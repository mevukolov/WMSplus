// no_shk_zone.js — physical storage structure (racks/shelves + capacity)
// for the "Без ШК" zone. Loaded alongside tasks.js on tasks.html but kept
// as its own file/closure since tasks.js is already very large and this
// feature is self-contained: its own tables, its own two modals, no
// interaction with tasks.js's own state. First step only -- structure and
// capacity, no linking of actual boxes/SHK to a shelf yet (that's a later
// step toward physical navigation through WMS).
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

    // Same fixed-class animated overlay every other modal on this page
    // uses (see .tasks-flow-modal.upload-work in tasks.html), but tasks.js
    // keeps its own setFlowModalOpen()/closeFlowModals() private to its
    // own closure -- this is the same behavior, self-contained here.
    const modalCloseTokens = {};
    function setZoneModalOpen(id, open) {
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
        modal.addEventListener("animationend", finish, { once: true });
        setTimeout(finish, 260);
    }

    let racks = [];

    async function loadZone() {
        const client = db();
        if (!client) return;
        const { data, error } = await client
            .from("wms_no_shk_racks")
            .select("id,name,created_at,wms_no_shk_shelves(id,name,capacity,created_at)")
            .order("created_at", { ascending: true })
            .order("created_at", { ascending: true, foreignTable: "wms_no_shk_shelves" });
        if (error) {
            racks = [];
            renderZoneView("Не удалось загрузить: " + error.message);
            renderAdminView();
            return;
        }
        racks = data || [];
        renderZoneView();
        renderAdminView();
    }

    function shelfRowHtml(shelf) {
        return "<div class='card' style='padding:8px 12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;'>"
            + "<span>" + escapeHtmlLocal(shelf.name) + "</span>"
            + "<span style='color:#64748b;font-size:13px;'>до " + shelf.capacity + " " + boxWord(shelf.capacity) + "</span>"
            + "</div>";
    }

    function boxWord(count) {
        const n = Math.abs(count) % 100;
        const last = n % 10;
        if (n >= 11 && n <= 14) return "коробов";
        if (last === 1) return "короба";
        if (last >= 2 && last <= 4) return "коробов";
        return "коробов";
    }

    function renderZoneView(errorMessage) {
        const wrap = $("noShkZoneWrap");
        if (!wrap) return;
        if (errorMessage) {
            wrap.innerHTML = "<p style='color:#dc2626;'>" + escapeHtmlLocal(errorMessage) + "</p>";
            return;
        }
        if (!racks.length) {
            wrap.innerHTML = "<p style='color:#64748b;'>Стеллажей пока нет. Нажми ✎, чтобы добавить.</p>";
            return;
        }
        wrap.innerHTML = racks.map((rack) => {
            const shelves = rack.wms_no_shk_shelves || [];
            const shelvesHtml = shelves.length
                ? shelves.map(shelfRowHtml).join("")
                : "<p style='color:#64748b;font-size:13px;'>Полок пока нет.</p>";
            return "<div class='card' style='padding:14px;margin-bottom:12px;'>"
                + "<h3 style='margin:0 0 10px;'>" + escapeHtmlLocal(rack.name) + "</h3>"
                + shelvesHtml
                + "</div>";
        }).join("");
    }

    function renderAdminView() {
        const wrap = $("noShkZoneAdminWrap");
        if (!wrap) return;
        if (!racks.length) {
            wrap.innerHTML = "<p style='color:#64748b;'>Стеллажей пока нет — добавь первый ниже.</p>";
            return;
        }
        wrap.innerHTML = racks.map((rack) => {
            const shelves = rack.wms_no_shk_shelves || [];
            const shelvesHtml = shelves.map((shelf) => (
                "<div class='card' style='padding:8px 12px;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;'>"
                + "<span>" + escapeHtmlLocal(shelf.name) + " — до " + shelf.capacity + " " + boxWord(shelf.capacity) + "</span>"
                + "<button class='btn btn-square' type='button' data-delete-shelf='" + shelf.id + "'>×</button>"
                + "</div>"
            )).join("");
            return "<div class='card' style='padding:14px;margin-bottom:12px;'>"
                + "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;'>"
                + "<h3 style='margin:0;'>" + escapeHtmlLocal(rack.name) + "</h3>"
                + "<button class='btn btn-outline' type='button' data-delete-rack='" + rack.id + "'>Удалить стеллаж</button>"
                + "</div>"
                + shelvesHtml
                + "<div style='display:flex;gap:8px;align-items:flex-end;margin-top:8px;'>"
                + "<label>Полка<br><input type='text' data-new-shelf-name='" + rack.id + "' placeholder='Полка " + (shelves.length + 1) + "' style='width:140px;'></label>"
                + "<label>Вместимость<br><input type='number' data-new-shelf-capacity='" + rack.id + "' value='10' style='width:90px;'></label>"
                + "<button class='btn btn-outline' type='button' data-add-shelf='" + rack.id + "'>+ Полка</button>"
                + "</div>"
                + "</div>";
        }).join("");

        wrap.querySelectorAll("[data-delete-rack]").forEach((btn) => {
            btn.addEventListener("click", () => deleteRack(btn.dataset.deleteRack));
        });
        wrap.querySelectorAll("[data-delete-shelf]").forEach((btn) => {
            btn.addEventListener("click", () => deleteShelf(btn.dataset.deleteShelf));
        });
        wrap.querySelectorAll("[data-add-shelf]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const rackId = btn.dataset.addShelf;
                const nameInput = wrap.querySelector("[data-new-shelf-name='" + rackId + "']");
                const capacityInput = wrap.querySelector("[data-new-shelf-capacity='" + rackId + "']");
                addShelf(rackId, nameInput.value.trim() || nameInput.placeholder, Number(capacityInput.value) || 0);
            });
        });
    }

    function setAdminStatus(message, isError) {
        const status = $("noShkZoneAdminStatus");
        if (!status) return;
        status.textContent = message || "";
        status.style.color = isError ? "#dc2626" : "";
    }

    async function addRack(name) {
        const client = db();
        if (!client || !name) return;
        const { error } = await client.from("wms_no_shk_racks").insert({ name });
        if (error) { setAdminStatus("Не удалось добавить стеллаж: " + error.message, true); return; }
        setAdminStatus("");
        await loadZone();
    }

    async function deleteRack(id) {
        const client = db();
        if (!client || !confirm("Удалить стеллаж вместе со всеми его полками?")) return;
        const { error } = await client.from("wms_no_shk_racks").delete().eq("id", id);
        if (error) { setAdminStatus("Не удалось удалить: " + error.message, true); return; }
        setAdminStatus("");
        await loadZone();
    }

    async function addShelf(rackId, name, capacity) {
        const client = db();
        if (!client) return;
        const { error } = await client.from("wms_no_shk_shelves").insert({ rack_id: rackId, name, capacity });
        if (error) { setAdminStatus("Не удалось добавить полку: " + error.message, true); return; }
        setAdminStatus("");
        await loadZone();
    }

    async function deleteShelf(id) {
        const client = db();
        if (!client || !confirm("Удалить полку?")) return;
        const { error } = await client.from("wms_no_shk_shelves").delete().eq("id", id);
        if (error) { setAdminStatus("Не удалось удалить: " + error.message, true); return; }
        setAdminStatus("");
        await loadZone();
    }

    document.addEventListener("DOMContentLoaded", () => {
        const openBtn = $("openNoShkZone");
        if (openBtn) {
            openBtn.addEventListener("click", () => {
                setZoneModalOpen("noShkZoneModal", true);
                void loadZone();
            });
        }
        const closeBtn = $("closeNoShkZone");
        if (closeBtn) closeBtn.addEventListener("click", () => setZoneModalOpen("noShkZoneModal", false));

        const editBtn = $("editNoShkZoneBtn");
        if (editBtn) {
            editBtn.addEventListener("click", () => {
                setZoneModalOpen("noShkZoneAdminModal", true);
                setAdminStatus("");
                renderAdminView();
            });
        }
        const closeAdminBtn = $("closeNoShkZoneAdmin");
        if (closeAdminBtn) closeAdminBtn.addEventListener("click", () => setZoneModalOpen("noShkZoneAdminModal", false));

        const addRackBtn = $("addRackBtn");
        if (addRackBtn) {
            addRackBtn.addEventListener("click", () => {
                const input = $("newRackName");
                const name = input.value.trim();
                if (!name) return;
                input.value = "";
                void addRack(name);
            });
        }
    });
})();
