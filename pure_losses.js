(function () {
    const TABLE_PURE = "pure_losses_rep";
    const TABLE_LOSSES = "losses_rep";
    const TABLE_2SHK = "2shk_rep";
    const TABLE_NM = "nm_rep";
    const TABLE_WH_DATA = "wh_data_rep";
    const URL_FILTER_CHUNK_SIZE = 80;
    const INSERT_CHUNK_SIZE = 400;
    const WMS_FILTER_CHUNK_SIZE = 60;
    const EVENT_TWO_SHK = "Два ШК";
    const EVENT_EMPTY_PACK = "Пустая упаковка";
    const DATA_TYPE_OPP_PURE_OPTIONS = "opp_pure_options";
    const EXTRA_FILTER_VALUES = ["2 ШК", "Пустая упаковка", "Оприход", "Пусто"];
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
    const pureFilterExtraBtn = document.getElementById("pure-filter-extra-btn");
    const pureFilterExtraPanel = document.getElementById("pure-filter-extra-panel");
    const pureFilterExtraList = document.getElementById("pure-filter-extra-list");
    const pureUnresolvedOnlyCheckbox = document.getElementById("pure-unresolved-only");
    const pureTableRefreshBtn = document.getElementById("pure-table-refresh-btn");
    const pureTableInlineStatusEl = document.getElementById("pure-table-inline-status");
    const pureTableBody = document.getElementById("pure-table-body");
    const pureTableHead = document.getElementById("pure-table-head");

    const tableState = {
        rows: [],
        filteredRows: [],
        activeLrs: new Set(),
        activeStatuses: new Set(),
        activeExtraStatuses: new Set(),
        decisionOptions: [],
        onlyUnresolved: false,
        sortKey: "price",
        sortDir: -1,
        wmsLoadSeq: 0,
        activeWmsPopover: null,
        activeVerdictPanel: null,
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

        pureUnresolvedOnlyCheckbox?.addEventListener("change", () => {
            tableState.onlyUnresolved = Boolean(pureUnresolvedOnlyCheckbox.checked);
            applyPureTableFiltersAndRender();
        });

        pureFilterLrBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePureFilterPanel(pureFilterLrPanel);
        });

        pureFilterStatusBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePureFilterPanel(pureFilterStatusPanel);
        });

        pureFilterExtraBtn?.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePureFilterPanel(pureFilterExtraPanel);
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
            closeAllWmsPopovers();
            closePureTableModal();
        });

        document.addEventListener("click", (event) => {
            if (pureTableModalEl.classList.contains("hidden")) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest(".pure-row-verdict-dropdown")) {
                closePureTableFilterPanels();
                closeAllWmsPopovers();
                return;
            }
            if (target.closest(".status-dropdown")) {
                closeActiveVerdictPanel();
                closeAllWmsPopovers();
                return;
            }
            if (target.closest(".pure-wms-popover-wrap")) {
                closeActiveVerdictPanel();
                return;
            }
            closePureTableFilterPanels();
            closeActiveVerdictPanel();
            closeAllWmsPopovers();
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

        pureTableBody.addEventListener("click", (event) => {
            void handlePureTableBodyClick(event);
        });

        pureTableHead?.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const th = target.closest("th[data-sort-key]");
            if (!th) return;

            const key = String(th.getAttribute("data-sort-key") || "").trim();
            if (!key) return;

            if (tableState.sortKey === key) {
                tableState.sortDir = tableState.sortDir * -1;
            } else {
                tableState.sortKey = key;
                tableState.sortDir = key === "dateLost" || key === "price" ? -1 : 1;
            }
            applyPureTableFiltersAndRender();
        });
    }

    function closePureTableModal() {
        pureTableModalEl?.classList.add("hidden");
        closePureTableFilterPanels();
        closeActiveVerdictPanel();
        closeAllWmsPopovers();
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
        pureFilterExtraPanel?.classList.add("hidden");
    }

    async function loadPureTableRows(currentUserWhId, options = {}) {
        const { silent = false } = options;
        if (!pureTableBody) return;
        const wmsSeq = ++tableState.wmsLoadSeq;

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
            const [rawRows, loadedDecisionOptions] = await Promise.all([
                fetchAllPureRowsForWh(currentUserWhId),
                loadDecisionOptionsForPureTable(currentUserWhId).catch((error) => {
                    console.error("pure_losses decision options load failed:", error);
                    return [];
                })
            ]);
            resolvePureTableUpdateColumns(rawRows);

            tableState.rows = rawRows.map((row) => normalizePureTableRow(row));
            tableState.decisionOptions = loadedDecisionOptions.length
                ? loadedDecisionOptions
                : buildDecisionOptionsFallback(rawRows);
            const rowsRef = tableState.rows;
            buildPureTableFilterControls(tableState.rows);
            applyPureTableFiltersAndRender();

            const baseCountText = `Строк загружено: ${formatInt(tableState.rows.length)}`;
            setPureTableInlineStatus(baseCountText, "success");
            if (!silent) {
                window.MiniUI?.toast?.("Таблица чистых списаний загружена", { type: "success" });
            }

            if (!rowsRef.length) return;

            setPureTableInlineStatus(`${baseCountText}. Загружаем База WMS+...`, "info");
            void enrichRowsWithWmsBase(rowsRef)
                .then(() => {
                    if (tableState.wmsLoadSeq !== wmsSeq) return;
                    if (tableState.rows !== rowsRef) return;
                    applyPureTableFiltersAndRender();
                    setPureTableInlineStatus(`${baseCountText}. База WMS+ загружена`, "success");
                })
                .catch((wmsError) => {
                    if (tableState.wmsLoadSeq !== wmsSeq) return;
                    if (tableState.rows !== rowsRef) return;
                    console.error("pure_losses wms_base lookup failed:", wmsError);
                    setPureTableInlineStatus(`${baseCountText}. База WMS+ временно недоступна`, "error");
                });
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
            comment: toText(readEditableColumnValue(row, tableState.updateColumnMap.comment)),
            wmsTwoShk: [],
            wmsNmRep: []
        };
    }

    async function loadDecisionOptionsForPureTable(currentUserWhId) {
        const fetchRows = async (withWhFilter) => {
            let query = supabaseClient
                .from(TABLE_WH_DATA)
                .select("data, wh_id, data_type")
                .eq("data_type", DATA_TYPE_OPP_PURE_OPTIONS)
                .limit(500);

            if (withWhFilter && currentUserWhId) {
                query = query.eq("wh_id", currentUserWhId);
            }

            const { data, error } = await query;
            if (error) {
                const errorText = String(error?.message || error?.details || error?.code || "unknown");
                throw new Error(`Не удалось загрузить варианты вердикта: ${errorText}`);
            }
            return Array.isArray(data) ? data : [];
        };

        let scopedRows = [];
        try {
            scopedRows = await fetchRows(true);
        } catch (error) {
            console.error("pure_losses decision options scoped load failed:", error);
        }

        let options = parseDecisionOptionsRows(scopedRows);
        if (options.length) return options;

        const fallbackRows = await fetchRows(false);
        options = parseDecisionOptionsRows(fallbackRows);
        return options;
    }

    function parseDecisionOptionsRows(rows) {
        const out = [];
        const seen = new Set();

        (Array.isArray(rows) ? rows : []).forEach((row) => {
            parseDecisionOptionsPayload(row?.data).forEach((option) => {
                const key = option.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                out.push(option);
            });
        });

        return out;
    }

    function parseDecisionOptionsPayload(payload) {
        if (payload === null || payload === undefined) return [];
        if (Array.isArray(payload)) {
            return payload
                .map((item) => sanitizeDecisionOptionText(item))
                .filter(Boolean);
        }

        const raw = String(payload).trim();
        if (!raw) return [];

        if (raw.startsWith("[") && raw.endsWith("]")) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed
                        .map((item) => sanitizeDecisionOptionText(item))
                        .filter(Boolean);
                }
            } catch (_) {
                // fallback below
            }
        }

        return raw
            .split(/[\r\n;]+/)
            .map((item) => sanitizeDecisionOptionText(item))
            .filter(Boolean);
    }

    function sanitizeDecisionOptionText(value) {
        const text = String(value || "")
            .trim()
            .replace(/^"+|"+$/g, "")
            .replace(/^'+|'+$/g, "")
            .replace(/\s+/g, " ");
        return text;
    }

    function buildDecisionOptionsFallback(rawRows) {
        const seen = new Set();
        const out = [];
        (Array.isArray(rawRows) ? rawRows : []).forEach((row) => {
            const decision = toText(readEditableColumnValue(row, tableState.updateColumnMap.decision));
            if (!decision) return;
            const key = decision.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push(decision);
        });
        return out;
    }

    async function enrichRowsWithWmsBase(rows) {
        const safeRows = Array.isArray(rows) ? rows : [];
        if (!safeRows.length) return;

        const uniqueShks = Array.from(new Set(
            safeRows.map((row) => normalizeShk(row?.shk)).filter(Boolean)
        ));
        const uniqueNms = Array.from(new Set(
            safeRows.map((row) => normalizeNmKey(row?.nm)).filter(Boolean)
        ));

        const [twoShkMap, nmRepMap] = await Promise.all([
            fetchTwoShkRowsForShks(uniqueShks),
            fetchNmRepRowsForNms(uniqueNms)
        ]);

        safeRows.forEach((row) => {
            const shk = normalizeShk(row?.shk);
            const nm = normalizeNmKey(row?.nm);
            row.wmsTwoShk = twoShkMap.get(shk) || [];
            row.wmsNmRep = nmRepMap.get(nm) || [];
        });
    }

    async function fetchTwoShkRowsForShks(shks) {
        const uniqueShks = Array.from(new Set((Array.isArray(shks) ? shks : []).map(normalizeShk).filter(Boolean)));
        if (!uniqueShks.length) return new Map();

        const chunks = chunkArray(uniqueShks, WMS_FILTER_CHUNK_SIZE);
        const allRows = [];
        for (const chunk of chunks) {
            const [byShk1, byShk2] = await Promise.all([
                fetchTwoShkRowsByColumnChunk("shk1", chunk),
                fetchTwoShkRowsByColumnChunk("shk2", chunk)
            ]);
            allRows.push(...byShk1, ...byShk2);
        }

        return mapTwoShkRowsByShk(allRows);
    }

    async function fetchTwoShkRowsByColumnChunk(columnName, shksChunk) {
        const chunk = Array.isArray(shksChunk) ? shksChunk.filter(Boolean) : [];
        if (!chunk.length) return [];

        const { data, error } = await supabaseClient
            .from(TABLE_2SHK)
            .select("*")
            .in(columnName, chunk);

        if (!error) {
            return Array.isArray(data) ? data : [];
        }

        const missingColumn = extractMissingColumnName(error);
        if (missingColumn && missingColumn === columnName) {
            return [];
        }

        if (chunk.length > 1) {
            const mid = Math.ceil(chunk.length / 2);
            const left = await fetchTwoShkRowsByColumnChunk(columnName, chunk.slice(0, mid));
            const right = await fetchTwoShkRowsByColumnChunk(columnName, chunk.slice(mid));
            return left.concat(right);
        }

        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Не удалось проверить ШК ${chunk[0]} в ${TABLE_2SHK}: ${errorText}`);
    }

    function mapTwoShkRowsByShk(rows) {
        const map = new Map();
        const seen = new Set();

        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const signature = buildTwoShkRowSignature(row);
            if (!signature || seen.has(signature)) return;
            seen.add(signature);

            const shk1 = normalizeShk(row?.shk1);
            const shk2 = normalizeShk(row?.shk2);
            if (!shk1 && !shk2) return;

            const eventType = classifyTwoShkEventType(row?.eventtype, shk1, shk2);
            const dateValue = row?.created_at || row?.date || row?.inserted_at || row?.updated_at || "";
            const ts = parseTimestampValue(dateValue);
            const mediaLinks = parseMediaLinksFromTwoShkRow(row);

            const base = {
                eventType,
                shk1,
                shk2,
                dateValue,
                ts,
                mediaLinks
            };

            if (shk1) {
                if (!map.has(shk1)) map.set(shk1, []);
                map.get(shk1).push({
                    ...base,
                    otherShk: shk2 && shk2 !== shk1 ? shk2 : ""
                });
            }

            if (shk2 && shk2 !== shk1) {
                if (!map.has(shk2)) map.set(shk2, []);
                map.get(shk2).push({
                    ...base,
                    otherShk: shk1
                });
            }
        });

        map.forEach((items, key) => {
            const sorted = (items || []).slice().sort((a, b) => compareDateTs(b?.ts, a?.ts));
            map.set(key, sorted);
        });

        return map;
    }

    function classifyTwoShkEventType(value, shk1, shk2) {
        const normalized = String(value || "")
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/[^\wа-я\s]/gi, " ")
            .replace(/\s+/g, " ")
            .trim();

        if (normalized.includes("пуст") && normalized.includes("упаков")) {
            return EVENT_EMPTY_PACK;
        }
        if (normalized.includes("2") && normalized.includes("шк")) {
            return EVENT_TWO_SHK;
        }
        if (normalized.includes("два") && normalized.includes("шк")) {
            return EVENT_TWO_SHK;
        }
        if (normalized.includes("пуст")) {
            return EVENT_EMPTY_PACK;
        }

        if (shk1 && shk2 && shk1 !== shk2) {
            return EVENT_TWO_SHK;
        }
        return EVENT_EMPTY_PACK;
    }

    function buildTwoShkRowSignature(row) {
        if (!row || typeof row !== "object") return "";
        const id = normalizeToken(row?.id || row?.two_shk_id || row?.row_id);
        if (id) return `id:${id}`;

        const dateValue = normalizeToken(row?.created_at || row?.date || row?.inserted_at || row?.updated_at);
        const shk1 = normalizeShk(row?.shk1);
        const shk2 = normalizeShk(row?.shk2);
        const eventType = normalizeToken(row?.eventtype);
        return `${dateValue}|${shk1}|${shk2}|${eventType}`;
    }

    function parseMediaLinksFromTwoShkRow(row) {
        const mediaFields = [
            row?.media,
            row?.media_links,
            row?.photos,
            row?.photo
        ];

        const links = [];
        mediaFields.forEach((value) => {
            if (Array.isArray(value)) {
                value.forEach((item) => {
                    const href = normalizeMediaLink(item);
                    if (href) links.push(href);
                });
                return;
            }

            parseMediaLinks(value).forEach((href) => {
                if (href) links.push(href);
            });
        });

        return Array.from(new Set(links));
    }

    function parseMediaLinks(value) {
        if (Array.isArray(value)) {
            return value.map((item) => normalizeMediaLink(item)).filter(Boolean);
        }

        const raw = String(value || "").trim();
        if (!raw) return [];

        if (raw.startsWith("[") && raw.endsWith("]")) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.map((item) => normalizeMediaLink(item)).filter(Boolean);
                }
            } catch (_) {
                // fallback to plain split below
            }
        }

        return raw
            .split(",")
            .map((item) => normalizeMediaLink(item))
            .filter(Boolean);
    }

    function normalizeMediaLink(url) {
        const value = String(url || "").trim().replace(/^"+|"+$/g, "");
        if (!value) return "";
        if (/^https?:\/\//i.test(value)) return value;
        if (/^www\./i.test(value)) return `https://${value}`;
        return value;
    }

    async function fetchNmRepRowsForNms(nms) {
        const uniqueNms = Array.from(new Set((Array.isArray(nms) ? nms : []).map(normalizeNmKey).filter(Boolean)));
        if (!uniqueNms.length) return new Map();

        const chunks = chunkArray(uniqueNms, WMS_FILTER_CHUNK_SIZE);
        const allRows = [];
        for (const chunk of chunks) {
            const rows = await fetchNmRepRowsByNmChunk(chunk);
            allRows.push(...rows);
        }

        return mapNmRepRowsByNm(allRows);
    }

    async function fetchNmRepRowsByNmChunk(nmChunk) {
        const chunk = Array.isArray(nmChunk) ? nmChunk.filter(Boolean) : [];
        if (!chunk.length) return [];

        const { data, error } = await supabaseClient
            .from(TABLE_NM)
            .select("*")
            .in("nm", chunk);

        if (!error) {
            return Array.isArray(data) ? data : [];
        }

        const missingColumn = extractMissingColumnName(error);
        if (missingColumn && missingColumn === "nm") {
            return [];
        }

        if (chunk.length > 1) {
            const mid = Math.ceil(chunk.length / 2);
            const left = await fetchNmRepRowsByNmChunk(chunk.slice(0, mid));
            const right = await fetchNmRepRowsByNmChunk(chunk.slice(mid));
            return left.concat(right);
        }

        const errorText = String(error?.message || error?.details || error?.code || "unknown");
        throw new Error(`Не удалось проверить НМ ${chunk[0]} в ${TABLE_NM}: ${errorText}`);
    }

    function mapNmRepRowsByNm(rows) {
        const map = new Map();
        const seen = new Set();

        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const signature = buildNmRepRowSignature(row);
            if (!signature || seen.has(signature)) return;
            seen.add(signature);

            const nm = normalizeNmKey(row?.nm);
            if (!nm) return;

            const dateValue = row?.date || row?.created_at || row?.inserted_at || row?.updated_at || "";
            const ts = parseTimestampValue(dateValue);
            const assignedShk = normalizeShk(row?.new_sticker || row?.shk || row?.sticker || row?.barcode);
            const emp = toText(row?.emp);
            const empName = toText(row?.emp_name || row?.fio || row?.name);

            if (!map.has(nm)) map.set(nm, []);
            map.get(nm).push({
                nm,
                dateValue,
                ts,
                emp,
                empName,
                assignedShk
            });
        });

        map.forEach((items, key) => {
            const sorted = (items || []).slice().sort((a, b) => compareDateTs(b?.ts, a?.ts));
            map.set(key, sorted);
        });

        return map;
    }

    function buildNmRepRowSignature(row) {
        if (!row || typeof row !== "object") return "";
        const id = normalizeToken(row?.id || row?.nm_rep_id || row?.row_id);
        if (id) return `id:${id}`;

        const nm = normalizeNmKey(row?.nm);
        const dateValue = normalizeToken(row?.date || row?.created_at || row?.inserted_at || row?.updated_at);
        const emp = normalizeToken(row?.emp);
        const assigned = normalizeShk(row?.new_sticker || row?.shk || row?.sticker || row?.barcode);
        return `${nm}|${dateValue}|${emp}|${assigned}`;
    }

    function normalizeNmKey(value) {
        return normalizeToken(value);
    }

    function parseTimestampValue(value) {
        if (value === null || value === undefined || value === "") return null;
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
        if (typeof value === "number" && Number.isFinite(value)) return value;

        const raw = String(value).trim();
        if (!raw) return null;

        let normalized = raw.replace(" ", "T");
        normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");
        const hasOffset = /([zZ]|[+-]\d{2}:\d{2}|[+-]\d{2})$/.test(normalized);
        const parsed = hasOffset ? new Date(normalized) : new Date(`${normalized}Z`);
        if (!Number.isNaN(parsed.getTime())) return parsed.getTime();

        const dateOnly = parseDateValue(raw);
        if (dateOnly && !Number.isNaN(dateOnly.getTime())) return dateOnly.getTime();
        return null;
    }

    function formatDateTimeMsk(value) {
        const ts = parseTimestampValue(value);
        if (!Number.isFinite(ts)) return "—";
        return new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Europe/Moscow",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(ts));
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
        const extraValues = EXTRA_FILTER_VALUES.slice();

        syncFilterSet(tableState.activeLrs, lrValues);
        syncFilterSet(tableState.activeStatuses, statusValues);
        syncFilterSet(tableState.activeExtraStatuses, extraValues);

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
        renderFilterCheckboxList(
            pureFilterExtraList,
            extraValues,
            tableState.activeExtraStatuses,
            () => {
                updateFilterButtonCaption(pureFilterExtraBtn, tableState.activeExtraStatuses.size, extraValues.length);
                applyPureTableFiltersAndRender();
            }
        );

        updateFilterButtonCaption(pureFilterLrBtn, tableState.activeLrs.size, lrValues.length);
        updateFilterButtonCaption(pureFilterStatusBtn, tableState.activeStatuses.size, statusValues.length);
        updateFilterButtonCaption(pureFilterExtraBtn, tableState.activeExtraStatuses.size, extraValues.length);
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

        const allLabel = document.createElement("label");
        allLabel.className = "status-item";

        const allCheckbox = document.createElement("input");
        allCheckbox.type = "checkbox";

        const allText = document.createElement("span");
        allText.textContent = "Выбрать всё";
        const optionCheckboxes = [];

        function syncAllCheckboxState() {
            const selectedCount = selectedSet.size;
            const totalCount = safeValues.length;
            allCheckbox.checked = totalCount > 0 && selectedCount === totalCount;
            allCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalCount;
        }

        function syncOptionCheckboxes() {
            optionCheckboxes.forEach(({ checkbox, value }) => {
                checkbox.checked = selectedSet.has(value);
            });
        }

        allCheckbox.addEventListener("change", () => {
            if (allCheckbox.checked) {
                selectedSet.clear();
                safeValues.forEach((value) => selectedSet.add(value));
            } else {
                selectedSet.clear();
            }
            syncOptionCheckboxes();
            syncAllCheckboxState();
            onChange();
        });

        allLabel.append(allCheckbox, allText);
        container.appendChild(allLabel);

        safeValues.forEach((value) => {
            const label = document.createElement("label");
            label.className = "status-item";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = selectedSet.has(value);
            optionCheckboxes.push({ checkbox, value });

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) selectedSet.add(value);
                else selectedSet.delete(value);
                syncAllCheckboxState();
                onChange();
            });

            const span = document.createElement("span");
            span.textContent = String(value);

            label.append(checkbox, span);
            container.appendChild(label);
        });

        syncOptionCheckboxes();
        syncAllCheckboxState();
    }

    function updateFilterButtonCaption(button, selectedCount, totalCount) {
        if (!button) return;
        const text = totalCount <= 0 || selectedCount === totalCount
            ? "Выбраны все"
            : `Выбрано ${selectedCount} из ${totalCount}`;
        button.innerHTML = `${escapeHtml(text)} <span class="caret">▾</span>`;
    }

    function applyPureTableFiltersAndRender() {
        const filtered = tableState.rows.filter((row) => {
            const matchLr = tableState.activeLrs.has(row.lr);
            const matchStatus = tableState.activeStatuses.has(row.shkStateBeforeLost);
            const matchExtra = rowMatchesExtraFilter(row, tableState.activeExtraStatuses);
            const matchUnresolved = !tableState.onlyUnresolved || !toText(row.decision);
            return matchLr && matchStatus && matchExtra && matchUnresolved;
        });

        tableState.filteredRows = sortPureRows(filtered);
        renderPureTableBody(tableState.filteredRows);
        updatePureTableSortIndicators();
    }

    function rowMatchesExtraFilter(row, activeSet) {
        if (!(activeSet instanceof Set)) return true;
        const statuses = getRowExtraStatuses(row);
        if (!statuses.length) return activeSet.has("Пусто");
        return statuses.some((status) => activeSet.has(status));
    }

    function getRowExtraStatuses(row) {
        const statuses = new Set();

        const twoShkRows = Array.isArray(row?.wmsTwoShk) ? row.wmsTwoShk : [];
        twoShkRows.forEach((item) => {
            const eventType = String(item?.eventType || "");
            if (eventType === EVENT_TWO_SHK) statuses.add("2 ШК");
            if (eventType === EVENT_EMPTY_PACK) statuses.add("Пустая упаковка");
        });

        const nmRows = Array.isArray(row?.wmsNmRep) ? row.wmsNmRep : [];
        if (nmRows.length) statuses.add("Оприход");

        if (!statuses.size) statuses.add("Пусто");
        return Array.from(statuses);
    }

    function renderPureTablePlaceholder(message) {
        if (!pureTableBody) return;
        closeAllWmsPopovers();
        closeActiveVerdictPanel();
        pureTableBody.innerHTML = "";
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 11;
        td.className = "muted";
        td.textContent = String(message || "");
        tr.appendChild(td);
        pureTableBody.appendChild(tr);
    }

    function renderPureTableBody(rows) {
        if (!pureTableBody) return;
        closeAllWmsPopovers();
        closeActiveVerdictPanel();
        pureTableBody.innerHTML = "";

        const safeRows = Array.isArray(rows) ? rows : [];
        if (!safeRows.length) {
            renderPureTablePlaceholder("По выбранным фильтрам строк нет.");
            return;
        }

        safeRows.forEach((row) => {
            const tr = document.createElement("tr");
            const extraStatuses = getRowExtraStatuses(row);
            const hasTwoShkOrEmpty = extraStatuses.includes("2 ШК") || extraStatuses.includes("Пустая упаковка");
            const hasAcceptance = extraStatuses.includes("Оприход");
            if (hasAcceptance) {
                tr.classList.add("pure-row-oprihod");
            } else if (hasTwoShkOrEmpty) {
                tr.classList.add("pure-row-blackout");
            }

            tr.appendChild(createShkCell(row.shk));
            tr.appendChild(createSubjectCell(row.nm, row.description, row.brand));
            tr.appendChild(createPlainCell(row.shkStateBeforeLost, "pure-col-status"));
            tr.appendChild(createPlainCell(formatDateForUi(row.dateLost), "pure-col-date"));
            tr.appendChild(createPlainCell(row.lr, "pure-col-lr"));
            tr.appendChild(createPriceCell(row.price));
            tr.appendChild(createGapCell());

            const verdictTd = document.createElement("td");
            verdictTd.appendChild(createVerdictDropdownCell(row));
            tr.appendChild(verdictTd);

            const commentTd = document.createElement("td");
            const commentInput = document.createElement("input");
            commentInput.className = "input pure-edit-input comment";
            commentInput.type = "text";
            commentInput.value = row.comment;
            commentInput.placeholder = "Комментарий";
            commentInput.dataset.shk = row.shk;
            commentInput.dataset.field = "comment";
            commentTd.appendChild(commentInput);
            tr.appendChild(commentTd);

            tr.appendChild(createEmptyCell("pure-col-extra"));
            tr.appendChild(createWmsBaseCell(row));

            pureTableBody.appendChild(tr);
        });
    }

    function createShkCell(shkValue) {
        const td = document.createElement("td");
        td.className = "pure-col-shk pure-shk-cell";

        const normalized = normalizeShk(shkValue);
        if (!normalized) {
            td.textContent = "—";
            return td;
        }

        const pill = document.createElement("span");
        pill.className = "pure-shk-pill";

        const link = document.createElement("a");
        link.className = "pure-shk-link";
        link.href = `https://wms.wbwh.tech/shk/status/history?shk=${encodeURIComponent(normalized)}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = normalized;

        pill.appendChild(link);
        td.appendChild(pill);
        return td;
    }

    function createPlainCell(value, className = "") {
        const td = document.createElement("td");
        if (className) td.className = className;
        td.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
        return td;
    }

    function createEmptyCell(className = "") {
        const td = document.createElement("td");
        if (className) td.className = className;
        td.textContent = "";
        return td;
    }

    function createVerdictDropdownCell(row) {
        const currentValue = toText(row?.decision);
        const options = getDecisionOptionsForRow(currentValue);

        const wrap = document.createElement("div");
        wrap.className = "pure-row-verdict-dropdown";
        wrap.dataset.shk = row?.shk || "";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-outline pure-row-verdict-btn";
        btn.dataset.verdictToggle = "1";
        btn.dataset.shk = row?.shk || "";
        btn.setAttribute("aria-expanded", "false");
        btn.innerHTML = `${escapeHtml(currentValue || "Выбрать")} <span class="caret">▾</span>`;

        const panel = document.createElement("div");
        panel.className = "pure-row-verdict-panel hidden";

        options.forEach((value) => {
            const optionBtn = document.createElement("button");
            optionBtn.type = "button";
            optionBtn.className = "pure-row-verdict-option";
            if (value === currentValue) {
                optionBtn.classList.add("is-selected");
            }
            optionBtn.dataset.verdictOption = "1";
            optionBtn.dataset.shk = row?.shk || "";
            optionBtn.dataset.value = value;
            optionBtn.textContent = value || "—";
            panel.appendChild(optionBtn);
        });

        wrap.append(btn, panel);
        return wrap;
    }

    function getDecisionOptionsForRow(currentValue) {
        const values = [];
        const seen = new Set();

        const addValue = (value) => {
            const normalized = toText(value);
            const key = normalized.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            values.push(normalized);
        };

        addValue("");
        (Array.isArray(tableState.decisionOptions) ? tableState.decisionOptions : []).forEach(addValue);
        addValue(currentValue);

        return values;
    }

    function createWmsBaseCell(row) {
        const td = document.createElement("td");
        td.className = "pure-col-extra pure-col-wms";

        const entries = buildWmsBaseEntriesForRow(row);
        if (!entries.length) {
            td.textContent = "";
            return td;
        }

        const wrap = document.createElement("div");
        wrap.className = "pure-wms-buttons";

        entries.forEach((entry) => {
            wrap.appendChild(createWmsPopoverControl(entry));
        });

        td.appendChild(wrap);
        return td;
    }

    function buildWmsBaseEntriesForRow(row) {
        const out = [];
        const twoShkRows = Array.isArray(row?.wmsTwoShk) ? row.wmsTwoShk : [];
        if (twoShkRows.length) {
            const latestByType = new Map();
            twoShkRows.forEach((item) => {
                const eventType = String(item?.eventType || EVENT_TWO_SHK);
                const prev = latestByType.get(eventType);
                if (!prev || compareDateTs(item?.ts, prev?.ts) > 0) {
                    latestByType.set(eventType, item);
                }
            });

            [EVENT_TWO_SHK, EVENT_EMPTY_PACK].forEach((eventType) => {
                const match = latestByType.get(eventType);
                if (!match) return;
                out.push({
                    kind: "two_shk",
                    label: eventType === EVENT_EMPTY_PACK ? EVENT_EMPTY_PACK : "2 ШК",
                    eventType: eventType,
                    dateText: formatDateTimeMsk(match.dateValue),
                    otherShk: match.otherShk,
                    shk1: match.shk1,
                    shk2: match.shk2,
                    mediaLinks: match.mediaLinks
                });
            });
        }

        const nmRows = Array.isArray(row?.wmsNmRep) ? row.wmsNmRep : [];
        if (nmRows.length) {
            const latest = nmRows[0];
            out.push({
                kind: "nm_rep",
                label: "Оприход",
                dateText: formatDateTimeMsk(latest?.dateValue),
                emp: latest?.emp,
                empName: latest?.empName,
                assignedShk: latest?.assignedShk
            });
        }

        return out;
    }

    function createWmsPopoverControl(entry) {
        const wrap = document.createElement("div");
        wrap.className = "pure-wms-popover-wrap";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-outline pure-wms-btn";
        btn.textContent = String(entry?.label || "Подробнее");

        const popover = document.createElement("div");
        popover.className = "pure-wms-popover hidden";

        const title = document.createElement("div");
        title.className = "pure-wms-popover-title";
        title.textContent = String(entry?.label || "Детали");
        popover.appendChild(title);

        if (entry?.kind === "two_shk") {
            if (entry.eventType === EVENT_TWO_SHK) {
                appendWmsPopoverLine(popover, "Другой ШК", entry.otherShk || "—");
            } else {
                appendWmsPopoverLine(popover, "ШК 1", entry.shk1 || "—");
                appendWmsPopoverLine(popover, "ШК 2", entry.shk2 || "—");
            }

            appendWmsPopoverLine(popover, "Дата", entry.dateText || "—");

            const mediaWrap = document.createElement("div");
            mediaWrap.className = "pure-wms-popover-photos";

            const mediaLinks = Array.isArray(entry?.mediaLinks) ? entry.mediaLinks : [];
            if (!mediaLinks.length) {
                const empty = document.createElement("div");
                empty.className = "pure-wms-popover-muted";
                empty.textContent = "Фото: —";
                mediaWrap.appendChild(empty);
            } else {
                mediaLinks.forEach((href, index) => {
                    const a = document.createElement("a");
                    a.className = "btn btn-outline pure-wms-photo-btn";
                    a.textContent = `Фото ${index + 1}`;
                    a.href = href;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    mediaWrap.appendChild(a);
                });
            }
            popover.appendChild(mediaWrap);
        } else {
            appendWmsPopoverLine(popover, "Дата", entry?.dateText || "—");
            appendWmsPopoverLine(popover, "Кто", buildNmWhoText(entry) || "—");
            appendWmsPopoverLine(popover, "Присвоенный ШК", entry?.assignedShk || "—");
        }

        btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleWmsPopover(popover);
        });

        wrap.append(btn, popover);
        return wrap;
    }

    function appendWmsPopoverLine(container, label, value) {
        const line = document.createElement("div");
        line.className = "pure-wms-popover-line";

        const key = document.createElement("span");
        key.className = "pure-wms-popover-key";
        key.textContent = `${String(label || "")}: `;

        const val = document.createElement("span");
        val.className = "pure-wms-popover-value";
        val.textContent = String(value || "—");

        line.append(key, val);
        container.appendChild(line);
    }

    function buildNmWhoText(entry) {
        const name = toText(entry?.empName);
        const emp = toText(entry?.emp);
        if (name && emp) return `${name} (${emp})`;
        return name || emp || "";
    }

    function toggleWmsPopover(popover) {
        if (!(popover instanceof HTMLElement)) return;
        const wasOpen = !popover.classList.contains("hidden");
        closeAllWmsPopovers();
        if (wasOpen) return;
        popover.classList.remove("hidden");
        tableState.activeWmsPopover = popover;
    }

    function closeAllWmsPopovers() {
        const active = tableState.activeWmsPopover;
        if (active instanceof HTMLElement) {
            active.classList.add("hidden");
        }
        tableState.activeWmsPopover = null;
    }

    async function handlePureTableBodyClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const optionBtn = target.closest("button[data-verdict-option='1']");
        if (optionBtn instanceof HTMLButtonElement) {
            event.preventDefault();
            event.stopPropagation();
            await handleVerdictOptionClick(optionBtn);
            return;
        }

        const toggleBtn = target.closest("button[data-verdict-toggle='1']");
        if (toggleBtn instanceof HTMLButtonElement) {
            event.preventDefault();
            event.stopPropagation();
            toggleVerdictPanel(toggleBtn);
        }
    }

    function toggleVerdictPanel(toggleBtn) {
        const wrap = toggleBtn.closest(".pure-row-verdict-dropdown");
        if (!wrap) return;
        const panel = wrap.querySelector(".pure-row-verdict-panel");
        if (!(panel instanceof HTMLElement)) return;

        const alreadyOpen = !panel.classList.contains("hidden");
        closeActiveVerdictPanel();
        if (alreadyOpen) return;

        panel.classList.remove("hidden");
        toggleBtn.setAttribute("aria-expanded", "true");
        tableState.activeVerdictPanel = panel;
    }

    function closeActiveVerdictPanel() {
        const panel = tableState.activeVerdictPanel;
        if (!(panel instanceof HTMLElement)) {
            tableState.activeVerdictPanel = null;
            return;
        }

        panel.classList.add("hidden");
        const wrap = panel.closest(".pure-row-verdict-dropdown");
        const btn = wrap?.querySelector("button[data-verdict-toggle='1']");
        if (btn instanceof HTMLButtonElement) {
            btn.setAttribute("aria-expanded", "false");
        }
        tableState.activeVerdictPanel = null;
    }

    async function handleVerdictOptionClick(optionBtn) {
        const shk = normalizeShk(optionBtn.dataset.shk);
        const nextValue = toText(optionBtn.dataset.value);
        if (!shk) return;

        const wrap = optionBtn.closest(".pure-row-verdict-dropdown");
        const row = tableState.rows.find((item) => item.shk === shk);
        if (!row) return;

        const previousValue = toText(row.decision);
        if (nextValue === previousValue) {
            closeActiveVerdictPanel();
            return;
        }

        const patch = {};
        patch[tableState.updateColumnMap.decision] = nextValue || null;
        if (nextValue) {
            patch[tableState.updateColumnMap.emp] = resolveCurrentUserId(user);
            patch[tableState.updateColumnMap.solved] = resolveCurrentTimestamp();
        } else {
            patch[tableState.updateColumnMap.emp] = null;
            patch[tableState.updateColumnMap.solved] = null;
        }

        setVerdictDropdownBusy(wrap, true);
        closeActiveVerdictPanel();
        setPureTableInlineStatus("Сохраняем изменения...", "info");

        try {
            const appliedPatch = await updatePureRowFields(shk, userWhId, patch);
            Object.assign(row.raw, appliedPatch);
            row.decision = toText(readEditableColumnValue(row.raw, tableState.updateColumnMap.decision));
            setPureTableInlineStatus("Изменения сохранены", "success");
            applyPureTableFiltersAndRender();
        } catch (error) {
            const message = String(error?.message || error || "Не удалось сохранить изменения.");
            setPureTableInlineStatus(message, "error");
            window.MiniUI?.toast?.("Ошибка сохранения строки", { type: "error" });
        } finally {
            setVerdictDropdownBusy(wrap, false);
        }
    }

    function setVerdictDropdownBusy(wrap, isBusy) {
        if (!(wrap instanceof Element)) return;
        wrap.querySelectorAll("button").forEach((btn) => {
            if (btn instanceof HTMLButtonElement) {
                btn.disabled = Boolean(isBusy);
            }
        });
        if (isBusy) wrap.classList.add("is-saving");
        else wrap.classList.remove("is-saving");
    }

    function createSubjectCell(nm, name, brand) {
        const td = document.createElement("td");
        td.className = "pure-wrap-cell pure-col-subject";

        const nmLine = document.createElement("div");
        nmLine.className = "pure-subject-nm";
        nmLine.textContent = nm === null || nm === undefined || nm === ""
            ? "—"
            : String(nm);
        td.appendChild(nmLine);

        const main = document.createElement("div");
        main.className = "pure-name-main";
        main.textContent = name ? String(name) : "—";
        td.appendChild(main);

        const sub = document.createElement("div");
        sub.className = "pure-brand-sub";
        sub.textContent = brand ? String(brand) : "—";
        td.appendChild(sub);

        return td;
    }

    function createPriceCell(priceValue) {
        const td = document.createElement("td");
        td.className = "pure-price-cell";

        const num = toNumberOrNull(priceValue);
        if (num === null) {
            td.textContent = "—";
            return td;
        }

        td.textContent = formatPriceForUi(num);
        const visual = getPriceVisual(num);
        td.style.setProperty("background-color", visual.background, "important");
        td.style.setProperty("color", visual.color, "important");
        return td;
    }

    function createGapCell() {
        const td = document.createElement("td");
        td.className = "pure-gap-col";
        td.textContent = "";
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
                patch[tableState.updateColumnMap.emp] = resolveCurrentUserId(user);
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
            applyPureTableFiltersAndRender();
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

    function resolveCurrentUserId(currentUser) {
        const userId = currentUser?.id ?? currentUser?.user_id ?? null;
        if (userId === null || userId === undefined || userId === "") return null;
        return String(userId);
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

    function sortPureRows(rows) {
        const safeRows = Array.isArray(rows) ? rows.slice() : [];
        const key = tableState.sortKey;
        const dir = tableState.sortDir === -1 ? -1 : 1;

        safeRows.sort((a, b) => {
            const cmp = comparePureRowsByKey(a, b, key);
            if (cmp !== 0) return cmp * dir;
            return sortMixedNumericStrings(a?.shk, b?.shk);
        });
        return safeRows;
    }

    function comparePureRowsByKey(a, b, key) {
        switch (key) {
            case "shk":
                return sortMixedNumericStrings(a?.shk, b?.shk);
            case "subject":
                return compareNullableNumbers(a?.nm, b?.nm, 0)
                    || compareStrings(a?.description, b?.description)
                    || compareStrings(a?.brand, b?.brand);
            case "shkStateBeforeLost":
                return compareStrings(a?.shkStateBeforeLost, b?.shkStateBeforeLost);
            case "dateLost":
                return compareNullableDates(a?.dateLost, b?.dateLost);
            case "lr":
                return sortMixedNumericStrings(a?.lr, b?.lr);
            case "price":
                return compareNullableNumbers(a?.price, b?.price, 0);
            case "decision":
                return compareStrings(a?.decision, b?.decision);
            case "comment":
                return compareStrings(a?.comment, b?.comment);
            default:
                return 0;
        }
    }

    function compareNullableNumbers(left, right, fallback) {
        const l = toNumberOrNull(left);
        const r = toNumberOrNull(right);
        if (l !== null && r !== null) {
            if (l === r) return 0;
            return l > r ? 1 : -1;
        }
        if (l !== null) return -1;
        if (r !== null) return 1;
        return fallback || 0;
    }

    function compareNullableDates(left, right) {
        const l = parseDateValue(left);
        const r = parseDateValue(right);
        if (l && r) {
            const lTs = l.getTime();
            const rTs = r.getTime();
            if (lTs === rTs) return 0;
            return lTs > rTs ? 1 : -1;
        }
        if (l) return -1;
        if (r) return 1;
        return compareStrings(left, right);
    }

    function compareStrings(left, right) {
        const l = String(left || "").toLowerCase();
        const r = String(right || "").toLowerCase();
        return l.localeCompare(r, "ru");
    }

    function updatePureTableSortIndicators() {
        if (!pureTableHead) return;
        pureTableHead.querySelectorAll("th[data-sort-key]").forEach((th) => {
            const key = th.getAttribute("data-sort-key");
            const indicator = th.querySelector(".pure-sort-indicator");
            if (!indicator) return;

            if (key === tableState.sortKey) {
                indicator.textContent = tableState.sortDir === -1 ? "▼" : "▲";
                return;
            }
            indicator.textContent = "";
        });
    }

    function getPriceVisual(price) {
        const stops = [
            { value: 0, color: "#c8f3d3" },
            { value: 200, color: "#c8f3d3" },
            { value: 500, color: "#ffe9a3" },
            { value: 4000, color: "#ffb0a6" },
            { value: 10000, color: "#d9868d" }
        ];

        const clamped = Math.max(0, Number(price) || 0);
        if (clamped >= stops[stops.length - 1].value) {
            const rgb = hexToRgb(stops[stops.length - 1].color);
            return {
                background: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                color: pickContrastColor(rgb)
            };
        }

        for (let i = 0; i < stops.length - 1; i += 1) {
            const from = stops[i];
            const to = stops[i + 1];
            if (clamped < from.value || clamped > to.value) continue;

            const ratio = to.value === from.value
                ? 0
                : (clamped - from.value) / (to.value - from.value);

            const rgbFrom = hexToRgb(from.color);
            const rgbTo = hexToRgb(to.color);
            const mixed = {
                r: Math.round(rgbFrom.r + (rgbTo.r - rgbFrom.r) * ratio),
                g: Math.round(rgbFrom.g + (rgbTo.g - rgbFrom.g) * ratio),
                b: Math.round(rgbFrom.b + (rgbTo.b - rgbFrom.b) * ratio)
            };
            return {
                background: `rgb(${mixed.r}, ${mixed.g}, ${mixed.b})`,
                color: pickContrastColor(mixed)
            };
        }

        const rgb = hexToRgb(stops[0].color);
        return {
            background: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
            color: pickContrastColor(rgb)
        };
    }

    function hexToRgb(hex) {
        const clean = String(hex || "").replace("#", "").trim();
        const normalized = clean.length === 3
            ? clean.split("").map((part) => part + part).join("")
            : clean;
        const num = parseInt(normalized, 16);
        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255
        };
    }

    function pickContrastColor(rgb) {
        const r = Number(rgb?.r || 0);
        const g = Number(rgb?.g || 0);
        const b = Number(rgb?.b || 0);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance < 0.58 ? "#ffffff" : "#111827";
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

        const match = text.match(/column\s+([^\s]+)\s+does not exist/i)
            || text.match(/could not find(?:\s+the)?\s+"?([a-z0-9_.]+)"?\s+column/i);
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
