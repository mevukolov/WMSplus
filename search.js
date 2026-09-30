// search.js — standalone "Поиск" page. Self-contained like no_shk_zone.js /
// intake_search.js / shk_info.js: own $()/escape/date helpers, no shared
// state with tasks.js. Login-gated by ui.js (included in search.html) the
// same way every other page is, but not listed in `pages` -- so
// checkUserAccess() never restricts it further, reachable only by direct
// link.
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

    function normalizeText(value) {
        return value == null ? "" : String(value).trim();
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

    async function searchTwoShkBare(query, date, tags) {
        const client = db();
        if (!client) return [];
        const { data, error } = await client.rpc("wms_search_two_shk_unmatched", {
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
        const wantTwoShkBare = noFilter || state.incidents.has("Два ШК") || state.incidents.has("Пустая упаковка");
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

        const jobs = [];
        if (wantNoShk) jobs.push(searchNoShk(query, date).catch((error) => { console.error("[search] без ШК:", error); return []; }));
        if (wantTasks) jobs.push(searchTasks(query, date, taskTags).catch((error) => { console.error("[search] задачи:", error); return []; }));
        if (wantTwoShkBare) jobs.push(searchTwoShkBare(query, date, twoShkTags).catch((error) => { console.error("[search] два шк:", error); return []; }));

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

    function taskTagPillsHtml(row) {
        const tags = Array.isArray(row.tags) ? row.tags : [];
        return tags.filter(Boolean).map((tag) => {
            const tone = tag === "Два ШК" ? "tone-red" : tag === "Пустая упаковка" ? "tone-yellow" : "";
            return "<span class='search-card-pill" + (tone ? " " + tone : "") + "'>" + escapeHtmlLocal(tag) + "</span>";
        }).join("");
    }

    let noShkRowsById = new Map();

    function noShkCardHtml(row) {
        noShkRowsById.set(row.id, row);
        const photo = row.photo_path
            ? "<img class='search-card-photo' data-detail-id='" + escapeHtmlLocal(row.id) + "' src='" + escapeHtmlLocal(buildIntakePhotoUrl(row.photo_path)) + "' loading='lazy' alt=''>"
            : "";
        const sticker = row.sticker_code
            ? "<span class='search-card-pill tone-green'>ШК: " + escapeHtmlLocal(decodeStickerCode(row.sticker_code) || row.sticker_code) + "</span>"
            : "<span class='search-card-pill'>Без стикера</span>";
        return "<div class='search-card'>"
            + photo
            + "<div class='search-card-title'>" + escapeHtmlLocal(row.item_text || row.item_type || "Без наименования") + (row.category ? " · " + escapeHtmlLocal(row.category) : "") + "</div>"
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

    function taskMatchLine(row, query) {
        const q = normalizeText(query);
        if (!q) return row.task_type || "";
        const ident = q.replace(/\s+/g, "");
        if (Array.isArray(row.source_shk_ids) && row.source_shk_ids.includes(ident)) return "ШК " + ident;
        if (row.source_tare_id && row.source_tare_id === ident) return "Тара " + ident;
        if (row.source_id && row.source_id.toLowerCase().includes(ident.toLowerCase())) return "ID " + row.source_id;
        if (!normalizeText(row.title).toLowerCase().includes(q.toLowerCase())) {
            const snippet = extractSnippet(row.search_text, q, 18);
            if (snippet) return snippet;
        }
        return row.task_type || "";
    }

    function taskCardHtml(row, query) {
        return "<div class='search-card search-card-task'>"
            + "<div class='search-card-title'>" + escapeHtmlLocal(row.title || "Задача") + "</div>"
            + "<div class='search-card-sub'>" + escapeHtmlLocal(taskMatchLine(row, query)) + "</div>"
            + "<div class='search-card-pills'>" + taskStatusPillHtml(row) + taskTagPillsHtml(row) + "</div>"
            + "</div>";
    }

    function twoShkCardHtml(row) {
        const tag = normalizeText(row.event_type).toLowerCase().includes("пуст") ? "Пустая упаковка" : "Два ШК";
        const tone = tag === "Два ШК" ? "tone-red" : "tone-yellow";
        const shk2 = normalizeText(row.shk2);
        return "<div class='search-card'>"
            + "<div class='search-card-title'>ШК " + escapeHtmlLocal(row.shk1) + "</div>"
            + (shk2 ? "<div class='search-card-sub'>Второй ШК: " + escapeHtmlLocal(shk2) + "</div>" : "<div class='search-card-sub'>Без задачи</div>")
            + "<div class='search-card-row'><span>" + escapeHtmlLocal(formatDateTime(row.created_at)) + "</span></div>"
            + (row.media ? "<div class='search-card-row'><a href='" + escapeHtmlLocal(row.media) + "' target='_blank' rel='noopener'>Ссылка</a></div>" : "")
            + "<div class='search-card-pills'><span class='search-card-pill " + tone + "'>" + escapeHtmlLocal(tag) + "</span></div>"
            + "</div>";
    }

    const GROUP_META = {
        no_shk: { title: "Товар «Без ШК»", render: noShkCardHtml },
        task: { title: "Разбор ОПП / Задачи", render: taskCardHtml },
        two_shk: { title: "Два ШК и Пустая упаковка (без задачи)", render: twoShkCardHtml },
    };

    function renderResults(hits, query) {
        const wrap = $("searchResults");
        if (!wrap) return;
        noShkRowsById = new Map();
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
        wrap.innerHTML = ["no_shk", "task", "two_shk"].filter((kind) => groups.has(kind)).map((kind) => {
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
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && $("searchDetailModal").classList.contains("active")) closeDetail();
        });
    });
})();
