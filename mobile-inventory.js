// mobile-inventory.js — "Инвентаризация «Без ШК»", the mobile side.
// Paired live with display.js through wms_no_shk_inventory_sessions --
// see docs/superpowers/specs/2026-09-23-no-shk-inventory-design.md.
(function () {
    "use strict";
    const SUPABASE_URL = "https://bgphllmzmlwurfnbagho.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q";
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const LS_KEY = "wmsplus_mobile_user";

    const userRaw = localStorage.getItem(LS_KEY);
    if (!userRaw) {
        window.location.href = "mobile-login.html";
        return;
    }
    let user;
    try {
        user = JSON.parse(userRaw);
    } catch (e) {
        // Corrupted/hand-edited localStorage value -- treat exactly like
        // "not logged in" instead of throwing into a blank page.
        window.location.href = "mobile-login.html";
        return;
    }

    const stepTitle = document.getElementById("stepTitle");
    const stepMsg = document.getElementById("stepMsg");
    const video = document.getElementById("invVideo");
    const canvas = document.getElementById("invCanvas");
    const stepButtons = document.getElementById("stepButtons");

    let activeSession = null;
    let scanStream = null;
    let scanRafId = null;
    // Tracks the currently-rendered shelf-step buttons so finishShelf()'s
    // error paths can re-enable them -- they were disabled synchronously
    // by renderShelfButtons' click handler (the re-entrancy guard) before
    // finishShelf() ran, and a failure must leave the worker able to
    // retry rather than stuck with two dead buttons.
    let shelfFinishBtn = null;
    let shelfMissingBtn = null;

    // ---------- Reusable camera scanner (shelf codes here, box codes in
    // Task 6, pairing code below) -- mirrors intake.js's
    // startCloseQrScan/scanCloseQrFrame pattern (wmsplus-intake-form repo).
    async function startScanner(onMatch) {
        stopScanner();
        video.style.display = "";
        try {
            scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        } catch (error) {
            video.style.display = "none";
            stepMsg.textContent = "Не удалось открыть камеру: " + error.message;
            return;
        }
        video.srcObject = scanStream;
        await video.play();
        const ctx = canvas.getContext("2d");
        // Re-entrancy guard: a code held steady in frame decodes on every
        // tick, and onMatch is async (DB round-trips) -- without this, a
        // second onMatch for the SAME decode can start before the first
        // one finishes reacting to it (stopScanner(), dup-checks, etc.),
        // racing itself. Frames keep being captured/decoded regardless;
        // only the onMatch dispatch is serialized. Declared fresh per
        // startScanner() call so a stale `true` from a previous scan
        // session can never wedge a later one.
        let processingMatch = false;
        function tick() {
            if (video.readyState === video.HAVE_ENOUGH_DATA && !processingMatch) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                if (code && code.data) {
                    processingMatch = true;
                    Promise.resolve(onMatch(code.data)).finally(() => { processingMatch = false; });
                }
            }
            if (scanStream) { // still running unless onMatch called stopScanner()
                scanRafId = requestAnimationFrame(tick);
            }
        }
        scanRafId = requestAnimationFrame(tick);
    }

    function stopScanner() {
        if (scanRafId) { cancelAnimationFrame(scanRafId); scanRafId = null; }
        if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
        video.style.display = "none";
    }

    // ---------- Pairing ----------
    async function findActiveSession() {
        const { data, error } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .select("id,status,step,started_by_name,started_at")
            .in("status", ["waiting_for_phone", "in_progress"])
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) {
            // Indistinguishable from "no active session" to the caller, but
            // at least not invisible for debugging.
            console.error("findActiveSession query failed", error);
        }
        return data || null;
    }

    async function startPairing() {
        const existing = await findActiveSession();
        if (existing) {
            activeSession = existing; // lets the abandon-recovery watcher below react if this session (found, not started here) later gets marked abandoned or completes.
            stepTitle.textContent = "Инвентаризация уже идёт";
            stepMsg.textContent = "Начал(а): " + (existing.started_by_name || "неизвестно") + " в " + new Date(existing.started_at).toLocaleTimeString("ru-RU");
            return;
        }

        const { data, error } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .insert({ status: "waiting_for_phone", step: "pairing", started_by_id: String(user.id), started_by_name: user.name })
            .select("id")
            .single();
        if (error || !data) {
            // Covers both a real failure and the app-level check above
            // losing a race to the DB's own unique-active-session index --
            // either way the friendly message is right, never the raw
            // Postgres constraint text.
            if (error) console.error("Failed to start inventory session", error);
            stepMsg.textContent = "Инвентаризация уже идёт, попробуйте позже";
            return;
        }
        activeSession = { id: data.id };

        stepTitle.textContent = "Отсканируйте QR на экране";
        stepMsg.textContent = "Экран, на который выводится инвентаризация";
        void startScanner(async (text) => {
            if (text !== "WMSP.INV." + activeSession.id) return; // not our pairing code, keep scanning
            stopScanner();
            const { error: updateError } = await supabaseClient
                .from("wms_no_shk_inventory_sessions")
                .update({ status: "in_progress", step: "scan_shelf", last_activity_at: new Date().toISOString() })
                .eq("id", activeSession.id);
            if (updateError) {
                stepMsg.textContent = "Ошибка: " + updateError.message;
                return;
            }
            stepTitle.textContent = "Отсканируйте полку";
            stepMsg.textContent = "";
            void startShelfScan();
        });
    }

    // ---------- Per-shelf loop ----------
    async function startShelfScan() {
        stepTitle.textContent = "Отсканируйте полку";
        stepMsg.textContent = "";
        stepButtons.innerHTML = "";
        const { error: resetStepError } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .update({ step: "scan_shelf", current_shelf_id: null, last_activity_at: new Date().toISOString() })
            .eq("id", activeSession.id);
        if (resetStepError) console.error("Failed to reset session to scan_shelf", resetStepError); // housekeeping only -- scanning still starts below regardless

        void startScanner(async (text) => {
            // WMSP.PLCE.WSHK.{rack_number}.{shelf_number}
            const match = /^WMSP\.PLCE\.WSHK\.(\d+)\.(\d+)$/.exec(text);
            if (!match) return; // not a shelf code, keep scanning
            const rackNumber = Number(match[1]);
            const shelfNumber = Number(match[2]);
            const { data: shelfRows, error: shelfError } = await supabaseClient
                .from("wms_no_shk_shelves")
                .select("id,name,capacity,rack_id,wms_no_shk_racks!inner(rack_number)")
                .eq("shelf_number", shelfNumber)
                .eq("wms_no_shk_racks.rack_number", rackNumber)
                .limit(1);
            if (shelfError) { stepMsg.textContent = "Ошибка: " + shelfError.message; return; }
            const shelf = shelfRows && shelfRows[0];
            if (!shelf) {
                stepMsg.textContent = "Полка не найдена в системе";
                return;
            }
            stopScanner();

            // Reopen (or create) this session's audit row for the shelf --
            // re-scanning an already-audited shelf this session should
            // redo it cleanly, not create a duplicate/conflicting record.
            const { error: clearError } = await supabaseClient
                .from("wms_no_shk_inventory_box_results")
                .delete()
                .eq("session_id", activeSession.id)
                .eq("shelf_id", shelf.id);
            if (clearError) { stepMsg.textContent = "Ошибка: " + clearError.message; return; }

            const { data: existingAudit, error: auditLookupError } = await supabaseClient
                .from("wms_no_shk_inventory_shelf_audits")
                .select("id")
                .eq("session_id", activeSession.id)
                .eq("shelf_id", shelf.id)
                .maybeSingle();
            if (auditLookupError) { stepMsg.textContent = "Ошибка: " + auditLookupError.message; return; }

            if (existingAudit) {
                const { error: auditUpdateError } = await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
                    .update({ started_at: new Date().toISOString(), finished_at: null, boxes_found_count: 0, boxes_missing_sticker_count: 0, boxes_not_found_count: 0 })
                    .eq("id", existingAudit.id);
                if (auditUpdateError) { stepMsg.textContent = "Ошибка: " + auditUpdateError.message; return; }
            } else {
                const { error: auditInsertError } = await supabaseClient.from("wms_no_shk_inventory_shelf_audits").insert({ session_id: activeSession.id, shelf_id: shelf.id });
                if (auditInsertError) { stepMsg.textContent = "Ошибка: " + auditInsertError.message; return; }
            }

            activeSession.shelfId = shelf.id;
            activeSession.shelf = shelf;
            const { error: sessionUpdateError } = await supabaseClient
                .from("wms_no_shk_inventory_sessions")
                .update({ step: "scan_boxes", current_shelf_id: shelf.id, last_activity_at: new Date().toISOString() })
                .eq("id", activeSession.id);
            if (sessionUpdateError) { stepMsg.textContent = "Ошибка: " + sessionUpdateError.message; return; }
            void startBoxScan(shelf);
        });
    }

    async function scannedCountForCurrentShelf() {
        const { count } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("id", { count: "exact", head: true })
            .eq("session_id", activeSession.id)
            .eq("shelf_id", activeSession.shelfId);
        return count || 0;
    }

    function renderShelfButtons(scannedCount, shelf) {
        stepButtons.innerHTML = "";
        const finishLabel = scannedCount === 0 ? "На полке нет коробов" : "На полке больше нет коробов";
        const finishBtn = document.createElement("button");
        finishBtn.className = "btn";
        finishBtn.textContent = finishLabel;
        let missingBtn = null;
        finishBtn.addEventListener("click", () => {
            // Disable synchronously, before any await, so a fast double-tap
            // can't re-enter finishShelf() while the first call is still in
            // flight (which would insert duplicate not_found rows and could
            // race the session-completion check) -- same disable-on-click
            // guard selectMissingStickerBox's caller uses below.
            finishBtn.disabled = true;
            if (missingBtn) missingBtn.disabled = true;
            void finishShelf();
        });
        stepButtons.appendChild(finishBtn);

        if (scannedCount < shelf.capacity) {
            missingBtn = document.createElement("button");
            missingBtn.className = "btn btn-outline";
            missingBtn.textContent = "Короб без наклейки";
            missingBtn.addEventListener("click", () => void openMissingStickerList());
            stepButtons.appendChild(missingBtn);
        }

        // Recorded so finishShelf()'s error paths can re-enable exactly
        // these buttons (see the module-level declaration above).
        shelfFinishBtn = finishBtn;
        shelfMissingBtn = missingBtn;
    }

    async function startBoxScan(shelf) {
        stepTitle.textContent = "Отсканируйте все короба на полке слева направо";
        stepMsg.textContent = shelf.name;
        const count = await scannedCountForCurrentShelf();
        renderShelfButtons(count, shelf);

        void startScanner(async (text) => {
            const match = /^WMSP\.BOX\.(\d+)$/.exec(text);
            if (!match) return;
            const boxNumber = Number(match[1]);
            const { data: boxRows, error: boxLookupError } = await supabaseClient.from("wms_no_shk_boxes").select("id").eq("box_number", boxNumber).limit(1);
            if (boxLookupError) { stepMsg.textContent = "Ошибка: " + boxLookupError.message; return; }
            const box = boxRows && boxRows[0];
            if (!box) { stepMsg.textContent = "Короб №" + boxNumber + " не найден"; return; }

            const { data: dup, error: dupError } = await supabaseClient
                .from("wms_no_shk_inventory_box_results")
                .select("id")
                .eq("session_id", activeSession.id)
                .eq("shelf_id", shelf.id)
                .eq("box_id", box.id)
                .maybeSingle();
            if (dupError) { stepMsg.textContent = "Ошибка: " + dupError.message; return; }
            if (dup) { stepMsg.textContent = "Короб №" + boxNumber + " уже отсканирован"; return; }

            // These two must both succeed before we tell the worker the box
            // was recorded -- an insert failure here must NOT be followed by
            // a false-positive "добавлен" message (the whole reason this
            // block now checks `error` at every step).
            const { error: insertError } = await supabaseClient.from("wms_no_shk_inventory_box_results").insert({ session_id: activeSession.id, shelf_id: shelf.id, box_id: box.id, result: "found" });
            if (insertError) { stepMsg.textContent = "Ошибка: " + insertError.message; return; }
            const { error: boxUpdateError } = await supabaseClient.from("wms_no_shk_boxes").update({ shelf_id: shelf.id }).eq("id", box.id);
            if (boxUpdateError) { stepMsg.textContent = "Ошибка: " + boxUpdateError.message; return; }

            const newCount = await scannedCountForCurrentShelf();
            const { error: auditUpdateError } = await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
                .update({ boxes_found_count: newCount })
                .eq("session_id", activeSession.id).eq("shelf_id", shelf.id);
            const { error: touchError } = await supabaseClient.from("wms_no_shk_inventory_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", activeSession.id);
            if (touchError) console.error("Failed to touch last_activity_at", touchError); // housekeeping only, box result above already recorded

            // The box itself is safely recorded by this point (both awaits
            // above succeeded) -- a boxes_found_count update failure here is
            // a denormalized-counter hiccup, not a lost scan, so it's
            // surfaced but doesn't block rendering the (independently
            // queried, so still accurate) button state.
            stepMsg.textContent = auditUpdateError
                ? "Короб №" + boxNumber + " добавлен, но не удалось обновить счётчик: " + auditUpdateError.message
                : "Короб №" + boxNumber + " добавлен (" + shelf.name + ")";
            renderShelfButtons(newCount, shelf);
            // keep scanning -- do NOT stop the scanner here, the loop in
            // startScanner already re-arms via requestAnimationFrame for
            // every call that doesn't return early
        });
    }

    // ---------- Короб без наклейки ----------
    // Same date helpers as no_shk_zone.js's printActiveBox() (that file's
    // lines ~541-550) -- duplicated here rather than shared because this
    // repo has no module system (print-tspl.js is duplicated the same way
    // across repos).
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

    async function openMissingStickerList() {
        stopScanner();
        stepTitle.textContent = "Выберите короб";
        stepMsg.textContent = "";

        const { data: allBoxes, error: allBoxesError } = await supabaseClient
            .from("wms_no_shk_boxes")
            .select("id,box_number,area,shift_date,shift_type,box_type")
            .order("box_number", { ascending: true });
        if (allBoxesError) { stepMsg.textContent = "Ошибка: " + allBoxesError.message; return; }
        const { data: alreadyAccounted, error: alreadyAccountedError } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("box_id")
            .eq("session_id", activeSession.id)
            .eq("shelf_id", activeSession.shelfId);
        if (alreadyAccountedError) { stepMsg.textContent = "Ошибка: " + alreadyAccountedError.message; return; }
        const excluded = new Set((alreadyAccounted || []).map((r) => r.box_id));
        const candidates = (allBoxes || []).filter((b) => !excluded.has(b.id));

        stepButtons.innerHTML = "";
        const filterInput = document.createElement("input");
        filterInput.className = "field";
        filterInput.placeholder = "Номер короба...";
        filterInput.style.marginBottom = "10px";
        stepButtons.appendChild(filterInput);

        const list = document.createElement("div");
        list.style.cssText = "display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto;";
        stepButtons.appendChild(list);

        function renderList(filterText) {
            list.innerHTML = "";
            const filtered = filterText
                ? candidates.filter((b) => String(b.box_number).includes(filterText))
                : candidates;
            filtered.slice(0, 100).forEach((box) => {
                const item = document.createElement("button");
                item.className = "btn btn-outline";
                item.style.textAlign = "left";
                item.textContent = "№" + box.box_number + " — " + box.area + ", " + box.box_type;
                item.addEventListener("click", () => {
                    // Disable synchronously, before any await, so a fast
                    // double-click/tap on the same box can't re-enter
                    // selectMissingStickerBox while the first click is
                    // still in flight (which would insert a duplicate
                    // box_results row and queue a second print job).
                    item.disabled = true;
                    void selectMissingStickerBox(box, item);
                });
                list.appendChild(item);
            });
        }
        renderList("");
        filterInput.addEventListener("input", () => renderList(filterInput.value.trim()));

        const backBtn = document.createElement("button");
        backBtn.className = "btn btn-outline";
        backBtn.textContent = "Назад";
        backBtn.addEventListener("click", () => void startBoxScan(activeSession.shelf));
        stepButtons.appendChild(backBtn);
    }

    async function selectMissingStickerBox(box, btn) {
        const { error: resultInsertError } = await supabaseClient.from("wms_no_shk_inventory_box_results").insert({
            session_id: activeSession.id, shelf_id: activeSession.shelfId, box_id: box.id, result: "missing_sticker",
        });
        if (resultInsertError) {
            stepMsg.textContent = "Ошибка: " + resultInsertError.message;
            if (btn) btn.disabled = false; // let the worker retry instead of leaving a dead button
            return;
        }
        const { error: boxUpdateError } = await supabaseClient.from("wms_no_shk_boxes").update({ shelf_id: activeSession.shelfId }).eq("id", box.id);
        if (boxUpdateError) {
            stepMsg.textContent = "Ошибка: " + boxUpdateError.message;
            if (btn) btn.disabled = false;
            return;
        }

        // Reprint this box's own sticker -- same payload shape
        // no_shk_zone.js's printActiveBox() builds for the "Короб «Без
        // ШК»" template.
        const { data: template, error: templateError } = await supabaseClient
            .from("print_label_templates")
            .select("id,width_mm,height_mm,elements")
            .eq("name", "Короб «Без ШК»")
            .maybeSingle();
        if (templateError) console.error("Failed to load print template", templateError); // reprint is best-effort here -- the box result above already succeeded
        if (template) {
            const tsplData = {
                box_code: "WMSP.BOX." + String(box.box_number).padStart(5, "0"),
                box_number: String(box.box_number),
                box_type: box.box_type,
                area: box.area,
                date_line1: formatDateShort(box.shift_date),
                date_line2: box.shift_type === "Ночная" ? formatDateShort(addDays(box.shift_date, 1)) : "",
                shift: box.shift_type === "Ночная" ? "Ночь" : "День",
            };
            const { error: printJobError } = await supabaseClient.from("print_jobs").insert({
                template_id: template.id, data: tsplData,
                tspl: window.buildTsplPayloadBase64 ? window.buildTsplPayloadBase64(template, tsplData) : null,
                created_by: user.id != null ? String(user.id) : null,
            });
            if (printJobError) console.error("Failed to queue print job", printJobError); // reprint is best-effort -- the box result above already succeeded
        }

        const newCount = await scannedCountForCurrentShelf();
        const { error: auditUpdateError } = await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
            .update({ boxes_missing_sticker_count: (await currentMissingStickerCount()) })
            .eq("session_id", activeSession.id).eq("shelf_id", activeSession.shelfId);
        if (auditUpdateError) console.error("Failed to update boxes_missing_sticker_count", auditUpdateError); // denormalized counter only -- the box result above already succeeded
        const { error: touchError } = await supabaseClient.from("wms_no_shk_inventory_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", activeSession.id);
        if (touchError) console.error("Failed to touch last_activity_at", touchError); // housekeeping only

        stepMsg.textContent = "Стикер короба №" + box.box_number + " поставлен в печать";
        void startBoxScan(activeSession.shelf);
        void newCount; // count is re-read by startBoxScan's own renderShelfButtons call
    }

    async function currentMissingStickerCount() {
        const { count, error } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("id", { count: "exact", head: true })
            .eq("session_id", activeSession.id).eq("shelf_id", activeSession.shelfId).eq("result", "missing_sticker");
        if (error) console.error("Failed to count missing_sticker results", error);
        return count || 0;
    }

    // ---------- Finishing a shelf ----------
    // Re-enables the shelf-step buttons on an error return below -- they
    // were disabled synchronously by renderShelfButtons' click handler
    // (the re-entrancy guard) before finishShelf() ran, so a failure here
    // must give the worker a way to retry instead of leaving both buttons
    // permanently dead (same reasoning as selectMissingStickerBox's own
    // re-enable-on-error, one function away in this same file).
    function reenableShelfButtons() {
        if (shelfFinishBtn) shelfFinishBtn.disabled = false;
        if (shelfMissingBtn) shelfMissingBtn.disabled = false;
    }

    async function finishShelf() {
        stopScanner();
        const shelf = activeSession.shelf;

        // Boxes the DB currently says are on this shelf but weren't
        // matched (found or missing_sticker) during this pass -> not_found.
        const { data: dbBoxesHere, error: dbBoxesHereError } = await supabaseClient
            .from("wms_no_shk_boxes")
            .select("id")
            .eq("shelf_id", shelf.id);
        if (dbBoxesHereError) { stepMsg.textContent = "Ошибка: " + dbBoxesHereError.message; reenableShelfButtons(); return; }
        const { data: accountedFor, error: accountedForError } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("box_id")
            .eq("session_id", activeSession.id).eq("shelf_id", shelf.id);
        if (accountedForError) { stepMsg.textContent = "Ошибка: " + accountedForError.message; reenableShelfButtons(); return; }
        const accountedIds = new Set((accountedFor || []).map((r) => r.box_id));
        const notFound = (dbBoxesHere || []).filter((b) => !accountedIds.has(b.id));
        if (notFound.length) {
            const { error: notFoundInsertError } = await supabaseClient.from("wms_no_shk_inventory_box_results").insert(
                notFound.map((b) => ({ session_id: activeSession.id, shelf_id: shelf.id, box_id: b.id, result: "not_found" }))
            );
            if (notFoundInsertError) { stepMsg.textContent = "Ошибка: " + notFoundInsertError.message; reenableShelfButtons(); return; }
        }

        const { error: auditFinishError } = await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
            .update({ finished_at: new Date().toISOString(), boxes_not_found_count: notFound.length })
            .eq("session_id", activeSession.id).eq("shelf_id", shelf.id);
        if (auditFinishError) { stepMsg.textContent = "Ошибка: " + auditFinishError.message; reenableShelfButtons(); return; }

        const { count: totalShelves, error: totalShelvesError } = await supabaseClient
            .from("wms_no_shk_shelves")
            .select("id", { count: "exact", head: true });
        if (totalShelvesError) { stepMsg.textContent = "Ошибка: " + totalShelvesError.message; reenableShelfButtons(); return; }
        const { data: finishedRows, error: finishedRowsError } = await supabaseClient
            .from("wms_no_shk_inventory_shelf_audits")
            .select("shelf_id")
            .eq("session_id", activeSession.id)
            .not("finished_at", "is", null);
        if (finishedRowsError) { stepMsg.textContent = "Ошибка: " + finishedRowsError.message; reenableShelfButtons(); return; }
        const finishedCount = new Set((finishedRows || []).map((r) => r.shelf_id)).size;

        if (totalShelves != null && finishedCount >= totalShelves) {
            const { error: completeSessionError } = await supabaseClient
                .from("wms_no_shk_inventory_sessions")
                .update({ status: "completed", step: "completed", finished_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
                .eq("id", activeSession.id);
            // The shelf itself is already finished in the DB by this point
            // (the shelf_audits update above succeeded) -- only the
            // session-completion update failed, so re-enabling here lets
            // the worker retry the finish tap, which safely re-runs this
            // now-idempotent shelf-finish work and tries the completion
            // update again, rather than being stuck on a dead screen.
            if (completeSessionError) { stepMsg.textContent = "Ошибка: " + completeSessionError.message; reenableShelfButtons(); return; }
            void showCompletion();
            return;
        }

        activeSession.shelfId = null;
        activeSession.shelf = null;
        void startShelfScan();
    }

    // ---------- Completion ----------
    async function showCompletion() {
        stepButtons.innerHTML = "";
        video.style.display = "none";
        const { data, error } = await supabaseClient.from("wms_no_shk_inventory_sessions").select("started_at,finished_at").eq("id", activeSession.id).single();
        stepTitle.textContent = "✓ Инвентаризация завершена";
        if (error || !data) {
            // The session itself already completed successfully (finishShelf()
            // wouldn't have called showCompletion() otherwise) -- this is just
            // the follow-up read for the elapsed-time display failing, so fall
            // back to a generic message instead of crashing on
            // `new Date(undefined)` below.
            stepMsg.textContent = "Готово!";
        } else {
            const elapsedMs = new Date(data.finished_at).getTime() - new Date(data.started_at).getTime();
            const totalSec = Math.max(0, Math.round(elapsedMs / 1000));
            const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
            const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
            const ss = String(totalSec % 60).padStart(2, "0");
            stepMsg.textContent = "Время: " + hh + ":" + mm + ":" + ss;
        }
        setTimeout(() => { window.location.href = "mobile-inventory.html"; }, 3000);
    }

    // Recovers a phone left open on a session that got marked abandoned
    // (by display.js's own 30-minute staleness check, or by this same
    // check running on ANOTHER idle phone) -- whichever side notices
    // first wins, both react the same way: reload back to the start
    // screen instead of sitting stuck on a dead scan prompt.
    supabaseClient
        .channel("mobile_inventory_session_watch")
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wms_no_shk_inventory_sessions" }, (payload) => {
            if (activeSession && payload.new.id === activeSession.id && payload.new.status === "abandoned") {
                window.location.reload();
            }
        })
        .subscribe();

    void startPairing();
})();
