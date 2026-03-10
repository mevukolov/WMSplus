(function () {
    if (!window.supabaseClient) {
        console.error("supabaseClient missing — ui.js must be loaded first");
        return;
    }

    const tbody = document.getElementById("wh-tbody");
    const btnAddWh = document.getElementById("btn-add-wh");

    const whModal = document.getElementById("wh-modal");
    const whModalTitle = document.getElementById("modal-title");
    const inpWhId = document.getElementById("inp-wh-id");
    const inpWhName = document.getElementById("inp-wh-name");
    const btnSaveWh = document.getElementById("btn-save-wh");
    const btnCloseWh = document.getElementById("btn-close-wh");

    const placesModal = document.getElementById("places-modal");
    const placesModalTitle = document.getElementById("places-modal-title");
    const placesList = document.getElementById("places-list");
    const btnAddPlace = document.getElementById("btn-add-place");
    const btnClosePlaces = document.getElementById("btn-close-places");

    const placeModal = document.getElementById("place-modal");
    const placeTitle = document.getElementById("place-modal-title");
    const inpPlaceName = document.getElementById("inp-place-name");
    const inpPlaceType = document.getElementById("inp-place-type");
    const txtPlaceId = document.getElementById("txt-place-id");
    const txtPlaceSticker = document.getElementById("txt-place-sticker");
    const btnShowSticker = document.getElementById("btn-show-sticker");
    const btnSavePlace = document.getElementById("btn-save-place");
    const btnClosePlace = document.getElementById("btn-close-place");

    const dataModal = document.getElementById("data-modal");
    const dataModalTitle = document.getElementById("data-modal-title");
    const dataList = document.getElementById("data-list");
    const btnOpenCreateData = document.getElementById("btn-open-create-data");
    const btnCloseData = document.getElementById("btn-close-data");

    const dataCreateModal = document.getElementById("data-create-modal");
    const inpDataType = document.getElementById("inp-data-type");
    const inpDataValue = document.getElementById("inp-data-value");
    const btnCreateData = document.getElementById("btn-create-data");
    const btnCloseCreateData = document.getElementById("btn-close-create-data");

    const stickerModal = document.getElementById("sticker-modal");
    const stickerCanvas = document.getElementById("sticker-canvas");
    const btnDownloadSticker = document.getElementById("btn-download-sticker");
    const btnPrintSticker = document.getElementById("btn-print-sticker");
    const btnCloseSticker = document.getElementById("btn-close-sticker");

    const modalStack = [];

    let whList = [];
    let places = [];

    let editWhId = null;
    let placesWhId = null;
    let editPlaceId = null;
    let dataWhId = null;
    let currentStickerPlace = null;

    function normalizeWhId(value) {
        const raw = String(value ?? "").trim();
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

    function placeTypeLabel(type) {
        return ({ 1: "Стол", 2: "Передача", 3: "Основное МХ" })[Number(type)] || String(type ?? "—");
    }

    function formatDataValue(value) {
        if (value === null || value === undefined) return "—";
        if (typeof value === "object") {
            try {
                return JSON.stringify(value, null, 2);
            } catch (_) {
                return String(value);
            }
        }
        return String(value);
    }

    function setReadOnlyTextField(el, isReadOnly) {
        if (!el) return;
        el.readOnly = isReadOnly;
        el.style.background = isReadOnly ? "#eee" : "";
        el.style.color = isReadOnly ? "#6b7280" : "";
        el.style.cursor = isReadOnly ? "not-allowed" : "";
    }

    function setDisabledField(el, isDisabled) {
        if (!el) return;
        el.disabled = isDisabled;
        el.style.background = isDisabled ? "#eee" : "";
        el.style.color = isDisabled ? "#6b7280" : "";
        el.style.cursor = isDisabled ? "not-allowed" : "";
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
        modal.addEventListener("click", (e) => {
            if (e.target === modal || e.target.classList.contains("modal-backdrop")) {
                closeHandler();
            }
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        const top = modalStack[modalStack.length - 1];
        if (!top?.close) return;
        e.preventDefault();
        top.close();
    });

    function getWhById(whId) {
        return whList.find(w => String(w.wh_id) === String(whId)) || null;
    }

    async function loadData() {
        const [{ data: wh, error: whError }, { data: plc, error: plcError }] = await Promise.all([
            supabaseClient.from("wh_rep").select("*").order("wh_id"),
            supabaseClient.from("places").select("*").order("place")
        ]);

        if (whError || plcError) {
            console.error("Ошибка загрузки данных:", whError || plcError);
            MiniUI.toast("Ошибка загрузки данных", { type: "error" });
            return;
        }

        whList = Array.isArray(wh) ? wh : [];
        places = Array.isArray(plc) ? plc : [];

        renderWhTable();

        if (placesWhId !== null) {
            renderPlacesEditor(placesWhId);
        }
    }

    function renderWhTable() {
        if (!Array.isArray(whList) || !whList.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="padding:14px;text-align:center;color:#6b7280;">СЦ пока не добавлены</td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = "";

        whList.forEach((w) => {
            const count = places.filter(p => String(p.wh_id) === String(w.wh_id)).length;
            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td style="padding:8px;">${escapeHtml(w.wh_id)}</td>
                <td style="padding:8px;">${escapeHtml(w.wh_name)}</td>
                <td style="padding:8px;">${count}</td>
                <td style="padding:8px;">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button class="btn btn-outline" data-id="${escapeHtml(w.wh_id)}" data-act="edit-wh">✏️ СЦ</button>
                        <button class="btn btn-outline" data-id="${escapeHtml(w.wh_id)}" data-act="manage-places">Управление МХ</button>
                        <button class="btn btn-outline" data-id="${escapeHtml(w.wh_id)}" data-act="manage-data">Управление контейнерами данных</button>
                        <button class="btn btn-outline" data-id="${escapeHtml(w.wh_id)}" data-act="del-wh">🗑️</button>
                    </div>
                </td>
            `;

            tbody.appendChild(tr);
        });
    }

    function openWhModal(wh = null) {
        editWhId = wh?.wh_id ?? null;

        if (wh) {
            whModalTitle.textContent = "Карточка СЦ";
            inpWhId.value = wh.wh_id ?? "";
            inpWhName.value = wh.wh_name ?? "";
            setReadOnlyTextField(inpWhId, true);
            setReadOnlyTextField(inpWhName, true);
            btnSaveWh.disabled = true;
            btnSaveWh.style.opacity = "0.6";
            btnSaveWh.style.cursor = "not-allowed";
        } else {
            whModalTitle.textContent = "Добавить СЦ";
            inpWhId.value = "";
            inpWhName.value = "";
            setReadOnlyTextField(inpWhId, false);
            setReadOnlyTextField(inpWhName, false);
            btnSaveWh.disabled = false;
            btnSaveWh.style.opacity = "1";
            btnSaveWh.style.cursor = "";
            setTimeout(() => inpWhId.focus(), 0);
        }

        showModal(whModal, closeWhModal);
    }

    function closeWhModal() {
        hideModal(whModal);
        editWhId = null;
        setReadOnlyTextField(inpWhId, false);
        setReadOnlyTextField(inpWhName, false);
        btnSaveWh.disabled = false;
        btnSaveWh.style.opacity = "1";
        btnSaveWh.style.cursor = "";
    }

    async function saveWh() {
        if (editWhId !== null) {
            closeWhModal();
            return;
        }

        const wh_id = inpWhId.value.trim();
        const wh_name = inpWhName.value.trim();

        if (!wh_id) return MiniUI.alert("ID обязателен");
        if (!wh_name) return MiniUI.alert("Название обязательно");

        const wh_id_fixed = normalizeWhId(wh_id);

        const { error } = await supabaseClient
            .from("wh_rep")
            .upsert({ wh_id: wh_id_fixed, wh_name });

        if (error) {
            console.error("Ошибка сохранения СЦ:", error);
            MiniUI.toast("Не удалось сохранить СЦ", { type: "error" });
            return;
        }

        await loadData();
        closeWhModal();
    }

    async function deleteWh(whId) {
        const ok = await MiniUI.confirm("Удалить СЦ и все его МХ/контейнеры данных?", { title: "Удаление" });
        if (!ok) return;

        const wh_id_fixed = normalizeWhId(whId);

        const { error: whError } = await supabaseClient
            .from("wh_rep")
            .delete()
            .eq("wh_id", wh_id_fixed);

        if (whError) {
            console.error("Ошибка удаления СЦ:", whError);
            MiniUI.toast("Ошибка удаления СЦ", { type: "error" });
            return;
        }

        const [{ error: placesError }, { error: dataError }] = await Promise.all([
            supabaseClient.from("places").delete().eq("wh_id", wh_id_fixed),
            supabaseClient.from("wh_data_rep").delete().eq("wh_id", wh_id_fixed)
        ]);

        if (placesError || dataError) {
            console.error("Ошибка удаления связей СЦ:", placesError || dataError);
            MiniUI.toast("СЦ удален, но часть связанных данных удалить не удалось", { type: "error" });
        }

        if (String(placesWhId) === String(whId)) {
            closeStickerModal();
            closePlaceModal();
            closePlacesModal();
        }
        if (String(dataWhId) === String(whId)) {
            closeCreateDataModal();
            closeDataModal();
        }

        await loadData();
    }

    async function onWhAction(e) {
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;

        const id = btn.dataset.id;
        const act = btn.dataset.act;

        if (!id) return;

        if (act === "edit-wh") {
            const wh = getWhById(id);
            if (!wh) return MiniUI.toast("СЦ не найден", { type: "error" });
            openWhModal(wh);
        }

        if (act === "manage-places") {
            await openPlacesModal(id);
        }

        if (act === "manage-data") {
            await openDataModal(id);
        }

        if (act === "del-wh") {
            await deleteWh(id);
        }
    }

    async function openPlacesModal(whId) {
        const wh = getWhById(whId);
        if (!wh) return MiniUI.toast("СЦ не найден", { type: "error" });

        placesWhId = wh.wh_id;
        placesModalTitle.textContent = `Управление МХ — ${wh.wh_name} (${wh.wh_id})`;

        renderPlacesEditor(placesWhId);
        showModal(placesModal, closePlacesModal);
    }

    function closePlacesModal() {
        closeStickerModal();
        closePlaceModal();
        hideModal(placesModal);
        placesWhId = null;
    }

    function renderPlacesEditor(whId) {
        if (whId === null || whId === undefined) {
            placesList.innerHTML = `<div style="color:#6b7280;">Сначала выберите СЦ</div>`;
            return;
        }

        const whPlaces = places
            .filter(p => String(p.wh_id) === String(whId))
            .sort((a, b) => String(a.place ?? "").localeCompare(String(b.place ?? ""), "ru"));

        if (!whPlaces.length) {
            placesList.innerHTML = `<div style="color:#6b7280;">Для этого СЦ пока нет мест хранения</div>`;
            return;
        }

        placesList.innerHTML = "";

        whPlaces.forEach((p) => {
            const div = document.createElement("div");
            div.style.padding = "10px 8px";
            div.style.borderBottom = "1px solid #e5e7eb";

            div.innerHTML = `
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
                    <div style="min-width:260px;">
                        <div><b>${escapeHtml(p.place)}</b> — ${escapeHtml(p.place_name)}</div>
                        <small>Тип: ${escapeHtml(placeTypeLabel(p.place_type))}</small><br>
                        <small>Стикер: ${escapeHtml(p.place_sticker || "—")}</small>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-outline" data-place="${escapeHtml(p.place)}" data-act="edit-place">✏️</button>
                        <button class="btn btn-outline" data-place="${escapeHtml(p.place)}" data-act="del-place">🗑️</button>
                    </div>
                </div>
            `;

            placesList.appendChild(div);
        });
    }

    async function onPlaceAction(e) {
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;

        const placeId = btn.dataset.place;
        const act = btn.dataset.act;

        if (!placeId) return;

        if (act === "del-place") {
            const ok = await MiniUI.confirm("Удалить МХ?", { title: "Удаление МХ" });
            if (!ok) return;

            const { error } = await supabaseClient
                .from("places")
                .delete()
                .eq("place", String(placeId));

            if (error) {
                console.error("Ошибка удаления МХ:", error);
                MiniUI.toast("Не удалось удалить МХ", { type: "error" });
                return;
            }

            await loadData();
            return;
        }

        if (act === "edit-place") {
            const plc = places.find(p => String(p.place) === String(placeId));
            if (!plc) return MiniUI.toast("МХ не найден", { type: "error" });
            openPlaceModal(plc);
        }
    }

    function setPlaceFieldsReadOnly(readOnly) {
        setReadOnlyTextField(inpPlaceName, readOnly);
        setDisabledField(inpPlaceType, readOnly);
    }

    function openPlaceModal(plc = null) {
        editPlaceId = plc?.place ?? null;

        if (plc) {
            placeTitle.textContent = "Редактирование МХ";
            txtPlaceId.textContent = plc.place ?? "—";
            txtPlaceSticker.textContent = plc.place_sticker || "—";
            txtPlaceSticker.style.display = "block";
            btnShowSticker.style.display = "inline-block";
            btnShowSticker.onclick = () => showSticker(plc);

            inpPlaceName.value = plc.place_name || "";
            inpPlaceType.value = String(plc.place_type ?? "1");

            setPlaceFieldsReadOnly(true);
            btnSavePlace.style.display = "none";
        } else {
            if (placesWhId === null || placesWhId === undefined) {
                MiniUI.alert("Сначала откройте управление МХ для нужного СЦ");
                return;
            }

            placeTitle.textContent = "Создать МХ";
            txtPlaceId.textContent = "(будет сгенерирован)";
            txtPlaceSticker.textContent = "(будет сгенерирован)";
            txtPlaceSticker.style.display = "block";
            btnShowSticker.style.display = "none";
            btnShowSticker.onclick = null;

            inpPlaceName.value = "";
            inpPlaceType.value = "1";

            setPlaceFieldsReadOnly(false);
            btnSavePlace.style.display = "inline-block";
            setTimeout(() => inpPlaceName.focus(), 0);
        }

        showModal(placeModal, closePlaceModal);
    }

    function closePlaceModal() {
        hideModal(placeModal);
        editPlaceId = null;
        setPlaceFieldsReadOnly(false);
        btnSavePlace.style.display = "inline-block";
    }

    async function savePlace() {
        if (editPlaceId) {
            MiniUI.toast("Редактирование существующего МХ отключено", { type: "info" });
            return;
        }

        const name = inpPlaceName.value.trim();
        const type = parseInt(inpPlaceType.value, 10);

        if (!name) return MiniUI.alert("Название МХ обязательно");
        if (![1, 2, 3].includes(type)) return MiniUI.alert("Неверный тип МХ");
        if (placesWhId === null || placesWhId === undefined) return MiniUI.alert("СЦ не выбран");

        const prefix = ({ 1: "TB", 2: "BX", 3: "PL" })[type];

        const usedNumbers = new Set(
            places
                .filter(p => String(p.place || "").startsWith(prefix))
                .map(p => parseInt(String(p.place).substring(2), 10))
                .filter(Number.isFinite)
        );

        let nextNum = 1;
        while (usedNumbers.has(nextNum)) nextNum++;

        const placeId = `${prefix}${String(nextNum).padStart(5, "0")}`;

        const fallbackNow = new Date();
        const nowParts = (window.MiniUI?.nowPartsPlus3
                ? window.MiniUI.nowPartsPlus3()
                : { hours: fallbackNow.getHours(), minutes: fallbackNow.getMinutes(), seconds: fallbackNow.getSeconds() }
        );
        const gent = (nowParts.hours * 10000 + nowParts.minutes * 100 + nowParts.seconds) * 6;
        const finalSticker = `$+${placesWhId}${placeId}${gent}`;

        const { error } = await supabaseClient
            .from("places")
            .upsert({
                place: placeId,
                place_name: name,
                wh_id: placesWhId,
                place_type: type,
                place_sticker: finalSticker
            });

        if (error) {
            console.error("Ошибка сохранения МХ:", error);
            MiniUI.toast("Не удалось сохранить МХ", { type: "error" });
            return;
        }

        await loadData();
        closePlaceModal();
    }

    async function openDataModal(whId) {
        const wh = getWhById(whId);
        if (!wh) return MiniUI.toast("СЦ не найден", { type: "error" });

        dataWhId = wh.wh_id;
        dataModalTitle.textContent = `Управление контейнерами данных — ${wh.wh_name} (${wh.wh_id})`;
        dataList.innerHTML = `<div style="color:#6b7280;">Загрузка...</div>`;
        showModal(dataModal, closeDataModal);

        await renderDataContainers();
    }

    function closeDataModal() {
        closeCreateDataModal();
        hideModal(dataModal);
        dataWhId = null;
    }

    async function renderDataContainers() {
        if (dataWhId === null || dataWhId === undefined) {
            dataList.innerHTML = `<div style="color:#6b7280;">СЦ не выбран</div>`;
            return;
        }

        const { data, error } = await supabaseClient
            .from("wh_data_rep")
            .select("*")
            .eq("wh_id", normalizeWhId(dataWhId));

        if (error) {
            console.error("Ошибка загрузки wh_data_rep:", error);
            dataList.innerHTML = `<div style="color:#b91c1c;">Не удалось загрузить контейнеры данных</div>`;
            MiniUI.toast("Ошибка загрузки контейнеров данных", { type: "error" });
            return;
        }

        const rows = (Array.isArray(data) ? data : []).sort((a, b) =>
            String(a.data_type ?? "").localeCompare(String(b.data_type ?? ""), "ru")
        );

        if (!rows.length) {
            dataList.innerHTML = `<div style="color:#6b7280;">Для этого СЦ контейнеры данных не найдены</div>`;
            return;
        }

        dataList.innerHTML = "";

        rows.forEach((row) => {
            const item = document.createElement("div");
            item.style.padding = "10px 8px";
            item.style.borderBottom = "1px solid #e5e7eb";

            item.innerHTML = `
                <div style="font-weight:600;">${escapeHtml(row.data_type || "—")}</div>
                <pre style="margin:6px 0 0;white-space:pre-wrap;word-break:break-word;">${escapeHtml(formatDataValue(row.data))}</pre>
            `;

            dataList.appendChild(item);
        });
    }

    function openCreateDataModal() {
        if (dataWhId === null || dataWhId === undefined) {
            MiniUI.alert("Сначала выберите СЦ");
            return;
        }

        inpDataType.value = "";
        inpDataValue.value = "";
        showModal(dataCreateModal, closeCreateDataModal);
        setTimeout(() => inpDataType.focus(), 0);
    }

    function closeCreateDataModal() {
        hideModal(dataCreateModal);
    }

    async function createDataContainer() {
        if (dataWhId === null || dataWhId === undefined) {
            MiniUI.alert("СЦ не выбран");
            return;
        }

        const dataType = inpDataType.value.trim();
        const rawValue = inpDataValue.value.trim();

        if (!dataType) return MiniUI.alert("Введите data_type");
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(dataType)) {
            return MiniUI.alert("data_type должен быть только на английском (A-Z, 0-9, _)");
        }
        if (!rawValue) return MiniUI.alert("Введите data");

        let payloadValue = rawValue;
        try {
            payloadValue = JSON.parse(rawValue);
        } catch (_) {
            payloadValue = rawValue;
        }

        const { error } = await supabaseClient
            .from("wh_data_rep")
            .insert({
                wh_id: normalizeWhId(dataWhId),
                data_type: dataType,
                data: payloadValue
            });

        if (error) {
            console.error("Ошибка создания контейнера данных:", error);
            MiniUI.toast("Не удалось создать контейнер данных", { type: "error" });
            return;
        }

        closeCreateDataModal();
        await renderDataContainers();
    }

    async function showSticker(plc) {
        currentStickerPlace = plc || null;

        try {
            await drawSticker(plc);
            showModal(stickerModal, closeStickerModal);
        } catch (err) {
            console.error("Ошибка генерации стикера:", err);
            MiniUI.toast("Не удалось построить стикер", { type: "error" });
        }
    }

    function closeStickerModal() {
        hideModal(stickerModal);
    }

    async function drawSticker(plc) {
        if (!plc) throw new Error("Place is required for sticker");

        const ctx = stickerCanvas.getContext("2d");

        const mhgen_place_sticker = plc.place_sticker || "";
        const mhgen_sc_id = String(plc.wh_id ?? "");
        const mhgen_place_id = String(plc.place ?? "");
        const mhgen_place_name = String(plc.place_name ?? "");
        const mhgen_place_type = ({ 1: "Стол", 2: "Передача", 3: "МХ" })[Number(plc.place_type)] || "МХ";

        const QR_SIZE = 200;
        const BAR_H_HEIGHT = 200;
        const BAR_V_WIDTH = 200;
        const OFFSET = 20;
        const MARGIN = 20;
        const CANVAS_SIZE = 1000;
        const FRAME_RADIUS = 20;
        const FRAME_LINE = 10;
        const LOGO_OFFSET = 12;
        const CENTER_QR_SIZE = 460;
        const BAR_H_WIDTH = CANVAS_SIZE - 2 * QR_SIZE - 2 * OFFSET - 2 * MARGIN;
        const BAR_V_HEIGHT = CANVAS_SIZE - 2 * QR_SIZE - 2 * OFFSET - 2 * MARGIN;

        const makeQR = (text, size = QR_SIZE) => new Promise((resolve) => {
            const div = document.createElement("div");
            new QRCode(div, { text, width: size, height: size, margin: 0 });
            setTimeout(() => resolve(div.querySelector("canvas")), 50);
        });

        const makeBarHScaled = (text) => {
            const temp = document.createElement("canvas");
            temp.width = 864;
            temp.height = BAR_H_HEIGHT;
            JsBarcode(temp, text, {
                format: "CODE128",
                displayValue: false,
                width: 3,
                height: BAR_H_HEIGHT,
                margin: 0
            });
            const c = document.createElement("canvas");
            c.width = BAR_H_WIDTH;
            c.height = BAR_H_HEIGHT;
            c.getContext("2d").drawImage(temp, 0, 0, BAR_H_WIDTH, BAR_H_HEIGHT);
            return c;
        };

        const makeBarV = (text) => {
            const temp = makeBarHScaled(text);
            const c = document.createElement("canvas");
            c.width = BAR_V_WIDTH;
            c.height = BAR_V_HEIGHT;
            const cctx = c.getContext("2d");
            cctx.save();
            cctx.translate(BAR_V_WIDTH, 0);
            cctx.rotate(Math.PI / 2);
            cctx.drawImage(temp, 0, 0);
            cctx.restore();
            return c;
        };

        const qr = await makeQR(mhgen_place_sticker, QR_SIZE);
        const centerQr = await makeQR(mhgen_place_sticker, CENTER_QR_SIZE);
        const barTop = makeBarHScaled(mhgen_place_sticker);
        const barLeft = makeBarV(mhgen_place_sticker);
        const barRight = makeBarV(mhgen_place_sticker);

        ctx.clearRect(0, 0, stickerCanvas.width, stickerCanvas.height);
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        ctx.drawImage(qr, MARGIN, MARGIN);
        ctx.drawImage(qr, CANVAS_SIZE - QR_SIZE - MARGIN, MARGIN);
        ctx.drawImage(qr, MARGIN, CANVAS_SIZE - QR_SIZE - MARGIN);
        ctx.drawImage(qr, CANVAS_SIZE - QR_SIZE - MARGIN, CANVAS_SIZE - QR_SIZE - MARGIN);

        ctx.drawImage(barTop, QR_SIZE + OFFSET + MARGIN, MARGIN);
        ctx.drawImage(barLeft, MARGIN, QR_SIZE + OFFSET + MARGIN);
        ctx.drawImage(barRight, CANVAS_SIZE - BAR_V_WIDTH - MARGIN, QR_SIZE + OFFSET + MARGIN);

        const frameX = QR_SIZE + OFFSET + MARGIN;
        const frameY = QR_SIZE + OFFSET + MARGIN;
        const frameWidth = CANVAS_SIZE - 2 * frameX;
        const frameHeight = CANVAS_SIZE - 2 * frameY;

        const centerQrX = Math.round((CANVAS_SIZE - CENTER_QR_SIZE) / 2);
        const centerQrY = Math.round((CANVAS_SIZE - CENTER_QR_SIZE) / 2);
        ctx.drawImage(centerQr, centerQrX, centerQrY);

        ctx.lineWidth = FRAME_LINE;
        ctx.strokeStyle = "black";
        ctx.beginPath();
        ctx.moveTo(frameX + FRAME_RADIUS, frameY);
        ctx.lineTo(frameX + frameWidth - FRAME_RADIUS, frameY);
        ctx.quadraticCurveTo(frameX + frameWidth, frameY, frameX + frameWidth, frameY + FRAME_RADIUS);
        ctx.lineTo(frameX + frameWidth, frameY + frameHeight - FRAME_RADIUS);
        ctx.quadraticCurveTo(frameX + frameWidth, frameY + frameHeight, frameX + frameWidth - FRAME_RADIUS, frameY + frameHeight);
        ctx.lineTo(frameX + FRAME_RADIUS, frameY + frameHeight);
        ctx.quadraticCurveTo(frameX, frameY + frameHeight, frameX, frameY + frameHeight - FRAME_RADIUS);
        ctx.lineTo(frameX, frameY + FRAME_RADIUS);
        ctx.quadraticCurveTo(frameX, frameY, frameX + FRAME_RADIUS, frameY);
        ctx.stroke();

        const bottomAreaX = QR_SIZE + OFFSET + MARGIN;
        const bottomAreaY = CANVAS_SIZE - BAR_H_HEIGHT - MARGIN;
        const bottomAreaW = BAR_H_WIDTH;
        const bottomTextX = bottomAreaX + 8;
        const bottomTextRightX = bottomAreaX + bottomAreaW - 8;

        ctx.fillStyle = "white";
        ctx.fillRect(bottomAreaX, bottomAreaY, bottomAreaW, BAR_H_HEIGHT);

        const wrapText = (text, maxWidth, maxLines) => {
            const words = String(text || "").trim().split(/\s+/).filter(Boolean);
            if (!words.length) return [""];

            const lines = [];
            let current = words[0];
            for (let i = 1; i < words.length; i++) {
                const test = `${current} ${words[i]}`;
                if (ctx.measureText(test).width <= maxWidth) {
                    current = test;
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
        };

        ctx.fillStyle = "black";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        ctx.font = "700 36px 'Inter', sans-serif";
        ctx.fillText(mhgen_place_type, bottomTextX, bottomAreaY + 12);

        ctx.font = "700 34px 'Inter', sans-serif";
        const nameLines = wrapText(mhgen_place_name, bottomAreaW - 16, 2);
        if (nameLines[0]) ctx.fillText(nameLines[0], bottomTextX, bottomAreaY + 56);
        if (nameLines[1]) ctx.fillText(nameLines[1], bottomTextX, bottomAreaY + 96);

        ctx.font = "700 28px 'Inter', sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("WMS+", bottomTextRightX - LOGO_OFFSET, bottomAreaY + 12);

        ctx.font = "600 30px 'Inter', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(mhgen_sc_id, bottomTextX, bottomAreaY + 170);
        ctx.textAlign = "right";
        ctx.fillText(mhgen_place_id, bottomTextRightX, bottomAreaY + 170);
    }

    function downloadSticker() {
        try {
            const dataUrl = stickerCanvas.toDataURL("image/png");
            const link = document.createElement("a");
            const rawName = currentStickerPlace
                ? `sticker_${currentStickerPlace.wh_id}_${currentStickerPlace.place}`
                : "sticker";
            const safeName = String(rawName).replace(/[^A-Za-z0-9_-]+/g, "_");
            link.href = dataUrl;
            link.download = `${safeName}.png`;
            link.click();
        } catch (err) {
            console.error("Ошибка скачивания стикера:", err);
            MiniUI.toast("Не удалось скачать стикер", { type: "error" });
        }
    }

    function printSticker() {
        try {
            const dataUrl = stickerCanvas.toDataURL("image/png");
            const w = window.open("", "_blank");
            if (!w) {
                MiniUI.toast("Разрешите всплывающие окна для печати", { type: "error" });
                return;
            }

            w.document.write(`
                <!doctype html>
                <html lang="ru">
                <head>
                    <meta charset="utf-8">
                    <title>Sticker Print</title>
                    <style>
                        html,body{margin:0;padding:0;background:#fff}
                        body{display:flex;justify-content:center;align-items:flex-start}
                        img{max-width:100vw;max-height:100vh}
                    </style>
                </head>
                <body>
                    <img id="sticker-img" src="${dataUrl}" alt="sticker">
                    <script>
                        const img = document.getElementById('sticker-img');
                        img.onload = () => window.print();
                        window.onafterprint = () => window.close();
                    </script>
                </body>
                </html>
            `);
            w.document.close();
        } catch (err) {
            console.error("Ошибка печати стикера:", err);
            MiniUI.toast("Не удалось отправить стикер в печать", { type: "error" });
        }
    }

    bindModalOverlayClose(whModal, closeWhModal);
    bindModalOverlayClose(placesModal, closePlacesModal);
    bindModalOverlayClose(placeModal, closePlaceModal);
    bindModalOverlayClose(dataModal, closeDataModal);
    bindModalOverlayClose(dataCreateModal, closeCreateDataModal);
    bindModalOverlayClose(stickerModal, closeStickerModal);

    tbody.addEventListener("click", onWhAction);
    placesList.addEventListener("click", onPlaceAction);

    btnAddWh.onclick = () => openWhModal(null);
    btnSaveWh.onclick = saveWh;
    btnCloseWh.onclick = closeWhModal;

    btnAddPlace.onclick = () => openPlaceModal(null);
    btnSavePlace.onclick = savePlace;
    btnClosePlace.onclick = closePlaceModal;
    btnClosePlaces.onclick = closePlacesModal;

    btnOpenCreateData.onclick = openCreateDataModal;
    btnCloseData.onclick = closeDataModal;
    btnCreateData.onclick = createDataContainer;
    btnCloseCreateData.onclick = closeCreateDataModal;

    btnCloseSticker.onclick = closeStickerModal;
    btnDownloadSticker.onclick = downloadSticker;
    btnPrintSticker.onclick = printSticker;

    loadData();
})();
