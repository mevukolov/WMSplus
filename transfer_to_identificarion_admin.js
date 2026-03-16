(function () {
    "use strict";

    const dateFromEl = document.getElementById("date-from");
    const timeFromEl = document.getElementById("time-from");
    const dateToEl = document.getElementById("date-to");
    const timeToEl = document.getElementById("time-to");
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
    let periodChart = null;
    let empDonutChart = null;
    let lastTopEmpId = "";
    let lastAntiEmpId = "";
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
            ? `Опознание товара "Без ШК" - админка (${whName})`
            : 'Опознание товара "Без ШК" - админка';
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

    function chunkArray(items, chunkSize) {
        const out = [];
        for (let i = 0; i < items.length; i += chunkSize) {
            out.push(items.slice(i, i + chunkSize));
        }
        return out;
    }

    async function fetchPlaceWarehouseMap(placeIds) {
        const map = new Map();
        const cleanIds = Array.from(new Set((placeIds || []).map(normalizeKey).filter(Boolean)));
        if (!cleanIds.length) return map;

        const chunks = chunkArray(cleanIds, 500);
        for (const idsChunk of chunks) {
            const { data, error } = await supabaseClient
                .from("places")
                .select("place, wh_id")
                .in("place", idsChunk);
            if (error) {
                console.error("Ошибка чтения places:", error);
                break;
            }
            (data || []).forEach((row) => {
                const place = normalizeKey(row?.place);
                const whId = normalizeKey(row?.wh_id);
                if (!place || !whId) return;
                map.set(place, whId);
            });
        }

        return map;
    }

    async function filterRowsByActiveWarehouse(rows, activeWhId) {
        const srcRows = Array.isArray(rows) ? rows : [];
        if (!srcRows.length) return [];
        const targetWhId = normalizeKey(activeWhId);
        if (!targetWhId) return [];

        const placeIds = srcRows.map((row) => row?.place);
        const placeWhMap = await fetchPlaceWarehouseMap(placeIds);

        return srcRows.filter((row) => {
            const place = normalizeKey(row?.place);
            if (!place) return false;

            const placeWh = normalizeKey(placeWhMap.get(place));
            if (!placeWh) return false;

            return placeWh === targetWhId;
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

    function autoTime(el) {
        if (!el) return;
        el.addEventListener("input", (e) => {
            if (e.inputType === "insertFromPaste") return;
            let value = el.value.replace(/\D/g, "").slice(0, 6);
            if (value.length >= 3) value = value.slice(0, 2) + ":" + value.slice(2);
            if (value.length >= 6) value = value.slice(0, 5) + ":" + value.slice(5);
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

    function toTimeInputValue(dateObj) {
        return [pad2(dateObj.getHours()), pad2(dateObj.getMinutes()), pad2(dateObj.getSeconds())].join(":");
    }

    function applyDefaultPeriod() {
        const now = moscowNowDate();
        const from = new Date(now);
        from.setMonth(from.getMonth() - 1);
        from.setHours(0, 0, 0, 0);

        dateFromEl.value = toDateInputValue(from);
        timeFromEl.value = toTimeInputValue(from);
        dateToEl.value = toDateInputValue(now);
        timeToEl.value = toTimeInputValue(now);
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

        return { day: pad2(day), month: pad2(month), year: String(year) };
    }

    function parseTimeInput(value, fallback) {
        const text = String(value || "").trim();
        if (!text) return fallback;

        const match = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (!match) return null;

        const hh = Number(match[1]);
        const mm = Number(match[2]);
        const ss = Number(match[3] || 0);
        if (hh > 23 || mm > 59 || ss > 59) return null;

        return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
    }

    function buildIsoAtMoscow(dateText, timeText, fallbackTime) {
        const date = parseDateInput(dateText);
        if (!date) return null;

        const time = parseTimeInput(timeText, fallbackTime);
        if (!time) return null;

        return `${date.year}-${date.month}-${date.day}T${time}.000+03:00`;
    }

    function formatDateMoscow(value) {
        if (!value) return "";
        try {
            return new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
        } catch {
            return String(value);
        }
    }

    function toDateKeyMoscow(value) {
        if (!value) return "";
        try {
            return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date(value));
        } catch {
            return "";
        }
    }

    function getCodeValue(row) {
        return String(row?.shk || row?.sticker || row?.new_sticker || row?.barcode || "").trim();
    }

    function getCodeSource(row) {
        if (String(row?.shk || "").trim()) return "shk";
        if (String(row?.sticker || "").trim()) return "sticker";
        if (String(row?.new_sticker || "").trim()) return "new_sticker";
        if (String(row?.barcode || "").trim()) return "barcode";
        return "-";
    }

    function getIdentifiedState(row) {
        const raw = row?.is_identified;
        if (raw === 1 || raw === "1" || raw === true) return 1;
        if (raw === 0 || raw === "0" || raw === false) return 0;

        const text = String(raw ?? "").trim().toLowerCase();
        if (text === "true") return 1;
        if (text === "false") return 0;

        const num = Number(text);
        if (Number.isFinite(num)) {
            if (num === 1) return 1;
            if (num === 0) return 0;
        }
        return null;
    }

    function getIdentifiedLabel(row) {
        const state = getIdentifiedState(row);
        if (state === 1) return "Прошло оприход";
        if (state === 0) return "Ожидает оприхода";
        return "Не определено";
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getEmployeeStats(rows) {
        const map = {};
        rows.forEach((row) => {
            const emp = String(row?.emp || "").trim();
            if (!emp) return;
            map[emp] = (map[emp] || 0) + 1;
        });

        return Object.entries(map)
            .map(([emp, count]) => ({ emp, count }))
            .sort((a, b) => b.count - a.count || a.emp.localeCompare(b.emp, "ru"));
    }

    function closeDetailModal() {
        detailModal.classList.add("hidden");
    }

    function renderModalTable(rows) {
        detailModalResultBody.innerHTML = "";

        rows.forEach((row) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escapeHtml(formatDateMoscow(row?.date))}</td>
                <td>${escapeHtml(row?.nm || "")}</td>
                <td>${escapeHtml(row?.description || "")}</td>
                <td>${escapeHtml(getCodeValue(row))}</td>
                <td>${escapeHtml(getCodeSource(row))}</td>
                <td>${escapeHtml(row?.operation || "")}</td>
                <td>${escapeHtml(getIdentifiedLabel(row))}</td>
                <td>${escapeHtml(row?.emp || "")}</td>
                <td>${escapeHtml(row?.place || "")}</td>
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

    function rowsForDate(dateKey) {
        return lastRows.filter((row) => toDateKeyMoscow(row?.date) === dateKey);
    }

    function openDetail(detailKey, options) {
        const opts = options || {};
        const titles = {
            transferred: "Опознано ОПП",
            passed: "Прошло оприход",
            waiting: "Ожидает оприхода",
            top_emp: "Топ сотрудник",
            anti_emp: "Антитоп сотрудник"
        };

        if (detailKey === "transferred") {
            if (opts.dateKey) {
                const rows = rowsForDate(opts.dateKey);
                openDetailModal(
                    `${titles.transferred} — ${opts.dateKey}`,
                    rows,
                    "За выбранный день данных нет.",
                    `opoznano_opp_${opts.dateKey}`
                );
                return;
            }

            openDetailModal(
                `${titles.transferred} — ${lastRows.length}`,
                lastRows,
                "Данных нет.",
                "opoznano_opp"
            );
            return;
        }

        if (detailKey === "passed" || detailKey === "waiting") {
            const targetState = detailKey === "passed" ? 1 : 0;
            let rows = lastRows.filter((row) => getIdentifiedState(row) === targetState);

            if (opts.dateKey) {
                rows = rows.filter((row) => toDateKeyMoscow(row?.date) === opts.dateKey);
                openDetailModal(
                    `${titles[detailKey]} — ${opts.dateKey}`,
                    rows,
                    "За выбранный день данных нет.",
                    `${detailKey}_${opts.dateKey}`
                );
                return;
            }

            openDetailModal(
                `${titles[detailKey]} — ${rows.length}`,
                rows,
                "Данных нет.",
                detailKey
            );
            return;
        }

        if (detailKey === "top_emp") {
            const emp = lastTopEmpId;
            if (!emp) {
                openDetailModal(titles.top_emp, [], "Нет данных по сотрудникам.", "top_emp");
                return;
            }
            const rows = lastRows.filter((row) => String(row?.emp || "").trim() === emp);
            openDetailModal(`${titles.top_emp} — ${emp}`, rows, "Нет данных.", `top_emp_${emp}`);
            return;
        }

        if (detailKey === "anti_emp") {
            const emp = lastAntiEmpId;
            if (!emp) {
                openDetailModal(titles.anti_emp, [], "Нет данных по сотрудникам.", "anti_emp");
                return;
            }
            const rows = lastRows.filter((row) => String(row?.emp || "").trim() === emp);
            openDetailModal(`${titles.anti_emp} — ${emp}`, rows, "Нет данных.", `anti_emp_${emp}`);
            return;
        }

        if (opts.dateKey) {
            openDetailModal(
                `${titles[detailKey] || "Детализация"} — ${opts.dateKey}`,
                [],
                "Для этого показателя детализация пока не подключена.",
                `${detailKey}_${opts.dateKey}`
            );
            return;
        }

        openDetailModal(
            titles[detailKey] || "Детализация",
            [],
            "Для этого показателя детализация пока не подключена.",
            detailKey
        );
    }

    function renderPeriodChart(rows) {
        const canvas = document.getElementById("period-chart");
        if (!canvas || typeof Chart === "undefined") return;

        if (periodChart) {
            periodChart.destroy();
            periodChart = null;
        }

        const byDate = {};
        rows.forEach((row) => {
            const key = toDateKeyMoscow(row?.date);
            if (!key) return;
            byDate[key] ??= { transferred: 0, passed: 0, waiting: 0 };
            byDate[key].transferred += 1;

            const identifiedState = getIdentifiedState(row);
            if (identifiedState === 1) {
                byDate[key].passed += 1;
            } else if (identifiedState === 0) {
                byDate[key].waiting += 1;
            }
        });

        const labels = Object.keys(byDate).sort();
        const transferred = labels.map((key) => byDate[key].transferred);
        const passed = labels.map((key) => byDate[key].passed);
        const waiting = labels.map((key) => byDate[key].waiting);

        periodChart = new Chart(canvas, {
            type: "line",
            data: {
                labels: labels,
                datasets: [
                    {
                        label: "Опознано ОПП",
                        data: transferred,
                        borderColor: "#16a34a",
                        backgroundColor: "#16a34a",
                        borderWidth: 2,
                        tension: 0.35
                    },
                    {
                        label: "Прошло оприход",
                        data: passed,
                        borderColor: "#eab308",
                        backgroundColor: "#eab308",
                        borderWidth: 2,
                        tension: 0.35
                    },
                    {
                        label: "Ожидает оприхода",
                        data: waiting,
                        borderColor: "#ef4444",
                        backgroundColor: "#ef4444",
                        borderDash: [8, 6],
                        borderWidth: 2,
                        tension: 0.35
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
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 },
                        title: { display: true, text: "Количество" }
                    }
                },
                onClick: (event, elements) => {
                    if (!elements || !elements.length) return;

                    const hit = elements[0];
                    const dateKey = labels[hit.index];
                    const map = {
                        0: "transferred",
                        1: "passed",
                        2: "waiting"
                    };
                    const detailKey = map[hit.datasetIndex] || "transferred";
                    openDetail(detailKey, { dateKey: dateKey });
                }
            }
        });
    }

    function renderEmpDonut(rows) {
        const canvas = document.getElementById("emp-donut-chart");
        if (!canvas || typeof Chart === "undefined") return;

        if (empDonutChart) {
            empDonutChart.destroy();
            empDonutChart = null;
        }

        const top = getEmployeeStats(rows).slice(0, 12);
        const labels = top.map((item) => item.emp);
        const values = top.map((item) => item.count);

        const hasData = values.length > 0;
        const dsLabels = hasData ? labels : ["Нет данных"];
        const dsValues = hasData ? values : [1];
        const colors = hasData
            ? ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#64748b", "#0ea5e9", "#14b8a6"]
            : ["#cbd5e1"];

        empDonutChart = new Chart(canvas, {
            type: "doughnut",
            data: {
                labels: dsLabels,
                datasets: [
                    {
                        data: dsValues,
                        backgroundColor: colors.slice(0, dsValues.length),
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom" },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                if (!hasData) return "Нет данных";
                                const value = Number(ctx.parsed || 0);
                                const total = values.reduce((sum, item) => sum + item, 0) || 1;
                                const pct = ((value / total) * 100).toFixed(1);
                                return `${ctx.label}: ${value} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    function renderSummary(rows) {
        const total = rows.length;
        const passedCount = rows.filter((row) => getIdentifiedState(row) === 1).length;
        const waitingCount = rows.filter((row) => getIdentifiedState(row) === 0).length;
        const uniqueNm = new Set(rows.map((r) => String(r?.nm || "").trim()).filter(Boolean)).size;
        const employees = getEmployeeStats(rows);
        const uniqueEmpCount = employees.length;

        const uniqueDates = new Set(rows.map((r) => toDateKeyMoscow(r?.date)).filter(Boolean)).size;
        const avgPerDayRounded = uniqueDates > 0 ? Math.round(total / uniqueDates) : 0;

        const topEmp = employees[0] || null;
        const antiTopEmp = employees.length
            ? [...employees].sort((a, b) => a.count - b.count || a.emp.localeCompare(b.emp, "ru"))[0]
            : null;

        lastTopEmpId = topEmp?.emp || "";
        lastAntiEmpId = antiTopEmp?.emp || "";

        const topEmpText = topEmp ? `${topEmp.emp} (${topEmp.count})` : "-";
        const antiTopText = antiTopEmp ? `${antiTopEmp.emp} (${antiTopEmp.count})` : "-";

        summaryWrap.innerHTML = `
            <section class="status-box" style="margin-bottom:16px;">
                <div class="status-header">
                    <div class="status-side status-side-inline">
                        <div class="status-inline-row">
                            <div class="status-inline-item opp-clickable" data-detail="transferred">
                                <div class="status-big">${total}</div>
                                <div class="status-label">Опознано ОПП</div>
                            </div>
                            <div class="status-inline-item">
                                <div class="status-big">${uniqueNm}</div>
                                <div class="status-label">Уникальных НМ</div>
                            </div>
                        </div>
                    </div>

                    <div class="status-center">
                        <div class="status-code">Передано на оприход</div>
                        <div class="status-desc">nm_rep за выбранный период</div>
                    </div>

                    <div class="status-side status-side-inline">
                        <div class="status-inline-row">
                            <div class="status-inline-item opp-clickable" data-detail="passed">
                                <div class="status-big">${passedCount}</div>
                                <div class="status-label">Прошло оприход</div>
                            </div>
                            <div class="status-inline-item opp-clickable" data-detail="waiting">
                                <div class="status-big">${waitingCount}</div>
                                <div class="status-label">Ожидает оприхода</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="status-metrics">
                    <div class="metric">
                        <div class="metric-value">${uniqueEmpCount}</div>
                        <div class="metric-label">Сотрудников</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">${avgPerDayRounded}</div>
                        <div class="metric-label">Среднее кол-во за сутки</div>
                    </div>
                    <div class="metric ${topEmp ? "opp-clickable" : ""}" data-detail="top_emp">
                        <div class="metric-value">${escapeHtml(topEmpText)}</div>
                        <div class="metric-label">Топ сотрудник</div>
                    </div>
                    <div class="metric ${antiTopEmp ? "opp-clickable" : ""}" data-detail="anti_emp">
                        <div class="metric-value">${escapeHtml(antiTopText)}</div>
                        <div class="metric-label">Антитоп сотрудник</div>
                    </div>
                </div>

                <div class="opp-chart-wrap">
                    <canvas id="period-chart" class="chart-appear"></canvas>
                </div>

                <div class="opp-donut-wrap">
                    <p class="opp-donut-title">Сотрудники за период</p>
                    <canvas id="emp-donut-chart"></canvas>
                </div>
            </section>
        `;

        summaryWrap.querySelectorAll("[data-detail]").forEach((el) => {
            el.addEventListener("click", () => {
                const detailKey = el.getAttribute("data-detail");
                openDetail(detailKey);
            });
        });

        renderPeriodChart(rows);
        renderEmpDonut(rows);
    }

    async function loadReport() {
        if (typeof supabaseClient === "undefined" || !supabaseClient) {
            toast("Supabase не инициализирован", { type: "error" });
            return;
        }

        const fromIso = buildIsoAtMoscow(dateFromEl.value, timeFromEl.value, "00:00:00");
        const toIso = buildIsoAtMoscow(dateToEl.value, timeToEl.value, "23:59:59");

        if ((dateFromEl.value && !fromIso) || (dateToEl.value && !toIso)) {
            toast("Проверьте формат даты/времени", { type: "error" });
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
            const activeWhId = getActiveWarehouseId();
            if (!activeWhId) {
                toast("Не удалось определить активный склад пользователя", { type: "error" });
                lastRows = [];
                renderSummary(lastRows);
                closeDetailModal();
                exportBtn.disabled = true;
                return;
            }

            let query = supabaseClient
                .from("nm_rep")
                .select("*")
                .order("date", { ascending: false });

            if (fromIso) query = query.gte("date", fromIso);
            if (toIso) query = query.lte("date", toIso);

            const { data, error } = await query;
            if (error) {
                console.error("Ошибка чтения nm_rep:", error);
                toast("Ошибка загрузки данных из nm_rep", { type: "error" });
                return;
            }

            const rawRows = Array.isArray(data) ? data : [];
            lastRows = await filterRowsByActiveWarehouse(rawRows, activeWhId);
            renderSummary(lastRows);
            closeDetailModal();

            exportBtn.disabled = lastRows.length === 0;

            if (!lastRows.length) {
                toast("За выбранный период данных нет", { type: "info" });
            }
        } finally {
            searchBtn.disabled = false;
            setLoading(false);
        }
    }

    function toExportRows(rows) {
        return rows.map((row) => ({
            "Дата": formatDateMoscow(row?.date),
            "НМ": String(row?.nm || ""),
            "Наименование": String(row?.description || ""),
            "ШК/Стикер": getCodeValue(row),
            "Источник кода": getCodeSource(row),
            "Операция": String(row?.operation || ""),
            "Статус оприхода": getIdentifiedLabel(row),
            "Сотрудник": String(row?.emp || ""),
            "МХ": String(row?.place || "")
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
        XLSX.utils.book_append_sheet(wb, ws, "Передано_на_оприход");
        XLSX.writeFile(wb, `transfer_to_oprihod_${sanitizeSuffix(suffix)}_${Date.now()}.xlsx`);
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
        autoTime(timeFromEl);
        autoTime(timeToEl);
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
