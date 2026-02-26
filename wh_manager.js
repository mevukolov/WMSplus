(function () {

    if (!supabaseClient) {
        console.error("supabaseClient missing — ui.js must be loaded first");
    }

    // === ELEMENTS ===
    const tbody = document.getElementById("wh-tbody");
    const btnAddWh = document.getElementById("btn-add-wh");

    const modal = document.getElementById("wh-modal");
    const modalTitle = document.getElementById("modal-title");

    const inpWhId = document.getElementById("inp-wh-id");
    const inpWhName = document.getElementById("inp-wh-name");

    const placesList = document.getElementById("places-list");
    const btnAddPlace = document.getElementById("btn-add-place");

    const btnSaveWh = document.getElementById("btn-save-wh");
    const btnCloseWh = document.getElementById("btn-close-wh");

    const placeModal = document.getElementById("place-modal");
    const placeTitle = document.getElementById("place-modal-title");
    const inpPlaceName = document.getElementById("inp-place-name");
    const inpPlaceType = document.getElementById("inp-place-type");
    const txtPlaceId = document.getElementById("txt-place-id");
    const txtPlaceSticker = document.getElementById("txt-place-sticker");
    const btnShowSticker = document.getElementById("btn-show-sticker");
    const btnSavePlace = document.getElementById("btn-save-place");
    const btnClosePlace = document.getElementById("btn-close-place");

    const stickerModal = document.getElementById("sticker-modal");
    const stickerCanvas = document.getElementById("sticker-canvas");
    const btnDownloadSticker = document.getElementById("btn-download-sticker");
    const btnCloseSticker = document.getElementById("btn-close-sticker");

    // === STATE ===
    let whList = [];
    let places = [];
    let editWhId = null;
    let editPlaceId = null;

    // ----------------------------------------------------
    // LOAD DATA
    // ----------------------------------------------------
    async function loadData() {
        const [{ data: wh }, { data: plc }] = await Promise.all([
            supabaseClient.from("wh_rep").select("*").order("wh_id"),
            supabaseClient.from("places").select("*").order("place")
        ]);

        whList = wh || [];
        places = plc || [];

        renderWhTable();
        if (editWhId) renderPlacesEditor(editWhId);
    }

    // ----------------------------------------------------
    // RENDER WH TABLE
    // ----------------------------------------------------
    function renderWhTable() {
        tbody.innerHTML = "";

        whList.forEach(w => {
            const count = places.filter(p => String(p.wh_id) === String(w.wh_id)).length;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="padding:8px;">${w.wh_id}</td>
                <td style="padding:8px;">${w.wh_name}</td>
                <td style="padding:8px;">${count}</td>
                <td style="padding:8px;">
                    <button class="btn btn-outline" data-id="${w.wh_id}" data-act="edit">✏️</button>
                    <button class="btn btn-outline" data-id="${w.wh_id}" data-act="del">🗑️</button>
                </td>
            `;

            tr.querySelectorAll("button").forEach(b => b.onclick = onAction);
            tbody.appendChild(tr);
        });
    }

    // ----------------------------------------------------
    // ACTIONS (edit/delete)
    // ----------------------------------------------------
    function onAction(e) {
        const id = e.target.dataset.id;
        const act = e.target.dataset.act;

        if (act === "edit") {
            const wh = whList.find(x => String(x.wh_id) === String(id));
            if (!wh) return console.error("СЦ не найден для редактирования:", id);
            openWhModal(wh);
        }

        if (act === "del") {
            deleteWh(id);
        }
    }

    // ----------------------------------------------------
    // OPEN / CLOSE WH MODAL
    // ----------------------------------------------------
    function openWhModal(wh = null) {
        editWhId = wh?.wh_id || null;

        if (wh) {
            modalTitle.textContent = "Редактировать СЦ";
            inpWhId.value = wh.wh_id;
            inpWhName.value = wh.wh_name;
        } else {
            modalTitle.textContent = "Добавить СЦ";
            inpWhId.value = "";
            inpWhName.value = "";
        }

        renderPlacesEditor(editWhId);
        modal.classList.remove("hidden");
    }

    function closeWhModal() {
        modal.classList.add("hidden");
        editWhId = null;
    }

    // ----------------------------------------------------
    // SAVE WH
    // ----------------------------------------------------
    btnSaveWh.onclick = async function () {
        const wh_id = inpWhId.value.trim();
        const wh_name = inpWhName.value.trim();

        if (!wh_id) return MiniUI.alert("ID обязателен");
        if (!wh_name) return MiniUI.alert("Название обязательно");

        const wh_id_fixed = isNaN(wh_id) ? wh_id : Number(wh_id);

        await supabaseClient.from("wh_rep").upsert({ wh_id: wh_id_fixed, wh_name });
        await loadData();
        closeWhModal();
    };

    btnCloseWh.onclick = closeWhModal;
    btnAddWh.onclick = () => openWhModal(null);

    // ----------------------------------------------------
    // DELETE WH
    // ----------------------------------------------------
    async function deleteWh(wh_id) {
        const ok = await MiniUI.confirm("Удалить СЦ и все его МХ?", { title: "Удаление" });
        if (!ok) return;

        const wh_id_fixed = isNaN(wh_id) ? wh_id : Number(wh_id);

        const { error } = await supabaseClient
            .from("wh_rep")
            .delete()
            .eq("wh_id", wh_id_fixed);

        if (error) return MiniUI.toast("Ошибка удаления СЦ", { type: "error" });

        await supabaseClient.from("places").delete().eq("wh_id", wh_id_fixed);

        await loadData();
    }


    // ----------------------------------------------------
    // PLACES EDITOR
    // ----------------------------------------------------
    function renderPlacesEditor(wh_id) {
        placesList.innerHTML = "";

        const whPlaces = places.filter(p => String(p.wh_id) === String(wh_id));

        whPlaces.forEach(p => {
            const div = document.createElement("div");
            div.style = "padding:8px;border-bottom:1px solid #eee;";

            div.innerHTML = `
                <b>${p.place}</b> — ${p.place_name}<br>
                <small>Тип: ${p.place_type}</small><br>
                <small>Стикер: ${p.place_sticker}</small>
                <div style="margin-top:8px;">
                    <button class="btn btn-outline" data-place="${p.place}" data-act="edit-place">✏️</button>
                    <button class="btn btn-outline" data-place="${p.place}" data-act="del-place">🗑️</button>
                </div>
            `;

            div.querySelectorAll("button").forEach(btn => btn.onclick = onPlaceAction);
            placesList.appendChild(div);
        });
    }

    // ----------------------------------------------------
    // PLACE ACTIONS
    // ----------------------------------------------------
    async function onPlaceAction(e) {
        const place = e.target.dataset.place;
        const act = e.target.dataset.act;

        if (act === "del-place") {
            const ok = await MiniUI.confirm("Удалить МХ?", { title: "Удаление МХ" });
            if (!ok) return;

            await supabaseClient.from("places").delete().eq("place", String(place));

            await loadData();
            renderPlacesEditor(editWhId);
        }

        if (act === "edit-place") {
            const plc = places.find(p => String(p.place) === String(place));
            if (!plc) return MiniUI.toast("МХ не найден", { type: "error" });
            openPlaceModal(plc);
        }
    }

    // ----------------------------------------------------
    // OPEN / CLOSE PLACE MODAL
    // ----------------------------------------------------
    function openPlaceModal(plc = null) {
        editPlaceId = plc?.place || null;

        if (plc) {
            placeTitle.textContent = "Редактировать МХ";

            txtPlaceId.textContent = plc.place;
            txtPlaceId.style.display = "block";

            txtPlaceSticker.style.display = "none";
            btnShowSticker.style.display = "inline-block";
            btnShowSticker.onclick = () => showSticker(plc);

            inpPlaceName.value = plc.place_name;
            inpPlaceType.value = plc.place_type;
        } else {
            placeTitle.textContent = "Создать МХ";

            txtPlaceId.textContent = "(будет сгенерирован)";
            txtPlaceSticker.textContent = "(будет сгенерирован)";
            txtPlaceId.style.display = "block";
            txtPlaceSticker.style.display = "block";
            btnShowSticker.style.display = "none";

            inpPlaceName.value = "";
            inpPlaceType.value = "1";
        }

        placeModal.classList.remove("hidden");
    }

    function closePlaceModal() {
        placeModal.classList.add("hidden");
        editPlaceId = null;
    }

    btnClosePlace.onclick = closePlaceModal;

    // ----------------------------------------------------
    // SAVE PLACE (с генерацией place_id и place_sticker)
    // ----------------------------------------------------
    btnSavePlace.onclick = async function () {
        const name = inpPlaceName.value.trim();
        const type = parseInt(inpPlaceType.value, 10);

        if (!name) return MiniUI.alert("Название МХ обязательно");
        if (![1,2,3].includes(type)) return MiniUI.alert("Неверный тип МХ");
        if (!editWhId) return MiniUI.alert("Ошибка: СЦ не выбран");

        let placeId = editPlaceId;

        if (!editPlaceId) {
            const prefix = {1:"TB", 2:"BX", 3:"PL"}[type];

            const existing = places
                .filter(p => p.place.startsWith(prefix))
                .map(p => parseInt(p.place.substring(2), 10));

            let nextNum = 1;
            while (existing.includes(nextNum)) nextNum++;
            placeId = prefix + String(nextNum).padStart(5, "0");
        }

        let finalSticker = editPlaceId ? txtPlaceSticker.textContent : "";

        if (!editPlaceId) {
            const fallbackNow = new Date();
            const nowParts = (window.MiniUI?.nowPartsPlus3
                ? window.MiniUI.nowPartsPlus3()
                : { hours: fallbackNow.getHours(), minutes: fallbackNow.getMinutes(), seconds: fallbackNow.getSeconds() });
            const gent = (nowParts.hours * 10000 + nowParts.minutes * 100 + nowParts.seconds) * 6;
            finalSticker = `$$WMSPLUSSC${editWhId}${placeId}${gent}`;
        }

        await supabaseClient.from("places").upsert({
            place: placeId,
            place_name: name,
            wh_id: editWhId,
            place_type: type,
            place_sticker: finalSticker
        });

        await loadData();
        renderPlacesEditor(editWhId);
        closePlaceModal();
    };

    // ----------------------------------------------------
    // ADD NEW PLACE BUTTON
    // ----------------------------------------------------
    btnAddPlace.onclick = () => openPlaceModal(null);

    // ----------------------------------------------------
    // SHOW STICKER MODAL
    // ----------------------------------------------------
    function showSticker(plc) {
        const ctx = stickerCanvas.getContext("2d");

        const mhgen_place_sticker = plc.place_sticker;
        const mhgen_sc_id = plc.wh_id;
        const mhgen_place_id = plc.place;
        const mhgen_place_name = plc.place_name;
        const mhgen_place_type = ({1:"Стол",2:"Передача",3:"МХ"})[plc.place_type] || "МХ";

        ctx.clearRect(0,0,stickerCanvas.width,stickerCanvas.height);

        // ====== ВСТАВЛЯЕМ ВСЮ ЛОГИКУ ПО РИСОВАНИЮ СТИКЕРА ======
        (async () => {
            // ... вставьте здесь полностью код генерации canvas как в твоем примере ...
            // QR, Bar, рамка, текст, логотип и подписи
            // используйте переменные mhgen_*
            const QR_SIZE = 200;
            const BAR_H_HEIGHT = 200;
            const BAR_V_WIDTH = 200;
            const OFFSET = 20;
            const MARGIN = 20;
            const CANVAS_SIZE = 1000;
            const FRAME_RADIUS = 20;
            const FRAME_LINE = 10;
            const LOGO_SIZE = 60;
            const LOGO_OFFSET = 25;
            const TEXT_OFFSET = 25;
            const TEXT_SIZE = 58;
            const SUBTEXT_OFFSET = 35;
            const BOTTOM_FONT_SIZE = 48;
            const BAR_H_WIDTH = CANVAS_SIZE - 2*QR_SIZE - 2*OFFSET - 2*MARGIN;
            const BAR_V_HEIGHT = CANVAS_SIZE - 2*QR_SIZE - 2*OFFSET - 2*MARGIN;

            const makeQR = text => new Promise(res=>{
                const div = document.createElement("div");
                new QRCode(div,{text,width:QR_SIZE,height:QR_SIZE,margin:0});
                setTimeout(()=>res(div.querySelector("canvas")),50);
            });

            const makeBarHScaled = text => {
                const temp = document.createElement("canvas");
                temp.width = 864; temp.height = BAR_H_HEIGHT;
                JsBarcode(temp,text,{format:"CODE128",displayValue:false,width:3,height:BAR_H_HEIGHT,margin:0});
                const c = document.createElement("canvas");
                c.width = BAR_H_WIDTH; c.height = BAR_H_HEIGHT;
                c.getContext("2d").drawImage(temp,0,0,BAR_H_WIDTH,BAR_H_HEIGHT);
                return c;
            }

            const makeBarV = text => {
                const temp = makeBarHScaled(text);
                const c = document.createElement("canvas");
                c.width = BAR_V_WIDTH; c.height = BAR_V_HEIGHT;
                const ctx = c.getContext("2d");
                ctx.save(); ctx.translate(BAR_V_WIDTH,0); ctx.rotate(Math.PI/2); ctx.drawImage(temp,0,0); ctx.restore();
                return c;
            }

            const qr = await makeQR(mhgen_place_sticker);
            const barTop = makeBarHScaled(mhgen_place_sticker);
            const barBottom = makeBarHScaled(mhgen_place_sticker);
            const barLeft = makeBarV(mhgen_place_sticker);
            const barRight = makeBarV(mhgen_place_sticker);

            ctx.fillStyle = "white";
            ctx.fillRect(0,0,CANVAS_SIZE,CANVAS_SIZE);

            ctx.drawImage(qr,MARGIN,MARGIN);
            ctx.drawImage(qr,CANVAS_SIZE-QR_SIZE-MARGIN,MARGIN);
            ctx.drawImage(qr,MARGIN,CANVAS_SIZE-QR_SIZE-MARGIN);
            ctx.drawImage(qr,CANVAS_SIZE-QR_SIZE-MARGIN,CANVAS_SIZE-QR_SIZE-MARGIN);

            ctx.drawImage(barTop,QR_SIZE+OFFSET+MARGIN,MARGIN);
            ctx.drawImage(barBottom,QR_SIZE+OFFSET+MARGIN,CANVAS_SIZE-BAR_H_HEIGHT-MARGIN);
            ctx.drawImage(barLeft,MARGIN,QR_SIZE+OFFSET+MARGIN);
            ctx.drawImage(barRight,CANVAS_SIZE-BAR_V_WIDTH-MARGIN,QR_SIZE+OFFSET+MARGIN);

            const frameX = QR_SIZE+OFFSET+MARGIN;
            const frameY = QR_SIZE+OFFSET+MARGIN;
            const frameWidth = CANVAS_SIZE-2*frameX;
            const frameHeight = CANVAS_SIZE-2*frameY;

            ctx.lineWidth = FRAME_LINE;
            ctx.strokeStyle = "black";
            ctx.beginPath();
            ctx.moveTo(frameX+FRAME_RADIUS,frameY);
            ctx.lineTo(frameX+frameWidth-FRAME_RADIUS,frameY);
            ctx.quadraticCurveTo(frameX+frameWidth,frameY,frameX+frameWidth,frameY+FRAME_RADIUS);
            ctx.lineTo(frameX+frameWidth,frameY+frameHeight-FRAME_RADIUS);
            ctx.quadraticCurveTo(frameX+frameWidth,frameY+frameHeight,frameX+frameWidth-FRAME_RADIUS,frameY+frameHeight);
            ctx.lineTo(frameX+FRAME_RADIUS,frameY+frameHeight);
            ctx.quadraticCurveTo(frameX,frameY+frameHeight,frameX,frameY+frameHeight-FRAME_RADIUS);
            ctx.lineTo(frameX,frameY+FRAME_RADIUS);
            ctx.quadraticCurveTo(frameX,frameY,frameX+FRAME_RADIUS,frameY);
            ctx.stroke();

            const logo = new Image();
            logo.src="https://raw.githubusercontent.com/mevukolov/WMSplus/refs/heads/main/icons/menu.svg";
            logo.onload = () => ctx.drawImage(logo,frameX+frameWidth-LOGO_SIZE-LOGO_OFFSET,frameY+LOGO_OFFSET,LOGO_SIZE,LOGO_SIZE);

            ctx.font = `${TEXT_SIZE}px 'Inter', sans-serif`;
            ctx.fillStyle="black"; ctx.textAlign="left"; ctx.textBaseline="top";
            ctx.fillText(mhgen_place_type,frameX+TEXT_OFFSET,frameY+TEXT_OFFSET);

            ctx.font = `${TEXT_SIZE}px 'Inter', sans-serif`;
            const maxWidth = frameWidth-2*TEXT_OFFSET;
            const words = mhgen_place_name.split(' ');
            let line='', y=frameY+TEXT_OFFSET+TEXT_SIZE+SUBTEXT_OFFSET;
            const lineHeight = TEXT_SIZE+5;
            for(let n=0;n<words.length;n++){
                const testLine = line?line+' '+words[n]:words[n];
                if(ctx.measureText(testLine).width>maxWidth && line){ ctx.fillText(line,frameX+TEXT_OFFSET,y); line=words[n]; y+=lineHeight; }
                else{ line=testLine; }
            }
            ctx.fillText(line,frameX+TEXT_OFFSET,y);

            ctx.font = `${BOTTOM_FONT_SIZE}px 'Inter', sans-serif`;
            ctx.textBaseline="bottom";
            ctx.textAlign="left"; ctx.fillText(mhgen_sc_id,frameX+TEXT_OFFSET,frameY+frameHeight-TEXT_OFFSET);
            ctx.textAlign="right"; ctx.fillText(mhgen_place_id,frameX+frameWidth-TEXT_OFFSET,frameY+frameHeight-TEXT_OFFSET);
        })();

        stickerModal.classList.remove("hidden");
    }

    btnCloseSticker.onclick = () => stickerModal.classList.add("hidden");

    btnDownloadSticker.onclick = () => {
        const link = document.createElement("a");
        link.href = stickerCanvas.toDataURL("image/png");
        link.download = "sticker.png";
        link.click();
    }

    // ----------------------------------------------------
    // INITIAL LOAD
    // ----------------------------------------------------
    loadData();

})();
