/* ui.js — ПОЛНЫЙ ФАЙЛ (КЭШИРОВАНИЕ: user + wh + pages + access)
   ------------------------------------------------------------
   Все кэши:
     user_cache     — TTL 30s
     wh_cache       — TTL 60s
     pages_cache    — TTL 30s
     page_access    — TTL 30s
*/
const T0 = performance.now();
function t(label) {
    console.log(`⏱ ${label}: ${(performance.now() - T0).toFixed(1)}ms`);
}



/* ============================================================================================
   Часть 1/5 — ИНИЦИАЛИЗАЦИЯ SUPABASE
============================================================================================ */

let supabaseClient;
if (typeof window.supabaseClient !== 'undefined') {
    supabaseClient = window.supabaseClient;
} else if (typeof window.supabase !== 'undefined') {
    const _URL = (typeof window.SUPABASE_URL !== 'undefined')
        ? window.SUPABASE_URL
        : 'https://bgphllmzmlwurfnbagho.supabase.co';

    const _KEY = (typeof window.SUPABASE_ANON_KEY !== 'undefined')
        ? window.SUPABASE_ANON_KEY
        : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q';

    try {
        supabaseClient = supabase.createClient(_URL, _KEY);
        window.supabaseClient = supabaseClient;
    } catch (e) {
        console.error('Supabase client creation failed:', e);
    }
} else {
    console.error('Supabase SDK not loaded.');
}



/* ============================================================================================
   TTL КЭШЕЙ
============================================================================================ */

const USER_CACHE_TTL  = 30 * 1000;
const WH_CACHE_TTL    = 30 * 1000;
const PAGES_CACHE_TTL = 30 * 1000;
const ACCESS_CACHE_TTL = 30 * 1000;



/* ============================================================================================
   ФУНКЦИИ ОБЩЕГО КЭША
============================================================================================ */

// -------------------------------
// CACHE SYSTEM (исправленная версия)
// -------------------------------

// Return format всегда: {timestamp, data}
// Но вызывающие функции ВСЕГДА работают с .data
function loadCache(key) {
    try {
        const raw = JSON.parse(localStorage.getItem(key));
        if (!raw || typeof raw !== "object") return null;
        if (!raw.timestamp || !("data" in raw)) return null;
        return raw; // {timestamp, data}
    } catch {
        return null;
    }
}

function saveCache(key, data) {
    localStorage.setItem(
        key,
        JSON.stringify({
            timestamp: Date.now(),
            data: data
        })
    );
}

// Удаление (оставляем как есть)
function clearCache(key) {
    localStorage.removeItem(key);
}




/* ============================================================================================
   Часть 1 — КЭШ pages (меню)
============================================================================================ */

async function loadPagesFromSupabase() {
    const cache = loadCache("pages_cache");
    if (cache && (Date.now() - cache.timestamp < PAGES_CACHE_TTL)) {
        return cache.data;
    }

    if (!supabaseClient) return [];

    const { data, error } = await supabaseClient
        .from('pages')
        .select('*')
        .order('menu_group', { ascending: true })
        .order('page_name', { ascending: true });

    if (error) {
        console.error("Ошибка загрузки pages:", error);
        return cache?.data || [];
    }

    saveCache("pages_cache", data);
    return data;
}



/* ============================================================================================
   Часть 1 — APPLY PAGE TITLE (используем кэш, если есть)
============================================================================================ */

async function applyPageTitleFromSupabase() {
    try {
        const current = window.location.pathname.split("/").pop() || "index.html";

        let accessCache = loadCache("page_access_cache_" + current);
        if (accessCache && Date.now() - accessCache.timestamp < ACCESS_CACHE_TTL) {
            if (accessCache.data?.page_name) {
                document.title = `WMS+ — ${accessCache.data.page_name}`;
            }
            return;
        }

        if (!supabaseClient) return;

        const { data, error } = await supabaseClient
            .from("pages")
            .select("page_name")
            .eq("url", current)
            .maybeSingle();

        if (error || !data) return;

        saveCache("page_access_cache_" + current, data);
        if (data.page_name) {
            document.title = `WMS+ — ${data.page_name}`;
        }
    } catch {}
}



