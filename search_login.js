// search_login.js — dedicated sign-in for search.html. Same
// signInWithPassword + users-profile-lookup flow as the main app's
// auth.js, just redirects to search.html instead of index.html, and
// never involves ui.js or login.html. Self-contained: its own Supabase
// client, no shared globals.
(function () {
    "use strict";

    const SUPABASE_URL = "https://bgphllmzmlwurfnbagho.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q";
    const supabaseClient = (typeof supabase !== "undefined") ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

    const $ = (id) => document.getElementById(id);

    document.addEventListener("DOMContentLoaded", () => {
        // Already have a live session? Skip straight past the form.
        if (localStorage.getItem("user") && supabaseClient) {
            supabaseClient.auth.getSession().then(({ data }) => {
                if (data && data.session) window.location.href = "search.html";
            });
        }

        const idInput = $("loginId");
        const passInput = $("loginPass");
        const btn = $("loginBtn");
        const errorEl = $("loginError");
        if (!idInput || !passInput || !btn || !errorEl || !supabaseClient) return;

        async function doLogin() {
            const id = idInput.value.trim();
            const pass = passInput.value;
            if (!id || !pass) {
                errorEl.textContent = "Введите ID и пароль";
                return;
            }
            btn.disabled = true;
            errorEl.textContent = "";
            try {
                const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                    email: id + "@wms.internal",
                    password: pass,
                });
                if (authError || !authData || !authData.user) {
                    errorEl.textContent = "Неверный ID или пароль";
                    return;
                }
                const { data, error } = await supabaseClient
                    .from("users")
                    .select("*")
                    .eq("auth_uid", authData.user.id)
                    .maybeSingle();
                if (error || !data) {
                    console.error("Profile lookup error", error);
                    errorEl.textContent = "Не удалось загрузить профиль";
                    return;
                }
                const userObj = {
                    id: data.id,
                    name: data.fio || data.name || "",
                    fio: data.fio || "",
                    accesses: Array.isArray(data.accesses) ? data.accesses : (data.accesses ? [data.accesses] : []),
                };
                localStorage.setItem("user", JSON.stringify(userObj));
                window.location.href = "search.html";
            } catch (e) {
                console.error("Login exception", e);
                errorEl.textContent = "Ошибка сервера, попробуйте позже";
            } finally {
                btn.disabled = false;
            }
        }

        btn.addEventListener("click", () => void doLogin());
        [idInput, passInput].forEach((input) => {
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") { event.preventDefault(); void doLogin(); }
            });
        });
    });
})();
