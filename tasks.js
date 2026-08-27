(function () {
    "use strict";

    const WH_ID = "50144199";
    const RUNS_TABLE = "wms_manual_upload_runs";
    const SETTINGS_TABLE = "wms_manual_upload_settings";
    const WMS_TASKS_TABLE = "wms_tasks";
    const WMS_TASK_SELECT_COLUMNS = "id,source_module,source_id,source_row_id,source_payload,source_shk_ids,source_tare_id,source_price_sum,source_last_movement_at,upload_type,upload_effective_date,task_type,title,description,priority,priority_label,due_date,responsibility_zone,task_status,opp_verdict,assignee_employee_id,assignee_name,tags,is_deleted,completed_at,reopened_at,reopen_after,created_at,updated_at";
    // Achievement counting only ever reads a handful of flat fields plus the
    // actor's id/name (buried in source_payload.wms_review). The full
    // WMS_TASK_SELECT_COLUMNS row -- source_payload especially, which carries
    // every task_item/review/history blob -- averages ~2.5KB/row; across
    // thousands of completed tasks that's ~19MB transferred on every single
    // achievement check (every page load, every task completion). Extracting
    // just the two JSON fields we need server-side cuts that to ~2MB.
    const ACHIEVEMENT_TASK_LEAN_COLUMNS = "id,task_status,is_deleted,opp_verdict,task_type,title,source_module,upload_type,completed_at,updated_at,assignee_employee_id,assignee_name,completed_by_id:source_payload->wms_review->>completed_by_id,completed_by_name:source_payload->wms_review->>completed_by_name";
    const WMS_EMPLOYEES_TABLE = "wms_employees";
    const WMS_SHIFTS_TABLE = "wms_shifts";
    const WMS_PRESPISOK_RUNS_TABLE = "wms_prespisok_runs";
    const WMS_PRESPISOK_ACTIONS_TABLE = "wms_prespisok_actions";
    const WMS_ACHIEVEMENTS_TABLE = "wms_achievements";
    const WMS_WRITEOFF_TERMS_TABLE = "wms_writeoff_terms";
    const FLOW_SETTINGS_TABLE = "wms_flow_score_settings";
    const FLOW_HISTORY_TABLE = "wms_task_history";
    const SUPABASE_FUNCTIONS_BASE_URL = ((typeof window !== "undefined" && window.SUPABASE_URL) || "https://bgphllmzmlwurfnbagho.supabase.co").replace(/\/$/, "") + "/functions/v1";
    const SUPABASE_PUBLIC_ANON_KEY = (typeof window !== "undefined" && window.SUPABASE_ANON_KEY) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q";
    const WMS_TASK_WRITEBACK_FUNCTION = "wms-task-writeback";
    const PURE_LOSSES_TABLE = "pure_losses_rep";
    const LOSSES_TABLE = "losses_rep";
    const SAVE_RPC = "save_wms_manual_upload";
    const SAVE_TASK_CHUNK_SIZE = 40;
    const SAVE_HEAVY_TASK_CHUNK_SIZE = 12;
    const SAVE_MAX_CHUNK_JSON_CHARS = 180000;
    const SAVE_HEAVY_MAX_CHUNK_JSON_CHARS = 90000;
    const FILTER_NONE = "__wms_filter_none__";
    const TWO_SHK_TABLE = "2shk_rep";
    const PURE_URL_FILTER_CHUNK_SIZE = 80;
    const PURE_INSERT_CHUNK_SIZE = 400;
    const SPECIAL_LOOKUP_CHUNK_SIZE = 500;
    const SPECIAL_LOOKUP_CONCURRENCY = 3;
    const PURE_AUTO_IDS = new Set(["11", "21", "26", "31", "32", "35", "42", "47"]);
    const AUTO_FOUND_DECISION = "Найден";
    const AUTO_FOUND_EMP_ID = "2405";
    const AUTO_FOUND_COMMENT = "У товара есть движение";
    const SYSTEM_COMPLETION_VERDICT_KEYS = new Set([
        SYSTEM_MOVEMENT_VERDICT,
        SYSTEM_NO_SHK_NOT_FOUND_VERDICT,
        SYSTEM_NO_SHK_FOUND_VERDICT,
    ].map((item) => normalizeForMatch(item)));
    const QUICK_NO_SHK_PURE_NOT_FOUND_MARKER = "[WMS+ Без ШК: не найден]";
    const QUICK_NO_SHK_SUPERSET_CACHE_KEY = "wms_quick_no_shk_superset_cache_v1";
    const QUICK_NO_SHK_SUPERSET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
    const QUICK_NO_SHK_PRELOAD_AHEAD = 4;
    const SUPERSET_CACHE_TABLE = "wms_superset_cache";
    const SUPERSET_CACHE_CHUNK_SIZE = 500;
    const QUICK_NO_SHK_STREAK_THRESHOLD_MS = 6000;
    const QUICK_NO_SHK_TIMER_WARN_MS = 8000;
    const QUICK_NO_SHK_TIMER_HOT_MS = 16000;
    const NO_SHK_SEARCH_LIMIT = 120;
    const NO_SHK_PHOTO_PREVIEW_LIMIT = 18;
    const NO_SHK_FOUND_COMMENT = "Разбор Без ШК: товар опознан в WMS+.";
    const NO_SHK_VISUAL_SIMILAR_MAP = {
        A: "А", a: "а", B: "В", b: "в", C: "С", c: "с", E: "Е", e: "е", H: "Н", h: "н",
        K: "К", k: "к", M: "М", m: "м", O: "О", o: "о", P: "Р", p: "р", T: "Т", t: "т",
        X: "Х", x: "х", Y: "У", y: "у", А: "A", а: "a", В: "B", в: "b", С: "C", с: "c",
        Е: "E", е: "e", Н: "H", н: "h", К: "K", к: "k", М: "M", м: "m", О: "O", о: "o",
        Р: "P", р: "p", Т: "T", т: "t", Х: "X", х: "x", У: "Y", у: "y",
    };
    const NO_SHK_PURE_COLUMNS = {
        nm: ["nm", "nm_id", "nmId"],
        description: ["decription", "description"],
        brand: ["brand", "brand_name", "brandName"],
        decision: ["opp_deecision", "opp_decision", "decision"],
        employee: ["opp_emp", "emp"],
        comment: ["opp_comment", "comment"],
    };
    const MOVEMENT_AUTO_CLOSE_MINUTES = 10;
    const MOVEMENT_AUTO_CLOSE_MIN_MS = MOVEMENT_AUTO_CLOSE_MINUTES * 60 * 1000;
    const PRESPISOK_STORAGE_KEY = "wms_prespisok_progress_v1";
    const PRESPISOK_TEST_MODE = false;
    const PRESPISOK_START_MINUTE = 14 * 60 + 30;
    const PRESPISOK_END_MINUTE = 20 * 60;
    const PRESPISOK_RESERVATION_TTL_MS = 20 * 60 * 1000;
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
    const MASTER_MAIN_MODULES = ["pm", "presort", "marketplace", "pc", "wmi_mp_pc"];
    const MASTER_PACKAGING_MODULES = ["packaging", "rwp"];
    const MASTER_MODULES = ["pm", "presort", "marketplace", "pc", "marketplace_pc", "wmi_mp_pc", "no_order", "packaging", "rwp", "after_sale_movement"];
    const DEFAULT_WRITEOFF_TERMS = [
        { term_type: "status", term_key: "SGR", label: "SGR", days_without_movement: 8, sort_order: 10 },
        { term_type: "status", term_key: "RWP", label: "RWP", days_without_movement: 5, sort_order: 20 },
        { term_type: "status", term_key: "SMS", label: "SMS", days_without_movement: 2, sort_order: 30 },
        { term_type: "status", term_key: "SWT", label: "SWT", days_without_movement: 2, sort_order: 40 },
        { term_type: "status", term_key: "SPS", label: "SPS", days_without_movement: 1, sort_order: 50 },
        { term_type: "status", term_key: "PWT", label: "PWT", days_without_movement: 1, sort_order: 60 },
        { term_type: "status", term_key: "GWS", label: "GWS", days_without_movement: 1, sort_order: 70 },
        { term_type: "status", term_key: "WMI", label: "WMI", days_without_movement: 1, sort_order: 80 },
        { term_type: "status", term_key: "LGR", label: "LGR", days_without_movement: 1, sort_order: 90 },
        { term_type: "status", term_key: "PAP", label: "PAP", days_without_movement: 1, sort_order: 100 },
        { term_type: "status", term_key: "SMC", label: "SMC", days_without_movement: 1, sort_order: 110 },
        { term_type: "status", term_key: "USD", label: "USD", days_without_movement: 1, sort_order: 120 },
        { term_type: "status", term_key: "TMM", label: "TMM", days_without_movement: 1, sort_order: 130 },
        { term_type: "status", term_key: "ORS", label: "ORS", days_without_movement: 1, sort_order: 140 },
        { term_type: "status", term_key: "SAS", label: "SAS", days_without_movement: 1, sort_order: 150 },
        { term_type: "status", term_key: "EPR", label: "EPR", days_without_movement: 1, sort_order: 160 },
        { term_type: "lr", term_key: "26LR", label: "26LR", days_without_movement: 0, sort_order: 1000 },
    ];
    const ACHIEVEMENT_RARITIES = {
        common: { label: "Обычная", marker: "⚪", icon: "✓" },
        uncommon: { label: "Необычная", marker: "🟢", icon: "↗" },
        rare: { label: "Редкая", marker: "🔵", icon: "◆" },
        epic: { label: "Эпическая", marker: "🟣", icon: "✦" },
        legendary: { label: "Легендарная", marker: "🟠", icon: "★" },
    };
    const ACHIEVEMENTS = [
        { id: "shift_open_first", rarity: "common", emoji: "👋", title: "И снова здравствуйте", text: "Открыть смену." },
        { id: "shift_open_10", rarity: "uncommon", emoji: "🏠", title: "Прописался", text: "Открыть 10 смен." },
        { id: "prespisok_first", rarity: "common", emoji: "📋", title: "С почином", text: "Разобрать первый предсписок." },
        { id: "prespisok_10", rarity: "uncommon", emoji: "🧾", title: "Предсписочник", text: "Разобрать 10 предсписков." },
        { id: "prespisok_100", rarity: "epic", emoji: "👑", title: "Повелитель предсписка", text: "Разобрать 100 предсписков." },
        { id: "prespisok_speedrun_60", rarity: "rare", emoji: "🏎️", title: "Спидран", text: "Разобрать предсписок менее чем за 60 минут." },
        { id: "prespisok_7_days", rarity: "epic", emoji: "🔁", title: "День сурка", text: "Участвовать в разборе предсписка 7 дней подряд." },
        { id: "prespisok_all_writeoff", rarity: "epic", emoji: "🕳️", title: "Фаталист", text: "Списать все ШК из предсписка.", hidden: true },
        { id: "awh_first", rarity: "common", emoji: "📦", title: "AWH, вот оно что", text: "Разобрать первое списание AWH." },
        { id: "awh_10", rarity: "uncommon", emoji: "🧮", title: "AWHторитет", text: "Разобрать 10 списаний AWH." },
        { id: "awh_100", rarity: "rare", emoji: "⚙️", title: "AWHтомат", text: "Разобрать 100 списаний AWH." },
        { id: "awh_1000", rarity: "legendary", emoji: "🏭", title: "AWHсолют", text: "Разобрать 1000 списаний AWH.", hidden: true },
        { id: "boxes_first", rarity: "common", emoji: "🎁", title: "Что в коробке?", text: "Разобрать первую коробку на входе." },
        { id: "boxes_10", rarity: "uncommon", emoji: "🧤", title: "Распаковщик", text: "Разобрать 10 коробок на входе." },
        { id: "boxes_100", rarity: "rare", emoji: "🗃️", title: "Коробочный магнат", text: "Разобрать 100 коробок на входе." },
        { id: "boxes_1000", rarity: "legendary", emoji: "🐉", title: "Властелин коробок", text: "Разобрать 1000 коробок на входе.", hidden: true },
        { id: "requests_first", rarity: "common", emoji: "📞", title: "На связи", text: "Ответить на первый запрос." },
        { id: "requests_100", rarity: "rare", emoji: "🎧", title: "Колл-центр", text: "Ответить на 100 запросов." },
        { id: "tasks_10", rarity: "common", emoji: "💪", title: "Разминка", text: "Завершить 10 заданий." },
        { id: "tasks_100", rarity: "uncommon", emoji: "💯", title: "Соточка", text: "Завершить 100 заданий." },
        { id: "tasks_1000", rarity: "epic", emoji: "🏭", title: "Конвейер", text: "Завершить 1000 заданий." },
        { id: "tasks_10000", rarity: "legendary", emoji: "🌱", title: "Потрогай траву", text: "Завершить 10 000 заданий.", hidden: true },
        { id: "autoclose_half", rarity: "rare", emoji: "🤖", title: "Оно само", text: "Более половины активных задач закрылись автозакрытием.", hidden: true, soon: true },
        { id: "dual_flow_shift", rarity: "rare", emoji: "🪓", title: "На два фронта", text: "Быть ответственным за оба потока в одну смену.", hidden: true },
        { id: "no_shk_150_10", rarity: "legendary", emoji: "👻", title: "ШК? Не слышал", text: "Разобрать более 150 «Без ШК» менее чем за 10 минут." },
        { id: "guilty_1034305", rarity: "epic", emoji: "🕵️", title: "Подозреваемый №1034305", text: "Попытаться указать 1034305 как виновного.", hidden: true },
        { id: "first_task_5m", rarity: "uncommon", emoji: "🚀", title: "С места в карьер", text: "Выполнить первую задачу менее чем через 5 минут после открытия смены." },
        { id: "tasks_first_hour_25", rarity: "rare", emoji: "🌅", title: "Доброе утро", text: "Выполнить 25 задач за первый час смены." },
        { id: "task_after_20", rarity: "uncommon", emoji: "🌙", title: "Последний выключает свет", text: "Выполнить задачу после 20:00." },
        { id: "zero_active_tasks", rarity: "epic", emoji: "🧹", title: "Всё. Вообще всё.", text: "Добиться момента, когда нет ни одной активной задачи." },
        { id: "shift_100_tasks", rarity: "rare", emoji: "🥁", title: "Ударная смена", text: "Выполнить 100 задач за одну смену." },
        { id: "shift_200_tasks", rarity: "epic", emoji: "⚡", title: "А ты точно сам?", text: "Выполнить 200 задач за одну смену." },
        { id: "shift_300_tasks", rarity: "legendary", emoji: "🚨", title: "Подозрительная активность", text: "Выполнить 300 задач за одну смену." },
        { id: "ten_task_types_shift", rarity: "rare", emoji: "🛠️", title: "Швейцарский нож", text: "Выполнить 10 разных типов задач за одну смену." },
        { id: "triple_prespisok_awh_boxes", rarity: "epic", emoji: "🎛️", title: "Три в одном", text: "За одну смену поработать с предсписком, AWH и коробками на входе." },
        { id: "excellent_shift", rarity: "uncommon", emoji: "🎓", title: "Отличник", text: "Закрыть смену на 5+.", hidden: true, soon: true },
        { id: "excellent_shift_10", rarity: "epic", emoji: "🏅", title: "Красный диплом", text: "Закрыть 10 смен на 5+.", hidden: true, soon: true },
        { id: "update_all_writeoff_dates", rarity: "uncommon", emoji: "⏳", title: "Ещё поживёт", text: "Обновить все сроки списания.", hidden: true, soon: true },
        { id: "birthday_task", rarity: "rare", emoji: "🎂", title: "Работа — лучший подарок", text: "Выполнить задачу в свой день рождения.", hidden: true, soon: true },
        { id: "clean_shift", rarity: "rare", emoji: "✨", title: "Чистая работа", text: "Закрыть смену без единой просроченной задачи.", hidden: true, soon: true },
        { id: "clean_shift_5_streak", rarity: "epic", emoji: "🧵", title: "Ни единого разрыва", text: "Закрыть 5 смен подряд без просрочек.", hidden: true, soon: true },
        { id: "excellent_shift_3_streak", rarity: "rare", emoji: "📈", title: "Стабильность — признак мастерства", text: "Закрыть 3 смены подряд на 5+.", hidden: true, soon: true },
        { id: "excellent_shift_10_streak", rarity: "legendary", emoji: "🧨", title: "Без права на ошибку", text: "Закрыть 10 смен подряд на 5+.", hidden: true, soon: true },
        { id: "last_minute_save", rarity: "rare", emoji: "⏱️", title: "На тоненького", text: "Найти товар в последнюю минуту перед списанием.", hidden: true, soon: true },
        { id: "midnight_task", rarity: "rare", emoji: "🕛", title: "Между мирами", text: "Выполнить задачу ровно в 00:00.", hidden: true, soon: true },
        { id: "new_year_first_task", rarity: "epic", emoji: "🎄", title: "Ну вот опять", text: "Выполнить первую задачу нового года.", hidden: true, soon: true },
        { id: "first_minute_task", rarity: "rare", emoji: "🙋", title: "Мне только спросить", text: "Закрыть задачу в течение первой минуты после открытия смены.", hidden: true, soon: true },
    ];
    const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));
    const RECOUNTABLE_TASK_ACHIEVEMENT_IDS = [
        "tasks_10",
        "tasks_100",
        "tasks_1000",
        "tasks_10000",
        "awh_first",
        "awh_10",
        "awh_100",
        "awh_1000",
        "boxes_first",
        "boxes_10",
        "boxes_100",
        "boxes_1000",
        "requests_first",
        "requests_100",
        "shift_100_tasks",
        "shift_200_tasks",
        "shift_300_tasks",
        "ten_task_types_shift",
        "task_after_20",
    ];

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
    const REQUEST_SECTIONS = [
        "Запросы входящего потока",
        "Списания AWH",
        "Коробки на входе",
    ];
    const FLOW_SKIP_COOLDOWN_MS = 4 * 60 * 60 * 1000;
    const FLOW_SCORE_VERSION = "flow-mvp-2026-08-24";
    const FLOW_ALLOWED_USER_IDS = new Set(["1034305"]);
    const FLOW_STRICT_INCOMING_SECTIONS = new Set(["Запросы входящего потока", "Коробки на входе"]);
    const FLOW_STRICT_OUTGOING_SECTIONS = new Set(["Списания AWH"]);
    const DEFAULT_FLOW_SCORE_SETTINGS = {
        lockTtlMinutes: 15,
        weights: {
            price: 1,
            urgency: 1,
            source: 1,
            mass: 1,
            age: 1,
            reopen: 1,
            tags: 1,
            group: 1,
            zone: 1,
            skill: 1,
        },
        sourceBoosts: {
            incomingFlowRequests: 60000,
            awhWriteoffs: 18000,
            incomingBoxes: 16000,
            prespisokSecondLine: 22000,
            afterSaleMovement: 14000,
        },
        zone: {
            own: 1.18,
            otherFlexible: 0.82,
            overflowBonus: 0.22,
            heavyLoadBonus: 0.14,
            strictBonus: 0.08,
        },
        grouping: {
            enabled: true,
            minCount: 3,
            windowMinutes: 120,
            perExtraTask: 1800,
            pricePercent: 0.08,
            maxBonus: 42000,
        },
        skill: {
            enabled: true,
            lookbackDays: 14,
            minCompleted: 5,
            perCompletion: 0.008,
            maxMultiplier: 1.16,
        },
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
        { key: "main", title: "Товары без движения - В заказе", kind: "pmPrimary", modules: ["pm", "presort", "marketplace", "pc", "wmi_mp_pc"] },
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
        writeoffTerms: {
            rows: DEFAULT_WRITEOFF_TERMS.map((item) => ({ ...item, is_active: true })),
            loaded: false,
            loading: false,
            saving: false,
            error: "",
            recommendations: {
                loading: false,
                rows: [],
                capacityRows: [],
                problemSections: [],
                statusPriorities: [],
                summary: null,
                error: "",
                generatedAt: "",
            },
        },
        staffStats: {
            date: todayIsoInMoscow(),
            loading: false,
            loaded: false,
            error: "",
            summary: null,
            employees: [],
            selectedKey: "",
            activeTab: "tasks",
            taskRowsById: {},
        },
        loadingStatus: false,
        calendarRange: null,
        manualDate: "",
        activeModule: "",
        activeDate: "",
        repeatUploadUnlocked: false,
        files: {},
        rows: {},
        preview: null,
        specialMap: new Map(),
        specialCheck: null,
        review: {
            rows: [],
            loading: false,
            loaded: false,
            loadPromise: null,
            activeSection: "",
            modalMode: "",
            sort: { key: "price", dir: "desc" },
            filters: createReviewFilterState(),
        },
        flow: {
            loading: false,
            rows: [],
            scored: [],
            currentRowId: "",
            currentScore: null,
            status: "Флоу еще не запускался.",
            statusTone: "",
            claiming: false,
            settings: JSON.parse(JSON.stringify(DEFAULT_FLOW_SCORE_SETTINGS)),
            settingsLoaded: false,
            settingsSaving: false,
            employeeStats: { bySection: {}, loaded: false, note: "" },
            groupIndex: new Map(),
            taskCardRowId: "",
            skipRowId: "",
            skipSaving: false,
            conflictRowId: "",
            allowConflictOpenId: "",
        },
        requests: {
            activeSection: "",
            sort: { key: "price", dir: "desc" },
            filters: createReviewFilterState(),
        },
        reviewCanvas: {
            sort: { key: "price", dir: "desc" },
            filters: createReviewFilterState(),
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
            countdownTimer: null,
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
            loadPromise: null,
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
        quickNoShk: {
            loading: false,
            items: [],
            index: 0,
            actions: [],
            started: false,
            processing: false,
            photoCache: {},
            pureCandidates: [],
            supersetRows: [],
            supersetByShk: new Map(),
            missingNm: 0,
            needsSuperset: false,
            fileName: "",
            lastSupersetMessage: "",
            lastSupersetTone: "",
        },
        noShkReview: {
            query: "",
            rows: [],
            loading: false,
            processing: false,
            photoCache: {},
            resolvedColumns: {},
            status: "",
            statusTone: "",
            enlargedPhoto: "",
            success: null,
            token: 0,
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
            reservations: {},
            remoteRun: null,
            progressOnly: false,
            joinedRemote: false,
            syncTimer: null,
        },
        prespisokSecondLine: {
            rows: [],
            loading: false,
            loaded: false,
            sort: { key: "price", dir: "desc" },
        },
        prespisokHome: {
            loading: false,
            run: null,
            timer: null,
            leaderboard: [],
        },
        prespisokJournal: {
            loading: false,
            runs: [],
            actionsByRunId: {},
            selectedRunId: "",
            error: "",
        },
        achievements: {
            earned: new Map(),
            loading: false,
            error: "",
            syncDisabled: false,
            cleaning: false,
        },
    };

    const $ = (id) => document.getElementById(id);

    function createReviewFilterState() {
        return {
            date: "",
            movementStatuses: new Set(),
            entityTypes: new Set(),
            taskStatuses: new Set(),
            sectionNames: new Set(),
            openKey: "",
        };
    }

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

    // Same idea as addDays() but keeps the time-of-day instead of truncating
    // to a date, for the "Прогнозируемая дата списания" history line.
    function addDaysToTimestamp(iso, days) {
        const ts = iso ? Date.parse(iso) : NaN;
        if (!Number.isFinite(ts)) return "";
        return new Date(ts + Number(days || 0) * 86400000).toISOString();
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

    function achievementActor() {
        const user = currentWmsUser();
        const fallbackId = normalizeText(localStorage.getItem("wms_achievement_user_id")) || "local";
        const id = normalizeText(user.id) || fallbackId;
        if (!normalizeText(user.id) && !localStorage.getItem("wms_achievement_user_id")) {
            try { localStorage.setItem("wms_achievement_user_id", id); } catch (_error) {}
        }
        return { id, name: normalizeText(user.name) || "Сотрудник ОПП" };
    }

    function achievementLocalKey(userId) {
        return "wms_achievements_v1:" + WH_ID + ":" + (normalizeText(userId) || "local");
    }

    function localAchievementRows(userId) {
        const rows = parseJsonSafe(localStorage.getItem(achievementLocalKey(userId)), []);
        return Array.isArray(rows) ? rows : [];
    }

    function saveLocalAchievementRow(userId, row) {
        try {
            const rows = localAchievementRows(userId).filter((item) => item.achievement_id !== row.achievement_id);
            rows.push(row);
            localStorage.setItem(achievementLocalKey(userId), JSON.stringify(rows));
        } catch (_error) {}
    }

    function removeLocalAchievementRows(userId, ids) {
        try {
            const blocked = new Set((ids || []).map(normalizeText).filter(Boolean));
            const rows = localAchievementRows(userId).filter((item) => !blocked.has(normalizeText(item && item.achievement_id)));
            localStorage.setItem(achievementLocalKey(userId), JSON.stringify(rows));
        } catch (_error) {}
    }

    function applyAchievementRows(rows) {
        (rows || []).forEach((row) => {
            const id = normalizeText(row && (row.achievement_id || row.id));
            if (!id || !ACHIEVEMENT_BY_ID.has(id)) return;
            state.achievements.earned.set(id, {
                achievement_id: id,
                unlocked_at: normalizeText(row.unlocked_at) || new Date().toISOString(),
                payload: row.payload && typeof row.payload === "object" ? row.payload : {},
            });
        });
    }

    async function syncLocalAchievementsToSupabase(actor, db, remoteRows) {
        if (!actor || !db || state.achievements.syncDisabled) return;
        const remoteIds = new Set((remoteRows || []).map((row) => normalizeText(row && row.achievement_id)).filter(Boolean));
        const rows = localAchievementRows(actor.id)
            .filter((row) => {
                const id = normalizeText(row && row.achievement_id);
                return id && ACHIEVEMENT_BY_ID.has(id) && !remoteIds.has(id);
            })
            .map((row) => ({
                wh_id: WH_ID,
                user_id: actor.id,
                user_name: actor.name,
                achievement_id: normalizeText(row.achievement_id),
                unlocked_at: normalizeText(row.unlocked_at) || new Date().toISOString(),
                payload: row.payload && typeof row.payload === "object" ? row.payload : {},
            }));
        if (!rows.length) return;
        try {
            const { error } = await db
                .from(WMS_ACHIEVEMENTS_TABLE)
                .upsert(rows, { onConflict: "wh_id,user_id,achievement_id" });
            if (error) throw error;
        } catch (error) {
            console.warn("achievement restore skipped:", error);
        }
    }

    async function forgetAchievements(ids) {
        const cleanIds = Array.from(new Set((ids || []).map(normalizeText).filter(Boolean)));
        if (!cleanIds.length) return;
        const actor = achievementActor();
        cleanIds.forEach((id) => state.achievements.earned.delete(id));
        removeLocalAchievementRows(actor.id, cleanIds);
        renderAchievementsModal();
        const db = supabaseDb();
        if (!db || state.achievements.syncDisabled) return;
        try {
            const { error } = await db
                .from(WMS_ACHIEVEMENTS_TABLE)
                .delete()
                .eq("wh_id", WH_ID)
                .eq("user_id", actor.id)
                .in("achievement_id", cleanIds);
            if (error) throw error;
        } catch (error) {
            console.warn("achievement cleanup skipped:", error);
        }
    }

    // Only a structurally missing table/column should permanently switch a
    // session to local-only mode. A timeout or network blip is transient --
    // this table has genuinely timed out under load before (same as other
    // large queries against wms_tasks), and permanently disabling sync over
    // one bad request would silently strand every achievement earned for
    // the rest of the session in localStorage only.
    function isMissingAchievementsSchemaError(error) {
        const code = normalizeText(error && error.code);
        const message = normalizeForMatch(error && error.message);
        return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("could not find the table") || message.includes("could not find the column");
    }

    async function loadAchievements() {
        const actor = achievementActor();
        state.achievements.loading = true;
        state.achievements.error = "";
        applyAchievementRows(localAchievementRows(actor.id));
        const db = supabaseDb();
        if (!db || state.achievements.syncDisabled) {
            state.achievements.loading = false;
            renderAchievementsModal();
            return;
        }
        try {
            const { data, error } = await db
                .from(WMS_ACHIEVEMENTS_TABLE)
                .select("achievement_id,unlocked_at,payload")
                .eq("wh_id", WH_ID)
                .eq("user_id", actor.id)
                .order("unlocked_at", { ascending: false });
            if (error) throw error;
            applyAchievementRows(data || []);
            await syncLocalAchievementsToSupabase(actor, db, data || []);
        } catch (error) {
            console.warn("achievements load skipped:", error);
            if (isMissingAchievementsSchemaError(error)) {
                state.achievements.syncDisabled = true;
                state.achievements.error = "Достижения временно сохраняются локально. Примените миграцию wms_achievements для синхронизации.";
            }
        } finally {
            state.achievements.loading = false;
            renderAchievementsModal();
            void cleanupIneligibleTaskAchievements();
        }
    }

    function achievementExtraMarkup(rarity) {
        if (rarity === "rare") return "<i class='rare-wave'></i>";
        if (rarity === "epic") return "<i class='epic-orbit'></i>";
        if (rarity === "legendary") return "<i class='legendary-flare'></i>";
        return "";
    }

    function achievementParticles(count) {
        return Array.from({ length: count }, (_item, index) => {
            const angle = (Math.PI * 2 * index) / count;
            const radius = 80 + Math.random() * 150;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius * .62;
            const size = 4 + Math.random() * 8;
            const delay = Math.random() * .22;
            const rotation = Math.round(Math.random() * 520 - 260);
            return "<i class='achievement-particle' style='--x:" + x.toFixed(1) + "px;--y:" + y.toFixed(1) + "px;--size:" + size.toFixed(1) + "px;--delay:" + delay.toFixed(2) + "s;--r:" + rotation + "deg'></i>";
        }).join("");
    }

    function showAchievementToast(achievement) {
        const layer = $("achievementLayer");
        if (!layer || !achievement) return;
        const rarity = ACHIEVEMENT_RARITIES[achievement.rarity] || ACHIEVEMENT_RARITIES.common;
        const particleCount = achievement.rarity === "legendary" ? 42 : achievement.rarity === "epic" ? 28 : achievement.rarity === "rare" ? 20 : achievement.rarity === "uncommon" ? 16 : 10;
        const toastEl = document.createElement("article");
        toastEl.className = "achievement-toast rarity-" + escapeHtml(achievement.rarity || "common");
        toastEl.setAttribute("role", "status");
        toastEl.innerHTML = achievementExtraMarkup(achievement.rarity)
            + achievementParticles(particleCount)
            + "<div class='ach-icon'>" + escapeHtml(rarity.icon) + "</div>"
            + "<div class='ach-body'>"
            + "<div class='ach-rarity'>" + escapeHtml(rarity.marker + " " + rarity.label) + "</div>"
            + "<h2 class='ach-title'>" + escapeHtml((achievement.emoji ? achievement.emoji + " " : "") + achievement.title) + "</h2>"
            + "<p class='ach-text'>" + escapeHtml(achievement.text) + "</p>"
            + "</div>";
        layer.prepend(toastEl);
        window.setTimeout(() => toastEl.remove(), achievement.rarity === "legendary" ? 6700 : 6200);
    }

    async function unlockAchievement(id, payload) {
        const achievement = ACHIEVEMENT_BY_ID.get(id);
        if (!achievement || achievement.soon || state.achievements.earned.has(id)) return false;
        const actor = achievementActor();
        const row = {
            wh_id: WH_ID,
            user_id: actor.id,
            user_name: actor.name,
            achievement_id: id,
            unlocked_at: new Date().toISOString(),
            payload: payload || {},
        };
        state.achievements.earned.set(id, row);
        saveLocalAchievementRow(actor.id, row);
        showAchievementToast(achievement);
        renderAchievementsModal();
        const db = supabaseDb();
        if (!db || state.achievements.syncDisabled) return true;
        try {
            const { error } = await db
                .from(WMS_ACHIEVEMENTS_TABLE)
                .upsert(row, { onConflict: "wh_id,user_id,achievement_id" });
            if (error) throw error;
        } catch (error) {
            console.warn("achievement sync skipped:", error);
            if (isMissingAchievementsSchemaError(error)) state.achievements.syncDisabled = true;
        }
        return true;
    }

    function achievementCardHtml(achievement, earned) {
        const rarity = ACHIEVEMENT_RARITIES[achievement.rarity] || ACHIEVEMENT_RARITIES.common;
        const lockedSecret = (achievement.hidden || achievement.soon) && !earned;
        const title = lockedSecret ? "???" : achievement.title;
        const icon = earned ? achievement.emoji : "?";
        return "<button type='button' class='achievement-card rarity-" + escapeHtml(achievement.rarity || "common") + " " + (earned ? "earned" : "locked") + (achievement.soon ? " soon" : "") + "' data-achievement-detail='" + escapeHtml(achievement.id) + "'>"
            + "<div class='achievement-card-icon'>" + escapeHtml(icon || (earned ? "🏆" : "?")) + "</div>"
            + "<div class='achievement-card-main'><h4 class='achievement-card-title'>" + escapeHtml(title) + "</h4>"
            + "<span class='achievement-card-state'>" + escapeHtml(earned ? "Открыто" : achievement.soon ? "Скоро" : "Не открыто") + "</span></div>"
            + "</button>";
    }

    function achievementDetailHtml(achievement, earned) {
        const rarity = ACHIEVEMENT_RARITIES[achievement.rarity] || ACHIEVEMENT_RARITIES.common;
        const lockedSecret = (achievement.hidden || achievement.soon) && !earned;
        const title = lockedSecret ? "???" : achievement.title;
        const text = lockedSecret ? "Секретное достижение. Оно смотрит на тебя из тумана и делает вид, что ничего не знает." : achievement.text;
        const icon = earned ? achievement.emoji : "?";
        const dateText = earned ? formatRuDateTime(earned.unlocked_at) : "Еще не получено";
        const secretText = lockedSecret ? "<div class='achievement-detail-secret'>Секретка. Условие не показываю, иначе какой это тайный трофей.</div>" : "";
        return "<article class='achievement-detail-card rarity-" + escapeHtml(achievement.rarity || "common") + " " + (earned ? "earned" : "locked") + "'>"
            + achievementExtraMarkup(achievement.rarity)
            + "<button id='closeAchievementDetail' class='btn btn-square achievement-detail-close' type='button' aria-label='Закрыть'>×</button>"
            + "<div class='achievement-detail-orb'>" + escapeHtml(icon || (earned ? "🏆" : "?")) + "</div>"
            + "<div class='achievement-detail-rarity'>" + escapeHtml(rarity.marker + " " + rarity.label) + "</div>"
            + "<h3 class='achievement-detail-title'>" + escapeHtml(title) + "</h3>"
            + "<p class='achievement-detail-text'>" + escapeHtml(text) + "</p>"
            + secretText
            + "<div class='achievement-detail-date'><span>Дата получения</span><strong>" + escapeHtml(dateText) + "</strong></div>"
            + "</article>";
    }

    function renderAchievementsModal() {
        const wrap = $("achievementsWrap");
        if (!wrap) return;
        const earnedCount = state.achievements.earned.size;
        const available = ACHIEVEMENTS.filter((item) => !item.soon);
        const soon = ACHIEVEMENTS.filter((item) => item.soon);
        const subtitle = $("achievementsSubtitle");
        if (subtitle) subtitle.textContent = "Открыто " + earnedCount + " из " + available.length + ". " + (state.achievements.error || "Секретные ачивки раскрываются только после получения.");
        const summary = "<div class='achievements-summary'>"
            + "<div class='mini-stat'><div class='mini-stat-label'>Открыто</div><div class='mini-stat-value'>" + earnedCount + "</div></div>"
            + "<div class='mini-stat'><div class='mini-stat-label'>Доступно</div><div class='mini-stat-value'>" + available.length + "</div></div>"
            + "<div class='mini-stat'><div class='mini-stat-label'>Скоро</div><div class='mini-stat-value'>" + soon.length + "</div></div>"
            + "</div>";
        const availableHtml = available.map((item) => achievementCardHtml(item, state.achievements.earned.get(item.id))).join("");
        const soonHtml = soon.map((item) => achievementCardHtml(item, state.achievements.earned.get(item.id))).join("");
        wrap.innerHTML = summary
            + "<h4 class='achievement-section-title'>Доступные</h4><div class='achievements-list'>" + availableHtml + "</div>"
            + "<h4 class='achievement-section-title'>Скоро...</h4><div class='achievements-list'>" + soonHtml + "</div>";
    }

    function openAchievementDetail(id) {
        const achievement = ACHIEVEMENT_BY_ID.get(normalizeText(id));
        const wrap = $("achievementDetailWrap");
        if (!achievement || !wrap) return;
        wrap.innerHTML = achievementDetailHtml(achievement, state.achievements.earned.get(achievement.id));
        setFlowModalOpen("achievementDetailModal", true);
        const closeBtn = $("closeAchievementDetail");
        if (closeBtn) closeBtn.addEventListener("click", closeAchievementDetail);
    }

    function closeAchievementDetail() {
        setFlowModalOpen("achievementDetailModal", false);
    }

    async function openAchievementsModal() {
        closeFlowModals();
        renderAchievementsModal();
        setFlowModalOpen("achievementsModal", true);
        void loadAchievements();
    }

    function closeAchievementsModal() {
        closeAchievementDetail();
        setFlowModalOpen("achievementsModal", false);
    }

    function installAchievementDebugHelpers() {
        window.WMSAchievementsDebug = {
            restoreCurrentUser: async () => {
                const actor = achievementActor();
                const db = supabaseDb();
                if (!db) throw new Error("Supabase client is not ready");
                await syncLocalAchievementsToSupabase(actor, db, []);
                await loadAchievements();
                return { ok: true, action: "restored", user_id: actor.id, local_count: localAchievementRows(actor.id).length };
            },
            resetCurrentUser: async () => {
                const actor = achievementActor();
                state.achievements.earned.clear();
                removeLocalAchievementRows(actor.id, ACHIEVEMENTS.map((item) => item.id));
                const db = supabaseDb();
                if (db) {
                    const { error } = await db
                        .from(WMS_ACHIEVEMENTS_TABLE)
                        .delete()
                        .eq("wh_id", WH_ID)
                        .eq("user_id", actor.id);
                    if (error) throw error;
                }
                renderAchievementsModal();
                return { ok: true, action: "reset", user_id: actor.id };
            },
            showCurrentUser: () => {
                const actor = achievementActor();
                return { user_id: actor.id, user_name: actor.name, local_key: achievementLocalKey(actor.id), local_count: localAchievementRows(actor.id).length, earned_count: state.achievements.earned.size };
            },
        };
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

    function configuredUploadDateForModule(module) {
        const def = moduleDef(module);
        return addDays(state.today, Number(def.offsetDays || 0));
    }

    function moduleRunDates(module) {
        return (state.runs || [])
            .filter((run) => runMatchesModuleBranch(run, module))
            .map((run) => normalizeText(run.effective_date || run.business_date || run.upload_date))
            .filter(Boolean)
            .sort();
    }

    function firstMissingUploadDate(module, targetDate) {
        const target = normalizeText(targetDate);
        if (!target) return "";
        const dates = Array.from(new Set(moduleRunDates(module)));
        const latestAny = dates.length ? dates[dates.length - 1] : "";
        if (!latestAny || latestAny > target) return target;
        const beforeTarget = dates.filter((date) => date <= target);
        if (!beforeTarget.length) return target;
        let cursor = addDays(beforeTarget[beforeTarget.length - 1], 1);
        while (cursor && cursor <= target) {
            if (!runForUpload(module, cursor)) return cursor;
            cursor = addDays(cursor, 1);
        }
        return target;
    }

    function uploadDateForModule(module) {
        if (state.manualDate) return state.manualDate;
        return firstMissingUploadDate(module, configuredUploadDateForModule(module));
    }

    function uploadDateGapInfo(module) {
        const targetDate = configuredUploadDateForModule(module);
        const actualDate = uploadDateForModule(module);
        return {
            targetDate,
            actualDate,
            hasGap: Boolean(actualDate && targetDate && actualDate !== targetDate),
        };
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

    function defaultWriteoffTerms() {
        return DEFAULT_WRITEOFF_TERMS.map((item) => ({ ...item, is_active: item.is_active !== false }));
    }

    function normalizeWriteoffTermType(value) {
        const normalized = normalizeForMatch(value);
        return normalized === "lr" || normalized === "26lr" ? "lr" : "status";
    }

    function normalizeWriteoffTermKey(value, type) {
        const raw = normalizeText(value).toUpperCase();
        if (!raw) return "";
        if (normalizeWriteoffTermType(type) === "status") {
            const code = latinStatusCode(raw);
            return code || raw.replace(/\s+/g, "_");
        }
        return raw.replace(/\s+/g, "");
    }

    function writeoffTermSort(a, b) {
        const aType = normalizeWriteoffTermType(a && a.term_type);
        const bType = normalizeWriteoffTermType(b && b.term_type);
        if (aType !== bType) return aType === "status" ? -1 : 1;
        const aOrder = Number(a && a.sort_order) || 999;
        const bOrder = Number(b && b.sort_order) || 999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return normalizeText(a && a.term_key).localeCompare(normalizeText(b && b.term_key), "ru");
    }

    function applyWriteoffTerms(rows) {
        const byKey = new Map();
        defaultWriteoffTerms().forEach((item) => {
            byKey.set(item.term_type + "|" + item.term_key, item);
        });
        (rows || []).forEach((row) => {
            const termType = normalizeWriteoffTermType(row && row.term_type);
            const termKey = normalizeWriteoffTermKey(row && (row.term_key || row.status_code), termType);
            if (!termKey) return;
            const current = byKey.get(termType + "|" + termKey) || {};
            byKey.set(termType + "|" + termKey, {
                ...current,
                id: row.id || current.id,
                wh_id: normalizeText(row.wh_id) || WH_ID,
                term_type: termType,
                term_key: termKey,
                label: normalizeText(row.label || row.status_label) || current.label || termKey,
                days_without_movement: settingNumber(row.days_without_movement, current.days_without_movement ?? 0),
                is_active: row.is_active !== false,
                sort_order: Number(row.sort_order) || current.sort_order || 999,
                updated_at: normalizeText(row.updated_at || current.updated_at),
            });
        });
        state.writeoffTerms.rows = Array.from(byKey.values()).sort(writeoffTermSort);
    }

    function activeWriteoffStatusTerms() {
        const map = new Map();
        (state.writeoffTerms.rows || []).forEach((row) => {
            if (normalizeWriteoffTermType(row.term_type) !== "status" || row.is_active === false) return;
            const key = normalizeWriteoffTermKey(row.term_key, "status");
            if (!key) return;
            map.set(key, row);
        });
        return map;
    }

    function rowStatusForWriteoff(row) {
        return normalizeText(row && (row.product_status || row.last_status || row.status));
    }

    function rowMovementForWriteoff(row) {
        return normalizeText(row && (row.last_movement || row.created_at || row.status_at));
    }

    function writeoffDateInfoForRow(row, termMap) {
        const movement = parseDateTime(rowMovementForWriteoff(row));
        const statusText = rowStatusForWriteoff(row);
        const statusKey = normalizeWriteoffTermKey(statusText, "status");
        const term = statusKey ? (termMap || activeWriteoffStatusTerms()).get(statusKey) : null;
        const days = term ? settingNumber(term.days_without_movement, null) : null;
        if (!movement.date || !term || !Number.isFinite(days)) return null;
        return {
            date: addDays(movement.date, days),
            movement_date: movement.date,
            movement_raw: rowMovementForWriteoff(row),
            status_key: statusKey,
            status_label: normalizeText(term.label) || statusText || statusKey,
            status_raw: statusText,
            days_without_movement: days,
            shk: normalizeIdentifier(row && (row.product || row.shk)),
        };
    }

    function writeoffDateInfoForRows(rows, fallbackDate) {
        const termMap = activeWriteoffStatusTerms();
        const candidates = (rows || []).map((row) => writeoffDateInfoForRow(row, termMap)).filter((item) => item && item.date);
        if (!candidates.length) {
            return {
                date: fallbackDate || "",
                source: "fallback",
                basis: null,
                candidates: [],
            };
        }
        const sorted = candidates.slice().sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return normalizeText(a.movement_date).localeCompare(normalizeText(b.movement_date));
        });
        return {
            date: sorted[0].date,
            source: "status_terms",
            basis: sorted[0],
            candidates: sorted,
        };
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

    const modalCloseTokens = {};

    function setFlowModalOpen(id, open) {
        const modal = $(id);
        if (!modal) return;
        if (open) {
            modalCloseTokens[id] = (modalCloseTokens[id] || 0) + 1;
            modal.classList.remove("is-closing");
            modal.classList.add("active");
            modal.setAttribute("aria-hidden", "false");
            return;
        }
        modal.setAttribute("aria-hidden", "true");
        if (!modal.classList.contains("active")) return;
        const token = (modalCloseTokens[id] = (modalCloseTokens[id] || 0) + 1);
        modal.classList.add("is-closing");
        const finish = () => {
            if (modalCloseTokens[id] !== token) return;
            modal.classList.remove("active", "is-closing");
        };
        modal.addEventListener("animationend", finish, { once: true });
        setTimeout(finish, 260);
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
        setFlowModalOpen("quickNoShkModal", false);
        setFlowModalOpen("noShkReviewModal", false);
        setFlowModalOpen("moduleChooser", false);
        setFlowModalOpen("uploadWork", false);
        setFlowModalOpen("masterWork", false);
        setFlowModalOpen("backfillCalendarModal", false);
        setFlowModalOpen("reviewSectionModal", false);
        setFlowModalOpen("taskDetailModal", false);
        setFlowModalOpen("flowTaskModal", false);
        setFlowModalOpen("flowSkipModal", false);
        setFlowModalOpen("flowConflictModal", false);
        setFlowModalOpen("flowSettingsModal", false);
        setFlowModalOpen("statusPilotModal", false);
        setFlowModalOpen("staffStatsModal", false);
        setFlowModalOpen("writeoffTermsModal", false);
        setFlowModalOpen("editTareTaskModal", false);
        setFlowModalOpen("deferTaskModal", false);
        setFlowModalOpen("reopenConfirmModal", false);
        setFlowModalOpen("splitShkConfirmModal", false);
        setFlowModalOpen("inactiveTasksModal", false);
        setFlowModalOpen("prespisokSecondLineModal", false);
        setFlowModalOpen("prespisokJournalModal", false);
        setFlowModalOpen("achievementDetailModal", false);
        setFlowModalOpen("achievementsModal", false);
        setFlowModalOpen("specialInfoModal", false);
        setFlowModalOpen("allTareShkModal", false);
        setFlowModalOpen("prespisokModal", false);
        if (state.prespisok && state.prespisok.clockTimer) {
            clearInterval(state.prespisok.clockTimer);
            state.prespisok.clockTimer = null;
        }
        if (state.prespisok && state.prespisok.syncTimer) {
            clearInterval(state.prespisok.syncTimer);
            state.prespisok.syncTimer = null;
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
        if (state.shift.loadPromise) return state.shift.loadPromise;
        const db = supabaseDb();
        if (!db) {
            renderShiftGate();
            return;
        }
        state.shift.loadPromise = (async () => {
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
                state.shift.loadPromise = null;
                renderShiftGate();
                if (state.view === "flow") renderFlowPage();
            }
        })();
        return state.shift.loadPromise;
    }

    function showHome() {
        state.view = "home";
        closeFlowModals();
        $("tasksHome").style.display = "grid";
        $("flowPage").classList.remove("active");
        $("uploadsPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("requestsPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
        renderPrespisokHomeCard();
        renderFlowAccessGate();
        void refreshPrespisokHomeState();
        void refreshPrespisokLeaderboard();
    }

    function formatMinutesCountdown(minutes) {
        const total = Math.max(Number(minutes) || 0, 0);
        if (!total) return "сейчас";
        const hours = Math.floor(total / 60);
        const mins = total % 60;
        return [
            hours ? hours + " ч" : "",
            mins ? mins + " мин" : "",
        ].filter(Boolean).join(" ") || "меньше минуты";
    }

    function prespisokLeaderboardScore(row) {
        const elapsed = Number(row && row.elapsed_ms) || 0;
        const shks = Number(row && (row.shk_count || row.actions || row.total)) || 0;
        if (!elapsed || !shks) return Number.POSITIVE_INFINITY;
        return elapsed / shks;
    }

    function formatPrespisokLeaderSpeed(row) {
        const score = prespisokLeaderboardScore(row);
        if (!Number.isFinite(score)) return "-";
        return formatDuration(score) + "/ШК";
    }

    function aggregatePrespisokLeaderboardFromRuns(runs) {
        const byUser = new Map();
        (runs || []).forEach((run) => {
            const employeeId = normalizeText(run.operator_id) || normalizeText(run.operator_name) || "unknown";
            const current = byUser.get(employeeId) || {
                name: normalizeText(run.operator_name) || "Неизвестный герой",
                employee_id: normalizeText(run.operator_id),
                runs: 0,
                shk_count: 0,
                elapsed_ms: 0,
            };
            current.runs += 1;
            current.shk_count += Number(run.completed_items) || Number(run.total_items) || 0;
            current.elapsed_ms += Number(run.elapsed_ms) || 0;
            byUser.set(employeeId, current);
        });
        return Array.from(byUser.values()).filter((row) => row.shk_count > 0 && row.elapsed_ms > 0);
    }

    function aggregatePrespisokLeaderboardFromActions(actions, runById) {
        const byUser = new Map();
        (actions || []).forEach((action) => {
            const payload = action && action.payload && typeof action.payload === "object" && !Array.isArray(action.payload) ? action.payload : {};
            const run = runById.get(normalizeText(action && action.run_id)) || {};
            const actor = payload.actor && typeof payload.actor === "object" ? payload.actor : {};
            const employeeId = normalizeText(action && action.operator_id) || normalizeText(actor.id) || normalizeText(run.operator_id) || normalizeText(action && action.operator_name) || normalizeText(actor.name) || normalizeText(run.operator_name) || "unknown";
            const name = normalizeText(action && action.operator_name) || normalizeText(actor.name) || normalizeText(run.operator_name) || "Неизвестный герой";
            const shkIds = Array.isArray(action && action.source_shk_ids) ? action.source_shk_ids.map(normalizeIdentifier).filter(Boolean) : [];
            const shkCount = shkIds.length || 1;
            const elapsed = Number(payload.item_elapsed_ms) || 0;
            if (!elapsed) return;
            const current = byUser.get(employeeId) || {
                name,
                employee_id: employeeId === "unknown" ? "" : employeeId,
                runs: new Set(),
                shk_count: 0,
                elapsed_ms: 0,
            };
            current.name = current.name || name;
            current.shk_count += shkCount;
            current.elapsed_ms += elapsed;
            if (action && action.run_id) current.runs.add(normalizeText(action.run_id));
            byUser.set(employeeId, current);
        });
        return Array.from(byUser.values()).map((row) => ({
            ...row,
            runs: row.runs && row.runs.size ? row.runs.size : 0,
        })).filter((row) => row.shk_count > 0 && row.elapsed_ms > 0);
    }

    function aggregatePrespisokLeaderboardRows(rows) {
        const byUser = new Map();
        const cutoff = addDays(state.today, -13);
        (rows || []).forEach((row) => {
            if (!row) return;
            const rowDate = normalizeText(row.date || row.run_date);
            if (rowDate && cutoff && rowDate < cutoff) return;
            const employeeId = normalizeText(row.employee_id || row.operator_id || row.name || row.operator_name) || "unknown";
            const count = Number(row.shk_count || row.actions || row.completed_items || row.total_items || row.total) || 0;
            const elapsed = Number(row.elapsed_ms) || 0;
            if (!count || !elapsed) return;
            const current = byUser.get(employeeId) || {
                name: normalizeText(row.name || row.operator_name) || "Неизвестный герой",
                employee_id: employeeId === "unknown" ? "" : employeeId,
                runs: 0,
                shk_count: 0,
                elapsed_ms: 0,
            };
            current.name = current.name || normalizeText(row.name || row.operator_name) || "Неизвестный герой";
            current.runs += Number(row.runs) || 1;
            current.shk_count += count;
            current.elapsed_ms += elapsed;
            byUser.set(employeeId, current);
        });
        return Array.from(byUser.values()).filter((row) => row.shk_count > 0 && row.elapsed_ms > 0);
    }

    function renderPrespisokHomeLeaderboard() {
        const card = $("prespisokLeaderboardCard");
        if (!card) return;
        const sourceRows = state.prespisokHome.leaderboard && state.prespisokHome.leaderboard.length
            ? state.prespisokHome.leaderboard
            : loadPrespisokLeaderboard();
        const rows = aggregatePrespisokLeaderboardRows(sourceRows)
            .sort((a, b) => prespisokLeaderboardScore(a) - prespisokLeaderboardScore(b))
            .slice(0, 3);
        const list = rows.length
            ? rows.map((row, index) => "<div class='prespisok-leader-row'><span><strong>" + (index + 1) + ". " + escapeHtml(row.name || "Без имени") + "</strong><br>" + escapeHtml((row.shk_count || row.actions || 0) + " ШК · " + (row.runs || 1) + " смен") + "</span><span>" + escapeHtml(formatPrespisokLeaderSpeed(row)) + "</span></div>").join("")
            : "<div class='prespisok-leader-row'><span>За 14 дней забегов нет.</span></div>";
        card.innerHTML = "<span class='tasks-action-icon'>♕</span>"
            + "<h2 class='tasks-action-title'>Лидеры</h2>"
            + "<p class='tasks-action-text'>Среднее время на 1 ШК за 14 дней.</p>"
            + "<div class='prespisok-leader-list'>" + list + "</div>";
    }

    async function refreshPrespisokLeaderboard() {
        const db = supabaseDb();
        if (!db) return;
        try {
            const { data, error } = await db
                .from(WMS_PRESPISOK_RUNS_TABLE)
                .select("id,run_date,total_items,completed_items,elapsed_ms,operator_id,operator_name,finished_at,updated_at,status")
                .eq("wh_id", WH_ID)
                .eq("status", "completed")
                .gte("run_date", addDays(state.today, -13))
                .order("finished_at", { ascending: false, nullsFirst: false })
                .limit(80);
            if (error) throw error;
            const runs = data || [];
            const runById = new Map(runs.map((run) => [normalizeText(run.id), run]));
            let leaderboard = [];
            if (runs.length) {
                const actionRows = [];
                for (const chunk of chunkArray(runs.map((run) => normalizeText(run.id)).filter(Boolean), 80)) {
                    const actions = await readOptionalRows(db, WMS_PRESPISOK_ACTIONS_TABLE, (query) => query
                        .select("run_id,source_shk_ids,operator_id,operator_name,payload")
                        .in("run_id", chunk));
                    if (actions.ok) actionRows.push(...actions.rows);
                }
                leaderboard = aggregatePrespisokLeaderboardFromActions(actionRows, runById);
            }
            state.prespisokHome.leaderboard = leaderboard.length ? leaderboard : aggregatePrespisokLeaderboardFromRuns(runs);
            renderPrespisokHomeLeaderboard();
        } catch (error) {
            console.warn("prespisok leaderboard failed:", error);
        }
    }

    function renderPrespisokHomeCard() {
        renderPrespisokHomeLeaderboard();
        const card = $("openPrespisok");
        if (!card) return;
        const text = card.querySelector(".tasks-action-text");
        const badge = $("prespisokCountdownBadge");
        const run = state.prespisokHome.run;
        const status = normalizeText(run && run.status);
        const info = prespisokWindowInfo();
        const completed = status === "completed" || Boolean(state.prespisok.finished);
        const active = status === "started" || status === "in_progress";
        const muted = state.prespisokHome.loading || completed || (!active && !info.inWindow);
        card.classList.toggle("is-muted", muted);
        if (badge) {
            badge.className = "tasks-home-timer";
            if (state.prespisokHome.loading) {
                badge.textContent = "Проверяю окно";
            } else if (completed) {
                badge.textContent = "Сегодня закрыт";
                badge.classList.add("is-closed");
            } else if (active || info.inWindow) {
                badge.textContent = active ? "В работе" : "Окно открыто";
                badge.classList.add("is-live");
            } else {
                badge.textContent = "До старта: " + info.waitDurationLabel;
                badge.classList.add("is-wait");
            }
        }
        if (!text) return;
        if (state.prespisokHome.loading) {
            text.textContent = "Проверяю сегодняшний запуск предсписка...";
        } else if (completed) {
            text.textContent = "Сегодня предсписок уже завершён. Детали смотри в журнале или во второй линии.";
        } else if (active) {
            text.textContent = "Предсписок уже в работе. Можно наблюдать прогресс или подключиться вторым номером.";
        } else if (!info.inWindow) {
            text.textContent = "До начала: " + info.waitDurationLabel + ". Окно " + info.windowLabel + ". Пока можно смотреть журнал и вторую линию.";
        } else {
            text.textContent = "Аркадная проверка ШК и тар перед списанием, с журналом и задачами второй линии.";
        }
    }

    function startPrespisokHomeTimer() {
        if (state.prespisokHome.timer) clearInterval(state.prespisokHome.timer);
        state.prespisokHome.timer = setInterval(renderPrespisokHomeCard, 30000);
    }

    async function refreshPrespisokHomeState() {
        state.prespisokHome.loading = true;
        renderPrespisokHomeCard();
        try {
            state.prespisokHome.run = await fetchTodayPrespisokRun();
        } finally {
            state.prespisokHome.loading = false;
            renderPrespisokHomeCard();
        }
    }

    async function showFlowPage() {
        if (!flowAccessAllowed()) {
            toast("Флоу пока доступен только пользователю 1034305.", "error");
            renderFlowAccessGate();
            if (state.view !== "home") showHome();
            return;
        }
        state.view = "flow";
        closeFlowModals();
        $("tasksHome").style.display = "none";
        $("uploadsPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("requestsPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
        $("flowPage").classList.add("active");
        state.flow.loading = true;
        state.flow.status = "Собираю активные задачи и считаю приоритеты...";
        state.flow.statusTone = "";
        renderFlowPage();
        try {
            await loadFlowSettings();
            if (!state.shift.current) await loadShiftState();
            await Promise.all([
                ensureReviewTasksLoaded(),
                loadFlowEmployeeStats(),
            ]);
            refreshFlowQueue();
            state.flow.status = state.shift.current
                ? "Очередь готова. WMS+ выберет следующую задачу по риску, зоне, срочности, загрузке и личной статистике."
                : "Смена не открыта. Флоу сможет выдавать задачи после открытия смены.";
            state.flow.statusTone = state.shift.current ? "good" : "error";
        } catch (error) {
            console.error("flow load failed:", error);
            state.flow.status = "Не удалось собрать Флоу: " + (error && error.message ? error.message : String(error));
            state.flow.statusTone = "error";
        } finally {
            state.flow.loading = false;
            renderFlowPage();
        }
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
        $("flowPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("requestsPage").classList.remove("active");
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
        $("flowPage").classList.remove("active");
        $("uploadsPage").classList.remove("active");
        $("requestsPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
        $("reviewPage").classList.add("active");
        renderReview();
        void loadReviewTasks();
    }

    function showRequestsPage() {
        state.view = "requests";
        closeFlowModals();
        $("tasksHome").style.display = "none";
        $("flowPage").classList.remove("active");
        $("uploadsPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
        $("requestsPage").classList.add("active");
        renderRequests();
        void loadReviewTasks();
    }

    function showInactivePage() {
        state.view = "inactive";
        closeFlowModals();
        $("tasksHome").style.display = "none";
        $("flowPage").classList.remove("active");
        $("uploadsPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("requestsPage").classList.remove("active");
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
            void evaluateShiftAchievements(incomingId, outgoingId);
        } catch (error) {
            console.error("shift opening save failed:", error);
            setShiftOpeningStatus("Не удалось открыть смену: " + (error && error.message ? error.message : String(error)), "error");
        } finally {
            state.shift.saving = false;
            updateShiftOpeningForm();
        }
    }

    async function loadReviewTasks() {
        if (state.review.loadPromise) return state.review.loadPromise;
        const db = supabaseDb();
        if (!db) {
            setReviewStatus("Supabase SDK не загрузился.", "error");
            return;
        }
        state.review.loadPromise = (async () => {
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
                state.review.loadPromise = null;
                renderReview();
                renderRequests();
                if (state.view === "flow") {
                    refreshFlowQueue();
                    renderFlowPage();
                }
                refreshOpenSectionModal();
            }
        })();
        return state.review.loadPromise;
    }

    async function ensureReviewTasksLoaded() {
        if (!state.review.loaded || state.review.loading || state.review.loadPromise) {
            await loadReviewTasks();
        }
    }

    async function fetchReviewTaskRows(db) {
        const rows = await fetchWmsTaskRows(db, "active");
        return rows.filter(isActiveReviewTask);
    }

    function refreshOpenSectionModal() {
        if (!$("reviewSectionModal") || !$("reviewSectionModal").classList.contains("active")) return;
        if (state.view === "requests") renderRequestsTable(requestsGroupedRows());
        else if (state.review.modalMode === "canvas") renderReviewCanvasTable();
        else renderReviewTable(reviewGroupedRows());
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
        (state.review.rows || []).filter((row) => isActiveReviewTask(row) && canSystemActualizeMovement(row)).forEach((row) => {
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
            setActualizeStatus("Проверяю движения и дубли с Движением после продажи...");
            const afterSaleIndex = await loadAfterSaleDedupeIndexForTasks(supabaseDb(), state.review.rows || []);
            state.actualize.rows = rows;
            state.actualize.stats = actualizeSupersetStats(rows);
            state.actualize.afterSaleDedupeIndex = afterSaleIndex;
            state.actualize.candidates = buildMovementCandidates(rows, afterSaleIndex);
            state.actualize.removedShks = new Set();
            state.actualize.tareActions = {};
            renderActualizeResults();
            void enrichTaskNomenclatureFromSuperset(rows).catch((error) => console.warn("superset nomenclature enrich skipped:", error));
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

    function mergeSupersetRowDetails(primary, fallback) {
        if (!primary) return fallback || null;
        if (!fallback) return primary;
        const merged = { ...primary };
        [
            "brand",
            "name",
            "article",
            "size",
            "nm",
            "supplier",
            "currency",
            "price_source",
            "srid",
            "last_office",
            "last_mx",
            "place",
            "last_tare",
            "previous_tare",
            "last_status",
            "last_status_at",
            "last_status_iso",
        ].forEach((key) => {
            if (!normalizeText(merged[key]) && normalizeText(fallback[key])) merged[key] = fallback[key];
        });
        if (!(Number(merged.price) > 0) && Number(fallback.price) > 0) merged.price = fallback.price;
        if (!(Number(merged.last_status_ts) > 0) && Number(fallback.last_status_ts) > 0) merged.last_status_ts = fallback.last_status_ts;
        return merged;
    }

    function latestSupersetByShk(rows) {
        const map = new Map();
        (rows || []).forEach((row) => {
            const previous = map.get(row.shk);
            if (!previous) {
                map.set(row.shk, row);
                return;
            }
            const rowTs = Number(row.last_status_ts) || 0;
            const previousTs = Number(previous.last_status_ts) || 0;
            const latest = rowTs >= previousTs ? row : previous;
            const fallback = latest === row ? previous : row;
            map.set(row.shk, mergeSupersetRowDetails(latest, fallback));
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

    function buildMovementCandidates(supersetRows, afterSaleIndex) {
        const byShk = latestSupersetByShk(supersetRows);
        const candidates = [];
        (state.review.rows || []).filter((row) => isActiveReviewTask(row) && canSystemActualizeMovement(row)).forEach((row) => {
            const items = taskItems(row);
            const byItem = new Map();
            items.forEach((item) => {
                const shk = normalizeIdentifier(item.shk);
                const superset = byShk.get(shk) || null;
                if (hasConfirmedMovement(row, item, superset)) byItem.set(shk, { row, item, superset, reason: "superset_movement" });
            });
            if (afterSaleIndex && afterSaleIndex.size) {
                items.forEach((item) => {
                    const shk = normalizeIdentifier(item.shk);
                    if (!shk || byItem.has(shk)) return;
                    const match = afterSaleDedupeMatch(row, item, afterSaleIndex);
                    if (match) byItem.set(shk, { row, item, superset: null, reason: "after_sale_duplicate", afterSaleTask: match.task, afterSaleDate: match.date });
                });
            }
            const moved = Array.from(byItem.values());
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

    function taskNmByShk(row) {
        const payload = taskPayload(row);
        const map = payload.nm_by_shk;
        return map && typeof map === "object" && !Array.isArray(map) ? map : {};
    }

    function taskNameByShk(row) {
        const payload = taskPayload(row);
        const map = payload.name_by_shk;
        return map && typeof map === "object" && !Array.isArray(map) ? map : {};
    }

    function itemNomenclature(row, item) {
        const shk = normalizeIdentifier(item && item.shk);
        const raw = item && item.raw && typeof item.raw === "object" ? item.raw : {};
        const nm = normalizeIdentifier(item && item.nm)
            || normalizeIdentifier(raw.nm || raw.nm_id || raw.nmId || raw.nmID)
            || normalizeIdentifier(taskNmByShk(row)[shk]);
        const name = normalizeText(item && item.name)
            || normalizeText(raw.name)
            || normalizeText(taskNameByShk(row)[shk]);
        return { nm, name };
    }

    function applySupersetNomenclatureToItem(row, item, supersetRow, options) {
        if (!item || !supersetRow || !supersetRow.nm) return { item, changed: false };
        if (!(options && options.allowMovementRows) && hasConfirmedMovement(row, item, supersetRow)) return { item, changed: false };
        const current = itemNomenclature(row, item);
        const nm = normalizeIdentifier(supersetRow.nm);
        const name = normalizeText(current.name || supersetRow.name);
        const changed = current.nm !== nm || (!current.name && name);
        if (!changed) return { item, changed: false };
        const raw = item.raw && typeof item.raw === "object" ? { ...item.raw } : {};
        raw.nm = nm;
        if (name && !raw.name) raw.name = name;
        return {
            changed: true,
            item: {
                ...item,
                nm,
                name,
                raw,
            },
        };
    }

    async function enrichTaskNomenclatureFromSuperset(supersetRows, options) {
        const db = supabaseDb();
        const byShk = latestSupersetByShk(supersetRows);
        if (!db || !byShk.size) return { updated: 0, missing: 0 };
        const tasks = (state.review.rows || []).filter(isActiveReviewTask);
        let updated = 0;
        let missing = 0;
        const plans = [];
        tasks.forEach((row) => {
            const payload = taskPayload(row);
            const nmByShk = { ...taskNmByShk(row) };
            const nameByShk = { ...taskNameByShk(row) };
            let changed = false;
            const items = taskItems(row).map((item) => {
                const shk = normalizeIdentifier(item.shk);
                const supersetRow = byShk.get(shk);
                if (!supersetRow) {
                    if (!itemNomenclature(row, item).nm) missing += 1;
                    return item;
                }
                const applied = applySupersetNomenclatureToItem(row, item, supersetRow, options);
                const nextItem = applied.item;
                if (applied.changed) changed = true;
                const info = itemNomenclature(row, nextItem);
                if (info.nm) nmByShk[shk] = info.nm;
                if (info.name) nameByShk[shk] = info.name;
                if (!info.nm) missing += 1;
                return nextItem;
            });
            if (!changed) return;
            plans.push({ row, items, nmByShk, nameByShk, payload });
        });
        const statusTarget = options && options.statusTarget ? $(options.statusTarget) : null;
        await runLimitedPool(plans, 4, async (plan) => {
            const now = new Date().toISOString();
            const nextPayload = payloadWithItems(plan.row, plan.items, {
                nm_by_shk: plan.nmByShk,
                name_by_shk: plan.nameByShk,
                superset_nomenclature_updated_at: now,
            });
            const searchText = [
                plan.row.title,
                plan.row.task_type,
                plan.row.source_tare_id,
                ...plan.items.map((item) => item.shk),
                ...plan.items.map((item) => item.name),
                ...plan.items.map((item) => item.nm),
            ].filter(Boolean).join(" ");
            const { data, error } = await db
                .from(WMS_TASKS_TABLE)
                .update({ source_payload: nextPayload, search_text: searchText, updated_at: now })
                .eq("id", plan.row.id)
                .select("id,source_payload,updated_at")
                .single();
            if (error) throw error;
            refreshTaskRow(plan.row.id, data || { source_payload: nextPayload, updated_at: now });
            updated += 1;
            if (statusTarget) statusTarget.textContent = "Дополняю НМ: обновлено задач " + updated + "/" + plans.length + ".";
        });
        return { updated, missing };
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
        const dedupeCount = (candidates || []).reduce((sum, candidate) => sum + (candidate.moved || []).filter((entry) => entry.reason === "after_sale_duplicate").length, 0);
        const movementCount = Math.max(movedCount - dedupeCount, 0);
        const partialCount = (candidates || []).filter((candidate) => candidate.type === "tare_partial").length;
        return "<div class='actualize-summary'>"
            + "<div><strong>" + escapeHtml(String(stats.rows)) + "</strong><span>строк проверено</span></div>"
            + "<div><strong>" + escapeHtml(String(stats.matched_active)) + "</strong><span>активных ШК найдено</span></div>"
            + "<div><strong>" + escapeHtml(String(movementCount)) + "</strong><span>ШК с движением +10 мин</span></div>"
            + "<div><strong>" + escapeHtml(String(dedupeCount)) + "</strong><span>дублей ORS</span></div>"
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
        const isAfterSaleDuplicate = entry.reason === "after_sale_duplicate";
        const changes = isAfterSaleDuplicate ? [] : movementChangeList(entry.row, entry.item, entry.superset);
        const changeHtml = changes.length
            ? changes.map((change) => "<div class='movement-change'><span>" + escapeHtml(change.label) + "</span><strong>" + escapeHtml(change.before) + " → " + escapeHtml(change.after) + "</strong></div>").join("")
            : isAfterSaleDuplicate
                ? "<div class='movement-change'><span>Схлопывание</span><strong>Уже есть задача “Движение после продажи” за " + escapeHtml(formatRuDate(entry.afterSaleDate)) + "</strong></div>"
            : "<div class='movement-change'><span>Изменение</span><strong>Не определено</strong></div>";
        const meta = isAfterSaleDuplicate
            ? "ORS-задача: " + (entry.afterSaleTask && entry.afterSaleTask.title ? entry.afterSaleTask.title : "-")
            : "МХ по Superset: " + ((entry.superset && entry.superset.last_mx) || "-");
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
            target.innerHTML = actualizeSummaryHtml(candidates) + "<div class='empty-state'>Активных задач с движением минимум на 10 минут позже исходных данных или дублем с “Движением после продажи” не найдено. " + escapeHtml(statsLine) + "</div>";
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
        target.innerHTML = "<div class='status-line good'>Проверьте движения: в список попали ШК, где время Superset минимум на 10 минут позже исходного времени задачи, и ШК, которые уже есть в “Движении после продажи” за ту же дату.</div>"
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

    function movementPlanNote(prefix, entries) {
        const selected = entries || [];
        const shks = selected.map((entry) => normalizeIdentifier(entry.item && entry.item.shk)).filter(Boolean);
        const afterSale = selected.filter((entry) => entry.reason === "after_sale_duplicate");
        const superset = selected.length - afterSale.length;
        const parts = [];
        if (superset) parts.push(prefix + ": " + shks.join(", "));
        if (afterSale.length) {
            parts.push("Схлопнуто с задачей Движение после продажи: " + afterSale.map((entry) => normalizeIdentifier(entry.item && entry.item.shk)).filter(Boolean).join(", "));
        }
        return parts.join(". ") || prefix + ": " + shks.join(", ");
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
        void writeTaskHistory({ ...row, ...payload, ...(data || {}) }, "task_system_closed", {
            title: displayTaskTitle(row),
            verdict: SYSTEM_MOVEMENT_VERDICT,
            comment: note || "Подтверждено движение по Superset",
        });
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
                    closePlans.push({ row, note: movementPlanNote("Подтверждено движение ШК", selected) });
                    continue;
                }
                const selectedShks = new Set(selected.map((entry) => normalizeIdentifier(entry.item.shk)));
                const allItems = taskItems(row);
                const rest = allItems.filter((item) => !selectedShks.has(normalizeIdentifier(item.shk)));
                const action = candidate.type === "tare_partial" ? (state.actualize.tareActions[row.id] || "exclude") : (rest.length ? "exclude" : "close");
                if (action === "close" || !rest.length) {
                    closePlans.push({ row, note: movementPlanNote("Подтверждено движение по таре", selected) });
                } else if (action === "split_remaining") {
                    splitTasks.push(...rest.map((item) => ({
                        ...splitTaskFromTare(row, item),
                        assignee_employee_id: row.assignee_employee_id || "",
                        assignee_name: row.assignee_name || "",
                    })));
                    closePlans.push({ row, note: movementPlanNote("По части тары подтверждено движение. Остаток вынесен в отдельные задачи", selected) });
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
            refreshOpenSectionModal();
        } catch (error) {
            console.error("actualize close movement failed:", error);
            setActualizeStatus("Не удалось закрыть задачи: " + (error && error.message ? error.message : String(error)), "error");
        } finally {
            state.actualize.processing = false;
            if (button) button.disabled = false;
        }
    }

    function resetQuickNoShkState(keepPhotos) {
        if (state.quickNoShk && state.quickNoShk.clockTimer) clearInterval(state.quickNoShk.clockTimer);
        const cachedSupersetRows = loadQuickNoShkSupersetCache();
        state.quickNoShk = {
            loading: false,
            items: [],
            index: 0,
            actions: [],
            started: false,
            processing: false,
            photoCache: keepPhotos && state.quickNoShk ? (state.quickNoShk.photoCache || {}) : {},
            pureCandidates: [],
            supersetRows: cachedSupersetRows,
            supersetByShk: latestSupersetByShk(cachedSupersetRows),
            missingNm: 0,
            needsSuperset: false,
            fileName: "",
            lastSupersetMessage: "",
            lastSupersetTone: "",
            timerStartedAt: 0,
            itemTimerStartedAt: 0,
            clockTimer: null,
            preloading: false,
            achievementsChecked: false,
            loadToken: "",
            streak: 0,
            bestStreak: 0,
            lastActionKey: "",
            setupPhase: "copy",
        };
    }

    function compactSupersetRowsForQuickNoShk(rows) {
        return (rows || []).map((row) => ({
            row_number: row.row_number || null,
            shk: normalizeIdentifier(row.shk),
            nm: normalizeIdentifier(row.nm),
            name: normalizeText(row.name),
            last_office: normalizeIdentifier(row.last_office),
            last_status: normalizeText(row.last_status),
            last_status_at: normalizeText(row.last_status_at),
            last_status_ts: Number(row.last_status_ts) || 0,
            price: Number(row.price) || 0,
        })).filter((row) => row.shk);
    }

    function loadQuickNoShkSupersetCache() {
        try {
            const parsed = parseJsonSafe(localStorage.getItem(QUICK_NO_SHK_SUPERSET_CACHE_KEY), null);
            if (!parsed || !Array.isArray(parsed.rows)) return [];
            if (Date.now() - (Number(parsed.saved_at) || 0) > QUICK_NO_SHK_SUPERSET_CACHE_TTL_MS) {
                localStorage.removeItem(QUICK_NO_SHK_SUPERSET_CACHE_KEY);
                return [];
            }
            return compactSupersetRowsForQuickNoShk(parsed.rows);
        } catch (_error) {
            return [];
        }
    }

    function saveQuickNoShkSupersetCache(rows) {
        try {
            localStorage.setItem(QUICK_NO_SHK_SUPERSET_CACHE_KEY, JSON.stringify({
                saved_at: Date.now(),
                rows: compactSupersetRowsForQuickNoShk(rows),
            }));
        } catch (error) {
            console.warn("quick no shk superset cache skipped:", error);
        }
    }

    function mergeQuickNoShkSupersetRows(existingRows, nextRows) {
        return Array.from(latestSupersetByShk([...(existingRows || []), ...(nextRows || [])]).values());
    }

    // Superset uploads used to live only in this browser's localStorage, so
    // starting the check from a different computer meant re-uploading a file
    // someone else had already fed the app minutes earlier. Pushing/pulling
    // through wms_superset_cache lets any device pick up the latest known
    // data for whatever SHKs it actually needs.
    async function pushSupersetRowsToSupabase(rows) {
        const db = supabaseDb();
        const compact = compactSupersetRowsForQuickNoShk(rows);
        if (!db || !compact.length) return;
        const now = new Date().toISOString();
        const payloads = compact.map((row) => ({
            wh_id: WH_ID,
            shk: row.shk,
            nm: row.nm || null,
            name: row.name || null,
            last_office: row.last_office || null,
            last_status: row.last_status || null,
            last_status_at: row.last_status_at || null,
            last_status_ts: row.last_status_ts || null,
            price: row.price || null,
            updated_at: now,
        }));
        for (const chunk of chunkArray(payloads, SUPERSET_CACHE_CHUNK_SIZE)) {
            try {
                const { error } = await db.from(SUPERSET_CACHE_TABLE).upsert(chunk, { onConflict: "wh_id,shk" });
                if (error) throw error;
            } catch (error) {
                console.warn("superset cache push skipped:", error);
                return;
            }
        }
    }

    async function fetchSupersetRowsFromSupabase(shks) {
        const db = supabaseDb();
        const ids = Array.from(new Set((shks || []).map(normalizeIdentifier).filter(Boolean)));
        if (!db || !ids.length) return [];
        const rows = [];
        for (const chunk of chunkArray(ids, 200)) {
            try {
                const { data, error } = await db
                    .from(SUPERSET_CACHE_TABLE)
                    .select("shk,nm,name,last_office,last_status,last_status_at,last_status_ts,price")
                    .eq("wh_id", WH_ID)
                    .in("shk", chunk);
                if (error) throw error;
                rows.push(...(data || []));
            } catch (error) {
                console.warn("superset cache fetch skipped:", error);
            }
        }
        return rows;
    }

    // Pulls whatever the warehouse already knows (from any device) about the
    // SHKs this session still needs, before falling back to asking the
    // current user to upload a Superset file themselves.
    async function hydrateQuickNoShkSupersetFromSupabase() {
        const needed = quickNoShkSupersetNeedStats().all;
        if (!needed.length) return;
        const remoteRows = await fetchSupersetRowsFromSupabase(needed);
        if (!remoteRows.length) return;
        const mergedRows = mergeQuickNoShkSupersetRows(state.quickNoShk.supersetRows || [], remoteRows);
        state.quickNoShk.supersetRows = mergedRows;
        state.quickNoShk.supersetByShk = latestSupersetByShk(mergedRows);
        saveQuickNoShkSupersetCache(mergedRows);
        await enrichTaskNomenclatureFromSuperset(mergedRows, { allowMovementRows: true });
        buildQuickNoShkItems();
    }

    function isQuickNoShkPureCandidate(row) {
        if (!row) return false;
        const status = statusCode(row.shk_state_before_lost || row.shk_state);
        if (status !== "SAS" && status !== "SMC" && status !== "EPR") return false;
        const comment = pureResolutionValue(row, ["opp_comment", "comment"]);
        if (normalizeForMatch(comment).includes(normalizeForMatch(QUICK_NO_SHK_PURE_NOT_FOUND_MARKER))) return false;
        return !pureResolutionValue(row, ["opp_deecision", "opp_decision", "decision"]);
    }

    async function fetchQuickNoShkPureCandidates() {
        const db = supabaseDb();
        if (!db) return [];
        const rows = [];
        const pageSize = 1000;
        for (let from = 0; from < 10000; from += pageSize) {
            const { data, error } = await db
                .from(PURE_LOSSES_TABLE)
                .select("id,shk,nm,decription,date_lost,price,wh_id,opp_decision,opp_comment,shk_state_before_lost")
                .eq("wh_id", WH_ID)
                .or("shk_state_before_lost.ilike.SAS%,shk_state_before_lost.ilike.SMC%,shk_state_before_lost.ilike.EPR%")
                .range(from, from + pageSize - 1);
            if (error) {
                console.warn("quick no shk pure candidates skipped:", error);
                return rows;
            }
            const batch = Array.isArray(data) ? data : [];
            rows.push(...batch.filter(isQuickNoShkPureCandidate));
            if (batch.length < pageSize) break;
        }
        const seen = new Set();
        return rows.filter((row) => {
            const shk = normalizeIdentifier(row && row.shk);
            const dateLost = parseDateTime(row && row.date_lost).date || normalizeText(row && row.date_lost);
            const key = [shk, dateLost, normalizeIdentifier(row && row.wh_id)].join("|");
            if (!shk || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function isQuickNoShkEligibleTask(row) {
        if (!row || !isActiveReviewTask(row) || requestSectionName(row) || isPrespisokTask(row)) return false;
        if (taskSectionName(row) !== "Предсортировка") return false;
        return true;
    }

    function quickNoShkSupersetRow(shk) {
        const key = normalizeIdentifier(shk);
        return key && state.quickNoShk.supersetByShk instanceof Map ? state.quickNoShk.supersetByShk.get(key) : null;
    }

    function quickNoShkPureItem(row, supersetRow) {
        const shk = normalizeIdentifier(row && row.shk);
        if (!shk) return null;
        const idTarget = pureRowIdTarget(row);
        const dateLost = parseDateTime(row && row.date_lost).date || normalizeText(row && row.date_lost);
        const nomenclature = {
            nm: normalizeIdentifier(row && row.nm) || normalizeIdentifier(supersetRow && supersetRow.nm),
            name: normalizeText(row && (row.decription || row.description)) || normalizeText(supersetRow && supersetRow.name) || "Наименование не найдено",
        };
        return {
            kind: "pure",
            key: "pure:" + (idTarget ? idTarget.column + ":" + idTarget.value : [shk, dateLost, normalizeIdentifier(row && row.wh_id)].join("|")),
            row_id: "",
            pure_row: row,
            pure_id_target: idTarget,
            shk,
            nm: nomenclature.nm,
            name: nomenclature.name,
            status: normalizeText(row && (row.shk_state_before_lost || row.shk_state)) || statusCode(row && row.shk_state_before_lost),
            movement: normalizeText(supersetRow && supersetRow.last_status_at) || normalizeText(row && row.date_lost),
            price: Number(row && row.price) || Number(supersetRow && supersetRow.price) || 0,
            task_title: "Чистые списания",
            last_office: normalizeIdentifier(supersetRow && supersetRow.last_office),
        };
    }

    function hasQuickNoShkKeptActiveCheck(row, shk) {
        const target = normalizeIdentifier(shk);
        const payload = taskPayload(row);
        const checks = [];
        if (payload.no_shk_review && typeof payload.no_shk_review === "object" && !Array.isArray(payload.no_shk_review)) checks.push(payload.no_shk_review);
        if (Array.isArray(payload.no_shk_review_history)) checks.push(...payload.no_shk_review_history);
        return checks.some((check) => normalizeIdentifier(check && check.shk) === target
            && normalizeText(check && check.result) === SYSTEM_NO_SHK_NOT_FOUND_VERDICT
            && Boolean(check && check.kept_active));
    }

    function buildQuickNoShkItems() {
        const items = [];
        (state.review.rows || []).filter(isQuickNoShkEligibleTask).forEach((row) => {
            const taskItemsList = taskItems(row);
            taskItemsList.forEach((item) => {
                if (hasQuickNoShkKeptActiveCheck(row, item.shk)) return;
                const price = Number(item.price) || (taskItemsList.length === 1 ? reviewPrice(row) : 0);
                const nomenclature = itemNomenclature(row, item);
                items.push({
                    kind: "task",
                    key: row.id + ":" + item.shk,
                    row_id: row.id,
                    row_is_tare: isTareTask(row),
                    tare_id: normalizeIdentifier(row.source_tare_id),
                    shk: item.shk,
                    nm: nomenclature.nm,
                    name: nomenclature.name || taskItemName(row) || "Наименование не найдено",
                    status: item.status || "",
                    movement: item.movement || row.source_last_movement_at || "",
                    price,
                    task_title: displayTaskTitle(row),
                });
            });
        });
        const hasSuperset = state.quickNoShk.supersetByShk instanceof Map && state.quickNoShk.supersetByShk.size > 0;
        if (hasSuperset) {
            (state.quickNoShk.pureCandidates || []).forEach((row) => {
                const supersetRow = quickNoShkSupersetRow(row && row.shk);
                if (!supersetRow || normalizeIdentifier(supersetRow.last_office) === WH_ID) return;
                const item = quickNoShkPureItem(row, supersetRow);
                if (item) items.push(item);
            });
        }
        items.sort((a, b) => (a.nm ? 1 : 0) - (b.nm ? 1 : 0) || b.price - a.price || String(a.shk).localeCompare(String(b.shk), "ru", { numeric: true }));
        state.quickNoShk.items = items;
        state.quickNoShk.missingNm = items.filter((item) => !item.nm).length;
        state.quickNoShk.needsSuperset = state.quickNoShk.missingNm > 0 || ((state.quickNoShk.pureCandidates || []).length > 0 && !hasSuperset);
        if (state.quickNoShk.index >= items.length) state.quickNoShk.index = Math.max(items.length - 1, 0);
        return items;
    }

    function quickNoShkSupersetNeedStats() {
        const missingNm = new Set();
        (state.quickNoShk.items || []).forEach((item) => {
            if (!item.nm && item.shk) missingNm.add(item.shk);
        });
        const hasSuperset = state.quickNoShk.supersetByShk instanceof Map && state.quickNoShk.supersetByShk.size > 0;
        const pureOffice = new Set();
        if (!hasSuperset) {
            (state.quickNoShk.pureCandidates || []).forEach((row) => {
                const shk = normalizeIdentifier(row && row.shk);
                if (shk) pureOffice.add(shk);
            });
        }
        const all = new Set([...missingNm, ...pureOffice]);
        return {
            missingNm: Array.from(missingNm).sort((a, b) => a.localeCompare(b, "ru", { numeric: true })),
            pureOffice: Array.from(pureOffice).sort((a, b) => a.localeCompare(b, "ru", { numeric: true })),
            all: Array.from(all).sort((a, b) => a.localeCompare(b, "ru", { numeric: true })),
        };
    }

    function quickNoShkSupersetUploadMessage(beforeNeededIds, uploadedRows, afterNeedStats) {
        const before = Array.isArray(beforeNeededIds) ? beforeNeededIds : [];
        const uploadedByShk = latestSupersetByShk(uploadedRows || []);
        let matched = 0;
        let withNm = 0;
        let withoutNm = 0;
        before.forEach((shk) => {
            const row = uploadedByShk.get(normalizeIdentifier(shk));
            if (!row) return;
            matched += 1;
            if (normalizeIdentifier(row.nm)) withNm += 1;
            else withoutNm += 1;
        });
        const missed = Math.max(before.length - matched, 0);
        const left = afterNeedStats && Array.isArray(afterNeedStats.all) ? afterNeedStats.all.length : 0;
        const parts = [
            "Файл обработан: строк " + (uploadedRows || []).length,
            "из запрошенных ШК совпало " + matched,
            "Код НМ найден у " + withNm,
        ];
        if (withoutNm) parts.push("в файле без Код НМ: " + withoutNm);
        if (missed) parts.push("не найдено в файле: " + missed);
        parts.push(left ? "осталось дозагрузить: " + left : "можно начинать проверку");
        return parts.join(" · ") + ".";
    }

    function quickNoShkElapsedMs() {
        return state.quickNoShk && state.quickNoShk.timerStartedAt ? Date.now() - state.quickNoShk.timerStartedAt : 0;
    }

    function quickNoShkItemElapsedMs() {
        return state.quickNoShk && state.quickNoShk.itemTimerStartedAt ? Date.now() - state.quickNoShk.itemTimerStartedAt : 0;
    }

    function updateQuickNoShkTimers() {
        const total = $("quickNoShkTotalTimer");
        if (total) total.textContent = formatDuration(quickNoShkElapsedMs());
        const item = $("quickNoShkItemTimer");
        if (item) {
            const ms = quickNoShkItemElapsedMs();
            item.textContent = formatDuration(ms);
            const card = item.closest(".quick-no-shk-hud-tile");
            if (card) {
                card.classList.toggle("is-warm", ms >= QUICK_NO_SHK_TIMER_WARN_MS && ms < QUICK_NO_SHK_TIMER_HOT_MS);
                card.classList.toggle("is-hot", ms >= QUICK_NO_SHK_TIMER_HOT_MS);
            }
        }
    }

    function startQuickNoShkClock() {
        if (state.quickNoShk.clockTimer) clearInterval(state.quickNoShk.clockTimer);
        state.quickNoShk.clockTimer = setInterval(updateQuickNoShkTimers, 1000);
        updateQuickNoShkTimers();
    }

    function quickNoShkTopHtml(subtitle) {
        return "<div class='quick-no-shk-top'>"
            + "<div><p class='quick-no-shk-kicker'>ОПП // быстрый без ШК</p><h2 class='quick-no-shk-title'>Без ШК</h2><p class='quick-no-shk-subtitle'>" + escapeHtml(subtitle || "Фото, быстрый глазной контроль и безопасный системный вердикт.") + "</p></div>"
            + "<button id='closeQuickNoShk' class='btn btn-square prespisok-close' type='button' aria-label='Закрыть'>×</button>"
            + "</div>";
    }

    async function openQuickNoShkModal() {
        closeFlowModals();
        resetQuickNoShkState(true);
        const loadToken = Date.now() + ":" + Math.random().toString(16).slice(2);
        state.quickNoShk.loading = true;
        state.quickNoShk.loadToken = loadToken;
        setFlowModalOpen("quickNoShkModal", true);
        renderQuickNoShkLoading();
        try {
            const [, pureRows] = await Promise.all([
                ensureReviewTasksLoaded(),
                fetchQuickNoShkPureCandidates(),
            ]);
            if (state.quickNoShk.loadToken !== loadToken || !$("quickNoShkModal").classList.contains("active")) return;
            state.quickNoShk.pureCandidates = pureRows || [];
            buildQuickNoShkItems();
            await hydrateQuickNoShkSupersetFromSupabase();
            if (state.quickNoShk.loadToken !== loadToken || !$("quickNoShkModal").classList.contains("active")) return;
            state.quickNoShk.loading = false;
            renderQuickNoShk();
        } catch (error) {
            if (state.quickNoShk.loadToken !== loadToken) return;
            state.quickNoShk.loading = false;
            const target = $("quickNoShkWrap");
            if (target) {
                target.innerHTML = quickNoShkTopHtml("Не удалось собрать цели для быстрой проверки.")
                    + "<section class='quick-no-shk-panel'><div class='quick-no-shk-center'><div><div class='status-line error'>"
                    + escapeHtml(error && error.message ? error.message : String(error))
                    + "</div></div></div></section>";
                bindQuickNoShkClose();
            }
        }
    }

    function closeQuickNoShkModal() {
        if (state.quickNoShk && state.quickNoShk.clockTimer) {
            clearInterval(state.quickNoShk.clockTimer);
            state.quickNoShk.clockTimer = null;
        }
        setFlowModalOpen("quickNoShkModal", false);
    }

    function bindQuickNoShkClose() {
        const close = $("closeQuickNoShk");
        if (close) close.addEventListener("click", closeQuickNoShkModal);
    }

    function renderQuickNoShkLoading() {
        const target = $("quickNoShkWrap");
        if (!target) return;
        target.innerHTML = quickNoShkTopHtml("Собираю ШК предсортировки и подходящие чистые списания. Если всё пусто, значит сегодня хотя бы эта часть склада решила не устраивать цирк.")
            + "<section class='quick-no-shk-panel'><div class='quick-no-shk-center'><div class='prespisok-wait'>Ищу цели</div></div></section>";
        bindQuickNoShkClose();
    }

    function renderQuickNoShk() {
        const target = $("quickNoShkWrap");
        if (!target) return;
        if (state.quickNoShk.loading) {
            renderQuickNoShkLoading();
            return;
        }
        const items = state.quickNoShk.items || [];
        if (state.quickNoShk.needsSuperset) {
            renderQuickNoShkNeedsNm();
            return;
        }
        if (!items.length) {
            target.innerHTML = quickNoShkTopHtml("Режим доступен, когда есть активные ШК предсортировки или чистые списания SAS/SMC/EPR с последним офисом не " + WH_ID + ".")
                + "<section class='quick-no-shk-panel'><div class='quick-no-shk-center'><div><div class='prespisok-wait'>Целей нет</div><p class='quick-no-shk-subtitle'>Пока нечего проверять. Редкий случай, когда склад не подкинул мелкой пакости.</p></div></div></section>";
            bindQuickNoShkClose();
            return;
        }
        if (!state.quickNoShk.started) {
            target.innerHTML = quickNoShkTopHtml("Готово к быстрой проверке: " + items.length + " ШК. Фото берется по Код НМ, вердикт закрывает задачу системно.")
                + "<section class='quick-no-shk-panel'><div class='quick-no-shk-center'><div><button id='startQuickNoShk' class='quick-no-shk-start' type='button'>Начать</button><p class='quick-no-shk-subtitle'>Попаданий: " + items.length + ". НМ заполнены у всех целей.</p></div></div></section>";
            bindQuickNoShkClose();
            $("startQuickNoShk").addEventListener("click", () => {
                state.quickNoShk.started = true;
                state.quickNoShk.index = 0;
                state.quickNoShk.timerStartedAt = Date.now();
                state.quickNoShk.itemTimerStartedAt = Date.now();
                startQuickNoShkClock();
                renderQuickNoShkPlay();
            });
            return;
        }
        renderQuickNoShkPlay();
    }

    function quickNoShkSupersetNeededShks() {
        return quickNoShkSupersetNeedStats().all;
    }

    async function copyQuickNoShkSupersetShks() {
        const ids = quickNoShkSupersetNeededShks();
        if (!ids.length) {
            state.quickNoShk.lastSupersetMessage = "Копировать нечего: нужные ШК уже дополнены.";
            state.quickNoShk.lastSupersetTone = "good";
            renderQuickNoShkNeedsNm();
            return;
        }
        const copied = await copyText(ids.join("\n"));
        state.quickNoShk.lastSupersetMessage = copied
            ? "Скопировано ШК: " + ids.length + "."
            : "Браузер заблокировал копирование. Можно выделить ШК вручную, но браузер, конечно, выбрал драму.";
        state.quickNoShk.lastSupersetTone = copied ? "good" : "error";
        if (copied) state.quickNoShk.setupPhase = "upload";
        toast(copied ? "Скопировано ШК: " + ids.length : "Браузер заблокировал копирование.", copied ? "success" : "error");
        renderQuickNoShkNeedsNm();
    }

    function renderQuickNoShkNeedsNm() {
        const target = $("quickNoShkWrap");
        if (!target) return;
        const needStats = quickNoShkSupersetNeedStats();
        const copyCount = needStats.all.length;
        const phase = copyCount ? (state.quickNoShk.setupPhase || "copy") : "upload";
        const step = phase === "copy" ? 1 : 2;
        const steps = "<div class='quick-no-shk-steps'>"
            + "<span class='" + (step >= 1 ? "is-done" : "") + (step === 1 ? " is-current" : "") + "'>1</span>"
            + "<i></i>"
            + "<span class='" + (step >= 2 ? "is-done" : "") + (step === 2 ? " is-current" : "") + "'>2</span>"
            + "</div>";
        const statusLine = state.quickNoShk.lastSupersetMessage
            ? "<p class='quick-no-shk-quest-status " + escapeHtml(state.quickNoShk.lastSupersetTone || "") + "'>" + escapeHtml(state.quickNoShk.lastSupersetMessage) + "</p>"
            : "";
        let body;
        if (phase === "copy") {
            body = "<div class='quick-no-shk-quest-icon'>📋</div>"
                + "<h2 class='quick-no-shk-quest-title'>Шаг 1 · Скопируй ШК</h2>"
                + "<p class='quick-no-shk-quest-text'>" + copyCount + " ШК ждут выгрузки из Superset.</p>"
                + "<button id='copyQuickNoShkShks' class='quick-no-shk-start' type='button'>📋 Скопировать (" + copyCount + ")</button>"
                + "<button id='skipToUploadPhase' class='quick-no-shk-ghost-btn' type='button'>Уже скопировано → загрузить файл</button>"
                + statusLine;
        } else {
            body = "<div class='quick-no-shk-quest-icon'>📤</div>"
                + "<h2 class='quick-no-shk-quest-title'>Шаг 2 · Загрузи файл</h2>"
                + "<p class='quick-no-shk-quest-text'>Выгрузку из Superset — сюда. Дополню НМ и вернусь к старту.</p>"
                + "<label class='quick-no-shk-start' for='quickNoShkSupersetFile'>📤 Выбрать файл</label>"
                + "<input id='quickNoShkSupersetFile' class='file-input' type='file' accept='.xlsx,.xls,.csv'>"
                + "<span id='quickNoShkFileName' class='quick-no-shk-quest-hint'>Файл пока не выбран</span>"
                + (copyCount ? "<button id='backToCopyPhase' class='quick-no-shk-ghost-btn' type='button'>← К списку ШК</button>" : "")
                + "<div id='quickNoShkStatus'>" + statusLine + "</div>";
        }
        target.innerHTML = quickNoShkTopHtml("Быстрая настройка перед проверкой.")
            + "<section class='quick-no-shk-panel'><div class='quick-no-shk-quest'>" + steps + body + "</div></section>";
        bindQuickNoShkClose();
        if (phase === "copy") {
            $("copyQuickNoShkShks").addEventListener("click", () => { void copyQuickNoShkSupersetShks(); });
            $("skipToUploadPhase").addEventListener("click", () => {
                state.quickNoShk.setupPhase = "upload";
                renderQuickNoShkNeedsNm();
            });
        } else {
            $("quickNoShkSupersetFile").addEventListener("change", () => {
                const file = $("quickNoShkSupersetFile").files && $("quickNoShkSupersetFile").files[0];
                if (file) void handleQuickNoShkSupersetFile(file);
            });
            const back = $("backToCopyPhase");
            if (back) back.addEventListener("click", () => {
                state.quickNoShk.setupPhase = "copy";
                renderQuickNoShkNeedsNm();
            });
        }
    }

    async function handleQuickNoShkSupersetFile(file) {
        if (!file) return;
        state.quickNoShk.fileName = file.name || "";
        if ($("quickNoShkFileName")) $("quickNoShkFileName").textContent = "Файл выбран: " + state.quickNoShk.fileName;
        const status = $("quickNoShkStatus");
        if (status) status.textContent = "Читаю Superset и достаю Код НМ...";
        try {
            const beforeNeedStats = quickNoShkSupersetNeedStats();
            const beforeNeededIds = beforeNeedStats.all || [];
            const rows = await readSupersetRows(file);
            const mergedRows = mergeQuickNoShkSupersetRows(state.quickNoShk.supersetRows || [], rows);
            state.quickNoShk.supersetRows = mergedRows;
            state.quickNoShk.supersetByShk = latestSupersetByShk(mergedRows);
            saveQuickNoShkSupersetCache(mergedRows);
            void pushSupersetRowsToSupabase(rows);
            await enrichTaskNomenclatureFromSuperset(mergedRows, { statusTarget: "quickNoShkStatus", allowMovementRows: true });
            state.actualize.rows = mergedRows;
            state.actualize.stats = actualizeSupersetStats(mergedRows);
            state.actualize.candidates = buildMovementCandidates(mergedRows);
            buildQuickNoShkItems();
            const afterNeedStats = quickNoShkSupersetNeedStats();
            state.quickNoShk.lastSupersetMessage = quickNoShkSupersetUploadMessage(beforeNeededIds, rows, afterNeedStats);
            state.quickNoShk.lastSupersetTone = afterNeedStats.all.length ? "error" : "good";
            // Still missing some -- send the user back to copy the remaining
            // ids instead of leaving them stuck on a stale upload step.
            state.quickNoShk.setupPhase = afterNeedStats.all.length ? "copy" : "upload";
            if (status) {
                status.className = "status-line " + state.quickNoShk.lastSupersetTone;
                status.textContent = state.quickNoShk.lastSupersetMessage;
            }
            renderQuickNoShk();
        } catch (error) {
            console.error("quick no shk superset failed:", error);
            state.quickNoShk.lastSupersetMessage = "Не удалось обработать файл: " + (error && error.message ? error.message : String(error));
            state.quickNoShk.lastSupersetTone = "error";
            if (status) {
                status.className = "status-line error";
                status.textContent = state.quickNoShk.lastSupersetMessage;
            }
        } finally {
            const input = $("quickNoShkSupersetFile");
            if (input) input.value = "";
        }
    }

    function currentQuickNoShkItem() {
        const done = new Set((state.quickNoShk.actions || []).map((action) => action.key));
        let index = Math.max(Number(state.quickNoShk.index) || 0, 0);
        while (index < (state.quickNoShk.items || []).length && done.has(state.quickNoShk.items[index].key)) index += 1;
        state.quickNoShk.index = index;
        return (state.quickNoShk.items || [])[index] || null;
    }

    function quickNoShkPhotoHtml(item) {
        const cacheKey = normalizeIdentifier(item && item.nm);
        const hasCache = cacheKey && Object.prototype.hasOwnProperty.call(state.quickNoShk.photoCache, cacheKey);
        const imageUrl = hasCache ? state.quickNoShk.photoCache[cacheKey] : "";
        if (imageUrl) return "<img id='quickNoShkPhoto' class='quick-no-shk-photo' src='" + escapeHtml(imageUrl) + "' alt='Фото товара'>";
        if (hasCache) return "<div id='quickNoShkPhotoEmpty' class='quick-no-shk-photo-empty'>Фото по НМ " + escapeHtml(cacheKey || "-") + " не найдено.<br>Проверяем руками, как в доисторические времена.</div>";
        return "<div id='quickNoShkPhotoEmpty' class='quick-no-shk-photo-empty'>Ищу фото по НМ " + escapeHtml(cacheKey || "-") + "...</div>";
    }

    async function loadQuickNoShkPhoto(item) {
        const nm = normalizeIdentifier(item && item.nm);
        if (!nm || Object.prototype.hasOwnProperty.call(state.quickNoShk.photoCache, nm)) return;
        const urls = buildWbImageCandidatesByNm(nm, { maxPics: 1, maxHosts: 30 });
        const found = await findFirstLoadableImage(urls);
        state.quickNoShk.photoCache[nm] = found || "";
        const current = currentQuickNoShkItem();
        if (current && current.key === item.key && $("quickNoShkModal") && $("quickNoShkModal").classList.contains("active")) renderQuickNoShkPlay();
    }

    async function preloadQuickNoShkPhotos() {
        if (state.quickNoShk.preloading) return;
        state.quickNoShk.preloading = true;
        try {
            const done = new Set((state.quickNoShk.actions || []).map((action) => action.key));
            const start = Math.max(Number(state.quickNoShk.index) || 0, 0) + 1;
            const next = [];
            for (let i = start; i < (state.quickNoShk.items || []).length && next.length < QUICK_NO_SHK_PRELOAD_AHEAD; i += 1) {
                const item = state.quickNoShk.items[i];
                const nm = normalizeIdentifier(item && item.nm);
                if (!item || done.has(item.key) || !nm || Object.prototype.hasOwnProperty.call(state.quickNoShk.photoCache, nm)) continue;
                next.push(item);
            }
            await Promise.all(next.map((item) => loadQuickNoShkPhoto(item)));
        } finally {
            state.quickNoShk.preloading = false;
        }
    }

    function renderQuickNoShkPlay() {
        const target = $("quickNoShkWrap");
        if (!target) return;
        const item = currentQuickNoShkItem();
        if (!item) {
            renderQuickNoShkFinish();
            return;
        }
        const progress = (state.quickNoShk.actions || []).length;
        const total = (state.quickNoShk.items || []).length;
        const pct = total ? Math.min(100, Math.round((progress / total) * 100)) : 0;
        const streak = Number(state.quickNoShk.streak) || 0;
        const streakBadge = streak >= 2
            ? "<div class='quick-no-shk-streak'>🔥 Комбо ×" + streak + "</div>"
            : "";
        target.innerHTML = quickNoShkTopHtml("Быстрый режим: " + progress + "/" + total + ". Смотри фото, сверяй глазами, жми без философского романа.")
            + "<section class='quick-no-shk-panel'>"
            + "<div class='quick-no-shk-progress'><div class='quick-no-shk-progress-fill' style='width:" + pct + "%'></div></div>"
            + "<div class='quick-no-shk-hud'>"
            + "<div class='quick-no-shk-hud-tile'><span>Общее время</span><strong id='quickNoShkTotalTimer'>" + escapeHtml(formatDuration(quickNoShkElapsedMs())) + "</strong></div>"
            + "<div class='quick-no-shk-hud-tile'><span>Текущая цель</span><strong id='quickNoShkItemTimer'>" + escapeHtml(formatDuration(quickNoShkItemElapsedMs())) + "</strong></div>"
            + streakBadge
            + "</div>"
            + "<div class='quick-no-shk-game'>"
            + "<div class='quick-no-shk-photo-wrap'>" + quickNoShkPhotoHtml(item) + "</div>"
            + "<aside class='quick-no-shk-side'>"
            + "<h3>" + escapeHtml(item.shk) + "</h3>"
            + "<p class='quick-no-shk-name'>" + escapeHtml(item.name || "Наименование не найдено") + "</p>"
            + "<div class='quick-no-shk-info'>"
            + "<div><span>Код НМ</span><strong>" + escapeHtml(item.nm || "-") + "</strong></div>"
            + "<div><span>Стоимость</span><strong>" + escapeHtml(formatMoney(item.price)) + "</strong></div>"
            + "<div><span>Статус</span><strong>" + escapeHtml(item.status || "-") + "</strong></div>"
            + "<div><span>Дата последнего движения</span><strong>" + escapeHtml(formatRuDateTime(item.movement)) + "</strong></div>"
            + "<div><span>Источник</span><strong>" + escapeHtml(item.kind === "pure" ? "Чистые списания" : (Number(item.price) < 1000 ? "Предсортировка до 1000" : "Предсортировка 1000+")) + "</strong></div>"
            + "</div>"
            + "<div id='quickNoShkActionStatus' class='review-status'></div>"
            + "<div class='quick-no-shk-actions'>"
            + "<button class='quick-no-shk-action not-found' type='button' data-quick-no-shk='not_found'>Не найден</button>"
            + "<button class='quick-no-shk-action found' type='button' data-quick-no-shk='found'>Есть</button>"
            + "</div>"
            + "</aside></div></section>";
        bindQuickNoShkClose();
        target.querySelectorAll("[data-quick-no-shk]").forEach((button) => {
            button.addEventListener("click", () => {
                triggerQuickNoShkHitEffect(button, button.dataset.quickNoShk === "found");
                void applyQuickNoShkAction(button.dataset.quickNoShk || "");
            });
        });
        void loadQuickNoShkPhoto(item);
        void preloadQuickNoShkPhotos();
        updateQuickNoShkTimers();
    }

    function quickNoShkBurstParticlesHtml(count, color) {
        return Array.from({ length: count }, (_item, index) => {
            const angle = (Math.PI * 2 * index) / count + Math.random() * 0.5;
            const radius = 54 + Math.random() * 130;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius * .72;
            const size = 5 + Math.random() * 9;
            const delay = Math.random() * .07;
            return "<i class='quick-no-shk-particle' style='--x:" + x.toFixed(1) + "px;--y:" + y.toFixed(1) + "px;--size:" + size.toFixed(1) + "px;--delay:" + delay.toFixed(2) + "s;--c:" + color + "'></i>";
        }).join("");
    }

    function triggerQuickNoShkHitEffect(buttonEl, found) {
        const color = found ? "#22c55e" : "#f87171";
        const burst = document.createElement("div");
        burst.className = "quick-no-shk-burst";
        burst.innerHTML = quickNoShkBurstParticlesHtml(16, color);
        if (buttonEl && buttonEl.getBoundingClientRect) {
            const rect = buttonEl.getBoundingClientRect();
            burst.style.left = (rect.left + rect.width / 2) + "px";
            burst.style.top = (rect.top + rect.height / 2) + "px";
        }
        document.body.appendChild(burst);
        window.setTimeout(() => burst.remove(), 750);
        const card = document.querySelector(".quick-no-shk-card");
        if (card) {
            card.classList.remove("quick-no-shk-shake", "quick-no-shk-flash-found", "quick-no-shk-flash-miss");
            void card.offsetWidth;
            card.classList.add("quick-no-shk-shake", found ? "quick-no-shk-flash-found" : "quick-no-shk-flash-miss");
            window.setTimeout(() => card.classList.remove("quick-no-shk-shake", "quick-no-shk-flash-found", "quick-no-shk-flash-miss"), 500);
        }
    }

    async function completeTaskBySystemNoShk(row, item, verdict, note) {
        const db = supabaseDb();
        if (!db) throw new Error("Supabase недоступен.");
        const user = currentWmsUser();
        const now = new Date().toISOString();
        const makeReviewPayload = (basePayload) => ({
            ...(basePayload || {}),
            wms_review: {
                ...taskReviewPayload(row),
                comment: note,
                verdict,
                completed_by_id: user.id || null,
                completed_by_name: user.name || null,
                completed_at: now,
            },
            no_shk_review: {
                shk: item.shk,
                nm: item.nm,
                name: item.name,
                result: verdict,
                checked_at: now,
                checked_by_id: user.id || null,
                checked_by_name: user.name || null,
            },
        });
        const items = taskItems(row);
        const sourceItem = items.find((candidate) => normalizeIdentifier(candidate.shk) === normalizeIdentifier(item.shk)) || item;
        if (isTareTask(row) && items.length > 1) {
            const enrichedSourceItem = {
                ...sourceItem,
                nm: item.nm || sourceItem.nm || "",
                name: item.name || sourceItem.name || "",
                raw: {
                    ...((sourceItem.raw && typeof sourceItem.raw === "object") ? sourceItem.raw : {}),
                    nm: item.nm || sourceItem.nm || "",
                    name: item.name || sourceItem.name || "",
                },
            };
            const rest = items.filter((candidate) => normalizeIdentifier(candidate.shk) !== normalizeIdentifier(item.shk));
            const splitTask = splitTaskFromTare(row, enrichedSourceItem);
            const splitPayload = makeReviewPayload({
                ...taskPayload(splitTask),
                item_name: item.name || sourceItem.name || "",
            });
            Object.assign(splitTask, {
                task_status: "Завершено",
                opp_verdict: verdict,
                completed_at: now,
                reopen_after: null,
                source_payload: splitPayload,
                search_text: [splitTask.title, splitTask.task_type, item.shk, item.nm, item.name, verdict].filter(Boolean).join(" "),
                updated_at: now,
            });
            const { error: saveError } = await db.rpc(SAVE_RPC, { p_tasks: [compactTaskForSave(splitTask)], p_run: {} });
            if (saveError) throw saveError;
            const checked = Array.isArray(taskPayload(row).no_shk_checked_shks) ? taskPayload(row).no_shk_checked_shks : [];
            await updateTareTaskItems(row, rest, {
                no_shk_checked_shks: Array.from(new Set(checked.concat(item.shk).filter(Boolean))),
                no_shk_last_checked_at: now,
            });
            return splitTask;
        }
        const nextPayload = makeReviewPayload(taskPayload(row));
        const payload = {
            task_status: "Завершено",
            opp_verdict: verdict,
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
        state.review.rows = (state.review.rows || []).filter((task) => task.id !== row.id);
        return data || payload;
    }

    async function markTaskNoShkCheckedWithoutClosing(row, item, verdict, note) {
        const db = supabaseDb();
        if (!db) throw new Error("Supabase недоступен.");
        const user = currentWmsUser();
        const now = new Date().toISOString();
        const basePayload = taskPayload(row);
        const reviewPayload = {
            ...(basePayload.no_shk_review && typeof basePayload.no_shk_review === "object" && !Array.isArray(basePayload.no_shk_review) ? basePayload.no_shk_review : {}),
            shk: item.shk,
            nm: item.nm,
            name: item.name,
            result: verdict,
            comment: note,
            checked_at: now,
            checked_by_id: user.id || null,
            checked_by_name: user.name || null,
            kept_active: true,
        };
        const history = Array.isArray(basePayload.no_shk_review_history) ? basePayload.no_shk_review_history.slice(-49) : [];
        const extraPayload = {
            no_shk_review: reviewPayload,
            no_shk_review_history: history.concat(reviewPayload),
            no_shk_last_checked_at: now,
        };
        const items = taskItems(row);
        if (isTareTask(row) && items.length > 1) {
            await updateTareTaskItems(row, items, extraPayload);
            return row;
        }
        const nextPayload = { ...basePayload, ...extraPayload };
        const { data, error } = await db
            .from(WMS_TASKS_TABLE)
            .update({ source_payload: nextPayload, updated_at: now })
            .eq("id", row.id)
            .select("id,source_payload,updated_at")
            .single();
        if (error) throw error;
        refreshTaskRow(row.id, data || { source_payload: nextPayload, updated_at: now });
        return data || row;
    }

    async function updatePureNoShkFound(item) {
        const db = supabaseDb();
        if (!db) throw new Error("Supabase недоступен.");
        const row = item && item.pure_row ? item.pure_row : {};
        const user = currentWmsUser();
        const patch = {
            opp_deecision: AUTO_FOUND_DECISION,
            opp_emp: user.id || AUTO_FOUND_EMP_ID,
            opp_comment: "Быстрая проверка Без ШК: товар обнаружен при оклейке.",
        };
        const unsupported = new Set();
        const apply = async () => {
            const finalPatch = {};
            Object.entries(patch).forEach(([key, value]) => {
                if (!unsupported.has(key)) finalPatch[key] = value;
            });
            if (!Object.keys(finalPatch).length) return false;
            let query = db.from(PURE_LOSSES_TABLE).update(finalPatch);
            if (item.pure_id_target && item.pure_id_target.column && item.pure_id_target.value) {
                query = query.eq(item.pure_id_target.column, item.pure_id_target.value);
            } else {
                query = query
                    .eq("shk", item.shk)
                    .eq("wh_id", normalizeIdentifier(row.wh_id) || WH_ID)
                    .eq("date_lost", parseDateTime(row.date_lost).date || normalizeText(row.date_lost));
            }
            const { error } = await query;
            if (!error) return true;
            const missing = extractMissingColumnName(error);
            if (missing && Object.prototype.hasOwnProperty.call(finalPatch, missing)) {
                unsupported.add(missing);
                return apply();
            }
            throw new Error("Не удалось обновить чистое списание: " + error.message);
        };
        return apply();
    }

    async function markPureNoShkNotFound(item) {
        const db = supabaseDb();
        if (!db) throw new Error("Supabase недоступен.");
        const row = item && item.pure_row ? item.pure_row : {};
        const user = currentWmsUser();
        const existingComment = pureResolutionValue(row, ["opp_comment", "comment"]);
        const markerLine = QUICK_NO_SHK_PURE_NOT_FOUND_MARKER
            + " " + (user.name || user.id || "Сотрудник")
            + ": товар не найден при быстрой проверке, вердикт в чистые списания не записан.";
        const nextComment = normalizeForMatch(existingComment).includes(normalizeForMatch(QUICK_NO_SHK_PURE_NOT_FOUND_MARKER))
            ? existingComment
            : [existingComment, markerLine].filter(Boolean).join("\n");
        const patch = {
            opp_comment: nextComment,
            comment: nextComment,
        };
        const unsupported = new Set();
        const apply = async () => {
            const finalPatch = {};
            Object.entries(patch).forEach(([key, value]) => {
                if (!unsupported.has(key)) finalPatch[key] = value;
            });
            if (!Object.keys(finalPatch).length) return false;
            let query = db.from(PURE_LOSSES_TABLE).update(finalPatch);
            if (item.pure_id_target && item.pure_id_target.column && item.pure_id_target.value) {
                query = query.eq(item.pure_id_target.column, item.pure_id_target.value);
            } else {
                query = query
                    .eq("shk", item.shk)
                    .eq("wh_id", normalizeIdentifier(row.wh_id) || WH_ID)
                    .eq("date_lost", parseDateTime(row.date_lost).date || normalizeText(row.date_lost));
            }
            const { error } = await query;
            if (!error) return true;
            const missing = extractMissingColumnName(error);
            if (missing && Object.prototype.hasOwnProperty.call(finalPatch, missing)) {
                unsupported.add(missing);
                return apply();
            }
            throw new Error("Не удалось поставить отметку чистого списания: " + error.message);
        };
        return apply();
    }

    async function applyQuickNoShkAction(actionKey) {
        if (state.quickNoShk.processing) return;
        const item = currentQuickNoShkItem();
        if (!item) return;
        const row = item.kind === "task" ? findTaskRow(item.row_id) : null;
        if (item.kind === "task" && !row) {
            state.quickNoShk.actions.push({ key: item.key, shk: item.shk, result: "missing_task" });
            renderQuickNoShkPlay();
            return;
        }
        const found = actionKey === "found";
        const verdict = found ? SYSTEM_NO_SHK_FOUND_VERDICT : SYSTEM_NO_SHK_NOT_FOUND_VERDICT;
        const note = found ? "Быстрая проверка Без ШК: товар обнаружен при оклейке." : "Быстрая проверка Без ШК: товар не найден.";
        state.quickNoShk.processing = true;
        const status = $("quickNoShkActionStatus");
        if (status) status.textContent = "Фиксирую вердикт...";
        document.querySelectorAll("[data-quick-no-shk]").forEach((button) => { button.disabled = true; });
        try {
            let effectiveVerdict = verdict;
            let keptActive = false;
            if (item.kind === "pure") {
                if (found) {
                    await updatePureNoShkFound(item);
                    effectiveVerdict = AUTO_FOUND_DECISION;
                } else {
                    await markPureNoShkNotFound(item);
                    keptActive = true;
                    effectiveVerdict = "Не найден, без записи в чистые списания";
                }
            } else if (found || Number(item.price) < 1000) {
                await completeTaskBySystemNoShk(row, item, verdict, note);
            } else {
                await markTaskNoShkCheckedWithoutClosing(row, item, verdict, note);
                keptActive = true;
            }
            const decisionMs = quickNoShkItemElapsedMs();
            if (decisionMs > 0 && decisionMs < QUICK_NO_SHK_STREAK_THRESHOLD_MS) state.quickNoShk.streak += 1;
            else state.quickNoShk.streak = 0;
            state.quickNoShk.bestStreak = Math.max(state.quickNoShk.bestStreak, state.quickNoShk.streak);
            state.quickNoShk.lastActionKey = actionKey + ":" + Date.now();
            state.quickNoShk.actions.push({
                key: item.key,
                shk: item.shk,
                nm: item.nm,
                name: item.name,
                price: item.price,
                verdict: effectiveVerdict,
                found,
                kind: item.kind || "task",
                keptActive,
                decisionMs,
                at: new Date().toISOString(),
            });
            state.quickNoShk.index += 1;
            state.quickNoShk.itemTimerStartedAt = Date.now();
            renderQuickNoShkPlay();
            refreshOpenSectionModal();
        } catch (error) {
            console.error("quick no shk action failed:", error);
            if (status) {
                status.style.color = "#b91c1c";
                status.textContent = "Не удалось сохранить результат: " + (error && error.message ? error.message : String(error));
            }
            document.querySelectorAll("[data-quick-no-shk]").forEach((button) => { button.disabled = false; });
        } finally {
            state.quickNoShk.processing = false;
        }
    }

    function renderQuickNoShkFinish() {
        const target = $("quickNoShkWrap");
        if (!target) return;
        if (!state.quickNoShk.achievementsChecked) {
            state.quickNoShk.achievementsChecked = true;
            void evaluateQuickNoShkAchievements();
        }
        const actions = state.quickNoShk.actions || [];
        const found = actions.filter((action) => action.found);
        const notFound = actions.filter((action) => !action.found);
        const keptActive = actions.filter((action) => action.keptActive);
        const foundRows = found.map((action) => "<div class='quick-no-shk-finish-row'><strong>" + escapeHtml(action.shk) + "</strong><br>" + escapeHtml(action.name || "-") + "<br>НМ: " + escapeHtml(action.nm || "-") + " · " + escapeHtml(formatMoney(action.price)) + (action.kind === "pure" ? " · чистые списания" : "") + "</div>").join("");
        const avgMs = actions.length ? Math.round(actions.reduce((sum, action) => sum + (Number(action.decisionMs) || 0), 0) / actions.length) : 0;
        target.innerHTML = quickNoShkTopHtml("Проверка завершена. Найденное при оклейке вынесено отдельно, остальное закрыто системным вердиктом.")
            + "<section class='quick-no-shk-panel quick-no-shk-finish-panel'>"
            + "<div class='quick-no-shk-finish-hero'>🏁</div>"
            + "<div class='prespisok-finish-grid'>"
            + "<div class='prespisok-finish-stat'><span>Проверено</span><strong>" + actions.length + "</strong></div>"
            + "<div class='prespisok-finish-stat saved'><span>Есть</span><strong>" + found.length + "</strong></div>"
            + "<div class='prespisok-finish-stat writeoff'><span>Не найден</span><strong>" + notFound.length + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>Остались в ручном</span><strong>" + keptActive.length + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>Лучшее комбо</span><strong>🔥" + (Number(state.quickNoShk.bestStreak) || 0) + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>Средний темп</span><strong>" + escapeHtml(formatDuration(avgMs)) + "</strong></div>"
            + "</div>"
            + "<h3 class='quick-no-shk-title' style='font-size:clamp(28px,4vw,54px);margin-top:18px'>Найдено при оклейке</h3>"
            + "<div class='quick-no-shk-finish-list'>" + (foundRows || "<div class='quick-no-shk-finish-row'>Ничего не нашли. Иногда реальность скучнее файла.</div>") + "</div>"
            + "<div class='file-row'><button id='closeQuickNoShkFinish' class='quick-no-shk-start' type='button'>Закрыть</button></div>"
            + "</section>";
        bindQuickNoShkClose();
        $("closeQuickNoShkFinish").addEventListener("click", closeQuickNoShkModal);
        fireQuickNoShkConfetti();
    }

    function fireQuickNoShkConfetti() {
        const layer = document.createElement("div");
        layer.className = "quick-no-shk-confetti-layer";
        const colors = ["#86efac", "#22c55e", "#facc15", "#38bdf8", "#f87171", "#c084fc"];
        layer.innerHTML = Array.from({ length: 60 }, () => {
            const left = Math.random() * 100;
            const size = 6 + Math.random() * 8;
            const delay = Math.random() * .5;
            const duration = 1.6 + Math.random() * 1.1;
            const rotate = Math.round(Math.random() * 720 - 360);
            const color = colors[Math.floor(Math.random() * colors.length)];
            return "<i class='quick-no-shk-confetti-bit' style='--left:" + left.toFixed(1) + "%;--size:" + size.toFixed(1) + "px;--delay:" + delay.toFixed(2) + "s;--duration:" + duration.toFixed(2) + "s;--rotate:" + rotate + "deg;--c:" + color + "'></i>";
        }).join("");
        document.body.appendChild(layer);
        window.setTimeout(() => layer.remove(), 3200);
    }

    function resetNoShkReviewState(keepPhotos) {
        state.noShkReview = {
            query: "",
            rows: [],
            loading: false,
            processing: false,
            photoCache: keepPhotos && state.noShkReview ? (state.noShkReview.photoCache || {}) : {},
            resolvedColumns: state.noShkReview ? (state.noShkReview.resolvedColumns || {}) : {},
            status: "Введите НМ, бренд или наименование товара. Ищем только в чистых списаниях.",
            statusTone: "",
            enlargedPhoto: "",
            success: null,
            token: 0,
        };
    }

    function noShkPureValue(row, keys) {
        for (const key of keys || []) {
            const value = pureResolutionValue(row, [key]);
            if (value) return value;
        }
        return "";
    }

    function noShkPureNm(row) {
        return normalizeIdentifier(noShkPureValue(row, NO_SHK_PURE_COLUMNS.nm));
    }

    function noShkPureName(row) {
        return noShkPureValue(row, NO_SHK_PURE_COLUMNS.description);
    }

    function noShkPureBrand(row) {
        return noShkPureValue(row, NO_SHK_PURE_COLUMNS.brand);
    }

    function noShkPureShk(row) {
        return normalizeIdentifier(row && row.shk);
    }

    function noShkPureDate(row) {
        return normalizeText(row && (row.date_lost || row.date || row.created_at));
    }

    function noShkPureDecision(row) {
        return noShkPureValue(row, NO_SHK_PURE_COLUMNS.decision);
    }

    function isNoShkPureAllowed(row) {
        const decision = normalizeForMatch(noShkPureDecision(row));
        return decision !== "найден" && decision !== "обнаружен без шк";
    }

    function noShkRowSignature(row) {
        const id = normalizeText(row && (row.id || row.pure_id || row.uuid || row.pure_losses_id || row.row_id));
        if (id) return "id:" + id;
        return [
            noShkPureShk(row),
            noShkPureNm(row),
            noShkPureName(row),
            noShkPureBrand(row),
            noShkPureDate(row),
            normalizeIdentifier(row && row.wh_id),
        ].join("|");
    }

    function dedupeNoShkPureRows(rows) {
        const seen = new Set();
        const out = [];
        (rows || []).forEach((row) => {
            const sig = noShkRowSignature(row);
            if (!sig || seen.has(sig)) return;
            seen.add(sig);
            out.push(row);
        });
        return out;
    }

    function isUnknownColumnError(error) {
        const code = normalizeText(error && error.code);
        const message = normalizeForMatch((error && (error.message || error.details)) || "");
        return code === "42703"
            || code === "PGRST204"
            || Boolean(extractMissingColumnName(error))
            || (message.includes("column") && (message.includes("does not exist") || message.includes("could not find")));
    }

    function buildNoShkVisualVariants(queryText, maxVariants) {
        const text = normalizeText(queryText);
        if (!text) return [];
        const chars = Array.from(text);
        const positions = [];
        chars.forEach((char, index) => {
            if (NO_SHK_VISUAL_SIMILAR_MAP[char]) positions.push(index);
        });
        const out = new Set([text]);
        if (!positions.length) return Array.from(out);
        out.add(chars.map((char) => NO_SHK_VISUAL_SIMILAR_MAP[char] || char).join(""));
        positions.slice(0, 8).forEach((position) => {
            const cloned = chars.slice();
            cloned[position] = NO_SHK_VISUAL_SIMILAR_MAP[cloned[position]] || cloned[position];
            out.add(cloned.join(""));
        });
        return Array.from(out).slice(0, Math.max(1, Number(maxVariants) || 8));
    }

    async function queryNoShkPureColumn(cacheKey, columns, matcher, value) {
        const db = supabaseDb();
        if (!db) throw new Error("Supabase недоступен.");
        const resolved = normalizeText(state.noShkReview.resolvedColumns[cacheKey]);
        const ordered = [];
        if (resolved) ordered.push(resolved);
        (columns || []).forEach((column) => {
            if (!ordered.includes(column)) ordered.push(column);
        });
        let lastError = null;
        for (const column of ordered) {
            let query = db.from(PURE_LOSSES_TABLE).select("*");
            query = matcher === "eq" ? query.eq(column, value) : query.ilike(column, value);
            const { data, error } = await query.limit(NO_SHK_SEARCH_LIMIT);
            if (!error) {
                state.noShkReview.resolvedColumns[cacheKey] = column;
                return { rows: Array.isArray(data) ? data : [], error: null };
            }
            if (isUnknownColumnError(error)) {
                if (state.noShkReview.resolvedColumns[cacheKey] === column) state.noShkReview.resolvedColumns[cacheKey] = "";
                continue;
            }
            lastError = error;
            break;
        }
        return { rows: [], error: lastError };
    }

    function sortNoShkPureRows(rows, queryText) {
        const query = normalizeForMatch(queryText);
        const nmQuery = normalizeIdentifier(queryText);
        return [...(rows || [])].sort((a, b) => {
            const aNmExact = nmQuery && noShkPureNm(a) === nmQuery ? 1 : 0;
            const bNmExact = nmQuery && noShkPureNm(b) === nmQuery ? 1 : 0;
            if (aNmExact !== bNmExact) return bNmExact - aNmExact;
            const aText = normalizeForMatch([noShkPureBrand(a), noShkPureName(a)].join(" "));
            const bText = normalizeForMatch([noShkPureBrand(b), noShkPureName(b)].join(" "));
            const aStarts = query && aText.startsWith(query) ? 1 : 0;
            const bStarts = query && bText.startsWith(query) ? 1 : 0;
            if (aStarts !== bStarts) return bStarts - aStarts;
            const aTs = parseDateTime(noShkPureDate(a)).ts || 0;
            const bTs = parseDateTime(noShkPureDate(b)).ts || 0;
            return bTs - aTs;
        });
    }

    async function fetchNoShkPureRows(queryText) {
        const query = normalizeText(queryText);
        if (!query) return { rows: [], error: null };
        const jobs = [];
        if (/^\d+$/.test(query)) {
            jobs.push(() => queryNoShkPureColumn("nm", NO_SHK_PURE_COLUMNS.nm, "eq", query));
            jobs.push(() => queryNoShkPureColumn("shk", ["shk"], "eq", query));
        } else {
            buildNoShkVisualVariants(query, 10).forEach((variant) => {
                jobs.push(() => queryNoShkPureColumn("description", NO_SHK_PURE_COLUMNS.description, "ilike", "%" + variant + "%"));
                jobs.push(() => queryNoShkPureColumn("brand", NO_SHK_PURE_COLUMNS.brand, "ilike", "%" + variant + "%"));
            });
        }
        const results = new Array(jobs.length);
        await runLimitedPool(jobs, 4, async (job, index) => {
            results[index] = await job();
        });
        let firstError = null;
        const merged = [];
        (results || []).forEach((result) => {
            if (result && result.error && !firstError) firstError = result.error;
            merged.push(...((result && result.rows) || []));
        });
        const rows = sortNoShkPureRows(dedupeNoShkPureRows(merged).filter(isNoShkPureAllowed), query).slice(0, NO_SHK_SEARCH_LIMIT);
        return { rows, error: firstError };
    }

    function noShkReviewStatusHtml() {
        const text = normalizeText(state.noShkReview.status);
        if (!text) return "";
        return "<div class='status-line " + escapeHtml(state.noShkReview.statusTone || "") + "'>" + escapeHtml(text) + "</div>";
    }

    function renderNoShkReviewModal() {
        const target = $("noShkReviewWrap");
        if (!target) return;
        const success = state.noShkReview.success;
        if (success) {
            target.innerHTML = "<div class='work-head'>"
                + "<div><h3 class='work-title'>Разбор “Без ШК”</h3><p class='work-subtitle'>Чистые списания, ручное опознание.</p></div>"
                + "<button id='closeNoShkReview' class='btn btn-square' type='button' aria-label='Закрыть'>×</button>"
                + "</div>"
                + "<section class='no-shk-success'><div><h3>Товар опознан!</h3><p>ШК " + escapeHtml(success.shk || "-") + "<br>" + escapeHtml(success.name || "Наименование не найдено") + "</p><div class='file-row' style='justify-content:center;margin-top:20px'><button id='noShkReviewAgain' class='btn btn-rect' type='button'>Продолжить поиск</button></div></div></section>";
            $("closeNoShkReview").addEventListener("click", closeNoShkReviewModal);
            $("noShkReviewAgain").addEventListener("click", () => {
                state.noShkReview.success = null;
                state.noShkReview.query = "";
                state.noShkReview.rows = [];
                state.noShkReview.status = "Введите следующий запрос.";
                state.noShkReview.statusTone = "";
                renderNoShkReviewModal();
            });
            return;
        }
        const rows = state.noShkReview.rows || [];
        target.innerHTML = "<div class='work-head'>"
            + "<div><h3 class='work-title'>Разбор “Без ШК”</h3><p class='work-subtitle'>Ищем товар только в чистых списаниях: НМ, бренд или наименование.</p></div>"
            + "<button id='closeNoShkReview' class='btn btn-square' type='button' aria-label='Закрыть'>×</button>"
            + "</div>"
            + "<div class='no-shk-search-row'>"
            + "<input id='noShkSearchInput' class='no-shk-search-input' type='search' autocomplete='off' placeholder='Введите НМ, бренд или наименование' value='" + escapeHtml(state.noShkReview.query || "") + "'>"
            + "<button id='noShkSearchBtn' class='btn btn-rect' type='button' " + (state.noShkReview.loading ? "disabled" : "") + ">" + (state.noShkReview.loading ? "Ищу..." : "Найти") + "</button>"
            + "</div>"
            + noShkReviewStatusHtml()
            + "<div id='noShkResults' class='no-shk-results'>" + renderNoShkRowsHtml(rows) + "</div>";
        $("closeNoShkReview").addEventListener("click", closeNoShkReviewModal);
        $("noShkSearchInput").addEventListener("input", (event) => {
            state.noShkReview.query = event.target.value || "";
        });
        $("noShkSearchInput").addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                void searchNoShkPureRows();
            }
        });
        $("noShkSearchBtn").addEventListener("click", () => { void searchNoShkPureRows(); });
        bindNoShkResultEvents();
        preloadNoShkResultPhotos();
        setTimeout(() => {
            const input = $("noShkSearchInput");
            if (input) input.focus();
        }, 0);
    }

    function renderNoShkRowsHtml(rows) {
        if (state.noShkReview.loading) return "<div class='no-shk-empty'>Ищу в чистых списаниях...</div>";
        if (!normalizeText(state.noShkReview.query)) return "<div class='no-shk-empty'>Введите запрос и нажмите “Найти”. Поиск не запускается на каждый символ, чтобы страница не превращалась в кипящий чайник.</div>";
        if (!rows.length) return "<div class='no-shk-empty'>Совпадений не найдено.</div>";
        return rows.map((row, index) => {
            const nm = noShkPureNm(row);
            const imageUrl = nm && state.noShkReview.photoCache[nm] ? state.noShkReview.photoCache[nm] : "";
            const photo = imageUrl
                ? "<img src='" + escapeHtml(imageUrl) + "' alt='Фото товара'>"
                : "<span>" + (nm ? "Фото" : "Нет НМ") + "</span>";
            return "<article class='no-shk-result-card' data-index='" + index + "'>"
                + "<button class='no-shk-photo-thumb' type='button' data-no-shk-photo='" + index + "' data-no-shk-nm='" + escapeHtml(nm || "") + "' " + (!imageUrl ? "disabled" : "") + ">" + photo + "</button>"
                + "<div class='no-shk-result-main'>"
                + "<div class='no-shk-result-title'>" + escapeHtml(noShkPureName(row) || "Наименование не найдено") + "</div>"
                + "<div class='no-shk-result-meta'>" + escapeHtml(noShkPureBrand(row) || "Бренд не указан") + "</div>"
                + "<div class='no-shk-result-pills'>"
                + "<span class='no-shk-pill'>ШК " + escapeHtml(noShkPureShk(row) || "-") + "</span>"
                + "<span class='no-shk-pill'>НМ " + escapeHtml(nm || "-") + "</span>"
                + "<span class='no-shk-pill'>" + escapeHtml(formatRuDate(parseDateTime(noShkPureDate(row)).date) || "-") + "</span>"
                + "</div></div>"
                + "<button class='btn btn-rect no-shk-found-btn' data-no-shk-found='" + index + "' type='button' " + (state.noShkReview.processing ? "disabled" : "") + ">Опознать</button>"
                + "</article>";
        }).join("");
    }

    function bindNoShkResultEvents() {
        document.querySelectorAll("[data-no-shk-found]").forEach((button) => {
            button.addEventListener("click", () => {
                const row = (state.noShkReview.rows || [])[Number(button.dataset.noShkFound)];
                if (row) void markNoShkPureAsFound(row);
            });
        });
        document.querySelectorAll("[data-no-shk-photo]").forEach((button) => {
            button.addEventListener("click", () => {
                const row = (state.noShkReview.rows || [])[Number(button.dataset.noShkPhoto)];
                const url = row ? state.noShkReview.photoCache[noShkPureNm(row)] : "";
                if (url) openNoShkPhotoPreview(row, url);
            });
        });
    }

    async function searchNoShkPureRows() {
        const query = normalizeText(state.noShkReview.query);
        if (!query) {
            state.noShkReview.status = "Введите НМ, бренд или наименование товара.";
            state.noShkReview.statusTone = "error";
            renderNoShkReviewModal();
            return;
        }
        const token = ++state.noShkReview.token;
        state.noShkReview.loading = true;
        state.noShkReview.status = "Ищу в чистых списаниях...";
        state.noShkReview.statusTone = "";
        renderNoShkReviewModal();
        try {
            const result = await fetchNoShkPureRows(query);
            if (token !== state.noShkReview.token) return;
            state.noShkReview.rows = result.rows || [];
            state.noShkReview.status = result.error
                ? "Часть колонок не прочиталась, но найденные варианты показал. Если пусто — проверь название поля в pure_losses_rep."
                : "Найдено вариантов: " + state.noShkReview.rows.length + ".";
            state.noShkReview.statusTone = result.error ? "error" : (state.noShkReview.rows.length ? "good" : "");
        } catch (error) {
            if (token !== state.noShkReview.token) return;
            state.noShkReview.rows = [];
            state.noShkReview.status = "Не удалось выполнить поиск: " + (error && error.message ? error.message : String(error));
            state.noShkReview.statusTone = "error";
        } finally {
            if (token === state.noShkReview.token) {
                state.noShkReview.loading = false;
                renderNoShkReviewModal();
            }
        }
    }

    async function loadNoShkResultPhoto(row) {
        const nm = noShkPureNm(row);
        if (!nm || Object.prototype.hasOwnProperty.call(state.noShkReview.photoCache, nm)) return;
        const urls = buildWbImageCandidatesByNm(nm, { maxPics: 1, maxHosts: 18 });
        const found = await findFirstLoadableImage(urls);
        state.noShkReview.photoCache[nm] = found || "";
        if (!$("noShkReviewModal") || !$("noShkReviewModal").classList.contains("active")) return;
        document.querySelectorAll("[data-no-shk-photo]").forEach((button) => {
            if (normalizeIdentifier(button.dataset.noShkNm) !== nm) return;
            if (found) {
                button.disabled = false;
                button.innerHTML = "<img src='" + escapeHtml(found) + "' alt='Фото товара'>";
            } else {
                button.disabled = true;
                button.innerHTML = "<span>Нет фото</span>";
            }
        });
    }

    function preloadNoShkResultPhotos() {
        const rows = (state.noShkReview.rows || []).slice(0, NO_SHK_PHOTO_PREVIEW_LIMIT);
        rows.forEach((row) => { void loadNoShkResultPhoto(row); });
    }

    function openNoShkPhotoPreview(row, imageUrl) {
        $("specialInfoWrap").innerHTML = "<div class='work-head'>"
            + "<div><h3 class='work-title'>Фото товара</h3><p class='work-subtitle'>" + escapeHtml(noShkPureName(row) || "Наименование не найдено") + "</p></div>"
            + "<button id='closeNoShkPhotoPreview' class='btn btn-square' type='button' aria-label='Закрыть'>×</button>"
            + "</div>"
            + "<img class='no-shk-photo-preview' src='" + escapeHtml(imageUrl) + "' alt='Фото товара'>"
            + "<div class='status-line'>ШК " + escapeHtml(noShkPureShk(row) || "-") + " · НМ " + escapeHtml(noShkPureNm(row) || "-") + "</div>";
        setFlowModalOpen("specialInfoModal", true);
        $("closeNoShkPhotoPreview").addEventListener("click", closeSpecialInfoModal);
    }

    function buildNoShkPureUpdateFilters(row) {
        const filters = [];
        const push = (obj) => {
            const entries = Object.entries(obj || {}).filter(([, value]) => normalizeText(value));
            if (entries.length) filters.push(Object.fromEntries(entries));
        };
        push({ id: row && row.id });
        push({ pure_id: row && row.pure_id });
        push({ uuid: row && row.uuid });
        push({ pure_losses_id: row && row.pure_losses_id });
        push({ row_id: row && row.row_id });
        const shk = noShkPureShk(row);
        const nm = noShkPureNm(row);
        const name = noShkPureName(row);
        const dateLost = normalizeText(row && row.date_lost);
        const whId = normalizeIdentifier(row && row.wh_id);
        if (shk && nm && dateLost && whId) push({ shk, nm, date_lost: dateLost, wh_id: whId });
        if (shk && dateLost && whId) push({ shk, date_lost: dateLost, wh_id: whId });
        if (shk && nm && dateLost) push({ shk, nm, date_lost: dateLost });
        if (shk && dateLost) push({ shk, date_lost: dateLost });
        if (shk && nm) push({ shk, nm });
        if (shk) push({ shk });
        if (nm && name) {
            push({ nm, decription: name });
            push({ nm, description: name });
        }
        if (nm) push({ nm });
        const seen = new Set();
        return filters.filter((filter) => {
            const sig = Object.entries(filter).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + ":" + value).join("|");
            if (!sig || seen.has(sig)) return false;
            seen.add(sig);
            return true;
        });
    }

    async function updateNoShkPureRow(row, patch) {
        const db = supabaseDb();
        if (!db) throw new Error("Supabase недоступен.");
        const filters = buildNoShkPureUpdateFilters(row);
        let lastError = null;
        for (const filter of filters) {
            let query = db.from(PURE_LOSSES_TABLE).update(patch);
            Object.entries(filter).forEach(([key, value]) => { query = query.eq(key, value); });
            const { data, error } = await query.select("*").limit(1);
            if (!error && Array.isArray(data) && data.length) return data[0];
            if (error && isUnknownColumnError(error)) {
                lastError = error;
                continue;
            }
            if (error) {
                lastError = error;
                break;
            }
        }
        throw lastError || new Error("Строка pure_losses_rep не обновилась.");
    }

    function noShkPurePatchVariants(row) {
        const user = currentWmsUser();
        const baseComment = NO_SHK_FOUND_COMMENT + " ШК: " + (noShkPureShk(row) || "-") + ".";
        const variants = [];
        NO_SHK_PURE_COLUMNS.decision.forEach((decisionCol) => {
            NO_SHK_PURE_COLUMNS.employee.forEach((employeeCol) => {
                NO_SHK_PURE_COLUMNS.comment.forEach((commentCol) => {
                    variants.push({ [decisionCol]: AUTO_FOUND_DECISION, [employeeCol]: user.id || user.name || "", [commentCol]: baseComment });
                });
                variants.push({ [decisionCol]: AUTO_FOUND_DECISION, [employeeCol]: user.id || user.name || "" });
            });
            variants.push({ [decisionCol]: AUTO_FOUND_DECISION });
        });
        return variants;
    }

    async function markNoShkPureAsFound(row) {
        if (state.noShkReview.processing) return;
        state.noShkReview.processing = true;
        state.noShkReview.status = "Сохраняю опознание...";
        state.noShkReview.statusTone = "";
        renderNoShkReviewModal();
        let lastError = null;
        try {
            for (const patch of noShkPurePatchVariants(row)) {
                try {
                    await updateNoShkPureRow(row, patch);
                    state.noShkReview.rows = (state.noShkReview.rows || []).filter((candidate) => noShkRowSignature(candidate) !== noShkRowSignature(row));
                    state.noShkReview.success = {
                        shk: noShkPureShk(row),
                        nm: noShkPureNm(row),
                        name: noShkPureName(row),
                    };
                    toast("Товар опознан", "success");
                    renderNoShkReviewModal();
                    return;
                } catch (error) {
                    lastError = error;
                    if (!isUnknownColumnError(error)) break;
                }
            }
            throw lastError || new Error("Не удалось записать вердикт.");
        } catch (error) {
            state.noShkReview.status = "Не удалось опознать товар: " + (error && error.message ? error.message : String(error));
            state.noShkReview.statusTone = "error";
        } finally {
            state.noShkReview.processing = false;
            if (!state.noShkReview.success) renderNoShkReviewModal();
        }
    }

    function openNoShkReviewModal() {
        closeFlowModals();
        resetNoShkReviewState(true);
        setFlowModalOpen("noShkReviewModal", true);
        renderNoShkReviewModal();
    }

    function closeNoShkReviewModal() {
        setFlowModalOpen("noShkReviewModal", false);
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

    function requestSectionName(row) {
        const taskType = normalizeForMatch(row && row.task_type);
        const sourceModule = normalizeForMatch(row && row.source_module);
        const uploadType = normalizeForMatch(row && row.upload_type);
        const title = normalizeForMatch(row && row.title);
        const combined = [taskType, title, sourceModule, uploadType].join(" ");
        if (sourceModule === "incoming_flow_requests"
            || uploadType === "incoming_flow_requests"
            || taskType === "запросы входящего потока"
            || taskType === "запрос входящего потока") return "Запросы входящего потока";
        if (combined.includes("списания awh") || combined.includes("awh")) return "Списания AWH";
        if (combined.includes("короб") && combined.includes("вход")) return "Коробки на входе";
        return "";
    }

    function cloneFlowSettings(value) {
        return JSON.parse(JSON.stringify(value || DEFAULT_FLOW_SCORE_SETTINGS));
    }

    function deepMergeObject(base, extra) {
        const output = { ...(base || {}) };
        Object.entries(extra || {}).forEach(([key, value]) => {
            if (value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) {
                output[key] = deepMergeObject(output[key], value);
            } else if (value !== undefined) {
                output[key] = value;
            }
        });
        return output;
    }

    function flowSettings() {
        return deepMergeObject(DEFAULT_FLOW_SCORE_SETTINGS, state.flow.settings || {});
    }

    function flowSettingNumber(path, fallback) {
        const parts = String(path || "").split(".").filter(Boolean);
        let value = flowSettings();
        for (const part of parts) {
            if (!value || typeof value !== "object") return fallback;
            value = value[part];
        }
        return settingNumber(value, fallback);
    }

    function flowWeight(key) {
        return Math.max(flowSettingNumber("weights." + key, 1), 0);
    }

    function flowSetNestedSetting(path, value) {
        const parts = String(path || "").split(".").filter(Boolean);
        if (!parts.length) return;
        const next = cloneFlowSettings(flowSettings());
        let cursor = next;
        parts.slice(0, -1).forEach((part) => {
            if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) cursor[part] = {};
            cursor = cursor[part];
        });
        cursor[parts[parts.length - 1]] = value;
        state.flow.settings = next;
    }

    function flowTaskSection(row) {
        return requestSectionName(row) || taskSectionName(row);
    }

    function flowTaskZoneKey(row) {
        const section = flowTaskSection(row);
        if (FLOW_STRICT_INCOMING_SECTIONS.has(section)) return "incoming";
        if (FLOW_STRICT_OUTGOING_SECTIONS.has(section)) return "outgoing";
        const zone = normalizeForMatch(row && row.responsibility_zone);
        if (zone.includes("вход")) return "incoming";
        if (zone.includes("исход")) return "outgoing";
        return "neutral";
    }

    function flowTaskZoneLabel(row) {
        const key = flowTaskZoneKey(row);
        if (key === "incoming") return "Входящий поток";
        if (key === "outgoing") return "Исходящий поток";
        return "Нет привязки";
    }

    function flowZonePolicy(row) {
        const section = flowTaskSection(row);
        if (FLOW_STRICT_INCOMING_SECTIONS.has(section) || FLOW_STRICT_OUTGOING_SECTIONS.has(section)) return "strict";
        if (flowTaskZoneKey(row) === "neutral") return "neutral";
        return "flexible";
    }

    function currentFlowEmployee() {
        const user = currentWmsUser();
        const shift = state.shift.current || {};
        let id = normalizeIdentifier(user.id);
        const nameKey = normalizeForMatch(user.name);
        const incomingId = normalizeIdentifier(shift.incoming_employee_id);
        const outgoingId = normalizeIdentifier(shift.outgoing_employee_id);
        const incomingName = normalizeForMatch(shift.incoming_name);
        const outgoingName = normalizeForMatch(shift.outgoing_name);
        const zones = new Set();
        if (id && incomingId && id === incomingId) zones.add("incoming");
        if (id && outgoingId && id === outgoingId) zones.add("outgoing");
        if (nameKey && incomingName && nameKey === incomingName) {
            zones.add("incoming");
            if (!id) id = incomingId;
        }
        if (nameKey && outgoingName && nameKey === outgoingName) {
            zones.add("outgoing");
            if (!id) id = outgoingId;
        }
        if (!id) id = nameKey;
        return {
            id,
            name: user.name,
            zones,
            incomingId,
            outgoingId,
            inShift: zones.size > 0,
        };
    }

    function flowActor() {
        const user = currentWmsUser();
        const context = currentFlowEmployee();
        const actorId = (context.zones.has("incoming") ? context.incomingId : "")
            || (context.zones.has("outgoing") ? context.outgoingId : "")
            || normalizeIdentifier(user.id)
            || normalizeIdentifier(context.id)
            || "";
        return { id: actorId, name: user.name || context.name || "" };
    }

    function flowPayload(row) {
        const flow = taskPayload(row).wms_flow;
        return flow && typeof flow === "object" && !Array.isArray(flow) ? flow : {};
    }

    function flowLockInfo(row) {
        const flow = flowPayload(row);
        const lockUntil = Date.parse(flow.lock_until || "");
        const claimedById = normalizeIdentifier(flow.claimed_by_id);
        const claimedByName = normalizeText(flow.claimed_by_name);
        const active = Number.isFinite(lockUntil) && lockUntil > Date.now();
        const expired = Number.isFinite(lockUntil) && lockUntil <= Date.now();
        return { flow, lockUntil, claimedById, claimedByName, active, expired };
    }

    function flowRowIsLockedForOther(row, context) {
        const lock = flowLockInfo(row);
        return lock.active && lock.claimedById && context.id && lock.claimedById !== context.id;
    }

    function flowSkipCooldown(row, context) {
        const actorId = normalizeIdentifier(context && context.id);
        if (!actorId) return { active: false, until: 0, reason: "" };
        const flow = flowPayload(row);
        const cooldowns = flow.skip_cooldowns && typeof flow.skip_cooldowns === "object" && !Array.isArray(flow.skip_cooldowns) ? flow.skip_cooldowns : {};
        const entry = cooldowns[actorId] || {};
        const until = Date.parse(entry.until || "");
        return {
            active: Number.isFinite(until) && until > Date.now(),
            until: Number.isFinite(until) ? until : 0,
            reason: normalizeText(entry.reason),
        };
    }

    function flowStrictMismatch(row, context) {
        const policy = flowZonePolicy(row);
        if (policy !== "strict") return false;
        const zone = flowTaskZoneKey(row);
        return !context.zones.has(zone);
    }

    function flowDateDiffDays(isoDate) {
        const date = parseDateTime(isoDate).date;
        if (!date) return null;
        const today = state.today || todayIsoInMoscow();
        const start = Date.parse(today + "T00:00:00Z");
        const end = Date.parse(date + "T00:00:00Z");
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        return Math.round((end - start) / 86400000);
    }

    function flowUrgencyComponent(row) {
        const days = flowDateDiffDays(row && row.due_date);
        if (days === null) return { value: 0, label: "Дата списания не задана" };
        if (days < 0) return { value: 32000 + Math.min(Math.abs(days) * 5500, 28000), label: "Просрочено на " + Math.abs(days) + " дн." };
        if (days === 0) return { value: 24000, label: "Списание сегодня" };
        if (days === 1) return { value: 15000, label: "Списание завтра" };
        if (days <= 3) return { value: 9000, label: "До списания " + days + " дн." };
        return { value: Math.max(1200, 5000 - days * 500), label: "До списания " + days + " дн." };
    }

    function flowSourceComponent(row) {
        const section = flowTaskSection(row);
        const boosts = flowSettings().sourceBoosts || {};
        if (section === "Запросы входящего потока") return { value: settingNumber(boosts.incomingFlowRequests, 60000), label: "Входящий запрос другого ЛО" };
        if (section === "Списания AWH") return { value: settingNumber(boosts.awhWriteoffs, 18000), label: "Списание AWH" };
        if (section === "Коробки на входе") return { value: settingNumber(boosts.incomingBoxes, 16000), label: "Коробки на входе" };
        if (isPrespisokTask(row)) return { value: settingNumber(boosts.prespisokSecondLine, 22000), label: "2-я линия предсписка" };
        if (section === "Движение после продажи") return { value: settingNumber(boosts.afterSaleMovement, 14000), label: "Движение после продажи" };
        return { value: 0, label: "Обычный предразбор" };
    }

    function flowZoneCounts(rows) {
        const counts = { incoming: 0, outgoing: 0, neutral: 0 };
        (rows || []).filter(isActiveReviewTask).forEach((row) => {
            const key = flowTaskZoneKey(row);
            counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
    }

    function flowZoneMultiplier(row, context, counts) {
        const policy = flowZonePolicy(row);
        const zone = flowTaskZoneKey(row);
        const zoneSettings = flowSettings().zone || {};
        if (policy === "neutral") return { value: 1, label: "Без жесткой зоны" };
        const own = context.zones.has(zone);
        let raw = own ? settingNumber(zoneSettings.own, 1.18) : settingNumber(zoneSettings.otherFlexible, 0.82);
        const currentCount = Number(counts[zone]) || 0;
        const ownCounts = Array.from(context.zones).map((key) => Number(counts[key]) || 0);
        const ownMax = ownCounts.length ? Math.max(...ownCounts) : 0;
        if (!own && policy === "flexible" && currentCount >= Math.max(ownMax * 1.3, ownMax + 8)) raw += settingNumber(zoneSettings.overflowBonus, 0.22);
        if (currentCount >= 50) raw += settingNumber(zoneSettings.heavyLoadBonus, 0.14);
        if (policy === "strict") raw += settingNumber(zoneSettings.strictBonus, 0.08);
        const weight = flowWeight("zone");
        const value = 1 + (Math.max(raw, 0.55) - 1) * weight;
        return {
            value: Math.max(value, 0.35),
            label: own ? "Своя зона" : policy === "flexible" ? "Чужая зона, но можно подхватить" : "Жесткая зона",
        };
    }

    function flowGroupingCandidate(row) {
        if (!row || requestSectionName(row)) return null;
        const items = taskItems(row);
        const first = items[0] || {};
        const mx = normalizeText(first.mx || taskPayload(row).mx || taskPayload(row).route_label || taskRouteLabel(row));
        const status = latinStatusCode(first.status || taskPayload(row).status || row.description || row.title);
        const movement = parseDateTime(first.movement || row.source_last_movement_at || row.upload_effective_date || row.created_at);
        const settings = flowSettings().grouping || {};
        const windowMinutes = Math.max(settingNumber(settings.windowMinutes, 120), 15);
        if (!mx || !status || !movement.ts) return null;
        const bucket = Math.floor(movement.ts / (windowMinutes * 60 * 1000));
        return {
            key: [normalizeForMatch(mx), status, bucket].join("|"),
            mx,
            status,
            bucket,
            windowMinutes,
            movementTs: movement.ts,
        };
    }

    function buildFlowGroupIndex(rows) {
        const settings = flowSettings().grouping || {};
        if (settings.enabled === false) return new Map();
        const raw = new Map();
        (rows || []).forEach((row) => {
            const candidate = flowGroupingCandidate(row);
            if (!candidate) return;
            if (!raw.has(candidate.key)) raw.set(candidate.key, { ...candidate, rows: [], totalPrice: 0 });
            const bucket = raw.get(candidate.key);
            bucket.rows.push(row);
            bucket.totalPrice += reviewPrice(row);
        });
        const minCount = Math.max(Math.round(settingNumber(settings.minCount, 3)), 2);
        const index = new Map();
        raw.forEach((group, key) => {
            if (group.rows.length < minCount) return;
            const sample = group.rows.slice(0, 8).map((row) => ({
                id: row.id,
                title: displayTaskTitle(row),
                price: reviewPrice(row),
                section: flowTaskSection(row),
                shk: (taskItems(row)[0] && taskItems(row)[0].shk) || normalizeIdentifier(row.source_id),
            }));
            const info = {
                key,
                mx: group.mx,
                status: group.status,
                count: group.rows.length,
                totalPrice: group.totalPrice,
                sample,
                rowIds: group.rows.map((row) => row.id),
            };
            group.rows.forEach((row) => index.set(row.id, info));
        });
        return index;
    }

    function flowGroupComponent(row, groupIndex) {
        const settings = flowSettings().grouping || {};
        const group = groupIndex && groupIndex.get ? groupIndex.get(row && row.id) : null;
        if (!group) return { value: 0, label: "", group: null };
        const perExtra = settingNumber(settings.perExtraTask, 1800);
        const pricePercent = settingNumber(settings.pricePercent, 0.08);
        const maxBonus = settingNumber(settings.maxBonus, 42000);
        const value = Math.round(Math.min((group.count - 1) * perExtra + group.totalPrice * pricePercent, maxBonus));
        return {
            value,
            label: "Массовый паттерн: " + group.count + " задач · " + group.status + " · " + group.mx,
            group,
        };
    }

    function flowSkillMultiplier(row, context) {
        const settings = flowSettings().skill || {};
        if (settings.enabled === false) return { value: 1, label: "Навык не учитывается" };
        const section = flowTaskSection(row);
        const stat = state.flow.employeeStats.bySection && state.flow.employeeStats.bySection[section];
        if (!stat || stat.count < Math.max(settingNumber(settings.minCompleted, 5), 1)) return { value: 1, label: "Личной статистики по участку мало" };
        const max = Math.max(settingNumber(settings.maxMultiplier, 1.16), 1);
        const raw = Math.min(max, 1 + stat.count * settingNumber(settings.perCompletion, 0.008));
        const weighted = 1 + (raw - 1) * flowWeight("skill");
        return { value: weighted, label: "Личный опыт: " + stat.count + " закрытий на участке" };
    }

    function flowLevelForScore(score) {
        const value = Number(score) || 0;
        if (value >= 90000) return { key: "critical", label: "Критично" };
        if (value >= 55000) return { key: "high", label: "Высокий" };
        if (value >= 26000) return { key: "medium", label: "Средний" };
        return { key: "low", label: "Низкий" };
    }

    function weightedFlowComponent(value, key) {
        return Math.round((Number(value) || 0) * flowWeight(key));
    }

    function flowScoreTask(row, context, counts, groupIndex) {
        const items = taskItems(row);
        const price = reviewPrice(row);
        const priceComponent = weightedFlowComponent(Math.round(Math.min(price, 90000) + Math.sqrt(Math.max(price - 90000, 0)) * 80), "price");
        const urgency = flowUrgencyComponent(row);
        const urgencyComponent = weightedFlowComponent(urgency.value, "urgency");
        const source = flowSourceComponent(row);
        const sourceComponent = weightedFlowComponent(source.value, "source");
        const itemCount = Math.max(items.length || (Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids.length : 0), 1);
        const massComponent = itemCount > 1 ? weightedFlowComponent(Math.round((itemCount - 1) * 900 + Math.min(price * 0.18, 26000)), "mass") : 0;
        const createdTs = Date.parse(row && (row.created_at || row.updated_at) || "");
        const ageHours = Number.isFinite(createdTs) ? Math.max((Date.now() - createdTs) / 3600000, 0) : 0;
        const ageComponent = weightedFlowComponent(Math.round(Math.min(ageHours * 110, 14000)), "age");
        const reopenComponent = weightedFlowComponent(isReopenedTask(row) ? 16000 : row && row.reopened_at ? 8000 : 0, "reopen");
        const tags = reviewTags(row);
        const tagComponent = weightedFlowComponent(tags.some(isSpecialTagLabel) ? 7000 : 0, "tags");
        const lock = flowLockInfo(row);
        const lockComponent = lock.expired ? 1800 : 0;
        const group = flowGroupComponent(row, groupIndex || state.flow.groupIndex);
        const groupComponent = weightedFlowComponent(group.value, "group");
        const base = priceComponent + urgencyComponent + sourceComponent + massComponent + ageComponent + reopenComponent + tagComponent + lockComponent + groupComponent;
        const zone = flowZoneMultiplier(row, context, counts);
        const skill = flowSkillMultiplier(row, context);
        const score = Math.max(Math.round(base * zone.value * skill.value), 0);
        const level = flowLevelForScore(score);
        const reasons = [
            price ? "Риск: " + formatMoney(price) : "",
            urgency.label,
            source.value ? source.label : "",
            itemCount > 1 ? "Массовость: " + itemCount + " ШК" : "",
            group.label,
            reopenComponent ? "Переоткрытая задача" : "",
            tagComponent ? "Есть спец-тег: " + tags.filter(isSpecialTagLabel).join(", ") : "",
            zone.label,
            skill.value > 1 ? skill.label : "",
            lock.expired && lock.claimedByName ? "Lock истек, раньше смотрел " + lock.claimedByName : "",
        ].filter(Boolean);
        return {
            row,
            score,
            level,
            breakdown: {
                version: FLOW_SCORE_VERSION,
                price: priceComponent,
                urgency: urgencyComponent,
                source: sourceComponent,
                mass: massComponent,
                age: ageComponent,
                reopen: reopenComponent,
                tags: tagComponent,
                group: groupComponent,
                expired_lock: lockComponent,
                zone_multiplier: zone.value,
                skill_multiplier: skill.value,
                total: score,
            },
            group: group.group,
            reasons,
        };
    }

    function flowRowIsSkippedForCurrentUser(row, context) {
        return flowSkipCooldown(row, context).active;
    }

    function refreshFlowQueue() {
        const context = currentFlowEmployee();
        const activeRows = (state.review.rows || []).filter((row) => isActiveReviewTask(row) && !row.is_deleted);
        const counts = flowZoneCounts(activeRows);
        const groupIndex = buildFlowGroupIndex(activeRows);
        state.flow.groupIndex = groupIndex;
        const scored = activeRows
            .filter((row) => row.id !== state.flow.currentRowId)
            .filter((row) => !flowRowIsLockedForOther(row, context))
            .filter((row) => !flowStrictMismatch(row, context))
            .filter((row) => !flowRowIsSkippedForCurrentUser(row, context))
            .map((row) => flowScoreTask(row, context, counts, groupIndex))
            .sort((a, b) => b.score - a.score || reviewPrice(b.row) - reviewPrice(a.row) || String(a.row.created_at || "").localeCompare(String(b.row.created_at || "")));
        state.flow.rows = activeRows;
        state.flow.scored = scored;
        return scored;
    }

    function flowStats() {
        const context = currentFlowEmployee();
        const activeRows = state.flow.rows || [];
        const scored = state.flow.scored || [];
        const locked = activeRows.filter((row) => flowRowIsLockedForOther(row, context)).length;
        const skipped = activeRows.filter((row) => flowRowIsSkippedForCurrentUser(row, context)).length;
        const critical = scored.filter((item) => item.level.key === "critical").length;
        const requests = scored.filter((item) => requestSectionName(item.row) === "Запросы входящего потока").length;
        const reopened = scored.filter((item) => isReopenedTask(item.row)).length;
        const groups = new Set(scored.map((item) => item.group && item.group.key).filter(Boolean)).size;
        const bySection = new Map();
        scored.forEach((item) => {
            const section = flowTaskSection(item.row);
            bySection.set(section, (bySection.get(section) || 0) + 1);
        });
        const hotSection = Array.from(bySection.entries()).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
        return { active: activeRows.length, available: scored.length, locked, skipped, critical, requests, reopened, groups, hotSection };
    }

    function renderFlowPage() {
        if (!$("flowPage")) return;
        const status = $("flowStatus");
        if (status) {
            status.textContent = state.flow.status || "";
            status.style.color = state.flow.statusTone === "error" ? "#b91c1c" : state.flow.statusTone === "good" ? "#15803d" : "#64748b";
        }
        const stats = flowStats();
        const context = currentFlowEmployee();
        const hasShift = Boolean(state.shift.current);
        const currentRow = state.flow.currentRowId ? findTaskRow(state.flow.currentRowId) : null;
        const currentActive = Boolean(currentRow && isActiveReviewTask(currentRow));
        if (state.flow.currentRowId && !currentActive) {
            state.flow.currentRowId = "";
            state.flow.currentScore = null;
        }
        const canIssue = hasShift && !state.flow.loading && !state.flow.claiming && (currentActive || (state.flow.scored || []).length > 0);
        const note = $("flowCommandNote");
        if (note) {
            const zones = Array.from(context.zones).map((zone) => zone === "incoming" ? "входящий поток" : "исходящий поток");
            const skillNote = state.flow.employeeStats.loaded ? " Личный коэффициент включен." : " Личная статистика пока не загружена.";
            note.textContent = hasShift
                ? "Сотрудник: " + (context.name || context.id || "не определен") + ". Зоны: " + (zones.join(", ") || "не найден в смене") + ". Доступно задач: " + stats.available + "." + skillNote
                : "Сначала открой смену: Флоу должен знать ответственных за зоны.";
        }
        const next = $("flowNextTask");
        if (next) {
            next.disabled = !canIssue;
            next.textContent = state.flow.claiming ? "Выдаю..." : state.flow.loading ? "Считаю..." : currentActive ? "Открыть текущую" : hasShift ? "Получить задачу" : "Нужна смена";
        }
        const statWrap = $("flowStats");
        if (statWrap) {
            statWrap.innerHTML = [
                ["Доступно", stats.available + "/" + stats.active, "good"],
                ["Критичных", stats.critical, "critical"],
                ["Входящих запросов", stats.requests, ""],
                ["Переоткрытых", stats.reopened, ""],
                ["Групп", stats.groups, ""],
                ["Lock у других", stats.locked, ""],
                ["Скипнутых мной", stats.skipped, ""],
            ].map(([label, value, tone]) => "<div class='flow-stat " + escapeHtml(tone) + "'><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></div>").join("");
        }
        renderFlowCurrent();
        renderFlowQueuePreview();
    }

    function renderFlowCurrent() {
        const target = $("flowCurrent");
        if (!target) return;
        const row = state.flow.currentRowId ? findTaskRow(state.flow.currentRowId) : null;
        const scored = state.flow.currentScore;
        target.classList.toggle("visible", Boolean(row));
        if (!row) {
            target.innerHTML = "";
            return;
        }
        const score = scored || flowScoreTask(row, currentFlowEmployee(), flowZoneCounts(state.flow.rows || []), state.flow.groupIndex);
        const route = taskRouteLabel(row);
        target.innerHTML = "<div class='flow-current-head'>"
            + "<div><h3 class='flow-current-title'>" + escapeHtml(displayTaskTitle(row)) + "</h3>"
            + "<div class='flow-current-meta'>" + escapeHtml([flowTaskSection(row), flowTaskZoneLabel(row), route].filter(Boolean).join(" · ")) + "</div></div>"
            + "<span class='flow-score-pill'>Score " + escapeHtml(String(score.score)) + "</span>"
            + "</div>"
            + "<div class='flow-reasons'>" + score.reasons.slice(0, 8).map((reason) => "<div class='flow-reason'>" + escapeHtml(reason) + "</div>").join("") + "</div>"
            + "<div class='flow-actions'>"
            + "<button id='openClaimedFlowTask' class='btn btn-rect task-complete-btn' type='button'>Открыть flow-карточку</button>"
            + "<button id='skipClaimedFlowTask' class='btn btn-outline' type='button'>Скипнуть</button>"
            + "<button id='refreshFlowQueue' class='btn btn-outline' type='button'>Обновить очередь</button>"
            + "</div>";
        $("openClaimedFlowTask").addEventListener("click", () => openFlowTaskCard(row.id));
        $("skipClaimedFlowTask").addEventListener("click", () => openFlowSkipModal(row.id));
        $("refreshFlowQueue").addEventListener("click", () => {
            refreshFlowQueue();
            state.flow.status = "Очередь пересчитана.";
            state.flow.statusTone = "good";
            renderFlowPage();
        });
    }

    function renderFlowQueuePreview() {
        const target = $("flowQueuePreview");
        if (!target) return;
        const rows = (state.flow.scored || []).slice(0, 7);
        if (state.flow.loading) {
            target.innerHTML = "<div class='task-search-empty'>Считаю очередь...</div>";
            return;
        }
        if (!rows.length) {
            target.innerHTML = "<div class='task-search-empty'>Доступных задач нет. Либо всё закрыто, либо strict-зона не подходит текущему сотруднику, либо задачи временно скипнуты.</div>";
            return;
        }
        target.innerHTML = rows.map((item) => {
            const row = item.row;
            const route = taskRouteLabel(row);
            const group = item.group ? "Группа " + item.group.count : "";
            return "<div class='flow-queue-row'>"
                + "<div><strong>" + escapeHtml(displayTaskTitle(row)) + "</strong>"
                + "<span>" + escapeHtml([flowTaskSection(row), flowTaskZoneLabel(row), route, group, formatMoney(reviewPrice(row))].filter(Boolean).join(" · ")) + "</span></div>"
                + "<span class='flow-level " + escapeHtml(item.level.key) + "'>" + escapeHtml(item.level.label + " · " + item.score) + "</span>"
                + "</div>";
        }).join("");
    }

    async function fetchFreshTaskRow(id) {
        const db = supabaseDb();
        if (!db || !id) return findTaskRow(id);
        const { data, error } = await db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).eq("id", id).single();
        if (error) throw error;
        refreshTaskRow(id, data);
        return findTaskRow(id) || data;
    }

    async function writeTaskHistory(row, eventType, payload) {
        const db = supabaseDb();
        if (!db || !row || !row.id) return;
        const actor = flowActor();
        try {
            await db.from(FLOW_HISTORY_TABLE).insert({
                task_id: row.id,
                event_type: eventType,
                actor_employee_id: actor.id || null,
                actor_name: actor.name || null,
                payload: payload || {},
            });
        } catch (error) {
            console.warn("flow history write skipped:", error);
        }
    }

    async function claimFlowTask(row, scored) {
        const db = supabaseDb();
        if (!db || !row) throw new Error("Supabase недоступен.");
        const fresh = await fetchFreshTaskRow(row.id);
        const context = currentFlowEmployee();
        if (flowRowIsLockedForOther(fresh, context)) {
            state.flow.conflictRowId = fresh.id;
            renderFlowConflictModal(fresh);
            setFlowModalOpen("flowConflictModal", true);
            throw new Error("Задача уже открыта другим сотрудником.");
        }
        const actor = flowActor();
        const now = new Date().toISOString();
        const lockMinutes = Math.max(flowSettingNumber("lockTtlMinutes", 15), 1);
        const lockUntil = new Date(Date.now() + lockMinutes * 60 * 1000).toISOString();
        const previousFlow = flowPayload(fresh);
        const claimEvent = {
            claimed_by_id: actor.id,
            claimed_by_name: actor.name || "",
            claimed_at: now,
            lock_until: lockUntil,
            score: scored.score,
        };
        const nextPayload = {
            ...taskPayload(fresh),
            wms_flow: {
                ...previousFlow,
                status: "claimed",
                claimed_by_id: actor.id,
                claimed_by_name: actor.name || "",
                claimed_at: now,
                lock_until: lockUntil,
                score: scored.score,
                score_level: scored.level.label,
                score_version: FLOW_SCORE_VERSION,
                score_breakdown: scored.breakdown,
                score_reasons: scored.reasons,
                group: scored.group || null,
                claim_history: [...(Array.isArray(previousFlow.claim_history) ? previousFlow.claim_history : []), claimEvent].slice(-20),
            },
        };
        const patch = {
            task_status: "В работе",
            assignee_employee_id: actor.id || fresh.assignee_employee_id || null,
            assignee_name: actor.name || fresh.assignee_name || null,
            source_payload: nextPayload,
            updated_at: now,
        };
        const { data, error } = await db
            .from(WMS_TASKS_TABLE)
            .update(patch)
            .eq("id", fresh.id)
            .select(WMS_TASK_SELECT_COLUMNS)
            .single();
        if (error) throw error;
        refreshTaskRow(fresh.id, data || patch);
        const updated = findTaskRow(fresh.id) || { ...fresh, ...(data || patch) };
        void writeTaskHistory(updated, "task_claimed", { score: scored.score, reasons: scored.reasons, group: scored.group || null, lock_until: lockUntil });
        return updated;
    }

    async function issueNextFlowTask() {
        if (state.flow.claiming) return;
        if (!state.shift.current) {
            toast("Сначала нужно открыть смену.", "error");
            openShiftOpeningModal();
            return;
        }
        const currentRow = state.flow.currentRowId ? findTaskRow(state.flow.currentRowId) : null;
        if (currentRow && isActiveReviewTask(currentRow)) {
            openFlowTaskCard(currentRow.id);
            return;
        }
        state.flow.claiming = true;
        state.flow.status = "Выбираю следующую задачу...";
        state.flow.statusTone = "";
        renderFlowPage();
        try {
            await ensureReviewTasksLoaded();
            const scored = refreshFlowQueue();
            const next = scored[0];
            if (!next) {
                state.flow.status = "Доступных задач для текущего сотрудника нет.";
                state.flow.statusTone = "good";
                return;
            }
            const row = await claimFlowTask(next.row, next);
            state.flow.currentRowId = row.id;
            state.flow.currentScore = next;
            refreshFlowQueue();
            state.flow.status = "Задача выдана и закреплена на " + flowSettingNumber("lockTtlMinutes", 15) + " минут: " + displayTaskTitle(row) + ".";
            state.flow.statusTone = "good";
            renderFlowPage();
            openFlowTaskCard(row.id);
        } catch (error) {
            console.error("flow claim failed:", error);
            if (normalizeText(error && error.message) !== "Задача уже открыта другим сотрудником.") {
                state.flow.status = "Не удалось выдать задачу: " + (error && error.message ? error.message : String(error));
                state.flow.statusTone = "error";
            }
        } finally {
            state.flow.claiming = false;
            renderFlowPage();
        }
    }

    function flowGroupBoxHtml(group, currentId) {
        if (!group) return "";
        const rows = (group.sample || []).map((item) => "<div class='flow-group-row'>"
            + escapeHtml(item.title || item.shk || "-")
            + "<span>" + escapeHtml([item.section, item.shk ? "ШК " + item.shk : "", formatMoney(item.price)].filter(Boolean).join(" · ")) + "</span>"
            + "</div>").join("");
        return "<section class='flow-task-panel'>"
            + "<h4>Похожая пачка</h4>"
            + "<div class='flow-conflict-box'>Экспериментально: WMS+ видит общий паттерн по МХ, статусу и 2-часовому окну. Задачи не объединяются в базе, но Флоу поднимает приоритет пачки.</div>"
            + "<div class='flow-group-list' style='margin-top:10px'>" + (rows || "<div class='task-search-empty'>Группа есть, но сэмпл пуст.</div>") + "</div>"
            + "<div class='review-table-subtitle' style='margin-top:10px'>Всего в группе: " + escapeHtml(String(group.count || 0)) + " · " + escapeHtml(formatMoney(group.totalPrice || 0)) + (currentId ? "" : "") + "</div>"
            + "</section>";
    }

    function bindFlowCopyEvents(target, row) {
        target.querySelectorAll("[data-copy-value]").forEach((field) => {
            field.addEventListener("click", async () => {
                const text = field.dataset.copyValue || "";
                if (!text) return;
                const copied = await copyText(text);
                toast(copied ? "Скопировано." : "Браузер заблокировал копирование.", copied ? "success" : "error");
            });
        });
        target.querySelectorAll("[data-copy-shk]").forEach((button) => {
            button.addEventListener("click", async () => {
                const text = button.dataset.copyShk || "";
                if (!text) return;
                const copied = await copyText(text);
                toast(copied ? "Список ШК скопирован." : "Браузер заблокировал копирование.", copied ? "success" : "error");
            });
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
    }

    function renderFlowTaskCard(row) {
        const target = $("flowTaskWrap");
        if (!target || !row) return;
        const context = currentFlowEmployee();
        const score = state.flow.currentScore && state.flow.currentScore.row && state.flow.currentScore.row.id === row.id
            ? state.flow.currentScore
            : flowScoreTask(row, context, flowZoneCounts(state.flow.rows || []), state.flow.groupIndex);
        const lock = flowLockInfo(row);
        const conflict = flowRowIsLockedForOther(row, context);
        const route = taskRouteLabel(row);
        const lockText = lock.active
            ? "Lock до " + formatRuDateTime(new Date(lock.lockUntil).toISOString()) + (lock.claimedByName ? " · " + lock.claimedByName : "")
            : lock.expired
            ? "Lock истек"
            : "Lock свободен";
        const conflictBox = conflict
            ? "<div class='flow-conflict-box'>С этой задачей уже работает " + escapeHtml(lock.claimedByName || lock.claimedById || "другой сотрудник") + ". Можно открыть для сверки, но лучше взять другую, чтобы не бодаться лбами в одном проходе.</div>"
            : "";
        target.innerHTML = "<div class='flow-task-hero'>"
            + "<div class='flow-task-head'><div><h3 class='flow-task-title'>" + escapeHtml(displayTaskTitle(row)) + "</h3>"
            + "<p class='flow-task-subtitle'>" + escapeHtml([flowTaskSection(row), flowTaskZoneLabel(row), route, lockText].filter(Boolean).join(" · ")) + "</p></div>"
            + "<button id='closeFlowTaskCard' class='btn btn-square' type='button'>×</button></div>"
            + "<div class='flow-task-score'>"
            + "<span>Score " + escapeHtml(String(score.score)) + "</span>"
            + "<span>" + escapeHtml(score.level.label) + "</span>"
            + "<span>" + escapeHtml(formatMoney(reviewPrice(row))) + "</span>"
            + "</div></div>"
            + "<div class='flow-task-body'>"
            + conflictBox
            + "<div class='flow-task-grid'>"
            + "<section class='flow-task-panel'><h4>Почему эта задача</h4><div class='flow-reasons'>" + score.reasons.slice(0, 10).map((reason) => "<div class='flow-reason'>" + escapeHtml(reason) + "</div>").join("") + "</div></section>"
            + "<section class='flow-task-panel'><h4>Инфо по задаче</h4><div class='task-info-grid'>" + taskDetailInfo(row) + "</div>" + taskTagsBox(row) + "</section>"
            + "</div>"
            + incomingFlowShkInfoBox(row)
            + taskTareInfoBox(row, true)
            + taskHistoryBox(row)
            + flowGroupBoxHtml(score.group, row.id)
            + "<div class='flow-actions'>"
            + (conflict ? "<button id='flowOpenAnyway' class='btn btn-outline' type='button'>Открыть всё равно</button><button id='flowTakeAnotherFromCard' class='btn btn-rect' type='button'>Взять другую</button>" : "<button id='flowStartReview' class='btn btn-rect task-complete-btn' type='button'>Начать разбор</button>")
            + "<button id='flowSkipFromCard' class='btn btn-outline' type='button'>Скипнуть с причиной</button>"
            + "</div>"
            + "</div>";
        $("closeFlowTaskCard").addEventListener("click", closeFlowTaskCard);
        const start = $("flowStartReview");
        if (start) start.addEventListener("click", () => openTaskDetailFromFlow(row.id));
        const skip = $("flowSkipFromCard");
        if (skip) skip.addEventListener("click", () => openFlowSkipModal(row.id));
        const anyway = $("flowOpenAnyway");
        if (anyway) anyway.addEventListener("click", () => {
            state.flow.allowConflictOpenId = row.id;
            openTaskDetailFromFlow(row.id);
        });
        const another = $("flowTakeAnotherFromCard");
        if (another) another.addEventListener("click", () => {
            closeFlowTaskCard();
            if (state.flow.currentRowId === row.id) {
                state.flow.currentRowId = "";
                state.flow.currentScore = null;
            }
            refreshFlowQueue();
            renderFlowPage();
            void issueNextFlowTask();
        });
        bindFlowCopyEvents(target, row);
    }

    function openFlowTaskCard(id) {
        const row = findTaskRow(id);
        if (!row) return;
        state.flow.taskCardRowId = id;
        renderFlowTaskCard(row);
        setFlowModalOpen("flowTaskModal", true);
    }

    function closeFlowTaskCard() {
        state.flow.taskCardRowId = "";
        setFlowModalOpen("flowTaskModal", false);
    }

    function openTaskDetailFromFlow(id) {
        const row = findTaskRow(id);
        if (!row) return;
        if (flowRowIsLockedForOther(row, currentFlowEmployee()) && state.flow.allowConflictOpenId !== id) {
            openFlowConflictModal(id);
            return;
        }
        closeFlowTaskCard();
        openTaskDetail(id, "review");
        state.flow.allowConflictOpenId = "";
    }

    function openFlowSkipModal(id) {
        const row = findTaskRow(id);
        if (!row) return;
        state.flow.skipRowId = id;
        const reason = $("flowSkipReason");
        const status = $("flowSkipStatus");
        if (reason) reason.value = "";
        if (status) status.textContent = "";
        updateFlowSkipForm();
        setFlowModalOpen("flowSkipModal", true);
    }

    function closeFlowSkipModal() {
        state.flow.skipRowId = "";
        setFlowModalOpen("flowSkipModal", false);
    }

    function updateFlowSkipForm() {
        const reason = normalizeText($("flowSkipReason") && $("flowSkipReason").value);
        const button = $("confirmFlowSkip");
        if (button) {
            button.disabled = reason.length < 3 || state.flow.skipSaving;
            button.title = reason.length < 3 ? "Нужна причина скипа" : "";
        }
    }

    async function skipFlowTaskFromModal() {
        const id = state.flow.skipRowId;
        const db = supabaseDb();
        const row = findTaskRow(id);
        const reason = normalizeText($("flowSkipReason") && $("flowSkipReason").value);
        const status = $("flowSkipStatus");
        if (!db || !row || !reason) return;
        const actor = flowActor();
        const lock = flowLockInfo(row);
        const ownClaim = !lock.claimedById || (actor.id && lock.claimedById === actor.id);
        const now = new Date().toISOString();
        const cooldownUntil = new Date(Date.now() + FLOW_SKIP_COOLDOWN_MS).toISOString();
        const previousFlow = flowPayload(row);
        const skipEvent = {
            skipped_by_id: actor.id || "",
            skipped_by_name: actor.name || "",
            skipped_at: now,
            reason,
            cooldown_until: cooldownUntil,
            previous_score: previousFlow.score || null,
        };
        const cooldowns = previousFlow.skip_cooldowns && typeof previousFlow.skip_cooldowns === "object" && !Array.isArray(previousFlow.skip_cooldowns)
            ? { ...previousFlow.skip_cooldowns }
            : {};
        if (actor.id) cooldowns[actor.id] = { until: cooldownUntil, reason, skipped_at: now };
        const nextPayload = {
            ...taskPayload(row),
            wms_flow: {
                ...previousFlow,
                status: ownClaim ? "skipped" : previousFlow.status || "skipped_for_actor",
                claimed_by_id: ownClaim ? "" : previousFlow.claimed_by_id,
                claimed_by_name: ownClaim ? "" : previousFlow.claimed_by_name,
                lock_until: ownClaim ? now : previousFlow.lock_until,
                last_skip: skipEvent,
                skip_cooldowns: cooldowns,
                skip_history: [...(Array.isArray(previousFlow.skip_history) ? previousFlow.skip_history : []), skipEvent].slice(-50),
            },
        };
        const sameAssignee = actor.id && normalizeIdentifier(row.assignee_employee_id) === actor.id;
        const patch = {
            task_status: ownClaim ? "Не начато" : taskStatus(row),
            assignee_employee_id: ownClaim && sameAssignee ? null : row.assignee_employee_id || null,
            assignee_name: ownClaim && sameAssignee ? null : row.assignee_name || null,
            source_payload: nextPayload,
            updated_at: now,
        };
        state.flow.skipSaving = true;
        updateFlowSkipForm();
        if (status) status.textContent = "Сохраняю скип...";
        try {
            const { data, error } = await db
                .from(WMS_TASKS_TABLE)
                .update(patch)
                .eq("id", id)
                .select(WMS_TASK_SELECT_COLUMNS)
                .single();
            if (error) throw error;
            refreshTaskRow(id, data || patch);
            void writeTaskHistory(findTaskRow(id) || row, "task_skipped", skipEvent);
            if (state.flow.currentRowId === id) {
                state.flow.currentRowId = "";
                state.flow.currentScore = null;
            }
            closeFlowSkipModal();
            closeFlowTaskCard();
            refreshFlowQueue();
            renderFlowPage();
            toast("Скип записан. Беру следующую.", "success");
            void issueNextFlowTask();
        } catch (error) {
            console.error("flow skip failed:", error);
            if (status) status.textContent = "Не удалось скипнуть: " + (error && error.message ? error.message : String(error));
        } finally {
            state.flow.skipSaving = false;
            updateFlowSkipForm();
        }
    }

    function renderFlowConflictModal(row) {
        const target = $("flowConflictWrap");
        if (!target || !row) return;
        const lock = flowLockInfo(row);
        target.innerHTML = "<div class='work-head'><div><h3 class='work-title'>Задача уже в работе</h3>"
            + "<p class='work-subtitle'>" + escapeHtml(displayTaskTitle(row)) + "</p></div>"
            + "<button id='closeFlowConflict' class='btn btn-square' type='button'>×</button></div>"
            + "<div class='flow-conflict-box'>Сейчас ее держит " + escapeHtml(lock.claimedByName || lock.claimedById || "другой сотрудник") + ". Lock до " + escapeHtml(lock.lockUntil ? formatRuDateTime(new Date(lock.lockUntil).toISOString()) : "-") + ". Если вы правда оба там, один может спокойно взять другую задачу.</div>"
            + "<div class='file-row'>"
            + "<button id='flowConflictTakeOther' class='btn btn-rect' type='button'>Взять другую</button>"
            + "<button id='flowConflictOpenAnyway' class='btn btn-outline' type='button'>Открыть всё равно</button>"
            + "</div>";
        $("closeFlowConflict").addEventListener("click", closeFlowConflictModal);
        $("flowConflictTakeOther").addEventListener("click", () => {
            closeFlowConflictModal();
            if (state.flow.currentRowId === row.id) {
                state.flow.currentRowId = "";
                state.flow.currentScore = null;
            }
            refreshFlowQueue();
            renderFlowPage();
            void issueNextFlowTask();
        });
        $("flowConflictOpenAnyway").addEventListener("click", () => {
            state.flow.allowConflictOpenId = row.id;
            closeFlowConflictModal();
            openTaskDetail(row.id, "review");
        });
    }

    function openFlowConflictModal(id) {
        const row = findTaskRow(id);
        if (!row) return;
        state.flow.conflictRowId = id;
        renderFlowConflictModal(row);
        setFlowModalOpen("flowConflictModal", true);
    }

    function closeFlowConflictModal() {
        state.flow.conflictRowId = "";
        setFlowModalOpen("flowConflictModal", false);
    }

    function flowSettingFields() {
        return [
            { path: "lockTtlMinutes", label: "Lock задачи, минут", step: 1, min: 1 },
            { path: "weights.price", label: "Вес стоимости", step: 0.1, min: 0 },
            { path: "weights.urgency", label: "Вес срочности", step: 0.1, min: 0 },
            { path: "weights.source", label: "Вес источника задачи", step: 0.1, min: 0 },
            { path: "weights.mass", label: "Вес массовости", step: 0.1, min: 0 },
            { path: "weights.age", label: "Вес возраста задачи", step: 0.1, min: 0 },
            { path: "weights.reopen", label: "Вес переоткрытия", step: 0.1, min: 0 },
            { path: "weights.group", label: "Вес группового паттерна", step: 0.1, min: 0 },
            { path: "weights.skill", label: "Вес личного опыта", step: 0.1, min: 0 },
            { path: "sourceBoosts.incomingFlowRequests", label: "Бонус: входящий запрос", step: 1000, min: 0 },
            { path: "sourceBoosts.awhWriteoffs", label: "Бонус: AWH", step: 1000, min: 0 },
            { path: "sourceBoosts.incomingBoxes", label: "Бонус: коробки на входе", step: 1000, min: 0 },
            { path: "grouping.enabled", label: "Группировка MX + статус + 2ч", type: "checkbox" },
            { path: "grouping.minCount", label: "Минимум задач в группе", step: 1, min: 2 },
            { path: "grouping.windowMinutes", label: "Окно группировки, минут", step: 15, min: 15 },
            { path: "skill.lookbackDays", label: "Личный опыт: дней назад", step: 1, min: 1 },
        ];
    }

    function flowGetNestedSetting(path) {
        const parts = String(path || "").split(".").filter(Boolean);
        let value = flowSettings();
        for (const part of parts) {
            if (!value || typeof value !== "object") return undefined;
            value = value[part];
        }
        return value;
    }

    function renderFlowSettingsModal() {
        const target = $("flowSettingsWrap");
        if (!target) return;
        target.innerHTML = flowSettingFields().map((field) => {
            const value = flowGetNestedSetting(field.path);
            if (field.type === "checkbox") {
                return "<div class='flow-setting-field checkbox'><label for='flowSetting_" + escapeHtml(field.path) + "'>" + escapeHtml(field.label) + "</label>"
                    + "<input id='flowSetting_" + escapeHtml(field.path) + "' data-flow-setting='" + escapeHtml(field.path) + "' type='checkbox' " + (value !== false ? "checked" : "") + "></div>";
            }
            return "<div class='flow-setting-field'><label for='flowSetting_" + escapeHtml(field.path) + "'>" + escapeHtml(field.label) + "</label>"
                + "<input id='flowSetting_" + escapeHtml(field.path) + "' data-flow-setting='" + escapeHtml(field.path) + "' type='number' min='" + escapeHtml(field.min ?? 0) + "' step='" + escapeHtml(field.step || 1) + "' value='" + escapeHtml(value) + "'></div>";
        }).join("");
        target.querySelectorAll("[data-flow-setting]").forEach((input) => {
            input.addEventListener("input", () => {
                const path = input.dataset.flowSetting;
                const value = input.type === "checkbox" ? input.checked : settingNumber(input.value, flowGetNestedSetting(path));
                flowSetNestedSetting(path, value);
                refreshFlowQueue();
                renderFlowPage();
            });
        });
    }

    function openFlowSettingsModal() {
        const status = $("flowSettingsStatus");
        if (status) status.textContent = state.flow.settingsLoaded ? "Настройки загружены." : "Работаю на дефолтных настройках. Если миграция применена, можно сохранить их в Supabase.";
        renderFlowSettingsModal();
        setFlowModalOpen("flowSettingsModal", true);
    }

    function closeFlowSettingsModal() {
        setFlowModalOpen("flowSettingsModal", false);
    }

    function normalizeFlowSettingsPayload(raw) {
        const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
        const converted = { ...input };
        if (input.lock_ttl_minutes !== undefined && converted.lockTtlMinutes === undefined) converted.lockTtlMinutes = input.lock_ttl_minutes;
        return deepMergeObject(DEFAULT_FLOW_SCORE_SETTINGS, converted);
    }

    async function loadFlowSettings() {
        if (state.flow.settingsLoaded) return;
        const db = supabaseDb();
        if (!db) return;
        try {
            const read = await readOptionalRows(db, FLOW_SETTINGS_TABLE, (query) => query
                .select("*")
                .eq("is_active", true)
                .order("updated_at", { ascending: false, nullsFirst: false })
                .limit(1));
            const row = read.ok && read.rows && read.rows[0] ? read.rows[0] : null;
            if (row) state.flow.settings = normalizeFlowSettingsPayload(row.settings);
            state.flow.settingsLoaded = true;
        } catch (error) {
            console.warn("flow settings load skipped:", error);
        }
    }

    async function saveFlowSettingsFromModal() {
        const db = supabaseDb();
        const status = $("flowSettingsStatus");
        const button = $("saveFlowSettings");
        if (!db) {
            if (status) status.textContent = "Supabase недоступен, настройки применены только на этой странице.";
            return;
        }
        if (button) button.disabled = true;
        if (status) status.textContent = "Сохраняю настройки...";
        try {
            const settings = flowSettings();
            const { error } = await db.from(FLOW_SETTINGS_TABLE).upsert({
                version: FLOW_SCORE_VERSION,
                is_active: true,
                settings: { ...settings, lock_ttl_minutes: settings.lockTtlMinutes },
                updated_at: new Date().toISOString(),
            }, { onConflict: "version" });
            if (error) throw error;
            state.flow.settingsLoaded = true;
            refreshFlowQueue();
            renderFlowPage();
            if (status) status.textContent = "Настройки сохранены. Очередь пересчитана.";
        } catch (error) {
            if (status) status.textContent = "Не удалось сохранить: " + (error && error.message ? error.message : String(error));
        } finally {
            if (button) button.disabled = false;
        }
    }

    function resetFlowSettingsFromModal() {
        state.flow.settings = cloneFlowSettings(DEFAULT_FLOW_SCORE_SETTINGS);
        refreshFlowQueue();
        renderFlowPage();
        renderFlowSettingsModal();
        const status = $("flowSettingsStatus");
        if (status) status.textContent = "Сброшено к дефолту. Нажми “Сохранить веса”, если нужно записать в Supabase.";
    }

    async function loadFlowEmployeeStats() {
        const db = supabaseDb();
        if (!db) return;
        const actor = flowActor();
        const settings = flowSettings().skill || {};
        const lookback = Math.max(settingNumber(settings.lookbackDays, 14), 1);
        if (!actor.id && !actor.name) return;
        try {
            let query = db
                .from(WMS_TASKS_TABLE)
                .select(WMS_TASK_SELECT_COLUMNS)
                .eq("task_status", "Завершено")
                .gte("completed_at", addDays(state.today, -lookback) + "T00:00:00Z")
                .order("completed_at", { ascending: false, nullsFirst: false })
                .limit(2000);
            const { data, error } = await query;
            if (error) throw error;
            const bySection = {};
            (data || []).filter((row) => isManualAchievementTask(row) && taskCompletedByMatches(row, actor)).forEach((row) => {
                const section = flowTaskSection(row);
                if (!bySection[section]) bySection[section] = { count: 0 };
                bySection[section].count += 1;
            });
            state.flow.employeeStats = {
                bySection,
                loaded: true,
                note: "Учтены ручные закрытия за " + lookback + " дней.",
            };
        } catch (error) {
            state.flow.employeeStats = { bySection: {}, loaded: false, note: "Личная статистика недоступна." };
            console.warn("flow employee stats skipped:", error);
        }
    }

    function reviewGroupedRows() {
        const grouped = new Map(REVIEW_SECTIONS.map((section) => [section, []]));
        (state.review.rows || []).forEach((row) => {
            if (isPrespisokTask(row) || requestSectionName(row)) return;
            const section = grouped.has(taskSectionName(row)) ? taskSectionName(row) : "Другие задачи";
            grouped.get(section).push(row);
        });
        return grouped;
    }

    function reviewCanvasRows() {
        return (state.review.rows || []).filter((row) => isActiveReviewTask(row) && !isPrespisokTask(row) && !requestSectionName(row));
    }

    function requestsGroupedRows() {
        const grouped = new Map(REQUEST_SECTIONS.map((section) => [section, []]));
        (state.review.rows || []).forEach((row) => {
            const section = requestSectionName(row);
            if (section && grouped.has(section)) grouped.get(section).push(row);
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

    function isAfterSaleMovementTask(row) {
        const combined = normalizeForMatch([row && row.source_module, row && row.upload_type, row && row.task_type, row && row.title].join(" "));
        return combined.includes("after_sale_movement") || combined.includes("движение после продажи") || /\bors\b/.test(combined);
    }

    function canSystemActualizeMovement(row) {
        return !isAfterSaleMovementTask(row);
    }

    function afterSaleDedupeDateForItem(row, item) {
        return parseDateTime(item && item.movement).date
            || parseDateTime(row && row.source_last_movement_at).date
            || normalizeText(row && row.upload_effective_date).slice(0, 10)
            || parseDateTime(row && row.created_at).date
            || "";
    }

    function afterSaleDedupeKey(shk, date) {
        const cleanShk = normalizeIdentifier(shk);
        const cleanDate = normalizeText(date).slice(0, 10);
        return cleanShk && cleanDate ? cleanShk + "|" + cleanDate : "";
    }

    function addAfterSaleTaskToDedupeIndex(index, row) {
        if (!index || !isAfterSaleMovementTask(row)) return;
        const items = taskItems(row);
        const sourceIds = Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids.map(normalizeIdentifier).filter(Boolean) : [];
        const rows = items.length ? items : sourceIds.map((shk) => ({ shk, movement: "" }));
        rows.forEach((item) => {
            const key = afterSaleDedupeKey(item.shk, afterSaleDedupeDateForItem(row, item));
            if (key && !index.has(key)) index.set(key, row);
        });
    }

    function buildAfterSaleDedupeIndex(rows) {
        const index = new Map();
        (rows || []).forEach((row) => addAfterSaleTaskToDedupeIndex(index, row));
        return index;
    }

    function afterSaleDedupeMatch(row, item, index) {
        const key = afterSaleDedupeKey(item && item.shk, afterSaleDedupeDateForItem(row, item));
        const matchedTask = key && index ? index.get(key) : null;
        return matchedTask ? { key, task: matchedTask, date: key.split("|")[1] || "" } : null;
    }

    async function loadAfterSaleDedupeIndexForTasks(db, tasks, extraAfterSaleRows) {
        const index = buildAfterSaleDedupeIndex(extraAfterSaleRows || []);
        const ids = productIdsFromTasks(tasks);
        if (!db || !ids.length) return index;
        for (const chunk of chunkArray(ids, 80)) {
            const { data, error } = await db
                .from(WMS_TASKS_TABLE)
                .select(WMS_TASK_SELECT_COLUMNS)
                .eq("is_deleted", false)
                .overlaps("source_shk_ids", chunk)
                .order("updated_at", { ascending: false, nullsFirst: false })
                .limit(10000);
            if (error) throw error;
            (data || []).filter(isAfterSaleMovementTask).forEach((row) => addAfterSaleTaskToDedupeIndex(index, row));
        }
        return index;
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

    function sectionFilterState(mode) {
        const holder = mode === "requests" ? state.requests : mode === "canvas" ? state.reviewCanvas : state.review;
        if (!holder.filters) holder.filters = createReviewFilterState();
        return holder.filters;
    }

    function resetSectionFilters(mode) {
        const holder = mode === "requests" ? state.requests : mode === "canvas" ? state.reviewCanvas : state.review;
        holder.filters = createReviewFilterState();
    }

    function taskFilterDate(row) {
        return parseDateTime(row && row.due_date).date
            || parseDateTime(row && row.upload_effective_date).date
            || parseDateTime(row && row.source_last_movement_at).date
            || parseDateTime(row && row.created_at).date;
    }

    function taskMovementStatusOptions(row) {
        const result = new Set();
        taskItems(row).forEach((item) => {
            const code = latinStatusCode(item.status);
            const value = code || normalizeText(item.status);
            if (value) result.add(value);
        });
        return Array.from(result);
    }

    function taskEntityFilterValue(row) {
        return isTareTask(row) ? "tare" : "shk";
    }

    function taskEntityFilterLabel(value) {
        return value === "tare" ? "Тары" : "ШК";
    }

    function taskStatusFilterValue(row) {
        return displayTaskStatus(row) || "Не начато";
    }

    function sortedUnique(values) {
        return Array.from(new Set((values || []).map(normalizeText).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));
    }

    function dateLevelForRows(rows) {
        const hasRed = (rows || []).some((row) => reviewPrice(row) > 5000);
        if (hasRed) return "red";
        const hasYellow = (rows || []).some((row) => reviewPrice(row) > 1000);
        return hasYellow ? "yellow" : "";
    }

    function sectionDateBuckets(rows) {
        const buckets = new Map();
        (rows || []).forEach((row) => {
            const date = taskFilterDate(row);
            if (!date) return;
            const bucket = buckets.get(date) || [];
            bucket.push(row);
            buckets.set(date, bucket);
        });
        return buckets;
    }

    function calendarStartMonday(isoDate) {
        if (!isoDate) return "";
        const date = new Date(isoDate + "T00:00:00Z");
        const day = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() - day + 1);
        return date.toISOString().slice(0, 10);
    }

    function calendarEndSunday(isoDate) {
        if (!isoDate) return "";
        const date = new Date(isoDate + "T00:00:00Z");
        const day = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + (7 - day));
        return date.toISOString().slice(0, 10);
    }

    function filterMatchesSet(value, selectedSet) {
        if (selectedSet && selectedSet.has(FILTER_NONE)) return false;
        return !selectedSet || !selectedSet.size || selectedSet.has(value);
    }

    function applySectionFilters(mode, rows) {
        const filters = sectionFilterState(mode);
        return (rows || []).filter((row) => {
            const date = taskFilterDate(row);
            if (filters.date === FILTER_NONE) return false;
            if (filters.date && date !== filters.date) return false;
            const movementOptions = taskMovementStatusOptions(row);
            if (filters.movementStatuses.size && !movementOptions.some((value) => filters.movementStatuses.has(value))) return false;
            if (!filterMatchesSet(taskEntityFilterValue(row), filters.entityTypes)) return false;
            if (!filterMatchesSet(taskStatusFilterValue(row), filters.taskStatuses)) return false;
            if (mode === "canvas" && !filterMatchesSet(taskSectionName(row), filters.sectionNames)) return false;
            return true;
        });
    }

    function filterOptionsForRows(rows) {
        return {
            movementStatuses: sortedUnique((rows || []).flatMap(taskMovementStatusOptions)),
            entityTypes: ["shk", "tare"].filter((value) => (rows || []).some((row) => taskEntityFilterValue(row) === value)),
            taskStatuses: sortedUnique((rows || []).map(taskStatusFilterValue)),
            sectionNames: REVIEW_SECTIONS.filter((section) => (rows || []).some((row) => taskSectionName(row) === section)),
        };
    }

    function filterSummaryText(mode, filterKey, options, labelForValue) {
        const filters = sectionFilterState(mode);
        const selected = filters[filterKey] || new Set();
        if (!options.length) return "Нет значений";
        if (selected.has(FILTER_NONE)) return "Ничего не выбрано";
        if (!selected.size || selected.size >= options.length) return "Выбраны все";
        if (selected.size === 1) {
            const value = Array.from(selected)[0];
            return labelForValue ? labelForValue(value) : value;
        }
        return "Выбрано: " + selected.size;
    }

    function renderFilterCheckboxes(mode, filterKey, options, labelForValue) {
        const filters = sectionFilterState(mode);
        const selected = filters[filterKey] || new Set();
        const noneChecked = selected.has(FILTER_NONE);
        const allChecked = !noneChecked && (!selected.size || selected.size >= options.length);
        if (!options.length) return "<div class='review-filter-empty-note'>Нет значений.</div>";
        return "<div class='review-filter-options'>"
            + "<label class='review-filter-check'><input type='checkbox' data-review-filter-all='" + escapeHtml(filterKey) + "' " + (allChecked ? "checked" : "") + "> Выбрать всё</label>"
            + options.map((value) => {
            const label = labelForValue ? labelForValue(value) : value;
            return "<label class='review-filter-check'><input type='checkbox' data-review-filter='" + escapeHtml(filterKey) + "' value='" + escapeHtml(value) + "' " + (allChecked || selected.has(value) ? "checked" : "") + "> " + escapeHtml(label) + "</label>";
        }).join("") + "</div>";
    }

    function renderFilterCalendar(mode, rows) {
        const filters = sectionFilterState(mode);
        const buckets = sectionDateBuckets(rows);
        const dates = Array.from(buckets.keys()).sort();
        if (!dates.length) return "<div class='review-filter-empty-note'>Нет дат.</div>";
        const start = calendarStartMonday(dates[0]);
        const end = calendarEndSunday(dates[dates.length - 1]);
        const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => "<span class='review-filter-weekday'>" + day + "</span>").join("");
        const cells = [];
        for (let current = start; current && current <= end; current = addDays(current, 1)) {
            const bucket = buckets.get(current) || [];
            if (!bucket.length) {
                cells.push("<span class='review-filter-empty'></span>");
                continue;
            }
            const level = dateLevelForRows(bucket);
            cells.push("<button class='review-filter-day" + (level ? " level-" + level : "") + (filters.date === current ? " is-selected" : "") + "' type='button' data-review-filter-date='" + escapeHtml(current) + "' title='" + escapeHtml(formatRuDate(current) + " · " + bucket.length + " задач") + "'>" + Number(current.slice(8, 10)) + "</button>");
        }
        return "<div class='review-filter-calendar'>" + weekdays + cells.join("") + "</div>";
    }

    function renderSectionFilters(mode, baseRows, filteredRows) {
        const options = filterOptionsForRows(baseRows);
        const filters = sectionFilterState(mode);
        const dateSummary = filters.date === FILTER_NONE ? "Ничего не выбрано" : filters.date ? formatRuDate(filters.date) : "Выбраны все";
        const control = (key, title, summary, body) => "<div class='review-filter-block" + (filters.openKey === key ? " is-open" : "") + "'>"
            + "<span class='review-filter-title'>" + escapeHtml(title) + "</span>"
            + "<button class='review-filter-trigger' type='button' data-review-filter-toggle='" + escapeHtml(key) + "'><span class='review-filter-summary'>" + escapeHtml(summary) + "</span><span class='review-filter-chevron'>⌄</span></button>"
            + "<div class='review-filter-popover'><p class='review-filter-menu-title'>" + escapeHtml(title) + "</p>" + body + "</div>"
            + "</div>";
        return "<div class='review-filter-dropdown'><div class='review-filter-panel'>"
            + control("date", "Дата", dateSummary, "<div class='review-filter-options'><label class='review-filter-check'><input type='checkbox' data-review-filter-date-all='1' " + (!filters.date ? "checked" : "") + "> Выбрать всё</label></div>" + renderFilterCalendar(mode, baseRows))
            + (mode === "canvas" ? control("sectionNames", "Участок", filterSummaryText(mode, "sectionNames", options.sectionNames), renderFilterCheckboxes(mode, "sectionNames", options.sectionNames)) : "")
            + control("movementStatuses", "Статус последнего движения", filterSummaryText(mode, "movementStatuses", options.movementStatuses), renderFilterCheckboxes(mode, "movementStatuses", options.movementStatuses))
            + control("entityTypes", "Тип задачи", filterSummaryText(mode, "entityTypes", options.entityTypes, taskEntityFilterLabel), renderFilterCheckboxes(mode, "entityTypes", options.entityTypes, taskEntityFilterLabel))
            + control("taskStatuses", "Статус", filterSummaryText(mode, "taskStatuses", options.taskStatuses), renderFilterCheckboxes(mode, "taskStatuses", options.taskStatuses) + "<div class='review-filter-empty-note' style='margin-top:8px'>Показано: " + escapeHtml(filteredRows.length) + " из " + escapeHtml(baseRows.length) + "</div>")
            + "</div></div>";
    }

    function filterRenderTarget(mode) {
        if (mode === "review") return $("reviewTableWrap");
        return $("reviewSectionTableWrap");
    }

    function rerenderSectionKeepingPosition(target, mode, renderAgain) {
        const modalCard = target.closest(".tasks-modal-card");
        const modalScroll = modalCard ? modalCard.scrollTop : 0;
        const tableScroll = target.querySelector(".review-table-scroll");
        const tableScrollTop = tableScroll ? tableScroll.scrollTop : 0;
        const popover = target.querySelector(".review-filter-block.is-open .review-filter-popover");
        const popoverScrollTop = popover ? popover.scrollTop : 0;
        renderAgain();
        requestAnimationFrame(() => {
            const nextTarget = filterRenderTarget(mode) || target;
            const nextModalCard = nextTarget.closest(".tasks-modal-card");
            const nextTableScroll = nextTarget.querySelector(".review-table-scroll");
            const nextPopover = nextTarget.querySelector(".review-filter-block.is-open .review-filter-popover");
            if (nextModalCard) nextModalCard.scrollTop = modalScroll;
            if (nextTableScroll) nextTableScroll.scrollTop = tableScrollTop;
            if (nextPopover) nextPopover.scrollTop = popoverScrollTop;
        });
    }

    function syncRenderedFilterCheckboxes(target, mode) {
        const filters = sectionFilterState(mode);
        target.querySelectorAll("[data-review-filter-all]").forEach((input) => {
            const key = input.dataset.reviewFilterAll;
            const selected = filters[key] || new Set();
            const optionInputs = Array.from(target.querySelectorAll("input[data-review-filter='" + key + "']"));
            const total = optionInputs.length;
            const selectedCount = selected.has(FILTER_NONE) ? 0 : !selected.size ? total : selected.size;
            input.checked = total > 0 && selectedCount === total;
            input.indeterminate = selectedCount > 0 && selectedCount < total;
            optionInputs.forEach((option) => {
                option.checked = !selected.has(FILTER_NONE) && (!selected.size || selected.has(option.value));
            });
        });
    }

    function bindSectionFilterEvents(target, mode, renderAgain) {
        target.querySelectorAll("[data-review-filter-toggle]").forEach((button) => {
            button.addEventListener("click", () => {
                const filters = sectionFilterState(mode);
                const key = button.dataset.reviewFilterToggle || "";
                filters.openKey = filters.openKey === key ? "" : key;
                renderAgain();
            });
        });
        target.querySelectorAll("[data-review-filter-date-all]").forEach((input) => {
            input.addEventListener("change", () => {
                const filters = sectionFilterState(mode);
                filters.date = input.checked ? "" : FILTER_NONE;
                filters.openKey = "date";
                rerenderSectionKeepingPosition(target, mode, renderAgain);
            });
        });
        target.querySelectorAll("[data-review-filter-date]").forEach((button) => {
            button.addEventListener("click", () => {
                const filters = sectionFilterState(mode);
                const value = button.dataset.reviewFilterDate || "";
                filters.date = filters.date === value ? "" : value;
                filters.openKey = "date";
                rerenderSectionKeepingPosition(target, mode, renderAgain);
            });
        });
        target.querySelectorAll("[data-review-filter-all]").forEach((input) => {
            input.addEventListener("change", () => {
                const filters = sectionFilterState(mode);
                const key = input.dataset.reviewFilterAll;
                if (key) filters[key] = input.checked ? new Set() : new Set([FILTER_NONE]);
                filters.openKey = key || "";
                rerenderSectionKeepingPosition(target, mode, renderAgain);
            });
        });
        target.querySelectorAll("[data-review-filter]").forEach((input) => {
            input.addEventListener("change", () => {
                const filters = sectionFilterState(mode);
                const key = input.dataset.reviewFilter;
                const optionInputs = Array.from(target.querySelectorAll("input[data-review-filter='" + key + "']"));
                const checked = optionInputs.filter((item) => item.checked).map((item) => item.value);
                filters[key] = !checked.length ? new Set([FILTER_NONE]) : checked.length >= optionInputs.length ? new Set() : new Set(checked);
                filters.openKey = key;
                rerenderSectionKeepingPosition(target, mode, renderAgain);
            });
        });
        syncRenderedFilterCheckboxes(target, mode);
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
                resetSectionFilters("review");
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
        state.review.modalMode = "section";
        renderReviewTable(reviewGroupedRows());
        setFlowModalOpen("reviewSectionModal", true);
    }

    function closeReviewSectionModal() {
        state.review.modalMode = "";
        setFlowModalOpen("reviewSectionModal", false);
    }

    function renderReviewTable(grouped) {
        const section = state.review.activeSection || REVIEW_SECTIONS[0];
        const baseRows = grouped.get(section) || [];
        const filteredRows = applySectionFilters("review", baseRows);
        const rows = sortedReviewRows(filteredRows);
        const target = $("reviewSectionTableWrap");
        if (!target) return;
        if (!state.review.loaded) {
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Разбор</h3><div class='review-table-subtitle'>Задачи еще не загружены.</div></div><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div><div class='empty-state'>Подождите загрузку задач из Supabase.</div>";
            const closeBtn = $("closeReviewSectionModal");
            if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
            return;
        }
        if (!baseRows.length) {
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
        target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>" + escapeHtml(section) + "</h3><div class='review-table-subtitle'>Задач: " + rows.length + " из " + baseRows.length + ". Нажми на заголовок столбца для сортировки.</div></div><div class='file-row' style='margin-top:0'><button id='refreshReviewTasks' class='btn btn-outline' type='button'>Обновить</button><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div></div>"
            + renderSectionFilters("review", baseRows, rows)
            + (rows.length ? "<div class='review-table-scroll'><table class='review-data-table'><thead><tr>"
            + reviewSortHead("title", "Задача")
            + reviewSortHead("entityType", "Тип задачи")
            + reviewSortHead("name", "Наименование")
            + reviewSortHead("price", "Стоимость")
            + reviewSortHead("status", "Статус")
            + "</tr></thead><tbody>" + body + "</tbody></table></div>" : "<div class='empty-state'>По выбранным фильтрам задач нет.</div>");
        const refresh = $("refreshReviewTasks");
        if (refresh) refresh.addEventListener("click", () => { void loadReviewTasks(); });
        const closeBtn = $("closeReviewSectionModal");
        if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
        bindSectionFilterEvents(target, "review", () => renderReviewTable(reviewGroupedRows()));
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

    function sortedCanvasRows(rows) {
        const previous = state.review.sort;
        state.review.sort = state.reviewCanvas.sort || { key: "price", dir: "desc" };
        const sorted = sortedReviewRows(rows);
        state.review.sort = previous;
        return sorted;
    }

    function openReviewCanvasModal() {
        state.review.modalMode = "canvas";
        resetSectionFilters("canvas");
        renderReviewCanvasTable();
        setFlowModalOpen("reviewSectionModal", true);
    }

    function renderReviewCanvasTable() {
        const baseRows = reviewCanvasRows();
        const filteredRows = applySectionFilters("canvas", baseRows);
        const rows = sortedCanvasRows(filteredRows);
        const target = $("reviewSectionTableWrap");
        if (!target) return;
        if (!state.review.loaded) {
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Полотно разбора</h3><div class='review-table-subtitle'>Задачи еще не загружены.</div></div><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div><div class='empty-state'>Подождите загрузку задач из Supabase.</div>";
            const closeBtn = $("closeReviewSectionModal");
            if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
            return;
        }
        const body = rows.map((row) => {
            const status = displayTaskStatus(row);
            const verdict = normalizeText(row.opp_verdict);
            const route = taskRouteLabel(row);
            return "<tr class='review-click-row' data-task-detail='" + escapeHtml(row.id) + "'>"
                + "<td class='review-wrap-cell'><div class='review-task-title'>" + escapeHtml(displayTaskTitle(row)) + "</div><div class='review-task-sub'>" + escapeHtml(row.task_type || "-") + " · " + escapeHtml(taskSectionName(row)) + "</div>" + (route ? "<div class='review-task-route'>" + escapeHtml(route) + "</div>" : "") + "</td>"
                + "<td><span class='review-pill'>" + escapeHtml(taskEntityTypeLabel(row)) + "</span></td>"
                + "<td class='review-wrap-cell'>" + escapeHtml(taskItemName(row) || "-") + "</td>"
                + "<td class='review-price-cell' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</td>"
                + "<td><span class='review-pill'>" + escapeHtml(status) + "</span>" + (verdict && verdict !== "Не выбран" ? "<div class='review-task-sub'>Вердикт: " + escapeHtml(verdict) + "</div>" : "") + "</td>"
                + "</tr>";
        }).join("");
        const previousSort = state.review.sort;
        state.review.sort = state.reviewCanvas.sort || { key: "price", dir: "desc" };
        target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Полотно разбора</h3><div class='review-table-subtitle'>Все активные задачи разбора: " + rows.length + " из " + baseRows.length + ".</div></div><div class='file-row' style='margin-top:0'><button id='refreshReviewTasks' class='btn btn-outline' type='button'>Обновить</button><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div></div>"
            + renderSectionFilters("canvas", baseRows, rows)
            + (rows.length ? "<div class='review-table-scroll'><table class='review-data-table'><thead><tr>"
            + reviewSortHead("title", "Задача")
            + reviewSortHead("entityType", "Тип задачи")
            + reviewSortHead("name", "Наименование")
            + reviewSortHead("price", "Стоимость")
            + reviewSortHead("status", "Статус")
            + "</tr></thead><tbody>" + body + "</tbody></table></div>" : "<div class='empty-state'>По выбранным фильтрам задач нет.</div>");
        state.review.sort = previousSort;
        const refresh = $("refreshReviewTasks");
        if (refresh) refresh.addEventListener("click", () => { void loadReviewTasks(); });
        const closeBtn = $("closeReviewSectionModal");
        if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
        bindSectionFilterEvents(target, "canvas", renderReviewCanvasTable);
        target.querySelectorAll("[data-review-sort]").forEach((button) => {
            button.addEventListener("click", () => {
                const key = button.dataset.reviewSort || "price";
                const current = state.reviewCanvas.sort || { key: "price", dir: "desc" };
                state.reviewCanvas.sort = current.key === key
                    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
                    : { key, dir: key === "price" ? "desc" : "asc" };
                renderReviewCanvasTable();
            });
        });
        target.querySelectorAll("[data-task-detail]").forEach((row) => {
            row.addEventListener("click", () => openTaskDetail(row.dataset.taskDetail, "review"));
        });
    }

    function setRequestsStatus(message, type) {
        const el = $("requestsStatus");
        if (!el) return;
        el.textContent = message || "";
        el.style.color = type === "error" ? "#b91c1c" : type === "good" ? "#15803d" : "#64748b";
    }

    function renderRequests() {
        if (!$("requestsSectionsGrid") || !$("requestsTableWrap")) return;
        if (state.review.loading) {
            setRequestsStatus("Загружаю задачи из Supabase...");
            $("requestsSectionsGrid").innerHTML = "";
            $("requestsTableWrap").innerHTML = "<div class='empty-state'>Загружаю задачи...</div>";
            return;
        }
        const grouped = requestsGroupedRows();
        if (!state.requests.activeSection || !(grouped.get(state.requests.activeSection) || []).length) {
            state.requests.activeSection = REQUEST_SECTIONS.find((section) => (grouped.get(section) || []).length) || REQUEST_SECTIONS[0];
        }
        setRequestsStatus(state.review.loaded ? "Запросы загружены." : "Задачи еще не загружены.", state.review.loaded ? "good" : "");
        renderRequestsSections(grouped);
        const section = state.requests.activeSection || REQUEST_SECTIONS[0];
        const rows = sortedRequestRows(grouped.get(section) || []);
        $("requestsTableWrap").innerHTML = state.review.loaded
            ? (rows.length ? "" : "<div class='empty-state'>Выберите участок. На выбранном участке \"" + escapeHtml(section) + "\" активных запросов пока нет.</div>")
            : "<div class='empty-state'>Нажмите \"Запросы\", и WMS+ загрузит задачи из Supabase.</div>";
    }

    function renderRequestsSections(grouped) {
        $("requestsSectionsGrid").innerHTML = REQUEST_SECTIONS.map((section) => {
            const rows = grouped.get(section) || [];
            const total = rows.reduce((acc, row) => acc + reviewPrice(row), 0);
            const active = section === state.requests.activeSection ? " active" : "";
            return "<button type='button' class='review-section-card" + active + "' data-request-section='" + escapeHtml(section) + "'>"
                + "<div class='review-section-name'><span>" + escapeHtml(section) + "</span><strong>" + rows.length + "</strong></div>"
                + "<div class='review-section-meta'>Стоимость: " + escapeHtml(formatMoney(total)) + "</div>"
                + "</button>";
        }).join("");
        $("requestsSectionsGrid").querySelectorAll("[data-request-section]").forEach((button) => {
            button.addEventListener("click", () => {
                state.requests.activeSection = button.dataset.requestSection || REQUEST_SECTIONS[0];
                resetSectionFilters("requests");
                renderRequests();
                openRequestsSectionModal();
            });
        });
    }

    function sortedRequestRows(rows) {
        const previous = state.review.sort;
        state.review.sort = state.requests.sort || { key: "price", dir: "desc" };
        const sorted = sortedReviewRows(rows);
        state.review.sort = previous;
        return sorted;
    }

    function openRequestsSectionModal() {
        renderRequestsTable(requestsGroupedRows());
        setFlowModalOpen("reviewSectionModal", true);
    }

    function renderRequestsTable(grouped) {
        const section = state.requests.activeSection || REQUEST_SECTIONS[0];
        const baseRows = grouped.get(section) || [];
        const filteredRows = applySectionFilters("requests", baseRows);
        const rows = sortedRequestRows(filteredRows);
        const target = $("reviewSectionTableWrap");
        if (!target) return;
        if (!state.review.loaded) {
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Запросы</h3><div class='review-table-subtitle'>Задачи еще не загружены.</div></div><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div><div class='empty-state'>Подождите загрузку задач из Supabase.</div>";
            const closeBtn = $("closeReviewSectionModal");
            if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
            return;
        }
        if (!baseRows.length) {
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>" + escapeHtml(section) + "</h3><div class='review-table-subtitle'>Активных задач нет.</div></div><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div><div class='empty-state'>Пусто. Непривычно, но приятно.</div>";
            const closeBtn = $("closeReviewSectionModal");
            if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
            return;
        }
        const body = rows.map((row) => {
            const status = displayTaskStatus(row);
            const verdict = normalizeText(row.opp_verdict);
            return "<tr class='review-click-row' data-task-detail='" + escapeHtml(row.id) + "'>"
                + "<td class='review-wrap-cell'><div class='review-task-title'>" + escapeHtml(displayTaskTitle(row)) + "</div><div class='review-task-sub'>" + escapeHtml(row.task_type || "-") + "</div></td>"
                + "<td class='review-price-cell' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</td>"
                + "<td><span class='review-pill'>" + escapeHtml(status) + "</span>" + (verdict && verdict !== "Не выбран" ? "<div class='review-task-sub'>Вердикт: " + escapeHtml(verdict) + "</div>" : "") + "</td>"
                + "</tr>";
        }).join("");
        const previousSort = state.review.sort;
        state.review.sort = state.requests.sort || { key: "price", dir: "desc" };
        target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>" + escapeHtml(section) + "</h3><div class='review-table-subtitle'>Задач: " + rows.length + " из " + baseRows.length + ". Нажми на заголовок столбца для сортировки.</div></div><div class='file-row' style='margin-top:0'><button id='refreshReviewTasks' class='btn btn-outline' type='button'>Обновить</button><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div></div>"
            + renderSectionFilters("requests", baseRows, rows)
            + (rows.length ? "<div class='review-table-scroll'><table class='review-data-table'><thead><tr>"
            + reviewSortHead("title", "Задача")
            + reviewSortHead("price", "Стоимость")
            + reviewSortHead("status", "Статус")
            + "</tr></thead><tbody>" + body + "</tbody></table></div>" : "<div class='empty-state'>По выбранным фильтрам задач нет.</div>");
        state.review.sort = previousSort;
        const refresh = $("refreshReviewTasks");
        if (refresh) refresh.addEventListener("click", () => { void loadReviewTasks(); });
        const closeBtn = $("closeReviewSectionModal");
        if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
        bindSectionFilterEvents(target, "requests", () => renderRequestsTable(requestsGroupedRows()));
        target.querySelectorAll("[data-review-sort]").forEach((button) => {
            button.addEventListener("click", () => {
                const key = button.dataset.reviewSort || "price";
                const current = state.requests.sort || { key: "price", dir: "desc" };
                state.requests.sort = current.key === key
                    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
                    : { key, dir: key === "price" ? "desc" : "asc" };
                renderRequestsTable(requestsGroupedRows());
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
        if (key === "creator") return prespisokTaskCreator(row);
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

    function taskCompletionActor(row, historyRow) {
        // History-first, payload-fallback (wms_task_history only covers tasks
        // completed since 2026-08-24; older ones fall back to source_payload).
        const review = taskReviewPayload(row);
        return {
            id: normalizeIdentifier(historyRow && historyRow.actor_employee_id)
                || normalizeIdentifier(review.completed_by_id)
                || normalizeIdentifier(row && row.assignee_employee_id),
            name: normalizeText(historyRow && historyRow.actor_name)
                || normalizeText(review.completed_by_name)
                || normalizeText(row && row.assignee_name),
        };
    }

    function taskCompletedByMatches(row, user, historyRow) {
        const actor = taskCompletionActor(row, historyRow);
        const userId = normalizeIdentifier(user && user.id);
        const userName = normalizeForMatch(user && user.name);
        if (userId && userId !== "local" && actor.id === userId) return true;
        if (userName && normalizeForMatch(actor.name) === userName) return true;
        return false;
    }

    function normalizeTaskItem(value) {
        if (!value || typeof value !== "object") return null;
        const raw = value.raw && typeof value.raw === "object" ? value.raw : value;
        const shk = normalizeIdentifier(value.shk || raw.product || raw.shk);
        if (!shk) return null;
        return {
            shk,
            name: normalizeText(value.name || raw.name),
            nm: normalizeIdentifier(value.nm || raw.nm || raw.nm_id || raw.nmId || raw.nmID),
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
        return (Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids : []).map((id) => ({ shk: normalizeIdentifier(id), name: "", nm: "", status: "", price: 0, mx: "", movement: "", row_number: null, raw: {} })).filter((item) => item.shk);
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

    function isIncomingFlowRequestTask(row) {
        return requestSectionName(row) === "Запросы входящего потока";
    }

    function extractIdsFromLooseText(value) {
        const text = normalizeText(value);
        if (!text) return [];
        const matches = text.match(/[+-]?\d+(?:[.,]\d+)?e[+-]?\d+|\d{5,}(?:\.0+)?/gi) || [];
        return matches.map(normalizeIdentifier).filter((id) => /^\d{5,}$/.test(id));
    }

    function firstTextFromPayload(row, keys) {
        const payload = taskPayload(row);
        const sources = [payload];
        if (payload.row && typeof payload.row === "object") sources.push(payload.row);
        if (Array.isArray(payload.rows) && payload.rows[0] && typeof payload.rows[0] === "object") sources.push(payload.rows[0]);
        for (const source of sources) {
            for (const key of keys) {
                const value = source[key];
                if (Array.isArray(value)) {
                    const joined = value.map(normalizeText).filter(Boolean).join(", ");
                    if (joined) return joined;
                }
                const text = normalizeText(value);
                if (text) return text;
            }
        }
        return "";
    }

    function textAfterDescriptionLabel(row, labels) {
        const lines = normalizeText(row && row.description).split(/\r?\n|<br\s*\/?>/i).map((line) => normalizeText(line.replace(/<[^>]+>/g, "")));
        for (const line of lines) {
            const match = line.match(/^([^:]+):\s*(.*)$/);
            if (!match) continue;
            const key = normalizeForMatch(match[1]);
            if (labels.some((label) => key === normalizeForMatch(label))) return normalizeText(match[2]);
        }
        return "";
    }

    function incomingFlowSender(row) {
        return firstTextFromPayload(row, [
            "sender_lo", "lo_sender", "source_lo", "lo", "office", "sender_office", "source_office", "lo_name",
            "ЛО-отправитель", "Наименование ЛО", "C",
        ]) || textAfterDescriptionLabel(row, ["ЛО-отправитель", "Наименование ЛО"]);
    }

    function incomingFlowRequestDate(row) {
        const raw = firstTextFromPayload(row, [
            "request_time", "requested_at", "timestamp", "created_at", "time", "request_at", "source_created_at",
            "Отметка времени", "Время запроса", "A",
        ]) || normalizeText(row && row.source_last_movement_at) || normalizeText(row && row.upload_effective_date);
        const parsed = parseDateTime(raw);
        if (!parsed.date) return "-";
        return /:\d{2}/.test(normalizeText(raw)) ? formatRuDateTime(raw) : formatRuDate(parsed.date);
    }

    function incomingFlowShkList(row) {
        const seen = new Set();
        const ids = [];
        const add = (value) => {
            extractIdsFromLooseText(value).forEach((id) => {
                if (!seen.has(id)) {
                    seen.add(id);
                    ids.push(id);
                }
            });
        };
        (Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids : []).forEach(add);
        [
            firstTextFromPayload(row, ["shk", "shks", "item_shk", "target_shk", "requested_shk", "search_shk", "incoming_shk", "barcode", "barcodes", "product", "products", "Искомый ШК", "D"]),
            normalizeText(row && row.source_id),
            textAfterDescriptionLabel(row, ["Искомый ШК", "ШК в запросе", "ШК"]),
        ].forEach(add);
        return ids;
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
        if (source !== "inactive" && state.flow.allowConflictOpenId !== id && flowRowIsLockedForOther(row, currentFlowEmployee())) {
            openFlowConflictModal(id);
            return;
        }
        state.flow.allowConflictOpenId = "";
        if (state.taskDetail && state.taskDetail.countdownTimer) clearInterval(state.taskDetail.countdownTimer);
        state.taskDetail = { rowId: id, source: source || "review", editRowId: "", deferRowId: "", reopenRowId: "", splitRowId: "", splitShk: "", countdownTimer: null };
        renderTaskDetail(row);
        setFlowModalOpen("taskDetailModal", true);
    }

    function closeTaskDetail() {
        if (state.taskDetail && state.taskDetail.countdownTimer) {
            clearInterval(state.taskDetail.countdownTimer);
            state.taskDetail.countdownTimer = null;
        }
        setFlowModalOpen("taskDetailModal", false);
    }

    const TASK_CELEBRATION_ICONS = { green: "✓", yellow: "◴", red: "✕" };

    function playTaskCompletionCelebration(tone) {
        const card = document.querySelector("#taskDetailModal .task-detail-card");
        const icon = TASK_CELEBRATION_ICONS[tone];
        if (!card || !icon) return Promise.resolve();
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.className = "task-celebration task-celebration-" + tone;
            overlay.innerHTML = "<div class='task-celebration-icon'>" + icon + "</div>";
            card.appendChild(overlay);
            card.classList.add("is-celebrating");
            void overlay.offsetWidth;
            overlay.classList.add("is-active");
            setTimeout(() => {
                overlay.remove();
                card.classList.remove("is-celebrating");
                resolve();
            }, 1400);
        });
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
        if (row && row.__kind === "prespisok_action") {
            const payload = taskPayload(row);
            return [
                "Журнал предсписка",
                payload.run_date ? formatRuDate(payload.run_date) : "",
                row.opp_verdict || "",
                payload.actor_label ? "Кто: " + payload.actor_label : "",
                formatMoney(row.source_price_sum),
            ].filter(Boolean).join(" · ");
        }
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
            row.due_date ? "Списание: " + formatRuDate(row.due_date) : "",
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
                if (row && row.__kind === "prespisok_action") {
                    openPrespisokActionSearchDetail(row);
                    return;
                }
                openTaskDetail(id, row && isActiveReviewTask(row) ? "review" : "inactive");
            });
        });
        setTaskSearchResultsVisible(true);
    }

    function prespisokActionSearchId(row) {
        return "prespisok-action:" + normalizeText(row && row.run_id) + ":" + normalizeText(row && row.item_key || row && row.id || row && row.created_at);
    }

    function normalizePrespisokActionSearchRow(row, run) {
        const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
        const sourceIds = Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids.map(normalizeIdentifier).filter(Boolean) : [];
        const actorLabel = [normalizeText(row && row.operator_name), normalizeText(row && row.operator_id)].filter(Boolean).join(" / ")
            || [normalizeText(payload.actor && payload.actor.name), normalizeText(payload.actor && payload.actor.id)].filter(Boolean).join(" / ");
        const entity = normalizeIdentifier(row && (row.source_tare_id || row.entity_id)) || sourceIds[0] || "-";
        return {
            __kind: "prespisok_action",
            id: prespisokActionSearchId(row),
            source_module: "wms_prespisok",
            source_id: entity,
            source_payload: {
                prespisok_action: payload,
                run_date: normalizeText(run && run.run_date),
                run_status: normalizeText(run && run.status),
                actor_label: actorLabel,
                extra_value: normalizeText(row && row.extra_value),
            },
            source_shk_ids: sourceIds,
            source_tare_id: normalizeIdentifier(row && row.source_tare_id),
            source_price_sum: Number(row && row.price) || Number(payload.price) || 0,
            source_last_movement_at: normalizeText(row && row.created_at),
            upload_type: "prespisok_journal",
            upload_effective_date: normalizeText(run && run.run_date),
            task_type: "Журнал предсписка",
            title: "Предсписок | " + entity,
            description: "",
            priority_label: "История",
            due_date: normalizeText(run && run.run_date),
            responsibility_zone: "Нет привязки",
            task_status: "Завершено",
            opp_verdict: normalizeText(row && row.verdict) || normalizeText(payload.verdict),
            assignee_employee_id: normalizeText(row && row.operator_id),
            assignee_name: normalizeText(row && row.operator_name),
            tags: ["Предсписок", "Журнал"],
            is_deleted: false,
            completed_at: normalizeText(row && row.created_at),
            updated_at: normalizeText(row && row.created_at),
        };
    }

    async function queryPrespisokActionSearch(db, id) {
        if (!db || !id) return [];
        const base = () => db
            .from(WMS_PRESPISOK_ACTIONS_TABLE)
            .select("*")
            .limit(20);
        const settled = await Promise.allSettled([
            base().contains("source_shk_ids", [id]),
            base().eq("source_tare_id", id),
            base().eq("entity_id", id),
        ]);
        const byKey = new Map();
        settled.forEach((result) => {
            if (result.status !== "fulfilled" || (result.value && result.value.error)) return;
            (Array.isArray(result.value.data) ? result.value.data : []).forEach((row) => {
                const key = normalizeText(row.run_id) + "|" + normalizeText(row.item_key) + "|" + normalizeText(row.created_at);
                if (!byKey.has(key)) byKey.set(key, row);
            });
        });
        const actions = Array.from(byKey.values());
        if (!actions.length) return [];
        const runIds = Array.from(new Set(actions.map((row) => normalizeText(row.run_id)).filter(Boolean)));
        const runsById = new Map();
        if (runIds.length) {
            const { data, error } = await db.from(WMS_PRESPISOK_RUNS_TABLE).select("*").in("id", runIds);
            if (!error) (data || []).forEach((run) => runsById.set(run.id, run));
        }
        return actions.map((row) => normalizePrespisokActionSearchRow(row, runsById.get(row.run_id))).filter(Boolean);
    }

    function openPrespisokActionSearchDetail(row) {
        const target = $("specialInfoWrap");
        if (!target) return;
        const payload = taskPayload(row);
        const action = payload.prespisok_action || {};
        const shks = (Array.isArray(row.source_shk_ids) ? row.source_shk_ids : []).map(normalizeIdentifier).filter(Boolean).join("\n") || "-";
        const lines = [
            ["Дата предсписка", payload.run_date ? formatRuDate(payload.run_date) : "-"],
            ["Цель", normalizeIdentifier(row.source_tare_id) ? "Тара " + normalizeIdentifier(row.source_tare_id) : "ШК " + (normalizeIdentifier(row.source_id) || "-")],
            ["Вердикт", row.opp_verdict || "-"],
            ["Ссылка/комментарий", payload.extra_value || "-"],
            ["Кто разбирал", payload.actor_label || "-"],
            ["Время решения", formatRuDateTime(row.completed_at)],
            ["Стоимость", formatMoney(row.source_price_sum)],
            ["ШК", shks],
        ];
        target.innerHTML = "<div class='work-head'><div><h3 class='work-title'>Разбор из журнала предсписка</h3><p class='work-subtitle'>Это история, не активная задача.</p></div><button id='closeSpecialInfo' class='btn btn-square' type='button' aria-label='Закрыть'>×</button></div>"
            + "<div class='special-info-list'><article class='special-info-card'>"
            + lines.map((line) => "<button type='button' class='special-info-line copyable' data-copy-value='" + escapeHtml(line[1]) + "' title='Нажми, чтобы скопировать'><span>" + escapeHtml(line[0]) + "</span><strong>" + escapeHtml(line[1]) + "</strong></button>").join("")
            + "</article></div>";
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
        const prespisokRows = id ? await queryPrespisokActionSearch(db, id).catch(() => []) : [];
        prespisokRows.forEach((row) => {
            if (row && row.id && !byId.has(row.id)) byId.set(row.id, row);
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
        const isIncomingFlow = isIncomingFlowRequestTask(row);
        const taskItemList = taskItems(row);
        const targetId = isIncomingFlow
            ? incomingFlowShkList(row)[0] || normalizeIdentifier(row && row.source_id)
            : isTareTask(row)
            ? normalizeIdentifier(row.source_tare_id) || normalizeIdentifier(taskPayload(row).tare_id || taskPayload(row).transfer)
            : normalizeIdentifier(taskItemList[0] && taskItemList[0].shk) || normalizeIdentifier(row.source_shk_ids && row.source_shk_ids[0]);
        const items = [
            taskInfoItem(isTareTask(row) ? "Искомая тара" : "Искомый ШК", targetId),
        ];
        if (isIncomingFlow) {
            items.push(taskInfoItem("ЛО-отправитель", incomingFlowSender(row)));
            items.push(taskInfoItem("Дата запроса", incomingFlowRequestDate(row)));
        }
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

    const TASK_TARE_PREVIEW_LIMIT = 5;

    function taskTareRowHtml(item) {
        return "<button class='task-tare-row' type='button' data-copy-single-shk='" + escapeHtml(item.shk) + "' title='Скопировать этот ШК'>"
            + "<span class='task-tare-shk'>" + escapeHtml(item.shk || "-") + "</span>"
            + "<span class='task-tare-meta'>" + escapeHtml(item.status || "-") + "</span>"
            + "<span class='task-tare-price'>" + escapeHtml(formatMoney(item.price)) + "</span>"
            + "</button>";
    }

    function taskTareInfoBox(row, readOnly) {
        if (!isTareTask(row)) return "";
        const items = taskItems(row);
        const ids = items.map((item) => item.shk).filter(Boolean).join("\n");
        const preview = items.slice(0, TASK_TARE_PREVIEW_LIMIT);
        const rows = preview.map(taskTareRowHtml).join("");
        const hiddenCount = items.length - preview.length;
        const editBtn = readOnly ? "" : "<button id='editTareTaskBtn' class='btn btn-square' type='button' title='Редактировать тару'>✎</button>";
        return "<div class='task-tare-box'>"
            + "<div class='task-tare-head'><strong>ШК в таре · " + items.length + "</strong><div class='task-tare-head-actions'>" + editBtn + "<button class='btn btn-outline' type='button' data-copy-shk='" + escapeHtml(ids) + "'>Скопировать все</button></div></div>"
            + "<div class='task-tare-list'>" + (rows || "<div class='task-tare-meta'>ШК не найдены</div>") + "</div>"
            + (hiddenCount > 0 ? "<button id='showAllTareShkBtn' class='btn btn-outline task-tare-more' type='button'>Показать все " + items.length + "</button>" : "")
            + "</div>";
    }

    function renderAllTareShkModal(row) {
        const target = $("allTareShkWrap");
        if (!target) return;
        const items = taskItems(row).slice().sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
        target.innerHTML = "<div class='work-head'><div><h3 class='work-title'>ШК в таре</h3><p class='work-subtitle'>Всего " + items.length + ", от дорогих к дешёвым.</p></div><button id='closeAllTareShk' class='btn btn-square' type='button' aria-label='Закрыть'>×</button></div>"
            + "<div class='task-tare-list'>" + (items.map(taskTareRowHtml).join("") || "<div class='task-tare-meta'>ШК не найдены</div>") + "</div>";
        $("closeAllTareShk").addEventListener("click", closeAllTareShkModal);
        target.querySelectorAll("[data-copy-single-shk]").forEach((button) => {
            button.addEventListener("click", async () => {
                const text = normalizeIdentifier(button.dataset.copySingleShk);
                if (!text) return;
                const copied = await copyText(text);
                toast(copied ? "ШК скопирован." : "Браузер заблокировал копирование.", copied ? "success" : "error");
            });
        });
    }

    function openAllTareShkModal(id) {
        const row = findTaskRow(id);
        if (!row || !isTareTask(row)) return;
        renderAllTareShkModal(row);
        setFlowModalOpen("allTareShkModal", true);
    }

    function closeAllTareShkModal() {
        setFlowModalOpen("allTareShkModal", false);
    }

    function incomingFlowShkInfoBox(row) {
        if (!isIncomingFlowRequestTask(row)) return "";
        const ids = incomingFlowShkList(row);
        const all = ids.join("\n");
        const rows = ids.map((id) => "<button class='task-tare-row' type='button' data-copy-single-shk='" + escapeHtml(id) + "' title='Скопировать этот ШК'>"
            + "<span class='task-tare-shk'>" + escapeHtml(id) + "</span>"
            + "<span class='task-tare-meta'>ШК из запроса</span>"
            + "</button>").join("");
        return "<div class='task-tare-box'>"
            + "<div class='task-tare-head'><strong>ШК в запросе</strong><button class='btn btn-outline' type='button' data-copy-shk='" + escapeHtml(all) + "'>Скопировать все</button></div>"
            + "<div class='task-tare-list'>" + (rows || "<div class='task-tare-meta'>ШК не найдены</div>") + "</div>"
            + "</div>";
    }

    function taskHistoryBox(row) {
        const review = taskReviewPayload(row);
        const lines = [];
        const verdict = normalizeText(review.verdict || review.attachment || row.opp_verdict);
        if (verdict && verdict !== "Не выбран") {
            const actor = taskCompletionActor(row);
            lines.push((isIncomingFlowRequestTask(row) ? "Вложение" : "Вердикт") + ": " + verdict);
            if (review.completed_at || row.completed_at) lines.push("Время вердикта: " + formatRuDateTime(review.completed_at || row.completed_at));
            if (actor.name || actor.id) lines.push("Кто поставил вердикт: " + [actor.name, actor.id].filter(Boolean).join(" / "));
        }
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

    const TASK_HISTORY_EVENT_LABELS = {
        task_created: "Задача создана",
        task_claimed: "Взято в работу (Flow)",
        task_skipped: "Пропущено (Flow)",
        task_started: "Начато",
        task_completed: "Завершено",
        task_deferred: "Отложено",
        task_reopened: "Переоткрыто вручную",
        task_auto_reopened: "Переоткрыто автоматически",
        task_system_closed: "Закрыто системой (актуализация)",
    };

    function taskHistoryEventLabel(eventType) {
        return TASK_HISTORY_EVENT_LABELS[eventType] || normalizeText(eventType) || "Событие";
    }

    async function loadTaskDetailHistory(id) {
        const db = supabaseDb();
        if (!db || !id) return [];
        const read = await readOptionalRows(db, FLOW_HISTORY_TABLE, (query) => query
            .select("*")
            .eq("task_id", id)
            .order("created_at", { ascending: true })
            .limit(200));
        return read.ok ? (read.rows || []) : [];
    }

    const AVATAR_PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#84cc16", "#f97316"];

    function avatarColorFor(key) {
        const str = normalizeText(key) || "?";
        let hash = 0;
        for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
        return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
    }

    function avatarInitials(name) {
        const parts = normalizeText(name).split(/\s+/).filter(Boolean);
        if (!parts.length) return "?";
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    function taskHistoryAvatarHtml(actorId, actorName, isSystem) {
        if (isSystem) return "<span class='task-chat-avatar task-chat-avatar-system' aria-hidden='true'>⚙</span>";
        const label = actorName || actorId;
        return "<span class='task-chat-avatar' style='background:" + escapeHtml(avatarColorFor(actorId || actorName)) + "' aria-hidden='true'>" + escapeHtml(avatarInitials(label)) + "</span>";
    }

    function taskHistoryFeedItemHtml(item) {
        const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload) ? item.payload : {};
        const rawActorName = normalizeText(item.actor_name);
        const rawActorId = normalizeText(item.actor_employee_id);
        // A task closed via actualization (or a legacy row carrying the same
        // system verdict) is credited to "Система" in Кто/Вердикт -- the
        // real person who ran the actualization goes in the comment instead,
        // per how this should read for reviewers scanning the feed.
        const isForecast = item.event_type === "task_predicted_writeoff";
        const isStatusLine = item.event_type === "task_last_movement_status";
        const isCreated = item.event_type === "task_created";
        const isSystemClosed = item.event_type === "task_system_closed" || isSystemCompletionVerdict(payload.verdict);
        const isSystem = isSystemClosed || isForecast || isStatusLine || isCreated || (!rawActorName && !rawActorId);
        const actorDisplay = (isSystemClosed || isForecast || isStatusLine || isCreated) ? "Система" : (rawActorName || rawActorId || "Система");
        const verdict = isForecast
            ? "Прогнозируемая дата списания"
            : isStatusLine
            ? (normalizeText(payload.status_code) || "Статус ШК")
            : isCreated
            ? "Создана задача"
            : isSystemClosed
            ? "Закрыто автоматически"
            : (normalizeText(payload.verdict) && normalizeText(payload.verdict) !== "Не выбран" ? payload.verdict : taskHistoryEventLabel(item.event_type));
        const commentParts = [];
        if (isSystemClosed) {
            const performer = rawActorName || rawActorId;
            if (performer) commentParts.push("Выполнил: " + performer);
        }
        if (normalizeText(payload.comment)) commentParts.push(payload.comment);
        if (payload.reopen_after) commentParts.push("до " + formatRuDateTime(payload.reopen_after));
        const rowClass = "task-chat-row"
            + (isForecast ? " task-chat-row-forecast" : "")
            + (!isSystem ? " task-chat-row-verdict" : "");
        const commentHtml = escapeHtml(commentParts.join(" · ") || "—");
        return "<div class='" + rowClass + "'>"
            + "<div class='task-chat-time'>" + escapeHtml(formatRuDateTime(item.created_at)) + "</div>"
            + "<div class='task-chat-actor'>" + taskHistoryAvatarHtml(rawActorId, rawActorName, isSystem) + "<span>" + escapeHtml(actorDisplay) + "</span></div>"
            + "<div class='task-chat-verdict'>" + escapeHtml(verdict) + "</div>"
            + "<div class='task-chat-comment'>" + (isForecast ? "<em>" + commentHtml + "</em>" : commentHtml) + "</div>"
            + "</div>";
    }

    // Earliest (movement + days_without_movement) across the task's items,
    // using the live writeoff terms -- so it always reflects the latest
    // terms even for tasks uploaded before those terms last changed. Shared
    // by the "Прогнозируемая дата списания" history line and the header
    // countdown pill.
    function predictedWriteoffTs(row) {
        const termMap = activeWriteoffStatusTerms();
        let best = null;
        taskItems(row).forEach((item) => {
            const parsed = parseDateTime(item.movement);
            if (!parsed.iso) return;
            const statusKey = normalizeWriteoffTermKey(item.status, "status");
            const term = statusKey ? termMap.get(statusKey) : null;
            const days = term ? settingNumber(term.days_without_movement, null) : null;
            if (!term || !Number.isFinite(days)) return;
            const predictedIso = addDaysToTimestamp(parsed.iso, days);
            const predictedTs = predictedIso ? Date.parse(predictedIso) : NaN;
            if (!Number.isFinite(predictedTs)) return;
            if (best === null || predictedTs < best) best = predictedTs;
        });
        return best;
    }

    // Not real history rows -- computed live from the task's current items
    // and the live writeoff terms. Rendered alongside real history in
    // chronological order like any other entry.
    function synthesizeForecastHistoryEntries(row) {
        const entries = [];
        entries.push({
            created_at: row.created_at,
            event_type: "task_created",
            actor_name: "Система",
            actor_employee_id: "",
            payload: {},
        });
        const items = taskItems(row);
        if (!items.length) return entries;
        let lastMovement = null;
        items.forEach((item) => {
            const parsed = parseDateTime(item.movement);
            if (!parsed.iso) return;
            if (!lastMovement || parsed.ts > lastMovement.ts) lastMovement = { ts: parsed.ts, iso: parsed.iso, mx: normalizeText(item.mx), statusCode: latinStatusCode(item.status) };
        });
        if (lastMovement) {
            entries.push({
                created_at: lastMovement.iso,
                event_type: "task_last_movement_status",
                actor_name: "",
                actor_employee_id: "",
                payload: { comment: lastMovement.mx || "Склад не указан", status_code: lastMovement.statusCode },
            });
        }
        const predictedTs = predictedWriteoffTs(row);
        if (predictedTs !== null) {
            entries.push({
                created_at: new Date(predictedTs).toISOString(),
                event_type: "task_predicted_writeoff",
                actor_name: "",
                actor_employee_id: "",
                payload: { comment: "Автосписание складом по товару без движения" },
            });
        }
        return entries;
    }

    // wms_task_history only has rows since 2026-08-24. For anything the task
    // itself remembers from before that (or from a write path that skipped
    // history for some other reason) we reconstruct one entry per gap from
    // source_payload, so the feed doesn't silently drop older context just
    // because a newer real history row now also exists for the task.
    function synthesizeLegacyHistoryEntries(row, realHistoryRows) {
        const review = taskReviewPayload(row);
        const presentTypes = new Set((realHistoryRows || []).map((item) => item.event_type));
        const entries = [];
        const verdict = normalizeText(review.verdict || review.attachment || row.opp_verdict);
        if (verdict && verdict !== "Не выбран" && !presentTypes.has("task_completed") && !presentTypes.has("task_system_closed")) {
            const actor = taskCompletionActor(row);
            entries.push({
                created_at: review.completed_at || row.completed_at || row.updated_at,
                event_type: "task_completed",
                actor_name: actor.name,
                actor_employee_id: actor.id,
                payload: { verdict, comment: review.comment },
            });
        }
        if (review.defer_reason && !presentTypes.has("task_deferred")) {
            entries.push({
                created_at: review.deferred_at || row.updated_at,
                event_type: "task_deferred",
                actor_name: review.deferred_by_name,
                actor_employee_id: review.deferred_by_id,
                payload: { comment: review.defer_reason, reopen_after: review.reopen_after },
            });
        }
        if (review.manual_reopen_at && !presentTypes.has("task_reopened")) {
            entries.push({
                created_at: review.manual_reopen_at,
                event_type: "task_reopened",
                actor_name: review.manual_reopen_by_name,
                actor_employee_id: review.manual_reopen_by_id,
                payload: {},
            });
        }
        return entries;
    }

    function renderTaskDetailHistoryFeed(historyRows, row) {
        const target = $("taskDetailHistoryFeed");
        if (!target) return;
        const merged = (historyRows || [])
            .concat(synthesizeLegacyHistoryEntries(row, historyRows))
            .concat(synthesizeForecastHistoryEntries(row))
            .filter((item) => item && item.created_at)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        target.className = "task-chat-history";
        if (!merged.length) {
            target.innerHTML = "<strong>История</strong><div class='task-chat-empty'>Событий пока нет.</div>";
            return;
        }
        const items = merged.map(taskHistoryFeedItemHtml).join("");
        target.innerHTML = "<strong>История</strong>"
            + "<div class='task-chat-head'><div>Дата</div><div>Сотрудник</div><div>Событие</div><div>Комментарий</div></div>"
            + "<div class='task-history-feed'>" + items + "</div>";
    }

    async function loadAndRenderTaskDetailHistory(row) {
        const historyRows = await loadTaskDetailHistory(row.id);
        if (!state.taskDetail || state.taskDetail.rowId !== row.id) return;
        renderTaskDetailHistoryFeed(historyRows, row);
    }

    function taskDetailActionButtons(row, readOnly) {
        if (readOnly) {
            return "<div class='task-detail-actions'><button id='reopenTaskBtn' class='btn btn-square' type='button' title='Переоткрыть задачу'>↻</button><button id='closeTaskDetail' class='btn btn-square' type='button'>×</button></div>";
        }
        const defer = isPrespisokTask(row) ? "" : "<button id='openDeferTaskBtn' class='btn btn-square' type='button' title='Отложить'>◴</button>";
        return "<div class='task-detail-actions'>" + defer + "<button id='closeTaskDetail' class='btn btn-square' type='button'>×</button></div>";
    }

    function renderTaskDetail(row) {
        const target = $("taskDetailWrap");
        if (!target) return;
        const savedReview = taskReviewPayload(row);
        const readOnly = state.taskDetail.source === "inactive" || isCompletedTask(row) || isWaitingReopenTask(row);
        const incomingFlow = isIncomingFlowRequestTask(row);
        const verdict = normalizeText(row.opp_verdict) && normalizeText(row.opp_verdict) !== "Не выбран"
            ? normalizeText(row.opp_verdict)
            : normalizeText(savedReview.verdict || savedReview.attachment) || "Не выбран";
        const verdictOptions = incomingFlow ? INCOMING_FLOW_ATTACHMENT_OPTIONS : REVIEW_VERDICTS;
        const formVerdict = verdictOptions.includes(verdict) ? verdict : "Не выбран";
        const extraLabel = DEFERRED_VERDICT_FIELDS[verdict] || "";
        const readOnlyReviewLines = [
            "Комментарий: " + (savedReview.comment || "-"),
            (incomingFlow ? "Вложение: " : "Вердикт: ") + (verdict || "-"),
        ];
        if (incomingFlow) readOnlyReviewLines.push("ID виновного: " + (savedReview.guilty_id || "-"));
        if (savedReview.extra_label || savedReview.extra_value) readOnlyReviewLines.push((savedReview.extra_label || "Доп. поле") + ": " + (savedReview.extra_value || "-"));
        if (savedReview.completed_by_name || savedReview.completed_by_id) readOnlyReviewLines.push("Кто поставил вердикт: " + [savedReview.completed_by_name, savedReview.completed_by_id].filter(Boolean).join(" / "));
        const verdictTriggerLabel = formVerdict === "Не выбран" ? (incomingFlow ? "Вложение" : "Вердикт") : formVerdict;
        const verdictPickerHtml = "<div class='task-verdict-picker' id='taskVerdictPicker'>"
            + "<button type='button' id='taskVerdictTrigger' class='task-verdict-trigger' aria-label='" + (incomingFlow ? "Вложение" : "Вердикт") + "'><span id='taskVerdictTriggerLabel' class='task-verdict-trigger-label'>" + escapeHtml(verdictTriggerLabel) + "</span><span class='task-verdict-chevron' aria-hidden='true'>▾</span></button>"
            + "<select id='taskVerdictInput' class='task-verdict-native-select' aria-hidden='true' tabindex='-1'>" + verdictOptions.map((option) => "<option value='" + escapeHtml(option) + "' " + (option === formVerdict ? "selected" : "") + ">" + escapeHtml(option) + "</option>").join("") + "</select>"
            + "<div id='taskVerdictPopup' class='task-verdict-popup'>" + taskVerdictOptionsHtml(verdictOptions, formVerdict) + "</div>"
            + "</div>";
        const reviewBlock = readOnly
            ? "<div class='task-description-box copyable' data-copy-value='" + escapeHtml(readOnlyReviewLines.join("\n")) + "' title='Нажми, чтобы скопировать'><strong>Комментарий:</strong><br>" + escapeHtml(savedReview.comment || "-")
                + "<br><br><strong>" + (incomingFlow ? "Вложение" : "Вердикт") + ":</strong><br>" + escapeHtml(verdict || "-")
                + (incomingFlow ? "<br><br><strong>ID виновного:</strong><br>" + escapeHtml(savedReview.guilty_id || "-") : "")
                + (savedReview.extra_label || savedReview.extra_value ? "<br><br><strong>" + escapeHtml(savedReview.extra_label || "Доп. поле") + ":</strong><br>" + escapeHtml(savedReview.extra_value || "-") : "")
                + (savedReview.completed_by_name || savedReview.completed_by_id ? "<br><br><strong>Кто поставил вердикт:</strong><br>" + escapeHtml([savedReview.completed_by_name, savedReview.completed_by_id].filter(Boolean).join(" / ")) : "")
                + "</div>"
            : incomingFlow
            ? "<div class='task-form task-compose'>"
                + "<div class='task-compose-extra'>"
                + "<div class='task-compose-field'><label for='taskGuiltyIdInput'>ID виновного</label><input id='taskGuiltyIdInput' type='text' inputmode='numeric' pattern='\\d{5,8}' maxlength='8' value='" + escapeHtml(savedReview.guilty_id || "") + "' placeholder='5-8 цифр'></div>"
                + "<div id='taskExtraFieldWrap' class='task-compose-field" + (extraLabel ? "" : " hidden") + "'><label id='taskExtraLabel' for='taskExtraInput'>" + escapeHtml(extraLabel) + "</label><input id='taskExtraInput' type='text' value='" + escapeHtml(savedReview.extra_value || "") + "'></div>"
                + "</div>"
                + "<div class='task-compose-bar' id='taskComposeBar'>"
                + verdictPickerHtml
                + "<textarea id='taskCommentInput' class='task-compose-input' rows='1' aria-label='Комментарий ОПП' placeholder='Комментарий ОПП'>" + escapeHtml(savedReview.comment || "") + "</textarea>"
                + "<button id='completeTaskBtn' class='task-compose-send' type='button' disabled title='Завершить задачу' aria-label='Завершить задачу'>✓</button>"
                + "</div>"
                + "<div id='taskDetailStatus' class='review-status'></div>"
                + "<div id='taskWritebackConflictActions' class='task-writeback-conflict hidden'></div>"
                + "</div>"
            : "<div class='task-form task-compose' id='taskComposeForm'>"
                + "<div class='task-compose-row-collapse' id='taskComposeAboveRow'><div class='task-compose-row-inner' id='taskComposeAboveInner'>"
                + "<div id='taskExtraFieldWrap' class='task-compose-field hidden'><label id='taskExtraLabel' for='taskExtraInput'></label><input id='taskExtraInput' type='text' value='" + escapeHtml(savedReview.extra_value || "") + "'></div>"
                + "</div></div>"
                + "<div class='task-compose-bar' id='taskComposeBar'>"
                + verdictPickerHtml
                + "<button id='completeTaskBtn' class='task-compose-send' type='button' disabled title='Завершить задачу' aria-label='Завершить задачу'>✓</button>"
                + "</div>"
                + "<div class='task-compose-row-collapse' id='taskComposeBelowRow'><div class='task-compose-row-inner' id='taskComposeBelowInner'>"
                + "<textarea id='taskCommentInput' class='task-compose-input' rows='1' aria-label='Комментарий' placeholder='Если есть что запомнить'>" + escapeHtml(savedReview.comment || "") + "</textarea>"
                + "</div></div>"
                + "<div id='taskDetailStatus' class='review-status'></div>"
                + "<div id='taskWritebackConflictActions' class='task-writeback-conflict hidden'></div>"
                + "</div>";
        const predictedTs = predictedWriteoffTs(row);
        const countdownHtml = predictedTs !== null
            ? "<div id='taskWriteoffCountdown' class='task-detail-countdown " + writeoffCountdownTone(predictedTs) + "'>" + escapeHtml(formatWriteoffCountdown(predictedTs)) + "</div>"
            : "";
        target.innerHTML = "<div class='task-detail-head'><div>"
            + "<div class='task-detail-created'>Создано " + escapeHtml(formatRuDateTime(row.created_at)) + "</div>"
            + "<div class='task-detail-title-row'><h3 class='task-detail-title copyable' data-copy-value='" + escapeHtml(displayTaskTitle(row)) + "' title='Нажми, чтобы скопировать'>" + escapeHtml(displayTaskTitle(row)) + "</h3><div class='task-detail-price' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</div>" + countdownHtml + "</div>"
            + "<div class='review-table-subtitle'>" + escapeHtml(row.task_type || "-") + "</div></div>" + taskDetailActionButtons(row, readOnly) + "</div>"
            + "<div class='task-detail-body'>"
            + "<div class='task-info-grid'>" + taskDetailInfo(row) + "</div>"
            + taskTagsBox(row)
            + incomingFlowShkInfoBox(row)
            + taskTareInfoBox(row, readOnly)
            + "<div class='task-chat-panel'>"
            + "<div id='taskDetailHistoryFeed' class='task-chat-history'>Загрузка истории…</div>"
            + reviewBlock
            + "</div>"
            + "</div>";
        if (state.taskDetail.countdownTimer) {
            clearInterval(state.taskDetail.countdownTimer);
            state.taskDetail.countdownTimer = null;
        }
        if (predictedTs !== null) {
            state.taskDetail.countdownTimer = setInterval(() => updateTaskWriteoffCountdown(predictedTs), 30000);
        }
        void loadAndRenderTaskDetailHistory(row);
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
        target.querySelectorAll("[data-copy-shk]").forEach((button) => {
            button.addEventListener("click", async () => {
                const text = button.dataset.copyShk || "";
                if (!text) return;
                const copied = await copyText(text);
                toast(copied ? "Список ШК скопирован." : "Браузер заблокировал копирование.", copied ? "success" : "error");
            });
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
        const showAllTareBtn = $("showAllTareShkBtn");
        if (showAllTareBtn) showAllTareBtn.addEventListener("click", () => openAllTareShkModal(row.id));
        if (readOnly) return;
        const editBtn = $("editTareTaskBtn");
        if (editBtn) editBtn.addEventListener("click", () => openEditTareTaskModal(row.id));
        const deferBtn = $("openDeferTaskBtn");
        if (deferBtn) deferBtn.addEventListener("click", () => openDeferTaskModal(row.id));
        ["taskCommentInput", "taskVerdictInput", "taskExtraInput", "taskGuiltyIdInput"].forEach((id) => {
            const el = $(id);
            if (el) {
                el.addEventListener(id === "taskVerdictInput" ? "change" : "input", () => {
                    if (id === "taskGuiltyIdInput") el.value = normalizeGuiltyId(el.value);
                    if (id === "taskCommentInput") autoGrowTextarea(el);
                    updateTaskDetailForm();
                });
            }
        });
        autoGrowTextarea($("taskCommentInput"));
        const verdictTrigger = $("taskVerdictTrigger");
        if (verdictTrigger) verdictTrigger.addEventListener("click", () => {
            const picker = $("taskVerdictPicker");
            if (picker && picker.classList.contains("is-open")) closeTaskVerdictPicker();
            else openTaskVerdictPicker();
        });
        const verdictPopup = $("taskVerdictPopup");
        if (verdictPopup) verdictPopup.querySelectorAll(".task-verdict-option").forEach((button) => {
            button.addEventListener("click", () => selectTaskVerdictOption(button.dataset.value || ""));
        });
        document.removeEventListener("click", taskVerdictOutsideClick);
        document.addEventListener("click", taskVerdictOutsideClick);
        $("completeTaskBtn").addEventListener("click", () => { void completeTaskFromDetail(row.id); });
        updateTaskDetailForm();
    }

    function autoGrowTextarea(el) {
        if (!el) return;
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
    }

    function taskVerdictOptionsHtml(options, selected) {
        return (options || []).map((option) => "<button type='button' class='task-verdict-option" + (option === selected ? " is-selected" : "") + "' data-value='" + escapeHtml(option) + "'>" + escapeHtml(option) + "</button>").join("");
    }

    function openTaskVerdictPicker() {
        const picker = $("taskVerdictPicker");
        if (picker) picker.classList.add("is-open");
    }

    function closeTaskVerdictPicker() {
        const picker = $("taskVerdictPicker");
        if (picker) picker.classList.remove("is-open");
    }

    function taskVerdictOutsideClick(event) {
        const picker = $("taskVerdictPicker");
        if (!picker || !picker.classList.contains("is-open")) return;
        if (!picker.contains(event.target)) closeTaskVerdictPicker();
    }

    function selectTaskVerdictOption(value) {
        const nativeSelect = $("taskVerdictInput");
        if (!nativeSelect || !value) return;
        nativeSelect.value = value;
        const label = $("taskVerdictTriggerLabel");
        if (label) label.textContent = value;
        const popup = $("taskVerdictPopup");
        if (popup) popup.querySelectorAll(".task-verdict-option").forEach((button) => {
            button.classList.toggle("is-selected", button.dataset.value === value);
        });
        closeTaskVerdictPicker();
        const trigger = $("taskVerdictTrigger");
        if (trigger) {
            trigger.classList.remove("is-pop");
            void trigger.offsetWidth;
            trigger.classList.add("is-pop");
        }
        nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function formatWriteoffCountdown(targetTs) {
        const diffMs = targetTs - Date.now();
        const overdue = diffMs < 0;
        const totalMinutes = Math.floor(Math.abs(diffMs) / 60000);
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        const parts = [];
        if (days) parts.push(days + "д");
        if (days || hours) parts.push(hours + "ч");
        parts.push(minutes + "м");
        return (overdue ? "Просрочено: " : "До списания: ") + parts.join(" ");
    }

    function writeoffCountdownTone(targetTs) {
        const diffMs = targetTs - Date.now();
        if (diffMs < 0) return "is-overdue";
        if (diffMs < 24 * 3600000) return "is-soon";
        return "";
    }

    function updateTaskWriteoffCountdown(targetTs) {
        const el = $("taskWriteoffCountdown");
        if (!el) return;
        el.textContent = formatWriteoffCountdown(targetTs);
        el.className = "task-detail-countdown " + writeoffCountdownTone(targetTs);
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
        return (items || []).map((item) => item.raw && Object.keys(item.raw).length ? { ...item.raw, nm: item.nm || item.raw.nm, name: item.name || item.raw.name } : {
            product: item.shk,
            nm: item.nm,
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

    function keepHighPriorityAfterTaskTrim(row) {
        const taskType = normalizeForMatch(row && row.task_type);
        const tags = reviewTags(row).map(normalizeForMatch);
        return taskType.includes("оклейка")
            || taskType.includes("usd")
            || taskType.includes("tmm")
            || tags.includes("идентификация из опп");
    }

    function trimTaskAfterSaleDuplicates(row, afterSaleIndex) {
        if (!row || isAfterSaleMovementTask(row) || !afterSaleIndex || !afterSaleIndex.size) {
            return { task: row, removed: [], dropped: false, trimmed: false };
        }
        const items = taskItems(row);
        if (!items.length) return { task: row, removed: [], dropped: false, trimmed: false };
        const removed = [];
        const kept = [];
        items.forEach((item) => {
            const match = afterSaleDedupeMatch(row, item, afterSaleIndex);
            if (match) removed.push({ shk: normalizeIdentifier(item.shk), date: match.date, task: match.task });
            else kept.push(item);
        });
        if (!removed.length) return { task: row, removed: [], dropped: false, trimmed: false };
        if (!kept.length) return { task: null, removed, dropped: true, trimmed: false };
        const price = sumTaskItems(kept);
        const priority = taskPriority(price, keepHighPriorityAfterTaskTrim(row));
        const removedShks = removed.map((item) => item.shk).filter(Boolean);
        const nextPayload = payloadWithItems(row, kept, {
            after_sale_dedupe_removed_shks: removedShks,
            after_sale_dedupe_removed_at: new Date().toISOString(),
            after_sale_dedupe_reason: "Исключено из задачи: по этому ШК и дате уже есть задача Движение после продажи.",
        });
        const nextTask = {
            ...row,
            source_payload: nextPayload,
            source_shk_ids: kept.map((item) => item.shk).filter(Boolean),
            source_price_sum: price,
            source_last_movement_at: sourceLastMovementFromItems(kept, row.source_last_movement_at),
            priority: priority.value,
            priority_label: priority.label,
            search_text: [row.title, row.task_type, row.source_tare_id, ...kept.map((item) => item.shk), ...kept.map((item) => item.name)].filter(Boolean).join(" "),
            description: normalizeText(row.description) + "\n\n-------------------------\nИсключено как дубль с Движением после продажи:\n" + removedShks.map((shk) => "- " + shk).join("\n"),
        };
        return { task: nextTask, removed, dropped: false, trimmed: true };
    }

    function filterTasksAfterSaleDuplicates(tasks, afterSaleIndex) {
        const result = [];
        const stats = { removedShkCount: 0, droppedTaskCount: 0, trimmedTaskCount: 0 };
        (tasks || []).forEach((task) => {
            const trimmed = trimTaskAfterSaleDuplicates(task, afterSaleIndex);
            stats.removedShkCount += trimmed.removed.length;
            if (trimmed.dropped) {
                stats.droppedTaskCount += 1;
                return;
            }
            if (trimmed.trimmed) stats.trimmedTaskCount += 1;
            if (trimmed.task) result.push(trimmed.task);
        });
        return { tasks: result, stats };
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
            refreshOpenSectionModal();
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
            refreshOpenSectionModal();
        } catch (error) {
            console.error("add shk failed:", error);
            if (status) status.textContent = "Не удалось добавить ШК: " + (error && error.message ? error.message : String(error));
        }
    }

    function updateTaskDetailForm() {
        const row = findTaskRow(state.taskDetail.rowId);
        const incomingFlow = isIncomingFlowRequestTask(row);
        const verdict = normalizeText($("taskVerdictInput") && $("taskVerdictInput").value) || "Не выбран";
        const comment = normalizeText($("taskCommentInput") && $("taskCommentInput").value);
        const extra = normalizeText($("taskExtraInput") && $("taskExtraInput").value);
        const missing = [];
        if (incomingFlow) {
            const extraLabel = DEFERRED_VERDICT_FIELDS[verdict] || "";
            const extraWrap = $("taskExtraFieldWrap");
            const extraLabelEl = $("taskExtraLabel");
            if (extraWrap) extraWrap.classList.toggle("hidden", !extraLabel);
            if (extraLabelEl) extraLabelEl.textContent = extraLabel;
            const guiltyIdError = incomingFlowGuiltyIdError($("taskGuiltyIdInput") && $("taskGuiltyIdInput").value);
            if (!comment) missing.push("Комментарий ОПП");
            if (!verdict || verdict === "Не выбран") missing.push("Вложение");
            if (guiltyIdError) missing.push(guiltyIdError);
            if (extraLabel && !extra) missing.push(extraLabel);
        } else {
            const tone = VERDICT_TONE[verdict] || "";
            updateComposeRows(verdict, tone, extra);
            if (!verdict || verdict === "Не выбран") missing.push("Вердикт");
            if (tone === "yellow" && !extra) missing.push(DEFERRED_VERDICT_FIELDS[verdict] || "Ссылка");
            if (tone === "red" && !comment) missing.push("Комментарий");
        }
        if (verdict === SYSTEM_MOVEMENT_VERDICT) missing.push("доступный пользователю вердикт");
        const ready = missing.length === 0;
        const button = $("completeTaskBtn");
        if (button) {
            const wasReady = !button.disabled;
            button.disabled = !ready;
            button.title = ready ? "" : "Не заполнено: " + missing.join(", ");
            if (ready && !wasReady) {
                button.classList.remove("is-pop");
                void button.offsetWidth;
                button.classList.add("is-pop");
            }
        }
    }

    function positionCommentField(tone) {
        const textarea = $("taskCommentInput");
        if (!textarea) return;
        const aboveInner = $("taskComposeAboveInner");
        const belowInner = $("taskComposeBelowInner");
        if (tone === "red" && aboveInner) {
            if (textarea.parentElement !== aboveInner) aboveInner.appendChild(textarea);
            textarea.placeholder = "Что сделали по задаче";
        } else if (belowInner) {
            if (textarea.parentElement !== belowInner) belowInner.appendChild(textarea);
            textarea.placeholder = "Если есть что запомнить";
        }
    }

    function updateComposeRows(verdict, tone, extraValue) {
        const bar = $("taskComposeBar");
        if (bar) {
            bar.classList.remove("tone-green", "tone-yellow", "tone-red");
            if (tone) bar.classList.add("tone-" + tone);
        }
        const trigger = $("taskVerdictTrigger");
        if (trigger) trigger.classList.toggle("is-narrow", tone === "yellow");
        const extraLabel = DEFERRED_VERDICT_FIELDS[verdict] || "";
        const extraWrap = $("taskExtraFieldWrap");
        const extraLabelEl = $("taskExtraLabel");
        if (extraLabelEl) extraLabelEl.textContent = extraLabel;
        if (extraWrap) extraWrap.classList.toggle("hidden", tone !== "yellow");
        positionCommentField(tone);
        const aboveRow = $("taskComposeAboveRow");
        const belowRow = $("taskComposeBelowRow");
        if (aboveRow) aboveRow.classList.toggle("is-expanded", tone === "yellow" || tone === "red");
        if (belowRow) belowRow.classList.toggle("is-expanded", tone === "yellow" && Boolean(extraValue));
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

    function flowAccessAllowed() {
        const user = currentWmsUser();
        return FLOW_ALLOWED_USER_IDS.has(normalizeIdentifier(user.id));
    }

    function ensureDevelopmentAccess(featureName) {
        if (flowAccessAllowed()) return true;
        toast((featureName || "Этот режим") + " пока доступен только пользователю 1034305.", "error");
        renderFlowAccessGate();
        return false;
    }

    function renderFlowAccessGate() {
        const allowed = flowAccessAllowed();
        document.querySelectorAll("[data-dev-only]").forEach((card) => {
            card.classList.toggle("is-disabled", !allowed);
            card.setAttribute("aria-disabled", allowed ? "false" : "true");
            if ("disabled" in card) card.disabled = !allowed;
            card.title = allowed ? "" : "Раздел в разработке. Пока доступен только пользователю 1034305.";
        });
    }

    function moscowDateFromValue(value) {
        const date = value ? new Date(value) : new Date();
        if (!Number.isFinite(date.getTime())) return "";
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
        const byType = {};
        parts.forEach((part) => { byType[part.type] = part.value; });
        return byType.year + "-" + byType.month + "-" + byType.day;
    }

    function moscowMinutesFromValue(value) {
        const date = value ? new Date(value) : new Date();
        if (!Number.isFinite(date.getTime())) return 0;
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
        const byType = {};
        parts.forEach((part) => { byType[part.type] = part.value; });
        return (Number(byType.hour) || 0) * 60 + (Number(byType.minute) || 0);
    }

    function userTaskQuery(query, user) {
        const id = normalizeText(user && user.id);
        const name = normalizeText(user && user.name);
        if (id && id !== "local") return query.eq("assignee_employee_id", id);
        if (name) return query.eq("assignee_name", name);
        return query;
    }

    function isSystemCompletionVerdict(value) {
        return SYSTEM_COMPLETION_VERDICT_KEYS.has(normalizeForMatch(value));
    }

    function isManualAchievementTask(row) {
        if (!row || normalizeText(row.task_status) !== "Завершено") return false;
        if (isTrueLike(row.is_deleted)) return false;
        if (isSystemCompletionVerdict(row.opp_verdict)) return false;
        return true;
    }

    function hydrateLeanAchievementRow(row) {
        return {
            ...row,
            source_payload: {
                wms_review: {
                    completed_by_id: row.completed_by_id || null,
                    completed_by_name: row.completed_by_name || null,
                },
            },
        };
    }

    async function fetchCompletedAchievementTasks() {
        const db = supabaseDb();
        if (!db) return { ok: true, rows: [] };
        const user = achievementActor();
        try {
            let query = db
                .from(WMS_TASKS_TABLE)
                .select(ACHIEVEMENT_TASK_LEAN_COLUMNS)
                .eq("task_status", "Завершено")
                .order("completed_at", { ascending: false, nullsFirst: false })
                .limit(10000);
            const { data, error } = await query;
            if (error) throw error;
            const rows = (data || []).map(hydrateLeanAchievementRow);
            return { ok: true, rows: rows.filter((row) => isManualAchievementTask(row) && taskCompletedByMatches(row, user)) };
        } catch (error) {
            console.warn("achievement completed tasks query skipped:", error);
            // ok:false must never be treated as "zero eligible tasks" by a caller --
            // cleanupIneligibleTaskAchievements() would otherwise read a transient
            // query failure (this table is large and occasionally times out) as
            // "user no longer qualifies for anything" and revoke real achievements.
            return { ok: false, rows: [] };
        }
    }

    function rowsCompletedOnDate(rows, isoDate) {
        return (rows || []).filter((row) => moscowDateFromValue(row.completed_at || row.updated_at) === isoDate);
    }

    function taskSectionForAchievement(row) {
        return requestSectionName(row) || taskSectionName(row);
    }

    function eligibleTaskAchievements(rows) {
        const eligible = new Set();
        const manualRows = (rows || []).filter(isManualAchievementTask);
        const total = manualRows.length;
        if (total >= 10) eligible.add("tasks_10");
        if (total >= 100) eligible.add("tasks_100");
        if (total >= 1000) eligible.add("tasks_1000");
        if (total >= 10000) eligible.add("tasks_10000");

        const countBySection = (section) => manualRows.filter((row) => taskSectionForAchievement(row) === section).length;
        const awhCount = countBySection("Списания AWH");
        const boxesCount = countBySection("Коробки на входе");
        const requestCount = countBySection("Запросы входящего потока");
        if (awhCount >= 1) eligible.add("awh_first");
        if (awhCount >= 10) eligible.add("awh_10");
        if (awhCount >= 100) eligible.add("awh_100");
        if (awhCount >= 1000) eligible.add("awh_1000");
        if (boxesCount >= 1) eligible.add("boxes_first");
        if (boxesCount >= 10) eligible.add("boxes_10");
        if (boxesCount >= 100) eligible.add("boxes_100");
        if (boxesCount >= 1000) eligible.add("boxes_1000");
        if (requestCount >= 1) eligible.add("requests_first");
        if (requestCount >= 100) eligible.add("requests_100");
        if (manualRows.some((row) => moscowMinutesFromValue(row.completed_at || row.updated_at) >= 20 * 60)) eligible.add("task_after_20");

        const byDate = new Map();
        manualRows.forEach((row) => {
            const date = moscowDateFromValue(row.completed_at || row.updated_at);
            if (!date) return;
            if (!byDate.has(date)) byDate.set(date, { count: 0, types: new Set() });
            const bucket = byDate.get(date);
            bucket.count += 1;
            const type = normalizeText(row.task_type);
            if (type) bucket.types.add(type);
        });
        byDate.forEach((bucket) => {
            if (bucket.count >= 100) eligible.add("shift_100_tasks");
            if (bucket.count >= 200) eligible.add("shift_200_tasks");
            if (bucket.count >= 300) eligible.add("shift_300_tasks");
            if (bucket.types.size >= 10) eligible.add("ten_task_types_shift");
        });
        return eligible;
    }

    async function cleanupIneligibleTaskAchievements() {
        if (state.achievements.cleaning) return;
        const hasRecountable = RECOUNTABLE_TASK_ACHIEVEMENT_IDS.some((id) => state.achievements.earned.has(id));
        if (!hasRecountable || !supabaseDb()) return;
        state.achievements.cleaning = true;
        try {
            const fetched = await fetchCompletedAchievementTasks();
            if (!fetched.ok) return;
            const eligible = eligibleTaskAchievements(fetched.rows);
            const invalid = RECOUNTABLE_TASK_ACHIEVEMENT_IDS.filter((id) => state.achievements.earned.has(id) && !eligible.has(id));
            if (invalid.length) await forgetAchievements(invalid);
        } catch (error) {
            console.warn("achievement recount skipped:", error);
        } finally {
            state.achievements.cleaning = false;
        }
    }

    async function countUserOpenedShifts() {
        const db = supabaseDb();
        const user = achievementActor();
        if (!db) return 0;
        try {
            let query = db
                .from(WMS_SHIFTS_TABLE)
                .select("id", { count: "exact", head: true })
                .eq("wh_id", WH_ID)
                .neq("status", "cancelled");
            if (user.id && user.id !== "local") query = query.ilike("opened_by", "%" + user.id + "%");
            else if (user.name) query = query.ilike("opened_by", "%" + user.name + "%");
            const { count, error } = await query;
            if (error) throw error;
            return Number(count) || 0;
        } catch (error) {
            console.warn("achievement shifts query skipped:", error);
            return 0;
        }
    }

    async function countCompletedPrespisokRuns() {
        const db = supabaseDb();
        const user = achievementActor();
        if (!db) return 0;
        try {
            let query = db
                .from(WMS_PRESPISOK_RUNS_TABLE)
                .select("id", { count: "exact", head: true })
                .eq("wh_id", WH_ID)
                .eq("status", "completed");
            if (user.id && user.id !== "local") query = query.eq("operator_id", user.id);
            else if (user.name) query = query.eq("operator_name", user.name);
            const { count, error } = await query;
            if (error) throw error;
            return Number(count) || 0;
        } catch (error) {
            console.warn("achievement prespisok count skipped:", error);
            return 0;
        }
    }

    async function hasPrespisokSevenDayStreak() {
        const db = supabaseDb();
        const user = achievementActor();
        if (!db) return false;
        try {
            let query = db
                .from(WMS_PRESPISOK_RUNS_TABLE)
                .select("run_date")
                .eq("wh_id", WH_ID)
                .eq("status", "completed")
                .gte("run_date", addDays(state.today, -13))
                .order("run_date", { ascending: false });
            if (user.id && user.id !== "local") query = query.eq("operator_id", user.id);
            else if (user.name) query = query.eq("operator_name", user.name);
            const { data, error } = await query;
            if (error) throw error;
            const dates = new Set((data || []).map((row) => normalizeText(row.run_date)).filter(Boolean));
            for (let offset = 0; offset < 7; offset += 1) {
                if (!dates.has(addDays(state.today, -offset))) return false;
            }
            return true;
        } catch (error) {
            console.warn("achievement prespisok streak skipped:", error);
            return false;
        }
    }

    async function evaluateShiftAchievements(incomingId, outgoingId) {
        await unlockAchievement("shift_open_first", { shift_date: state.today });
        if (incomingId && outgoingId && incomingId === outgoingId) await unlockAchievement("dual_flow_shift", { shift_date: state.today });
        const count = await countUserOpenedShifts();
        if (count >= 10) await unlockAchievement("shift_open_10", { count });
    }

    async function evaluatePrespisokAchievements(record) {
        await unlockAchievement("prespisok_first", { run_date: state.today });
        const count = await countCompletedPrespisokRuns();
        if (count >= 10) await unlockAchievement("prespisok_10", { count });
        if (count >= 100) await unlockAchievement("prespisok_100", { count });
        const elapsed = Number(record && record.elapsed_ms) || prespisokElapsedMs();
        if (elapsed > 0 && elapsed < 60 * 60 * 1000) await unlockAchievement("prespisok_speedrun_60", { elapsed_ms: Math.round(elapsed) });
        if (await hasPrespisokSevenDayStreak()) await unlockAchievement("prespisok_7_days", { run_date: state.today });
        const actions = state.prespisok.actions || [];
        const allWriteoff = actions.length > 0 && actions.every((action) => normalizeForMatch(action.verdict || action.action_key).includes("автоспис"));
        if (allWriteoff) await unlockAchievement("prespisok_all_writeoff", { actions: actions.length });
        await evaluateTaskCompletionAchievements(null, { prespisokCompleted: true });
    }

    async function evaluateQuickNoShkAchievements() {
        const actions = state.quickNoShk.actions || [];
        const elapsed = quickNoShkElapsedMs();
        if (actions.length >= 150 && elapsed > 0 && elapsed < 10 * 60 * 1000) {
            await unlockAchievement("no_shk_150_10", { actions: actions.length, elapsed_ms: Math.round(elapsed) });
        }
    }

    async function evaluateTaskCompletionAchievements(completedRow, options) {
        if (completedRow && !isManualAchievementTask(completedRow)) return;
        const rows = (await fetchCompletedAchievementTasks()).rows;
        const allRows = completedRow && !rows.some((row) => row.id === completedRow.id) ? [completedRow].concat(rows) : rows;
        const total = allRows.length;
        if (total >= 10) await unlockAchievement("tasks_10", { count: total });
        if (total >= 100) await unlockAchievement("tasks_100", { count: total });
        if (total >= 1000) await unlockAchievement("tasks_1000", { count: total });
        if (total >= 10000) await unlockAchievement("tasks_10000", { count: total });

        const countBySection = (section) => allRows.filter((row) => taskSectionForAchievement(row) === section).length;
        const completedSection = completedRow ? taskSectionForAchievement(completedRow) : "";
        if (completedSection === "Списания AWH") {
            const awhCount = countBySection("Списания AWH");
            if (awhCount >= 1) await unlockAchievement("awh_first", { count: awhCount });
            if (awhCount >= 10) await unlockAchievement("awh_10", { count: awhCount });
            if (awhCount >= 100) await unlockAchievement("awh_100", { count: awhCount });
            if (awhCount >= 1000) await unlockAchievement("awh_1000", { count: awhCount });
        }
        if (completedSection === "Коробки на входе") {
            const boxesCount = countBySection("Коробки на входе");
            if (boxesCount >= 1) await unlockAchievement("boxes_first", { count: boxesCount });
            if (boxesCount >= 10) await unlockAchievement("boxes_10", { count: boxesCount });
            if (boxesCount >= 100) await unlockAchievement("boxes_100", { count: boxesCount });
            if (boxesCount >= 1000) await unlockAchievement("boxes_1000", { count: boxesCount });
        }
        if (completedSection === "Запросы входящего потока") {
            const requestCount = countBySection("Запросы входящего потока");
            if (requestCount >= 1) await unlockAchievement("requests_first", { count: requestCount });
            if (requestCount >= 100) await unlockAchievement("requests_100", { count: requestCount });
        }

        const shiftRows = rowsCompletedOnDate(allRows, state.today);
        if (shiftRows.length >= 100) await unlockAchievement("shift_100_tasks", { count: shiftRows.length, shift_date: state.today });
        if (shiftRows.length >= 200) await unlockAchievement("shift_200_tasks", { count: shiftRows.length, shift_date: state.today });
        if (shiftRows.length >= 300) await unlockAchievement("shift_300_tasks", { count: shiftRows.length, shift_date: state.today });
        const typeCount = new Set(shiftRows.map((row) => normalizeText(row.task_type)).filter(Boolean)).size;
        if (typeCount >= 10) await unlockAchievement("ten_task_types_shift", { count: typeCount, shift_date: state.today });

        const completedAt = completedRow && (completedRow.completed_at || completedRow.updated_at);
        const shift = state.shift.current;
        if (completedAt && moscowMinutesFromValue(completedAt) >= 20 * 60) await unlockAchievement("task_after_20", { completed_at: completedAt });
        if (completedAt && shift && shift.opened_at) {
            const delta = Date.parse(completedAt) - Date.parse(shift.opened_at);
            if (delta >= 0 && delta < 5 * 60 * 1000) await unlockAchievement("first_task_5m", { delta_ms: delta });
            const firstHour = shiftRows.filter((row) => {
                const ts = Date.parse(row.completed_at || row.updated_at);
                const opened = Date.parse(shift.opened_at);
                return Number.isFinite(ts) && Number.isFinite(opened) && ts >= opened && ts <= opened + 60 * 60 * 1000;
            }).length;
            if (firstHour >= 25) await unlockAchievement("tasks_first_hour_25", { count: firstHour });
        }

        const hasPrespisok = Boolean(options && options.prespisokCompleted) || normalizeText(state.prespisokHome.run && state.prespisokHome.run.status) === "completed" || (state.prespisok.actions || []).length > 0;
        if (hasPrespisok
            && shiftRows.some((row) => taskSectionForAchievement(row) === "Списания AWH")
            && shiftRows.some((row) => taskSectionForAchievement(row) === "Коробки на входе")) {
            await unlockAchievement("triple_prespisok_awh_boxes", { shift_date: state.today });
        }

        if (state.review.loaded) {
            const activeCount = (state.review.rows || []).filter(isActiveReviewTask).length;
            if (activeCount === 0) await unlockAchievement("zero_active_tasks", { shift_date: state.today });
        }
    }

    function needsSourceWriteback(row) {
        return isIncomingFlowRequestTask(row);
    }

    function normalizeGuiltyId(value) {
        return normalizeText(value).replace(/\D+/g, "").slice(0, 8);
    }

    function incomingFlowGuiltyIdError(value) {
        const normalized = normalizeGuiltyId(value);
        if (!normalized) return "ID виновного";
        if (!/^\d{5,8}$/.test(normalized)) return "ID виновного: 5-8 цифр";
        return "";
    }

    function sourceRowNumberForTask(row) {
        const payload = taskPayload(row);
        const direct = normalizeIdentifier(payload.source_row_number || payload.sourceRowNumber || payload.row_number || payload.row);
        if (direct) return direct;
        const sourceRowId = normalizeText(row && row.source_row_id);
        const match = sourceRowId.match(/(\d+)\s*$/);
        return match ? match[1] : "";
    }

    function incomingFlowSourceSheetUrl(row) {
        const payload = taskPayload(row);
        const spreadsheetId = normalizeText(payload.spreadsheet_id || payload.spreadsheetId || payload.source_spreadsheet_id);
        if (!spreadsheetId) return "";
        const rowNumber = sourceRowNumberForTask(row);
        const gid = normalizeIdentifier(payload.gid || payload.sheet_gid || payload.source_gid || payload.source_sheet_gid);
        const parts = [];
        if (gid) parts.push("gid=" + encodeURIComponent(gid));
        if (rowNumber) parts.push("range=" + encodeURIComponent("H" + rowNumber + ":I" + rowNumber));
        return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(spreadsheetId) + "/edit" + (parts.length ? "#" + parts.join("&") : "");
    }

    function isIncomingFlowWritebackConflict(error) {
        const message = normalizeText(error && error.message ? error.message : error);
        return /строка\s+\d+.*уже\s+заполн/i.test(message) || /уже\s+заполнен[аы]?.*столбц[еа]\s+h/i.test(message);
    }

    function showIncomingFlowWritebackConflict(row, error) {
        const status = $("taskDetailStatus");
        const actions = $("taskWritebackConflictActions");
        const rowNumber = sourceRowNumberForTask(row);
        const url = incomingFlowSourceSheetUrl(row);
        if (status) {
            status.textContent = "В исходной таблице строка " + (rowNumber || "") + " уже заполнена. Проверь H/I: если данные корректные, можно закрыть задачу без повторной записи. Если в таблице ошибка, перезапиши только H/I.";
        }
        if (!actions) return;
        actions.classList.remove("hidden");
        actions.innerHTML = "<div class='task-writeback-note'>"
            + escapeHtml(error && error.message ? error.message : String(error))
            + "</div><div class='file-row'>"
            + (url ? "<a class='btn btn-outline' href='" + escapeHtml(url) + "' target='_blank' rel='noopener'>Проверить таблицу</a>" : "<button class='btn btn-outline' type='button' disabled>Проверить таблицу</button>")
            + "<button id='completeTaskSkipWriteback' class='btn btn-outline' type='button'>Закрыть задачу</button>"
            + "<button id='completeTaskOverwriteWriteback' class='btn btn-rect' type='button'>Перезаписать данные в таблице</button>"
            + "</div>";
        const skip = $("completeTaskSkipWriteback");
        const overwrite = $("completeTaskOverwriteWriteback");
        if (skip) skip.addEventListener("click", () => { void completeTaskFromDetail(row.id, { skipSourceWriteback: true }); });
        if (overwrite) overwrite.addEventListener("click", () => { void completeTaskFromDetail(row.id, { overwriteSourceWriteback: true }); });
    }

    function wmsWritebackSecret() {
        return normalizeText(localStorage.getItem("wms_task_writeback_secret") || localStorage.getItem("WMS_TASK_WRITEBACK_SECRET"));
    }

    async function writeBackTaskToSource(row, review, options) {
        if (!needsSourceWriteback(row)) return null;
        const response = await fetch(SUPABASE_FUNCTIONS_BASE_URL + "/" + WMS_TASK_WRITEBACK_FUNCTION, {
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/json",
                apikey: SUPABASE_PUBLIC_ANON_KEY,
                authorization: "Bearer " + SUPABASE_PUBLIC_ANON_KEY,
            },
            body: JSON.stringify({
                task_id: row.id,
                secret: wmsWritebackSecret() || undefined,
                review,
                allow_overwrite: Boolean(options && options.overwrite),
            }),
        });
        const text = await response.text();
        let payload = {};
        try {
            payload = text ? JSON.parse(text) : {};
        } catch (_error) {
            payload = { raw: text };
        }
        if (!response.ok || payload.ok === false) {
            const message = payload && payload.error ? payload.error : text || response.statusText;
            throw new Error("Не удалось записать результат в источник: " + message);
        }
        return payload;
    }

    async function completeTaskFromDetail(id, options) {
        const opts = options || {};
        const db = supabaseDb();
        if (!db || !id) return;
        const row = findTaskRow(id);
        if (!row) return;
        const user = currentWmsUser();
        const incomingFlow = isIncomingFlowRequestTask(row);
        const verdict = normalizeText($("taskVerdictInput") && $("taskVerdictInput").value) || "Не выбран";
        const comment = normalizeText($("taskCommentInput") && $("taskCommentInput").value);
        const extraLabel = DEFERRED_VERDICT_FIELDS[verdict] || "";
        const extraValue = normalizeText($("taskExtraInput") && $("taskExtraInput").value);
        const guiltyId = incomingFlow ? normalizeGuiltyId($("taskGuiltyIdInput") && $("taskGuiltyIdInput").value) : "";
        const guiltyIdError = incomingFlow ? incomingFlowGuiltyIdError(guiltyId) : "";
        if (verdict === SYSTEM_MOVEMENT_VERDICT) {
            const status = $("taskDetailStatus");
            if (status) status.textContent = "Вердикт “" + SYSTEM_MOVEMENT_VERDICT + "” ставится только системой при актуализации движения.";
            return;
        }
        if (incomingFlow && guiltyId === "1034305") void unlockAchievement("guilty_1034305", { task_id: id, source_id: row.source_id });
        const tone = incomingFlow ? "" : (VERDICT_TONE[verdict] || "");
        const commentRequired = incomingFlow || tone === "red";
        if ((commentRequired && !comment) || verdict === "Не выбран" || (extraLabel && !extraValue) || guiltyIdError) {
            const status = $("taskDetailStatus");
            if (status) status.textContent = incomingFlow
                ? "Заполни Комментарий ОПП, Вложение и ID виновного: только цифры, 5-8 символов."
                : "Заполни вердикт и обязательное поле по выбранному вердикту.";
            return;
        }
        const now = new Date().toISOString();
        const isDeferred = Boolean(DEFERRED_VERDICT_FIELDS[verdict]);
        const reviewPayload = {
            comment,
            verdict,
            attachment: incomingFlow ? verdict : "",
            guilty_id: guiltyId || "",
            extra_label: extraLabel,
            extra_value: extraValue,
            completed_by_id: user.id || null,
            completed_by_name: user.name || null,
            completed_at: now,
            reopen_after: isDeferred ? addDaysIso(2) : null,
        };
        const reopenAfter = isDeferred ? addDaysIso(2) : null;
        const button = $("completeTaskBtn");
        const status = $("taskDetailStatus");
        if (button) button.disabled = true;
        let writebackResponse = null;
        try {
            if (!isDeferred && needsSourceWriteback(row) && !opts.skipSourceWriteback) {
                if (status) status.textContent = "Записываю результат в исходную таблицу...";
                writebackResponse = await writeBackTaskToSource(row, reviewPayload, { overwrite: opts.overwriteSourceWriteback });
            } else if (opts.skipSourceWriteback) {
                writebackResponse = { ok: true, skipped: true, reason: "source_checked_manually" };
            }
        } catch (error) {
            console.error("wms source writeback failed:", error);
            if (incomingFlow && isIncomingFlowWritebackConflict(error)) {
                showIncomingFlowWritebackConflict(row, error);
                if (button) button.disabled = false;
                return;
            }
            if (status) status.textContent = error && error.message ? error.message : String(error);
            if (button) button.disabled = false;
            return;
        }
        const nextPayload = {
            ...taskPayload(row),
            wms_review: {
                ...taskReviewPayload(row),
                ...reviewPayload,
            },
            wms_writeback: writebackResponse,
        };
        const payload = {
            opp_verdict: verdict,
            task_status: isDeferred ? "Отложено" : "Завершено",
            completed_at: now,
            reopen_after: reopenAfter,
            source_payload: nextPayload,
            updated_at: now,
        };
        if (status) status.textContent = "Сохраняю задачу...";
        try {
            const { data, error } = await db
                .from(WMS_TASKS_TABLE)
                .update(payload)
                .eq("id", id)
                .select("id,source_payload,task_status,opp_verdict,assignee_employee_id,assignee_name,completed_at,reopen_after,updated_at")
                .single();
            if (error) throw error;
            const completedForAchievements = { ...row, ...payload, ...(data || {}) };
            const stateRow = (state.review.rows || []).find((item) => item.id === id);
            if (stateRow) Object.assign(stateRow, data || payload);
            state.review.rows = (state.review.rows || []).filter((item) => item.id !== id || isActiveReviewTask(item));
            if (state.flow.currentRowId === id) {
                state.flow.currentRowId = "";
                state.flow.currentScore = null;
            }
            void writeTaskHistory(completedForAchievements, isDeferred ? "task_deferred" : "task_completed", {
                title: displayTaskTitle(row),
                verdict,
                comment,
                extra_label: extraLabel,
                extra_value: extraValue,
                completed_by_id: user.id || null,
                completed_by_name: user.name || null,
                reopen_after: reopenAfter,
            });
            if (!isDeferred && state.flow.employeeStats.loaded && isManualAchievementTask(completedForAchievements)) {
                const section = flowTaskSection(completedForAchievements);
                if (!state.flow.employeeStats.bySection[section]) state.flow.employeeStats.bySection[section] = { count: 0 };
                state.flow.employeeStats.bySection[section].count += 1;
            }
            setReviewStatus(isDeferred ? "Задача отложена до " + formatRuDateTime(reopenAfter) + "." : "Задача завершена.", "good");
            renderReview();
            refreshOpenSectionModal();
            if (state.view === "flow") {
                refreshFlowQueue();
                renderFlowPage();
            }
            if (!isDeferred) void evaluateTaskCompletionAchievements(completedForAchievements, { source: "manual_task_complete" });
            if (!incomingFlow && tone) void playTaskCompletionCelebration(tone).then(closeTaskDetail);
            else closeTaskDetail();
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
            void writeTaskHistory({ ...row, ...payload, ...(data || {}) }, "task_deferred", {
                title: displayTaskTitle(row),
                comment: reason,
                reopen_after: reopenAfter,
            });
            const activeRow = (state.review.rows || []).find((item) => item.id === id);
            if (activeRow) Object.assign(activeRow, data || payload);
            state.review.rows = (state.review.rows || []).filter((item) => item.id !== id || isActiveReviewTask(item));
            closeDeferTaskModal();
            setReviewStatus("Задача отложена до " + formatRuDateTime(reopenAfter) + ".", "good");
            renderReview();
            refreshOpenSectionModal();
            void playTaskCompletionCelebration("yellow").then(closeTaskDetail);
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
            void writeTaskHistory({ ...row, ...payload, ...(data || {}) }, "task_reopened", {
                title: displayTaskTitle(row),
            });
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

    async function loadPrespisokSecondLineTasks() {
        const db = supabaseDb();
        if (!db) throw new Error("Supabase недоступен.");
        state.prespisokSecondLine.loading = true;
        renderPrespisokSecondLineTable();
        try {
            const rows = await fetchWmsTaskRows(db, "active");
            state.prespisokSecondLine.rows = rows.filter((row) => isActiveReviewTask(row) && isPrespisokTask(row));
            state.prespisokSecondLine.loaded = true;
        } finally {
            state.prespisokSecondLine.loading = false;
            renderPrespisokSecondLineTable();
        }
    }

    async function openPrespisokSecondLineModal() {
        setFlowModalOpen("prespisokSecondLineModal", true);
        renderPrespisokSecondLineTable();
        await loadPrespisokSecondLineTasks();
    }

    function closePrespisokSecondLineModal() {
        setFlowModalOpen("prespisokSecondLineModal", false);
    }

    function closePrespisokJournalModal() {
        setFlowModalOpen("prespisokJournalModal", false);
        setFlowModalOpen("prespisokJournalDetailModal", false);
    }

    function closePrespisokJournalDetailModal() {
        setFlowModalOpen("prespisokJournalDetailModal", false);
    }

    async function openPrespisokJournalModal() {
        setFlowModalOpen("prespisokJournalModal", true);
        state.prespisokJournal.selectedRunId = "";
        renderPrespisokJournal();
        await loadPrespisokJournal();
    }

    function sortedPrespisokSecondLineRows(rows) {
        const previous = state.review.sort;
        state.review.sort = state.prespisokSecondLine.sort || { key: "price", dir: "desc" };
        const sorted = sortedReviewRows(rows || []);
        state.review.sort = previous;
        return sorted;
    }

    function prespisokTaskCreator(row) {
        const payload = taskPayload(row);
        return [normalizeText(payload.prespisok_created_by_name), normalizeText(payload.prespisok_created_by_id)].filter(Boolean).join(" / ") || "Не определено";
    }

    function renderPrespisokSecondLineTable() {
        const target = $("prespisokSecondLineWrap");
        if (!target) return;
        const rows = sortedPrespisokSecondLineRows(state.prespisokSecondLine.rows || []);
        if (state.prespisokSecondLine.loading) {
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>2-я линия предсписка</h3><div class='review-table-subtitle'>Загружаю задачи с тегом Предсписок...</div></div><button id='closePrespisokSecondLine' class='btn btn-square' type='button'>×</button></div><div class='empty-state'>Гружу. Даже вторая линия не любит ждать, но потерпит.</div>";
        } else {
            const body = rows.map((row) => "<tr class='review-click-row' data-prespisok-second-task='" + escapeHtml(row.id) + "'>"
                + "<td class='review-wrap-cell'><div class='review-task-title'>" + escapeHtml(displayTaskTitle(row)) + "</div><div class='review-task-sub'>" + escapeHtml(row.task_type || "-") + "</div><div class='review-task-sub'>Создал: " + escapeHtml(prespisokTaskCreator(row)) + "</div></td>"
                + "<td><span class='review-pill'>" + escapeHtml(taskEntityTypeLabel(row)) + "</span></td>"
                + "<td class='review-wrap-cell'>" + escapeHtml(taskItemName(row) || "-") + "</td>"
                + "<td class='review-wrap-cell'>" + escapeHtml(prespisokTaskCreator(row)) + "</td>"
                + "<td class='review-price-cell' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</td>"
                + "<td><span class='review-pill'>" + escapeHtml(displayTaskStatus(row)) + "</span></td>"
                + "</tr>").join("");
            const previousSort = state.review.sort;
            state.review.sort = state.prespisokSecondLine.sort || { key: "price", dir: "desc" };
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>2-я линия предсписка</h3><div class='review-table-subtitle'>Задачи, созданные из предсписка кнопкой “Создать задачу”. Задач: " + rows.length + ".</div></div><div class='file-row' style='margin-top:0'><button id='refreshPrespisokSecondLine' class='btn btn-outline' type='button'>Обновить</button><button id='closePrespisokSecondLine' class='btn btn-square' type='button'>×</button></div></div>"
                + (rows.length ? "<div class='review-table-scroll'><table class='review-data-table'><thead><tr>"
                + reviewSortHead("title", "Задача")
                + reviewSortHead("entityType", "Тип")
                + reviewSortHead("name", "Наименование")
                + reviewSortHead("creator", "Кто создал")
                + reviewSortHead("price", "Стоимость")
                + reviewSortHead("status", "Статус")
                + "</tr></thead><tbody>" + body + "</tbody></table></div>" : "<div class='empty-state'>Задач второй линии пока нет.</div>");
            state.review.sort = previousSort;
        }
        const close = $("closePrespisokSecondLine");
        if (close) close.addEventListener("click", closePrespisokSecondLineModal);
        const refresh = $("refreshPrespisokSecondLine");
        if (refresh) refresh.addEventListener("click", () => { void loadPrespisokSecondLineTasks(); });
        target.querySelectorAll("[data-review-sort]").forEach((button) => {
            button.addEventListener("click", () => {
                const key = button.dataset.reviewSort || "price";
                const current = state.prespisokSecondLine.sort || { key: "price", dir: "desc" };
                state.prespisokSecondLine.sort = current.key === key
                    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
                    : { key, dir: key === "price" ? "desc" : "asc" };
                renderPrespisokSecondLineTable();
            });
        });
        target.querySelectorAll("[data-prespisok-second-task]").forEach((row) => {
            row.addEventListener("click", () => {
                const taskId = row.dataset.prespisokSecondTask;
                const task = (state.prespisokSecondLine.rows || []).find((item) => item.id === taskId);
                if (task && !(state.review.rows || []).some((item) => item.id === task.id)) state.review.rows.push(task);
                openTaskDetail(taskId, "review");
            });
        });
    }

    function prespisokRunStatusLabel(status) {
        const normalized = normalizeText(status);
        if (normalized === "completed") return "Сделан";
        if (normalized === "started" || normalized === "in_progress") return "В работе";
        return normalized || "Не сделан";
    }

    function prespisokJournalDays() {
        const days = [];
        for (let offset = 29; offset >= 0; offset -= 1) days.push(addDays(state.today, -offset));
        return days;
    }

    function weekdayIndexMonday(isoDate) {
        const date = new Date(normalizeText(isoDate) + "T00:00:00Z");
        if (!Number.isFinite(date.getTime())) return 0;
        return (date.getUTCDay() + 6) % 7;
    }

    function latestPrespisokRunsByDate() {
        const byDate = new Map();
        (state.prespisokJournal.runs || []).forEach((run) => {
            const date = normalizeText(run.run_date);
            if (!date) return;
            const current = byDate.get(date);
            if (!current || normalizeText(run.updated_at) > normalizeText(current.updated_at)) byDate.set(date, run);
        });
        return byDate;
    }

    function prespisokActionActorLabel(action) {
        return [normalizeText(action && action.actor && action.actor.name), normalizeText(action && action.actor && action.actor.id)].filter(Boolean).join(" / ") || "Не определено";
    }

    function prespisokActionEntityLabel(action) {
        const tare = normalizeIdentifier(action && action.source_tare_id);
        const shks = Array.isArray(action && action.source_shk_ids) ? action.source_shk_ids.map(normalizeIdentifier).filter(Boolean) : [];
        if (tare) return "Тара " + tare + (shks.length ? " · ШК: " + shks.slice(0, 4).join(", ") + (shks.length > 4 ? " +" + (shks.length - 4) : "") : "");
        return "ШК " + (normalizeIdentifier(action && action.entity_id) || shks[0] || "-");
    }

    function prespisokJournalMoneyStats(actions) {
        return (actions || []).reduce((acc, action) => {
            const key = normalizeText(action.action_key);
            const verdict = normalizeForMatch(action.verdict);
            const price = Number(action.price) || 0;
            if (key === "movement" || key === "release" || verdict === "движение" || verdict === "нужен релиз") acc.saved += price;
            if (key === "auto_writeoff" || key === "writeoff" || verdict === "автосписание" || verdict === "нужно списание") acc.writeoff += price;
            return acc;
        }, { saved: 0, writeoff: 0 });
    }

    async function loadPrespisokJournal() {
        const db = supabaseDb();
        if (!db) {
            state.prespisokJournal.error = "Supabase недоступен.";
            renderPrespisokJournal();
            return;
        }
        state.prespisokJournal.loading = true;
        state.prespisokJournal.error = "";
        renderPrespisokJournal();
        try {
            const start = addDays(state.today, -29);
            const { data, error } = await db
                .from(WMS_PRESPISOK_RUNS_TABLE)
                .select("*")
                .eq("wh_id", WH_ID)
                .gte("run_date", start)
                .lte("run_date", state.today)
                .order("run_date", { ascending: false })
                .order("updated_at", { ascending: false });
            if (error) throw error;
            state.prespisokJournal.runs = Array.isArray(data) ? data : [];
        } catch (error) {
            state.prespisokJournal.error = error && error.message ? error.message : String(error);
        } finally {
            state.prespisokJournal.loading = false;
            renderPrespisokJournal();
        }
    }

    async function selectPrespisokJournalRun(runId) {
        state.prespisokJournal.selectedRunId = runId || "";
        renderPrespisokJournal();
        setFlowModalOpen("prespisokJournalDetailModal", true);
        renderPrespisokJournalDetail();
        if (!runId || state.prespisokJournal.actionsByRunId[runId]) return;
        const actions = await fetchPrespisokActions(runId);
        state.prespisokJournal.actionsByRunId[runId] = Array.isArray(actions) ? actions : [];
        renderPrespisokJournal();
        renderPrespisokJournalDetail();
    }

    function renderPrespisokJournalDetail() {
        const target = $("prespisokJournalDetailWrap");
        if (!target) return;
        const selectedRun = (state.prespisokJournal.runs || []).find((run) => run.id === state.prespisokJournal.selectedRunId) || null;
        const selectedActions = selectedRun ? state.prespisokJournal.actionsByRunId[selectedRun.id] : null;
        if (!selectedRun) {
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Детали предсписка</h3><div class='review-table-subtitle'>Выберите день в журнале.</div></div><button id='closePrespisokJournalDetail' class='btn btn-square' type='button'>×</button></div><div class='empty-state'>Запуск не выбран.</div>";
        } else if (!selectedActions) {
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Предсписок за " + escapeHtml(formatRuDate(selectedRun.run_date)) + "</h3><div class='review-table-subtitle'>Загружаю разборы...</div></div><button id='closePrespisokJournalDetail' class='btn btn-square' type='button'>×</button></div><div class='empty-state'>Гружу список ШК и вердикты. Сейчас будет не сыро, а прожарено.</div>";
        } else {
            const money = prespisokJournalMoneyStats(selectedActions || []);
            const runOperator = [normalizeText(selectedRun.operator_name), normalizeText(selectedRun.operator_id)].filter(Boolean).join(" / ") || "Не определено";
            const actionsHtml = (selectedActions || []).map((action) => {
                const extra = normalizeText(action.extra_value);
                const shks = Array.isArray(action.source_shk_ids) ? action.source_shk_ids.map(normalizeIdentifier).filter(Boolean).join("\n") : "";
                return "<article class='journal-action-row'>"
                    + "<div class='journal-action-main'><span>" + escapeHtml(prespisokActionEntityLabel(action)) + "</span><span>" + escapeHtml(action.verdict || "-") + "</span></div>"
                    + "<div class='journal-action-meta'>"
                    + "Кто разбирал: " + escapeHtml(prespisokActionActorLabel(action)) + "\n"
                    + "Время решения: " + escapeHtml(formatRuDateTime(action.created_at)) + "\n"
                    + "Стоимость: " + escapeHtml(formatMoney(action.price)) + "\n"
                    + (extra ? "Ссылка/комментарий: " + escapeHtml(extra) + "\n" : "")
                    + (shks ? "ШК:\n" + escapeHtml(shks) : "")
                    + "</div></article>";
            }).join("");
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Предсписок за " + escapeHtml(formatRuDate(selectedRun.run_date)) + "</h3><div class='review-table-subtitle'>Разборы, вердикты, деньги и кто держал оборону.</div></div><button id='closePrespisokJournalDetail' class='btn btn-square' type='button'>×</button></div>"
                + "<div class='journal-detail-card'>"
                + "<div class='journal-stats-strip'>"
                + "<div class='journal-stat'><span>Разобрано</span><strong>" + escapeHtml(String(selectedRun.completed_items || selectedActions.length || 0)) + "/" + escapeHtml(String(selectedRun.total_items || 0)) + "</strong></div>"
                + "<div class='journal-stat'><span>Начал запуск</span><strong>" + escapeHtml(runOperator) + "</strong></div>"
                + "<div class='journal-stat'><span>Время</span><strong>" + escapeHtml(formatDuration(selectedRun.elapsed_ms || 0)) + "</strong></div>"
                + "<div class='journal-stat'><span>Спасено</span><strong>" + escapeHtml(formatMoney(money.saved)) + "</strong></div>"
                + "<div class='journal-stat'><span>Списано</span><strong>" + escapeHtml(formatMoney(money.writeoff)) + "</strong></div>"
                + "</div>"
                + "<div class='journal-action-list'>" + (actionsHtml || "<div class='empty-state'>Разборов по этому запуску нет.</div>") + "</div>"
                + "</div>";
        }
        const close = $("closePrespisokJournalDetail");
        if (close) close.addEventListener("click", closePrespisokJournalDetailModal);
    }

    function renderPrespisokJournal() {
        const target = $("prespisokJournalWrap");
        if (!target) return;
        const byDate = latestPrespisokRunsByDate();
        const days = prespisokJournalDays();
        const leadingBlanks = days.length ? weekdayIndexMonday(days[0]) : 0;
        const daysHtml = Array.from({ length: leadingBlanks }).map(() => "<div class='journal-day-empty'></div>").join("") + days.map((date) => {
            const run = byDate.get(date);
            const status = run ? prespisokRunStatusLabel(run.status) : "Не сделан";
            const selected = run && run.id === state.prespisokJournal.selectedRunId ? " is-selected" : "";
            const cls = run ? " has-run " + (normalizeText(run.status) === "completed" ? "completed" : "active-run") + selected : "";
            const attrs = run ? " type='button' data-prespisok-journal-run='" + escapeHtml(run.id) + "'" : "";
            const tag = run ? "button" : "div";
            return "<" + tag + " class='journal-day" + cls + "'" + attrs + ">"
                + "<span class='journal-day-date'>" + escapeHtml(formatRuDate(date)) + "</span>"
                + "<span class='journal-day-status'>" + escapeHtml(status) + "</span>"
                + (run ? "<span class='journal-day-status'>Разобрано: " + escapeHtml(String(run.completed_items || 0)) + "/" + escapeHtml(String(run.total_items || 0)) + "</span>" : "")
                + "</" + tag + ">";
        }).join("");
        target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Журнал предсписка</h3><div class='review-table-subtitle'>" + (state.prespisokJournal.loading ? "Загружаю последние 30 дней..." : "Последние 30 дней: видно, был ли предсписок и что по нему решили.") + "</div></div><div class='file-row' style='margin-top:0'><button id='refreshPrespisokJournal' class='btn btn-outline' type='button'>Обновить</button><button id='closePrespisokJournal' class='btn btn-square' type='button'>×</button></div></div>"
            + (state.prespisokJournal.error ? "<div class='status-line error'>Не удалось открыть журнал: " + escapeHtml(state.prespisokJournal.error) + "</div>" : "")
            + "<div class='journal-scroll'><div class='journal-layout'>"
            + "<section class='journal-panel'><h4 class='journal-panel-title'>Календарь</h4><div class='journal-weekdays'><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div class='journal-day-grid'>" + daysHtml + "</div></section>"
            + "</div></div>";
        const close = $("closePrespisokJournal");
        if (close) close.addEventListener("click", closePrespisokJournalModal);
        const refresh = $("refreshPrespisokJournal");
        if (refresh) refresh.addEventListener("click", () => { void loadPrespisokJournal(); });
        target.querySelectorAll("[data-prespisok-journal-run]").forEach((button) => {
            button.addEventListener("click", () => { void selectPrespisokJournalRun(button.dataset.prespisokJournalRun || ""); });
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
            const [wmsSettings, wmsRuns] = await Promise.all([
                readOptionalRows(db, SETTINGS_TABLE, (query) => query.select("*").order("sort_order", { ascending: true })),
                readOptionalRows(db, RUNS_TABLE, (query) => query.select("*").gte("effective_date", range.start).lte("effective_date", range.end).order("effective_date", { ascending: false })),
            ]);
            await loadWriteoffTerms();
            if (wmsSettings.rows.length) applySettings(wmsSettings.rows);
            if (!wmsRuns.ok) throw wmsRuns.error || new Error("Не удалось прочитать журналы выгрузок.");
            state.runs = mergeUploadRuns(wmsRuns.rows || []);
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

    async function loadWriteoffTerms(force) {
        if (state.writeoffTerms.loaded && !force) return true;
        const db = supabaseDb();
        state.writeoffTerms.loading = true;
        state.writeoffTerms.error = "";
        renderWriteoffTermsModal();
        if (!db) {
            state.writeoffTerms.loading = false;
            state.writeoffTerms.error = "Supabase SDK недоступен. Использую дефолтные сроки на этой странице.";
            applyWriteoffTerms([]);
            renderWriteoffTermsModal();
            return false;
        }
        try {
            const read = await readOptionalRows(db, WMS_WRITEOFF_TERMS_TABLE, (query) => query
                .select("*")
                .eq("wh_id", WH_ID)
                .order("term_type", { ascending: true })
                .order("sort_order", { ascending: true })
                .order("term_key", { ascending: true }));
            if (!read.ok) throw read.error || new Error("Не удалось прочитать сроки списания.");
            applyWriteoffTerms(read.rows);
            state.writeoffTerms.loaded = true;
            return true;
        } catch (error) {
            applyWriteoffTerms([]);
            state.writeoffTerms.error = "Не удалось загрузить сроки из Supabase. Проверь миграцию wms_writeoff_terms. Сейчас используются дефолты.";
            console.warn("writeoff terms load skipped:", error);
            return false;
        } finally {
            state.writeoffTerms.loading = false;
            renderWriteoffTermsModal();
        }
    }

    function writeoffTermInputRows() {
        return Array.from(document.querySelectorAll("[data-writeoff-term-row]")).map((row, index) => {
            const typeInput = row.querySelector("[data-writeoff-term-type]");
            const keyInput = row.querySelector("[data-writeoff-term-key]");
            const labelInput = row.querySelector("[data-writeoff-term-label]");
            const daysInput = row.querySelector("[data-writeoff-term-days]");
            const activeInput = row.querySelector("[data-writeoff-term-active]");
            const termType = normalizeWriteoffTermType(typeInput && typeInput.value);
            const termKey = normalizeWriteoffTermKey(keyInput && keyInput.value, termType);
            if (!termKey) return null;
            return {
                wh_id: WH_ID,
                term_type: termType,
                term_key: termKey,
                label: normalizeText(labelInput && labelInput.value) || termKey,
                days_without_movement: Math.max(0, Math.trunc(settingNumber(daysInput && daysInput.value, 0))),
                is_active: activeInput ? activeInput.checked : true,
                sort_order: index + 1,
                updated_by: normalizeText(currentWmsUser().id) || null,
                updated_at: new Date().toISOString(),
            };
        }).filter(Boolean);
    }

    function writeoffTermRowHtml(row, lockedType) {
        const type = normalizeWriteoffTermType(row && row.term_type);
        const key = normalizeWriteoffTermKey(row && row.term_key, type);
        const days = row && row.days_without_movement !== undefined && row.days_without_movement !== null ? row.days_without_movement : 0;
        return "<div class='writeoff-term-row' data-writeoff-term-row>"
            + "<input data-writeoff-term-type type='hidden' value='" + escapeHtml(type) + "'>"
            + "<input data-writeoff-term-key type='text' value='" + escapeHtml(key) + "' placeholder='Статус' " + (lockedType ? "" : "") + ">"
            + "<input data-writeoff-term-label type='text' value='" + escapeHtml(row && row.label || key) + "' placeholder='Название'>"
            + "<input data-writeoff-term-days type='number' min='0' step='1' value='" + escapeHtml(days) + "'>"
            + "<label class='writeoff-term-active'><input data-writeoff-term-active type='checkbox' " + (row && row.is_active === false ? "" : "checked") + "> активен</label>"
            + "</div>";
    }

    function renderWriteoffRecommendationsHtml() {
        const reco = state.writeoffTerms.recommendations || {};
        const summary = reco.summary || {};
        const rows = Array.isArray(reco.rows) ? reco.rows : [];
        const capacityRows = Array.isArray(reco.capacityRows) ? reco.capacityRows : [];
        const problemSections = Array.isArray(reco.problemSections) ? reco.problemSections : [];
        const statusPriorities = Array.isArray(reco.statusPriorities) ? reco.statusPriorities : [];
        const summaryHtml = summary.activeTasks !== undefined
            ? "<div class='writeoff-reco-summary'>"
                + "<div class='writeoff-reco-card'><strong>" + escapeHtml(summary.priorityStatusCount || 0) + "</strong><span>Приоритетных статусов</span></div>"
                + "<div class='writeoff-reco-card'><strong>" + escapeHtml(summary.ruleCount) + "</strong><span>Правил в расчете</span></div>"
                + "<div class='writeoff-reco-card'><strong>" + escapeHtml(summary.moveOnlineCount) + "</strong><span>Можно вернуть ближе к онлайну</span></div>"
                + "<div class='writeoff-reco-card'><strong>" + escapeHtml(summary.deferCount) + "</strong><span>Стоит отодвинуть из-за нагрузки</span></div>"
                + "<div class='writeoff-reco-card'><strong>" + escapeHtml(summary.riskCount) + "</strong><span>Есть риск по безопасному окну</span></div>"
            + "</div>"
            : "";
        const capacityHtml = capacityRows.length
            ? "<div class='writeoff-reco-capacity'>" + capacityRows.map((row) => {
                const source = row.source === "history" ? "среднее" : "оценка";
                return "<span class='writeoff-reco-pill'>" + escapeHtml(row.moduleLabel) + ": " + escapeHtml(row.capacity) + " ШК/день, " + escapeHtml(source) + "</span>";
            }).join("") + "</div>"
            : "";
        const statusHtml = statusPriorities.length
            ? "<div class='writeoff-reco-statuses'>" + statusPriorities.slice(0, 12).map((row) => "<article class='writeoff-reco-status " + escapeHtml(row.tierClass || "") + "'>"
                + "<strong>#" + escapeHtml(row.rank) + " " + escapeHtml(row.status) + " · " + escapeHtml(row.tierLabel) + "</strong>"
                + "<span>" + escapeHtml(row.reason) + "</span>"
                + "<span>Где лежит: " + escapeHtml((row.moduleLabels || []).join("; ") || "участки не выделены") + "</span>"
            + "</article>").join("") + "</div>"
            : "";
        const tableHtml = rows.length
            ? "<div class='writeoff-reco-table-wrap'><table class='writeoff-reco-table'><thead><tr>"
                + "<th>Участок</th><th>Статус</th><th>Списание</th><th>Сейчас</th><th>Рекомендую</th><th>Сегодня брать дату</th><th>Нагрузка</th><th>Упор</th><th>Причина</th>"
            + "</tr></thead><tbody>"
            + rows.map((row) => "<tr class='" + (row.risk ? "writeoff-reco-row-risk" : "") + "'>"
                + "<td><strong>" + escapeHtml(row.moduleLabel) + "</strong></td>"
                + "<td>" + escapeHtml(row.driverStatus || "Без статуса") + "</td>"
                + "<td>" + escapeHtml(row.writeoffTermLabel) + "</td>"
                + "<td>" + escapeHtml(row.currentLabel) + "</td>"
                + "<td><strong>" + escapeHtml(row.recommendedLabel) + "</strong><br><span class='writeoff-reco-note'>" + escapeHtml(row.changeLabel) + "</span></td>"
                + "<td>" + escapeHtml(formatRuDate(row.recommendedBusinessDate)) + (row.gapLabel ? "<span class='writeoff-reco-gap'>" + escapeHtml(row.gapLabel) + "</span>" : "") + "</td>"
                + "<td>" + escapeHtml(row.loadLabel) + "</td>"
                + "<td class='writeoff-reco-focus'>" + escapeHtml(row.focusLabel || "Без отдельного упора") + "</td>"
                + "<td class='writeoff-reco-note'>" + escapeHtml(row.note) + "</td>"
            + "</tr>").join("")
            + "</tbody></table></div>"
            : reco.loading ? "" : "<div class='status-line'>" + (summary.activeTasks !== undefined ? "Нет активных задач для планирования." : "Рекомендации еще не рассчитаны. Нажмите “Рассчитать рекомендации”.") + "</div>";
        return "<section class='writeoff-term-section'><h4>Рекомендованные сроки выгрузок</h4>"
            + "<p>Это не план разбора уже созданных задач. Это подсказка, какой срез данных брать сегодня: ближе к онлайну в спокойные дни и глубже в прошлое, если участок перегружен или есть риск списания.</p>"
            + (reco.loading ? "<div class='status-line'>Считаю рекомендации по текущим срокам, хвостам задач, журналу выгрузок и ручной мощности за последние 14 дней...</div>" : "")
            + (reco.error ? "<div class='status-line error'>" + escapeHtml(reco.error) + "</div>" : "")
            + summaryHtml
            + capacityHtml
            + statusHtml
            + tableHtml
            + (reco.generatedAt ? "<p>Обновлено: " + escapeHtml(formatRuDateTime(reco.generatedAt)) + "</p>" : "")
            + "</section>";
    }

    function renderWriteoffTermsModal() {
        const target = $("writeoffTermsWrap");
        if (!target) return;
        const rows = state.writeoffTerms.rows || defaultWriteoffTerms();
        const statusRows = rows.filter((row) => normalizeWriteoffTermType(row.term_type) === "status");
        const lrRows = rows.filter((row) => normalizeWriteoffTermType(row.term_type) === "lr");
        const statusHtml = statusRows.map((row) => writeoffTermRowHtml(row, true)).join("");
        const lrHtml = lrRows.map((row) => writeoffTermRowHtml(row, true)).join("");
        target.innerHTML = (state.writeoffTerms.error ? "<div class='status-line error'>" + escapeHtml(state.writeoffTerms.error) + "</div>" : "")
            + (state.writeoffTerms.loading ? "<div class='status-line'>Загружаю сроки списания...</div>" : "")
            + "<section class='writeoff-term-section'><h4>Статусы WMS</h4><p>Дата списания = дата последнего движения ШК + срок статуса. Для тары берется самая ранняя дата списания среди ШК.</p>"
            + "<div class='writeoff-term-head'><span>Код</span><span>Название</span><span>Дней</span><span>Вкл.</span></div>"
            + "<div class='writeoff-term-list'>" + statusHtml + "</div></section>"
            + "<section class='writeoff-term-section'><h4>Дополнительно</h4><p>Срок 26LR пока просто хранится здесь, без влияния на задачи.</p>"
            + "<div class='writeoff-term-head'><span>Ключ</span><span>Название</span><span>Дней</span><span>Вкл.</span></div>"
            + "<div class='writeoff-term-list'>" + (lrHtml || writeoffTermRowHtml({ term_type: "lr", term_key: "26LR", label: "26LR", days_without_movement: 0, is_active: true }, true)) + "</div></section>"
            + "<section class='writeoff-term-section'><h4>Добавить статус</h4>"
            + "<div class='writeoff-term-add'><input id='newWriteoffStatusKey' type='text' placeholder='Например: ABC'><input id='newWriteoffStatusDays' type='number' min='0' step='1' placeholder='Дней'><button id='addWriteoffStatus' class='btn btn-outline' type='button'>Добавить</button></div></section>"
            + renderWriteoffRecommendationsHtml();
        const add = $("addWriteoffStatus");
        if (add) add.addEventListener("click", addWriteoffStatusDraft);
    }

    function addWriteoffStatusDraft() {
        const keyInput = $("newWriteoffStatusKey");
        const daysInput = $("newWriteoffStatusDays");
        const key = normalizeWriteoffTermKey(keyInput && keyInput.value, "status");
        if (!key) {
            toast("Укажите код статуса.", "error");
            return;
        }
        const rows = writeoffTermInputRows();
        const exists = rows.some((row) => row.term_type === "status" && row.term_key === key);
        if (exists) {
            toast("Такой статус уже есть в списке.", "error");
            return;
        }
        state.writeoffTerms.rows = rows.concat({
            wh_id: WH_ID,
            term_type: "status",
            term_key: key,
            label: key,
            days_without_movement: Math.max(0, Math.trunc(settingNumber(daysInput && daysInput.value, 0))),
            is_active: true,
            sort_order: rows.length + 1,
        }).sort(writeoffTermSort);
        renderWriteoffTermsModal();
    }

    function openStatusPilotModal() {
        if (!ensureDevelopmentAccess("Статусный штурман")) return;
        closeFlowModals();
        setFlowModalOpen("statusPilotModal", true);
    }

    function closeStatusPilotModal() {
        setFlowModalOpen("statusPilotModal", false);
    }

    function moscowDayBoundsUtc(isoDate) {
        const date = normalizeText(isoDate) || state.today || todayIsoInMoscow();
        const start = new Date(date + "T00:00:00+03:00");
        const safeStart = Number.isFinite(start.getTime()) ? start : new Date((state.today || todayIsoInMoscow()) + "T00:00:00+03:00");
        const end = new Date(safeStart.getTime() + 24 * 60 * 60 * 1000);
        return { start: safeStart.toISOString(), end: end.toISOString() };
    }

    function staffStatsKey(id, name) {
        return normalizeIdentifier(id) || normalizeForMatch(name) || "unknown";
    }

    function createStaffStatsRow(id, name) {
        const cleanId = normalizeIdentifier(id);
        const cleanName = normalizeText(name) || (cleanId ? "Сотрудник " + cleanId : "Не определено");
        return {
            key: staffStatsKey(cleanId, cleanName),
            id: cleanId,
            name: cleanName,
            tasksCompleted: 0,
            requestsCompleted: 0,
            prespisokTargets: 0,
            prespisokShk: 0,
            noShkFound: 0,
            noShkChecked: 0,
            deferred: 0,
            verdicts: {},
            sections: {},
            details: {
                tasks: [],
                requests: [],
                prespisok: [],
                noShk: [],
                deferred: [],
            },
        };
    }

    function ensureStaffStatsRow(map, id, name) {
        const key = staffStatsKey(id, name);
        if (!map.has(key)) map.set(key, createStaffStatsRow(id, name));
        const row = map.get(key);
        if (!row.id && normalizeIdentifier(id)) row.id = normalizeIdentifier(id);
        if ((!row.name || row.name === "Не определено" || row.name.startsWith("Сотрудник ")) && normalizeText(name)) row.name = normalizeText(name);
        return row;
    }

    function incrementCounter(target, key, amount) {
        const cleanKey = normalizeText(key) || "Не указано";
        target[cleanKey] = (Number(target[cleanKey]) || 0) + (Number(amount) || 1);
    }

    function staffStatsTaskActor(row, historyRow) {
        return taskCompletionActor(row, historyRow);
    }

    function staffStatsNoShkActor(row) {
        const payload = taskPayload(row);
        const review = taskReviewPayload(row);
        const noShk = payload.no_shk_review && typeof payload.no_shk_review === "object" && !Array.isArray(payload.no_shk_review) ? payload.no_shk_review : {};
        return {
            id: normalizeIdentifier(noShk.checked_by_id) || normalizeIdentifier(review.completed_by_id) || normalizeIdentifier(row && row.assignee_employee_id),
            name: normalizeText(noShk.checked_by_name) || normalizeText(review.completed_by_name) || normalizeText(row && row.assignee_name),
        };
    }

    function staffStatsPrespisokActor(row) {
        return {
            id: normalizeIdentifier(row && row.operator_id),
            name: normalizeText(row && row.operator_name),
        };
    }

    function staffStatsHistoryActor(row) {
        return {
            id: normalizeIdentifier(row && row.actor_employee_id),
            name: normalizeText(row && row.actor_name),
        };
    }

    function sourceShkCountFromPrespisokAction(row) {
        const payload = row && row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
        const ids = Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids : Array.isArray(payload.source_shk_ids) ? payload.source_shk_ids : [];
        return ids.map(normalizeIdentifier).filter(Boolean).length || 1;
    }

    function staffStatsActivityScore(row) {
        return row.tasksCompleted + row.requestsCompleted + row.prespisokShk + row.noShkChecked + row.deferred;
    }

    function isQuickNoShkVerdict(value) {
        const normalized = normalizeForMatch(value);
        return normalized === normalizeForMatch(SYSTEM_NO_SHK_NOT_FOUND_VERDICT)
            || normalized === normalizeForMatch(SYSTEM_NO_SHK_FOUND_VERDICT);
    }

    function isQuickNoShkFoundResult(value) {
        const normalized = normalizeForMatch(value);
        if (!normalized || normalized.includes("не найден")) return false;
        return normalized === normalizeForMatch(SYSTEM_NO_SHK_FOUND_VERDICT)
            || normalized.includes("обнаружен")
            || normalized === "найден";
    }

    function staffStatsSummaryFromEmployees(employees) {
        const summary = {
            employees: 0,
            tasksCompleted: 0,
            requestsCompleted: 0,
            prespisokShk: 0,
            noShkFound: 0,
            deferred: 0,
            verdicts: 0,
        };
        (employees || []).forEach((row) => {
            if (staffStatsActivityScore(row) > 0) summary.employees += 1;
            summary.tasksCompleted += row.tasksCompleted;
            summary.requestsCompleted += row.requestsCompleted;
            summary.prespisokShk += row.prespisokShk;
            summary.noShkFound += row.noShkFound;
            summary.deferred += row.deferred;
            summary.verdicts += Object.values(row.verdicts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
        });
        return summary;
    }

    function buildStaffStats(tasks, historyRows, prespisokActions, employees, date) {
        const byEmployee = new Map();
        (employees || []).forEach((employee) => {
            ensureStaffStatsRow(byEmployee, employee.employee_id || employee.id, employee.full_name || employee.name);
        });
        // History-first, payload-fallback: wms_task_history only has rows since
        // 2026-08-24, so historyDeferredTaskIds dedupes against source_payload.deferred_at
        // below only to catch older tasks that predate history tracking, not as a
        // parallel counting path for the same event.
        const historyDeferredTaskIds = new Set();
        const completedHistoryByTaskId = new Map();
        (historyRows || []).filter((row) => normalizeText(row.event_type) === "task_completed" && moscowDateFromValue(row.created_at) === date).forEach((row) => {
            const taskId = normalizeText(row.task_id);
            if (taskId && !completedHistoryByTaskId.has(taskId)) completedHistoryByTaskId.set(taskId, row);
        });
        (historyRows || []).filter((row) => normalizeText(row.event_type) === "task_deferred" && moscowDateFromValue(row.created_at) === date).forEach((row) => {
            const actor = staffStatsHistoryActor(row);
            const employee = ensureStaffStatsRow(byEmployee, actor.id, actor.name);
            const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
            employee.deferred += 1;
            if (payload.verdict) incrementCounter(employee.verdicts, payload.verdict, 1);
            historyDeferredTaskIds.add(normalizeText(row.task_id));
            employee.details.deferred.push({
                title: normalizeText(payload.title) || "Отложенная задача",
                meta: [payload.verdict ? "Вердикт: " + payload.verdict : "", payload.reopen_after ? "Переоткрытие: " + formatRuDateTime(payload.reopen_after) : "", formatRuDateTime(row.created_at)].filter(Boolean).join(" · "),
            });
        });
        (tasks || []).forEach((row) => {
            const completedDate = moscowDateFromValue(row.completed_at);
            const manualCompleted = completedDate === date && isManualAchievementTask(row);
            if (manualCompleted) {
                const actor = staffStatsTaskActor(row, completedHistoryByTaskId.get(normalizeText(row.id)));
                const employee = ensureStaffStatsRow(byEmployee, actor.id, actor.name);
                const requestSection = requestSectionName(row);
                const section = requestSection || taskSectionName(row);
                const verdict = normalizeText(row.opp_verdict) || "Не выбран";
                employee.tasksCompleted += 1;
                if (requestSection === "Запросы входящего потока") employee.requestsCompleted += 1;
                incrementCounter(employee.verdicts, verdict, 1);
                incrementCounter(employee.sections, section, 1);
                const detail = {
                    id: row.id,
                    title: displayTaskTitle(row),
                    meta: [section, verdict, formatMoney(reviewPrice(row)), formatRuDateTime(row.completed_at || row.updated_at)].filter(Boolean).join(" · "),
                };
                employee.details.tasks.push(detail);
                if (requestSection === "Запросы входящего потока") employee.details.requests.push(detail);
            }
            const review = taskReviewPayload(row);
            const payload = taskPayload(row);
            const noShk = payload.no_shk_review && typeof payload.no_shk_review === "object" && !Array.isArray(payload.no_shk_review) ? payload.no_shk_review : {};
            const noShkAt = normalizeText(noShk.checked_at) || (isQuickNoShkVerdict(row.opp_verdict) ? row.completed_at : "");
            if (moscowDateFromValue(noShkAt) === date && (noShk.result || isQuickNoShkVerdict(row.opp_verdict))) {
                const actor = staffStatsNoShkActor(row);
                const employee = ensureStaffStatsRow(byEmployee, actor.id, actor.name);
                const result = normalizeText(noShk.result) || normalizeText(row.opp_verdict);
                employee.noShkChecked += 1;
                if (isQuickNoShkFoundResult(result)) employee.noShkFound += 1;
                incrementCounter(employee.verdicts, result, 1);
                employee.details.noShk.push({
                    id: row.id,
                    title: displayTaskTitle(row),
                    meta: [result, noShk.shk ? "ШК " + noShk.shk : "", noShk.name || taskItemName(row), formatRuDateTime(noShkAt)].filter(Boolean).join(" · "),
                });
            }
            const deferredAt = normalizeText(review.deferred_at);
            if (deferredAt && moscowDateFromValue(deferredAt) === date && !historyDeferredTaskIds.has(normalizeText(row.id))) {
                const employee = ensureStaffStatsRow(byEmployee, review.deferred_by_id, review.deferred_by_name);
                employee.deferred += 1;
                employee.details.deferred.push({
                    id: row.id,
                    title: displayTaskTitle(row),
                    meta: [review.defer_reason ? "Причина: " + review.defer_reason : "", review.reopen_after ? "Переоткрытие: " + formatRuDateTime(review.reopen_after) : "", formatRuDateTime(deferredAt)].filter(Boolean).join(" · "),
                });
            }
        });
        (prespisokActions || []).filter((row) => moscowDateFromValue(row.created_at) === date).forEach((row) => {
            const actor = staffStatsPrespisokActor(row);
            const employee = ensureStaffStatsRow(byEmployee, actor.id, actor.name);
            const shkCount = sourceShkCountFromPrespisokAction(row);
            const verdict = normalizeText(row.verdict) || "Не указан";
            employee.prespisokTargets += 1;
            employee.prespisokShk += shkCount;
            incrementCounter(employee.verdicts, verdict, 1);
            employee.details.prespisok.push({
                title: normalizeText(row.entity_type) === "tare" ? "Тара " + normalizeText(row.entity_id) : "ШК " + normalizeText(row.entity_id),
                meta: [verdict, shkCount + " ШК", formatMoney(row.price), formatRuDateTime(row.created_at)].filter(Boolean).join(" · "),
            });
        });
        const rows = Array.from(byEmployee.values())
            .filter((row) => staffStatsActivityScore(row) > 0)
            .sort((a, b) => staffStatsActivityScore(b) - staffStatsActivityScore(a) || a.name.localeCompare(b.name, "ru"));
        return { employees: rows, summary: staffStatsSummaryFromEmployees(rows) };
    }

    function renderStaffStatsModal() {
        const dateInput = $("staffStatsDate");
        if (dateInput && dateInput.value !== state.staffStats.date) dateInput.value = state.staffStats.date;
        const status = $("staffStatsStatus");
        const summaryWrap = $("staffStatsSummary");
        const grid = $("staffStatsGrid");
        const detail = $("staffStatsDetail");
        if (status) {
            status.textContent = state.staffStats.loading
                ? "Собираю пульс смены. Считаю руками, без бухгалтерской магии."
                : state.staffStats.error || (state.staffStats.loaded ? "Статистика за " + formatRuDate(state.staffStats.date) + "." : "");
            status.style.color = state.staffStats.error ? "#b91c1c" : "#64748b";
        }
        if (!summaryWrap || !grid || !detail) return;
        if (state.staffStats.loading) {
            summaryWrap.innerHTML = "";
            grid.innerHTML = "<div class='staff-stats-empty'>Загружаю события смены...</div>";
            detail.innerHTML = "";
            return;
        }
        const summary = state.staffStats.summary || {};
        summaryWrap.innerHTML = [
            ["Сотрудников", summary.employees || 0],
            ["Ручных задач", summary.tasksCompleted || 0],
            ["Запросов", summary.requestsCompleted || 0],
            ["ШК предсписка", summary.prespisokShk || 0],
            ["Без ШК найдено", summary.noShkFound || 0],
            ["Отложено", summary.deferred || 0],
        ].map((item) => "<div class='staff-stat-tile'><span>" + escapeHtml(item[0]) + "</span><strong>" + escapeHtml(item[1]) + "</strong></div>").join("");
        if (!state.staffStats.employees.length) {
            grid.innerHTML = "<div class='staff-stats-empty'>За эту дату пока нет действий. Тишина подозрительная, но статистически допустимая.</div>";
            detail.innerHTML = "";
            return;
        }
        if (!state.staffStats.selectedKey || !state.staffStats.employees.some((row) => row.key === state.staffStats.selectedKey)) {
            state.staffStats.selectedKey = state.staffStats.employees[0].key;
        }
        grid.innerHTML = state.staffStats.employees.map((employee) => {
            const topVerdicts = Object.entries(employee.verdicts || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
            return "<button class='staff-card" + (employee.key === state.staffStats.selectedKey ? " active" : "") + "' type='button' data-staff-stats-key='" + escapeHtml(employee.key) + "'>"
                + "<h4>" + escapeHtml(employee.name) + "</h4>"
                + "<p>" + escapeHtml(employee.id ? "ID " + employee.id : "ID не указан") + "</p>"
                + "<div class='staff-card-stats'>"
                + "<div class='staff-card-stat'><span>Задачи</span><strong>" + employee.tasksCompleted + "</strong></div>"
                + "<div class='staff-card-stat'><span>Запросы</span><strong>" + employee.requestsCompleted + "</strong></div>"
                + "<div class='staff-card-stat'><span>Предсписок</span><strong>" + employee.prespisokShk + "</strong></div>"
                + "<div class='staff-card-stat'><span>Без ШК</span><strong>" + employee.noShkFound + "</strong></div>"
                + "<div class='staff-card-stat'><span>Отложил</span><strong>" + employee.deferred + "</strong></div>"
                + "<div class='staff-card-stat'><span>Вердикты</span><strong>" + Object.values(employee.verdicts || {}).reduce((sum, value) => sum + value, 0) + "</strong></div>"
                + "</div>"
                + "<div class='staff-verdict-strip'>" + (topVerdicts.length ? topVerdicts.map(([label, count]) => "<span class='staff-verdict-chip'>" + escapeHtml(label) + ": " + count + "</span>").join("") : "<span class='staff-verdict-chip'>Вердиктов нет</span>") + "</div>"
                + "</button>";
        }).join("");
        grid.querySelectorAll("[data-staff-stats-key]").forEach((button) => {
            button.addEventListener("click", () => {
                state.staffStats.selectedKey = button.dataset.staffStatsKey || "";
                state.staffStats.activeTab = "tasks";
                renderStaffStatsModal();
            });
        });
        renderStaffStatsDetail();
    }

    function staffStatsTabRows(employee, tab) {
        if (!employee) return [];
        if (tab === "verdicts") {
            return Object.entries(employee.verdicts || {})
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => ({ title: label, meta: count + " раз" }));
        }
        if (tab === "sections") {
            return Object.entries(employee.sections || {})
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => ({ title: label, meta: count + " задач" }));
        }
        return employee.details[tab] || [];
    }

    function renderStaffStatsDetail() {
        const detail = $("staffStatsDetail");
        if (!detail) return;
        const employee = (state.staffStats.employees || []).find((row) => row.key === state.staffStats.selectedKey);
        if (!employee) {
            detail.innerHTML = "";
            return;
        }
        const tabs = [
            ["tasks", "Задачи", employee.details.tasks.length],
            ["requests", "Запросы", employee.details.requests.length],
            ["prespisok", "Предсписок", employee.details.prespisok.length],
            ["noShk", "Без ШК", employee.details.noShk.length],
            ["deferred", "Отложения", employee.details.deferred.length],
            ["verdicts", "Вердикты", Object.keys(employee.verdicts || {}).length],
            ["sections", "Участки", Object.keys(employee.sections || {}).length],
        ];
        const active = tabs.some(([key]) => key === state.staffStats.activeTab) ? state.staffStats.activeTab : "tasks";
        state.staffStats.activeTab = active;
        const rows = staffStatsTabRows(employee, active);
        detail.innerHTML = "<div class='staff-stats-detail-head'><div><h4 class='staff-stats-detail-title'>" + escapeHtml(employee.name) + "</h4><p class='staff-stats-detail-sub'>" + escapeHtml([employee.id ? "ID " + employee.id : "", "дата " + formatRuDate(state.staffStats.date)].filter(Boolean).join(" · ")) + "</p></div></div>"
            + "<div class='staff-detail-tabs'>" + tabs.map(([key, label, count]) => "<button class='staff-detail-tab" + (key === active ? " active" : "") + "' type='button' data-staff-stats-tab='" + escapeHtml(key) + "'>" + escapeHtml(label + " · " + count) + "</button>").join("") + "</div>"
            + "<div class='staff-detail-list'>" + (rows.length ? rows.map((row) => "<div class='staff-detail-row" + (row.id ? " copyable" : "") + "' " + (row.id ? "data-staff-task-id='" + escapeHtml(row.id) + "'" : "") + "><strong>" + escapeHtml(row.title || "-") + "</strong><span>" + escapeHtml(row.meta || "-") + "</span></div>").join("") : "<div class='staff-stats-empty'>В этом разделе пусто.</div>") + "</div>";
        detail.querySelectorAll("[data-staff-stats-tab]").forEach((button) => {
            button.addEventListener("click", () => {
                state.staffStats.activeTab = button.dataset.staffStatsTab || "tasks";
                renderStaffStatsDetail();
            });
        });
        detail.querySelectorAll("[data-staff-task-id]").forEach((row) => {
            row.addEventListener("click", () => {
                const id = row.dataset.staffTaskId;
                if (!id) return;
                const sourceRow = state.staffStats.taskRowsById && state.staffStats.taskRowsById[id];
                if (sourceRow && !findTaskRow(id)) {
                    state.taskSearch.rows = [sourceRow].concat(state.taskSearch.rows || []).slice(0, 25);
                }
                closeStaffStatsModal();
                openTaskDetail(id, "inactive");
            });
        });
    }

    async function loadStaffStats() {
        const db = supabaseDb();
        if (!db) {
            state.staffStats.error = "Supabase SDK недоступен.";
            renderStaffStatsModal();
            return;
        }
        const date = state.staffStats.date || state.today || todayIsoInMoscow();
        const bounds = moscowDayBoundsUtc(date);
        state.staffStats.loading = true;
        state.staffStats.error = "";
        renderStaffStatsModal();
        try {
            const [completedRead, updatedRead, historyRead, prespisokRead, employeesRead] = await Promise.all([
                db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).eq("is_deleted", false).gte("completed_at", bounds.start).lt("completed_at", bounds.end).order("completed_at", { ascending: false, nullsFirst: false }).limit(10000),
                db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).eq("is_deleted", false).gte("updated_at", bounds.start).lt("updated_at", bounds.end).order("updated_at", { ascending: false, nullsFirst: false }).limit(10000),
                readOptionalRows(db, FLOW_HISTORY_TABLE, (query) => query.select("*").gte("created_at", bounds.start).lt("created_at", bounds.end).order("created_at", { ascending: false }).limit(10000)),
                readOptionalRows(db, WMS_PRESPISOK_ACTIONS_TABLE, (query) => query.select("*").gte("created_at", bounds.start).lt("created_at", bounds.end).order("created_at", { ascending: false }).limit(10000)),
                readOptionalRows(db, WMS_EMPLOYEES_TABLE, (query) => query.select("*").eq("is_active", true).order("full_name", { ascending: true })),
            ]);
            if (completedRead.error) throw completedRead.error;
            if (updatedRead.error) throw updatedRead.error;
            const byId = new Map();
            [...(completedRead.data || []), ...(updatedRead.data || [])].forEach((row) => {
                if (row && row.id) byId.set(row.id, row);
            });
            state.staffStats.taskRowsById = Object.fromEntries(Array.from(byId.values()).filter((row) => row && row.id).map((row) => [row.id, row]));
            const built = buildStaffStats(
                Array.from(byId.values()),
                historyRead.ok ? historyRead.rows : [],
                prespisokRead.ok ? prespisokRead.rows : [],
                employeesRead.ok ? employeesRead.rows : state.shift.employees,
                date,
            );
            state.staffStats.employees = built.employees;
            state.staffStats.summary = built.summary;
            state.staffStats.loaded = true;
            if (!state.staffStats.selectedKey && built.employees[0]) state.staffStats.selectedKey = built.employees[0].key;
        } catch (error) {
            console.error("staff stats failed:", error);
            state.staffStats.error = "Не удалось собрать статистику: " + (error && error.message ? error.message : String(error));
            state.staffStats.employees = [];
            state.staffStats.summary = null;
            state.staffStats.taskRowsById = {};
        } finally {
            state.staffStats.loading = false;
            renderStaffStatsModal();
        }
    }

    function openStaffStatsModal() {
        if (!ensureDevelopmentAccess("Пульс смены")) return;
        closeFlowModals();
        state.staffStats.date = state.staffStats.date || state.today || todayIsoInMoscow();
        setFlowModalOpen("staffStatsModal", true);
        renderStaffStatsModal();
        void loadStaffStats();
    }

    function closeStaffStatsModal() {
        setFlowModalOpen("staffStatsModal", false);
    }

    async function openWriteoffTermsModal() {
        if (!ensureDevelopmentAccess("Сроки списания")) return;
        closeFlowModals();
        setFlowModalOpen("writeoffTermsModal", true);
        renderWriteoffTermsModal();
        await loadWriteoffTerms(true);
        if (!state.writeoffTerms.recommendations.summary && !state.writeoffTerms.recommendations.loading) {
            void refreshWriteoffRecommendations();
        }
    }

    function closeWriteoffTermsModal() {
        setFlowModalOpen("writeoffTermsModal", false);
    }

    async function saveWriteoffTermsFromModal() {
        const db = supabaseDb();
        const status = $("writeoffTermsStatus");
        const button = $("saveWriteoffTerms");
        const rows = writeoffTermInputRows();
        if (!rows.length) {
            if (status) status.textContent = "Нет строк для сохранения.";
            return;
        }
        state.writeoffTerms.rows = rows.sort(writeoffTermSort);
        if (!db) {
            if (status) status.textContent = "Supabase недоступен. На этой странице сроки применены, но не сохранены.";
            return;
        }
        if (button) button.disabled = true;
        state.writeoffTerms.saving = true;
        if (status) status.textContent = "Сохраняю сроки списания...";
        try {
            const { error } = await db
                .from(WMS_WRITEOFF_TERMS_TABLE)
                .upsert(rows, { onConflict: "wh_id,term_type,term_key" });
            if (error) throw error;
            state.writeoffTerms.loaded = true;
            state.writeoffTerms.error = "";
            state.writeoffTerms.recommendations.rows = [];
            state.writeoffTerms.recommendations.capacityRows = [];
            state.writeoffTerms.recommendations.problemSections = [];
            state.writeoffTerms.recommendations.statusPriorities = [];
            state.writeoffTerms.recommendations.summary = null;
            state.writeoffTerms.recommendations.generatedAt = "";
            if (status) status.textContent = "Сроки сохранены. Новые выгрузки будут считать дату списания по этим значениям.";
            toast("Сроки списания сохранены.", "success");
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            state.writeoffTerms.error = "Не удалось сохранить сроки: " + message;
            if (status) status.textContent = state.writeoffTerms.error;
        } finally {
            state.writeoffTerms.saving = false;
            if (button) button.disabled = false;
            renderWriteoffTermsModal();
        }
    }

    async function recalculateWriteoffDatesFromModal() {
        const db = supabaseDb();
        const status = $("writeoffTermsStatus");
        const button = $("recalculateWriteoffDates");
        if (!db) {
            if (status) status.textContent = "Supabase недоступен, пересчитать активные задачи не получится.";
            return;
        }
        if (button) button.disabled = true;
        if (status) status.textContent = "Пересчитываю даты списания у активных задач...";
        try {
            const { data, error } = await db.rpc("recalculate_wms_task_writeoff_dates", { p_wh_id: WH_ID });
            if (error) throw error;
            const updated = Number(data && data.updated_count) || 0;
            if (status) status.textContent = "Пересчет готов. Обновлено активных задач: " + updated + ".";
            toast("Даты списания пересчитаны: " + updated + ".", "success");
            state.review.loaded = false;
            await loadReviewTasks();
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            if (status) status.textContent = "Не удалось пересчитать: " + message;
        } finally {
            if (button) button.disabled = false;
        }
    }

    function planningTaskItemsCount(row) {
        const items = taskItems(row);
        const sourceIds = Array.isArray(row && row.source_shk_ids) ? row.source_shk_ids.map(normalizeIdentifier).filter(Boolean) : [];
        return Math.max(1, items.length, sourceIds.length);
    }

    function planningWriteoffInfo(row) {
        const items = taskItems(row);
        const computed = items.length
            ? writeoffDateInfoForRows(items.map((item) => ({
                product: item.shk,
                status: item.status,
                last_movement: item.movement,
                status_at: item.movement,
            })), "")
            : null;
        if (computed && computed.date) return computed;
        const payload = taskPayload(row);
        const payloadDate = normalizeText(payload.writeoff_date || row && row.due_date);
        const parsed = parseDateTime(payloadDate);
        return {
            date: parsed.date || payloadDate || "",
            source: payload.writeoff_date ? "stored" : "fallback",
            basis: payload.writeoff_date_basis || null,
            candidates: Array.isArray(payload.writeoff_date_candidates) ? payload.writeoff_date_candidates : [],
        };
    }

    function planningTaskStatus(row, writeoffInfo) {
        const basis = writeoffInfo && writeoffInfo.basis;
        const fromBasis = normalizeWriteoffTermKey(basis && (basis.status_key || basis.status_raw || basis.status_label), "status");
        if (fromBasis) return fromBasis;
        const fromItems = taskItems(row).map((item) => normalizeWriteoffTermKey(item.status, "status")).filter(Boolean);
        if (fromItems.length) return fromItems[0];
        const fromPayload = normalizeWriteoffTermKey(taskPayload(row).status || taskPayload(row).last_status, "status");
        return fromPayload || "Без статуса";
    }

    function planningTaskSection(row) {
        return requestSectionName(row) || taskSectionName(row);
    }

    function planningModuleKey(row) {
        if (!row || requestSectionName(row) || isPrespisokTask(row)) return "";
        const sourceModule = normalizeForMatch(row.source_module);
        const uploadType = normalizeForMatch(row.upload_type);
        const taskType = normalizeForMatch(row.task_type);
        if (sourceModule.includes("manual_packaging") || uploadType === "packaging") return taskType.includes("rwp") ? "rwp" : "packaging";
        if (sourceModule.includes("manual_rwp") || uploadType === "rwp") return "rwp";
        if (sourceModule.includes("manual_pm") || uploadType === "pm_buffer") return "pm";
        if (sourceModule.includes("manual_presort") || uploadType === "presort") return taskType.includes("оклейка") ? "labeling" : "presort";
        if (sourceModule.includes("manual_wmi") || uploadType === "wmi_mp_pc") return "wmi_mp_pc";
        if (sourceModule.includes("manual_marketplace") || uploadType === "marketplace_pc") {
            if (taskType.includes("пц")) return "pc";
            if (taskType.includes("маркетплейс")) return "marketplace";
            return "marketplace_pc";
        }
        if (sourceModule.includes("manual_no_order") || uploadType === "no_order") {
            if (taskType.includes("usd")) return "usd";
            if (taskType.includes("tmm")) return "tmm";
            return "no_order";
        }
        if (sourceModule.includes("manual_after_sale") || uploadType === "after_sale_movement") return "after_sale_movement";
        return "";
    }

    function uploadAgeFromOffset(offsetDays) {
        return Math.max(0, Math.trunc(-settingNumber(offsetDays, 0)));
    }

    function uploadOffsetFromAge(ageDays) {
        return -Math.max(0, Math.trunc(settingNumber(ageDays, 0)));
    }

    function uploadAgeLabel(ageDays, offsetDays) {
        const age = Math.max(0, Math.trunc(settingNumber(ageDays, 0)));
        const offset = uploadOffsetFromAge(age);
        return "на " + age + "-й день без движения (" + offset + ")";
    }

    function branchSummaryCount(run, module) {
        const summary = run && run.summary && typeof run.summary === "object" && !Array.isArray(run.summary) ? run.summary : parseJsonSafe(run && run.summary, {});
        const tasksCount = Number(run && run.tasks_count) || 0;
        const byModule = {
            packaging: tasksCount,
            rwp: tasksCount,
            pm: tasksCount,
            presort: Number(summary.presortTasks) || 0,
            labeling: Number(summary.labelingTasks) || 0,
            marketplace: Number(summary.marketplaceTasks) || 0,
            pc: Number(summary.pcTasks) || 0,
            marketplace_pc: tasksCount,
            wmi_mp_pc: Number(summary.wmiTasks) || 0,
            no_order: Number(summary.noOrderTasks) || 0,
            usd: Number(summary.usdTasks) || 0,
            tmm: Number(summary.tmmTasks) || 0,
            after_sale_movement: Number(summary.afterSaleMovementTasks) || tasksCount,
        };
        return Number(byModule[module]) || 0;
    }

    function runMatchesModuleBranch(run, module) {
        const def = moduleDef(module);
        if (!def) return false;
        return normalizeText(run && run.source_module) === normalizeText(def.sourceModule)
            && normalizeText(run && run.upload_type) === normalizeText(def.uploadType);
    }

    function averageRunTasksForModule(module) {
        const since = addDays(state.today, -21);
        const matched = (state.runs || []).filter((run) => normalizeText(run.effective_date) >= since && runMatchesModuleBranch(run, module));
        const counts = matched.map((run) => branchSummaryCount(run, module)).filter((value) => Number.isFinite(value) && value > 0);
        if (!counts.length) return { average: 0, runs: 0, source: "none" };
        const sum = counts.reduce((acc, value) => acc + value, 0);
        return { average: Math.ceil(sum / counts.length), runs: counts.length, source: "history" };
    }

    async function fetchManualCompletedTasksForPlanning() {
        const db = supabaseDb();
        if (!db) return [];
        const sinceDate = addDays(state.today, -14);
        try {
            const { data, error } = await db
                .from(WMS_TASKS_TABLE)
                .select(WMS_TASK_SELECT_COLUMNS)
                .eq("task_status", "Завершено")
                .gte("completed_at", sinceDate + "T00:00:00+03:00")
                .order("completed_at", { ascending: false, nullsFirst: false })
                .limit(10000);
            if (error) throw error;
            return (data || []).filter(isManualAchievementTask);
        } catch (error) {
            console.warn("writeoff recommendation completed tasks query skipped:", error);
            return [];
        }
    }

    function buildPlanningCapacityRows(activePlanningRows, completedRows, modules) {
        const activeByModule = new Map();
        const completedByModule = new Map();
        activePlanningRows.forEach((row) => {
            const current = activeByModule.get(row.module) || 0;
            activeByModule.set(row.module, current + row.shkCount);
        });
        (completedRows || []).forEach((row) => {
            const module = planningModuleKey(row);
            if (!module) return;
            const current = completedByModule.get(module) || 0;
            completedByModule.set(module, current + planningTaskItemsCount(row));
        });
        return Array.from(modules || []).map((module) => {
            const activeCount = activeByModule.get(module) || 0;
            const completedCount = completedByModule.get(module) || 0;
            const historicalAverage = Math.ceil(completedCount / 14);
            const fallbackCapacity = Math.max(20, Math.min(90, Math.ceil(activeCount / 3)));
            const hasEnoughHistory = completedCount >= 14;
            const capacity = hasEnoughHistory ? Math.max(1, historicalAverage) : fallbackCapacity;
            return {
                module,
                moduleLabel: moduleDef(module).label || module,
                activeCount,
                completedCount,
                historicalAverage,
                capacity,
                source: hasEnoughHistory ? "history" : "fallback",
            };
        }).sort((a, b) => a.moduleLabel.localeCompare(b.moduleLabel, "ru"));
    }

    function buildWriteoffRecommendations(activeRows, completedRows) {
        const statusTerms = activeWriteoffStatusTerms();
        const planningRows = (activeRows || []).map((row) => {
            const module = planningModuleKey(row);
            const info = planningWriteoffInfo(row);
            const writeoffDate = normalizeText(info && info.date);
            return {
                row,
                module,
                section: planningTaskSection(row),
                status: planningTaskStatus(row, info),
                shkCount: planningTaskItemsCount(row),
                price: reviewPrice(row),
                writeoffDate,
                safeReviewDate: writeoffDate ? addDays(writeoffDate, -2) : "",
            };
        }).filter((row) => row.module);
        const moduleSet = new Set(["packaging", "rwp", "pm", "presort", "marketplace", "pc", "wmi_mp_pc", "no_order", "after_sale_movement"]);
        planningRows.forEach((row) => moduleSet.add(row.module));
        const capacityRows = buildPlanningCapacityRows(planningRows, completedRows, moduleSet);
        const capacityByModule = new Map(capacityRows.map((row) => [row.module, row]));
        const activeByModule = new Map();
        planningRows.forEach((row) => {
            const current = activeByModule.get(row.module) || { rows: [], byStatus: new Map(), activeTasks: 0, activeShk: 0, priceSum: 0, overdueSafe: 0 };
            current.rows.push(row);
            current.activeTasks += 1;
            current.activeShk += row.shkCount;
            current.priceSum += row.price;
            if (row.safeReviewDate && row.safeReviewDate < state.today) current.overdueSafe += 1;
            const status = row.status || "Без статуса";
            const statusCurrent = current.byStatus.get(status) || { status, taskCount: 0, shkCount: 0, priceSum: 0, overdueSafeTasks: 0, overdueSafeShk: 0, minWriteoffDate: "", maxSafeAge: null, termDays: null, missingTerm: false };
            statusCurrent.taskCount += 1;
            statusCurrent.shkCount += row.shkCount;
            statusCurrent.priceSum += row.price;
            if (row.safeReviewDate && row.safeReviewDate < state.today) {
                statusCurrent.overdueSafeTasks += 1;
                statusCurrent.overdueSafeShk += row.shkCount;
            }
            if (row.writeoffDate && (!statusCurrent.minWriteoffDate || row.writeoffDate < statusCurrent.minWriteoffDate)) {
                statusCurrent.minWriteoffDate = row.writeoffDate;
            }
            const term = statusTerms.get(status);
            const termDays = term ? Math.max(0, Math.trunc(settingNumber(term.days_without_movement, 0))) : null;
            statusCurrent.termDays = termDays;
            statusCurrent.maxSafeAge = termDays === null ? null : Math.max(0, termDays - 2);
            statusCurrent.missingTerm = !term;
            current.byStatus.set(status, statusCurrent);
            activeByModule.set(row.module, current);
        });
        const statusPlanMap = new Map();
        planningRows.forEach((row) => {
            const status = row.status || "Без статуса";
            const term = statusTerms.get(status);
            const termDays = term ? Math.max(0, Math.trunc(settingNumber(term.days_without_movement, 0))) : null;
            const maxSafeAge = termDays === null ? null : Math.max(0, termDays - 2);
            const current = statusPlanMap.get(status) || {
                status,
                termDays,
                maxSafeAge,
                missingTerm: !term,
                taskCount: 0,
                shkCount: 0,
                priceSum: 0,
                overdueSafeTasks: 0,
                overdueSafeShk: 0,
                minWriteoffDate: "",
                modules: new Map(),
            };
            current.taskCount += 1;
            current.shkCount += row.shkCount;
            current.priceSum += row.price;
            if (row.safeReviewDate && row.safeReviewDate < state.today) {
                current.overdueSafeTasks += 1;
                current.overdueSafeShk += row.shkCount;
            }
            if (row.writeoffDate && (!current.minWriteoffDate || row.writeoffDate < current.minWriteoffDate)) {
                current.minWriteoffDate = row.writeoffDate;
            }
            const moduleRow = current.modules.get(row.module) || { module: row.module, shkCount: 0, taskCount: 0 };
            moduleRow.shkCount += row.shkCount;
            moduleRow.taskCount += 1;
            current.modules.set(row.module, moduleRow);
            statusPlanMap.set(status, current);
        });
        const statusTier = (plan) => {
            if (plan.missingTerm || plan.overdueSafeShk > 0) return { label: "Критично", cls: "critical" };
            if (Number.isFinite(plan.maxSafeAge) && plan.maxSafeAge <= 2) return { label: "Срочно", cls: "critical" };
            if (Number.isFinite(plan.maxSafeAge) && plan.maxSafeAge <= 7) return { label: "Высоко", cls: "high" };
            if (plan.shkCount >= 100) return { label: "Средне", cls: "medium" };
            return { label: "Наблюдать", cls: "" };
        };
        const statusPriorities = Array.from(statusPlanMap.values()).sort((a, b) => {
            if (a.missingTerm !== b.missingTerm) return a.missingTerm ? -1 : 1;
            if (Boolean(a.overdueSafeShk) !== Boolean(b.overdueSafeShk)) return a.overdueSafeShk ? -1 : 1;
            const aSafe = Number.isFinite(a.maxSafeAge) ? a.maxSafeAge : 999;
            const bSafe = Number.isFinite(b.maxSafeAge) ? b.maxSafeAge : 999;
            if (aSafe !== bSafe) return aSafe - bSafe;
            if (a.overdueSafeShk !== b.overdueSafeShk) return b.overdueSafeShk - a.overdueSafeShk;
            if (a.shkCount !== b.shkCount) return b.shkCount - a.shkCount;
            return normalizeText(a.status).localeCompare(normalizeText(b.status), "ru");
        }).map((plan, index) => {
            const tier = statusTier(plan);
            const moduleLabels = Array.from(plan.modules.values())
                .sort((a, b) => b.shkCount - a.shkCount)
                .slice(0, 4)
                .map((row) => (moduleDef(row.module).label || row.module) + " — " + row.shkCount + " ШК");
            const safeText = plan.missingTerm
                ? "срок списания не задан"
                : "безопасный максимум " + plan.maxSafeAge + " дн.";
            const overdueText = plan.overdueSafeShk > 0 ? ", за безопасным окном " + plan.overdueSafeShk + " ШК" : "";
            return {
                ...plan,
                rank: index + 1,
                tierLabel: tier.label,
                tierClass: tier.cls,
                moduleLabels,
                reason: safeText + "; хвост " + plan.shkCount + " ШК" + overdueText + ".",
            };
        });
        const statusPriorityRank = new Map(statusPriorities.map((row) => [row.status, row.rank]));
        const statusPriorityByStatus = new Map(statusPriorities.map((row) => [row.status, row]));
        const modulePlans = new Map();
        Array.from(moduleSet).forEach((module) => {
            const def = moduleDef(module);
            const currentAge = uploadAgeFromOffset(def.offsetDays);
            const active = activeByModule.get(module) || { rows: [], byStatus: new Map(), activeTasks: 0, activeShk: 0, priceSum: 0, overdueSafe: 0 };
            const statuses = Array.from(active.byStatus.values()).sort((a, b) => {
                const aRank = statusPriorityRank.get(a.status) || 9999;
                const bRank = statusPriorityRank.get(b.status) || 9999;
                if (aRank !== bRank) return aRank - bRank;
                const aSafe = a.maxSafeAge === null ? 999 : a.maxSafeAge;
                const bSafe = b.maxSafeAge === null ? 999 : b.maxSafeAge;
                if (aSafe !== bSafe) return aSafe - bSafe;
                return b.shkCount - a.shkCount;
            });
            const runAverage = averageRunTasksForModule(module);
            const capacity = capacityByModule.get(module) || { capacity: Math.max(20, Math.ceil(active.activeShk / 3)), source: "fallback" };
            const expectedNew = runAverage.average || Math.max(0, Math.ceil(active.activeShk / 3));
            const pressure = (active.activeShk + expectedNew) / Math.max(1, capacity.capacity);
            const isProblem = Boolean(active.overdueSafe > 0 || pressure >= 1.5 || active.activeShk >= capacity.capacity);
            const topStatusLabels = statuses
                .slice(0, 3)
                .map((row) => row.status + " — " + row.shkCount + " ШК")
                .filter(Boolean);
            const severity = (active.overdueSafe * 1000) + (pressure * 100) + active.activeShk;
            const reason = active.overdueSafe > 0
                ? "Есть задачи за безопасным окном: " + active.overdueSafe + ". Хвост: " + active.activeShk + " ШК; мощность: " + capacity.capacity + " ШК/день."
                : pressure >= 1.5
                    ? "Хвост + средняя выгрузка выше мощности в " + Math.round(pressure * 10) / 10 + " раза. Хвост: " + active.activeShk + " ШК; ожидается еще ~" + expectedNew + "."
                    : active.activeShk >= capacity.capacity
                        ? "Хвост уже равен или выше дневной мощности. Хвост: " + active.activeShk + " ШК; мощность: " + capacity.capacity + " ШК/день."
                        : "Участок в рабочем режиме.";
            modulePlans.set(module, {
                module,
                moduleLabel: def.label || module,
                def,
                currentAge,
                active,
                statuses,
                focusStatusRow: statuses[0] || null,
                runAverage,
                capacity,
                expectedNew,
                pressure,
                isProblem,
                severity,
                reason,
                topStatusLabels,
            });
        });
        const problemSections = Array.from(modulePlans.values())
            .filter((plan) => plan.isProblem)
            .sort((a, b) => b.severity - a.severity)
            .slice(0, 6)
            .map((plan) => ({
                module: plan.module,
                moduleLabel: plan.moduleLabel,
                activeShk: plan.active.activeShk,
                expectedNew: plan.expectedNew,
                capacity: plan.capacity.capacity,
                pressure: plan.pressure,
                overdueSafe: plan.active.overdueSafe,
                reason: plan.reason,
                topStatusLabels: plan.topStatusLabels,
            }));
        const hasProblemOutsideModule = (module) => problemSections.some((target) => target.module !== module);
        const recommendedAgeForStatusFocus = (plan, statusRow) => {
            if (!statusRow) {
                if (hasProblemOutsideModule(plan.module)) return Math.min(30, plan.currentAge + 1);
                return plan.currentAge > 0 && plan.pressure <= 0.75 ? Math.max(0, plan.currentAge - 1) : plan.currentAge;
            }
            const maxSafeAge = Number.isFinite(statusRow.maxSafeAge) ? statusRow.maxSafeAge : Math.max(0, plan.currentAge);
            const priority = statusPriorityByStatus.get(statusRow.status);
            if (statusRow.missingTerm) return 0;
            if (plan.currentAge > maxSafeAge) return maxSafeAge;
            if (statusRow.overdueSafeShk > 0 || statusRow.overdueSafeTasks > 0) return maxSafeAge;
            if (plan.isProblem && plan.pressure >= 2.4) return Math.min(maxSafeAge, Math.max(plan.currentAge, Math.ceil(maxSafeAge * 0.75), 1));
            if (plan.isProblem || (priority && priority.rank <= 5)) return Math.min(maxSafeAge, Math.max(plan.currentAge, Math.ceil(maxSafeAge * 0.55), 1));
            if (hasProblemOutsideModule(plan.module) && plan.pressure <= 1.1 && plan.currentAge < maxSafeAge) return Math.min(maxSafeAge, plan.currentAge + 1);
            if (plan.pressure <= 0.75 && plan.currentAge > 0) return Math.max(0, plan.currentAge - 1);
            return plan.currentAge;
        };
        const rows = [];
        Array.from(moduleSet).forEach((module) => {
            const plan = modulePlans.get(module);
            const def = plan.def;
            const currentAge = plan.currentAge;
            const active = plan.active;
            const statuses = plan.statuses;
            const capacity = plan.capacity;
            const expectedNew = plan.expectedNew;
            const pressure = plan.pressure;
            const focusStatusRow = plan.focusStatusRow;
            const focusPriority = focusStatusRow ? statusPriorityByStatus.get(focusStatusRow.status) : null;
            const focusRecommendedAge = recommendedAgeForStatusFocus(plan, focusStatusRow);
            const rowsForModule = statuses.length ? statuses : [null];
            rowsForModule.forEach((statusRow) => {
                const hasStatus = Boolean(statusRow);
                const maxSafeAge = hasStatus && Number.isFinite(statusRow.maxSafeAge) ? statusRow.maxSafeAge : Math.max(0, currentAge);
                const missingTerm = hasStatus && statusRow.missingTerm;
                const controlsDate = Boolean(hasStatus && focusStatusRow && normalizeText(statusRow.status) === normalizeText(focusStatusRow.status));
                let recommendedAge = hasStatus ? focusRecommendedAge : recommendedAgeForStatusFocus(plan, null);
                let note = "Оставить текущий срок: нагрузка похожа на нормальную.";
                let risk = Boolean(controlsDate && (missingTerm || currentAge > maxSafeAge || statusRow.overdueSafeShk > 0 || statusRow.overdueSafeTasks > 0));
                if (hasStatus && !controlsDate) {
                    const focusLabel = focusStatusRow ? focusStatusRow.status + " (#" + (focusPriority ? focusPriority.rank : "-") + ")" : "нет фокусного статуса";
                    note = "Этот статус не задает дату выгрузки. Срок участка сейчас задает более приоритетный статус: " + focusLabel + ".";
                } else if (!hasStatus) {
                    const hasOtherProblem = hasProblemOutsideModule(module);
                    note = currentAge > recommendedAge
                        ? "Активного хвоста нет. Можно на день вернуть выгрузку ближе к онлайну."
                        : hasOtherProblem && recommendedAge > currentAge
                            ? "Активного хвоста нет. Временно не открываем свежий срез, чтобы смена ушла в проблемные участки."
                            : "Активного хвоста нет. Срок можно не трогать.";
                } else if (missingTerm) {
                    risk = true;
                    note = "По статусу нет срока списания. Пока безопаснее выгружать максимально близко к онлайну.";
                } else if (currentAge > maxSafeAge) {
                    risk = true;
                    note = "Текущий срок оставляет меньше 2 дней до списания. Нужно подтянуть ближе к безопасному максимуму.";
                } else if (statusRow.overdueSafeShk > 0 || statusRow.overdueSafeTasks > 0) {
                    risk = true;
                    note = "Фокусный статус уже за безопасным окном. Берем срез по нему и не даем длинным статусам перетянуть дату.";
                } else if (plan.isProblem && pressure >= 1.5) {
                    note = "Участок перегружен, но дату задает не участок целиком, а фокусный статус по глобальному рейтингу.";
                } else if (hasProblemOutsideModule(module) && pressure <= 1.1 && recommendedAge > currentAge) {
                    note = "Участок не в красной зоне. Временно притормаживаем свежую выгрузку, чтобы отдать смену проблемным участкам.";
                } else if (pressure <= 0.75 && currentAge > 0) {
                    note = "Нагрузка ниже мощности. Можно на день вернуться ближе к онлайну.";
                } else if (currentAge === 0) {
                    note = "Онлайн-режим выдерживается: сегодня берем сегодняшнюю дату.";
                }
                recommendedAge = Math.max(0, hasStatus && controlsDate ? Math.min(recommendedAge, maxSafeAge) : recommendedAge);
                const recommendedOffset = uploadOffsetFromAge(recommendedAge);
                const diff = recommendedAge - currentAge;
                const changeLabel = diff === 0
                    ? "без изменения"
                    : diff > 0
                        ? "отодвинуть на " + diff + " дн."
                        : "вернуть ближе на " + Math.abs(diff) + " дн.";
                const driverTerm = hasStatus && Number.isFinite(statusRow.termDays) ? statusRow.termDays : null;
                rows.push({
                    module,
                    moduleLabel: def.label || module,
                    driverStatus: hasStatus ? statusRow.status : "Нет активного хвоста",
                    writeoffTermLabel: !hasStatus ? "нет активного статуса" : driverTerm === null ? "срок не задан" : driverTerm + " дн.; безопасный максимум " + maxSafeAge + " дн.",
                    currentAge,
                    currentOffset: uploadOffsetFromAge(currentAge),
                    currentLabel: uploadAgeLabel(currentAge),
                    recommendedAge,
                    recommendedOffset,
                    recommendedLabel: uploadAgeLabel(recommendedAge),
                    changeLabel,
                    recommendedBusinessDate: addDays(state.today, -recommendedAge),
                    currentBusinessDate: addDays(state.today, -currentAge),
                    activeTasks: hasStatus ? statusRow.taskCount : 0,
                    activeShk: hasStatus ? statusRow.shkCount : 0,
                    expectedNew,
                    capacity: capacity.capacity,
                    pressure,
                    loadLabel: active.activeShk + " в хвосте + ~" + expectedNew + " из выгрузки / " + capacity.capacity + " ШК/день",
                    problemModule: plan.isProblem,
                    moduleProblemReason: plan.reason,
                    moduleTopStatusLabels: plan.topStatusLabels,
                    controlsDate,
                    statusPriorityRank: hasStatus ? statusPriorityRank.get(statusRow.status) || null : null,
                    statusPriorityLabel: hasStatus && statusPriorityByStatus.get(statusRow.status) ? statusPriorityByStatus.get(statusRow.status).tierLabel : "",
                    focusDriverStatus: focusStatusRow ? focusStatusRow.status : "",
                    focusPriorityRank: focusPriority ? focusPriority.rank : null,
                    risk,
                    note,
                });
            });
        });
        rows.sort((a, b) => {
            if (a.risk !== b.risk) return a.risk ? -1 : 1;
            const aRank = a.statusPriorityRank || 9999;
            const bRank = b.statusPriorityRank || 9999;
            if (aRank !== bRank) return aRank - bRank;
            if (a.moduleLabel !== b.moduleLabel) return a.moduleLabel.localeCompare(b.moduleLabel, "ru");
            if (a.controlsDate !== b.controlsDate) return a.controlsDate ? -1 : 1;
            if (a.recommendedAge !== b.recommendedAge) return b.recommendedAge - a.recommendedAge;
            return normalizeText(a.driverStatus).localeCompare(normalizeText(b.driverStatus), "ru");
        });
        const focusCandidates = statusPriorities.slice(0, 5);
        const focusName = (row) => "#" + row.rank + " " + row.status;
        rows.forEach((row) => {
            const targets = focusCandidates.filter((target) => normalizeText(target.status) !== normalizeText(row.driverStatus)).slice(0, 3);
            if (row.recommendedAge > row.currentAge) {
                if (row.controlsDate) {
                    row.focusLabel = "Дату участка задает статус #" + (row.statusPriorityRank || "-") + " " + row.driverStatus + ".";
                } else {
                    row.focusLabel = "Не рулит датой: участок следует статусу #" + (row.focusPriorityRank || "-") + " " + (row.focusDriverStatus || "-") + ".";
                }
            } else if (row.recommendedAge < row.currentAge) {
                row.focusLabel = targets.length
                    ? "Возвращаем ближе к онлайну: это не мешает статусам " + targets.map(focusName).join("; ") + "."
                    : "Возвращаем ближе к онлайну: кризисного упора рядом нет.";
            } else if (targets.length) {
                row.focusLabel = row.controlsDate
                    ? "Статус держим в фокусе: #" + (row.statusPriorityRank || "-") + " " + row.driverStatus + "."
                    : "Срок задает #" + (row.focusPriorityRank || "-") + " " + (row.focusDriverStatus || "-") + ".";
            } else {
                row.focusLabel = "Отдельного кризисного упора нет.";
            }
            const gapDate = firstMissingUploadDate(row.module, row.recommendedBusinessDate);
            row.effectiveRecommendedBusinessDate = gapDate || row.recommendedBusinessDate;
            row.gapLabel = gapDate && gapDate !== row.recommendedBusinessDate
                ? "Сначала догоняем разрыв: " + formatRuDate(gapDate)
                : "";
        });
        const summary = {
            activeTasks: planningRows.length,
            ruleCount: rows.length,
            moveOnlineCount: rows.filter((row) => row.recommendedAge < row.currentAge).length,
            deferCount: rows.filter((row) => row.recommendedAge > row.currentAge).length,
            riskCount: rows.filter((row) => row.risk).length,
            problemCount: problemSections.length,
            priorityStatusCount: statusPriorities.length,
        };
        return { rows, capacityRows, problemSections, statusPriorities, summary };
    }

    async function refreshWriteoffRecommendations() {
        const reco = state.writeoffTerms.recommendations;
        const button = $("refreshWriteoffRecommendations");
        const status = $("writeoffTermsStatus");
        const applyButton = $("applyWriteoffRecommendations");
        const inputRows = writeoffTermInputRows();
        if (inputRows.length) state.writeoffTerms.rows = inputRows.sort(writeoffTermSort);
        reco.loading = true;
        reco.error = "";
        reco.rows = [];
        reco.capacityRows = [];
        reco.problemSections = [];
        reco.statusPriorities = [];
        reco.summary = null;
        if (button) button.disabled = true;
        if (applyButton) applyButton.disabled = true;
        if (status) status.textContent = "Считаю рекомендованные даты выгрузки и разбора...";
        renderWriteoffTermsModal();
        try {
            await ensureReviewTasksLoaded();
            const activeRows = (state.review.rows || []).filter(isActiveReviewTask);
            const completedRows = await fetchManualCompletedTasksForPlanning();
            const result = buildWriteoffRecommendations(activeRows, completedRows);
            reco.rows = result.rows;
            reco.capacityRows = result.capacityRows;
            reco.problemSections = result.problemSections || [];
            reco.statusPriorities = result.statusPriorities || [];
            reco.summary = result.summary;
            reco.generatedAt = new Date().toISOString();
            if (status) status.textContent = "Рекомендации готовы. Это расчетный план: он ничего не меняет в задачах автоматически.";
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            reco.error = "Не удалось рассчитать рекомендации: " + message;
            if (status) status.textContent = reco.error;
        } finally {
            reco.loading = false;
            if (button) button.disabled = false;
            if (applyButton) applyButton.disabled = false;
            renderWriteoffTermsModal();
        }
    }

    function buildWriteoffRecommendationApplyRows() {
        const recoRows = Array.isArray(state.writeoffTerms.recommendations.rows) ? state.writeoffTerms.recommendations.rows : [];
        const byModule = new Map();
        recoRows.forEach((row) => {
            if (!row || !row.module) return;
            const current = byModule.get(row.module);
            const recommendedAge = Math.max(0, Math.trunc(settingNumber(row.recommendedAge, 0)));
            const recommendedOffset = uploadOffsetFromAge(recommendedAge);
            const candidate = {
                module: row.module,
                recommendedAge,
                recommendedOffset,
                rows: [row],
            };
            if (!current) {
                byModule.set(row.module, candidate);
                return;
            }
            current.rows.push(row);
            if (recommendedAge < current.recommendedAge) {
                current.recommendedAge = recommendedAge;
                current.recommendedOffset = recommendedOffset;
            }
        });
        return Array.from(byModule.values()).map((item) => {
            const def = moduleDef(item.module);
            const targetDate = addDays(state.today, item.recommendedOffset);
            const effectiveDate = firstMissingUploadDate(item.module, targetDate);
            const uniqueAges = Array.from(new Set(item.rows.map((row) => row.recommendedAge))).sort((a, b) => a - b);
            return {
                module: item.module,
                label: def.label || item.module,
                source_module: def.sourceModule || item.module,
                upload_type: def.uploadType || item.module,
                upload_offset_days: item.recommendedOffset,
                task_deadline_days: settingNumber(def.taskDeadlineDays, 1),
                is_required: def.required !== false,
                responsibility_zone: def.responsibilityZone || "Исходящий поток",
                description: def.description || "",
                sort_order: Number(def.sortOrder) || DEFAULT_MODULES.findIndex((row) => row.module === item.module) + 1 || 100,
                current_offset_days: Number(def.offsetDays || 0),
                recommended_age: item.recommendedAge,
                target_date: targetDate,
                effective_date: effectiveDate,
                has_gap: Boolean(effectiveDate && targetDate && effectiveDate !== targetDate),
                status_conflict: uniqueAges.length > 1,
                reason: item.rows.map((row) => row.focusLabel || row.note || "").filter(Boolean).slice(0, 3).join(" "),
            };
        }).filter((row) => row.upload_offset_days !== row.current_offset_days);
    }

    function applyUploadSettingsToState(rows) {
        (rows || []).forEach((row) => {
            const current = moduleDef(row.module);
            state.settings.set(row.module, {
                ...current,
                module: row.module,
                label: normalizeText(row.label) || current.label,
                sourceModule: normalizeText(row.source_module) || current.sourceModule,
                uploadType: normalizeText(row.upload_type) || current.uploadType,
                offsetDays: settingNumber(row.upload_offset_days, current.offsetDays),
                taskDeadlineDays: settingNumber(row.task_deadline_days, current.taskDeadlineDays),
                required: row.is_required !== false,
                responsibilityZone: normalizeText(row.responsibility_zone) || current.responsibilityZone,
                description: normalizeText(row.description) || current.description,
                sortOrder: Number(row.sort_order) || current.sortOrder || 100,
            });
        });
    }

    async function applyWriteoffRecommendationsFromModal() {
        const status = $("writeoffTermsStatus");
        const button = $("applyWriteoffRecommendations");
        const reco = state.writeoffTerms.recommendations || {};
        if (!Array.isArray(reco.rows) || !reco.rows.length) {
            if (status) status.textContent = "Сначала рассчитайте рекомендации.";
            return;
        }
        const rows = buildWriteoffRecommendationApplyRows();
        if (!rows.length) {
            if (status) status.textContent = "Применять нечего: настройки уже совпадают с рекомендациями.";
            return;
        }
        const db = supabaseDb();
        if (button) button.disabled = true;
        if (status) status.textContent = "Применяю рекомендации: обновляю сроки выгрузок и пересчитываю даты мастера...";
        try {
            if (!db) throw new Error("Supabase SDK недоступен.");
            const { error } = await db.rpc("apply_wms_upload_offsets", { p_rows: rows });
            if (error) throw error;
            applyUploadSettingsToState(rows);
            state.manualDate = "";
            renderCalendar();
            renderModuleChooser();
            if ($("masterWork") && $("masterWork").classList.contains("active")) {
                renderMasterSlots();
            }
            const gaps = rows.filter((row) => row.has_gap);
            const conflicts = rows.filter((row) => row.status_conflict);
            if (status) {
                status.textContent = "Применено: " + rows.length + " модулей. Мастер выгрузок теперь берет новые даты."
                    + (gaps.length ? "\nЕсть догонка разрывов: " + gaps.map((row) => row.label + " сначала за " + formatRuDate(row.effective_date)).join("; ") + "." : "")
                    + (conflicts.length ? "\nВнутри некоторых участков были разные рекомендации по статусам, применен самый безопасный срок: " + conflicts.map((row) => row.label).join(", ") + "." : "");
            }
            toast("Рекомендации применены. Мастер выгрузок уже смотрит на новые даты.", "good");
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            if (status) status.textContent = "Не удалось применить рекомендации: " + message + "\nЕсли RPC еще не создана, примени новую SQL-миграцию apply_wms_upload_offsets.";
        } finally {
            if (button) button.disabled = false;
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

    function chooserUploadDateInfo(module) {
        if (module === "marketplace_pc") {
            const marketplace = uploadDateGapInfo("marketplace");
            const pc = uploadDateGapInfo("pc");
            const sameActual = marketplace.actualDate === pc.actualDate;
            const label = sameActual
                ? "За " + formatRuDate(marketplace.actualDate)
                : "МП: " + formatRuDate(marketplace.actualDate) + "; ПЦ: " + formatRuDate(pc.actualDate);
            const targetLabel = marketplace.targetDate === pc.targetDate
                ? formatRuDate(marketplace.targetDate)
                : "МП " + formatRuDate(marketplace.targetDate) + ", ПЦ " + formatRuDate(pc.targetDate);
            const hasGap = marketplace.hasGap || pc.hasGap;
            return {
                date: earliestDate([marketplace.actualDate, pc.actualDate]),
                label,
                hasGap,
                gapLabel: hasGap ? "Догоняем разрыв; целевой срез: " + targetLabel : "",
                run: runForUpload("marketplace", marketplace.actualDate) && runForUpload("pc", pc.actualDate),
            };
        }
        const info = uploadDateGapInfo(module);
        return {
            date: info.actualDate,
            label: "За " + formatRuDate(info.actualDate),
            hasGap: info.hasGap,
            gapLabel: info.hasGap ? "Догоняем разрыв: целевой срез " + formatRuDate(info.targetDate) : "",
            run: runForUpload(module, info.actualDate),
        };
    }

    function renderModuleChooser() {
        $("chooserDateText").textContent = state.manualDate ? "Ручная догрузка за " + formatRuDate(state.manualDate) : "Плановые даты на сегодня.";
        $("moduleGrid").innerHTML = visibleDefs().map((def) => {
            const dateInfo = chooserUploadDateInfo(def.module);
            const run = dateInfo.run;
            const cls = state.loadingStatus ? " loading" : run ? " done" : " missing";
            const badge = state.loadingStatus ? "Проверяю" : run ? "Есть" : "Нет";
            const gapLine = !state.manualDate && dateInfo.hasGap && dateInfo.gapLabel
                ? "<span class='writeoff-reco-gap'>" + escapeHtml(dateInfo.gapLabel) + "</span>"
                : "";
            return "<button type='button' class='module-card" + cls + "' data-module='" + escapeHtml(def.module) + "' " + (state.loadingStatus ? "disabled" : "") + ">"
                + "<p class='module-name'><span>" + escapeHtml(def.label) + "</span><span>" + badge + "</span></p>"
                + "<div class='module-date'>" + escapeHtml(dateInfo.label) + "</div>"
                + "<p class='module-desc'>" + escapeHtml(def.description) + "</p>"
                + gapLine
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
        state.activeDate = module === "marketplace_pc" ? chooserUploadDateInfo(module).date : uploadDateForModule(module);
        state.repeatUploadUnlocked = false;
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
        $("workSubtitle").textContent = "Выгрузка за " + formatRuDate(state.activeDate) + ". Дата списания считается по статусу каждого ШК.";
        $("workInstruction").innerHTML = instructionHtml(module, state.activeDate);
        $("doneBox").classList.remove("visible");
        $("saveUpload").disabled = true;
        $("saveUpload").classList.remove("hidden");
        $("repeatUpload").classList.add("hidden");
        renderPreview(null);
        const existing = runForUpload(module, state.activeDate);
        if (existing && !state.repeatUploadUnlocked) {
            $("workInstruction").classList.add("hidden");
            $("fileControls").innerHTML = "";
            $("fileControls").classList.add("hidden");
            $("previewGrid").innerHTML = "";
            $("sampleWrap").innerHTML = "";
            $("saveUpload").classList.add("hidden");
            $("repeatUpload").classList.remove("hidden");
            setStatus("Выгрузка за эту дату уже есть. Если нужно заменить данные, нажмите “Выгрузить повторно”.", "good");
            return;
        }
        $("workInstruction").classList.remove("hidden");
        $("fileControls").classList.remove("hidden");
        renderFileControls(module);
        if (existing) {
            $("repeatUpload").classList.remove("hidden");
            setStatus("Повторная выгрузка включена. Выберите файл, запись обновится без дублей.", "good");
        } else {
            setStatus("Выберите файл для расчета.");
        }
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
            if (!file) return;
            input.value = "";
            handler(file).catch((error) => setStatus(error && error.message ? error.message : String(error), "error"));
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

    function jsonChars(value) {
        try {
            return JSON.stringify(value).length;
        } catch (_error) {
            return 0;
        }
    }

    function isHeavySaveModule(module) {
        return ["packaging", "rwp", "presort", "marketplace_pc", "wmi_mp_pc", "no_order"].includes(module);
    }

    function isHeavySaveTask(task) {
        const shks = Array.isArray(task && task.source_shk_ids) ? task.source_shk_ids.length : 0;
        const payloadSize = jsonChars(task && task.source_payload);
        return shks > 12 || payloadSize > 18000 || Boolean(task && task.source_tare_id);
    }

    function saveChunkLimits(module, tasks) {
        const hasHeavyTasks = (tasks || []).some(isHeavySaveTask);
        const heavy = isHeavySaveModule(module) || hasHeavyTasks;
        return {
            maxCount: heavy ? SAVE_HEAVY_TASK_CHUNK_SIZE : SAVE_TASK_CHUNK_SIZE,
            maxChars: heavy ? SAVE_HEAVY_MAX_CHUNK_JSON_CHARS : SAVE_MAX_CHUNK_JSON_CHARS,
        };
    }

    function chunkTasksForSave(module, tasks) {
        const limits = saveChunkLimits(module, tasks);
        const chunks = [];
        let current = [];
        let currentChars = 2;
        (tasks || []).forEach((task) => {
            const taskChars = Math.max(jsonChars(task), 2) + 1;
            if (current.length && (current.length >= limits.maxCount || currentChars + taskChars > limits.maxChars)) {
                chunks.push(current);
                current = [];
                currentChars = 2;
            }
            current.push(task);
            currentChars += taskChars;
        });
        if (current.length) chunks.push(current);
        return chunks;
    }

    function errorText(error) {
        if (!error) return "";
        if (typeof error === "string") return error;
        const parts = [error.message, error.details, error.hint, error.code, error.name].map(normalizeText).filter(Boolean);
        if (parts.length) return parts.join(" ");
        try {
            return JSON.stringify(error);
        } catch (_jsonError) {
            return String(error);
        }
    }

    function isRetryableSaveTimeout(error) {
        const text = errorText(error).toLowerCase();
        return text.includes("statement timeout")
            || text.includes("canceling statement")
            || text.includes("57014")
            || text.includes("request timeout")
            || text.includes("networkerror")
            || text.includes("failed to fetch");
    }

    function compactTaskItemForSave(item) {
        const normalized = normalizeTaskItem(item);
        if (!normalized) return null;
        return {
            shk: normalized.shk,
            name: normalized.name,
            nm: normalized.nm,
            status: normalized.status,
            price: normalized.price,
            mx: normalized.mx,
            movement: normalized.movement,
            row_number: normalized.row_number,
        };
    }

    function compactTaskForSave(task) {
        const payload = task && task.source_payload && typeof task.source_payload === "object" && !Array.isArray(task.source_payload)
            ? { ...task.source_payload }
            : {};
        if (Array.isArray(payload.task_items)) {
            payload.task_items = payload.task_items.map(compactTaskItemForSave).filter(Boolean);
        }
        return { ...task, source_payload: payload };
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

    function normalizeNmDigits(value) {
        return String(value || "").replace(/\D/g, "");
    }

    function normalizeHttpUrl(value) {
        let url = normalizeText(value);
        if (!url) return "";
        if (url.startsWith("//")) url = "https:" + url;
        if (url.startsWith("http://")) url = "https://" + url.slice(7);
        return /^https?:\/\//i.test(url) ? url : "";
    }

    function isLikelyImageUrl(url) {
        const value = String(url || "");
        return /\.(webp|jpe?g|png)(?:\?|$)/i.test(value)
            || /\/images\/(big|c516x688|tm)\//i.test(value)
            || /\/img\//i.test(value);
    }

    function uniqueUrls(urls) {
        const result = [];
        const seen = new Set();
        (urls || []).forEach((raw) => {
            const url = normalizeHttpUrl(raw);
            if (!url || !isLikelyImageUrl(url) || seen.has(url)) return;
            seen.add(url);
            result.push(url);
        });
        return result;
    }

    function buildWbImageCandidatesByNm(nm, options) {
        const digits = normalizeNmDigits(nm);
        if (!digits) return [];
        const article = Number(digits);
        if (!Number.isFinite(article)) return [];
        const opts = options || {};
        const maxHosts = Math.max(12, Math.min(Number(opts.maxHosts || 40), 99));
        const maxPics = Math.max(1, Math.min(Number(opts.maxPics || 4), 12));
        const vol = Math.floor(article / 100000);
        const part = Math.floor(article / 1000);
        const urls = [];
        const hosts = [];
        for (let i = 1; i <= maxHosts; i += 1) {
            const idx = String(i).padStart(2, "0");
            hosts.push("https://basket-" + idx + ".wbbasket.ru");
            hosts.push("https://basket-" + idx + ".wb.ru");
        }
        for (let imageIndex = 1; imageIndex <= maxPics; imageIndex += 1) {
            ["big", "c516x688"].forEach((size) => {
                ["webp", "jpg"].forEach((ext) => {
                    hosts.forEach((host) => urls.push(host + "/vol" + vol + "/part" + part + "/" + digits + "/images/" + size + "/" + imageIndex + "." + ext));
                });
            });
        }
        const shard = digits.slice(0, Math.max(digits.length - 4, 1)) + "0000";
        for (let imageIndex = 1; imageIndex <= Math.min(maxPics, 6); imageIndex += 1) {
            urls.push("https://images.wbstatic.net/c516x688/new/" + shard + "/" + digits + "-" + imageIndex + ".jpg");
            urls.push("https://images.wbstatic.net/big/new/" + shard + "/" + digits + "-" + imageIndex + ".jpg");
            urls.push("https://images.wbstatic.net/c516x688/new/" + shard + "/" + digits + "-" + imageIndex + ".webp");
            urls.push("https://images.wbstatic.net/big/new/" + shard + "/" + digits + "-" + imageIndex + ".webp");
        }
        return uniqueUrls(urls);
    }

    function probeImageUrl(url, timeoutMs) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            let finished = false;
            const timer = setTimeout(() => {
                if (finished) return;
                finished = true;
                image.onload = null;
                image.onerror = null;
                reject(new Error("timeout"));
            }, timeoutMs || 1300);
            image.onload = () => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                resolve(url);
            };
            image.onerror = () => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                reject(new Error("load error"));
            };
            image.src = url;
        });
    }

    function firstFulfilled(promises) {
        return new Promise((resolve) => {
            if (!promises.length) {
                resolve("");
                return;
            }
            let rejected = 0;
            let done = false;
            promises.forEach((promise) => {
                promise.then((value) => {
                    if (done) return;
                    done = true;
                    resolve(value);
                }).catch(() => {
                    rejected += 1;
                    if (!done && rejected === promises.length) resolve("");
                });
            });
        });
    }

    async function findFirstLoadableImage(urls) {
        // WB shards product photos across ~30-60 CDN hosts with no public
        // mapping from article to host, so this races every candidate host
        // at once instead of guessing one at a time. Batching at 16 (the old
        // value) meant up to ~60 sequential 1.3s rounds before giving up --
        // effectively minutes per photo. Racing a much larger wave means the
        // real host (wherever it lands) is almost always caught in the
        // first round.
        const batchSize = 300;
        for (let i = 0; i < (urls || []).length; i += batchSize) {
            const found = await firstFulfilled(urls.slice(i, i + batchSize).map((url) => probeImageUrl(url, 1300)));
            if (found) return found;
        }
        return "";
    }

    function taskItemFromSourceRow(row) {
        const shk = normalizeIdentifier(row && (row.product || row.shk));
        if (!shk) return null;
        return {
            shk,
            name: normalizeText(row && row.name),
            nm: normalizeIdentifier(row && (row.nm || row.nm_id || row.nmId || row.nmID)),
            status: normalizeText(row && (row.product_status || row.last_status || row.status)),
            price: Number(row && row.price) || 0,
            mx: normalizeText(row && (row.mx || row.block)),
            movement: normalizeText(row && (row.last_movement || row.created_at || row.status_at)),
            row_number: row && row.row_number ? row.row_number : null,
            raw: null,
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
        const writeoffInfo = writeoffDateInfoForRows(options.rows, options.dueDate);
        const sourcePayload = {
            ...(options.payload || {}),
            task_items: taskItems,
            item_name: itemName || (options.payload && options.payload.item_name) || "",
            writeoff_date: writeoffInfo.date || "",
            writeoff_date_source: writeoffInfo.source,
        };
        if (writeoffInfo.basis) sourcePayload.writeoff_date_basis = writeoffInfo.basis;
        if (writeoffInfo.candidates && writeoffInfo.candidates.length) sourcePayload.writeoff_date_candidates = writeoffInfo.candidates.slice(0, 80);
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
            search_text: [options.title, itemName, options.taskType, options.column, options.tareId, ...(options.searchParts || []), ...sourceIds].filter(Boolean).join(" "),
            upload_type: options.uploadType,
            upload_effective_date: options.businessDate,
            task_type: options.taskType,
            title: titleLimit(options.title),
            description: descriptionLines(options.descriptionTaskType || options.taskType, options.infoLines || [], specialInfos),
            priority: priority.value,
            priority_label: priority.label,
            due_date: writeoffInfo.date || options.dueDate,
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
        const isOtherTasksColumn = normalizeText(options.column) === "Другие задачи";
        const isLabelingTask = normalizeForMatch(options.module) === "labeling" || normalizeForMatch(options.taskType).includes("оклейка");
        const forceTareGrouping = Boolean(options.forceTareGrouping || (isOtherTasksColumn && !isLabelingTask));
        const split = forceTareGrouping ? { regular: rows || [], special: [] } : splitSpecialRows(rows, specialMap, "product");
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
            if (group.length > 1 || forceTareGrouping) {
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
        // loadWriteoffTerms() without force only fetches once per session
        // (state.writeoffTerms.loaded guard), so a long-lived open upload tab
        // kept computing due_date from whatever terms it first loaded --
        // stale as soon as someone edits days_without_movement in the Сроки
        // списания modal. Force a fresh pull right before every upload so
        // writeoffDateInfoForRows() below always sees current terms, same as
        // the recalculate_wms_task_writeoff_dates RPC does.
        const [rows] = await Promise.all([readWorkbookRows(file, kind), loadWriteoffTerms(true)]);
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
            waitMinutes,
            waitLabel: minuteLabel(waitMinutes),
            waitDurationLabel: formatMinutesCountdown(waitMinutes),
            windowLabel: minuteLabel(PRESPISOK_START_MINUTE) + "-" + minuteLabel(PRESPISOK_END_MINUTE),
        };
    }

    function prespisokStorageKey() {
        return PRESPISOK_STORAGE_KEY + ":" + state.today;
    }

    function prespisokLeaderboardKey() {
        return PRESPISOK_STORAGE_KEY + ":leaderboard";
    }

    function prespisokActor() {
        const user = currentWmsUser();
        return {
            id: normalizeText(user.id) || normalizeText(user.employee_id) || normalizeText(user.name) || "local",
            name: normalizeText(user.name) || "Неизвестный сотрудник",
        };
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
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        return [
            hours ? hours + " ч" : "",
            minutes ? minutes + " мин" : "",
            seconds + " сек",
        ].filter(Boolean).join(" ");
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
            reservations: state.prespisok.reservations || {},
            joinedRemote: Boolean(state.prespisok.joinedRemote),
        };
    }

    function prespisokCompactPayload() {
        return {
            date: state.today,
            file_name: state.prespisok.fileName,
            items_full: state.prespisok.items || [],
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
            reservations: state.prespisok.reservations || {},
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
                reservations: parsed.reservations && typeof parsed.reservations === "object" ? parsed.reservations : {},
                joinedRemote: Boolean(parsed.joinedRemote),
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
        state.prespisok.reservations = {};
        state.prespisok.remoteRun = null;
        state.prespisok.progressOnly = false;
        state.prespisok.joinedRemote = false;
    }

    function prespisokRunPayload(run) {
        const payload = run && run.payload;
        return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    }

    async function fetchTodayPrespisokRun() {
        const db = supabaseDb();
        if (!db) return null;
        try {
            const { data, error } = await db
                .from(WMS_PRESPISOK_RUNS_TABLE)
                .select("*")
                .eq("wh_id", WH_ID)
                .eq("run_date", state.today)
                .order("updated_at", { ascending: false })
                .limit(1);
            if (error) throw error;
            return Array.isArray(data) && data.length ? data[0] : null;
        } catch (error) {
            console.warn("today prespisok run failed:", error);
            return null;
        }
    }

    async function fetchActivePrespisokRun() {
        const db = supabaseDb();
        if (!db) return null;
        try {
            const { data, error } = await db
                .from(WMS_PRESPISOK_RUNS_TABLE)
                .select("*")
                .eq("wh_id", WH_ID)
                .eq("run_date", state.today)
                .in("status", ["started", "in_progress"])
                .order("updated_at", { ascending: false })
                .limit(1);
            if (error) throw error;
            return Array.isArray(data) && data.length ? data[0] : null;
        } catch (error) {
            console.warn("active prespisok run failed:", error);
            return null;
        }
    }

    // payload.items_full is the full candidate list (hundreds of rows, can run
    // 100s of KB) and only changes when a run starts, not on every progress
    // tick. The 15s poll in syncPrespisokRunActions used to re-pull it in full
    // every time; this lean variant skips it and hydrateLeanPrespisokRun below
    // reattaches the previously-fetched items_full so nothing downstream
    // (joinPrespisokRun, canJoin) notices the difference.
    async function fetchActivePrespisokRunLean() {
        const db = supabaseDb();
        if (!db) return null;
        try {
            const { data, error } = await db
                .from(WMS_PRESPISOK_RUNS_TABLE)
                .select("id,wh_id,run_date,status,file_name,total_items,completed_items,excluded_items,elapsed_ms,operator_id,operator_name,started_at,finished_at,created_at,updated_at,reservations:payload->reservations")
                .eq("wh_id", WH_ID)
                .eq("run_date", state.today)
                .in("status", ["started", "in_progress"])
                .order("updated_at", { ascending: false })
                .limit(1);
            if (error) throw error;
            return Array.isArray(data) && data.length ? data[0] : null;
        } catch (error) {
            console.warn("active prespisok run (lean) failed:", error);
            return null;
        }
    }

    function hydrateLeanPrespisokRun(row, previousRun) {
        if (!row) return null;
        const previousPayload = previousRun && previousRun.id === row.id ? prespisokRunPayload(previousRun) : {};
        const { reservations, ...rest } = row;
        return {
            ...rest,
            payload: { ...previousPayload, reservations: reservations && typeof reservations === "object" ? reservations : {} },
        };
    }

    async function fetchPrespisokActions(runId) {
        const db = supabaseDb();
        if (!db || !runId) return [];
        try {
            const { data, error } = await db
                .from(WMS_PRESPISOK_ACTIONS_TABLE)
                .select("*")
                .eq("run_id", runId)
                .order("created_at", { ascending: true });
            if (error) throw error;
            return (data || []).map((row) => {
                const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
                return {
                    ...payload,
                    run_id: row.run_id,
                    item_key: row.item_key,
                    action_key: payload.action_key || "",
                    entity_type: row.entity_type,
                    entity_id: row.entity_id,
                    verdict: row.verdict,
                    extra_value: row.extra_value || "",
                    price: Number(row.price) || Number(payload.price) || 0,
                    source_shk_ids: Array.isArray(row.source_shk_ids) ? row.source_shk_ids : [],
                    source_tare_id: row.source_tare_id || "",
                    task_created: Boolean(row.task_created),
                    created_at: row.created_at,
                    actor: {
                        id: row.operator_id || (payload.actor && payload.actor.id) || "",
                        name: row.operator_name || (payload.actor && payload.actor.name) || "",
                    },
                };
            });
        } catch (error) {
            console.warn("prespisok actions sync failed:", error);
            return null;
        }
    }

    async function syncPrespisokRunActions() {
        if (!state.prespisok.runId) return;
        const actions = await fetchPrespisokActions(state.prespisok.runId);
        if (Array.isArray(actions)) state.prespisok.actions = actions;
        const cached = state.prespisok.remoteRun;
        const hasCachedItemsFull = cached && cached.id === state.prespisok.runId && Array.isArray(prespisokRunPayload(cached).items_full);
        const run = hasCachedItemsFull
            ? hydrateLeanPrespisokRun(await fetchActivePrespisokRunLean(), cached)
            : await fetchActivePrespisokRun();
        if (run && run.id === state.prespisok.runId) {
            const payload = prespisokRunPayload(run);
            if (payload.reservations && typeof payload.reservations === "object") state.prespisok.reservations = payload.reservations;
            state.prespisok.remoteRun = run;
        }
    }

    function applyPrespisokRemoteRun(run, join) {
        if (!run) return false;
        const payload = prespisokRunPayload(run);
        const fullItems = Array.isArray(payload.items_full) ? payload.items_full : [];
        state.prespisok.remoteRun = run;
        state.prespisok.progressOnly = !join;
        state.prespisok.runId = run.id;
        state.prespisok.fileName = normalizeText(run.file_name || payload.file_name);
        state.prespisok.startedAt = normalizeText(run.started_at);
        state.prespisok.elapsedBeforeMs = Number(run.elapsed_ms) || 0;
        state.prespisok.excludedCount = Number(run.excluded_items) || 0;
        state.prespisok.reservations = payload.reservations && typeof payload.reservations === "object" ? payload.reservations : {};
        if (join && fullItems.length) {
            state.prespisok.items = fullItems;
            state.prespisok.rows = Array.isArray(payload.rows) ? payload.rows : [];
            state.prespisok.index = 0;
            state.prespisok.history = {};
            state.prespisok.finished = false;
            state.prespisok.progressOnly = false;
            state.prespisok.joinedRemote = true;
            state.prespisok.timerStartedAt = Date.now();
            state.prespisok.itemTimerStartedAt = Date.now();
            return true;
        }
        return fullItems.length > 0;
    }

    async function openPrespisokModal() {
        closeFlowModals();
        setFlowModalOpen("prespisokModal", true);
        const target = $("prespisokWrap");
        if (target) target.innerHTML = prespisokTopHtml("Проверяю, не начал ли кто-то предсписок раньше. Паранойя? Нет, совместная работа.") + "<div class='prespisok-center'><div class='prespisok-wait'>Проверяю запуск</div></div>";
        const hasLocal = loadPrespisokState();
        if (hasLocal) {
            await syncPrespisokRunActions();
        } else {
            const remote = await fetchActivePrespisokRun() || await fetchTodayPrespisokRun();
            if (remote) {
                applyPrespisokRemoteRun(remote, false);
                const actions = await fetchPrespisokActions(remote.id);
                state.prespisok.actions = Array.isArray(actions) ? actions : [];
            }
        }
        renderPrespisok();
        if (state.prespisok.clockTimer) clearInterval(state.prespisok.clockTimer);
        state.prespisok.clockTimer = setInterval(() => {
            if ($("prespisokModal") && $("prespisokModal").classList.contains("active") && !state.prespisok.items.length) renderPrespisok();
        }, 30000);
        if (state.prespisok.syncTimer) clearInterval(state.prespisok.syncTimer);
        state.prespisok.syncTimer = setInterval(() => {
            if ($("prespisokModal") && $("prespisokModal").classList.contains("active") && state.prespisok.runId) {
                void syncPrespisokRunActions().then(() => {
                    if (state.prespisok.progressOnly) renderPrespisok();
                });
            }
        }, 15000);
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
        if (state.prespisok.syncTimer) clearInterval(state.prespisok.syncTimer);
        state.prespisok.syncTimer = null;
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
            + "<div class='prespisok-top-stat bad'><span>Списано</span><strong id='prespisokWriteoffMoney'>" + escapeHtml(formatMoney(stats.writeoff)) + "</strong></div>"
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
            + "<div><p class='prespisok-kicker'>Финальная проверка перед списанием</p><h2 class='prespisok-title'>Предсписок</h2><p class='prespisok-subtitle'>" + escapeHtml(subtitle || (PRESPISOK_TEST_MODE ? "Тестовый режим: запуск доступен в любое время. Боевой таймер пока сидит в углу и делает вид, что не обиделся." : "Окно разбора: 14:30-20:00. Тут не склад, тут арена последнего шанса.")) + "</p></div>"
            + "<div class='prespisok-top-right'>" + prespisokTopStatsHtml() + "<button id='closePrespisok' class='btn btn-square prespisok-close' type='button' aria-label='Закрыть'>×</button></div>"
            + "</div>";
    }

    function setPrespisokPlayMode(enabled) {
        const target = $("prespisokWrap");
        if (target) target.classList.toggle("is-playing", Boolean(enabled));
    }

    function renderPrespisok() {
        const target = $("prespisokWrap");
        if (!target) return;
        setPrespisokPlayMode(false);
        const info = prespisokWindowInfo();
        if (state.prespisok.progressOnly && state.prespisok.remoteRun) {
            renderPrespisokRemoteProgress();
            return;
        }
        if (!state.prespisok.items.length) {
            const saved = loadPrespisokState();
            if (saved) {
                renderPrespisokPlay();
                return;
            }
        }
        if (!state.prespisok.items.length && !info.inWindow) {
            target.innerHTML = prespisokTopHtml("Сегодняшнее окно: " + info.windowLabel + ". Раньше нельзя, позже тоже нельзя. Да, режим строгий, как акт списания без подписи.")
                + "<div class='prespisok-center'><div><div class='prespisok-wait'>До разбора предсписка<br>" + escapeHtml(info.waitLabel) + "</div><button id='showPrespisokSecondLine' class='btn btn-outline prespisok-start-small prespisok-second-line-btn' type='button'>Показать задачи 2-й линии из предсписка</button></div></div>";
            bindPrespisokClose();
            $("showPrespisokSecondLine").addEventListener("click", () => { void openPrespisokSecondLineModal(); });
            return;
        }
        if (!state.prespisok.items.length) {
            target.innerHTML = prespisokTopHtml("Окно открыто. Загружаем XLSX и начинаем финальную проверку без лишней лирики.")
                + "<div class='prespisok-center'><div><button id='startPrespisok' class='prespisok-start' type='button'>Начать</button><button id='showPrespisokSecondLine' class='btn btn-outline prespisok-start-small prespisok-second-line-btn' type='button'>Показать задачи 2-й линии из предсписка</button></div></div>";
            bindPrespisokClose();
            $("startPrespisok").addEventListener("click", renderPrespisokFileStep);
            $("showPrespisokSecondLine").addEventListener("click", () => { void openPrespisokSecondLineModal(); });
            return;
        }
        renderPrespisokPlay();
    }

    function renderPrespisokRemoteProgress() {
        const target = $("prespisokWrap");
        if (!target) return;
        setPrespisokPlayMode(false);
        const run = state.prespisok.remoteRun || {};
        const payload = prespisokRunPayload(run);
        const actions = state.prespisok.actions || [];
        const total = Number(run.total_items) || (Array.isArray(payload.items) ? payload.items.length : 0);
        const completed = actions.length || Number(run.completed_items) || 0;
        const isCompletedRun = normalizeText(run.status) === "completed";
        const money = actions.reduce((acc, action) => {
            const key = normalizeText(action.action_key);
            const verdict = normalizeForMatch(action.verdict);
            const price = Number(action.price) || 0;
            if (key === "movement" || key === "release" || verdict === "движение" || verdict === "нужен релиз") acc.saved += price;
            if (key === "auto_writeoff" || key === "writeoff" || verdict === "автосписание" || verdict === "нужно списание") acc.writeoff += price;
            return acc;
        }, { saved: 0, writeoff: 0 });
        const operator = normalizeText(run.operator_name) || "другой сотрудник";
        const canJoin = !isCompletedRun && Array.isArray(payload.items_full) && payload.items_full.length;
        target.innerHTML = prespisokTopHtml(isCompletedRun ? "Сегодняшний предсписок уже завершён. Для деталей открой журнал." : "Предсписок уже в работе. Можно наблюдать прогресс или подключиться вторым номером.")
            + "<section class='prespisok-file-panel'>"
            + "<h3 class='prespisok-title' style='font-size:clamp(30px,5vw,62px)'>" + (isCompletedRun ? "Предсписок завершён" : "Предсписок в работе") + "</h3>"
            + "<p class='prespisok-subtitle'>Начал: " + escapeHtml(operator) + (isCompletedRun ? ". Сводка ниже, грязные подробности в журнале." : ". Не деремся за один ШК: WMS+ резервирует текущую цель за сотрудником.") + "</p>"
            + "<div class='prespisok-finish-grid'>"
            + "<div class='prespisok-finish-stat'><span>Сделано</span><strong>" + completed + "/" + total + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>Осталось</span><strong>" + Math.max(total - completed, 0) + "</strong></div>"
            + "<div class='prespisok-finish-stat'><span>Общее время</span><strong>" + escapeHtml(formatDuration(run.elapsed_ms || 0)) + "</strong></div>"
            + "<div class='prespisok-finish-stat saved'><span>Спасено</span><strong>" + escapeHtml(formatMoney(money.saved)) + "</strong></div>"
            + "<div class='prespisok-finish-stat writeoff'><span>Списано</span><strong>" + escapeHtml(formatMoney(money.writeoff)) + "</strong></div>"
            + "</div>"
            + "<div class='file-row'>"
            + (canJoin ? "<button id='joinPrespisokRun' class='prespisok-submit prespisok-submit-arcade' type='button'>Подключиться к разбору</button>" : (isCompletedRun ? "<button id='openPrespisokJournalFromRun' class='btn btn-rect prespisok-second-line-btn' type='button'>Открыть журнал предсписка</button>" : "<div class='status-line error'>К этому запуску нельзя подключиться: он создан старой версией без полного списка целей.</div>"))
            + "<button id='showPrespisokSecondLine' class='btn btn-outline prespisok-second-line-btn' type='button'>Показать задачи 2-й линии из предсписка</button>"
            + "</div>"
            + "</section>";
        bindPrespisokClose();
        if ($("joinPrespisokRun")) $("joinPrespisokRun").addEventListener("click", () => { void joinPrespisokRun(); });
        if ($("openPrespisokJournalFromRun")) $("openPrespisokJournalFromRun").addEventListener("click", () => { void openPrespisokJournalModal(); });
        if ($("showPrespisokSecondLine")) $("showPrespisokSecondLine").addEventListener("click", () => { void openPrespisokSecondLineModal(); });
    }

    async function joinPrespisokRun() {
        const run = state.prespisok.remoteRun || await fetchActivePrespisokRun();
        if (!run) {
            resetPrespisokState();
            renderPrespisok();
            return;
        }
        const actions = await fetchPrespisokActions(run.id);
        state.prespisok.actions = Array.isArray(actions) ? actions : [];
        const ok = applyPrespisokRemoteRun(run, true);
        if (!ok) {
            state.prespisok.progressOnly = true;
            renderPrespisok();
            return;
        }
        persistPrespisokState();
        renderPrespisokPlay();
    }

    function bindPrespisokClose() {
        const close = $("closePrespisok");
        if (close) close.addEventListener("click", requestPrespisokClose);
    }

    function renderPrespisokExitConfirm() {
        const target = $("prespisokWrap");
        if (!target) return;
        setPrespisokPlayMode(false);
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
        setPrespisokPlayMode(false);
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
        const parsed = parseDateTime(item.predictedWriteoffAt);
        const fallbackTs = parsed.date ? Date.parse(parsed.date + "T23:59:59Z") : Date.now() + 30 * 86400000;
        const targetTs = parsed.ts || fallbackTs;
        const hoursLeft = Math.max((targetTs - Date.now()) / 3600000, -72);
        const timeScore = Math.max(0, 336 - hoursLeft) * 7000;
        const priceScore = Math.log10(price + 10) * 1800 + Math.min(price, 100000) / 12;
        return timeScore + priceScore;
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

    async function loadPrespisokHistory(items) {
        const db = supabaseDb();
        const history = { byShk: {}, byTare: {} };
        if (!db || !items || !items.length) return history;
        const shks = Array.from(new Set(items.flatMap((item) => item.rows.map((row) => row.shk)).map(normalizeIdentifier).filter(Boolean)));
        const tares = Array.from(new Set(items.filter((item) => item.type === "tare").map((item) => item.id).map(normalizeIdentifier).filter(Boolean)));
        try {
            for (const chunk of chunkArray(shks, 80)) {
                const { data, error } = await db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).overlaps("source_shk_ids", chunk).order("updated_at", { ascending: false }).limit(1000);
                if (!error) (data || []).forEach((row) => addPrespisokHistory(history, { ...row, __history_source: "WMS+" }));
            }
            for (const chunk of chunkArray(tares, 80)) {
                const { data, error } = await db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).in("source_tare_id", chunk).order("updated_at", { ascending: false }).limit(1000);
                if (!error) (data || []).forEach((row) => addPrespisokHistory(history, { ...row, __history_source: "WMS+" }));
            }
        } catch (error) {
            console.warn("prespisok history failed:", error);
        }
        return history;
    }

    function renderPrespisokReady() {
        const target = $("prespisokWrap");
        if (!target) return;
        setPrespisokPlayMode(false);
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
        setPrespisokPlayMode(false);
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
        const actor = prespisokActor();
        const reservations = state.prespisok.reservations || {};
        const isBlockedByOther = (key) => {
            const reservation = reservations[key];
            if (!reservation || !reservation.actor_id || reservation.actor_id === actor.id) return false;
            const reservedAt = parseDateTime(reservation.reserved_at).ts || 0;
            return reservedAt && Date.now() - reservedAt < PRESPISOK_RESERVATION_TTL_MS;
        };
        let index = Math.max(Number(state.prespisok.index) || 0, 0);
        while (index < state.prespisok.items.length) {
            const key = prespisokItemKey(state.prespisok.items[index]);
            if (!done.has(key) && !isBlockedByOther(key)) break;
            index += 1;
        }
        state.prespisok.index = index;
        return state.prespisok.items[index] || null;
    }

    function hasUnfinishedPrespisokItems() {
        const done = new Set((state.prespisok.actions || []).map((action) => action.item_key));
        return (state.prespisok.items || []).some((item) => !done.has(prespisokItemKey(item)));
    }

    async function reservePrespisokItem(item) {
        if (!item || !state.prespisok.runId) return;
        const key = prespisokItemKey(item);
        const actor = prespisokActor();
        const current = state.prespisok.reservations && state.prespisok.reservations[key];
        if (current && current.actor_id === actor.id) return;
        state.prespisok.reservations = {
            ...(state.prespisok.reservations || {}),
            [key]: {
                actor_id: actor.id,
                actor_name: actor.name,
                reserved_at: new Date().toISOString(),
            },
        };
        persistPrespisokState();
        await upsertPrespisokRun("in_progress");
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
            setPrespisokPlayMode(false);
            if (hasUnfinishedPrespisokItems()) {
                target.innerHTML = prespisokTopHtml("Все свободные цели сейчас заняты другим сотрудником. Да, коллективная работа иногда выглядит как очередь в столовую.")
                    + "<div class='prespisok-center'><div><div class='prespisok-wait'>Жду свободную цель</div><button id='refreshPrespisokFreeItem' class='prespisok-start prespisok-start-small' type='button'>Проверить еще раз</button></div></div>";
                bindPrespisokClose();
                $("refreshPrespisokFreeItem").addEventListener("click", () => { void syncPrespisokRunActions().then(renderPrespisokPlay); });
                return;
            }
            void finishPrespisokRun();
            renderPrespisokFinish();
            return;
        }
        setPrespisokPlayMode(true);
        if (!state.prespisok.timerStartedAt) state.prespisok.timerStartedAt = Date.now();
        if (!state.prespisok.itemTimerStartedAt) state.prespisok.itemTimerStartedAt = Date.now();
        void reservePrespisokItem(item);
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
        const actor = currentWmsUser();
        const actorLabel = [actor.name, actor.id].filter(Boolean).join(" / ") || "Не определено";
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
            payload: {
                entity_type: item.type === "tare" ? "tare" : "shk",
                prespisok: true,
                prespisok_action: actionLabel,
                prespisok_extra: extraValue,
                prespisok_created_by_id: actor.id || "",
                prespisok_created_by_name: actor.name || "",
                rows: rows.slice(0, 80),
            },
            searchParts: [actor.name, actor.id, actionLabel, extraValue],
            infoLines: [
                "Решение предсписка: " + actionLabel,
                extraValue ? "Ссылка/комментарий: " + extraValue : "",
                "Создал задачу: " + actorLabel,
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
        await syncPrespisokRunActions();
        const item = currentPrespisokItem();
        if (!item) return;
        const itemKey = prespisokItemKey(item);
        if ((state.prespisok.actions || []).some((action) => action.item_key === itemKey)) {
            toast("Эту цель уже разобрали. Переключаю дальше.", "info");
            renderPrespisokPlay();
            return;
        }
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
                item_key: itemKey,
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
            if (state.prespisok.reservations) delete state.prespisok.reservations[itemKey];
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
        const existingRun = state.prespisok.remoteRun || {};
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
            operator_id: existingRun.operator_id || user.id || null,
            operator_name: existingRun.operator_name || user.name || null,
            started_at: state.prespisok.startedAt || new Date().toISOString(),
            finished_at: statusValue === "completed" ? new Date().toISOString() : null,
            payload: prespisokCompactPayload(),
        };
        try {
            await db.from(WMS_PRESPISOK_RUNS_TABLE).upsert(payload, { onConflict: "id" });
            state.prespisokHome.run = payload;
            renderPrespisokHomeCard();
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
        rows.sort((a, b) => prespisokLeaderboardScore(a) - prespisokLeaderboardScore(b));
        const top = rows.slice(0, 25);
        try { localStorage.setItem(prespisokLeaderboardKey(), JSON.stringify(top)); } catch (_error) {}
        state.prespisok.leaderboard = top;
        renderPrespisokHomeLeaderboard();
        return record;
    }

    async function finishPrespisokRun() {
        if (state.prespisok.finished) return;
        state.prespisok.finished = true;
        state.prespisok.elapsedBeforeMs = prespisokElapsedMs();
        state.prespisok.timerStartedAt = 0;
        const record = savePrespisokRecord();
        persistPrespisokState();
        await upsertPrespisokRun("completed");
        void evaluatePrespisokAchievements(record);
        void refreshPrespisokLeaderboard();
    }

    function renderPrespisokFinish() {
        const target = $("prespisokWrap");
        if (!target) return;
        setPrespisokPlayMode(false);
        const record = savePrespisokRecord();
        const moneyStats = prespisokMoneyStats();
        const leaderboard = state.prespisok.leaderboard.length ? state.prespisok.leaderboard : loadPrespisokLeaderboard();
        const personal = leaderboard.filter((row) => row.employee_id === record.employee_id || row.name === record.name);
        const best = personal.slice().sort((a, b) => prespisokLeaderboardScore(a) - prespisokLeaderboardScore(b))[0] || record;
        const topRows = leaderboard.slice(0, 5).map((row, index) => "<tr><td>" + (index + 1) + "</td><td>" + escapeHtml(row.name) + "</td><td>" + escapeHtml(row.actions + "/" + row.total) + "</td><td>" + escapeHtml(formatPrespisokLeaderSpeed(row)) + "</td></tr>").join("");
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
            + "<div class='prespisok-finish-stat writeoff'><span>Списано рублей</span><strong>" + escapeHtml(formatMoney(moneyStats.writeoff)) + "</strong></div>"
            + "</div>"
            + "<div class='prespisok-file-panel'><h3>Таблица лидеров</h3><table class='sample-table'><thead><tr><th>#</th><th>Сотрудник</th><th>Разобрано</th><th>Скорость</th></tr></thead><tbody>" + topRows + "</tbody></table><div class='status-line good'>Личный рекорд: " + escapeHtml(best.actions + "/" + best.total + " · " + formatPrespisokLeaderSpeed(best)) + ".</div><button id='resetPrespisokFinished' class='btn btn-rect' type='button'>Закрыть и очистить прогресс</button></div>"
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
            + (rows ? "<table class='sample-table'><thead><tr><th>Название</th><th>Тип задачи</th><th>Наименование</th><th>Тип</th><th>Колонка</th><th>Дата списания</th><th>Стоимость</th><th>Приоритет</th></tr></thead><tbody>" + rows + "</tbody></table>" : "<div class='empty-state'>Нет задач к сохранению.</div>");
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
                if (progress.phase === "after_sale_dedupe_start") {
                    setStatus("Проверяю дубли с Движением после продажи: " + progress.totalTasks + " задач...");
                    return;
                }
                if (progress.phase === "after_sale_dedupe_done") {
                    setStatus(progress.removedShkCount
                        ? "ORS-защита: убрано ШК " + progress.removedShkCount + ", удалено задач " + progress.droppedTaskCount + ", подрезано тар " + progress.trimmedTaskCount + "."
                        : "ORS-защита: дублей с Движением после продажи не найдено.");
                    return;
                }
                if (progress.phase === "split") {
                    setStatus("Supabase не прожевал пачку из " + progress.chunkSize + " задач. Делю на части по " + progress.nextChunkSize + " и продолжаю: сохранено " + progress.saved + "/" + progress.totalTasks + "...");
                    return;
                }
                if (progress.phase === "verify") {
                    setStatus("Проверяю, что все задачи реально попали в Supabase: " + progress.saved + "/" + progress.totalTasks + "...");
                    return;
                }
                if (progress.phase === "repair") {
                    setStatus("Нашёл недостающие задачи: " + progress.missing + ". Дозаливаю маленькими пачками...");
                    return;
                }
                if (progress.phase === "repair_chunk") {
                    setStatus("Дозаливаю недостающие задачи: пачка " + progress.chunk + "/" + progress.totalChunks + " (" + progress.chunkSize + " задач)...");
                    return;
                }
                setStatus("Сохраняю в Supabase: пачка " + progress.chunk + "/" + progress.totalChunks + " (" + progress.chunkSize + " задач), сохранено " + progress.saved + "/" + progress.totalTasks + "...");
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

    function rpcUpsertedCount(data, fallback) {
        const value = Number(data && data.upserted_count);
        return Number.isFinite(value) ? value : fallback;
    }

    function savedTaskKey(task) {
        return [normalizeText(task && task.source_module), normalizeText(task && task.source_id), normalizeText(task && task.task_type)].join("\u001f");
    }

    async function fetchSavedTaskKeys(db, tasks) {
        const keys = new Set();
        const byModule = new Map();
        (tasks || []).forEach((task) => {
            const sourceModule = normalizeText(task && task.source_module);
            const sourceId = normalizeText(task && task.source_id);
            if (!sourceModule || !sourceId) return;
            if (!byModule.has(sourceModule)) byModule.set(sourceModule, new Set());
            byModule.get(sourceModule).add(sourceId);
        });
        for (const [sourceModule, sourceIds] of byModule.entries()) {
            const chunks = chunkArray(Array.from(sourceIds), 80);
            for (let i = 0; i < chunks.length; i += 1) {
                const { data, error } = await db
                    .from(WMS_TASKS_TABLE)
                    .select("source_module,source_id,task_type")
                    .eq("source_module", sourceModule)
                    .in("source_id", chunks[i]);
                if (error) throw error;
                (data || []).forEach((row) => keys.add(savedTaskKey(row)));
            }
        }
        return keys;
    }

    async function saveRepairTasks(db, tasks, context) {
        const chunks = chunkArray(tasks || [], 3);
        let repaired = 0;
        for (let i = 0; i < chunks.length; i += 1) {
            if (context.onProgress) {
                context.onProgress({
                    phase: "repair_chunk",
                    chunk: i + 1,
                    totalChunks: chunks.length,
                    chunkSize: chunks[i].length,
                    saved: context.saved + repaired,
                    totalTasks: context.totalTasks,
                });
            }
            const repairContext = {
                onProgress: null,
                initialTotalChunks: chunks.length,
                totalTasks: context.totalTasks,
                physicalBatch: context.physicalBatch,
                saved: context.saved + repaired,
                initialChunk: i + 1,
            };
            const result = await saveRpcChunkAdaptive(db, chunks[i], {}, repairContext);
            context.physicalBatch = repairContext.physicalBatch;
            repaired += result.upserted;
        }
        return repaired;
    }

    async function verifyAndRepairSavedTasks(db, payloadTasks, context) {
        const expected = new Map();
        (payloadTasks || []).forEach((task) => {
            if (!normalizeText(task && task.source_module) || !normalizeText(task && task.source_id)) return;
            const key = savedTaskKey(task);
            expected.set(key, task);
        });
        if (!expected.size) return { expectedCount: 0, repairedCount: 0 };
        let repairedCount = 0;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            if (context.onProgress) {
                context.onProgress({
                    phase: "verify",
                    attempt,
                    saved: context.saved + repairedCount,
                    totalTasks: context.totalTasks,
                    expectedCount: expected.size,
                });
            }
            const saved = await fetchSavedTaskKeys(db, Array.from(expected.values()));
            const missing = Array.from(expected.entries()).filter(([key]) => !saved.has(key)).map(([, task]) => task);
            if (!missing.length) return { expectedCount: expected.size, repairedCount };
            if (attempt >= 3) {
                throw new Error("После контрольной сверки не сохранилось задач: " + missing.length + ". Попробуйте повторить выгрузку; WMS+ не будет делать вид, что всё ок.");
            }
            if (context.onProgress) {
                context.onProgress({
                    phase: "repair",
                    missing: missing.length,
                    saved: context.saved + repairedCount,
                    totalTasks: context.totalTasks,
                });
            }
            repairedCount += await saveRepairTasks(db, missing, context);
        }
        return { expectedCount: expected.size, repairedCount };
    }

    async function prepareTasksForAfterSaleDedupe(db, module, tasks, meta, onProgress) {
        const sourceTasks = tasks || [];
        const emptyStats = { removedShkCount: 0, droppedTaskCount: 0, trimmedTaskCount: 0 };
        if (!sourceTasks.length || module === "after_sale_movement") return { tasks: sourceTasks, stats: emptyStats };
        if (onProgress) onProgress({ phase: "after_sale_dedupe_start", totalTasks: sourceTasks.length });
        const index = await loadAfterSaleDedupeIndexForTasks(db, sourceTasks, meta && meta.afterSaleDedupeRows);
        const filtered = filterTasksAfterSaleDuplicates(sourceTasks, index);
        if (onProgress) {
            onProgress({
                phase: "after_sale_dedupe_done",
                originalTasks: sourceTasks.length,
                totalTasks: filtered.tasks.length,
                removedShkCount: filtered.stats.removedShkCount,
                droppedTaskCount: filtered.stats.droppedTaskCount,
                trimmedTaskCount: filtered.stats.trimmedTaskCount,
            });
        }
        return filtered;
    }

    async function saveUploadRunOnly(db, run) {
        const { data, error } = await db
            .from(RUNS_TABLE)
            .upsert(run, { onConflict: "effective_date,source_module,upload_type" })
            .select("*")
            .single();
        if (error) throw error;
        return data || run;
    }

    async function saveRpcChunkAdaptive(db, chunk, run, context) {
        context.physicalBatch += 1;
        if (context.onProgress) {
            context.onProgress({
                phase: "rpc_start",
                chunk: context.initialChunk,
                totalChunks: context.initialTotalChunks,
                chunkSize: chunk.length,
                saved: context.saved,
                totalTasks: context.totalTasks,
                physicalBatch: context.physicalBatch,
            });
        }
        const { data, error } = await db.rpc(SAVE_RPC, { p_tasks: chunk, p_run: run || {} });
        if (!error) {
            return {
                upserted: rpcUpsertedCount(data, chunk.length),
                uploadRun: data && data.upload_run ? data.upload_run : null,
            };
        }
        if (chunk.length > 1 && isRetryableSaveTimeout(error)) {
            const mid = Math.max(Math.floor(chunk.length / 2), 1);
            if (context.onProgress) {
                context.onProgress({
                    phase: "split",
                    chunk: context.initialChunk,
                    totalChunks: context.initialTotalChunks,
                    chunkSize: chunk.length,
                    nextChunkSize: mid,
                    saved: context.saved,
                    totalTasks: context.totalTasks,
                    physicalBatch: context.physicalBatch,
                    error: errorText(error),
                });
            }
            const left = await saveRpcChunkAdaptive(db, chunk.slice(0, mid), {}, context);
            context.saved += left.upserted;
            const right = await saveRpcChunkAdaptive(db, chunk.slice(mid), run || {}, context);
            return {
                upserted: left.upserted + right.upserted,
                uploadRun: right.uploadRun || left.uploadRun,
            };
        }
        throw error;
    }

    async function saveTasksAndRun(module, businessDate, tasks, meta, onProgress) {
        const db = supabaseDb();
        if (!db) throw new Error("Supabase недоступен.");
        const def = moduleDef(module);
        const prepared = await prepareTasksForAfterSaleDedupe(db, module, tasks || [], meta || {}, onProgress);
        const payloadTasks = (prepared.tasks || []).map((task) => ({ ...compactTaskForSave(task), module: undefined, column: undefined }));
        const summary = {
            ...((meta && meta.summary) || {}),
        };
        if (prepared.stats && prepared.stats.removedShkCount) {
            summary.after_sale_dedupe_removed_shks = prepared.stats.removedShkCount;
            summary.after_sale_dedupe_dropped_tasks = prepared.stats.droppedTaskCount;
            summary.after_sale_dedupe_trimmed_tasks = prepared.stats.trimmedTaskCount;
        }
        const run = {
            upload_date: state.today,
            effective_date: businessDate,
            business_date: businessDate,
            source_module: def.sourceModule,
            upload_type: def.uploadType,
            status: "completed",
            file_name: meta && meta.fileName || "",
            secondary_file_name: meta && meta.secondaryFileName || "",
            rows_count: meta && meta.rowsCount || 0,
            tasks_count: payloadTasks.length,
            upserted_count: 0,
            summary,
        };
        const chunks = chunkTasksForSave(module, payloadTasks);
        let totalUpserted = 0;
        let uploadRun = null;
        if (!chunks.length) {
            uploadRun = await saveUploadRunOnly(db, run);
            return { ok: true, upserted_count: 0, upload_run: uploadRun, dedupe: prepared.stats };
        }
        const progressContext = {
            onProgress,
            initialTotalChunks: chunks.length,
            totalTasks: payloadTasks.length,
            physicalBatch: 0,
            saved: 0,
            initialChunk: 1,
        };
        for (let i = 0; i < chunks.length; i += 1) {
            progressContext.initialChunk = i + 1;
            progressContext.saved = totalUpserted;
            if (onProgress) onProgress({ phase: "chunk", chunk: i + 1, totalChunks: chunks.length, chunkSize: chunks[i].length, saved: totalUpserted, totalTasks: payloadTasks.length, physicalBatch: progressContext.physicalBatch });
            const isLast = i === chunks.length - 1;
            const result = await saveRpcChunkAdaptive(db, chunks[i], isLast ? run : {}, progressContext);
            totalUpserted += result.upserted;
            progressContext.saved = totalUpserted;
            if (result.uploadRun) uploadRun = result.uploadRun;
        }
        const verified = await verifyAndRepairSavedTasks(db, payloadTasks, progressContext);
        const finalUpserted = Math.max(totalUpserted, verified.expectedCount || payloadTasks.length);
        if (uploadRun && uploadRun.id && Number(uploadRun.upserted_count) !== finalUpserted) {
            uploadRun = { ...uploadRun, upserted_count: finalUpserted };
            const { data, error } = await db
                .from(RUNS_TABLE)
                .update({ upserted_count: finalUpserted })
                .eq("id", uploadRun.id)
                .select("*")
                .single();
            if (!error && data) uploadRun = data;
        }
        return { ok: true, upserted_count: finalUpserted, upload_run: uploadRun, dedupe: prepared.stats };
    }

    function mergeRun(run) {
        if (!run) return;
        const key = [run.effective_date, run.source_module, run.upload_type].join("|");
        state.runs = state.runs.filter((item) => [item.effective_date, item.source_module, item.upload_type].join("|") !== key);
        state.runs.push(run);
    }

    function resetCurrentUpload() {
        if (!state.activeModule) return;
        state.repeatUploadUnlocked = true;
        state.preview = null;
        state.rows = {};
        state.files = {};
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
            { module: "marketplace_pc", date: earliestDate([dates.marketplace, dates.pc, dates.marketplace_pc]), rows: main, carrierRows: [] },
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
            if (isMarketplaceStatus(row) && date !== dates.marketplace) pushReject(list, "marketplace_pc", row, "Нужна дата Маркетплейса " + formatRuDate(dates.marketplace), date, "marketplace");
            if (isPcStatus(row) && !isMarketplaceStatus(row) && date !== dates.pc) pushReject(list, "marketplace_pc", row, "Нужна дата ПЦ " + formatRuDate(dates.pc), date, "pc");
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
            const masterAfterSaleTasks = (preview.modules || [])
                .filter((item) => item.module === "after_sale_movement")
                .flatMap((item) => item.preview && Array.isArray(item.preview.tasks) ? item.preview.tasks : []);
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
                    afterSaleDedupeRows: masterAfterSaleTasks,
                }, (progress) => {
                    if (progress.phase === "after_sale_dedupe_start") {
                        setMasterStatus("Проверяю ORS-дубли: " + moduleDef(item.module).label + ". Задач: " + progress.totalTasks + ".");
                        return;
                    }
                    if (progress.phase === "after_sale_dedupe_done") {
                        setMasterStatus(progress.removedShkCount
                            ? "ORS-защита: " + moduleDef(item.module).label + ". Убрано ШК " + progress.removedShkCount + ", удалено задач " + progress.droppedTaskCount + ", подрезано тар " + progress.trimmedTaskCount + "."
                            : "ORS-защита: " + moduleDef(item.module).label + ". Дублей не найдено.");
                        return;
                    }
                    if (progress.phase === "split") {
                        setMasterStatus("Сохраняю: " + moduleDef(item.module).label + ". Пачка из " + progress.chunkSize + " задач оказалась тяжелой, делю на части по " + progress.nextChunkSize + ". В модуле сохранено " + progress.saved + "/" + progress.totalTasks + ", всего ранее: " + total + ".");
                        return;
                    }
                    if (progress.phase === "verify") {
                        setMasterStatus("Проверяю сохранение: " + moduleDef(item.module).label + ". В модуле записано " + progress.saved + "/" + progress.totalTasks + ", сверяю ключи задач в Supabase.");
                        return;
                    }
                    if (progress.phase === "repair") {
                        setMasterStatus("Проверяю сохранение: " + moduleDef(item.module).label + ". Не хватило " + progress.missing + " задач, дозаливаю малыми пачками.");
                        return;
                    }
                    if (progress.phase === "repair_chunk") {
                        setMasterStatus("Дозаливаю: " + moduleDef(item.module).label + ". Пачка " + progress.chunk + "/" + progress.totalChunks + " (" + progress.chunkSize + " задач).");
                        return;
                    }
                    setMasterStatus("Сохраняю: " + moduleDef(item.module).label + ". Пачка " + progress.chunk + "/" + progress.totalChunks + " (" + progress.chunkSize + " задач), в модуле сохранено " + progress.saved + "/" + progress.totalTasks + ". Уже сохранено всего: " + total + ".");
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
        $("openStatusPilotUploads").addEventListener("click", openStatusPilotModal);
        $("openStaffStats").addEventListener("click", openStaffStatsModal);
        $("openFlow").addEventListener("click", () => { void showFlowPage(); });
        $("openUploads").addEventListener("click", () => { void showUploads(); });
        $("openReview").addEventListener("click", showReviewPage);
        $("openRequests").addEventListener("click", showRequestsPage);
        $("openInactive").addEventListener("click", showInactivePage);
        $("openQuickNoShkReview").addEventListener("click", () => { void openQuickNoShkModal(); });
        $("openPrespisok").addEventListener("click", () => { void openPrespisokModal(); });
        $("openPrespisokSecondLineHome").addEventListener("click", () => { void openPrespisokSecondLineModal(); });
        $("openPrespisokJournal").addEventListener("click", () => { void openPrespisokJournalModal(); });
        $("openPureLosses").addEventListener("click", () => { window.location.href = "pure_losses.html"; });
        $("openNoShkReview").addEventListener("click", openNoShkReviewModal);
        $("openAchievements").addEventListener("click", () => { void openAchievementsModal(); });
        $("openWriteoffTerms").addEventListener("click", () => { void openWriteoffTermsModal(); });
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
        $("homeFromFlow").addEventListener("click", showHome);
        $("flowNextTask").addEventListener("click", () => { void issueNextFlowTask(); });
        $("openFlowSettings").addEventListener("click", openFlowSettingsModal);
        $("closeFlowSettings").addEventListener("click", closeFlowSettingsModal);
        $("saveFlowSettings").addEventListener("click", () => { void saveFlowSettingsFromModal(); });
        $("resetFlowSettings").addEventListener("click", resetFlowSettingsFromModal);
        $("closeStatusPilot").addEventListener("click", closeStatusPilotModal);
        $("closeStaffStats").addEventListener("click", closeStaffStatsModal);
        $("reloadStaffStats").addEventListener("click", () => { void loadStaffStats(); });
        $("staffStatsDate").addEventListener("change", () => {
            state.staffStats.date = normalizeText($("staffStatsDate").value) || state.today || todayIsoInMoscow();
            state.staffStats.selectedKey = "";
            void loadStaffStats();
        });
        $("closeWriteoffTerms").addEventListener("click", closeWriteoffTermsModal);
        $("saveWriteoffTerms").addEventListener("click", () => { void saveWriteoffTermsFromModal(); });
        $("reloadWriteoffTerms").addEventListener("click", () => { void loadWriteoffTerms(true); });
        $("recalculateWriteoffDates").addEventListener("click", () => { void recalculateWriteoffDatesFromModal(); });
        $("refreshWriteoffRecommendations").addEventListener("click", () => { void refreshWriteoffRecommendations(); });
        $("applyWriteoffRecommendations").addEventListener("click", () => { void applyWriteoffRecommendationsFromModal(); });
        $("closeFlowSkip").addEventListener("click", closeFlowSkipModal);
        $("cancelFlowSkip").addEventListener("click", closeFlowSkipModal);
        $("flowSkipReason").addEventListener("input", updateFlowSkipForm);
        $("confirmFlowSkip").addEventListener("click", () => { void skipFlowTaskFromModal(); });
        $("homeFromUploads").addEventListener("click", showHome);
        $("homeFromReview").addEventListener("click", showHome);
        $("homeFromRequests").addEventListener("click", showHome);
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
        $("reviewViewCanvas").addEventListener("click", openReviewCanvasModal);
        $("requestsViewSections").addEventListener("click", renderRequests);
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
        $("closeAchievements").addEventListener("click", closeAchievementsModal);
        $("achievementsWrap").addEventListener("click", (event) => {
            const button = event.target.closest && event.target.closest("[data-achievement-detail]");
            if (button) openAchievementDetail(button.dataset.achievementDetail);
        });
        $("achievementDetailModal").addEventListener("click", (event) => { if (event.target === $("achievementDetailModal")) closeAchievementDetail(); });
        $("achievementsModal").addEventListener("click", (event) => { if (event.target === $("achievementsModal")) closeAchievementsModal(); });
        $("prespisokModal").addEventListener("click", (event) => { if (event.target === $("prespisokModal")) requestPrespisokClose(); });
        $("quickNoShkModal").addEventListener("click", (event) => { if (event.target === $("quickNoShkModal")) closeQuickNoShkModal(); });
        $("noShkReviewModal").addEventListener("click", (event) => { if (event.target === $("noShkReviewModal")) closeNoShkReviewModal(); });
        $("shiftOpeningModal").addEventListener("click", (event) => { if (event.target === $("shiftOpeningModal")) closeShiftOpeningModal(); });
        $("actualizeTasksModal").addEventListener("click", (event) => { if (event.target === $("actualizeTasksModal")) closeActualizeTasksModal(); });
        $("flowTaskModal").addEventListener("click", (event) => { if (event.target === $("flowTaskModal")) closeFlowTaskCard(); });
        $("flowSkipModal").addEventListener("click", (event) => { if (event.target === $("flowSkipModal")) closeFlowSkipModal(); });
        $("flowConflictModal").addEventListener("click", (event) => { if (event.target === $("flowConflictModal")) closeFlowConflictModal(); });
        $("flowSettingsModal").addEventListener("click", (event) => { if (event.target === $("flowSettingsModal")) closeFlowSettingsModal(); });
        $("statusPilotModal").addEventListener("click", (event) => { if (event.target === $("statusPilotModal")) closeStatusPilotModal(); });
        $("staffStatsModal").addEventListener("click", (event) => { if (event.target === $("staffStatsModal")) closeStaffStatsModal(); });
        $("writeoffTermsModal").addEventListener("click", (event) => { if (event.target === $("writeoffTermsModal")) closeWriteoffTermsModal(); });
        $("moduleChooser").addEventListener("click", (event) => { if (event.target === $("moduleChooser")) setFlowModalOpen("moduleChooser", false); });
        $("uploadWork").addEventListener("click", (event) => { if (event.target === $("uploadWork")) openChooser(state.manualDate); });
        $("masterWork").addEventListener("click", (event) => { if (event.target === $("masterWork")) setFlowModalOpen("masterWork", false); });
        $("backfillCalendarModal").addEventListener("click", (event) => { if (event.target === $("backfillCalendarModal")) setFlowModalOpen("backfillCalendarModal", false); });
        $("reviewSectionModal").addEventListener("click", (event) => { if (event.target === $("reviewSectionModal")) closeReviewSectionModal(); });
        $("inactiveTasksModal").addEventListener("click", (event) => { if (event.target === $("inactiveTasksModal")) setFlowModalOpen("inactiveTasksModal", false); });
        $("prespisokSecondLineModal").addEventListener("click", (event) => { if (event.target === $("prespisokSecondLineModal")) setFlowModalOpen("prespisokSecondLineModal", false); });
        $("prespisokJournalModal").addEventListener("click", (event) => { if (event.target === $("prespisokJournalModal")) closePrespisokJournalModal(); });
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if ($("specialInfoModal").classList.contains("active")) {
                closeSpecialInfoModal();
                return;
            }
            if ($("achievementDetailModal").classList.contains("active")) {
                closeAchievementDetail();
                return;
            }
            if ($("achievementsModal").classList.contains("active")) {
                closeAchievementsModal();
                return;
            }
            if ($("statusPilotModal").classList.contains("active")) {
                closeStatusPilotModal();
                return;
            }
            if ($("staffStatsModal").classList.contains("active")) {
                closeStaffStatsModal();
                return;
            }
            if ($("taskDetailModal").classList.contains("active")
                || $("flowTaskModal").classList.contains("active")
                || $("flowSkipModal").classList.contains("active")
                || $("flowConflictModal").classList.contains("active")
                || $("flowSettingsModal").classList.contains("active")
                || $("writeoffTermsModal").classList.contains("active")
                || $("editTareTaskModal").classList.contains("active")
                || $("deferTaskModal").classList.contains("active")
                || $("reopenConfirmModal").classList.contains("active")
                || $("splitShkConfirmModal").classList.contains("active")) return;
            if ($("quickNoShkModal").classList.contains("active")) closeQuickNoShkModal();
            else if ($("noShkReviewModal").classList.contains("active")) closeNoShkReviewModal();
            else if ($("prespisokModal").classList.contains("active")) requestPrespisokClose();
            else if ($("prespisokSecondLineModal").classList.contains("active")) setFlowModalOpen("prespisokSecondLineModal", false);
            else if ($("prespisokJournalModal").classList.contains("active")) closePrespisokJournalModal();
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
        installAchievementDebugHelpers();
        initEvents();
        startPrespisokHomeTimer();
        renderCalendar();
        renderShiftGate();
        renderFlowAccessGate();
        renderPrespisokHomeCard();
        void refreshPrespisokHomeState();
        void refreshPrespisokLeaderboard();
        void loadShiftState();
        void loadAchievements();
        void loadWriteoffTerms();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
}());