/* ============================================================================================
   Часть 2/5 — ACCESS ДЛЯ СТРАНИЦЫ (кэш)
============================================================================================ */

async function getPageAccessFromSupabase() {
    const current = window.location.pathname.split('/').pop() || "index.html";
    const key = "page_access_cache_" + current;

    const cache = loadCache(key);
    if (cache && Date.now() - cache.timestamp < ACCESS_CACHE_TTL) {
        return cache.data?.page || cache.data || null; // Кэш первичный
    }

    // Только если кэш нет — делаем запрос
    if (!supabaseClient) return null;

    try {
        const { data, error } = await supabaseClient
            .from("pages")
            .select("page, page_name, url")
            .eq("url", current)
            .maybeSingle();

        if (!error && data) saveCache(key, data);
        return data?.page || null;
    } catch {
        return null;
    }
}


/* ============================================================================================
   Часть 2 — КЭШ wh (склады)
============================================================================================ */

async function getWarehouseNameById(whId) {
    if (!whId) return null;

    const key = "wh_cache_" + whId;
    const cache = loadCache(key);
    if (cache && (Date.now() - cache.timestamp < WH_CACHE_TTL)) {
        return cache.data;
    }

    if (!supabaseClient) return null;

    const { data, error } = await supabaseClient
        .from('wh_rep')
        .select('wh_name')
        .eq('wh_id', String(whId))
        .maybeSingle();

    if (error || !data) return null;

    saveCache(key, data.wh_name);
    return data.wh_name;
}



/* ============================================================================================
   Часть 2 — КЭШ USER + обновление в UI
============================================================================================ */

async function checkUserAccess() {
    let userLocal = JSON.parse(localStorage.getItem('user') || 'null');
    if (!userLocal) {
        window.location.href = 'login.html';
        return;
    }

    const cache = loadCache("user_cache");
    if (cache && Date.now() - cache.timestamp < USER_CACHE_TTL) {
        const u = cache.data;
        if (u) {
            updateUserName(u.name);
            updateHeaderWarehouseName(u.wh_name);
            filterMenu(u.accesses || []);
            localStorage.setItem("user", JSON.stringify(u));
        }
        return; // 🚀 важно: прекращаем функцию, не делаем запрос
    }

    if (!supabaseClient) return;

    try {
        const { data, error } = await supabaseClient
            .from('users')
            .select('*')
            .eq('id', userLocal.id)
            .single();

        if (!data || error) throw error || new Error("User not found");

        const accesses = Array.isArray(data.accesses)
            ? data.accesses
            : String(data.accesses || '').split(',').map(a => a.trim()).filter(Boolean);

        const wh_name = await getWarehouseNameById(data.user_wh_id);

        const fresh = { id: data.id, name: data.fio, accesses, user_wh_id: data.user_wh_id, wh_name };

        localStorage.setItem("user", JSON.stringify(fresh));
        saveCache("user_cache", fresh);

        updateUserName(fresh.name);
        updateHeaderWarehouseName(fresh.wh_name);
        filterMenu(fresh.accesses || []);

    } catch {
        // fallback — используем локальный user
        if (userLocal?.name) updateUserName(userLocal.name);
        if (userLocal?.wh_name) updateHeaderWarehouseName(userLocal.wh_name);
        if (userLocal?.accesses) filterMenu(userLocal.accesses);
    }
}


/* ============================================================================================
   Часть 2 — APPLY WH NAME
============================================================================================ */

