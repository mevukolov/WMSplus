// mobile-login.js — login for the WMS+ mobile app (link-only, no nav
// entry). Uses the same Supabase Auth signInWithPassword flow the
// desktop login.html/auth.js uses (see
// docs/superpowers/specs/2026-09-29-rls-auth-migration-design.md), same
// synthetic <id>@wms.internal email. Stores its own session under a
// distinct localStorage key so it never collides with the desktop's own
// 'user' key/cache assumptions.
(function () {
    "use strict";
    const SUPABASE_URL = "https://bgphllmzmlwurfnbagho.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q";
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const LS_KEY = "wmsplus_mobile_user";

    if (localStorage.getItem(LS_KEY)) {
        window.location.href = "mobile-inventory.html";
        return;
    }

    const idInput = document.getElementById("idInput");
    const passInput = document.getElementById("passInput");
    const btn = document.getElementById("loginBtn");
    const msg = document.getElementById("loginMsg");

    async function doLogin() {
        if (btn.disabled) return;
        const id = idInput.value.trim();
        const pass = passInput.value;
        if (!id || !pass) {
            msg.textContent = "Введите ID и пароль";
            return;
        }
        btn.disabled = true;
        msg.textContent = "Вхожу...";
        try {
            const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                email: id + "@wms.internal",
                password: pass,
            });
            if (authError || !authData?.user) {
                msg.textContent = "Неверный ID или пароль";
                return;
            }
            const { data, error } = await supabaseClient
                .from("users")
                .select("id, fio")
                .eq("auth_uid", authData.user.id)
                .maybeSingle();
            if (error || !data) {
                msg.textContent = "Не удалось загрузить профиль";
                return;
            }
            localStorage.setItem(LS_KEY, JSON.stringify({ id: data.id, name: data.fio || "" }));
            window.location.href = "mobile-inventory.html";
        } catch (e) {
            console.error("Login exception", e);
            msg.textContent = "Ошибка сервера, попробуйте позже";
        } finally {
            btn.disabled = false;
        }
    }

    btn.addEventListener("click", doLogin);
    passInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
})();
