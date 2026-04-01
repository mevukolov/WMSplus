(function () {
    const TABLE_PURE = "pure_losses_rep";
    const TABLE_LOSSES = "losses_rep";
    const URL_FILTER_CHUNK_SIZE = 80;
    const INSERT_CHUNK_SIZE = 400;
    const unsupportedInsertColumns = new Set();

    const COLUMN_VARIANTS = {
        shk: ["ШК", "shk", "Шк", "Штрихкод"],
        nm: ["ID номенклатуры", "ID Номенклатуры", "ID НМ", "nm"],
        decription: ["Наименования товара", "Наименование товара", "Товар"],
        brand: ["Наименования бренда", "Наименование бренда", "Бренд"],
        shk_state_before_lost: ["Статус перед списанием", "Статус ШК перед списанием"],
        wh_id: ["ID офиса статуса перед списанием", "ID офиса статуса перед списания", "wh_id"],
        date_lost: ["Дата последнего списания", "date_lost"],
        lr: ["Лостризон последнего списания", "ЛР последнего списания", "ID списания"],
        price: ["Сумма списания", "Сумма"],
        posted_flag: ["Флаг оприходования", "Оприходовано", "Флаг оприходован"]
    };

    const NORMALIZED_COLUMN_VARIANTS = Object.fromEntries(
        Object.entries(COLUMN_VARIANTS).map(([key, variants]) => [
            key,
            variants.map(normalizeHeaderKey)
        ])
    );

    const refreshBtn = document.getElementById("refresh-btn");
    const fileInput = document.getElementById("file-input");
    const statusLineEl = document.getElementById("status-line");
    const lastUploadDateEl = document.getElementById("last-upload-date");
    const openPureTableBtn = document.getElementById("open-pure-table-btn");
    const pureTableModalEl = document.getElementById("pure-table-modal");
    const pureTableCloseBtn = document.getElementById("pure-table-close-btn");
    const pureFilterLrBtn = document.getElementById("pure-filter-lr-btn");
    const pureFilterLrPanel = document.getElementById("pure-filter-lr-panel");
    const pureFilterLrList = document.getElementById("pure-filter-lr-list");
    const pureFilterStatusBtn = document.getElementById("pure-filter-status-btn");
    const pureFilterStatusPanel = document.getElementById("pure-filter-status-panel");
    const pureFilterStatusList = document.getElementById("pure-filter-status-list");
    const pureTableRefreshBtn = document.getElementById("pure-table-refresh-btn");
    const pureTableInlineStatusEl = document.getElementById("pure-table-inline-status");
    const pureTableBody = document.getElementById("pure-table-body");

    const tableState = {
        rows: [],
        filteredRows: [],
        activeLrs: new Set(),
        activeStatuses: new Set(),
        unsupportedUpdateColumns: new Set(),
        updateColumnMap: {
            decision: "opp_deecision",
            comment: "opp_comment",
            emp: "opp_emp",
            solved: "date_solved"
        }
    };

    if (!refreshBtn || !fileInput) return;

    const user = getCurrentUser();
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    const userWhId = normalizeToken(user.user_wh_id);

    if (!userWhId) {
        setStatus("Не удалось определить user_wh_id текущего пользователя.", "error");
    }

    refreshLastUploadedDate(userWhId);
    initPureTableModal();

    refreshBtn.addEventListener("click", () => {
        fileInput.value = "";
        fileInput.click();
    });

    fileInput.addEventListener("change", async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        await processImport(file, userWhId);
        fileInput.value = "";
    });

    async function processImport(file, currentUserWhId) {
        if (!currentUserWhId) {
            window.MiniUI?.toast?.("Не определён wh_id пользователя", { type: "error" });
            return;
        }
        if (typeof window.XLSX === "undefined") {
            window.MiniUI?.toast?.("Не загрузилась библиотека XLSX", { type: "error" });
            return;
        }
        if (typeof supabaseClient === "undefined" || !supabaseClient) {
            window.MiniUI?.toast?.("Supabase не инициализирован", { type: "error" });
            return;
        }

        setBusy(true);
        setStatus("Обработка данных", "info");

        try {
            const excelRows = await readExcelRows(file);
            if (!excelRows.length) {
                setStatus("Файл пустой", "error");
                window.MiniUI?.toast?.("Файл пустой", { type: "error" });
                return;
            }

            const autoLrSet = await loadAutoLossReasonIds();
            const prepared = prepareIncomingRows(excelRows, currentUserWhId, autoLrSet);

            if (!prepared.rowsByShk.size) {
                renderSummary({
                    insertedNew: 0
                });
                window.MiniUI?.toast?.("Подходящих строк для выгрузки не найдено", { type: "info" });
                return;
            }

            const incomingShks = Array.from(prepared.rowsByShk.keys());
            const existingByShk = await loadExistingRowsByShk(incomingShks);
            const syncPlan = buildSyncPlan(prepared.rowsByShk, existingByShk);

            await applySyncPlan(syncPlan);

            renderSummary(syncPlan.stats);
            await refreshLastUploadedDate(currentUserWhId);
            if (!pureTableModalEl?.classList.contains("hidden")) {
                await loadPureTableRows(currentUserWhId, { silent: true });
            }

            const updated = syncPlan.stats.insertedNew + syncPlan.stats.replacedByNewer;
            window.MiniUI?.toast?.(`Обновление завершено. Изменено строк: ${updated}`, { type: "success" });
        } catch (error) {
            const message = String(error?.message || error || "Неизвестная ошибка");
            console.error("pure_losses import failed:", error);
            setStatus(message, "error");
            window.MiniUI?.toast?.("Ошибка обновления данных", { type: "error" });
        } finally {
            setBusy(false);
        }
    }

    function initPureTableModal() {
        if (!openPureTableBtn || !pureTableModalEl || !pureTableBody) return;

        openPureTableBtn.addEventListener("click", async () => {
            pureTableModalEl.classList.remove("hidden");
            closePureTableFilterPanels();
            await loadPureTableRows(userWhId);
        });

        pureTableCloseBtn?.addEventListener("click", closePureTableModal);
        pureTableRefreshBtn?.addEventListener("click", async () => {
            await loadPureTableRows(userWhId);
        });

        pureFilterLrBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePureFilterPanel(pureFilterLrPanel);
        });

        pureFilterStatusBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePureFilterPanel(pureFilterStatusPanel);
        });

        pureTableModalEl.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.matches("[data-close-pure-table='1']")) {
                closePureTableModal();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if (pureTableModalEl.classList.contains("hidden")) return;
            closePureTableModal();
        });

        document.addEventListener("click", (event) => {
            if (pureTableModalEl.classList.contains("hidden")) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest(".status-dropdown")) return;
            closePureTableFilterPanels();
        });

        pureTableBody.addEventListener("blur", (event) => {
            void handlePureTableInputBlur(event);
        }, true);

        pureTableBody.addEventListener("keydown", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) return;
            if (event.key === "Enter") {
                event.preventDefault();
                target.blur();
            }
        });
    }

    function closePureTableModal() {
        pureTableModalEl?.classList.add("hidden");
        closePureTableFilterPanels();
    }

    function togglePureFilterPanel(panel) {
        if (!panel) return;
        const isHidden = panel.classList.contains("hidden");
        closePureTableFilterPanels();
        if (isHidden) panel.classList.remove("hidden");
    }

    function closePureTableFilterPanels() {
        pureFilterLrPanel?.classList.add("hidden");
        pureFilterStatusPanel?.classList.add("hidden");
    }

    async function loadPureTableRows(currentUserWhId, options = {}) {
        const { silent = false } = options;
        if (!pureTableBody) return;

        if (!currentUserWhId) {
            setPureTableInlineStatus("Не удалось определить wh_id пользователя.", "error");
            return;
        }
        if (typeof supabaseClient === "undefined" || !supabaseClient) {
            setPureTableInlineStatus("Supabase не инициализирован.", "error");
            return;
        }

        setPureTableInlineStatus("Загрузка данных...", "info");
        renderPureTablePlaceholder("Загрузка...");

        try {
            const rawRows = await fetchAllPureRowsForWh(currentUserWhId);
            resolvePureTableUpdateColumns(rawRows);

            tableState.rows = rawRows.map((row) => normalizePureTableRow(row));
            buildPureTableFilterControls(tableState.rows);
            applyPureTableFiltersAndRender();

            setPureTableInlineStatus(`Строк загружено: ${formatInt(tableState.rows.length)}`, "success");
            if (!silent) {
                window.MiniUI?.toast?.("Таблица чистых списаний загружена", { type: "success" });
            }
        } catch (error) {
            const message = String(error?.message || error || "Не удалось загрузить таблицу.");
            setPureTableInlineStatus(message, "error");
            renderPureTablePlaceholder(message);
            if (!silent) {
                window.MiniUI?.toast?.("Ошибка загрузки таблицы чистых списаний", { type: "error" });
            }
        }
    }

    async function fetchAllPureRowsForWh(currentUserWhId) {
        const all = [];
        const pageSize = 1000;

        for (let from = 0; ; from += pageSize) {
            const to = from + pageSize - 1;
            const { data, error } = await supabaseClient
                .from(TABLE_PURE)
                .select("*")
                .eq("wh_id", currentUserWhId)
                .order("date_lost", { ascending: false })
                .range(from, to);

            if (error) {
                throw new Error("Не удалось загрузить данные pure_losses_rep.");
            }

            const chunk = Array.isArray(data) ? data : [];
            if (!chunk.length) break;
            all.push(...chunk);
            if (chunk.length < pageSize) break;
        }

        return all;
    }

    function normalizePureTableRow(row) {
        return {
            raw: row || {},
            shk: normalizeShk(row?.shk),
            nm: row?.nm ?? "",
            description: toText(row?.description || row?.decription),
            brand: toText(row?.brand),
            shkStateBeforeLost: toText(row?.shk_state_before_lost || row?.shk_state) || "—",
            dateLost: toText(row?.date_lost),
            lr: normalizeLossReason(row?.lr) || toText(row?.lr) || "—",
            price: toNumberOrNull(row?.price),
            decision: toText(readEditableColumnValue(row, tableState.updateColumnMap.decision)),
            comment: toText(readEditableColumnValue(row, tableState.updateColumnMap.comment))
        };
    }

    function resolvePureTableUpdateColumns(rawRows) {
        const sample = Array.isArray(rawRows) ? rawRows.find((item) => item && typeof item === "object") : null;
        const keys = sample ? Object.keys(sample) : [];

        tableState.updateColumnMap.decision = pickFirstExistingColumn(
            keys,
            ["opp_deecision", "opp_decision"],
            "opp_deecision"
        );
        tableState.updateColumnMap.comment = pickFirstExistingColumn(
            keys,
            ["opp_comment"],
            "opp_comment"
        );
        tableState.updateColumnMap.emp = pickFirstExistingColumn(
            keys,
            ["opp_emp", "emp"],
            "opp_emp"
        );
        tableState.updateColumnMap.solved = pickFirstExistingColumn(
            keys,
            ["date_solved", "dt_solved"],
            "date_solved"
        );
    }

    function pickFirstExistingColumn(keys, candidates, fallback) {
        const safeKeys = Array.isArray(keys) ? keys : [];
        for (const candidate of candidates) {
            if (safeKeys.includes(candidate)) return candidate;
        }
        return fallback;
    }

    function readEditableColumnValue(row, key) {
        if (!row || !key) return "";
        if (!Object.prototype.hasOwnProperty.call(row, key)) return "";
        return row[key];
    }

    function buildPureTableFilterControls(rows) {
        const lrValues = Array.from(new Set(rows.map((row) => row.lr).filter((value) => String(value).trim() !== "")))
            .sort(sortMixedNumericStrings);
        const statusValues = Array.from(new Set(rows.map((row) => row.shkStateBeforeLost).filter(Boolean)))
            .sort((a, b) => String(a).localeCompare(String(b), "ru"));

        syncFilterSet(tableState.activeLrs, lrValues);
        syncFilterSet(tableState.activeStatuses, statusValues);

        renderFilterCheckboxList(
            pureFilterLrList,
            lrValues,
            tableState.activeLrs,
            () => {
                updateFilterButtonCaption(pureFilterLrBtn, tableState.activeLrs.size, lrValues.length);
                applyPureTableFiltersAndRender();
            }
        );
        renderFilterCheckboxList(
            pureFilterStatusList,
            statusValues,
            tableState.activeStatuses,
            () => {
                updateFilterButtonCaption(pureFilterStatusBtn, tableState.activeStatuses.size, statusValues.length);
                applyPureTableFiltersAndRender();
            }
        );

        updateFilterButtonCaption(pureFilterLrBtn, tableState.activeLrs.size, lrValues.length);
        updateFilterButtonCaption(pureFilterStatusBtn, tableState.activeStatuses.size, statusValues.length);
    }

    function syncFilterSet(set, values) {
        if (!set || !(set instanceof Set)) return;

        const safeValues = Array.isArray(values) ? values : [];
        if (!set.size) {
            safeValues.forEach((value) => set.add(value));
            return;
        }

        Array.from(set).forEach((value) => {
            if (!safeValues.includes(value)) set.delete(value);
        });

        if (!set.size && safeValues.length) {
            safeValues.forEach((value) => set.add(value));
        }
    }

    function renderFilterCheckboxList(container, values, selectedSet, onChange) {
        if (!container) return;
        container.innerHTML = "";

        const safeValues = Array.isArray(values) ? values : [];
        if (!safeValues.length) {
            const empty = document.createElement("div");
            empty.className = "muted";
            empty.textContent = "Нет значений";
            container.appendChild(empty);
            return;
        }

        safeValues.forEach((value) => {
            const label = document.createElement("label");
            label.className = "status-item";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = selectedSet.has(value);

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) selectedSet.add(value);
                else selectedSet.delete(value);
                onChange();
            });

            const span = document.createElement("span");
            span.textContent = String(value);

            label.append(checkbox, span);
            container.appendChild(label);
        });
    }

    function updateFilterButtonCaption(button, selectedCount, totalCount) {
        if (!button) return;
        const text = totalCount <= 0 || selectedCount === totalCount
            ? "Выбраны все"
            : `Выбрано ${selectedCount} из ${totalCount}`;
        button.innerHTML = `${escapeHtml(text)} <span class="caret">▾</span>`;
    }

    function applyPureTableFiltersAndRender() {
        tableState.filteredRows = tableState.rows.filter((row) => {
            const matchLr = tableState.activeLrs.has(row.lr);
            const matchStatus = tableState.activeStatuses.has(row.shkStateBeforeLost);
            return matchLr && matchStatus;
        });
        renderPureTableBody(tableState.filteredRows);
    }

    function renderPureTablePlaceholder(message) {
        if (!pureTableBody) return;
        pureTableBody.innerHTML = "";
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 10;
        td.className = "muted";
        td.textContent = String(message || "");
        tr.appendChild(td);
        pureTableBody.appendChild(tr);
    }

    function renderPureTableBody(rows) {
        if (!pureTableBody) return;
        pureTableBody.innerHTML = "";

        const safeRows = Array.isArray(rows) ? rows : [];
        if (!safeRows.length) {
            renderPureTablePlaceholder("По выбранным фильтрам строк нет.");
            return;
        }

        safeRows.forEach((row) => {
            const tr = document.createElement("tr");

            tr.appendChild(createPlainCell(row.shk));
            tr.appendChild(createPlainCell(row.nm));
            tr.appendChild(createPlainCell(row.description, "pure-wrap-cell"));
            tr.appendChild(createPlainCell(row.brand));
            tr.appendChild(createPlainCell(row.shkStateBeforeLost));
            tr.appendChild(createPlainCell(formatDateForUi(row.dateLost)));
            tr.appendChild(createPlainCell(row.lr));
            tr.appendChild(createPlainCell(formatPriceForUi(row.price)));

            const verdictTd = document.createElement("td");
            const verdictInput = document.createElement("input");
            verdictInput.className = "input pure-edit-input short";
            verdictInput.type = "text";
            verdictInput.value = row.decision;
            verdictInput.placeholder = "Вердикт";
            verdictInput.dataset.shk = row.shk;
            verdictInput.dataset.field = "decision";
            verdictTd.appendChild(verdictInput);
            tr.appendChild(verdictTd);

            const commentTd = document.createElement("td");
            const commentInput = document.createElement("input");
            commentInput.className = "input pure-edit-input";
            commentInput.type = "text";
            commentInput.value = row.comment;
            commentInput.placeholder = "Комментарий";
            commentInput.dataset.shk = row.shk;
            commentInput.dataset.field = "comment";
            commentTd.appendChild(commentInput);
            tr.appendChild(commentTd);

            pureTableBody.appendChild(tr);
        });
    }

    function createPlainCell(value, className = "") {
        const td = document.createElement("td");
        if (className) td.className = className;
        td.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
        return td;
    }

    async function handlePureTableInputBlur(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!target.classList.contains("pure-edit-input")) return;

        const shk = normalizeShk(target.dataset.shk);
        const field = target.dataset.field;
        if (!shk || !field) return;

        const row = tableState.rows.find((item) => item.shk === shk);
        if (!row) return;

        const previousValue = field === "decision" ? row.decision : row.comment;
        const nextValue = String(target.value || "").trim();
        if (nextValue === previousValue) return;

        const patch = {};
        if (field === "decision") {
            patch[tableState.updateColumnMap.decision] = nextValue || null;
            if (nextValue) {
                patch[tableState.updateColumnMap.emp] = resolveCurrentUserName(user);
                patch[tableState.updateColumnMap.solved] = resolveCurrentTimestamp();
            } else {
                patch[tableState.updateColumnMap.emp] = null;
                patch[tableState.updateColumnMap.solved] = null;
            }
        } else if (field === "comment") {
            patch[tableState.updateColumnMap.comment] = nextValue || null;
        } else {
            return;
        }

        target.disabled = true;
        setPureTableInlineStatus("Сохраняем изменения...", "info");

        try {
            const appliedPatch = await updatePureRowFields(shk, userWhId, patch);
            Object.assign(row.raw, appliedPatch);
            row.decision = toText(readEditableColumnValue(row.raw, tableState.updateColumnMap.decision));
            row.comment = toText(readEditableColumnValue(row.raw, tableState.updateColumnMap.comment));

            target.value = field === "decision" ? row.decision : row.comment;
            setPureTableInlineStatus("Изменения сохранены", "success");
        } catch (error) {
            target.value = previousValue;
            const message = String(error?.message || error || "Не удалось сохранить изменения.");
            setPureTableInlineStatus(message, "error");
            window.MiniUI?.toast?.("Ошибка сохранения строки", { type: "error" });
        } finally {
            target.disabled = false;
        }
    }

    async function updatePureRowFields(shk, currentUserWhId, patch) {
        const sanitized = sanitizeUpdatePatch(patch);
        if (!Object.keys(sanitized).length) {
            throw new Error("В таблице отсутствуют поля для сохранения.");
        }

        const { error } = await supabaseClient
            .from(TABLE_PURE)
            .update(sanitized)
            .eq("shk", shk)
            .eq("wh_id", currentUserWhId);

        if (!error) return sanitized;

        const missingColumn = extractMissingColumnName(error);
        if (missingColumn && Object.prototype.hasOwnProperty.call(sanitized, missingColumn)) {
            tableState.unsupportedUpdateColumns.add(missingColumn);
            return updatePureRowFields(shk, currentUserWhId, patch);
        }

        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Ошибка обновления строки ${shk}: ${errorText}`);
    }

    function sanitizeUpdatePatch(patch) {
        const out = {};
        Object.entries(patch || {}).forEach(([key, value]) => {
            if (!key) return;
            if (tableState.unsupportedUpdateColumns.has(key)) return;
            out[key] = value;
        });
        return out;
    }

    function resolveCurrentUserName(currentUser) {
        return toText(currentUser?.name || currentUser?.fio || currentUser?.id || "Неизвестный пользователь");
    }

    function resolveCurrentTimestamp() {
        if (typeof window.MiniUI?.nowIsoPlus3 === "function") {
            return window.MiniUI.nowIsoPlus3();
        }
        return new Date().toISOString();
    }

    function setPureTableInlineStatus(message, type) {
        if (!pureTableInlineStatusEl) return;
        pureTableInlineStatusEl.textContent = String(message || "");
        pureTableInlineStatusEl.style.color = type === "error"
            ? "#b91c1c"
            : type === "success"
                ? "#15803d"
                : "#64748b";
    }

    async function refreshLastUploadedDate(currentUserWhId) {
        if (!lastUploadDateEl) return;

        if (!currentUserWhId || typeof supabaseClient === "undefined" || !supabaseClient) {
            lastUploadDateEl.textContent = "Последняя выгруженная дата: —";
            return;
        }

        try {
            const { data, error } = await supabaseClient
                .from(TABLE_PURE)
                .select("date_lost")
                .eq("wh_id", currentUserWhId)
                .order("date_lost", { ascending: false })
                .limit(1);

            if (error) {
                lastUploadDateEl.textContent = "Последняя выгруженная дата: —";
                return;
            }

            const rawDate = Array.isArray(data) && data[0] ? data[0].date_lost : "";
            const formatted = formatDateForUi(rawDate);
            lastUploadDateEl.textContent = `Последняя выгруженная дата: ${formatted || "—"}`;
        } catch {
            lastUploadDateEl.textContent = "Последняя выгруженная дата: —";
        }
    }

    async function readExcelRows(file) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames && workbook.SheetNames[0];
        if (!firstSheetName) return [];

        const firstSheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
        return Array.isArray(rows) ? rows : [];
    }

    async function loadAutoLossReasonIds() {
        const { data, error } = await supabaseClient
            .from(TABLE_LOSSES)
            .select("writeoff_id, is_auto");

        if (error) {
            throw new Error("Не удалось загрузить справочник losses_rep (writeoff_id/is_auto).");
        }

        const autoIds = new Set();
        (data || []).forEach((row) => {
            if (!isTrueLike(row?.is_auto)) return;
            const normalized = normalizeLossReason(row?.writeoff_id);
            if (normalized) autoIds.add(normalized);
        });
        return autoIds;
    }

    function prepareIncomingRows(rows, currentUserWhId, autoLrSet) {
        const rowsByShk = new Map();
        const stats = {
            skippedByWh: 0,
            skippedPostedFlag: 0,
            skippedByIsAuto: 0,
            skippedInvalid: 0,
            duplicateInFileIgnored: 0,
            duplicateInFileReplaced: 0
        };

        for (const row of rows) {
            const normalizedRow = buildNormalizedRow(row);

            const whId = normalizeToken(getCellValue(row, normalizedRow, "wh_id"));
            if (!whId || whId !== currentUserWhId) {
                stats.skippedByWh += 1;
                continue;
            }

            const postedFlag = getCellValue(row, normalizedRow, "posted_flag");
            if (isTrueLike(postedFlag)) {
                stats.skippedPostedFlag += 1;
                continue;
            }

            const lrRaw = getCellValue(row, normalizedRow, "lr");
            const lr = normalizeLossReason(lrRaw);
            if (!lr || !autoLrSet.has(lr)) {
                stats.skippedByIsAuto += 1;
                continue;
            }

            const shk = normalizeShk(getCellValue(row, normalizedRow, "shk"));
            const dateObj = parseDateValue(getCellValue(row, normalizedRow, "date_lost"));

            if (!shk || !dateObj) {
                stats.skippedInvalid += 1;
                continue;
            }

            const incoming = {
                shk,
                nm: toIntegerOrNull(getCellValue(row, normalizedRow, "nm")),
                decription: toText(getCellValue(row, normalizedRow, "decription")),
                brand: toText(getCellValue(row, normalizedRow, "brand")),
                shk_state_before_lost: toText(getCellValue(row, normalizedRow, "shk_state_before_lost")),
                wh_id: whId,
                date_lost: formatIsoDate(dateObj),
                lr: toIntegerOrNull(lrRaw) ?? toIntegerOrNull(lr) ?? lr,
                price: toNumberOrNull(getCellValue(row, normalizedRow, "price")) ?? 0,
                __dateTs: dateObj.getTime()
            };

            const prev = rowsByShk.get(shk);
            if (!prev) {
                rowsByShk.set(shk, incoming);
                continue;
            }

            const compare = compareDateTs(incoming.__dateTs, prev.__dateTs);
            if (compare > 0) {
                rowsByShk.set(shk, incoming);
                stats.duplicateInFileReplaced += 1;
            } else {
                stats.duplicateInFileIgnored += 1;
            }
        }

        return { rowsByShk, stats };
    }

    async function loadExistingRowsByShk(shks) {
        const result = new Map();
        const chunks = chunkArray(shks, URL_FILTER_CHUNK_SIZE);

        for (const idsChunk of chunks) {
            const data = await fetchPureRowsByShkChunk(idsChunk);

            (data || []).forEach((row) => {
                const shk = normalizeShk(row?.shk);
                if (!shk) return;
                if (!result.has(shk)) result.set(shk, []);
                result.get(shk).push(row);
            });
        }

        return result;
    }

    async function fetchPureRowsByShkChunk(shksChunk) {
        if (!Array.isArray(shksChunk) || !shksChunk.length) return [];

        const { data, error } = await supabaseClient
            .from(TABLE_PURE)
            .select("*")
            .in("shk", shksChunk);

        if (!error) return Array.isArray(data) ? data : [];

        if (shksChunk.length > 1) {
            const mid = Math.ceil(shksChunk.length / 2);
            const left = await fetchPureRowsByShkChunk(shksChunk.slice(0, mid));
            const right = await fetchPureRowsByShkChunk(shksChunk.slice(mid));
            return left.concat(right);
        }

        const oneShk = shksChunk[0];
        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Не удалось проверить ШК ${oneShk} в pure_losses_rep: ${errorText}`);
    }

    function buildSyncPlan(rowsByShk, existingByShk) {
        const rowsToInsert = [];
        const deleteShks = new Set();
        const stats = {
            insertedNew: 0,
            replacedByNewer: 0,
            skippedSameDate: 0,
            skippedOlderDate: 0,
            dedupedExistingRows: 0
        };

        for (const [shk, incoming] of rowsByShk.entries()) {
            const existingRows = existingByShk.get(shk) || [];

            if (!existingRows.length) {
                rowsToInsert.push(toInsertPayload(incoming));
                stats.insertedNew += 1;
                continue;
            }

            const existingNewest = getNewestExistingRow(existingRows);
            const compare = compareDateTs(incoming.__dateTs, existingNewest.ts);

            if (compare > 0) {
                deleteShks.add(shk);
                rowsToInsert.push(toInsertPayload(incoming));
                stats.replacedByNewer += 1;
            } else {
                if (existingRows.length > 1) {
                    deleteShks.add(shk);
                    rowsToInsert.push(toInsertPayloadFromExisting(existingNewest.row, shk));
                    stats.dedupedExistingRows += (existingRows.length - 1);
                }

                if (compare === 0) {
                    stats.skippedSameDate += 1;
                } else {
                    stats.skippedOlderDate += 1;
                }
            }
        }

        return {
            deleteShks: Array.from(deleteShks),
            rowsToInsert,
            stats
        };
    }

    async function applySyncPlan(syncPlan) {
        const deleteChunks = chunkArray(syncPlan.deleteShks, URL_FILTER_CHUNK_SIZE);
        for (const idsChunk of deleteChunks) {
            const { error } = await supabaseClient
                .from(TABLE_PURE)
                .delete()
                .in("shk", idsChunk);

            if (error) {
                throw new Error("Не удалось удалить старые строки по ШК перед обновлением.");
            }
        }

        const insertChunks = chunkArray(syncPlan.rowsToInsert, INSERT_CHUNK_SIZE);
        for (const rowsChunk of insertChunks) {
            await insertRowsAdaptive(rowsChunk);
        }
    }

    async function insertRowsAdaptive(rowsChunk) {
        const preparedRows = rowsChunk
            .map((row) => sanitizeInsertRow(row))
            .filter((row) => Object.keys(row).length > 0);

        if (!preparedRows.length) return;

        const { error } = await supabaseClient
            .from(TABLE_PURE)
            .insert(preparedRows);

        if (!error) return;

        const missingColumn = extractMissingColumnName(error);
        if (
            missingColumn
            && preparedRows.some((row) => Object.prototype.hasOwnProperty.call(row, missingColumn))
        ) {
            unsupportedInsertColumns.add(missingColumn);
            await insertRowsAdaptive(rowsChunk);
            return;
        }

        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Не удалось вставить новые строки в pure_losses_rep: ${errorText}`);
    }

    function sanitizeInsertRow(row) {
        const out = {};
        Object.entries(row || {}).forEach(([key, value]) => {
            if (unsupportedInsertColumns.has(key)) return;
            if (value === undefined) return;
            out[key] = value;
        });
        return out;
    }

    function extractMissingColumnName(error) {
        const text = String(error?.message || error?.details || "");
        if (!text) return "";

        const match = text.match(/column\s+([^\s]+)\s+does not exist/i);
        if (!match || !match[1]) return "";

        const token = String(match[1]).replace(/"/g, "");
        const parts = token.split(".");
        return parts[parts.length - 1] || "";

    }

    function toInsertPayload(row) {
        return {
            shk: row.shk,
            nm: row.nm,
            decription: row.decription,
            brand: row.brand,
            shk_state_before_lost: row.shk_state_before_lost,
            wh_id: row.wh_id,
            date_lost: row.date_lost,
            lr: row.lr,
            price: row.price
        };
    }

    function toInsertPayloadFromExisting(row, fallbackShk) {
        const date = parseDateValue(row?.date_lost);
        return {
            shk: normalizeShk(row?.shk) || fallbackShk,
            nm: toIntegerOrNull(row?.nm),
            decription: toText(row?.decription),
            brand: toText(row?.brand),
            shk_state_before_lost: toText(row?.shk_state_before_lost || row?.shk_state),
            wh_id: normalizeToken(row?.wh_id),
            date_lost: date ? formatIsoDate(date) : (toText(row?.date_lost) || null),
            lr: toIntegerOrNull(row?.lr) ?? normalizeLossReason(row?.lr),
            price: toNumberOrNull(row?.price) ?? 0
        };
    }

    function renderSummary(syncStats) {
        setStatus(`Добавлено строк: ${formatInt(syncStats?.insertedNew)}`, "success");
    }

    function setBusy(busy) {
        refreshBtn.disabled = busy;
        refreshBtn.textContent = "Загрузить .xlsx";
        window.MiniUI?.setLoaderVisible?.(busy);
    }

    function setStatus(message, type) {
        if (!statusLineEl) return;
        const text = String(message || "").trim();
        statusLineEl.textContent = text;
        statusLineEl.style.display = text ? "block" : "none";
        statusLineEl.style.color = type === "error"
            ? "#dc2626"
            : type === "success"
                ? "#15803d"
                : "#334155";
    }

    function getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }

    function getCellValue(rawRow, normalizedRow, columnKey) {
        const variants = COLUMN_VARIANTS[columnKey] || [];
        for (const name of variants) {
            if (Object.prototype.hasOwnProperty.call(rawRow, name)) {
                return rawRow[name];
            }
        }

        const normalizedVariants = NORMALIZED_COLUMN_VARIANTS[columnKey] || [];
        for (const normalized of normalizedVariants) {
            if (Object.prototype.hasOwnProperty.call(normalizedRow, normalized)) {
                return normalizedRow[normalized];
            }
        }
        return "";
    }

    function buildNormalizedRow(row) {
        const output = {};
        Object.keys(row || {}).forEach((key) => {
            output[normalizeHeaderKey(key)] = row[key];
        });
        return output;
    }

    function normalizeHeaderKey(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/\u00a0/g, " ")
            .replace(/ё/g, "е")
            .replace(/['"`]/g, "")
            .replace(/[()\[\]]/g, "")
            .replace(/[\s_-]+/g, "");
    }

    function normalizeToken(value) {
        if (value === null || value === undefined) return "";

        if (typeof value === "number" && Number.isFinite(value)) {
            if (Number.isInteger(value)) return String(value);
            return String(value).replace(/\.0+$/, "");
        }

        const raw = String(value).trim();
        if (!raw) return "";

        const compact = raw.replace(/\s+/g, "");
        if (/^-?\d+\.0+$/.test(compact)) {
            return compact.replace(/\.0+$/, "");
        }
        return compact;
    }

    function normalizeShk(value) {
        return normalizeToken(value);
    }

    function normalizeLossReason(value) {
        const token = normalizeToken(value);
        if (!token) return "";

        if (/^-?\d+$/.test(token)) {
            return String(parseInt(token, 10));
        }

        const intValue = toIntegerOrNull(token);
        if (intValue !== null) return String(intValue);

        return token;
    }

    function toText(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim();
    }

    function toIntegerOrNull(value) {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);

        const raw = String(value)
            .trim()
            .replace(/\u00a0/g, "")
            .replace(/\s+/g, "")
            .replace(",", ".");

        if (!raw) return null;
        if (/^-?\d+$/.test(raw)) return Number(raw);

        const parsed = Number(raw);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }

    function toNumberOrNull(value) {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number" && Number.isFinite(value)) return value;

        const raw = String(value)
            .trim()
            .replace(/\u00a0/g, "")
            .replace(/\s+/g, "");

        if (!raw) return null;

        let normalized = raw;
        const hasComma = raw.includes(",");
        const hasDot = raw.includes(".");

        if (hasComma && hasDot) {
            const lastComma = raw.lastIndexOf(",");
            const lastDot = raw.lastIndexOf(".");
            if (lastComma > lastDot) {
                normalized = raw.replace(/\./g, "").replace(",", ".");
            } else {
                normalized = raw.replace(/,/g, "");
            }
        } else if (hasComma) {
            normalized = raw.replace(",", ".");
        }

        normalized = normalized.replace(/[^\d.-]/g, "");
        if (!normalized) return null;

        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function isTrueLike(value) {
        if (value === true) return true;
        if (value === false || value === 0 || value === null || value === undefined) return false;

        const normalized = String(value).trim().toLowerCase();
        return normalized === "true"
            || normalized === "1"
            || normalized === "yes"
            || normalized === "да";
    }

    function parseDateValue(value) {
        if (value === null || value === undefined || value === "") return null;

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return new Date(value.getFullYear(), value.getMonth(), value.getDate());
        }

        if (typeof value === "number" && Number.isFinite(value)) {
            const excelEpochOffset = 25569;
            const dayMs = 86400 * 1000;
            const ts = (Math.floor(value) - excelEpochOffset) * dayMs;
            const d = new Date(ts);
            if (!Number.isNaN(d.getTime())) {
                return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            }
        }

        const raw = String(value).trim();
        if (!raw) return null;

        const datePart = raw.replace("T", " ").split(" ")[0];

        let match = datePart.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
        if (match) {
            let year = Number(match[3]);
            if (year < 100) year += 2000;

            const date = new Date(year, Number(match[2]) - 1, Number(match[1]));
            if (!Number.isNaN(date.getTime())) return date;
        }

        match = datePart.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
        if (match) {
            const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            if (!Number.isNaN(date.getTime())) return date;
        }

        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
        }

        return null;
    }

    function formatIsoDate(dateObj) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, "0");
        const d = String(dateObj.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    function compareDateTs(leftTs, rightTs) {
        const left = Number.isFinite(leftTs) ? leftTs : null;
        const right = Number.isFinite(rightTs) ? rightTs : null;

        if (left === null && right === null) return 0;
        if (left !== null && right === null) return 1;
        if (left === null && right !== null) return -1;
        if (left === right) return 0;
        return left > right ? 1 : -1;
    }

    function getNewestExistingRow(rows) {
        let newestRow = rows[0] || null;
        let newestTs = null;

        for (const row of rows) {
            const parsed = parseDateValue(row?.date_lost);
            if (!parsed) continue;

            const ts = parsed.getTime();
            if (newestTs === null || ts > newestTs) {
                newestTs = ts;
                newestRow = row;
            }
        }

        return {
            row: newestRow,
            ts: newestTs
        };
    }

    function chunkArray(items, chunkSize) {
        const out = [];
        const size = Math.max(Number(chunkSize || 1), 1);
        for (let i = 0; i < items.length; i += size) {
            out.push(items.slice(i, i + size));
        }
        return out;
    }

    function sortMixedNumericStrings(a, b) {
        const aNum = Number(a);
        const bNum = Number(b);
        const aIsNum = Number.isFinite(aNum);
        const bIsNum = Number.isFinite(bNum);

        if (aIsNum && bIsNum) return aNum - bNum;
        if (aIsNum) return -1;
        if (bIsNum) return 1;
        return String(a).localeCompare(String(b), "ru");
    }

    function formatDateForUi(value) {
        const parsed = parseDateValue(value);
        if (!parsed) return toText(value);
        const dd = String(parsed.getDate()).padStart(2, "0");
        const mm = String(parsed.getMonth() + 1).padStart(2, "0");
        const yyyy = parsed.getFullYear();
        return `${dd}.${mm}.${yyyy}`;
    }

    function formatPriceForUi(value) {
        const num = toNumberOrNull(value);
        if (num === null) return "—";
        return new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(num);
    }

    function formatInt(value) {
        const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
        return Math.trunc(safe).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
})();
