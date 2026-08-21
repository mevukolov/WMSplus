(function () {
    "use strict";

    const WH_ID = "50144199";
    const RUNS_TABLE = "wms_manual_upload_runs";
    const SETTINGS_TABLE = "wms_manual_upload_settings";
    const LEGACY_RUNS_TABLE = "weeek_manual_upload_runs";
    const LEGACY_SETTINGS_TABLE = "weeek_manual_upload_settings";
    const WMS_TASKS_TABLE = "wms_tasks";
    const WMS_TASK_SELECT_COLUMNS = "id,source_module,source_id,source_row_id,source_payload,source_shk_ids,source_tare_id,source_price_sum,source_last_movement_at,upload_type,upload_effective_date,task_type,title,description,priority,priority_label,due_date,responsibility_zone,task_status,opp_verdict,assignee_employee_id,assignee_name,tags,is_deleted,completed_at,reopened_at,reopen_after,created_at,updated_at";
    const WEEEK_TASKS_TABLE = "weeek_tasks";
    const WEEEK_TASKS_BASIC_TABLE = "weeek_tasks_basic";
    const WEEEK_BASIC_SELECT_COLUMNS = "id,source_id,source_payload,source_shk_ids,source_tare_id,source_price_sum,source_last_movement_at,task_type,title,task_status,opp_verdict,updated_at,created_at";
    const WEEEK_SIMPLE_SELECT_COLUMNS = "id,source_id,source_payload,task_type,title,task_status,opp_verdict,updated_at,created_at";
    const WMS_EMPLOYEES_TABLE = "wms_employees";
    const WMS_SHIFTS_TABLE = "wms_shifts";
    const WMS_PRESPISOK_RUNS_TABLE = "wms_prespisok_runs";
    const WMS_PRESPISOK_ACTIONS_TABLE = "wms_prespisok_actions";
    const PURE_LOSSES_TABLE = "pure_losses_rep";
    const LOSSES_TABLE = "losses_rep";
    const SAVE_RPC = "save_wms_manual_upload";
    const SAVE_TASK_CHUNK_SIZE = 100;
    const TWO_SHK_TABLE = "2shk_rep";
    const PURE_URL_FILTER_CHUNK_SIZE = 80;
    const PURE_INSERT_CHUNK_SIZE = 400;
    const SPECIAL_LOOKUP_CHUNK_SIZE = 500;
    const SPECIAL_LOOKUP_CONCURRENCY = 3;
    const PURE_AUTO_IDS = new Set(["11", "21", "26", "31", "32", "35", "42", "47"]);
    const AUTO_FOUND_DECISION = "Найден";
    const AUTO_FOUND_EMP_ID = "2405";
    const AUTO_FOUND_COMMENT = "У товара есть движение";
    const SYSTEM_MOVEMENT_VERDICT = "Система - Движение";
    const MOVEMENT_AUTO_CLOSE_MINUTES = 10;
    const MOVEMENT_AUTO_CLOSE_MIN_MS = MOVEMENT_AUTO_CLOSE_MINUTES * 60 * 1000;
    const PRESPISOK_STORAGE_KEY = "wms_prespisok_progress_v1";
    const PRESPISOK_TEST_MODE = true;
    const PRESPISOK_START_MINUTE = 14 * 60 + 30;
    const PRESPISOK_END_MINUTE = 16 * 60;
    const PURE_COLUMN_VARIANTS = {
        shk: ["ШК", "shk", "Шк", "Штрихкод"],
        nm: ["ID номенклатуры", "ID Номенклатуры", "ID НМ", "nm"],
        decription: ["Наименования товара", "Наименование товара", "Товар"],
        brand: ["Наименования бренда", "Наименование бренда", "Бренд"],
        shk_state_before_lost: ["Статус перед списанием", "Статус ШК перед списанием"],
        wh_id: ["ID офиса", "ID офиса статуса перед списанием", "ID офиса статуса перед списания", "wh_id"],
        date_lost: ["Дата последнего списания", "date_lost"],
        lr: ["Лостризон последнего списания", "ЛР последнего списания", "ID списания", "lr"],
        price: ["Сумма списания", "Сумма", "price"],
        posted_flag: ["Флаг оприходования", "Оприходовано", "Флаг оприходован"],
    };
    const PURE_NORMALIZED_COLUMN_VARIANTS = Object.fromEntries(Object.entries(PURE_COLUMN_VARIANTS).map(([key, variants]) => [key, variants.map(normalizeHeaderKey)]));
    const SUPERSET_COLUMN_VARIANTS = {
        shk: ["ШК", "C - ШК", "C. ШК", "C. - ШК"],
        brand: ["Марка товара", "D - Марка товара", "D. Марка товара"],
        name: ["Наименование товара", "E - Наименование товара", "E. Наименование товара"],
        article: ["Артикул", "F - Артикул", "F. Артикул"],
        size: ["Размер", "G - Размер", "G. Размер"],
        nm: ["Код НМ", "H - Код НМ", "H. Код НМ"],
        supplier: ["Поставщик", "I - Поставщик", "I. Поставщик"],
        price: ["Цена", "J - Цена", "J. Цена"],
        currency: ["Валюта", "K - Валюта", "K. Валюта"],
        price_source: ["Источник цены", "L - Источник цены", "L. Источник цены"],
        srid: ["SRID", "M - SRID", "M. SRID"],
        last_office: ["Офис последнего МХ", "Офис последнего MX", "N - Офис последнего МХ", "N. -Офис последнего МХ", "N. Офис последнего МХ"],
        last_mx: ["Последнее МХ", "Последнее MX", "O - Последнее МХ", "O. Последнее МХ"],
        place: ["Место нахождения", "P - Место нахождения", "P. Место нахождения"],
        last_tare: ["Последняя тара", "Q - Последняя тара", "Q. Последняя тара"],
        previous_tare: ["Предпоследняя тара", "R - Предпоследняя тара", "R. Предпоследняя тара"],
        last_status: ["Последний статус ШК", "S - Последний статус ШК", "S. Последний статус ШК"],
        last_status_at: ["Дата посл статуса ШК", "Дата последнего статуса ШК", "T - Дата посл статуса ШК", "T. Дата посл статуса ШК"],
    };
    const SUPERSET_NORMALIZED_COLUMN_VARIANTS = Object.fromEntries(Object.entries(SUPERSET_COLUMN_VARIANTS).map(([key, variants]) => [key, variants.map(normalizeHeaderKey)]));
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
            taskDeadlineDays: 2,
            pmDeadlineDays: 2,
            mailDeadlineDays: 3,
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
    const REVIEW_SECTIONS = [
        "Упаковка",
        "RWP",
        "ПМ",
        "Почта",
        "Предсортировка",
        "Маркетплейс",
        "ПЦ",
        "WMI (МП + ПЦ)",
        "Без заказа",
        "Движение после продажи",
        "Другие задачи",
    ];
    const REVIEW_VERDICTS = [
        "Не выбран",
        "Найден/Релиз/Списан",
        "Отправлен на релиз",
        "Отправлен на списание ревизией",
        "Отправлен запрос",
        "Нет на МХ/Не найден",
        "Добавлен в исключения",
    ];
    const DEFERRED_VERDICT_FIELDS = {
        "Отправлен запрос": "Направление запроса",
        "Отправлен на релиз": "Вставьте ссылку на запрос релиза",
        "Отправлен на списание ревизией": "Вставьте ссылку",
    };
    const PRESPISOK_SNARK = {
        openers: [
            "Работаем.",
            "Следующий.",
            "Не зависаем.",
            "Проверяем быстро.",
            "Еще один кандидат.",
            "Склад опять шутит.",
            "Без героизма.",
            "Смотри по факту.",
            "Время идет.",
            "Не корми списание.",
            "ОПП на сцене.",
            "Погнали.",
        ],
        needles: [
            "Цена перед тобой.",
            "Дата списания рядом.",
            "Движение есть — фиксируй.",
            "Ссылка нужна нормальная.",
            "Не тяни.",
            "Очередь сама не похудеет.",
            "Проверил — жми.",
            "Тара не оправдание.",
            "ШК не святой.",
            "Excel переживет.",
            "Ревизия потом спросит.",
            "Меньше пауз.",
        ],
        spikes: [
            "Списание уже облизывается.",
            "Товар спрятался плохо.",
            "Тара мутная.",
            "Статус подозрительный.",
            "Деньги не казенные. Хотя стоп.",
            "Строк много, нервов мало.",
            "Алиби слабое.",
            "WMS опять с покерфейсом.",
            "Складовой фольклор не принимаем.",
            "Кандидат расслабился зря.",
            "ШК решил пожить бесплатно.",
            "Проверка короткая. Надеюсь.",
        ],
        closers: [
            "Дальше.",
            "Жалость оставь принтеру.",
            "Фиксируй.",
            "Без театра.",
            "ШК, цена, решение.",
            "Сделай чисто.",
            "Сомневаешься — проверь.",
            "Предсписок не самоунизится.",
            "Бьем по бардаку.",
            "Не растягивай.",
            "Паника подождет.",
            "Следующий ждет.",
        ],
    };
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
        specialCheck: null,
        review: {
            rows: [],
            loading: false,
            loaded: false,
            activeSection: "",
            sort: { key: "price", dir: "desc" },
        },
        inactive: {
            rows: [],
            loading: false,
            loaded: false,
            activeGroup: "deferred",
            sort: { key: "updated", dir: "desc" },
        },
        taskDetail: {
            rowId: "",
            source: "review",
            editRowId: "",
            deferRowId: "",
            reopenRowId: "",
            splitRowId: "",
            splitShk: "",
        },
        master: {
            files: {},
            fileNames: {},
            rows: {},
            preview: null,
            dateRejects: [],
            conditionRejects: [],
            slotIndex: 0,
            skippedSlots: {},
            specialCheck: null,
            building: false,
        },
        shift: {
            loading: false,
            employees: [],
            current: null,
            pureRows: [],
            pureStats: null,
            purePrepared: null,
            pureFileName: "",
            saving: false,
            error: "",
        },
        actualize: {
            copied: false,
            rows: [],
            candidates: [],
            removedShks: new Set(),
            tareActions: {},
            stats: null,
            supersetDebug: null,
            processing: false,
        },
        taskSearch: {
            rows: [],
            loading: false,
            timer: null,
            requestId: 0,
        },
        prespisok: {
            rows: [],
            items: [],
            index: 0,
            actions: [],
            excludedCount: 0,
            fileName: "",
            runId: "",
            startedAt: "",
            timerStartedAt: 0,
            elapsedBeforeMs: 0,
            itemTimerStartedAt: 0,
            itemElapsedBeforeMs: 0,
            itemTimerKick: 0,
            history: {},
            selectedAction: "",
            loading: false,
            finished: false,
            leaderboard: [],
            clockTimer: null,
        },
    };

    const $ = (id) => document.getElementById(id);

    function normalizeText(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim();
    }

    function parseJsonSafe(value, fallback) {
        try {
            return value ? JSON.parse(value) : fallback;
        } catch (_error) {
            return fallback;
        }
    }

    function normalizeForMatch(value) {
        return normalizeText(value).replace(/[–—−]/g, "-").replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/\s+/g, " ").toLowerCase();
    }

    function statusCode(value) {
        const match = normalizeText(value).toUpperCase().match(/[A-ZА-ЯЁ]{3}/);
        return match ? match[0] : "";
    }

    function latinStatusCode(value) {
        const match = normalizeText(value).toUpperCase().match(/[A-Z]{3}/);
        return match ? match[0] : "";
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

    function formatRuDateTime(value) {
        const parsed = parseDateTime(value);
        if (!parsed.date) return "-";
        const dateText = formatRuDate(parsed.date);
        if (!parsed.ts) return dateText;
        return new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Europe/Moscow",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(parsed.ts));
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

    function settingNumber(value, fallback) {
        if (value === null || value === undefined || normalizeText(value) === "") return fallback;
        const parsed = Number(normalizeText(value).replace(",", "."));
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function uploadDateForModule(module) {
        const def = moduleDef(module);
        return state.manualDate || addDays(state.today, Number(def.offsetDays || 0));
    }

    function plannedUploadDateForBusinessDate(module, businessDate) {
        const def = moduleDef(module);
        return addDays(businessDate, -(Number(def.offsetDays || 0) || 0));
    }

    function dueDateForBusinessDate(module, businessDate, variant) {
        const def = moduleDef(module);
        let deadlineDays = settingNumber(def.taskDeadlineDays, 1);
        if (module === "pm" && variant === "mail") deadlineDays = settingNumber(def.mailDeadlineDays, deadlineDays);
        if (module === "pm" && variant === "pm") deadlineDays = settingNumber(def.pmDeadlineDays, deadlineDays);
        return addDays(plannedUploadDateForBusinessDate(module, businessDate), deadlineDays);
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

    function renderBackfillCalendar() {
        const range = state.calendarRange || buildCalendarRange();
        state.calendarRange = range;
        const required = requiredVisibleDefs();
        const html = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => "<div class='weekday'>" + day + "</div>").join("")
            + datesBetween(range.start, range.end).map((isoDate) => {
                const doneCount = required.filter((def) => runForUpload(def.module, isoDate)).length;
                const disabled = isoDate > state.today;
                return "<button type='button' class='backfill-day " + dayStatusClass(doneCount) + "' data-date='" + escapeHtml(isoDate) + "' " + (disabled ? "disabled" : "") + ">"
                    + "<span class='day-number'>" + Number(isoDate.slice(8, 10)) + "</span>"
                    + "<span class='day-progress'>" + doneCount + "/" + required.length + "</span>"
                    + calendarTooltipHtml(isoDate)
                    + "</button>";
            }).join("");
        $("backfillCalendarGrid").innerHTML = html;
        $("backfillCalendarGrid").querySelectorAll("[data-date]").forEach((button) => {
            button.addEventListener("click", () => {
                const date = button.dataset.date;
                if (!date || date > state.today) return;
                setFlowModalOpen("backfillCalendarModal", false);
                openChooser(date);
            });
        });
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
        el.style.display = message ? "" : "none";
    }

    function setFlowModalOpen(id, open) {
        const modal = $(id);
        if (!modal) return;
        modal.classList.toggle("active", Boolean(open));
        modal.setAttribute("aria-hidden", open ? "false" : "true");
    }

    function closeFlowModals() {
        if ($("prespisokModal") && $("prespisokModal").classList.contains("active") && state.prespisok) {
            if (state.prespisok.timerStartedAt) {
                state.prespisok.elapsedBeforeMs = prespisokElapsedMs();
                state.prespisok.timerStartedAt = 0;
            }
            if (state.prespisok.itemTimerStartedAt) {
                state.prespisok.itemElapsedBeforeMs = prespisokItemElapsedMs();
                state.prespisok.itemTimerStartedAt = 0;
            }
            persistPrespisokState();
        }
        setFlowModalOpen("shiftOpeningModal", false);
        setFlowModalOpen("actualizeTasksModal", false);
        setFlowModalOpen("moduleChooser", false);
        setFlowModalOpen("uploadWork", false);
        setFlowModalOpen("masterWork", false);
        setFlowModalOpen("backfillCalendarModal", false);
        setFlowModalOpen("reviewSectionModal", false);
        setFlowModalOpen("taskDetailModal", false);
        setFlowModalOpen("editTareTaskModal", false);
        setFlowModalOpen("deferTaskModal", false);
        setFlowModalOpen("reopenConfirmModal", false);
        setFlowModalOpen("splitShkConfirmModal", false);
        setFlowModalOpen("inactiveTasksModal", false);
        setFlowModalOpen("specialInfoModal", false);
        setFlowModalOpen("prespisokModal", false);
        if (state.prespisok && state.prespisok.clockTimer) {
            clearInterval(state.prespisok.clockTimer);
            state.prespisok.clockTimer = null;
        }
    }

    function shiftLabel(isoDate) {
        return formatRuDate(isoDate || state.today);
    }

    function shiftTargetPureDate() {
        return addDays(state.today, -1);
    }

    function employeeById(id) {
        const target = normalizeText(id);
        return (state.shift.employees || []).find((employee) => normalizeText(employee.id) === target || normalizeText(employee.employee_id) === target) || null;
    }

    function employeeNameById(id) {
        const employee = employeeById(id);
        return employee ? normalizeText(employee.full_name) : "";
    }

    function renderShiftGate() {
        const banner = $("shiftGateBanner");
        const title = $("shiftGateTitle");
        const text = $("shiftGateText");
        const openButton = $("openShiftFromBanner");
        const uploads = $("openUploads");
        if (!banner || !title || !text || !uploads) return;
        const shift = state.shift.current;
        uploads.classList.toggle("is-disabled", !shift);
        uploads.disabled = !shift;
        banner.classList.remove("good");
        if (state.shift.loading) {
            banner.classList.remove("visible");
            title.textContent = "Проверяю смену";
            text.textContent = "Смотрю, открыта ли смена за " + shiftLabel(state.today) + ".";
            if (openButton) openButton.style.display = "none";
            return;
        }
        if (shift) {
            banner.classList.remove("visible");
            title.textContent = "";
            text.textContent = "";
            if (openButton) openButton.style.display = "none";
            return;
        }
        banner.classList.add("visible");
        if (state.shift.error) {
            title.textContent = "Не удалось проверить смену";
            text.textContent = state.shift.error;
            if (openButton) openButton.style.display = "";
            return;
        }
        title.textContent = "Смену нужно открыть";
        text.textContent = "Смена за " + shiftLabel(state.today) + " не открыта. Открой смену, чтобы включить выгрузки и назначение ответственных.";
        if (openButton) openButton.style.display = "";
    }

    async function loadShiftState() {
        const db = supabaseDb();
        if (!db) {
            renderShiftGate();
            return;
        }
        state.shift.loading = true;
        renderShiftGate();
        try {
            const [employeesResult, shiftsResult] = await Promise.all([
                db.from(WMS_EMPLOYEES_TABLE).select("*").eq("is_active", true).order("full_name", { ascending: true }),
                db.from(WMS_SHIFTS_TABLE).select("*").eq("wh_id", WH_ID).eq("shift_date", state.today).neq("status", "cancelled").order("opened_at", { ascending: false }).limit(1),
            ]);
            if (employeesResult.error) throw employeesResult.error;
            if (shiftsResult.error) throw shiftsResult.error;
            state.shift.error = "";
            state.shift.employees = Array.isArray(employeesResult.data) ? employeesResult.data : [];
            const shift = Array.isArray(shiftsResult.data) && shiftsResult.data.length ? shiftsResult.data[0] : null;
            state.shift.current = shift ? {
                ...shift,
                incoming_name: employeeNameById(shift.incoming_employee_id),
                outgoing_name: employeeNameById(shift.outgoing_employee_id),
            } : null;
        } catch (error) {
            console.error("wms shift state failed:", error);
            state.shift.current = null;
            state.shift.error = (error && error.message ? error.message : String(error)) + ". Проверь, что миграция WMS shifts применена.";
        } finally {
            state.shift.loading = false;
            renderShiftGate();
        }
    }

    function showHome() {
        state.view = "home";
        closeFlowModals();
        $("tasksHome").style.display = "grid";
        $("uploadsPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
    }

    async function showUploads() {
        if (!state.shift.current) {
            toast("Сначала нужно открыть смену.", "error");
            openShiftOpeningModal();
            return;
        }
        state.view = "uploads";
        closeFlowModals();
        $("tasksHome").style.display = "none";
        $("reviewPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
        $("uploadsPage").classList.add("active");
        $("uploadsStatus").textContent = "Загружаю журнал и настройки...";
        const ok = await loadUploadMeta();
        if (ok) $("uploadsStatus").textContent = "Готово. Задачи сохраняются в WMS+ Supabase.";
    }

    function showReviewPage() {
        state.view = "review";
        closeFlowModals();
        $("tasksHome").style.display = "none";
        $("uploadsPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
        $("reviewPage").classList.add("active");
        renderReview();
        void loadReviewTasks();
    }

    function showInactivePage() {
        state.view = "inactive";
        closeFlowModals();
        $("tasksHome").style.display = "none";
        $("uploadsPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("inactivePage").classList.add("active");
        renderInactive();
        void loadInactiveTasks();
    }

    function setShiftOpeningStatus(message, type) {
        const el = $("shiftOpeningStatus");
        if (!el) return;
        el.textContent = message || "";
        el.className = "status-line" + (type ? " " + type : "");
    }

    function fillShiftSelects() {
        const options = "<option value=''>Выберите сотрудника</option>" + (state.shift.employees || [])
            .map((employee) => "<option value='" + escapeHtml(employee.id) + "'>" + escapeHtml(employee.full_name + (employee.employee_id ? " · " + employee.employee_id : "")) + "</option>")
            .join("");
        if ($("shiftIncomingSelect")) $("shiftIncomingSelect").innerHTML = options;
        if ($("shiftOutgoingSelect")) $("shiftOutgoingSelect").innerHTML = options;
    }

    async function openShiftOpeningModal() {
        if (!state.shift.employees.length) await loadShiftState();
        closeFlowModals();
        fillShiftSelects();
        state.shift.pureRows = [];
        state.shift.pureStats = null;
        state.shift.purePrepared = null;
        state.shift.pureFileName = "";
        if ($("shiftPureLossesFile")) $("shiftPureLossesFile").value = "";
        if ($("shiftPureLossesFileName")) $("shiftPureLossesFileName").textContent = "Файл пока не выбран";
        if ($("shiftPureStats")) $("shiftPureStats").innerHTML = "";
        if ($("shiftPureDetails")) $("shiftPureDetails").innerHTML = "";
        if ($("shiftOpeningSubtitle")) {
            $("shiftOpeningSubtitle").textContent = "Смена за " + formatRuDate(state.today) + ". Чистые списания будут взяты за " + formatRuDate(shiftTargetPureDate()) + ".";
        }
        setShiftOpeningStatus("Выберите ответственных и загрузите файл чистых списаний.");
        updateShiftOpeningForm();
        setFlowModalOpen("shiftOpeningModal", true);
    }

    function closeShiftOpeningModal() {
        setFlowModalOpen("shiftOpeningModal", false);
    }

    function updateShiftOpeningForm() {
        const incoming = normalizeText($("shiftIncomingSelect") && $("shiftIncomingSelect").value);
        const outgoing = normalizeText($("shiftOutgoingSelect") && $("shiftOutgoingSelect").value);
        const button = $("saveShiftOpening");
        const ready = Boolean(incoming && outgoing && state.shift.purePrepared && !state.shift.saving);
        if (button) {
            button.disabled = !ready;
            button.title = ready ? "" : "Нужно выбрать ответственных и загрузить чистые списания.";
        }
    }

    async function handleShiftPureLossesFile(file) {
        if (!file) return;
        state.shift.pureFileName = file.name;
        if ($("shiftPureLossesFileName")) $("shiftPureLossesFileName").textContent = "Файл выбран: " + file.name;
        setShiftOpeningStatus("Читаю чистые списания...");
        try {
            const rows = await readObjectWorkbookRows(file);
            const autoLrSet = await loadPureAutoLossReasonIds();
            const prepared = preparePureLossesRows(rows, WH_ID, shiftTargetPureDate(), autoLrSet);
            state.shift.pureRows = rows;
            state.shift.purePrepared = prepared;
            state.shift.pureStats = prepared.stats;
            renderShiftPureStats(prepared.stats);
            const candidates = prepared.rowsByKey.size;
            const posted = prepared.postedRowsByKey.size;
            setShiftOpeningStatus("Файл разобран. К добавлению: " + candidates + " ШК. Сигналы движения/оприхода: " + posted + ".", candidates || posted ? "good" : "");
        } catch (error) {
            console.error("shift pure losses file failed:", error);
            state.shift.pureRows = [];
            state.shift.purePrepared = null;
            state.shift.pureStats = null;
            if ($("shiftPureStats")) $("shiftPureStats").innerHTML = "";
            if ($("shiftPureDetails")) $("shiftPureDetails").innerHTML = "";
            setShiftOpeningStatus("Не удалось разобрать файл: " + (error && error.message ? error.message : String(error)), "error");
        } finally {
            updateShiftOpeningForm();
        }
    }

    function renderShiftPureStats(stats) {
        if (!stats) return;
        if ($("shiftPureStats")) {
            const cards = [
                ["Строк в файле", stats.source_total_rows],
                ["Строк за " + formatRuDate(shiftTargetPureDate()), stats.target_date_rows],
                ["Наш СЦ", stats.wh_matched_rows],
                ["К добавлению", stats.candidate_rows],
                ["Сумма", formatMoney(stats.candidate_sum_price || 0)],
                ["Оприход-сигналы", stats.posted_signals],
                ["Дубли в файле", stats.duplicate_in_file_ignored],
                ["Отсечено не авто", stats.skipped_by_is_auto],
            ];
            $("shiftPureStats").innerHTML = cards.map(([label, value]) => "<div class='mini-stat'><div class='mini-stat-label'>" + escapeHtml(label) + "</div><div class='mini-stat-value'>" + escapeHtml(value) + "</div></div>").join("");
        }
        if ($("shiftPureDetails")) {
            $("shiftPureDetails").innerHTML = shiftCounterBox("ЛР", stats.by_lr)
                + shiftCounterBox("Статусы перед списанием", stats.by_status_before_lost);
        }
    }

    function shiftCounterBox(title, rows) {
        const body = (rows || []).slice(0, 10).map((row) => "<div class='shift-list-row'><span>" + escapeHtml(row.key || "-") + "</span><strong>" + escapeHtml(row.count || 0) + " ШК · " + escapeHtml(formatMoney(row.price || 0)) + "</strong></div>").join("");
        return "<div class='shift-list-box'><p class='shift-list-title'>" + escapeHtml(title) + "</p>" + (body || "<div class='shift-list-row'><span>Нет данных</span><strong>0</strong></div>") + "</div>";
    }

    async function saveShiftOpening() {
        const db = supabaseDb();
        if (!db) return;
        const incomingId = normalizeText($("shiftIncomingSelect") && $("shiftIncomingSelect").value);
        const outgoingId = normalizeText($("shiftOutgoingSelect") && $("shiftOutgoingSelect").value);
        if (!incomingId || !outgoingId || !state.shift.purePrepared) {
            setShiftOpeningStatus("Нужно выбрать ответственных и загрузить чистые списания.", "error");
            return;
        }
        const incoming = employeeById(incomingId);
        const outgoing = employeeById(outgoingId);
        const button = $("saveShiftOpening");
        state.shift.saving = true;
        if (button) button.disabled = true;
        setShiftOpeningStatus("Сохраняю чистые списания и открываю смену...");
        try {
            const pureImport = await applyPureLossesImport(state.shift.purePrepared, WH_ID, shiftTargetPureDate());
            const user = currentWmsUser();
            const payload = {
                wh_id: WH_ID,
                shift_date: state.today,
                shift_key: WH_ID + ":" + state.today,
                shift_label: formatRuDate(state.today),
                status: "opened",
                incoming_employee_id: incomingId,
                outgoing_employee_id: outgoingId,
                incoming_process: "Входящий поток",
                outgoing_process: "Исходящий поток",
                file_uploaded: true,
                file_name: state.shift.pureFileName || "",
                opened_by: [user.name, user.id].filter(Boolean).join(" / ") || null,
                source: "wms_tasks_page",
                payload: {
                    pure_losses_date_mode: "previous_shift_date",
                    pure_losses_target_date: shiftTargetPureDate(),
                    pure_losses_stats: state.shift.pureStats || {},
                    pure_losses_import: pureImport,
                },
            };
            const existingResult = await db.from(WMS_SHIFTS_TABLE).select("id").eq("wh_id", WH_ID).eq("shift_date", state.today).neq("status", "cancelled").limit(1);
            if (existingResult.error) throw existingResult.error;
            const existing = Array.isArray(existingResult.data) && existingResult.data[0] ? existingResult.data[0] : null;
            const result = existing
                ? await db.from(WMS_SHIFTS_TABLE).update(payload).eq("id", existing.id).select("*").single()
                : await db.from(WMS_SHIFTS_TABLE).insert(payload).select("*").single();
            if (result.error) throw result.error;
            state.shift.current = {
                ...(result.data || payload),
                incoming_name: incoming ? incoming.full_name : "",
                outgoing_name: outgoing ? outgoing.full_name : "",
            };
            renderShiftGate();
            closeShiftOpeningModal();
            toast("Смена открыта. Чистые списания обработаны: +" + pureImport.inserted_new + ", движение: " + pureImport.auto_marked_found + ".", "success");
        } catch (error) {
            console.error("shift opening save failed:", error);
            setShiftOpeningStatus("Не удалось открыть смену: " + (error && error.message ? error.message : String(error)), "error");
        } finally {
            state.shift.saving = false;
            updateShiftOpeningForm();
        }
    }

    async function loadReviewTasks() {
        const db = supabaseDb();
        if (!db) {
            setReviewStatus("Supabase SDK не загрузился.", "error");
            return;
        }
        state.review.loading = true;
        renderReview();
        try {
            state.review.rows = await fetchReviewTaskRows(db);
            state.review.loaded = true;
            const grouped = reviewGroupedRows();
            if (!state.review.activeSection || !(grouped.get(state.review.activeSection) || []).length) {
                state.review.activeSection = REVIEW_SECTIONS.find((section) => (grouped.get(section) || []).length) || REVIEW_SECTIONS[0];
            }
            setReviewStatus("Загружено активных задач: " + state.review.rows.length + ".");
        } catch (error) {
            console.error("wms review load failed:", error);
            state.review.rows = [];
            setReviewStatus("Не удалось загрузить задачи: " + (error && error.message ? error.message : String(error)), "error");
        } finally {
            state.review.loading = false;
            renderReview();
            if ($("reviewSectionModal") && $("reviewSectionModal").classList.contains("active")) renderReviewTable(reviewGroupedRows());
        }
    }

    async function fetchReviewTaskRows(db) {
        const rows = await fetchWmsTaskRows(db, "active");
        return rows.filter(isActiveReviewTask);
    }

    function setActualizeStatus(message, type) {
        const el = $("actualizeStatus");
        if (!el) return;
        el.textContent = message || "";
        el.className = "status-line" + (type ? " " + type : "");
    }

    async function openActualizeTasksModal() {
        closeFlowModals();
        state.actualize = { copied: false, rows: [], candidates: [], removedShks: new Set(), tareActions: {}, stats: null, supersetDebug: null, processing: false };
        if ($("actualizeSupersetFile")) $("actualizeSupersetFile").value = "";
        if ($("actualizeUploadLabel")) $("actualizeUploadLabel").classList.add("hidden");
        if ($("actualizeResults")) $("actualizeResults").innerHTML = "";
        setActualizeStatus("Сначала скопируйте список активных ШК.");
        setFlowModalOpen("actualizeTasksModal", true);
        if (!state.review.loaded && !state.review.loading) await loadReviewTasks();
    }

    function closeActualizeTasksModal() {
        setFlowModalOpen("actualizeTasksModal", false);
    }

    function activeTaskShkList() {
        const shks = new Set();
        (state.review.rows || []).filter(isActiveReviewTask).forEach((row) => {
            taskItems(row).forEach((item) => {
                const shk = normalizeIdentifier(item.shk);
                if (shk) shks.add(shk);
            });
        });
        return Array.from(shks).sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
    }

    async function copyActiveShkForActualize() {
        if (!state.review.loaded && !state.review.loading) await loadReviewTasks();
        const ids = activeTaskShkList();
        if (!ids.length) {
            setActualizeStatus("Активных ШК в задачах не нашел.", "error");
            return;
        }
        const copied = await copyText(ids.join("\n"));
        state.actualize.copied = copied;
        if ($("actualizeUploadLabel")) $("actualizeUploadLabel").classList.toggle("hidden", !copied);
        setActualizeStatus(copied ? "Скопировано активных ШК: " + ids.length + ". Теперь добавьте XLSX из Superset." : "Браузер заблокировал копирование. Попробуйте еще раз.", copied ? "good" : "error");
    }

    async function handleActualizeSupersetFile(file) {
        if (!file) return;
        if (!state.review.loaded && !state.review.loading) await loadReviewTasks();
        setActualizeStatus("Читаю Superset...");
        try {
            const rows = await readSupersetRows(file);
            state.actualize.rows = rows;
            state.actualize.stats = actualizeSupersetStats(rows);
            state.actualize.candidates = buildMovementCandidates(rows);
            state.actualize.removedShks = new Set();
            state.actualize.tareActions = {};
            renderActualizeResults();
        } catch (error) {
            console.error("actualize superset failed:", error);
            setActualizeStatus("Не удалось разобрать Superset: " + (error && error.message ? error.message : String(error)), "error");
        }
    }

    async function readSupersetRows(file) {
        if (typeof window.XLSX === "undefined") throw new Error("Не загрузилась библиотека XLSX. Обновите страницу и попробуйте еще раз.");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("В файле не найдено листов.");
        const sheet = workbook.Sheets[firstSheetName];
        normalizeWorksheetRange(sheet);
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
        const headerIndex = findSupersetHeaderIndex(rows);
        const headerMap = buildSupersetHeaderMap(rows[headerIndex] || []);
        state.actualize.supersetDebug = {
            sheet_name: firstSheetName,
            range: sheet["!ref"] || "",
            raw_rows: rows.length,
            data_rows: Math.max(rows.length - headerIndex - 1, 0),
            header_row: headerIndex + 1,
            shk_column: excelColumnName(Number.isInteger(headerMap.shk) ? headerMap.shk : 2),
            office_column: excelColumnName(Number.isInteger(headerMap.last_office) ? headerMap.last_office : 13),
            status_column: excelColumnName(Number.isInteger(headerMap.last_status) ? headerMap.last_status : 18),
            date_column: excelColumnName(Number.isInteger(headerMap.last_status_at) ? headerMap.last_status_at : 19),
        };
        return rows.slice(headerIndex + 1).map((row, index) => normalizeSupersetRow(row, headerIndex + index + 2, headerMap)).filter((row) => row && row.shk);
    }

    function normalizeWorksheetRange(sheet) {
        if (!sheet || typeof window.XLSX === "undefined") return;
        let minRow = Infinity;
        let minCol = Infinity;
        let maxRow = -1;
        let maxCol = -1;
        Object.keys(sheet).forEach((key) => {
            if (!/^[A-Z]+[0-9]+$/i.test(key)) return;
            const cell = sheet[key];
            if (!cell || (cell.v === undefined && cell.w === undefined && cell.f === undefined)) return;
            const decoded = XLSX.utils.decode_cell(key);
            minRow = Math.min(minRow, decoded.r);
            minCol = Math.min(minCol, decoded.c);
            maxRow = Math.max(maxRow, decoded.r);
            maxCol = Math.max(maxCol, decoded.c);
        });
        if (!Number.isFinite(minRow) || maxRow < 0 || maxCol < 0) return;
        sheet["!ref"] = XLSX.utils.encode_range({ s: { r: minRow, c: minCol }, e: { r: maxRow, c: maxCol } });
    }

    function findSupersetHeaderIndex(rows) {
        const max = Math.min((rows || []).length, 30);
        for (let i = 0; i < max; i += 1) {
            const line = (rows[i] || []).map(normalizeText).join(" ").toLowerCase();
            if (line.includes("шк") && line.includes("дата посл")) return i;
        }
        return 0;
    }

    function buildSupersetHeaderMap(headerRow) {
        const map = {};
        const normalizedCells = (headerRow || []).map((cell) => normalizeHeaderKey(cell));
        Object.entries(SUPERSET_NORMALIZED_COLUMN_VARIANTS).forEach(([key, variants]) => {
            const directIndex = normalizedCells.findIndex((cell) => variants.includes(cell));
            if (directIndex >= 0) {
                map[key] = directIndex;
                return;
            }
            if (key === "shk") return;
            const fuzzyIndex = normalizedCells.findIndex((cell) => variants.some((variant) => variant.length > 4 && (cell === variant || cell.endsWith(variant))));
            if (fuzzyIndex >= 0) map[key] = fuzzyIndex;
        });
        return map;
    }

    function excelColumnName(zeroBasedIndex) {
        let index = Number(zeroBasedIndex);
        if (!Number.isInteger(index) || index < 0) return "-";
        let name = "";
        index += 1;
        while (index > 0) {
            const mod = (index - 1) % 26;
            name = String.fromCharCode(65 + mod) + name;
            index = Math.floor((index - mod) / 26);
        }
        return name;
    }

    function supersetCell(row, headerMap, key, fallbackIndex) {
        const mappedIndex = Number.isInteger(headerMap && headerMap[key]) ? headerMap[key] : fallbackIndex;
        return row[mappedIndex];
    }

    function normalizeSupersetRow(row, rowNumber, headerMap) {
        const shk = normalizeIdentifier(supersetCell(row, headerMap, "shk", 2));
        if (!shk) return null;
        const statusAtRaw = supersetCell(row, headerMap, "last_status_at", 19);
        const statusAt = parseDateTime(statusAtRaw);
        return {
            row_number: rowNumber,
            shk,
            brand: normalizeText(supersetCell(row, headerMap, "brand", 3)),
            name: normalizeText(supersetCell(row, headerMap, "name", 4)),
            article: normalizeText(supersetCell(row, headerMap, "article", 5)),
            size: normalizeText(supersetCell(row, headerMap, "size", 6)),
            nm: normalizeIdentifier(supersetCell(row, headerMap, "nm", 7)),
            supplier: normalizeText(supersetCell(row, headerMap, "supplier", 8)),
            price: normalizePrice(supersetCell(row, headerMap, "price", 9)),
            currency: normalizeText(supersetCell(row, headerMap, "currency", 10)),
            price_source: normalizeText(supersetCell(row, headerMap, "price_source", 11)),
            srid: normalizeText(supersetCell(row, headerMap, "srid", 12)),
            last_office: normalizeIdentifier(supersetCell(row, headerMap, "last_office", 13)),
            last_mx: normalizeText(supersetCell(row, headerMap, "last_mx", 14)),
            place: normalizeText(supersetCell(row, headerMap, "place", 15)),
            last_tare: normalizeIdentifier(supersetCell(row, headerMap, "last_tare", 16)),
            previous_tare: normalizeIdentifier(supersetCell(row, headerMap, "previous_tare", 17)),
            last_status: normalizeText(supersetCell(row, headerMap, "last_status", 18)),
            last_status_at: normalizeText(statusAtRaw),
            last_status_iso: statusAt.iso,
            last_status_ts: statusAt.ts || 0,
        };
    }

    function latestSupersetByShk(rows) {
        const map = new Map();
        (rows || []).forEach((row) => {
            const previous = map.get(row.shk);
            if (!previous || (row.last_status_ts || 0) >= (previous.last_status_ts || 0)) map.set(row.shk, row);
        });
        return map;
    }

    function itemMovementTs(row, item) {
        const itemTs = parseDateTime(item && item.movement).ts || 0;
        const rowTs = parseDateTime(row && row.source_last_movement_at).ts || 0;
        return Math.max(itemTs, rowTs);
    }

    function itemMovementInfo(row, item) {
        const itemRaw = normalizeText(item && item.movement);
        const rowRaw = normalizeText(row && row.source_last_movement_at);
        const itemParsed = parseDateTime(itemRaw);
        const rowParsed = parseDateTime(rowRaw);
        if (itemParsed.ts && (!rowParsed.ts || itemParsed.ts >= rowParsed.ts)) return { raw: itemRaw, ts: itemParsed.ts, label: formatRuDateTime(itemRaw) };
        if (rowParsed.ts) return { raw: rowRaw, ts: rowParsed.ts, label: formatRuDateTime(rowRaw) };
        const raw = itemRaw || rowRaw;
        return { raw, ts: 0, label: raw || "-" };
    }

    function movementTimeInfo(row, item, supersetRow) {
        const taskMovement = itemMovementInfo(row, item);
        const supersetRaw = normalizeText(supersetRow && (supersetRow.last_status_iso || supersetRow.last_status_at));
        const supersetParsed = parseDateTime(supersetRaw);
        const supersetTs = Number(supersetRow && supersetRow.last_status_ts) || supersetParsed.ts || 0;
        const deltaMs = taskMovement.ts && supersetTs ? supersetTs - taskMovement.ts : null;
        return {
            taskMovement,
            supersetTs,
            supersetLabel: supersetTs ? formatRuDateTime(supersetRaw || new Date(supersetTs).toISOString()) : (supersetRaw || "-"),
            deltaMs,
            canAutoClose: Number.isFinite(deltaMs) && deltaMs >= MOVEMENT_AUTO_CLOSE_MIN_MS,
        };
    }

    function formatMovementDelta(deltaMs) {
        if (!Number.isFinite(deltaMs)) return "разница не определена";
        const sign = deltaMs >= 0 ? "+" : "-";
        const totalMinutes = Math.floor(Math.abs(deltaMs) / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours) return sign + hours + " ч " + minutes + " мин";
        return sign + minutes + " мин";
    }

    function movementChangeList(row, item, supersetRow) {
        if (!supersetRow) return [];
        const changes = [];
        const beforeStatus = normalizeText(item && item.status);
        const afterStatus = normalizeText(supersetRow.last_status);
        const beforeCode = statusCode(beforeStatus);
        const afterCode = statusCode(afterStatus);
        const statusChanged = beforeCode && afterCode
            ? beforeCode !== afterCode
            : normalizeForMatch(beforeStatus) && normalizeForMatch(afterStatus) && normalizeForMatch(beforeStatus) !== normalizeForMatch(afterStatus);
        if (statusChanged) {
            changes.push({ reason: "статус изменился", label: "Статус", before: beforeStatus || "-", after: afterStatus || "-" });
        }
        const time = movementTimeInfo(row, item, supersetRow);
        if (time.supersetTs && time.taskMovement.ts) {
            changes.push({
                reason: time.canAutoClose ? "дата позже минимум на " + MOVEMENT_AUTO_CLOSE_MINUTES + " минут" : "дата без достаточного сдвига",
                label: "Дата движения",
                before: time.taskMovement.label || "-",
                after: time.supersetLabel + " (" + formatMovementDelta(time.deltaMs) + ")",
            });
        }
        const office = normalizeIdentifier(supersetRow.last_office);
        if (office && office !== WH_ID) {
            changes.push({ reason: "офис не " + WH_ID, label: "Офис последнего МХ", before: WH_ID, after: office });
        }
        return changes;
    }

    function movementReasonList(row, item, supersetRow) {
        if (!movementTimeInfo(row, item, supersetRow).canAutoClose) return [];
        return movementChangeList(row, item, supersetRow).map((change) => change.reason);
    }

    function hasConfirmedMovement(row, item, supersetRow) {
        return movementTimeInfo(row, item, supersetRow).canAutoClose;
    }

    function buildMovementCandidates(supersetRows) {
        const byShk = latestSupersetByShk(supersetRows);
        const candidates = [];
        (state.review.rows || []).filter(isActiveReviewTask).forEach((row) => {
            const items = taskItems(row);
            const moved = items
                .map((item) => ({ row, item, superset: byShk.get(item.shk) || null }))
                .filter((entry) => hasConfirmedMovement(row, entry.item, entry.superset));
            if (!moved.length) return;
            const stationary = items.filter((item) => !moved.some((entry) => entry.item.shk === item.shk));
            candidates.push({
                row,
                moved,
                stationary,
                allItems: items,
                type: isTareTask(row) && stationary.length ? "tare_partial" : isTareTask(row) ? "tare_full" : "single",
            });
        });
        return candidates;
    }

    function actualizeSupersetStats(rows) {
        const active = new Set(activeTaskShkList());
        let matchedActive = 0;
        let outsideOffice = 0;
        let matchedOutsideOffice = 0;
        let emptyOffice = 0;
        (rows || []).forEach((row) => {
            const isActive = active.has(normalizeIdentifier(row.shk));
            if (isActive) matchedActive += 1;
            const office = normalizeIdentifier(row.last_office);
            if (!office) emptyOffice += 1;
            if (office && office !== WH_ID) {
                outsideOffice += 1;
                if (isActive) matchedOutsideOffice += 1;
            }
        });
        return {
            rows: (rows || []).length,
            active_shks: active.size,
            matched_active: matchedActive,
            outside_office: outsideOffice,
            matched_outside_office: matchedOutsideOffice,
            empty_office: emptyOffice,
        };
    }

    function actualizeStatsLine() {
        const stats = state.actualize.stats;
        if (!stats) return "";
        return "Проверено строк: " + stats.rows
            + ". Активных ШК в задачах: " + stats.active_shks
            + ". Найдено совпадений: " + stats.matched_active
            + ". С другим офисом в Superset: " + stats.matched_outside_office + ".";
    }

    function actualizeSummaryHtml(candidates) {
        const stats = state.actualize.stats;
        if (!stats) return "";
        const movedCount = (candidates || []).reduce((sum, candidate) => sum + (candidate.moved || []).length, 0);
        const partialCount = (candidates || []).filter((candidate) => candidate.type === "tare_partial").length;
        return "<div class='actualize-summary'>"
            + "<div><strong>" + escapeHtml(String(stats.rows)) + "</strong><span>строк проверено</span></div>"
            + "<div><strong>" + escapeHtml(String(stats.matched_active)) + "</strong><span>активных ШК найдено</span></div>"
            + "<div><strong>" + escapeHtml(String(movedCount)) + "</strong><span>ШК с движением +10 мин</span></div>"
            + "<div><strong>" + escapeHtml(String(partialCount)) + "</strong><span>частичных тар</span></div>"
            + "</div>";
    }

    function actualizeCandidateTitle(candidate) {
        const row = candidate.row;
        if (!isTareTask(row)) return row.title || (candidate.moved[0] && candidate.moved[0].item.shk) || "-";
        return "Тара " + (normalizeIdentifier(row.source_tare_id) || normalizeIdentifier(taskPayload(row).tare_id || taskPayload(row).transfer) || row.title || "-");
    }

    function movementRowHtml(entry) {
        const shk = normalizeIdentifier(entry.item.shk);
        const removed = state.actualize.removedShks.has(shk);
        const changes = movementChangeList(entry.row, entry.item, entry.superset);
        const changeHtml = changes.length
            ? changes.map((change) => "<div class='movement-change'><span>" + escapeHtml(change.label) + "</span><strong>" + escapeHtml(change.before) + " → " + escapeHtml(change.after) + "</strong></div>").join("")
            : "<div class='movement-change'><span>Изменение</span><strong>Не определено</strong></div>";
        const meta = "МХ по Superset: " + ((entry.superset && entry.superset.last_mx) || "-");
        return "<div class='movement-row" + (removed ? " removed" : "") + "'>"
            + "<div class='movement-main'>" + escapeHtml(shk) + "<div class='movement-change-list'>" + changeHtml + "</div><div class='movement-meta'>" + escapeHtml(meta) + "</div></div>"
            + "<button class='btn btn-square' type='button' data-remove-movement='" + escapeHtml(shk) + "' title='Убрать из подтверждения'>−</button>"
            + "</div>";
    }

    function renderActualizeResults() {
        const target = $("actualizeResults");
        if (!target) return;
        const candidates = state.actualize.candidates || [];
        const statsLine = actualizeStatsLine();
        if (!candidates.length) {
            target.innerHTML = actualizeSummaryHtml(candidates) + "<div class='empty-state'>Активных задач с движением минимум на 10 минут позже исходных данных не найдено. " + escapeHtml(statsLine) + "</div>";
            setActualizeStatus("Superset прочитан. Кандидатов на закрытие нет.", "good");
            return;
        }
        const full = candidates.filter((candidate) => candidate.type !== "tare_partial");
        const partial = candidates.filter((candidate) => candidate.type === "tare_partial");
        const fullHtml = full.map((candidate) => "<div class='shift-list-box'><p class='shift-list-title'>" + escapeHtml(actualizeCandidateTitle(candidate)) + "</p><div class='movement-list'>" + candidate.moved.map(movementRowHtml).join("") + "</div></div>").join("");
        const partialHtml = partial.map((candidate) => {
            const tare = actualizeCandidateTitle(candidate);
            const action = state.actualize.tareActions[candidate.row.id] || "exclude";
            const movedExample = candidate.moved[0] ? candidate.moved[0].item.shk : "-";
            const staticExample = candidate.stationary[0] ? candidate.stationary[0].shk : "-";
            return "<div class='movement-tare-card'>"
                + "<p class='shift-list-title'>" + escapeHtml(tare) + ": часть ШК получила движение</p>"
                + "<div class='movement-meta'>Пример с движением: " + escapeHtml(movedExample) + ". Пример без движения: " + escapeHtml(staticExample) + ". Получили движение: " + candidate.moved.length + ". Без движения: " + candidate.stationary.length + ".</div>"
                + "<div class='movement-list'>" + candidate.moved.map(movementRowHtml).join("") + "</div>"
                + "<div class='movement-tare-actions'>"
                + movementActionButton(candidate.row.id, "close", "Закрыть всю задачу", action)
                + movementActionButton(candidate.row.id, "exclude", "Исключить ШК с движением", action)
                + movementActionButton(candidate.row.id, "split_remaining", "Создать задачи на оставшиеся ШК", action)
                + "</div></div>";
        }).join("");
        target.innerHTML = "<div class='status-line good'>Проверьте движения: в список попали только ШК, где время Superset минимум на 10 минут позже исходного времени задачи.</div>"
            + actualizeSummaryHtml(candidates)
            + (fullHtml ? "<h4>Полное закрытие</h4>" + fullHtml : "")
            + (partialHtml ? "<h4>Частичное движение по тарам</h4>" + partialHtml : "")
            + "<div class='file-row'><button id='closeMovementTasks' class='btn btn-rect task-complete-btn' type='button'>Закрыть задания по ШК</button></div>";
        target.querySelectorAll("[data-remove-movement]").forEach((button) => {
            button.addEventListener("click", () => {
                const shk = normalizeIdentifier(button.dataset.removeMovement);
                if (shk) state.actualize.removedShks.add(shk);
                renderActualizeResults();
            });
        });
        target.querySelectorAll("[data-tare-action]").forEach((button) => {
            button.addEventListener("click", () => {
                state.actualize.tareActions[button.dataset.tareRow || ""] = button.dataset.tareAction || "exclude";
                renderActualizeResults();
            });
        });
        const closeBtn = $("closeMovementTasks");
        if (closeBtn) closeBtn.addEventListener("click", () => { void closeMovementTasks(); });
        setActualizeStatus("Найдено задач/тар с движением: " + candidates.length + ".", "good");
    }

    function movementActionButton(rowId, action, label, current) {
        return "<button class='btn " + (current === action ? "btn-rect" : "btn-outline") + "' type='button' data-tare-row='" + escapeHtml(rowId) + "' data-tare-action='" + escapeHtml(action) + "'>" + escapeHtml(label) + "</button>";
    }

    function selectedMovedEntries(candidate) {
        return (candidate.moved || []).filter((entry) => !state.actualize.removedShks.has(normalizeIdentifier(entry.item.shk)));
    }

    async function completeTaskBySystemMovement(row, note) {
        const db = supabaseDb();
        const user = currentWmsUser();
        const now = new Date().toISOString();
        const nextPayload = {
            ...taskPayload(row),
            wms_review: {
                ...taskReviewPayload(row),
                comment: note || "Подтверждено движение по Superset",
                verdict: SYSTEM_MOVEMENT_VERDICT,
                completed_by_id: user.id || null,
                completed_by_name: user.name || null,
                completed_at: now,
                movement_confirmed_at: now,
            },
        };
        const payload = {
            task_status: "Завершено",
            opp_verdict: SYSTEM_MOVEMENT_VERDICT,
            assignee_employee_id: user.id || null,
            assignee_name: user.name || null,
            completed_at: now,
            reopen_after: null,
            source_payload: nextPayload,
            updated_at: now,
        };
        const { data, error } = await db
            .from(WMS_TASKS_TABLE)
            .update(payload)
            .eq("id", row.id)
            .select("id,source_payload,task_status,opp_verdict,assignee_employee_id,assignee_name,completed_at,reopen_after,updated_at")
            .single();
        if (error) throw error;
        refreshTaskRow(row.id, data || payload);
        state.review.rows = (state.review.rows || []).filter((item) => item.id !== row.id);
        return data || payload;
    }

    async function runLimitedPool(items, limit, worker, onProgress) {
        const list = items || [];
        const workerCount = Math.min(Math.max(Number(limit) || 1, 1), list.length);
        let cursor = 0;
        let done = 0;
        if (!workerCount) return;
        await Promise.all(Array.from({ length: workerCount }, async () => {
            while (cursor < list.length) {
                const index = cursor;
                cursor += 1;
                await worker(list[index], index);
                done += 1;
                if (onProgress) onProgress(done, list.length);
            }
        }));
    }

    async function closeMovementTasks() {
        if (state.actualize.processing) return;
        const candidates = state.actualize.candidates || [];
        if (!candidates.length) return;
        state.actualize.processing = true;
        const button = $("closeMovementTasks");
        if (button) button.disabled = true;
        setActualizeStatus("Готовлю пакет закрытия задач...");
        let completed = 0;
        let updated = 0;
        let created = 0;
        try {
            const closePlans = [];
            const updatePlans = [];
            const splitTasks = [];
            for (const candidate of candidates) {
                const selected = selectedMovedEntries(candidate);
                if (!selected.length) continue;
                const row = findTaskRow(candidate.row.id) || candidate.row;
                if (!isTareTask(row)) {
                    closePlans.push({ row, note: "Подтверждено движение ШК " + selected.map((entry) => entry.item.shk).join(", ") });
                    continue;
                }
                const selectedShks = new Set(selected.map((entry) => normalizeIdentifier(entry.item.shk)));
                const allItems = taskItems(row);
                const rest = allItems.filter((item) => !selectedShks.has(normalizeIdentifier(item.shk)));
                const action = candidate.type === "tare_partial" ? (state.actualize.tareActions[row.id] || "exclude") : (rest.length ? "exclude" : "close");
                if (action === "close" || !rest.length) {
                    closePlans.push({ row, note: "Подтверждено движение по таре: " + selected.map((entry) => entry.item.shk).join(", ") });
                } else if (action === "split_remaining") {
                    splitTasks.push(...rest.map((item) => ({
                        ...splitTaskFromTare(row, item),
                        assignee_employee_id: row.assignee_employee_id || "",
                        assignee_name: row.assignee_name || "",
                    })));
                    closePlans.push({ row, note: "По части тары подтверждено движение. Остаток вынесен в отдельные задачи." });
                } else {
                    updatePlans.push({ row, items: rest, extraPayload: {
                        movement_excluded_shks: Array.from(selectedShks),
                        movement_excluded_at: new Date().toISOString(),
                    } });
                }
            }
            const totalActions = closePlans.length + updatePlans.length + (splitTasks.length ? 1 : 0);
            if (!totalActions) {
                setActualizeStatus("Нечего закрывать: все строки убраны из подтверждения.", "good");
                return;
            }
            if (splitTasks.length) {
                const chunks = chunkArray(splitTasks, 250);
                for (let i = 0; i < chunks.length; i += 1) {
                    setActualizeStatus("Создаю отдельные задачи по остаткам: пачка " + (i + 1) + "/" + chunks.length + ", задач " + chunks[i].length + ".");
                    const { error } = await supabaseDb().rpc(SAVE_RPC, { p_tasks: chunks[i], p_run: {} });
                    if (error) throw error;
                    created += chunks[i].length;
                }
            }
            if (closePlans.length) {
                setActualizeStatus("Закрываю задачи: 0/" + closePlans.length + "...");
                await runLimitedPool(closePlans, 8, async (plan) => {
                    await completeTaskBySystemMovement(plan.row, plan.note);
                    completed += 1;
                }, (done, total) => {
                    setActualizeStatus("Закрываю задачи: " + done + "/" + total + ". Обновлено тар: " + updated + ". Создано задач: " + created + ".");
                });
            }
            if (updatePlans.length) {
                setActualizeStatus("Обновляю частичные тары: 0/" + updatePlans.length + "...");
                await runLimitedPool(updatePlans, 5, async (plan) => {
                    await updateTareTaskItems(plan.row, plan.items, plan.extraPayload);
                    updated += 1;
                }, (done, total) => {
                    setActualizeStatus("Обновляю частичные тары: " + done + "/" + total + ". Закрыто задач: " + completed + ". Создано задач: " + created + ".");
                });
            }
            await loadReviewTasks();
            state.actualize.candidates = [];
            if ($("actualizeResults")) {
                $("actualizeResults").innerHTML = "<div class='status-line good'>Готово. Завершено задач: " + completed + ". Обновлено тар: " + updated + ". Создано задач: " + created + ".</div>";
            }
            setActualizeStatus("Готово. Завершено задач: " + completed + ". Обновлено тар: " + updated + ". Создано задач: " + created + ".", "good");
            if ($("reviewSectionModal") && $("reviewSectionModal").classList.contains("active")) renderReviewTable(reviewGroupedRows());
        } catch (error) {
            console.error("actualize close movement failed:", error);
            setActualizeStatus("Не удалось закрыть задачи: " + (error && error.message ? error.message : String(error)), "error");
        } finally {
            state.actualize.processing = false;
            if (button) button.disabled = false;
        }
    }

    async function fetchWmsTaskRows(db, mode) {
        const pageSize = 1000;
        const maxRows = 20000;
        const rows = [];
        for (let from = 0; from < maxRows; from += pageSize) {
            let query = db
                .from(WMS_TASKS_TABLE)
                .select(WMS_TASK_SELECT_COLUMNS)
                .eq("is_deleted", false);
            if (mode === "active") query = query.or("task_status.is.null,task_status.neq.Завершено");
            if (mode === "inactive") query = query.in("task_status", ["Завершено", "Отложено"]);
            const { data, error } = await query
                .order("source_price_sum", { ascending: false, nullsFirst: false })
                .range(from, from + pageSize - 1);
            if (error) throw error;
            const batch = Array.isArray(data) ? data : [];
            rows.push(...batch);
            if (batch.length < pageSize) break;
        }
        return rows;
    }

    function taskStatus(row) {
        return normalizeText(row && row.task_status) || "Не начато";
    }

    function isCompletedTask(row) {
        return taskStatus(row) === "Завершено";
    }

    function reopenTime(row) {
        const value = row && row.reopen_after ? Date.parse(row.reopen_after) : NaN;
        return Number.isFinite(value) ? value : 0;
    }

    function isWaitingReopenTask(row) {
        return taskStatus(row) === "Отложено" && reopenTime(row) > Date.now();
    }

    function isReopenedTask(row) {
        return taskStatus(row) === "Отложено" && reopenTime(row) > 0 && reopenTime(row) <= Date.now();
    }

    function isActiveReviewTask(row) {
        return !isCompletedTask(row) && !isWaitingReopenTask(row);
    }

    function displayTaskStatus(row) {
        if (isReopenedTask(row)) return "Переоткрыто";
        return taskStatus(row);
    }

    function setReviewStatus(message, type) {
        const el = $("reviewStatus");
        if (!el) return;
        el.textContent = message || "";
        el.style.color = type === "error" ? "#b91c1c" : type === "good" ? "#15803d" : "#64748b";
    }

    function taskSectionName(row) {
        const taskType = normalizeForMatch(row && row.task_type);
        const title = normalizeForMatch(row && row.title);
        const sourceModule = normalizeForMatch(row && row.source_module);
        const combined = [taskType, title, sourceModule, normalizeForMatch(row && row.upload_type)].join(" ");
        if (combined.includes("оклейка") || /\busd\b/.test(combined) || /\btmm\b/.test(combined)) return "Другие задачи";
        if (combined.includes("wmi")) return "WMI (МП + ПЦ)";
        if (combined.includes("почта")) return "Почта";
        if (combined.includes("пм") || combined.includes("pm")) return "ПМ";
        if (combined.includes("rwp")) return "RWP";
        if (combined.includes("упаковка") || combined.includes("переупаковка")) return "Упаковка";
        if (combined.includes("предсорт")) return "Предсортировка";
        if (combined.includes("маркетплейс")) return "Маркетплейс";
        if (combined.includes("пц")) return "ПЦ";
        if (combined.includes("без заказа")) return "Без заказа";
        if (combined.includes("движение после продажи")) return "Движение после продажи";
        return "Другие задачи";
    }

    function reviewGroupedRows() {
        const grouped = new Map(REVIEW_SECTIONS.map((section) => [section, []]));
        (state.review.rows || []).forEach((row) => {
            const section = grouped.has(taskSectionName(row)) ? taskSectionName(row) : "Другие задачи";
            grouped.get(section).push(row);
        });
        return grouped;
    }

    function reviewPrice(row) {
        const value = Number(row && row.source_price_sum);
        return Number.isFinite(value) ? value : 0;
    }

    function reviewTags(row) {
        const raw = row && row.tags;
        if (Array.isArray(raw)) return raw.map(normalizeText).filter(Boolean);
        if (typeof raw === "string") {
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed.map(normalizeText).filter(Boolean) : [];
            } catch (_error) {
                return raw.split(",").map(normalizeText).filter(Boolean);
            }
        }
        return [];
    }

    function isSpecialTagLabel(tag) {
        const normalized = normalizeForMatch(tag);
        return normalized === "два шк" || normalized === "пустая упаковка";
    }

    function isPrespisokTask(row) {
        const tags = reviewTags(row).map(normalizeForMatch);
        const combined = normalizeForMatch([row && row.source_module, row && row.upload_type, row && row.task_type].join(" "));
        return tags.includes("предсписок") || combined.includes("предсписок") || combined.includes("prespisok");
    }

    function reviewSourceIds(row) {
        const ids = Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids.map(normalizeIdentifier).filter(Boolean) : [];
        const tare = normalizeIdentifier(row && row.source_tare_id);
        const preview = ids.slice(0, 4).join(", ");
        const tail = ids.length > 4 ? " +" + (ids.length - 4) : "";
        return [
            tare ? "Тара: " + tare : "",
            ids.length ? "ШК: " + preview + tail : "",
            !ids.length && !tare ? normalizeText(row && row.source_id) : "",
        ].filter(Boolean).join("\n");
    }

    function priceStyle(value) {
        const price = Number(value) || 0;
        if (price >= 10000) return "background:#fee2e2;color:#7f1d1d;";
        if (price >= 5000) return "background:#ffedd5;color:#7c2d12;";
        if (price >= 1000) return "background:#fef3c7;color:#713f12;";
        if (price > 0) return "background:#dcfce7;color:#14532d;";
        return "background:#f8fafc;color:#64748b;";
    }

    function renderReview() {
        if (!$("reviewSectionsGrid") || !$("reviewTableWrap")) return;
        if (state.review.loading) {
            setReviewStatus("Загружаю задачи из Supabase...");
            $("reviewSectionsGrid").innerHTML = "";
            $("reviewTableWrap").innerHTML = "<div class='empty-state'>Загружаю задачи...</div>";
            return;
        }
        const grouped = reviewGroupedRows();
        renderReviewSections(grouped);
        renderReviewLanding(grouped);
    }

    function renderReviewSections(grouped) {
        $("reviewSectionsGrid").innerHTML = REVIEW_SECTIONS.map((section) => {
            const rows = grouped.get(section) || [];
            const total = rows.reduce((acc, row) => acc + reviewPrice(row), 0);
            const active = section === state.review.activeSection ? " active" : "";
            return "<button type='button' class='review-section-card" + active + "' data-review-section='" + escapeHtml(section) + "'>"
                + "<div class='review-section-name'><span>" + escapeHtml(section) + "</span><strong>" + rows.length + "</strong></div>"
                + "<div class='review-section-meta'>Стоимость: " + escapeHtml(formatMoney(total)) + "</div>"
                + "</button>";
        }).join("");
        $("reviewSectionsGrid").querySelectorAll("[data-review-section]").forEach((button) => {
            button.addEventListener("click", () => {
                state.review.activeSection = button.dataset.reviewSection || REVIEW_SECTIONS[0];
                renderReview();
                openReviewSectionModal();
            });
        });
    }

    function renderReviewLanding(grouped) {
        const section = state.review.activeSection || REVIEW_SECTIONS[0];
        const rows = sortedReviewRows(grouped.get(section) || []);
        if (!state.review.loaded) {
            $("reviewTableWrap").innerHTML = "<div class='empty-state'>Нажмите \"Разбор\", и WMS+ загрузит активные задачи из Supabase.</div>";
            return;
        }
        if (!rows.length) {
            $("reviewTableWrap").innerHTML = "<div class='empty-state'>Выберите участок. На выбранном участке \"" + escapeHtml(section) + "\" активных задач пока нет.</div>";
            return;
        }
        $("reviewTableWrap").innerHTML = "";
    }

    function openReviewSectionModal() {
        renderReviewTable(reviewGroupedRows());
        setFlowModalOpen("reviewSectionModal", true);
    }

    function closeReviewSectionModal() {
        setFlowModalOpen("reviewSectionModal", false);
    }

    function renderReviewTable(grouped) {
        const section = state.review.activeSection || REVIEW_SECTIONS[0];
        const rows = sortedReviewRows(grouped.get(section) || []);
        const target = $("reviewSectionTableWrap");
        if (!target) return;
        if (!state.review.loaded) {
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Разбор</h3><div class='review-table-subtitle'>Задачи еще не загружены.</div></div><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div><div class='empty-state'>Подождите загрузку задач из Supabase.</div>";
            const closeBtn = $("closeReviewSectionModal");
            if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
            return;
        }
        if (!rows.length) {
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>" + escapeHtml(section) + "</h3><div class='review-table-subtitle'>Активных задач на участке нет.</div></div><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div><div class='empty-state'>Пусто. Красиво, если это правда.</div>";
            const closeBtn = $("closeReviewSectionModal");
            if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
            return;
        }
        const body = rows.map((row) => {
            const status = displayTaskStatus(row);
            const verdict = normalizeText(row.opp_verdict);
            const route = taskRouteLabel(row);
            return "<tr class='review-click-row' data-task-detail='" + escapeHtml(row.id) + "'>"
                + "<td class='review-wrap-cell'><div class='review-task-title'>" + escapeHtml(displayTaskTitle(row)) + "</div><div class='review-task-sub'>" + escapeHtml(row.task_type || "-") + "</div>" + (route ? "<div class='review-task-route'>" + escapeHtml(route) + "</div>" : "") + "</td>"
                + "<td><span class='review-pill'>" + escapeHtml(taskEntityTypeLabel(row)) + "</span></td>"
                + "<td class='review-wrap-cell'>" + escapeHtml(taskItemName(row) || "-") + "</td>"
                + "<td class='review-price-cell' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</td>"
                + "<td><span class='review-pill'>" + escapeHtml(status) + "</span>" + (verdict && verdict !== "Не выбран" ? "<div class='review-task-sub'>Вердикт: " + escapeHtml(verdict) + "</div>" : "") + "</td>"
                + "</tr>";
        }).join("");
        target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>" + escapeHtml(section) + "</h3><div class='review-table-subtitle'>Задач: " + rows.length + ". Нажми на заголовок столбца для сортировки.</div></div><div class='file-row' style='margin-top:0'><button id='refreshReviewTasks' class='btn btn-outline' type='button'>Обновить</button><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div></div>"
            + "<div class='review-table-scroll'><table class='review-data-table'><thead><tr>"
            + reviewSortHead("title", "Задача")
            + reviewSortHead("entityType", "Тип задачи")
            + reviewSortHead("name", "Наименование")
            + reviewSortHead("price", "Стоимость")
            + reviewSortHead("status", "Статус")
            + "</tr></thead><tbody>" + body + "</tbody></table></div>";
        const refresh = $("refreshReviewTasks");
        if (refresh) refresh.addEventListener("click", () => { void loadReviewTasks(); });
        const closeBtn = $("closeReviewSectionModal");
        if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
        target.querySelectorAll("[data-review-sort]").forEach((button) => {
            button.addEventListener("click", () => {
                const key = button.dataset.reviewSort || "price";
                const current = state.review.sort || { key: "price", dir: "desc" };
                state.review.sort = current.key === key
                    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
                    : { key, dir: key === "price" ? "desc" : "asc" };
                renderReviewTable(reviewGroupedRows());
            });
        });
        target.querySelectorAll("[data-task-detail]").forEach((row) => {
            row.addEventListener("click", () => openTaskDetail(row.dataset.taskDetail, "review"));
        });
    }

    function reviewSortHead(key, label) {
        const sort = state.review.sort || { key: "price", dir: "desc" };
        const arrow = sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : "";
        return "<th><button type='button' class='review-sort-btn' data-review-sort='" + escapeHtml(key) + "'>" + escapeHtml(label + arrow) + "</button></th>";
    }

    function sortedReviewRows(rows) {
        const sort = state.review.sort || { key: "price", dir: "desc" };
        const dir = sort.dir === "asc" ? 1 : -1;
        return (rows || []).slice().sort((a, b) => {
            const av = reviewSortValue(a, sort.key);
            const bv = reviewSortValue(b, sort.key);
            if (typeof av === "number" || typeof bv === "number") return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
            return String(av || "").localeCompare(String(bv || ""), "ru", { numeric: true, sensitivity: "base" }) * dir;
        });
    }

    function reviewSortValue(row, key) {
        if (key === "price") return reviewPrice(row);
        if (key === "dueDate") return normalizeText(row && row.due_date);
        if (key === "status") return displayTaskStatus(row) + " " + (normalizeText(row && row.opp_verdict) || "");
        if (key === "verdict") return normalizeText(row && row.opp_verdict) || "Не выбран";
        if (key === "sourceIds") return reviewSourceIds(row);
        if (key === "priority") return normalizeText(row && row.priority_label) || "Без приоритета";
        if (key === "tags") return reviewTags(row).join(", ");
        if (key === "movement") return normalizeText(row && row.source_last_movement_at);
        if (key === "name") return taskItemName(row);
        if (key === "entityType") return taskEntityTypeLabel(row);
        return normalizeText(row && row.title);
    }

    function taskPayload(row) {
        const payload = row && row.source_payload;
        if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
        return {};
    }

    function taskReviewPayload(row) {
        const payload = taskPayload(row).wms_review;
        return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    }

    function normalizeTaskItem(value) {
        if (!value || typeof value !== "object") return null;
        const raw = value.raw && typeof value.raw === "object" ? value.raw : value;
        const shk = normalizeIdentifier(value.shk || raw.product || raw.shk);
        if (!shk) return null;
        return {
            shk,
            name: normalizeText(value.name || raw.name),
            status: normalizeText(value.status || raw.product_status || raw.last_status || raw.status),
            price: Number(value.price ?? raw.price) || 0,
            mx: normalizeText(value.mx || raw.mx || raw.block),
            movement: normalizeText(value.movement || raw.last_movement || raw.created_at || raw.status_at),
            row_number: value.row_number || raw.row_number || null,
            raw,
        };
    }

    function taskItems(row) {
        const payload = taskPayload(row);
        const fromPayload = Array.isArray(payload.task_items) ? payload.task_items.map(normalizeTaskItem).filter(Boolean) : [];
        if (fromPayload.length) return fromPayload;
        const sourceRows = Array.isArray(payload.rows) ? payload.rows : payload.row ? [payload.row] : [];
        const fromRows = sourceRows.map(taskItemFromSourceRow).filter(Boolean);
        if (fromRows.length) return fromRows;
        return (Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids : []).map((id) => ({ shk: normalizeIdentifier(id), name: "", status: "", price: 0, mx: "", movement: "", row_number: null, raw: {} })).filter((item) => item.shk);
    }

    function taskItemName(row) {
        const payload = taskPayload(row);
        const explicit = normalizeText(payload.item_name);
        if (explicit) return explicit;
        const names = Array.from(new Set(taskItems(row).map((item) => normalizeText(item.name)).filter(Boolean)));
        if (!names.length) return "";
        return names.length === 1 ? names[0] : names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : "");
    }

    function taskEntityTypeLabel(row) {
        return isTareTask(row) ? "Тара" : "Товар";
    }

    function taskRouteLabel(row) {
        const payload = taskPayload(row);
        return normalizeText(payload.route_label || payload.routeLabel || payload.parking || payload.place);
    }

    function isSingleShkTask(row) {
        return !isTareTask(row) && taskItems(row).length <= 1 && (Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids.length : 0) <= 1;
    }

    function findTaskRow(id) {
        return (state.review.rows || []).find((row) => row.id === id)
            || (state.inactive.rows || []).find((row) => row.id === id)
            || (state.taskSearch.rows || []).find((row) => row.id === id)
            || null;
    }

    function openTaskDetail(id, source) {
        const row = findTaskRow(id);
        if (!row) return;
        state.taskDetail = { rowId: id, source: source || "review", editRowId: "", deferRowId: "", reopenRowId: "", splitRowId: "", splitShk: "" };
        renderTaskDetail(row);
        setFlowModalOpen("taskDetailModal", true);
    }

    function closeTaskDetail() {
        setFlowModalOpen("taskDetailModal", false);
    }

    function closeSpecialInfoModal() {
        setFlowModalOpen("specialInfoModal", false);
    }

    function openSpecialInfoModal(taskId, tag) {
        const row = findTaskRow(taskId);
        const target = $("specialInfoWrap");
        if (!row || !target) return;
        const normalizedTag = normalizeForMatch(tag);
        const infos = taskSpecialInfos(row).filter((info) => !normalizedTag || normalizeForMatch(info.tag_name) === normalizedTag);
        const title = normalizeText(tag) || "Особый ШК";
        const cards = infos.length ? infos.map((info) => {
            const lines = [
                ["Тип", info.tag_name],
                ["ШК в задаче", info.matched_shk || "-"],
                ["Второй ШК", info.second_shk || "-"],
                ["Дата события", info.created_at ? formatRuDateTime(info.created_at) : "-"],
                ["Склад", info.wh_id || "-"],
            ];
            return "<article class='special-info-card'>"
                + lines.map((line) => "<button type='button' class='special-info-line copyable' data-copy-value='" + escapeHtml(line[1]) + "' title='Нажми, чтобы скопировать'><span>" + escapeHtml(line[0]) + "</span><strong>" + escapeHtml(line[1]) + "</strong></button>").join("")
                + (info.media ? "<a class='special-info-link' href='" + escapeHtml(info.media) + "' target='_blank' rel='noopener'>Открыть ссылку/материал</a>" : "<div class='special-info-muted'>Ссылка не указана</div>")
                + "</article>";
        }).join("") : "<div class='empty-state'>Детали по этому тегу не найдены. Для старых задач может понадобиться повторная выгрузка, чтобы WMS+ записал детали в payload.</div>";
        target.innerHTML = "<div class='work-head'><div><h3 class='work-title'>" + escapeHtml(title) + "</h3><p class='work-subtitle'>Детали из базы 2ШК/ПУ по этой задаче.</p></div><button id='closeSpecialInfo' class='btn btn-square' type='button' aria-label='Закрыть'>×</button></div>"
            + "<div class='special-info-list'>" + cards + "</div>";
        $("closeSpecialInfo").addEventListener("click", closeSpecialInfoModal);
        target.querySelectorAll("[data-copy-value]").forEach((field) => {
            field.addEventListener("click", async () => {
                const text = field.dataset.copyValue || "";
                if (!text || text === "-") return;
                const copied = await copyText(text);
                toast(copied ? "Скопировано." : "Браузер заблокировал копирование.", copied ? "success" : "error");
            });
        });
        setFlowModalOpen("specialInfoModal", true);
    }

    function taskSearchPattern(value) {
        const cleaned = normalizeText(value).replace(/[%_]/g, " ").replace(/\s+/g, " ").trim();
        return cleaned ? "%" + cleaned + "%" : "";
    }

    function taskSearchMeta(row) {
        const ids = taskItems(row).map((item) => item.shk).filter(Boolean);
        const shownIds = ids.slice(0, 4).join(", ") + (ids.length > 4 ? " +" + (ids.length - 4) : "");
        const route = taskRouteLabel(row);
        return [
            taskSectionName(row),
            displayTaskStatus(row),
            route ? route : "",
            formatMoney(row.source_price_sum),
            isTareTask(row) ? "Тара: " + (normalizeIdentifier(row.source_tare_id) || "-") : "",
            shownIds ? "ШК: " + shownIds : "",
            row.due_date ? "ДД: " + formatRuDate(row.due_date) : "",
        ].filter(Boolean).join(" · ");
    }

    function setTaskSearchResultsVisible(visible) {
        const target = $("taskSearchResults");
        if (target) target.classList.toggle("visible", Boolean(visible));
    }

    function renderTaskSearchResults(message) {
        const target = $("taskSearchResults");
        if (!target) return;
        const rows = state.taskSearch.rows || [];
        if (message) {
            target.innerHTML = "<div class='task-search-empty'>" + escapeHtml(message) + "</div>";
            setTaskSearchResultsVisible(true);
            return;
        }
        if (!rows.length) {
            target.innerHTML = "<div class='task-search-empty'>Ничего не нашёл. Проверь ШК или номер тары.</div>";
            setTaskSearchResultsVisible(true);
            return;
        }
        target.innerHTML = rows.map((row) => "<button class='task-search-row' type='button' data-search-task-id='" + escapeHtml(row.id) + "'>"
            + "<span class='task-search-title'>" + escapeHtml(displayTaskTitle(row)) + "</span>"
            + "<span class='task-search-meta'>" + escapeHtml(taskSearchMeta(row)) + "</span>"
            + "</button>").join("");
        target.querySelectorAll("[data-search-task-id]").forEach((button) => {
            button.addEventListener("click", () => {
                const id = button.dataset.searchTaskId || "";
                setTaskSearchResultsVisible(false);
                const row = findTaskRow(id);
                openTaskDetail(id, row && isActiveReviewTask(row) ? "review" : "inactive");
            });
        });
        setTaskSearchResultsVisible(true);
    }

    async function queryTaskSearch(value) {
        const db = supabaseDb();
        if (!db) return [];
        const text = normalizeText(value);
        const id = normalizeIdentifier(text);
        const pattern = taskSearchPattern(text);
        const base = () => db
            .from(WMS_TASKS_TABLE)
            .select(WMS_TASK_SELECT_COLUMNS)
            .eq("is_deleted", false);
        const queries = [];
        if (id) {
            queries.push(base().contains("source_shk_ids", [id]).order("updated_at", { ascending: false }).limit(20));
            queries.push(base().eq("source_tare_id", id).order("updated_at", { ascending: false }).limit(20));
            queries.push(base().ilike("source_id", pattern).order("updated_at", { ascending: false }).limit(20));
        }
        if (pattern) {
            queries.push(base().ilike("title", pattern).order("updated_at", { ascending: false }).limit(20));
            queries.push(base().ilike("search_text", pattern).order("updated_at", { ascending: false }).limit(20));
        }
        const settled = await Promise.allSettled(queries);
        const errors = [];
        const byId = new Map();
        settled.forEach((result) => {
            if (result.status !== "fulfilled") {
                errors.push(result.reason);
                return;
            }
            if (result.value && result.value.error) {
                errors.push(result.value.error);
                return;
            }
            (result.value && Array.isArray(result.value.data) ? result.value.data : []).forEach((row) => {
                if (row && row.id && !byId.has(row.id)) byId.set(row.id, row);
            });
        });
        if (!byId.size && errors.length === settled.length && errors[0]) throw errors[0];
        return Array.from(byId.values())
            .sort((a, b) => {
                const aActive = isActiveReviewTask(a) ? 1 : 0;
                const bActive = isActiveReviewTask(b) ? 1 : 0;
                if (aActive !== bActive) return bActive - aActive;
                return (Number(b.source_price_sum) || 0) - (Number(a.source_price_sum) || 0);
            })
            .slice(0, 25);
    }

    function scheduleTaskSearch() {
        const input = $("taskSearchInput");
        const query = normalizeText(input && input.value);
        if (state.taskSearch.timer) clearTimeout(state.taskSearch.timer);
        if (query.length < 2) {
            state.taskSearch.rows = [];
            setTaskSearchResultsVisible(false);
            return;
        }
        renderTaskSearchResults("Ищу задачу...");
        state.taskSearch.timer = setTimeout(() => { void runTaskSearch(query); }, 280);
    }

    async function runTaskSearch(query) {
        const requestId = state.taskSearch.requestId + 1;
        state.taskSearch.requestId = requestId;
        state.taskSearch.loading = true;
        try {
            const rows = await queryTaskSearch(query);
            if (requestId !== state.taskSearch.requestId) return;
            state.taskSearch.rows = rows;
            renderTaskSearchResults();
        } catch (error) {
            if (requestId !== state.taskSearch.requestId) return;
            state.taskSearch.rows = [];
            renderTaskSearchResults("Не удалось выполнить поиск: " + (error && error.message ? error.message : String(error)));
        } finally {
            if (requestId === state.taskSearch.requestId) state.taskSearch.loading = false;
        }
    }

    function taskInfoItem(label, value) {
        const text = normalizeText(value) || "-";
        const copy = text === "-" ? "" : " data-copy-value='" + escapeHtml(text) + "' title='Нажми, чтобы скопировать'";
        return "<div class='task-info-item" + (copy ? " copyable" : "") + "'" + copy + "><div class='task-info-label'>" + escapeHtml(label) + "</div><div class='task-info-value'>" + escapeHtml(text) + "</div></div>";
    }

    function taskDetailInfo(row) {
        const tags = reviewTags(row);
        const assignee = [normalizeText(row.assignee_name), normalizeText(row.assignee_employee_id)].filter(Boolean).join(" / ") || "Не назначен";
        const taskItemList = taskItems(row);
        const targetId = isTareTask(row)
            ? normalizeIdentifier(row.source_tare_id) || normalizeIdentifier(taskPayload(row).tare_id || taskPayload(row).transfer)
            : normalizeIdentifier(taskItemList[0] && taskItemList[0].shk) || normalizeIdentifier(row.source_shk_ids && row.source_shk_ids[0]);
        const items = [
            taskInfoItem(isTareTask(row) ? "Искомая тара" : "Искомый ШК", targetId),
            taskInfoItem("Стоимость", formatMoney(row.source_price_sum)),
            taskInfoItem("Дедлайн", formatRuDate(row.due_date)),
            taskInfoItem("Дата выгрузки", formatRuDate(row.upload_effective_date)),
            taskInfoItem("Последнее движение", formatRuDateTime(row.source_last_movement_at)),
            taskInfoItem("Исполнитель", assignee),
        ];
        const itemName = taskItemName(row);
        if (isSingleShkTask(row) && itemName) items.splice(1, 0, taskInfoItem("Наименование", itemName));
        const routeLabel = normalizeText(taskPayload(row).route_label);
        if (routeLabel) items.push(taskInfoItem("Место", routeLabel));
        if (row.reopen_after) items.push(taskInfoItem("Переоткрытие", formatRuDateTime(row.reopen_after)));
        return items.join("");
    }

    function normalizeSpecialInfo(info) {
        if (!info || typeof info !== "object") return null;
        const tagName = normalizeText(info.tag_name || info.tagName || info.type);
        if (!isSpecialTagLabel(tagName)) return null;
        return {
            tag_name: tagName,
            matched_shk: normalizeIdentifier(info.matched_shk || info.matchedShk || info.shk),
            second_shk: normalizeIdentifier(info.second_shk || info.secondShk || info.other_shk || info.otherShk),
            media: normalizeText(info.media || info.link || info.url),
            created_at: normalizeText(info.created_at || info.createdAt || info.date),
            wh_id: normalizeIdentifier(info.wh_id || info.whId),
        };
    }

    function parseSpecialInfosFromDescription(description) {
        const lines = normalizeText(description).split(/\r?\n/).map(normalizeText);
        const result = [];
        let current = null;
        lines.forEach((line) => {
            if (isSpecialTagLabel(line)) {
                if (current) result.push(current);
                current = { tag_name: line };
                return;
            }
            if (!current) return;
            const match = line.match(/^([^:]+):\s*(.*)$/);
            if (!match) return;
            const key = normalizeForMatch(match[1]);
            const value = normalizeText(match[2]);
            if (key === "шк") current.matched_shk = normalizeIdentifier(value);
            else if (key === "второй шк") current.second_shk = normalizeIdentifier(value);
            else if (key === "ссылка") current.media = value;
            else if (key === "дата") current.created_at = value;
        });
        if (current) result.push(current);
        return result.map(normalizeSpecialInfo).filter(Boolean);
    }

    function taskSpecialInfos(row) {
        const payload = taskPayload(row);
        const fromPayload = Array.isArray(payload.special_infos) ? payload.special_infos.map(normalizeSpecialInfo).filter(Boolean) : [];
        if (fromPayload.length) return fromPayload;
        return parseSpecialInfosFromDescription(row && row.description);
    }

    function taskTagsBox(row) {
        const tags = reviewTags(row);
        if (!tags.length) return "";
        const specialTags = new Set(taskSpecialInfos(row).map((info) => normalizeForMatch(info.tag_name)));
        const buttons = tags.map((tag) => {
            const isSpecial = isSpecialTagLabel(tag) || specialTags.has(normalizeForMatch(tag));
            return isSpecial
                ? "<button class='task-tag-pill special' type='button' data-special-tag='" + escapeHtml(tag) + "' title='Открыть детали'>" + escapeHtml(tag) + "</button>"
                : "<button class='task-tag-pill' type='button' data-copy-value='" + escapeHtml(tag) + "' title='Нажми, чтобы скопировать'>" + escapeHtml(tag) + "</button>";
        }).join("");
        return "<div class='task-tags-box'><div class='task-info-label'>Теги</div><div class='task-tags-row'>" + buttons + "</div></div>";
    }

    function isTareTask(row) {
        const tare = normalizeIdentifier(row && row.source_tare_id);
        const ids = Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids.map(normalizeIdentifier).filter(Boolean) : [];
        const sourceId = normalizeText(row && row.source_id).toLowerCase();
        const title = normalizeForMatch(row && row.title);
        const entityType = normalizeText(taskPayload(row).entity_type);
        const markedAsTare = sourceId.startsWith("tare:") || sourceId.includes(":tare:") || sourceId.includes(":transfer:") || entityType === "tare" || entityType === "transfer" || title.includes("тара ");
        return Boolean(markedAsTare && tare && tare !== "0" && ids.length);
    }

    function taskTareInfoBox(row) {
        if (!isTareTask(row)) return "";
        const items = taskItems(row);
        const ids = items.map((item) => item.shk).filter(Boolean).join("\n");
        const rows = items.map((item) => "<button class='task-tare-row' type='button' data-copy-single-shk='" + escapeHtml(item.shk) + "' title='Скопировать этот ШК'>"
            + "<span class='task-tare-shk'>" + escapeHtml(item.shk || "-") + "</span>"
            + "<span class='task-tare-meta'>" + escapeHtml(item.status || "-") + "</span>"
            + "<span class='task-tare-price'>" + escapeHtml(formatMoney(item.price)) + "</span>"
            + "</button>").join("");
        return "<div class='task-tare-box'>"
            + "<div class='task-tare-head'><strong>ШК в таре</strong><button id='copyAllTareShk' class='btn btn-outline' type='button' data-copy-shk='" + escapeHtml(ids) + "'>Скопировать все</button></div>"
            + "<div class='task-tare-list'>" + (rows || "<div class='task-tare-meta'>ШК не найдены</div>") + "</div>"
            + "</div>";
    }

    function taskHistoryBox(row) {
        const review = taskReviewPayload(row);
        const lines = [];
        if (review.defer_reason) {
            lines.push("Отложено: " + review.defer_reason);
            if (review.reopen_after) lines.push("Дата переоткрытия: " + formatRuDateTime(review.reopen_after));
            if (review.deferred_by_name || review.deferred_by_id) lines.push("Кто отложил: " + [review.deferred_by_name, review.deferred_by_id].filter(Boolean).join(" / "));
        }
        if (review.manual_reopen_at) {
            lines.push("Переоткрыто вручную: " + formatRuDateTime(review.manual_reopen_at));
            if (review.manual_reopen_by_name || review.manual_reopen_by_id) lines.push("Кто переоткрыл: " + [review.manual_reopen_by_name, review.manual_reopen_by_id].filter(Boolean).join(" / "));
        }
        if (!lines.length) return "";
        return "<div class='task-history-box copyable' data-copy-value='" + escapeHtml(lines.join("\n")) + "' title='Нажми, чтобы скопировать'><strong>История разбора</strong>\n" + escapeHtml(lines.join("\n")) + "</div>";
    }

    function taskDetailActionButtons(row, readOnly) {
        if (readOnly) {
            return "<div class='task-detail-actions'><button id='reopenTaskBtn' class='btn btn-square' type='button' title='Переоткрыть задачу'>↻</button><button id='closeTaskDetail' class='btn btn-square' type='button'>×</button></div>";
        }
        const edit = isTareTask(row) ? "<button id='editTareTaskBtn' class='btn btn-square' type='button' title='Редактировать задачу'>✎</button>" : "";
        const defer = isPrespisokTask(row) ? "" : "<button id='openDeferTaskBtn' class='btn btn-square' type='button' title='Отложить'>◴</button>";
        return "<div class='task-detail-actions'>" + edit + defer + "<button id='closeTaskDetail' class='btn btn-square' type='button'>×</button></div>";
    }

    function renderTaskDetail(row) {
        const target = $("taskDetailWrap");
        if (!target) return;
        const savedReview = taskReviewPayload(row);
        const readOnly = state.taskDetail.source === "inactive" || isCompletedTask(row) || isWaitingReopenTask(row);
        const verdict = normalizeText(row.opp_verdict) && normalizeText(row.opp_verdict) !== "Не выбран"
            ? normalizeText(row.opp_verdict)
            : normalizeText(savedReview.verdict) || "Не выбран";
        const formVerdict = REVIEW_VERDICTS.includes(verdict) ? verdict : "Не выбран";
        const extraLabel = DEFERRED_VERDICT_FIELDS[verdict] || "";
        const readOnlyReviewLines = [
            "Комментарий: " + (savedReview.comment || "-"),
            "Вердикт: " + (verdict || "-"),
        ];
        if (savedReview.extra_label || savedReview.extra_value) readOnlyReviewLines.push((savedReview.extra_label || "Доп. поле") + ": " + (savedReview.extra_value || "-"));
        if (savedReview.completed_by_name || savedReview.completed_by_id) readOnlyReviewLines.push("Исполнитель: " + [savedReview.completed_by_name, savedReview.completed_by_id].filter(Boolean).join(" / "));
        const reviewBlock = readOnly
            ? "<div class='task-description-box copyable' data-copy-value='" + escapeHtml(readOnlyReviewLines.join("\n")) + "' title='Нажми, чтобы скопировать'><strong>Комментарий:</strong><br>" + escapeHtml(savedReview.comment || "-")
                + "<br><br><strong>Вердикт:</strong><br>" + escapeHtml(verdict || "-")
                + (savedReview.extra_label || savedReview.extra_value ? "<br><br><strong>" + escapeHtml(savedReview.extra_label || "Доп. поле") + ":</strong><br>" + escapeHtml(savedReview.extra_value || "-") : "")
                + (savedReview.completed_by_name || savedReview.completed_by_id ? "<br><br><strong>Исполнитель:</strong><br>" + escapeHtml([savedReview.completed_by_name, savedReview.completed_by_id].filter(Boolean).join(" / ")) : "")
                + "</div>"
            : "<div class='task-form'>"
                + "<label for='taskCommentInput'>Комментарий</label>"
                + "<textarea id='taskCommentInput' placeholder='Что сделали по задаче'>" + escapeHtml(savedReview.comment || "") + "</textarea>"
                + "<label for='taskVerdictInput'>Вердикт</label>"
                + "<select id='taskVerdictInput'>" + REVIEW_VERDICTS.map((option) => "<option value='" + escapeHtml(option) + "' " + (option === formVerdict ? "selected" : "") + ">" + escapeHtml(option) + "</option>").join("") + "</select>"
                + "<div id='taskExtraFieldWrap' class='" + (extraLabel ? "" : "hidden") + "'><label id='taskExtraLabel' for='taskExtraInput'>" + escapeHtml(extraLabel) + "</label><input id='taskExtraInput' type='text' value='" + escapeHtml(savedReview.extra_value || "") + "'></div>"
                + "<button id='completeTaskBtn' class='btn btn-rect task-complete-btn' type='button' disabled>Завершить задачу</button>"
                + "<div id='taskDetailStatus' class='review-status'></div>"
                + "</div>";
        target.innerHTML = "<div class='task-detail-head'><div><h3 class='task-detail-title copyable' data-copy-value='" + escapeHtml(displayTaskTitle(row)) + "' title='Нажми, чтобы скопировать'>" + escapeHtml(displayTaskTitle(row)) + "</h3><div class='review-table-subtitle'>" + escapeHtml(row.task_type || "-") + "</div></div>" + taskDetailActionButtons(row, readOnly) + "</div>"
            + "<div class='task-detail-body'>"
            + "<div class='task-info-grid'>" + taskDetailInfo(row) + "</div>"
            + taskTagsBox(row)
            + taskTareInfoBox(row)
            + taskHistoryBox(row)
            + reviewBlock
            + "</div>";
        $("closeTaskDetail").addEventListener("click", closeTaskDetail);
        target.querySelectorAll("[data-copy-value]").forEach((field) => {
            field.addEventListener("click", async () => {
                const text = field.dataset.copyValue || "";
                if (!text) return;
                const copied = await copyText(text);
                toast(copied ? "Скопировано." : "Браузер заблокировал копирование.", copied ? "success" : "error");
            });
        });
        const reopenBtn = $("reopenTaskBtn");
        if (reopenBtn) reopenBtn.addEventListener("click", () => openReopenConfirm(row.id));
        const copyAllTare = $("copyAllTareShk");
        if (copyAllTare) copyAllTare.addEventListener("click", async () => {
            const text = copyAllTare.dataset.copyShk || "";
            if (!text) return;
            const copied = await copyText(text);
            toast(copied ? "ШК в таре скопированы." : "Браузер заблокировал копирование.", copied ? "success" : "error");
        });
        target.querySelectorAll("[data-copy-single-shk]").forEach((button) => {
            button.addEventListener("click", async () => {
                const text = normalizeIdentifier(button.dataset.copySingleShk);
                if (!text) return;
                const copied = await copyText(text);
                toast(copied ? "ШК скопирован." : "Браузер заблокировал копирование.", copied ? "success" : "error");
            });
        });
        target.querySelectorAll("[data-special-tag]").forEach((button) => {
            button.addEventListener("click", () => openSpecialInfoModal(row.id, button.dataset.specialTag || ""));
        });
        if (readOnly) return;
        const editBtn = $("editTareTaskBtn");
        if (editBtn) editBtn.addEventListener("click", () => openEditTareTaskModal(row.id));
        const deferBtn = $("openDeferTaskBtn");
        if (deferBtn) deferBtn.addEventListener("click", () => openDeferTaskModal(row.id));
        ["taskCommentInput", "taskVerdictInput", "taskExtraInput"].forEach((id) => {
            const el = $(id);
            if (el) el.addEventListener(id === "taskVerdictInput" ? "change" : "input", updateTaskDetailForm);
        });
        $("completeTaskBtn").addEventListener("click", () => { void completeTaskFromDetail(row.id); });
        updateTaskDetailForm();
    }

    function closeEditTareTaskModal() {
        state.taskDetail.editRowId = "";
        setFlowModalOpen("editTareTaskModal", false);
    }

    function renderEditTareTaskModal(row) {
        const target = $("editTareTaskWrap");
        if (!target) return;
        const items = taskItems(row);
        target.innerHTML = "<div class='tare-edit-list'>" + items.map((item) => {
            const meta = [
                item.name ? "Наименование: " + item.name : "",
                "Статус: " + (item.status || "-"),
                "Стоимость: " + formatMoney(item.price),
            ].filter(Boolean).join(" · ");
            return "<div class='tare-edit-row'>"
                + "<div class='tare-edit-main copyable' data-copy-value='" + escapeHtml(item.shk) + "' title='Нажми, чтобы скопировать ШК'>" + escapeHtml(item.shk) + "<div class='tare-edit-meta'>" + escapeHtml(meta) + "</div></div>"
                + "<button class='btn btn-square tare-detach-btn' type='button' data-detach-shk='" + escapeHtml(item.shk) + "' title='Отделить ШК'>−</button>"
                + "</div>";
        }).join("") + "</div>";
        target.querySelectorAll("[data-copy-value]").forEach((field) => {
            field.addEventListener("click", async () => {
                const text = field.dataset.copyValue || "";
                if (!text) return;
                const copied = await copyText(text);
                toast(copied ? "Скопировано." : "Браузер заблокировал копирование.", copied ? "success" : "error");
            });
        });
        target.querySelectorAll("[data-detach-shk]").forEach((button) => {
            button.addEventListener("click", () => openSplitShkConfirm(row.id, button.dataset.detachShk || ""));
        });
    }

    function openEditTareTaskModal(id) {
        const row = findTaskRow(id);
        if (!row || !isTareTask(row)) return;
        state.taskDetail.editRowId = id;
        const status = $("editTareTaskStatus");
        if (status) status.textContent = "";
        renderEditTareTaskModal(row);
        setFlowModalOpen("editTareTaskModal", true);
    }

    function openSplitShkConfirm(id, shk) {
        const row = findTaskRow(id);
        if (!row || !shk) return;
        state.taskDetail.splitRowId = id;
        state.taskDetail.splitShk = shk;
        const text = $("splitShkConfirmText");
        const status = $("splitShkConfirmStatus");
        if (text) {
            const tare = normalizeIdentifier(row.source_tare_id) || normalizeIdentifier(taskPayload(row).tare_id || taskPayload(row).transfer) || "-";
            text.textContent = "Отделить ШК " + shk + " из тары " + tare + "? Действие нельзя отменить: товар будет удален из текущей тары и создан отдельной задачей.";
        }
        if (status) status.textContent = "";
        const button = $("confirmSplitShk");
        if (button) button.disabled = false;
        setFlowModalOpen("splitShkConfirmModal", true);
    }

    function closeSplitShkConfirm() {
        state.taskDetail.splitRowId = "";
        state.taskDetail.splitShk = "";
        setFlowModalOpen("splitShkConfirmModal", false);
    }

    async function splitShkFromConfirm() {
        const id = state.taskDetail.splitRowId;
        const shk = state.taskDetail.splitShk;
        const button = $("confirmSplitShk");
        const status = $("splitShkConfirmStatus");
        if (!id || !shk) return;
        if (button) button.disabled = true;
        if (status) status.textContent = "Отделяю ШК...";
        try {
            const ok = await detachShkFromTare(id, shk);
            if (ok) closeSplitShkConfirm();
            else if (status) status.textContent = "Не удалось отделить ШК. Проверь сообщение в окне редактирования тары.";
        } finally {
            if (button) button.disabled = false;
        }
    }

    function itemsSourceRows(items) {
        return (items || []).map((item) => item.raw && Object.keys(item.raw).length ? item.raw : {
            product: item.shk,
            name: item.name,
            product_status: item.status,
            price: item.price,
            mx: item.mx,
            created_at: item.movement,
            row_number: item.row_number,
        });
    }

    function payloadWithItems(row, items, extra) {
        const payload = taskPayload(row);
        const rows = itemsSourceRows(items);
        return {
            ...payload,
            ...(extra || {}),
            task_items: items,
            rows,
            item_name: itemNameFromRows(rows),
        };
    }

    function sumTaskItems(items) {
        return Math.round((items || []).reduce((acc, item) => acc + (Number(item.price) || 0), 0) * 100) / 100;
    }

    function sourceLastMovementFromItems(items, fallback) {
        const values = (items || []).map((item) => parseDateTime(item.movement).iso).filter(Boolean).sort();
        return values[values.length - 1] || fallback || null;
    }

    function refreshTaskRow(id, patch) {
        [state.review.rows, state.inactive.rows].forEach((rows) => {
            const row = (rows || []).find((item) => item.id === id);
            if (row) Object.assign(row, patch);
        });
    }

    async function updateTareTaskItems(row, items, extraPayload) {
        const db = supabaseDb();
        if (!db || !row) return null;
        const price = sumTaskItems(items);
        const priority = taskPriority(price, false);
        const payload = {
            source_payload: payloadWithItems(row, items, extraPayload),
            source_shk_ids: items.map((item) => item.shk).filter(Boolean),
            source_price_sum: price,
            source_last_movement_at: sourceLastMovementFromItems(items, row.source_last_movement_at),
            priority: priority.value,
            priority_label: priority.label,
            search_text: [row.title, row.task_type, row.source_tare_id, ...items.map((item) => item.shk), ...items.map((item) => item.name)].filter(Boolean).join(" "),
            updated_at: new Date().toISOString(),
        };
        const { data, error } = await db
            .from(WMS_TASKS_TABLE)
            .update(payload)
            .eq("id", row.id)
            .select("id,source_payload,source_shk_ids,source_price_sum,source_last_movement_at,priority,priority_label,search_text,updated_at")
            .single();
        if (error) throw error;
        refreshTaskRow(row.id, data || payload);
        return data || payload;
    }

    function splitTaskFromTare(row, item) {
        const price = Number(item.price) || 0;
        return taskRecord({
            module: row.module || "",
            sourceModule: row.source_module,
            uploadType: row.upload_type,
            businessDate: row.upload_effective_date,
            sourceTable: "manual_split",
            sourceId: row.source_id + ":split:" + item.shk,
            title: taskTitleForShk(item.shk),
            taskType: row.task_type,
            descriptionTaskType: row.task_type,
            column: taskSectionName(row),
            dueDate: row.due_date,
            responsibilityZone: row.responsibility_zone,
            productIds: [item.shk],
            rows: itemsSourceRows([item]),
            tareId: row.source_tare_id,
            price,
            tags: reviewTags(row),
            payload: {
                entity_type: "shk",
                row: item.raw || item,
                split_from_task_id: row.id,
                split_from_source_id: row.source_id,
            },
            infoLines: ["Искомый ШК: " + item.shk, "Тара: " + (row.source_tare_id || "-"), "Статус крайнего движения: " + (item.status || "-")],
        });
    }

    async function detachShkFromTare(id, shk) {
        const row = findTaskRow(id);
        if (!row || !shk) return false;
        const items = taskItems(row);
        const item = items.find((candidate) => candidate.shk === shk);
        if (!item) return false;
        if (items.length <= 1) {
            const status = $("editTareTaskStatus");
            if (status) status.textContent = "Нельзя отделить последний ШК из задачи.";
            return false;
        }
        const status = $("editTareTaskStatus");
        if (status) status.textContent = "Отделяю ШК...";
        try {
            const rest = items.filter((candidate) => candidate.shk !== shk);
            await updateTareTaskItems(row, rest, { edited_at: new Date().toISOString() });
            const db = supabaseDb();
            const splitTask = splitTaskFromTare(row, item);
            const { error } = await db.rpc(SAVE_RPC, { p_tasks: [splitTask], p_run: {} });
            if (error) throw error;
            if (status) status.textContent = "ШК отделен в отдельную задачу.";
            const updated = findTaskRow(id);
            if (updated) {
                renderTaskDetail(updated);
                renderEditTareTaskModal(updated);
            }
            renderReview();
            if ($("reviewSectionModal") && $("reviewSectionModal").classList.contains("active")) renderReviewTable(reviewGroupedRows());
            return true;
        } catch (error) {
            console.error("detach shk failed:", error);
            if (status) status.textContent = "Не удалось отделить ШК: " + (error && error.message ? error.message : String(error));
            return false;
        }
    }

    async function addShkToTare(id) {
        const row = findTaskRow(id);
        if (!row) return;
        const shk = normalizeIdentifier($("addShkIdInput") && $("addShkIdInput").value);
        const statusText = normalizeText($("addShkStatusInput") && $("addShkStatusInput").value);
        const name = normalizeText($("addShkNameInput") && $("addShkNameInput").value);
        const price = normalizePrice($("addShkPriceInput") && $("addShkPriceInput").value) || 0;
        const status = $("editTareTaskStatus");
        if (!shk) {
            if (status) status.textContent = "Укажите ШК.";
            return;
        }
        const items = taskItems(row);
        if (items.some((item) => item.shk === shk)) {
            if (status) status.textContent = "Этот ШК уже есть в задаче.";
            return;
        }
        try {
            const item = { shk, name, status: statusText, price, mx: "", movement: "", row_number: null, raw: { product: shk, name, product_status: statusText, price } };
            await updateTareTaskItems(row, items.concat(item), { edited_at: new Date().toISOString() });
            if (status) status.textContent = "ШК добавлен в задачу.";
            const updated = findTaskRow(id);
            if (updated) {
                renderTaskDetail(updated);
                renderEditTareTaskModal(updated);
            }
            renderReview();
            if ($("reviewSectionModal") && $("reviewSectionModal").classList.contains("active")) renderReviewTable(reviewGroupedRows());
        } catch (error) {
            console.error("add shk failed:", error);
            if (status) status.textContent = "Не удалось добавить ШК: " + (error && error.message ? error.message : String(error));
        }
    }

    function updateTaskDetailForm() {
        const verdict = normalizeText($("taskVerdictInput") && $("taskVerdictInput").value) || "Не выбран";
        const extraLabel = DEFERRED_VERDICT_FIELDS[verdict] || "";
        const extraWrap = $("taskExtraFieldWrap");
        const extraLabelEl = $("taskExtraLabel");
        if (extraWrap) extraWrap.classList.toggle("hidden", !extraLabel);
        if (extraLabelEl) extraLabelEl.textContent = extraLabel;
        const comment = normalizeText($("taskCommentInput") && $("taskCommentInput").value);
        const extra = normalizeText($("taskExtraInput") && $("taskExtraInput").value);
        const missing = [];
        if (!comment) missing.push("Комментарий");
        if (!verdict || verdict === "Не выбран") missing.push("Вердикт");
        if (verdict === SYSTEM_MOVEMENT_VERDICT) missing.push("доступный пользователю вердикт");
        if (extraLabel && !extra) missing.push(extraLabel);
        const ready = missing.length === 0;
        const button = $("completeTaskBtn");
        if (button) {
            button.disabled = !ready;
            button.title = ready ? "" : "Не заполнено: " + missing.join(", ");
        }
    }

    function addDaysIso(days) {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString();
    }

    function currentWmsUser() {
        const parsed = parseJsonSafe(localStorage.getItem("user"), {}) || {};
        const id = normalizeText(parsed.id || parsed.employee_id || parsed.employeeId || parsed.user_id || parsed.userId);
        const name = normalizeText(parsed.name || parsed.fio || parsed.full_name || parsed.fullName || $("user-name") && $("user-name").textContent);
        return { id, name };
    }

    async function completeTaskFromDetail(id) {
        const db = supabaseDb();
        if (!db || !id) return;
        const row = findTaskRow(id);
        if (!row) return;
        const user = currentWmsUser();
        const verdict = normalizeText($("taskVerdictInput") && $("taskVerdictInput").value) || "Не выбран";
        const comment = normalizeText($("taskCommentInput") && $("taskCommentInput").value);
        const extraLabel = DEFERRED_VERDICT_FIELDS[verdict] || "";
        const extraValue = normalizeText($("taskExtraInput") && $("taskExtraInput").value);
        if (verdict === SYSTEM_MOVEMENT_VERDICT) {
            const status = $("taskDetailStatus");
            if (status) status.textContent = "Вердикт “" + SYSTEM_MOVEMENT_VERDICT + "” ставится только системой при актуализации движения.";
            return;
        }
        if (!comment || verdict === "Не выбран" || (extraLabel && !extraValue)) {
            const status = $("taskDetailStatus");
            if (status) status.textContent = "Заполни комментарий, вердикт и обязательное поле по выбранному вердикту.";
            return;
        }
        const now = new Date().toISOString();
        const isDeferred = Boolean(DEFERRED_VERDICT_FIELDS[verdict]);
        const reopenAfter = isDeferred ? addDaysIso(2) : null;
        const nextPayload = {
            ...taskPayload(row),
            wms_review: {
                ...taskReviewPayload(row),
                comment,
                verdict,
                extra_label: extraLabel,
                extra_value: extraValue,
                completed_by_id: user.id || null,
                completed_by_name: user.name || null,
                completed_at: now,
                reopen_after: reopenAfter,
            },
        };
        const payload = {
            opp_verdict: verdict,
            assignee_employee_id: user.id || null,
            assignee_name: user.name || null,
            task_status: isDeferred ? "Отложено" : "Завершено",
            completed_at: now,
            reopen_after: reopenAfter,
            source_payload: nextPayload,
            updated_at: now,
        };
        const button = $("completeTaskBtn");
        const status = $("taskDetailStatus");
        if (button) button.disabled = true;
        if (status) status.textContent = "Сохраняю задачу...";
        try {
            const { data, error } = await db
                .from(WMS_TASKS_TABLE)
                .update(payload)
                .eq("id", id)
                .select("id,source_payload,task_status,opp_verdict,assignee_employee_id,assignee_name,completed_at,reopen_after,updated_at")
                .single();
            if (error) throw error;
            const row = (state.review.rows || []).find((item) => item.id === id);
            if (row) Object.assign(row, data || payload);
            state.review.rows = (state.review.rows || []).filter((item) => item.id !== id || isActiveReviewTask(item));
            setReviewStatus(isDeferred ? "Задача отложена до " + formatRuDateTime(reopenAfter) + "." : "Задача завершена.", "good");
            closeTaskDetail();
            renderReview();
            if ($("reviewSectionModal") && $("reviewSectionModal").classList.contains("active")) renderReviewTable(reviewGroupedRows());
        } catch (error) {
            console.error("wms task complete failed:", error);
            if (status) status.textContent = "Не удалось завершить задачу: " + (error && error.message ? error.message : String(error));
            if (button) button.disabled = false;
        }
    }

    function datetimeLocalValue(isoValue) {
        const date = isoValue ? new Date(isoValue) : new Date();
        if (!Number.isFinite(date.getTime())) return "";
        const pad = (value) => String(value).padStart(2, "0");
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
    }

    function isoFromDatetimeLocal(value) {
        const date = value ? new Date(value) : null;
        return date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
    }

    function openDeferTaskModal(id) {
        const row = findTaskRow(id);
        if (!row) return;
        state.taskDetail.deferRowId = id;
        const savedReview = taskReviewPayload(row);
        const reason = $("deferReasonInput");
        const date = $("deferDateInput");
        const status = $("deferTaskStatus");
        if (reason) reason.value = savedReview.defer_reason || "";
        if (date) date.value = datetimeLocalValue(savedReview.reopen_after || addDaysIso(2));
        if (status) status.textContent = "";
        updateDeferTaskForm();
        setFlowModalOpen("deferTaskModal", true);
    }

    function closeDeferTaskModal() {
        state.taskDetail.deferRowId = "";
        setFlowModalOpen("deferTaskModal", false);
    }

    function updateDeferTaskForm() {
        const reason = normalizeText($("deferReasonInput") && $("deferReasonInput").value);
        const reopenAfter = isoFromDatetimeLocal($("deferDateInput") && $("deferDateInput").value);
        const button = $("saveDeferTask");
        const missing = [];
        if (!reason) missing.push("причина");
        if (!reopenAfter) missing.push("дата и время переоткрытия");
        else if (Date.parse(reopenAfter) <= Date.now()) missing.push("будущая дата переоткрытия");
        const ready = missing.length === 0;
        if (button) {
            button.disabled = !ready;
            button.title = ready ? "" : "Не заполнено: " + missing.join(", ");
        }
    }

    async function deferTaskFromModal() {
        const id = state.taskDetail.deferRowId;
        const db = supabaseDb();
        const row = findTaskRow(id);
        if (!db || !row) return;
        const reason = normalizeText($("deferReasonInput") && $("deferReasonInput").value);
        const reopenAfter = isoFromDatetimeLocal($("deferDateInput") && $("deferDateInput").value);
        const status = $("deferTaskStatus");
        const button = $("saveDeferTask");
        if (!reason || !reopenAfter || Date.parse(reopenAfter) <= Date.now()) {
            if (status) status.textContent = "Заполни причину и будущую дату переоткрытия.";
            updateDeferTaskForm();
            return;
        }
        const user = currentWmsUser();
        const now = new Date().toISOString();
        const nextPayload = {
            ...taskPayload(row),
            wms_review: {
                ...taskReviewPayload(row),
                defer_reason: reason,
                deferred_by_id: user.id || null,
                deferred_by_name: user.name || null,
                deferred_at: now,
                reopen_after: reopenAfter,
            },
        };
        const payload = {
            task_status: "Отложено",
            reopen_after: reopenAfter,
            completed_at: null,
            source_payload: nextPayload,
            updated_at: now,
        };
        if (button) button.disabled = true;
        if (status) status.textContent = "Откладываю задачу...";
        try {
            const { data, error } = await db
                .from(WMS_TASKS_TABLE)
                .update(payload)
                .eq("id", id)
                .select("id,source_payload,task_status,completed_at,reopen_after,updated_at")
                .single();
            if (error) throw error;
            const activeRow = (state.review.rows || []).find((item) => item.id === id);
            if (activeRow) Object.assign(activeRow, data || payload);
            state.review.rows = (state.review.rows || []).filter((item) => item.id !== id || isActiveReviewTask(item));
            closeDeferTaskModal();
            closeTaskDetail();
            setReviewStatus("Задача отложена до " + formatRuDateTime(reopenAfter) + ".", "good");
            renderReview();
            if ($("reviewSectionModal") && $("reviewSectionModal").classList.contains("active")) renderReviewTable(reviewGroupedRows());
        } catch (error) {
            console.error("wms task defer failed:", error);
            if (status) status.textContent = "Не удалось отложить задачу: " + (error && error.message ? error.message : String(error));
            if (button) button.disabled = false;
        }
    }

    function openReopenConfirm(id) {
        const row = findTaskRow(id);
        if (!row) return;
        state.taskDetail.reopenRowId = id;
        const status = $("reopenConfirmStatus");
        if (status) status.textContent = "";
        setFlowModalOpen("reopenConfirmModal", true);
    }

    function closeReopenConfirm() {
        state.taskDetail.reopenRowId = "";
        setFlowModalOpen("reopenConfirmModal", false);
    }

    async function reopenTaskFromConfirm() {
        const id = state.taskDetail.reopenRowId;
        const db = supabaseDb();
        const row = findTaskRow(id);
        if (!db || !row) return;
        const user = currentWmsUser();
        const now = new Date().toISOString();
        const nextPayload = {
            ...taskPayload(row),
            wms_review: {
                ...taskReviewPayload(row),
                manual_reopen_at: now,
                manual_reopen_by_id: user.id || null,
                manual_reopen_by_name: user.name || null,
            },
        };
        const payload = {
            task_status: "Не начато",
            opp_verdict: "Не выбран",
            completed_at: null,
            reopen_after: null,
            reopened_at: now,
            source_payload: nextPayload,
            updated_at: now,
        };
        const button = $("confirmReopenTask");
        const status = $("reopenConfirmStatus");
        if (button) button.disabled = true;
        if (status) status.textContent = "Переоткрываю задачу...";
        try {
            const { data, error } = await db
                .from(WMS_TASKS_TABLE)
                .update(payload)
                .eq("id", id)
                .select("id,source_payload,task_status,opp_verdict,completed_at,reopen_after,reopened_at,updated_at")
                .single();
            if (error) throw error;
            const inactiveRow = (state.inactive.rows || []).find((item) => item.id === id);
            if (inactiveRow) Object.assign(inactiveRow, data || payload);
            state.inactive.rows = (state.inactive.rows || []).filter((item) => item.id !== id);
            if (state.review.loaded) {
                const existing = (state.review.rows || []).find((item) => item.id === id);
                if (existing) Object.assign(existing, row, data || payload);
                else state.review.rows.unshift({ ...row, ...(data || payload) });
            }
            closeReopenConfirm();
            closeTaskDetail();
            renderInactive();
            if ($("inactiveTasksModal") && $("inactiveTasksModal").classList.contains("active")) renderInactiveTasksTable();
            if (state.view === "review") renderReview();
            setReviewStatus("Задача переоткрыта.", "good");
        } catch (error) {
            console.error("wms task reopen failed:", error);
            if (status) status.textContent = "Не удалось переоткрыть задачу: " + (error && error.message ? error.message : String(error));
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function loadInactiveTasks() {
        const db = supabaseDb();
        if (!db) {
            setInactiveStatus("Supabase SDK не загрузился.", "error");
            return;
        }
        state.inactive.loading = true;
        renderInactive();
        try {
            const rows = await fetchWmsTaskRows(db, "inactive");
            state.inactive.rows = rows.filter((row) => isCompletedTask(row) || isWaitingReopenTask(row));
            state.inactive.loaded = true;
            setInactiveStatus("Загружено неактивных задач: " + state.inactive.rows.length + ".");
        } catch (error) {
            console.error("wms inactive load failed:", error);
            state.inactive.rows = [];
            setInactiveStatus("Не удалось загрузить неактивные задачи: " + (error && error.message ? error.message : String(error)), "error");
        } finally {
            state.inactive.loading = false;
            renderInactive();
            if ($("inactiveTasksModal") && $("inactiveTasksModal").classList.contains("active")) renderInactiveTasksTable();
        }
    }

    function setInactiveStatus(message, type) {
        const el = $("inactiveStatus");
        if (!el) return;
        el.textContent = message || "";
        el.style.color = type === "error" ? "#b91c1c" : type === "good" ? "#15803d" : "#64748b";
    }

    function inactiveRowsByGroup(group) {
        const rows = state.inactive.rows || [];
        if (group === "completed") return rows.filter(isCompletedTask);
        return rows.filter(isWaitingReopenTask);
    }

    function renderInactive() {
        const target = $("inactiveGrid");
        if (!target) return;
        if (state.inactive.loading) {
            target.innerHTML = "<div class='empty-state'>Загружаю неактивные задачи...</div>";
            return;
        }
        const deferred = inactiveRowsByGroup("deferred");
        const completed = inactiveRowsByGroup("completed");
        target.innerHTML = [
            { key: "deferred", title: "Ожидают переоткрытия", count: deferred.length, note: "Отложенные задачи. В карточке показывается дата, когда они снова появятся в активном разборе." },
            { key: "completed", title: "Разбор завершен", count: completed.length, note: "Задачи, которые закрыты окончательно и больше не должны возвращаться в активный разбор." },
        ].map((item) => "<button class='inactive-card' type='button' data-inactive-group='" + escapeHtml(item.key) + "'>"
            + "<div class='inactive-card-title'><span>" + escapeHtml(item.title) + "</span><strong>" + item.count + "</strong></div>"
            + "<div class='inactive-card-note'>" + escapeHtml(item.note) + "</div>"
            + "</button>").join("");
        target.querySelectorAll("[data-inactive-group]").forEach((button) => {
            button.addEventListener("click", () => {
                state.inactive.activeGroup = button.dataset.inactiveGroup || "deferred";
                renderInactiveTasksTable();
                setFlowModalOpen("inactiveTasksModal", true);
            });
        });
    }

    function renderInactiveTasksTable() {
        const group = state.inactive.activeGroup || "deferred";
        const title = group === "completed" ? "Разбор завершен" : "Ожидают переоткрытия";
        const rows = inactiveRowsByGroup(group).slice().sort((a, b) => {
            if (group === "deferred") return reopenTime(a) - reopenTime(b);
            return String(b.completed_at || b.updated_at || "").localeCompare(String(a.completed_at || a.updated_at || ""));
        });
        const target = $("inactiveTasksTableWrap");
        if (!target) return;
        const body = rows.map((row) => {
            const statusLine = group === "deferred"
                ? "Переоткрытие: " + formatRuDateTime(row.reopen_after)
                : "Завершено: " + formatRuDateTime(row.completed_at || row.updated_at);
            const route = taskRouteLabel(row);
            return "<tr class='review-click-row' data-inactive-task-detail='" + escapeHtml(row.id) + "'>"
                + "<td class='review-wrap-cell'><div class='review-task-title'>" + escapeHtml(displayTaskTitle(row)) + "</div><div class='review-task-sub'>" + escapeHtml(row.task_type || "-") + "</div>" + (route ? "<div class='review-task-route'>" + escapeHtml(route) + "</div>" : "") + "</td>"
                + "<td><span class='review-pill'>" + escapeHtml(taskEntityTypeLabel(row)) + "</span></td>"
                + "<td class='review-wrap-cell'>" + escapeHtml(taskItemName(row) || "-") + "</td>"
                + "<td class='review-price-cell' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</td>"
                + "<td><span class='review-pill'>" + escapeHtml(taskStatus(row)) + "</span><div class='review-task-sub'>" + escapeHtml(statusLine) + "</div></td>"
                + "</tr>";
        }).join("");
        target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>" + escapeHtml(title) + "</h3><div class='review-table-subtitle'>Задач: " + rows.length + ".</div></div><div class='file-row' style='margin-top:0'><button id='refreshInactiveTasks' class='btn btn-outline' type='button'>Обновить</button><button id='closeInactiveTasksModal' class='btn btn-square' type='button'>×</button></div></div>"
            + (rows.length ? "<div class='review-table-scroll'><table class='review-data-table'><thead><tr><th>Задача</th><th>Тип задачи</th><th>Наименование</th><th>Стоимость</th><th>Статус</th></tr></thead><tbody>" + body + "</tbody></table></div>" : "<div class='empty-state'>Пока пусто.</div>");
        const refresh = $("refreshInactiveTasks");
        if (refresh) refresh.addEventListener("click", () => { void loadInactiveTasks(); });
        const closeBtn = $("closeInactiveTasksModal");
        if (closeBtn) closeBtn.addEventListener("click", () => setFlowModalOpen("inactiveTasksModal", false));
        target.querySelectorAll("[data-inactive-task-detail]").forEach((row) => {
            row.addEventListener("click", () => openTaskDetail(row.dataset.inactiveTaskDetail, "inactive"));
        });
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
            const range = state.calendarRange || buildCalendarRange();
            const [wmsSettings, legacySettings, wmsRuns, legacyRuns] = await Promise.all([
                readOptionalRows(db, SETTINGS_TABLE, (query) => query.select("*").order("sort_order", { ascending: true })),
                readOptionalRows(db, LEGACY_SETTINGS_TABLE, (query) => query.select("*").order("sort_order", { ascending: true })),
                readOptionalRows(db, RUNS_TABLE, (query) => query.select("*").gte("effective_date", range.start).lte("effective_date", range.end).order("effective_date", { ascending: false })),
                readOptionalRows(db, LEGACY_RUNS_TABLE, (query) => query.select("*").gte("effective_date", range.start).lte("effective_date", range.end).order("effective_date", { ascending: false })),
            ]);
            if (wmsSettings.rows.length) applySettings(wmsSettings.rows);
            if (legacySettings.rows.length) applySettings(legacySettings.rows);
            if (!wmsRuns.ok && !legacyRuns.ok) throw wmsRuns.error || legacyRuns.error || new Error("Не удалось прочитать журналы выгрузок.");
            state.runs = mergeUploadRuns((legacyRuns.rows || []).concat(wmsRuns.rows || []));
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

    async function readOptionalRows(db, table, buildQuery) {
        try {
            const result = await buildQuery(db.from(table));
            if (result.error) throw result.error;
            return { ok: true, rows: Array.isArray(result.data) ? result.data : [] };
        } catch (error) {
            console.warn("optional table read failed:", table, error);
            return { ok: false, rows: [], error };
        }
    }

    function mergeUploadRuns(rows) {
        const merged = new Map();
        (rows || []).forEach((run) => {
            const effectiveDate = normalizeText(run.effective_date || run.business_date || run.upload_date);
            const sourceModule = normalizeText(run.source_module);
            const uploadType = normalizeText(run.upload_type || run.source_module);
            if (!effectiveDate || !sourceModule || !uploadType) return;
            merged.set([effectiveDate, sourceModule, uploadType].join("|"), run);
        });
        return Array.from(merged.values());
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
                offsetDays: settingNumber(row.upload_offset_days, current.offsetDays),
                taskDeadlineDays: settingNumber(row.task_deadline_days, current.taskDeadlineDays),
                pmDeadlineDays: settingNumber(row.pm_deadline_days, current.pmDeadlineDays),
                mailDeadlineDays: settingNumber(row.mail_deadline_days, current.mailDeadlineDays),
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
        setFlowModalOpen("uploadWork", false);
        setFlowModalOpen("masterWork", false);
        setFlowModalOpen("moduleChooser", true);
        renderModuleChooser();
    }

    function openBackfillChooser() {
        closeFlowModals();
        renderBackfillCalendar();
        setFlowModalOpen("backfillCalendarModal", true);
    }

    function chooseModule(module) {
        state.activeModule = module;
        state.activeDate = uploadDateForModule(module);
        state.preview = null;
        state.rows = {};
        state.files = {};
        setFlowModalOpen("moduleChooser", false);
        setFlowModalOpen("masterWork", false);
        setFlowModalOpen("uploadWork", true);
        renderWorkShell(module);
    }

    function renderWorkShell(module) {
        const def = moduleDef(module);
        $("workTitle").textContent = def.label;
        $("workSubtitle").textContent = module === "pm"
            ? "Выгрузка за " + formatRuDate(state.activeDate) + ". Дедлайн ПМ: " + formatRuDate(dueDateForBusinessDate("pm", state.activeDate, "pm")) + ", Почта: " + formatRuDate(dueDateForBusinessDate("pm", state.activeDate, "mail")) + "."
            : "Выгрузка за " + formatRuDate(state.activeDate) + ". Дедлайн задач: " + formatRuDate(dueDateForBusinessDate(module, state.activeDate)) + ".";
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
        normalizeWorksheetRange(sheet);
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
            if (kind === "afterSaleMovement") {
                const normalized = normalizeForMatch(line);
                const oldFormat = normalized.includes("товар") && normalized.includes("дата статуса") && normalized.includes("статус после реализации");
                const newFormat = normalized.includes("шк") && normalized.includes("время статуса") && normalized.includes("статус");
                if (oldFormat || newFormat) return i;
                continue;
            }
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
        const v2Product = normalizeIdentifier(row[1]);
        const v2StatusAt = parseDateTime(row[2]);
        if (v2Product && v2StatusAt.ts && normalizeText(row[3])) {
            const office = normalizeText(row[0]);
            const block = normalizeText(row[5]);
            return {
                row_number: rowNumber,
                office,
                block,
                product: v2Product,
                realized_at: normalizeText(row[8]),
                status_id: "",
                status: normalizeText(row[3]),
                status_at: normalizeText(row[2]),
                mx: [office, block].filter(Boolean).join(" / "),
                tare: normalizeIdentifier(row[6]),
                employee_id: normalizeIdentifier(row[7]),
                employee: "",
                office_id: normalizeIdentifier(row[4]),
                source_format: "after_sale_movement_v2",
            };
        }
        const product = normalizeIdentifier(row[2]);
        if (!product) return null;
        return { row_number: rowNumber, office: normalizeText(row[0]), block: normalizeText(row[1]), product, realized_at: normalizeText(row[3]), status_id: normalizeIdentifier(row[4]), status: normalizeText(row[5]), status_at: normalizeText(row[6]), mx: normalizeText(row[7]), tare: normalizeIdentifier(row[8]), employee_id: normalizeIdentifier(row[9]), employee: normalizeText(row[10]), source_format: "after_sale_movement_v1" };
    }

    async function readObjectWorkbookRows(file) {
        if (typeof window.XLSX === "undefined") throw new Error("Не загрузилась библиотека XLSX. Обновите страницу и попробуйте еще раз.");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("В файле не найдено листов.");
        const sheet = workbook.Sheets[firstSheetName];
        normalizeWorksheetRange(sheet);
        return XLSX.utils.sheet_to_json(sheet, { raw: true, defval: "" });
    }

    function normalizeHeaderKey(value) {
        return normalizeText(value)
            .toLowerCase()
            .replace(/\u00a0/g, " ")
            .replace(/ё/g, "е")
            .replace(/['"`]/g, "")
            .replace(/[()\[\].№]/g, "")
            .replace(/[\s_-]+/g, "");
    }

    function buildNormalizedObjectRow(row) {
        const out = {};
        Object.keys(row || {}).forEach((key) => { out[normalizeHeaderKey(key)] = row[key]; });
        return out;
    }

    function objectCell(row, normalizedRow, columnKey) {
        const variants = PURE_COLUMN_VARIANTS[columnKey] || [];
        for (const name of variants) {
            if (Object.prototype.hasOwnProperty.call(row || {}, name)) return row[name];
        }
        const normalizedVariants = PURE_NORMALIZED_COLUMN_VARIANTS[columnKey] || [];
        for (const key of normalizedVariants) {
            if (Object.prototype.hasOwnProperty.call(normalizedRow || {}, key)) return normalizedRow[key];
        }
        return "";
    }

    function toIntegerOrNull(value) {
        const id = normalizeIdentifier(value);
        if (!id) return null;
        const parsed = Number(id);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }

    function isTrueLike(value) {
        if (value === true) return true;
        if (value === false || value === 0 || value === null || value === undefined) return false;
        const normalized = normalizeForMatch(value);
        return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "да";
    }

    function normalizeLossReason(value) {
        const token = normalizeIdentifier(value);
        if (!token) return "";
        const integer = toIntegerOrNull(token);
        return integer !== null ? String(integer) : token;
    }

    function chunkArray(items, chunkSize) {
        const size = Math.max(Number(chunkSize) || 1, 1);
        const chunks = [];
        for (let i = 0; i < (items || []).length; i += size) chunks.push(items.slice(i, i + size));
        return chunks;
    }

    async function loadPureAutoLossReasonIds() {
        const db = supabaseDb();
        if (!db) return new Set(PURE_AUTO_IDS);
        try {
            const { data, error } = await db.from(LOSSES_TABLE).select("writeoff_id,is_auto");
            if (error) throw error;
            const result = new Set();
            (data || []).forEach((row) => {
                if (!isTrueLike(row && row.is_auto)) return;
                const lr = normalizeLossReason(row && row.writeoff_id);
                if (lr) result.add(lr);
            });
            return result.size ? result : new Set(PURE_AUTO_IDS);
        } catch (error) {
            console.warn("losses_rep auto ids fallback:", error);
            return new Set(PURE_AUTO_IDS);
        }
    }

    function addPureCounter(map, key, price) {
        const label = normalizeText(key) || "-";
        const current = map.get(label) || { key: label, count: 0, price: 0 };
        current.count += 1;
        current.price += Number(price) || 0;
        map.set(label, current);
    }

    function pureCounterRows(map) {
        return Array.from(map.values())
            .map((row) => ({ ...row, price: Math.round((Number(row.price) || 0) * 100) / 100 }))
            .sort((a, b) => b.count - a.count || b.price - a.price);
    }

    function preparePureLossesRows(rows, whId, targetDate, autoLrSet) {
        const rowsByKey = new Map();
        const postedRowsByKey = new Map();
        const byLr = new Map();
        const byStatusBeforeLost = new Map();
        const stats = {
            source_total_rows: (rows || []).length,
            target_date_rows: 0,
            wh_matched_rows: 0,
            auto_lr_matched_rows: 0,
            candidate_rows: 0,
            candidate_sum_price: 0,
            posted_signals: 0,
            skipped_by_date: 0,
            skipped_by_wh: 0,
            skipped_posted_flag: 0,
            skipped_by_is_auto: 0,
            skipped_invalid: 0,
            duplicate_in_file_ignored: 0,
            by_lr: [],
            by_status_before_lost: [],
        };
        (rows || []).forEach((row) => {
            const normalizedRow = buildNormalizedObjectRow(row);
            const dateLost = parseDateTime(objectCell(row, normalizedRow, "date_lost")).date;
            if (!dateLost) { stats.skipped_invalid += 1; return; }
            if (dateLost !== targetDate) { stats.skipped_by_date += 1; return; }
            stats.target_date_rows += 1;

            const rowWhId = normalizeIdentifier(objectCell(row, normalizedRow, "wh_id"));
            if (!rowWhId || rowWhId !== whId) { stats.skipped_by_wh += 1; return; }
            stats.wh_matched_rows += 1;

            const lrRaw = objectCell(row, normalizedRow, "lr");
            const lr = normalizeLossReason(lrRaw);
            if (!lr || !autoLrSet.has(lr)) { stats.skipped_by_is_auto += 1; return; }
            stats.auto_lr_matched_rows += 1;

            const shk = normalizeIdentifier(objectCell(row, normalizedRow, "shk"));
            if (!shk) { stats.skipped_invalid += 1; return; }
            const rowKey = shk + "|" + dateLost + "|" + rowWhId;
            if (isTrueLike(objectCell(row, normalizedRow, "posted_flag"))) {
                stats.skipped_posted_flag += 1;
                rowsByKey.delete(rowKey);
                if (postedRowsByKey.has(rowKey)) stats.duplicate_in_file_ignored += 1;
                else postedRowsByKey.set(rowKey, { shk, wh_id: rowWhId, date_lost: dateLost });
                return;
            }
            if (postedRowsByKey.has(rowKey) || rowsByKey.has(rowKey)) {
                stats.duplicate_in_file_ignored += 1;
                return;
            }
            const incoming = {
                shk,
                nm: toIntegerOrNull(objectCell(row, normalizedRow, "nm")),
                decription: normalizeText(objectCell(row, normalizedRow, "decription")),
                brand: normalizeText(objectCell(row, normalizedRow, "brand")),
                shk_state_before_lost: normalizeText(objectCell(row, normalizedRow, "shk_state_before_lost")),
                wh_id: rowWhId,
                date_lost: dateLost,
                lr: toIntegerOrNull(lrRaw) ?? toIntegerOrNull(lr) ?? lr,
                price: normalizePrice(objectCell(row, normalizedRow, "price")) ?? 0,
            };
            rowsByKey.set(rowKey, incoming);
        });
        rowsByKey.forEach((row) => {
            stats.candidate_sum_price += Number(row.price) || 0;
            addPureCounter(byLr, row.lr, row.price);
            addPureCounter(byStatusBeforeLost, row.shk_state_before_lost, row.price);
        });
        stats.candidate_sum_price = Math.round(stats.candidate_sum_price * 100) / 100;
        stats.candidate_rows = rowsByKey.size;
        stats.posted_signals = postedRowsByKey.size;
        stats.by_lr = pureCounterRows(byLr);
        stats.by_status_before_lost = pureCounterRows(byStatusBeforeLost);
        return { rowsByKey, postedRowsByKey, stats };
    }

    function collectPureShks(prepared) {
        const shks = new Set();
        if (prepared && prepared.rowsByKey instanceof Map) prepared.rowsByKey.forEach((row) => { if (row.shk) shks.add(row.shk); });
        if (prepared && prepared.postedRowsByKey instanceof Map) prepared.postedRowsByKey.forEach((row) => { if (row.shk) shks.add(row.shk); });
        return Array.from(shks);
    }

    async function fetchPureRowsByShkChunk(shksChunk, whId, targetDate) {
        if (!shksChunk.length) return [];
        const db = supabaseDb();
        const { data, error } = await db
            .from(PURE_LOSSES_TABLE)
            .select("*")
            .in("shk", shksChunk)
            .eq("wh_id", whId)
            .eq("date_lost", targetDate);
        if (!error) return Array.isArray(data) ? data : [];
        if (shksChunk.length > 1) {
            const mid = Math.ceil(shksChunk.length / 2);
            const left = await fetchPureRowsByShkChunk(shksChunk.slice(0, mid), whId, targetDate);
            const right = await fetchPureRowsByShkChunk(shksChunk.slice(mid), whId, targetDate);
            return left.concat(right);
        }
        throw new Error("Не удалось проверить ШК " + shksChunk[0] + " в pure_losses_rep: " + error.message);
    }

    async function loadExistingPureRowsByShk(shks, whId, targetDate) {
        const result = new Map();
        for (const chunk of chunkArray(shks, PURE_URL_FILTER_CHUNK_SIZE)) {
            const rows = await fetchPureRowsByShkChunk(chunk, whId, targetDate);
            (rows || []).forEach((row) => {
                const shk = normalizeIdentifier(row && row.shk);
                if (!shk) return;
                if (!result.has(shk)) result.set(shk, []);
                result.get(shk).push(row);
            });
        }
        return result;
    }

    function isSamePureShkDateWh(row, shkValue, dateLostValue, whIdValue) {
        return normalizeIdentifier(row && row.shk) === normalizeIdentifier(shkValue)
            && parseDateTime(row && row.date_lost).date === parseDateTime(dateLostValue).date
            && (!normalizeIdentifier(whIdValue) || normalizeIdentifier(row && row.wh_id) === normalizeIdentifier(whIdValue));
    }

    function pureResolutionValue(row, columns) {
        for (const column of columns) {
            if (!Object.prototype.hasOwnProperty.call(row || {}, column)) continue;
            const raw = row[column];
            const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw.value ?? raw.name) : raw;
            const text = normalizeText(value);
            if (text) return text;
        }
        return "";
    }

    function isPureRowPendingForAutoFound(row) {
        return !pureResolutionValue(row, ["opp_deecision", "opp_decision", "decision"])
            && !pureResolutionValue(row, ["opp_comment", "comment"]);
    }

    function pureRowIdTarget(row) {
        for (const column of ["id", "pure_losses_id", "row_id"]) {
            const value = normalizeText(row && row[column]);
            if (value) return { column, value };
        }
        return null;
    }

    function buildPureSyncPlan(prepared, existingByShk, whId) {
        const rowsToInsert = [];
        const autoFoundUpdates = [];
        const stats = { planned_insert_new: 0, skipped_same_date: 0, planned_auto_mark_found: 0 };
        prepared.rowsByKey.forEach((incoming) => {
            const existingRows = existingByShk.get(incoming.shk) || [];
            const hasSameDate = existingRows.some((row) => isSamePureShkDateWh(row, incoming.shk, incoming.date_lost, whId));
            if (hasSameDate) { stats.skipped_same_date += 1; return; }
            rowsToInsert.push({
                shk: incoming.shk,
                nm: incoming.nm,
                decription: incoming.decription,
                brand: incoming.brand,
                shk_state_before_lost: incoming.shk_state_before_lost,
                wh_id: incoming.wh_id,
                date_lost: incoming.date_lost,
                lr: incoming.lr,
                price: incoming.price,
            });
            stats.planned_insert_new += 1;
        });
        const seenUpdates = new Set();
        prepared.postedRowsByKey.forEach((postedSignal) => {
            const existingRows = existingByShk.get(postedSignal.shk) || [];
            existingRows.forEach((row) => {
                if (!isSamePureShkDateWh(row, postedSignal.shk, postedSignal.date_lost, whId)) return;
                if (!isPureRowPendingForAutoFound(row)) return;
                const idTarget = pureRowIdTarget(row);
                const key = idTarget ? idTarget.column + ":" + idTarget.value : postedSignal.shk + "|" + postedSignal.date_lost + "|" + postedSignal.wh_id;
                if (seenUpdates.has(key)) return;
                seenUpdates.add(key);
                autoFoundUpdates.push({ idTarget, ...postedSignal });
            });
        });
        stats.planned_auto_mark_found = autoFoundUpdates.length;
        return { rowsToInsert, autoFoundUpdates, stats };
    }

    function extractMissingColumnName(error) {
        const text = String((error && (error.message || error.details)) || "");
        const match = text.match(/column\s+([^\s]+)\s+does not exist/i)
            || text.match(/could not find(?:\s+the)?\s+"?([a-z0-9_.]+)"?\s+column/i);
        if (!match || !match[1]) return "";
        const parts = String(match[1]).replace(/"/g, "").split(".");
        return parts[parts.length - 1] || "";
    }

    async function insertPureRowsAdaptive(rowsChunk, unsupportedColumns) {
        const preparedRows = (rowsChunk || []).map((row) => {
            const out = {};
            Object.entries(row || {}).forEach(([key, value]) => {
                if (unsupportedColumns.has(key) || value === undefined) return;
                out[key] = value;
            });
            return out;
        }).filter((row) => Object.keys(row).length);
        if (!preparedRows.length) return 0;
        const { error } = await supabaseDb().from(PURE_LOSSES_TABLE).insert(preparedRows);
        if (!error) return preparedRows.length;
        const missing = extractMissingColumnName(error);
        if (missing && preparedRows.some((row) => Object.prototype.hasOwnProperty.call(row, missing))) {
            unsupportedColumns.add(missing);
            return insertPureRowsAdaptive(rowsChunk, unsupportedColumns);
        }
        throw new Error("Не удалось вставить строки в pure_losses_rep: " + error.message);
    }

    async function applyPureAutoFoundUpdate(target, unsupportedColumns) {
        const patch = {
            opp_deecision: AUTO_FOUND_DECISION,
            opp_emp: AUTO_FOUND_EMP_ID,
            opp_comment: AUTO_FOUND_COMMENT,
        };
        Object.keys(patch).forEach((key) => { if (unsupportedColumns.has(key)) delete patch[key]; });
        if (!Object.keys(patch).length) return false;
        let query = supabaseDb().from(PURE_LOSSES_TABLE).update(patch);
        if (target.idTarget && target.idTarget.column && target.idTarget.value) {
            query = query.eq(target.idTarget.column, target.idTarget.value);
        } else {
            query = query.eq("shk", target.shk).eq("wh_id", target.wh_id).eq("date_lost", target.date_lost);
        }
        const { error } = await query;
        if (!error) return true;
        const missing = extractMissingColumnName(error);
        if (missing && Object.prototype.hasOwnProperty.call(patch, missing)) {
            unsupportedColumns.add(missing);
            return applyPureAutoFoundUpdate(target, unsupportedColumns);
        }
        throw new Error("Не удалось обновить строку с движением товара: " + error.message);
    }

    async function applyPureLossesImport(prepared, whId, targetDate) {
        const shks = collectPureShks(prepared);
        const existingByShk = await loadExistingPureRowsByShk(shks, whId, targetDate);
        const syncPlan = buildPureSyncPlan(prepared, existingByShk, whId);
        const unsupportedInsertColumns = new Set();
        const unsupportedUpdateColumns = new Set();
        let insertedNew = 0;
        let autoMarkedFound = 0;
        for (const chunk of chunkArray(syncPlan.rowsToInsert, PURE_INSERT_CHUNK_SIZE)) insertedNew += await insertPureRowsAdaptive(chunk, unsupportedInsertColumns);
        for (const target of syncPlan.autoFoundUpdates) {
            if (await applyPureAutoFoundUpdate(target, unsupportedUpdateColumns)) autoMarkedFound += 1;
        }
        return {
            inserted_new: insertedNew,
            auto_marked_found: autoMarkedFound,
            planned_insert_new: syncPlan.stats.planned_insert_new,
            planned_auto_mark_found: syncPlan.stats.planned_auto_mark_found,
            skipped_same_date: syncPlan.stats.skipped_same_date,
        };
    }

    function sourceStatusCode(value) { return latinStatusCode(value).toLowerCase() || normalizeForMatch(value); }
    function sourceRowStatus(row) { return sourceStatusCode(row && row.product_status); }
    function isRwpStatus(value) { return sourceStatusCode(value) === "rwp" || normalizeForMatch(value) === normalizeForMatch(RWP_STATUS); }
    function isPmBufferStatus(value) { return PM_BUFFER_STATUSES.has(sourceStatusCode(value)); }
    function mxHasPresortExclusion(mx) { const normalized = normalizeForMatch(mx); return PRESORT_EXCLUDED_MX_PARTS.some((part) => normalized.includes(part)); }
    function mxIncludes(row, part) { return normalizeForMatch(row && row.mx).includes(normalizeForMatch(part)); }
    function mxHasBuffer(row) { return normalizeForMatch(row && row.mx).includes("буфер"); }
    function isPresortStatus(row) {
        const status = sourceRowStatus(row);
        if (status === "sps") return true;
        if (status === "pwt") return !mxHasBuffer(row) && !mxHasPresortExclusion(row && row.mx);
        if ((status === "gws" || status === "wmi") && !mxHasPresortExclusion(row && row.mx)) return true;
        return false;
    }
    function isLabelingStatus(row) { return sourceRowStatus(row) === "lgr"; }
    function isMarketplaceStatus(row) {
        const status = sourceRowStatus(row);
        if (status === "pap") return true;
        return (status === "gws" || status === "pwt") && mxIncludes(row, "Пред сортировка МП");
    }
    function isPcStatus(row) {
        const status = sourceRowStatus(row);
        if (status === "smc") return true;
        return (status === "gws" || status === "pwt") && mxIncludes(row, "Сортировка в сетки");
    }
    function isWmiMpPcStatus(row) {
        const status = sourceRowStatus(row);
        return status === "wmi" && (mxIncludes(row, "Пред сортировка МП") || mxIncludes(row, "Сортировка в сетки"));
    }
    function isNoOrderUsdStatus(row) { return sourceRowStatus(row) === "usd"; }
    function isNoOrderTmmStatus(row) { return sourceRowStatus(row) === "tmm"; }
    function isMultiShipmentBufferMx(value) { return normalizeForMatch(value).includes("буфер мультиотгрузки"); }
    function mxHasBoxes(row) { return normalizeForMatch(row && row.mx).includes("коробк"); }
    function isGateMx(value) { return normalizeForMatch(value).includes("ворота"); }

    function routeNumberFromMx(mx) {
        const matches = normalizeText(mx).match(/\d{1,3}/g);
        if (!matches || !matches.length) return null;
        const value = Number(matches[matches.length - 1]);
        return Number.isFinite(value) ? value : null;
    }

    function isMailRoute(routeNumber) { return routeNumber !== null && MAIL_ROUTES.has(routeNumber); }

    function routeLabelFromMx(mx, routeNumber) {
        const number = routeNumber || routeNumberFromMx(mx);
        if (isMultiShipmentBufferMx(mx)) return "Мультиотгрузка " + (number || "без номера");
        return "Парковка " + (number || "без номера");
    }

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

    function itemNameFromRows(rows) {
        const names = Array.from(new Set((rows || []).map((row) => normalizeText(row && row.name)).filter(Boolean)));
        if (!names.length) return "";
        return names.length === 1 ? names[0] : names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : "");
    }

    function taskStatusCodeLabel(row) {
        const codes = Array.from(new Set(taskItems(row).map((item) => latinStatusCode(item.status)).filter(Boolean)));
        if (!codes.length) return "";
        return codes.length <= 3 ? codes.join("/") : codes.slice(0, 3).join("/") + "+" + (codes.length - 3);
    }

    function displayTaskTitle(row) {
        const title = normalizeText(row && row.title) || normalizeText(row && row.source_id) || "-";
        const code = taskStatusCodeLabel(row);
        if (!code) return title;
        return title.includes("[" + code + "]") ? title : title + " [" + code + "]";
    }

    function taskTitleForShk(shk) {
        return "ШК " + normalizeIdentifier(shk);
    }

    function taskTitleForTare(tare) {
        return "Тара " + normalizeIdentifier(tare);
    }

    function taskItemFromSourceRow(row) {
        const shk = normalizeIdentifier(row && (row.product || row.shk));
        if (!shk) return null;
        return {
            shk,
            name: normalizeText(row && row.name),
            status: normalizeText(row && (row.product_status || row.last_status || row.status)),
            price: Number(row && row.price) || 0,
            mx: normalizeText(row && (row.mx || row.block)),
            movement: normalizeText(row && (row.last_movement || row.created_at || row.status_at)),
            row_number: row && row.row_number ? row.row_number : null,
            raw: row || {},
        };
    }

    function taskItemsFromSourceRows(rows) {
        const seen = new Set();
        const items = [];
        (rows || []).forEach((row) => {
            const item = taskItemFromSourceRow(row);
            if (!item || seen.has(item.shk)) return;
            seen.add(item.shk);
            items.push(item);
        });
        return items;
    }

    function productIdsFromRows(rows) {
        return (rows || []).map((row) => row.product || row.shk).map(normalizeIdentifier).filter(Boolean);
    }

    function productIdsFromTasks(tasks) {
        const ids = [];
        (tasks || []).forEach((task) => {
            if (Array.isArray(task.source_shk_ids)) ids.push(...task.source_shk_ids);
        });
        return Array.from(new Set(ids.map(normalizeIdentifier).filter(Boolean)));
    }

    function shiftAssigneeForZone(zone) {
        const shift = state.shift.current;
        if (!shift) return null;
        const normalized = normalizeForMatch(zone);
        const id = normalized.includes("вход")
            ? shift.incoming_employee_id
            : normalized.includes("исход")
                ? shift.outgoing_employee_id
                : "";
        return id ? employeeById(id) : null;
    }

    function candidateIdsForSpecial(preview) {
        const direct = Array.isArray(preview && preview.specialCandidateIds) ? preview.specialCandidateIds : [];
        const fallback = productIdsFromTasks(preview && preview.tasks);
        return Array.from(new Set(direct.concat(fallback).map(normalizeIdentifier).filter(Boolean)));
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
        return {
            tag_name: tagName,
            matched_shk: matchedShk,
            second_shk: matchedShk === shk1 ? shk2 : matchedShk === shk2 ? shk1 : (shk2 || shk1),
            media: normalizeText(row.media),
            created_at: normalizeText(row.created_at),
            wh_id: normalizeIdentifier(row.wh_id),
        };
    }

    async function loadSpecialMap(productIdsRaw) {
        const db = supabaseDb();
        const productIds = Array.from(new Set((productIdsRaw || []).map(normalizeIdentifier).filter(Boolean)));
        const result = new Map();
        if (!db || !productIds.length) return result;
        const productSet = new Set(productIds);
        const chunks = [];
        for (let i = 0; i < productIds.length; i += SPECIAL_LOOKUP_CHUNK_SIZE) chunks.push(productIds.slice(i, i + SPECIAL_LOOKUP_CHUNK_SIZE));
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
            for (let i = 0; i < chunks.length; i += SPECIAL_LOOKUP_CONCURRENCY) {
                const batch = chunks.slice(i, i + SPECIAL_LOOKUP_CONCURRENCY);
                const results = await Promise.all(batch.map(async (chunk) => {
                    let q1 = db.from(TWO_SHK_TABLE).select("shk1,shk2,eventtype,media,wh_id,created_at").in("shk1", chunk).order("created_at", { ascending: false });
                    let q2 = db.from(TWO_SHK_TABLE).select("shk1,shk2,eventtype,media,wh_id,created_at").in("shk2", chunk).order("created_at", { ascending: false });
                    if (WH_ID) { q1 = q1.eq("wh_id", WH_ID); q2 = q2.eq("wh_id", WH_ID); }
                    return Promise.all([q1, q2]);
                }));
                results.flat().forEach((queryResult) => {
                    if (!queryResult.error) applyRows(queryResult.data);
                });
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
        const assignee = shiftAssigneeForZone(options.responsibilityZone);
        const sourceIds = (options.productIds || []).map(normalizeIdentifier).filter(Boolean);
        const specialMap = options.specialMap || new Map();
        const specialInfos = specialInfosForIds(sourceIds, specialMap);
        const tags = mergeTags(options.tags || [], specialInfos);
        const taskItems = taskItemsFromSourceRows(options.rows);
        const itemName = itemNameFromRows(options.rows);
        const sourcePayload = {
            ...(options.payload || {}),
            task_items: taskItems,
            item_name: itemName || (options.payload && options.payload.item_name) || "",
        };
        if (specialInfos.length) sourcePayload.special_infos = specialInfos;
        return {
            module: options.module,
            source_module: options.sourceModule,
            source_table: options.sourceTable || "manual_xlsx",
            source_id: options.sourceId,
            source_row_id: sourceRowId(options.rows),
            source_payload: sourcePayload,
            source_generated_at: new Date().toISOString(),
            source_shk_ids: sourceIds,
            source_tare_id: options.tareId || "",
            source_price_sum: options.price || 0,
            source_last_movement_at: sourceLastMovement(options.rows),
            search_text: [options.title, itemName, options.taskType, options.column, options.tareId, ...sourceIds].filter(Boolean).join(" "),
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
            assignee_employee_id: assignee ? normalizeText(assignee.employee_id) : "",
            assignee_name: assignee ? normalizeText(assignee.full_name) : "",
            tags,
            column: options.column,
        };
    }

    function splitSpecialRows(rows, specialMap, productField) {
        const regular = [];
        const special = [];
        const lookup = specialMap || new Map();
        (rows || []).forEach((row) => {
            const id = normalizeIdentifier(row[productField]);
            if (id && lookup.has(id)) special.push(row);
            else regular.push(row);
        });
        return { regular, special };
    }

    function newestRow(rows, field) {
        return (rows || []).slice().sort((a, b) => parseDateTime(b[field]).ts - parseDateTime(a[field]).ts)[0] || rows[0];
    }

    function buildPackagingPreview(rows, module, businessDate, specialMap) {
        specialMap = specialMap || new Map();
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
                    title: taskTitleForTare(tareId),
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
                title: taskTitleForShk(row.shk),
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
        return { mode: module, sourceRows: rows.length, rowsCount: uniqueRows.length, dateFilteredOut: statusRows.length - dateRows.length, duplicateShkCount, groupedTareCount, skippedCheap, specialCount: split.special.length, specialCandidateIds: uniqueRows.map((row) => row.shk), tasks };
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
        const specialMap = options.specialMap || new Map();
        const split = splitSpecialRows(rows, specialMap, "product");
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
                    title: taskTitleForTare(transfer),
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
                    specialMap,
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
                title: taskTitleForShk(row.product),
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
                specialMap,
                payload: { entity_type: specialMap.has(row.product) ? "special_shk" : "shk", row },
                infoLines: ["Искомый ШК: " + row.product, "Тара: " + (row.transfer || "-"), "Блок/МХ: " + (row.mx || "-"), "Статус крайнего движения: " + (row.product_status || "-")],
            }));
        });
        return { tasks, groupedTareCount, singleCount: singles.length + split.special.length, specialCount: split.special.length };
    }

    function buildPmPreview(sourceRows, carrierRows, businessDate, specialMap) {
        specialMap = specialMap || new Map();
        const def = moduleDef("pm");
        const pmDueDate = dueDateForBusinessDate("pm", businessDate, "pm");
        const mailDueDate = dueDateForBusinessDate("pm", businessDate, "mail");
        const dateRows = sourceRows.filter((row) => parseDateTime(row.created_at).date === businessDate);
        const eligibleDateRows = dateRows.filter((row) => !mxHasBoxes(row));
        const smsRows = eligibleDateRows.filter((row) => isPmBufferStatus(row.product_status));
        const transferIds = Array.from(new Set(smsRows.map((row) => row.transfer).filter(isGroupableIdentifier))).sort((a, b) => a.localeCompare(b, "ru"));
        const excludedTransfers = new Set((carrierRows || []).filter((row) => normalizeForMatch(row.mx).includes("отгрузка сторонним перевозчиком")).map((row) => row.transfer));
        const carrierGateMxByTransfer = new Map();
        (carrierRows || []).forEach((row) => {
            if (!row.transfer || excludedTransfers.has(row.transfer) || !isGateMx(row.mx)) return;
            if (!carrierGateMxByTransfer.has(row.transfer)) carrierGateMxByTransfer.set(row.transfer, row.mx);
        });
        const byTransfer = new Map();
        eligibleDateRows.forEach((row) => {
            const group = byTransfer.get(row.transfer) || [];
            group.push(row);
            byTransfer.set(row.transfer, group);
        });
        const tasks = [];
        let excludedByCarrier = 0;
        let cheapTransfers = 0;
        let specialTaskCount = 0;
        const specialCandidateIds = [];
        transferIds.forEach((transfer) => {
            const allRows = byTransfer.get(transfer) || [];
            if (excludedTransfers.has(transfer)) { excludedByCarrier += 1; return; }
            specialCandidateIds.push(...allRows.map((row) => row.product));
            const specialSplit = splitSpecialRows(allRows, specialMap, "product");
            specialSplit.special.forEach((row) => {
                specialTaskCount += 1;
                const routeMx = isMultiShipmentBufferMx(row.mx) ? (carrierGateMxByTransfer.get(transfer) || row.mx) : row.mx;
                const routeNumber = routeNumberFromMx(routeMx);
                const routeLabel = routeLabelFromMx(row.mx, isMultiShipmentBufferMx(row.mx) ? routeNumberFromMx(row.mx) : routeNumber);
                const mail = isMailRoute(routeNumber);
                const taskType = mail ? "Разбор ОПП // Почта" : "Разбор ОПП // ПМ";
                tasks.push(taskRecord({
                    module: "pm",
                    sourceModule: def.sourceModule,
                    uploadType: def.uploadType,
                    businessDate,
                    sourceId: (mail ? "mail" : "pm") + ":special:" + row.product + "|" + businessDate,
                    title: taskTitleForShk(row.product),
                    taskType,
                    descriptionTaskType: taskType,
                    column: mail ? "Почта" : "ПМ",
                    dueDate: mail ? mailDueDate : pmDueDate,
                    responsibilityZone: def.responsibilityZone,
                    productIds: [row.product],
                    rows: [row],
                    tareId: transfer,
                    price: row.price,
                    tags: mail ? ["почта"] : [],
                    specialMap,
                    payload: { entity_type: "special_shk", transfer, route_number: routeNumber, route_label: routeLabel, row },
                    infoLines: ["Передача: " + transfer, "Искомый ШК: " + row.product, routeLabel || "-", "МХ: " + (row.mx || "-"), "Статус крайнего движения: " + (row.product_status || "-")],
                }));
            });
            const groupRows = specialSplit.regular;
            if (!groupRows.length) return;
            const priceSum = rowsPrice(groupRows, "price");
            if (priceSum < 2000) { cheapTransfers += 1; return; }
            const primary = groupRows.find((row) => isPmBufferStatus(row.product_status)) || groupRows[0];
            const routeMx = isMultiShipmentBufferMx(primary.mx) ? (carrierGateMxByTransfer.get(transfer) || primary.mx) : primary.mx;
            const routeNumber = routeNumberFromMx(routeMx);
            const routeLabel = routeLabelFromMx(primary.mx, isMultiShipmentBufferMx(primary.mx) ? routeNumberFromMx(primary.mx) : routeNumber);
            const mail = isMailRoute(routeNumber);
            const taskType = mail ? "Разбор ОПП // Почта" : "Разбор ОПП // ПМ";
            tasks.push(taskRecord({
                module: "pm",
                sourceModule: def.sourceModule,
                uploadType: def.uploadType,
                businessDate,
                sourceId: (mail ? "mail" : "pm") + ":transfer:" + transfer + "|" + businessDate,
                title: taskTitleForTare(transfer),
                taskType,
                descriptionTaskType: taskType,
                column: mail ? "Почта" : "ПМ",
                dueDate: mail ? mailDueDate : pmDueDate,
                responsibilityZone: def.responsibilityZone,
                productIds: groupRows.map((row) => row.product),
                rows: groupRows,
                tareId: transfer,
                price: priceSum,
                tags: mail ? ["почта"] : [],
                specialMap,
                payload: { entity_type: "transfer", transfer, route_number: routeNumber, route_label: routeLabel, rows: groupRows.slice(0, 40) },
                infoLines: ["Передача: " + transfer, routeLabel || "-", "ШК в передаче:", ...groupRows.map((row) => "- " + row.product + " / " + (row.product_status || "-") + " / " + formatMoney(row.price))],
            }));
        });
        return { mode: "pm", sourceRows: sourceRows.length, rowsCount: smsRows.length, dateFilteredOut: sourceRows.length - dateRows.length, boxesFilteredOut: dateRows.length - eligibleDateRows.length, smsTransfers: transferIds.length, excludedByCarrier, cheapTransfers, specialTaskCount, specialCandidateIds, copiedTransferIds: transferIds, tasks, pmTasks: tasks.filter((task) => task.task_type === "Разбор ОПП // ПМ").length, mailTasks: tasks.filter((task) => task.task_type === "Разбор ОПП // Почта").length };
    }

    function buildPresortPreview(sourceRows, businessDate, specialMap) {
        specialMap = specialMap || new Map();
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
        return { mode: "presort", sourceRows: sourceRows.length, rowsCount: presortRows.length, dateFilteredOut: sourceRows.length - rows.length, labelingRows: labelingRows.length, groupedTareCount: presort.groupedTareCount + labeling.groupedTareCount, specialCount: presort.specialCount + labeling.specialCount, specialCandidateIds: productIdsFromRows(presortRows.concat(labelingRows)), tasks, presortTasks: presort.tasks.length, labelingTasks: labeling.tasks.length };
    }

    function buildMarketplacePcPreview(sourceRows, businessDate, specialMap) {
        specialMap = specialMap || new Map();
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
        return { mode: "marketplace_pc", sourceRows: sourceRows.length, rowsCount: marketplaceRows.length + pcRows.length, dateFilteredOut: sourceRows.filter((row) => !targetDates.has(parseDateTime(row.created_at).date)).length, marketplaceRows: marketplaceRows.length, pcRows: pcRows.length, groupedTareCount: marketplace.groupedTareCount + pc.groupedTareCount, specialCount: marketplace.specialCount + pc.specialCount, specialCandidateIds: productIdsFromRows(marketplaceRows.concat(pcRows)), tasks, marketplaceTasks: marketplace.tasks.length, pcTasks: pc.tasks.length };
    }

    function buildWmiMpPcPreview(sourceRows, businessDate, specialMap) {
        specialMap = specialMap || new Map();
        const def = moduleDef("wmi_mp_pc");
        const rows = sourceRows.filter((row) => parseDateTime(row.created_at).date === businessDate);
        const wmiRows = rows.filter(isWmiMpPcStatus);
        const grouped = appendGroupedTasks(wmiRows, { module: "wmi_mp_pc", sourceModule: def.sourceModule, uploadType: def.uploadType, businessDate, sourcePrefix: "wmi_mp_pc", titlePrefix: "WMI (МП + ПЦ)", taskType: def.taskType, descriptionTaskType: def.taskTypeLabel, column: def.column, dueDate: dueDateForBusinessDate("wmi_mp_pc", businessDate), responsibilityZone: def.responsibilityZone, specialMap });
        return { mode: "wmi_mp_pc", sourceRows: sourceRows.length, rowsCount: wmiRows.length, dateFilteredOut: sourceRows.length - rows.length, groupedTareCount: grouped.groupedTareCount, specialCount: grouped.specialCount, specialCandidateIds: productIdsFromRows(wmiRows), tasks: grouped.tasks, wmiTasks: grouped.tasks.length };
    }

    function buildNoOrderPreview(sourceRows, businessDate, specialMap) {
        specialMap = specialMap || new Map();
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
        return { mode: "no_order", sourceRows: sourceRows.length, rowsCount: rows.length, dateFilteredOut: sourceRows.length - rows.length, groupedTareCount: noOrder.groupedTareCount + usd.groupedTareCount + tmm.groupedTareCount, specialCount: noOrder.specialCount + usd.specialCount + tmm.specialCount, specialCandidateIds: productIdsFromRows(rows), usdRows: usdRows.length, tmmRows: tmmRows.length, tasks, noOrderTasks: noOrder.tasks.length, usdTasks: usd.tasks.length, tmmTasks: tmm.tasks.length };
    }

    function buildAfterSaleMovementPreview(sourceRows, businessDate, specialMap) {
        specialMap = specialMap || new Map();
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
                title: taskTitleForShk(row.product),
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
        return { mode: "after_sale_movement", sourceRows: sourceRows.length, rowsCount: rows.length, dateFilteredOut: sourceRows.length - rows.length, duplicateProductCount, specialCandidateIds: productIdsFromRows(rows), tasks, afterSaleMovementTasks: tasks.length };
    }

    function buildPreviewForModule(module, rows, carrierRows, businessDate, specialMap) {
        specialMap = specialMap || new Map();
        if (module === "packaging" || module === "rwp") return buildPackagingPreview(rows, module, businessDate, specialMap);
        if (module === "pm") return buildPmPreview(rows, carrierRows || [], businessDate, specialMap);
        if (module === "presort") return buildPresortPreview(rows, businessDate, specialMap);
        if (module === "marketplace_pc") return buildMarketplacePcPreview(rows, businessDate, specialMap);
        if (module === "wmi_mp_pc") return buildWmiMpPcPreview(rows, businessDate, specialMap);
        if (module === "no_order") return buildNoOrderPreview(rows, businessDate, specialMap);
        if (module === "after_sale_movement") return buildAfterSaleMovementPreview(rows, businessDate, specialMap);
        return { mode: module, tasks: [] };
    }

    function specialStatusText(preview) {
        if (!preview) return "";
        if (preview.specialStatus === "checking") return "2ШК/ПУ: проверяю в фоне " + (preview.specialLookupCount || 0) + " ШК.";
        if (preview.specialStatus === "done") return "2ШК/ПУ: проверено " + (preview.specialLookupCount || 0) + " ШК, найдено " + (preview.specialMatchedCount || 0) + ".";
        if (preview.specialStatus === "skipped") return "2ШК/ПУ: нечего проверять.";
        if (preview.specialStatus === "error") return "2ШК/ПУ: проверка не удалась, можно повторить загрузку.";
        return "";
    }

    function startSpecialBackground(module, rows, carrierRows, businessDate, context) {
        const preview = state.preview;
        const ids = candidateIdsForSpecial(preview);
        const token = Date.now() + ":" + Math.random().toString(16).slice(2);
        if (!ids.length) {
            preview.specialStatus = "skipped";
            preview.specialLookupCount = 0;
            preview.specialMatchedCount = 0;
            state.specialCheck = null;
            renderPreview(preview);
            return;
        }
        preview.specialStatus = "checking";
        preview.specialLookupCount = ids.length;
        preview.specialMatchedCount = 0;
        state.specialCheck = {
            token,
            pending: true,
            promise: (async () => {
                try {
                    const specialMap = await loadSpecialMap(ids);
                    if (!state.specialCheck || state.specialCheck.token !== token) return null;
                    const enriched = buildPreviewForModule(module, rows, carrierRows || [], businessDate, specialMap);
                    enriched.specialStatus = "done";
                    enriched.specialLookupCount = ids.length;
                    enriched.specialMatchedCount = specialMap.size;
                    state.preview = enriched;
                    renderPreview(enriched);
                    $("saveUpload").disabled = !enriched.tasks.length;
                    setStatus((context || "Предпросмотр готов.") + "\n" + specialStatusText(enriched), enriched.tasks.length ? "good" : "");
                    return enriched;
                } catch (error) {
                    if (!state.specialCheck || state.specialCheck.token !== token) return null;
                    preview.specialStatus = "error";
                    renderPreview(preview);
                    setStatus("Предпросмотр готов, но фоновая проверка 2ШК/ПУ упала: " + (error && error.message ? error.message : String(error)), "error");
                    return preview;
                } finally {
                    if (state.specialCheck && state.specialCheck.token === token) state.specialCheck.pending = false;
                }
            })(),
        };
        renderPreview(preview);
        setStatus((context || "Предпросмотр готов.") + "\n" + specialStatusText(preview), preview.tasks.length ? "good" : "");
    }

    async function waitForSpecialBackground() {
        if (!state.specialCheck || !state.specialCheck.pending || !state.specialCheck.promise) return;
        setStatus("Дожидаюсь фоновой проверки 2ШК/ПУ перед сохранением...");
        await state.specialCheck.promise;
    }

    async function handleSingleFile(module, file, kind) {
        state.files.primary = file;
        $("fileName").textContent = "Файл выбран: " + file.name;
        setStatus("Читаю файл...");
        const rows = await readWorkbookRows(file, kind);
        state.rows.primary = rows;
        state.specialCheck = null;
        if (module === "pm") {
            state.rows.carrier = [];
            state.preview = buildPreviewForModule(module, rows, [], state.activeDate);
            renderPreview(state.preview);
            $("copyTransfers").disabled = !(state.preview.copiedTransferIds || []).length;
            $("skipCarrier").disabled = false;
            $("carrierLabel").style.display = "inline-flex";
            startSpecialBackground(module, rows, [], state.activeDate, "Основной файл прочитан. Строк: " + rows.length + ". Скопируйте передачи и загрузите проверку отгрузки либо пропустите второй файл.");
            return;
        }
        state.preview = buildPreviewForModule(module, rows, [], state.activeDate);
        renderPreview(state.preview);
        $("saveUpload").disabled = !state.preview.tasks.length;
        startSpecialBackground(module, rows, [], state.activeDate, state.preview.tasks.length ? "Предпросмотр готов. К сохранению: " + state.preview.tasks.length + "." : "Нет задач по текущим правилам.");
    }

    async function handleCarrierFile(file) {
        state.files.carrier = file;
        $("fileName").textContent = "Основной и второй файлы выбраны";
        setStatus("Читаю проверку отгрузки...");
        const rows = await readWorkbookRows(file, "pmCarrier");
        state.rows.carrier = rows;
        state.specialCheck = null;
        state.preview = buildPreviewForModule("pm", state.rows.primary || [], rows, state.activeDate);
        renderPreview(state.preview);
        $("saveUpload").disabled = !state.preview.tasks.length;
        startSpecialBackground("pm", state.rows.primary || [], rows, state.activeDate, state.preview.tasks.length ? "Предпросмотр готов. К сохранению: " + state.preview.tasks.length + "." : "Нет задач по текущим правилам.");
    }

    async function skipCarrierFile() {
        state.rows.carrier = [];
        state.files.carrier = null;
        state.specialCheck = null;
        state.preview = buildPreviewForModule("pm", state.rows.primary || [], [], state.activeDate);
        renderPreview(state.preview);
        $("saveUpload").disabled = !state.preview.tasks.length;
        startSpecialBackground("pm", state.rows.primary || [], [], state.activeDate, "Второй файл пропущен. К сохранению: " + state.preview.tasks.length + ".");
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

    function uuidValue() {
        return window.crypto && typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
                const value = Math.random() * 16 | 0;
                return (char === "x" ? value : (value & 0x3 | 0x8)).toString(16);
            });
    }

    function moscowNowParts() {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Moscow",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).formatToParts(new Date());
        const byType = {};
        parts.forEach((part) => { byType[part.type] = part.value; });
        let hour = Number(byType.hour || 0);
        if (hour === 24) hour = 0;
        const minute = Number(byType.minute || 0);
        return { date: byType.year + "-" + byType.month + "-" + byType.day, hour, minute, minuteOfDay: hour * 60 + minute };
    }

    function minuteLabel(totalMinutes) {
        const normalized = ((Number(totalMinutes) || 0) % 1440 + 1440) % 1440;
        const hours = Math.floor(normalized / 60);
        const minutes = normalized % 60;
        return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
    }

    function prespisokWindowInfo() {
        const now = moscowNowParts();
        const inWindow = PRESPISOK_TEST_MODE || (now.minuteOfDay >= PRESPISOK_START_MINUTE && now.minuteOfDay <= PRESPISOK_END_MINUTE);
        const waitMinutes = now.minuteOfDay < PRESPISOK_START_MINUTE
            ? PRESPISOK_START_MINUTE - now.minuteOfDay
            : 1440 - now.minuteOfDay + PRESPISOK_START_MINUTE;
        return {
            ...now,
            inWindow,
            waitLabel: minuteLabel(waitMinutes),
            windowLabel: minuteLabel(PRESPISOK_START_MINUTE) + "-" + minuteLabel(PRESPISOK_END_MINUTE),
        };
    }

    function prespisokStorageKey() {
        return PRESPISOK_STORAGE_KEY + ":" + state.today;
    }

    function prespisokLeaderboardKey() {
        return PRESPISOK_STORAGE_KEY + ":leaderboard";
    }

    function prespisokElapsedMs() {
        const active = state.prespisok.timerStartedAt ? Date.now() - state.prespisok.timerStartedAt : 0;
        return (Number(state.prespisok.elapsedBeforeMs) || 0) + active;
    }

    function prespisokItemElapsedMs() {
        const active = state.prespisok.itemTimerStartedAt ? Date.now() - state.prespisok.itemTimerStartedAt : 0;
        return (Number(state.prespisok.itemElapsedBeforeMs) || 0) + active;
    }

    function prespisokItemTimerTone(ms) {
        const minutes = (Number(ms) || 0) / 60000;
        if (minutes >= 10) return "doom";
        if (minutes >= 5) return "danger";
        if (minutes >= 1) return "warn";
        return "fresh";
    }

    function formatDuration(ms) {
        const total = Math.max(Math.floor((Number(ms) || 0) / 1000), 0);
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }

    function formatPrespisokWriteoffAt(value) {
        const raw = normalizeText(value);
        const parsed = parseDateTime(value);
        if (!parsed.date) return raw || "-";
        if (typeof value === "number" && Number.isFinite(value) && Math.abs(value - Math.floor(value)) > 0.00001) return formatRuDateTime(value);
        if (/[ T]\d{1,2}:\d{2}/.test(raw)) return formatRuDateTime(value);
        return formatRuDate(parsed.date) + " 00:00";
    }

    function prespisokItemKey(item) {
        return normalizeText(item && item.key) || [item && item.type, item && item.id, item && item.predictedDate].map(normalizeText).join(":");
    }

    function serializePrespisokState() {
        return {
            date: state.today,
            rows: state.prespisok.rows,
            items: state.prespisok.items,
            index: state.prespisok.index,
            actions: state.prespisok.actions,
            excludedCount: state.prespisok.excludedCount,
            fileName: state.prespisok.fileName,
            runId: state.prespisok.runId,
            startedAt: state.prespisok.startedAt,
            elapsedBeforeMs: prespisokElapsedMs(),
            itemElapsedBeforeMs: prespisokItemElapsedMs(),
            history: state.prespisok.history,
            finished: state.prespisok.finished,
        };
    }

    function prespisokCompactPayload() {
        return {
            date: state.today,
            file_name: state.prespisok.fileName,
            items: (state.prespisok.items || []).map((item) => ({
                key: prespisokItemKey(item),
                type: item.type,
                id: item.id,
                price: item.price,
                predicted_date: item.predictedDate,
                shk_count: (item.rows || []).length,
                source_shk_ids: (item.rows || []).map((row) => row.shk),
            })),
            actions: state.prespisok.actions || [],
        };
    }

    function persistPrespisokState() {
        try {
            localStorage.setItem(prespisokStorageKey(), JSON.stringify(serializePrespisokState()));
        } catch (error) {
            console.warn("prespisok local save failed:", error);
        }
    }

    function loadPrespisokState() {
        try {
            const parsed = parseJsonSafe(localStorage.getItem(prespisokStorageKey()), null);
            if (!parsed || parsed.date !== state.today || parsed.finished) return false;
            state.prespisok = {
                ...state.prespisok,
                rows: Array.isArray(parsed.rows) ? parsed.rows : [],
                items: Array.isArray(parsed.items) ? parsed.items : [],
                index: Number(parsed.index) || 0,
                actions: Array.isArray(parsed.actions) ? parsed.actions : [],
                excludedCount: Number(parsed.excludedCount) || 0,
                fileName: normalizeText(parsed.fileName),
                runId: normalizeText(parsed.runId) || uuidValue(),
                startedAt: normalizeText(parsed.startedAt),
                elapsedBeforeMs: Number(parsed.elapsedBeforeMs) || 0,
                itemElapsedBeforeMs: Number(parsed.itemElapsedBeforeMs) || 0,
                timerStartedAt: 0,
                itemTimerStartedAt: 0,
                itemTimerKick: 0,
                history: parsed.history && typeof parsed.history === "object" ? parsed.history : {},
                finished: false,
                selectedAction: "",
            };
            return Boolean(state.prespisok.items.length);
        } catch (_error) {
            return false;
        }
    }

    function resetPrespisokState() {
        state.prespisok.rows = [];
        state.prespisok.items = [];
        state.prespisok.index = 0;
        state.prespisok.actions = [];
        state.prespisok.excludedCount = 0;
        state.prespisok.fileName = "";
        state.prespisok.runId = uuidValue();
        state.prespisok.startedAt = "";
        state.prespisok.timerStartedAt = 0;
        state.prespisok.elapsedBeforeMs = 0;
        state.prespisok.itemTimerStartedAt = 0;
        state.prespisok.itemElapsedBeforeMs = 0;
        state.prespisok.itemTimerKick = 0;
        state.prespisok.history = {};
        state.prespisok.selectedAction = "";
        state.prespisok.finished = false;
    }

    function openPrespisokModal() {
        closeFlowModals();
        loadPrespisokState();
        setFlowModalOpen("prespisokModal", true);
        renderPrespisok();
        if (state.prespisok.clockTimer) clearInterval(state.prespisok.clockTimer);
        state.prespisok.clockTimer = setInterval(() => {
            if ($("prespisokModal") && $("prespisokModal").classList.contains("active") && !state.prespisok.items.length) renderPrespisok();
        }, 30000);
    }

    function closePrespisokModal() {
        if (state.prespisok.timerStartedAt) {
            state.prespisok.elapsedBeforeMs = prespisokElapsedMs();
            state.prespisok.timerStartedAt = 0;
        }
        if (state.prespisok.itemTimerStartedAt) {
            state.prespisok.itemElapsedBeforeMs = prespisokItemElapsedMs();
            state.prespisok.itemTimerStartedAt = 0;
        }
        persistPrespisokState();
        if (state.prespisok.clockTimer) clearInterval(state.prespisok.clockTimer);
        state.prespisok.clockTimer = null;
        setFlowModalOpen("prespisokModal", false);
    }

    function prespisokMoneyStats() {
        const result = { saved: 0, writeoff: 0, savedCount: 0, writeoffCount: 0, autoWriteoffCount: 0 };
        (state.prespisok.actions || []).forEach((action) => {
            const key = normalizeText(action.action_key);
            const verdict = normalizeForMatch(action.verdict);
            const price = Number(action.price) || 0;
            const shkCount = Array.isArray(action.source_shk_ids) && action.source_shk_ids.length ? action.source_shk_ids.length : 1;
            if (key === "movement" || key === "release" || verdict === "движение" || verdict === "нужен релиз") {
                result.saved += price;
                result.savedCount += shkCount;
                return;
            }
            if (key === "auto_writeoff" || key === "writeoff" || verdict === "автосписание" || verdict === "нужно списание") {
                result.writeoff += price;
                result.writeoffCount += shkCount;
                if (key === "auto_writeoff" || verdict === "автосписание") result.autoWriteoffCount += shkCount;
            }
        });
        return result;
    }

    function prespisokTopStatsHtml() {
        if (!state.prespisok.items.length || state.prespisok.finished) return "";
        const stats = prespisokMoneyStats();
        return "<div class='prespisok-top-stats'>"
            + "<div class='prespisok-top-stat'><span>Общее время</span><strong id='prespisokTotalTimer'>" + escapeHtml(formatDuration(prespisokElapsedMs())) + "</strong></div>"
            + "<div class='prespisok-top-stat good'><span>Спасено</span><strong id='prespisokSavedMoney'>" + escapeHtml(formatMoney(stats.saved)) + "</strong></div>"
            + "<div class='prespisok-top-stat bad'><span>Допущено к списанию</span><strong id='prespisokWriteoffMoney'>" + escapeHtml(formatMoney(stats.writeoff)) + "</strong></div>"
            + "</div>";
    }

    function requestPrespisokClose() {
        if (state.prespisok.items.length && !state.prespisok.finished) {
            renderPrespisokExitConfirm();
            return;
        }
        closePrespisokModal();
    }

    function prespisokTopHtml(subtitle) {
        return "<div class='prespisok-top'>"
            + "<div><p class='prespisok-kicker'>Финальная проверка перед списанием</p><h2 class='prespisok-title'>Предсписок</h2><p class='prespisok-subtitle'>" + escapeHtml(subtitle || (PRESPISOK_TEST_MODE ? "Тестовый режим: запуск доступен в любое время. Боевой таймер пока сидит в углу и делает вид, что не обиделся." : "Окно разбора: 14:30-16:00. Тут не склад, тут арена последнего шанса.")) + "</p></div>"
            + "<div class='prespisok-top-right'>" + prespisokTopStatsHtml() + "<button id='closePrespisok' class='btn btn-square prespisok-close' type='button' aria-label='Закрыть'>×</button></div>"
            + "</div>";
    }

    function renderPrespisok() {
        const target = $("prespisokWrap");
        if (!target) return;
        const info = prespisokWindowInfo();
        if (!state.prespisok.items.length) {
            const saved = loadPrespisokState();
            if (saved) {
                renderPrespisokPlay();
                return;
            }
        }
        if (!state.prespisok.items.length && !info.inWindow) {
            target.innerHTML = prespisokTopHtml("Сегодняшнее окно: " + info.windowLabel + ". Раньше нельзя, позже тоже нельзя. Да, режим строгий, как акт списания без подписи.")
                + "<div class='prespisok-center'><div class='prespisok-wait'>До разбора предсписка<br>" + escapeHtml(info.waitLabel) + "</div></div>";
            bindPrespisokClose();
            return;
        }
        if (!state.prespisok.items.length) {
            target.innerHTML = prespisokTopHtml("Окно открыто. Загружаем XLSX и начинаем финальную проверку без лишней лирики.")
                + "<div class='prespisok-center'><button id='startPrespisok' class='prespisok-start' type='button'>Начать</button></div>";
            bindPrespisokClose();
            $("startPrespisok").addEventListener("click", renderPrespisokFileStep);
            return;
        }
        renderPrespisokPlay();
    }

    function bindPrespisokClose() {
        const close = $("closePrespisok");
        if (close) close.addEventListener("click", requestPrespisokClose);
    }

    function renderPrespisokExitConfirm() {
        const target = $("prespisokWrap");
        if (!target) return;
        if (state.prespisok.timerStartedAt) {
            state.prespisok.elapsedBeforeMs = prespisokElapsedMs();
            state.prespisok.timerStartedAt = 0;
        }
        if (state.prespisok.itemTimerStartedAt) {
            state.prespisok.itemElapsedBeforeMs = prespisokItemElapsedMs();
            state.prespisok.itemTimerStartedAt = 0;
        }
        persistPrespisokState();
        target.innerHTML = prespisokTopHtml("Уйти можно. Но товару тоже хотелось просто уйти со склада, и вот мы здесь.")
            + "<section class='prespisok-file-panel prespisok-exit-panel'>"
            + "<h3>Закрыть предсписок?</h3>"
            + "<p class='prespisok-exit-take'>Слабый ход, но прогресс сохраню. Я же не зверь, просто язвительный интерфейс.</p>"
            + "<div class='prespisok-exit-actions'>"
            + "<button id='continuePrespisok' class='prespisok-submit prespisok-submit-arcade' type='button'>Вернуться и добить</button>"
            + "<button id='confirmClosePrespisok' class='btn btn-outline prespisok-exit-btn' type='button'>Закрыть</button>"
            + "</div>"
            + "</section>";
        bindPrespisokClose();
        $("continuePrespisok").addEventListener("click", () => {
            state.prespisok.timerStartedAt = Date.now();
            state.prespisok.itemTimerStartedAt = Date.now();
            renderPrespisokPlay();
        });
        $("confirmClosePrespisok").addEventListener("click", closePrespisokModal);
    }

    function renderPrespisokFileStep() {
        const target = $("prespisokWrap");
        if (!target) return;
        target.innerHTML = prespisokTopHtml("Загрузи XLSX предсписка. Исключения из файла будут пропущены, но мы честно покажем сколько их было.")
            + "<section class='prespisok-file-panel'>"
            + "<div class='prespisok-file-drop'><div><label for='prespisokFileInput'>Загрузить XLSX</label><input id='prespisokFileInput' class='file-input' type='file' accept='.xlsx,.xls,.csv'><p id='prespisokFileName' class='prespisok-subtitle'>Файл пока не выбран. Даже товар уже нервничает.</p></div></div>"
            + "<div id='prespisokFileStatus' class='status-line'>Жду файл предсписка.</div>"
            + "</section>";
        bindPrespisokClose();
        $("prespisokFileInput").addEventListener("change", () => {
            const file = $("prespisokFileInput").files && $("prespisokFileInput").files[0];
            if (file) void handlePrespisokFile(file);
        });
    }

    function findPrespisokHeaderIndex(rows) {
        const max = Math.min((rows || []).length, 30);
        for (let i = 0; i < max; i += 1) {
            const line = (rows[i] || []).map(normalizeText).join(" ").toLowerCase();
            if (line.includes("идентификатор товара") && line.includes("прогнозируемая дата списания")) return i;
        }
        return 0;
    }

    async function readPrespisokRows(file) {
        if (typeof window.XLSX === "undefined") throw new Error("Не загрузилась библиотека XLSX. Обновите страницу и попробуйте еще раз.");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("В файле не найдено листов.");
        const sheet = workbook.Sheets[firstSheetName];
        normalizeWorksheetRange(sheet);
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
        const headerIndex = findPrespisokHeaderIndex(rawRows);
        return rawRows.slice(headerIndex + 1).map((row, index) => normalizePrespisokRow(row, headerIndex + index + 2)).filter(Boolean);
    }

    function normalizePrespisokRow(row, rowNumber) {
        const shk = normalizeIdentifier(row[0]);
        if (!shk) return null;
        return {
            row_number: rowNumber,
            shk,
            product: shk,
            last_status_at: normalizeText(row[1]),
            arrived_from: normalizeText(row[2]),
            tare_place: normalizeText(row[3]),
            destination_office: normalizeText(row[4]),
            block_id: normalizeIdentifier(row[5]),
            status: normalizeText(row[6]),
            product_status: normalizeText(row[6]),
            tare_id: normalizeIdentifier(row[7]),
            transfer: normalizeIdentifier(row[7]),
            tare_type: normalizeText(row[8]),
            predicted_writeoff_at: normalizeText(row[9]),
            price: normalizePrice(row[10]) || 0,
            in_exception: isTrueLike(row[11]),
            mx: normalizeText(row[3] || row[4]),
            created_at: normalizeText(row[1]),
        };
    }

    function prespisokUrgencyScore(item) {
        const price = Number(item.price) || 0;
        const date = parseDateTime(item.predictedWriteoffAt).date;
        const daysLeft = date ? Math.max((Date.parse(date + "T00:00:00Z") - Date.parse(state.today + "T00:00:00Z")) / 86400000, -30) : 30;
        return price * 1.8 + Math.max(0, 30 - daysLeft) * 900;
    }

    function buildPrespisokItems(rows) {
        const usable = (rows || []).filter((row) => !row.in_exception);
        const excludedCount = (rows || []).length - usable.length;
        const byTare = new Map();
        const singles = [];
        usable.forEach((row) => {
            if (!isGroupableIdentifier(row.tare_id)) { singles.push(row); return; }
            const group = byTare.get(row.tare_id) || [];
            group.push(row);
            byTare.set(row.tare_id, group);
        });
        const items = [];
        byTare.forEach((group, tareId) => {
            if (group.length > 1) {
                const sorted = group.slice().sort((a, b) => a.shk.localeCompare(b.shk, "ru"));
                const newest = newestRow(sorted, "last_status_at") || sorted[0];
                const soonest = sorted.slice().sort((a, b) => (parseDateTime(a.predicted_writeoff_at).ts || Infinity) - (parseDateTime(b.predicted_writeoff_at).ts || Infinity))[0] || sorted[0];
                items.push({
                    key: "tare:" + tareId + "|" + (parseDateTime(soonest.predicted_writeoff_at).date || state.today),
                    type: "tare",
                    id: tareId,
                    title: "Тара " + tareId,
                    rows: sorted,
                    price: rowsPrice(sorted, "price"),
                    predictedWriteoffAt: soonest.predicted_writeoff_at,
                    predictedDate: parseDateTime(soonest.predicted_writeoff_at).date || state.today,
                    lastStatusAt: newest.last_status_at,
                    status: newest.status,
                    tareType: newest.tare_type,
                });
            } else singles.push(group[0]);
        });
        singles.forEach((row) => {
            items.push({
                key: "shk:" + row.shk + "|" + (parseDateTime(row.predicted_writeoff_at).date || state.today),
                type: "shk",
                id: row.shk,
                title: "ШК " + row.shk,
                rows: [row],
                price: Number(row.price) || 0,
                predictedWriteoffAt: row.predicted_writeoff_at,
                predictedDate: parseDateTime(row.predicted_writeoff_at).date || state.today,
                lastStatusAt: row.last_status_at,
                status: row.status,
                tareType: row.tare_type,
            });
        });
        items.sort((a, b) => prespisokUrgencyScore(b) - prespisokUrgencyScore(a));
        return { items, excludedCount };
    }

    async function handlePrespisokFile(file) {
        const status = $("prespisokFileStatus");
        const fileName = $("prespisokFileName");
        if (fileName) fileName.textContent = file.name;
        if (status) status.textContent = "Читаю файл. Excel сейчас делает вид, что он база данных.";
        try {
            const rows = await readPrespisokRows(file);
            const built = buildPrespisokItems(rows);
            resetPrespisokState();
            state.prespisok.rows = rows;
            state.prespisok.items = built.items;
            state.prespisok.excludedCount = built.excludedCount;
            state.prespisok.fileName = file.name;
            state.prespisok.startedAt = new Date().toISOString();
            if (status) status.textContent = "Подтягиваю историю разборов по ШК/тарам. Сплетни склада тоже данные.";
            state.prespisok.history = await loadPrespisokHistory(built.items);
            await upsertPrespisokRun("started");
            persistPrespisokState();
            renderPrespisokReady();
        } catch (error) {
            console.error("prespisok file failed:", error);
            if (status) {
                status.textContent = "Не удалось разобрать предсписок: " + (error && error.message ? error.message : String(error));
                status.className = "status-line error";
            }
        }
    }

    function addPrespisokHistory(history, row) {
        if (!row || !row.id) return;
        const entry = {
            id: row.id,
            source: normalizeText(row.__history_source) || "WMS+",
            title: displayTaskTitle(row),
            task_type: row.task_type,
            status: taskStatus(row),
            verdict: normalizeText(row.opp_verdict),
            assignee: [normalizeText(row.assignee_name), normalizeText(row.assignee_employee_id)].filter(Boolean).join(" / "),
            updated_at: row.updated_at,
            completed_at: row.completed_at || row.finalized_at,
        };
        (Array.isArray(row.source_shk_ids) ? row.source_shk_ids : []).map(normalizeIdentifier).filter(Boolean).forEach((shk) => {
            if (!history.byShk[shk]) history.byShk[shk] = [];
            history.byShk[shk].push(entry);
        });
        const tare = normalizeIdentifier(row.source_tare_id);
        if (tare) {
            if (!history.byTare[tare]) history.byTare[tare] = [];
            history.byTare[tare].push(entry);
        }
    }

    function addPrespisokHistoryFromSourceId(history, row, source, shkSet, tareSet) {
        const sourceId = normalizeIdentifier(row && row.source_id);
        if (!sourceId || (!shkSet.has(sourceId) && !tareSet.has(sourceId))) return;
        addPrespisokHistory(history, {
            ...row,
            __history_source: source,
            source_shk_ids: shkSet.has(sourceId) ? [sourceId] : [],
            source_tare_id: tareSet.has(sourceId) ? sourceId : "",
        });
    }

    async function loadPrespisokHistory(items) {
        const db = supabaseDb();
        const history = { byShk: {}, byTare: {} };
        if (!db || !items || !items.length) return history;
        const shks = Array.from(new Set(items.flatMap((item) => item.rows.map((row) => row.shk)).map(normalizeIdentifier).filter(Boolean)));
        const tares = Array.from(new Set(items.filter((item) => item.type === "tare").map((item) => item.id).map(normalizeIdentifier).filter(Boolean)));
        const shkSet = new Set(shks);
        const tareSet = new Set(tares);
        try {
            for (const chunk of chunkArray(shks, 80)) {
                const { data, error } = await db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).overlaps("source_shk_ids", chunk).order("updated_at", { ascending: false }).limit(1000);
                if (!error) (data || []).forEach((row) => addPrespisokHistory(history, { ...row, __history_source: "WMS+" }));
            }
            for (const chunk of chunkArray(tares, 80)) {
                const { data, error } = await db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).in("source_tare_id", chunk).order("updated_at", { ascending: false }).limit(1000);
                if (!error) (data || []).forEach((row) => addPrespisokHistory(history, { ...row, __history_source: "WMS+" }));
            }
            for (const chunk of chunkArray(shks, 80)) {
                const { data, error } = await db.from(WEEEK_TASKS_BASIC_TABLE).select(WEEEK_BASIC_SELECT_COLUMNS).overlaps("source_shk_ids", chunk).order("updated_at", { ascending: false }).limit(1000);
                if (!error) (data || []).forEach((row) => addPrespisokHistory(history, { ...row, __history_source: "WEEEK" }));
            }
            for (const chunk of chunkArray(tares, 80)) {
                const { data, error } = await db.from(WEEEK_TASKS_BASIC_TABLE).select(WEEEK_BASIC_SELECT_COLUMNS).in("source_tare_id", chunk).order("updated_at", { ascending: false }).limit(1000);
                if (!error) (data || []).forEach((row) => addPrespisokHistory(history, { ...row, __history_source: "WEEEK" }));
            }
            for (const chunk of chunkArray(shks.concat(tares), 80)) {
                const { data, error } = await db.from(WEEEK_TASKS_TABLE).select(WEEEK_SIMPLE_SELECT_COLUMNS).in("source_id", chunk).order("updated_at", { ascending: false }).limit(1000);
                if (!error) (data || []).forEach((row) => addPrespisokHistoryFromSourceId(history, row, "WEEEK", shkSet, tareSet));
            }
        } catch (error) {
            console.warn("prespisok history failed:", error);
        }
        return history;
    }

    function renderPrespisokReady() {
        const target = $("prespisokWrap");
        if (!target) return;
        const totalRows = state.prespisok.rows.length || 0;
        const totalItems = state.prespisok.items.length || 0;
        const totalMoney = (state.prespisok.items || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        target.innerHTML = prespisokTopHtml("Файл принят. Перед стартом сверяем, сколько мусора файл честно принес с собой.")
            + "<section class='prespisok-file-panel'>"
            + "<div class='prespisok-finish-grid'>"
            + "<div class='prespisok-finish-stat'><span>Строк в файле</span><strong>" + totalRows + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>К разбору</span><strong>" + totalItems + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>Исключений</span><strong>" + state.prespisok.excludedCount + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>Сумма риска</span><strong>" + escapeHtml(formatMoney(totalMoney)) + "</strong></div>"
            + "</div>"
            + "<button id='launchPrespisokCountdown' class='prespisok-start prespisok-start-small' type='button'>Начать разбор</button>"
            + "</section>";
        bindPrespisokClose();
        $("launchPrespisokCountdown").addEventListener("click", () => renderPrespisokCountdown(3));
    }

    function renderPrespisokCountdown(value) {
        const target = $("prespisokWrap");
        if (!target) return;
        target.innerHTML = prespisokTopHtml("Файл принят. Сейчас будет короткий обратный отсчет, потому что даже хаосу нужен драматический вход.")
            + "<div class='prespisok-center'><div class='prespisok-wait'>" + escapeHtml(value > 0 ? String(value) : "Погнали") + "</div></div>";
        bindPrespisokClose();
        if (value > 0) setTimeout(() => renderPrespisokCountdown(value - 1), 720);
        else {
            state.prespisok.timerStartedAt = Date.now();
            state.prespisok.itemTimerStartedAt = Date.now();
            state.prespisok.itemElapsedBeforeMs = 0;
            state.prespisok.itemTimerKick = Date.now();
            persistPrespisokState();
            setTimeout(renderPrespisokPlay, 520);
        }
    }

    function currentPrespisokItem() {
        const done = new Set((state.prespisok.actions || []).map((action) => action.item_key));
        let index = Math.max(Number(state.prespisok.index) || 0, 0);
        while (index < state.prespisok.items.length && done.has(prespisokItemKey(state.prespisok.items[index]))) index += 1;
        state.prespisok.index = index;
        return state.prespisok.items[index] || null;
    }

    function prespisokSnark(item) {
        const seed = normalizeText(item && item.key).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) + (state.prespisok.index || 0);
        const pick = (list, salt) => list[(seed + salt) % list.length];
        return pick(PRESPISOK_SNARK.openers, 0) + " " + pick(PRESPISOK_SNARK.spikes, 3) + " " + pick(PRESPISOK_SNARK.needles, 7) + " " + pick(PRESPISOK_SNARK.closers, 19);
    }

    function prespisokHistoryHtml(item) {
        const history = state.prespisok.history || {};
        const rows = [];
        if (item.type === "tare" && history.byTare && Array.isArray(history.byTare[item.id])) rows.push(...history.byTare[item.id]);
        (item.rows || []).forEach((row) => {
            const found = history.byShk && history.byShk[row.shk] ? history.byShk[row.shk] : [];
            rows.push(...found);
        });
        const unique = [];
        const seen = new Set();
        rows.forEach((row) => { if (row && row.id && !seen.has(row.id)) { seen.add(row.id); unique.push(row); } });
        if (!unique.length) return "<div class='prespisok-history'><strong>История разборов</strong><br>По этим ШК/таре разборов не найдено. Белое пятно на карте, только без романтики.</div>";
        const lines = unique.slice(0, 6).map((row) => "- " + (row.source || "WMS+") + " · " + row.title + " · " + (row.verdict || row.status || "-") + " · " + formatRuDateTime(row.updated_at)).join("\n");
        return "<div class='prespisok-history copyable' data-copy-value='" + escapeHtml(lines) + "' title='Нажми, чтобы скопировать'><strong>История разборов</strong>\n" + escapeHtml(lines) + (unique.length > 6 ? "\n+" + (unique.length - 6) + " еще" : "") + "</div>";
    }

    function prespisokActionsForItem(item) {
        if ((Number(item.price) || 0) < 1000) return [
            { key: "movement", label: "Движение", needsExtra: false, createsTask: false },
            { key: "auto_writeoff", label: "Автосписание", needsExtra: false, createsTask: false },
        ];
        return [
            { key: "movement", label: "Движение", needsExtra: true, extraLabel: "Укажите комментарий к движению", extraPlaceholder: "Что проверили и почему закрываем как движение", createsTask: false },
            { key: "auto_writeoff", label: "Автосписание", needsExtra: true, extraLabel: "Укажите комментарий к автосписанию", extraPlaceholder: "Что проверили и почему допускаем автосписание", createsTask: false },
            { key: "release", label: "Нужен релиз", needsExtra: true, extraLabel: "Вставьте ссылку на запрос релиза", createsTask: true },
            { key: "writeoff", label: "Нужно списание", needsExtra: true, extraLabel: "Вставьте ссылку", createsTask: true },
            { key: "request", label: "Отправлен запрос", needsExtra: true, extraLabel: "Вставьте ссылку или направление запроса", createsTask: true },
            { key: "task", label: "Создать задачу", needsExtra: false, createsTask: true },
        ];
    }

    function prespisokItemHeadingHtml(item) {
        if (!item) return "";
        if (item.type !== "tare") return "<h3>" + escapeHtml(item.title) + "</h3>";
        const shks = (item.rows || []).map((row) => row.shk).filter(Boolean);
        const visible = shks.slice(0, 5).join(", ");
        const tail = shks.length > 5 ? " +" + (shks.length - 5) : "";
        return "<h3>ШК в таре: " + escapeHtml(visible + tail) + "</h3><p class='prespisok-entity-subtitle'>Тара: " + escapeHtml(item.id) + "</p>";
    }

    function renderPrespisokPlay() {
        const target = $("prespisokWrap");
        if (!target) return;
        const item = currentPrespisokItem();
        if (!item) {
            void finishPrespisokRun();
            renderPrespisokFinish();
            return;
        }
        if (!state.prespisok.timerStartedAt) state.prespisok.timerStartedAt = Date.now();
        if (!state.prespisok.itemTimerStartedAt) state.prespisok.itemTimerStartedAt = Date.now();
        const progress = (state.prespisok.actions || []).length;
        const total = state.prespisok.items.length;
        const rowsHtml = (item.rows || []).map((row) => "<div class='prespisok-item-line'><strong>" + escapeHtml(row.shk) + "</strong><span>" + escapeHtml(row.status || "-") + "</span><span>" + escapeHtml(formatMoney(row.price)) + "</span></div>").join("");
        const actions = prespisokActionsForItem(item);
        const cheapHint = (Number(item.price) || 0) < 1000 ? "<div class='status-line good'>Цена меньше 1000 ₽. Сценарий: проверить на “Без ШК”.</div>" : "";
        const itemElapsed = prespisokItemElapsedMs();
        const kick = state.prespisok.itemTimerKick && Date.now() - state.prespisok.itemTimerKick < 1400 ? " kick" : "";
        target.innerHTML = prespisokTopHtml("Таймер идет. Если закрыть режим, прогресс сохранится, но персонаж будет осуждать молча.")
            + "<section class='prespisok-play-panel'>"
            + "<div class='prespisok-hud'>"
            + "<div id='prespisokItemTimerCard' class='prespisok-hud-card prespisok-item-timer-card " + escapeHtml(prespisokItemTimerTone(itemElapsed) + kick) + "'><span>Текущая цель</span><strong id='prespisokItemTimer'>" + escapeHtml(formatDuration(itemElapsed)) + "</strong></div>"
            + "<div class='prespisok-hud-card'><span>Прогресс</span><strong>" + progress + "/" + total + "</strong></div>"
            + "<div class='prespisok-hud-card'><span>Исключения</span><strong>" + state.prespisok.excludedCount + "</strong></div>"
            + "<div class='prespisok-hud-card'><span>Цена цели</span><strong>" + escapeHtml(formatMoney(item.price)) + "</strong></div>"
            + "</div>"
            + "<div class='prespisok-task-card'>"
            + "<article class='prespisok-task-main'>"
            + prespisokItemHeadingHtml(item)
            + "<div class='prespisok-badge-row'><span class='prespisok-badge hot'>" + escapeHtml(item.type === "tare" ? "Задача на тару" : "Задача на ШК") + "</span><span class='prespisok-badge gold'>Списание: " + escapeHtml(formatPrespisokWriteoffAt(item.predictedWriteoffAt)) + "</span><span class='prespisok-badge'>" + escapeHtml(item.tareType || "тип тары не указан") + "</span></div>"
            + "<div class='prespisok-info-grid'>"
            + "<div class='prespisok-info'><span>Последний статус</span><strong>" + escapeHtml(item.status || "-") + "</strong></div>"
            + "<div class='prespisok-info'><span>Дата статуса</span><strong>" + escapeHtml(formatRuDateTime(item.lastStatusAt)) + "</strong></div>"
            + "<div class='prespisok-info'><span>Где находится тара</span><strong>" + escapeHtml((item.rows[0] && item.rows[0].tare_place) || "-") + "</strong></div>"
            + "<div class='prespisok-info'><span>Офис назначения</span><strong>" + escapeHtml((item.rows[0] && item.rows[0].destination_office) || "-") + "</strong></div>"
            + "</div>"
            + (item.type === "tare" ? "<div class='prespisok-items'>" + rowsHtml + "</div>" : "")
            + prespisokHistoryHtml(item)
            + "</article>"
            + "<aside class='prespisok-side'>"
            + "<div class='prespisok-snark'>" + escapeHtml(prespisokSnark(item)) + "</div>"
            + cheapHint
            + "<div class='prespisok-actions'>" + actions.map((action) => "<button class='prespisok-action-btn' type='button' data-prespisok-action='" + escapeHtml(action.key) + "'>" + escapeHtml(action.label) + "</button>").join("") + "</div>"
            + "<div id='prespisokExtraWrap' class='prespisok-extra hidden'></div>"
            + "<div id='prespisokActionStatus' class='review-status'></div>"
            + "</aside>"
            + "</div></section>";
        bindPrespisokClose();
        target.querySelectorAll("[data-copy-value]").forEach((field) => {
            field.addEventListener("click", async () => {
                const text = field.dataset.copyValue || "";
                if (!text) return;
                const copied = await copyText(text);
                toast(copied ? "Скопировано." : "Браузер заблокировал копирование.", copied ? "success" : "error");
            });
        });
        target.querySelectorAll("[data-prespisok-action]").forEach((button) => {
            button.addEventListener("click", () => selectPrespisokAction(button.dataset.prespisokAction || ""));
        });
        updatePrespisokTimer();
    }

    function updatePrespisokTimer() {
        if (!$("prespisokModal") || !$("prespisokModal").classList.contains("active")) return;
        const totalTimer = $("prespisokTotalTimer");
        if (totalTimer) totalTimer.textContent = formatDuration(prespisokElapsedMs());
        const itemTimer = $("prespisokItemTimer");
        const itemCard = $("prespisokItemTimerCard");
        const itemElapsed = prespisokItemElapsedMs();
        if (itemTimer) itemTimer.textContent = formatDuration(itemElapsed);
        if (itemCard) {
            const kick = state.prespisok.itemTimerKick && Date.now() - state.prespisok.itemTimerKick < 1400 ? " kick" : "";
            itemCard.className = "prespisok-hud-card prespisok-item-timer-card " + prespisokItemTimerTone(itemElapsed) + kick;
        }
        setTimeout(updatePrespisokTimer, 1000);
    }

    function selectPrespisokAction(actionKey) {
        const item = currentPrespisokItem();
        if (!item) return;
        const action = prespisokActionsForItem(item).find((candidate) => candidate.key === actionKey);
        if (!action) return;
        state.prespisok.selectedAction = actionKey;
        document.querySelectorAll("[data-prespisok-action]").forEach((button) => button.classList.toggle("active", button.dataset.prespisokAction === actionKey));
        const wrap = $("prespisokExtraWrap");
        if (!wrap) return;
        if (action.needsExtra) {
            wrap.classList.remove("hidden");
            wrap.innerHTML = "<label for='prespisokExtraInput'>" + escapeHtml(action.extraLabel) + "</label><input id='prespisokExtraInput' type='text' placeholder='" + escapeHtml(action.extraPlaceholder || "Ссылка или направление") + "'><button id='submitPrespisokAction' class='prespisok-submit' type='button' disabled>Принять вердикт</button>";
            $("prespisokExtraInput").addEventListener("input", () => { $("submitPrespisokAction").disabled = !normalizeText($("prespisokExtraInput").value); });
            $("submitPrespisokAction").addEventListener("click", () => { void applyPrespisokAction(actionKey, normalizeText($("prespisokExtraInput").value)); });
        } else {
            wrap.classList.remove("hidden");
            wrap.innerHTML = "<button id='submitPrespisokAction' class='prespisok-submit' type='button'>Принять вердикт</button>";
            $("submitPrespisokAction").addEventListener("click", () => { void applyPrespisokAction(actionKey, ""); });
        }
    }

    function prespisokActionLabel(actionKey, item) {
        const action = prespisokActionsForItem(item).find((candidate) => candidate.key === actionKey);
        return action ? action.label : actionKey;
    }

    async function createPrespisokTask(item, actionLabel, extraValue) {
        const db = supabaseDb();
        if (!db) throw new Error("Supabase недоступен.");
        const rows = (item.rows || []).map((row) => ({ ...row, product: row.shk, name: "", product_status: row.status, created_at: row.last_status_at, mx: row.tare_place || row.destination_office }));
        const task = taskRecord({
            module: "prespisok",
            sourceModule: "wms_prespisok",
            uploadType: "prespisok",
            businessDate: state.today,
            sourceId: "prespisok:" + prespisokItemKey(item),
            title: item.title,
            taskType: "Предсписок",
            descriptionTaskType: "Предсписок",
            column: "Другие задачи",
            dueDate: item.predictedDate || state.today,
            responsibilityZone: "Нет привязки",
            productIds: rows.map((row) => row.product),
            rows,
            tareId: item.type === "tare" ? item.id : rows[0] && rows[0].tare_id,
            price: item.price,
            tags: ["Предсписок"],
            payload: { entity_type: item.type === "tare" ? "tare" : "shk", prespisok: true, prespisok_action: actionLabel, prespisok_extra: extraValue, rows: rows.slice(0, 80) },
            infoLines: [
                "Решение предсписка: " + actionLabel,
                extraValue ? "Ссылка/комментарий: " + extraValue : "",
                "Прогнозируемая дата списания: " + formatPrespisokWriteoffAt(item.predictedWriteoffAt),
                item.type === "tare" ? "ШК в таре:" : "Искомый ШК: " + item.id,
                ...(item.type === "tare" ? rows.map((row) => "- " + row.product + " / " + (row.product_status || "-") + " / " + formatMoney(row.price)) : []),
            ].filter(Boolean),
        });
        const { data, error } = await db.rpc(SAVE_RPC, { p_tasks: [task], p_run: {} });
        if (error) throw error;
        return { response: data, task };
    }

    async function applyPrespisokAction(actionKey, extraValue) {
        const item = currentPrespisokItem();
        if (!item) return;
        const status = $("prespisokActionStatus");
        const submit = $("submitPrespisokAction");
        if (submit) submit.disabled = true;
        const label = prespisokActionLabel(actionKey, item);
        const itemElapsed = prespisokItemElapsedMs();
        if (status) status.textContent = "Фиксирую: " + label + ".";
        let taskResponse = null;
        try {
            const actionDef = prespisokActionsForItem(item).find((action) => action.key === actionKey);
            if (actionDef && actionDef.createsTask) {
                if (status) status.textContent = "Создаю задачу в Других задачах. Предсписок решил не отпускать это просто так.";
                taskResponse = await createPrespisokTask(item, label, extraValue);
            }
            const action = {
                run_id: state.prespisok.runId,
                item_key: prespisokItemKey(item),
                action_key: actionKey,
                entity_type: item.type,
                entity_id: item.id,
                verdict: label,
                extra_value: extraValue || "",
                price: item.price,
                item_elapsed_ms: Math.round(itemElapsed),
                source_shk_ids: item.rows.map((row) => row.shk),
                source_tare_id: item.type === "tare" ? item.id : "",
                task_created: Boolean(taskResponse),
                created_at: new Date().toISOString(),
                actor: currentWmsUser(),
            };
            state.prespisok.actions.push(action);
            state.prespisok.index += 1;
            state.prespisok.elapsedBeforeMs = prespisokElapsedMs();
            state.prespisok.itemElapsedBeforeMs = 0;
            state.prespisok.timerStartedAt = Date.now();
            state.prespisok.itemTimerStartedAt = Date.now();
            state.prespisok.itemTimerKick = Date.now();
            await insertPrespisokAction(action);
            await upsertPrespisokRun("in_progress");
            persistPrespisokState();
            renderPrespisokPlay();
        } catch (error) {
            console.error("prespisok action failed:", error);
            if (status) status.textContent = "Не удалось применить вердикт: " + (error && error.message ? error.message : String(error));
            if (submit) submit.disabled = false;
        }
    }

    async function upsertPrespisokRun(statusValue) {
        const db = supabaseDb();
        if (!db || !state.prespisok.runId) return;
        const user = currentWmsUser();
        const payload = {
            id: state.prespisok.runId,
            wh_id: WH_ID,
            run_date: state.today,
            status: statusValue,
            file_name: state.prespisok.fileName || "",
            total_items: state.prespisok.items.length || 0,
            completed_items: state.prespisok.actions.length || 0,
            excluded_items: state.prespisok.excludedCount || 0,
            elapsed_ms: Math.round(prespisokElapsedMs()),
            operator_id: user.id || null,
            operator_name: user.name || null,
            started_at: state.prespisok.startedAt || new Date().toISOString(),
            finished_at: statusValue === "completed" ? new Date().toISOString() : null,
            payload: prespisokCompactPayload(),
        };
        try {
            await db.from(WMS_PRESPISOK_RUNS_TABLE).upsert(payload, { onConflict: "id" });
        } catch (error) {
            console.warn("prespisok run log skipped:", error);
        }
    }

    async function insertPrespisokAction(action) {
        const db = supabaseDb();
        if (!db) return;
        const user = action.actor || currentWmsUser();
        try {
            await db.from(WMS_PRESPISOK_ACTIONS_TABLE).insert({
                run_id: action.run_id,
                item_key: action.item_key,
                entity_type: action.entity_type,
                entity_id: action.entity_id,
                verdict: action.verdict,
                extra_value: action.extra_value,
                price: action.price,
                source_shk_ids: action.source_shk_ids,
                source_tare_id: action.source_tare_id || null,
                task_created: action.task_created,
                operator_id: user.id || null,
                operator_name: user.name || null,
                payload: action,
            });
        } catch (error) {
            console.warn("prespisok action log skipped:", error);
        }
    }

    function loadPrespisokLeaderboard() {
        const rows = parseJsonSafe(localStorage.getItem(prespisokLeaderboardKey()), []);
        return Array.isArray(rows) ? rows : [];
    }

    function savePrespisokRecord() {
        const user = currentWmsUser();
        const record = {
            name: user.name || "Неизвестный герой",
            employee_id: user.id || "",
            date: state.today,
            total: state.prespisok.items.length,
            actions: state.prespisok.actions.length,
            elapsed_ms: prespisokElapsedMs(),
        };
        const rows = loadPrespisokLeaderboard().filter((row) => !(row.date === record.date && row.employee_id === record.employee_id));
        rows.push(record);
        rows.sort((a, b) => (Number(b.actions) || 0) - (Number(a.actions) || 0) || (Number(a.elapsed_ms) || 0) - (Number(b.elapsed_ms) || 0));
        const top = rows.slice(0, 25);
        try { localStorage.setItem(prespisokLeaderboardKey(), JSON.stringify(top)); } catch (_error) {}
        state.prespisok.leaderboard = top;
        return record;
    }

    async function finishPrespisokRun() {
        if (state.prespisok.finished) return;
        state.prespisok.finished = true;
        state.prespisok.elapsedBeforeMs = prespisokElapsedMs();
        state.prespisok.timerStartedAt = 0;
        savePrespisokRecord();
        persistPrespisokState();
        await upsertPrespisokRun("completed");
    }

    function renderPrespisokFinish() {
        const target = $("prespisokWrap");
        if (!target) return;
        const record = savePrespisokRecord();
        const moneyStats = prespisokMoneyStats();
        const leaderboard = state.prespisok.leaderboard.length ? state.prespisok.leaderboard : loadPrespisokLeaderboard();
        const personal = leaderboard.filter((row) => row.employee_id === record.employee_id || row.name === record.name);
        const best = personal.slice().sort((a, b) => (Number(b.actions) || 0) - (Number(a.actions) || 0) || (Number(a.elapsed_ms) || 0) - (Number(b.elapsed_ms) || 0))[0] || record;
        const topRows = leaderboard.slice(0, 5).map((row, index) => "<tr><td>" + (index + 1) + "</td><td>" + escapeHtml(row.name) + "</td><td>" + escapeHtml(row.actions + "/" + row.total) + "</td><td>" + escapeHtml(formatDuration(row.elapsed_ms)) + "</td></tr>").join("");
        target.innerHTML = prespisokTopHtml("Готово. Предсписок пережил тебя, но только формально.")
            + "<section class='prespisok-finish-panel'>"
            + "<h3 class='prespisok-title'>Разбор завершен</h3>"
            + "<div class='prespisok-finish-grid'>"
            + "<div class='prespisok-finish-stat'><span>Разобрано</span><strong>" + state.prespisok.actions.length + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>Всего целей</span><strong>" + state.prespisok.items.length + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>Исключений</span><strong>" + state.prespisok.excludedCount + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>Время</span><strong>" + escapeHtml(formatDuration(record.elapsed_ms)) + "</strong></div>"
            + "</div>"
            + "<div class='prespisok-finish-grid'>"
            + "<div class='prespisok-finish-stat saved'><span>Спасено ШК</span><strong>" + moneyStats.savedCount + "</strong></div>"
            + "<div class='prespisok-finish-stat saved'><span>Спасено рублей</span><strong>" + escapeHtml(formatMoney(moneyStats.saved)) + "</strong></div>"
            + "<div class='prespisok-finish-stat writeoff'><span>Автосписание ШК</span><strong>" + moneyStats.autoWriteoffCount + "</strong></div>"
            + "<div class='prespisok-finish-stat writeoff'><span>К списанию рублей</span><strong>" + escapeHtml(formatMoney(moneyStats.writeoff)) + "</strong></div>"
            + "</div>"
            + "<div class='prespisok-file-panel'><h3>Таблица лидеров</h3><table class='sample-table'><thead><tr><th>#</th><th>Сотрудник</th><th>Разобрано</th><th>Время</th></tr></thead><tbody>" + topRows + "</tbody></table><div class='status-line good'>Личный рекорд: " + escapeHtml(best.actions + "/" + best.total + " за " + formatDuration(best.elapsed_ms)) + ".</div><button id='resetPrespisokFinished' class='btn btn-rect' type='button'>Закрыть и очистить прогресс</button></div>"
            + "</section>";
        bindPrespisokClose();
        $("resetPrespisokFinished").addEventListener("click", () => {
            localStorage.removeItem(prespisokStorageKey());
            resetPrespisokState();
            if (state.prespisok.clockTimer) clearInterval(state.prespisok.clockTimer);
            state.prespisok.clockTimer = null;
            setFlowModalOpen("prespisokModal", false);
        });
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
        const rows = (preview.tasks || []).slice(0, 5).map((task) => "<tr><td>" + escapeHtml(task.title) + "</td><td>" + escapeHtml(taskEntityTypeLabel(task)) + "</td><td>" + escapeHtml(taskItemName(task) || "-") + "</td><td>" + escapeHtml(task.task_type) + "</td><td>" + escapeHtml(task.column) + "</td><td>" + escapeHtml(formatRuDate(task.due_date)) + "</td><td>" + escapeHtml(formatMoney(task.source_price_sum)) + "</td><td>" + escapeHtml(task.priority_label) + "</td></tr>").join("");
        const specialLine = specialStatusText(preview);
        $("sampleWrap").innerHTML = (specialLine ? "<div class='status-line'>" + escapeHtml(specialLine) + "</div>" : "")
            + (rows ? "<table class='sample-table'><thead><tr><th>Название</th><th>Тип задачи</th><th>Наименование</th><th>Тип</th><th>Колонка</th><th>Дата</th><th>Стоимость</th><th>Приоритет</th></tr></thead><tbody>" + rows + "</tbody></table>" : "<div class='empty-state'>Нет задач к сохранению.</div>");
    }

    async function saveCurrentUpload() {
        if (!state.preview || !state.preview.tasks.length) return;
        const module = state.activeModule;
        const def = moduleDef(module);
        $("saveUpload").disabled = true;
        setStatus("Сохраняю в Supabase: " + state.preview.tasks.length + " задач...");
        try {
            await waitForSpecialBackground();
            const response = await saveTasksAndRun(module, state.activeDate, state.preview.tasks, {
                fileName: state.files.primary ? state.files.primary.name : "",
                secondaryFileName: state.files.carrier ? state.files.carrier.name : "",
                rowsCount: state.rows.primary ? state.rows.primary.length : 0,
                summary: summarizePreview(state.preview),
            }, (progress) => {
                setStatus("Сохраняю в Supabase: пачка " + progress.chunk + "/" + progress.totalChunks + ", задач " + progress.saved + "/" + progress.totalTasks + "...");
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

    async function saveTasksAndRun(module, businessDate, tasks, meta, onProgress) {
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
            tasks_count: payloadTasks.length,
            summary: meta.summary || {},
        };
        const chunks = chunkArray(payloadTasks, SAVE_TASK_CHUNK_SIZE);
        let totalUpserted = 0;
        let uploadRun = null;
        if (!chunks.length) return { ok: true, upserted_count: 0, upload_run: null };
        for (let i = 0; i < chunks.length; i += 1) {
            if (onProgress) onProgress({ chunk: i + 1, totalChunks: chunks.length, chunkSize: chunks[i].length, saved: totalUpserted, totalTasks: payloadTasks.length });
            const isLast = i === chunks.length - 1;
            const { data, error } = await db.rpc(SAVE_RPC, { p_tasks: chunks[i], p_run: isLast ? run : {} });
            if (error) throw error;
            totalUpserted += Number(data && data.upserted_count) || chunks[i].length;
            if (data && data.upload_run) uploadRun = data.upload_run;
        }
        if (uploadRun && uploadRun.id && Number(uploadRun.upserted_count) !== totalUpserted) {
            uploadRun = { ...uploadRun, upserted_count: totalUpserted };
            const { data, error } = await db
                .from(RUNS_TABLE)
                .update({ upserted_count: totalUpserted })
                .eq("id", uploadRun.id)
                .select("*")
                .single();
            if (!error && data) uploadRun = data;
        }
        return { ok: true, upserted_count: totalUpserted, upload_run: uploadRun };
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
        state.master = { files: {}, fileNames: {}, rows: {}, preview: null, dateRejects: [], conditionRejects: [], slotIndex: 0, skippedSlots: {}, specialCheck: null, building: false };
        setFlowModalOpen("moduleChooser", false);
        setFlowModalOpen("uploadWork", false);
        setFlowModalOpen("masterWork", true);
        renderMasterSlots();
        setMasterStatus("");
        $("masterSummary").innerHTML = "";
        $("masterRejects").classList.remove("visible");
        $("masterDone").classList.remove("visible");
        $("masterTopActions").classList.add("hidden");
        $("masterBottomActions").classList.add("hidden");
        $("saveMaster").disabled = true;
        $("showRejects").disabled = true;
        $("buildMasterPreview").disabled = true;
        $("copyMasterTransfers").disabled = true;
        $("masterTransferFallback").style.display = "none";
        $("masterTransferFallback").value = "";
    }

    function masterDatePlan() {
        const dates = {};
        MASTER_MODULES.forEach((module) => { dates[module] = uploadDateForModule(module); });
        return dates;
    }

    function renderMasterSlots() {
        const dates = masterDatePlan();
        const index = Math.min(state.master.slotIndex || 0, MASTER_SLOTS.length);
        const completed = MASTER_SLOTS.slice(0, index).map((slot, itemIndex) => {
            const name = state.master.skippedSlots[slot.key] ? "пропущено" : "готово";
            return "<span class='master-step-done'>" + (itemIndex + 1) + ". " + escapeHtml(slot.title) + " — " + name + "</span>";
        }).join("");
        if (index >= MASTER_SLOTS.length) {
            $("masterSlots").innerHTML = "<article class='slot-card master-step-card'><h4 class='slot-title'>Файлы загружены</h4><p class='slot-note'>Теперь WMS+ по очереди рассчитает выгрузки и подготовит задачи к сохранению.</p>" + (completed ? "<div class='master-step-list'>" + completed + "</div>" : "") + "</article>";
            $("buildMasterPreview").disabled = !masterCanBuild();
            if (masterCanBuild() && !state.master.preview) void buildMasterPreview();
            return;
        }
        const slot = MASTER_SLOTS[index];
        const slotDates = Array.from(new Set(slot.modules.map((module) => dates[module]).filter(Boolean)));
        const note = slot.key === "main"
            ? "Выгрузите файл с " + formatRuDate(earliestDate(slotDates)) + " по " + formatRuDate(state.today) + "."
            : slot.key === "carrier"
                ? "Проверка передач ПМ/Почты за " + formatRuDate(dates.pm) + "."
                : "Нужная дата: " + slotDates.map(formatRuDate).join(", ") + ".";
        const carrierTools = slot.key === "carrier"
            ? "<button id='copyMasterTransfersInline' class='btn btn-outline' type='button' " + ((state.master.pmTransferIds || []).length ? "" : "disabled") + ">Скопировать номера передач</button><button id='skipMasterSlot' class='btn btn-outline' type='button'>Пропустить</button>"
            : "";
        $("masterSlots").innerHTML = (completed ? "<div class='master-step-list'>" + completed + "</div>" : "")
            + "<article class='slot-card master-step-card'><h4 class='slot-title'>" + escapeHtml(slot.title) + "</h4><p class='slot-note'>" + escapeHtml(note) + "</p><div class='file-row'><label class='btn btn-rect' for='master-" + slot.key + "'>Выбрать файл</label><input id='master-" + slot.key + "' class='file-input' type='file' accept='.xlsx,.xls,.csv'><span id='master-name-" + slot.key + "' class='file-name'>Файл пока не выбран</span>" + carrierTools + "</div></article>";
        const input = $("master-" + slot.key);
        input.addEventListener("change", () => {
            const file = input.files && input.files[0];
            if (file) handleMasterFile(slot, file).catch((error) => setMasterStatus(error && error.message ? error.message : String(error), "error"));
        });
        const copyInline = $("copyMasterTransfersInline");
        if (copyInline) copyInline.addEventListener("click", () => { void copyMasterTransfers(); });
        const skip = $("skipMasterSlot");
        if (skip) skip.addEventListener("click", () => skipMasterSlot(slot));
    }

    function earliestDate(dates) { return (dates || []).filter(Boolean).sort()[0] || ""; }

    async function handleMasterFile(slot, file) {
        state.master.files[slot.key] = file;
        state.master.fileNames[slot.key] = file.name;
        setMasterStatus("Читаю файл: " + slot.title + "...");
        const rows = await readWorkbookRows(file, slot.kind);
        state.master.rows[slot.key] = rows;
        if (slot.key === "main") {
            const pmPreview = buildPreviewForModule("pm", rows, [], uploadDateForModule("pm"));
            state.master.pmTransferIds = pmPreview.copiedTransferIds || [];
            $("copyMasterTransfers").disabled = !state.master.pmTransferIds.length;
        }
        $("buildMasterPreview").disabled = !masterCanBuild();
        setMasterStatus("Файл прочитан: " + slot.title + ". Строк: " + rows.length + ".", "good");
        advanceMasterSlot();
    }

    function masterCanBuild() {
        return Boolean(state.master.rows.main && state.master.rows.noOrder && state.master.rows.packaging && state.master.rows.afterSale && (state.master.rows.carrier || state.master.skippedSlots.carrier));
    }

    function skipMasterSlot(slot) {
        if (!slot || !slot.optional) return;
        state.master.skippedSlots[slot.key] = true;
        state.master.rows[slot.key] = [];
        state.master.files[slot.key] = null;
        setMasterStatus("Шаг пропущен: " + slot.title + ".", "good");
        advanceMasterSlot();
    }

    function advanceMasterSlot() {
        state.master.slotIndex = Math.min((state.master.slotIndex || 0) + 1, MASTER_SLOTS.length);
        renderMasterSlots();
        if ((state.master.slotIndex || 0) < MASTER_SLOTS.length) setMasterStatus("");
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

    function nextPaint() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }

    function masterPreviewJobs(dates) {
        const main = state.master.rows.main || [];
        const noOrder = state.master.rows.noOrder || [];
        const carrier = state.master.rows.carrier || [];
        const packaging = state.master.rows.packaging || [];
        const afterSale = state.master.rows.afterSale || [];
        return [
            { module: "pm", date: dates.pm, rows: main, carrierRows: carrier },
            { module: "presort", date: dates.presort, rows: main, carrierRows: [] },
            { module: "marketplace_pc", date: dates.marketplace_pc, rows: main, carrierRows: [] },
            { module: "wmi_mp_pc", date: dates.wmi_mp_pc, rows: main, carrierRows: [] },
            { module: "no_order", date: dates.no_order, rows: noOrder, carrierRows: [] },
            { module: "packaging", date: dates.packaging, rows: packaging, carrierRows: [] },
            { module: "rwp", date: dates.rwp, rows: packaging, carrierRows: [] },
            { module: "after_sale_movement", date: dates.after_sale_movement, rows: afterSale, carrierRows: [] },
        ];
    }

    function totalMasterTasks(modules) {
        return (modules || []).reduce((acc, item) => acc + ((item.preview.tasks || []).length), 0);
    }

    async function buildMasterPreview() {
        if (!masterCanBuild() || state.master.building) return;
        state.master.building = true;
        $("buildMasterPreview").disabled = true;
        try {
            setMasterStatus("Считаю мастер-выгрузку по шагам...");
            const dates = masterDatePlan();
            const main = state.master.rows.main || [];
            const noOrder = state.master.rows.noOrder || [];
            const carrier = state.master.rows.carrier || [];
            const packaging = state.master.rows.packaging || [];
            const afterSale = state.master.rows.afterSale || [];
            const modules = [];
            state.master.preview = { dates, modules, totalTasks: 0, specialStatus: "idle" };
            renderMasterPreview("Считаю модули...");
            const jobs = masterPreviewJobs(dates);
            for (let i = 0; i < jobs.length; i += 1) {
                const job = jobs[i];
                setMasterStatus("Расчет " + (i + 1) + "/" + jobs.length + ": " + moduleDef(job.module).label + "...");
                await nextPaint();
                modules.push({ module: job.module, date: job.date, preview: buildPreviewForModule(job.module, job.rows, job.carrierRows, job.date) });
                state.master.preview.totalTasks = totalMasterTasks(modules);
                renderMasterPreview("Расчет " + (i + 1) + "/" + jobs.length + ".");
            }
            state.master.dateRejects = buildMasterDateRejects({ main, noOrder, packaging, afterSale }, dates);
            state.master.conditionRejects = buildMasterConditionRejects({ main, noOrder, packaging, carrier }, dates);
            renderMasterPreview();
            startMasterSpecialBackground();
        } catch (error) {
            setMasterStatus(error && error.message ? error.message : String(error), "error");
        } finally {
            state.master.building = false;
            if (!state.master.preview || !state.master.preview.totalTasks) $("buildMasterPreview").disabled = !masterCanBuild();
        }
    }

    function renderMasterPreview(message) {
        const preview = state.master.preview;
        const modules = preview ? preview.modules : [];
        const complete = Boolean(preview && modules.length === masterPreviewJobs(preview.dates || {}).length && !message);
        const hasRejects = Boolean((state.master.dateRejects || []).length || (state.master.conditionRejects || []).length);
        const hasTasks = Boolean(preview && preview.totalTasks);
        $("masterSummary").innerHTML = modules.map((item) => {
            const count = item.preview.tasks.length;
            return "<article class='module-card " + (count ? "done" : "missing") + "'><p class='module-name'><span>" + escapeHtml(moduleDef(item.module).label) + "</span><span>" + count + "</span></p><div class='module-date'>За " + formatRuDate(item.date) + "</div><p class='module-desc'>задач к сохранению</p></article>";
        }).join("");
        $("masterBottomActions").classList.toggle("hidden", !(complete && (hasRejects || hasTasks)));
        $("showRejects").classList.toggle("hidden", !hasRejects);
        $("showRejects").disabled = !hasRejects;
        $("saveMaster").classList.toggle("hidden", !hasTasks);
        $("saveMaster").disabled = !hasTasks;
        if (message) return;
        const specialLine = preview && preview.specialStatus === "checking"
            ? "\n2ШК/ПУ: проверяю в фоне " + (preview.specialLookupCount || 0) + " ШК."
            : preview && preview.specialStatus === "done"
                ? "\n2ШК/ПУ: проверено " + (preview.specialLookupCount || 0) + " ШК, найдено " + (preview.specialMatchedCount || 0) + "."
                : "";
        setMasterStatus(preview && preview.totalTasks ? "Предпросмотр готов. Всего задач: " + preview.totalTasks + "." + specialLine : "По файлам нет задач к сохранению." + specialLine, preview && preview.totalTasks ? "good" : "");
    }

    function startMasterSpecialBackground() {
        const preview = state.master.preview;
        if (!preview) return;
        const ids = Array.from(new Set((preview.modules || []).flatMap((item) => candidateIdsForSpecial(item.preview)).map(normalizeIdentifier).filter(Boolean)));
        const token = Date.now() + ":" + Math.random().toString(16).slice(2);
        if (!ids.length) {
            preview.specialStatus = "skipped";
            preview.specialLookupCount = 0;
            preview.specialMatchedCount = 0;
            state.master.specialCheck = null;
            renderMasterPreview();
            return;
        }
        preview.specialStatus = "checking";
        preview.specialLookupCount = ids.length;
        preview.specialMatchedCount = 0;
        state.master.specialCheck = {
            token,
            pending: true,
            promise: (async () => {
                try {
                    const specialMap = await loadSpecialMap(ids);
                    if (!state.master.specialCheck || state.master.specialCheck.token !== token) return null;
                    const dates = masterDatePlan();
                    const modules = masterPreviewJobs(dates).map((job) => ({ module: job.module, date: job.date, preview: buildPreviewForModule(job.module, job.rows, job.carrierRows, job.date, specialMap) }));
                    state.master.preview = { dates, modules, totalTasks: totalMasterTasks(modules), specialStatus: "done", specialLookupCount: ids.length, specialMatchedCount: specialMap.size };
                    renderMasterPreview();
                    return state.master.preview;
                } catch (error) {
                    if (state.master.preview) state.master.preview.specialStatus = "error";
                    setMasterStatus("Предпросмотр готов, но фоновая проверка 2ШК/ПУ упала: " + (error && error.message ? error.message : String(error)), "error");
                    return state.master.preview;
                } finally {
                    if (state.master.specialCheck && state.master.specialCheck.token === token) state.master.specialCheck.pending = false;
                }
            })(),
        };
        renderMasterPreview();
    }

    async function waitForMasterSpecialBackground() {
        if (!state.master.specialCheck || !state.master.specialCheck.pending || !state.master.specialCheck.promise) return;
        setMasterStatus("Дожидаюсь фоновой проверки 2ШК/ПУ перед сохранением...");
        await state.master.specialCheck.promise;
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
            if (isPmBufferStatus(row.product_status) && mxHasBoxes(row)) pushReject(list, "pm", row, "МХ содержит слово \"коробки\", строка исключена из ПМ/Почты", date, "pm");
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
        let preview = state.master.preview;
        if (!preview || !preview.totalTasks) return;
        $("saveMaster").disabled = true;
        setMasterStatus("Сохраняю мастер-выгрузку в Supabase...");
        let total = 0;
        const results = [];
        try {
            await waitForMasterSpecialBackground();
            preview = state.master.preview;
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
                }, (progress) => {
                    setMasterStatus("Сохраняю: " + moduleDef(item.module).label + ". Пачка " + progress.chunk + "/" + progress.totalChunks + ", задач в модуле " + progress.saved + "/" + progress.totalTasks + ". Уже сохранено всего: " + total + ".");
                });
                total += Number(response.upserted_count || tasks.length) || 0;
                if (response.upload_run) mergeRun(response.upload_run);
                results.push(moduleDef(item.module).label + ": " + tasks.length);
            }
            renderCalendar();
            renderModuleChooser();
            $("masterDone").classList.add("visible");
            $("masterDone").textContent = "Мастер-выгрузка завершена. Создано/обновлено задач: " + total + ". " + results.join("; ") + ".";
            $("masterBottomActions").classList.add("hidden");
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
        $("openReview").addEventListener("click", showReviewPage);
        $("openInactive").addEventListener("click", showInactivePage);
        $("openPrespisok").addEventListener("click", openPrespisokModal);
        $("taskSearchInput").addEventListener("input", scheduleTaskSearch);
        $("taskSearchInput").addEventListener("focus", () => {
            if ((state.taskSearch.rows || []).length) setTaskSearchResultsVisible(true);
        });
        $("taskSearchInput").addEventListener("keydown", (event) => {
            if (event.key === "Enter" && (state.taskSearch.rows || []).length) {
                event.preventDefault();
                const row = state.taskSearch.rows[0];
                setTaskSearchResultsVisible(false);
                openTaskDetail(row.id, isActiveReviewTask(row) ? "review" : "inactive");
            }
            if (event.key === "Escape") setTaskSearchResultsVisible(false);
        });
        document.addEventListener("click", (event) => {
            if (!event.target.closest || !event.target.closest(".task-search")) setTaskSearchResultsVisible(false);
        });
        $("openShiftFromBanner").addEventListener("click", () => { void openShiftOpeningModal(); });
        $("closeShiftOpening").addEventListener("click", closeShiftOpeningModal);
        $("shiftIncomingSelect").addEventListener("change", updateShiftOpeningForm);
        $("shiftOutgoingSelect").addEventListener("change", updateShiftOpeningForm);
        $("shiftPureLossesFile").addEventListener("change", () => {
            const file = $("shiftPureLossesFile").files && $("shiftPureLossesFile").files[0];
            if (file) void handleShiftPureLossesFile(file);
        });
        $("saveShiftOpening").addEventListener("click", () => { void saveShiftOpening(); });
        $("homeFromUploads").addEventListener("click", showHome);
        $("homeFromReview").addEventListener("click", showHome);
        $("homeFromInactive").addEventListener("click", showHome);
        $("makeUpload").addEventListener("click", () => openChooser(""));
        $("backfillUpload").addEventListener("click", openBackfillChooser);
        $("makeMasterUpload").addEventListener("click", openMaster);
        $("closeChooser").addEventListener("click", () => setFlowModalOpen("moduleChooser", false));
        $("backToChooser").addEventListener("click", () => openChooser(state.manualDate));
        $("saveUpload").addEventListener("click", () => { void saveCurrentUpload(); });
        $("repeatUpload").addEventListener("click", resetCurrentUpload);
        $("closeMaster").addEventListener("click", () => setFlowModalOpen("masterWork", false));
        $("closeBackfillCalendar").addEventListener("click", () => setFlowModalOpen("backfillCalendarModal", false));
        $("reviewViewSections").addEventListener("click", renderReview);
        $("openActualizeTasks").addEventListener("click", () => { void openActualizeTasksModal(); });
        $("closeActualizeTasks").addEventListener("click", closeActualizeTasksModal);
        $("copyActiveShk").addEventListener("click", () => { void copyActiveShkForActualize(); });
        $("actualizeSupersetFile").addEventListener("change", () => {
            const file = $("actualizeSupersetFile").files && $("actualizeSupersetFile").files[0];
            if (file) void handleActualizeSupersetFile(file);
        });
        $("copyMasterTransfers").addEventListener("click", () => { void copyMasterTransfers(); });
        $("buildMasterPreview").addEventListener("click", () => { void buildMasterPreview(); });
        $("showRejects").addEventListener("click", showMasterRejects);
        $("saveMaster").addEventListener("click", () => { void saveMasterUpload(); });
        $("closeEditTareTask").addEventListener("click", closeEditTareTaskModal);
        $("closeDeferTask").addEventListener("click", closeDeferTaskModal);
        $("cancelDeferTask").addEventListener("click", closeDeferTaskModal);
        $("saveDeferTask").addEventListener("click", () => { void deferTaskFromModal(); });
        $("deferReasonInput").addEventListener("input", updateDeferTaskForm);
        $("deferDateInput").addEventListener("input", updateDeferTaskForm);
        $("closeReopenConfirm").addEventListener("click", closeReopenConfirm);
        $("cancelReopenTask").addEventListener("click", closeReopenConfirm);
        $("confirmReopenTask").addEventListener("click", () => { void reopenTaskFromConfirm(); });
        $("closeSplitShkConfirm").addEventListener("click", closeSplitShkConfirm);
        $("cancelSplitShk").addEventListener("click", closeSplitShkConfirm);
        $("confirmSplitShk").addEventListener("click", () => { void splitShkFromConfirm(); });
        $("specialInfoModal").addEventListener("click", (event) => { if (event.target === $("specialInfoModal")) closeSpecialInfoModal(); });
        $("prespisokModal").addEventListener("click", (event) => { if (event.target === $("prespisokModal")) requestPrespisokClose(); });
        $("shiftOpeningModal").addEventListener("click", (event) => { if (event.target === $("shiftOpeningModal")) closeShiftOpeningModal(); });
        $("actualizeTasksModal").addEventListener("click", (event) => { if (event.target === $("actualizeTasksModal")) closeActualizeTasksModal(); });
        $("moduleChooser").addEventListener("click", (event) => { if (event.target === $("moduleChooser")) setFlowModalOpen("moduleChooser", false); });
        $("uploadWork").addEventListener("click", (event) => { if (event.target === $("uploadWork")) openChooser(state.manualDate); });
        $("masterWork").addEventListener("click", (event) => { if (event.target === $("masterWork")) setFlowModalOpen("masterWork", false); });
        $("backfillCalendarModal").addEventListener("click", (event) => { if (event.target === $("backfillCalendarModal")) setFlowModalOpen("backfillCalendarModal", false); });
        $("reviewSectionModal").addEventListener("click", (event) => { if (event.target === $("reviewSectionModal")) closeReviewSectionModal(); });
        $("inactiveTasksModal").addEventListener("click", (event) => { if (event.target === $("inactiveTasksModal")) setFlowModalOpen("inactiveTasksModal", false); });
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if ($("specialInfoModal").classList.contains("active")) {
                closeSpecialInfoModal();
                return;
            }
            if ($("taskDetailModal").classList.contains("active")
                || $("editTareTaskModal").classList.contains("active")
                || $("deferTaskModal").classList.contains("active")
                || $("reopenConfirmModal").classList.contains("active")
                || $("splitShkConfirmModal").classList.contains("active")) return;
            if ($("prespisokModal").classList.contains("active")) requestPrespisokClose();
            else if ($("inactiveTasksModal").classList.contains("active")) setFlowModalOpen("inactiveTasksModal", false);
            else if ($("actualizeTasksModal").classList.contains("active")) closeActualizeTasksModal();
            else if ($("shiftOpeningModal").classList.contains("active")) closeShiftOpeningModal();
            else if ($("masterWork").classList.contains("active")) setFlowModalOpen("masterWork", false);
            else if ($("uploadWork").classList.contains("active")) openChooser(state.manualDate);
            else if ($("moduleChooser").classList.contains("active")) setFlowModalOpen("moduleChooser", false);
            else if ($("backfillCalendarModal").classList.contains("active")) setFlowModalOpen("backfillCalendarModal", false);
            else if ($("reviewSectionModal").classList.contains("active")) closeReviewSectionModal();
        });
    }

    function init() {
        initEvents();
        renderCalendar();
        renderShiftGate();
        void loadShiftState();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
}());
