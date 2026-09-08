// intake_search.js — "Поиск товара без ШК": a standalone admin search
// across everything ever logged through the public intake form, on any
// area, in any accounting bucket (shift-box items, Шредер, Товар с
// переупаковки, Брак Бытовая химия). Self-contained, same convention as
// no_shk_zone.js: its own db()/escapeHtmlLocal, no shared state with
// tasks.js or no_shk_zone.js.
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

    function buildIntakePhotoUrl(path) {
        return "https://bgphllmzmlwurfnbagho.supabase.co/storage/v1/object/public/intake-photos/" + path;
    }

    // Mirrors no_shk_zone.js's setZoneModalOpen (fade-out before hiding) --
    // duplicated rather than shared, matching this app's per-file
    // self-containment convention for these small admin modals.
    const modalCloseTokens = {};
    function setModalOpen(id, open) {
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
        setTimeout(finish, 220);
    }

    const PAGE_SIZE = 50;
    let offset = 0;
    let lastFilters = null;
    let loading = false;

    function pad2(n) { return String(n).padStart(2, "0"); }
    function isoDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

    // Today's/yesterday's items are still being actively tracked live
    // elsewhere (shift counters, the "Без ШК" zone); this search is for
    // looking back at the recent past, so it defaults to the -7..-2 day
    // window rather than today.
    function defaultDateRange() {
        const today = new Date();
        const from = new Date(today);
        from.setDate(from.getDate() - 7);
        const to = new Date(today);
        to.setDate(to.getDate() - 2);
        return { from: isoDate(from), to: isoDate(to) };
    }

    function currentFilters() {
        return {
            p_query: $("intakeSearchQuery").value.trim() || null,
            p_area: $("intakeSearchArea").value || null,
            p_item_type: $("intakeSearchItemType").value || null,
            p_category: $("intakeSearchCategory").value || null,
            p_full_name: $("intakeSearchFullName").value.trim() || null,
            p_date_from: $("intakeSearchDateFrom").value || null,
            p_date_to: $("intakeSearchDateTo").value || null,
        };
    }

    function resultCardHtml(item) {
        const photo = item.photo_path
            ? "<img src='" + escapeHtmlLocal(buildIntakePhotoUrl(item.photo_path)) + "' style='width:100%;border-radius:8px;object-fit:cover;max-height:200px;display:block;' loading='lazy'>"
            : "";
        const nameLine = escapeHtmlLocal(item.item_text || item.item_type || "Без наименования");
        const categoryLine = item.category ? " · " + escapeHtmlLocal(item.category) : "";
        const bucketLine = item.no_shk_bucket && item.no_shk_bucket !== "Короб смены"
            ? " <span style='color:#dc2626;font-weight:700;'>· " + escapeHtmlLocal(item.no_shk_bucket) + "</span>"
            : "";
        const when = new Date(item.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const stickerLine = item.sticker_code
            ? "<div style='font-size:12px;color:#64748b;'>Присвоенный ШК: " + escapeHtmlLocal(item.sticker_code) + "</div>"
            : "";
        return "<div style='border:1px solid rgba(15,23,42,.08);border-radius:10px;padding:10px;'>"
            + photo
            + "<div style='margin-top:8px;font-weight:700;font-size:14px;'>" + nameLine + categoryLine + bucketLine + "</div>"
            + "<div style='font-size:12px;color:#64748b;margin-top:2px;'>" + escapeHtmlLocal(item.area) + " · " + escapeHtmlLocal(item.item_type || "") + "</div>"
            + "<div style='font-size:12px;color:#64748b;'>" + escapeHtmlLocal(item.full_name) + " · " + when + "</div>"
            + stickerLine
            + "</div>";
    }

    async function runSearch(reset) {
        if (loading) return;
        const wrap = $("intakeSearchResultsWrap");
        const status = $("intakeSearchStatus");
        const moreBtn = $("intakeSearchMoreBtn");
        if (!wrap || !status || !moreBtn) return;
        const client = db();
        if (!client) return;
        if (reset) {
            offset = 0;
            lastFilters = currentFilters();
            wrap.innerHTML = "";
        }
        loading = true;
        status.textContent = "Загрузка…";
        status.style.color = "";
        const { data, error } = await client.rpc(
            "wms_intake_submissions_search",
            Object.assign({}, lastFilters, { p_limit: PAGE_SIZE, p_offset: offset })
        );
        loading = false;
        if (error) {
            status.textContent = "Не удалось загрузить: " + error.message;
            status.style.color = "#dc2626";
            moreBtn.style.display = "none";
            return;
        }
        const rows = data || [];
        if (reset && !rows.length) {
            wrap.innerHTML = "<p style='color:#94a3b8;'>Ничего не найдено.</p>";
        } else if (rows.length) {
            let grid = wrap.querySelector("[data-intake-search-grid]");
            if (!grid) {
                grid = document.createElement("div");
                grid.setAttribute("data-intake-search-grid", "");
                grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;";
                wrap.appendChild(grid);
            }
            grid.insertAdjacentHTML("beforeend", rows.map(resultCardHtml).join(""));
        }
        offset += rows.length;
        status.textContent = rows.length || !reset ? "" : "Ничего не найдено.";
        moreBtn.style.display = rows.length === PAGE_SIZE ? "" : "none";
    }

    function resetFiltersToDefault() {
        $("intakeSearchQuery").value = "";
        $("intakeSearchArea").value = "";
        $("intakeSearchItemType").value = "";
        $("intakeSearchCategory").value = "";
        $("intakeSearchFullName").value = "";
        const range = defaultDateRange();
        $("intakeSearchDateFrom").value = range.from;
        $("intakeSearchDateTo").value = range.to;
    }

    document.addEventListener("DOMContentLoaded", () => {
        const openBtn = $("openIntakeSearch");
        if (openBtn) {
            openBtn.addEventListener("click", () => {
                setModalOpen("intakeSearchModal", true);
                if (!lastFilters) {
                    resetFiltersToDefault();
                    void runSearch(true);
                }
            });
        }
        const closeBtn = $("closeIntakeSearch");
        if (closeBtn) closeBtn.addEventListener("click", () => setModalOpen("intakeSearchModal", false));

        const goBtn = $("intakeSearchGoBtn");
        if (goBtn) goBtn.addEventListener("click", () => void runSearch(true));

        const resetBtn = $("intakeSearchResetBtn");
        if (resetBtn) {
            resetBtn.addEventListener("click", () => {
                resetFiltersToDefault();
                void runSearch(true);
            });
        }

        const moreBtn = $("intakeSearchMoreBtn");
        if (moreBtn) moreBtn.addEventListener("click", () => void runSearch(false));
    });
})();
