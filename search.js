// search.js — standalone "Поиск" page. Fully independent of the main
// WMS+ app: its own Supabase client, its own real-session guard, its own
// login page (search_login.html) and its own logout target -- never
// touches ui.js/login.html/index.html. Self-contained like no_shk_zone.js
// / intake_search.js: own $()/escape/date helpers, no shared state.
(function () {
    "use strict";

    const SUPABASE_URL = "https://bgphllmzmlwurfnbagho.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q";
    const supabaseClient = (typeof supabase !== "undefined") ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

    function db() {
        return supabaseClient;
    }

    // No cached localStorage.user is trusted on its own -- same reasoning
    // as the main app's ui.js::checkUserAccess: a real Supabase Auth
    // session is the only thing that actually proves a live login. Runs
    // immediately (not on DOMContentLoaded) so a logged-out visitor never
    // sees the page flash before bouncing to search_login.html.
    (function guardAuth() {
        if (!localStorage.getItem("user")) {
            window.location.href = "search_login.html";
            return;
        }
        if (!supabaseClient) return;
        supabaseClient.auth.getSession().then(({ data }) => {
            if (!data || !data.session) {
                localStorage.removeItem("user");
                window.location.href = "search_login.html";
            }
        });
    })();

    const $ = (id) => document.getElementById(id);

    function escapeHtmlLocal(value) {
        const div = document.createElement("div");
        div.textContent = value == null ? "" : String(value);
        return div.innerHTML;
    }

    function normalizeText(value) {
        return value == null ? "" : String(value).trim();
    }

    // Wraps the first case-insensitive occurrence of `query` inside `text`
    // in a <mark> -- the "why did this match" highlight asked for across
    // every card type. Escapes the untouched portions too, so this is
    // always safe to drop straight into innerHTML.
    function highlightHtml(text, query) {
        const raw = normalizeText(text);
        if (!raw) return "";
        const q = normalizeText(query);
        if (!q) return escapeHtmlLocal(raw);
        const idx = raw.toLowerCase().indexOf(q.toLowerCase());
        if (idx < 0) return escapeHtmlLocal(raw);
        return escapeHtmlLocal(raw.slice(0, idx))
            + "<mark class='search-hl'>" + escapeHtmlLocal(raw.slice(idx, idx + q.length)) + "</mark>"
            + escapeHtmlLocal(raw.slice(idx + q.length));
    }

    // Same decode as no_shk_zone.js/intake_search.js's own copy -- shows a
    // "без ШК" item's assigned sticker as its plain numeric value.
    const SHK_CHAR_LIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const SHK_CHECK_SUM_BITS = 4n + 4n;
    const SHK_VALUE_BITS = 42n;
    function decodeStickerCode(barcode) {
        if (!barcode || barcode.charAt(0) !== "*") return null;
        const body = barcode.slice(1);
        const base = BigInt(SHK_CHAR_LIST.length);
        let result = 0n;
        for (let i = 0; i < body.length; i++) {
            const idx = SHK_CHAR_LIST.indexOf(body.charAt(body.length - 1 - i));
            if (idx < 0) return null;
            result += BigInt(idx) * (base ** BigInt(i));
        }
        const shkVal = (result >> SHK_CHECK_SUM_BITS) & ((1n << SHK_VALUE_BITS) - 1n);
        const remaining = result >> (SHK_CHECK_SUM_BITS + SHK_VALUE_BITS);
        if (remaining !== 0n || shkVal === 0n) return null;
        return shkVal.toString();
    }

    function buildIntakePhotoUrl(path) {
        return "https://bgphllmzmlwurfnbagho.supabase.co/storage/v1/object/public/intake-photos/" + path;
    }

    function formatDateTime(value) {
        if (!value) return "-";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "-";
        return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    }

    // ---- state ----

    const state = {
        incidents: new Set(), // subset of the 4 data-incident chip values; empty = no filter (search everywhere)
        filterOpen: false,
        searching: false,
    };

    // ---- RPC calls, one per domain ----

    async function searchNoShk(query, date) {
        const client = db();
        if (!client) return [];
        // Dedicated strict-substring RPC, not the shared
        // wms_intake_submissions_search -- that one now does pg_trgm fuzzy
        // matching (word_similarity >= 0.3, tuned for the existing "Лента
        // без ШК" feature's typo tolerance), which was pulling in
        // unrelated items like "Корм для куриц" for a "куртка" query.
        const { data, error } = await client.rpc("wms_search_no_shk_items", {
            p_query: query || null,
            p_date: date || null,
        });
        if (error) throw error;
        return (data || []).map((row) => ({ __kind: "no_shk", row }));
    }

    async function searchTasks(query, date, tags) {
        const client = db();
        if (!client) return [];
        const { data, error } = await client.rpc("wms_search_tasks", {
            p_query: query || null,
            p_date: date || null,
            p_tags: tags && tags.length ? tags : null,
        });
        if (error) throw error;
        return (data || []).map((row) => ({ __kind: "task", row }));
    }

    async function searchTwoShk(query, date, tags) {
        const client = db();
        if (!client) return [];
        // 2shk_rep records take priority over tasks now -- this no longer
        // excludes rows that already have a matching task (see
        // 202609300002); the fixation itself is the source of truth.
        const { data, error } = await client.rpc("wms_search_two_shk", {
            p_query: query || null,
            p_date: date || null,
            p_tags: tags && tags.length ? tags : null,
        });
        if (error) throw error;
        return (data || []).map((row) => ({ __kind: "two_shk", row }));
    }

    // ---- orchestration ----

    function setStatus(message, isError) {
        const el = $("searchStatus");
        if (!el) return;
        el.textContent = message || "";
        el.classList.toggle("is-error", Boolean(isError));
    }

    async function runSearch() {
        if (state.searching) return;
        const query = normalizeText($("searchInput").value);
        const date = normalizeText($("filterDate").value) || null;
        if (!query && !date) {
            setStatus("Введите запрос или укажите дату в фильтре.", true);
            return;
        }
        const noFilter = state.incidents.size === 0;
        const wantNoShk = noFilter || state.incidents.has("Без ШК");
        const wantTasks = noFilter || state.incidents.has("Два ШК") || state.incidents.has("Пустая упаковка") || state.incidents.has("Разбор ОПП");
        const wantTwoShk = noFilter || state.incidents.has("Два ШК") || state.incidents.has("Пустая упаковка");
        // "Разбор ОПП" (or no filter at all) means "any task, no tag
        // requirement" -- only pass a real tag constraint when neither of
        // those broadening cases applies.
        const taskTags = (noFilter || state.incidents.has("Разбор ОПП"))
            ? null
            : ["Два ШК", "Пустая упаковка"].filter((tag) => state.incidents.has(tag));
        const twoShkTags = noFilter ? null : ["Два ШК", "Пустая упаковка"].filter((tag) => state.incidents.has(tag));

        state.searching = true;
        $("searchBtn").disabled = true;
        $("searchBtn").textContent = "Ищу…";
        setStatus("");

        // 2shk_rep is queried first and rendered first (its own group
        // comes before "Задачи" in renderResults) -- it's the priority
        // source for "Два ШК"/"Пустая упаковка" now, tasks are secondary.
        const jobs = [];
        if (wantTwoShk) jobs.push(searchTwoShk(query, date, twoShkTags).catch((error) => { console.error("[search] два шк:", error); return []; }));
        if (wantNoShk) jobs.push(searchNoShk(query, date).catch((error) => { console.error("[search] без ШК:", error); return []; }));
        if (wantTasks) jobs.push(searchTasks(query, date, taskTags).catch((error) => { console.error("[search] задачи:", error); return []; }));

        try {
            const results = (await Promise.all(jobs)).flat();
            renderResults(results, query);
        } finally {
            state.searching = false;
            $("searchBtn").disabled = false;
            $("searchBtn").textContent = "Найти";
        }
    }

    // ---- rendering ----

    function taskStatusPillHtml(row) {
        const status = normalizeText(row.task_status) || "-";
        const tone = status === "Завершено" ? "tone-green" : status === "Отложено" ? "tone-yellow" : "";
        return "<span class='search-card-pill" + (tone ? " " + tone : "") + "'>" + escapeHtmlLocal(status) + "</span>";
    }

    // "Завершено" alone doesn't say why -- show the actual verdict
    // (Найден/Релиз/Списан, Нет на МХ/Не найден, etc.) alongside it.
    function taskVerdictPillHtml(row) {
        const verdict = normalizeText(row.opp_verdict);
        if (!verdict || verdict === "Не выбран") return "";
        return "<span class='search-card-pill'>" + escapeHtmlLocal(verdict) + "</span>";
    }

    function taskTagPillsHtml(row) {
        const tags = Array.isArray(row.tags) ? row.tags : [];
        return tags.filter(Boolean).map((tag) => {
            const tone = tag === "Два ШК" ? "tone-red" : tag === "Пустая упаковка" ? "tone-yellow" : "";
            return "<span class='search-card-pill" + (tone ? " " + tone : "") + "'>" + escapeHtmlLocal(tag) + "</span>";
        }).join("");
    }

    let noShkRowsById = new Map();

    function noShkCardHtml(row, query) {
        noShkRowsById.set(row.id, row);
        const photo = row.photo_path
            ? "<img class='search-card-photo' data-detail-id='" + escapeHtmlLocal(row.id) + "' src='" + escapeHtmlLocal(buildIntakePhotoUrl(row.photo_path)) + "' loading='lazy' alt=''>"
            : "";
        const sticker = row.sticker_code
            ? "<span class='search-card-pill tone-green'>ШК: " + escapeHtmlLocal(decodeStickerCode(row.sticker_code) || row.sticker_code) + "</span>"
            : "<span class='search-card-pill'>В ревизии</span>";
        const titleHtml = highlightHtml(row.item_text || row.item_type || "Без наименования", query);
        const categoryHtml = row.category ? " · " + highlightHtml(row.category, query) : "";
        return "<div class='search-card'>"
            + photo
            + "<div class='search-card-title'>" + titleHtml + categoryHtml + "</div>"
            + "<div class='search-card-sub'>" + escapeHtmlLocal(row.area || "-") + " · " + escapeHtmlLocal(row.full_name || "-") + "</div>"
            + "<div class='search-card-row'><span>" + escapeHtmlLocal(formatDateTime(row.created_at)) + "</span></div>"
            + "<div class='search-card-pills'>" + sticker + "</div>"
            + "</div>";
    }

    // Short excerpt of search_text around the query, for a task that
    // matched via joined item names rather than its own title -- shows
    // WHAT matched instead of repeating info already visible elsewhere.
    function extractSnippet(text, query, radius) {
        const t = normalizeText(text);
        const q = normalizeText(query).toLowerCase();
        if (!t || !q) return "";
        const idx = t.toLowerCase().indexOf(q);
        if (idx < 0) return "";
        const start = Math.max(0, idx - radius);
        const end = Math.min(t.length, idx + q.length + radius);
        return (start > 0 ? "…" : "") + t.slice(start, end).trim() + (end < t.length ? "…" : "");
    }

    function taskMatchLineHtml(row, query) {
        const q = normalizeText(query);
        if (!q) return escapeHtmlLocal(row.task_type || "");
        const ident = q.replace(/\s+/g, "");
        if (Array.isArray(row.source_shk_ids) && row.source_shk_ids.includes(ident)) return "ШК <mark class='search-hl'>" + escapeHtmlLocal(ident) + "</mark>";
        if (row.source_tare_id && row.source_tare_id === ident) return "Тара <mark class='search-hl'>" + escapeHtmlLocal(ident) + "</mark>";
        if (row.source_id && row.source_id.toLowerCase().includes(ident.toLowerCase())) return "ID " + highlightHtml(row.source_id, ident);
        if (!normalizeText(row.title).toLowerCase().includes(q.toLowerCase())) {
            const snippet = extractSnippet(row.search_text, q, 18);
            if (snippet) return highlightHtml(snippet, q);
        }
        return escapeHtmlLocal(row.task_type || "");
    }

    let taskRowsById = new Map();

    function taskCardHtml(row, query) {
        taskRowsById.set(row.id, row);
        return "<div class='search-card search-card-task' data-task-history-id='" + escapeHtmlLocal(row.id) + "'>"
            + "<div class='search-card-title'>" + highlightHtml(row.title || "Задача", query) + "</div>"
            + "<div class='search-card-sub'>" + taskMatchLineHtml(row, query) + "</div>"
            + "<div class='search-card-pills'>" + taskStatusPillHtml(row) + taskVerdictPillHtml(row) + taskTagPillsHtml(row) + "</div>"
            + "</div>";
    }

    function twoShkCardHtml(row, query) {
        const tag = normalizeText(row.event_type).toLowerCase().includes("пуст") ? "Пустая упаковка" : "Два ШК";
        const tone = tag === "Два ШК" ? "tone-red" : "tone-yellow";
        const shk2 = normalizeText(row.shk2);
        const ident = normalizeText(query).replace(/\s+/g, "");
        const shkPill = (value) => {
            const isMatch = ident && value === ident;
            return "<span class='search-card-pill-shk" + (isMatch ? " search-hl" : "") + "'>" + escapeHtmlLocal(value) + "</span>";
        };
        // Пустая упаковка never has a real second ШК (shk2 comes back as a
        // lone space from 2shk_rep for that event type) -- one pill.
        const shkRowHtml = shk2 ? shkPill(row.shk1) + shkPill(shk2) : shkPill(row.shk1);
        const links = [row.media, row.media2].map(normalizeText).filter(Boolean);
        const linkButtonsHtml = links.length
            ? "<div class='search-card-link-row'>" + links.map((url, i) =>
                "<a class='search-card-link-btn' href='" + escapeHtmlLocal(url) + "' target='_blank' rel='noopener'>" + (links.length > 1 ? "Ссылка " + (i + 1) : "Ссылка") + "</a>"
            ).join("") + "</div>"
            : "";
        return "<div class='search-card search-card-two-shk'>"
            + "<div class='search-card-shk-row'>" + shkRowHtml + "</div>"
            + "<div class='search-card-row'><span>" + escapeHtmlLocal(formatDateTime(row.created_at)) + "</span></div>"
            + linkButtonsHtml
            + "<div class='search-card-pills'><span class='search-card-pill " + tone + "'>" + escapeHtmlLocal(tag) + "</span></div>"
            + "</div>";
    }

    const GROUP_META = {
        two_shk: { title: "Два ШК и Пустая упаковка", render: twoShkCardHtml },
        no_shk: { title: "Товар «Без ШК»", render: noShkCardHtml },
        task: { title: "Разбор ОПП / Задачи", render: taskCardHtml },
    };
    // Priority order: 2shk_rep first, then без ШК, tasks last.
    const GROUP_ORDER = ["two_shk", "no_shk", "task"];

    function renderResults(hits, query) {
        const wrap = $("searchResults");
        if (!wrap) return;
        noShkRowsById = new Map();
        taskRowsById = new Map();
        if (!hits.length) {
            wrap.innerHTML = "";
            setStatus("Ничего не нашлось.");
            return;
        }
        setStatus(hits.length + (hits.length === 1 ? " результат" : hits.length < 5 ? " результата" : " результатов"));
        const groups = new Map();
        hits.forEach((hit) => {
            if (!groups.has(hit.__kind)) groups.set(hit.__kind, []);
            groups.get(hit.__kind).push(hit.row);
        });
        let cardIndex = 0;
        wrap.innerHTML = GROUP_ORDER.filter((kind) => groups.has(kind)).map((kind) => {
            const meta = GROUP_META[kind];
            const rows = groups.get(kind);
            const cardsHtml = rows.map((row) => {
                const html = meta.render(row, query);
                const delay = Math.min(cardIndex, 14) * 20;
                cardIndex++;
                return html.replace("<div class='search-card", "<div style='animation-delay:" + delay + "ms;' class='search-card");
            }).join("");
            return "<div class='search-results-group'>"
                + "<p class='search-results-group-title'>" + escapeHtmlLocal(meta.title) + " (" + rows.length + ")</p>"
                + "<div class='search-results-grid'>" + cardsHtml + "</div>"
                + "</div>";
        }).join("");
        wrap.querySelectorAll("[data-detail-id]").forEach((el) => {
            el.addEventListener("click", () => openDetail(el.dataset.detailId));
        });
        wrap.querySelectorAll("[data-task-history-id]").forEach((el) => {
            el.addEventListener("click", () => void openTaskHistory(el.dataset.taskHistoryId));
        });
    }

    // ---- full-screen "без ШК" item detail ----

    function detailRowHtml(label, value) {
        const text = normalizeText(value) || "-";
        return "<div class='search-detail-row'><span>" + escapeHtmlLocal(label) + "</span><strong>" + escapeHtmlLocal(text) + "</strong></div>";
    }

    function openDetail(itemId) {
        const row = noShkRowsById.get(itemId);
        if (!row) return;
        const photo = $("searchDetailPhoto");
        photo.src = row.photo_path ? buildIntakePhotoUrl(row.photo_path) : "";
        const sticker = row.sticker_code ? (decodeStickerCode(row.sticker_code) || row.sticker_code) : "Не присвоен";
        $("searchDetailInfo").innerHTML = "<h2 class='search-detail-title'>" + escapeHtmlLocal(row.item_text || row.item_type || "Без наименования") + "</h2>"
            + detailRowHtml("Категория", row.category)
            + detailRowHtml("Тип", row.item_type)
            + detailRowHtml("Участок", row.area)
            + detailRowHtml("Ответственный", row.full_name)
            + detailRowHtml("Дата/время", formatDateTime(row.created_at))
            + detailRowHtml("Стикер", sticker);
        $("searchDetailModal").classList.add("active");
        $("searchDetailModal").setAttribute("aria-hidden", "false");
    }

    function closeDetail() {
        $("searchDetailModal").classList.remove("active");
        $("searchDetailModal").setAttribute("aria-hidden", "true");
    }

    // ---- read-only task history (opened from a task card) ----

    // Humanized labels for the event types a search hit is realistically
    // going to have -- not the full set tasks.js's own feed handles (no
    // avatars, no clickable sub-links, no forecast styling): this is a
    // read-only lookup, not the review UI, so a plain chronological list
    // is enough.
    const HISTORY_EVENT_LABELS = {
        task_created: "Создана задача",
        task_completed: "Завершена",
        task_deferred: "Отложена",
        task_reopened: "Переоткрыта",
        task_auto_reopened: "Переоткрыта автоматически",
        task_system_closed: "Закрыто автоматически",
        task_cross_module_touch: "Продолжилось в другом модуле",
        task_no_shk_found: "Найден без ШК",
        task_predicted_writeoff: "Прогнозируемая дата списания",
        task_prespisok_uploaded: "ШК в предсписке",
        task_prespisok_second_line: "Решение предсписка",
        task_last_movement_status: "Статус ШК",
    };

    function historyRowHtml(item) {
        const payload = item.payload && typeof item.payload === "object" ? item.payload : {};
        const actor = normalizeText(item.actor_name) || normalizeText(item.actor_employee_id) || "Система";
        const verdict = normalizeText(payload.verdict) && payload.verdict !== "Не выбран"
            ? payload.verdict
            : (HISTORY_EVENT_LABELS[item.event_type] || item.event_type || "-");
        const commentParts = [];
        if (normalizeText(payload.comment)) commentParts.push(payload.comment);
        if (payload.reopen_after) commentParts.push("до " + formatDateTime(payload.reopen_after));
        if (normalizeText(payload.extra_value)) commentParts.push(payload.extra_value);
        return "<div class='search-history-row'>"
            + "<div class='search-history-row-time'>" + escapeHtmlLocal(formatDateTime(item.created_at)) + "</div>"
            + "<div class='search-history-row-actor'>" + escapeHtmlLocal(actor) + "</div>"
            + "<div class='search-history-row-verdict'>" + escapeHtmlLocal(verdict) + "</div>"
            + (commentParts.length ? "<div class='search-history-row-comment'>" + escapeHtmlLocal(commentParts.join(" · ")) + "</div>" : "")
            + "</div>";
    }

    async function openTaskHistory(taskId) {
        const row = taskRowsById.get(taskId);
        $("searchHistoryTitle").textContent = (row && row.title) || "Задача";
        $("searchHistorySub").textContent = row ? [row.task_type, row.task_status, row.opp_verdict].filter((v) => v && v !== "Не выбран").join(" · ") : "";
        $("searchHistoryList").innerHTML = "<p class='search-history-empty'>Загрузка…</p>";
        $("searchHistoryModal").classList.add("active");
        $("searchHistoryModal").setAttribute("aria-hidden", "false");
        const client = db();
        if (!client) return;
        const { data, error } = await client
            .from("wms_task_history")
            .select("event_type,actor_name,actor_employee_id,payload,created_at")
            .eq("task_id", taskId)
            .order("created_at", { ascending: true });
        if (error) {
            $("searchHistoryList").innerHTML = "<p class='search-history-empty'>Не удалось загрузить: " + escapeHtmlLocal(error.message) + "</p>";
            return;
        }
        if (!data || !data.length) {
            $("searchHistoryList").innerHTML = "<p class='search-history-empty'>История пуста.</p>";
            return;
        }
        $("searchHistoryList").innerHTML = data.map(historyRowHtml).join("");
    }

    function closeTaskHistory() {
        $("searchHistoryModal").classList.remove("active");
        $("searchHistoryModal").setAttribute("aria-hidden", "true");
    }

    // ---- filter panel + chips ----

    function updateFilterUi() {
        $("filterDateClear").classList.toggle("is-visible", Boolean($("filterDate").value));
        document.querySelectorAll("[data-incident]").forEach((btn) => {
            btn.classList.toggle("is-active", state.incidents.has(btn.dataset.incident));
        });
    }

    function toggleFilterPanel(open) {
        state.filterOpen = open;
        $("filterPanel").classList.toggle("is-open", open);
        $("filterToggleBtn").classList.toggle("is-open", open);
    }

    document.addEventListener("DOMContentLoaded", () => {
        const searchBtn = $("searchBtn");
        const searchInput = $("searchInput");
        if (searchBtn) searchBtn.addEventListener("click", () => void runSearch());
        if (searchInput) {
            searchInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") { event.preventDefault(); void runSearch(); }
            });
            setTimeout(() => searchInput.focus({ preventScroll: true }), 50);
        }

        const filterToggleBtn = $("filterToggleBtn");
        if (filterToggleBtn) filterToggleBtn.addEventListener("click", () => toggleFilterPanel(!state.filterOpen));

        const filterDate = $("filterDate");
        if (filterDate) filterDate.addEventListener("change", updateFilterUi);
        const filterDateClear = $("filterDateClear");
        if (filterDateClear) {
            filterDateClear.addEventListener("click", () => {
                filterDate.value = "";
                updateFilterUi();
            });
        }

        document.querySelectorAll("[data-incident]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const value = btn.dataset.incident;
                if (state.incidents.has(value)) state.incidents.delete(value); else state.incidents.add(value);
                updateFilterUi();
            });
        });

        const closeDetailBtn = $("closeSearchDetail");
        if (closeDetailBtn) closeDetailBtn.addEventListener("click", closeDetail);
        const detailModal = $("searchDetailModal");
        if (detailModal) detailModal.addEventListener("click", (event) => { if (event.target === detailModal) closeDetail(); });

        const closeHistoryBtn = $("closeSearchHistory");
        if (closeHistoryBtn) closeHistoryBtn.addEventListener("click", closeTaskHistory);
        const historyModal = $("searchHistoryModal");
        if (historyModal) historyModal.addEventListener("click", (event) => { if (event.target === historyModal) closeTaskHistory(); });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if ($("searchDetailModal").classList.contains("active")) closeDetail();
            else if ($("searchHistoryModal").classList.contains("active")) closeTaskHistory();
        });

        const logoutBtn = $("searchLogoutBtn");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", async () => {
                try { if (supabaseClient) await supabaseClient.auth.signOut(); } catch (_error) { /* redirect regardless */ }
                localStorage.removeItem("user");
                window.location.href = "search_login.html";
            });
        }
    });
})();
