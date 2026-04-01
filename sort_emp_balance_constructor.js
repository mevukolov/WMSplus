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

    const reloadBtn = document.getElementById("reload-btn");

    const kpiGroupsEl = document.getElementById("kpi-groups");
    const kpiSquaresEl = document.getElementById("kpi-squares");
    const kpiEmployeesEl = document.getElementById("kpi-employees");
    const kpiAssignedEl = document.getElementById("kpi-assigned");
    const kpiTotalWeightEl = document.getElementById("kpi-total-weight");

    const statusLineEl = document.getElementById("status-line");
    const groupsWrapEl = document.getElementById("groups-wrap");
    const groupsEmptyEl = document.getElementById("groups-empty");

    const employeesSearchInputEl = document.getElementById("employees-search-input");
    const employeesListEl = document.getElementById("employees-list");
    const employeesEmptyEl = document.getElementById("employees-empty");

    const analysisDropZoneEl = document.getElementById("analysis-drop-zone");
    const analysisListEl = document.getElementById("analysis-list");
    const analysisEmptyEl = document.getElementById("analysis-empty");
    const analysisCountEl = document.getElementById("analysis-count");
    const analysisClearBtn = document.getElementById("analysis-clear-btn");
    const balanceBtn = document.getElementById("balance-btn");

    const balanceModalEl = document.getElementById("balance-modal");
    const balanceModalSchemeEl = document.getElementById("balance-modal-scheme");
    const balanceModalStatusEl = document.getElementById("balance-modal-status");
    const balanceSaveBtn = document.getElementById("balance-save-btn");
    const balanceResetBtn = document.getElementById("balance-reset-btn");
    const balanceCloseBtn = document.getElementById("balance-close-btn");

    const btnAddEmployee = document.getElementById("btn-add-employee");
    const employeeCreateModalEl = document.getElementById("employee-create-modal");
    const employeeFormTitleEl = document.getElementById("employee-form-title");
    const employeeCreateIdEl = document.getElementById("employee-create-id");
    const employeeCreateNameEl = document.getElementById("employee-create-name");
    const employeeCreateShiftEl = document.getElementById("employee-create-shift");
    const employeeCreatePerformance1El = document.getElementById("employee-create-performance-1");
    const employeeCreatePerformance2El = document.getElementById("employee-create-performance-2");
    const employeeCreatePerformance3El = document.getElementById("employee-create-performance-3");
    const employeeCreatePerformanceAvgEl = document.getElementById("employee-create-performance-avg");
    const employeeCreateSaveBtn = document.getElementById("employee-create-save");
    const employeeCreateCloseBtn = document.getElementById("employee-create-close");
    const employeeCreateCloseTopBtn = document.getElementById("employee-create-close-top");
    const btnBulkUnassign = document.getElementById("btn-bulk-unassign");

    const state = {
        currentWhId: normalizeWhId(user?.user_wh_id),
        squares: [],
        groups: [],
        employees: [],
        loadedAt: null,

        employeesSearchTerm: "",

        activeAssignSquareKey: "",
        activeAssignEmployeeId: "",

        isLoading: false,
        isAssigning: false,
        isSavingBalance: false,
        isCreatingEmployee: false,

        draggingEmpIds: [],
        squareMap: new Map(),
        currentModel: null,

        analysisEmployeeIds: [],

        balanceProposal: null,

        employeeFormMode: "create",
        employeeEditTargetId: "",

        selectedEmployeeIds: [],

        checkboxDragActive: false,
        checkboxDragValue: false
    };

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
    const FREE_SQUARES_GROUP = "Свободные КС";
    const ARCHIVE_SQUARES_GROUP = "Архив КС";

    if (state.currentWhId === null) {
        window.MiniUI?.toast?.("Не удалось определить user_wh_id пользователя", { type: "error" });
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

    function getShiftClass(value) {
        return SHIFT_CLASS_BY_VALUE[normalizeShiftValue(value)] || "";
    }

    function renderEmployeeShiftChips(value) {
        const tokens = getShiftTokens(value);
        if (!tokens.length) {
            return '<span class="emp-shift-label">—</span>';
        }
        return tokens
            .map((shift) => `<span class="emp-shift-label ${getShiftClass(shift)}">${escapeHtml(shift)}</span>`)
            .join("");
    }

    function parseNumber(value, fallback = 0) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const normalized = normalizeKey(value).replace(/\s+/g, "").replace(",", ".");
        if (!normalized) return fallback;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function isTruthyFlag(value) {
        const raw = normalizeKey(value).toLowerCase();
        if (!raw) return false;
        return raw === "1" || raw === "true" || raw === "t" || raw === "yes" || raw === "y";
    }

    function isPseudoSquaresGroup(groupKey) {
        const ref = normalizeRef(groupKey);
        if (!ref) return false;
        return ref === normalizeRef(FREE_SQUARES_GROUP) || ref === normalizeRef(ARCHIVE_SQUARES_GROUP);
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

    function getEmployeePerformanceTriplet(emp) {
        const values = EMPLOYEE_PERF_FIELDS.map((field) => parseNonNegativeInt(emp?.[field]));
        if (values.every((v) => v !== null)) return values;

        const fallback = Math.max(0, Math.round(parseNumber(emp?.linear_emp_performance, 0)));
        return [fallback, fallback, fallback];
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatNum(value) {
        return new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(Number(value || 0));
    }

    function compareByKey(a, b) {
        const na = Number(a);
        const nb = Number(b);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return String(a).localeCompare(String(b), "ru", { numeric: true, sensitivity: "base" });
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

    function getEmployeeById(empId) {
        const id = normalizeKey(empId);
        return (state.employees || []).find((emp) => getEmployeeId(emp) === id) || null;
    }

    function getUniqueEmployeeIds(values) {
        const seen = new Set();
        return (values || [])
            .map((value) => normalizeKey(value))
            .filter(Boolean)
            .filter((id) => {
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
            });
    }

    function syncSelectedEmployees() {
        const existing = new Set((state.employees || []).map((emp) => getEmployeeId(emp)));
        state.selectedEmployeeIds = getUniqueEmployeeIds(state.selectedEmployeeIds).filter((id) => existing.has(id));
    }

    function refreshBulkUnassignButton() {
        const hasSelected = (state.selectedEmployeeIds || []).length > 0;
        btnBulkUnassign.style.display = hasSelected ? "" : "none";
        btnBulkUnassign.disabled = state.isAssigning || state.isSavingBalance || state.isLoading;
        btnBulkUnassign.style.opacity = btnBulkUnassign.disabled ? "0.7" : "";
        btnBulkUnassign.style.cursor = btnBulkUnassign.disabled ? "not-allowed" : "";
    }

    function findEmployeeNodeByRole(role, empIdRaw) {
        const empId = normalizeKey(empIdRaw);
        if (!empId) return null;

        return Array.from(employeesListEl.querySelectorAll(`[data-role="${role}"]`))
            .find((node) => normalizeKey(node.dataset.empId) === empId) || null;
    }

    function setEmployeeSelection(empIdRaw, shouldSelect, syncUi = true) {
        const empId = normalizeKey(empIdRaw);
        if (!empId) return;

        if (shouldSelect) {
            if (!state.selectedEmployeeIds.includes(empId)) {
                state.selectedEmployeeIds.push(empId);
            }
        } else {
            state.selectedEmployeeIds = state.selectedEmployeeIds.filter((id) => id !== empId);
        }

        syncSelectedEmployees();

        if (syncUi) {
            const isSelected = state.selectedEmployeeIds.includes(empId);
            const empItem = findEmployeeNodeByRole("emp-item", empId);
            if (empItem) empItem.classList.toggle("is-selected", isSelected);

            const checkbox = findEmployeeNodeByRole("emp-check", empId);
            if (checkbox && checkbox.checked !== isSelected) checkbox.checked = isSelected;
        }

        refreshBulkUnassignButton();
    }

    function getSquareRefCandidates(square) {
        return [normalizeRef(square?.sqId), normalizeRef(square?.sqName)].filter(Boolean);
    }

    function getSquareAssignTarget(square) {
        return normalizeKey(square?.sqId) || normalizeKey(square?.sqName);
    }

    function calcSquareProductivity(employees) {
        return (employees || []).reduce((acc, emp) => acc + parseNumber(emp?.linear_emp_performance, 0), 0);
    }

    function setLoadingState(isLoading) {
        state.isLoading = Boolean(isLoading);
        refreshBusyUi();
    }

    function setAssigningState(isBusy) {
        state.isAssigning = Boolean(isBusy);
        refreshBusyUi();
    }

    function setSavingBalanceState(isBusy) {
        state.isSavingBalance = Boolean(isBusy);
        balanceSaveBtn.disabled = state.isSavingBalance;
        balanceSaveBtn.style.opacity = state.isSavingBalance ? "0.7" : "";
        balanceSaveBtn.style.cursor = state.isSavingBalance ? "not-allowed" : "";
        refreshBusyUi();
    }

    function setCreatingEmployeeState(isBusy) {
        state.isCreatingEmployee = Boolean(isBusy);
        employeeCreateSaveBtn.disabled = state.isCreatingEmployee;
        employeeCreateSaveBtn.style.opacity = state.isCreatingEmployee ? "0.7" : "";
        employeeCreateSaveBtn.style.cursor = state.isCreatingEmployee ? "not-allowed" : "";
        refreshBusyUi();
    }

    function refreshBusyUi() {
        const busy = state.isLoading || state.isSavingBalance || state.isAssigning || state.isCreatingEmployee;
        if (window.MiniUI?.setLoaderVisible) {
            window.MiniUI.setLoaderVisible(busy);
        }

        reloadBtn.disabled = busy;
        reloadBtn.style.opacity = busy ? "0.7" : "";
        reloadBtn.style.cursor = busy ? "not-allowed" : "";

        refreshBulkUnassignButton();
    }

    function createBaseModel() {
        const groupsMap = new Map();

        (state.groups || []).forEach((row) => {
            const groupKey = normalizeKey(row?.sort_group);
            if (!groupKey) return;
            groupsMap.set(groupKey, {
                groupKey,
                weight: parseNumber(row?.weight, 0),
                squares: []
            });
        });

        (state.squares || []).forEach((row) => {
            const groupKey = normalizeKey(row?.sq_group);
            if (!groupKey) return;
            if (isPseudoSquaresGroup(groupKey)) return;
            if (!groupsMap.has(groupKey)) return;

            groupsMap.get(groupKey).squares.push({
                sqId: normalizeKey(row?.sq_id),
                sqName: normalizeKey(row?.sq_name),
                sqGroup: groupKey,
                isSecondary: isTruthyFlag(row?.is_secondary)
            });
        });

        const employeesByRef = new Map();
        (state.employees || []).forEach((emp) => {
            const ref = normalizeRef(emp?.linear_emp_sq);
            if (!ref) return;
            if (!employeesByRef.has(ref)) employeesByRef.set(ref, []);
            employeesByRef.get(ref).push(emp);
        });

        let assignedEmployeesCount = 0;

        const groups = Array.from(groupsMap.values())
            .sort((a, b) => compareByKey(a.groupKey, b.groupKey))
            .map((group, groupIndex) => {
                const squares = (group.squares || [])
                    .sort((a, b) => compareByKey(a.sqId || a.sqName, b.sqId || b.sqName))
                    .map((square, squareIndex) => {
                        const refs = getSquareRefCandidates(square);

                        const linked = [];
                        const uniq = new Set();

                        refs.forEach((ref) => {
                            const list = employeesByRef.get(ref) || [];
                            list.forEach((emp) => {
                                const key = getEmployeeId(emp) || normalizeKey(emp?.linear_emp_name);
                                if (!key || uniq.has(key)) return;
                                uniq.add(key);
                                linked.push(emp);
                            });
                        });

                        linked.sort((a, b) => compareByKey(a?.linear_emp_id, b?.linear_emp_id));
                        assignedEmployeesCount += linked.length;

                        const sqKey = `${group.groupKey}::${square.sqId || square.sqName || `${groupIndex}-${squareIndex}`}`;

                        return {
                            ...square,
                            sqKey,
                            refs,
                            assignTarget: getSquareAssignTarget(square),
                            employees: linked
                        };
                    });

                return {
                    ...group,
                    squares
                };
            });

        const totalWeight = groups.reduce((acc, group) => acc + Math.max(0, parseNumber(group.weight, 0)), 0);

        return {
            groups,
            totalEmployeesCount: (state.employees || []).length,
            assignedEmployeesCount,
            totalWeight
        };
    }

    function getAvailableUnassignedEmployees() {
        return (state.employees || [])
            .filter((emp) => !normalizeKey(emp?.linear_emp_sq))
            .sort((a, b) => {
                const nameCmp = normalizeKey(a?.linear_emp_name).localeCompare(normalizeKey(b?.linear_emp_name), "ru", { sensitivity: "base" });
                if (nameCmp !== 0) return nameCmp;
                return compareByKey(a?.linear_emp_id, b?.linear_emp_id);
            });
    }

    function getSquareByKey(squareKey) {
        return state.squareMap.get(normalizeKey(squareKey)) || null;
    }

    function renderKpis(model) {
        const hasKpiTargets = Boolean(kpiGroupsEl || kpiSquaresEl || kpiEmployeesEl || kpiAssignedEl || kpiTotalWeightEl);
        if (!hasKpiTargets) return;

        const groupsCount = model.groups.length;
        const squaresCount = model.groups.reduce((acc, group) => acc + (group.squares?.length || 0), 0);

        if (kpiGroupsEl) kpiGroupsEl.textContent = String(groupsCount);
        if (kpiSquaresEl) kpiSquaresEl.textContent = String(squaresCount);
        if (kpiEmployeesEl) kpiEmployeesEl.textContent = String(model.totalEmployeesCount);
        if (kpiAssignedEl) kpiAssignedEl.textContent = String(model.assignedEmployeesCount);
        if (kpiTotalWeightEl) kpiTotalWeightEl.textContent = formatNum(model.totalWeight);
    }

    function renderStatus(model) {
        const loadedAt = state.loadedAt
            ? new Date(state.loadedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
            : "—";

        statusLineEl.textContent = `Сотрудников: ${model.totalEmployeesCount} · групп: ${model.groups.length} · обновлено: ${loadedAt}`;
    }

    function renderAnalysisZone() {
        const selectedEmployees = state.analysisEmployeeIds
            .map((id) => getEmployeeById(id))
            .filter(Boolean);

        const chipsHtml = selectedEmployees.map((emp) => {
            const empId = getEmployeeId(emp) || "—";
            const empName = normalizeKey(emp?.linear_emp_name) || "Без имени";
            return `
                <span class="analysis-chip">
                    ${escapeHtml(`${empName} (${empId})`)}
                    <button type="button" data-role="analysis-remove" data-emp-id="${escapeHtml(empId)}">✕</button>
                </span>
            `;
        }).join("");

        analysisListEl.innerHTML = chipsHtml;
        const hasItems = selectedEmployees.length > 0;
        if (analysisCountEl) {
            analysisCountEl.textContent = `Добавлено: ${selectedEmployees.length} чел.`;
        }
        analysisEmptyEl.style.display = hasItems ? "none" : "";
        analysisDropZoneEl.classList.toggle("has-items", hasItems);
        balanceBtn.style.display = hasItems ? "" : "none";
        analysisClearBtn.style.display = hasItems ? "" : "none";
    }

    function renderGroups(model) {
        state.squareMap = new Map();

        if (!model.groups.length) {
            groupsWrapEl.innerHTML = "";
            groupsEmptyEl.style.display = "";
            return;
        }

        groupsEmptyEl.style.display = "none";

        const freeEmployees = getAvailableUnassignedEmployees();

        groupsWrapEl.innerHTML = model.groups.map((group) => {
            const squaresHtml = (group.squares || []).map((square) => {
                state.squareMap.set(square.sqKey, square);

                const isOpen = normalizeKey(state.activeAssignSquareKey) === normalizeKey(square.sqKey);
                const isFull = (square.employees || []).length >= 2;

                const employeesHtml = (square.employees || []).length
                    ? square.employees.map((emp) => {
                        const empId = getEmployeeId(emp) || "—";
                        const empName = normalizeKey(emp?.linear_emp_name) || empId;
                        const empPerf = formatNum(parseNumber(emp?.linear_emp_performance, 0));
                        return `
                            <button
                                type="button"
                                class="sq-emp-pill-btn"
                                data-role="unassign-square"
                                data-emp-id="${escapeHtml(empId)}"
                                title="Снять закрепление: ${escapeHtml(empName)}"
                            >
                                <span>${escapeHtml(`${empId} (${empPerf})`)}</span>
                                <span class="sq-emp-remove">✕</span>
                            </button>
                        `;
                    }).join("")
                    : '<span class="sq-empty">Нет сотрудников</span>';

                let assignPanelHtml = "";
                if (isOpen) {
                    if (isFull) {
                        assignPanelHtml = '<div class="empty-note">На этом КС уже 2 сотрудника.</div>';
                    } else if (!freeEmployees.length) {
                        assignPanelHtml = '<div class="empty-note">Свободных сотрудников нет.</div>';
                    } else {
                        const currentSelected = normalizeKey(state.activeAssignEmployeeId);
                        const selectedValue = freeEmployees.some((emp) => getEmployeeId(emp) === currentSelected)
                            ? currentSelected
                            : getEmployeeId(freeEmployees[0]);

                        state.activeAssignEmployeeId = selectedValue;

                        assignPanelHtml = `
                            <div class="sq-assign-panel">
                                <select class="input" data-role="assign-select" data-square-key="${escapeHtml(square.sqKey)}">
                                    ${freeEmployees.map((emp) => {
                                        const empId = getEmployeeId(emp) || "—";
                                        const empName = normalizeKey(emp?.linear_emp_name) || "Без имени";
                                        const perf = formatNum(parseNumber(emp?.linear_emp_performance, 0));
                                        const isSelected = empId === selectedValue;
                                        return `<option value="${escapeHtml(empId)}" ${isSelected ? "selected" : ""}>${escapeHtml(`${empName} (${empId}) ${perf}`)}</option>`;
                                    }).join("")}
                                </select>
                                <button type="button" class="btn btn-rect" data-role="assign-confirm" data-square-key="${escapeHtml(square.sqKey)}" title="Назначить">✔</button>
                                <button type="button" class="btn btn-outline" data-role="assign-cancel" data-square-key="${escapeHtml(square.sqKey)}" title="Закрыть">✕</button>
                            </div>
                        `;
                    }
                }

                const productivity = calcSquareProductivity(square.employees || []);
                const isInactiveSecondary = Boolean(square.isSecondary) && (square.employees || []).length === 0;
                const squareClasses = [
                    "sq-box",
                    isOpen ? "is-open" : "",
                    square.isSecondary ? "secondary" : "",
                    isInactiveSecondary ? "is-inactive-secondary" : ""
                ].filter(Boolean).join(" ");

                return `
                    <div class="sq-item">
                        <div
                            class="${squareClasses}"
                            data-role="sq-drop"
                            data-square-key="${escapeHtml(square.sqKey)}"
                            title="Нажмите для назначения"
                        >
                            ${employeesHtml}
                            <div class="sq-hint">${isFull ? "Лимит: 2/2" : "Нажмите или drop"}</div>
                        </div>
                        <p class="sq-caption">${escapeHtml(square.sqName || "—")}</p>
                        <p class="sq-productivity">Продуктивность: ${formatNum(productivity)}</p>
                        ${assignPanelHtml}
                    </div>
                `;
            }).join("");

            return `
                <article class="group-box">
                    <div class="group-squares">
                        ${squaresHtml}
                    </div>
                    <div class="group-footer">
                        <p class="group-title">Группа сортировки ${escapeHtml(group.groupKey)}</p>
                        <p class="group-weight">${formatNum(group.weight)}</p>
                    </div>
                </article>
            `;
        }).join("");
    }

    function renderEmployeesSidebar() {
        const q = normalizeKey(state.employeesSearchTerm).toLowerCase();

        const employees = (state.employees || [])
            .filter((emp) => {
                if (!q) return true;

                const empId = getEmployeeId(emp);
                const empName = normalizeKey(emp?.linear_emp_name);
                const perf = formatNum(parseNumber(emp?.linear_emp_performance, 0));
                const sq = normalizeKey(emp?.linear_emp_sq);
                const shifts = getShiftTokens(emp?.linear_emp_shift).join(" ");
                const hay = `${empName} ${empId} ${perf} ${sq} ${shifts}`.toLowerCase();
                return hay.includes(q);
            })
            .sort((a, b) => {
                const byName = normalizeKey(a?.linear_emp_name).localeCompare(normalizeKey(b?.linear_emp_name), "ru", { sensitivity: "base" });
                if (byName !== 0) return byName;
                return compareByKey(a?.linear_emp_id, b?.linear_emp_id);
            });

        if (!employees.length) {
            employeesListEl.innerHTML = "";
            employeesEmptyEl.style.display = "";
            refreshBulkUnassignButton();
            return;
        }

        employeesEmptyEl.style.display = "none";

        employeesListEl.innerHTML = employees.map((emp) => {
            const empId = getEmployeeId(emp) || "—";
            const empName = normalizeKey(emp?.linear_emp_name) || "Без имени";
            const perf = formatNum(parseNumber(emp?.linear_emp_performance, 0));
            const assignedSq = normalizeKey(emp?.linear_emp_sq);
            const shiftChips = renderEmployeeShiftChips(emp?.linear_emp_shift);
            const isSelected = state.selectedEmployeeIds.includes(empId);
            const isInAnalysis = state.analysisEmployeeIds.some((id) => normalizeKey(id) === empId);

            return `
                <div class="emp-item ${assignedSq ? "is-assigned" : ""} ${isInAnalysis ? "is-in-analysis" : ""} ${isSelected ? "is-selected" : ""}" data-role="emp-item" data-emp-id="${escapeHtml(empId)}">
                    <div class="emp-drag-handle" draggable="true" data-role="emp-drag-handle" data-emp-id="${escapeHtml(empId)}" title="Перетащить">⋮⋮</div>
                    <div class="emp-content">
                        <div class="emp-main">
                            <label class="emp-check-hit" data-role="emp-check-hit" data-emp-id="${escapeHtml(empId)}" title="Выбрать сотрудника">
                                <input class="emp-check" type="checkbox" data-role="emp-check" data-emp-id="${escapeHtml(empId)}" ${isSelected ? "checked" : ""}>
                            </label>
                            <span class="emp-name" title="${escapeHtml(empName)}">${escapeHtml(empName)}</span>
                        </div>
                        <div class="emp-bottom">
                            <span class="emp-perf">${escapeHtml(perf)}</span>
                            <div class="emp-actions">
                                <span class="emp-shift-tags">${shiftChips}</span>
                                ${assignedSq
                                    ? `<button type="button" class="btn btn-outline" data-role="unassign-right" data-emp-id="${escapeHtml(empId)}">Снять закрепление</button>`
                                    : ""}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        refreshBulkUnassignButton();
    }

    function render() {
        const model = createBaseModel();
        syncSelectedEmployees();

        if (state.activeAssignSquareKey && !model.groups.some((group) => group.squares.some((sq) => sq.sqKey === state.activeAssignSquareKey))) {
            state.activeAssignSquareKey = "";
            state.activeAssignEmployeeId = "";
        }

        state.currentModel = model;

        renderKpis(model);
        renderStatus(model);
        renderGroups(model);
        renderEmployeesSidebar();
        renderAnalysisZone();
    }

    function removeEmployeeFromAnalysis(empId) {
        const id = normalizeKey(empId);
        if (!id) return;
        state.analysisEmployeeIds = state.analysisEmployeeIds.filter((value) => normalizeKey(value) !== id);
        renderAnalysisZone();
        renderEmployeesSidebar();
    }

    function clearAnalysisSelection() {
        if (!state.analysisEmployeeIds.length) return;
        state.analysisEmployeeIds = [];
        renderAnalysisZone();
        renderEmployeesSidebar();
    }

    function addEmployeeToAnalysis(empId) {
        const id = normalizeKey(empId);
        if (!id) return;

        if (!getEmployeeById(id)) {
            toast("Сотрудник не найден", { type: "error" });
            return;
        }

        if (state.analysisEmployeeIds.some((value) => normalizeKey(value) === id)) {
            toast("Сотрудник уже добавлен в анализ", { type: "info" });
            return;
        }

        state.analysisEmployeeIds.push(id);
        renderAnalysisZone();
        renderEmployeesSidebar();
    }

    function addEmployeesToAnalysis(empIdsRaw) {
        const empIds = getUniqueEmployeeIds(empIdsRaw);
        if (!empIds.length) return;

        let added = 0;
        let skipped = 0;
        let missing = 0;

        empIds.forEach((id) => {
            if (!getEmployeeById(id)) {
                missing += 1;
                return;
            }
            if (state.analysisEmployeeIds.some((value) => normalizeKey(value) === id)) {
                skipped += 1;
                return;
            }
            state.analysisEmployeeIds.push(id);
            added += 1;
        });

        renderAnalysisZone();
        renderEmployeesSidebar();

        if (!added && skipped && !missing) {
            toast("Выбранные сотрудники уже добавлены в анализ", { type: "info" });
        } else if (!added && missing) {
            toast("Не удалось добавить сотрудников в анализ", { type: "error" });
        }
    }

    function getDraggedEmployeeIds(event, fallbackEmpId = "") {
        const payloadJson = normalizeKey(event?.dataTransfer?.getData("application/json"));
        if (payloadJson) {
            try {
                const parsed = JSON.parse(payloadJson);
                if (Array.isArray(parsed?.empIds)) {
                    const ids = getUniqueEmployeeIds(parsed.empIds);
                    if (ids.length) return ids;
                }
            } catch (_) {}
        }

        const payloadPlain = normalizeKey(event?.dataTransfer?.getData("text/plain"));
        if (payloadPlain.includes(",")) {
            const fromPlain = getUniqueEmployeeIds(payloadPlain.split(","));
            if (fromPlain.length) return fromPlain;
        }
        if (payloadPlain) return [payloadPlain];

        const fallbackIds = getUniqueEmployeeIds(state.draggingEmpIds);
        if (fallbackIds.length) return fallbackIds;

        const fallback = normalizeKey(fallbackEmpId);
        if (fallback) return [fallback];

        return [];
    }

    function setEmployeeIdReadonly(isReadonly) {
        employeeCreateIdEl.readOnly = isReadonly;
        employeeCreateIdEl.style.background = isReadonly ? "#eef2f7" : "";
        employeeCreateIdEl.style.color = isReadonly ? "#64748b" : "";
        employeeCreateIdEl.style.cursor = isReadonly ? "not-allowed" : "";
    }

    function getEmployeeFormTriplet() {
        const values = [
            parseNonNegativeInt(employeeCreatePerformance1El.value),
            parseNonNegativeInt(employeeCreatePerformance2El.value),
            parseNonNegativeInt(employeeCreatePerformance3El.value)
        ];

        if (values.some((v) => v === null)) return null;
        return values;
    }

    function updateEmployeePerformancePreview() {
        const triplet = getEmployeeFormTriplet();
        if (!triplet) {
            employeeCreatePerformanceAvgEl.textContent = "Средняя выработка: —";
            return;
        }
        employeeCreatePerformanceAvgEl.textContent = `Средняя выработка: ${formatNum(calcAveragePerformance(triplet))}`;
    }

    function openEmployeeCreateModal() {
        if (state.isLoading || state.isAssigning || state.isSavingBalance || state.isCreatingEmployee) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        state.employeeFormMode = "create";
        state.employeeEditTargetId = "";

        employeeFormTitleEl.textContent = "Добавить сотрудника";
        employeeCreateIdEl.value = "";
        employeeCreateNameEl.value = "";
        employeeCreateShiftEl.value = "День";
        employeeCreatePerformance1El.value = "";
        employeeCreatePerformance2El.value = "";
        employeeCreatePerformance3El.value = "";
        setEmployeeIdReadonly(false);
        updateEmployeePerformancePreview();

        employeeCreateModalEl.classList.remove("hidden");
        setTimeout(() => employeeCreateIdEl.focus(), 0);
    }

    function openEmployeeEditModal(empIdRaw) {
        if (state.isLoading || state.isAssigning || state.isSavingBalance || state.isCreatingEmployee) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        const empId = normalizeKey(empIdRaw);
        const employee = getEmployeeById(empId);
        if (!employee) {
            toast("Сотрудник не найден", { type: "error" });
            return;
        }

        state.employeeFormMode = "edit";
        state.employeeEditTargetId = empId;

        const perfTriplet = getEmployeePerformanceTriplet(employee);

        employeeFormTitleEl.textContent = "Редактировать сотрудника";
        employeeCreateIdEl.value = empId;
        employeeCreateNameEl.value = normalizeKey(employee?.linear_emp_name);
        const shiftValue = normalizeKey(employee?.linear_emp_shift);
        employeeCreateShiftEl.value = ["День", "Ночь"].includes(shiftValue) ? shiftValue : "День";
        employeeCreatePerformance1El.value = String(perfTriplet[0]);
        employeeCreatePerformance2El.value = String(perfTriplet[1]);
        employeeCreatePerformance3El.value = String(perfTriplet[2]);
        setEmployeeIdReadonly(true);
        updateEmployeePerformancePreview();

        employeeCreateModalEl.classList.remove("hidden");
        setTimeout(() => employeeCreateNameEl.focus(), 0);
    }

    function closeEmployeeCreateModal() {
        employeeCreateModalEl.classList.add("hidden");
        state.employeeFormMode = "create";
        state.employeeEditTargetId = "";
        setEmployeeIdReadonly(false);
    }

    function makeEmployeePayload({ name, shift, avgPerf, perfTriplet }) {
        const payload = {
            linear_emp_name: name,
            linear_emp_shift: shift,
            linear_emp_performance: avgPerf,
            [EMPLOYEE_PERF_FIELDS[0]]: perfTriplet[0],
            [EMPLOYEE_PERF_FIELDS[1]]: perfTriplet[1],
            [EMPLOYEE_PERF_FIELDS[2]]: perfTriplet[2]
        };
        return payload;
    }

    async function createEmployee() {
        if (state.isCreatingEmployee || state.isLoading || state.isAssigning || state.isSavingBalance) {
            toast("Сейчас выполняется другая операция", { type: "info" });
            return;
        }

        const isEdit = state.employeeFormMode === "edit";
        const rawId = normalizeKey(employeeCreateIdEl.value);
        const name = normalizeKey(employeeCreateNameEl.value);
        const shift = normalizeKey(employeeCreateShiftEl.value) || "День";
        const perfTriplet = getEmployeeFormTriplet();

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
        if (!["День", "Ночь"].includes(shift)) {
            toast("Смена должна быть День или Ночь", { type: "error" });
            return;
        }
        if (!perfTriplet) {
            toast("Заполните выработку за 3 смены целыми числами", { type: "error" });
            return;
        }

        const avgPerf = calcAveragePerformance(perfTriplet);

        if (isEdit) {
            if (normalizeKey(state.employeeEditTargetId) !== rawId) {
                toast("ID сотрудника в режиме редактирования менять нельзя", { type: "error" });
                return;
            }
        } else {
            const exists = (state.employees || []).some((emp) => getEmployeeId(emp) === rawId);
            if (exists) {
                toast(`Сотрудник с ID ${rawId} уже существует`, { type: "error" });
                return;
            }
        }

        setCreatingEmployeeState(true);

        try {
            const payload = makeEmployeePayload({ name, shift, avgPerf, perfTriplet });

            let error = null;
            if (isEdit) {
                const employee = getEmployeeById(rawId);
                if (!employee) throw new Error("Сотрудник не найден");

                const fullUpdate = await supabaseClient
                    .from("linear_emp_rep")
                    .update(payload)
                    .eq("wh_id", state.currentWhId)
                    .eq("linear_emp_id", employee.linear_emp_id);

                error = fullUpdate.error || null;
                const errorMsg = String(error?.message || "").toLowerCase();

                if (error && EMPLOYEE_PERF_FIELDS.some((field) => errorMsg.includes(field.toLowerCase()))) {
                    const fallbackPayload = {
                        linear_emp_name: name,
                        linear_emp_shift: shift,
                        linear_emp_performance: avgPerf
                    };

                    const fallbackUpdate = await supabaseClient
                        .from("linear_emp_rep")
                        .update(fallbackPayload)
                        .eq("wh_id", state.currentWhId)
                        .eq("linear_emp_id", employee.linear_emp_id);

                    error = fallbackUpdate.error || null;
                }
            } else {
                const createPayload = {
                    ...payload,
                    linear_emp_id: Number(rawId),
                    linear_emp_sq: null,
                    wh_id: state.currentWhId
                };

                const fullInsert = await supabaseClient
                    .from("linear_emp_rep")
                    .insert(createPayload);

                error = fullInsert.error || null;
                const errorMsg = String(error?.message || "").toLowerCase();

                if (error && EMPLOYEE_PERF_FIELDS.some((field) => errorMsg.includes(field.toLowerCase()))) {
                    const fallbackPayload = {
                        linear_emp_id: Number(rawId),
                        linear_emp_name: name,
                        linear_emp_shift: shift,
                        linear_emp_performance: avgPerf,
                        linear_emp_sq: null,
                        wh_id: state.currentWhId
                    };

                    const fallbackInsert = await supabaseClient
                        .from("linear_emp_rep")
                        .insert(fallbackPayload);

                    error = fallbackInsert.error || null;
                }
            }

            if (error) {
                throw new Error(error.message || "Ошибка сохранения сотрудника");
            }

            closeEmployeeCreateModal();
            await loadData();
            toast(isEdit ? "Сотрудник обновлен" : "Сотрудник добавлен", { type: "success" });
        } catch (error) {
            console.error("Ошибка сохранения сотрудника:", error);
            toast(`Не удалось сохранить сотрудника: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setCreatingEmployeeState(false);
        }
    }

    async function clearEmployeeAssignment(empIdRaw) {
        const empId = normalizeKey(empIdRaw);
        if (!empId) return;

        if (state.isAssigning || state.isSavingBalance) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        const employee = getEmployeeById(empId);
        if (!employee) {
            toast("Сотрудник не найден", { type: "error" });
            return;
        }

        if (!normalizeKey(employee.linear_emp_sq)) {
            toast("Сотрудник уже без закрепления", { type: "info" });
            return;
        }

        setAssigningState(true);
        try {
            const { error } = await supabaseClient
                .from("linear_emp_rep")
                .update({ linear_emp_sq: null })
                .eq("wh_id", state.currentWhId)
                .eq("linear_emp_id", employee.linear_emp_id);

            if (error) throw new Error(error.message || "Ошибка снятия закрепления");

            employee.linear_emp_sq = null;
            state.loadedAt = Date.now();
            render();
            toast(`Закрепление снято: ${empId}`, { type: "success" });
        } catch (error) {
            console.error("Ошибка снятия закрепления:", error);
            toast(`Не удалось снять закрепление: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setAssigningState(false);
        }
    }

    async function clearSelectedEmployeesAssignments() {
        syncSelectedEmployees();

        const selectedIds = getUniqueEmployeeIds(state.selectedEmployeeIds);
        if (!selectedIds.length) return;

        if (state.isAssigning || state.isSavingBalance || state.isLoading) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        const selectedEmployees = selectedIds
            .map((id) => getEmployeeById(id))
            .filter(Boolean);

        const assignedEmployees = selectedEmployees.filter((employee) => normalizeKey(employee?.linear_emp_sq));
        if (!assignedEmployees.length) {
            toast("У выбранных сотрудников нет закреплений", { type: "info" });
            return;
        }

        setAssigningState(true);
        try {
            const dbIds = assignedEmployees.map((employee) => employee.linear_emp_id);
            const { error } = await supabaseClient
                .from("linear_emp_rep")
                .update({ linear_emp_sq: null })
                .eq("wh_id", state.currentWhId)
                .in("linear_emp_id", dbIds);

            if (error) throw new Error(error.message || "Ошибка снятия закреплений");

            assignedEmployees.forEach((employee) => {
                employee.linear_emp_sq = null;
            });

            state.loadedAt = Date.now();
            render();
            toast(`Снято закреплений: ${assignedEmployees.length}`, { type: "success" });
        } catch (error) {
            console.error("Ошибка массового снятия закреплений:", error);
            toast(`Не удалось снять закрепления: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setAssigningState(false);
        }
    }

    async function assignEmployeesToSquare(empIdsRaw, squareKeyRaw) {
        const empIds = getUniqueEmployeeIds(Array.isArray(empIdsRaw) ? empIdsRaw : [empIdsRaw]);
        const squareKey = normalizeKey(squareKeyRaw);

        if (!empIds.length || !squareKey) return;

        if (state.isAssigning || state.isSavingBalance) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        const square = getSquareByKey(squareKey);
        if (!square) {
            toast("КС не найден", { type: "error" });
            return;
        }

        if (!square.assignTarget) {
            toast("У КС отсутствует идентификатор назначения", { type: "error" });
            return;
        }

        const freeSlots = Math.max(0, 2 - (square.employees || []).length);
        if (freeSlots <= 0) {
            toast("На одном КС может быть не более 2 сотрудников", { type: "error" });
            return;
        }

        if (empIds.length > freeSlots) {
            toast(`На КС доступно только ${freeSlots} мест(а)`, { type: "error" });
            return;
        }

        const employees = empIds.map((empId) => getEmployeeById(empId)).filter(Boolean);
        if (employees.length !== empIds.length) {
            toast("Часть выбранных сотрудников не найдена", { type: "error" });
            return;
        }

        const assignedAlready = employees.find((employee) => normalizeKey(employee.linear_emp_sq));
        if (assignedAlready) {
            const id = getEmployeeId(assignedAlready);
            toast(`Сотрудник ${id} уже закреплён на КС`, { type: "error" });
            return;
        }

        setAssigningState(true);
        try {
            for (const employee of employees) {
                const { error } = await supabaseClient
                    .from("linear_emp_rep")
                    .update({ linear_emp_sq: square.assignTarget })
                    .eq("wh_id", state.currentWhId)
                    .eq("linear_emp_id", employee.linear_emp_id);

                if (error) throw new Error(`Сотрудник ${getEmployeeId(employee)}: ${error.message || "Ошибка назначения"}`);

                employee.linear_emp_sq = square.assignTarget;
            }

            state.loadedAt = Date.now();
            state.activeAssignSquareKey = "";
            state.activeAssignEmployeeId = "";

            render();
            if (employees.length === 1) {
                toast(`Сотрудник ${getEmployeeId(employees[0])} закреплён на КС ${square.sqName || square.sqId}`, { type: "success" });
            } else {
                toast(`Закреплено ${employees.length} сотрудников на КС ${square.sqName || square.sqId}`, { type: "success" });
            }
        } catch (error) {
            console.error("Ошибка назначения сотрудника:", error);
            toast(`Не удалось закрепить сотрудника: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setAssigningState(false);
        }
    }

    async function assignEmployeeToSquare(empIdRaw, squareKeyRaw) {
        await assignEmployeesToSquare([empIdRaw], squareKeyRaw);
    }

    function allocateGroupTargets(totalEmployees, groupsWithCapacity) {
        const result = new Map();
        if (!totalEmployees || !groupsWithCapacity.length) {
            groupsWithCapacity.forEach((g) => result.set(g.groupKey, 0));
            return result;
        }

        const totalWeight = groupsWithCapacity.reduce((acc, g) => acc + Math.max(0, parseNumber(g.weight, 0)), 0);
        const useEqual = totalWeight <= 0;

        const raw = groupsWithCapacity.map((g) => {
            const w = useEqual ? 1 : Math.max(0, parseNumber(g.weight, 0));
            const value = totalEmployees * (w / (useEqual ? groupsWithCapacity.length : totalWeight));
            return {
                groupKey: g.groupKey,
                capacity: g.capacity,
                raw: value,
                frac: value - Math.floor(value)
            };
        });

        let allocated = 0;
        raw.forEach((item) => {
            const base = Math.min(item.capacity, Math.floor(item.raw));
            result.set(item.groupKey, base);
            allocated += base;
        });

        let remaining = totalEmployees - allocated;

        raw
            .slice()
            .sort((a, b) => b.frac - a.frac || compareByKey(a.groupKey, b.groupKey))
            .forEach((item) => {
                if (remaining <= 0) return;
                const cur = result.get(item.groupKey) || 0;
                if (cur >= item.capacity) return;
                result.set(item.groupKey, cur + 1);
                remaining -= 1;
            });

        if (remaining > 0) {
            raw
                .slice()
                .sort((a, b) => compareByKey(a.groupKey, b.groupKey))
                .forEach((item) => {
                    while (remaining > 0) {
                        const cur = result.get(item.groupKey) || 0;
                        if (cur >= item.capacity) break;
                        result.set(item.groupKey, cur + 1);
                        remaining -= 1;
                    }
                });
        }

        return result;
    }

    function buildBalanceProposal() {
        const baseModel = createBaseModel();
        const selectedIds = state.analysisEmployeeIds.map((id) => normalizeKey(id)).filter(Boolean);
        const selectedSet = new Set(selectedIds);

        const selectedEmployees = selectedIds
            .map((id) => getEmployeeById(id))
            .filter(Boolean)
            .map((emp) => ({
                id: getEmployeeId(emp),
                perf: parseNumber(emp?.linear_emp_performance, 0),
                source: emp
            }));

        if (!selectedEmployees.length) {
            return {
                baseModel,
                assignments: new Map(),
                bySquare: new Map(),
                unplaced: [],
                selectedCount: 0
            };
        }

        const squareStates = [];
        const groupMeta = new Map();

        baseModel.groups.forEach((group) => {
            if (!groupMeta.has(group.groupKey)) {
                groupMeta.set(group.groupKey, {
                    groupKey: group.groupKey,
                    weight: group.weight,
                    capacity: 0,
                    primaryCapacity: 0,
                    perf: 0,
                    remainingTarget: 0,
                    remainingCapacity: 0,
                    remainingPrimary: 0,
                    assignedEmployees: []
                });
            }

            group.squares.forEach((square) => {
                const fixed = (square.employees || []).filter((emp) => !selectedSet.has(getEmployeeId(emp)));
                const fixedPerf = fixed.reduce((acc, emp) => acc + parseNumber(emp?.linear_emp_performance, 0), 0);
                const remainingSlots = Math.max(0, 2 - fixed.length);

                const stateSquare = {
                    sqKey: square.sqKey,
                    groupKey: group.groupKey,
                    assignTarget: square.assignTarget,
                    isSecondary: Boolean(square.isSecondary),
                    remainingSlots,
                    projectedPerf: fixedPerf,
                    assigned: []
                };

                squareStates.push(stateSquare);

                const meta = groupMeta.get(group.groupKey);
                meta.capacity += remainingSlots;
                if (!stateSquare.isSecondary) {
                    meta.primaryCapacity += remainingSlots;
                }
                meta.perf += fixedPerf;
            });
        });

        const totalCapacity = squareStates.reduce((acc, sq) => acc + sq.remainingSlots, 0);
        const assignableCount = Math.min(selectedEmployees.length, totalCapacity);

        const groupTargets = allocateGroupTargets(assignableCount, Array.from(groupMeta.values()));
        groupMeta.forEach((meta) => {
            meta.remainingTarget = groupTargets.get(meta.groupKey) || 0;
            meta.remainingCapacity = meta.capacity;
            meta.remainingPrimary = meta.primaryCapacity;
            meta.assignedEmployees = [];
        });

        const sorted = [...selectedEmployees].sort((a, b) => a.perf - b.perf || compareByKey(a.id, b.id));
        const pairs = [];
        let left = 0;
        let right = sorted.length - 1;
        while (left <= right) {
            if (left === right) {
                pairs.push([sorted[left]]);
            } else {
                pairs.push([sorted[left], sorted[right]]);
            }
            left += 1;
            right -= 1;
        }

        const assignments = new Map();
        const unplacedSet = new Set();

        function chooseGroupForPair(requiredSlots) {
            const groups = Array.from(groupMeta.values())
                .filter((meta) => meta.remainingTarget >= requiredSlots)
                .filter((meta) => meta.remainingCapacity >= requiredSlots)
                .sort((a, b) => (b.remainingPrimary - a.remainingPrimary) || (b.remainingTarget - a.remainingTarget) || (parseNumber(b.weight, 0) - parseNumber(a.weight, 0)) || (a.perf - b.perf) || compareByKey(a.groupKey, b.groupKey));

            return groups[0] || null;
        }

        function chooseGroupForSingle() {
            const groupsWithTarget = Array.from(groupMeta.values())
                .filter((meta) => meta.remainingTarget > 0)
                .filter((meta) => meta.remainingCapacity > 0)
                .sort((a, b) => (b.remainingPrimary - a.remainingPrimary) || (b.remainingTarget - a.remainingTarget) || (parseNumber(b.weight, 0) - parseNumber(a.weight, 0)) || (a.perf - b.perf) || compareByKey(a.groupKey, b.groupKey));

            if (groupsWithTarget[0]) return groupsWithTarget[0];

            const fallback = Array.from(groupMeta.values())
                .filter((meta) => meta.remainingCapacity > 0)
                .sort((a, b) => (b.remainingPrimary - a.remainingPrimary) || (parseNumber(b.weight, 0) - parseNumber(a.weight, 0)) || (a.perf - b.perf) || compareByKey(a.groupKey, b.groupKey));

            return fallback[0] || null;
        }

        function assignToGroup(empObj, targetMeta) {
            if (!targetMeta || !empObj) return false;
            if (targetMeta.remainingCapacity <= 0) return false;

            targetMeta.remainingCapacity -= 1;
            if (targetMeta.remainingPrimary > 0) {
                targetMeta.remainingPrimary -= 1;
            }
            targetMeta.perf += empObj.perf;
            if (targetMeta.remainingTarget > 0) targetMeta.remainingTarget -= 1;
            targetMeta.assignedEmployees.push(empObj);
            return true;
        }

        pairs.forEach((pair) => {
            if (pair.length === 2) {
                const group = chooseGroupForPair(2);
                if (group && assignToGroup(pair[0], group) && assignToGroup(pair[1], group)) {
                    return;
                }
            }

            pair.forEach((empObj) => {
                const group = chooseGroupForSingle();
                if (!group) {
                    unplacedSet.add(empObj.id);
                    return;
                }

                const ok = assignToGroup(empObj, group);
                if (!ok) unplacedSet.add(empObj.id);
            });
        });

        function scoreSquarePlacement(groupSquares, candidateSquare, empPerf) {
            const totals = groupSquares.map((sq) => sq.projectedPerf + (sq === candidateSquare ? empPerf : 0));
            const maxTotal = Math.max(...totals);
            const minTotal = Math.min(...totals);
            const spread = maxTotal - minTotal;
            const sum = totals.reduce((acc, value) => acc + value, 0);
            const mean = totals.length ? sum / totals.length : 0;
            const variance = totals.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0);
            const targetTotal = candidateSquare.projectedPerf + empPerf;

            return { spread, variance, targetTotal };
        }

        groupMeta.forEach((meta) => {
            const groupSquares = squareStates.filter((sq) => sq.groupKey === meta.groupKey);
            if (!groupSquares.length) {
                (meta.assignedEmployees || []).forEach((empObj) => unplacedSet.add(empObj.id));
                return;
            }

            const plannedForGroup = [...(meta.assignedEmployees || [])]
                .sort((a, b) => b.perf - a.perf || compareByKey(a.id, b.id));

            plannedForGroup.forEach((empObj) => {
                const candidates = groupSquares.filter((sq) => sq.remainingSlots > 0 && normalizeKey(sq.assignTarget));
                if (!candidates.length) {
                    unplacedSet.add(empObj.id);
                    return;
                }

                const primaryCandidates = candidates.filter((sq) => !sq.isSecondary);
                const effectiveCandidates = primaryCandidates.length ? primaryCandidates : candidates;

                const bestSquare = effectiveCandidates
                    .slice()
                    .sort((a, b) => {
                        const scoreA = scoreSquarePlacement(groupSquares, a, empObj.perf);
                        const scoreB = scoreSquarePlacement(groupSquares, b, empObj.perf);

                        if (scoreA.spread !== scoreB.spread) return scoreA.spread - scoreB.spread;
                        if (scoreA.variance !== scoreB.variance) return scoreA.variance - scoreB.variance;
                        if (scoreA.targetTotal !== scoreB.targetTotal) return scoreA.targetTotal - scoreB.targetTotal;
                        if (b.remainingSlots !== a.remainingSlots) return b.remainingSlots - a.remainingSlots;
                        return compareByKey(a.sqKey, b.sqKey);
                    })[0];

                if (!bestSquare) {
                    unplacedSet.add(empObj.id);
                    return;
                }

                bestSquare.remainingSlots -= 1;
                bestSquare.projectedPerf += empObj.perf;
                bestSquare.assigned.push(empObj);
                assignments.set(empObj.id, bestSquare.assignTarget);
            });
        });

        const bySquare = new Map();
        squareStates.forEach((sq) => {
            bySquare.set(sq.sqKey, sq.assigned.map((item) => item.id));
        });

        const unplaced = Array.from(unplacedSet.values());

        return {
            baseModel,
            assignments,
            bySquare,
            unplaced,
            selectedCount: selectedEmployees.length
        };
    }

    function renderBalanceModalScheme(proposal) {
        const selectedSet = new Set(state.analysisEmployeeIds.map((id) => normalizeKey(id)));

        const groupsHtml = proposal.baseModel.groups.map((group) => {
            const squaresHtml = (group.squares || []).map((square) => {
                const fixed = (square.employees || [])
                    .filter((emp) => !selectedSet.has(getEmployeeId(emp)))
                    .map((emp) => ({
                        id: getEmployeeId(emp) || "—",
                        name: normalizeKey(emp?.linear_emp_name),
                        perf: parseNumber(emp?.linear_emp_performance, 0),
                        proposed: false
                    }));

                const proposedIds = proposal.bySquare.get(square.sqKey) || [];
                const proposedItems = proposedIds
                    .map((empId) => getEmployeeById(empId))
                    .filter(Boolean)
                    .map((emp) => ({
                        id: getEmployeeId(emp) || "—",
                        name: normalizeKey(emp?.linear_emp_name),
                        perf: parseNumber(emp?.linear_emp_performance, 0),
                        proposed: true
                    }));

                const combined = fixed.concat(proposedItems);
                const productivity = combined.reduce((acc, item) => acc + parseNumber(item?.perf, 0), 0);

                const pills = combined.length
                    ? combined.map((item) => {
                        const perf = formatNum(parseNumber(item?.perf, 0));
                        return `
                            <span class="sq-emp-pill-btn ${item.proposed ? "proposed" : ""}" title="${escapeHtml(item.name || item.id)}">
                                <span>${escapeHtml(`${item.id} (${perf})`)}</span>
                            </span>
                        `;
                    }).join("")
                    : '<span class="sq-empty">Нет сотрудников</span>';

                const isInactiveSecondary = Boolean(square.isSecondary) && combined.length === 0;
                const proposedClass = [
                    square.isSecondary ? "secondary" : "",
                    proposedItems.length ? "proposed" : "",
                    isInactiveSecondary ? "is-inactive-secondary" : ""
                ].filter(Boolean).join(" ");

                return `
                    <div class="sq-item">
                        <div class="sq-box ${proposedClass}">
                            ${pills}
                            <div class="sq-hint">${combined.length >= 2 ? "Лимит: 2/2" : ""}</div>
                        </div>
                        <p class="sq-caption">${escapeHtml(square.sqName || "—")}</p>
                        <p class="sq-productivity">Продуктивность: ${formatNum(productivity)}</p>
                    </div>
                `;
            }).join("");

            return `
                <article class="group-box">
                    <div class="group-squares">
                        ${squaresHtml}
                    </div>
                    <div class="group-footer">
                        <p class="group-title">Группа сортировки ${escapeHtml(group.groupKey)}</p>
                        <p class="group-weight">${formatNum(group.weight)}</p>
                    </div>
                </article>
            `;
        }).join("");

        balanceModalSchemeEl.innerHTML = groupsHtml;

        const unplacedCount = proposal.unplaced.length;
        if (unplacedCount > 0) {
            balanceModalStatusEl.textContent = `Распределено не полностью: ${unplacedCount} сотрудников не удалось поставить (ограничение 2 сотрудника на КС).`;
        } else {
            balanceModalStatusEl.textContent = "Распределение готово. Зеленым показаны новые назначения из анализа.";
        }
    }

    function openBalanceModal() {
        const selectedEmployees = state.analysisEmployeeIds
            .map((id) => getEmployeeById(id))
            .filter(Boolean);

        if (!selectedEmployees.length) {
            toast("Добавьте сотрудников для анализа", { type: "info" });
            return;
        }

        const proposal = buildBalanceProposal();
        state.balanceProposal = proposal;
        renderBalanceModalScheme(proposal);

        balanceModalEl.classList.remove("hidden");
    }

    function closeBalanceModal(resetProposal = true) {
        balanceModalEl.classList.add("hidden");
        if (resetProposal) {
            state.balanceProposal = null;
            balanceModalSchemeEl.innerHTML = "";
            balanceModalStatusEl.textContent = "";
        }
    }

    async function saveBalanceProposal() {
        const proposal = state.balanceProposal;
        if (!proposal || !proposal.assignments || proposal.assignments.size === 0) {
            toast("Нет рассчитанных назначений для сохранения", { type: "info" });
            closeBalanceModal(true);
            return;
        }

        if (state.isSavingBalance || state.isAssigning || state.isLoading) {
            toast("Сейчас выполняется другая операция", { type: "info" });
            return;
        }

        setSavingBalanceState(true);

        try {
            const entries = Array.from(proposal.assignments.entries());

            for (const [empId, targetSq] of entries) {
                const employee = getEmployeeById(empId);
                if (!employee) continue;

                const { error } = await supabaseClient
                    .from("linear_emp_rep")
                    .update({ linear_emp_sq: targetSq })
                    .eq("wh_id", state.currentWhId)
                    .eq("linear_emp_id", employee.linear_emp_id);

                if (error) {
                    throw new Error(`Сотрудник ${empId}: ${error.message}`);
                }

                employee.linear_emp_sq = targetSq;
            }

            state.loadedAt = Date.now();
            state.analysisEmployeeIds = [];
            state.activeAssignSquareKey = "";
            state.activeAssignEmployeeId = "";

            closeBalanceModal(true);
            render();
            toast("Расстановка сохранена", { type: "success" });
        } catch (error) {
            console.error("Ошибка сохранения расстановки:", error);
            toast(`Не удалось сохранить расстановку: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setSavingBalanceState(false);
        }
    }

    async function loadSquaresWithSecondaryFallback() {
        const withSecondary = await supabaseClient
            .from("sort_squares_rep")
            .select("sq_id, sq_name, sq_group, wh_id, is_secondary")
            .eq("wh_id", state.currentWhId);

        if (!withSecondary.error) {
            return Array.isArray(withSecondary.data) ? withSecondary.data : [];
        }

        const err = withSecondary.error || {};
        const errMsg = normalizeKey(err.message).toLowerCase();
        const errDetails = normalizeKey(err.details).toLowerCase();
        const errCode = normalizeKey(err.code).toUpperCase();
        const missingSecondaryColumn = errCode === "PGRST204" || errCode === "42703" || errMsg.includes("is_secondary") || errDetails.includes("is_secondary");

        if (!missingSecondaryColumn) {
            throw new Error(`sort_squares_rep: ${err.message || "Неизвестная ошибка"}`);
        }

        const fallback = await supabaseClient
            .from("sort_squares_rep")
            .select("sq_id, sq_name, sq_group, wh_id")
            .eq("wh_id", state.currentWhId);

        if (fallback.error) {
            throw new Error(`sort_squares_rep: ${fallback.error.message}`);
        }

        const rows = Array.isArray(fallback.data) ? fallback.data : [];
        return rows.map((row) => ({ ...row, is_secondary: 0 }));
    }

    async function loadData() {
        setLoadingState(true);

        try {
            const [squaresRows, groupsRes, employeesRes] = await Promise.all([
                loadSquaresWithSecondaryFallback(),
                supabaseClient
                    .from("sort_groups_rep")
                    .select("sort_group, weight, wh_id")
                    .eq("wh_id", state.currentWhId),
                supabaseClient
                    .from("linear_emp_rep")
                    .select("*")
                    .eq("wh_id", state.currentWhId)
            ]);

            if (groupsRes.error) throw new Error(`sort_groups_rep: ${groupsRes.error.message}`);
            if (employeesRes.error) throw new Error(`linear_emp_rep: ${employeesRes.error.message}`);

            state.squares = Array.isArray(squaresRows) ? squaresRows : [];
            state.groups = Array.isArray(groupsRes.data) ? groupsRes.data : [];
            state.employees = Array.isArray(employeesRes.data) ? employeesRes.data : [];
            state.loadedAt = Date.now();
            syncSelectedEmployees();
            state.draggingEmpIds = [];

            state.activeAssignSquareKey = "";
            state.activeAssignEmployeeId = "";
            state.analysisEmployeeIds = state.analysisEmployeeIds.filter((id) => Boolean(getEmployeeById(id)));
            state.balanceProposal = null;

            render();
        } catch (error) {
            console.error("Ошибка загрузки данных:", error);
            statusLineEl.textContent = "Не удалось загрузить данные. Проверьте таблицы и поля Supabase.";
            groupsWrapEl.innerHTML = "";
            groupsEmptyEl.style.display = "";
            employeesListEl.innerHTML = "";
            employeesEmptyEl.style.display = "";
            toast(`Ошибка загрузки данных: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setLoadingState(false);
        }
    }

    function bindGroupsEvents() {
        groupsWrapEl.addEventListener("click", (event) => {
            const unassignBtn = event.target.closest('[data-role="unassign-square"]');
            if (unassignBtn) {
                clearEmployeeAssignment(unassignBtn.dataset.empId);
                return;
            }

            const cancelBtn = event.target.closest('[data-role="assign-cancel"]');
            if (cancelBtn) {
                state.activeAssignSquareKey = "";
                state.activeAssignEmployeeId = "";
                render();
                return;
            }

            const confirmBtn = event.target.closest('[data-role="assign-confirm"]');
            if (confirmBtn) {
                const squareKey = confirmBtn.dataset.squareKey;
                const empId = state.activeAssignEmployeeId;
                if (!empId) {
                    toast("Выберите сотрудника", { type: "info" });
                    return;
                }
                assignEmployeeToSquare(empId, squareKey);
                return;
            }

            const sqBox = event.target.closest('[data-role="sq-drop"]');
            if (!sqBox) return;

            const squareKey = normalizeKey(sqBox.dataset.squareKey);
            if (!squareKey) return;

            const square = getSquareByKey(squareKey);
            if (!square) return;

            if ((square.employees || []).length >= 2) {
                toast("На одном КС может быть не более 2 сотрудников", { type: "error" });
                return;
            }

            const freeEmployees = getAvailableUnassignedEmployees();
            if (!freeEmployees.length) {
                toast("Нет свободных сотрудников для назначения", { type: "info" });
                return;
            }

            if (state.activeAssignSquareKey === squareKey) {
                state.activeAssignSquareKey = "";
                state.activeAssignEmployeeId = "";
            } else {
                state.activeAssignSquareKey = squareKey;
                state.activeAssignEmployeeId = getEmployeeId(freeEmployees[0]);
            }

            render();
        });

        groupsWrapEl.addEventListener("change", (event) => {
            const select = event.target.closest('[data-role="assign-select"]');
            if (!select) return;
            state.activeAssignEmployeeId = normalizeKey(select.value);
        });

        groupsWrapEl.addEventListener("dragover", (event) => {
            const sqBox = event.target.closest('[data-role="sq-drop"]');
            if (!sqBox) return;
            event.preventDefault();
            sqBox.classList.add("is-drop-target");
        });

        groupsWrapEl.addEventListener("dragleave", (event) => {
            const sqBox = event.target.closest('[data-role="sq-drop"]');
            if (!sqBox) return;
            sqBox.classList.remove("is-drop-target");
        });

        groupsWrapEl.addEventListener("drop", (event) => {
            const sqBox = event.target.closest('[data-role="sq-drop"]');
            if (!sqBox) return;

            event.preventDefault();
            sqBox.classList.remove("is-drop-target");

            const squareKey = normalizeKey(sqBox.dataset.squareKey);
            const draggedIds = getDraggedEmployeeIds(event);

            if (!draggedIds.length) {
                toast("Не удалось определить сотрудника для назначения", { type: "error" });
                return;
            }

            assignEmployeesToSquare(draggedIds, squareKey);
        });
    }

    function bindEmployeesEvents() {
        employeesListEl.addEventListener("mousedown", (event) => {
            const checkboxTarget = event.target.closest('[data-role="emp-check"], [data-role="emp-check-hit"]');
            if (!checkboxTarget) return;
            if (event.button !== 0) return;

            event.preventDefault();

            const empId = normalizeKey(checkboxTarget.dataset.empId);
            if (!empId) return;

            const targetValue = !state.selectedEmployeeIds.includes(empId);
            state.checkboxDragActive = true;
            state.checkboxDragValue = targetValue;
            setEmployeeSelection(empId, targetValue, true);
        });

        employeesListEl.addEventListener("mouseover", (event) => {
            if (!state.checkboxDragActive) return;
            if ((event.buttons & 1) !== 1) return;

            const checkboxTarget = event.target.closest('[data-role="emp-check"], [data-role="emp-check-hit"]');
            if (!checkboxTarget) return;

            const empId = normalizeKey(checkboxTarget.dataset.empId);
            if (!empId) return;
            setEmployeeSelection(empId, state.checkboxDragValue, true);
        });

        document.addEventListener("mouseup", () => {
            state.checkboxDragActive = false;
        });

        employeesListEl.addEventListener("click", (event) => {
            const checkboxTarget = event.target.closest('[data-role="emp-check"], [data-role="emp-check-hit"]');
            if (checkboxTarget) {
                event.preventDefault();
                return;
            }

            const unassignBtn = event.target.closest('[data-role="unassign-right"]');
            if (!unassignBtn) return;
            clearEmployeeAssignment(unassignBtn.dataset.empId);
        });

        employeesListEl.addEventListener("dragstart", (event) => {
            const handle = event.target.closest('[data-role="emp-drag-handle"]');
            if (!handle) {
                event.preventDefault();
                return;
            }

            const empId = normalizeKey(handle.dataset.empId);
            if (!empId) return;

            syncSelectedEmployees();

            const selectedIds = getUniqueEmployeeIds(state.selectedEmployeeIds);
            const dragIds = selectedIds.length > 1 && selectedIds.includes(empId)
                ? selectedIds
                : [empId];

            state.draggingEmpIds = dragIds;

            if (event.dataTransfer) {
                event.dataTransfer.setData("text/plain", dragIds.join(","));
                event.dataTransfer.setData("application/json", JSON.stringify({ empIds: dragIds }));
                event.dataTransfer.effectAllowed = "move";
            }
        });

        employeesListEl.addEventListener("dragend", () => {
            state.draggingEmpIds = [];
            groupsWrapEl.querySelectorAll('.sq-box.is-drop-target').forEach((el) => el.classList.remove("is-drop-target"));
            analysisDropZoneEl.classList.remove("is-dragover");
        });
    }

    function bindAnalysisEvents() {
        analysisDropZoneEl.addEventListener("dragover", (event) => {
            event.preventDefault();
            analysisDropZoneEl.classList.add("is-dragover");
        });

        analysisDropZoneEl.addEventListener("dragleave", () => {
            analysisDropZoneEl.classList.remove("is-dragover");
        });

        analysisDropZoneEl.addEventListener("drop", (event) => {
            event.preventDefault();
            analysisDropZoneEl.classList.remove("is-dragover");

            const draggedIds = getDraggedEmployeeIds(event);
            if (!draggedIds.length) return;
            addEmployeesToAnalysis(draggedIds);
        });

        analysisListEl.addEventListener("click", (event) => {
            const removeBtn = event.target.closest('[data-role="analysis-remove"]');
            if (!removeBtn) return;
            removeEmployeeFromAnalysis(removeBtn.dataset.empId);
        });

        analysisClearBtn.addEventListener("click", clearAnalysisSelection);
        balanceBtn.addEventListener("click", openBalanceModal);
    }

    function bindControlsEvents() {
        reloadBtn.addEventListener("click", () => loadData());

        employeesSearchInputEl.addEventListener("input", () => {
            state.employeesSearchTerm = employeesSearchInputEl.value || "";
            renderEmployeesSidebar();
        });

        if (btnAddEmployee) {
            btnAddEmployee.addEventListener("click", openEmployeeCreateModal);
        }
        btnBulkUnassign.addEventListener("click", clearSelectedEmployeesAssignments);

        employeeCreateIdEl.addEventListener("input", () => {
            employeeCreateIdEl.value = employeeCreateIdEl.value.replace(/[^\d]/g, "");
        });

        const perfInputs = [employeeCreatePerformance1El, employeeCreatePerformance2El, employeeCreatePerformance3El];
        perfInputs.forEach((input) => {
            input.addEventListener("input", () => {
                input.value = input.value.replace(/[^\d]/g, "");
                updateEmployeePerformancePreview();
            });
        });
    }

    function bindModalEvents() {
        balanceSaveBtn.addEventListener("click", saveBalanceProposal);
        balanceResetBtn.addEventListener("click", () => closeBalanceModal(true));
        balanceCloseBtn.addEventListener("click", () => closeBalanceModal(true));

        employeeCreateSaveBtn.addEventListener("click", createEmployee);
        employeeCreateCloseBtn.addEventListener("click", closeEmployeeCreateModal);
        employeeCreateCloseTopBtn.addEventListener("click", closeEmployeeCreateModal);

        balanceModalEl.addEventListener("click", (event) => {
            if (event.target === balanceModalEl) {
                closeBalanceModal(true);
            }
        });

        employeeCreateModalEl.addEventListener("click", (event) => {
            if (event.target === employeeCreateModalEl || event.target.classList.contains("modal-backdrop")) {
                closeEmployeeCreateModal();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;

            if (!employeeCreateModalEl.classList.contains("hidden")) {
                closeEmployeeCreateModal();
                return;
            }

            if (!balanceModalEl.classList.contains("hidden")) {
                closeBalanceModal(true);
            }
        });
    }

    function init() {
        bindControlsEvents();
        bindEmployeesEvents();
        bindGroupsEvents();
        bindAnalysisEvents();
        bindModalEvents();
        loadData();
    }

    init();
})();
