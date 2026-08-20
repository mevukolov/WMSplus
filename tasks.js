(function () {
    "use strict";

    const WH_ID = "50144199";
    const RUNS_TABLE = "wms_manual_upload_runs";
    const SETTINGS_TABLE = "wms_manual_upload_settings";
    const SAVE_RPC = "save_wms_manual_upload";
    const TWO_SHK_TABLE = "2shk_rep";
    const RWP_STATUS = "RWP – Ожидает упаковки на столе переупаковки";
    const MAIL_ROUTES = new Set([
        101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,
        201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,
        301,302,303,304,305,306,307,308,309,310,311,312,313,314,315,
        401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,
    ]);
    const PM_BUFFER_STATUSES = new Set(["sms", "swt"]);
    const PRESORT_EXCLUDED_MX_PARTS = ["пред сортировка мп", "сортировка в сетки"];
    const MASTER_MAIN_MODULES = ["pm", "presort", "marketplace_pc", "wmi_mp_pc"];
    const MASTER_PACKAGING_MODULES = ["packaging", "rwp"];
    const MASTER_MODULES = ["pm", "presort", "marketplace_pc", "wmi_mp_pc", "no_order", "packaging", "rwp", "after_sale_movement"];

    const DEFAULT_MODULES = [
        {
            module: "packaging",
            label: "Переупаковка",
            sourceModule: "manual_packaging_opp",
            uploadType: "packaging",
            offsetDays: -7,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // Упаковка",
            taskTypeLabel: "Разбор ОПП // Упаковка",
            column: "Упаковка",
            description: "Контроль зависшего товара и тар на участке \"Переупаковка\".",
            responsibilityZone: "Исходящий поток",
            required: true,
        },
        {
            module: "rwp",
            label: "RWP",
            sourceModule: "manual_rwp_opp",
            uploadType: "rwp",
            offsetDays: -4,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // RWP",
            taskTypeLabel: "Разбор ОПП // RWP",
            column: "RWP",
            description: "Контроль товара, поступившего на стол переупаковки, но не получившего корректной обработки.",
            responsibilityZone: "Исходящий поток",
            required: true,
        },
        {
            module: "pm",
            label: "ПМ / Почта",
            sourceModule: "manual_pm_buffer",
            uploadType: "pm_buffer",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // ПМ",
            taskTypeLabel: "Разбор ОПП // ПМ / Почта",
            column: "ПМ",
            description: "Контроль бессистемно отгруженных тар на буфере последней мили.",
            responsibilityZone: "Исходящий поток",
            required: true,
        },
        {
            module: "presort",
            label: "Предсортировка",
            sourceModule: "manual_presort_opp",
            uploadType: "presort",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // Предсортировка",
            taskTypeLabel: "Разбор ОПП // Предсортировка",
            column: "Предсортировка",
            description: "Контроль товара, зависшего на этапе предсортировки.",
            responsibilityZone: "Исходящий поток",
            required: true,
        },
        {
            module: "marketplace_pc",
            label: "Маркетплейс + ПЦ",
            sourceModule: "manual_marketplace_pc",
            uploadType: "marketplace_pc",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // Маркетплейс / ПЦ",
            taskTypeLabel: "Разбор ОПП // Маркетплейс / ПЦ",
            column: "Маркетплейс / ПЦ",
            description: "Контроль товара, зависшего на участках сортировки для других ЛО.",
            responsibilityZone: "Исходящий поток",
            required: true,
        },
        {
            module: "wmi_mp_pc",
            label: "WMI (МП + ПЦ)",
            sourceModule: "manual_wmi_mp_pc",
            uploadType: "wmi_mp_pc",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // WMI (МП + ПЦ)",
            taskTypeLabel: "WMI (МП + ПЦ)",
            column: "WMI (МП + ПЦ)",
            description: "Контроль ошибок, не получивших корректного движения на участках сортировки для других ЛО.",
            responsibilityZone: "Исходящий поток",
            required: true,
        },
        {
            module: "no_order",
            label: "Без заказа",
            sourceModule: "manual_no_order",
            uploadType: "no_order",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // Без заказа",
            taskTypeLabel: "Разбор ОПП // Без заказа",
            column: "Без заказа",
            description: "Контроль ошибок, возникающих при обработке товаров без активного заказа.",
            responsibilityZone: "Исходящий поток",
            required: true,
        },
        {
            module: "after_sale_movement",
            label: "Движение после продажи",
            sourceModule: "manual_after_sale_movement",
            uploadType: "after_sale_movement",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // Движение после продажи",
            taskTypeLabel: "Разбор ОПП // Движение после продажи",
            column: "Движение после продажи",
            description: "Контроль товара, получившего движение после реализации.",
            responsibilityZone: "Исходящий поток",
            required: true,
        },
        {
            module: "labeling",
            label: "Оклейка",
            sourceModule: "manual_presort_opp",
            uploadType: "presort",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // Оклейка",
            taskTypeLabel: "Разбор ОПП // Оклейка",
            column: "Другие задачи",
            description: "Скрытая ветка предсортировки для LGR.",
            responsibilityZone: "Исходящий поток",
            required: false,
        },
        {
            module: "marketplace",
            label: "Маркетплейс",
            sourceModule: "manual_marketplace_pc",
            uploadType: "marketplace_pc",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // Маркетплейс",
            taskTypeLabel: "Разбор ОПП // Маркетплейс",
            column: "Маркетплейс",
            description: "Внутренняя ветка Маркетплейса.",
            responsibilityZone: "Исходящий поток",
            required: false,
        },
        {
            module: "pc",
            label: "ПЦ",
            sourceModule: "manual_marketplace_pc",
            uploadType: "marketplace_pc",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // ПЦ",
            taskTypeLabel: "Разбор ОПП // ПЦ",
            column: "ПЦ",
            description: "Внутренняя ветка ПЦ.",
            responsibilityZone: "Исходящий поток",
            required: false,
        },
        {
            module: "usd",
            label: "USD",
            sourceModule: "manual_no_order",
            uploadType: "no_order",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // USD",
            taskTypeLabel: "Разбор ОПП // USD",
            column: "Другие задачи",
            description: "Скрытая ветка Без заказа для USD.",
            responsibilityZone: "Исходящий поток",
            required: false,
        },
        {
            module: "tmm",
            label: "TMM",
            sourceModule: "manual_no_order",
            uploadType: "no_order",
            offsetDays: 0,
            taskDeadlineDays: 1,
            taskType: "Разбор ОПП // TMM",
            taskTypeLabel: "Разбор ОПП // TMM",
            column: "Другие задачи",
            description: "Скрытая ветка Без заказа для TMM.",
            responsibilityZone: "Исходящий поток",
            required: false,
        },
    ];

    const VISIBLE_MODULES = ["packaging", "rwp", "pm", "presort", "marketplace_pc", "wmi_mp_pc", "no_order", "after_sale_movement"];
    const MASTER_SLOTS = [
        { key: "main", title: "Товары без движения - В заказе", kind: "pmPrimary", modules: ["pm", "presort", "marketplace_pc", "wmi_mp_pc"] },
        { key: "noOrder", title: "Без заказа", kind: "pmPrimary", modules: ["no_order"] },
        { key: "packaging", title: "Утерянные и обездвиженные товары", kind: "packaging", modules: ["packaging", "rwp"] },
        { key: "afterSale", title: "Движение после продажи", kind: "afterSaleMovement", modules: ["after_sale_movement"] },
        { key: "carrier", title: "Проверить наличие отгрузки", kind: "pmCarrier", modules: ["pm"], optional: true },
    ];

    const state = {
        view: "home",
        today: todayIsoInMoscow(),
        settings: new Map(DEFAULT_MODULES.map((item) => [item.module, { ...item }])),
        runs: [],
        loadingStatus: false,
        calendarRange: null,
        manualDate: "",
        activeModule: "",
        activeDate: "",
        files: {},
        rows: {},
        preview: null,
        specialMap: new Map(),
        master: {
            files: {},
            fileNames: {},
            rows: {},
            preview: null,
            dateRejects: [],
            conditionRejects: [],
        },
    };

    const $ = (id) => document.getElementById(id);

    function normalizeText(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim();
    }

    function normalizeForMatch(value) {
        return normalizeText(value).replace(/[–—−]/g, "-").replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/\s+/g, " ").toLowerCase();
    }

    function normalizeIdentifier(value) {
        if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toFixed(0);
        const raw = normalizeText(value).replace(/\u00a0/g, "").replace(/\s+/g, "");
        if (!raw) return "";
        if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(raw)) {
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) return Math.trunc(parsed).toFixed(0);
        }
        if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, "");
        return raw;
    }

    function isGroupableIdentifier(value) {
        const normalized = normalizeIdentifier(value);
        return Boolean(normalized) && normalized !== "0";
    }

    function normalizePrice(value) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const raw = normalizeText(value).replace(/\u00a0/g, "").replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
        if (!raw) return null;
        const parsed = Number(raw.replace(/\.(?=.*\.)/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
    }

    function excelSerialToDate(value) {
        if (!Number.isFinite(value)) return null;
        const date = new Date(Math.round((value - 25569) * 86400 * 1000));
        return Number.isFinite(date.getTime()) ? date : null;
    }

    function parseDateTime(value) {
        if (typeof value === "number" && Number.isFinite(value)) {
            const date = excelSerialToDate(value);
            if (date) return { date: date.toISOString().slice(0, 10), ts: date.getTime(), iso: date.toISOString(), label: formatRuDate(date.toISOString().slice(0, 10)) };
        }
        const raw = normalizeText(value);
        if (!raw) return { date: "", ts: 0, iso: "", label: "" };
        let match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/);
        if (match) {
            const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)));
            return { date: date.toISOString().slice(0, 10), ts: date.getTime(), iso: date.toISOString(), label: formatRuDate(date.toISOString().slice(0, 10)) };
        }
        match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (match) {
            let year = Number(match[3]);
            if (year < 100) year += 2000;
            const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)));
            return { date: date.toISOString().slice(0, 10), ts: date.getTime(), iso: date.toISOString(), label: formatRuDate(date.toISOString().slice(0, 10)) };
        }
        const parsed = new Date(raw.replace(" ", "T"));
        return Number.isFinite(parsed.getTime())
            ? { date: parsed.toISOString().slice(0, 10), ts: parsed.getTime(), iso: parsed.toISOString(), label: formatRuDate(parsed.toISOString().slice(0, 10)) }
            : { date: raw, ts: 0, iso: "", label: raw };
    }

    function todayIsoInMoscow() {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
        const byType = {};
        parts.forEach((part) => { byType[part.type] = part.value; });
        return byType.year + "-" + byType.month + "-" + byType.day;
    }

    function nowLabelMoscow() {
        return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date());
    }

    function addDays(isoDate, days) {
        if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "";
        const date = new Date(isoDate + "T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + Number(days || 0));
        return date.toISOString().slice(0, 10);
    }

    function formatRuDate(isoDate) {
        const match = normalizeText(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return match ? match[3] + "." + match[2] + "." + match[1] : isoDate || "-";
    }

    function formatMoney(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
        return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value)) + " ₽";
    }

    function escapeHtml(value) {
        return normalizeText(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function toast(message, type) {
        if (window.MiniUI && typeof window.MiniUI.toast === "function") window.MiniUI.toast(message, { type: type || "info" });
        else console.log(message);
    }

    function supabaseDb() {
        return window.supabaseClient || supabaseClient;
    }

    function moduleDef(module) {
        return state.settings.get(module) || DEFAULT_MODULES.find((item) => item.module === module) || DEFAULT_MODULES[0];
    }

    function uploadDateForModule(module) {
        const def = moduleDef(module);
        return state.manualDate || addDays(state.today, Number(def.offsetDays || 0));
    }

    function plannedUploadDateForBusinessDate(module, businessDate) {
        const def = moduleDef(module);
        return addDays(businessDate, -(Number(def.offsetDays || 0) || 0));
    }

    function dueDateForBusinessDate(module, businessDate) {
        const def = moduleDef(module);
        return addDays(plannedUploadDateForBusinessDate(module, businessDate), Number(def.taskDeadlineDays || 1));
    }

    function startOfWeekMonday(isoDate) {
        const date = new Date((isoDate || state.today) + "T00:00:00Z");
        const day = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() - day + 1);
        return date.toISOString().slice(0, 10);
    }

    function buildCalendarRange() {
        const monday = startOfWeekMonday(state.today);
        return { start: addDays(monday, -28), end: addDays(monday, 13) };
    }

    function datesBetween(startDate, endDate) {
        const result = [];
        let current = startDate;
        while (current && current <= endDate) {
            result.push(current);
            current = addDays(current, 1);
        }
        return result;
    }

    function uploadTypeForModule(module) {
        return moduleDef(module).uploadType || module;
    }

    function runForUpload(module, isoDate) {
        const date = isoDate || uploadDateForModule(module);
        const type = uploadTypeForModule(module);
        return state.runs.find((run) => normalizeText(run.effective_date || run.business_date || run.upload_date) === date && normalizeText(run.upload_type || run.source_module) === type) || null;
    }

    function visibleDefs() {
        return VISIBLE_MODULES.map(moduleDef);
    }

    function requiredVisibleDefs() {
        return visibleDefs().filter((def) => def.required !== false);
    }

    function dayStatusClass(doneCount) {
        const required = Math.max(requiredVisibleDefs().length || 1, 1);
        if (doneCount <= 0) return "status-gray";
        if (doneCount >= required) return "status-green";
        if (doneCount >= required / 2) return "status-yellow";
        return "status-red";
    }

    function calendarTooltipHtml(isoDate) {
        const missing = [];
        const done = [];
        requiredVisibleDefs().forEach((def) => {
            if (runForUpload(def.module, isoDate)) done.push(def.label);
            else missing.push(def.label);
        });
        const lines = missing.map((label) => "<span class='tooltip-line missing'><span class='tooltip-dot'></span>" + escapeHtml(label) + "</span>")
            .concat(done.map((label) => "<span class='tooltip-line done'><span class='tooltip-dot'></span>" + escapeHtml(label) + "</span>"))
            .join("");
        return "<span class='calendar-tooltip'><span class='tooltip-title'>" + formatRuDate(isoDate) + "</span>" + lines + "</span>";
    }

    function renderCalendar() {
        const range = state.calendarRange || buildCalendarRange();
        state.calendarRange = range;
        const required = requiredVisibleDefs();
        const html = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => "<div class='weekday'>" + day + "</div>").join("")
            + datesBetween(range.start, range.end).map((isoDate) => {
                const doneCount = required.filter((def) => runForUpload(def.module, isoDate)).length;
                return "<button type='button' class='calendar-day " + dayStatusClass(doneCount) + "'>"
                    + "<span class='day-number'>" + Number(isoDate.slice(8, 10)) + "</span>"
                    + "<span class='day-progress'>" + doneCount + "/" + required.length + "</span>"
                    + calendarTooltipHtml(isoDate)
                    + "</button>";
            }).join("");
        $("calendarGrid").innerHTML = html;
    }

    function setStatus(message, type) {
        const el = $("workStatus");
        el.textContent = message || "";
        el.className = "status-line" + (type ? " " + type : "");
    }

    function setMasterStatus(message, type) {
        const el = $("masterStatus");
        el.textContent = message || "";
        el.className = "status-line" + (type ? " " + type : "");
    }

    function showHome() {
        state.view = "home";
        $("tasksHome").style.display = "grid";
        $("uploadsPage").classList.remove("active");
        $("moduleChooser").classList.remove("active");
        $("uploadWork").classList.remove("active");
        $("masterWork").classList.remove("active");
    }

    async function showUploads() {
        state.view = "uploads";
        $("tasksHome").style.display = "none";
        $("uploadsPage").classList.add("active");
        $("uploadsStatus").textContent = "Загружаю журнал и настройки...";
        const ok = await loadUploadMeta();
        if (ok) $("uploadsStatus").textContent = "Готово. Задачи сохраняются в WMS+ Supabase.";
    }

    function openReviewModal() {
        $("reviewModal").classList.add("visible");
        $("reviewModal").setAttribute("aria-hidden", "false");
    }

    function closeReviewModal() {
        $("reviewModal").classList.remove("visible");
        $("reviewModal").setAttribute("aria-hidden", "true");
    }

    async function loadUploadMeta() {
        state.loadingStatus = true;
        renderModuleChooser();
        const db = supabaseDb();
        if (!db) {
            $("uploadsStatus").textContent = "Supabase SDK не загрузился.";
            state.loadingStatus = false;
            return false;
        }
        try {
            const settingsResult = await db.from(SETTINGS_TABLE).select("*").order("sort_order", { ascending: true });
            if (!settingsResult.error && Array.isArray(settingsResult.data)) applySettings(settingsResult.data);
            const range = state.calendarRange || buildCalendarRange();
            const runsResult = await db.from(RUNS_TABLE).select("*").gte("effective_date", range.start).lte("effective_date", range.end).order("effective_date", { ascending: false });
            if (runsResult.error) throw runsResult.error;
            state.runs = Array.isArray(runsResult.data) ? runsResult.data : [];
        } catch (error) {
            $("uploadsStatus").textContent = "Не удалось проверить журнал. Если это первый запуск, примени миграцию WMS tables. " + (error && error.message ? error.message : String(error));
            return false;
        } finally {
            state.loadingStatus = false;
            renderCalendar();
            renderModuleChooser();
        }
        return true;
    }

    function applySettings(rows) {
        rows.forEach((row) => {
            const current = moduleDef(row.module);
            state.settings.set(row.module, {
                ...current,
                module: row.module,
                label: normalizeText(row.label) || current.label,
                sourceModule: normalizeText(row.source_module) || current.sourceModule,
                uploadType: normalizeText(row.upload_type) || current.uploadType,
                offsetDays: Number.isFinite(Number(row.upload_offset_days)) ? Number(row.upload_offset_days) : current.offsetDays,
                taskDeadlineDays: Number.isFinite(Number(row.task_deadline_days)) ? Number(row.task_deadline_days) : current.taskDeadlineDays,
                required: row.is_required !== false,
                responsibilityZone: normalizeText(row.responsibility_zone) || current.responsibilityZone,
                description: normalizeText(row.description) || current.description,
                sortOrder: Number(row.sort_order) || current.sortOrder || 100,
            });
        });
    }

    function renderModuleChooser() {
        $("chooserDateText").textContent = state.manualDate ? "Ручная догрузка за " + formatRuDate(state.manualDate) : "Плановые даты на сегодня.";
        $("moduleGrid").innerHTML = visibleDefs().map((def) => {
            const run = runForUpload(def.module, uploadDateForModule(def.module));
            const cls = state.loadingStatus ? " loading" : run ? " done" : " missing";
            const badge = state.loadingStatus ? "Проверяю" : run ? "Есть" : "Нет";
            return "<button type='button' class='module-card" + cls + "' data-module='" + escapeHtml(def.module) + "' " + (state.loadingStatus ? "disabled" : "") + ">"
                + "<p class='module-name'><span>" + escapeHtml(def.label) + "</span><span>" + badge + "</span></p>"
                + "<div class='module-date'>За " + formatRuDate(uploadDateForModule(def.module)) + "</div>"
                + "<p class='module-desc'>" + escapeHtml(def.description) + "</p>"
                + "</button>";
        }).join("");
        $("moduleGrid").querySelectorAll("[data-module]").forEach((button) => {
            button.addEventListener("click", () => chooseModule(button.dataset.module));
        });
    }

    function openChooser(manualDate) {
        state.manualDate = manualDate || "";
        $("moduleChooser").classList.add("active");
        $("uploadWork").classList.remove("active");
        $("masterWork").classList.remove("active");
        renderModuleChooser();
    }

    function openBackfillChooser() {
        const date = window.prompt("За какую дату сделать ручную догрузку? Формат ДД.ММ.ГГГГ или ГГГГ-ММ-ДД", addDays(state.today, -1));
        if (!date) return;
        const parsed = parseDateTime(date).date;
        if (!parsed || parsed > state.today) {
            toast("Можно выбрать только прошлую или сегодняшнюю дату.", "error");
            return;
        }
        openChooser(parsed);
    }

    function chooseModule(module) {
        state.activeModule = module;
        state.activeDate = uploadDateForModule(module);
        state.preview = null;
        state.rows = {};
        state.files = {};
        $("moduleChooser").classList.remove("active");
        $("masterWork").classList.remove("active");
        $("uploadWork").classList.add("active");
        renderWorkShell(module);
    }

    function renderWorkShell(module) {
        const def = moduleDef(module);
        $("workTitle").textContent = def.label;
        $("workSubtitle").textContent = "Выгрузка за " + formatRuDate(state.activeDate) + ". Дедлайн задач: " + formatRuDate(dueDateForBusinessDate(module === "pm" ? "pm" : module, state.activeDate)) + ".";
        $("workInstruction").innerHTML = instructionHtml(module, state.activeDate);
        $("doneBox").classList.remove("visible");
        $("saveUpload").disabled = true;
        renderPreview(null);
        renderFileControls(module);
        const existing = runForUpload(module, state.activeDate);
        if (existing) setStatus("Выгрузка за эту дату уже есть. Можно выгрузить повторно, запись и задачи будут обновлены без дублей.", "good");
        else setStatus("Выберите файл для расчета.");
    }

    function instructionHtml(module, date) {
        if (module === "packaging" || module === "rwp") {
            const title = module === "rwp" ? "Выгрузить RWP" : "Выгрузить зависший товар";
            return "<strong>" + title + "</strong>"
                + "<ol>"
                + "<li>Откройте отчет <a href='https://reports.wbwh.tech/reports/lost-and-non-movable-goods' target='_blank' rel='noopener'>Утерянные и обездвиженные товары</a>.</li>"
                + "<li>Укажите склад \"СЦ Нижний Новгород Ларина\".</li>"
                + "<li>Укажите дату " + formatRuDate(date) + ".</li>"
                + "<li>Откройте вкладку \"Обездвижено\" и выгрузите XLSX.</li>"
                + "<li>Без изменений загрузите файл ниже.</li>"
                + "</ol>";
        }
        if (module === "pm") {
            return "<strong>Выгрузить ПМ / Почту</strong><ol><li>Загрузите основной файл \"Товары без движения - В заказе\".</li><li>Нажмите \"Скопировать номера передач\".</li><li>Проверьте наличие отгрузки и загрузите второй файл или нажмите \"Пропустить второй файл\".</li></ol>";
        }
        if (module === "no_order") return "<strong>Выгрузить Без заказа</strong><ol><li>Загрузите отдельную таблицу Без заказа.</li><li>WMS+ возьмет строки за " + formatRuDate(date) + " и сохранит задачи.</li></ol>";
        if (module === "after_sale_movement") return "<strong>Выгрузить Движение после продажи</strong><ol><li>Загрузите отдельную таблицу.</li><li>WMS+ возьмет строки за " + formatRuDate(date) + " по дате статуса.</li></ol>";
        return "<strong>Выгрузить " + escapeHtml(moduleDef(module).label) + "</strong><ol><li>Загрузите основной файл \"Товары без движения - В заказе\".</li><li>WMS+ сам применит фильтры за " + formatRuDate(date) + ".</li></ol>";
    }

    function renderFileControls(module) {
        if (module === "pm") {
            $("fileControls").innerHTML = fileInputHtml("primary", "Выбрать основной XLSX")
                + fileInputHtml("carrier", "Выбрать проверку отгрузки", true)
                + "<button id='copyTransfers' class='btn btn-outline' type='button' disabled>Скопировать номера передач</button>"
                + "<button id='skipCarrier' class='btn btn-outline' type='button' disabled>Пропустить второй файл</button>"
                + "<span id='fileName' class='file-name'>Файлы пока не выбраны</span>";
            bindFileInput("primary", (file) => handleSingleFile(module, file, "pmPrimary"));
            bindFileInput("carrier", (file) => handleCarrierFile(file));
            $("copyTransfers").addEventListener("click", copyActiveTransfers);
            $("skipCarrier").addEventListener("click", skipCarrierFile);
            return;
        }
        $("fileControls").innerHTML = fileInputHtml("primary", "Выбрать файл") + "<span id='fileName' class='file-name'>Файл пока не выбран</span>";
        const kind = module === "packaging" || module === "rwp" ? "packaging" : module === "after_sale_movement" ? "afterSaleMovement" : "pmPrimary";
        bindFileInput("primary", (file) => handleSingleFile(module, file, kind));
    }

    function fileInputHtml(key, label, hidden) {
        return "<label class='btn btn-rect' for='file-" + key + "'" + (hidden ? " id='carrierLabel' style='display:none'" : "") + ">" + label + "</label>"
            + "<input id='file-" + key + "' class='file-input' type='file' accept='.xlsx,.xls,.csv'>";
    }

    function bindFileInput(key, handler) {
        const input = $("file-" + key);
        input.addEventListener("change", () => {
            const file = input.files && input.files[0];
            if (file) handler(file).catch((error) => setStatus(error && error.message ? error.message : String(error), "error"));
        });
    }

    async function readWorkbookRows(file, kind) {
        if (typeof window.XLSX === "undefined") throw new Error("Не загрузилась библиотека XLSX. Обновите страницу и попробуйте еще раз.");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("В файле не найдено листов.");
        const sheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
        const headerIndex = findHeaderIndex(rows, kind);
        return rows.slice(headerIndex + 1).map((row, index) => normalizeRowByKind(row, headerIndex + index + 2, kind)).filter(Boolean);
    }

    function findHeaderIndex(rows, kind) {
        const markersByKind = {
            packaging: ["id товара", "стоимость", "id тары"],
            pmPrimary: ["передача", "товар", "статус товара"],
            pmCarrier: ["тара", "мх"],
            afterSaleMovement: ["товар", "дата статуса", "статус после реализации"],
        };
        const markers = markersByKind[kind] || [];
        const max = Math.min(rows.length, 30);
        for (let i = 0; i < max; i += 1) {
            const line = rows[i].map(normalizeText).join(" ").toLowerCase();
            if (markers.every((marker) => line.includes(marker))) return i;
        }
        return 0;
    }

    function normalizeRowByKind(row, rowNumber, kind) {
        if (kind === "packaging") return normalizePackagingRow(row, rowNumber);
        if (kind === "afterSaleMovement") return normalizeAfterSaleMovementRow(row, rowNumber);
        if (kind === "pmCarrier") return normalizePmCarrierRow(row, rowNumber);
        return normalizePmPrimaryRow(row, rowNumber);
    }

    function normalizePackagingRow(row, rowNumber) {
        const shk = normalizeIdentifier(row[2]);
        if (!shk) return null;
        return {
            row_number: rowNumber,
            warehouse: normalizeText(row[0]),
            block: normalizeText(row[1]),
            shk,
            price: normalizePrice(row[3]),
            tare_id: normalizeIdentifier(row[4]),
            supplier_id: normalizeIdentifier(row[5]),
            receiver_id: normalizeIdentifier(row[6]),
            last_status: normalizeText(row[7]),
            last_movement: normalizeText(row[8]),
        };
    }

    function normalizePmPrimaryRow(row, rowNumber) {
        const transfer = normalizeIdentifier(row[1]);
        const product = normalizeIdentifier(row[2]);
        if (!transfer || !product) return null;
        return {
            row_number: rowNumber,
            corrugated: normalizeIdentifier(row[0]),
            transfer,
            product,
            product_status: normalizeText(row[3]),
            name: normalizeText(row[4]),
            brand: normalizeText(row[5]),
            supplier: normalizeText(row[6]),
            price: normalizePrice(row[7]),
            mx: normalizeText(row[8]),
            previous_mx: normalizeText(row[9]),
            created_at: normalizeText(row[10]),
            previous_mx_date: normalizeText(row[11]),
            responsible: normalizeText(row[12]),
            responsible_id: normalizeIdentifier(row[13]),
            shipment_block: normalizeText(row[14]),
        };
    }

    function normalizePmCarrierRow(row, rowNumber) {
        const transfer = normalizeIdentifier(row[1]);
        if (!transfer) return null;
        return { row_number: rowNumber, transfer, office: normalizeText(row[2]), time: normalizeText(row[3]), mx: normalizeText(row[4]), employee: normalizeText(row[5]), carrier: normalizeText(row[6]) };
    }

    function normalizeAfterSaleMovementRow(row, rowNumber) {
        const product = normalizeIdentifier(row[2]);
        if (!product) return null;
        return { row_number: rowNumber, office: normalizeText(row[0]), block: normalizeText(row[1]), product, realized_at: normalizeText(row[3]), status_id: normalizeIdentifier(row[4]), status: normalizeText(row[5]), status_at: normalizeText(row[6]), mx: normalizeText(row[7]), tare: normalizeIdentifier(row[8]), employee_id: normalizeIdentifier(row[9]), employee: normalizeText(row[10]) };
    }

    function isRwpStatus(value) { return normalizeForMatch(value) === normalizeForMatch(RWP_STATUS); }
    function isPmBufferStatus(value) { return PM_BUFFER_STATUSES.has(normalizeForMatch(value)); }
    function mxHasPresortExclusion(mx) { const normalized = normalizeForMatch(mx); return PRESORT_EXCLUDED_MX_PARTS.some((part) => normalized.includes(part)); }
    function mxIncludes(row, part) { return normalizeForMatch(row && row.mx).includes(normalizeForMatch(part)); }
    function mxHasBuffer(row) { return normalizeForMatch(row && row.mx).includes("буфер"); }
    function isPresortStatus(row) {
        const status = normalizeForMatch(row && row.product_status);
        if (status === "sps") return true;
        if (status === "pwt") return !mxHasPresortExclusion(row && row.mx);
        if ((status === "gws" || status === "wmi") && !mxHasPresortExclusion(row && row.mx)) return true;
        return false;
    }
    function isLabelingStatus(row) { return normalizeForMatch(row && row.product_status) === "lgr"; }
    function isMarketplaceStatus(row) {
        const status = normalizeForMatch(row && row.product_status);
        if (status === "pap") return true;
        return (status === "gws" || status === "pwt") && mxIncludes(row, "Пред сортировка МП");
    }
    function isPcStatus(row) {
        const status = normalizeForMatch(row && row.product_status);
        if (status === "smc") return true;
        return (status === "gws" || status === "pwt") && mxIncludes(row, "Сортировка в сетки");
    }
    function isWmiMpPcStatus(row) {
        const status = normalizeForMatch(row && row.product_status);
        return status === "wmi" && (mxIncludes(row, "Пред сортировка МП") || mxIncludes(row, "Сортировка в сетки"));
    }
    function isNoOrderUsdStatus(row) { return normalizeForMatch(row && row.product_status) === "usd"; }
    function isNoOrderTmmStatus(row) { return normalizeForMatch(row && row.product_status) === "tmm"; }
    function isMultiShipmentBufferMx(value) { return normalizeForMatch(value).includes("буфер мультиотгрузки"); }
    function isGateMx(value) { return normalizeForMatch(value).includes("ворота"); }

    function routeNumberFromMx(mx) {
        const matches = normalizeText(mx).match(/\d{1,3}/g);
        if (!matches || !matches.length) return null;
        const value = Number(matches[matches.length - 1]);
        return Number.isFinite(value) ? value : null;
    }

    function isMailRoute(routeNumber) { return routeNumber !== null && MAIL_ROUTES.has(routeNumber); }

    function taskPriority(price, forceHigh) {
        if (forceHigh) return { value: 2, label: "Высокий" };
        const value = Number(price || 0);
        if (!Number.isFinite(value) || value < 500) return { value: null, label: "Без приоритета" };
        if (value < 1000) return { value: 3, label: "Замороженный" };
        if (value < 5000) return { value: 0, label: "Низкий" };
        if (value < 10000) return { value: 1, label: "Средний" };
        return { value: 2, label: "Высокий" };
    }

    function titleLimit(value) {
        const text = normalizeText(value);
        return text.length > 180 ? text.slice(0, 177) + "..." : text;
    }

    function rowsPrice(rows, field) {
        return Math.round((rows || []).reduce((acc, row) => acc + (Number(row[field] || row.price) || 0), 0) * 100) / 100;
    }

    function productIdsFromRows(rows) {
        return (rows || []).map((row) => row.product || row.shk).map(normalizeIdentifier).filter(Boolean);
    }

    function sourceRowId(rows) {
        const ids = (rows || []).map((row) => row.row_number).filter(Boolean);
        if (!ids.length) return "";
        const sample = ids.slice(0, 80).join(",");
        return ids.length > 80 ? sample + ",+" + (ids.length - 80) : sample;
    }

    function sourceLastMovement(rows) {
        const dates = (rows || []).map((row) => parseDateTime(row.last_movement || row.created_at || row.status_at).iso).filter(Boolean).sort();
        return dates[dates.length - 1] || "";
    }

    function descriptionLines(taskTypeLabel, infoLines, specialInfos) {
        const lines = [];
        (specialInfos || []).forEach((info) => {
            lines.push(info.tag_name);
            lines.push("ШК: " + (info.matched_shk || "-"));
            lines.push("Второй ШК: " + (info.second_shk || "-"));
            if (info.media) lines.push("Ссылка: " + info.media);
            lines.push("");
        });
        lines.push("Тип задания: " + taskTypeLabel);
        lines.push("Дата создания задания: " + nowLabelMoscow());
        lines.push("");
        lines.push("-------------------------");
        lines.push("Инфо по заданию:");
        return lines.concat(infoLines || []).join("\n");
    }

    function specialTagName(eventType) {
        const normalized = normalizeForMatch(eventType);
        const compact = normalized.replace(/\s+/g, "");
        if (normalized.includes("пуст")) return "Пустая упаковка";
        if (normalized.includes("два") || compact.includes("2шк") || normalized === "2") return "Два ШК";
        return "";
    }

    function specialInfoFromRow(row, matchedShk) {
        const tagName = specialTagName(row.eventtype);
        if (!tagName) return null;
        const shk1 = normalizeIdentifier(row.shk1);
        const shk2 = normalizeIdentifier(row.shk2);
        return { tag_name: tagName, matched_shk: matchedShk, second_shk: matchedShk === shk1 ? shk2 : matchedShk === shk2 ? shk1 : (shk2 || shk1), media: normalizeText(row.media) };
    }

    async function loadSpecialMap(productIdsRaw) {
        const db = supabaseDb();
        const productIds = Array.from(new Set((productIdsRaw || []).map(normalizeIdentifier).filter(Boolean)));
        const result = new Map();
        if (!db || !productIds.length) return result;
        const productSet = new Set(productIds);
        const chunks = [];
        for (let i = 0; i < productIds.length; i += 100) chunks.push(productIds.slice(i, i + 100));
        const applyRows = (rows) => {
            (rows || []).forEach((row) => {
                [normalizeIdentifier(row.shk1), normalizeIdentifier(row.shk2)].filter(Boolean).forEach((candidate) => {
                    if (!productSet.has(candidate) || result.has(candidate)) return;
                    const info = specialInfoFromRow(row, candidate);
                    if (info) result.set(candidate, info);
                });
            });
        };
        try {
            for (const chunk of chunks) {
                let q1 = db.from(TWO_SHK_TABLE).select("shk1,shk2,eventtype,media,wh_id,created_at").in("shk1", chunk).order("created_at", { ascending: false });
                let q2 = db.from(TWO_SHK_TABLE).select("shk1,shk2,eventtype,media,wh_id,created_at").in("shk2", chunk).order("created_at", { ascending: false });
                if (WH_ID) { q1 = q1.eq("wh_id", WH_ID); q2 = q2.eq("wh_id", WH_ID); }
                const [r1, r2] = await Promise.all([q1, q2]);
                if (!r1.error) applyRows(r1.data);
                if (!r2.error) applyRows(r2.data);
            }
        } catch (_error) {
            return result;
        }
        return result;
    }

    function specialInfosForIds(ids, specialMap) {
        const result = [];
        const seen = new Set();
        (ids || []).forEach((id) => {
            const info = specialMap && specialMap.get(normalizeIdentifier(id));
            if (!info) return;
            const key = info.tag_name + "|" + info.matched_shk + "|" + info.second_shk + "|" + info.media;
            if (seen.has(key)) return;
            seen.add(key);
            result.push(info);
        });
        return result;
    }

    function mergeTags(baseTags, specialInfos) {
        const result = Array.from(new Set((baseTags || []).map(normalizeText).filter(Boolean)));
        (specialInfos || []).forEach((info) => {
            if (!result.includes(info.tag_name)) result.push(info.tag_name);
        });
        return result;
    }

    function taskRecord(options) {
        const priority = taskPriority(options.price, options.forceHighPriority);
        const sourceIds = (options.productIds || []).map(normalizeIdentifier).filter(Boolean);
        const specialInfos = specialInfosForIds(sourceIds, options.specialMap);
        const tags = mergeTags(options.tags || [], specialInfos);
        return {
            module: options.module,
            source_module: options.sourceModule,
            source_table: options.sourceTable || "manual_xlsx",
            source_id: options.sourceId,
            source_row_id: sourceRowId(options.rows),
            source_payload: options.payload || {},
            source_generated_at: new Date().toISOString(),
            source_shk_ids: sourceIds,
            source_tare_id: options.tareId || "",
            source_price_sum: options.price || 0,
            source_last_movement_at: sourceLastMovement(options.rows),
            search_text: [options.title, options.taskType, options.column, options.tareId, ...sourceIds].filter(Boolean).join(" "),
            upload_type: options.uploadType,
            upload_effective_date: options.businessDate,
            task_type: options.taskType,
            title: titleLimit(options.title),
            description: descriptionLines(options.descriptionTaskType || options.taskType, options.infoLines || [], specialInfos),
            priority: priority.value,
            priority_label: priority.label,
            due_date: options.dueDate,
            responsibility_zone: options.responsibilityZone || "Нет привязки",
            task_status: "Не начато",
            opp_verdict: "Не выбран",
            tags,
            column: options.column,
        };
    }

    function splitSpecialRows(rows, specialMap, productField) {
        const regular = [];
        const special = [];
        (rows || []).forEach((row) => {
            const id = normalizeIdentifier(row[productField]);
            if (id && specialMap && specialMap.has(id)) special.push(row);
            else regular.push(row);
        });
        return { regular, special };
    }

    function newestRow(rows, field) {
        return (rows || []).slice().sort((a, b) => parseDateTime(b[field]).ts - parseDateTime(a[field]).ts)[0] || rows[0];
    }

    function buildPackagingPreview(rows, module, businessDate, specialMap) {
        const isRwp = module === "rwp";
        const def = moduleDef(module);
        const statusRows = rows.filter((row) => isRwp ? isRwpStatus(row.last_status) : !isRwpStatus(row.last_status));
        const dateRows = statusRows.filter((row) => parseDateTime(row.last_movement).date === businessDate);
        const byShk = new Map();
        let duplicateShkCount = 0;
        dateRows.forEach((row) => {
            const previous = byShk.get(row.shk);
            if (previous) {
                duplicateShkCount += 1;
                if (parseDateTime(row.last_movement).ts >= parseDateTime(previous.last_movement).ts) byShk.set(row.shk, row);
            } else byShk.set(row.shk, row);
        });
        const uniqueRows = Array.from(byShk.values());
        const split = splitSpecialRows(uniqueRows, specialMap, "shk");
        const byTare = new Map();
        const singles = [];
        split.regular.forEach((row) => {
            if (isRwp || !isGroupableIdentifier(row.tare_id)) { singles.push(row); return; }
            const group = byTare.get(row.tare_id) || [];
            group.push(row);
            byTare.set(row.tare_id, group);
        });
        const tasks = [];
        let groupedTareCount = 0;
        let skippedCheap = 0;
        const dueDate = dueDateForBusinessDate(module, businessDate);
        byTare.forEach((group, tareId) => {
            if (group.length > 1) {
                groupedTareCount += 1;
                const sorted = group.slice().sort((a, b) => a.shk.localeCompare(b.shk, "ru"));
                const price = rowsPrice(sorted, "price");
                const status = newestRow(sorted, "last_movement").last_status || "-";
                tasks.push(taskRecord({
                    module,
                    sourceModule: def.sourceModule,
                    uploadType: def.uploadType,
                    businessDate,
                    sourceId: "tare:" + tareId + "|" + businessDate,
                    title: "Упаковка | Тара " + tareId,
                    taskType: def.taskType,
                    descriptionTaskType: def.taskTypeLabel,
                    column: def.column,
                    dueDate,
                    responsibilityZone: def.responsibilityZone,
                    productIds: sorted.map((item) => item.shk),
                    rows: sorted,
                    tareId,
                    price,
                    specialMap,
                    payload: { entity_type: "tare", tare_id: tareId, rows: sorted.slice(0, 40) },
                    infoLines: ["ШК в таре:", ...sorted.map((item) => "- " + item.shk + " / " + formatMoney(item.price)), "Статус крайнего движения: " + status],
                }));
            } else singles.push(group[0]);
        });
        singles.concat(split.special).forEach((row) => {
            const price = Number(row.price) || 0;
            if (!isRwp && !specialMap.has(row.shk) && price < 1000) { skippedCheap += 1; return; }
            tasks.push(taskRecord({
                module,
                sourceModule: def.sourceModule,
                uploadType: def.uploadType,
                businessDate,
                sourceId: (isRwp ? "rwp:" : "shk:") + row.shk + "|" + businessDate,
                title: (isRwp ? "RWP | " : "Упаковка | ") + row.shk,
                taskType: def.taskType,
                descriptionTaskType: def.taskTypeLabel,
                column: def.column,
                dueDate,
                responsibilityZone: def.responsibilityZone,
                productIds: [row.shk],
                rows: [row],
                tareId: row.tare_id,
                price: row.price,
                specialMap,
                payload: { entity_type: specialMap.has(row.shk) ? "special_shk" : "shk", row },
                infoLines: ["Искомый ШК: " + row.shk, "Тара: " + (row.tare_id || "-"), "Статус крайнего движения: " + (row.last_status || "-"), "Время крайнего движения: " + (row.last_movement || "-")],
            }));
        });
        return { mode: module, sourceRows: rows.length, rowsCount: uniqueRows.length, dateFilteredOut: statusRows.length - dateRows.length, duplicateShkCount, groupedTareCount, skippedCheap, specialCount: split.special.length, tasks };
    }

    function sortRowsByCreatedAt(rows) {
        return rows.slice().sort((a, b) => {
            const aTs = parseDateTime(a.created_at).ts || 0;
            const bTs = parseDateTime(b.created_at).ts || 0;
            if (aTs !== bTs) return aTs - bTs;
            return (a.row_number || 0) - (b.row_number || 0);
        });
    }

    function appendGroupedTasks(rows, options) {
        const tasks = [];
        const split = splitSpecialRows(rows, options.specialMap, "product");
        const byTare = new Map();
        const singles = [];
        let groupedTareCount = 0;
        split.regular.forEach((row) => {
            if (!isGroupableIdentifier(row.transfer)) { singles.push(row); return; }
            const group = byTare.get(row.transfer) || [];
            group.push(row);
            byTare.set(row.transfer, group);
        });
        byTare.forEach((group, transfer) => {
            if (group.length > 1 || options.forceTareGrouping) {
                groupedTareCount += 1;
                const sorted = sortRowsByCreatedAt(group);
                const price = rowsPrice(sorted, "price");
                tasks.push(taskRecord({
                    module: options.module,
                    sourceModule: options.sourceModule,
                    uploadType: options.uploadType,
                    businessDate: options.businessDate,
                    sourceId: options.sourcePrefix + ":tare:" + transfer + "|" + options.businessDate,
                    title: options.titlePrefix + " | Тара " + transfer,
                    taskType: options.taskType,
                    descriptionTaskType: options.descriptionTaskType || options.taskType,
                    column: options.column,
                    dueDate: options.dueDate,
                    responsibilityZone: options.responsibilityZone,
                    productIds: sorted.map((row) => row.product),
                    rows: sorted,
                    tareId: transfer,
                    price,
                    forceHighPriority: options.forceHighPriority,
                    tags: options.tags,
                    specialMap: options.specialMap,
                    payload: { entity_type: "tare", tare_id: transfer, rows: sorted.slice(0, 40) },
                    infoLines: ["ШК в таре:", ...sorted.map((row) => "- " + row.product + " / " + (row.product_status || "-") + " / " + formatMoney(row.price)), "Статус крайнего движения: " + (sorted[0].product_status || "-")],
                }));
            } else singles.push(group[0]);
        });
        singles.concat(split.special).forEach((row) => {
            tasks.push(taskRecord({
                module: options.module,
                sourceModule: options.sourceModule,
                uploadType: options.uploadType,
                businessDate: options.businessDate,
                sourceId: options.sourcePrefix + ":shk:" + row.product + "|" + options.businessDate,
                title: options.titlePrefix + " | " + row.product,
                taskType: options.taskType,
                descriptionTaskType: options.descriptionTaskType || options.taskType,
                column: options.column,
                dueDate: options.dueDate,
                responsibilityZone: options.responsibilityZone,
                productIds: [row.product],
                rows: [row],
                tareId: row.transfer,
                price: row.price,
                forceHighPriority: options.forceHighPriority,
                tags: options.tags,
                specialMap: options.specialMap,
                payload: { entity_type: options.specialMap.has(row.product) ? "special_shk" : "shk", row },
                infoLines: ["Искомый ШК: " + row.product, "Тара: " + (row.transfer || "-"), "Блок/МХ: " + (row.mx || "-"), "Статус крайнего движения: " + (row.product_status || "-")],
            }));
        });
        return { tasks, groupedTareCount, singleCount: singles.length + split.special.length, specialCount: split.special.length };
    }

    function buildPmPreview(sourceRows, carrierRows, businessDate, specialMap) {
        const def = moduleDef("pm");
        const dueDate = dueDateForBusinessDate("pm", businessDate);
        const dateRows = sourceRows.filter((row) => parseDateTime(row.created_at).date === businessDate);
        const smsRows = dateRows.filter((row) => isPmBufferStatus(row.product_status));
        const transferIds = Array.from(new Set(smsRows.map((row) => row.transfer).filter(isGroupableIdentifier))).sort((a, b) => a.localeCompare(b, "ru"));
        const excludedTransfers = new Set((carrierRows || []).filter((row) => normalizeForMatch(row.mx).includes("отгрузка сторонним перевозчиком")).map((row) => row.transfer));
        const carrierGateMxByTransfer = new Map();
        (carrierRows || []).forEach((row) => {
            if (!row.transfer || excludedTransfers.has(row.transfer) || !isGateMx(row.mx)) return;
            if (!carrierGateMxByTransfer.has(row.transfer)) carrierGateMxByTransfer.set(row.transfer, row.mx);
        });
        const byTransfer = new Map();
        dateRows.forEach((row) => {
            const group = byTransfer.get(row.transfer) || [];
            group.push(row);
            byTransfer.set(row.transfer, group);
        });
        const tasks = [];
        let excludedByCarrier = 0;
        let cheapTransfers = 0;
        let specialTaskCount = 0;
        transferIds.forEach((transfer) => {
            const allRows = byTransfer.get(transfer) || [];
            if (excludedTransfers.has(transfer)) { excludedByCarrier += 1; return; }
            const specialSplit = splitSpecialRows(allRows, specialMap, "product");
            specialSplit.special.forEach((row) => {
                specialTaskCount += 1;
                const routeMx = isMultiShipmentBufferMx(row.mx) ? (carrierGateMxByTransfer.get(transfer) || row.mx) : row.mx;
                const routeNumber = routeNumberFromMx(routeMx);
                const mail = isMailRoute(routeNumber);
                const taskType = mail ? "Разбор ОПП // Почта" : "Разбор ОПП // ПМ";
                tasks.push(taskRecord({
                    module: "pm",
                    sourceModule: def.sourceModule,
                    uploadType: def.uploadType,
                    businessDate,
                    sourceId: (mail ? "mail" : "pm") + ":special:" + row.product + "|" + businessDate,
                    title: (mail ? "Буфер Почта | " : "Буфер ПМ | ") + row.product + " - Парковка " + (routeNumber || "без номера"),
                    taskType,
                    descriptionTaskType: taskType,
                    column: mail ? "Почта" : "ПМ",
                    dueDate,
                    responsibilityZone: def.responsibilityZone,
                    productIds: [row.product],
                    rows: [row],
                    tareId: transfer,
                    price: row.price,
                    tags: mail ? ["почта"] : [],
                    specialMap,
                    payload: { entity_type: "special_shk", transfer, row },
                    infoLines: ["Передача: " + transfer, "Искомый ШК: " + row.product, "МХ: " + (row.mx || "-"), "Статус крайнего движения: " + (row.product_status || "-")],
                }));
            });
            const groupRows = specialSplit.regular;
            if (!groupRows.length) return;
            const priceSum = rowsPrice(groupRows, "price");
            if (priceSum < 2000) { cheapTransfers += 1; return; }
            const primary = groupRows.find((row) => isPmBufferStatus(row.product_status)) || groupRows[0];
            const routeMx = isMultiShipmentBufferMx(primary.mx) ? (carrierGateMxByTransfer.get(transfer) || primary.mx) : primary.mx;
            const routeNumber = routeNumberFromMx(routeMx);
            const mail = isMailRoute(routeNumber);
            const taskType = mail ? "Разбор ОПП // Почта" : "Разбор ОПП // ПМ";
            tasks.push(taskRecord({
                module: "pm",
                sourceModule: def.sourceModule,
                uploadType: def.uploadType,
                businessDate,
                sourceId: (mail ? "mail" : "pm") + ":transfer:" + transfer + "|" + businessDate,
                title: "Буфер ПМ | " + transfer + " - Парковка " + (routeNumber || "без номера"),
                taskType,
                descriptionTaskType: taskType,
                column: mail ? "Почта" : "ПМ",
                dueDate,
                responsibilityZone: def.responsibilityZone,
                productIds: groupRows.map((row) => row.product),
                rows: groupRows,
                tareId: transfer,
                price: priceSum,
                tags: mail ? ["почта"] : [],
                specialMap,
                payload: { entity_type: "transfer", transfer, route_number: routeNumber, rows: groupRows.slice(0, 40) },
                infoLines: ["Передача: " + transfer, "Парковка: " + (routeNumber || "без номера"), "ШК в передаче:", ...groupRows.map((row) => "- " + row.product + " / " + (row.product_status || "-") + " / " + formatMoney(row.price))],
            }));
        });
        return { mode: "pm", sourceRows: sourceRows.length, rowsCount: smsRows.length, dateFilteredOut: sourceRows.length - dateRows.length, smsTransfers: transferIds.length, excludedByCarrier, cheapTransfers, specialTaskCount, copiedTransferIds: transferIds, tasks, pmTasks: tasks.filter((task) => task.task_type === "Разбор ОПП // ПМ").length, mailTasks: tasks.filter((task) => task.task_type === "Разбор ОПП // Почта").length };
    }

    function buildPresortPreview(sourceRows, businessDate, specialMap) {
        const presortDef = moduleDef("presort");
        const labelingDef = moduleDef("labeling");
        const rows = sourceRows.filter((row) => parseDateTime(row.created_at).date === businessDate);
        const presortRows = rows.filter(isPresortStatus);
        const labelingRows = rows.filter(isLabelingStatus);
        const presort = appendGroupedTasks(presortRows, {
            module: "presort", sourceModule: presortDef.sourceModule, uploadType: presortDef.uploadType, businessDate, sourcePrefix: "presort", titlePrefix: "Предсортировка", taskType: presortDef.taskType, descriptionTaskType: presortDef.taskTypeLabel, column: presortDef.column, dueDate: dueDateForBusinessDate("presort", businessDate), responsibilityZone: presortDef.responsibilityZone, specialMap,
        });
        const labeling = appendGroupedTasks(labelingRows, {
            module: "labeling", sourceModule: labelingDef.sourceModule, uploadType: labelingDef.uploadType, businessDate, sourcePrefix: "labeling", titlePrefix: "Оклейка", taskType: labelingDef.taskType, descriptionTaskType: labelingDef.taskTypeLabel, column: labelingDef.column, dueDate: dueDateForBusinessDate("labeling", businessDate), responsibilityZone: labelingDef.responsibilityZone, specialMap, forceHighPriority: true,
        });
        const tasks = presort.tasks.concat(labeling.tasks);
        return { mode: "presort", sourceRows: sourceRows.length, rowsCount: presortRows.length, dateFilteredOut: sourceRows.length - rows.length, labelingRows: labelingRows.length, groupedTareCount: presort.groupedTareCount + labeling.groupedTareCount, specialCount: presort.specialCount + labeling.specialCount, tasks, presortTasks: presort.tasks.length, labelingTasks: labeling.tasks.length };
    }

    function buildMarketplacePcPreview(sourceRows, businessDate, specialMap) {
        const marketplaceDef = moduleDef("marketplace");
        const pcDef = moduleDef("pc");
        const marketplaceDate = state.manualDate ? businessDate : uploadDateForModule("marketplace");
        const pcDate = state.manualDate ? businessDate : uploadDateForModule("pc");
        const marketplaceDateRows = sourceRows.filter((row) => parseDateTime(row.created_at).date === marketplaceDate);
        const pcDateRows = sourceRows.filter((row) => parseDateTime(row.created_at).date === pcDate);
        const marketplaceRows = marketplaceDateRows.filter((row) => isMarketplaceStatus(row) && !mxHasBuffer(row));
        const pcRows = pcDateRows.filter((row) => isPcStatus(row) && !isMarketplaceStatus(row) && !mxHasBuffer(row));
        const marketplace = appendGroupedTasks(marketplaceRows, { module: "marketplace", sourceModule: marketplaceDef.sourceModule, uploadType: marketplaceDef.uploadType, businessDate: marketplaceDate, sourcePrefix: "marketplace", titlePrefix: "Маркетплейс", taskType: marketplaceDef.taskType, descriptionTaskType: marketplaceDef.taskTypeLabel, column: marketplaceDef.column, dueDate: dueDateForBusinessDate("marketplace", marketplaceDate), responsibilityZone: marketplaceDef.responsibilityZone, specialMap });
        const pc = appendGroupedTasks(pcRows, { module: "pc", sourceModule: pcDef.sourceModule, uploadType: pcDef.uploadType, businessDate: pcDate, sourcePrefix: "pc", titlePrefix: "ПЦ", taskType: pcDef.taskType, descriptionTaskType: pcDef.taskTypeLabel, column: pcDef.column, dueDate: dueDateForBusinessDate("pc", pcDate), responsibilityZone: pcDef.responsibilityZone, specialMap });
        const tasks = marketplace.tasks.concat(pc.tasks);
        const targetDates = new Set([marketplaceDate, pcDate]);
        return { mode: "marketplace_pc", sourceRows: sourceRows.length, rowsCount: marketplaceRows.length + pcRows.length, dateFilteredOut: sourceRows.filter((row) => !targetDates.has(parseDateTime(row.created_at).date)).length, marketplaceRows: marketplaceRows.length, pcRows: pcRows.length, groupedTareCount: marketplace.groupedTareCount + pc.groupedTareCount, specialCount: marketplace.specialCount + pc.specialCount, tasks, marketplaceTasks: marketplace.tasks.length, pcTasks: pc.tasks.length };
    }

    function buildWmiMpPcPreview(sourceRows, businessDate, specialMap) {
        const def = moduleDef("wmi_mp_pc");
        const rows = sourceRows.filter((row) => parseDateTime(row.created_at).date === businessDate);
        const wmiRows = rows.filter(isWmiMpPcStatus);
        const grouped = appendGroupedTasks(wmiRows, { module: "wmi_mp_pc", sourceModule: def.sourceModule, uploadType: def.uploadType, businessDate, sourcePrefix: "wmi_mp_pc", titlePrefix: "WMI (МП + ПЦ)", taskType: def.taskType, descriptionTaskType: def.taskTypeLabel, column: def.column, dueDate: dueDateForBusinessDate("wmi_mp_pc", businessDate), responsibilityZone: def.responsibilityZone, specialMap });
        return { mode: "wmi_mp_pc", sourceRows: sourceRows.length, rowsCount: wmiRows.length, dateFilteredOut: sourceRows.length - rows.length, groupedTareCount: grouped.groupedTareCount, specialCount: grouped.specialCount, tasks: grouped.tasks, wmiTasks: grouped.tasks.length };
    }

    function buildNoOrderPreview(sourceRows, businessDate, specialMap) {
        const def = moduleDef("no_order");
        const usdDef = moduleDef("usd");
        const tmmDef = moduleDef("tmm");
        const rows = sourceRows.filter((row) => parseDateTime(row.created_at).date === businessDate);
        const usdRows = rows.filter(isNoOrderUsdStatus);
        const tmmRows = rows.filter(isNoOrderTmmStatus);
        const noOrderRows = rows.filter((row) => !isNoOrderUsdStatus(row) && !isNoOrderTmmStatus(row));
        const noOrder = appendGroupedTasks(noOrderRows, { module: "no_order", sourceModule: def.sourceModule, uploadType: def.uploadType, businessDate, sourcePrefix: "no_order", titlePrefix: "Без заказа", taskType: def.taskType, descriptionTaskType: def.taskTypeLabel, column: def.column, dueDate: dueDateForBusinessDate("no_order", businessDate), responsibilityZone: def.responsibilityZone, specialMap });
        const usd = appendGroupedTasks(usdRows, { module: "usd", sourceModule: usdDef.sourceModule, uploadType: usdDef.uploadType, businessDate, sourcePrefix: "usd", titlePrefix: "USD", taskType: usdDef.taskType, descriptionTaskType: usdDef.taskTypeLabel, column: usdDef.column, dueDate: dueDateForBusinessDate("usd", businessDate), responsibilityZone: usdDef.responsibilityZone, specialMap, forceHighPriority: true, forceTareGrouping: true, tags: ["Идентификация из ОПП"] });
        const tmm = appendGroupedTasks(tmmRows, { module: "tmm", sourceModule: tmmDef.sourceModule, uploadType: tmmDef.uploadType, businessDate, sourcePrefix: "tmm", titlePrefix: "TMM", taskType: tmmDef.taskType, descriptionTaskType: tmmDef.taskTypeLabel, column: tmmDef.column, dueDate: dueDateForBusinessDate("tmm", businessDate), responsibilityZone: tmmDef.responsibilityZone, specialMap, forceHighPriority: true, forceTareGrouping: true, tags: ["Идентификация из ОПП"] });
        const tasks = noOrder.tasks.concat(usd.tasks, tmm.tasks);
        return { mode: "no_order", sourceRows: sourceRows.length, rowsCount: rows.length, dateFilteredOut: sourceRows.length - rows.length, groupedTareCount: noOrder.groupedTareCount + usd.groupedTareCount + tmm.groupedTareCount, specialCount: noOrder.specialCount + usd.specialCount + tmm.specialCount, usdRows: usdRows.length, tmmRows: tmmRows.length, tasks, noOrderTasks: noOrder.tasks.length, usdTasks: usd.tasks.length, tmmTasks: tmm.tasks.length };
    }

    function buildAfterSaleMovementPreview(sourceRows, businessDate, specialMap) {
        const def = moduleDef("after_sale_movement");
        const rows = sourceRows.filter((row) => parseDateTime(row.status_at).date === businessDate);
        const seen = new Set();
        let duplicateProductCount = 0;
        const tasks = [];
        rows.forEach((row) => {
            if (seen.has(row.product)) { duplicateProductCount += 1; return; }
            seen.add(row.product);
            tasks.push(taskRecord({
                module: "after_sale_movement",
                sourceModule: def.sourceModule,
                uploadType: def.uploadType,
                businessDate,
                sourceId: "after_sale:shk:" + row.product + "|" + businessDate,
                title: "Движение после продажи | " + row.product,
                taskType: def.taskType,
                descriptionTaskType: def.taskTypeLabel,
                column: def.column,
                dueDate: dueDateForBusinessDate("after_sale_movement", businessDate),
                responsibilityZone: def.responsibilityZone,
                productIds: [row.product],
                rows: [row],
                tareId: row.tare,
                price: 0,
                specialMap,
                payload: { entity_type: "shk", row },
                infoLines: ["Искомый ШК: " + row.product, "Тара: " + (row.tare || "-"), "МХ: " + (row.mx || "-"), "Статус после реализации: " + (row.status || "-"), "Дата статуса: " + (row.status_at || "-")],
            }));
        });
        return { mode: "after_sale_movement", sourceRows: sourceRows.length, rowsCount: rows.length, dateFilteredOut: sourceRows.length - rows.length, duplicateProductCount, tasks, afterSaleMovementTasks: tasks.length };
    }

    async function buildPreviewForModule(module, rows, carrierRows, businessDate) {
        const productIds = productIdsFromRows(rows).concat(productIdsFromRows(carrierRows || []));
        const specialMap = await loadSpecialMap(productIds);
        if (module === "packaging" || module === "rwp") return buildPackagingPreview(rows, module, businessDate, specialMap);
        if (module === "pm") return buildPmPreview(rows, carrierRows || [], businessDate, specialMap);
        if (module === "presort") return buildPresortPreview(rows, businessDate, specialMap);
        if (module === "marketplace_pc") return buildMarketplacePcPreview(rows, businessDate, specialMap);
        if (module === "wmi_mp_pc") return buildWmiMpPcPreview(rows, businessDate, specialMap);
        if (module === "no_order") return buildNoOrderPreview(rows, businessDate, specialMap);
        if (module === "after_sale_movement") return buildAfterSaleMovementPreview(rows, businessDate, specialMap);
        return { mode: module, tasks: [] };
    }

    async function handleSingleFile(module, file, kind) {
        state.files.primary = file;
        $("fileName").textContent = "Файл выбран: " + file.name;
        setStatus("Читаю файл...");
        const rows = await readWorkbookRows(file, kind);
        state.rows.primary = rows;
        if (module === "pm") {
            state.rows.carrier = [];
            state.preview = await buildPreviewForModule(module, rows, [], state.activeDate);
            renderPreview(state.preview);
            $("copyTransfers").disabled = !(state.preview.copiedTransferIds || []).length;
            $("skipCarrier").disabled = false;
            $("carrierLabel").style.display = "inline-flex";
            setStatus("Основной файл прочитан. Строк: " + rows.length + ". Скопируйте передачи и загрузите проверку отгрузки либо пропустите второй файл.", "good");
            return;
        }
        state.preview = await buildPreviewForModule(module, rows, [], state.activeDate);
        renderPreview(state.preview);
        $("saveUpload").disabled = !state.preview.tasks.length;
        setStatus(state.preview.tasks.length ? "Предпросмотр готов. К сохранению: " + state.preview.tasks.length + "." : "Нет задач по текущим правилам.", state.preview.tasks.length ? "good" : "");
    }

    async function handleCarrierFile(file) {
        state.files.carrier = file;
        $("fileName").textContent = "Основной и второй файлы выбраны";
        setStatus("Читаю проверку отгрузки...");
        const rows = await readWorkbookRows(file, "pmCarrier");
        state.rows.carrier = rows;
        state.preview = await buildPreviewForModule("pm", state.rows.primary || [], rows, state.activeDate);
        renderPreview(state.preview);
        $("saveUpload").disabled = !state.preview.tasks.length;
        setStatus(state.preview.tasks.length ? "Предпросмотр готов. К сохранению: " + state.preview.tasks.length + "." : "Нет задач по текущим правилам.", state.preview.tasks.length ? "good" : "");
    }

    async function skipCarrierFile() {
        state.rows.carrier = [];
        state.files.carrier = null;
        state.preview = await buildPreviewForModule("pm", state.rows.primary || [], [], state.activeDate);
        renderPreview(state.preview);
        $("saveUpload").disabled = !state.preview.tasks.length;
        setStatus("Второй файл пропущен. К сохранению: " + state.preview.tasks.length + ".", state.preview.tasks.length ? "good" : "");
    }

    async function copyActiveTransfers() {
        const ids = state.preview && state.preview.copiedTransferIds ? state.preview.copiedTransferIds : [];
        if (!ids.length) return;
        const text = ids.join("\n");
        const copied = await copyText(text);
        toast(copied ? "Скопировано передач: " + ids.length : "Автокопирование заблокировано браузером.", copied ? "success" : "error");
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_error) {}
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        let copied = false;
        try { copied = document.execCommand("copy"); } catch (_error) { copied = false; }
        document.body.removeChild(textarea);
        return copied;
    }

    function renderPreview(preview) {
        if (!preview) {
            $("previewGrid").innerHTML = "";
            $("sampleWrap").innerHTML = "";
            return;
        }
        const stats = [
            ["Строк в файле", preview.sourceRows || 0],
            ["Строк подходит", preview.rowsCount || preview.smsRows || preview.presortRows || 0],
            ["Групп тар", preview.groupedTareCount || 0],
            ["Особые ШК", preview.specialCount || preview.specialTaskCount || 0],
            ["К сохранению", preview.tasks ? preview.tasks.length : 0],
        ];
        $("previewGrid").innerHTML = stats.map(([label, value]) => "<div class='mini-stat'><div class='mini-stat-label'>" + escapeHtml(label) + "</div><div class='mini-stat-value'>" + escapeHtml(value) + "</div></div>").join("");
        const rows = (preview.tasks || []).slice(0, 5).map((task) => "<tr><td>" + escapeHtml(task.title) + "</td><td>" + escapeHtml(task.task_type) + "</td><td>" + escapeHtml(task.column) + "</td><td>" + escapeHtml(formatRuDate(task.due_date)) + "</td><td>" + escapeHtml(formatMoney(task.source_price_sum)) + "</td><td>" + escapeHtml(task.priority_label) + "</td></tr>").join("");
        $("sampleWrap").innerHTML = rows ? "<table class='sample-table'><thead><tr><th>Название</th><th>Тип</th><th>Колонка</th><th>Дата</th><th>Стоимость</th><th>Приоритет</th></tr></thead><tbody>" + rows + "</tbody></table>" : "<div class='empty-state'>Нет задач к сохранению.</div>";
    }

    async function saveCurrentUpload() {
        if (!state.preview || !state.preview.tasks.length) return;
        const module = state.activeModule;
        const def = moduleDef(module);
        $("saveUpload").disabled = true;
        setStatus("Сохраняю в Supabase: " + state.preview.tasks.length + " задач...");
        try {
            const response = await saveTasksAndRun(module, state.activeDate, state.preview.tasks, {
                fileName: state.files.primary ? state.files.primary.name : "",
                secondaryFileName: state.files.carrier ? state.files.carrier.name : "",
                rowsCount: state.rows.primary ? state.rows.primary.length : 0,
                summary: summarizePreview(state.preview),
            });
            if (response && response.upload_run) mergeRun(response.upload_run);
            renderCalendar();
            renderModuleChooser();
            $("doneBox").classList.add("visible");
            $("doneBox").textContent = "Выгрузка завершена. Создано/обновлено задач: " + (response.upserted_count || state.preview.tasks.length) + ".";
            setStatus("Готово. Данные сохранены в WMS+.", "good");
        } catch (error) {
            $("saveUpload").disabled = false;
            setStatus(error && error.message ? error.message : String(error), "error");
        }
    }

    function summarizePreview(preview) {
        const result = { tasks_count: (preview.tasks || []).length };
        Object.keys(preview || {}).forEach((key) => {
            if (key !== "tasks" && typeof preview[key] !== "object") result[key] = preview[key];
        });
        return result;
    }

    async function saveTasksAndRun(module, businessDate, tasks, meta) {
        const db = supabaseDb();
        if (!db) throw new Error("Supabase недоступен.");
        const def = moduleDef(module);
        const payloadTasks = (tasks || []).map((task) => ({ ...task, module: undefined, column: undefined }));
        const run = {
            upload_date: state.today,
            effective_date: businessDate,
            business_date: businessDate,
            source_module: def.sourceModule,
            upload_type: def.uploadType,
            status: "completed",
            file_name: meta.fileName || "",
            secondary_file_name: meta.secondaryFileName || "",
            rows_count: meta.rowsCount || 0,
            tasks_count: tasks.length,
            summary: meta.summary || {},
        };
        const { data, error } = await db.rpc(SAVE_RPC, { p_tasks: payloadTasks, p_run: run });
        if (error) throw error;
        return data || { ok: true, upserted_count: tasks.length };
    }

    function mergeRun(run) {
        if (!run) return;
        const key = [run.effective_date, run.source_module, run.upload_type].join("|");
        state.runs = state.runs.filter((item) => [item.effective_date, item.source_module, item.upload_type].join("|") !== key);
        state.runs.push(run);
    }

    function resetCurrentUpload() {
        if (!state.activeModule) return;
        renderWorkShell(state.activeModule);
    }

    function openMaster() {
        state.manualDate = "";
        state.master = { files: {}, fileNames: {}, rows: {}, preview: null, dateRejects: [], conditionRejects: [] };
        $("moduleChooser").classList.remove("active");
        $("uploadWork").classList.remove("active");
        $("masterWork").classList.add("active");
        renderMasterSlots();
        setMasterStatus("Жду файлы. После основного файла можно скопировать передачи для проверки отгрузки.");
        $("masterSummary").innerHTML = "";
        $("masterRejects").classList.remove("visible");
        $("masterDone").classList.remove("visible");
        $("saveMaster").disabled = true;
        $("showRejects").disabled = true;
        $("buildMasterPreview").disabled = true;
    }

    function masterDatePlan() {
        const dates = {};
        MASTER_MODULES.forEach((module) => { dates[module] = uploadDateForModule(module); });
        return dates;
    }

    function renderMasterSlots() {
        const dates = masterDatePlan();
        $("masterSlots").innerHTML = MASTER_SLOTS.map((slot) => {
            const slotDates = Array.from(new Set(slot.modules.map((module) => dates[module]).filter(Boolean)));
            const note = slot.key === "main"
                ? "Выгрузите файл с " + formatRuDate(earliestDate(slotDates)) + " по " + formatRuDate(state.today) + "."
                : slot.key === "carrier"
                    ? "Проверка передач ПМ/Почты за " + formatRuDate(dates.pm) + "."
                    : "Нужная дата: " + slotDates.map(formatRuDate).join(", ") + ".";
            return "<article class='slot-card'><h4 class='slot-title'>" + escapeHtml(slot.title) + "</h4><p class='slot-note'>" + escapeHtml(note) + "</p><div class='file-row'><label class='btn btn-rect' for='master-" + slot.key + "'>Выбрать файл</label><input id='master-" + slot.key + "' class='file-input' type='file' accept='.xlsx,.xls,.csv'><span id='master-name-" + slot.key + "' class='file-name'>Файл пока не выбран</span></div></article>";
        }).join("");
        MASTER_SLOTS.forEach((slot) => {
            const input = $("master-" + slot.key);
            input.addEventListener("change", () => {
                const file = input.files && input.files[0];
                if (file) handleMasterFile(slot, file).catch((error) => setMasterStatus(error && error.message ? error.message : String(error), "error"));
            });
        });
    }

    function earliestDate(dates) { return (dates || []).filter(Boolean).sort()[0] || ""; }

    async function handleMasterFile(slot, file) {
        state.master.files[slot.key] = file;
        state.master.fileNames[slot.key] = file.name;
        $("master-name-" + slot.key).textContent = "Файл выбран";
        setMasterStatus("Читаю файл: " + slot.title + "...");
        const rows = await readWorkbookRows(file, slot.kind);
        state.master.rows[slot.key] = rows;
        if (slot.key === "main") {
            const pmPreview = await buildPreviewForModule("pm", rows, [], uploadDateForModule("pm"));
            state.master.pmTransferIds = pmPreview.copiedTransferIds || [];
            $("copyMasterTransfers").disabled = !state.master.pmTransferIds.length;
        }
        $("buildMasterPreview").disabled = !masterCanBuild();
        setMasterStatus("Файл прочитан: " + slot.title + ". Строк: " + rows.length + ".", "good");
    }

    function masterCanBuild() {
        return Boolean(state.master.rows.main && state.master.rows.noOrder && state.master.rows.packaging && state.master.rows.afterSale);
    }

    async function copyMasterTransfers() {
        const ids = state.master.pmTransferIds || [];
        if (!ids.length) {
            setMasterStatus("В основном файле не нашел передач ПМ/Почты за нужную дату.", "error");
            return;
        }
        const text = ids.join("\n");
        $("masterTransferFallback").style.display = "none";
        if (await copyText(text)) setMasterStatus("Скопировано передач: " + ids.length + ".", "good");
        else {
            $("masterTransferFallback").value = text;
            $("masterTransferFallback").style.display = "block";
            $("masterTransferFallback").focus();
            $("masterTransferFallback").select();
            setMasterStatus("Браузер заблокировал автокопирование. Я вывел список ниже и выделил его - нажмите Cmd+C.");
        }
    }

    async function buildMasterPreview() {
        if (!masterCanBuild()) return;
        setMasterStatus("Считаю мастер-выгрузку...");
        const dates = masterDatePlan();
        const main = state.master.rows.main || [];
        const noOrder = state.master.rows.noOrder || [];
        const carrier = state.master.rows.carrier || [];
        const packaging = state.master.rows.packaging || [];
        const afterSale = state.master.rows.afterSale || [];
        const modules = [
            { module: "pm", date: dates.pm, preview: await buildPreviewForModule("pm", main, carrier, dates.pm) },
            { module: "presort", date: dates.presort, preview: await buildPreviewForModule("presort", main, [], dates.presort) },
            { module: "marketplace_pc", date: dates.marketplace_pc, preview: await buildPreviewForModule("marketplace_pc", main, [], dates.marketplace_pc) },
            { module: "wmi_mp_pc", date: dates.wmi_mp_pc, preview: await buildPreviewForModule("wmi_mp_pc", main, [], dates.wmi_mp_pc) },
            { module: "no_order", date: dates.no_order, preview: await buildPreviewForModule("no_order", noOrder, [], dates.no_order) },
            { module: "packaging", date: dates.packaging, preview: await buildPreviewForModule("packaging", packaging, [], dates.packaging) },
            { module: "rwp", date: dates.rwp, preview: await buildPreviewForModule("rwp", packaging, [], dates.rwp) },
            { module: "after_sale_movement", date: dates.after_sale_movement, preview: await buildPreviewForModule("after_sale_movement", afterSale, [], dates.after_sale_movement) },
        ];
        state.master.preview = { dates, modules, totalTasks: modules.reduce((acc, item) => acc + ((item.preview.tasks || []).length), 0) };
        state.master.dateRejects = buildMasterDateRejects({ main, noOrder, packaging, afterSale }, dates);
        state.master.conditionRejects = buildMasterConditionRejects({ main, noOrder, packaging, carrier }, dates);
        renderMasterPreview();
    }

    function renderMasterPreview() {
        const preview = state.master.preview;
        const modules = preview ? preview.modules : [];
        $("masterSummary").innerHTML = modules.map((item) => {
            const count = item.preview.tasks.length;
            return "<article class='module-card " + (count ? "done" : "missing") + "'><p class='module-name'><span>" + escapeHtml(moduleDef(item.module).label) + "</span><span>" + count + "</span></p><div class='module-date'>За " + formatRuDate(item.date) + "</div><p class='module-desc'>задач к сохранению</p></article>";
        }).join("");
        $("showRejects").disabled = false;
        $("saveMaster").disabled = !preview || !preview.totalTasks;
        setMasterStatus(preview && preview.totalTasks ? "Предпросмотр готов. Всего задач: " + preview.totalTasks + "." : "По файлам нет задач к сохранению.", preview && preview.totalTasks ? "good" : "");
    }

    function rowDate(row) { return parseDateTime(row.created_at).date; }
    function packDate(row) { return parseDateTime(row.last_movement).date; }
    function afterDate(row) { return parseDateTime(row.status_at).date; }

    function pushReject(list, module, row, reason, dateValue, matchedUpload) {
        list.push({ module: moduleDef(module).label || module, matched_upload: matchedUpload ? moduleDef(matchedUpload).label : moduleDef(module).label, row_number: row.row_number || "", source_id: row.product || row.shk || row.transfer || "", date: dateValue || "", reason });
    }

    function buildMasterDateRejects(rows, dates) {
        const list = [];
        rows.main.forEach((row) => {
            const date = rowDate(row);
            if (isPmBufferStatus(row.product_status) && date !== dates.pm) pushReject(list, "pm", row, "Нужна дата " + formatRuDate(dates.pm), date, "pm");
            if ((isPresortStatus(row) || isLabelingStatus(row)) && date !== dates.presort) pushReject(list, "presort", row, "Нужна дата " + formatRuDate(dates.presort), date, "presort");
            if ((isMarketplaceStatus(row) || isPcStatus(row)) && date !== dates.marketplace_pc) pushReject(list, "marketplace_pc", row, "Нужна дата " + formatRuDate(dates.marketplace_pc), date, "marketplace_pc");
            if (isWmiMpPcStatus(row) && date !== dates.wmi_mp_pc) pushReject(list, "wmi_mp_pc", row, "Нужна дата " + formatRuDate(dates.wmi_mp_pc), date, "wmi_mp_pc");
        });
        rows.noOrder.forEach((row) => { const date = rowDate(row); if (date !== dates.no_order) pushReject(list, "no_order", row, "Нужна дата " + formatRuDate(dates.no_order), date, "no_order"); });
        rows.packaging.forEach((row) => { const date = packDate(row); if (!isRwpStatus(row.last_status) && date !== dates.packaging) pushReject(list, "packaging", row, "Нужна дата " + formatRuDate(dates.packaging), date, "packaging"); if (isRwpStatus(row.last_status) && date !== dates.rwp) pushReject(list, "rwp", row, "Нужна дата " + formatRuDate(dates.rwp), date, "rwp"); });
        rows.afterSale.forEach((row) => { const date = afterDate(row); if (date !== dates.after_sale_movement) pushReject(list, "after_sale_movement", row, "Нужна дата " + formatRuDate(dates.after_sale_movement), date, "after_sale_movement"); });
        return list.slice(0, 1000);
    }

    function buildMasterConditionRejects(rows, dates) {
        const list = [];
        const mainTargetDates = new Set(MASTER_MAIN_MODULES.map((module) => dates[module]));
        rows.main.forEach((row) => {
            const date = rowDate(row);
            if (!mainTargetDates.has(date)) return;
            const matches = isPmBufferStatus(row.product_status) || isPresortStatus(row) || isLabelingStatus(row) || isMarketplaceStatus(row) || isPcStatus(row) || isWmiMpPcStatus(row);
            if (!matches) pushReject(list, "pm", row, "Дата подходит, но статус/МХ не подошли ни под одну выгрузку. Статус: " + (row.product_status || "-") + "; МХ: " + (row.mx || "-"), date, "pm");
            if ((isMarketplaceStatus(row) || isPcStatus(row)) && mxHasBuffer(row)) pushReject(list, "marketplace_pc", row, "МХ содержит Буфер, строка исключена", date, "marketplace_pc");
        });
        return list.slice(0, 1000);
    }

    function showMasterRejects() {
        const htmlTable = (items) => {
            if (!items.length) return "<div class='empty-state'>Таких строк нет.</div>";
            const rows = items.map((item) => "<tr><td>" + escapeHtml(item.module) + "</td><td>" + escapeHtml(item.matched_upload || "-") + "</td><td>" + escapeHtml(item.row_number) + "</td><td>" + escapeHtml(item.source_id) + "</td><td>" + escapeHtml(formatRuDate(item.date)) + "</td><td>" + escapeHtml(item.reason) + "</td></tr>").join("");
            return "<table class='sample-table'><thead><tr><th>Файл/проверка</th><th>Подходит в выгрузку</th><th>Строка</th><th>ID</th><th>Дата</th><th>Причина</th></tr></thead><tbody>" + rows + "</tbody></table>";
        };
        $("masterRejects").classList.toggle("visible");
        $("masterRejects").innerHTML = "<h4>Отсеяно по датам</h4>" + htmlTable(state.master.dateRejects || []) + "<h4>Отсеяно по условиям</h4>" + htmlTable(state.master.conditionRejects || []);
    }

    async function saveMasterUpload() {
        const preview = state.master.preview;
        if (!preview || !preview.totalTasks) return;
        $("saveMaster").disabled = true;
        setMasterStatus("Сохраняю мастер-выгрузку в Supabase...");
        let total = 0;
        const results = [];
        try {
            for (const item of preview.modules) {
                const tasks = item.preview.tasks || [];
                if (!tasks.length) continue;
                const slot = slotForModule(item.module);
                setMasterStatus("Сохраняю: " + moduleDef(item.module).label + ". Задач: " + tasks.length + ". Уже сохранено: " + total + ".");
                const response = await saveTasksAndRun(item.module, item.date, tasks, {
                    fileName: slot && state.master.fileNames[slot.key] ? state.master.fileNames[slot.key] : "",
                    secondaryFileName: item.module === "pm" && state.master.fileNames.carrier ? state.master.fileNames.carrier : "",
                    rowsCount: sourceRowsCountForMasterModule(item.module),
                    summary: summarizePreview(item.preview),
                });
                total += Number(response.upserted_count || tasks.length) || 0;
                if (response.upload_run) mergeRun(response.upload_run);
                results.push(moduleDef(item.module).label + ": " + tasks.length);
            }
            renderCalendar();
            renderModuleChooser();
            $("masterDone").classList.add("visible");
            $("masterDone").textContent = "Мастер-выгрузка завершена. Создано/обновлено задач: " + total + ". " + results.join("; ") + ".";
            setMasterStatus("Готово. Данные сохранены в WMS+.", "good");
        } catch (error) {
            $("saveMaster").disabled = false;
            setMasterStatus(error && error.message ? error.message : String(error), "error");
        }
    }

    function slotForModule(module) {
        if (module === "packaging" || module === "rwp") return MASTER_SLOTS.find((slot) => slot.key === "packaging");
        if (module === "no_order") return MASTER_SLOTS.find((slot) => slot.key === "noOrder");
        if (module === "after_sale_movement") return MASTER_SLOTS.find((slot) => slot.key === "afterSale");
        return MASTER_SLOTS.find((slot) => slot.key === "main");
    }

    function sourceRowsCountForMasterModule(module) {
        if (module === "packaging" || module === "rwp") return (state.master.rows.packaging || []).length;
        if (module === "no_order") return (state.master.rows.noOrder || []).length;
        if (module === "after_sale_movement") return (state.master.rows.afterSale || []).length;
        return (state.master.rows.main || []).length;
    }

    function initEvents() {
        $("openUploads").addEventListener("click", () => { void showUploads(); });
        $("openReview").addEventListener("click", openReviewModal);
        $("homeFromUploads").addEventListener("click", showHome);
        $("closeReview").addEventListener("click", closeReviewModal);
        $("reviewModal").addEventListener("click", (event) => { if (event.target === $("reviewModal")) closeReviewModal(); });
        $("makeUpload").addEventListener("click", () => openChooser(""));
        $("backfillUpload").addEventListener("click", openBackfillChooser);
        $("makeMasterUpload").addEventListener("click", openMaster);
        $("closeChooser").addEventListener("click", () => $("moduleChooser").classList.remove("active"));
        $("backToChooser").addEventListener("click", () => openChooser(state.manualDate));
        $("saveUpload").addEventListener("click", () => { void saveCurrentUpload(); });
        $("repeatUpload").addEventListener("click", resetCurrentUpload);
        $("closeMaster").addEventListener("click", () => $("masterWork").classList.remove("active"));
        $("copyMasterTransfers").addEventListener("click", () => { void copyMasterTransfers(); });
        $("buildMasterPreview").addEventListener("click", () => { void buildMasterPreview(); });
        $("showRejects").addEventListener("click", showMasterRejects);
        $("saveMaster").addEventListener("click", () => { void saveMasterUpload(); });
    }

    function init() {
        initEvents();
        renderCalendar();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
}());
