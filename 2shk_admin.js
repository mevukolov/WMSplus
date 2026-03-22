(function () {
    "use strict";

    const TABLE_NAME = "2shk_rep";
    const EVENT_TWO = "Два ШК";
    const EVENT_EMPTY = "Пустая упаковка";
    const DATE_COLUMN_CANDIDATES = ["date", "created_at"];

    const dateFromEl = document.getElementById("date-from");
    const dateToEl = document.getElementById("date-to");
    const searchBtn = document.getElementById("search-btn");
    const exportBtn = document.getElementById("export-btn");
    const summaryWrap = document.getElementById("summary-wrap");
    const pageTitleEl = document.getElementById("page-title");
    const headerWhEl = document.getElementById("header-wh");

    const detailModal = document.getElementById("detail-modal");
    const detailModalTitle = document.getElementById("detail-modal-title");
    const detailModalTableWrap = document.getElementById("detail-modal-table-wrap");
    const detailModalResultBody = document.getElementById("detail-modal-result-body");
    const detailModalEmpty = document.getElementById("detail-modal-empty");
    const detailModalExportBtn = document.getElementById("detail-modal-export");
    const detailModalCloseBtn = document.getElementById("detail-modal-close");

    let lastRows = [];
    let lastTopWhIds = [];
    let topWhChart = null;
    let lastModalRows = [];
    let lastModalSuffix = "details";
    let pageTitleObserver = null;

    function toast(message, opts) {
        if (window.MiniUI?.toast) {
            window.MiniUI.toast(message, opts || {});
            return;
        }
        alert(message);
    }

    function setLoading(isLoading) {
        if (window.MiniUI?.setLoaderVisible) {
            window.MiniUI.setLoaderVisible(isLoading);
        }
    }

    function normalizeKey(value) {
        return String(value || "").trim();
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getWarehouseNameForTitle() {
        const fromHeader = normalizeKey(headerWhEl?.textContent);
        if (fromHeader) return fromHeader;

        try {
            const user = JSON.parse(localStorage.getItem("user") || "null");
            const fromUser = normalizeKey(user?.wh_name);
            if (fromUser) return fromUser;
        } catch {
            // ignore
        }

        return "";
    }

    function getActiveWarehouseId() {
        try {
            const user = JSON.parse(localStorage.getItem("user") || "null");
            const whId = normalizeKey(user?.user_wh_id);
            return whId || "";
        } catch {
            return "";
        }
    }

    function updatePageTitle() {
        if (!pageTitleEl) return;
        const whName = getWarehouseNameForTitle();
        pageTitleEl.textContent = whName
            ? `Статистика 2ШК — админка (${whName})`
            : "Статистика 2ШК — админка";
    }

    function bindPageTitleSync() {
        updatePageTitle();
        if (!headerWhEl) return;
        if (pageTitleObserver) pageTitleObserver.disconnect();
        pageTitleObserver = new MutationObserver(() => updatePageTitle());
        pageTitleObserver.observe(headerWhEl, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    function autoDate(el) {
        if (!el) return;
        el.addEventListener("input", (e) => {
            if (e.inputType === "insertFromPaste") return;
            let value = el.value.replace(/\D/g, "").slice(0, 8);
            if (value.length >= 3) value = value.slice(0, 2) + "." + value.slice(2);
            if (value.length >= 6) value = value.slice(0, 5) + "." + value.slice(5);
            el.value = value;
        });
    }

    function pad2(value) {
        return String(value).padStart(2, "0");
    }

    function moscowNowDate() {
        return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
    }

    function toDateInputValue(dateObj) {
        return [pad2(dateObj.getDate()), pad2(dateObj.getMonth() + 1), dateObj.getFullYear()].join(".");
    }

    function applyDefaultPeriod() {
        const now = moscowNowDate();
        const from = new Date(now);
        from.setMonth(from.getMonth() - 1);

        dateFromEl.value = toDateInputValue(from);
        dateToEl.value = toDateInputValue(now);
    }

    function parseDateInput(value) {
        const text = String(value || "").trim();
        if (!text) return null;
        const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (!match) return null;

        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = Number(match[3]);
        if (!day || !month || !year) return null;
        if (month < 1 || month > 12) return null;
        if (day < 1 || day > 31) return null;

        const date = new Date(Date.UTC(year, month - 1, day));
        if (
            date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 ||
            date.getUTCDate() !== day
        ) {
            return null;
        }

        return { day: pad2(day), month: pad2(month), year: String(year) };
    }

    function buildIsoAtMoscowDateStart(dateText) {
        const date = parseDateInput(dateText);
        if (!date) return null;
        return `${date.year}-${date.month}-${date.day}T00:00:00.000+03:00`;
    }

    function buildIsoAtMoscowDateEnd(dateText) {
        const date = parseDateInput(dateText);
        if (!date) return null;
        return `${date.year}-${date.month}-${date.day}T23:59:59.999+03:00`;
    }

    function formatDateMoscow(value) {
        if (!value) return "";
        try {
            return new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
        } catch {
            return String(value);
        }
    }

    function extractDateValue(row) {
        const keys = ["date", "created_at", "createdAt", "inserted_at", "updated_at"];
        for (const key of keys) {
            const value = row?.[key];
            if (!value) continue;
            const parsed = Date.parse(String(value));
            if (!Number.isNaN(parsed)) return String(value);
        }
        return "";
    }

    function classifyEventType(value) {
        const text = String(value || "")
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/[^\wа-я\s]/gi, " ")
            .replace(/\s+/g, " ")
            .trim();

        if (!text) return "";

        if (text === "два шк" || text === "2 шк" || text === "2шк" || text === "два ш к") {
            return EVENT_TWO;
        }

        if (text === "пустая упаковка" || text === "пустаяупаковка") {
            return EVENT_EMPTY;
        }

        return "";
    }

    function chunkArray(items, chunkSize) {
        const out = [];
        for (let i = 0; i < items.length; i += chunkSize) {
            out.push(items.slice(i, i + chunkSize));
        }
        return out;
    }

    async function fetchWarehouseMap(whIds) {
        const map = new Map();
        const cleanIds = Array.from(new Set((whIds || []).map(normalizeKey).filter(Boolean)));
        if (!cleanIds.length) return map;

        const chunks = chunkArray(cleanIds, 500);
        for (const idsChunk of chunks) {
            const { data, error } = await supabaseClient
                .from("wh_rep")
                .select("wh_id, wh_name")
                .in("wh_id", idsChunk);

            if (error) {
                console.error("Ошибка чтения wh_rep:", error);
                break;
            }

            (data || []).forEach((row) => {
                const whId = normalizeKey(row?.wh_id);
                if (!whId) return;
                map.set(whId, normalizeKey(row?.wh_name));
            });
        }

        return map;
    }

    function isMissingColumnError(error, columnName) {
        const text = [
            error?.message || "",
            error?.details || "",
            error?.hint || ""
        ].join(" ").toLowerCase();

        if (!text) return false;
        return text.includes(String(columnName || "").toLowerCase()) &&
            (text.includes("does not exist") || text.includes("not found"));
    }

    async function queryRowsByPeriod(fromIso, toIso) {
        let lastError = null;

        for (const column of DATE_COLUMN_CANDIDATES) {
            let query = supabaseClient
                .from(TABLE_NAME)
                .select("*")
                .order(column, { ascending: false });

            if (fromIso) query = query.gte(column, fromIso);
            if (toIso) query = query.lte(column, toIso);

            const { data, error } = await query;
            if (!error) {
                return { rows: Array.isArray(data) ? data : [], usedDateColumn: column };
            }

            lastError = error;
            if (!isMissingColumnError(error, column)) {
                console.warn(`Не удалось загрузить ${TABLE_NAME} по колонке "${column}":`, error);
            }
        }

        const { data, error } = await supabaseClient.from(TABLE_NAME).select("*");
        if (error) {
            throw lastError || error;
        }

        let rows = Array.isArray(data) ? data : [];
        if (fromIso || toIso) {
            const fromTs = fromIso ? Date.parse(fromIso) : null;
            const toTs = toIso ? Date.parse(toIso) : null;
            rows = rows.filter((row) => {
                const dateValue = extractDateValue(row);
                if (!dateValue) return false;
                const ts = Date.parse(dateValue);
                if (Number.isNaN(ts)) return false;
                if (fromTs !== null && ts < fromTs) return false;
                if (toTs !== null && ts > toTs) return false;
                return true;
            });
        }

        rows.sort((a, b) => {
            const aTs = Date.parse(extractDateValue(a));
            const bTs = Date.parse(extractDateValue(b));
            if (Number.isNaN(aTs) && Number.isNaN(bTs)) return 0;
            if (Number.isNaN(aTs)) return 1;
            if (Number.isNaN(bTs)) return -1;
            return bTs - aTs;
        });

        return { rows, usedDateColumn: null };
    }

    function buildPreparedRows(rows, whMap) {
        const out = [];
        (rows || []).forEach((row) => {
            const eventType = classifyEventType(row?.eventtype);
            if (!eventType) return;

            const whId = normalizeKey(row?.wh_id);
            if (!whId) return;

            out.push({
                raw: row,
                eventType,
                whId,
                whName: normalizeKey(whMap.get(whId)),
                dateValue: extractDateValue(row),
                shk1: normalizeKey(row?.shk1),
                shk2: normalizeKey(row?.shk2),
                media: normalizeKey(row?.media)
            });
        });

        out.sort((a, b) => {
            const aTs = Date.parse(a.dateValue || "");
            const bTs = Date.parse(b.dateValue || "");
            if (Number.isNaN(aTs) && Number.isNaN(bTs)) return 0;
            if (Number.isNaN(aTs)) return 1;
            if (Number.isNaN(bTs)) return -1;
            return bTs - aTs;
        });

        return out;
    }

    function closeDetailModal() {
        detailModal.classList.add("hidden");
    }

    function renderModalTable(rows) {
        detailModalResultBody.innerHTML = "";

        rows.forEach((row) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escapeHtml(formatDateMoscow(row?.dateValue))}</td>
                <td>${escapeHtml(row?.eventType || "")}</td>
                <td>${escapeHtml(row?.whId || "")}</td>
                <td>${escapeHtml(row?.whName || "")}</td>
                <td>${escapeHtml(row?.shk1 || "")}</td>
                <td>${escapeHtml(row?.shk2 || "")}</td>
                <td>${escapeHtml(row?.media || "")}</td>
            `;
            detailModalResultBody.appendChild(tr);
        });
    }

    function openDetailModal(title, rows, emptyMessage, exportSuffix) {
        detailModalTitle.textContent = title;
        lastModalRows = Array.isArray(rows) ? rows.slice() : [];
        lastModalSuffix = String(exportSuffix || "details");

        if (rows && rows.length) {
            detailModalEmpty.style.display = "none";
            detailModalTableWrap.style.display = "";
            renderModalTable(rows);
            if (detailModalExportBtn) detailModalExportBtn.style.display = "";
        } else {
            detailModalTableWrap.style.display = "none";
            detailModalResultBody.innerHTML = "";
            detailModalEmpty.textContent = emptyMessage || "Данные отсутствуют.";
            detailModalEmpty.style.display = "";
            if (detailModalExportBtn) detailModalExportBtn.style.display = "none";
        }

        detailModal.classList.remove("hidden");
    }

    function aggregateTopWh(rows) {
        const map = new Map();

        rows.forEach((row) => {
            const whId = row?.whId;
            if (!whId) return;

            const state = map.get(whId) || {
                whId,
                whName: row?.whName || "",
                twoCount: 0,
                emptyCount: 0,
                total: 0
            };

            if (row.eventType === EVENT_TWO) {
                state.twoCount += 1;
            } else if (row.eventType === EVENT_EMPTY) {
                state.emptyCount += 1;
            }

            state.total = state.twoCount + state.emptyCount;
            map.set(whId, state);
        });

        return Array.from(map.values())
            .sort((a, b) => b.total - a.total || a.whId.localeCompare(b.whId, "ru"))
            .slice(0, 10);
    }

    function openActiveWarehouseDetail(eventType) {
        const activeWhId = getActiveWarehouseId();
        if (!activeWhId) {
            openDetailModal("Детализация", [], "У пользователя не задан активный склад.", "active_wh");
            return;
        }

        const rows = lastRows.filter((row) => {
            if (row.whId !== activeWhId) return false;
            if (!eventType) return true;
            return row.eventType === eventType;
        });

        const titleWh = rows[0]?.whName || getWarehouseNameForTitle() || activeWhId;
        const suffix = eventType ? `${activeWhId}_${eventType}` : `${activeWhId}_all`;
        const title = eventType
            ? `${eventType} — ${titleWh} (${activeWhId})`
            : `Все события — ${titleWh} (${activeWhId})`;

        openDetailModal(title, rows, "За выбранный период данных нет.", suffix);
    }

    function openTopWhDetail(whId, eventType) {
        const targetWhId = normalizeKey(whId);
        if (!targetWhId) return;

        const rows = lastRows.filter((row) => {
            if (row.whId !== targetWhId) return false;
            return row.eventType === eventType;
        });

        const whName = rows[0]?.whName || "";
        const titleWh = whName ? `${whName} (${targetWhId})` : targetWhId;
        openDetailModal(
            `${eventType} — ${titleWh}`,
            rows,
            "За выбранный период данных нет.",
            `${targetWhId}_${eventType}`
        );
    }

    function renderTopWhChart(rows) {
        const canvas = document.getElementById("top-wh-chart");
        if (!canvas || typeof Chart === "undefined") return;

        if (topWhChart) {
            topWhChart.destroy();
            topWhChart = null;
        }

        const top = aggregateTopWh(rows);
        lastTopWhIds = top.map((item) => item.whId);

        const hasData = top.length > 0;
        const labels = hasData
            ? top.map((item) => item.whName ? `${item.whName} (${item.whId})` : item.whId)
            : ["Нет данных"];

        const twoData = hasData ? top.map((item) => item.twoCount) : [0];
        const emptyData = hasData ? top.map((item) => item.emptyCount) : [0];

        topWhChart = new Chart(canvas, {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: EVENT_TWO,
                        data: twoData,
                        backgroundColor: "#2563eb",
                        borderRadius: 6
                    },
                    {
                        label: EVENT_EMPTY,
                        data: emptyData,
                        backgroundColor: "#f59e0b",
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}`
                        }
                    },
                    legend: { position: "bottom" }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 },
                        title: { display: true, text: "Количество" }
                    }
                },
                onClick: (event, elements) => {
                    if (!hasData || !elements || !elements.length) return;

                    const hit = elements[0];
                    const whId = lastTopWhIds[hit.index];
                    const eventType = hit.datasetIndex === 0 ? EVENT_TWO : EVENT_EMPTY;
                    openTopWhDetail(whId, eventType);
                }
            }
        });
    }

    function renderSummary(rows) {
        const activeWhId = getActiveWarehouseId();
        const activeRows = activeWhId
            ? rows.filter((row) => row.whId === activeWhId)
            : [];

        const activeWhName = activeRows[0]?.whName || getWarehouseNameForTitle();

        const activeTwoCount = activeRows.filter((row) => row.eventType === EVENT_TWO).length;
        const activeEmptyCount = activeRows.filter((row) => row.eventType === EVENT_EMPTY).length;
        const activeTotalCount = activeRows.length;

        const topRows = aggregateTopWh(rows);
        const topWhText = topRows.length
            ? `${topRows[0].whName || topRows[0].whId} (${topRows[0].total})`
            : "-";

        summaryWrap.innerHTML = `
            <section class="status-box" style="margin-bottom:16px;">
                <div class="status-header">
                    <div class="status-side status-side-inline">
                        <div class="status-inline-row">
                            <div class="status-inline-item opp-clickable" data-detail="active_two">
                                <div class="status-big">${activeTwoCount}</div>
                                <div class="status-label">${EVENT_TWO}</div>
                            </div>
                        </div>
                    </div>

                    <div class="status-center">
                        <div class="status-code">${escapeHtml(activeWhName || "Текущий WH")}</div>
                        <div class="status-desc">Актуальный склад пользователя: ${escapeHtml(activeWhId || "-")}</div>
                    </div>

                    <div class="status-side status-side-inline">
                        <div class="status-inline-row">
                            <div class="status-inline-item opp-clickable" data-detail="active_empty">
                                <div class="status-big">${activeEmptyCount}</div>
                                <div class="status-label">${EVENT_EMPTY}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="status-metrics">
                    <div class="metric opp-clickable" data-detail="active_all">
                        <div class="metric-value">${activeTotalCount}</div>
                        <div class="metric-label">Всего по текущему WH</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">${rows.length}</div>
                        <div class="metric-label">Всего по всем WH</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">${topRows.length}</div>
                        <div class="metric-label">WH в Top-10</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">${escapeHtml(topWhText)}</div>
                        <div class="metric-label">Лидер по периоду</div>
                    </div>
                </div>

                <div class="opp-chart-wrap">
                    <canvas id="top-wh-chart" class="chart-appear"></canvas>
                </div>
            </section>
        `;

        summaryWrap.querySelectorAll("[data-detail]").forEach((el) => {
            el.addEventListener("click", () => {
                const detailKey = el.getAttribute("data-detail");
                if (detailKey === "active_two") {
                    openActiveWarehouseDetail(EVENT_TWO);
                    return;
                }
                if (detailKey === "active_empty") {
                    openActiveWarehouseDetail(EVENT_EMPTY);
                    return;
                }
                if (detailKey === "active_all") {
                    openActiveWarehouseDetail("");
                }
            });
        });

        renderTopWhChart(rows);
    }

    async function loadReport() {
        if (typeof supabaseClient === "undefined" || !supabaseClient) {
            toast("Supabase не инициализирован", { type: "error" });
            return;
        }

        const fromIso = buildIsoAtMoscowDateStart(dateFromEl.value);
        const toIso = buildIsoAtMoscowDateEnd(dateToEl.value);

        if ((dateFromEl.value && !fromIso) || (dateToEl.value && !toIso)) {
            toast("Проверьте формат даты", { type: "error" });
            return;
        }
        if (fromIso && toIso && Date.parse(fromIso) > Date.parse(toIso)) {
            toast("Период задан некорректно", { type: "error" });
            return;
        }

        setLoading(true);
        searchBtn.disabled = true;
        exportBtn.disabled = true;

        try {
            const { rows } = await queryRowsByPeriod(fromIso, toIso);
            const activeWhId = getActiveWarehouseId();

            const whIds = rows.map((row) => row?.wh_id);
            if (activeWhId) whIds.push(activeWhId);
            const whMap = await fetchWarehouseMap(whIds);

            lastRows = buildPreparedRows(rows, whMap);
            renderSummary(lastRows);
            closeDetailModal();

            exportBtn.disabled = lastRows.length === 0;
            if (!activeWhId) {
                toast("У пользователя не задан активный WH. Верхние KPI могут быть пустыми.", { type: "info" });
            }
            if (!lastRows.length) {
                toast("За выбранный период данных нет", { type: "info" });
            }
        } catch (error) {
            console.error(`Ошибка загрузки ${TABLE_NAME}:`, error);
            toast(`Ошибка загрузки данных из ${TABLE_NAME}`, { type: "error" });
        } finally {
            searchBtn.disabled = false;
            setLoading(false);
        }
    }

    function toExportRows(rows) {
        return rows.map((row) => ({
            "Дата": formatDateMoscow(row?.dateValue),
            "Тип события": String(row?.eventType || ""),
            "WH ID": String(row?.whId || ""),
            "Склад": String(row?.whName || ""),
            "SHK1": String(row?.shk1 || ""),
            "SHK2": String(row?.shk2 || ""),
            "Media": String(row?.media || "")
        }));
    }

    function sanitizeSuffix(value) {
        return String(value || "details")
            .replace(/\s+/g, "_")
            .replace(/[^\w\-]+/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 80) || "details";
    }

    function exportRowsToExcel(rows, suffix) {
        if (!rows.length) {
            toast("Нет данных для выгрузки", { type: "info" });
            return;
        }
        if (typeof XLSX === "undefined") {
            toast("Библиотека Excel не загрузилась", { type: "error" });
            return;
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(toExportRows(rows));
        XLSX.utils.book_append_sheet(wb, ws, "2SHK");
        XLSX.writeFile(wb, `2shk_admin_${sanitizeSuffix(suffix)}_${Date.now()}.xlsx`);
    }

    function exportToExcel() {
        exportRowsToExcel(lastRows, "all");
    }

    function bindModal() {
        if (detailModalCloseBtn) {
            detailModalCloseBtn.addEventListener("click", closeDetailModal);
        }
        if (detailModalExportBtn) {
            detailModalExportBtn.addEventListener("click", () => {
                exportRowsToExcel(lastModalRows, lastModalSuffix);
            });
        }
        if (detailModal) {
            detailModal.addEventListener("click", (event) => {
                if (event.target === detailModal || event.target.classList.contains("modal-backdrop")) {
                    closeDetailModal();
                }
            });
        }
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeDetailModal();
            }
        });
    }

    function init() {
        autoDate(dateFromEl);
        autoDate(dateToEl);
        applyDefaultPeriod();
        bindPageTitleSync();
        bindModal();

        searchBtn.addEventListener("click", loadReport);
        exportBtn.addEventListener("click", exportToExcel);
        exportBtn.disabled = true;

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (!target.closest(".card")) return;
            loadReport();
        });

        loadReport();
    }

    init();
})();
