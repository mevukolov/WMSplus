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
    const balanceBtn = document.getElementById("balance-btn");

    const balanceModalEl = document.getElementById("balance-modal");
    const balanceModalSchemeEl = document.getElementById("balance-modal-scheme");
    const balanceModalStatusEl = document.getElementById("balance-modal-status");
    const balanceSaveBtn = document.getElementById("balance-save-btn");
    const balanceResetBtn = document.getElementById("balance-reset-btn");
    const balanceCloseBtn = document.getElementById("balance-close-btn");

    const btnAddEmployee = document.getElementById("btn-add-employee");
    const employeeCreateModalEl = document.getElementById("employee-create-modal");
    const employeeCreateIdEl = document.getElementById("employee-create-id");
    const employeeCreateNameEl = document.getElementById("employee-create-name");
    const employeeCreateShiftEl = document.getElementById("employee-create-shift");
    const employeeCreatePerformanceEl = document.getElementById("employee-create-performance");
    const employeeCreateSaveBtn = document.getElementById("employee-create-save");
    const employeeCreateCloseBtn = document.getElementById("employee-create-close");
    const employeeCreateCloseTopBtn = document.getElementById("employee-create-close-top");

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

        draggingEmpId: "",
        squareMap: new Map(),
        currentModel: null,

        analysisEmployeeIds: [],

        balanceProposal: null
    };

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

    function parseNumber(value, fallback = 0) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const normalized = normalizeKey(value).replace(/\s+/g, "").replace(",", ".");
        if (!normalized) return fallback;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : fallback;
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

    function getSquareRefCandidates(square) {
        return [normalizeRef(square?.sqId), normalizeRef(square?.sqName)].filter(Boolean);
    }

    function getSquareAssignTarget(square) {
        return normalizeKey(square?.sqId) || normalizeKey(square?.sqName);
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

            if (!groupsMap.has(groupKey)) {
                groupsMap.set(groupKey, {
                    groupKey,
                    weight: 0,
                    squares: []
                });
            }

            groupsMap.get(groupKey).squares.push({
                sqId: normalizeKey(row?.sq_id),
                sqName: normalizeKey(row?.sq_name),
                sqGroup: groupKey
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
        const groupsCount = model.groups.length;
        const squaresCount = model.groups.reduce((acc, group) => acc + (group.squares?.length || 0), 0);

        kpiGroupsEl.textContent = String(groupsCount);
        kpiSquaresEl.textContent = String(squaresCount);
        kpiEmployeesEl.textContent = String(model.totalEmployeesCount);
        kpiAssignedEl.textContent = String(model.assignedEmployeesCount);
        kpiTotalWeightEl.textContent = formatNum(model.totalWeight);
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
        analysisEmptyEl.style.display = selectedEmployees.length ? "none" : "";
        balanceBtn.style.display = selectedEmployees.length ? "" : "none";
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
                        return `
                            <button
                                type="button"
                                class="sq-emp-pill-btn"
                                data-role="unassign-square"
                                data-emp-id="${escapeHtml(empId)}"
                                title="Снять закрепление: ${escapeHtml(empName)}"
                            >
                                <span>${escapeHtml(empId)}</span>
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

                return `
                    <div class="sq-item">
                        <div
                            class="sq-box ${isOpen ? "is-open" : ""}"
                            data-role="sq-drop"
                            data-square-key="${escapeHtml(square.sqKey)}"
                            title="Нажмите для назначения"
                        >
                            ${employeesHtml}
                            <div class="sq-hint">${isFull ? "Лимит: 2/2" : "Нажмите или drop"}</div>
                        </div>
                        <p class="sq-name">${escapeHtml(square.sqId || "—")}</p>
                        <p class="sq-caption">${escapeHtml(square.sqName || "—")}</p>
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
                const hay = `${empName} ${empId} ${perf} ${sq}`.toLowerCase();
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
            return;
        }

        employeesEmptyEl.style.display = "none";

        employeesListEl.innerHTML = employees.map((emp) => {
            const empId = getEmployeeId(emp) || "—";
            const empName = normalizeKey(emp?.linear_emp_name) || "Без имени";
            const perf = formatNum(parseNumber(emp?.linear_emp_performance, 0));
            const assignedSq = normalizeKey(emp?.linear_emp_sq);

            return `
                <div class="emp-item ${assignedSq ? "is-assigned" : ""}" draggable="true" data-role="emp-item" data-emp-id="${escapeHtml(empId)}">
                    <div class="emp-main">
                        <span class="emp-name">${escapeHtml(`${empName} (${empId})`)}</span>
                        <span class="emp-perf">${escapeHtml(perf)}</span>
                    </div>
                    <div class="emp-actions">
                        ${assignedSq
                            ? `<button type="button" class="btn btn-outline" data-role="unassign-right" data-emp-id="${escapeHtml(empId)}">Снять закрепление</button>`
                            : ""}
                    </div>
                </div>
            `;
        }).join("");
    }

    function render() {
        const model = createBaseModel();

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
    }

    function openEmployeeCreateModal() {
        if (state.isLoading || state.isAssigning || state.isSavingBalance || state.isCreatingEmployee) {
            toast("Дождитесь завершения текущей операции", { type: "info" });
            return;
        }

        employeeCreateIdEl.value = "";
        employeeCreateNameEl.value = "";
        employeeCreateShiftEl.value = "День";
        employeeCreatePerformanceEl.value = "";
        employeeCreateModalEl.classList.remove("hidden");

        setTimeout(() => employeeCreateIdEl.focus(), 0);
    }

    function closeEmployeeCreateModal() {
        employeeCreateModalEl.classList.add("hidden");
    }

    async function createEmployee() {
        if (state.isCreatingEmployee || state.isLoading || state.isAssigning || state.isSavingBalance) {
            toast("Сейчас выполняется другая операция", { type: "info" });
            return;
        }

        const rawId = normalizeKey(employeeCreateIdEl.value);
        const name = normalizeKey(employeeCreateNameEl.value);
        const shift = normalizeKey(employeeCreateShiftEl.value) || "День";
        const rawPerf = normalizeKey(employeeCreatePerformanceEl.value);

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
        if (!rawPerf || !/^\d+$/.test(rawPerf)) {
            toast("Выработка должна быть целым числом", { type: "error" });
            return;
        }

        const exists = (state.employees || []).some((emp) => getEmployeeId(emp) === rawId);
        if (exists) {
            toast(`Сотрудник с ID ${rawId} уже существует`, { type: "error" });
            return;
        }

        setCreatingEmployeeState(true);

        try {
            const payload = {
                linear_emp_id: Number(rawId),
                linear_emp_name: name,
                linear_emp_shift: shift,
                linear_emp_performance: Number(rawPerf),
                linear_emp_sq: null,
                wh_id: state.currentWhId
            };

            const { error } = await supabaseClient
                .from("linear_emp_rep")
                .insert(payload);

            if (error) {
                throw new Error(error.message || "Ошибка создания сотрудника");
            }

            closeEmployeeCreateModal();
            await loadData();
            toast("Сотрудник добавлен", { type: "success" });
        } catch (error) {
            console.error("Ошибка создания сотрудника:", error);
            toast(`Не удалось добавить сотрудника: ${String(error?.message || error)}`, { type: "error" });
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

    async function assignEmployeeToSquare(empIdRaw, squareKeyRaw) {
        const empId = normalizeKey(empIdRaw);
        const squareKey = normalizeKey(squareKeyRaw);

        if (!empId || !squareKey) return;

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

        if ((square.employees || []).length >= 2) {
            toast("На одном КС может быть не более 2 сотрудников", { type: "error" });
            return;
        }

        const employee = getEmployeeById(empId);
        if (!employee) {
            toast("Сотрудник не найден", { type: "error" });
            return;
        }

        if (normalizeKey(employee.linear_emp_sq)) {
            toast(`Сотрудник ${empId} уже закреплён на КС`, { type: "error" });
            return;
        }

        setAssigningState(true);
        try {
            const { error } = await supabaseClient
                .from("linear_emp_rep")
                .update({ linear_emp_sq: square.assignTarget })
                .eq("wh_id", state.currentWhId)
                .eq("linear_emp_id", employee.linear_emp_id);

            if (error) throw new Error(error.message || "Ошибка назначения сотрудника");

            employee.linear_emp_sq = square.assignTarget;
            state.loadedAt = Date.now();
            state.activeAssignSquareKey = "";
            state.activeAssignEmployeeId = "";

            render();
            toast(`Сотрудник ${empId} закреплён на КС ${square.sqId || square.sqName}`, { type: "success" });
        } catch (error) {
            console.error("Ошибка назначения сотрудника:", error);
            toast(`Не удалось закрепить сотрудника: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setAssigningState(false);
        }
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
                    perf: 0,
                    remainingTarget: 0
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
                    remainingSlots,
                    projectedPerf: fixedPerf,
                    assigned: []
                };

                squareStates.push(stateSquare);

                const meta = groupMeta.get(group.groupKey);
                meta.capacity += remainingSlots;
                meta.perf += fixedPerf;
            });
        });

        const totalCapacity = squareStates.reduce((acc, sq) => acc + sq.remainingSlots, 0);
        const assignableCount = Math.min(selectedEmployees.length, totalCapacity);

        const groupTargets = allocateGroupTargets(assignableCount, Array.from(groupMeta.values()));
        groupMeta.forEach((meta) => {
            meta.remainingTarget = groupTargets.get(meta.groupKey) || 0;
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

        function chooseSquareForGroup(groupKey, requiredSlots) {
            const candidates = squareStates
                .filter((sq) => sq.groupKey === groupKey && sq.remainingSlots >= requiredSlots)
                .sort((a, b) => (a.projectedPerf - b.projectedPerf) || (b.remainingSlots - a.remainingSlots) || compareByKey(a.sqKey, b.sqKey));

            return candidates[0] || null;
        }

        function chooseGroupForPair(requiredSlots) {
            const groups = Array.from(groupMeta.values())
                .filter((meta) => meta.remainingTarget >= requiredSlots)
                .filter((meta) => chooseSquareForGroup(meta.groupKey, requiredSlots))
                .sort((a, b) => (b.remainingTarget - a.remainingTarget) || (parseNumber(b.weight, 0) - parseNumber(a.weight, 0)) || (a.perf - b.perf) || compareByKey(a.groupKey, b.groupKey));

            return groups[0] || null;
        }

        function chooseGroupForSingle() {
            const groupsWithTarget = Array.from(groupMeta.values())
                .filter((meta) => meta.remainingTarget > 0)
                .filter((meta) => chooseSquareForGroup(meta.groupKey, 1))
                .sort((a, b) => (b.remainingTarget - a.remainingTarget) || (parseNumber(b.weight, 0) - parseNumber(a.weight, 0)) || (a.perf - b.perf) || compareByKey(a.groupKey, b.groupKey));

            if (groupsWithTarget[0]) return groupsWithTarget[0];

            const fallback = Array.from(groupMeta.values())
                .filter((meta) => chooseSquareForGroup(meta.groupKey, 1))
                .sort((a, b) => (parseNumber(b.weight, 0) - parseNumber(a.weight, 0)) || (a.perf - b.perf) || compareByKey(a.groupKey, b.groupKey));

            return fallback[0] || null;
        }

        function assignToSquare(empObj, targetSquare, targetMeta) {
            if (!targetSquare || !empObj) return false;
            if (targetSquare.remainingSlots <= 0) return false;

            targetSquare.remainingSlots -= 1;
            targetSquare.projectedPerf += empObj.perf;
            targetSquare.assigned.push(empObj);
            targetMeta.perf += empObj.perf;
            if (targetMeta.remainingTarget > 0) targetMeta.remainingTarget -= 1;

            assignments.set(empObj.id, targetSquare.assignTarget);
            return true;
        }

        const unplaced = [];

        pairs.forEach((pair) => {
            if (pair.length === 2) {
                const group = chooseGroupForPair(2);
                if (group) {
                    const square = chooseSquareForGroup(group.groupKey, 2);
                    if (square) {
                        assignToSquare(pair[0], square, group);
                        assignToSquare(pair[1], square, group);
                        return;
                    }
                }
            }

            pair.forEach((empObj) => {
                const group = chooseGroupForSingle();
                if (!group) {
                    unplaced.push(empObj.id);
                    return;
                }

                const square = chooseSquareForGroup(group.groupKey, 1);
                if (!square) {
                    unplaced.push(empObj.id);
                    return;
                }

                const ok = assignToSquare(empObj, square, group);
                if (!ok) unplaced.push(empObj.id);
            });
        });

        const bySquare = new Map();
        squareStates.forEach((sq) => {
            bySquare.set(sq.sqKey, sq.assigned.map((item) => item.id));
        });

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
                        proposed: false
                    }));

                const proposedIds = proposal.bySquare.get(square.sqKey) || [];
                const proposedItems = proposedIds
                    .map((empId) => getEmployeeById(empId))
                    .filter(Boolean)
                    .map((emp) => ({
                        id: getEmployeeId(emp) || "—",
                        name: normalizeKey(emp?.linear_emp_name),
                        proposed: true
                    }));

                const combined = fixed.concat(proposedItems);

                const pills = combined.length
                    ? combined.map((item) => {
                        return `
                            <span class="sq-emp-pill-btn ${item.proposed ? "proposed" : ""}" title="${escapeHtml(item.name || item.id)}">
                                <span>${escapeHtml(item.id)}</span>
                            </span>
                        `;
                    }).join("")
                    : '<span class="sq-empty">Нет сотрудников</span>';

                const proposedClass = proposedItems.length ? "proposed" : "";

                return `
                    <div class="sq-item">
                        <div class="sq-box ${proposedClass}">
                            ${pills}
                            <div class="sq-hint">${combined.length >= 2 ? "Лимит: 2/2" : ""}</div>
                        </div>
                        <p class="sq-name">${escapeHtml(square.sqId || "—")}</p>
                        <p class="sq-caption">${escapeHtml(square.sqName || "—")}</p>
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

    async function loadData() {
        setLoadingState(true);

        try {
            const [squaresRes, groupsRes, employeesRes] = await Promise.all([
                supabaseClient
                    .from("sort_squares_rep")
                    .select("sq_id, sq_name, sq_group, wh_id")
                    .eq("wh_id", state.currentWhId),
                supabaseClient
                    .from("sort_groups_rep")
                    .select("sort_group, weight, wh_id")
                    .eq("wh_id", state.currentWhId),
                supabaseClient
                    .from("linear_emp_rep")
                    .select("linear_emp_id, linear_emp_name, linear_emp_performance, linear_emp_shift, linear_emp_sq, wh_id")
                    .eq("wh_id", state.currentWhId)
            ]);

            if (squaresRes.error) throw new Error(`sort_squares_rep: ${squaresRes.error.message}`);
            if (groupsRes.error) throw new Error(`sort_groups_rep: ${groupsRes.error.message}`);
            if (employeesRes.error) throw new Error(`linear_emp_rep: ${employeesRes.error.message}`);

            state.squares = Array.isArray(squaresRes.data) ? squaresRes.data : [];
            state.groups = Array.isArray(groupsRes.data) ? groupsRes.data : [];
            state.employees = Array.isArray(employeesRes.data) ? employeesRes.data : [];
            state.loadedAt = Date.now();

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
            const transferId = normalizeKey(event.dataTransfer?.getData("text/plain"));
            const empId = transferId || normalizeKey(state.draggingEmpId);

            if (!empId) {
                toast("Не удалось определить сотрудника для назначения", { type: "error" });
                return;
            }

            assignEmployeeToSquare(empId, squareKey);
        });
    }

    function bindEmployeesEvents() {
        employeesListEl.addEventListener("click", (event) => {
            const btn = event.target.closest('[data-role="unassign-right"]');
            if (!btn) return;
            clearEmployeeAssignment(btn.dataset.empId);
        });

        employeesListEl.addEventListener("dragstart", (event) => {
            const item = event.target.closest('[data-role="emp-item"]');
            if (!item) return;

            const empId = normalizeKey(item.dataset.empId);
            if (!empId) return;

            state.draggingEmpId = empId;

            if (event.dataTransfer) {
                event.dataTransfer.setData("text/plain", empId);
                event.dataTransfer.effectAllowed = "move";
            }
        });

        employeesListEl.addEventListener("dragend", () => {
            state.draggingEmpId = "";
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

            const transferId = normalizeKey(event.dataTransfer?.getData("text/plain"));
            const empId = transferId || normalizeKey(state.draggingEmpId);

            if (!empId) return;
            addEmployeeToAnalysis(empId);
        });

        analysisListEl.addEventListener("click", (event) => {
            const removeBtn = event.target.closest('[data-role="analysis-remove"]');
            if (!removeBtn) return;
            removeEmployeeFromAnalysis(removeBtn.dataset.empId);
        });

        balanceBtn.addEventListener("click", openBalanceModal);
    }

    function bindControlsEvents() {
        reloadBtn.addEventListener("click", () => loadData());

        employeesSearchInputEl.addEventListener("input", () => {
            state.employeesSearchTerm = employeesSearchInputEl.value || "";
            renderEmployeesSidebar();
        });

        btnAddEmployee.addEventListener("click", openEmployeeCreateModal);

        employeeCreateIdEl.addEventListener("input", () => {
            employeeCreateIdEl.value = employeeCreateIdEl.value.replace(/[^\d]/g, "");
        });

        employeeCreatePerformanceEl.addEventListener("input", () => {
            employeeCreatePerformanceEl.value = employeeCreatePerformanceEl.value.replace(/[^\d]/g, "");
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
