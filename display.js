// display.js — read-only "Без ШК" zone showcase for an unattended kiosk
// display (link-only page, not linked from any nav menu; no keyboard/mouse
// interaction expected or wired up). Visually mirrors no_shk_zone.js's
// renderZoneView() -- same CSS classes, same underlying data -- but strips
// every editing/admin capability and its own Supabase client (no ui.js:
// ui.js can redirect to login.html on missing access, which would break a
// page meant to work from a bare link with no session at all).
//
// Also listens for a "show_qr" Realtime Broadcast event, sent by
// wmsplus-intake-form's intake.js the moment a worker taps "Закрыть
// короб" on the mobile form, and displays the same physical revision-
// office QR code (WMSP.PLCE.WSHK.FLR) on screen with a pop-in animation.
// This is a convenience addition, not a replacement: the printed QR
// sticker in the revision office still works exactly as before if this
// page happens to be offline or misses the broadcast (Realtime Broadcast
// has no persistence/replay -- a client not connected at the moment of
// the event simply never sees it).
(function () {
    "use strict";

    const SUPABASE_URL = "https://bgphllmzmlwurfnbagho.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q";
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    function escapeHtmlLocal(value) {
        const div = document.createElement("div");
        div.textContent = value == null ? "" : String(value);
        return div.innerHTML;
    }

    // Same rule as no_shk_zone.js's areaClass(): "Переупаковка" gets the
    // purple stripe, every other area (ХАБ, Сортировка, Маркетплейс) gets
    // the yellow one.
    function areaClass(area) {
        return area === "Переупаковка" ? "area-repack" : "area-sort";
    }

    function formatDateShort(isoDate) {
        const parts = String(isoDate).split("-");
        if (parts.length !== 3) return String(isoDate);
        return parts[2] + "." + parts[1] + "." + parts[0].slice(2);
    }

    const BOX_FIELDS = "id,box_number,shift_date,shift_type,box_type,area,responsible_name,shelf_id,outside_opp,total_items,created_at";

    let racks = [];
    let floorBoxes = [];
    let outsideBoxes = [];
    // Same "seen before -> calm fade, new -> bouncy pop" split as
    // no_shk_zone.js, so boxes that just appeared are the ones that catch
    // the eye on an unattended screen.
    let seenBoxIds = new Set();

    function boxTileHtml(box, index) {
        const isNew = !seenBoxIds.has(box.id);
        const cls = "no-shk-box " + areaClass(box.area) + (isNew ? " is-new" : "");
        const delay = Math.min(index, 10) * 30;
        return "<div class='" + cls + "' style='animation-delay:" + delay + "ms;'>"
            + "<span class='no-shk-box-number'>№" + box.box_number + "</span>"
            + "<span class='no-shk-box-date'>" + escapeHtmlLocal(formatDateShort(box.shift_date)) + "</span>"
            + "</div>";
    }

    function outsideBoxTileHtml(box, index) {
        const isNew = !seenBoxIds.has(box.id);
        const cls = "no-shk-box " + areaClass(box.area) + (isNew ? " is-new" : "");
        const delay = Math.min(index, 10) * 30;
        return "<div class='" + cls + "' style='animation-delay:" + delay + "ms;'>"
            + "<span class='no-shk-box-number'>" + escapeHtmlLocal(box.area) + "</span>"
            + "<span class='no-shk-box-date'>" + escapeHtmlLocal(formatDateShort(box.shift_date)) + " · " + box.total_items + " шт.</span>"
            + "</div>";
    }

    function shelvesTopToBottom(rack) {
        return (rack.wms_no_shk_shelves || []).slice().sort((a, b) => b.shelf_number - a.shelf_number);
    }

    function rackMaxCapacity(rack) {
        const shelves = rack.wms_no_shk_shelves || [];
        return shelves.reduce((max, s) => Math.max(max, s.capacity || 0), 1);
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

    // "+N" tile standing in for boxes that didn't fit the row's slot
    // budget -- looks like a box tile (same size/grid cell) but carries a
    // count instead of a specific box.
    function moreTileHtml(count) {
        return "<div class='no-shk-box no-shk-box-more'><span class='no-shk-box-more-count'>+" + count + "</span></div>";
    }

    const BOX_TILE_W = 64;
    const BOX_TILE_GAP = 8;
    // How many .no-shk-box tiles (width + gap) fit in a given pixel width.
    function computeSlots(availableWidthPx) {
        if (!availableWidthPx || availableWidthPx <= 0) return 1;
        return Math.max(1, Math.floor((availableWidthPx + BOX_TILE_GAP) / (BOX_TILE_W + BOX_TILE_GAP)));
    }

    // Renders up to `slots` tiles; if there are more boxes than that,
    // shows (slots - 1) real tiles + one "+N" tile for the rest, so the
    // row never exceeds its slot budget regardless of how many boxes
    // actually exist.
    function slotRowHtml(boxes, slots, tileHtmlFn) {
        if (!boxes.length) return "<span style='color:#94a3b8;font-size:12px;'>пусто</span>";
        if (boxes.length <= slots) return boxes.map(tileHtmlFn).join("");
        const shown = Math.max(0, slots - 1);
        const rest = boxes.length - shown;
        return boxes.slice(0, shown).map(tileHtmlFn).join("") + moreTileHtml(rest);
    }

    // Вне ОПП always budgets exactly 3 slots (fixed, no measurement
    // needed -- its container is flex:0 0 auto, sized by this content).
    const OUTSIDE_SLOTS = 3;

    const SHELF_PADDING_H = 20; // .no-shk-shelf horizontal padding (10px * 2)
    const RACK_TILE_GAP = 6;    // .no-shk-shelf .no-shk-boxes-row gap
    const RACK_TILE_MAX = 64;   // never bigger than the Вне ОПП/На полу tiles
    const RACK_TILE_MIN = 24;   // floor so a high-capacity shelf doesn't shrink to nothing

    // Computes one square tile size that fits every rack's own widest
    // shelf within its (equal-width) column, then applies the smallest of
    // those as a single shared size on .no-shk-racks-row -- every box
    // tile across all racks ends up the same square size, and each shelf
    // is exactly tall enough for one row of them (min-height: var(--tile)
    // in CSS) instead of stretched to fill whatever vertical space is
    // left over.
    function sizeRackTilesToFitSquare() {
        const frames = document.querySelectorAll(".no-shk-rack-frame[data-max-cap]");
        if (!frames.length) return;
        let tile = RACK_TILE_MAX;
        frames.forEach((frame) => {
            const cap = Number(frame.dataset.maxCap) || 1;
            const usable = frame.clientWidth - SHELF_PADDING_H - (cap - 1) * RACK_TILE_GAP;
            tile = Math.min(tile, Math.floor(usable / cap));
        });
        tile = Math.max(RACK_TILE_MIN, Math.min(RACK_TILE_MAX, tile));
        const racksRow = document.querySelector(".no-shk-racks-row");
        if (racksRow) racksRow.style.setProperty("--tile", tile + "px");
    }

    function renderZoneView() {
        const wrap = document.getElementById("displayZoneWrap");
        if (!wrap) return;

        const topRowHtml = "<div class='no-shk-top-row'>"
            + "<div class='no-shk-floor no-shk-floor-outside'>"
            + "<p class='no-shk-floor-title'>Вне ОПП" + (outsideBoxes.length ? " (" + outsideBoxes.length + ")" : "") + "</p>"
            + "<div class='no-shk-boxes-row'>" + slotRowHtml(outsideBoxes, OUTSIDE_SLOTS, outsideBoxTileHtml) + "</div>"
            + "</div>"
            + "<div class='no-shk-floor no-shk-floor-onfloor'>"
            + "<p class='no-shk-floor-title'>На полу" + (floorBoxes.length ? " (" + floorBoxes.length + ")" : "") + "</p>"
            + "<div class='no-shk-boxes-row' id='floorBoxesRow'></div>"
            + "</div>"
            + "</div>";

        const racksHtml = racks.length
            ? "<div class='no-shk-racks-row'>" + racks.map((rack) => {
                const shelves = rack.wms_no_shk_shelves || [];
                const maxCapacity = rackMaxCapacity(rack);
                const shelvesHtml = shelves.length
                    ? "<div class='no-shk-rack-frame' data-max-cap='" + maxCapacity + "'>" + shelvesTopToBottom(rack).map(shelfSkeuoHtml).join("") + "</div>"
                    : "<p style='color:#64748b;font-size:13px;'>Полок пока нет.</p>";
                return "<div class='no-shk-rack'>"
                    + "<h3 class='no-shk-rack-title'>" + escapeHtmlLocal(rack.name) + "</h3>"
                    + shelvesHtml
                    + "</div>";
            }).join("") + "</div>"
            : "";

        wrap.innerHTML = topRowHtml + racksHtml;

        // На полу has no fixed slot count -- it takes whatever width is
        // left after Вне ОПП in the same row (flex:1 in CSS). Measure that
        // now that the row's widths have settled, then fill it in --
        // reading clientWidth here forces the layout pass, no need to
        // wait a frame.
        const floorRow = document.getElementById("floorBoxesRow");
        if (floorRow) {
            const slots = computeSlots(floorRow.clientWidth);
            floorRow.innerHTML = slotRowHtml(floorBoxes, slots, boxTileHtml);
        }

        sizeRackTilesToFitSquare();

        const nextSeen = new Set();
        outsideBoxes.forEach((box) => nextSeen.add(box.id));
        floorBoxes.forEach((box) => nextSeen.add(box.id));
        racks.forEach((rack) => (rack.wms_no_shk_shelves || []).forEach((shelf) => (shelf.wms_no_shk_boxes || []).forEach((box) => nextSeen.add(box.id))));
        seenBoxIds = nextSeen;

        checkQrOverlayShouldHide();
    }

    async function loadZone() {
        const [racksRes, floorRes, outsideRes] = await Promise.all([
            supabaseClient
                .from("wms_no_shk_racks")
                .select("id,name,rack_number,position,created_at,wms_no_shk_shelves(id,name,shelf_number,capacity,created_at,wms_no_shk_boxes(" + BOX_FIELDS + "))")
                .order("position", { ascending: true })
                .order("created_at", { ascending: true, foreignTable: "wms_no_shk_shelves" }),
            supabaseClient
                .from("wms_no_shk_boxes")
                .select(BOX_FIELDS)
                .is("shelf_id", null)
                .eq("outside_opp", false)
                .order("box_number", { ascending: true }),
            supabaseClient
                .from("wms_no_shk_boxes")
                .select(BOX_FIELDS)
                .eq("outside_opp", true)
                .order("created_at", { ascending: false }),
        ]);
        racks = racksRes.error ? [] : (racksRes.data || []);
        floorBoxes = floorRes.error ? [] : (floorRes.data || []);
        outsideBoxes = outsideRes.error ? [] : (outsideRes.data || []);
        renderZoneView();
    }

    // ---------- QR overlay ----------
    const QR_OVERLAY_TIMEOUT_MS = 3 * 60 * 1000; // hide after 3 minutes even if the box never closes
    let qrOverlayHideTimer = null;
    let qrOverlayBoxNumber = null;

    function showQrOverlay(payload) {
        const overlay = document.getElementById("qrOverlay");
        const context = document.getElementById("qrOverlayContext");
        const codeBox = document.getElementById("qrOverlayCode");
        if (!overlay || !codeBox) return;

        qrOverlayBoxNumber = payload && payload.box_number != null ? payload.box_number : null;
        context.textContent = payload
            ? [payload.area, payload.box_number ? "короб №" + payload.box_number : "", payload.total_items != null ? payload.total_items + " шт." : ""]
                .filter(Boolean)
                .join(" · ")
            : "";

        codeBox.innerHTML = "";
        // eslint-disable-next-line no-undef -- QRCode comes from the qrcodejs CDN script
        new QRCode(codeBox, { text: "WMSP.PLCE.WSHK.FLR", width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });

        // Restart the pop-in animation even if the overlay is already
        // visible for a previous box (two "Закрыть короб" taps in a row).
        overlay.classList.remove("is-visible");
        void overlay.offsetWidth;
        overlay.classList.add("is-visible");
        overlay.setAttribute("aria-hidden", "false");

        clearTimeout(qrOverlayHideTimer);
        qrOverlayHideTimer = setTimeout(hideQrOverlay, QR_OVERLAY_TIMEOUT_MS);
    }

    function hideQrOverlay() {
        const overlay = document.getElementById("qrOverlay");
        if (overlay) {
            overlay.classList.remove("is-visible");
            overlay.setAttribute("aria-hidden", "true");
        }
        clearTimeout(qrOverlayHideTimer);
        qrOverlayHideTimer = null;
        qrOverlayBoxNumber = null;
    }

    // Runs after every zone refresh: if the box the overlay is currently
    // showing for has left "Вне ОПП" (closed for real), hide early instead
    // of waiting out the full 3-minute timeout.
    function checkQrOverlayShouldHide() {
        if (qrOverlayBoxNumber == null) return;
        const stillOutside = outsideBoxes.some((box) => box.box_number === qrOverlayBoxNumber);
        if (!stillOutside) hideQrOverlay();
    }

    // ---------- Live updates ----------
    supabaseClient
        .channel("display_zone_changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "wms_no_shk_boxes" }, () => { void loadZone(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "wms_no_shk_racks" }, () => { void loadZone(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "wms_no_shk_shelves" }, () => { void loadZone(); })
        .subscribe();

    supabaseClient
        .channel("shift_close_display")
        .on("broadcast", { event: "show_qr" }, (message) => { showQrOverlay(message.payload); })
        .subscribe();

    void loadZone();
    // Safety net alongside Realtime -- same reasoning as print-bridge's own
    // poll-plus-subscription combo: a dropped Realtime connection on an
    // unattended screen should never mean a permanently stale display.
    setInterval(() => { void loadZone(); }, 20000);
})();
