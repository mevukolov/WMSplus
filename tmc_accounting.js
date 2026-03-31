(function () {
    "use strict";

    const FURNITURE_TYPE = "Мебель";
    const ROWS_PER_PAGE = 7;
    const COLS_PER_PAGE = 4;
    const LABELS_PER_PAGE = ROWS_PER_PAGE * COLS_PER_PAGE;

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

    const introModal = document.getElementById("intro-modal");
    const manageModal = document.getElementById("manage-modal");
    const placeEditModal = document.getElementById("place-edit-modal");

    const btnOpenIntro = document.getElementById("btn-open-intro");
    const btnOpenManage = document.getElementById("btn-open-manage");

    const introItemNameEl = document.getElementById("intro-item-name");
    const introItemQtyEl = document.getElementById("intro-item-qty");
    const btnIntroSave = document.getElementById("btn-intro-save");
    const btnIntroClose = document.getElementById("btn-intro-close");

    const manageTbodyEl = document.getElementById("manage-tbody");
    const manageSelectAllEl = document.getElementById("manage-select-all");
    const manageActionsBarEl = document.getElementById("manage-actions-bar");
    const manageSelectedCountEl = document.getElementById("manage-selected-count");
    const btnManageDelete = document.getElementById("btn-manage-delete");
    const btnManagePrint = document.getElementById("btn-manage-print");
    const btnManageRefresh = document.getElementById("btn-manage-refresh");
    const btnManageClose = document.getElementById("btn-manage-close");
    const btnManageCloseTop = document.getElementById("btn-manage-close-top");
    const placeEditItemNameEl = document.getElementById("place-edit-item-name");
    const placeEditInputEl = document.getElementById("place-edit-input");
    const btnPlaceEditSave = document.getElementById("btn-place-edit-save");
    const btnPlaceEditCancel = document.getElementById("btn-place-edit-cancel");

    const subtitleEl = document.getElementById("tmc-subtitle");

    const modalStack = [];
    let warehouseNameCache = String(user?.wh_name || "").trim();
    let furnitureRows = [];
    let employeeFioMap = new Map();
    const selectedRowKeys = new Set();
    let isDragSelecting = false;
    let dragSelectValue = null;
    let editingPlaceRowKey = "";

    const currentWhId = normalizeWhId(user?.user_wh_id);
    if (currentWhId === null) {
        window.MiniUI?.toast?.("Не удалось определить user_wh_id пользователя", { type: "error" });
        return;
    }

    if (subtitleEl) {
        subtitleEl.textContent = `Работа с мебелью в эксплуатации текущего склада (WH: ${String(currentWhId)}).`;
    }

    function toast(message, opts = {}) {
        if (window.MiniUI?.toast) {
            window.MiniUI.toast(message, opts);
            return;
        }
        console.log(message);
    }

    function normalizeWhId(value) {
        const raw = String(value ?? "").trim();
        if (!raw) return null;
        if (/^-?\d+$/.test(raw)) return Number(raw);
        return raw;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function escapeRegExp(value) {
        return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function normalizeBaseName(value) {
        return String(value || "")
            .trim()
            .replace(/\s*№\s*\d+\s*$/i, "")
            .trim();
    }

    function parseItemNameForSort(itemName) {
        const raw = String(itemName || "").trim();
        const match = raw.match(/^(.*?)(?:\s*№\s*(\d+))$/i);
        if (!match) {
            return { base: raw, num: Number.NaN };
        }

        return {
            base: String(match[1] || "").trim(),
            num: Number.parseInt(match[2], 10)
        };
    }

    function compareFurnitureRows(a, b) {
        const aName = String(a?.item_name || "").trim();
        const bName = String(b?.item_name || "").trim();

        const aParsed = parseItemNameForSort(aName);
        const bParsed = parseItemNameForSort(bName);

        const baseCmp = aParsed.base.localeCompare(bParsed.base, "ru", { sensitivity: "base" });
        if (baseCmp !== 0) return baseCmp;

        const aHasNum = Number.isFinite(aParsed.num);
        const bHasNum = Number.isFinite(bParsed.num);

        if (aHasNum && bHasNum && aParsed.num !== bParsed.num) {
            return aParsed.num - bParsed.num;
        }

        if (aHasNum && !bHasNum) return -1;
        if (!aHasNum && bHasNum) return 1;

        return aName.localeCompare(bName, "ru", { sensitivity: "base" });
    }

    function toRowKey(row) {
        return `${String(row?.item_code || "").trim()}|${String(row?.item_name || "").trim()}`;
    }

    function formatInventDate(value) {
        if (!value) return "—";
        try {
            return new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
        } catch (_) {
            try {
                return new Date(value).toLocaleString("ru-RU");
            } catch (__) {
                return "—";
            }
        }
    }

    function isInventRecent(value) {
        if (!value) return false;
        const ts = Date.parse(String(value));
        if (!Number.isFinite(ts)) return false;

        const now = new Date();
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return ts >= monthAgo.getTime() && ts <= now.getTime();
    }

    async function loadEmployeeFioMap(rows) {
        const ids = Array.from(new Set(
            (rows || [])
                .map((row) => String(row?.emp_invent || "").trim())
                .filter(Boolean)
        ));
        if (!ids.length) return new Map();

        const { data, error } = await supabaseClient
            .from("users")
            .select("id, fio")
            .in("id", ids);

        if (error) {
            console.error("Ошибка чтения users для emp_invent:", error);
            return new Map();
        }

        const map = new Map();
        (data || []).forEach((row) => {
            const id = String(row?.id || "").trim();
            if (!id) return;
            map.set(id, String(row?.fio || "").trim());
        });
        return map;
    }

    function setButtonsDisabled(buttons, disabled) {
        (buttons || []).forEach((btn) => {
            if (!btn) return;
            btn.disabled = disabled;
            btn.style.opacity = disabled ? "0.65" : "";
            btn.style.cursor = disabled ? "not-allowed" : "";
        });
    }

    function showModal(modal, closeHandler) {
        if (!modal || !modal.classList.contains("hidden")) return;
        modal.classList.remove("hidden");
        modalStack.push({ id: modal.id, close: closeHandler });
    }

    function hideModal(modal) {
        if (!modal || modal.classList.contains("hidden")) return;
        modal.classList.add("hidden");
        for (let i = modalStack.length - 1; i >= 0; i--) {
            if (modalStack[i].id === modal.id) {
                modalStack.splice(i, 1);
                break;
            }
        }
    }

    function bindModalOverlayClose(modal, closeHandler) {
        if (!modal) return;
        modal.addEventListener("click", (event) => {
            if (event.target === modal || event.target.classList.contains("modal-backdrop")) {
                closeHandler();
            }
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        const top = modalStack[modalStack.length - 1];
        if (!top?.close) return;
        event.preventDefault();
        top.close();
    });

    async function getWarehouseName() {
        if (warehouseNameCache) return warehouseNameCache;
        const { data, error } = await supabaseClient
            .from("wh_rep")
            .select("wh_name")
            .eq("wh_id", currentWhId)
            .maybeSingle();

        if (error) {
            console.error("Ошибка загрузки wh_name:", error);
            return "";
        }

        warehouseNameCache = String(data?.wh_name || "").trim();
        return warehouseNameCache;
    }

    function openIntroModal() {
        introItemNameEl.value = "";
        introItemQtyEl.value = "1";
        showModal(introModal, closeIntroModal);
        setTimeout(() => introItemNameEl.focus(), 0);
    }

    function closeIntroModal() {
        hideModal(introModal);
    }

    async function createFurnitureItems() {
        const baseName = normalizeBaseName(introItemNameEl.value);
        const quantity = Number.parseInt(String(introItemQtyEl.value || "").trim(), 10);

        if (!baseName) {
            toast("Введите название мебели", { type: "error" });
            return;
        }
        if (!Number.isFinite(quantity) || quantity < 1) {
            toast("Количество должно быть целым числом от 1", { type: "error" });
            return;
        }

        setButtonsDisabled([btnIntroSave, btnIntroClose], true);

        try {
            const { data: existingRows, error: existingError } = await supabaseClient
                .from("tmc_rep")
                .select("item_name")
                .eq("type", FURNITURE_TYPE)
                .eq("wh_id", currentWhId)
                .ilike("item_name", `${baseName} №%`);

            if (existingError) {
                console.error("Ошибка чтения tmc_rep:", existingError);
                toast("Не удалось загрузить существующие позиции", { type: "error" });
                return;
            }

            const re = new RegExp(`^${escapeRegExp(baseName)}\\s*№\\s*(\\d+)$`, "i");
            let maxNumber = 0;
            (existingRows || []).forEach((row) => {
                const match = re.exec(String(row?.item_name || "").trim());
                if (!match) return;
                const parsed = Number.parseInt(match[1], 10);
                if (Number.isFinite(parsed) && parsed > maxNumber) maxNumber = parsed;
            });

            const whName = (await getWarehouseName()) || String(user?.wh_name || "").trim() || `WH ${String(currentWhId)}`;
            const payload = [];

            for (let i = 0; i < quantity; i++) {
                const itemNumber = maxNumber + i + 1;
                const itemName = `${baseName} №${itemNumber}`;
                const itemCode = `${whName}, ${itemName}`;

                payload.push({
                    type: FURNITURE_TYPE,
                    item_name: itemName,
                    item_code: itemCode,
                    wh_id: currentWhId,
                    item_place: null
                });
            }

            const { error: insertError } = await supabaseClient
                .from("tmc_rep")
                .insert(payload);

            if (insertError) {
                console.error("Ошибка вставки tmc_rep:", insertError);
                toast("Не удалось ввести мебель в эксплуатацию", { type: "error" });
                return;
            }

            toast(`Добавлено предметов: ${payload.length}`, { type: "success" });
            closeIntroModal();

            if (!manageModal.classList.contains("hidden")) {
                await loadFurnitureRows();
            }
        } catch (error) {
            console.error("createFurnitureItems failed:", error);
            toast("Ошибка выполнения операции", { type: "error" });
        } finally {
            setButtonsDisabled([btnIntroSave, btnIntroClose], false);
        }
    }

    function openManageModal() {
        showModal(manageModal, closeManageModal);
        loadFurnitureRows();
    }

    function closeManageModal() {
        closePlaceEditModal();
        hideModal(manageModal);
    }

    async function loadFurnitureRows() {
        manageTbodyEl.innerHTML = `
            <tr>
                <td colspan="5" class="tmc-muted">Загрузка...</td>
            </tr>
        `;

        selectedRowKeys.clear();
        manageSelectAllEl.checked = false;
        updateActionsBar();

        const { data, error } = await supabaseClient
            .from("tmc_rep")
            .select("type, item_name, item_code, item_place, wh_id, date_invent, emp_invent")
            .eq("type", FURNITURE_TYPE)
            .eq("wh_id", currentWhId);

        if (error) {
            console.error("Ошибка загрузки мебели из tmc_rep:", error);
            manageTbodyEl.innerHTML = `
                <tr>
                    <td colspan="5" class="tmc-muted">Не удалось загрузить данные</td>
                </tr>
            `;
            toast("Ошибка загрузки мебели", { type: "error" });
            return;
        }

        const rows = Array.isArray(data) ? data : [];
        employeeFioMap = await loadEmployeeFioMap(rows);
        furnitureRows = rows.sort(compareFurnitureRows);
        renderFurnitureRows();
    }

    function renderFurnitureRows() {
        if (!furnitureRows.length) {
            manageTbodyEl.innerHTML = `
                <tr>
                    <td colspan="5" class="tmc-muted">По текущему складу мебель не найдена</td>
                </tr>
            `;
            updateActionsBar();
            return;
        }

        manageTbodyEl.innerHTML = furnitureRows.map((row, index) => {
            const key = toRowKey(row);
            const itemPlace = String(row?.item_place || "").trim() || "Не заполнен";
            const isEmptyPlace = !String(row?.item_place || "").trim();
            const dateInventText = formatInventDate(row?.date_invent);
            const empId = String(row?.emp_invent || "").trim();
            const fio = empId
                ? (employeeFioMap.get(empId) || "Сотрудник не найден")
                : "—";
            const rowClass = isInventRecent(row?.date_invent) ? "invent-row-recent" : "invent-row-stale";

            return `
                <tr data-row-index="${index}" class="${rowClass}">
                    <td class="manage-select-cell" data-row-key="${escapeHtml(key)}" title="Кликните или проведите мышкой для выделения">
                        <input type="checkbox" class="manage-row-check" data-row-key="${escapeHtml(key)}" />
                    </td>
                    <td>${escapeHtml(row?.item_name || "—")}</td>
                    <td>
                        <button
                            type="button"
                            class="manage-place-btn ${isEmptyPlace ? "tmc-muted" : ""}"
                            data-row-key="${escapeHtml(key)}"
                            title="Нажмите, чтобы изменить место расположения"
                        >${escapeHtml(itemPlace)}</button>
                    </td>
                    <td>${escapeHtml(dateInventText)}</td>
                    <td>${escapeHtml(fio)}</td>
                </tr>
            `;
        }).join("");

        updateActionsBar();
    }

    function updateActionsBar() {
        const count = selectedRowKeys.size;
        manageSelectedCountEl.textContent = `Выбрано: ${count}`;
        manageActionsBarEl.classList.toggle("hidden", count === 0);

        const rowChecks = Array.from(manageTbodyEl.querySelectorAll(".manage-row-check"));
        const total = rowChecks.length;
        const selectedInDom = rowChecks.filter((el) => el.checked).length;

        if (!total) {
            manageSelectAllEl.checked = false;
            manageSelectAllEl.indeterminate = false;
            return;
        }

        manageSelectAllEl.checked = selectedInDom > 0 && selectedInDom === total;
        manageSelectAllEl.indeterminate = selectedInDom > 0 && selectedInDom < total;
    }

    function setRowSelectionByCheckbox(checkbox, checked) {
        if (!checkbox) return false;
        const rowKey = String(checkbox.dataset.rowKey || "");
        if (!rowKey) return false;

        const next = !!checked;
        const changed = checkbox.checked !== next;
        checkbox.checked = next;

        if (next) selectedRowKeys.add(rowKey);
        else selectedRowKeys.delete(rowKey);

        return changed;
    }

    function handleRowSelectionChange(event) {
        const check = event.target.closest(".manage-row-check");
        if (!check) return;
        setRowSelectionByCheckbox(check, check.checked);
        updateActionsBar();
    }

    function handleSelectAllChange() {
        const checks = Array.from(manageTbodyEl.querySelectorAll(".manage-row-check"));
        const shouldCheck = !!manageSelectAllEl.checked;

        checks.forEach((check) => {
            setRowSelectionByCheckbox(check, shouldCheck);
        });

        updateActionsBar();
    }

    function handleSelectionMouseDown(event) {
        const cell = event.target.closest(".manage-select-cell");
        if (!cell || !manageTbodyEl.contains(cell)) return;

        const checkbox = cell.querySelector(".manage-row-check");
        if (!checkbox) return;

        event.preventDefault();
        const nextState = !checkbox.checked;
        setRowSelectionByCheckbox(checkbox, nextState);

        isDragSelecting = true;
        dragSelectValue = nextState;
        updateActionsBar();
    }

    function handleSelectionMouseOver(event) {
        if (!isDragSelecting) return;

        const row = event.target.closest("tr");
        if (!row || !manageTbodyEl.contains(row)) return;

        const checkbox = row.querySelector(".manage-row-check");
        if (!checkbox) return;

        const changed = setRowSelectionByCheckbox(checkbox, dragSelectValue);
        if (changed) updateActionsBar();
    }

    function stopDragSelection() {
        if (!isDragSelecting) return;
        isDragSelecting = false;
        dragSelectValue = null;
        updateActionsBar();
    }

    function openPlaceEditModalByRowKey(rowKey) {
        const targetKey = String(rowKey || "").trim();
        if (!targetKey) return;

        const row = furnitureRows.find((item) => toRowKey(item) === targetKey);
        if (!row) return;

        editingPlaceRowKey = targetKey;
        placeEditItemNameEl.textContent = String(row?.item_name || "").trim() || "—";
        placeEditInputEl.value = String(row?.item_place || "").trim();
        showModal(placeEditModal, closePlaceEditModal);
        setTimeout(() => {
            placeEditInputEl.focus();
            placeEditInputEl.select();
        }, 0);
    }

    function closePlaceEditModal() {
        hideModal(placeEditModal);
        editingPlaceRowKey = "";
        placeEditInputEl.value = "";
        placeEditItemNameEl.textContent = "";
    }

    async function savePlaceEdit() {
        const targetKey = String(editingPlaceRowKey || "").trim();
        if (!targetKey) return;

        const row = furnitureRows.find((item) => toRowKey(item) === targetKey);
        if (!row) {
            closePlaceEditModal();
            return;
        }

        const currentPlace = String(row?.item_place || "").trim();
        const nextPlace = String(placeEditInputEl.value || "").trim();
        if (nextPlace === currentPlace) {
            closePlaceEditModal();
            return;
        }

        setButtonsDisabled(
            [btnManageDelete, btnManagePrint, btnManageRefresh, btnPlaceEditSave, btnPlaceEditCancel],
            true
        );

        try {
            const { error } = await supabaseClient
                .from("tmc_rep")
                .update({ item_place: nextPlace || null })
                .eq("type", FURNITURE_TYPE)
                .eq("wh_id", currentWhId)
                .eq("item_code", String(row?.item_code || "").trim())
                .eq("item_name", String(row?.item_name || "").trim());

            if (error) {
                console.error("Ошибка обновления item_place:", error);
                toast("Не удалось обновить место расположения", { type: "error" });
                return;
            }

            toast("Место расположения обновлено", { type: "success" });
            closePlaceEditModal();
            await loadFurnitureRows();
        } catch (updateError) {
            console.error("savePlaceEdit failed:", updateError);
            toast("Ошибка обновления места расположения", { type: "error" });
        } finally {
            setButtonsDisabled(
                [btnManageDelete, btnManagePrint, btnManageRefresh, btnPlaceEditSave, btnPlaceEditCancel],
                false
            );
        }
    }

    function handlePlaceButtonClick(event) {
        const btn = event.target.closest(".manage-place-btn");
        if (!btn || !manageTbodyEl.contains(btn)) return;

        const rowKey = String(btn.dataset.rowKey || "");
        if (!rowKey) return;
        openPlaceEditModalByRowKey(rowKey);
    }

    function getSelectedRows() {
        if (!selectedRowKeys.size) return [];
        const keys = selectedRowKeys;
        return furnitureRows.filter((row) => keys.has(toRowKey(row)));
    }

    async function deleteSelectedRows() {
        const selectedRows = getSelectedRows();
        if (!selectedRows.length) {
            toast("Выберите хотя бы один предмет", { type: "info" });
            return;
        }

        const ok = await window.MiniUI?.confirm?.(
            `Удалить выбранные предметы (${selectedRows.length} шт.)?`,
            { okText: "Удалить", cancelText: "Отмена" }
        );
        if (!ok) return;

        setButtonsDisabled([btnManageDelete, btnManagePrint, btnManageRefresh], true);

        try {
            const selectedCodes = Array.from(new Set(
                selectedRows
                    .map((row) => String(row?.item_code || "").trim())
                    .filter(Boolean)
            ));

            if (!selectedCodes.length) {
                toast("Не удалось определить item_code выбранных строк", { type: "error" });
                return;
            }

            const { error } = await supabaseClient
                .from("tmc_rep")
                .delete()
                .eq("type", FURNITURE_TYPE)
                .eq("wh_id", currentWhId)
                .in("item_code", selectedCodes);

            if (error) {
                console.error("Ошибка удаления tmc_rep:", error);
                toast("Не удалось удалить выбранные предметы", { type: "error" });
                return;
            }

            toast(`Удалено предметов: ${selectedRows.length}`, { type: "success" });
            await loadFurnitureRows();
        } catch (error) {
            console.error("deleteSelectedRows failed:", error);
            toast("Ошибка удаления", { type: "error" });
        } finally {
            setButtonsDisabled([btnManageDelete, btnManagePrint, btnManageRefresh], false);
        }
    }

    async function generateLabelsPdf() {
        const selectedRows = getSelectedRows();
        if (!selectedRows.length) {
            toast("Выберите хотя бы один предмет для печати", { type: "info" });
            return;
        }

        if (!window.jspdf?.jsPDF) {
            toast("PDF библиотека не загрузилась", { type: "error" });
            return;
        }

        if (!window.QRCode || typeof window.QRCode.toDataURL !== "function") {
            toast("QR библиотека не загрузилась", { type: "error" });
            return;
        }

        setButtonsDisabled([btnManageDelete, btnManagePrint, btnManageRefresh], true);

        try {
            const qrDataCache = new Map();
            for (const row of selectedRows) {
                const itemCode = String(row?.item_code || "").trim();
                if (!itemCode || qrDataCache.has(itemCode)) continue;

                try {
                    const dataUrl = await window.QRCode.toDataURL(itemCode, {
                        width: 560,
                        margin: 0,
                        errorCorrectionLevel: "M"
                    });
                    qrDataCache.set(itemCode, dataUrl);
                } catch (qrError) {
                    console.error("Ошибка генерации QR для item_code:", itemCode, qrError);
                    qrDataCache.set(itemCode, null);
                }
            }

            const qrImageCache = new Map();
            for (const [itemCode, dataUrl] of qrDataCache.entries()) {
                if (!dataUrl) {
                    qrImageCache.set(itemCode, null);
                    continue;
                }

                try {
                    const image = await loadImage(dataUrl);
                    qrImageCache.set(itemCode, image);
                } catch (loadError) {
                    console.error("Ошибка загрузки QR картинки:", itemCode, loadError);
                    qrImageCache.set(itemCode, null);
                }
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
            const pageWidth = 297;
            const pageHeight = 210;
            const marginLeft = 8;
            const marginRight = 8;
            const marginTop = 8;
            const marginBottom = 8;
            const gapX = 1;
            const gapY = 1;
            const labelWidth = (pageWidth - marginLeft - marginRight - gapX * (COLS_PER_PAGE - 1)) / COLS_PER_PAGE;
            const labelHeight = (pageHeight - marginTop - marginBottom - gapY * (ROWS_PER_PAGE - 1)) / ROWS_PER_PAGE;

            const pagesCount = Math.max(1, Math.ceil(selectedRows.length / LABELS_PER_PAGE));
            for (let pageIndex = 0; pageIndex < pagesCount; pageIndex++) {
                if (pageIndex > 0) doc.addPage("a4", "landscape");
                drawPageGrid(doc, marginLeft, marginTop, labelWidth, labelHeight, gapX, gapY);

                const pageRows = selectedRows.slice(
                    pageIndex * LABELS_PER_PAGE,
                    (pageIndex + 1) * LABELS_PER_PAGE
                );

                for (let indexOnPage = 0; indexOnPage < pageRows.length; indexOnPage++) {
                    const row = pageRows[indexOnPage];
                    const rowIndex = Math.floor(indexOnPage / COLS_PER_PAGE);
                    const colIndex = indexOnPage % COLS_PER_PAGE;
                    const x = marginLeft + colIndex * (labelWidth + gapX);
                    const y = marginTop + rowIndex * (labelHeight + gapY);
                    const itemCode = String(row?.item_code || "").trim();
                    const qrImage = qrImageCache.get(itemCode) || null;

                    // Рендерим текст на canvas, чтобы корректно печаталась кириллица в PDF.
                    const labelDataUrl = renderLabelCanvasDataUrl(row, qrImage);
                    if (labelDataUrl) {
                        doc.addImage(labelDataUrl, "PNG", x, y, labelWidth, labelHeight, undefined, "FAST");
                    }
                }
            }


            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, "0");
            const d = String(now.getDate()).padStart(2, "0");
            const h = String(now.getHours()).padStart(2, "0");
            const min = String(now.getMinutes()).padStart(2, "0");
            const fileName = `tmc_labels_${String(currentWhId)}_${y}${m}${d}_${h}${min}.pdf`;

            doc.save(fileName);
            toast(`PDF сформирован: ${selectedRows.length} этикеток`, { type: "success" });
        } catch (error) {
            console.error("generateLabelsPdf failed:", error);
            toast("Не удалось сформировать PDF", { type: "error" });
        } finally {
            setButtonsDisabled([btnManageDelete, btnManagePrint, btnManageRefresh], false);
        }
    }

    function drawPageGrid(doc, marginLeft, marginTop, labelWidth, labelHeight, gapX, gapY) {
        doc.setDrawColor(31, 41, 55);
        doc.setLineWidth(0.2);

        for (let r = 0; r < ROWS_PER_PAGE; r++) {
            for (let c = 0; c < COLS_PER_PAGE; c++) {
                const x = marginLeft + c * (labelWidth + gapX);
                const y = marginTop + r * (labelHeight + gapY);
                doc.rect(x, y, labelWidth, labelHeight);
            }
        }
    }

    function renderLabelCanvasDataUrl(row, qrImage) {
        const canvas = document.createElement("canvas");
        const w = 1120;
        const h = 430;
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);

        const padX = 34;
        const padTop = 20;
        const itemName = String(row?.item_name || "").trim() || "Без названия";
        const whLabel = resolveWarehouseTitle(row);
        const maxTextWidth = w - padX * 2;

        ctx.fillStyle = "#111827";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        const centerX = w / 2;
        const qrSize = 250;
        const qrBottomPad = 14;
        const qrY = h - qrBottomPad - qrSize;
        const textBottomLimit = qrY - 8;
        const textAreaHeight = Math.max(0, textBottomLimit - padTop);

        let whFontSize = 52;
        let nameFontSize = 50;
        const blockGap = 6;
        let whLines = [whLabel];
        let nameLines = [itemName];
        let whLineHeight = whFontSize + 2;
        let nameLineHeight = nameFontSize + 2;

        // Подбираем размер текста сверху вниз: стремимся к крупному размеру,
        // но гарантируем, что текст не зайдет на область QR.
        for (let attempt = 0; attempt < 8; attempt++) {
            whLineHeight = whFontSize + 2;
            nameLineHeight = nameFontSize + 2;

            ctx.font = `700 ${whFontSize}px Arial, sans-serif`;
            whLines = wrapCanvasText(ctx, whLabel, maxTextWidth, 2);
            ctx.font = `700 ${nameFontSize}px Arial, sans-serif`;
            nameLines = wrapCanvasText(ctx, itemName, maxTextWidth, 2);

            const blockHeight = whLines.length * whLineHeight
                + nameLines.length * nameLineHeight
                + (whLines.length && nameLines.length ? blockGap : 0);

            if (blockHeight <= textAreaHeight) {
                break;
            }

            whFontSize = Math.max(34, whFontSize - 3);
            nameFontSize = Math.max(32, nameFontSize - 3);
        }

        const textBlockHeight = whLines.length * whLineHeight
            + nameLines.length * nameLineHeight
            + (whLines.length && nameLines.length ? blockGap : 0);

        let cursorY = padTop + Math.max(0, (textAreaHeight - textBlockHeight) / 2);

        ctx.font = `700 ${whFontSize}px Arial, sans-serif`;
        whLines.forEach((line) => {
            ctx.fillText(line, centerX, cursorY);
            cursorY += whLineHeight;
        });

        if (whLines.length && nameLines.length) {
            cursorY += blockGap;
        }

        ctx.font = `700 ${nameFontSize}px Arial, sans-serif`;
        nameLines.forEach((line) => {
            ctx.fillText(line, centerX, cursorY);
            cursorY += nameLineHeight;
        });

        if (qrImage) {
            const qrLeftX = padX;
            const qrRightX = w - padX - qrSize;
            ctx.drawImage(qrImage, qrLeftX, qrY, qrSize, qrSize);
            ctx.drawImage(qrImage, qrRightX, qrY, qrSize, qrSize);
        }

        return canvas.toDataURL("image/png");
    }

    function wrapCanvasText(ctx, text, maxWidth, maxLines) {
        const normalized = String(text || "").trim();
        if (!normalized) return [""];

        const words = normalized.split(/\s+/).filter(Boolean);
        if (!words.length) return [normalized];

        const lines = [];
        let current = words[0];

        for (let i = 1; i < words.length; i++) {
            const testLine = `${current} ${words[i]}`;
            if (ctx.measureText(testLine).width <= maxWidth) {
                current = testLine;
            } else {
                lines.push(current);
                current = words[i];
                if (lines.length >= maxLines - 1) break;
            }
        }

        if (lines.length < maxLines) {
            lines.push(current);
        }

        return lines.slice(0, maxLines);
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("Image load failed"));
            image.src = src;
        });
    }

    function resolveWarehouseTitle(row) {
        const ownWarehouse = warehouseNameCache || String(user?.wh_name || "").trim();
        if (ownWarehouse) return ownWarehouse;

        const fromCode = String(row?.item_code || "");
        const commaIndex = fromCode.indexOf(",");
        if (commaIndex > 0) {
            return fromCode.slice(0, commaIndex).trim();
        }

        return `WH ${String(currentWhId)}`;
    }

    bindModalOverlayClose(introModal, closeIntroModal);
    bindModalOverlayClose(manageModal, closeManageModal);
    bindModalOverlayClose(placeEditModal, closePlaceEditModal);

    btnOpenIntro?.addEventListener("click", openIntroModal);
    btnOpenManage?.addEventListener("click", openManageModal);

    btnIntroClose?.addEventListener("click", closeIntroModal);
    btnIntroSave?.addEventListener("click", createFurnitureItems);

    btnManageClose?.addEventListener("click", closeManageModal);
    btnManageCloseTop?.addEventListener("click", closeManageModal);
    btnManageRefresh?.addEventListener("click", loadFurnitureRows);
    btnManageDelete?.addEventListener("click", deleteSelectedRows);
    btnManagePrint?.addEventListener("click", generateLabelsPdf);
    btnPlaceEditSave?.addEventListener("click", savePlaceEdit);
    btnPlaceEditCancel?.addEventListener("click", closePlaceEditModal);
    placeEditInputEl?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        savePlaceEdit();
    });

    manageTbodyEl?.addEventListener("change", handleRowSelectionChange);
    manageTbodyEl?.addEventListener("click", handlePlaceButtonClick);
    manageTbodyEl?.addEventListener("mousedown", handleSelectionMouseDown);
    manageTbodyEl?.addEventListener("mouseover", handleSelectionMouseOver);
    manageSelectAllEl?.addEventListener("change", handleSelectAllChange);
    document.addEventListener("mouseup", stopDragSelection);
})();
