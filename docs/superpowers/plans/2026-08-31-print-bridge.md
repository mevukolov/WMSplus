# Мост печати термоэтикеток — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any logged-in WMS+ user print a termolabel (barcode/QR/text mix,
50×50mm) from a website button to a single shared network thermal printer
(TSC DA220), with label layouts stored as editable data and a thin,
never-redeployed relay process on the warehouse LAN doing the actual
printing.

**Architecture:** Two independently-verifiable halves. The **website half**
(this repo) adds two Supabase tables (`print_label_templates`,
`print_jobs`), a pure TSPL-generation module (`print-tspl.js`, testable in
plain Node — no DOM, no Supabase), a template-admin page, and a test-print
page — all following this repo's existing pattern of plain `<script>` tags
and a shared `supabaseClient` from `ui.js`. The **bridge half** is a
standalone Node.js process (new top-level folder `print-bridge/`, not part
of the browser app) that watches `print_jobs` for `status = 'queued'` rows
and relays their `tspl` text as raw bytes to the printer's IP on TCP port
9100. The bridge never parses or understands label content — it is
deliberately dumb so new label types never require touching it.

**Tech Stack:** Vanilla JS (no bundler, no framework — matches
`tasks.js`/`ui.js`), Supabase (Postgres + Realtime + JS client v2, same as
the rest of this repo), plain Node.js (`node:net`, `@supabase/supabase-js`)
for the bridge — no framework there either.

**Spec:** [docs/superpowers/specs/2026-08-31-print-bridge-design.md](../specs/2026-08-31-print-bridge-design.md)

## Global Constraints

- Мост is a single always-on process for the whole site, never per-PC —
  no task in this plan installs anything on an end-user's machine.
- `print-tspl.js` builds the final TSPL text on the **website** side; the
  bridge only relays bytes it's given, it never builds or edits TSPL.
- Label layouts (`elements`) live as data in `print_label_templates`,
  editable through a form-based admin page — no visual/drag-and-drop
  editor in this plan, and no label type may require a code change to add.
- The DA220's actual raw-socket TSPL behavior (port 9100, dots-per-mm,
  label gap) has **never been verified against real hardware** — nobody
  executing this plan from this environment has network access to the
  warehouse LAN. No task may claim to have confirmed real-printer output;
  the final task is an explicit, human-executed, on-site manual step.
- Every JS-touching task ends with `node --check` on the changed file(s)
  passing. Every UI-facing task ends with live browser verification via
  this project's static preview server (`.claude/launch.json`, config
  named `static`).
- Supabase schema changes are SQL files under `supabase/migrations/`,
  named `YYYYMMDDNNNN_description.sql` (this repo's existing convention —
  see e.g. `supabase/migrations/202608280002_prespisok_runs_shk_index.sql`).

---

## File Structure

- **`supabase/migrations/202608310001_print_label_templates.sql`** — new
  table: label layout definitions.
- **`supabase/migrations/202608310002_print_jobs.sql`** — new table: the
  print queue, FK to templates.
- **`print-tspl.js`** — new file, repo root (loaded as a plain `<script>`
  like `task-verdicts.js`). Pure functions: `buildTsplFromTemplate`,
  `mmToDots`, and per-element-type TSPL fragment builders. No DOM, no
  network — this is the one part of this plan that's genuinely unit
  testable, and it gets real tests (via plain `node` scripts, since this
  repo has no test runner).
- **`print_templates_admin.html` / `print_templates_admin.js`** — new
  standalone page: CRUD over `print_label_templates`, following
  `barcode_generator.html`'s page structure (loads `styles.css`, the
  Supabase UMD bundle, `ui.js` for the shared header/session, then its own
  script).
- **`print_test.html` / `print_test.js`** — new standalone page: pick a
  template, fill in field values, print, watch status.
