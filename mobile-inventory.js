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
    const user = JSON.parse(userRaw);

    const stepTitle = document.getElementById("stepTitle");
    const stepMsg = document.getElementById("stepMsg");
    const video = document.getElementById("invVideo");
    const canvas = document.getElementById("invCanvas");
    const stepButtons = document.getElementById("stepButtons");

    let activeSession = null;
    let scanStream = null;
    let scanRafId = null;

    // ---------- Reusable camera scanner (shelf codes here, box codes in
    // Task 6, pairing code below) -- mirrors intake.js's
    // startCloseQrScan/scanCloseQrFrame pattern (wmsplus-intake-form repo).
    async function startScanner(onMatch) {
        stopScanner();
        video.style.display = "";
        try {
            scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        } catch (error) {
            stepMsg.textContent = "Не удалось открыть камеру: " + error.message;
            return;
        }
        video.srcObject = scanStream;
        await video.play();
        const ctx = canvas.getContext("2d");
        function tick() {
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                if (code && code.data) {
                    onMatch(code.data);
                    return; // caller decides whether to restart via stopScanner()+startScanner() again
                }
            }
            scanRafId = requestAnimationFrame(tick);
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
        const { data } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .select("id,status,step,started_by_name,started_at")
            .in("status", ["waiting_for_phone", "in_progress"])
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        return data || null;
    }

    async function startPairing() {
        const existing = await findActiveSession();
        if (existing) {
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
            stepMsg.textContent = "Не удалось начать инвентаризацию: " + (error ? error.message : "");
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
            // Task 5 implements the shelf-scan step from here.
        });
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
