// no_shk_zone.js — physical storage structure (racks/shelves + capacity)
// and box placement for the "Без ШК" zone. Loaded alongside tasks.js on
// tasks.html but kept as its own file/closure since tasks.js is already
// very large and this feature is self-contained: its own tables, its own
// modals, no interaction with tasks.js's own state.
//
// A "box" here is its own auto-numbered entity ("Короб без ШК {N}",
// matching the printed-label text), not tied to any product SHK -- these
// are exactly the items without a readable barcode. Boxes are placed
// directly on a shelf at creation; there's no unassigned/staging state and
// no move-between-shelves yet (remove + re-add is the way to move one for
// now). Printing reuses the existing print_label_templates -> print_jobs
// pipeline (print-tspl.js / print-bridge) via a seeded template named
// "Короб «Без ШК»" (see the 202609020003 migration) -- no separate print
// infrastructure. Next step toward physical navigation: linking a real
// task/SHK to a box.
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
    let boxLabelTemplate = null;
    let pendingBoxShelfId = "";
    let activeBoxId = "";

    const BOX_FIELDS = "id,box_number,shift_date,shift_type,box_type,area,responsible_name,created_at";

    async function loadZone() {
        const client = db();
        if (!client) return;
        const { data, error } = await client
            .from("wms_no_shk_racks")
            .select("id,name,created_at,wms_no_shk_shelves(id,name,capacity,created_at,wms_no_shk_boxes(" + BOX_FIELDS + "))")
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
        if (!boxLabelTemplate) void loadBoxLabelTemplate();
    }

    async function loadBoxLabelTemplate() {
        const client = db();
        if (!client) return;
        const { data, error } = await client
            .from("print_label_templates")
            .select("id,width_mm,height_mm,elements")
            .eq("name", "Короб «Без ШК»")
            .maybeSingle();
        if (error || !data) {
            console.error("[no_shk_zone] box label template not found:", error && error.message);
            return;
        }
        boxLabelTemplate = data;
    }

    function shelfSkeuoHtml(shelf) {
        const boxes = (shelf.wms_no_shk_boxes || []).slice().sort((a, b) => a.box_number - b.box_number);
        const isFull = boxes.length >= shelf.capacity;
        const boxesHtml = boxes.map((box) => (
            "<div class='no-shk-box' data-box-id='" + box.id + "' title='Короб без ШК " + box.box_number + "'>№" + box.box_number + "</div>"
        )).join("");
        const addHtml = "<button type='button' class='no-shk-box-add' data-add-box-shelf='" + shelf.id + "'"
            + (isFull ? " disabled title='Полка заполнена'" : " title='Добавить короб'") + ">+</button>";
        return "<div class='no-shk-shelf'>"
            + "<div class='no-shk-shelf-head'>"
            + "<span>" + escapeHtmlLocal(shelf.name) + "</span>"
            + "<span class='no-shk-shelf-fill" + (isFull ? " is-full" : "") + "'>" + boxes.length + " / " + shelf.capacity + "</span>"
            + "</div>"
            + "<div class='no-shk-boxes-row'>" + boxesHtml + addHtml + "</div>"
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
                ? "<div class='no-shk-rack-frame'>" + shelves.map(shelfSkeuoHtml).join("") + "</div>"
                : "<p style='color:#64748b;font-size:13px;'>Полок пока нет.</p>";
            return "<div class='no-shk-rack'>"
                + "<h3 class='no-shk-rack-title'>" + escapeHtmlLocal(rack.name) + "</h3>"
                + shelvesHtml
                + "</div>";
        }).join("");

        wrap.querySelectorAll("[data-add-box-shelf]").forEach((btn) => {
            btn.addEventListener("click", () => openNewBoxModal(btn.dataset.addBoxShelf));
        });
        wrap.querySelectorAll("[data-box-id]").forEach((box) => {
            box.addEventListener("click", () => openBoxDetailModal(box.dataset.boxId));
        });
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

    function findShelf(shelfId) {
        for (const rack of racks) {
            const shelf = (rack.wms_no_shk_shelves || []).find((s) => s.id === shelfId);
            if (shelf) return shelf;
        }
        return null;
    }

    function findBoxContext(boxId) {
        for (const rack of racks) {
            for (const shelf of rack.wms_no_shk_shelves || []) {
                const box = (shelf.wms_no_shk_boxes || []).find((b) => b.id === boxId);
                if (box) return { box, shelf, rack };
            }
        }
        return null;
    }

    // ---- New box modal ----

    function openNewBoxModal(shelfId) {
        const shelf = findShelf(shelfId);
        if (shelf && (shelf.wms_no_shk_boxes || []).length >= shelf.capacity) {
            alert("Полка уже заполнена (" + shelf.capacity + " " + boxWord(shelf.capacity) + ").");
            return;
        }
        pendingBoxShelfId = shelfId;
        $("newBoxShiftDate").value = new Date().toISOString().slice(0, 10);
        $("newBoxShiftType").value = "Дневная";
        $("newBoxType").value = "Короб";
        $("newBoxArea").value = "Сортировка";
        $("newBoxResponsible").value = "";
        $("noShkNewBoxStatus").textContent = "";
        setZoneModalOpen("noShkNewBoxModal", true);
    }

    async function saveNewBox() {
        const client = db();
        if (!client || !pendingBoxShelfId) return;
        const responsibleName = $("newBoxResponsible").value.trim();
        if (!responsibleName) {
            $("noShkNewBoxStatus").textContent = "Укажи, кто принёс короб.";
            $("noShkNewBoxStatus").style.color = "#dc2626";
            return;
        }
        const payload = {
            shelf_id: pendingBoxShelfId,
            shift_date: $("newBoxShiftDate").value || new Date().toISOString().slice(0, 10),
            shift_type: $("newBoxShiftType").value,
            box_type: $("newBoxType").value,
            area: $("newBoxArea").value,
            responsible_name: responsibleName,
        };
        const { error } = await client.from("wms_no_shk_boxes").insert(payload);
        if (error) {
            $("noShkNewBoxStatus").textContent = "Не удалось создать: " + error.message;
            $("noShkNewBoxStatus").style.color = "#dc2626";
            return;
        }
        setZoneModalOpen("noShkNewBoxModal", false);
        await loadZone();
    }

    // ---- Box detail modal ----

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

    function computeDateLabel(box) {
        if (box.shift_type === "Ночная") {
            return formatDateShort(box.shift_date) + "-" + formatDateShort(addDays(box.shift_date, 1));
        }
        return formatDateShort(box.shift_date);
    }

    function boxCode(box) {
        return "WMSP.BOX." + String(box.box_number).padStart(5, "0");
    }

    function openBoxDetailModal(boxId) {
        const ctx = findBoxContext(boxId);
        if (!ctx) return;
        activeBoxId = boxId;
        const { box, shelf, rack } = ctx;
        $("noShkBoxDetailWrap").innerHTML = "<div style='display:flex;flex-direction:column;gap:6px;font-size:14px;'>"
            + "<div><strong>Короб без ШК " + box.box_number + "</strong></div>"
            + "<div>Дата: " + escapeHtmlLocal(computeDateLabel(box)) + " (" + escapeHtmlLocal(box.shift_type) + ")</div>"
            + "<div>Тип: " + escapeHtmlLocal(box.box_type) + "</div>"
            + "<div>Участок: " + escapeHtmlLocal(box.area) + "</div>"
            + "<div>Ответственный: " + escapeHtmlLocal(box.responsible_name) + "</div>"
            + "<div>Местоположение: " + escapeHtmlLocal(rack.name) + " — " + escapeHtmlLocal(shelf.name) + "</div>"
            + "</div>";
        $("noShkBoxDetailStatus").textContent = "";
        setZoneModalOpen("noShkBoxDetailModal", true);
    }

    async function removeActiveBox() {
        const client = db();
        if (!client || !activeBoxId || !confirm("Убрать этот короб с полки?")) return;
        const { error } = await client.from("wms_no_shk_boxes").delete().eq("id", activeBoxId);
        if (error) {
            $("noShkBoxDetailStatus").textContent = "Не удалось убрать: " + error.message;
            $("noShkBoxDetailStatus").style.color = "#dc2626";
            return;
        }
        setZoneModalOpen("noShkBoxDetailModal", false);
        await loadZone();
    }

    async function printActiveBox() {
        const client = db();
        const status = $("noShkBoxDetailStatus");
        if (!client || !activeBoxId) return;
        if (!boxLabelTemplate) await loadBoxLabelTemplate();
        if (!boxLabelTemplate) {
            status.textContent = "Шаблон этикетки «Короб «Без ШК»» не найден.";
            status.style.color = "#dc2626";
            return;
        }
        const ctx = findBoxContext(activeBoxId);
        if (!ctx) return;
        const box = ctx.box;
        const data = {
            box_code: boxCode(box),
            box_number: String(box.box_number),
            date_label: computeDateLabel(box),
            area: box.area,
            box_type: box.box_type,
        };
        const tspl = buildTsplPayloadBase64(boxLabelTemplate, data);
        status.textContent = "Отправляю в очередь…";
        status.style.color = "";
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        const { data: job, error } = await client
            .from("print_jobs")
            .insert({ template_id: boxLabelTemplate.id, data, tspl, created_by: user.id || user.name || null })
            .select("id,status")
            .single();
        if (error) {
            status.textContent = "Ошибка постановки в очередь: " + error.message;
            status.style.color = "#dc2626";
            return;
        }
        status.textContent = "В очереди, жду принтер…";
        const channel = client
            .channel("no_shk_print_job_" + job.id)
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "print_jobs", filter: "id=eq." + job.id }, (payload) => {
                const row = payload.new;
                if (row.status === "printed") {
                    status.textContent = "Напечатано ✓";
                    client.removeChannel(channel);
                } else if (row.status === "failed") {
                    status.textContent = "Ошибка: " + (row.error_message || "неизвестная ошибка моста");
                    client.removeChannel(channel);
                }
            })
            .subscribe();
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

        const closeNewBoxBtn = $("closeNoShkNewBox");
        if (closeNewBoxBtn) closeNewBoxBtn.addEventListener("click", () => setZoneModalOpen("noShkNewBoxModal", false));
        const cancelNewBoxBtn = $("cancelNewBoxBtn");
        if (cancelNewBoxBtn) cancelNewBoxBtn.addEventListener("click", () => setZoneModalOpen("noShkNewBoxModal", false));
        const saveNewBoxBtn = $("saveNewBoxBtn");
        if (saveNewBoxBtn) saveNewBoxBtn.addEventListener("click", () => void saveNewBox());

        const closeBoxDetailBtn = $("closeNoShkBoxDetail");
        if (closeBoxDetailBtn) closeBoxDetailBtn.addEventListener("click", () => setZoneModalOpen("noShkBoxDetailModal", false));
        const removeBoxBtn = $("removeNoShkBoxBtn");
        if (removeBoxBtn) removeBoxBtn.addEventListener("click", () => void removeActiveBox());
        const printBoxBtn = $("printNoShkBoxBtn");
        if (printBoxBtn) printBoxBtn.addEventListener("click", () => void printActiveBox());
    });
})();
