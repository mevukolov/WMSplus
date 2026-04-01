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

    const FREE_GROUP_KEY = "Свободные КС";
    const ARCHIVE_GROUP_KEY = "Архив КС";
    const GROUP_SELECT_FREE = "__FREE__";
    const GROUP_SELECT_ARCHIVE = "__ARCHIVE__";

    const btnReload = document.getElementById("btn-reload");
    const btnAddGroup = document.getElementById("btn-add-group");
    const btnAddSquare = document.getElementById("btn-add-square");

    const statusLineEl = document.getElementById("status-line");
    const groupsGridEl = document.getElementById("groups-grid");
    const groupsEmptyEl = document.getElementById("groups-empty");

    const squareSearchInputEl = document.getElementById("square-search-input");
    const freeZoneEl = document.getElementById("free-zone");
    const archiveZoneEl = document.getElementById("archive-zone");
    const freeCountEl = document.getElementById("free-count");
    const archiveCountEl = document.getElementById("archive-count");

    const groupModalEl = document.getElementById("group-modal");
    const groupModalTitleEl = document.getElementById("group-modal-title");
    const groupNameInputEl = document.getElementById("group-name-input");
    const groupWeightInputEl = document.getElementById("group-weight-input");
    const groupSaveBtn = document.getElementById("group-save-btn");
    const groupDeleteBtn = document.getElementById("group-delete-btn");
    const groupModalCloseBtn = document.getElementById("group-modal-close");
    const groupModalCloseTopBtn = document.getElementById("group-modal-close-top");

    const squareModalEl = document.getElementById("square-modal");
    const squareModalTitleEl = document.getElementById("square-modal-title");
    const squareIdPreviewEl = document.getElementById("square-id-preview");
    const squareNameInputEl = document.getElementById("square-name-input");
    const squareGroupSelectEl = document.getElementById("square-group-select");
    const squareSecondaryCheckEl = document.getElementById("square-secondary-check");
    const squareSaveBtn = document.getElementById("square-save-btn");
    const squareDeleteBtn = document.getElementById("square-delete-btn");
    const squareModalCloseBtn = document.getElementById("square-modal-close");
    const squareModalCloseTopBtn = document.getElementById("square-modal-close-top");

    const state = {
        currentWhId: normalizeWhId(user?.user_wh_id),
        groups: [],
        squares: [],
        loadedAt: null,

        hasSecondaryColumn: true,

        searchTerm: "",

        isLoading: false,
        isSaving: false,

        draggingSquareId: "",

        groupFormMode: "create",
        editingGroupKey: "",

        squareFormMode: "create",
        editingSquareId: "",

        activeModalId: ""
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

    function parseNumber(value, fallback = 0) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const normalized = normalizeKey(value).replace(/\s+/g, "").replace(",", ".");
        if (!normalized) return fallback;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function parseNonNegativeInt(value) {
        const raw = normalizeKey(value).replace(/\s+/g, "");
        if (!/^\d+$/.test(raw)) return null;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) return null;
        return Math.round(parsed);
    }

    function compareByKey(a, b) {
        const na = Number(a);
        const nb = Number(b);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return String(a).localeCompare(String(b), "ru", { numeric: true, sensitivity: "base" });
    }

    function formatNum(value) {
        return new Intl.NumberFormat("ru-RU", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(Number(value || 0));
    }

    function isTruthyFlag(value) {
        const raw = normalizeKey(value).toLowerCase();
        if (!raw) return false;
        return raw === "1" || raw === "true" || raw === "t" || raw === "yes" || raw === "y";
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

    async function confirmAction(message, title = "Подтверждение") {
        if (window.MiniUI?.confirm) {
            return window.MiniUI.confirm(message, { title });
        }
        return Promise.resolve(window.confirm(message));
    }

    function showModal(modalEl) {
        if (!modalEl) return;
        if (state.activeModalId && state.activeModalId !== modalEl.id) {
            closeAnyModal();
        }
        modalEl.classList.remove("hidden");
        state.activeModalId = modalEl.id;
    }

    function hideModal(modalEl) {
        if (!modalEl) return;
        modalEl.classList.add("hidden");
        if (state.activeModalId === modalEl.id) {
            state.activeModalId = "";
        }
    }

    function closeAnyModal() {
        if (state.activeModalId === groupModalEl.id) {
            closeGroupModal();
            return true;
        }
        if (state.activeModalId === squareModalEl.id) {
            closeSquareModal();
            return true;
        }
        return false;
    }

    function isReservedGroupKey(value) {
        const ref = normalizeRef(value);
        if (!ref) return false;
        return ref === normalizeRef(FREE_GROUP_KEY) || ref === normalizeRef(ARCHIVE_GROUP_KEY);
    }

    function isMissingSecondaryColumnError(error) {
        const code = normalizeKey(error?.code).toUpperCase();
        const msg = normalizeKey(error?.message).toLowerCase();
        const details = normalizeKey(error?.details).toLowerCase();
        return code === "PGRST204" || code === "42703" || msg.includes("is_secondary") || details.includes("is_secondary");
    }

    function getCanonicalGroups() {
        const map = new Map();

        (state.groups || []).forEach((row) => {
            const groupKey = normalizeKey(row?.sort_group);
            if (!groupKey) return;
            if (isReservedGroupKey(groupKey)) return;

            const groupRef = normalizeRef(groupKey);
            const existing = map.get(groupRef);
            const weight = parseNumber(row?.weight, 0);

            if (!existing) {
                map.set(groupRef, {
                    groupKey,
                    groupRef,
                    weight
                });
            } else {
                existing.weight = weight;
            }
        });

        return Array.from(map.values()).sort((a, b) => compareByKey(a.groupKey, b.groupKey));
    }

    function getActiveGroupMap() {
        const map = new Map();
        getCanonicalGroups().forEach((group) => {
            map.set(group.groupRef, group);
        });
        return map;
    }

    function getSquareId(square) {
        return normalizeKey(square?.sq_id);
    }

    function getSquareById(sqId) {
        const ref = normalizeRef(sqId);
        if (!ref) return null;
        return (state.squares || []).find((square) => normalizeRef(square?.sq_id) === ref) || null;
    }

    function classifySquare(square, activeGroupMap) {
        const groupRaw = normalizeKey(square?.sq_group);
        const groupRef = normalizeRef(groupRaw);

        if (!groupRef) return "free";
        if (groupRef === normalizeRef(ARCHIVE_GROUP_KEY)) return "archive";
        if (groupRef === normalizeRef(FREE_GROUP_KEY)) return "free";
        if (!activeGroupMap.has(groupRef)) return "free";
        return "group";
    }

    function sortSquares(list) {
        return [...(list || [])].sort((a, b) => {
            const byId = compareByKey(normalizeKey(a?.sq_id), normalizeKey(b?.sq_id));
            if (byId !== 0) return byId;
            return compareByKey(normalizeKey(a?.sq_name), normalizeKey(b?.sq_name));
        });
    }

    function getGroupSquares(groupKey, activeGroupMap) {
        const targetRef = normalizeRef(groupKey);
        return sortSquares(
            (state.squares || []).filter((square) => {
                if (classifySquare(square, activeGroupMap) !== "group") return false;
                return normalizeRef(square?.sq_group) === targetRef;
            })
        );
    }

    function getFreeSquares(activeGroupMap) {
        return sortSquares(
            (state.squares || []).filter((square) => classifySquare(square, activeGroupMap) === "free")
        );
    }

    function getArchiveSquares(activeGroupMap) {
        return sortSquares(
            (state.squares || []).filter((square) => classifySquare(square, activeGroupMap) === "archive")
        );
    }

    function matchesSquareSearch(square) {
        const q = normalizeKey(state.searchTerm).toLowerCase();
        if (!q) return true;
        const hay = `${normalizeKey(square?.sq_id)} ${normalizeKey(square?.sq_name)} ${normalizeKey(square?.sq_group)}`.toLowerCase();
        return hay.includes(q);
    }

    function renderSquareCard(square) {
        const sqId = getSquareId(square) || "—";
        const sqName = normalizeKey(square?.sq_name) || sqId;
        const isSecondary = isTruthyFlag(square?.is_secondary);

        return `
            <article
                class="pm-square ${isSecondary ? "secondary" : ""}"
                draggable="true"
                data-role="square-card"
                data-sq-id="${escapeHtml(sqId)}"
            >
                <button
                    type="button"
                    class="pm-square-edit"
                    data-role="edit-square"
                    data-sq-id="${escapeHtml(sqId)}"
                    title="Редактировать КС"
                >✎</button>
                <p class="pm-square-name">${escapeHtml(sqName)}</p>
                <p class="pm-square-id">${escapeHtml(sqId)}</p>
                <p class="pm-square-badge">${isSecondary ? "Допка" : ""}</p>
            </article>
        `;
    }

    function renderStatus() {
        const activeGroupMap = getActiveGroupMap();
        const freeCount = getFreeSquares(activeGroupMap).length;
        const archiveCount = getArchiveSquares(activeGroupMap).length;
        const loadedAt = state.loadedAt
            ? new Date(state.loadedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
            : "—";

        statusLineEl.textContent = `Групп: ${activeGroupMap.size} · КС: ${(state.squares || []).length} · свободных: ${freeCount} · архив: ${archiveCount} · обновлено: ${loadedAt}`;
    }

    function renderGroups() {
        const groups = getCanonicalGroups();
        const activeGroupMap = getActiveGroupMap();

        if (!groups.length) {
            groupsGridEl.innerHTML = "";
            groupsEmptyEl.style.display = "";
            return;
        }

        groupsEmptyEl.style.display = "none";

        groupsGridEl.innerHTML = groups.map((group) => {
            const groupSquares = getGroupSquares(group.groupKey, activeGroupMap).filter(matchesSquareSearch);

            const squaresHtml = groupSquares.length
                ? groupSquares.map((square) => renderSquareCard(square)).join("")
                : '<div class="group-empty-slot">Перетащите сюда КС</div>';

            return `
                <article class="group-card">
                    <div class="group-head">
                        <div class="group-head-left">
                            <h3 class="group-title">Группа сортировки ${escapeHtml(group.groupKey)}</h3>
                        </div>
                        <div class="group-actions">
                            <button type="button" class="btn btn-outline mini-btn" data-role="add-square-group" data-group-key="${escapeHtml(group.groupKey)}" title="Добавить КС">+</button>
                            <button type="button" class="btn btn-outline mini-btn" data-role="edit-group" data-group-key="${escapeHtml(group.groupKey)}" title="Редактировать группу">✎</button>
                        </div>
                    </div>

                    <div class="group-dropzone" data-role="drop-group" data-group-key="${escapeHtml(group.groupKey)}">
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

    function renderSideZone(zoneEl, squares, emptyText) {
        if (!zoneEl) return;
        zoneEl.innerHTML = squares.length
            ? squares.map((square) => renderSquareCard(square)).join("")
            : `<div class="side-empty">${escapeHtml(emptyText)}</div>`;
    }

    function renderSidebar() {
        const activeGroupMap = getActiveGroupMap();
        const freeAll = getFreeSquares(activeGroupMap);
        const archiveAll = getArchiveSquares(activeGroupMap);

        const freeFiltered = freeAll.filter(matchesSquareSearch);
        const archiveFiltered = archiveAll.filter(matchesSquareSearch);

        renderSideZone(freeZoneEl, freeFiltered, "Перетащите сюда КС без активной группы");
        renderSideZone(archiveZoneEl, archiveFiltered, "Перетащите сюда КС для архива");

        freeCountEl.textContent = freeFiltered.length === freeAll.length
            ? String(freeAll.length)
            : `${freeFiltered.length}/${freeAll.length}`;

        archiveCountEl.textContent = archiveFiltered.length === archiveAll.length
            ? String(archiveAll.length)
            : `${archiveFiltered.length}/${archiveAll.length}`;
    }

    function render() {
        renderStatus();
        renderGroups();
        renderSidebar();
    }

    function refreshBusyUi() {
        const busy = state.isLoading || state.isSaving;
        if (window.MiniUI?.setLoaderVisible) {
            window.MiniUI.setLoaderVisible(busy);
        }

        [btnReload, btnAddGroup, btnAddSquare, groupSaveBtn, squareSaveBtn].forEach((btn) => {
            if (!btn) return;
            btn.disabled = busy;
            btn.style.opacity = busy ? "0.7" : "";
            btn.style.cursor = busy ? "not-allowed" : "";
        });
    }

    function setLoadingState(isLoading) {
        state.isLoading = Boolean(isLoading);
        refreshBusyUi();
    }

    function setSavingState(isSaving) {
        state.isSaving = Boolean(isSaving);
        refreshBusyUi();
    }

    async function loadSquaresWithSecondaryFallback() {
        const withSecondary = await supabaseClient
            .from("sort_squares_rep")
            .select("sq_id, sq_name, sq_group, wh_id, is_secondary")
            .eq("wh_id", state.currentWhId);

        if (!withSecondary.error) {
            state.hasSecondaryColumn = true;
            return Array.isArray(withSecondary.data) ? withSecondary.data : [];
        }

        if (!isMissingSecondaryColumnError(withSecondary.error)) {
            throw new Error(withSecondary.error.message || "Ошибка загрузки sort_squares_rep");
        }

        const fallback = await supabaseClient
            .from("sort_squares_rep")
            .select("sq_id, sq_name, sq_group, wh_id")
            .eq("wh_id", state.currentWhId);

        if (fallback.error) {
            throw new Error(fallback.error.message || "Ошибка загрузки sort_squares_rep");
        }

        state.hasSecondaryColumn = false;
        const rows = Array.isArray(fallback.data) ? fallback.data : [];
        return rows.map((row) => ({ ...row, is_secondary: 0 }));
    }

    async function loadData() {
        setLoadingState(true);

        try {
            const [squaresRows, groupsRes] = await Promise.all([
                loadSquaresWithSecondaryFallback(),
                supabaseClient
                    .from("sort_groups_rep")
                    .select("sort_group, weight, wh_id")
                    .eq("wh_id", state.currentWhId)
            ]);

            if (groupsRes.error) throw new Error(groupsRes.error.message || "Ошибка загрузки sort_groups_rep");

            state.squares = Array.isArray(squaresRows) ? squaresRows : [];
            state.groups = Array.isArray(groupsRes.data) ? groupsRes.data : [];
            state.loadedAt = Date.now();

            render();
            return true;
        } catch (error) {
            console.error("Ошибка загрузки данных:", error);
            statusLineEl.textContent = "Не удалось загрузить данные. Проверьте таблицы и поля Supabase.";
            groupsGridEl.innerHTML = "";
            groupsEmptyEl.style.display = "";
            freeZoneEl.innerHTML = "";
            archiveZoneEl.innerHTML = "";
            toast(`Ошибка загрузки данных: ${String(error?.message || error)}`, { type: "error" });
            return false;
        } finally {
            setLoadingState(false);
        }
    }

    function clearDropHighlights() {
        groupsGridEl.querySelectorAll(".group-dropzone.is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
        freeZoneEl.classList.remove("is-drop-target");
        archiveZoneEl.classList.remove("is-drop-target");
    }

    function getDraggedSquareId(event) {
        if (normalizeKey(state.draggingSquareId)) return normalizeKey(state.draggingSquareId);

        const plain = normalizeKey(event?.dataTransfer?.getData("text/plain"));
        if (plain) return plain;

        return "";
    }

    function getTargetGroupForSelectValue(value) {
        const raw = normalizeKey(value);
        if (!raw || raw === GROUP_SELECT_FREE) return FREE_GROUP_KEY;
        if (raw === GROUP_SELECT_ARCHIVE) return ARCHIVE_GROUP_KEY;
        return raw;
    }

    function getSelectValueForSquareGroup(groupValue) {
        const activeGroupMap = getActiveGroupMap();
        const raw = normalizeKey(groupValue);
        const ref = normalizeRef(raw);

        if (!ref || ref === normalizeRef(FREE_GROUP_KEY)) return GROUP_SELECT_FREE;
        if (ref === normalizeRef(ARCHIVE_GROUP_KEY)) return GROUP_SELECT_ARCHIVE;

        const group = activeGroupMap.get(ref);
        if (group) return group.groupKey;
        return GROUP_SELECT_FREE;
    }

    function populateSquareGroupSelect(selectedValue = GROUP_SELECT_FREE) {
        const groups = getCanonicalGroups();

        const options = groups.map((group) => `
            <option value="${escapeHtml(group.groupKey)}">${escapeHtml(`Группа сортировки ${group.groupKey}`)}</option>
        `);

        options.push(`<option value="${GROUP_SELECT_FREE}">${escapeHtml(FREE_GROUP_KEY)}</option>`);
        options.push(`<option value="${GROUP_SELECT_ARCHIVE}">${escapeHtml(ARCHIVE_GROUP_KEY)}</option>`);

        squareGroupSelectEl.innerHTML = options.join("");

        const normalizedSelected = normalizeKey(selectedValue);
        const canSelect = Array.from(squareGroupSelectEl.options).some((opt) => normalizeKey(opt.value) === normalizedSelected);
        squareGroupSelectEl.value = canSelect ? normalizedSelected : GROUP_SELECT_FREE;
    }

    function generateNextSquareId() {
        const used = new Set(
            (state.squares || [])
                .map((square) => normalizeKey(square?.sq_id).toUpperCase())
                .filter(Boolean)
        );

        let idx = 1;
        while (used.has(`SQ${String(idx).padStart(5, "0")}`)) {
            idx += 1;
        }

        return `SQ${String(idx).padStart(5, "0")}`;
    }

    function openGroupModal(mode, payload = {}) {
        state.groupFormMode = mode === "edit" ? "edit" : "create";
        state.editingGroupKey = normalizeKey(payload?.groupKey);

        if (state.groupFormMode === "edit") {
            groupModalTitleEl.textContent = "Редактировать группу";
            groupNameInputEl.value = normalizeKey(payload?.groupKey);
            groupWeightInputEl.value = String(Math.max(0, Math.round(parseNumber(payload?.weight, 0))));
            groupDeleteBtn.style.display = "";
        } else {
            groupModalTitleEl.textContent = "Добавить группу";
            groupNameInputEl.value = "";
            groupWeightInputEl.value = "";
            groupDeleteBtn.style.display = "none";
        }

        showModal(groupModalEl);
        setTimeout(() => groupNameInputEl.focus(), 0);
    }

    function closeGroupModal() {
        hideModal(groupModalEl);
        state.groupFormMode = "create";
        state.editingGroupKey = "";
    }

    async function saveGroup() {
        if (state.isSaving || state.isLoading) return;

        const groupKey = normalizeKey(groupNameInputEl.value);
        const weight = parseNonNegativeInt(groupWeightInputEl.value);

        if (!groupKey) {
            toast("Укажите группу КС", { type: "error" });
            return;
        }

        if (isReservedGroupKey(groupKey)) {
            toast(`"${groupKey}" — системная группа, выберите другое имя`, { type: "error" });
            return;
        }

        if (weight === null) {
            toast("Weight должен быть целым числом от 0", { type: "error" });
            return;
        }

        const existing = getCanonicalGroups().find((group) => normalizeRef(group.groupKey) === normalizeRef(groupKey));
        const isCreate = state.groupFormMode === "create";
        const oldGroupKey = normalizeKey(state.editingGroupKey);

        if (isCreate && existing) {
            toast("Такая группа уже существует", { type: "error" });
            return;
        }

        if (!isCreate && !oldGroupKey) {
            toast("Не найдена редактируемая группа", { type: "error" });
            return;
        }

        if (!isCreate && existing && normalizeRef(existing.groupKey) !== normalizeRef(oldGroupKey)) {
            toast("Группа с таким именем уже существует", { type: "error" });
            return;
        }

        setSavingState(true);

        try {
            if (isCreate) {
                const { error } = await supabaseClient
                    .from("sort_groups_rep")
                    .insert({
                        sort_group: groupKey,
                        weight,
                        wh_id: state.currentWhId
                    });

                if (error) throw new Error(error.message || "Не удалось создать группу");
            } else if (normalizeRef(groupKey) === normalizeRef(oldGroupKey)) {
                const { error } = await supabaseClient
                    .from("sort_groups_rep")
                    .update({
                        sort_group: groupKey,
                        weight
                    })
                    .eq("wh_id", state.currentWhId)
                    .eq("sort_group", oldGroupKey);

                if (error) throw new Error(error.message || "Не удалось обновить группу");
            } else {
                const { error: insertError } = await supabaseClient
                    .from("sort_groups_rep")
                    .insert({
                        sort_group: groupKey,
                        weight,
                        wh_id: state.currentWhId
                    });

                if (insertError) throw new Error(insertError.message || "Не удалось создать новую группу");

                const { error: moveSquaresError } = await supabaseClient
                    .from("sort_squares_rep")
                    .update({ sq_group: groupKey })
                    .eq("wh_id", state.currentWhId)
                    .eq("sq_group", oldGroupKey);

                if (moveSquaresError) {
                    await supabaseClient
                        .from("sort_groups_rep")
                        .delete()
                        .eq("wh_id", state.currentWhId)
                        .eq("sort_group", groupKey);

                    throw new Error(moveSquaresError.message || "Не удалось перенести КС в новую группу");
                }

                const { error: deleteOldError } = await supabaseClient
                    .from("sort_groups_rep")
                    .delete()
                    .eq("wh_id", state.currentWhId)
                    .eq("sort_group", oldGroupKey);

                if (deleteOldError) throw new Error(deleteOldError.message || "Не удалось удалить старую группу");
            }

            closeGroupModal();
            const reloaded = await loadData();
            if (reloaded) {
                toast("Группа сохранена", { type: "success" });
            }
        } catch (error) {
            console.error("Ошибка сохранения группы:", error);
            toast(`Не удалось сохранить группу: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setSavingState(false);
        }
    }

    async function deleteGroup(groupKeyRaw) {
        const groupKey = normalizeKey(groupKeyRaw);
        if (!groupKey) return;

        const ok = await confirmAction(`Удалить группу "${groupKey}"? Все КС этой группы будут перемещены в "${FREE_GROUP_KEY}".`, "Удаление группы");
        if (!ok) return;

        setSavingState(true);

        try {
            const { error: moveError } = await supabaseClient
                .from("sort_squares_rep")
                .update({ sq_group: FREE_GROUP_KEY })
                .eq("wh_id", state.currentWhId)
                .eq("sq_group", groupKey);

            if (moveError) throw new Error(moveError.message || "Не удалось переместить КС");

            const { error: deleteError } = await supabaseClient
                .from("sort_groups_rep")
                .delete()
                .eq("wh_id", state.currentWhId)
                .eq("sort_group", groupKey);

            if (deleteError) throw new Error(deleteError.message || "Не удалось удалить группу");

            if (!groupModalEl.classList.contains("hidden") && normalizeRef(state.editingGroupKey) === normalizeRef(groupKey)) {
                closeGroupModal();
            }

            const reloaded = await loadData();
            if (reloaded) {
                toast("Группа удалена", { type: "success" });
            }
        } catch (error) {
            console.error("Ошибка удаления группы:", error);
            toast(`Не удалось удалить группу: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setSavingState(false);
        }
    }

    function openSquareModal(mode, payload = {}) {
        state.squareFormMode = mode === "edit" ? "edit" : "create";

        if (state.squareFormMode === "edit") {
            const square = getSquareById(payload?.sqId);
            if (!square) {
                toast("КС не найден", { type: "error" });
                state.squareFormMode = "create";
                state.editingSquareId = "";
                return;
            }

            state.editingSquareId = getSquareId(square);
            squareModalTitleEl.textContent = "Редактировать КС";
            squareIdPreviewEl.textContent = getSquareId(square) || "—";
            squareNameInputEl.value = normalizeKey(square?.sq_name);
            squareSecondaryCheckEl.checked = isTruthyFlag(square?.is_secondary);
            squareDeleteBtn.style.display = "";
            populateSquareGroupSelect(getSelectValueForSquareGroup(square?.sq_group));
        } else {
            state.editingSquareId = "";
            const generatedId = generateNextSquareId();
            squareModalTitleEl.textContent = "Добавить КС";
            squareIdPreviewEl.textContent = generatedId;
            squareNameInputEl.value = "";
            squareSecondaryCheckEl.checked = false;
            squareDeleteBtn.style.display = "none";
            populateSquareGroupSelect(payload?.prefillGroupValue || GROUP_SELECT_FREE);
        }

        showModal(squareModalEl);
        setTimeout(() => squareNameInputEl.focus(), 0);
    }

    function closeSquareModal() {
        hideModal(squareModalEl);
        state.squareFormMode = "create";
        state.editingSquareId = "";
    }

    async function writeSquareRecord(mode, squareId, payload) {
        const withSecondary = { ...payload };
        const withoutSecondary = { ...payload };
        delete withoutSecondary.is_secondary;

        const runQuery = async (body) => {
            if (mode === "insert") {
                return supabaseClient.from("sort_squares_rep").insert(body);
            }
            return supabaseClient
                .from("sort_squares_rep")
                .update(body)
                .eq("wh_id", state.currentWhId)
                .eq("sq_id", squareId);
        };

        const initialBody = state.hasSecondaryColumn ? withSecondary : withoutSecondary;
        let res = await runQuery(initialBody);

        if (res.error && state.hasSecondaryColumn && isMissingSecondaryColumnError(res.error)) {
            state.hasSecondaryColumn = false;
            res = await runQuery(withoutSecondary);
            if (!res.error) {
                toast("Колонка is_secondary не найдена в БД. КС сохранен без этого признака.", { type: "info" });
            }
        }

        if (res.error) {
            throw new Error(res.error.message || "Ошибка сохранения КС");
        }
    }

    async function saveSquare() {
        if (state.isSaving || state.isLoading) return;

        const sqId = normalizeKey(squareIdPreviewEl.textContent);
        const sqName = normalizeKey(squareNameInputEl.value);
        const sqGroup = getTargetGroupForSelectValue(squareGroupSelectEl.value);
        const isSecondary = squareSecondaryCheckEl.checked ? 1 : 0;

        if (!sqId) {
            toast("Не удалось определить ID КС", { type: "error" });
            return;
        }
        if (!sqName) {
            toast("Укажите название КС", { type: "error" });
            return;
        }
        if (!sqGroup) {
            toast("Укажите группу КС", { type: "error" });
            return;
        }

        const isCreate = state.squareFormMode === "create";
        const editingSquareId = normalizeKey(state.editingSquareId);

        if (isCreate && getSquareById(sqId)) {
            toast("КС с таким ID уже существует", { type: "error" });
            return;
        }

        if (!isCreate && !editingSquareId) {
            toast("Не найден редактируемый КС", { type: "error" });
            return;
        }

        const payload = {
            sq_id: sqId,
            sq_name: sqName,
            sq_group: sqGroup,
            wh_id: state.currentWhId,
            is_secondary: isSecondary
        };

        setSavingState(true);

        try {
            if (isCreate) {
                await writeSquareRecord("insert", sqId, payload);
            } else {
                await writeSquareRecord("update", editingSquareId, payload);
            }

            closeSquareModal();
            const reloaded = await loadData();
            if (reloaded) {
                toast("КС сохранен", { type: "success" });
            }
        } catch (error) {
            console.error("Ошибка сохранения КС:", error);
            toast(`Не удалось сохранить КС: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setSavingState(false);
        }
    }

    async function deleteSquare(squareIdRaw) {
        const squareId = normalizeKey(squareIdRaw);
        if (!squareId) return;

        const ok = await confirmAction(`Удалить КС ${squareId}?`, "Удаление КС");
        if (!ok) return;

        setSavingState(true);

        try {
            const { error } = await supabaseClient
                .from("sort_squares_rep")
                .delete()
                .eq("wh_id", state.currentWhId)
                .eq("sq_id", squareId);

            if (error) throw new Error(error.message || "Не удалось удалить КС");

            if (!squareModalEl.classList.contains("hidden") && normalizeRef(state.editingSquareId) === normalizeRef(squareId)) {
                closeSquareModal();
            }

            const reloaded = await loadData();
            if (reloaded) {
                toast("КС удален", { type: "success" });
            }
        } catch (error) {
            console.error("Ошибка удаления КС:", error);
            toast(`Не удалось удалить КС: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setSavingState(false);
        }
    }

    function getCanonicalGroupValue(groupRaw) {
        const activeMap = getActiveGroupMap();
        const groupRef = normalizeRef(groupRaw);
        if (!groupRef) return FREE_GROUP_KEY;
        if (groupRef === normalizeRef(FREE_GROUP_KEY)) return FREE_GROUP_KEY;
        if (groupRef === normalizeRef(ARCHIVE_GROUP_KEY)) return ARCHIVE_GROUP_KEY;
        const active = activeMap.get(groupRef);
        if (active) return active.groupKey;
        return FREE_GROUP_KEY;
    }

    async function moveSquareToGroup(squareIdRaw, targetGroupRaw) {
        const squareId = normalizeKey(squareIdRaw);
        if (!squareId) return;

        const square = getSquareById(squareId);
        if (!square) {
            toast("КС не найден", { type: "error" });
            return;
        }

        const targetGroup = getCanonicalGroupValue(targetGroupRaw);
        const currentGroup = getCanonicalGroupValue(square?.sq_group);

        if (normalizeRef(targetGroup) === normalizeRef(currentGroup)) {
            return;
        }

        setSavingState(true);

        try {
            const { error } = await supabaseClient
                .from("sort_squares_rep")
                .update({ sq_group: targetGroup })
                .eq("wh_id", state.currentWhId)
                .eq("sq_id", squareId);

            if (error) throw new Error(error.message || "Не удалось переместить КС");

            square.sq_group = targetGroup;
            state.loadedAt = Date.now();

            render();
            toast(`КС ${squareId} перемещен`, { type: "success" });
        } catch (error) {
            console.error("Ошибка перемещения КС:", error);
            toast(`Не удалось переместить КС: ${String(error?.message || error)}`, { type: "error" });
        } finally {
            setSavingState(false);
        }
    }

    function bindGroupsEvents() {
        groupsGridEl.addEventListener("click", (event) => {
            const editSquareBtn = event.target.closest('[data-role="edit-square"]');
            if (editSquareBtn) {
                openSquareModal("edit", { sqId: editSquareBtn.dataset.sqId });
                return;
            }

            const addSquareBtn = event.target.closest('[data-role="add-square-group"]');
            if (addSquareBtn) {
                const groupKey = normalizeKey(addSquareBtn.dataset.groupKey);
                openSquareModal("create", { prefillGroupValue: groupKey || GROUP_SELECT_FREE });
                return;
            }

            const editGroupBtn = event.target.closest('[data-role="edit-group"]');
            if (editGroupBtn) {
                const groupKey = normalizeKey(editGroupBtn.dataset.groupKey);
                const group = getCanonicalGroups().find((item) => normalizeRef(item.groupKey) === normalizeRef(groupKey));
                if (!group) {
                    toast("Группа не найдена", { type: "error" });
                    return;
                }
                openGroupModal("edit", group);
                return;
            }

            const squareCard = event.target.closest('[data-role="square-card"]');
            if (squareCard) {
                openSquareModal("edit", { sqId: squareCard.dataset.sqId });
            }
        });

        groupsGridEl.addEventListener("dragover", (event) => {
            const dropZone = event.target.closest('[data-role="drop-group"]');
            if (!dropZone) return;
            event.preventDefault();
            dropZone.classList.add("is-drop-target");
        });

        groupsGridEl.addEventListener("dragleave", (event) => {
            const dropZone = event.target.closest('[data-role="drop-group"]');
            if (!dropZone) return;
            dropZone.classList.remove("is-drop-target");
        });

        groupsGridEl.addEventListener("drop", (event) => {
            const dropZone = event.target.closest('[data-role="drop-group"]');
            if (!dropZone) return;
            event.preventDefault();
            dropZone.classList.remove("is-drop-target");

            const squareId = getDraggedSquareId(event);
            if (!squareId) return;
            moveSquareToGroup(squareId, dropZone.dataset.groupKey);
        });
    }

    function bindSidebarEvents() {
        [freeZoneEl, archiveZoneEl].forEach((zoneEl) => {
            zoneEl.addEventListener("click", (event) => {
                const editSquareBtn = event.target.closest('[data-role="edit-square"]');
                if (editSquareBtn) {
                    openSquareModal("edit", { sqId: editSquareBtn.dataset.sqId });
                    return;
                }

                const squareCard = event.target.closest('[data-role="square-card"]');
                if (squareCard) {
                    openSquareModal("edit", { sqId: squareCard.dataset.sqId });
                }
            });

            zoneEl.addEventListener("dragover", (event) => {
                event.preventDefault();
                zoneEl.classList.add("is-drop-target");
            });

            zoneEl.addEventListener("dragleave", () => {
                zoneEl.classList.remove("is-drop-target");
            });

            zoneEl.addEventListener("drop", (event) => {
                event.preventDefault();
                zoneEl.classList.remove("is-drop-target");

                const squareId = getDraggedSquareId(event);
                if (!squareId) return;

                const target = zoneEl === archiveZoneEl ? ARCHIVE_GROUP_KEY : FREE_GROUP_KEY;
                moveSquareToGroup(squareId, target);
            });
        });
    }

    function bindDragEvents() {
        document.addEventListener("dragstart", (event) => {
            const card = event.target.closest('[data-role="square-card"]');
            if (!card) return;

            const editBtn = event.target.closest('[data-role="edit-square"]');
            if (editBtn) {
                event.preventDefault();
                return;
            }

            const squareId = normalizeKey(card.dataset.sqId);
            if (!squareId) {
                event.preventDefault();
                return;
            }

            state.draggingSquareId = squareId;
            card.classList.add("is-dragging");

            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", squareId);
            }
        });

        document.addEventListener("dragend", () => {
            state.draggingSquareId = "";
            document.querySelectorAll('.pm-square.is-dragging').forEach((el) => el.classList.remove("is-dragging"));
            clearDropHighlights();
        });
    }

    function bindControlsEvents() {
        btnReload.addEventListener("click", () => loadData());

        btnAddGroup.addEventListener("click", () => openGroupModal("create"));
        btnAddSquare.addEventListener("click", () => openSquareModal("create", { prefillGroupValue: GROUP_SELECT_FREE }));

        squareSearchInputEl.addEventListener("input", () => {
            state.searchTerm = squareSearchInputEl.value || "";
            render();
        });

        groupWeightInputEl.addEventListener("input", () => {
            groupWeightInputEl.value = groupWeightInputEl.value.replace(/[^\d]/g, "");
        });

        groupSaveBtn.addEventListener("click", saveGroup);
        groupDeleteBtn.addEventListener("click", () => deleteGroup(state.editingGroupKey));
        groupModalCloseBtn.addEventListener("click", closeGroupModal);
        groupModalCloseTopBtn.addEventListener("click", closeGroupModal);

        squareSaveBtn.addEventListener("click", saveSquare);
        squareDeleteBtn.addEventListener("click", () => deleteSquare(state.editingSquareId || squareIdPreviewEl.textContent));
        squareModalCloseBtn.addEventListener("click", closeSquareModal);
        squareModalCloseTopBtn.addEventListener("click", closeSquareModal);
    }

    function bindModalEvents() {
        groupModalEl.addEventListener("click", (event) => {
            if (event.target === groupModalEl || event.target.classList.contains("modal-backdrop")) {
                closeGroupModal();
            }
        });

        squareModalEl.addEventListener("click", (event) => {
            if (event.target === squareModalEl || event.target.classList.contains("modal-backdrop")) {
                closeSquareModal();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            closeAnyModal();
        });
    }

    function init() {
        bindControlsEvents();
        bindGroupsEvents();
        bindSidebarEvents();
        bindDragEvents();
        bindModalEvents();
        loadData();
    }

    init();
})();
