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

    function elementRowHtml(element, index) {
        const type = element.type || "text";
        const isStatic = Object.prototype.hasOwnProperty.call(element, "literal");
        const extraFields = type === "text"
            ? "<label>Размер шрифта<br><input data-el-field='font_size' type='number' value='" + (element.font_size || 10) + "' style='width:80px;'></label>"
            : type === "barcode"
            ? "<label>Высота, мм<br><input data-el-field='height_mm' type='number' value='" + (element.height_mm || 10) + "' style='width:80px;'></label>"
                + "<label>Тип штрихкода<br><select data-el-field='barcode_type'><option value='code128'" + (element.barcode_type !== "ean13" ? " selected" : "") + ">Code128</option><option value='ean13'" + (element.barcode_type === "ean13" ? " selected" : "") + ">EAN13</option></select></label>"
            : "<label>Ширина, мм<br><input data-el-field='width_mm' type='number' value='" + (element.width_mm || 20) + "' style='width:80px;'></label>";
        return "<div class='card' style='padding:10px;display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;' data-element-row='" + index + "'>"
            + "<label>Тип<br><select data-el-field='type'><option value='text'" + (type === "text" ? " selected" : "") + ">Текст</option><option value='barcode'" + (type === "barcode" ? " selected" : "") + ">Штрихкод</option><option value='qr'" + (type === "qr" ? " selected" : "") + ">QR</option></select></label>"
            + "<label>Источник<br><select data-el-field='source'><option value='field'" + (!isStatic ? " selected" : "") + ">Поле данных</option><option value='literal'" + (isStatic ? " selected" : "") + ">Статический текст</option></select></label>"
            + "<label>" + (isStatic ? "Текст" : "Имя поля") + "<br><input data-el-field='value' type='text' value='" + escapeHtmlLocal(isStatic ? element.literal : (element.field || "")) + "' placeholder='" + (isStatic ? "СКЛАД 1" : "shk") + "'></label>"
            + "<label>X, мм<br><input data-el-field='x_mm' type='number' value='" + (element.x_mm || 0) + "' style='width:70px;'></label>"
            + "<label>Y, мм<br><input data-el-field='y_mm' type='number' value='" + (element.y_mm || 0) + "' style='width:70px;'></label>"
            + extraFields
            + "<button type='button' class='btn btn-outline' data-remove-element='" + index + "'>×</button>"
            + "</div>";
    }

    function renderElements() {
        const wrap = document.getElementById("elementsList");
        wrap.innerHTML = editingElements.map((element, index) => elementRowHtml(element, index)).join("");
        wrap.querySelectorAll("[data-element-row]").forEach((row) => {
            const index = Number(row.dataset.elementRow);
            row.querySelectorAll("[data-el-field]").forEach((input) => {
                input.addEventListener("input", () => {
                    const field = input.dataset.elField;
                    const element = editingElements[index];
                    if (field === "type") {
                        element.type = input.value;
                        renderElements(); // re-render so the type-specific extra inputs swap in
                        return;
                    }
                    if (field === "source") {
                        // Toggling source moves the current value between
                        // .field and .literal, keeping the other key absent
                        // -- print-tspl.js's resolveElementValue() checks
                        // for the *presence* of .literal, not its emptiness.
                        const current = element.literal != null ? element.literal : (element.field || "");
                        if (input.value === "literal") { element.literal = current; delete element.field; }
                        else { element.field = current; delete element.literal; }
                        renderElements();
                        return;
                    }
                    if (field === "value") {
                        if (Object.prototype.hasOwnProperty.call(element, "literal")) element.literal = input.value;
                        else element.field = input.value;
                        return;
                    }
                    element[field] = NUMERIC_FIELDS.indexOf(field) !== -1 ? Number(input.value) : input.value;
                });
            });
        });
        wrap.querySelectorAll("[data-remove-element]").forEach((btn) => {
            btn.addEventListener("click", () => {
                editingElements.splice(Number(btn.dataset.removeElement), 1);
                renderElements();
            });
        });
    }

    function openEditor(template) {
        editingId = template ? template.id : "";
        editingElements = template && Array.isArray(template.elements) ? JSON.parse(JSON.stringify(template.elements)) : [];
        document.getElementById("tplName").value = template ? template.name : "";
        document.getElementById("tplWidth").value = template ? template.width_mm : 50;
        document.getElementById("tplHeight").value = template ? template.height_mm : 50;
        renderElements();
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
            editingElements.push({ type: "text", field: "", x_mm: 0, y_mm: 0 });
            renderElements();
        });
        void loadTemplates();
    });
})();
