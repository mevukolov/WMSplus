// print_templates_admin.js — CRUD over print_label_templates. Uses the
// shared supabaseClient that ui.js sets up on window (ui.js:71-83) --
// same pattern every other standalone page in this repo follows.
(function () {
    "use strict";

    function db() {
        return window.supabaseClient || null;
    }

    let editingId = "";
    let editingElements = [];

    async function loadTemplates() {
        const client = db();
        const list = document.getElementById("templateList");
        if (!client || !list) return;
        const { data, error } = await client
            .from("print_label_templates")
            .select("id,name,width_mm,height_mm,elements")
            .order("created_at", { ascending: false });
        if (error) {
            list.textContent = "Не удалось загрузить шаблоны: " + error.message;
            return;
        }
        if (!data || !data.length) {
            list.innerHTML = "<p>Шаблонов пока нет.</p>";
            return;
        }
        list.innerHTML = data.map((template) => (
            "<div class='card' style='padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;'>"
            + "<div><strong>" + escapeHtmlLocal(template.name) + "</strong>"
            + "<div style='color:#64748b;font-size:13px;'>" + template.width_mm + "×" + template.height_mm + " мм · " + (Array.isArray(template.elements) ? template.elements.length : 0) + " элементов</div></div>"
            + "<div style='display:flex;gap:8px;'>"
            + "<button class='btn btn-outline' data-edit='" + template.id + "' type='button'>Изменить</button>"
            + "<button class='btn btn-outline' data-delete='" + template.id + "' type='button'>Удалить</button>"
            + "</div></div>"
        )).join("");
        list.querySelectorAll("[data-edit]").forEach((btn) => {
            btn.addEventListener("click", () => openEditor(data.find((t) => t.id === btn.dataset.edit)));
        });
        list.querySelectorAll("[data-delete]").forEach((btn) => {
            btn.addEventListener("click", () => deleteTemplate(btn.dataset.delete));
        });
    }

    function escapeHtmlLocal(value) {
        const div = document.createElement("div");
        div.textContent = value == null ? "" : String(value);
        return div.innerHTML;
    }

    // Which extra inputs make sense depends on the element's type -- e.g.
    // font_size only matters for text, barcode_type only for barcode.
    // This mirrors exactly the field set print-tspl.js's element builders
    // read (Task 3), so nothing entered here is silently ignored by TSPL
    // generation.
    const NUMERIC_FIELDS = ["x_mm", "y_mm", "width_mm", "height_mm", "font_size"];

    // Visual drag-and-drop editor: elements are boxes positioned on a
    // to-scale rectangle representing the physical label. Dragging updates
    // x_mm/y_mm live; clicking selects an element and shows its full
    // property set below the canvas. Boxes are labeled placeholders (type
    // + value), not real barcode/QR renders -- precise positioning is the
    // goal here, not print-accurate preview.
    const PX_PER_MM = 6;
    let selectedIndex = -1;
    let dragState = null;

    function labelWidthMm() { return Number(document.getElementById("tplWidth").value) || 50; }
    function labelHeightMm() { return Number(document.getElementById("tplHeight").value) || 50; }

    function elementBoxSizePx(element) {
        const type = element.type || "text";
        if (type === "barcode") return { w: 90, h: Math.max(16, Math.round((element.height_mm || 10) * PX_PER_MM)) };
        if (type === "qr") { const side = Math.max(24, Math.round((element.width_mm || 20) * PX_PER_MM)); return { w: side, h: side }; }
        return { w: 70, h: 22 };
    }

    function elementLabel(element) {
        const type = element.type || "text";
        const isStatic = Object.prototype.hasOwnProperty.call(element, "literal");
        const value = isStatic ? (element.literal || "") : "{" + (element.field || "?") + "}";
        const prefix = type === "text" ? "Текст" : type === "barcode" ? "ШК" : "QR";
        return prefix + ": " + value;
    }

    function elementBoxHtml(element, index) {
        const size = elementBoxSizePx(element);
        const left = Math.round((element.x_mm || 0) * PX_PER_MM);
        const top = Math.round((element.y_mm || 0) * PX_PER_MM);
        const isSelected = index === selectedIndex;
        const bg = isSelected ? "#2563eb" : "#94a3b8";
        return "<div class='label-el' data-el-index='" + index + "' style='"
            + "position:absolute;left:" + left + "px;top:" + top + "px;width:" + size.w + "px;height:" + size.h + "px;"
            + "background:" + bg + ";color:#fff;font-size:11px;line-height:1.2;padding:2px 4px;overflow:hidden;"
            + "border-radius:3px;cursor:grab;box-sizing:border-box;user-select:none;white-space:nowrap;"
            + (isSelected ? "outline:2px solid #1d4ed8;outline-offset:1px;" : "") + "'>"
            + escapeHtmlLocal(elementLabel(element))
            + "</div>";
    }

    function renderCanvas() {
        const wrap = document.getElementById("labelCanvasWrap");
        const widthPx = Math.round(labelWidthMm() * PX_PER_MM);
        const heightPx = Math.round(labelHeightMm() * PX_PER_MM);
        wrap.style.width = widthPx + "px";
        wrap.style.height = heightPx + "px";
        wrap.innerHTML = editingElements.map((element, index) => elementBoxHtml(element, index)).join("");
        wrap.querySelectorAll("[data-el-index]").forEach((box) => {
            box.addEventListener("pointerdown", onBoxPointerDown);
        });
        renderPropsPanel();
    }

    // Cheap update for while the user is actively typing in a property
    // field: repositions/resizes/relabels one box in place, without
    // rebuilding the property panel (which would drop input focus on
    // every keystroke).
    function updateBoxVisual(index) {
        const wrap = document.getElementById("labelCanvasWrap");
        const box = wrap.querySelector("[data-el-index='" + index + "']");
        if (!box) return;
        const element = editingElements[index];
        const size = elementBoxSizePx(element);
        const left = Math.max(0, Math.min(Math.round((element.x_mm || 0) * PX_PER_MM), wrap.clientWidth - size.w));
        const top = Math.max(0, Math.min(Math.round((element.y_mm || 0) * PX_PER_MM), wrap.clientHeight - size.h));
        box.style.left = left + "px";
        box.style.top = top + "px";
        box.style.width = size.w + "px";
        box.style.height = size.h + "px";
        box.textContent = elementLabel(element);
    }

    function onBoxPointerDown(event) {
        event.preventDefault();
        const box = event.currentTarget;
        const index = Number(box.dataset.elIndex);
        const wrap = document.getElementById("labelCanvasWrap");
        const wrapRect = wrap.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();
        dragState = {
            index: index,
            offsetX: event.clientX - boxRect.left,
            offsetY: event.clientY - boxRect.top,
            wrapRect: wrapRect,
            moved: false,
        };
        selectedIndex = index;
        document.addEventListener("pointermove", onDragMove);
        document.addEventListener("pointerup", onDragEnd);
        renderCanvas();
    }

    function onDragMove(event) {
        if (!dragState) return;
        dragState.moved = true;
        const element = editingElements[dragState.index];
        const size = elementBoxSizePx(element);
        const wrap = document.getElementById("labelCanvasWrap");
        let left = event.clientX - dragState.wrapRect.left - dragState.offsetX;
        let top = event.clientY - dragState.wrapRect.top - dragState.offsetY;
        left = Math.max(0, Math.min(left, wrap.clientWidth - size.w));
        top = Math.max(0, Math.min(top, wrap.clientHeight - size.h));
        const box = wrap.querySelector("[data-el-index='" + dragState.index + "']");
        if (box) { box.style.left = left + "px"; box.style.top = top + "px"; }
    }

    function onDragEnd() {
        document.removeEventListener("pointermove", onDragMove);
        document.removeEventListener("pointerup", onDragEnd);
        if (!dragState) return;
        const element = editingElements[dragState.index];
        const wrap = document.getElementById("labelCanvasWrap");
        const box = wrap.querySelector("[data-el-index='" + dragState.index + "']");
        if (box && dragState.moved) {
            element.x_mm = Math.round(parseInt(box.style.left, 10) / PX_PER_MM);
            element.y_mm = Math.round(parseInt(box.style.top, 10) / PX_PER_MM);
        }
        dragState = null;
        renderCanvas();
    }

    function propFieldHtml(element) {
        const type = element.type || "text";
        if (type === "text") return "<label>Размер шрифта<br><input data-prop-field='font_size' type='number' value='" + (element.font_size || 10) + "' style='width:100%;'></label>";
        if (type === "barcode") {
            return "<label>Высота, мм<br><input data-prop-field='height_mm' type='number' value='" + (element.height_mm || 10) + "' style='width:100%;'></label>"
                + "<label>Тип штрихкода<br><select data-prop-field='barcode_type'><option value='code128'" + (element.barcode_type !== "ean13" ? " selected" : "") + ">Code128</option><option value='ean13'" + (element.barcode_type === "ean13" ? " selected" : "") + ">EAN13</option></select></label>";
        }
        return "<label>Ширина, мм<br><input data-prop-field='width_mm' type='number' value='" + (element.width_mm || 20) + "' style='width:100%;'></label>";
    }

    function renderPropsPanel() {
        const panel = document.getElementById("elementProps");
        if (selectedIndex < 0 || !editingElements[selectedIndex]) {
            panel.innerHTML = "<p style='color:#64748b;font-size:13px;'>Кликни по блоку на этикетке, чтобы изменить его свойства.</p>";
            return;
        }
        const element = editingElements[selectedIndex];
        const type = element.type || "text";
        const isStatic = Object.prototype.hasOwnProperty.call(element, "literal");
        panel.innerHTML = "<div style='display:flex;flex-direction:column;gap:8px;'>"
            + "<label>Тип<br><select data-prop-field='type'><option value='text'" + (type === "text" ? " selected" : "") + ">Текст</option><option value='barcode'" + (type === "barcode" ? " selected" : "") + ">Штрихкод</option><option value='qr'" + (type === "qr" ? " selected" : "") + ">QR</option></select></label>"
            + "<label>Источник<br><select data-prop-field='source'><option value='field'" + (!isStatic ? " selected" : "") + ">Поле данных</option><option value='literal'" + (isStatic ? " selected" : "") + ">Статический текст</option></select></label>"
            + "<label>" + (isStatic ? "Текст" : "Имя поля") + "<br><input data-prop-field='value' type='text' value='" + escapeHtmlLocal(isStatic ? element.literal : (element.field || "")) + "' placeholder='" + (isStatic ? "СКЛАД 1" : "shk") + "' style='width:100%;'></label>"
            + "<div style='display:flex;gap:8px;'>"
            + "<label style='flex:1;'>X, мм<br><input data-prop-field='x_mm' type='number' value='" + (element.x_mm || 0) + "' style='width:100%;'></label>"
            + "<label style='flex:1;'>Y, мм<br><input data-prop-field='y_mm' type='number' value='" + (element.y_mm || 0) + "' style='width:100%;'></label>"
            + "</div>"
            + propFieldHtml(element)
            + "<button type='button' class='btn btn-outline' id='removeSelectedElementBtn'>Удалить элемент</button>"
            + "</div>";
        panel.querySelectorAll("[data-prop-field]").forEach((input) => {
            input.addEventListener("input", () => {
                const field = input.dataset.propField;
                const el = editingElements[selectedIndex];
                if (field === "type") {
                    el.type = input.value;
                    renderCanvas(); // box size/shape depends on type -- full rebuild
                    return;
                }
                if (field === "source") {
                    // Toggling source moves the current value between
                    // .field and .literal, keeping the other key absent --
                    // print-tspl.js's resolveElementValue() checks for the
                    // *presence* of .literal, not its emptiness.
                    const current = el.literal != null ? el.literal : (el.field || "");
                    if (input.value === "literal") { el.literal = current; delete el.field; }
                    else { el.field = current; delete el.literal; }
                    renderPropsPanel(); // label/placeholder swap ("Имя поля" <-> "Текст")
                    updateBoxVisual(selectedIndex);
                    return;
                }
                if (field === "value") {
                    if (Object.prototype.hasOwnProperty.call(el, "literal")) el.literal = input.value;
                    else el.field = input.value;
                    updateBoxVisual(selectedIndex); // no panel rebuild -- keep focus while typing
                    return;
                }
                el[field] = NUMERIC_FIELDS.indexOf(field) !== -1 ? Number(input.value) : input.value;
                updateBoxVisual(selectedIndex); // no panel rebuild -- keep focus while typing
            });
        });
        document.getElementById("removeSelectedElementBtn").addEventListener("click", () => {
            editingElements.splice(selectedIndex, 1);
            selectedIndex = -1;
            renderCanvas();
        });
    }

    function openEditor(template) {
        editingId = template ? template.id : "";
        editingElements = template && Array.isArray(template.elements) ? JSON.parse(JSON.stringify(template.elements)) : [];
        selectedIndex = -1;
        document.getElementById("tplName").value = template ? template.name : "";
        document.getElementById("tplWidth").value = template ? template.width_mm : 50;
        document.getElementById("tplHeight").value = template ? template.height_mm : 50;
        renderCanvas();
        document.getElementById("templateEditor").showModal();
    }

    async function saveTemplate() {
        const client = db();
        if (!client) return;
        const payload = {
            name: document.getElementById("tplName").value.trim(),
            width_mm: Number(document.getElementById("tplWidth").value) || 50,
            height_mm: Number(document.getElementById("tplHeight").value) || 50,
            elements: editingElements,
            updated_at: new Date().toISOString(),
        };
        if (!payload.name) return;
        const query = editingId
            ? client.from("print_label_templates").update(payload).eq("id", editingId)
            : client.from("print_label_templates").insert(payload);
        const { error } = await query;
        if (error) {
            alert("Не удалось сохранить: " + error.message);
            return;
        }
        document.getElementById("templateEditor").close();
        void loadTemplates();
    }

    async function deleteTemplate(id) {
        const client = db();
        if (!client || !confirm("Удалить шаблон?")) return;
        const { error } = await client.from("print_label_templates").delete().eq("id", id);
        if (error) { alert("Не удалось удалить: " + error.message); return; }
        void loadTemplates();
    }

    document.addEventListener("DOMContentLoaded", () => {
        document.getElementById("newTemplateBtn").addEventListener("click", () => openEditor(null));
        document.getElementById("cancelTemplateBtn").addEventListener("click", () => document.getElementById("templateEditor").close());
        document.getElementById("saveTemplateBtn").addEventListener("click", saveTemplate);
        document.getElementById("addElementBtn").addEventListener("click", () => {
            editingElements.push({ type: "text", field: "", x_mm: 5, y_mm: 5 });
            selectedIndex = editingElements.length - 1;
            renderCanvas();
        });
        document.getElementById("tplWidth").addEventListener("input", renderCanvas);
        document.getElementById("tplHeight").addEventListener("input", renderCanvas);
        void loadTemplates();
    });
})();
