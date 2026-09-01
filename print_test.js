// print_test.js — pick a template, fill its fields, print, watch status.
(function () {
    "use strict";

    let templates = [];
    let selectedTemplate = null;

    function db() { return window.supabaseClient || null; }

    function fieldsOf(template) {
        return (template.elements || [])
            .filter((element) => element.field)
            .map((element) => element.field)
            .filter((field, index, all) => all.indexOf(field) === index);
    }

    function renderFieldInputs() {
        const wrap = document.getElementById("fieldInputs");
        if (!selectedTemplate) { wrap.innerHTML = ""; return; }
        const fields = fieldsOf(selectedTemplate);
        wrap.innerHTML = fields.map((field) => (
            "<label>" + field + "<br><input data-field='" + field + "' type='text' style='width:100%;'></label>"
        )).join("") || "<p style='color:#64748b;'>У этого шаблона нет полей для заполнения.</p>";
        document.getElementById("printBtn").disabled = false;
    }

    async function loadTemplates() {
        const client = db();
        const select = document.getElementById("templateSelect");
        if (!client || !select) return;
        const { data, error } = await client
            .from("print_label_templates")
            .select("id,name,width_mm,height_mm,elements")
            .order("name", { ascending: true });
        if (error) {
            document.getElementById("printStatus").textContent = "Не удалось загрузить шаблоны: " + error.message;
            return;
        }
        templates = data || [];
        select.innerHTML = templates.map((template) => "<option value='" + template.id + "'>" + template.name + "</option>").join("");
        selectedTemplate = templates[0] || null;
        renderFieldInputs();
    }

    function collectFieldData() {
        const data = {};
        document.querySelectorAll("#fieldInputs [data-field]").forEach((input) => {
            data[input.dataset.field] = input.value;
        });
        return data;
    }

    async function submitPrint() {
        const client = db();
        const status = document.getElementById("printStatus");
        if (!client || !selectedTemplate) return;
        const data = collectFieldData();
        const tspl = buildTsplFromTemplate(selectedTemplate, data);
        status.textContent = "Отправляю в очередь…";
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        const { data: job, error } = await client
            .from("print_jobs")
            .insert({ template_id: selectedTemplate.id, data, tspl, created_by: user.id || user.name || null })
            .select("id,status")
            .single();
        if (error) {
            status.textContent = "Ошибка постановки в очередь: " + error.message;
            return;
        }
        status.textContent = "В очереди, жду принтер…";
        watchJob(job.id);
    }

    function watchJob(jobId) {
        const client = db();
        const status = document.getElementById("printStatus");
        const channel = client
            .channel("print_job_" + jobId)
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "print_jobs", filter: "id=eq." + jobId }, (payload) => {
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
        document.getElementById("templateSelect").addEventListener("change", (event) => {
            selectedTemplate = templates.find((template) => template.id === event.target.value) || null;
            renderFieldInputs();
        });
        document.getElementById("printBtn").addEventListener("click", submitPrint);
        void loadTemplates();
    });
})();