function updateHeaderWarehouseName(name) {
    if (!name) return;
    const el = document.querySelector('.header-title');
    if (el) {
        el.textContent = name;
        return;
    }

    const obs = new MutationObserver(() => {
        const el2 = document.querySelector('.header-title');
        if (el2) {
            el2.textContent = name;
            obs.disconnect();
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
}



/* ============================================================================================
   Часть 3/5 — РЕНДЕР МЕНЮ (кэш pages уже используется в loadPages)
============================================================================================ */

async function renderMenuFromSupabase() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const wrap = sidebar.querySelector('.sidebar-content');
    if (!wrap) return;

    // Если меню уже есть в DOM — не перерисовываем (чтобы не ломать состояние, listeners и т.д.)
    if (wrap.childElementCount > 0) {
        // Но мы всё равно могут триггернуть фильтрацию в зависимости от текущего user
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        filterMenu(user.accesses || []);
        return;
    }

    // loadPagesFromSupabase использует pages_cache внутри — поэтому вызов будет быстрый при наличии кэша
    const pages = await loadPagesFromSupabase();

    // группируем и рендерим — логика идентична оригиналу
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const accesses = Array.isArray(user.accesses) ? user.accesses : [];

    const groups = {};
    pages.forEach(p => {
        const g = p.menu_group || "Другое";
        if (!groups[g]) groups[g] = [];
        groups[g].push(p);
    });

    for (const groupName of Object.keys(groups)) {
        const pagesInGroup = groups[groupName].filter(p => {
            if (!p.page) return true;
            return accesses.includes(p.page);
        });

        if (pagesInGroup.length === 0) continue;

        const catIcon = pagesInGroup.reduce((acc, cur) => acc || cur.menu_icon, null)
            || 'https://raw.githubusercontent.com/mevukolov/WMSplus/main/icons/default.svg';

        const catDiv = document.createElement('div');
        catDiv.className = 'menu-category';

        const header = document.createElement('div');
        header.className = 'menu-category-header';
        header.innerHTML = `
            <div class="menu-header-left">
                <span class="menu-icon"><img src="${catIcon}" width="20"/></span>
                <span class="menu-title">${groupName}</span>
            </div>
            <span class="menu-arrow">
                <img src="https://raw.githubusercontent.com/mevukolov/WMSplus/refs/heads/main/icons/angle-down.svg" width="14"/>
            </span>`;

        const list = document.createElement('ul');
        list.className = 'menu-list';

        pagesInGroup.forEach(p => {
            const pageIcon = p.page_icon || p.menu_icon || 'https://raw.githubusercontent.com/mevukolov/WMSplus/main/icons/default-page.svg';
            const title = p.page_name || p.page || p.url;

            const li = document.createElement("li");
            li.innerHTML = `
               <a href="${p.url}" data-access="${p.page || ''}">
                    <img class="page-icon" src="${pageIcon}" width="16" style="margin-right:8px;opacity:.9">
                    <span>${title}</span>
               </a>`;

            list.appendChild(li);
        });

        header.addEventListener('click', () => {
            wrap.querySelectorAll('.menu-category').forEach(c => {
                if (c !== catDiv) c.classList.remove('open');
            });
            catDiv.classList.toggle('open');
        });

        catDiv.appendChild(header);
        catDiv.appendChild(list);
        wrap.appendChild(catDiv);
    }
}




/* ============================================================================================
   Часть 4/5 — ФИЛЬТРАЦИЯ МЕНЮ + ИМЯ ПОЛЬЗОВАТЕЛЯ
============================================================================================ */

function filterMenu(accesses = []) {
    document.querySelectorAll('#sidebar a').forEach(a => {
        const access = a.getAttribute('data-access');
        if (!access) {
            a.style.display = '';
            return;
        }
        if (a.href.includes('index.html')) {
            a.style.display = '';
            return;
        }
        a.style.display = accesses.includes(access) ? '' : 'none';
    });
}

function updateUserName(name) {
    if (!name) return;

    function apply() {
        const els = document.querySelectorAll('#user-name, #user-name-small');
        if (els.length === 0) return false;
        els.forEach(e => (e.textContent = name));
        return true;
    }

    if (apply()) return;

    const obs = new MutationObserver(() => {
        if (apply()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
}



/* ============================================================================================
   Часть 4 — DOMContentLoaded
============================================================================================ */

document.addEventListener('DOMContentLoaded', () => {
    const raw = localStorage.getItem('user');
    if (!raw) {
        window.location.href = "login.html";
        return;
    }

    const cachedUser = JSON.parse(raw);
    const userAccesses = cachedUser.accesses || [];

    // Получаем текущую страницу
    const currentPage = window.location.pathname.split('/').pop() || "index.html";

    // Сразу проверяем доступ по кэшу
    // pages_cache хранит все страницы с полем page
    const pagesCache = loadCache("pages_cache")?.data || [];
    const pageObj = pagesCache.find(p => p.url === currentPage);

    if (pageObj?.page && !userAccesses.includes(pageObj.page)) {
        // Пользователь не имеет доступа → редирект мгновенно
        console.warn(`No access to page "${pageObj.page}". Redirecting...`);
        window.location.href = "index.html";
        return;
    }

    // Мгновенно обновляем UI
    updateUserName(cachedUser.name);
    updateHeaderWarehouseName(cachedUser.wh_name || "");
    filterMenu(userAccesses);

    // Асинхронно подгружаем свежие данные
    checkUserAccess();
    renderMenuFromSupabase();
});


/* ============================================================================================
   Часть 5/5 — TOASTS + SIDEBAR + LOADER (без изменений)
============================================================================================ */

const toastsRoot = document.getElementById('toasts');

function createToast(msg, opts = {}) {
    const { duration = 3000, type = 'default' } = opts;
    const el = document.createElement('div');
    el.className = 'toast';

    if (type === 'success') el.style.background = 'linear-gradient(90deg,#16a34a,#059669)';
    if (type === 'error') el.style.background = 'linear-gradient(90deg,#ef4444,#dc2626)';
    if (type === 'info') el.style.background = 'linear-gradient(90deg,#2563eb,#1e40af)';

    el.innerHTML = `
        <div style="flex:1">${msg}</div>
        <button style="background:none;border:0;color:#fff;font-weight:bold;cursor:pointer">✕</button>
    `;

    el.querySelector('button').onclick = () => remove();

    function remove() {
        el.style.opacity = '0';
        el.style.transform = 'translateY(6px)';
        setTimeout(() => el.remove(), 180);
    }

    if (toastsRoot) toastsRoot.appendChild(el);
    const t = setTimeout(remove, duration);
    el._timer = t;
    return el;
}

const menuBtn = document.getElementById('menu-btn');
const sidebarEl = document.getElementById('sidebar');
const overlay = document.getElementById('menu-overlay');

if (menuBtn && sidebarEl && overlay) {
    menuBtn.addEventListener('click', () => {
        sidebarEl.classList.toggle('open');
        overlay.classList.toggle('active');
    });
    overlay.addEventListener('click', () => {
        sidebarEl.classList.remove('open');
        overlay.classList.remove('active');
    });
}

const loader = document.getElementById('loader');
if (loader) loader.style.display = 'none';

function clearAllCaches() {
    localStorage.removeItem("user");
    localStorage.removeItem("user_cache");
    localStorage.removeItem("pages_cache");

    // Удаляем все ключи вида wh_cache_*
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith("wh_cache_")) localStorage.removeItem(k);
    });

    // Удаляем все ключи вида access_cache_*
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith("access_cache_")) localStorage.removeItem(k);
    });

    // Удаляем все ключи вида page_access_cache_*
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith("page_access_cache_")) localStorage.removeItem(k);
    });
}

