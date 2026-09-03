// no_shk_zone.js — physical storage structure (racks/shelves + capacity)
// and box placement for the "Без ШК" zone. Loaded alongside tasks.js on
// tasks.html but kept as its own file/closure since tasks.js is already
// very large and this feature is self-contained: its own tables, its own
// modals, no interaction with tasks.js's own state.
//
// Flow: a box is created "на полу" (shelf_id null), gets its sticker
// printed, then lands on a specific shelf only via the scan-based
// "Перемещение коробов" flow -- scan the shelf's own label
// (WMSP.PLCE.WSHK.{rack_number}.{shelf_number}, 2-digit zero-padded) once,
// then scan boxes (WMSP.BOX.{box_number}) one after another to place them
// there. Printing reuses the existing print_label_templates -> print_jobs
// pipeline (print-tspl.js / print-bridge) via seeded templates named
// "Короб «Без ШК»" and "Полка «Без ШК»" (see the 2026090200003/4
// migrations) -- no separate print infrastructure.
(function () {
    "use strict";

    const $ = (id) => document.getElementById(id);

    function db() {
        return window.supabaseClient || null;
    }

    function escapeHtmlLocal(value) {
        const div = document.createElement("div");
        div.textContent = value == null ? "" : String(value);
        return div.innerHTML;
    }

    // Layout-independent scan input: same technique already used in
    // barcode_generator.js/shk_generator.js/etc -- a scanner emulates a
    // physical keyboard, so if the OS is on a Cyrillic (ЙЦУКЕН) layout the
    // scanned ASCII codes come out as Cyrillic look-alike characters on the
    // same key positions. Remap them back by character, not by re-reading
    // hardware key codes (this repo has no such API layer), matching the
    // existing per-file convention rather than inventing a new approach.
    function buildRuToEnMap() {
        const ruLow = "ё1234567890-=йцукенгшщзхъ\\фывапролджэячсмитьбю.";
        const enLow = "`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./";
        const ruHigh = "Ё!\"№;%:?*()_+ЙЦУКЕНГШЩЗХЪ/ФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,";
        const enHigh = "~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:\"ZXCVBNM<>?";
        const map = {};
        for (let i = 0; i < ruLow.length; i++) map[ruLow[i]] = enLow[i];
        for (let i = 0; i < ruHigh.length; i++) map[ruHigh[i]] = enHigh[i];
        return map;
    }
    const RU_TO_EN = buildRuToEnMap();
    function ruToEnLayout(str) {
        return String(str || "").split("").map((ch) => RU_TO_EN[ch] || ch).join("");
    }

    // Same fixed-class animated overlay every other modal on this page
    // uses (see .tasks-flow-modal.upload-work in tasks.html), but tasks.js
    // keeps its own setFlowModalOpen()/closeFlowModals() private to its
    // own closure -- this is the same behavior, self-contained here.
    const modalCloseTokens = {};
    function setZoneModalOpen(id, open) {
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

    // In-house confirm() replacement -- no native browser dialogs, matches
    // the app's own modal styling. Promise-based so call sites read like
    // `if (!(await zoneConfirm("..."))) return;`, same shape as confirm().
    let confirmResolve = null;
    function zoneConfirm(message) {
        return new Promise((resolve) => {
            confirmResolve = resolve;
            $("noShkConfirmMessage").textContent = message;
            setZoneModalOpen("noShkConfirmModal", true);
        });
    }
    function resolveConfirm(value) {
        setZoneModalOpen("noShkConfirmModal", false);
        if (confirmResolve) { confirmResolve(value); confirmResolve = null; }
    }

    let racks = [];
    let floorBoxes = [];
    // Boxes already rendered once get a calm fade on re-render; a box seen
    // for the first time (just created, or freshly moved into view) gets
    // the bouncier pop-in -- see .no-shk-box.is-new in tasks.html.
    let seenBoxIds = new Set();
    let boxLabelTemplate = null;
    let shelfLabelTemplate = null;
    let activeBoxId = "";
    let moveActiveShelf = null; // { id, rack, shelf }

    const BOX_FIELDS = "id,box_number,shift_date,shift_type,box_type,area,responsible_name,shelf_id,created_at";

    async function loadZone() {
        const client = db();
        if (!client) return;
        const [racksRes, floorRes] = await Promise.all([
            client
                .from("wms_no_shk_racks")
                .select("id,name,rack_number,created_at,wms_no_shk_shelves(id,name,shelf_number,capacity,created_at,wms_no_shk_boxes(" + BOX_FIELDS + "))")
                .order("created_at", { ascending: true })
                .order("created_at", { ascending: true, foreignTable: "wms_no_shk_shelves" }),
            client
                .from("wms_no_shk_boxes")
                .select(BOX_FIELDS)
                .is("shelf_id", null)
                .order("box_number", { ascending: true }),
        ]);
        if (racksRes.error) {
            racks = [];
            renderZoneView("Не удалось загрузить: " + racksRes.error.message);
            renderAdminView();
            return;
        }
        racks = racksRes.data || [];
        floorBoxes = floorRes.error ? [] : (floorRes.data || []);
        renderZoneView();
        renderAdminView();
        if (!boxLabelTemplate) void loadTemplate("Короб «Без ШК»", (tpl) => { boxLabelTemplate = tpl; });
        if (!shelfLabelTemplate) void loadTemplate("Полка «Без ШК»", (tpl) => { shelfLabelTemplate = tpl; });
    }

    async function loadTemplate(name, assign) {
        const client = db();
        if (!client) return;
        const { data, error } = await client
            .from("print_label_templates")
            .select("id,width_mm,height_mm,elements")
            .eq("name", name)
            .maybeSingle();
        if (error || !data) {
            console.error("[no_shk_zone] template not found:", name, error && error.message);
            return;
        }
        assign(data);
    }

    function areaClass(area) {
        return area === "Переупаковка" ? "area-repack" : "area-sort";
    }

    function boxTooltip(box) {
        return "Короб без ШК " + box.box_number
            + "\nДата: " + computeDateLabel(box) + " (" + box.shift_type + ")"
            + "\nТип: " + box.box_type
            + "\nУчасток: " + box.area
            + "\nОтветственный: " + box.responsible_name;
    }

    function boxTileHtml(box, index) {
        const isNew = !seenBoxIds.has(box.id);
        const cls = "no-shk-box " + areaClass(box.area) + (isNew ? " is-new" : "");
        const delay = Math.min(index, 10) * 30;
        return "<div class='" + cls + "' style='animation-delay:" + delay + "ms;' data-box-id='" + box.id + "' title='" + escapeHtmlLocal(boxTooltip(box)) + "'>"
            + "<span class='no-shk-box-number'>№" + box.box_number + "</span>"
            + "<span class='no-shk-box-date'>" + escapeHtmlLocal(formatDateShort(box.shift_date)) + "</span>"
            + "</div>";
    }

    function shelfSkeuoHtml(shelf) {
        const boxes = (shelf.wms_no_shk_boxes || []).slice().sort((a, b) => a.box_number - b.box_number);
        const isFull = boxes.length >= shelf.capacity;
        const boxesHtml = boxes.map(boxTileHtml).join("");
        return "<div class='no-shk-shelf'>"
            + "<div class='no-shk-shelf-head'>"
            + "<span>" + escapeHtmlLocal(shelf.name) + "</span>"
            + "<span class='no-shk-shelf-fill" + (isFull ? " is-full" : "") + "'>" + boxes.length + " / " + shelf.capacity + "</span>"
            + "</div>"
            + "<div class='no-shk-boxes-row'>" + (boxesHtml || "<span style='color:#94a3b8;font-size:12px;'>пусто</span>") + "</div>"
            + "</div>";
    }

    // Rack width scales with its widest shelf's capacity, so a rack that
    // holds more boxes per shelf is visibly wider -- not just a fixed box.
    const BOX_TILE_PX = 64 + 8; // .no-shk-box width + .no-shk-boxes-row gap
    function rackFrameWidthPx(rack) {
        const shelves = rack.wms_no_shk_shelves || [];
        const maxCapacity = shelves.reduce((max, s) => Math.max(max, s.capacity || 0), 1);
        return maxCapacity * BOX_TILE_PX + 28; // + shelf horizontal padding
    }

    function boxWord(count) {
        const n = Math.abs(count) % 100;
        const last = n % 10;
        if (n >= 11 && n <= 14) return "коробов";
        if (last === 1) return "короба";
        if (last >= 2 && last <= 4) return "коробов";
        return "коробов";
    }

    function renderZoneView(errorMessage) {
        const wrap = $("noShkZoneWrap");
        if (!wrap) return;
        if (errorMessage) {
            wrap.innerHTML = "<p style='color:#dc2626;'>" + escapeHtmlLocal(errorMessage) + "</p>";
            return;
        }
        const floorHtml = "<div class='no-shk-floor'>"
            + "<p class='no-shk-floor-title'>На полу" + (floorBoxes.length ? " (" + floorBoxes.length + ")" : "") + "</p>"
            + "<div class='no-shk-boxes-row'>"
            + (floorBoxes.length
                ? floorBoxes.map(boxTileHtml).join("")
                : "<span style='color:#94a3b8;font-size:12px;'>пусто</span>")
            + "</div></div>";

        const racksHtml = racks.length
            ? "<div class='no-shk-racks-row'>" + racks.map((rack) => {
                const shelves = rack.wms_no_shk_shelves || [];
                const width = rackFrameWidthPx(rack);
                const shelvesHtml = shelves.length
                    ? "<div class='no-shk-rack-frame' style='width:" + width + "px;'>" + shelves.map(shelfSkeuoHtml).join("") + "</div>"
                    : "<p style='color:#64748b;font-size:13px;'>Полок пока нет.</p>";
                return "<div class='no-shk-rack'>"
                    + "<h3 class='no-shk-rack-title'>" + escapeHtmlLocal(rack.name) + "</h3>"
                    + shelvesHtml
                    + "</div>";
            }).join("") + "</div>"
            : "<p style='color:#64748b;'>Стеллажей пока нет. Нажми ✎, чтобы добавить.</p>";

        wrap.innerHTML = floorHtml + racksHtml;

        wrap.querySelectorAll("[data-box-id]").forEach((box) => {
            box.addEventListener("click", () => openBoxDetailModal(box.dataset.boxId));
        });

        const nextSeen = new Set();
        floorBoxes.forEach((box) => nextSeen.add(box.id));
        racks.forEach((rack) => (rack.wms_no_shk_shelves || []).forEach((shelf) => (shelf.wms_no_shk_boxes || []).forEach((box) => nextSeen.add(box.id))));
        seenBoxIds = nextSeen;
    }

    function renderAdminView() {
        const wrap = $("noShkZoneAdminWrap");
        if (!wrap) return;
        if (!racks.length) {
            wrap.innerHTML = "<p style='color:#64748b;'>Стеллажей пока нет — добавь первый ниже.</p>";
            return;
        }
        wrap.innerHTML = racks.map((rack) => {
            const shelves = rack.wms_no_shk_shelves || [];
            const shelvesHtml = shelves.map((shelf) => (
                "<div class='card' style='padding:8px 12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;'>"
                + "<span>" + escapeHtmlLocal(shelf.name) + " — до " + shelf.capacity + " " + boxWord(shelf.capacity) + "</span>"
                + "<span style='display:flex;gap:6px;'>"
                + "<button class='btn btn-square' type='button' data-print-shelf='" + shelf.id + "' title='Распечатать этикетку полки'>🖨</button>"
                + "<button class='btn btn-square' type='button' data-delete-shelf='" + shelf.id + "'>×</button>"
                + "</span>"
                + "</div>"
            )).join("");
            return "<div class='card' style='padding:14px;margin-bottom:12px;'>"
                + "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;'>"
                + "<h3 style='margin:0;'>" + escapeHtmlLocal(rack.name) + "</h3>"
                + "<button class='btn btn-outline' type='button' data-delete-rack='" + rack.id + "'>Удалить стеллаж</button>"
                + "</div>"
                + shelvesHtml
                + "<div style='display:flex;gap:8px;align-items:flex-end;margin-top:8px;'>"
                + "<label>Полка<br><input type='text' data-new-shelf-name='" + rack.id + "' placeholder='Полка " + (shelves.length + 1) + "' style='width:140px;'></label>"
                + "<label>Вместимость<br><input type='number' data-new-shelf-capacity='" + rack.id + "' value='4' style='width:90px;'></label>"
                + "<button class='btn btn-outline' type='button' data-add-shelf='" + rack.id + "'>+ Полка</button>"
                + "</div>"
                + "</div>";
        }).join("");

        wrap.querySelectorAll("[data-delete-rack]").forEach((btn) => {
            btn.addEventListener("click", () => deleteRack(btn.dataset.deleteRack));
        });
        wrap.querySelectorAll("[data-delete-shelf]").forEach((btn) => {
            btn.addEventListener("click", () => deleteShelf(btn.dataset.deleteShelf));
        });
        wrap.querySelectorAll("[data-print-shelf]").forEach((btn) => {
            btn.addEventListener("click", () => void printShelfLabel(btn.dataset.printShelf));
        });
        wrap.querySelectorAll("[data-add-shelf]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const rackId = btn.dataset.addShelf;
                const nameInput = wrap.querySelector("[data-new-shelf-name='" + rackId + "']");
                const capacityInput = wrap.querySelector("[data-new-shelf-capacity='" + rackId + "']");
                addShelf(rackId, nameInput.value.trim() || nameInput.placeholder, Number(capacityInput.value) || 0);
            });
        });
    }

    function setAdminStatus(message, isError) {
        const status = $("noShkZoneAdminStatus");
        if (!status) return;
        status.textContent = message || "";
        status.style.color = isError ? "#dc2626" : "";
    }

    const DEFAULT_SHELVES_PER_RACK = 5;
    const DEFAULT_SHELF_CAPACITY = 4;

    async function addRack(name) {
        const client = db();
        if (!client || !name) return;
        const { data: rack, error } = await client.from("wms_no_shk_racks").insert({ name }).select("id").single();
        if (error) { setAdminStatus("Не удалось добавить стеллаж: " + error.message, true); return; }
        const shelves = [];
        for (let i = 1; i <= DEFAULT_SHELVES_PER_RACK; i++) {
            shelves.push({ rack_id: rack.id, name: "Полка " + i, capacity: DEFAULT_SHELF_CAPACITY, shelf_number: i });
        }
        const { error: shelvesError } = await client.from("wms_no_shk_shelves").insert(shelves);
        if (shelvesError) { setAdminStatus("Стеллаж создан, но не удалось добавить полки: " + shelvesError.message, true); await loadZone(); return; }
        setAdminStatus("");
        await loadZone();
    }

    async function deleteRack(id) {
        const client = db();
        if (!client || !(await zoneConfirm("Удалить стеллаж вместе со всеми его полками? Короба с этих полок вернутся «на пол»."))) return;
        const { error } = await client.from("wms_no_shk_racks").delete().eq("id", id);
        if (error) { setAdminStatus("Не удалось удалить: " + error.message, true); return; }
        setAdminStatus("");
        await loadZone();
    }

    async function addShelf(rackId, name, capacity) {
        const client = db();
        if (!client) return;
        const rack = racks.find((r) => r.id === rackId);
        const shelfNumber = rack ? (rack.wms_no_shk_shelves || []).reduce((max, s) => Math.max(max, s.shelf_number || 0), 0) + 1 : 1;
        const { error } = await client.from("wms_no_shk_shelves").insert({ rack_id: rackId, name, capacity, shelf_number: shelfNumber });
        if (error) { setAdminStatus("Не удалось добавить полку: " + error.message, true); return; }
        setAdminStatus("");
        await loadZone();
    }

    async function deleteShelf(id) {
        const client = db();
        if (!client || !(await zoneConfirm("Удалить полку? Короба с неё вернутся «на пол»."))) return;
        const { error } = await client.from("wms_no_shk_shelves").delete().eq("id", id);
        if (error) { setAdminStatus("Не удалось удалить: " + error.message, true); return; }
        setAdminStatus("");
        await loadZone();
    }

    function pad2(n) { return String(n).padStart(2, "0"); }

    function shelfCode(rack, shelf) {
        return "WMSP.PLCE.WSHK." + pad2(rack.rack_number) + "." + pad2(shelf.shelf_number);
    }

    async function printShelfLabel(shelfId) {
        let rack = null;
        let shelf = null;
        for (const r of racks) {
            const found = (r.wms_no_shk_shelves || []).find((s) => s.id === shelfId);
            if (found) { rack = r; shelf = found; break; }
        }
        if (!rack || !shelf) return;
        if (!shelfLabelTemplate) await loadTemplate("Полка «Без ШК»", (tpl) => { shelfLabelTemplate = tpl; });
        if (!shelfLabelTemplate) { setAdminStatus("Шаблон этикетки полки не найден.", true); return; }
        const client = db();
        const data = { shelf_code: shelfCode(rack, shelf), shelf_name: rack.name + " — " + shelf.name };
        const tspl = buildTsplPayloadBase64(shelfLabelTemplate, data);
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        const { error } = await client
            .from("print_jobs")
            .insert({ template_id: shelfLabelTemplate.id, data, tspl, created_by: user.id || user.name || null });
        if (error) { setAdminStatus("Не удалось поставить в очередь: " + error.message, true); return; }
        setAdminStatus("Этикетка полки «" + shelf.name + "» отправлена в очередь.");
    }

    // ---- Box lookup helpers (across shelves + floor) ----

    function findBoxContext(boxId) {
        for (const rack of racks) {
            for (const shelf of rack.wms_no_shk_shelves || []) {
                const box = (shelf.wms_no_shk_boxes || []).find((b) => b.id === boxId);
                if (box) return { box, shelf, rack };
            }
        }
        const floorBox = floorBoxes.find((b) => b.id === boxId);
        if (floorBox) return { box: floorBox, shelf: null, rack: null };
        return null;
    }

    function findBoxByNumber(boxNumber) {
        for (const rack of racks) {
            for (const shelf of rack.wms_no_shk_shelves || []) {
                const box = (shelf.wms_no_shk_boxes || []).find((b) => b.box_number === boxNumber);
                if (box) return box;
            }
        }
        return floorBoxes.find((b) => b.box_number === boxNumber) || null;
    }

    // ---- New box modal (always created "на полу") ----

    function openNewBoxModal() {
        $("newBoxShiftDate").value = new Date().toISOString().slice(0, 10);
        $("newBoxShiftType").value = "Дневная";
        $("newBoxType").value = "Короб";
        $("newBoxArea").value = "Сортировка";
        $("newBoxResponsible").value = "";
        $("noShkNewBoxStatus").textContent = "";
        setZoneModalOpen("noShkNewBoxModal", true);
    }

    async function saveNewBox() {
        const client = db();
        if (!client) return;
        const responsibleName = $("newBoxResponsible").value.trim();
        if (!responsibleName) {
            $("noShkNewBoxStatus").textContent = "Укажи, кто принёс короб.";
            $("noShkNewBoxStatus").style.color = "#dc2626";
            return;
        }
        const payload = {
            shift_date: $("newBoxShiftDate").value || new Date().toISOString().slice(0, 10),
            shift_type: $("newBoxShiftType").value,
            box_type: $("newBoxType").value,
            area: $("newBoxArea").value,
            responsible_name: responsibleName,
        };
        const { data: box, error } = await client.from("wms_no_shk_boxes").insert(payload).select("id").single();
        if (error) {
            $("noShkNewBoxStatus").textContent = "Не удалось создать: " + error.message;
            $("noShkNewBoxStatus").style.color = "#dc2626";
            return;
        }
        setZoneModalOpen("noShkNewBoxModal", false);
        await loadZone();
        openBoxDetailModal(box.id);
    }

    // ---- Box detail modal ----

    function formatDateShort(isoDate) {
        const parts = String(isoDate).split("-");
        if (parts.length !== 3) return String(isoDate);
        return parts[2] + "." + parts[1] + "." + parts[0].slice(2);
    }

    function addDays(isoDate, days) {
        const d = new Date(isoDate + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
    }

    function computeDateLabel(box) {
        if (box.shift_type === "Ночная") {
            return formatDateShort(box.shift_date) + "-" + formatDateShort(addDays(box.shift_date, 1));
        }
        return formatDateShort(box.shift_date);
    }

    function boxCode(box) {
        return "WMSP.BOX." + String(box.box_number).padStart(5, "0");
    }

    function openBoxDetailModal(boxId) {
        const ctx = findBoxContext(boxId);
        if (!ctx) return;
        activeBoxId = boxId;
        const { box, shelf, rack } = ctx;
        const location = shelf ? escapeHtmlLocal(rack.name) + " — " + escapeHtmlLocal(shelf.name) : "На полу";
        $("noShkBoxDetailWrap").innerHTML = "<div style='display:flex;flex-direction:column;gap:6px;font-size:14px;'>"
            + "<div><strong>Короб без ШК " + box.box_number + "</strong></div>"
            + "<div>Дата: " + escapeHtmlLocal(computeDateLabel(box)) + " (" + escapeHtmlLocal(box.shift_type) + ")</div>"
            + "<div>Тип: " + escapeHtmlLocal(box.box_type) + "</div>"
            + "<div>Участок: " + escapeHtmlLocal(box.area) + "</div>"
            + "<div>Ответственный: " + escapeHtmlLocal(box.responsible_name) + "</div>"
            + "<div>Местоположение: " + location + "</div>"
            + "</div>";
        $("removeNoShkBoxBtn").textContent = shelf ? "Убрать с полки (на пол)" : "Удалить короб";
        $("noShkBoxDetailStatus").textContent = "";
        setZoneModalOpen("noShkBoxDetailModal", true);
    }

    async function removeActiveBox() {
        const client = db();
        if (!client || !activeBoxId) return;
        const ctx = findBoxContext(activeBoxId);
        if (!ctx) return;
        if (ctx.shelf) {
            if (!(await zoneConfirm("Убрать этот короб с полки? Он останется в системе, «на полу»."))) return;
            const { error } = await client.from("wms_no_shk_boxes").update({ shelf_id: null }).eq("id", activeBoxId);
            if (error) { $("noShkBoxDetailStatus").textContent = "Не удалось убрать: " + error.message; $("noShkBoxDetailStatus").style.color = "#dc2626"; return; }
        } else {
            if (!(await zoneConfirm("Удалить этот короб полностью? Это нельзя отменить."))) return;
            const { error } = await client.from("wms_no_shk_boxes").delete().eq("id", activeBoxId);
            if (error) { $("noShkBoxDetailStatus").textContent = "Не удалось удалить: " + error.message; $("noShkBoxDetailStatus").style.color = "#dc2626"; return; }
        }
        setZoneModalOpen("noShkBoxDetailModal", false);
        await loadZone();
    }

    async function printActiveBox() {
        const client = db();
        const status = $("noShkBoxDetailStatus");
        if (!client || !activeBoxId) return;
        if (!boxLabelTemplate) await loadTemplate("Короб «Без ШК»", (tpl) => { boxLabelTemplate = tpl; });
        if (!boxLabelTemplate) {
            status.textContent = "Шаблон этикетки «Короб «Без ШК»» не найден.";
            status.style.color = "#dc2626";
            return;
        }
        const ctx = findBoxContext(activeBoxId);
        if (!ctx) return;
        const box = ctx.box;
        const data = {
            box_code: boxCode(box),
            box_number: String(box.box_number),
            box_type: box.box_type,
            area: box.area,
            // Two lines instead of one "ДД.ММ.ГГ-ДД.ММ.ГГ" string -- that
            // was wide enough to run off the label's right edge for a
            // night shift. date_line2 stays empty for a day shift.
            date_line1: formatDateShort(box.shift_date),
            date_line2: box.shift_type === "Ночная" ? formatDateShort(addDays(box.shift_date, 1)) : "",
        };
        const tspl = buildTsplPayloadBase64(boxLabelTemplate, data);
        status.textContent = "Отправляю в очередь…";
        status.style.color = "";
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        const { data: job, error } = await client
            .from("print_jobs")
            .insert({ template_id: boxLabelTemplate.id, data, tspl, created_by: user.id || user.name || null })
            .select("id,status")
            .single();
        if (error) {
            status.textContent = "Ошибка постановки в очередь: " + error.message;
            status.style.color = "#dc2626";
            return;
        }
        status.textContent = "В очереди, жду принтер…";
        const channel = client
            .channel("no_shk_print_job_" + job.id)
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "print_jobs", filter: "id=eq." + job.id }, (payload) => {
                const row = payload.new;
                if (row.status === "printed") {
                    status.textContent = "Напечатано ✓";
                    client.removeChannel(channel);
                } else if (row.status === "failed") {
                    status.textContent = "Ошибка: " + (row.error_message || "неизвестная ошибка моста");
                    client.removeChannel(channel);
                }
            })
            .subscribe();
    }

    // ---- Move boxes (scan flow) ----
    // No visible form fields -- a schematic overview, a big status prompt,
    // and animated feedback (checkmark / zoomed placement). The real input
    // stays focused but visually hidden (.no-shk-move-hidden-input) to
    // capture scanner keystrokes. Every single box placement re-requires a
    // shelf scan (state resets to "shelf" after each successful box), per
    // the described flow -- simplest to reason about, and matches "scan
    // shelf, scan box, watch it land, scan shelf again."

    let moveStage = "shelf"; // 'shelf' | 'box'

    function setMovePrompt(text) {
        const el = $("noShkMovePrompt");
        if (el) el.textContent = text;
    }

    function flashMoveCheck() {
        const el = $("noShkMoveCheck");
        if (!el) return;
        el.classList.add("is-visible");
        setTimeout(() => el.classList.remove("is-visible"), 700);
    }

    function flashMoveError(message) {
        const el = $("noShkMoveError");
        if (!el) return;
        el.textContent = message;
        el.classList.add("is-visible");
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => el.classList.remove("is-visible"), 2200);
    }

    function moveShelfHtml(shelf, isTarget, justPlacedBoxId) {
        const boxes = (shelf.wms_no_shk_boxes || []).slice().sort((a, b) => a.box_number - b.box_number);
        const isFull = boxes.length >= shelf.capacity;
        const boxesHtml = boxes.map((box) => {
            const cls = "no-shk-box " + areaClass(box.area) + (box.id === justPlacedBoxId ? " is-new" : "");
            return "<div class='" + cls + "' title='" + escapeHtmlLocal(boxTooltip(box)) + "'>"
                + "<span class='no-shk-box-number'>№" + box.box_number + "</span>"
                + "<span class='no-shk-box-date'>" + escapeHtmlLocal(formatDateShort(box.shift_date)) + "</span></div>";
        }).join("");
        return "<div class='no-shk-shelf" + (isTarget ? " no-shk-move-shelf is-target" : "") + "'>"
            + "<div class='no-shk-shelf-head'><span>" + escapeHtmlLocal(shelf.name) + "</span>"
            + "<span class='no-shk-shelf-fill" + (isFull ? " is-full" : "") + "'>" + boxes.length + " / " + shelf.capacity + "</span></div>"
            + "<div class='no-shk-boxes-row'>" + (boxesHtml || "<span style='color:#94a3b8;font-size:12px;'>пусто</span>") + "</div>"
            + "</div>";
    }

    function renderMoveOverview(justPlacedBoxId) {
        const el = $("noShkMoveOverview");
        if (!el) return;
        el.innerHTML = racks.map((rack) => {
            const isTargetRack = moveActiveShelf && moveActiveShelf.rack.id === rack.id;
            const isDimmed = moveActiveShelf && !isTargetRack;
            const shelves = rack.wms_no_shk_shelves || [];
            const shelvesHtml = shelves.map((shelf) => moveShelfHtml(shelf, Boolean(moveActiveShelf && moveActiveShelf.id === shelf.id), justPlacedBoxId)).join("");
            return "<div class='no-shk-rack" + (isTargetRack ? " is-zoomed" : "") + (isDimmed ? " is-dimmed" : "") + "'>"
                + "<h3 class='no-shk-rack-title'>" + escapeHtmlLocal(rack.name) + "</h3>"
                + "<div class='no-shk-rack-frame' style='width:" + rackFrameWidthPx(rack) + "px;'>" + shelvesHtml + "</div>"
                + "</div>";
        }).join("");
    }

    async function handleScan(rawCode) {
        const code = rawCode.trim();
        if (!code) return;
        if (code.startsWith("WMSP.PLCE.WSHK.")) {
            if (moveStage !== "shelf") { flashMoveError("Сейчас нужно отсканировать короб."); return; }
            const parts = code.slice("WMSP.PLCE.WSHK.".length).split(".");
            const rackNumber = parseInt(parts[0], 10);
            const shelfNumber = parseInt(parts[1], 10);
            const rack = racks.find((r) => r.rack_number === rackNumber);
            if (!rack) { flashMoveError("Стеллаж " + parts[0] + " не существует."); return; }
            const shelf = (rack.wms_no_shk_shelves || []).find((s) => s.shelf_number === shelfNumber);
            if (!shelf) { flashMoveError("Полка " + parts[1] + " не найдена на стеллаже " + rack.name + "."); return; }
            moveActiveShelf = { id: shelf.id, rack, shelf };
            moveStage = "box";
            flashMoveCheck();
            renderMoveOverview();
            setMovePrompt("Отсканируйте короб — " + rack.name + " · " + shelf.name);
            return;
        }
        if (code.startsWith("WMSP.BOX.")) {
            if (moveStage !== "box" || !moveActiveShelf) { flashMoveError("Сначала отсканируйте полку."); return; }
            const boxNumber = parseInt(code.slice("WMSP.BOX.".length), 10);
            const box = findBoxByNumber(boxNumber);
            if (!box) { flashMoveError("Короб №" + boxNumber + " не найден."); return; }
            const currentCount = (moveActiveShelf.shelf.wms_no_shk_boxes || []).length;
            if (currentCount >= moveActiveShelf.shelf.capacity && box.shelf_id !== moveActiveShelf.id) {
                flashMoveError("Полка «" + moveActiveShelf.shelf.name + "» заполнена.");
                return;
            }
            const client = db();
            const { error } = await client.from("wms_no_shk_boxes").update({ shelf_id: moveActiveShelf.id }).eq("id", box.id);
            if (error) { flashMoveError("Ошибка: " + error.message); return; }
            await loadZone();
            // loadZone() replaced the racks array -- keep moveActiveShelf pointing at fresh data
            // for the placement animation below.
            const freshRack = racks.find((r) => r.id === moveActiveShelf.rack.id);
            const freshShelf = freshRack && (freshRack.wms_no_shk_shelves || []).find((s) => s.id === moveActiveShelf.id);
            if (freshRack && freshShelf) moveActiveShelf = { id: freshShelf.id, rack: freshRack, shelf: freshShelf };
            flashMoveCheck();
            renderMoveOverview(box.id);
            setMovePrompt("Короб №" + boxNumber + " на месте ✓");
            setTimeout(() => {
                moveActiveShelf = null;
                moveStage = "shelf";
                renderMoveOverview();
                setMovePrompt("Отсканируйте полку");
            }, 1300);
            return;
        }
        flashMoveError("Неизвестный код: " + code);
    }

    document.addEventListener("DOMContentLoaded", () => {
        const openBtn = $("openNoShkZone");
        if (openBtn) {
            openBtn.addEventListener("click", () => {
                setZoneModalOpen("noShkZoneModal", true);
                void loadZone();
            });
        }
        const closeBtn = $("closeNoShkZone");
        if (closeBtn) closeBtn.addEventListener("click", () => setZoneModalOpen("noShkZoneModal", false));

        const editBtn = $("editNoShkZoneBtn");
        if (editBtn) {
            editBtn.addEventListener("click", () => {
                setZoneModalOpen("noShkZoneAdminModal", true);
                setAdminStatus("");
                renderAdminView();
            });
        }
        const closeAdminBtn = $("closeNoShkZoneAdmin");
        if (closeAdminBtn) closeAdminBtn.addEventListener("click", () => setZoneModalOpen("noShkZoneAdminModal", false));

        const addRackBtn = $("addRackBtn");
        if (addRackBtn) {
            addRackBtn.addEventListener("click", () => {
                const input = $("newRackName");
                const name = input.value.trim();
                if (!name) return;
                input.value = "";
                void addRack(name);
            });
        }

        const openNewBoxBtn = $("openNewBoxBtn");
        if (openNewBoxBtn) openNewBoxBtn.addEventListener("click", openNewBoxModal);
        const closeNewBoxBtn = $("closeNoShkNewBox");
        if (closeNewBoxBtn) closeNewBoxBtn.addEventListener("click", () => setZoneModalOpen("noShkNewBoxModal", false));
        const cancelNewBoxBtn = $("cancelNewBoxBtn");
        if (cancelNewBoxBtn) cancelNewBoxBtn.addEventListener("click", () => setZoneModalOpen("noShkNewBoxModal", false));
        const saveNewBoxBtn = $("saveNewBoxBtn");
        if (saveNewBoxBtn) saveNewBoxBtn.addEventListener("click", () => void saveNewBox());

        const closeBoxDetailBtn = $("closeNoShkBoxDetail");
        if (closeBoxDetailBtn) closeBoxDetailBtn.addEventListener("click", () => setZoneModalOpen("noShkBoxDetailModal", false));
        const removeBoxBtn = $("removeNoShkBoxBtn");
        if (removeBoxBtn) removeBoxBtn.addEventListener("click", () => void removeActiveBox());
        const printBoxBtn = $("printNoShkBoxBtn");
        if (printBoxBtn) printBoxBtn.addEventListener("click", () => void printActiveBox());

        const openMoveBtn = $("openMoveBoxesBtn");
        const moveInput = $("noShkMoveScanInput");
        if (openMoveBtn) {
            openMoveBtn.addEventListener("click", () => {
                moveActiveShelf = null;
                moveStage = "shelf";
                $("noShkMoveError").classList.remove("is-visible");
                $("noShkMoveCheck").classList.remove("is-visible");
                setMovePrompt("Отсканируйте полку");
                renderMoveOverview();
                if (moveInput) moveInput.value = "";
                setZoneModalOpen("noShkMoveModal", true);
                setTimeout(() => moveInput && moveInput.focus(), 50);
            });
        }
        const closeMoveBtn = $("closeNoShkMove");
        if (closeMoveBtn) closeMoveBtn.addEventListener("click", () => setZoneModalOpen("noShkMoveModal", false));
        if (moveInput) {
            let scanBuffer = "";
            moveInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    const code = ruToEnLayout(scanBuffer || moveInput.value).trim();
                    scanBuffer = "";
                    moveInput.value = "";
                    void handleScan(code);
                    return;
                }
                if (event.key.length === 1) scanBuffer += event.key;
            });
            // Keep the (visually hidden) scan input focused while the move
            // modal is open -- a stray click inside the modal shouldn't
            // stop the scanner's keystrokes from being captured.
            document.addEventListener("focusout", () => {
                const modal = $("noShkMoveModal");
                if (modal && modal.classList.contains("active")) setTimeout(() => moveInput.focus(), 0);
            });
        }

        const confirmYesBtn = $("noShkConfirmYes");
        if (confirmYesBtn) confirmYesBtn.addEventListener("click", () => resolveConfirm(true));
        const confirmNoBtn = $("noShkConfirmNo");
        if (confirmNoBtn) confirmNoBtn.addEventListener("click", () => resolveConfirm(false));
    });
})();
