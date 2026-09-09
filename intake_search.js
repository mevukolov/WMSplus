// intake_search.js — "Поиск товара без ШК": a standalone admin search
// across everything ever logged through the public intake form, on any
// area, in any accounting bucket (shift-box items, Шредер, Товар с
// переупаковки, Брак Бытовая химия). Self-contained, same convention as
// no_shk_zone.js: its own db()/escapeHtmlLocal, no shared state with
// tasks.js or no_shk_zone.js. The multi-select filter dropdowns visually
// match tasks.js's review-filter-* components (same CSS classes, same
// FILTER_NONE/empty-Set-means-all convention) but keep fully separate JS
// state, per this file's own self-containment convention.
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

    // Reverse of shk_generator.js's encode_shk_light/common_encode: a
    // sticker's scanned QR value is "*" + a base64-like-encoded BigInt
    // packing [checksum(4b)][checksum2(4b)][SHK value(42b)]. Decodes back
    // to the plain numeric value for display; falls back to the raw code
    // on any malformed input rather than hiding it. Checksum validity is
    // NOT re-checked here (matches shk_generator.js's own
    // try_parse(barcode, true) -- it displays the value even when the
    // checksum doesn't validate).
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

    // ---- fixed enums, matching the values used elsewhere for these same columns ----
    const AREA_OPTIONS = ["ХАБ", "Упаковка", "Маркетплейс"];
    const ITEM_TYPE_OPTIONS = ["Мелкий товар", "КГТ", "Шредер"];
    const CATEGORY_OPTIONS = ["Одежда", "Обувь", "Косметика", "Бытовая химия", "Мебель", "Электроника", "Ювелирка", "Для авто", "Для животных", "Посуда", "Еда", "Посылка"];
    const FILTER_OPTIONS = { areas: AREA_OPTIONS, itemTypes: ITEM_TYPE_OPTIONS, categories: CATEGORY_OPTIONS };

    const AREA_PILL_CLASS = {
        "ХАБ": "intake-area-pill--hub",
        "Упаковка": "intake-area-pill--pack",
        "Маркетплейс": "intake-area-pill--market",
    };
    function areaPillHtml(area) {
        if (!area) return "";
        return "<span class='intake-area-pill " + (AREA_PILL_CLASS[area] || "") + "'>" + escapeHtmlLocal(area) + "</span>";
    }

    function pad2(n) { return String(n).padStart(2, "0"); }
    function isoDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
    function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
    function ruDate(iso) {
        if (!iso) return "";
        const parts = iso.split("-");
        return parts[2] + "." + parts[1] + "." + parts[0];
    }

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

    // ---- multi-select filter state. Set semantics (mirrors tasks.js's
    // review-filter Set convention): empty Set = "all selected"; a Set
    // containing FILTER_NONE = "nothing selected" (matches zero rows). ----
    const FILTER_NONE = "__intake_filter_none__";
    const filters = {
        areas: new Set(),
        itemTypes: new Set(),
        categories: new Set(),
        employeeQuery: "",
        rangeFrom: "",
        rangeTo: "",
        calendarMonth: startOfMonth(new Date()),
        openKey: "",
    };

    function filterSummaryText(key) {
        const selected = filters[key];
        const options = FILTER_OPTIONS[key];
        if (selected.has(FILTER_NONE)) return "Ничего не выбрано";
        if (!selected.size || selected.size >= options.length) return "Выбраны все";
        if (selected.size === 1) return Array.from(selected)[0];
        return "Выбрано: " + selected.size;
    }

    function renderCheckboxOptions(key) {
        const selected = filters[key];
        const options = FILTER_OPTIONS[key];
        const noneChecked = selected.has(FILTER_NONE);
        const allChecked = !noneChecked && (!selected.size || selected.size >= options.length);
        return "<div class='review-filter-options'>"
            + "<label class='review-filter-check'><input type='checkbox' data-intake-filter-all='" + key + "' " + (allChecked ? "checked" : "") + "> Выбрать всё</label>"
            + options.map((value) => "<label class='review-filter-check'><input type='checkbox' data-intake-filter='" + key + "' value='" + escapeHtmlLocal(value) + "' " + (allChecked || selected.has(value) ? "checked" : "") + "> " + escapeHtmlLocal(value) + "</label>").join("")
            + "</div>";
    }

    function renderDropdownBlock(key, title) {
        return "<div class='review-filter-block" + (filters.openKey === key ? " is-open" : "") + "'>"
            + "<span class='review-filter-title'>" + escapeHtmlLocal(title) + "</span>"
            + "<button class='review-filter-trigger' type='button' data-intake-filter-toggle='" + key + "'><span class='review-filter-summary'>" + escapeHtmlLocal(filterSummaryText(key)) + "</span><span class='review-filter-chevron'>⌄</span></button>"
            + "<div class='review-filter-popover'><p class='review-filter-menu-title'>" + escapeHtmlLocal(title) + "</p>" + renderCheckboxOptions(key) + "</div>"
            + "</div>";
    }

    function renderEmployeeBlock() {
        return "<div class='review-filter-block'>"
            + "<span class='review-filter-title'>Сотрудник</span>"
            + "<input id='intakeSearchEmployee' type='text' class='input' placeholder='ФИО или таб. номер' style='width:100%;min-height:38px;' value='" + escapeHtmlLocal(filters.employeeQuery) + "'>"
            + "</div>";
    }

    function renderCalendarBlock() {
        const month = filters.calendarMonth;
        const label = month.toLocaleString("ru-RU", { month: "long", year: "numeric" });
        const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => "<span class='review-filter-weekday'>" + d + "</span>").join("");
        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        const startOffset = (first.getDay() + 6) % 7;
        const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        const cells = [];
        for (let i = 0; i < startOffset; i++) cells.push("<span class='review-filter-empty'></span>");
        for (let day = 1; day <= daysInMonth; day++) {
            const iso = isoDate(new Date(month.getFullYear(), month.getMonth(), day));
            let cls = "";
            if (iso === filters.rangeFrom || iso === filters.rangeTo) cls = " is-intake-range-start";
            else if (filters.rangeFrom && filters.rangeTo && iso > filters.rangeFrom && iso < filters.rangeTo) cls = " is-intake-in-range";
            cells.push("<button class='review-filter-day" + cls + "' type='button' data-intake-range-day='" + iso + "'>" + day + "</button>");
        }
        const summary = filters.rangeFrom && filters.rangeTo
            ? ruDate(filters.rangeFrom) + " – " + ruDate(filters.rangeTo)
            : (filters.rangeFrom ? "С " + ruDate(filters.rangeFrom) + "… выберите конец" : "Выберите период");
        return "<div class='review-filter-block" + (filters.openKey === "date" ? " is-open" : "") + "'>"
            + "<span class='review-filter-title'>Период</span>"
            + "<button class='review-filter-trigger intake-daterange-trigger' type='button' data-intake-filter-toggle='date'><span class='review-filter-summary'>" + escapeHtmlLocal(summary) + "</span><span class='review-filter-chevron'>⌄</span></button>"
            + "<div class='review-filter-popover'>"
            + "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;'>"
            + "<button class='btn btn-square' type='button' data-intake-month-nav='-1' style='min-width:28px;min-height:28px;'>‹</button>"
            + "<b style='font-size:13px;text-transform:capitalize;'>" + escapeHtmlLocal(label) + "</b>"
            + "<button class='btn btn-square' type='button' data-intake-month-nav='1' style='min-width:28px;min-height:28px;'>›</button>"
            + "</div>"
            + "<div class='review-filter-calendar'>" + weekdays + cells.join("") + "</div>"
            + "</div>"
            + "</div>";
    }

    function renderFilterPanel() {
        const panel = $("intakeSearchFilterPanel");
        if (!panel) return;
        const grid = panel.querySelector(".review-filter-panel");
        if (!grid) return;
        grid.innerHTML = renderDropdownBlock("areas", "Участок")
            + renderDropdownBlock("itemTypes", "Тип")
            + renderDropdownBlock("categories", "Категория")
            + renderEmployeeBlock()
            + renderCalendarBlock();
    }

    function wireFilterPanelEvents() {
        const panel = $("intakeSearchFilterPanel");
        if (!panel) return;

        panel.addEventListener("click", (e) => {
            const toggleBtn = e.target.closest("[data-intake-filter-toggle]");
            if (toggleBtn) {
                e.stopPropagation();
                const key = toggleBtn.getAttribute("data-intake-filter-toggle");
                filters.openKey = filters.openKey === key ? "" : key;
                renderFilterPanel();
                return;
            }
            const monthNav = e.target.closest("[data-intake-month-nav]");
            if (monthNav) {
                e.stopPropagation();
                const delta = parseInt(monthNav.getAttribute("data-intake-month-nav"), 10);
                const m = filters.calendarMonth;
                filters.calendarMonth = new Date(m.getFullYear(), m.getMonth() + delta, 1);
                renderFilterPanel();
                return;
            }
            const dayBtn = e.target.closest("[data-intake-range-day]");
            if (dayBtn) {
                e.stopPropagation();
                const iso = dayBtn.getAttribute("data-intake-range-day");
                if (!filters.rangeFrom || filters.rangeTo || iso < filters.rangeFrom) {
                    filters.rangeFrom = iso;
                    filters.rangeTo = "";
                } else {
                    filters.rangeTo = iso;
                    filters.openKey = "";
                }
                renderFilterPanel();
                return;
            }
        });

        panel.addEventListener("change", (e) => {
            const allBox = e.target.closest("[data-intake-filter-all]");
            if (allBox) {
                e.stopPropagation();
                const key = allBox.getAttribute("data-intake-filter-all");
                filters[key] = allBox.checked ? new Set() : new Set([FILTER_NONE]);
                renderFilterPanel();
                return;
            }
            const oneBox = e.target.closest("[data-intake-filter]");
            if (oneBox) {
                e.stopPropagation();
                const key = oneBox.getAttribute("data-intake-filter");
                const options = FILTER_OPTIONS[key];
                const popover = oneBox.closest(".review-filter-popover");
                const checked = Array.from(popover.querySelectorAll("[data-intake-filter='" + key + "']:checked")).map((el) => el.value);
                if (!checked.length) filters[key] = new Set([FILTER_NONE]);
                else if (checked.length >= options.length) filters[key] = new Set();
                else filters[key] = new Set(checked);
                renderFilterPanel();
            }
        });

        panel.addEventListener("input", (e) => {
            if (e.target && e.target.id === "intakeSearchEmployee") {
                filters.employeeQuery = e.target.value;
            }
        });

        document.addEventListener("click", (e) => {
            if (!filters.openKey) return;
            if (panel.contains(e.target)) return;
            filters.openKey = "";
            renderFilterPanel();
        });
    }

    function setToParam(key) {
        const selected = filters[key];
        if (selected.has(FILTER_NONE)) return [];
        if (!selected.size) return null;
        return Array.from(selected);
    }

    function currentFilters() {
        return {
            p_query: $("intakeSearchQuery").value.trim() || null,
            p_areas: setToParam("areas"),
            p_item_types: setToParam("itemTypes"),
            p_categories: setToParam("categories"),
            p_employee_query: filters.employeeQuery.trim() || null,
            p_date_from: filters.rangeFrom || null,
            p_date_to: filters.rangeTo || null,
        };
    }

    const PAGE_SIZE = 50;
    let offset = 0;
    let lastFilters = null;
    let loading = false;
    let itemsById = new Map();
    let itemAutoId = 0;

    function resultCardHtml(item) {
        const id = "int" + (++itemAutoId);
        itemsById.set(id, item);
        const photo = item.photo_path
            ? "<img class='intake-search-photo' data-intake-photo-id='" + id + "' src='" + escapeHtmlLocal(buildIntakePhotoUrl(item.photo_path)) + "' style='width:100%;border-radius:8px;object-fit:cover;max-height:200px;display:block;' loading='lazy'>"
            : "";
        const isShredder = item.item_type === "Шредер";
        const nameLine = escapeHtmlLocal(isShredder ? "Шредер" : (item.item_text || item.item_type || "Без наименования"));
        const categoryLine = item.category
            ? "<div style='font-style:italic;color:#64748b;font-size:12px;'>" + escapeHtmlLocal(item.category) + "</div>"
            : "";
        // "Короб смены" is the default bucket (not worth calling out);
        // "Товар с переупаковки" just restates the area, already shown as
        // the pill above; "Шредер" the bucket restates item_type, already
        // shown in black below -- suppress all three, keep genuine extras.
        const showBucket = item.no_shk_bucket
            && item.no_shk_bucket !== "Короб смены"
            && item.no_shk_bucket !== "Товар с переупаковки"
            && item.no_shk_bucket !== "Шредер";
        const bucketLine = showBucket
            ? "<div style='font-size:12px;color:#dc2626;font-weight:700;'>" + escapeHtmlLocal(item.no_shk_bucket) + "</div>"
            : "";
        const when = new Date(item.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const stickerLine = item.sticker_code
            ? "<div style='font-size:12px;color:#64748b;'>Присвоенный ШК: " + escapeHtmlLocal(decodeStickerCode(item.sticker_code) || item.sticker_code) + "</div>"
            : "";
        return "<div class='intake-search-card" + (item.sticker_code ? " has-shk" : "") + "'>"
            + photo
            + "<div style='margin-top:8px;'>"
            + areaPillHtml(item.area)
            + "<div style='font-weight:900;font-size:14px;margin-top:4px;'>" + nameLine + "</div>"
            + categoryLine
            + bucketLine
            + "<div style='font-size:12px;color:#64748b;margin-top:2px;'>" + escapeHtmlLocal(item.item_type || "") + " · " + when + "</div>"
            + stickerLine
            + "</div>"
            + "</div>";
    }

    function openPhotoLightbox(item) {
        const wrap = $("intakeSearchPhotoWrap");
        if (!wrap || !item.photo_path) return;
        const when = new Date(item.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const isShredder = item.item_type === "Шредер";
        const nameLine = escapeHtmlLocal(isShredder ? "Шредер" : (item.item_text || item.item_type || "Без наименования"));
        const stickerLine = item.sticker_code
            ? "<div class='row'><b>Присвоенный ШК:</b> " + escapeHtmlLocal(decodeStickerCode(item.sticker_code) || item.sticker_code) + "</div>"
            : "";
        const bucketLine = item.no_shk_bucket && item.no_shk_bucket !== "Короб смены"
            ? "<div class='row'><b>Учёт:</b> " + escapeHtmlLocal(item.no_shk_bucket) + "</div>"
            : "";
        const employeeLine = "<div class='row'><b>Сотрудник:</b> " + escapeHtmlLocal(item.full_name || "-")
            + (item.employee_id ? " (№" + escapeHtmlLocal(String(item.employee_id)) + ")" : "") + "</div>";
        wrap.innerHTML = "<img src='" + escapeHtmlLocal(buildIntakePhotoUrl(item.photo_path)) + "' alt='Фото товара'>"
            + "<div class='intake-photo-lightbox-info'>"
            + areaPillHtml(item.area)
            + "<div class='name'>" + nameLine + "</div>"
            + (item.category ? "<div class='category'>" + escapeHtmlLocal(item.category) + "</div>" : "")
            + bucketLine
            + employeeLine
            + "<div class='row'><b>Тип:</b> " + escapeHtmlLocal(item.item_type || "-") + "</div>"
            + "<div class='row'><b>Когда:</b> " + when + "</div>"
            + stickerLine
            + "</div>";
        setModalOpen("intakeSearchPhotoModal", true);
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
            itemsById = new Map();
            itemAutoId = 0;
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
        filters.areas = new Set();
        filters.itemTypes = new Set();
        filters.categories = new Set();
        filters.employeeQuery = "";
        filters.openKey = "";
        const range = defaultDateRange();
        filters.rangeFrom = range.from;
        filters.rangeTo = range.to;
        filters.calendarMonth = startOfMonth(new Date(range.to + "T00:00:00"));
        renderFilterPanel();
    }

    document.addEventListener("DOMContentLoaded", () => {
        wireFilterPanelEvents();

        const resultsWrap = $("intakeSearchResultsWrap");
        if (resultsWrap) {
            resultsWrap.addEventListener("click", (e) => {
                const photoEl = e.target.closest("[data-intake-photo-id]");
                if (!photoEl) return;
                const item = itemsById.get(photoEl.getAttribute("data-intake-photo-id"));
                if (item) openPhotoLightbox(item);
            });
        }

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
        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                setModalOpen("intakeSearchModal", false);
                setModalOpen("intakeSearchPhotoModal", false);
            });
        }
        const closePhotoBtn = $("closeIntakeSearchPhoto");
        if (closePhotoBtn) closePhotoBtn.addEventListener("click", () => setModalOpen("intakeSearchPhotoModal", false));

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
