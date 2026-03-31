(function () {
    "use strict";

    const API_DATA_TYPE = "opp_table_analisys_script";
    const DEADLINES_DATA_TYPE = "opp_table_deadlines";
    const EMPLOYEES_DATA_TYPE = "opp_table_employees";
    const REPORT_CACHE_TABLE = "opp_reports_cache";
    const CACHE_SCOPE_DASHBOARD_SHIFT = "opp_dashboard_shift";
    const CACHE_SCOPE_DASHBOARD_MONTH = "opp_dashboard_month";
    const SUPPORTED_DEADLINE_KEYS = ["SPS_WMI", "SMC", "SMS", "WMI_BZ", "RWP", "24", "ORS", "REPACK"];
    const MAIN_EMPLOYEE_KEYS_FOR_CARD = new Set(["REPACK", "SPS_WMI", "WMI_BZ", "SMC", "SMS", "RWP"]);
    const DEADLINE_LABELS = {
        SPS_WMI: "SPS + WMI",
        SMC: "SMC",
        SMS: "SMS",
        WMI_BZ: "WMI Без заказа",
        RWP: "RWP",
        "24": "24",
        ORS: "ORS",
        REPACK: "Упаковка"
    };

    const pageTitleEl = document.getElementById("page-title");
    const headerWhEl = document.getElementById("header-wh");
    const dateFromEl = document.getElementById("date-from");
    const dateToEl = document.getElementById("date-to");
    const searchBtn = document.getElementById("search-btn");
    const calendarBtn = document.getElementById("calendar-btn");

    const statusEl = document.getElementById("gsheet-status");
    const errorsEl = document.getElementById("gsheet-errors");
    const summaryWrap = document.getElementById("summary-wrap");

    const detailModal = document.getElementById("detail-modal");
    const detailModalTitle = document.getElementById("detail-modal-title");
    const detailModalTableWrap = document.getElementById("detail-modal-table-wrap");
    const detailModalResultBody = document.getElementById("detail-modal-result-body");
    const detailModalEmpty = document.getElementById("detail-modal-empty");
    const detailModalCloseBtn = document.getElementById("detail-modal-close");

    const shiftModal = document.getElementById("shift-modal");
    const shiftModalTitle = document.getElementById("shift-modal-title");
    const shiftModalOverall = document.getElementById("shift-modal-overall");
    const shiftModalOverallShk = document.getElementById("shift-modal-overall-shk");
    const shiftModalOverallSum = document.getElementById("shift-modal-overall-sum");
    const shiftModalOverallExpensive = document.getElementById("shift-modal-overall-expensive");
    const shiftModalTableWrap = document.getElementById("shift-modal-table-wrap");
    const shiftModalResultBody = document.getElementById("shift-modal-result-body");
    const shiftModalEmpty = document.getElementById("shift-modal-empty");
    const shiftModalBreakdownWrap = document.getElementById("shift-modal-breakdown-wrap");
    const shiftModalBreakdownChartCanvas = document.getElementById("shift-modal-breakdown-chart");
    const shiftModalCloseBtn = document.getElementById("shift-modal-close");

    const calendarModal = document.getElementById("calendar-modal");
    const calendarModalContent = document.getElementById("calendar-modal-content");
    const calendarModalCloseBtn = document.getElementById("calendar-modal-close");

    let currentWhId = "";
    let currentWhName = "";
    let currentApiUrl = "";
    let currentDeadlines = {};
    let currentDeadlineOrder = [];
    let currentEmployeesById = {};
    let currentEmployeeDirectory = [];

    let lastRows = [];
    let lastPeriod = { from: "", to: "" };
    let lastSummary = { totalLoaded: 0, totalAnalyzed: 0 };
    let lastMonthSummary = {
        from: "",
        to: "",
        totalDue: 0,
        analyzed: 0,
        dueSumPrice: 0,
        analyzedSumPrice: 0,
        expensiveDueTotal: 0,
        expensiveAnalyzed: 0,
        percentBySum: 0,
        hasData: false
    };
    let lastTodayDeadline = null;
    let lastMissingSheets = [];
    let lastShiftDynamics = [];
    let lastMonthShiftDynamics = [];
    let lastCurrentShift = null;
    let lastPreviousShift = null;
    let selectedShiftId = "";
    let lastReportGeneratedAtText = "";
    let shiftBreakdownChart = null;

    let pageTitleObserver = null;

    function normalizeKey(value) {
        return String(value || "").trim();
    }

    function normalizeWhId(value) {
        const raw = normalizeKey(value);
        if (/^-?\d+$/.test(raw)) return Number(raw);
        return raw;
    }

    function normalizeDeadlineKey(value) {
        return normalizeKey(value).toUpperCase().replace(/\s+/g, "");
    }

    function getConfiguredDeadlineKeys() {
        return SUPPORTED_DEADLINE_KEYS.filter((key) => {
            return Object.prototype.hasOwnProperty.call(currentDeadlines, key);
        });
    }

    function parseDeadlineNumber(value) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }

        const raw = normalizeKey(value).replace(",", ".");
        if (!raw) return null;

        const cleaned = raw.replace(/\s+/g, "");
        if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;

        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function normalizeEmployeeToken(value) {
        return normalizeKey(value)
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/[^a-zа-я0-9]+/g, "");
    }

    function normalizeEmployeeWords(value) {
        return normalizeKey(value)
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/[^a-zа-я0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

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
        if (searchBtn) searchBtn.disabled = Boolean(isLoading);
        if (calendarBtn) calendarBtn.disabled = Boolean(isLoading);
    }

    function setStatus(text, type) {
        if (!statusEl) return;
        const safeText = String(text || "");
        statusEl.textContent = safeText;
        statusEl.style.display = safeText ? "" : "none";
        statusEl.classList.remove("success", "error");
        if (type === "success") statusEl.classList.add("success");
        if (type === "error") statusEl.classList.add("error");
    }

    function setErrors(lines) {
        if (!errorsEl) return;
        const list = Array.isArray(lines) ? lines.filter(Boolean) : [];

        if (!list.length) {
            errorsEl.style.display = "none";
            errorsEl.textContent = "";
            return;
        }

        errorsEl.style.display = "block";
        errorsEl.textContent = list.join("\n");
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatNumber(value) {
        return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
    }

    function formatCurrency(value) {
        const n = Number(value || 0);
        if (!Number.isFinite(n)) return "0 ₽";
        return `${new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(n)} ₽`;
    }

    function formatPercent(value) {
        const n = Number(value || 0);
        if (!Number.isFinite(n)) return "0%";
        return `${Math.max(0, Math.round(n))}%`;
    }

    function buildMonthSummaryFromShiftDynamics(shiftDynamics, period) {
        const rows = Array.isArray(shiftDynamics) ? shiftDynamics : [];
        const totals = rows.reduce((acc, item) => {
            acc.totalDue += toNumber(item?.totalDue);
            acc.analyzed += toNumber(item?.analyzed);
            acc.dueSumPrice += toNumber(item?.dueSumPrice);
            acc.analyzedSumPrice += toNumber(item?.analyzedSumPrice);
            acc.expensiveDueTotal += toNumber(item?.expensiveDueTotal);
            acc.expensiveAnalyzed += toNumber(item?.expensiveAnalyzed);
            return acc;
        }, {
            totalDue: 0,
            analyzed: 0,
            dueSumPrice: 0,
            analyzedSumPrice: 0,
            expensiveDueTotal: 0,
            expensiveAnalyzed: 0
        });

        const percentBySum = totals.dueSumPrice > 0
            ? (totals.analyzedSumPrice / totals.dueSumPrice) * 100
            : 0;
        const hasData = rows.length > 0 && (
            totals.totalDue > 0 ||
            totals.dueSumPrice > 0 ||
            totals.expensiveDueTotal > 0
        );

        return {
            from: parseIsoDate(period?.from) || "",
            to: parseIsoDate(period?.to) || "",
            totalDue: totals.totalDue,
            analyzed: totals.analyzed,
            dueSumPrice: totals.dueSumPrice,
            analyzedSumPrice: totals.analyzedSumPrice,
            expensiveDueTotal: totals.expensiveDueTotal,
            expensiveAnalyzed: totals.expensiveAnalyzed,
            percentBySum,
            hasData
        };
    }

    function computeStatusCardLevel(item) {
        let level = "green";
        const expensiveDue = toNumber(item?.expensiveDueTotal);
        const expensiveAnalyzed = toNumber(item?.expensiveAnalyzed);
        const dueSum = toNumber(item?.dueSumPrice);
        const analyzedSum = toNumber(item?.analyzedSumPrice);
        const uploadStatus = normalizeKey(item?.uploadStatus || item?.upload_status);
        const hasUpload = !uploadStatus || /есть/i.test(uploadStatus);

        const expensivePct = expensiveDue > 0 ? (expensiveAnalyzed / expensiveDue) * 100 : null;
        const sumPct = dueSum > 0 ? (analyzedSum / dueSum) * 100 : null;

        if (expensivePct !== null) {
            if (expensivePct < 70) level = "red";
            else if (expensivePct < 95 && level !== "red") level = "yellow";
        }

        if (sumPct !== null) {
            if (sumPct < 70) level = "red";
            else if (sumPct < 85 && level !== "red") level = "yellow";
        }

        if (!hasUpload) {
            level = "red";
        }

        return { level, expensivePct, sumPct, hasUpload };
    }

    function calcLagPercent(analyzed, total) {
        const totalNum = toNumber(total);
        const analyzedNum = toNumber(analyzed);
        if (totalNum <= 0) return null;
        const pct = (analyzedNum / totalNum) * 100;
        return Math.max(0, 100 - pct);
    }

    function buildMonthLagByStatus(monthShiftDynamics) {
        const rows = Array.isArray(monthShiftDynamics) ? monthShiftDynamics : [];
        const keysBase = getConfiguredDeadlineKeys();
        const keys = keysBase.length ? keysBase : SUPPORTED_DEADLINE_KEYS.slice();
        const map = new Map();

        keys.forEach((key) => {
            map.set(key, {
                key,
                label: DEADLINE_LABELS[key] || key,
                dueSumPrice: 0,
                analyzedSumPrice: 0
            });
        });

        rows.forEach((shift) => {
            const details = Array.isArray(shift?.details) ? shift.details : [];
            details.forEach((item) => {
                const key = normalizeDeadlineKey(item?.key);
                if (!key || !map.has(key)) return;
                const target = map.get(key);
                target.dueSumPrice += toNumber(item?.dueSumPrice);
                target.analyzedSumPrice += toNumber(item?.analyzedSumPrice);
            });
        });

        return keys.map((key) => {
            const item = map.get(key) || {
                key,
                label: DEADLINE_LABELS[key] || key,
                dueSumPrice: 0,
                analyzedSumPrice: 0
            };
            return {
                key: item.key,
                label: item.label,
                lagPercent: calcLagPercent(item.analyzedSumPrice, item.dueSumPrice)
            };
        });
    }

    function getUserFromLocalStorage() {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }

    function getWarehouseNameForTitle() {
        const fromHeader = normalizeKey(headerWhEl?.textContent);
        if (fromHeader) return fromHeader;

        const user = getUserFromLocalStorage();
        const fromUser = normalizeKey(user?.wh_name);
        if (fromUser) return fromUser;

        return "";
    }

    function updatePageTitle() {
        const whName = getWarehouseNameForTitle();
        currentWhName = whName;

        const base = "ОПП - Главная";
        const finalTitle = whName ? `${base} - ${whName}` : base;

        if (pageTitleEl) pageTitleEl.textContent = finalTitle;
        document.title = `WMS+ — ${finalTitle}`;
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

    function moscowNowDate() {
        return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
    }

    function pad2(value) {
        return String(value).padStart(2, "0");
    }

    function toIsoDate(dateObj) {
        return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
    }

    function parseIsoDate(value) {
        const raw = normalizeKey(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
        return raw;
    }

    function shiftIsoDate(isoDate, daysDelta) {
        const safe = parseIsoDate(isoDate);
        if (!safe) return "";

        const dt = new Date(`${safe}T00:00:00`);
        if (!Number.isFinite(dt.getTime())) return "";

        dt.setDate(dt.getDate() + Number(daysDelta || 0));
        return toIsoDate(dt);
    }

    function formatDateRu(isoDate) {
        const safe = parseIsoDate(isoDate);
        if (!safe) return String(isoDate || "");

        const dt = new Date(`${safe}T00:00:00`);
        if (!Number.isFinite(dt.getTime())) return safe;

        return new Intl.DateTimeFormat("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).format(dt);
    }

    function extractDateTokensRu(value) {
        const raw = normalizeKey(value);
        if (!raw) return [];

        const full = raw.match(/\d{2}\.\d{2}\.\d{4}/g);
        if (Array.isArray(full) && full.length) return full;

        const short = raw.match(/\d{2}\.\d{2}(?!\.\d{4})/g);
        return Array.isArray(short) ? short : [];
    }

    function withFallbackYearRu(dateToken, fallbackYear) {
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateToken)) return dateToken;
        if (/^\d{2}\.\d{2}$/.test(dateToken) && /^\d{4}$/.test(String(fallbackYear || ""))) {
            return `${dateToken}.${fallbackYear}`;
        }
        return dateToken;
    }

    function buildShortDueLabelForShiftDetail(detailItem, shiftItem) {
        const key = normalizeDeadlineKey(detailItem?.key);
        const shiftDateIso = parseIsoDate(shiftItem?.date);

        if (key === "WMI_BZ") {
            if (!shiftDateIso) return "-";
            if (shiftItem?.shiftType === "night") {
                return `${formatDateRu(shiftDateIso)} До 13:00`;
            }
            const prevDateIso = shiftIsoDate(shiftDateIso, -1) || shiftDateIso;
            return `${formatDateRu(prevDateIso)} После 13:00`;
        }

        const dueLabel = normalizeKey(detailItem?.dueLabel || detailItem?.due_for_date_label || detailItem?.due_until_label);
        if (!dueLabel) return "-";

        const fallbackYear = shiftDateIso ? String(shiftDateIso).slice(0, 4) : "";
        const tokens = extractDateTokensRu(dueLabel).map((token) => withFallbackYearRu(token, fallbackYear));
        if (!tokens.length) return dueLabel;
        if (tokens.length === 1) return tokens[0];
        return `${tokens[0]} - ${tokens[tokens.length - 1]}`;
    }

    function hasOwn(obj, key) {
        return Boolean(obj && Object.prototype.hasOwnProperty.call(obj, key));
    }

    function parseLooseNumber(value) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const raw = normalizeKey(value);
        if (!raw) return null;
        const cleaned = raw.replace(/\s+/g, "").replace(",", ".");
        if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function getNumberByKeys(obj, keys) {
        const row = obj || {};
        const list = Array.isArray(keys) ? keys : [];
        for (const key of list) {
            if (!hasOwn(row, key)) continue;
            const n = parseLooseNumber(row[key]);
            if (n !== null) return n;
        }
        return null;
    }

    function computeRemainingExpensiveCount(item, options) {
        const row = item || {};
        const opts = options && typeof options === "object" ? options : {};
        const allowGeneric = Boolean(opts.allowGeneric);
        const remaining = getNumberByKeys(row, [
            "remainingExpensiveCount",
            "remaining_expensive_count",
            "remaining_expensive_due_unique_shk",
            "remaining_expensive_due",
            "remaining_expensive_total"
        ]);
        if (remaining !== null) {
            return Math.max(0, remaining);
        }

        if (allowGeneric) {
            const remainingGeneric = getNumberByKeys(row, [
                "remaining_count",
                "remaining_due_unique_shk",
                "remaining_due",
                "count",
                "cnt",
                "qty",
                "quantity",
                "shk"
            ]);
            if (remainingGeneric !== null) {
                return Math.max(0, remainingGeneric);
            }
        }

        const due = getNumberByKeys(row, [
            "expensiveDueTotal",
            "expensive_due_total_unique_shk",
            "expensive_due_total",
            "expensive_due_count",
            "expensive_due",
            "due_expensive_count"
        ]);
        const analyzed = getNumberByKeys(row, [
            "expensiveAnalyzed",
            "expensive_analyzed_due_unique_shk",
            "expensive_analyzed_due",
            "expensive_analyzed",
            "expensive_analyzed_count",
            "analyzed_expensive_count"
        ]);
        if (due === null && analyzed === null) return 0;
        return Math.max(0, due - analyzed);
    }

    function computeRemainingExpensiveSum(item, options) {
        const row = item || {};
        const opts = options && typeof options === "object" ? options : {};
        const allowGeneric = Boolean(opts.allowGeneric);
        const remaining = getNumberByKeys(row, [
            "remainingExpensiveSumPrice",
            "remaining_expensive_sum_price",
            "remaining_expensive_due_sum_price",
            "remaining_expensive_total_sum_price",
            "remaining_expensive_sum",
            "remaining_expensive_price",
            "remaining_expensive_amount"
        ]);
        if (remaining !== null) {
            return Math.max(0, remaining);
        }

        const dueExp = getNumberByKeys(row, [
            "expensiveDueSumPrice",
            "expensive_due_total_sum_price",
            "expensive_due_sum_price",
            "expensive_due_price",
            "expensive_due_sum",
            "expensive_due_amount",
            "expensive_due_total_price",
            "expensive_due_total_amount",
            "expensive_due_price_total"
        ]);
        const analyzedExp = getNumberByKeys(row, [
            "expensiveAnalyzedSumPrice",
            "expensive_analyzed_due_sum_price",
            "expensive_analyzed_sum_price",
            "expensive_analyzed_due_price",
            "expensive_analyzed_sum",
            "expensive_analyzed_amount",
            "expensive_analyzed_total_price",
            "expensive_analyzed_total_amount",
            "expensive_analyzed_price_total"
        ]);
        if (dueExp !== null || analyzedExp !== null) {
            return Math.max(0, toNumber(dueExp) - toNumber(analyzedExp));
        }

        if (allowGeneric) {
            const remainingGeneric = getNumberByKeys(row, [
                "remaining_sum_price",
                "remaining_sum",
                "sum_price",
                "sum",
                "amount",
                "cost"
            ]);
            if (remainingGeneric !== null) {
                return Math.max(0, remainingGeneric);
            }
        }

        const dueTotal = getNumberByKeys(row, ["dueTotal", "due_total_unique_shk", "due_total", "total_due"]);
        const analyzedTotal = getNumberByKeys(row, ["analyzed", "analyzed_due_unique_shk", "analyzed_due"]);
        const expensiveDueTotal = getNumberByKeys(row, ["expensiveDueTotal", "expensive_due_total_unique_shk", "expensive_due_total"]);
        const expensiveAnalyzedTotal = getNumberByKeys(row, ["expensiveAnalyzed", "expensive_analyzed_due_unique_shk", "expensive_analyzed_due", "expensive_analyzed"]);
        if (
            dueTotal !== null &&
            analyzedTotal !== null &&
            expensiveDueTotal !== null &&
            expensiveAnalyzedTotal !== null &&
            Number(dueTotal) === Number(expensiveDueTotal) &&
            Number(analyzedTotal) === Number(expensiveAnalyzedTotal)
        ) {
            const dueAll = getNumberByKeys(row, ["dueSumPrice", "due_total_sum_price", "due_sum_price", "due_total_price"]);
            const analyzedAll = getNumberByKeys(row, ["analyzedSumPrice", "analyzed_due_sum_price", "analyzed_sum_price", "analyzed_due_price"]);
            if (dueAll !== null || analyzedAll !== null) {
                return Math.max(0, toNumber(dueAll) - toNumber(analyzedAll));
            }
        }
        return null;
    }

    function normalizeUnfinishedDateLabel(rawValue, fallbackDetail, shiftItem) {
        const raw = normalizeKey(rawValue);
        if (raw) {
            const iso = parseYmd(raw);
            if (iso) return formatDateRu(iso);

            const fallbackYear = parseIsoDate(shiftItem?.date)?.slice(0, 4) || "";
            const tokens = extractDateTokensRu(raw).map((token) => withFallbackYearRu(token, fallbackYear));
            if (tokens.length === 1) return tokens[0];
            if (tokens.length > 1) return `${tokens[0]} - ${tokens[tokens.length - 1]}`;

            return raw;
        }
        return buildShortDueLabelForShiftDetail(fallbackDetail, shiftItem);
    }

    function parseUnfinishedEntriesFromSource(source, detail, shiftItem) {
        if (!source) return [];

        const out = [];
        if (Array.isArray(source)) {
            source.forEach((entry) => {
                if (!entry) return;
                const dateLabel = normalizeUnfinishedDateLabel(
                    entry?.date ??
                    entry?.ymd ??
                    entry?.day ??
                    entry?.due_date ??
                    entry?.due_for_date ??
                    entry?.due_for_date_label ??
                    entry?.label ??
                    entry?.name,
                    detail,
                    shiftItem
                );
                const count = computeRemainingExpensiveCount(entry, { allowGeneric: true });
                const sum = computeRemainingExpensiveSum(entry, { allowGeneric: true });
                if (count < 0) return;
                out.push({ dateLabel, count, sum });
            });
            return out;
        }

        if (typeof source === "object") {
            Object.entries(source).forEach(([key, rawValue]) => {
                if (rawValue && typeof rawValue === "object") {
                    const dateLabel = normalizeUnfinishedDateLabel(key, detail, shiftItem);
                    const count = computeRemainingExpensiveCount(rawValue, { allowGeneric: true });
                    const sum = computeRemainingExpensiveSum(rawValue, { allowGeneric: true });
                    if (count < 0) return;
                    out.push({ dateLabel, count, sum });
                    return;
                }

                const rawNumber = parseLooseNumber(rawValue);
                if (rawNumber === null) return;
                const count = Math.max(0, rawNumber);
                const dateLabel = normalizeUnfinishedDateLabel(key, detail, shiftItem);
                out.push({ dateLabel, count, sum: null });
            });
        }

        return out;
    }

    function buildUnfinishedExpensiveByStatus(monthShiftDynamics) {
        const shiftsRaw = Array.isArray(monthShiftDynamics) ? monthShiftDynamics : [];
        const shifts = shiftsRaw
            .slice()
            .sort((a, b) => {
                const aTs = toNumber(a?.shiftSortTs);
                const bTs = toNumber(b?.shiftSortTs);
                if (aTs !== bTs) return aTs - bTs;
                const aDate = parseIsoDate(a?.date) || "";
                const bDate = parseIsoDate(b?.date) || "";
                if (aDate !== bDate) return aDate.localeCompare(bDate);
                return normalizeKey(a?.shiftId).localeCompare(normalizeKey(b?.shiftId));
            });

        const statusOrder = getConfiguredDeadlineKeys();
        const indexMap = new Map(statusOrder.map((key, idx) => [key, idx]));
        const groupsMap = new Map();

        shifts.forEach((shiftItem) => {
            const details = Array.isArray(shiftItem?.details) ? shiftItem.details : [];
            const shiftStamp = `${toNumber(shiftItem?.shiftSortTs)}|${normalizeKey(shiftItem?.shiftId)}`;

            details.forEach((detail) => {
                const statusKey = normalizeDeadlineKey(detail?.key);
                if (!statusKey) return;

                if (!groupsMap.has(statusKey)) {
                    groupsMap.set(statusKey, {
                        key: statusKey,
                        displayKey: normalizeKey(detail?.displayKey) || DEADLINE_LABELS[statusKey] || statusKey,
                        sheetNames: new Set(),
                        entriesMap: new Map()
                    });
                }
                const group = groupsMap.get(statusKey);
                (Array.isArray(detail?.sheetNames) ? detail.sheetNames : []).forEach((name) => {
                    const n = normalizeKey(name);
                    if (n) group.sheetNames.add(n);
                });

                const sources = [
                    detail?.remainingExpensiveByDate,
                    detail?.remaining_expensive_by_date,
                    detail?.remaining_expensive_due_by_date,
                    detail?.expensive_remaining_by_date,
                    detail?.expensive_due_by_date,
                    detail?.remaining_due_by_date
                ];

                let entries = [];
                for (const source of sources) {
                    const parsed = parseUnfinishedEntriesFromSource(source, detail, shiftItem);
                    if (parsed.length) {
                        entries = parsed;
                        break;
                    }
                }

                if (!entries.length) {
                    const count = computeRemainingExpensiveCount(detail, { allowGeneric: false });
                    const sum = computeRemainingExpensiveSum(detail, { allowGeneric: true });
                    if (count > 0) {
                        entries = [{
                            dateLabel: buildShortDueLabelForShiftDetail(detail, shiftItem) || "-",
                            count,
                            sum
                        }];
                    }
                }
                if (!entries.length) return;

                const hasAnySum = entries.some((entry) => entry?.sum !== null && entry?.sum !== undefined);
                if (!hasAnySum) {
                    const detailRemainingSum = computeRemainingExpensiveSum(detail, { allowGeneric: true });
                    if (detailRemainingSum !== null && detailRemainingSum > 0) {
                        const totalCount = entries.reduce((acc, entry) => acc + Math.max(0, toNumber(entry?.count)), 0);
                        if (totalCount > 0) {
                            entries = entries.map((entry) => ({
                                ...entry,
                                sum: Math.max(0, toNumber(entry?.count)) > 0
                                    ? detailRemainingSum * (Math.max(0, toNumber(entry?.count)) / totalCount)
                                    : null
                            }));
                        }
                    }
                }

                entries.forEach((entry) => {
                    const dateLabel = normalizeKey(entry?.dateLabel) || "-";
                    const count = Math.max(0, toNumber(entry?.count));
                    const sumRaw = entry?.sum;
                    let sum = (sumRaw === null || sumRaw === undefined || sumRaw === "")
                        ? null
                        : Math.max(0, toNumber(sumRaw));
                    if (count > 0 && sum !== null && sum <= 0) {
                        // Для дорогостоя (цена > 1000) нулевая сумма при положительном количестве
                        // чаще всего означает, что API не вернул сумму, а не реальный ноль.
                        sum = null;
                    }

                    const prev = group.entriesMap.get(dateLabel);
                    if (!prev || prev.lastStamp !== shiftStamp) {
                        group.entriesMap.set(dateLabel, {
                            dateLabel,
                            count,
                            sum: sum === null ? 0 : sum,
                            hasSum: sum !== null,
                            lastStamp: shiftStamp
                        });
                        return;
                    }

                    prev.count += count;
                    if (sum !== null) {
                        prev.sum += sum;
                        prev.hasSum = true;
                    }
                    group.entriesMap.set(dateLabel, prev);
                });
            });
        });

        const groups = Array.from(groupsMap.values())
            .map((group) => {
                const entries = Array.from(group.entriesMap.values())
                    .filter((entry) => entry.count > 0)
                    .sort((a, b) => {
                        const aIso = parseYmd(a.dateLabel) || "";
                        const bIso = parseYmd(b.dateLabel) || "";
                        if (aIso && bIso && aIso !== bIso) return bIso.localeCompare(aIso);
                        return a.dateLabel.localeCompare(b.dateLabel, "ru");
                    });
                if (!entries.length) return null;

                return {
                    key: group.key,
                    displayKey: group.displayKey,
                    sheetNames: Array.from(group.sheetNames),
                    entries,
                    totalCount: entries.reduce((acc, entry) => acc + toNumber(entry.count), 0),
                    totalSum: entries.reduce((acc, entry) => acc + (entry.hasSum ? toNumber(entry.sum) : 0), 0),
                    hasFullSum: entries.every((entry) => entry.hasSum)
                };
            })
            .filter(Boolean);

        groups.sort((a, b) => {
            const aIndex = indexMap.has(a.key) ? indexMap.get(a.key) : Number.MAX_SAFE_INTEGER;
            const bIndex = indexMap.has(b.key) ? indexMap.get(b.key) : Number.MAX_SAFE_INTEGER;
            if (aIndex !== bIndex) return aIndex - bIndex;
            return a.displayKey.localeCompare(b.displayKey, "ru");
        });

        return groups;
    }

    function compactDueDateLabel(label) {
        const raw = normalizeKey(label);
        if (!raw) return "-";
        return raw.replace(/(\d{2}\.\d{2})\.\d{4}/g, "$1");
    }

    function renderUnfinishedCompactPanel() {
        const panel = document.getElementById("dashboard-unfinished-panel-content");
        if (!panel) return;

        const groups = buildUnfinishedExpensiveByStatus(lastMonthShiftDynamics);
        if (!groups.length) {
            panel.innerHTML = `<div class="muted" style="font-size:11px;">Нет хвостов по дорогостою.</div>`;
            return;
        }

        const html = groups.map((group) => {
            const rows = group.entries.map((entry) => `
                <div class="opp-unfinished-mini-row">
                    <span class="opp-unfinished-mini-date">${escapeHtml(compactDueDateLabel(entry.dateLabel))}</span>
                    <span class="opp-unfinished-mini-count">${formatNumber(entry.count)} ШК</span>
                </div>
            `).join("");

            return `
                <div class="opp-unfinished-mini-group">
                    <div class="opp-unfinished-mini-title">${escapeHtml(group.displayKey)}</div>
                    ${rows}
                </div>
            `;
        }).join("");

        panel.innerHTML = `<div class="opp-unfinished-mini-list">${html}</div>`;
    }

    function formatDateTimeRu(value) {
        const raw = normalizeKey(value);
        if (!raw) return "";

        const dt = new Date(raw);
        if (!Number.isFinite(dt.getTime())) return raw;

        return new Intl.DateTimeFormat("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Moscow"
        }).format(dt);
    }

    function getPeriodByDates(dateFromIso, dateToIso) {
        const to = parseIsoDate(dateToIso) || toIsoDate(moscowNowDate());
        const fromRaw = parseIsoDate(dateFromIso);
        const from = fromRaw || shiftIsoDate(to, -7);
        return { from, to };
    }

    function getMonthPeriodByDate(dateIso) {
        const safeTo = parseIsoDate(dateIso) || toIsoDate(moscowNowDate());
        const y = safeTo.slice(0, 4);
        const m = safeTo.slice(5, 7);
        return {
            from: `${y}-${m}-01`,
            to: safeTo
        };
    }

    function chunkArray(items, chunkSize) {
        const out = [];
        const safeItems = Array.isArray(items) ? items : [];
        const size = Math.max(Number(chunkSize || 1), 1);
        for (let i = 0; i < safeItems.length; i += size) {
            out.push(safeItems.slice(i, i + size));
        }
        return out;
    }

    function toMoscowDate(value) {
        const dt = new Date(value);
        if (!Number.isFinite(dt.getTime())) return null;
        const moscow = new Date(dt.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
        if (!Number.isFinite(moscow.getTime())) return null;
        return moscow;
    }

    function buildShiftIdByMoscowDate(value) {
        const moscow = toMoscowDate(value);
        if (!moscow) return "";

        const hh = moscow.getHours();
        const base = new Date(moscow.getTime());
        base.setHours(0, 0, 0, 0);

        if (hh >= 8 && hh < 20) {
            return `day:${toIsoDate(base)}`;
        }

        if (hh >= 20) {
            return `night:${toIsoDate(base)}`;
        }

        base.setDate(base.getDate() - 1);
        return `night:${toIsoDate(base)}`;
    }

    function findCurrentShiftItem(shiftRows) {
        const rows = Array.isArray(shiftRows) ? shiftRows : [];
        if (!rows.length) return null;

        const currentShiftId = buildShiftIdByMoscowDate(new Date());
        if (currentShiftId) {
            const exact = rows.find((item) => item.shiftId === currentShiftId);
            if (exact) return exact;

            const currentType = currentShiftId.startsWith("night:") ? "night" : "day";
            const sameType = rows.find((item) => normalizeKey(item?.shiftType) === currentType);
            if (sameType) return sameType;
        }

        return rows[0] || null;
    }

    function findPreviousShiftItem(shiftRows, currentShift) {
        const rows = Array.isArray(shiftRows) ? shiftRows : [];
        if (!rows.length || !currentShift) return null;

        const idx = rows.findIndex((item) => item.shiftId === currentShift.shiftId);
        if (idx === -1) return null;
        return rows[idx + 1] || null;
    }

    function isPreviousShiftButtonAvailable(nowDate) {
        const now = nowDate instanceof Date ? nowDate : moscowNowDate();
        const hh = Number(now.getHours());
        return (hh >= 8 && hh < 10) || (hh >= 20 && hh < 22);
    }

    async function fetchPlaceWarehouseMap(placeIds) {
        if (!window.supabaseClient) return new Map();
        const map = new Map();
        const cleanIds = Array.from(new Set((placeIds || []).map((id) => normalizeKey(id)).filter(Boolean)));
        if (!cleanIds.length) return map;

        const chunks = chunkArray(cleanIds, 500);
        for (const idsChunk of chunks) {
            const { data, error } = await window.supabaseClient
                .from("places")
                .select("place, wh_id")
                .in("place", idsChunk);
            if (error) {
                console.warn("Не удалось прочитать places:", error.message || error);
                return map;
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

    async function fetchOppRecognizedCountsByShift(period) {
        const out = Object.create(null);
        if (!window.supabaseClient) return out;
        if (!currentWhId) return out;

        const from = parseIsoDate(period?.from);
        const to = parseIsoDate(period?.to);
        if (!from || !to) return out;

        const fromIso = `${from}T00:00:00+03:00`;
        const toPlusOne = shiftIsoDate(to, 1) || to;
        const toIso = `${toPlusOne}T08:00:00+03:00`;

        let query = window.supabaseClient
            .from("nm_rep")
            .select("date, place")
            .order("date", { ascending: false })
            .gte("date", fromIso)
            .lte("date", toIso);

        const { data, error } = await query;
        if (error) {
            console.warn("Не удалось загрузить nm_rep для динамики смен:", error.message || error);
            return out;
        }

        const srcRows = Array.isArray(data) ? data : [];
        if (!srcRows.length) return out;

        const placeMap = await fetchPlaceWarehouseMap(srcRows.map((row) => row?.place));
        const targetWhId = normalizeKey(currentWhId);

        srcRows.forEach((row) => {
            const place = normalizeKey(row?.place);
            if (!place) return;
            const placeWh = normalizeKey(placeMap.get(place));
            if (!placeWh || placeWh !== targetWhId) return;

            const shiftId = buildShiftIdByMoscowDate(row?.date);
            if (!shiftId) return;
            out[shiftId] = toNumber(out[shiftId]) + 1;
        });

        return out;
    }

    function parseMaybeJson(value) {
        if (typeof value !== "string") return value;
        const raw = value.trim();
        if (!raw) return value;
        if (!raw.startsWith("{") && !raw.startsWith("[")) return value;

        try {
            return JSON.parse(raw);
        } catch {
            return value;
        }
    }

    function collectCandidateStrings(value, out) {
        if (value === null || value === undefined) return;

        if (typeof value === "string" || typeof value === "number") {
            out.push(String(value).trim());
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(item => collectCandidateStrings(item, out));
            return;
        }

        if (typeof value === "object") {
            Object.keys(value).forEach(key => {
                collectCandidateStrings(value[key], out);
            });
        }
    }

    function extractAppsScriptUrlFromData(rawData) {
        const data = parseMaybeJson(rawData);
        const regex = /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/(?:exec|dev)(?:\?[^\s"']*)?/i;

        if (data && typeof data === "object" && !Array.isArray(data)) {
            const preferred = [
                "apps_script_url",
                "appsScriptUrl",
                "api_url",
                "apiUrl",
                "gas_url",
                "gasUrl"
            ];
            for (const key of preferred) {
                if (!(key in data)) continue;
                const val = normalizeKey(data[key]);
                const m = val.match(regex);
                if (m) return m[0];
            }
        }

        const candidates = [];
        collectCandidateStrings(data, candidates);

        for (const candidate of candidates) {
            const m = candidate.match(regex);
            if (m) return m[0];
        }

        return "";
    }

    function extractDeadlinesFromData(rawData) {
        const result = { map: {}, order: [] };
        const parsed = parseMaybeJson(rawData);

        function put(key, value) {
            const nKey = normalizeDeadlineKey(key);
            const nVal = parseDeadlineNumber(value);
            if (!nKey || nVal === null) return;

            if (!Object.prototype.hasOwnProperty.call(result.map, nKey)) {
                result.order.push(nKey);
            }
            result.map[nKey] = nVal;
        }

        function parsePairsObject(obj) {
            if (!obj || typeof obj !== "object") return;
            Object.keys(obj).forEach((key) => {
                put(key, obj[key]);
            });
        }

        if (parsed && typeof parsed === "object") {
            if (Array.isArray(parsed)) {
                parsed.forEach((item) => {
                    if (!item || typeof item !== "object") return;
                    put(item.key || item.name || item.status, item.offset_days ?? item.offset ?? item.value);
                });
            } else {
                if (Array.isArray(parsed.deadlines)) {
                    parsed.deadlines.forEach((item) => {
                        if (!item || typeof item !== "object") return;
                        put(item.key || item.name || item.status, item.offset_days ?? item.offset ?? item.value);
                    });
                }

                if (parsed.values && typeof parsed.values === "object") {
                    parsePairsObject(parsed.values);
                }

                parsePairsObject(parsed);
            }
        }

        const sourceText = typeof rawData === "string" ? rawData : "";
        const pairRegex = /["']?([A-Za-z0-9_]+)["']?\s*:\s*["']?(-?\d+(?:[.,]\d+)?)["']?/g;
        let match = null;
        while ((match = pairRegex.exec(sourceText)) !== null) {
            put(match[1], match[2]);
        }

        return result;
    }

    function extractEmployeesFromData(rawData) {
        const result = { map: {}, order: [] };
        const parsed = parseMaybeJson(rawData);

        function put(idRaw, aliasRaw) {
            const id = normalizeKey(idRaw);
            const alias = normalizeKey(aliasRaw);
            if (!id || !alias) return;

            if (!Object.prototype.hasOwnProperty.call(result.map, id)) {
                result.order.push(id);
            }
            result.map[id] = alias;
        }

        function parsePairsObject(obj) {
            if (!obj || typeof obj !== "object") return;
            Object.keys(obj).forEach((idKey) => {
                const value = obj[idKey];
                if (value === null || value === undefined) return;
                if (typeof value === "string" || typeof value === "number") {
                    put(idKey, value);
                }
            });
        }

        if (parsed && typeof parsed === "object") {
            if (Array.isArray(parsed)) {
                parsed.forEach((item) => {
                    if (!item || typeof item !== "object") return;
                    put(
                        item.id ?? item.user_id ?? item.key,
                        item.alias ?? item.name ?? item.value ?? item.display_name
                    );
                });
            } else {
                if (Array.isArray(parsed.employees)) {
                    parsed.employees.forEach((item) => {
                        if (!item || typeof item !== "object") return;
                        put(
                            item.id ?? item.user_id ?? item.key,
                            item.alias ?? item.name ?? item.value ?? item.display_name
                        );
                    });
                }

                if (parsed.values && typeof parsed.values === "object") {
                    parsePairsObject(parsed.values);
                }

                parsePairsObject(parsed);
            }
        }

        const sourceText = typeof rawData === "string" ? rawData : "";
        const pairRegex = /["']?([A-Za-z0-9_-]+)["']?\s*:\s*["']([^"']+)["']/g;
        let match = null;
        while ((match = pairRegex.exec(sourceText)) !== null) {
            put(match[1], match[2]);
        }

        return result;
    }

    async function loadEmployeeDirectoryFromUsers(employeeMap) {
        const sourceMap = employeeMap && typeof employeeMap === "object" ? employeeMap : {};
        const ids = Object.keys(sourceMap);
        const usersById = new Map();

        if (ids.length && window.supabaseClient) {
            const numericIds = ids
                .filter((id) => /^-?\d+$/.test(String(id)))
                .map((id) => Number(id));

            if (numericIds.length) {
                const { data, error } = await window.supabaseClient
                    .from("users")
                    .select("id, fio, name")
                    .in("id", numericIds);

                if (!error && Array.isArray(data)) {
                    data.forEach((row) => {
                        usersById.set(String(row?.id ?? ""), row || {});
                    });
                } else if (error) {
                    console.warn("Не удалось загрузить users для opp_table_employees:", error.message || error);
                }
            }
        }

        const directory = [];
        const seenAliasNorm = new Set();
        ids.forEach((id) => {
            const alias = normalizeKey(sourceMap[id]);
            if (!alias) return;

            const aliasNorm = normalizeEmployeeToken(alias);
            const aliasWords = normalizeEmployeeWords(alias);
            if (!aliasNorm || !aliasWords) return;
            if (seenAliasNorm.has(aliasNorm)) return;
            seenAliasNorm.add(aliasNorm);

            const idText = normalizeKey(id);
            const userRow = usersById.get(idText) || null;
            const displayName = normalizeKey(userRow?.fio || userRow?.name || alias || id);
            const displayWords = normalizeEmployeeWords(displayName);

            directory.push({
                id: idText,
                idToken: idText.replace(/\D+/g, ""),
                alias,
                aliasNorm,
                aliasWords,
                displayName,
                displayWords
            });
        });

        currentEmployeeDirectory = directory;
    }

    function resolveEmployeeNamesFromAnalyzerValues(values) {
        const rows = Array.isArray(values) ? values : [];
        if (!rows.length) return [];

        const employees = Array.isArray(currentEmployeeDirectory) ? currentEmployeeDirectory : [];
        if (!employees.length) return [];
        const names = new Set();

        rows.forEach((rawValue) => {
            const rawText = normalizeKey(rawValue);
            if (!rawText) return;

            const rawWords = normalizeEmployeeWords(rawText);
            const rawNorm = normalizeEmployeeToken(rawText);
            const rawChunks = rawText
                .split(/[\n\r,;|/\\+&]+/)
                .map((part) => normalizeEmployeeWords(part))
                .filter(Boolean);

            const tokenSet = new Set();
            if (rawWords) tokenSet.add(rawWords);
            if (rawNorm) tokenSet.add(rawNorm);
            rawChunks.forEach((chunk) => {
                const chunkNorm = normalizeEmployeeToken(chunk);
                if (chunk) tokenSet.add(chunk);
                if (chunkNorm) tokenSet.add(chunkNorm);
                chunk.split(" ").forEach((word) => {
                    const wordNorm = normalizeEmployeeToken(word);
                    if (word) tokenSet.add(word);
                    if (wordNorm) tokenSet.add(wordNorm);
                });
            });
            const rawIdToken = rawText.replace(/\D+/g, "");
            if (rawIdToken) tokenSet.add(rawIdToken);

            employees.forEach((entry) => {
                const aliasNorm = entry?.aliasNorm;
                const aliasWords = entry?.aliasWords;
                const displayWords = entry?.displayWords;
                const idToken = normalizeKey(entry?.idToken);

                const isMatch =
                    (aliasNorm && tokenSet.has(aliasNorm)) ||
                    (aliasWords && tokenSet.has(aliasWords)) ||
                    (displayWords && tokenSet.has(displayWords)) ||
                    (idToken && tokenSet.has(idToken));

                if (!isMatch) return;
                names.add(normalizeKey(entry.displayName || entry.alias || ""));
            });
        });

        return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
    }

    async function loadWarehouseConfig() {
        if (!window.supabaseClient) {
            throw new Error("Supabase клиент не инициализирован (ui.js).");
        }

        if (!currentWhId) {
            throw new Error("Не удалось определить user_wh_id текущего пользователя.");
        }

        const normalizedWhId = normalizeWhId(currentWhId);
        const { data, error } = await window.supabaseClient
            .from("wh_data_rep")
            .select("wh_id, data_type, data")
            .eq("wh_id", normalizedWhId)
            .in("data_type", [API_DATA_TYPE, DEADLINES_DATA_TYPE, EMPLOYEES_DATA_TYPE]);

        if (error) {
            throw new Error(`Ошибка чтения wh_data_rep: ${error.message || String(error)}`);
        }

        const rows = Array.isArray(data) ? data : [];
        const apiRows = rows.filter((row) => normalizeKey(row?.data_type) === API_DATA_TYPE);
        const deadlineRows = rows.filter((row) => normalizeKey(row?.data_type) === DEADLINES_DATA_TYPE);
        const employeeRows = rows.filter((row) => normalizeKey(row?.data_type) === EMPLOYEES_DATA_TYPE);

        if (!apiRows.length) {
            throw new Error(`Контейнер ${API_DATA_TYPE} для этого склада не найден.`);
        }

        let apiUrl = "";
        for (const row of apiRows) {
            const candidate = extractAppsScriptUrlFromData(row?.data);
            if (candidate) {
                apiUrl = candidate;
                break;
            }
        }

        if (!apiUrl) {
            throw new Error(
                `В ${API_DATA_TYPE} не найден URL Google Apps Script. ` +
                "Добавьте в поле data ключ apps_script_url/api_url со ссылкой .../exec"
            );
        }

        const mergedMap = {};
        const mergedOrder = [];
        deadlineRows.forEach((row) => {
            const parsed = extractDeadlinesFromData(row?.data);
            parsed.order.forEach((key) => {
                if (!Object.prototype.hasOwnProperty.call(mergedMap, key)) {
                    mergedOrder.push(key);
                }
                mergedMap[key] = parsed.map[key];
            });
        });

        const mergedEmployeesMap = {};
        employeeRows.forEach((row) => {
            const parsed = extractEmployeesFromData(row?.data);
            parsed.order.forEach((id) => {
                mergedEmployeesMap[id] = parsed.map[id];
            });
        });

        await loadEmployeeDirectoryFromUsers(mergedEmployeesMap);

        currentApiUrl = apiUrl;
        currentDeadlines = mergedMap;
        currentDeadlineOrder = mergedOrder;
        currentEmployeesById = mergedEmployeesMap;
    }

    function buildDeadlinesRequestPayload() {
        const keys = getConfiguredDeadlineKeys();
        const items = keys
            .map((key) => ({
                key,
                offset_days: currentDeadlines[key],
                display_key: DEADLINE_LABELS[key] || key
            }));

        if (!items.length) return "";

        return JSON.stringify({ deadlines: items });
    }

    function buildApiRequestUrl(baseUrl, period) {
        const url = new URL(baseUrl);
        url.searchParams.set("mode", "unique_shk_by_date");
        url.searchParams.set("date_from", period.from);
        url.searchParams.set("date_to", period.to);
        url.searchParams.set("_ts", String(Date.now()));

        if (currentWhId) {
            url.searchParams.set("wh_id", String(currentWhId));
        }

        const deadlinesPayload = buildDeadlinesRequestPayload();
        if (deadlinesPayload) {
            url.searchParams.set("deadlines_json", deadlinesPayload);
        }

        return url.toString();
    }

    function parseYmd(value) {
        const raw = normalizeKey(value);
        if (!raw) return "";

        const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) return raw;

        const ru = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
        if (!ru) return "";

        const d = pad2(ru[1]);
        const m = pad2(ru[2]);
        const yRaw = String(ru[3]);
        const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
        return `${y}-${m}-${d}`;
    }

    function toNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }

    function normalizeApiRows(payload) {
        let rows = [];

        if (Array.isArray(payload?.by_date)) rows = payload.by_date;
        else if (Array.isArray(payload?.rows)) rows = payload.rows;
        else if (Array.isArray(payload?.data)) rows = payload.data;
        else if (payload?.by_date && typeof payload.by_date === "object") {
            rows = Object.keys(payload.by_date).map((dateKey) => ({
                date: dateKey,
                ...(payload.by_date[dateKey] || {})
            }));
        }

        return rows
            .map((row) => {
                const date = parseYmd(row?.date || row?.ymd || row?.day || "");
                if (!date) return null;

                const sheetCounts = row?.sheets || {};
                const analyzedSheetCounts = row?.analyzed_sheets || row?.sheets_analyzed || {};

                const count24 = toNumber(row?.sheet_24 ?? sheetCounts?.["24"]);
                const countSps = toNumber(row?.sheet_presort_sps ?? sheetCounts?.["Предсорт SPS"]);
                const countPack = toNumber(row?.sheet_packaging ?? sheetCounts?.["Упаковка"]);

                const analyzed24 = toNumber(row?.analyzed_sheet_24 ?? analyzedSheetCounts?.["24"]);
                const analyzedSps = toNumber(row?.analyzed_sheet_presort_sps ?? analyzedSheetCounts?.["Предсорт SPS"]);
                const analyzedPack = toNumber(row?.analyzed_sheet_packaging ?? analyzedSheetCounts?.["Упаковка"]);

                const loadedTotal = toNumber(
                    row?.total_unique_shk ?? row?.total_unique ?? row?.total
                ) || (count24 + countSps + countPack);

                const analyzedTotal = toNumber(
                    row?.total_analyzed_unique_shk ?? row?.total_analyzed_unique ?? row?.analyzed_total
                ) || (analyzed24 + analyzedSps + analyzedPack);

                return {
                    date,
                    count24,
                    countSps,
                    countPack,
                    loadedTotal,
                    analyzedTotal
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.date.localeCompare(a.date));
    }

    function normalizeSummary(payload, rows) {
        const totalLoaded = toNumber(
            payload?.total_period_unique_shk ??
            payload?.period_total_unique_shk ??
            payload?.summary?.total_period_unique_shk
        );

        const totalAnalyzed = toNumber(
            payload?.total_period_analyzed_unique_shk ??
            payload?.period_total_analyzed_unique_shk ??
            payload?.summary?.total_period_analyzed_unique_shk
        );

        return {
            totalLoaded: totalLoaded || rows.reduce((acc, item) => acc + item.loadedTotal, 0),
            totalAnalyzed: totalAnalyzed || rows.reduce((acc, item) => acc + item.analyzedTotal, 0)
        };
    }

    function normalizeTodayDeadline(payload) {
        const block = payload?.today_deadline || payload?.deadline_today || payload?.today_deadlines;
        if (!block || typeof block !== "object") {
            return null;
        }

        const itemsRaw = Array.isArray(block.items) ? block.items : [];
        const items = itemsRaw
            .map((item) => {
                const keyNorm = normalizeDeadlineKey(item?.key || item?.display_key);
                const displayKey = normalizeKey(DEADLINE_LABELS[keyNorm] || item?.display_key || item?.key || keyNorm);
                if (!keyNorm || !displayKey) return null;
                if (!SUPPORTED_DEADLINE_KEYS.includes(keyNorm)) return null;

                const dueTotal = toNumber(
                    item?.due_total_unique_shk ??
                    item?.due_total ??
                    item?.total_due
                );
                const analyzed = toNumber(
                    item?.analyzed_due_unique_shk ??
                    item?.analyzed_due ??
                    item?.analyzed
                );

                const hasRemaining = Object.prototype.hasOwnProperty.call(item || {}, "remaining_due_unique_shk") ||
                    Object.prototype.hasOwnProperty.call(item || {}, "remaining_due");
                const remaining = hasRemaining
                    ? toNumber(item?.remaining_due_unique_shk ?? item?.remaining_due)
                    : Math.max(dueTotal - analyzed, 0);

                const dueLabel = normalizeKey(item?.due_until_label || item?.due_for_date_label || item?.due_for_date);
                const percent = dueTotal > 0 ? (analyzed / dueTotal) * 100 : 0;
                const dueSumPrice = toNumber(
                    item?.due_total_sum_price ??
                    item?.due_sum_price ??
                    item?.due_total_price
                );
                const analyzedSumPrice = toNumber(
                    item?.analyzed_due_sum_price ??
                    item?.analyzed_sum_price ??
                    item?.analyzed_due_price
                );
                const expensiveDueTotal = toNumber(
                    item?.expensive_due_total_unique_shk ??
                    item?.expensive_due_total ??
                    item?.expensive_total_due
                );
                const expensiveAnalyzed = toNumber(
                    item?.expensive_analyzed_due_unique_shk ??
                    item?.expensive_analyzed_due ??
                    item?.expensive_analyzed
                );
                const expensivePercent = expensiveDueTotal > 0
                    ? (expensiveAnalyzed / expensiveDueTotal) * 100
                    : toNumber(item?.expensive_analyzed_percent);

                return {
                    key: keyNorm,
                    displayKey,
                    offsetDays: parseDeadlineNumber(item?.offset_days ?? item?.offset ?? 0) ?? 0,
                    dueLabel: dueLabel || "Дедлайн не задан",
                    dueTotal,
                    analyzed,
                    remaining,
                    percent,
                    dueSumPrice,
                    analyzedSumPrice,
                    expensiveDueTotal,
                    expensiveAnalyzed,
                    expensivePercent,
                    hasPriceDetail: keyNorm !== "ORS"
                };
            })
            .filter(Boolean);

        const asOfRaw = normalizeKey(block.as_of_label || block.generated_at_label || block.as_of || block.generated_at);
        const asOfText = formatDateTimeRu(asOfRaw) || asOfRaw;
        const shiftMode = normalizeKey(block.shift_mode);
        const operationalDateLabel = normalizeKey(block.operational_date_label || block.operational_date);

        return { items, asOfText, shiftMode, operationalDateLabel };
    }

    function normalizeShiftDynamics(payload) {
        const rowsRaw = Array.isArray(payload?.shift_dynamics) ? payload.shift_dynamics : [];

        return rowsRaw
            .map((row) => {
                const date = parseYmd(row?.operational_date_key || row?.date || "");
                if (!date) return null;
                const shiftType = normalizeKey(row?.shift_type).toLowerCase();
                const shiftId = normalizeKey(row?.shift_id || `${shiftType || "shift"}:${date}`);
                const shiftName = normalizeKey(row?.shift_name || (shiftType === "night" ? "Ночная смена" : "Дневная смена"));
                const shiftLabel = normalizeKey(row?.shift_label || row?.operational_date_label || formatDateRu(date));
                const shiftSortTs = toNumber(row?.shift_sort_ts);

                const totalDue = toNumber(
                    row?.total_due_unique_shk ??
                    row?.due_total ??
                    row?.total_due
                );
                const analyzed = toNumber(
                    row?.analyzed_due_unique_shk ??
                    row?.analyzed_due ??
                    row?.analyzed_total
                );
                const dueSumPrice = toNumber(
                    row?.total_due_sum_price ??
                    row?.due_total_sum_price ??
                    row?.due_sum_price
                );
                const analyzedSumPrice = toNumber(
                    row?.analyzed_due_sum_price ??
                    row?.analyzed_sum_price
                );
                const expensiveDueTotal = toNumber(
                    row?.expensive_due_total_unique_shk ??
                    row?.expensive_due_total
                );
                const expensiveAnalyzed = toNumber(
                    row?.expensive_analyzed_due_unique_shk ??
                    row?.expensive_analyzed_due
                );
                const shiftBreakdownRaw = Array.isArray(row?.breakdown_status_counts)
                    ? row.breakdown_status_counts
                    : [];
                const shiftBreakdownStatuses = shiftBreakdownRaw
                    .map((entry) => ({
                        status: normalizeKey(entry?.status || entry?.name || entry?.label),
                        count: toNumber(entry?.count || entry?.value)
                    }))
                    .filter((entry) => entry.status && entry.count > 0)
                    .sort((a, b) => (b.count - a.count) || a.status.localeCompare(b.status, "ru"));
                const shiftAnalyzerValues = Array.isArray(row?.analyzer_values)
                    ? row.analyzer_values.map((v) => normalizeKey(v)).filter(Boolean)
                    : [];

                const detailsRaw = Array.isArray(row?.details) ? row.details : [];
                const details = detailsRaw
                    .map((detail) => {
                        const keyNorm = normalizeDeadlineKey(detail?.key || detail?.display_key);
                        if (!keyNorm || !SUPPORTED_DEADLINE_KEYS.includes(keyNorm)) return null;

                        const displayKey = normalizeKey(DEADLINE_LABELS[keyNorm] || detail?.display_key || keyNorm);
                        const dueLabel = normalizeKey(
                            detail?.due_until_label ||
                            detail?.due_for_date_label ||
                            detail?.due_for_date
                        );
                        const detailDueTotal = toNumber(
                            detail?.due_total_unique_shk ??
                            detail?.due_total ??
                            detail?.total_due
                        );
                        const detailAnalyzed = toNumber(
                            detail?.analyzed_due_unique_shk ??
                            detail?.analyzed_due ??
                            detail?.analyzed
                        );
                        const detailDueSumPrice = toNumber(
                            detail?.due_total_sum_price ??
                            detail?.due_sum_price
                        );
                        const detailAnalyzedSumPrice = toNumber(
                            detail?.analyzed_due_sum_price ??
                            detail?.analyzed_sum_price
                        );
                        const detailExpensiveDueTotal = toNumber(
                            detail?.expensive_due_total_unique_shk ??
                            detail?.expensive_due_total
                        );
                        const detailExpensiveAnalyzed = toNumber(
                            detail?.expensive_analyzed_due_unique_shk ??
                            detail?.expensive_analyzed_due
                        );
                        const detailExpensiveDueSumPrice = toNumber(
                            detail?.expensive_due_total_sum_price ??
                            detail?.expensive_due_sum_price ??
                            detail?.expensive_due_price
                        );
                        const detailExpensiveAnalyzedSumPrice = toNumber(
                            detail?.expensive_analyzed_due_sum_price ??
                            detail?.expensive_analyzed_sum_price ??
                            detail?.expensive_analyzed_due_price
                        );
                        const detailAnalyzerValues = Array.isArray(detail?.analyzer_values)
                            ? detail.analyzer_values.map((v) => normalizeKey(v)).filter(Boolean)
                            : [];
                        const detailEmployeeNames = resolveEmployeeNamesFromAnalyzerValues(detailAnalyzerValues);
                        const detailBreakdownRaw = Array.isArray(detail?.breakdown_status_counts)
                            ? detail.breakdown_status_counts
                            : [];
                        const detailBreakdownStatuses = detailBreakdownRaw
                            .map((entry) => ({
                                status: normalizeKey(entry?.status || entry?.name || entry?.label),
                                count: toNumber(entry?.count || entry?.value)
                            }))
                            .filter((entry) => entry.status && entry.count > 0)
                            .sort((a, b) => (b.count - a.count) || a.status.localeCompare(b.status, "ru"));

                        const sheetNamesRaw = Array.isArray(detail?.sheet_names) ? detail.sheet_names : [];
                        const sheetNames = sheetNamesRaw
                            .map((name) => normalizeKey(name))
                            .filter(Boolean);

                        return {
                            key: keyNorm,
                            displayKey,
                            dueLabel: dueLabel || "Дедлайн не задан",
                            dueTotal: detailDueTotal,
                            analyzed: detailAnalyzed,
                            dueSumPrice: detailDueSumPrice,
                            analyzedSumPrice: detailAnalyzedSumPrice,
                            expensiveDueTotal: detailExpensiveDueTotal,
                            expensiveAnalyzed: detailExpensiveAnalyzed,
                            expensiveDueSumPrice: detailExpensiveDueSumPrice,
                            expensiveAnalyzedSumPrice: detailExpensiveAnalyzedSumPrice,
                            expensivePercent: detailExpensiveDueTotal > 0
                                ? (detailExpensiveAnalyzed / detailExpensiveDueTotal) * 100
                                : toNumber(detail?.expensive_analyzed_percent),
                            analyzerValues: detailAnalyzerValues,
                            employeeNames: detailEmployeeNames,
                            breakdownStatuses: detailBreakdownStatuses,
                            uploadStatus: normalizeKey(detail?.upload_status) || (detailDueTotal > 0 ? "Есть" : "Нет выгрузки"),
                            sheetNames,
                            remainingExpensiveByDate: detail?.remaining_expensive_by_date ?? detail?.expensive_remaining_by_date ?? detail?.remaining_expensive_due_by_date ?? detail?.expensive_due_by_date ?? null,
                            hasPriceDetail: keyNorm !== "ORS"
                        };
                    })
                    .filter(Boolean);

                const shiftEmployeeNameSet = new Set();
                details.forEach((detail) => {
                    if (!MAIN_EMPLOYEE_KEYS_FOR_CARD.has(detail.key)) return;
                    (detail.employeeNames || []).forEach((name) => {
                        const n = normalizeKey(name);
                        if (n) shiftEmployeeNameSet.add(n);
                    });
                });
                const shiftEmployeeNames = Array.from(shiftEmployeeNameSet).sort((a, b) => a.localeCompare(b, "ru"));

                const percent = totalDue > 0 ? (analyzed / totalDue) * 100 : 0;
                const expensivePercent = expensiveDueTotal > 0
                    ? (expensiveAnalyzed / expensiveDueTotal) * 100
                    : toNumber(row?.expensive_analyzed_percent);

                return {
                    shiftId,
                    shiftType,
                    shiftName,
                    shiftLabel,
                    shiftSortTs,
                    date,
                    displayDate: shiftLabel || formatDateRu(date),
                    totalDue,
                    analyzed,
                    percent,
                    dueSumPrice,
                    analyzedSumPrice,
                    expensiveDueTotal,
                    expensiveAnalyzed,
                    expensivePercent,
                    analyzerValues: shiftAnalyzerValues,
                    employeeNames: shiftEmployeeNames,
                    breakdownStatuses: shiftBreakdownStatuses,
                    oppRecognizedCount: toNumber(row?.opp_recognized_count),
                    details
                };
            })
            .filter(Boolean)
            .sort((a, b) => {
                if (b.shiftSortTs !== a.shiftSortTs) return b.shiftSortTs - a.shiftSortTs;
                return b.date.localeCompare(a.date);
            });
    }

    function normalizeReportPayload(payload) {
        const rows = normalizeApiRows(payload);
        const summary = normalizeSummary(payload, rows);
        const todayDeadline = normalizeTodayDeadline(payload);
        const shiftDynamics = normalizeShiftDynamics(payload);
        const missingSheets = Array.isArray(payload?.missing_sheets) ? payload.missing_sheets.filter(Boolean) : [];
        const generatedAtRaw = normalizeKey(payload?.generated_at || payload?.generatedAt);
        const generatedAtText = formatDateTimeRu(generatedAtRaw) || generatedAtRaw || "";

        return { rows, summary, todayDeadline, shiftDynamics, missingSheets, generatedAtText };
    }

    async function fetchReport(period) {
        if (!currentApiUrl) {
            throw new Error("URL Apps Script API не определён.");
        }

        const requestUrl = buildApiRequestUrl(currentApiUrl, period);
        const response = await fetch(requestUrl, {
            method: "GET",
            headers: { Accept: "application/json" }
        });

        const text = await response.text();
        let payload = null;

        try {
            payload = JSON.parse(text);
        } catch {
            throw new Error("API вернул не JSON. Проверьте doGet() в Apps Script.");
        }

        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        return normalizeReportPayload(payload);
    }

    function isCacheFresh(cacheRow) {
        const staleAfterRaw = normalizeKey(cacheRow?.stale_after);
        const refreshedRaw = normalizeKey(cacheRow?.refreshed_at);
        const staleAfterMs = staleAfterRaw ? new Date(staleAfterRaw).getTime() : NaN;
        if (Number.isFinite(staleAfterMs)) {
            return staleAfterMs > Date.now();
        }
        const refreshedMs = refreshedRaw ? new Date(refreshedRaw).getTime() : NaN;
        if (Number.isFinite(refreshedMs)) {
            return (Date.now() - refreshedMs) <= 30 * 60 * 1000;
        }
        return false;
    }

    function parseReportFromCacheRow(cacheRow) {
        const payload = parseMaybeJson(cacheRow?.payload);
        if (!payload || typeof payload !== "object") return null;
        try {
            const report = normalizeReportPayload(payload);
            if (!normalizeKey(report?.generatedAtText)) {
                const fallbackRaw = normalizeKey(cacheRow?.source_generated_at || cacheRow?.refreshed_at);
                report.generatedAtText = formatDateTimeRu(fallbackRaw) || fallbackRaw || "";
            }
            return report;
        } catch (error) {
            console.warn("Некорректный payload в кэше OPP:", error instanceof Error ? error.message : error);
            return null;
        }
    }

    async function fetchCachedReportRow(period, cacheScope) {
        if (!window.supabaseClient || !currentWhId) return null;

        const { data, error } = await window.supabaseClient
            .from(REPORT_CACHE_TABLE)
            .select("payload, refreshed_at, stale_after, source_generated_at")
            .eq("wh_id", normalizeKey(currentWhId))
            .eq("cache_scope", normalizeKey(cacheScope))
            .eq("date_from", parseIsoDate(period?.from))
            .eq("date_to", parseIsoDate(period?.to))
            .maybeSingle();

        if (error) {
            console.warn("Не удалось прочитать кэш OPP из Supabase:", error.message || error);
            return null;
        }
        return data || null;
    }

    async function fetchReportWithCache(period, cacheScope) {
        const cacheRow = await fetchCachedReportRow(period, cacheScope).catch(() => null);
        const cachedReport = parseReportFromCacheRow(cacheRow);
        if (cachedReport && isCacheFresh(cacheRow)) {
            return cachedReport;
        }

        if (cachedReport) {
            // Возвращаем устаревший кэш сразу, чтобы не блокировать UI медленным API.
            fetchReport(period)
                .then(() => {
                    // no-op: новые данные подтянутся при следующем обновлении страницы
                })
                .catch((error) => {
                    console.warn("Не удалось обновить устаревший кэш OPP в фоне:", error instanceof Error ? error.message : error);
                });
            return cachedReport;
        }

        return await fetchReport(period);
    }

    function attachOppCountsToShiftDynamics(shiftDynamics, countsByShift) {
        const src = Array.isArray(shiftDynamics) ? shiftDynamics : [];
        const counts = countsByShift && typeof countsByShift === "object" ? countsByShift : {};
        return src.map((item) => ({
            ...item,
            oppRecognizedCount: toNumber(counts[item.shiftId] ?? item.oppRecognizedCount ?? 0)
        }));
    }

    function renderTodayDeadlineSectionHtml() {
        const hasConfiguredDeadlines = getConfiguredDeadlineKeys().length > 0;
        const items = Array.isArray(lastTodayDeadline?.items) ? lastTodayDeadline.items : [];
        const asOfText = normalizeKey(lastTodayDeadline?.asOfText);

        if (!hasConfiguredDeadlines) {
            return `
                <section class="status-box" style="margin-top:12px;">
                    <div class="status-header">
                        <div class="status-center" style="grid-column:1 / -1;">
                            <div class="status-code" style="font-size:28px;">Статистика по статусам</div>
                            <div class="status-desc">Требуемые сроки по контейнеру ${DEADLINES_DATA_TYPE}</div>
                        </div>
                    </div>
                    <div class="muted">Контейнер ${DEADLINES_DATA_TYPE} не найден или пуст.</div>
                </section>
            `;
        }

        if (!items.length) {
            return `
                <section class="status-box" style="margin-top:12px;">
                    <div class="status-header">
                        <div class="status-center" style="grid-column:1 / -1;">
                            <div class="status-code" style="font-size:28px;">Статистика по статусам</div>
                            <div class="status-desc">Требуемые сроки по статусам</div>
                        </div>
                    </div>
                    <div class="muted">По настроенным дедлайнам сейчас нет данных.</div>
                </section>
            `;
        }

        const cardsHtml = items.map((item) => {
            const statusInfo = computeStatusCardLevel(item);
            const statusClass = `opp-status-${statusInfo.level}`;
            const sumPctText = statusInfo.sumPct === null ? "" : ` (${formatPercent(statusInfo.sumPct)})`;
            return `
                <div class="opp-deadline-card ${statusClass}">
                    <div class="opp-deadline-key">${escapeHtml(item.displayKey)}</div>
                    <div class="opp-deadline-target">${escapeHtml(item.dueLabel)}</div>
                    <div class="opp-deadline-progress">
                        <span class="opp-deadline-progress-value">${formatNumber(item.analyzed)} / ${formatNumber(item.dueTotal)}</span>
                        <span class="opp-deadline-progress-label">${formatPercent(item.percent)}<br>разобрано</span>
                    </div>
                    <div class="opp-shift-meta" style="margin-top:8px;">
                        ${item.hasPriceDetail
                    ? `Сумма: ${escapeHtml(formatCurrency(item.analyzedSumPrice))} / ${escapeHtml(formatCurrency(item.dueSumPrice))}${escapeHtml(sumPctText)}`
                    : "Сумма: без детализации"}
                    </div>
                    <div class="opp-shift-meta">
                        ${item.hasPriceDetail
                    ? `Дорогостой: ${formatNumber(item.expensiveAnalyzed)} / ${formatNumber(item.expensiveDueTotal)} (${formatPercent(item.expensivePercent)})`
                    : "Дорогостой: без детализации"}
                    </div>
                </div>
            `;
        }).join("");

        return `
            <section class="status-box" style="margin-top:12px;">
                <div class="status-header">
                    <div class="status-center" style="grid-column:1 / -1;">
                        <div class="status-code" style="font-size:28px;">Статистика по статусам</div>
                        <div class="status-desc">${asOfText ? `Актуально на ${escapeHtml(asOfText)}` : "Актуально на -"}</div>
                    </div>
                </div>

                <div class="opp-deadline-grid">${cardsHtml}</div>
            </section>
        `;
    }

    function renderShiftDynamicsSectionHtml() {
        if (!lastShiftDynamics.length) {
            return `
                <section class="status-box" style="margin-top:12px;">
                    <div class="status-header">
                        <div class="status-center" style="grid-column:1 / -1;">
                            <div class="status-code" style="font-size:28px;">Динамика смен</div>
                            <div class="status-desc">Дневные и ночные смены за период</div>
                        </div>
                    </div>
                    <div class="muted">Нет данных для динамики смен.</div>
                </section>
            `;
        }

        const cardsHtml = lastShiftDynamics.map((item) => {
            const statusInfo = computeStatusCardLevel(item);
            const statusClass = `opp-status-${statusInfo.level}`;
            const valueText = `${formatNumber(item.analyzed)} / ${formatNumber(item.totalDue)}`;
            const noUploadCount = (item.details || []).filter((d) => !/есть/i.test(String(d?.uploadStatus || ""))).length;
            const metaText = item.totalDue > 0
                ? `${formatPercent(item.percent)} разобрано${noUploadCount ? ` • Нет выгрузки: ${noUploadCount}` : ""}`
                : "Нет выгрузки";
            const priceText = `Сумма: ${formatCurrency(item.analyzedSumPrice)} / ${formatCurrency(item.dueSumPrice)}`;
            const expensiveText = `Дорогостой: ${formatPercent(item.expensivePercent)} (${formatNumber(item.expensiveAnalyzed)} / ${formatNumber(item.expensiveDueTotal)})`;
            const oppText = `Опознано ОПП: ${formatNumber(item.oppRecognizedCount)}`;
            const employeeText = item.employeeNames?.length
                ? `Сотрудники: ${item.employeeNames.join(", ")}`
                : "Сотрудники: -";
            return `
                <div class="opp-shift-card ${statusClass}" data-shift-id="${escapeHtml(item.shiftId)}">
                    <div class="opp-shift-meta" style="margin-bottom:6px;font-weight:600;color:#334155;">${escapeHtml(item.shiftName)}</div>
                    <div class="opp-shift-date">${escapeHtml(item.displayDate)}</div>
                    <div class="opp-shift-value">${escapeHtml(valueText)}</div>
                    <div class="opp-shift-meta">${escapeHtml(metaText)}</div>
                    <div class="opp-shift-meta">${escapeHtml(priceText)}</div>
                    <div class="opp-shift-meta">${escapeHtml(expensiveText)}</div>
                    <div class="opp-shift-meta">${escapeHtml(oppText)}</div>
                    <div class="opp-shift-meta">${escapeHtml(employeeText)}</div>
                </div>
            `;
        }).join("");

        return `
            <section class="status-box" style="margin-top:12px;">
                <div class="status-header">
                    <div class="status-center" style="grid-column:1 / -1;">
                        <div class="status-code" style="font-size:28px;">Динамика смен</div>
                        <div class="status-desc">Раздельно по дневным и ночным сменам</div>
                    </div>
                </div>

                <div class="opp-shift-grid">${cardsHtml}</div>
            </section>
        `;
    }

    function renderMonthSummarySectionHtml() {
        const fromText = formatDateRu(lastMonthSummary?.from || "");
        const toText = formatDateRu(lastMonthSummary?.to || "");
        const periodText = (fromText && toText) ? `${fromText} - ${toText}` : "Текущий месяц";

        if (!lastMonthSummary?.hasData) {
            return `
                <section class="status-box" style="margin-top:0;">
                    <div class="status-header">
                        <div class="status-center" style="grid-column:1 / -1;">
                            <div class="status-code" style="font-size:28px;">Итоги за месяц</div>
                            <div class="status-desc">${escapeHtml(periodText)}</div>
                        </div>
                    </div>
                    <div class="muted">За выбранный месяц нет данных для итоговых показателей.</div>
                </section>
            `;
        }

        return `
            <section class="status-box" style="margin-top:0;">
                <div class="status-header">
                    <div class="status-center" style="grid-column:1 / -1;">
                        <div class="status-code" style="font-size:28px;">Итоги за месяц</div>
                        <div class="status-desc">${escapeHtml(periodText)}</div>
                    </div>
                </div>
                <div class="opp-month-grid">
                    <div class="opp-month-card">
                        <div class="opp-month-label">Разобрано/Всего</div>
                        <div class="opp-month-value">${formatNumber(lastMonthSummary.analyzed)} / ${formatNumber(lastMonthSummary.totalDue)}</div>
                    </div>
                    <div class="opp-month-card">
                        <div class="opp-month-label">Стоимость разобранного/Всего</div>
                        <div class="opp-month-value">${escapeHtml(formatCurrency(lastMonthSummary.analyzedSumPrice))} / ${escapeHtml(formatCurrency(lastMonthSummary.dueSumPrice))}</div>
                    </div>
                    <div class="opp-month-card">
                        <div class="opp-month-label">Разобрано дорогостоя/Всего</div>
                        <div class="opp-month-value">${formatNumber(lastMonthSummary.expensiveAnalyzed)} / ${formatNumber(lastMonthSummary.expensiveDueTotal)}</div>
                    </div>
                    <div class="opp-month-card">
                        <div class="opp-month-label">Процент разбора</div>
                        <div class="opp-month-value">${escapeHtml(formatPercent(lastMonthSummary.percentBySum))}</div>
                    </div>
                </div>
            </section>
        `;
    }

    function destroyCurrentShiftBreakdownChart() {
        if (shiftBreakdownChart) {
            shiftBreakdownChart.destroy();
            shiftBreakdownChart = null;
        }
    }

    function renderCurrentShiftBreakdownChart(shiftItem) {
        const wrap = document.getElementById("dashboard-breakdown-wrap");
        const canvas = document.getElementById("dashboard-breakdown-chart");
        const empty = document.getElementById("dashboard-breakdown-empty");
        if (!wrap || !canvas || !empty) return;

        destroyCurrentShiftBreakdownChart();

        const details = Array.isArray(shiftItem?.details) ? shiftItem.details : [];
        const totalMap = new Map();
        details.forEach((detail) => {
            const statuses = Array.isArray(detail?.breakdownStatuses) ? detail.breakdownStatuses : [];
            statuses.forEach((entry) => {
                const status = normalizeKey(entry?.status);
                const count = toNumber(entry?.count);
                if (!status || count <= 0) return;
                totalMap.set(status, toNumber(totalMap.get(status)) + count);
            });
        });

        const sorted = Array.from(totalMap.entries())
            .map(([status, count]) => ({ status, count }))
            .sort((a, b) => (b.count - a.count) || a.status.localeCompare(b.status, "ru"));

        if (!sorted.length || typeof Chart === "undefined") {
            wrap.style.display = "none";
            empty.style.display = "";
            empty.textContent = "Нет данных по статусам разбора за смену.";
            return;
        }

        const labels = sorted.map((entry) => entry.status);
        const values = sorted.map((entry) => entry.count);
        const colors = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#64748b", "#0ea5e9", "#14b8a6"];

        shiftBreakdownChart = new Chart(canvas, {
            type: "doughnut",
            data: {
                labels,
                datasets: [
                    {
                        data: values,
                        backgroundColor: colors.slice(0, values.length),
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom" },
                    title: { display: true, text: "Статусы разбора за смену" },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const total = values.reduce((sum, val) => sum + val, 0) || 1;
                                const value = toNumber(ctx.parsed);
                                const pct = ((value / total) * 100).toFixed(1);
                                return `${ctx.label}: ${value} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });

        empty.style.display = "none";
        wrap.style.display = "";
    }

    function renderCurrentShiftTable(shiftItem) {
        const tableWrap = document.getElementById("dashboard-shift-table-wrap");
        const body = document.getElementById("dashboard-shift-table-body");
        const empty = document.getElementById("dashboard-shift-table-empty");
        if (!tableWrap || !body || !empty) return;

        body.innerHTML = "";
        const details = Array.isArray(shiftItem?.details) ? shiftItem.details : [];
        if (!details.length) {
            tableWrap.style.display = "none";
            empty.style.display = "";
            empty.textContent = "По текущей смене нет строк для детализации.";
            return;
        }

        details.forEach((item) => {
            const sheetText = item.sheetNames?.length ? item.sheetNames.join(", ") : "-";
            const dueLabelShort = buildShortDueLabelForShiftDetail(item, shiftItem);
            const valueText = `${formatNumber(item.analyzed)} / ${formatNumber(item.dueTotal)}`;
            const sumText = item.hasPriceDetail
                ? `${formatCurrency(item.analyzedSumPrice)} / ${formatCurrency(item.dueSumPrice)}`
                : "Без детализации";
            const expensiveText = item.hasPriceDetail
                ? `${formatNumber(item.expensiveAnalyzed)} / ${formatNumber(item.expensiveDueTotal)} (${formatPercent(item.expensivePercent)})`
                : "Без детализации";
            const employeeText = item.employeeNames?.length ? item.employeeNames.join(", ") : "-";
            const statusText = item.uploadStatus || (item.dueTotal > 0 ? "Есть выгрузка" : "Нет выгрузки");
            const hasUpload = /есть/i.test(statusText);
            const statusColor = hasUpload ? "#166534" : "#b45309";

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escapeHtml(sheetText)}</td>
                <td>${escapeHtml(dueLabelShort)}</td>
                <td>${escapeHtml(valueText)}</td>
                <td>${escapeHtml(sumText)}</td>
                <td>${escapeHtml(expensiveText)}</td>
                <td>${escapeHtml(employeeText)}</td>
                <td style="color:${statusColor};font-weight:600;">${escapeHtml(statusText)}</td>
            `;
            body.appendChild(tr);
        });

        empty.style.display = "none";
        tableWrap.style.display = "";
    }

    function renderLagPanel() {
        const panel = document.getElementById("dashboard-lag-panel-content");
        if (!panel) return;

        const overallLag = Math.max(0, 100 - toNumber(lastMonthSummary?.percentBySum));
        const lagBySheets = buildMonthLagByStatus(lastMonthShiftDynamics);
        const lagBySheetsHtml = lagBySheets.map((entry) => {
            const valueText = entry.lagPercent === null ? "—" : formatPercent(entry.lagPercent);
            return `
                <div class="opp-lag-item">
                    <span class="opp-lag-item-key" title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span>
                    <span class="opp-lag-item-value">${escapeHtml(valueText)}</span>
                </div>
            `;
        }).join("");

        panel.innerHTML = `
            <div class="opp-lag-main-title">Отставание (общее)</div>
            <div class="opp-lag-main-value">${escapeHtml(formatPercent(overallLag))}</div>
            <div class="opp-lag-list">
                ${lagBySheetsHtml || '<div class="muted" style="font-size:11px;">Нет данных по листам</div>'}
            </div>
        `;
    }

    function renderSummary() {
        if (!summaryWrap) return;

        destroyCurrentShiftBreakdownChart();

        const missingSheetsText = lastMissingSheets.length
            ? `В таблице не найдены листы: ${lastMissingSheets.map((v) => escapeHtml(String(v))).join(", ")}`
            : "";
        const generatedText = normalizeKey(lastReportGeneratedAtText);

        if (!lastCurrentShift) {
            renderLagPanel();
            renderUnfinishedCompactPanel();
            renderCurrentShiftBreakdownChart(null);
            summaryWrap.innerHTML = `
                ${generatedText ? `<div class="muted" style="margin:4px 0 10px;">Актуально на: ${escapeHtml(generatedText)}</div>` : ""}
                ${missingSheetsText ? `<div class="muted" style="margin:8px 0 10px;color:#b45309;">${missingSheetsText}</div>` : ""}
                <section class="status-box" style="margin-top:0;">
                    <div class="status-header">
                        <div class="status-center" style="grid-column:1 / -1;">
                            <div class="status-code" style="font-size:28px;">ОПП - Главная</div>
                            <div class="status-desc">Текущая смена не найдена в выгрузке</div>
                        </div>
                    </div>
                    <div class="muted">Проверьте, что в Apps Script API возвращается блок shift_dynamics.</div>
                </section>
            `;
            return;
        }

        const selectedShift = lastShiftDynamics.find((item) => item.shiftId === selectedShiftId);
        const shiftItem = selectedShift || lastCurrentShift;
        if (!shiftItem) {
            renderLagPanel();
            renderUnfinishedCompactPanel();
            renderCurrentShiftBreakdownChart(null);
            summaryWrap.innerHTML = `
                ${missingSheetsText ? `<div class="muted" style="margin:8px 0 10px;color:#b45309;">${missingSheetsText}</div>` : ""}
                <section class="status-box" style="margin-top:0;">
                    <div class="status-header">
                        <div class="status-center" style="grid-column:1 / -1;">
                            <div class="status-code" style="font-size:28px;">ОПП - Главная</div>
                            <div class="status-desc">Текущая смена не найдена в выгрузке</div>
                        </div>
                    </div>
                    <div class="muted">Проверьте, что в Apps Script API возвращается блок shift_dynamics.</div>
                </section>
            `;
            return;
        }

        selectedShiftId = shiftItem.shiftId;
        const shiftTitle = `${shiftItem.shiftName} ${shiftItem.displayDate}`;
        const employeesText = shiftItem.employeeNames?.length ? shiftItem.employeeNames.join(", ") : "-";
        const canShowPreviousButton = isPreviousShiftButtonAvailable(moscowNowDate());
        const isViewingPrevious = Boolean(lastPreviousShift && shiftItem.shiftId === lastPreviousShift.shiftId);
        const switchTargetShift = isViewingPrevious ? lastCurrentShift : lastPreviousShift;
        const showSwitchButton = canShowPreviousButton && Boolean(switchTargetShift);

        const statusCardsHtml = (shiftItem.details || []).map((item) => {
            const statusInfo = computeStatusCardLevel(item);
            const statusClass = `opp-status-${statusInfo.level}`;
            const dueLabelShort = buildShortDueLabelForShiftDetail(item, shiftItem);
            const percent = item.dueTotal > 0 ? (item.analyzed / item.dueTotal) * 100 : 0;
            const sumPct = item.dueSumPrice > 0 ? (item.analyzedSumPrice / item.dueSumPrice) * 100 : null;
            const expensivePct = item.expensiveDueTotal > 0 ? (item.expensiveAnalyzed / item.expensiveDueTotal) * 100 : null;
            const uploadTitle = statusInfo.hasUpload ? "Выгрузка есть" : "Нет выгрузки";
            const uploadClass = statusInfo.hasUpload ? "ok" : "bad";
            const uploadIcon = statusInfo.hasUpload ? "✓" : "✕";
            const employeeText = item.employeeNames?.length ? item.employeeNames.join(", ") : "—";
            return `
                <div class="opp-deadline-card ${statusClass}">
                    <span class="opp-upload-indicator ${uploadClass}" title="${escapeHtml(uploadTitle)}">${uploadIcon}</span>
                    <div class="opp-deadline-key">${escapeHtml(item.displayKey)}</div>
                    <div class="opp-deadline-target">${escapeHtml(dueLabelShort)}</div>
                    <div class="opp-deadline-progress">
                        <span class="opp-deadline-progress-value">${formatNumber(item.analyzed)} / ${formatNumber(item.dueTotal)}</span>
                        <span class="opp-deadline-progress-label">${formatPercent(percent)}<br>разобрано</span>
                    </div>
                    <div class="opp-shift-meta" style="margin-top:8px;">
                        ${item.hasPriceDetail
                ? `Сумма: ${escapeHtml(formatCurrency(item.analyzedSumPrice))} / ${escapeHtml(formatCurrency(item.dueSumPrice))}${sumPct === null ? "" : ` (${escapeHtml(formatPercent(sumPct))})`}`
                : "Сумма: без детализации"}
                    </div>
                    <div class="opp-shift-meta">
                        ${item.hasPriceDetail
                ? `Дорогостой: ${formatNumber(item.expensiveAnalyzed)} / ${formatNumber(item.expensiveDueTotal)}${expensivePct === null ? "" : ` (${escapeHtml(formatPercent(expensivePct))})`}`
                : "Дорогостой: без детализации"}
                    </div>
                    <div class="opp-deadline-employees">${escapeHtml(employeeText)}</div>
                </div>
            `;
        }).join("");
        const expensiveCardClass = toNumber(shiftItem.expensiveDueTotal) <= 0 ||
            toNumber(shiftItem.expensiveAnalyzed) >= toNumber(shiftItem.expensiveDueTotal)
            ? "opp-month-card-good"
            : "opp-month-card-bad";

        summaryWrap.innerHTML = `
            ${generatedText ? `<div class="muted" style="margin:4px 0 10px;">Актуально на: ${escapeHtml(generatedText)}</div>` : ""}
            ${missingSheetsText ? `<div class="muted" style="margin:8px 0 10px;color:#b45309;">${missingSheetsText}</div>` : ""}
            ${showSwitchButton ? `
                <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
                    <button id="dashboard-prev-shift-btn" class="btn btn-rect" data-shift-id="${escapeHtml(switchTargetShift.shiftId)}">${escapeHtml(`${switchTargetShift.shiftName} ${switchTargetShift.displayDate}`)}</button>
                </div>
            ` : ""}
            <section class="status-box" style="margin-top:0;">
                <div class="status-header">
                    <div class="status-center" style="grid-column:1 / -1;">
                        <div class="status-code" style="font-size:32px;">${escapeHtml(shiftTitle)}</div>
                        <div class="status-desc">${escapeHtml(employeesText)}</div>
                    </div>
                </div>
                <div class="opp-month-grid opp-month-grid-main">
                    <div class="opp-month-card">
                        <div class="opp-month-label">Разобрано ШК</div>
                        <div class="opp-month-value">${formatNumber(shiftItem.analyzed)} / ${formatNumber(shiftItem.totalDue)}</div>
                    </div>
                    <div class="opp-month-card">
                        <div class="opp-month-label">Сумма ШК</div>
                        <div class="opp-month-value">${escapeHtml(formatCurrency(shiftItem.analyzedSumPrice))} / ${escapeHtml(formatCurrency(shiftItem.dueSumPrice))}</div>
                    </div>
                    <div class="opp-month-card ${expensiveCardClass}">
                        <div class="opp-month-label">Дорогостой</div>
                        <div class="opp-month-value">${formatNumber(shiftItem.expensiveAnalyzed)} / ${formatNumber(shiftItem.expensiveDueTotal)}</div>
                    </div>
                    <div class="opp-month-card ${toNumber(shiftItem.oppRecognizedCount) > 0 ? "opp-month-card-good" : "opp-month-card-bad"}">
                        <div class="opp-month-label">Опознано</div>
                        <div class="opp-month-value">${formatNumber(shiftItem.oppRecognizedCount)}</div>
                    </div>
                </div>
            </section>
            <section class="status-box" style="margin-top:12px;">
                <div class="status-header">
                    <div class="status-center" style="grid-column:1 / -1;">
                        <div class="status-code" style="font-size:28px;">Статистика по статусам</div>
                    </div>
                </div>
                <div class="opp-deadline-grid">
                    ${statusCardsHtml || '<div class="muted">По текущей смене нет данных по статусам.</div>'}
                </div>
            </section>
        `;

        const switchBtn = document.getElementById("dashboard-prev-shift-btn");
        if (switchBtn) {
            switchBtn.addEventListener("click", () => {
                const targetId = normalizeKey(switchBtn.getAttribute("data-shift-id"));
                if (!targetId) return;
                selectedShiftId = targetId;
                renderSummary();
            });
        }
        renderLagPanel();
        renderUnfinishedCompactPanel();
        renderCurrentShiftBreakdownChart(shiftItem);

    }

    function renderDetailsTable() {
        if (!detailModalResultBody) return;

        detailModalResultBody.innerHTML = "";

        lastRows.forEach((row) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escapeHtml(formatDateRu(row.date))}</td>
                <td>${formatNumber(row.count24)}</td>
                <td>${formatNumber(row.countSps)}</td>
                <td>${formatNumber(row.countPack)}</td>
                <td>${formatNumber(row.loadedTotal)}</td>
                <td>${formatNumber(row.analyzedTotal)}</td>
            `;
            detailModalResultBody.appendChild(tr);
        });
    }

    function openDetailsModal() {
        if (!detailModal) return;

        const periodText = `${formatDateRu(lastPeriod.from)} - ${formatDateRu(lastPeriod.to)}`;
        if (detailModalTitle) {
            detailModalTitle.textContent = `Уникальные ШК по датам (${periodText})`;
        }

        if (!lastRows.length) {
            if (detailModalTableWrap) detailModalTableWrap.style.display = "none";
            if (detailModalEmpty) {
                detailModalEmpty.style.display = "";
                detailModalEmpty.textContent = "За выбранный период данных нет.";
            }
            detailModal.classList.remove("hidden");
            return;
        }

        renderDetailsTable();
        if (detailModalTableWrap) detailModalTableWrap.style.display = "";
        if (detailModalEmpty) detailModalEmpty.style.display = "none";
        detailModal.classList.remove("hidden");
    }

    function closeDetailsModal() {
        if (detailModal) detailModal.classList.add("hidden");
    }

    function closeShiftModal() {
        if (shiftBreakdownChart) {
            shiftBreakdownChart.destroy();
            shiftBreakdownChart = null;
        }
        if (shiftModalOverall) {
            shiftModalOverall.style.display = "none";
        }
        if (shiftModalBreakdownWrap) {
            shiftModalBreakdownWrap.style.display = "none";
        }
        if (shiftModal) shiftModal.classList.add("hidden");
    }

    function closeCalendarModal() {
        if (calendarModal) calendarModal.classList.add("hidden");
    }

    function openCalendarModal() {
        if (!calendarModal || !calendarModalContent) return;

        calendarModalContent.innerHTML = renderShiftDynamicsSectionHtml();
        calendarModalContent.querySelectorAll(".opp-shift-card[data-shift-id]").forEach((card) => {
            card.addEventListener("click", () => {
                openShiftModalById(card.getAttribute("data-shift-id"));
            });
        });

        calendarModal.classList.remove("hidden");
    }

    function renderShiftModalTable(shiftItem) {
        if (!shiftModalResultBody) return;
        shiftModalResultBody.innerHTML = "";

        const details = Array.isArray(shiftItem?.details) ? shiftItem.details : [];
        details.forEach((item) => {
            const sheetText = item.sheetNames?.length ? item.sheetNames.join(", ") : "-";
            const dueLabelShort = buildShortDueLabelForShiftDetail(item, shiftItem);
            const valueText = `${formatNumber(item.analyzed)} / ${formatNumber(item.dueTotal)}`;
            const sumText = item.hasPriceDetail
                ? `${formatCurrency(item.analyzedSumPrice)} / ${formatCurrency(item.dueSumPrice)}`
                : "Без детализации";
            const expensiveText = item.hasPriceDetail
                ? `${formatNumber(item.expensiveAnalyzed)} / ${formatNumber(item.expensiveDueTotal)} (${formatPercent(item.expensivePercent)})`
                : "Без детализации";
            const employeeText = item.employeeNames?.length
                ? item.employeeNames.join(", ")
                : "-";
            const statusText = item.uploadStatus || (item.dueTotal > 0 ? "Есть выгрузка" : "Нет выгрузки");
            const hasUpload = /есть/i.test(statusText);
            const statusColor = hasUpload ? "#166534" : "#b45309";

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escapeHtml(sheetText)}</td>
                <td>${escapeHtml(dueLabelShort)}</td>
                <td>${escapeHtml(valueText)}</td>
                <td>${escapeHtml(sumText)}</td>
                <td>${escapeHtml(expensiveText)}</td>
                <td>${escapeHtml(employeeText)}</td>
                <td style="color:${statusColor};font-weight:600;">${escapeHtml(statusText)}</td>
            `;
            shiftModalResultBody.appendChild(tr);
        });
    }

    function renderShiftModalOverall(shiftItem) {
        if (!shiftModalOverall || !shiftModalOverallShk || !shiftModalOverallSum || !shiftModalOverallExpensive) {
            return;
        }

        const analyzed = toNumber(shiftItem?.analyzed);
        const totalDue = toNumber(shiftItem?.totalDue);
        const analyzedSumPrice = toNumber(shiftItem?.analyzedSumPrice);
        const dueSumPrice = toNumber(shiftItem?.dueSumPrice);
        const expensiveAnalyzed = toNumber(shiftItem?.expensiveAnalyzed);
        const expensiveDueTotal = toNumber(shiftItem?.expensiveDueTotal);

        shiftModalOverallShk.textContent = `${formatNumber(analyzed)} / ${formatNumber(totalDue)}`;
        shiftModalOverallSum.textContent = `${formatCurrency(analyzedSumPrice)} / ${formatCurrency(dueSumPrice)}`;
        shiftModalOverallExpensive.textContent = `${formatNumber(expensiveAnalyzed)} / ${formatNumber(expensiveDueTotal)}`;
        shiftModalOverall.style.display = "";
    }

    function renderShiftModalBreakdownChart(shiftItem) {
        if (!shiftModalBreakdownWrap || !shiftModalBreakdownChartCanvas) return;

        if (shiftBreakdownChart) {
            shiftBreakdownChart.destroy();
            shiftBreakdownChart = null;
        }

        const details = Array.isArray(shiftItem?.details) ? shiftItem.details : [];
        const totalMap = new Map();
        details.forEach((detail) => {
            const statuses = Array.isArray(detail?.breakdownStatuses) ? detail.breakdownStatuses : [];
            statuses.forEach((entry) => {
                const status = normalizeKey(entry?.status);
                const count = toNumber(entry?.count);
                if (!status || count <= 0) return;
                totalMap.set(status, toNumber(totalMap.get(status)) + count);
            });
        });

        const sorted = Array.from(totalMap.entries())
            .map(([status, count]) => ({ status, count }))
            .sort((a, b) => (b.count - a.count) || a.status.localeCompare(b.status, "ru"));

        if (!sorted.length || typeof Chart === "undefined") {
            shiftModalBreakdownWrap.style.display = "none";
            return;
        }

        const labels = sorted.map((entry) => entry.status);
        const values = sorted.map((entry) => entry.count);
        const colors = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#64748b", "#0ea5e9", "#14b8a6"];

        shiftBreakdownChart = new Chart(shiftModalBreakdownChartCanvas, {
            type: "doughnut",
            data: {
                labels,
                datasets: [
                    {
                        data: values,
                        backgroundColor: colors.slice(0, values.length),
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom" },
                    title: {
                        display: true,
                        text: "Статусы разбора за смену"
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const total = values.reduce((sum, val) => sum + val, 0) || 1;
                                const value = toNumber(ctx.parsed);
                                const pct = ((value / total) * 100).toFixed(1);
                                return `${ctx.label}: ${value} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });

        shiftModalBreakdownWrap.style.display = "";
    }

    function openShiftModalById(shiftId) {
        if (!shiftModal) return;

        const target = lastShiftDynamics.find((item) => item.shiftId === shiftId);
        if (!target) return;

        if (shiftModalTitle) {
            shiftModalTitle.textContent = `Детализация: ${target.shiftName} (${target.displayDate})`;
        }
        renderShiftModalOverall(target);
        renderShiftModalBreakdownChart(target);

        const details = Array.isArray(target.details) ? target.details : [];
        if (!details.length) {
            if (shiftModalBreakdownWrap) shiftModalBreakdownWrap.style.display = "none";
            if (shiftModalTableWrap) shiftModalTableWrap.style.display = "none";
            if (shiftModalEmpty) {
                shiftModalEmpty.style.display = "";
                shiftModalEmpty.textContent = "По этой смене данных нет.";
            }
            shiftModal.classList.remove("hidden");
            return;
        }

        renderShiftModalTable(target);
        if (shiftModalTableWrap) shiftModalTableWrap.style.display = "";
        if (shiftModalEmpty) shiftModalEmpty.style.display = "none";
        shiftModal.classList.remove("hidden");
    }

    function bindModalEvents() {
        if (detailModalCloseBtn) {
            detailModalCloseBtn.addEventListener("click", closeDetailsModal);
        }

        if (detailModal) {
            detailModal.addEventListener("click", (event) => {
                if (event.target === detailModal || event.target.classList.contains("modal-backdrop")) {
                    closeDetailsModal();
                }
            });
        }

        if (shiftModalCloseBtn) {
            shiftModalCloseBtn.addEventListener("click", closeShiftModal);
        }

        if (shiftModal) {
            shiftModal.addEventListener("click", (event) => {
                if (event.target === shiftModal || event.target.classList.contains("modal-backdrop")) {
                    closeShiftModal();
                }
            });
        }

        if (calendarModalCloseBtn) {
            calendarModalCloseBtn.addEventListener("click", closeCalendarModal);
        }

        if (calendarModal) {
            calendarModal.addEventListener("click", (event) => {
                if (event.target === calendarModal || event.target.classList.contains("modal-backdrop")) {
                    closeCalendarModal();
                }
            });
        }

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if (shiftModal && !shiftModal.classList.contains("hidden")) {
                closeShiftModal();
                return;
            }
            if (detailModal && !detailModal.classList.contains("hidden")) {
                closeDetailsModal();
                return;
            }
            if (calendarModal && !calendarModal.classList.contains("hidden")) {
                closeCalendarModal();
            }
        });
    }

    async function loadReport() {
        const todayIso = toIsoDate(moscowNowDate());
        const monthPeriod = getMonthPeriodByDate(todayIso);
        const shiftPeriod = {
            from: shiftIsoDate(todayIso, -1) || monthPeriod.from,
            to: monthPeriod.to
        };
        lastPeriod = shiftPeriod;

        setLoading(true);
        setErrors([]);
        setStatus("Загружаю данные (кэш Supabase / Google Apps Script API)...", "");

        try {
            if (!currentApiUrl) {
                await loadWarehouseConfig();
            }

            const monthReportPromise = fetchReportWithCache(monthPeriod, CACHE_SCOPE_DASHBOARD_MONTH).catch((error) => {
                console.warn("Не удалось загрузить месячные итоги:", error instanceof Error ? error.message : error);
                return null;
            });
            const reportPromise = fetchReportWithCache(shiftPeriod, CACHE_SCOPE_DASHBOARD_SHIFT).catch(async (error) => {
                console.warn("Не удалось загрузить scope opp_dashboard_shift, пробую fallback через opp_dashboard_month:", error instanceof Error ? error.message : error);
                const fallbackMonthReport = await monthReportPromise;
                if (fallbackMonthReport) {
                    return fallbackMonthReport;
                }
                throw error;
            });
            const oppPromise = fetchOppRecognizedCountsByShift(shiftPeriod).catch((error) => {
                console.warn("Не удалось загрузить опознания ОПП по сменам:", error instanceof Error ? error.message : error);
                return {};
            });
            const [report, monthReport, oppByShift] = await Promise.all([reportPromise, monthReportPromise, oppPromise]);
            lastRows = report.rows;
            lastSummary = report.summary;
            lastTodayDeadline = report.todayDeadline;
            lastReportGeneratedAtText = report.generatedAtText || "";
            lastShiftDynamics = attachOppCountsToShiftDynamics(
                Array.isArray(report.shiftDynamics) ? report.shiftDynamics : [],
                oppByShift
            );
            lastCurrentShift = findCurrentShiftItem(lastShiftDynamics);
            lastPreviousShift = findPreviousShiftItem(lastShiftDynamics, lastCurrentShift);
            selectedShiftId = lastCurrentShift?.shiftId || "";
            const monthRowsFallback = lastShiftDynamics.filter((item) => {
                const d = parseIsoDate(item?.date);
                return d && d >= monthPeriod.from && d <= monthPeriod.to;
            });
            lastMonthShiftDynamics = Array.isArray(monthReport?.shiftDynamics)
                ? monthReport.shiftDynamics
                : monthRowsFallback;
            lastMonthSummary = buildMonthSummaryFromShiftDynamics(
                lastMonthShiftDynamics,
                monthPeriod
            );
            lastMissingSheets = report.missingSheets;

            renderSummary();
            setStatus("", "");

            if (!lastShiftDynamics.length) {
                toast("По текущему месяцу нет данных по сменам", { type: "info" });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus(`Ошибка загрузки: ${message}`, "error");
            setErrors([
                `Проверьте, что в wh_data_rep есть data_type = ${API_DATA_TYPE}.`,
                `Для дедлайнов используйте data_type = ${DEADLINES_DATA_TYPE}.`,
                "В API-контейнере data должен быть URL Apps Script Web App (/exec)."
            ]);
            summaryWrap.innerHTML = "";
            lastRows = [];
            lastSummary = { totalLoaded: 0, totalAnalyzed: 0 };
            lastMonthSummary = {
                from: "",
                to: "",
                totalDue: 0,
                analyzed: 0,
                dueSumPrice: 0,
                analyzedSumPrice: 0,
                expensiveDueTotal: 0,
                expensiveAnalyzed: 0,
                percentBySum: 0,
                hasData: false
            };
            lastTodayDeadline = null;
            lastShiftDynamics = [];
            lastMonthShiftDynamics = [];
            lastCurrentShift = null;
            lastPreviousShift = null;
            selectedShiftId = "";
            lastReportGeneratedAtText = "";
            lastMissingSheets = [];
            destroyCurrentShiftBreakdownChart();
        } finally {
            setLoading(false);
        }
    }

    function bindEvents() {
        // На dashboard нет полей даты/модалок, обновление происходит при открытии страницы.
    }

    async function init() {
        const user = getUserFromLocalStorage();
        currentWhId = normalizeKey(user?.user_wh_id);

        const userNameEl = document.getElementById("user-name-small");
        if (userNameEl && user) {
            userNameEl.textContent = user.name || user.fio || "";
        }

        bindPageTitleSync();
        bindEvents();

        try {
            await loadWarehouseConfig();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus(`Ошибка источника ${API_DATA_TYPE}: ${message}`, "error");
            setErrors([
                "Нужна запись в wh_data_rep для user_wh_id текущего пользователя.",
                `data_type для API: ${API_DATA_TYPE}.`,
                `data_type для дедлайнов: ${DEADLINES_DATA_TYPE}.`,
                "В API-контейнере укажите apps_script_url/api_url со ссылкой Web App (/exec)."
            ]);
            return;
        }

        await loadReport();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