function initLogoutButton() {
    const logoutBtn = document.getElementById("logout-btn");
    if (!logoutBtn) return;

    logoutBtn.addEventListener("click", () => {
        clearAllCaches();
        window.location.href = "login.html";
    });
}

// Запускаем после DOMContentLoaded
document.addEventListener("DOMContentLoaded", initLogoutButton);



window.MiniUI = {
    toast: createToast,
    setLoaderVisible: v => {
        if (loader) loader.style.display = v ? 'block' : 'none';
    }
};
/* ============================================================================================
   MiniUI.confirm() & MiniUI.alert() — JS-МОДАЛКИ (динамические, без HTML в документе)
   ============================================================================================ */

(function(){
    function createBaseModal() {
        const wrap = document.createElement("div");
        wrap.className = "modal";
        wrap.style.position = "fixed";
        wrap.style.left = "0";
        wrap.style.top = "0";
        wrap.style.width = "100%";
        wrap.style.height = "100%";
        wrap.style.background = "rgba(0,0,0,.35)";
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.justifyContent = "center";
        wrap.style.zIndex = "9999";
        wrap.style.opacity = "0";
        wrap.style.transition = "opacity .15s";

        const box = document.createElement("div");
        box.className = "modal-content";
        box.style.background = "#fff";
        box.style.padding = "22px";
        box.style.borderRadius = "14px";
        box.style.width = "360px";
        box.style.maxWidth = "92%";
        box.style.boxShadow = "0 6px 24px rgba(0,0,0,.15)";
        box.style.transform = "translateY(-8px)";
        box.style.transition = "transform .15s";

        wrap.appendChild(box);

        setTimeout(() => {
            wrap.style.opacity = "1";
            box.style.transform = "translateY(0)";
        }, 10);

        return {wrap, box};
    }


    // -------------------------------------------
// MiniUI.modal (блокирующее окно, без кнопок)
// -------------------------------------------
    (function(){
        let currentModal = null;

        MiniUI.modal = function({ title = '', content = '', closeable = true } = {}) {
            if (currentModal) currentModal.remove();

            const wrap = document.createElement('div');
            wrap.className = 'miniui-modal-overlay';
            wrap.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.35);
            backdrop-filter: blur(2px);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;

            const box = document.createElement('div');
            box.className = 'miniui-modal-box';
            box.style.cssText = `
            background: #fff;
            border-radius: 14px;
            padding: 24px 26px;
            width: 340px;
            max-width: 90%;
            box-shadow: 0 4px 18px rgba(0,0,0,0.12);
            text-align: center;
            position: relative;
        `;

            if (closeable) {
                const closeBtn = document.createElement('button');
                closeBtn.innerHTML = "✕";
                closeBtn.style.cssText = `
                position:absolute;
                top:10px;
                right:12px;
                font-size:16px;
                background:none;
                border:none;
                color:#64748b;
                cursor:pointer;
            `;
                closeBtn.onclick = () => MiniUI.closeModal();
                box.appendChild(closeBtn);
            }

            const titleEl = document.createElement('div');
            titleEl.style.cssText = `
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
        `;
            titleEl.textContent = title;

            const contentEl = document.createElement('div');
            contentEl.style.cssText = `
            font-size: 15px;
            color:#334155;
        `;
            contentEl.textContent = content;

            box.appendChild(titleEl);
            box.appendChild(contentEl);
            wrap.appendChild(box);
            document.body.appendChild(wrap);

            currentModal = wrap;
        };

        MiniUI.closeModal = function() {
            if (currentModal) {
                currentModal.remove();
                currentModal = null;
            }
        };
    })();

    // ======================================================
// MiniUI.confirm — кастомный confirm в стиле WMS+
// ======================================================
    MiniUI.confirm = function (message, { okText = "Да", cancelText = "Отмена" } = {}) {
        return new Promise(resolve => {

            // Создаём затемнение
            const overlay = document.createElement("div");
            overlay.className = "modal-overlay";
            overlay.style.position = "fixed";
            overlay.style.top = 0;
            overlay.style.left = 0;
            overlay.style.width = "100%";
            overlay.style.height = "100%";
            overlay.style.background = "rgba(0,0,0,0.4)";
            overlay.style.display = "flex";
            overlay.style.alignItems = "center";
            overlay.style.justifyContent = "center";
            overlay.style.zIndex = 9999;

            // Окно
            const box = document.createElement("div");
            box.className = "modal-content";
            box.style.background = "#fff";
            box.style.padding = "20px";
            box.style.borderRadius = "10px";
            box.style.maxWidth = "350px";
            box.style.width = "100%";
            box.style.boxShadow = "0 4px 20px rgba(0,0,0,0.25)";
            box.style.textAlign = "center";

            // Текст
            const txt = document.createElement("div");
            txt.style.marginBottom = "20px";
            txt.style.fontSize = "16px";
            txt.style.fontWeight = "500";
            txt.textContent = message;

            // Кнопки
            const actions = document.createElement("div");
            actions.style.display = "flex";
            actions.style.justifyContent = "center";
            actions.style.gap = "12px";

            const okBtn = document.createElement("button");
            okBtn.className = "btn btn-rect";
            okBtn.textContent = okText;

            const cancelBtn = document.createElement("button");
            cancelBtn.className = "btn btn-outline";
            cancelBtn.textContent = cancelText;

            // Логика
            okBtn.onclick = () => {
                overlay.remove();
                resolve(true);
            };

            cancelBtn.onclick = () => {
                overlay.remove();
                resolve(false);
            };

            // Сборка
            actions.appendChild(okBtn);
            actions.appendChild(cancelBtn);
            box.appendChild(txt);
            box.appendChild(actions);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
        });
    };
    // -------------------------------------------
// MiniUI.modalScan — модалка для сканирования МХ (видимое поле)
// -------------------------------------------
    (function(){
        let currentModal = null;

        MiniUI.modalScan = function({ title = '', content = '' } = {}) {
            if (currentModal) currentModal.remove();

            const wrap = document.createElement('div');
            wrap.className = 'miniui-modal-overlay';
            wrap.style.cssText = `
            position: fixed;
            top: 64px;  /* ниже шапки */
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.28);
            backdrop-filter: blur(2px);
            z-index: 500;   /* ниже сайдбара, но выше контента */
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;

            const box = document.createElement('div');
            box.className = 'miniui-modal-box';
            box.style.cssText = `
            background: #fff;
            border-radius: 14px;
            padding: 26px 28px 32px;
            width: 360px;
            max-width: 90%;
            box-shadow: 0 4px 18px rgba(0,0,0,0.12);
            text-align: center;
            position: relative;
        `;

            const titleEl = document.createElement('div');
            titleEl.style.cssText = `
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 14px;
        `;
            titleEl.textContent = title;

            const contentEl = document.createElement('div');
            contentEl.style.cssText = `
            font-size: 16px;
            color:#334155;
            margin-bottom: 20px;
        `;
            contentEl.textContent = content;

            // ВИДИМОЕ поле для сканера
            const input = document.createElement('input');
            input.type = 'text';
            input.id = "miniui-scan-input";
            input.style.cssText = `
            width: 100%;
            padding: 12px 14px;
            font-size: 18px;
            border: 2px solid #cbd5e1;
            border-radius: 8px;
            outline: none;
            text-align: center;
            letter-spacing: 2px;
        `;

            // при фокусе рамка подсвечивается
            input.addEventListener('focus', () => input.style.borderColor = '#2563eb');
            input.addEventListener('blur', () => input.style.borderColor = '#cbd5e1');

            box.appendChild(titleEl);
            box.appendChild(contentEl);
            box.appendChild(input);
            wrap.appendChild(box);
            document.body.appendChild(wrap);

            currentModal = wrap;

            // автофокус через 50ms
            setTimeout(() => input.focus(), 50);

            return input;
        };

        MiniUI.closeModal = function() {
            if (currentModal) {
                currentModal.remove();
                currentModal = null;
            }
        };
    })();



    MiniUI.alert = function(text, opts = {}) {
        return new Promise(resolve => {
            const title = opts.title || "Сообщение";
            const {wrap, box} = createBaseModal();

            box.innerHTML = `
                <h3 style="margin-top:0;font-size:20px;">${title}</h3>
                <div style="margin:12px 0 22px;font-size:15px;line-height:1.35;">
                    ${text}
                </div>
            `;

            const btns = document.createElement("div");
            btns.style.display = "flex";
            btns.style.justifyContent = "flex-end";
            btns.style.marginTop = "16px";

            const ok = document.createElement("button");
            ok.className = "btn btn-rect";
            ok.textContent = opts.okText || "Понятно";

            btns.appendChild(ok);
            box.appendChild(btns);

            document.body.appendChild(wrap);

            function close() {
                wrap.style.opacity = "0";
                box.style.transform = "translateY(-8px)";
                setTimeout(()=>wrap.remove(),150);
                resolve(true);
            }

            ok.onclick = close;

            wrap.addEventListener("click", e => {
                if (e.target === wrap) close();
            });
        });
    };
})();