- **`print-bridge/`** — new top-level folder, NOT part of the browser app:
  - `print-bridge/index.js` — the relay process.
  - `print-bridge/package.json` — its own tiny `package.json`
    (`@supabase/supabase-js` as the only dependency; `node:net` is
    built-in).
  - `print-bridge/.env.example` — documents the 3 required env vars
    (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PRINTER_IP`).
  - `print-bridge/README.md` — deployment instructions for the warehouse
    machine (what Node version, how to run it as a persistent service,
    where the printer IP comes from).

---

### Task 1: `print_label_templates` migration

**Files:**
- Create: `supabase/migrations/202608310001_print_label_templates.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `print_label_templates(id, name, width_mm, height_mm, elements, created_at, updated_at)`, used by Task 4 (admin page) and Task 5 (test page).

- [ ] **Step 1: Write the migration**

```sql
-- 202608310001_print_label_templates.sql
-- Label layouts as data, editable via the admin page (Task 4), so a new
-- label type never requires touching print-tspl.js or the bridge.
create table public.print_label_templates (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    width_mm numeric not null default 50,
    height_mm numeric not null default 50,
    -- Array of {type, field|literal, x_mm, y_mm, width_mm?, height_mm?,
    -- font_size?, barcode_type?} -- see print-tspl.js (Task 3) for the
    -- exact shape each element type reads.
    elements jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.print_label_templates enable row level security;

-- Every logged-in WMS+ user can read/manage templates -- this app has no
-- role system for this feature (see spec's "Явно не входит" section), it
-- authenticates via a custom RPC (auth.js) rather than Supabase Auth, so
-- policies here match this repo's existing pattern of anon-key + open
-- policies gated only by the app's own login screen.
create policy "print_label_templates_all" on public.print_label_templates
    for all using (true) with check (true);
```

- [ ] **Step 2: Apply it**

Run: `supabase db push --linked` (or however this repo's migrations are normally applied -- check for a project script first; if none, `supabase migration up --linked` from the project root).
Expected: migration applies without error; `supabase db query --linked "select count(*) from print_label_templates;"` returns `0`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202608310001_print_label_templates.sql
git commit -m "Add print_label_templates table"
```

---

### Task 2: `print_jobs` migration

**Files:**
- Create: `supabase/migrations/202608310002_print_jobs.sql`

**Interfaces:**
- Consumes: `print_label_templates.id` (Task 1).
- Produces: table `print_jobs(id, template_id, data, tspl, status, error_message, created_at, created_by, printed_at)`, used by Task 5 (test page, inserts) and Task 7 (bridge, updates).

- [ ] **Step 1: Write the migration**

```sql
-- 202608310002_print_jobs.sql
create table public.print_jobs (
    id uuid primary key default gen_random_uuid(),
    template_id uuid not null references public.print_label_templates(id),
    data jsonb not null default '{}'::jsonb,
    -- Already-built TSPL text -- the website builds this (print-tspl.js,
    -- Task 3), the bridge (Task 6/7) only ever relays it as raw bytes.
    tspl text not null,
    status text not null default 'queued' check (status in ('queued', 'printed', 'failed')),
    error_message text,
    created_at timestamptz not null default now(),
    created_by text,
    printed_at timestamptz
);

create index print_jobs_status_idx on public.print_jobs (status, created_at)
    where status = 'queued';

alter table public.print_jobs enable row level security;

-- Same open-policy pattern as print_label_templates (Task 1) -- gated by
-- the app's own login, not Supabase Auth/RLS roles.
create policy "print_jobs_all" on public.print_jobs
    for all using (true) with check (true);

-- Supabase Realtime: the test page (Task 5) subscribes to status changes
-- on the row it just inserted.
alter publication supabase_realtime add table public.print_jobs;
```

- [ ] **Step 2: Apply it**

Run: `supabase db push --linked`.
Expected: migration applies without error; `supabase db query --linked "select column_name from information_schema.columns where table_name='print_jobs';"` lists all 9 columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202608310002_print_jobs.sql
git commit -m "Add print_jobs queue table"
```

---

### Task 3: `print-tspl.js` — TSPL builder module (with real tests)

**Files:**
- Create: `print-tspl.js`
- Create: `print-tspl.test.js` (a plain Node script, run directly with `node print-tspl.test.js` -- this repo has no test runner installed, so this is a hand-rolled assert-based script, not a framework file)

**Interfaces:**
- Consumes: nothing (pure functions, no DOM/network).
- Produces: `buildTsplFromTemplate(template, data)` — `template` is a row shape from `print_label_templates` (`{width_mm, height_mm, elements}`), `data` is a flat object of field values (`{shk: "123456"}`). Returns a TSPL command string. Used by Task 5 (test page) and, per the spec, any future page (разбор/предсписок) that adds printing later.

This module is the one part of this plan with no browser/Supabase
dependency, so it gets real automated tests, matching this repo's
established preference for TDD wherever the code is actually testable.

**Background on TSPL** (TSC's command language, stable across their
printer line): labels are addressed in **dots**, not mm — dots-per-mm
depends on the printer's DPI. `SIZE`/`GAP` set the label dimensions,
`CLS` clears the buffer, `TEXT`/`BARCODE`/`QRCODE` place content, `PRINT`
fires the label. The exact DPI for this specific DA220 unit is one of the
two things the spec flags as unverified — `PRINTER_DPI` below is a
documented default, not a claim it's confirmed; Task 8's on-site check is
where it gets corrected if wrong.

- [ ] **Step 1: Write the module**

```js
// print-tspl.js — builds TSPL2 command text from a label template + field
// values. Pure, no DOM/network, loaded as a plain global-scope <script>
// like task-verdicts.js. The print bridge (print-bridge/) never runs this
// file — it only ever relays the string this produces.

// TSC desktop-class printers (DA-series included) are commonly 203dpi.
// Not confirmed against this specific unit -- see Task 8 of
// docs/superpowers/plans/2026-08-31-print-bridge.md. If labels come out
// the wrong size/position on real hardware, this is the first constant
// to check.
const PRINTER_DPI = 203;
const DOTS_PER_MM = PRINTER_DPI / 25.4;

function mmToDots(mm) {
    return Math.round(Number(mm || 0) * DOTS_PER_MM);
}

function tsplEscape(value) {
    // TSPL string literals are double-quoted; escape embedded quotes and
    // strip control characters that would break the command line.
    return String(value == null ? "" : value)
        .replace(/["\\]/g, "")
        .replace(/[\r\n]/g, " ");
}

function resolveElementValue(element, data) {
    if (Object.prototype.hasOwnProperty.call(element, "literal")) return element.literal;
    return (data && data[element.field] != null) ? data[element.field] : "";
}

function textCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const value = tsplEscape(resolveElementValue(element, data));
    // Built-in font "3" (a mid-size bitmap font); font_size scales it via
    // the x/y multiplier args (TSPL takes integer multipliers, not a
    // point size) -- font_size 10 -> multiplier 1, roughly doubling per
    // +10, clamped to TSPL's 1-10 multiplier range.
    const mult = Math.min(10, Math.max(1, Math.round((Number(element.font_size) || 10) / 10)));
    return `TEXT ${x},${y},"3",0,${mult},${mult},"${value}"`;
}

function barcodeCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const height = mmToDots(element.height_mm || 10);
    const value = tsplEscape(resolveElementValue(element, data));
    const type = element.barcode_type === "ean13" ? "EAN13" : "128";
    // human-readable line under the barcode (1) -- useful on a warehouse
    // floor where someone may need to read it without a scanner.
    return `BARCODE ${x},${y},"${type}",${height},1,0,2,2,"${value}"`;
}

function qrCommand(element, data) {
    const x = mmToDots(element.x_mm);
    const y = mmToDots(element.y_mm);
    const value = tsplEscape(resolveElementValue(element, data));
    // ECC level M (medium, TSPL's "M"), cell width from width_mm (a QR
    // "cell" in TSPL is specified as a dot-size integer, not mm directly
    // -- approximate via width_mm / expected module count; a flat default
    // of 4 dots/cell reads reliably at 50mm label size and is adjusted
    // per-template via width_mm if a template needs it denser/looser).
    const cellSize = Math.max(1, Math.round(mmToDots(element.width_mm || 20) / 20));
    return `QRCODE ${x},${y},M,${cellSize},A,0,"${value}"`;
}

function elementCommand(element, data) {
    if (element.type === "text") return textCommand(element, data);
    if (element.type === "barcode") return barcodeCommand(element, data);
    if (element.type === "qr") return qrCommand(element, data);
    throw new Error("print-tspl: unknown element type '" + element.type + "'");
}

function buildTsplFromTemplate(template, data) {
    const widthMm = Number(template.width_mm) || 50;
    const heightMm = Number(template.height_mm) || 50;
    const elements = Array.isArray(template.elements) ? template.elements : [];
    const lines = [
        `SIZE ${widthMm} mm,${heightMm} mm`,
        `GAP 2 mm,0 mm`,
        `CLS`,
        ...elements.map((element) => elementCommand(element, data || {})),
        `PRINT 1,1`,
    ];
    return lines.join("\r\n") + "\r\n";
}

// Plain global-scope exports (this repo has no module system) plus a
// CommonJS export so print-tspl.test.js (Node, no browser) can require it.
if (typeof module !== "undefined" && module.exports) {
    module.exports = { buildTsplFromTemplate, mmToDots, tsplEscape };
}
```

- [ ] **Step 2: Write the test script**

```js
// print-tspl.test.js — run with: node print-tspl.test.js
const assert = require("node:assert");
const { buildTsplFromTemplate, mmToDots, tsplEscape } = require("./print-tspl.js");

function test(name, fn) {
    try {
        fn();
        console.log("PASS " + name);
    } catch (error) {
        console.error("FAIL " + name);
        console.error(error);
        process.exitCode = 1;
    }
}

test("mmToDots converts using 203dpi", () => {
    assert.strictEqual(mmToDots(25.4), 203);
    assert.strictEqual(mmToDots(0), 0);
});

test("tsplEscape strips quotes and newlines", () => {
    assert.strictEqual(tsplEscape('a"b\\c'), "abc");
    assert.strictEqual(tsplEscape("line1\nline2"), "line1 line2");
    assert.strictEqual(tsplEscape(null), "");
});

test("buildTsplFromTemplate emits SIZE/GAP/CLS/PRINT around elements", () => {
    const template = {
        width_mm: 50,
        height_mm: 50,
        elements: [
            { type: "text", field: "title", x_mm: 5, y_mm: 5, font_size: 10 },
        ],
    };
    const tspl = buildTsplFromTemplate(template, { title: "Тест" });
    assert.ok(tspl.startsWith("SIZE 50 mm,50 mm\r\nGAP 2 mm,0 mm\r\nCLS\r\n"));
    assert.ok(tspl.includes('TEXT 40,40,"3",0,1,1,"Тест"'));
    assert.ok(tspl.trim().endsWith("PRINT 1,1"));
});

test("buildTsplFromTemplate resolves literal text over a missing field", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "text", literal: "СКЛАД", x_mm: 0, y_mm: 0 }] };
    const tspl = buildTsplFromTemplate(template, {});
    assert.ok(tspl.includes('"СКЛАД"'));
});

test("buildTsplFromTemplate emits a BARCODE command for type=barcode", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "barcode", field: "shk", x_mm: 5, y_mm: 5, height_mm: 10 }] };
    const tspl = buildTsplFromTemplate(template, { shk: "56515623488" });
    assert.ok(tspl.includes('BARCODE 40,40,"128",80,1,0,2,2,"56515623488"'));
});

test("buildTsplFromTemplate emits a QRCODE command for type=qr", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "qr", field: "url", x_mm: 5, y_mm: 5, width_mm: 20 }] };
    const tspl = buildTsplFromTemplate(template, { url: "https://example.com" });
    assert.ok(tspl.includes('QRCODE 40,40,M,4,A,0,"https://example.com"'));
});

test("buildTsplFromTemplate throws on an unknown element type", () => {
    const template = { width_mm: 50, height_mm: 50, elements: [{ type: "bogus", x_mm: 0, y_mm: 0 }] };
    assert.throws(() => buildTsplFromTemplate(template, {}), /unknown element type/);
});

if (process.exitCode) {
    console.error("Some tests failed.");
} else {
    console.log("All print-tspl.js tests passed.");
}
```

- [ ] **Step 3: Run the tests, verify they pass**

Run: `node print-tspl.test.js`
Expected: seven `PASS` lines, then `All print-tspl.js tests passed.`, exit code 0.

- [ ] **Step 4: Syntax-check for browser loading too**

Run: `node --check print-tspl.js`
Expected: no output (passes). This confirms the file is also valid as a plain `<script src="print-tspl.js">` include (Task 4/5 will add that tag) even though Step 3 exercised it via `require()`.

- [ ] **Step 5: Commit**

```bash
git add print-tspl.js print-tspl.test.js
git commit -m "Add print-tspl.js TSPL builder with tests"
```

---

### Task 4: Template admin page

**Files:**
- Create: `print_templates_admin.html`
- Create: `print_templates_admin.js`

**Interfaces:**
- Consumes: `print_label_templates` table (Task 1), the shared `supabaseClient` global that `ui.js` sets up (see `ui.js:71-83` — every existing standalone page like `barcode_generator.html` relies on this same pattern, not a page-local client).
- Produces: rows in `print_label_templates` that Task 5 (test page) and Task 3's `buildTsplFromTemplate` (already built) can consume.

- [ ] **Step 1: Write the HTML shell**

Follow `barcode_generator.html`'s exact head/header structure (checked: `barcode_generator.html:1-30`) — same stylesheet, same Supabase UMD script, same `ui.js`, same header/sidebar markup, so the page inherits the existing session/login/logout chrome for free.

```html
<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8" />
    <title>WMS+ — Шаблоны этикеток</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />

    <link rel="stylesheet" href="styles.css">
    <link rel="icon" href="https://raw.githubusercontent.com/mevukolov/WMSplus/refs/heads/main/icons/wms_icon.ico" type="image/x-icon">

    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="ui.js" defer></script>
    <script src="print_templates_admin.js" defer></script>
</head>

<body>
<div id="menu-overlay" class="menu-overlay"></div>

<header class="header">
    <button class="btn btn-round header-btn" id="menu-btn">☰</button>
    <span class="header-title">Шаблоны этикеток</span>
    <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
        <span id="user-name-small" class="user-name" aria-hidden="true"></span>
        <button class="btn btn-round header-btn" id="logout-btn">⎋</button>
    </div>
</header>

<div id="sidebar" class="sidebar">
    <div class="sidebar-content"></div>
</div>

<main style="max-width:820px;margin:24px auto;padding:0 16px;">
    <section style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2 style="margin:0;">Шаблоны этикеток</h2>
        <button id="newTemplateBtn" class="btn btn-outline" type="button">+ Новый шаблон</button>
    </section>
    <div id="templateList"></div>

    <dialog id="templateEditor" style="width:min(680px,92vw);border-radius:16px;border:1px solid #e2e8f0;padding:0;">
        <form method="dialog" style="padding:20px;display:flex;flex-direction:column;gap:12px;" id="templateForm">
            <label>Название<br><input id="tplName" type="text" required style="width:100%;"></label>
            <div style="display:flex;gap:12px;">
                <label style="flex:1;">Ширина, мм<br><input id="tplWidth" type="number" value="50" required style="width:100%;"></label>
                <label style="flex:1;">Высота, мм<br><input id="tplHeight" type="number" value="50" required style="width:100%;"></label>
            </div>
            <div>
                <strong>Элементы</strong>
                <div id="elementsList" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;"></div>
                <button id="addElementBtn" type="button" class="btn btn-outline" style="margin-top:8px;">+ Элемент</button>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
                <button id="cancelTemplateBtn" type="button" class="btn btn-outline">Отмена</button>
                <button id="saveTemplateBtn" type="button" class="btn btn-rect">Сохранить</button>
            </div>
        </form>
    </dialog>
</main>
</body>
</html>
```

- [ ] **Step 2: Write the page script**

```js
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
```

- [ ] **Step 3: Syntax-check**

Run: `node --check print_templates_admin.js`
Expected: no output.

- [ ] **Step 4: Live-verify in browser**

Start the project's static preview server (`preview_start` with config `static`), open `print_templates_admin.html`. Log in with a real WMS+ account (same as every other page). Click "+ Новый шаблон", add one `text` element with source "Поле данных", field `shk`, `x_mm=5, y_mm=5, font_size=10`, save. Confirm: the new template appears in the list with "1 элементов"; `supabase db query --linked "select name, elements from print_label_templates order by created_at desc limit 1;"` shows a row whose `elements` jsonb has `field: "shk"` (not `literal`). Edit it, add a second element of type `barcode` with field `shk`, `height_mm=10`, `barcode_type=code128`, and a third element of type `text` with source switched to "Статический текст" and value `СКЛАД`, save again — confirm the list shows "3 элементов" and the DB query shows one element with a `literal` key instead of `field`. Delete the template — confirm it disappears from both the list and the database query.

- [ ] **Step 5: Commit**

```bash
git add print_templates_admin.html print_templates_admin.js
git commit -m "Add label template admin page"
```

---

### Task 5: Test print page

**Files:**
- Create: `print_test.html`
- Create: `print_test.js`

**Interfaces:**
- Consumes: `print_label_templates` (Task 1), `buildTsplFromTemplate` from `print-tspl.js` (Task 3), `print_jobs` table (Task 2), shared `supabaseClient` (as in Task 4).
- Produces: rows in `print_jobs` with `status = 'queued'` and a real `tspl` string — this is the end of what's verifiable without the bridge (Task 6/7) existing.

- [ ] **Step 1: Write the HTML shell**

Same head/header pattern as Task 4's `print_templates_admin.html`, but also loads `print-tspl.js` before the page script:

```html
<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8" />
    <title>WMS+ — Тест печати</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />

    <link rel="stylesheet" href="styles.css">
    <link rel="icon" href="https://raw.githubusercontent.com/mevukolov/WMSplus/refs/heads/main/icons/wms_icon.ico" type="image/x-icon">

    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="ui.js" defer></script>
    <script src="print-tspl.js" defer></script>
    <script src="print_test.js" defer></script>
</head>

<body>
<div id="menu-overlay" class="menu-overlay"></div>

<header class="header">
    <button class="btn btn-round header-btn" id="menu-btn">☰</button>
    <span class="header-title">Тест печати</span>
    <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
        <span id="user-name-small" class="user-name" aria-hidden="true"></span>
        <button class="btn btn-round header-btn" id="logout-btn">⎋</button>
    </div>
</header>

<div id="sidebar" class="sidebar">
    <div class="sidebar-content"></div>
</div>

<main style="max-width:520px;margin:24px auto;padding:0 16px;">
    <label>Шаблон<br><select id="templateSelect" style="width:100%;"></select></label>
    <div id="fieldInputs" style="display:flex;flex-direction:column;gap:10px;margin:16px 0;"></div>
    <button id="printBtn" class="btn btn-rect" type="button" disabled>Печать</button>
    <p id="printStatus" style="margin-top:12px;"></p>
</main>
</body>
</html>
```

- [ ] **Step 2: Write the page script**

```js
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
```

- [ ] **Step 3: Syntax-check**

Run: `node --check print_test.js`
Expected: no output.

- [ ] **Step 4: Live-verify in browser (no printer/bridge needed yet)**

Via the static preview server, open `print_test.html`, select the template created in Task 4's verification, fill in its field(s), click "Печать". Confirm: status shows "В очереди, жду принтер…" and stays there (expected — no bridge exists yet to pick it up). Confirm via `supabase db query --linked "select status, tspl from print_jobs order by created_at desc limit 1;"` that a row exists with `status = 'queued'` and `tspl` containing the exact text you typed into the field, wrapped in the `SIZE`/`GAP`/`CLS`/`TEXT`.../`PRINT` structure from Task 3.

- [ ] **Step 5: Commit**

```bash
git add print_test.html print_test.js
git commit -m "Add test print page (queues jobs, no bridge yet)"
```

---

### Task 6: Print bridge — project skeleton + job subscription

**Files:**
- Create: `print-bridge/package.json`
- Create: `print-bridge/.env.example`
- Create: `print-bridge/index.js`

**Interfaces:**
- Consumes: `print_jobs` table (Task 2, via Supabase Realtime).
- Produces: a running process that logs every `queued` job it sees (printing itself is Task 7 — this task only proves the subscription side works).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "wmsplus-print-bridge",
  "version": "1.0.0",
  "private": true,
  "description": "Relays queued WMS+ print_jobs rows to the warehouse's network thermal printer. One instance, always-on, on the warehouse LAN.",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0"
  }
}
```

- [ ] **Step 2: Write `.env.example`**

```
# Copy to .env and fill in before running. Never commit the real .env.
SUPABASE_URL=https://bgphllmzmlwurfnbagho.supabase.co
SUPABASE_SERVICE_KEY=
PRINTER_IP=
PRINTER_PORT=9100
```

- [ ] **Step 3: Write the subscription skeleton**

```js
// print-bridge/index.js — one always-on process, warehouse LAN.
// Watches print_jobs for status='queued' rows and relays their tspl text
// to the printer. Never parses or builds label content -- print-tspl.js
// (in the main repo, browser side) already did that.
"use strict";
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PRINTER_IP = process.env.PRINTER_IP;
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PRINTER_IP) {
    console.error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, PRINTER_IP. See .env.example.");
    process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function handleQueuedJob(job) {
    console.log("[print-bridge] queued job seen:", job.id, "tspl length:", (job.tspl || "").length);
    // Task 7 replaces this line with the actual TCP send + status update.
}

async function pollOnce() {
    const { data, error } = await client
        .from("print_jobs")
        .select("id,tspl")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(10);
    if (error) {
        console.error("[print-bridge] poll failed:", error.message);
        return;
    }
    for (const job of data || []) {
        await handleQueuedJob(job);
    }
}

function startRealtimeSubscription() {
    client
        .channel("print_jobs_queue")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "print_jobs", filter: "status=eq.queued" }, (payload) => {
            void handleQueuedJob(payload.new);
        })
        .subscribe((status) => {
            console.log("[print-bridge] realtime subscription status:", status);
        });
}

