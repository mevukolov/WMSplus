(function () {
    "use strict";

    const loggedRaw = localStorage.getItem("user");
    if (!loggedRaw) {
        window.location.href = "login.html";
        return;
    }

    let user = null;
    try {
        user = JSON.parse(loggedRaw);
    } catch (_) {
        window.location.href = "login.html";
        return;
    }

    const supabaseClient = window.supabaseClient;
    if (!supabaseClient) {
        console.error("supabaseClient missing — ui.js must be loaded first");
        window.MiniUI?.toast?.("Supabase не инициализирован", { type: "error" });
        return;
    }

    const btnReload = document.getElementById("btn-reload");
    const btnAddEmployee = document.getElementById("btn-add-employee");
    const filterShiftEl = document.getElementById("filter-shift");
    const filterUnassignedEl = document.getElementById("filter-unassigned");
    const filterSearchEl = document.getElementById("filter-search");
    const filterSortEl = document.getElementById("filter-sort");
    const statusLineEl = document.getElementById("status-line");
    const employeesGridEl = document.getElementById("employees-grid");
    const employeesEmptyEl = document.getElementById("employees-empty");

    const employeeCreateModalEl = document.getElementById("employee-create-modal");
    const employeeCreateIdEl = document.getElementById("employee-create-id");
    const employeeCreateNameEl = document.getElementById("employee-create-name");
    const employeeCreateShiftsEl = document.getElementById("employee-create-shifts");
    const employeeCreatePerformance1El = document.getElementById("employee-create-performance-1");
    const employeeCreatePerformance2El = document.getElementById("employee-create-performance-2");
    const employeeCreatePerformance3El = document.getElementById("employee-create-performance-3");
    const employeeCreatePerformanceAvgEl = document.getElementById("employee-create-performance-avg");
    const employeeCreateSaveBtn = document.getElementById("employee-create-save");
    const employeeCreateCloseBtn = document.getElementById("employee-create-close");
    const employeeCreateCloseTopBtn = document.getElementById("employee-create-close-top");

    const employeeEditModalEl = document.getElementById("employee-edit-modal");
    const employeeEditIdEl = document.getElementById("employee-edit-id");
    const employeeEditNameEl = document.getElementById("employee-edit-name");
    const employeeEditShiftsEl = document.getElementById("employee-edit-shifts");
    const employeeEditSaveBtn = document.getElementById("employee-edit-save");
    const employeeEditCloseBtn = document.getElementById("employee-edit-close");
    const employeeEditCloseTopBtn = document.getElementById("employee-edit-close-top");

    const employeeRecalcModalEl = document.getElementById("employee-recalc-modal");
    const employeeRecalcIdEl = document.getElementById("employee-recalc-id");
    const employeeRecalcNameEl = document.getElementById("employee-recalc-name");
    const employeeRecalcPerformance1El = document.getElementById("employee-recalc-performance-1");
    const employeeRecalcPerformance2El = document.getElementById("employee-recalc-performance-2");
    const employeeRecalcPerformance3El = document.getElementById("employee-recalc-performance-3");
    const employeeRecalcPerformanceAvgEl = document.getElementById("employee-recalc-performance-avg");
    const employeeRecalcSaveBtn = document.getElementById("employee-recalc-save");
    const employeeRecalcCloseBtn = document.getElementById("employee-recalc-close");
    const employeeRecalcCloseTopBtn = document.getElementById("employee-recalc-close-top");

    const EMPLOYEE_PERF_FIELDS = [
        "linear_emp_performance_1",
        "linear_emp_performance_2",
        "linear_emp_performance_3"
    ];
    const SHIFT_VALUES = ["День 1", "День 2", "Ночь 1", "Ночь 2"];
    const SHIFT_CLASS_BY_VALUE = {
        "День 1": "day-1",
        "День 2": "day-2",
        "Ночь 1": "night-1",
        "Ночь 2": "night-2"
    };
    const PERFORMANCE_DATE_FIELD = "linear_emp_performance_date";
    const STALE_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;

    const state = {
        currentWhId: normalizeWhId(user?.user_wh_id),
        employees: [],
        squares: [],
        squareNameByRef: new Map(),
        loadedAt: null,

        shiftFilter: "all",
        onlyUnassigned: false,
        searchTerm: "",
        sortMode: "name",

        busy: {
            loading: false,
            saving: false,
            deleting: false
        },

        editingEmployeeId: "",
        recalculatingEmployeeId: ""
    };

    if (state.currentWhId === null) {
        toast("Не удалось определить user_wh_id пользователя", { type: "error" });
        return;
    }

    function normalizeWhId(value) {
        const raw = String(value ?? "").trim();
        if (!raw) return null;
        if (/^-?\d+$/.test(raw)) return Number(raw);
        return raw;
    }

    function normalizeKey(value) {
        return String(value ?? "").trim();
    }

    function normalizeRef(value) {
        return normalizeKey(value)
            .toLowerCase()
            .replace(/\s+/g, "")
            .replace(/[._-]/g, "");
    }

    function normalizeShiftValue(value) {
        const raw = normalizeKey(value);
        if (!raw) return "";

        if (SHIFT_VALUES.includes(raw)) return raw;
        if (raw === "День") return "День 1";
        if (raw === "Ночь") return "Ночь 1";
        return "";
    }

    function getShiftTokens(value) {
        if (Array.isArray(value)) {
            const uniq = new Set();
            return value
                .map((item) => normalizeShiftValue(item))
                .filter(Boolean)
                .filter((item) => {
                    if (uniq.has(item)) return false;
                    uniq.add(item);
                    return true;
                });
        }

        const raw = normalizeKey(value);
        if (!raw) return [];

        const parts = raw
            .split(/[,;|]+|\n/g)
            .map((item) => normalizeShiftValue(item))
            .filter(Boolean);

        const uniq = new Set();
        return parts.filter((item) => {
            if (uniq.has(item)) return false;
            uniq.add(item);
            return true;
        });
    }

    function serializeShiftTokens(tokens) {
        const uniq = getShiftTokens(tokens);
        return uniq.join(", ");
    }

    function getShiftClass(value) {
        return SHIFT_CLASS_BY_VALUE[normalizeShiftValue(value)] || "";
    }

    function renderShiftChips(tokens) {
        const list = getShiftTokens(tokens);
        if (!list.length) {
            return '<span class="employee-shift-chip">—</span>';
        }
        return list
            .map((shift) => `<span class="employee-shift-chip ${getShiftClass(shift)}">${escapeHtml(shift)}</span>`)
            .join("");
    }

    function collectShiftPickerValues(containerEl) {
        if (!containerEl) return [];
        const checked = Array.from(containerEl.querySelectorAll('input[type="checkbox"]:checked'))
            .map((input) => normalizeShiftValue(input.value))
            .filter(Boolean);
        return getShiftTokens(checked);
    }

    function applyShiftPickerValues(containerEl, values) {
        if (!containerEl) return;
        const selected = new Set(getShiftTokens(values));
        Array.from(containerEl.querySelectorAll('input[type="checkbox"]')).forEach((input) => {
            input.checked = selected.has(normalizeShiftValue(input.value));
        });
    }

    function rebuildSquareNameMap() {
        const map = new Map();
        (state.squares || []).forEach((square) => {
            const sqName = normalizeKey(square?.sq_name) || normalizeKey(square?.sq_id);
            if (!sqName) return;

            const refs = [normalizeRef(square?.sq_id), normalizeRef(square?.sq_name)].filter(Boolean);
            refs.forEach((ref) => map.set(ref, sqName));
        });
        state.squareNameByRef = map;
    }

    function resolveSquareName(value) {
        const raw = normalizeKey(value);
        if (!raw) return "не закреплен";

        const ref = normalizeRef(raw);
        const mapped = state.squareNameByRef.get(ref);
        return mapped || raw;
    }

    function parseNumber(value, fallback = 0) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const normalized = normalizeKey(value).replace(/\s+/g, "").replace(",", ".");
        if (!normalized) return fallback;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function parseNonNegativeInt(value) {
        const raw = normalizeKey(value);
        if (!/^\d+$/.test(raw)) return null;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) return null;
        return Math.round(parsed);
    }

    function calcAveragePerformance(values) {
        if (!Array.isArray(values) || values.length !== 3) return 0;
        const total = values.reduce((acc, val) => acc + parseNumber(val, 0), 0);
        return Math.round(total / 3);
    }

    function formatNum(value) {
        return new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(Number(value || 0));
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function toast(message, opts = {}) {
        if (window.MiniUI?.toast) {
            window.MiniUI.toast(message, opts);
            return;
        }
        console.log(message);
    }

    function getEmployeeId(emp) {
        return normalizeKey(emp?.linear_emp_id);
    }

    function getEmployeeById(empIdRaw) {
        const empId = normalizeKey(empIdRaw);
        if (!empId) return null;
        return (state.employees || []).find((emp) => getEmployeeId(emp) === empId) || null;
    }

    function getEmployeeShiftTokens(emp) {
        return getShiftTokens(emp?.linear_emp_shift);
    }

    function getEmployeePerformanceTriplet(emp) {
        const values = EMPLOYEE_PERF_FIELDS.map((field) => parseNonNegativeInt(emp?.[field]));
        if (values.every((v) => v !== null)) return values;

        const fallback = Math.max(0, Math.round(parseNumber(emp?.linear_emp_performance, 0)));
        return [fallback, fallback, fallback];
    }

    function isEmployeeUnassigned(emp) {
        return !normalizeKey(emp?.linear_emp_sq);
    }

    function isPerformanceDateStale(value) {
        const raw = normalizeKey(value);
        if (!raw) return true;

        const ts = Date.parse(raw);
        if (!Number.isFinite(ts)) return true;

        return (Date.now() - ts) > STALE_LIMIT_MS;
    }

    function formatPerformanceDate(value) {
        const raw = normalizeKey(value);
        if (!raw) return "не указано";

        const ts = Date.parse(raw);
        if (!Number.isFinite(ts)) return "некорректная дата";

        return new Date(ts).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
    }

    function getNowIso() {
        return new Date().toISOString();
    }

    function isBusy() {
        return Object.values(state.busy).some(Boolean);
    }

    function setBusyFlag(flag, value) {
        state.busy[flag] = Boolean(value);
        refreshBusyUi();
    }

    function refreshBusyUi() {
        const busy = isBusy();

        if (window.MiniUI?.setLoaderVisible) {
            window.MiniUI.setLoaderVisible(busy);
        }

        btnReload.disabled = busy;
        btnReload.style.opacity = busy ? "0.7" : "";
        btnReload.style.cursor = busy ? "not-allowed" : "";

        btnAddEmployee.disabled = busy;
        btnAddEmployee.style.opacity = busy ? "0.7" : "";
        btnAddEmployee.style.cursor = busy ? "not-allowed" : "";

        employeeCreateSaveBtn.disabled = busy;
        employeeCreateSaveBtn.style.opacity = busy ? "0.7" : "";
        employeeCreateSaveBtn.style.cursor = busy ? "not-allowed" : "";

        employeeEditSaveBtn.disabled = busy;
        employeeEditSaveBtn.style.opacity = busy ? "0.7" : "";
        employeeEditSaveBtn.style.cursor = busy ? "not-allowed" : "";

        employeeRecalcSaveBtn.disabled = busy;
        employeeRecalcSaveBtn.style.opacity = busy ? "0.7" : "";
        employeeRecalcSaveBtn.style.cursor = busy ? "not-allowed" : "";
    }

    function updateStatusLine(filteredCount) {
        const loadedAt = state.loadedAt
            ? new Date(state.loadedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
            : "—";

        statusLineEl.textContent = `Сотрудников: ${state.employees.length} · показано: ${filteredCount} · обновлено: ${loadedAt}`;
    }

    function getFilteredEmployees() {
        const query = normalizeKey(state.searchTerm).toLowerCase();

        return (state.employees || [])
            .filter((emp) => {
                const shiftTokens = getEmployeeShiftTokens(emp);
                if (state.shiftFilter !== "all" && !shiftTokens.includes(state.shiftFilter)) {
                    return false;
                }
                if (state.onlyUnassigned && !isEmployeeUnassigned(emp)) {
                    return false;
                }
                if (query) {
                    const empId = getEmployeeId(emp);
                    const empName = normalizeKey(emp?.linear_emp_name);
                    const perf = formatNum(parseNumber(emp?.linear_emp_performance, 0));
                    const shift = shiftTokens.join(" ");
                    const assignment = resolveSquareName(emp?.linear_emp_sq);
                    const haystack = `${empName} ${empId} ${perf} ${shift} ${assignment}`.toLowerCase();
                    if (!haystack.includes(query)) {
                        return false;
                    }
                }
                return true;
            })
            .sort((a, b) => {
                if (state.sortMode === "performance_desc") {
                    const perfA = parseNumber(a?.linear_emp_performance, 0);
                    const perfB = parseNumber(b?.linear_emp_performance, 0);
                    if (perfA !== perfB) return perfB - perfA;
                }

                const nameCmp = normalizeKey(a?.linear_emp_name).localeCompare(normalizeKey(b?.linear_emp_name), "ru", { sensitivity: "base" });
                if (nameCmp !== 0) return nameCmp;
                return getEmployeeId(a).localeCompare(getEmployeeId(b), "ru", { numeric: true, sensitivity: "base" });
            });
    }

    function renderEmployees() {
        const employees = getFilteredEmployees();
        updateStatusLine(employees.length);

        if (!employees.length) {
            employeesGridEl.innerHTML = "";
            employeesEmptyEl.style.display = "";
            return;
        }

        employeesEmptyEl.style.display = "none";

        employeesGridEl.innerHTML = employees.map((emp) => {
            const empId = getEmployeeId(emp) || "—";
            const empName = normalizeKey(emp?.linear_emp_name) || "Без имени";
            const shiftTokens = getEmployeeShiftTokens(emp);
            const perf = formatNum(parseNumber(emp?.linear_emp_performance, 0));
            const perfDateRaw = emp?.[PERFORMANCE_DATE_FIELD];
            const assignedSq = normalizeKey(emp?.linear_emp_sq);
            const stale = isPerformanceDateStale(perfDateRaw);
            const perfDateText = formatPerformanceDate(perfDateRaw);
            const assignedLabel = resolveSquareName(assignedSq);

            return `
                <article class="employee-card ${stale ? "is-stale" : ""}">
                    <div class="employee-main">
                        <p class="employee-id">${escapeHtml(empId)}</p>
                        <p class="employee-name" title="${escapeHtml(empName)}">${escapeHtml(empName)}</p>
                        <p class="employee-shift">
                            <span class="employee-shift-tags">${renderShiftChips(shiftTokens)}</span>
                        </p>
                    </div>

                    <p class="employee-perf">${escapeHtml(perf)}</p>
                    <p class="employee-date">${stale ? "Выработка неактуальна" : "Выработка актуальна"}<br>${escapeHtml(perfDateText)}</p>
                    <p class="employee-assignment">Закрепление: ${escapeHtml(assignedLabel)}</p>

                    <div class="employee-actions">
                        <button type="button" class="btn btn-outline" data-role="edit" data-emp-id="${escapeHtml(empId)}">Редактировать</button>
                        <button type="button" class="btn btn-outline btn-danger" data-role="delete" data-emp-id="${escapeHtml(empId)}">Удалить</button>
                        <button type="button" class="btn btn-outline" data-role="recalc" data-emp-id="${escapeHtml(empId)}">Пересчитать</button>
                    </div>
                </article>
            `;
        }).join("");
    }

    function showModal(modalEl) {
        if (!modalEl) return;
        modalEl.classList.remove("hidden");
    }

    function hideModal(modalEl) {
        if (!modalEl) return;
        modalEl.classList.add("hidden");
    }

    function closeCreateModal() {
        hideModal(employeeCreateModalEl);
    }

    function closeEditModal() {
        hideModal(employeeEditModalEl);
        state.editingEmployeeId = "";
    }

    function closeRecalcModal() {
        hideModal(employeeRecalcModalEl);
        state.recalculatingEmployeeId = "";
    }

    function getCreateTriplet() {
        const values = [
            parseNonNegativeInt(employeeCreatePerformance1El.value),
            parseNonNegativeInt(employeeCreatePerformance2El.value),
            parseNonNegativeInt(employeeCreatePerformance3El.value)
        ];
        return values.some((v) => v === null) ? null : values;
    }

    function getRecalcTriplet() {
        const values = [
            parseNonNegativeInt(employeeRecalcPerformance1El.value),
            parseNonNegativeInt(employeeRecalcPerformance2El.value),
            parseNonNegativeInt(employeeRecalcPerformance3El.value)
        ];
        return values.some((v) => v === null) ? null : values;
    }

    function updateCreateAvgPreview() {
        const triplet = getCreateTriplet();
        if (!triplet) {
            employeeCreatePerformanceAvgEl.textContent = "Средняя выработка: —";
            return;
        }
        employeeCreatePerformanceAvgEl.textContent = `Средняя выработка: ${formatNum(calcAveragePerformance(triplet))}`;
    }

    function updateRecalcAvgPreview() {
        const triplet = getRecalcTriplet();
        if (!triplet) {
            employeeRecalcPerformanceAvgEl.textContent = "Средняя выработка: —";
            return;
        }
        employeeRecalcPerformanceAvgEl.textContent = `Средняя выработка: ${formatNum(calcAveragePerformance(triplet))}`;
    }

    function openCreateModal() {
        if (isBusy()) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        employeeCreateIdEl.value = "";
        employeeCreateNameEl.value = "";
        applyShiftPickerValues(employeeCreateShiftsEl, ["День 1"]);
        employeeCreatePerformance1El.value = "";
        employeeCreatePerformance2El.value = "";
        employeeCreatePerformance3El.value = "";
        updateCreateAvgPreview();

        showModal(employeeCreateModalEl);
        setTimeout(() => employeeCreateIdEl.focus(), 0);
    }

    function openEditModal(empIdRaw) {
        if (isBusy()) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        const empId = normalizeKey(empIdRaw);
        const employee = getEmployeeById(empId);
        if (!employee) {
            toast("Сотрудник не найден", { type: "error" });
            return;
        }

        state.editingEmployeeId = empId;
        employeeEditIdEl.textContent = empId;
        employeeEditNameEl.value = normalizeKey(employee?.linear_emp_name);
        applyShiftPickerValues(employeeEditShiftsEl, getEmployeeShiftTokens(employee));

        showModal(employeeEditModalEl);
        setTimeout(() => employeeEditNameEl.focus(), 0);
    }

    function openRecalcModal(empIdRaw) {
        if (isBusy()) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        const empId = normalizeKey(empIdRaw);
        const employee = getEmployeeById(empId);
        if (!employee) {
            toast("Сотрудник не найден", { type: "error" });
            return;
        }

        state.recalculatingEmployeeId = empId;
        employeeRecalcIdEl.textContent = empId;
        employeeRecalcNameEl.textContent = normalizeKey(employee?.linear_emp_name) || "Без имени";

        const triplet = getEmployeePerformanceTriplet(employee);
        employeeRecalcPerformance1El.value = String(triplet[0]);
        employeeRecalcPerformance2El.value = String(triplet[1]);
        employeeRecalcPerformance3El.value = String(triplet[2]);
        updateRecalcAvgPreview();

        showModal(employeeRecalcModalEl);
        setTimeout(() => employeeRecalcPerformance1El.focus(), 0);
    }

    function getErrorMessage(error) {
        return String(error?.message || error || "");
    }

    function isColumnMissingError(error) {
        const msg = getErrorMessage(error).toLowerCase();
        return msg.includes("column") || msg.includes("does not exist") || msg.includes("не существует");
    }

    function makePayloadVariants(basePayload, omitSets) {
        const seen = new Set();
        const variants = [];

        (omitSets || []).forEach((omit) => {
            const variant = { ...basePayload };
            (omit || []).forEach((field) => {
                delete variant[field];
            });

            const signature = JSON.stringify(
                Object.keys(variant)
                    .sort()
                    .map((key) => [key, variant[key]])
            );

            if (seen.has(signature)) return;
            seen.add(signature);
            variants.push(variant);
        });

        return variants;
    }

    async function insertEmployeeWithFallback(basePayload) {
        const variants = makePayloadVariants(basePayload, [
            [],
            [...EMPLOYEE_PERF_FIELDS],
            [PERFORMANCE_DATE_FIELD],
            [...EMPLOYEE_PERF_FIELDS, PERFORMANCE_DATE_FIELD]
        ]);

        let lastError = null;

        for (const payload of variants) {
            const { error } = await supabaseClient
                .from("linear_emp_rep")
                .insert(payload);

            if (!error) return;
            lastError = error;

            if (!isColumnMissingError(error)) break;
        }

        throw new Error(getErrorMessage(lastError) || "Ошибка добавления сотрудника");
    }

    async function updateEmployeePerformanceWithFallback(dbLinearEmpId, basePayload) {
        const variants = makePayloadVariants(basePayload, [
            [],
            [...EMPLOYEE_PERF_FIELDS],
            [PERFORMANCE_DATE_FIELD],
            [...EMPLOYEE_PERF_FIELDS, PERFORMANCE_DATE_FIELD]
        ]);

        let lastError = null;

        for (const payload of variants) {
            const { error } = await supabaseClient
                .from("linear_emp_rep")
                .update(payload)
                .eq("wh_id", state.currentWhId)
                .eq("linear_emp_id", dbLinearEmpId);

            if (!error) return;
            lastError = error;

            if (!isColumnMissingError(error)) break;
        }

        throw new Error(getErrorMessage(lastError) || "Ошибка пересчета продуктивности");
    }

    async function askConfirm(message) {
        if (window.MiniUI?.confirm) {
            try {
                return await window.MiniUI.confirm(message, { okText: "Да", cancelText: "Отмена" });
            } catch (_) {
                return window.confirm(message);
            }
        }
        return window.confirm(message);
    }

    async function createEmployee() {
        if (isBusy()) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        const rawId = normalizeKey(employeeCreateIdEl.value);
        const name = normalizeKey(employeeCreateNameEl.value);
        const shiftTokens = collectShiftPickerValues(employeeCreateShiftsEl);
        const triplet = getCreateTriplet();

        if (!rawId) {
            toast("Введите ID сотрудника", { type: "error" });
            return;
        }
        if (!/^\d+$/.test(rawId)) {
            toast("ID должен содержать только цифры", { type: "error" });
            return;
        }
        if (!name) {
            toast("Введите ФИО сотрудника", { type: "error" });
            return;
        }
        if (!shiftTokens.length) {
            toast("Выберите хотя бы одну смену", { type: "error" });
            return;
        }
        if (!triplet) {
            toast("Заполните выработку за 3 смены целыми числами", { type: "error" });
            return;
        }
        if (getEmployeeById(rawId)) {
            toast(`Сотрудник с ID ${rawId} уже существует`, { type: "error" });
            return;
        }

        const avgPerf = calcAveragePerformance(triplet);
        const nowIso = getNowIso();

        const payload = {
            linear_emp_id: Number(rawId),
            linear_emp_name: name,
            linear_emp_shift: serializeShiftTokens(shiftTokens),
            linear_emp_performance: avgPerf,
            [EMPLOYEE_PERF_FIELDS[0]]: triplet[0],
            [EMPLOYEE_PERF_FIELDS[1]]: triplet[1],
            [EMPLOYEE_PERF_FIELDS[2]]: triplet[2],
            [PERFORMANCE_DATE_FIELD]: nowIso,
            linear_emp_sq: null,
            wh_id: state.currentWhId
        };

        setBusyFlag("saving", true);
        try {
            await insertEmployeeWithFallback(payload);
            closeCreateModal();
            await loadData();
            toast("Сотрудник добавлен", { type: "success" });
        } catch (error) {
            console.error("Ошибка добавления сотрудника:", error);
            toast(`Не удалось добавить сотрудника: ${getErrorMessage(error)}`, { type: "error" });
        } finally {
            setBusyFlag("saving", false);
        }
    }

    async function saveEmployeeEdit() {
        if (isBusy()) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        const empId = normalizeKey(state.editingEmployeeId);
        const employee = getEmployeeById(empId);
        if (!employee) {
            toast("Сотрудник не найден", { type: "error" });
            return;
        }

        const name = normalizeKey(employeeEditNameEl.value);
        const shiftTokens = collectShiftPickerValues(employeeEditShiftsEl);

        if (!name) {
            toast("Введите ФИО сотрудника", { type: "error" });
            return;
        }
        if (!shiftTokens.length) {
            toast("Выберите хотя бы одну смену", { type: "error" });
            return;
        }

        setBusyFlag("saving", true);
        try {
            const { error } = await supabaseClient
                .from("linear_emp_rep")
                .update({
                    linear_emp_name: name,
                    linear_emp_shift: serializeShiftTokens(shiftTokens)
                })
                .eq("wh_id", state.currentWhId)
                .eq("linear_emp_id", employee.linear_emp_id);

            if (error) throw new Error(error.message || "Ошибка редактирования сотрудника");

            closeEditModal();
            await loadData();
            toast("Сотрудник обновлен", { type: "success" });
        } catch (error) {
            console.error("Ошибка редактирования сотрудника:", error);
            toast(`Не удалось обновить сотрудника: ${getErrorMessage(error)}`, { type: "error" });
        } finally {
            setBusyFlag("saving", false);
        }
    }

    async function saveRecalculatedPerformance() {
        if (isBusy()) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        const empId = normalizeKey(state.recalculatingEmployeeId);
        const employee = getEmployeeById(empId);
        if (!employee) {
            toast("Сотрудник не найден", { type: "error" });
            return;
        }

        const triplet = getRecalcTriplet();
        if (!triplet) {
            toast("Заполните выработку за 3 смены целыми числами", { type: "error" });
            return;
        }

        const avgPerf = calcAveragePerformance(triplet);
        const nowIso = getNowIso();

        const payload = {
            linear_emp_performance: avgPerf,
            [EMPLOYEE_PERF_FIELDS[0]]: triplet[0],
            [EMPLOYEE_PERF_FIELDS[1]]: triplet[1],
            [EMPLOYEE_PERF_FIELDS[2]]: triplet[2],
            [PERFORMANCE_DATE_FIELD]: nowIso
        };

        setBusyFlag("saving", true);
        try {
            await updateEmployeePerformanceWithFallback(employee.linear_emp_id, payload);
            closeRecalcModal();
            await loadData();
            toast("Продуктивность пересчитана", { type: "success" });
        } catch (error) {
            console.error("Ошибка пересчета продуктивности:", error);
            toast(`Не удалось пересчитать продуктивность: ${getErrorMessage(error)}`, { type: "error" });
        } finally {
            setBusyFlag("saving", false);
        }
    }

    async function deleteEmployee(empIdRaw) {
        const empId = normalizeKey(empIdRaw);
        if (!empId) return;

        const employee = getEmployeeById(empId);
        if (!employee) {
            toast("Сотрудник не найден", { type: "error" });
            return;
        }

        const ok = await askConfirm(`Удалить сотрудника ${normalizeKey(employee?.linear_emp_name) || empId} (${empId})?`);
        if (!ok) return;

        if (isBusy()) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        setBusyFlag("deleting", true);
        try {
            const { error } = await supabaseClient
                .from("linear_emp_rep")
                .delete()
                .eq("wh_id", state.currentWhId)
                .eq("linear_emp_id", employee.linear_emp_id);

            if (error) throw new Error(error.message || "Ошибка удаления сотрудника");

            if (normalizeKey(state.editingEmployeeId) === empId) {
                closeEditModal();
            }
            if (normalizeKey(state.recalculatingEmployeeId) === empId) {
                closeRecalcModal();
            }

            await loadData();
            toast("Сотрудник удален", { type: "success" });
        } catch (error) {
            console.error("Ошибка удаления сотрудника:", error);
            toast(`Не удалось удалить сотрудника: ${getErrorMessage(error)}`, { type: "error" });
        } finally {
            setBusyFlag("deleting", false);
        }
    }

    async function loadData() {
        setBusyFlag("loading", true);
        try {
            const [employeesRes, squaresRes] = await Promise.all([
                supabaseClient
                    .from("linear_emp_rep")
                    .select("*")
                    .eq("wh_id", state.currentWhId),
                supabaseClient
                    .from("sort_squares_rep")
                    .select("sq_id, sq_name, sq_group, wh_id")
                    .eq("wh_id", state.currentWhId)
            ]);

            if (employeesRes.error) throw new Error(employeesRes.error.message || "Ошибка загрузки linear_emp_rep");
            if (squaresRes.error) throw new Error(squaresRes.error.message || "Ошибка загрузки sort_squares_rep");

            state.employees = Array.isArray(employeesRes.data) ? employeesRes.data : [];
            state.squares = Array.isArray(squaresRes.data) ? squaresRes.data : [];
            rebuildSquareNameMap();
            state.loadedAt = Date.now();
            renderEmployees();
        } catch (error) {
            console.error("Ошибка загрузки сотрудников:", error);
            state.employees = [];
            state.squares = [];
            state.squareNameByRef = new Map();
            renderEmployees();
            toast(`Ошибка загрузки сотрудников: ${getErrorMessage(error)}`, { type: "error" });
        } finally {
            setBusyFlag("loading", false);
        }
    }

    function bindNumericInput(inputEl, onUpdate) {
        if (!inputEl) return;
        inputEl.addEventListener("input", () => {
            inputEl.value = inputEl.value.replace(/[^\d]/g, "");
            if (typeof onUpdate === "function") onUpdate();
        });
    }

    function bindEvents() {
        btnReload.addEventListener("click", loadData);
        btnAddEmployee.addEventListener("click", openCreateModal);

        filterShiftEl.addEventListener("change", () => {
            const value = normalizeKey(filterShiftEl.value);
            state.shiftFilter = SHIFT_VALUES.includes(value) ? value : "all";
            renderEmployees();
        });

        filterUnassignedEl.addEventListener("change", () => {
            state.onlyUnassigned = Boolean(filterUnassignedEl.checked);
            renderEmployees();
        });

        if (filterSearchEl) {
            filterSearchEl.addEventListener("input", () => {
                state.searchTerm = filterSearchEl.value || "";
                renderEmployees();
            });
        }

        if (filterSortEl) {
            filterSortEl.addEventListener("change", () => {
                const value = normalizeKey(filterSortEl.value);
                state.sortMode = value === "performance_desc" ? "performance_desc" : "name";
                renderEmployees();
            });
        }

        employeesGridEl.addEventListener("click", (event) => {
            const actionBtn = event.target.closest("[data-role]");
            if (!actionBtn) return;

            const empId = normalizeKey(actionBtn.dataset.empId);
            if (!empId) return;

            const role = normalizeKey(actionBtn.dataset.role);
            if (role === "edit") {
                openEditModal(empId);
                return;
            }
            if (role === "delete") {
                deleteEmployee(empId);
                return;
            }
            if (role === "recalc") {
                openRecalcModal(empId);
            }
        });

        bindNumericInput(employeeCreateIdEl);
        bindNumericInput(employeeCreatePerformance1El, updateCreateAvgPreview);
        bindNumericInput(employeeCreatePerformance2El, updateCreateAvgPreview);
        bindNumericInput(employeeCreatePerformance3El, updateCreateAvgPreview);
        bindNumericInput(employeeRecalcPerformance1El, updateRecalcAvgPreview);
        bindNumericInput(employeeRecalcPerformance2El, updateRecalcAvgPreview);
        bindNumericInput(employeeRecalcPerformance3El, updateRecalcAvgPreview);

        employeeCreateSaveBtn.addEventListener("click", createEmployee);
        employeeCreateCloseBtn.addEventListener("click", closeCreateModal);
        employeeCreateCloseTopBtn.addEventListener("click", closeCreateModal);

        employeeEditSaveBtn.addEventListener("click", saveEmployeeEdit);
        employeeEditCloseBtn.addEventListener("click", closeEditModal);
        employeeEditCloseTopBtn.addEventListener("click", closeEditModal);

        employeeRecalcSaveBtn.addEventListener("click", saveRecalculatedPerformance);
        employeeRecalcCloseBtn.addEventListener("click", closeRecalcModal);
        employeeRecalcCloseTopBtn.addEventListener("click", closeRecalcModal);

        employeeCreateModalEl.addEventListener("click", (event) => {
            if (event.target === employeeCreateModalEl || event.target.classList.contains("modal-backdrop")) {
                closeCreateModal();
            }
        });

        employeeEditModalEl.addEventListener("click", (event) => {
            if (event.target === employeeEditModalEl || event.target.classList.contains("modal-backdrop")) {
                closeEditModal();
            }
        });

        employeeRecalcModalEl.addEventListener("click", (event) => {
            if (event.target === employeeRecalcModalEl || event.target.classList.contains("modal-backdrop")) {
                closeRecalcModal();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;

            if (!employeeRecalcModalEl.classList.contains("hidden")) {
                closeRecalcModal();
                return;
            }
            if (!employeeEditModalEl.classList.contains("hidden")) {
                closeEditModal();
                return;
            }
            if (!employeeCreateModalEl.classList.contains("hidden")) {
                closeCreateModal();
            }
        });
    }

    function init() {
        filterShiftEl.value = "all";
        filterUnassignedEl.checked = false;
        if (filterSearchEl) filterSearchEl.value = "";
        if (filterSortEl) filterSortEl.value = "name";
        updateCreateAvgPreview();
        updateRecalcAvgPreview();
        bindEvents();
        refreshBusyUi();
        loadData();
    }

    init();
})();