console.log("[print-bridge] starting, printer target:", PRINTER_IP + ":" + PRINTER_PORT);
void pollOnce(); // catch anything queued before this process started
startRealtimeSubscription();
// Safety net: Realtime can drop silently on network blips (this repo's
// own tasks.js has hit this class of issue before with WB CDN photo
// loads) -- a slow poll alongside the subscription means a queued job
// never waits forever even if the socket dies quietly.
setInterval(() => { void pollOnce(); }, 30000);
```

- [ ] **Step 4: Add `dotenv` dependency**

```bash
cd print-bridge
npm install dotenv
cd ..
```

Run: `node --check print-bridge/index.js`
Expected: no output.

- [ ] **Step 5: Manual smoke test (no real printer needed for this step)**

This step needs a real Supabase service-role key, which you'll need to generate from the Supabase dashboard (Project Settings → API → service_role key) and put in `print-bridge/.env` — never commit this file (add `print-bridge/.env` to `.gitignore` if not already covered by a top-level `.env` pattern; check first). Run `cd print-bridge && node index.js`, leave it running. From another terminal, insert a test row directly: `supabase db query --linked "insert into print_jobs (template_id, data, tspl) select id, '{}'::jsonb, 'TEST' from print_label_templates limit 1;"`. Confirm the bridge process logs `queued job seen: <id> tspl length: 4` within a few seconds (Realtime) or within 30s (poll fallback). Stop the process (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
cd print-bridge
git add package.json package-lock.json .env.example index.js
cd ..
git status --short print-bridge/  # confirm .env itself is NOT staged
git commit -m "Add print bridge skeleton with job subscription"
```

---

### Task 7: Print bridge — TCP send + status writeback

**Files:**
- Modify: `print-bridge/index.js`

**Interfaces:**
- Consumes: `PRINTER_IP`/`PRINTER_PORT` (Task 6), `print_jobs.status`/`error_message`/`printed_at` (Task 2).
- Produces: the bridge's actual printing behavior — this is the last piece of code in this plan; Task 8 is a manual on-site check, not code.

- [ ] **Step 1: Replace `handleQueuedJob` with the real TCP send**

Find `handleQueuedJob` (Task 6's version, the one-line `console.log` placeholder) and replace it with:

```js
const net = require("node:net");

function sendToPrinter(tspl) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: PRINTER_IP, port: PRINTER_PORT }, () => {
            socket.write(tspl, "utf8", () => {
                socket.end();
            });
        });
        socket.setTimeout(10000);
        socket.on("timeout", () => {
            socket.destroy();
            reject(new Error("Таймаут соединения с принтером (" + PRINTER_IP + ":" + PRINTER_PORT + ")"));
        });
        socket.on("error", (error) => {
            reject(new Error("Ошибка соединения с принтером: " + error.message));
        });
        socket.on("close", (hadError) => {
            if (!hadError) resolve();
        });
    });
}

async function handleQueuedJob(job) {
    console.log("[print-bridge] printing job:", job.id);
    try {
        await sendToPrinter(job.tspl);
        const { error } = await client
            .from("print_jobs")
            .update({ status: "printed", printed_at: new Date().toISOString() })
            .eq("id", job.id)
            .eq("status", "queued"); // avoid double-printing if both the realtime handler and the poll loop see the same job
        if (error) console.error("[print-bridge] failed to mark job printed:", job.id, error.message);
        else console.log("[print-bridge] job printed:", job.id);
    } catch (error) {
        console.error("[print-bridge] print failed:", job.id, error.message);
        await client
            .from("print_jobs")
            .update({ status: "failed", error_message: error.message })
            .eq("id", job.id)
            .eq("status", "queued");
    }
}
```

Also update the `select` in `pollOnce()` to include `tspl` (it already does, per Task 6's code — confirm before moving on).

- [ ] **Step 2: Syntax-check**

Run: `node --check print-bridge/index.js`
Expected: no output.

- [ ] **Step 3: Manual smoke test against a fake TCP listener (still no real printer)**

In one terminal, start a throwaway TCP listener standing in for the printer: `node -e "require('net').createServer(s => { let buf=''; s.on('data', d => buf += d); s.on('end', () => { console.log('RECEIVED:', JSON.stringify(buf)); }); }).listen(9100, () => console.log('fake printer listening on 9100'));"`. In `print-bridge/.env`, set `PRINTER_IP=127.0.0.1`. Start the bridge (`node index.js`). Insert a test job as in Task 6 Step 5 but with real TSPL text this time (e.g. via the actual test page from Task 5, logged in as yourself, print one real label). Confirm: the fake-printer terminal prints `RECEIVED: "SIZE 50 mm,50 mm\r\nGAP 2 mm,0 mm\r\nCLS\r\n..."` matching what the test page sent; `supabase db query --linked "select status, printed_at from print_jobs order by created_at desc limit 1;"` shows `status = printed` with a `printed_at` timestamp; the test page itself (still open in the browser from Task 5's verification) flips to "Напечатано ✓" via the Realtime subscription.

Also confirm the failure path once: stop the fake-printer listener, submit another test print, confirm the bridge logs a connection error, the job's `status` becomes `failed` with a real `error_message`, and the test page shows "Ошибка: …".

- [ ] **Step 4: Commit**

```bash
cd print-bridge
git add index.js
cd ..
git commit -m "Print bridge: send TSPL to the printer over TCP, write back status"
```

---

### Task 8: On-site verification against the real DA220 (manual, human-executed)

**Files:** none — this task produces no code. It exists because the spec
explicitly flags the DA220's real raw-socket TSPL behavior as unverified,
and nobody executing this plan from this environment has network access
to the warehouse LAN to check it. **Do not mark this task done by
reasoning about it — it requires physically being on the same network as
the printer.**

**Interfaces:** none.

- [ ] **Step 1: Find the printer's IP and confirm it's reachable**

On the warehouse network, find the DA220's IP (its own network config
page, or the router's DHCP client list). From a machine on that same
network: `ping <printer_ip>` succeeds, and `nc -vz <printer_ip> 9100` (or
`Test-NetConnection <printer_ip> -Port 9100` on Windows) reports the port
open. If the port doesn't respond, this specific model may need a
different port/protocol than assumed in this plan (LPD/515, IPP/631, or a
vendor-specific port) — check the printer's own network settings page or
manual before continuing; this would mean revisiting `print-bridge/index.js`'s
`PRINTER_PORT`, not the TSPL content itself.

- [ ] **Step 2: Send one hand-written TSPL string directly, bypassing the app entirely**

This isolates "does the printer understand TSPL over a raw socket at all"
from "does our app's generated TSPL happen to be correct" — test the
simpler question first.

```bash
printf 'SIZE 50 mm,50 mm\r\nGAP 2 mm,0 mm\r\nCLS\r\nTEXT 40,40,"3",0,1,1,"HELLO"\r\nPRINT 1,1\r\n' | nc <printer_ip> 9100
```

(On Windows without `nc`, TSC's own "Diagnostic Tool" utility, if
installed, has a raw "Send Command" feature that accepts the same text.)

Expected: a label physically prints with "HELLO" on it, roughly centered,
at a legible size. If nothing prints, or the printer errors/blinks a
fault light, this confirms the printer needs a different setup (check its
own configuration menu for "TSPL emulation mode" — some TSC units ship in
a different default command-language mode and need switching) before the
bridge can work as designed.

- [ ] **Step 2a: If the label prints but looks wrong, adjust and note the fix**

Two things this plan explicitly flagged as assumptions to correct here:

- **Position/size wrong** → `PRINTER_DPI` in `print-tspl.js` (Task 3,
  currently `203`) doesn't match this unit. Common alternative: `300`.
  Update the constant, re-run `node print-tspl.test.js` to confirm the
  existing tests still pass (they test relative structure, not exact dot
  values, so they should), then redo Step 2's manual test to confirm the
  new value looks right physically.
- **Label boundaries wrong / extra blank label ejected** → the `GAP 2
  mm,0 mm` in `buildTsplFromTemplate` (Task 3) doesn't match this label
  stock's actual gap. Check the label roll's spec sheet or measure the
  gap between labels with a ruler, update the constant in
  `print-tspl.js`.

If either needs changing, commit the fix:

```bash
git add print-tspl.js
git commit -m "Correct PRINTER_DPI/label gap after on-site DA220 verification"
```

- [ ] **Step 3: End-to-end test through the real app**

With `print-bridge/.env`'s `PRINTER_IP` set to the real printer's IP
(not the Task 7 fake listener), start the bridge on the machine you intend
to leave running (`node index.js`, or set it up as a persistent service —
see Step 4). From any other machine on the network (or off it entirely,
since the browser side only talks to Supabase, not the printer directly),
open `print_test.html`, pick the template created in Task 4, fill in a
real value, click "Печать". Confirm: a real label physically prints, and
the page shows "Напечатано ✓" within a few seconds.

- [ ] **Step 4: Set up the bridge as a persistent service**

Pick whichever the target machine already has available (don't install a
new service manager just for this): `pm2` if Node tooling is already
present, a `systemd` unit if it's Linux, Task Scheduler "run at startup"
if it's Windows, or `nohup node index.js &` with a reboot cron entry as
the simplest fallback. Document whichever was actually used in
`print-bridge/README.md`:

```markdown
# print-bridge

Relays WMS+ print jobs to the warehouse's network thermal printer.
Runs as **one instance**, on one always-on machine on the warehouse LAN
— never install this per-PC.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env`, fill in `SUPABASE_SERVICE_KEY` (Supabase
   dashboard → Project Settings → API → service_role key) and `PRINTER_IP`
   (the DA220's IP on the warehouse network).
3. `node index.js` to run in the foreground, or set up as a persistent
   service — see "Running persistently" below.

## Running persistently

<!-- filled in during Task 8 with whatever mechanism was actually used -->

## Printer protocol notes

Confirmed working: raw TSPL over TCP port 9100.
PRINTER_DPI (in the main repo's print-tspl.js): <value confirmed on-site>.
Label gap: <value confirmed on-site>.
```

- [ ] **Step 5: Commit the README**

```bash
cd print-bridge
git add README.md
cd ..
git commit -m "Document print bridge on-site deployment"
```
