# Флоу Phase 2, Part 1: Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Флоу's two-named-role shift model (`incoming_employee_id`/`outgoing_employee_id`) with a per-employee roster (any number of people, each covering any number of the 14 existing участки/sections), and generalize Флоу's zone-scoring/default-assignee logic to use it.

**Architecture:** A new `wms_shifts.roster jsonb` column holds `[{employee_id, full_name, zones: [...]}]`. A single pure function, `normalizeShiftRoster(shift)`, is the one place old two-field shifts get read as an equivalent roster — every other function (scoring, UI, default-assignee) only ever reads `state.shift.current.roster`, never the two old fields directly. The shift-opening modal's two `<select>` elements are replaced with a repeatable "person + zone checkboxes" editor. Zone names are exactly the 14 strings already in `REVIEW_SECTIONS`/`REQUEST_SECTIONS` — no new vocabulary.

**Tech Stack:** Single-file vanilla JS (`tasks.js`, ~15k lines) + `tasks.html` + `task-verdicts.js`, Supabase (Postgres + PostgREST client, no ORM), no build step, no test framework. This repo's actual test method is manual browser verification — every JS task ends with `node --check tasks.js` plus a live check in the browser, exactly as the Флоу Phase 1 plan (`docs/superpowers/plans/2026-08-31-flow-phase1-engine-ux.md`) did.

**Spec:** `docs/superpowers/specs/2026-09-02-flow-phase2-roster-design.md`

## Global Constraints

- Must not break the classic (non-Флоу) разбор flow for any user — this is the standing hard constraint carried over from Phase 1's entire execution.
- Must not touch `flowScoreTask`'s actual weight formula/weights — only how "is this the user's own zone" gets determined.
- Must not migrate or delete `wms_shifts.incoming_employee_id`/`outgoing_employee_id`/`incoming_process`/`outgoing_process` — they stay in the schema, just stop being written for new/updated shifts.
- Must not touch the server-side dispatcher, the QA screen, or the personal-coefficient formula — those are separate Phase 2 sub-projects with their own future specs/plans.
- Флоу itself stays gated to `FLOW_ALLOWED_USER_IDS` throughout this plan — nothing here touches that gate.
- No automated test suite exists or should be added — verification is `node --check` plus manual browser checks, per this repo's established convention.

---

## File Structure

- **Modify `tasks.js`**: state shape (`state.shift`), shift loading/saving (`loadShiftState`, `openShiftOpeningModal`, `saveShiftOpening`, `updateShiftOpeningForm`), a new `normalizeShiftRoster`/roster-editor function group, and the zone-scoring functions (`currentFlowEmployee`, `flowTaskZoneKey`, `flowTaskZoneLabel`, `flowZonePolicy`, `flowZoneCounts`, `flowZoneMultiplier`, `shiftAssigneeForZone`).
- **Modify `tasks.html`**: the `#shiftOpeningModal` markup (replace the two `<select>`s with a roster editor) and its CSS (`.shift-form-grid` and new roster-row styles).
- **Create `supabase/migrations/202609020001_wms_shifts_roster.sql`**: adds the `roster` column.

No new files beyond the migration — this stays inside the existing single-file-client pattern this codebase already uses everywhere else in Флоу.

---

## Task 1: Add the `roster` column and the one place old shifts get read as one

**Files:**
- Create: `supabase/migrations/202609020001_wms_shifts_roster.sql`
- Modify: `tasks.js:1668-1677` (near `employeeById`/`employeeNameById`) — add `normalizeShiftRoster`
- Modify: `tasks.js:1715-1740` (`loadShiftState`) — populate `state.shift.current.roster` via `normalizeShiftRoster`

**Interfaces:**
- Produces: `normalizeShiftRoster(shift)` → `Array<{employee_id: string, full_name: string, zones: string[]}>`. Every later task reads roster data exclusively through `shift.roster` after this normalization has run — never `shift.incoming_employee_id`/`shift.outgoing_employee_id` directly.
- Consumes: `REVIEW_SECTIONS`, `REQUEST_SECTIONS` (existing constants, `tasks.js:428-445`), `employeeNameById` (existing, `tasks.js:1673-1676`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202609020001_wms_shifts_roster.sql`:

```sql
-- Флоу Phase 2 (roster): per-employee zone list, replacing the old
-- two-named-role model. incoming_employee_id/outgoing_employee_id stay in
-- the schema untouched (may be relied on by reporting outside this repo)
-- -- they just stop being written for shifts saved after this migration.
alter table public.wms_shifts
  add column if not exists roster jsonb not null default '[]'::jsonb;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push --linked` from the repo root (`/Users/WBwork/Downloads/WMSplus-main`).
Expected: migration applies cleanly (it's purely additive — `add column if not exists`, safe to run even if partially applied before).

- [ ] **Step 3: Verify the column exists**

Run: `supabase db query --linked "select column_name, data_type, column_default from information_schema.columns where table_name = 'wms_shifts' and column_name = 'roster';"`
Expected: one row, `data_type = jsonb`, `column_default` containing `'[]'::jsonb`.

- [ ] **Step 4: Add `normalizeShiftRoster`**

In `tasks.js`, right after `employeeNameById` (currently ends at line 1676, immediately before `function renderShiftGate()`), add:

```javascript
    // The one place old two-named-role shifts (incoming_employee_id/
    // outgoing_employee_id, no real `roster`) get read as an equivalent
    // roster. Everything else in this file reads shift.roster only --
    // never the two old fields directly -- so this is the single point
    // that has to change if the old-shift compatibility mapping ever
    // needs adjusting. The old model treated "Запросы входящего потока"
    // and "Коробки на входе" as the incoming person's zones (see the old
    // FLOW_STRICT_INCOMING_SECTIONS set) and everything else as the
    // outgoing person's -- this reproduces that split exactly, so a shift
    // opened before this change scores identically to before.
    function normalizeShiftRoster(shift) {
        if (!shift) return [];
        if (Array.isArray(shift.roster) && shift.roster.length) {
            return shift.roster.map((entry) => ({
                employee_id: normalizeIdentifier(entry && entry.employee_id),
                full_name: normalizeText(entry && entry.full_name),
                zones: Array.isArray(entry && entry.zones) ? entry.zones.filter(Boolean) : [],
            })).filter((entry) => entry.employee_id);
        }
        const roster = [];
        const incomingId = normalizeIdentifier(shift.incoming_employee_id);
        if (incomingId) {
            roster.push({
                employee_id: incomingId,
                full_name: normalizeText(shift.incoming_name) || employeeNameById(incomingId),
                zones: ["Запросы входящего потока", "Коробки на входе"],
            });
        }
        const outgoingId = normalizeIdentifier(shift.outgoing_employee_id);
        if (outgoingId) {
            const outgoingZones = REVIEW_SECTIONS.concat(["Списания AWH"]);
            const existing = roster.find((entry) => entry.employee_id === outgoingId);
            if (existing) existing.zones = existing.zones.concat(outgoingZones);
            else roster.push({
                employee_id: outgoingId,
                full_name: normalizeText(shift.outgoing_name) || employeeNameById(outgoingId),
                zones: outgoingZones,
            });
        }
        return roster;
    }
```

- [ ] **Step 5: Wire it into `loadShiftState`**

Find this in `loadShiftState` (`tasks.js`, currently lines 1734-1739):

```javascript
                const shift = Array.isArray(shiftsResult.data) && shiftsResult.data.length ? shiftsResult.data[0] : null;
                state.shift.current = shift ? {
                    ...shift,
                    incoming_name: employeeNameById(shift.incoming_employee_id),
                    outgoing_name: employeeNameById(shift.outgoing_employee_id),
                } : null;
```

Replace with:

```javascript
                const shift = Array.isArray(shiftsResult.data) && shiftsResult.data.length ? shiftsResult.data[0] : null;
                state.shift.current = shift ? {
                    ...shift,
                    incoming_name: employeeNameById(shift.incoming_employee_id),
                    outgoing_name: employeeNameById(shift.outgoing_employee_id),
                    roster: normalizeShiftRoster(shift),
                } : null;
```

(`normalizeShiftRoster` must run after `shift.incoming_name`/`outgoing_name` aren't needed by it directly -- it re-derives names itself via `employeeNameById` when `shift.roster` is empty, so the order of these three keys inside the object literal doesn't matter functionally; keeping `roster` last just matches the diff above.)

- [ ] **Step 6: Verify with `node --check`**

Run: `node --check tasks.js`
Expected: no output (syntax OK).

- [ ] **Step 7: Verify live**

In the browser, as the pilot user (`1034305`), open the app and check that a real, already-open shift still shows correctly (shift banner gone, "Дай мне задачу" enabled) — this task doesn't change any visible behavior yet, it only adds a column and a normalization function nothing calls for scoring/UI decisions yet. Confirm via `javascript_tool` that `state` isn't reachable (it's module-private, expected) but that no console errors appear on page load.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/202609020001_wms_shifts_roster.sql tasks.js
git commit -m "Флоу: add wms_shifts.roster column and the old-shift->roster compatibility read"
```

---

## Task 2: Roster editor UI (dormant — not wired to save yet)

**Files:**
- Modify: `tasks.html:821-823` (`.shift-form-grid` CSS) — add roster-row styles
- Modify: `tasks.html:1522-1529` (the two `<select>`s) — replace with roster editor markup
- Modify: `tasks.js` — add `renderShiftRosterEditor()`, `addShiftRosterRow(prefill)`, and wire a delegated remove-row click handler

**Interfaces:**
- Consumes: `state.shift.employees` (existing, populated by `loadShiftState`), `REVIEW_SECTIONS`/`REQUEST_SECTIONS` (existing constants).
- Produces: `renderShiftRosterEditor(rows)` — renders `rows` (an array of `{employee_id, zones}`-shaped objects, or empty for a blank one-row start) into `#shiftRosterEditor`. `addShiftRosterRow(prefill)` — appends one row to the DOM, `prefill` optional `{employee_id, zones}`. Later tasks (Task 3) read the rendered DOM back out; this task only renders, it does not yet feed into `saveShiftOpening`.

This task is deliberately inert: the old `#shiftIncomingSelect`/`#shiftOutgoingSelect` reads inside `updateShiftOpeningForm`/`saveShiftOpening` are NOT touched here (Task 3 does that) — the new editor exists and renders, but nothing reads it yet, exactly like Флоу Phase 1's Task 1 added dormant CSS before anything used it.

- [ ] **Step 1: Replace the CSS**

In `tasks.html`, find (currently lines 821-823):

```css
        .shift-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
        .shift-form-grid label { color: #334155; font-size: 13px; font-weight: 900; }
        .shift-form-grid select { box-sizing: border-box; width: 100%; margin-top: 6px; border: 1px solid #dbe3ec; border-radius: 14px; padding: 11px 12px; background: #fff; color: #242038; font: inherit; }
```

Replace with:

```css
        .shift-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
        .shift-form-grid label { color: #334155; font-size: 13px; font-weight: 900; }
        .shift-form-grid select { box-sizing: border-box; width: 100%; margin-top: 6px; border: 1px solid #dbe3ec; border-radius: 14px; padding: 11px 12px; background: #fff; color: #242038; font: inherit; }
        .shift-roster { margin-top: 14px; display: grid; gap: 10px; }
        .shift-roster-row { border: 1px solid #dbe3ec; border-radius: 14px; padding: 12px; display: grid; gap: 8px; }
        .shift-roster-row-head { display: flex; align-items: center; gap: 8px; }
        .shift-roster-row-head select { flex: 1; box-sizing: border-box; border: 1px solid #dbe3ec; border-radius: 12px; padding: 9px 10px; background: #fff; color: #242038; font: inherit; }
        .shift-roster-zones { display: flex; flex-wrap: wrap; gap: 6px 14px; }
        .shift-roster-zone { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #334155; }
        .shift-roster-add { justify-self: start; }
```

- [ ] **Step 2: Replace the modal markup**

In `tasks.html`, find (currently lines 1522-1529):

```html
        <div class="shift-form-grid">
            <label>Входящий поток
                <select id="shiftIncomingSelect"></select>
            </label>
            <label>Исходящий поток
                <select id="shiftOutgoingSelect"></select>
            </label>
        </div>
```

Replace with:

```html
        <div id="shiftRosterEditor" class="shift-roster"></div>
        <button id="addShiftRosterRow" class="btn btn-outline shift-roster-add" type="button">+ Добавить человека</button>
```

- [ ] **Step 3: Add the zone list constant reference and the render/add functions**

In `tasks.js`, right after `normalizeShiftRoster` (added in Task 1), add:

```javascript
    const SHIFT_ROSTER_ZONES = REVIEW_SECTIONS.concat(REQUEST_SECTIONS);

    function shiftRosterZoneCheckboxesHtml(selectedZones) {
        const selected = new Set(selectedZones || []);
        return SHIFT_ROSTER_ZONES.map((zone) => "<label class='shift-roster-zone'><input type='checkbox' value='" + escapeHtml(zone) + "'" + (selected.has(zone) ? " checked" : "") + ">" + escapeHtml(zone) + "</label>").join("");
    }

    function shiftRosterEmployeeOptionsHtml(selectedId) {
        const options = "<option value=''>Выберите сотрудника</option>" + (state.shift.employees || [])
            .map((employee) => "<option value='" + escapeHtml(employee.id || employee.employee_id) + "'" + ((employee.id || employee.employee_id) === selectedId ? " selected" : "") + ">" + escapeHtml(employee.full_name) + "</option>")
            .join("");
        return options;
    }

    function addShiftRosterRow(prefill) {
        const container = $("shiftRosterEditor");
        if (!container) return;
        const row = document.createElement("div");
        row.className = "shift-roster-row";
        row.innerHTML = "<div class='shift-roster-row-head'>"
            + "<select class='shift-roster-employee'>" + shiftRosterEmployeeOptionsHtml(prefill && prefill.employee_id) + "</select>"
            + "<button class='btn btn-square shift-roster-remove' type='button' aria-label='Убрать'>×</button>"
            + "</div>"
            + "<div class='shift-roster-zones'>" + shiftRosterZoneCheckboxesHtml(prefill && prefill.zones) + "</div>";
        container.appendChild(row);
        row.querySelector(".shift-roster-remove").addEventListener("click", () => row.remove());
    }

    function renderShiftRosterEditor(rows) {
        const container = $("shiftRosterEditor");
        if (!container) return;
        container.innerHTML = "";
        const entries = Array.isArray(rows) && rows.length ? rows : [null];
        entries.forEach((entry) => addShiftRosterRow(entry));
    }
```

- [ ] **Step 4: Wire the "add person" button**

In `initEvents()` (`tasks.js`), find the line `$("shiftIncomingSelect").addEventListener("change", updateShiftOpeningForm);` (currently `tasks.js:15622-15623`, immediately followed by the `shiftOutgoingSelect` line). Leave both of those two lines exactly as they are for now (Task 3 removes them) — add this new line directly after them:

```javascript
        $("addShiftRosterRow").addEventListener("click", () => addShiftRosterRow(null));
```

- [ ] **Step 5: Render the editor when the modal opens**

In `openShiftOpeningModal()` (`tasks.js`, currently starts at line 2095), find:

```javascript
        if (!state.shift.employees.length) await loadShiftState();
        closeFlowModals();
        fillShiftSelects();
```

Add a call right after `fillShiftSelects();` (leave `fillShiftSelects()` itself untouched — Task 3 removes it, this task keeps both old and new UI rendering side by side, harmlessly, since the old selects are gone from the DOM after Step 2 above, so `fillShiftSelects` becomes a silent no-op — it does `if ($("shiftIncomingSelect")) ...`, and that element no longer exists):

```javascript
        renderShiftRosterEditor(normalizeShiftRoster(state.shift.current));
```

- [ ] **Step 6: Verify with `node --check`**

Run: `node --check tasks.js`
Expected: no output.

- [ ] **Step 7: Verify live**

In the browser, log in as the pilot (`1034305`), open "Открыть смену". Confirm: one empty roster row renders with an employee dropdown (populated with real active employees) and 14 zone checkboxes; clicking "+ Добавить человека" adds another identical row; clicking a row's "×" removes it. Confirm the save button's enabled/disabled state and the actual save behavior are UNCHANGED from before (Task 3 hasn't touched them yet) — the modal should still work exactly as it did with the two old dropdowns, since `fillShiftSelects`/`updateShiftOpeningForm`/`saveShiftOpening` haven't been touched.

- [ ] **Step 8: Commit**

```bash
git add tasks.html tasks.js
git commit -m "Флоу: add roster editor UI, not yet wired to save"
```

---

## Task 3: Wire the roster editor into save/validate/reopen

**Files:**
- Modify: `tasks.js:2089-2094` (`fillShiftSelects`) — delete, no longer used
- Modify: `tasks.js:2119-2128` (`updateShiftOpeningForm`) — validate against the roster editor instead of the two selects
- Modify: `tasks.js:2185-2236` area (`saveShiftOpening`) — build `roster` from the DOM instead of `incomingId`/`outgoingId`
- Modify: `tasks.js:15622-15624` (`initEvents`) — remove the two old select listeners, add roster-editor change listeners

**Interfaces:**
- Consumes: `renderShiftRosterEditor`, `addShiftRosterRow`, `SHIFT_ROSTER_ZONES` (Task 2), `normalizeShiftRoster` (Task 1).
- Produces: `collectShiftRosterFromForm()` → same shape as `normalizeShiftRoster`'s return value (`Array<{employee_id, full_name, zones}>`), read by `updateShiftOpeningForm` and `saveShiftOpening`. Later tasks (scoring) consume `state.shift.current.roster`, which this task is what actually populates with real user input for the first time.

- [ ] **Step 1: Delete `fillShiftSelects`**

In `tasks.js`, find and delete this whole function (currently `tasks.js:2089-2094`):

```javascript
    function fillShiftSelects() {
        const options = "<option value=''>Выберите сотрудника</option>" + (state.shift.employees || [])
            .map((employee) => "<option value='" + escapeHtml(employee.id || employee.employee_id) + "'>" + escapeHtml(employee.full_name) + "</option>")
            .join("");
        if ($("shiftIncomingSelect")) $("shiftIncomingSelect").innerHTML = options;
        if ($("shiftOutgoingSelect")) $("shiftOutgoingSelect").innerHTML = options;
    }
```

In `openShiftOpeningModal()`, remove the now-dead `fillShiftSelects();` call (the line directly above the `renderShiftRosterEditor(...)` line added in Task 2).

- [ ] **Step 2: Add `collectShiftRosterFromForm`**

Right after `renderShiftRosterEditor` (added in Task 2), add:

```javascript
    function collectShiftRosterFromForm() {
        const rows = Array.from(document.querySelectorAll("#shiftRosterEditor .shift-roster-row"));
        return rows.map((row) => {
            const select = row.querySelector(".shift-roster-employee");
            const employeeId = select ? normalizeIdentifier(select.value) : "";
            if (!employeeId) return null;
            const employee = employeeById(employeeId);
            const zones = Array.from(row.querySelectorAll(".shift-roster-zone input:checked")).map((input) => input.value);
            if (!zones.length) return null;
            return { employee_id: employeeId, full_name: employee ? employee.full_name : "", zones };
        }).filter(Boolean);
    }
```

- [ ] **Step 3: Rewrite `updateShiftOpeningForm`**

Find (currently `tasks.js:2119-2128`):

```javascript
    function updateShiftOpeningForm() {
        const incoming = normalizeText($("shiftIncomingSelect") && $("shiftIncomingSelect").value);
        const outgoing = normalizeText($("shiftOutgoingSelect") && $("shiftOutgoingSelect").value);
        const button = $("saveShiftOpening");
        const ready = Boolean(incoming && outgoing && state.shift.purePrepared && !state.shift.saving);
        if (button) {
            button.disabled = !ready;
            button.title = ready ? "" : "Нужно выбрать ответственных и загрузить чистые списания.";
        }
    }
```

Replace with:

```javascript
    function updateShiftOpeningForm() {
        const roster = collectShiftRosterFromForm();
        const button = $("saveShiftOpening");
        const ready = Boolean(roster.length && state.shift.purePrepared && !state.shift.saving);
        if (button) {
            button.disabled = !ready;
            button.title = ready ? "" : "Нужно добавить хотя бы одного человека с хотя бы одним участком и загрузить чистые списания.";
        }
    }
```

- [ ] **Step 4: Rewrite the relevant part of `saveShiftOpening`**

Find (currently `tasks.js:2185-2196`):

```javascript
    async function saveShiftOpening() {
        const db = supabaseDb();
        if (!db) return;
        const incomingId = normalizeText($("shiftIncomingSelect") && $("shiftIncomingSelect").value);
        const outgoingId = normalizeText($("shiftOutgoingSelect") && $("shiftOutgoingSelect").value);
        if (!incomingId || !outgoingId || !state.shift.purePrepared) {
            setShiftOpeningStatus("Нужно выбрать ответственных и загрузить чистые списания.", "error");
            return;
        }
        const incoming = employeeById(incomingId);
        const outgoing = employeeById(outgoingId);
        const button = $("saveShiftOpening");
```

Replace with:

```javascript
    async function saveShiftOpening() {
        const db = supabaseDb();
        if (!db) return;
        const roster = collectShiftRosterFromForm();
        if (!roster.length || !state.shift.purePrepared) {
            setShiftOpeningStatus("Нужно добавить хотя бы одного человека с хотя бы одним участком и загрузить чистые списания.", "error");
            return;
        }
        const button = $("saveShiftOpening");
```

Then find the payload block a few lines further down (currently `tasks.js:2203-2223`):

```javascript
            const payload = {
                wh_id: WH_ID,
                shift_date: state.today,
                shift_key: WH_ID + ":" + state.today,
                shift_label: formatRuDate(state.today),
                status: "opened",
                incoming_employee_id: incomingId,
                outgoing_employee_id: outgoingId,
                incoming_process: "Входящий поток",
                outgoing_process: "Исходящий поток",
                file_uploaded: true,
                file_name: state.shift.pureFileName || "",
                opened_by: [user.name, user.id].filter(Boolean).join(" / ") || null,
                source: "wms_tasks_page",
                payload: {
                    pure_losses_date_mode: "previous_shift_date",
                    pure_losses_target_date: shiftTargetPureDate(),
                    pure_losses_stats: state.shift.pureStats || {},
                    pure_losses_import: pureImport,
                },
            };
```

Replace with:

```javascript
            const payload = {
                wh_id: WH_ID,
                shift_date: state.today,
                shift_key: WH_ID + ":" + state.today,
                shift_label: formatRuDate(state.today),
                status: "opened",
                roster,
                file_uploaded: true,
                file_name: state.shift.pureFileName || "",
                opened_by: [user.name, user.id].filter(Boolean).join(" / ") || null,
                source: "wms_tasks_page",
                payload: {
                    pure_losses_date_mode: "previous_shift_date",
                    pure_losses_target_date: shiftTargetPureDate(),
                    pure_losses_stats: state.shift.pureStats || {},
                    pure_losses_import: pureImport,
                },
            };
```

(dropping `incoming_employee_id`/`outgoing_employee_id`/`incoming_process`/`outgoing_process` from the payload means the DB's own column defaults apply — `null` for the two id columns, matching "stop writing them for new/updated shifts" from the spec; the columns themselves are untouched in the schema).

Then find, a few lines further (currently around `tasks.js:2231-2236`):

```javascript
            state.shift.current = {
                ...(result.data || payload),
                incoming_name: incoming ? incoming.full_name : "",
                outgoing_name: outgoing ? outgoing.full_name : "",
```

Replace with:

```javascript
            state.shift.current = {
                ...(result.data || payload),
                roster: normalizeShiftRoster(result.data || payload),
```

- [ ] **Step 5: Rewire `initEvents`'s shift-form listeners**

Find (currently `tasks.js:15622-15624`, added-to in Task 2):

```javascript
        $("shiftIncomingSelect").addEventListener("change", updateShiftOpeningForm);
        $("shiftOutgoingSelect").addEventListener("change", updateShiftOpeningForm);
        $("addShiftRosterRow").addEventListener("click", () => addShiftRosterRow(null));
```

Replace with:

```javascript
        $("addShiftRosterRow").addEventListener("click", () => { addShiftRosterRow(null); updateShiftOpeningForm(); });
        // Delegated on the editor's stable container (not the rows
        // themselves, which get created/removed dynamically) -- covers
        // every employee-select change, every zone checkbox, and doubles
        // as the "row removed" signal since removing a row changes what
        // collectShiftRosterFromForm() would return.
        $("shiftRosterEditor").addEventListener("change", updateShiftOpeningForm);
        $("shiftRosterEditor").addEventListener("click", (event) => {
            if (event.target.closest && event.target.closest(".shift-roster-remove")) updateShiftOpeningForm();
        });
```

- [ ] **Step 6: Verify with `node --check`**

Run: `node --check tasks.js`
Expected: no output.

- [ ] **Step 7: Verify live**

As the pilot user, open "Открыть смену": add 2-3 people, assign overlapping and non-overlapping zones (e.g. person A → ПЦ + Маркетплейс, person B → Упаковка), confirm the save button enables only once at least one person has at least one zone checked AND чистые списания is loaded, save, and confirm via `supabase db query --linked "select roster from wms_shifts where wh_id = '<WH_ID>' and shift_date = current_date;"` that the saved `roster` JSON matches exactly what was checked in the UI. Reopen "Открыть смену" for the same (already-open) shift and confirm the editor repopulates with the saved roster (via `normalizeShiftRoster(state.shift.current)` in `openShiftOpeningModal`, from Task 2 Step 5) rather than starting blank.

- [ ] **Step 8: Commit**

```bash
git add tasks.js
git commit -m "Флоу: wire roster editor into shift save/validate/reopen"
```

---

## Task 4: `currentFlowEmployee()` reads zones from the roster

**Files:**
- Modify: `tasks.js:4932-4961` (`currentFlowEmployee`)

**Interfaces:**
- Consumes: `state.shift.current.roster` (populated by Tasks 1 and 3), `currentWmsUser()` (existing).
- Produces: `currentFlowEmployee()` still returns `{id, name, zones, inShift}` (same shape callers already expect) but `zones` is now a `Set<string>` of participios/section names (any of the 14 `SHIFT_ROSTER_ZONES`) instead of `Set<"incoming"|"outgoing">`. `incomingId`/`outgoingId` are dropped from the return value — Task 5 confirms nothing outside this function still reads them (Task 5's own step 1 does that check as part of removing `flowActor`'s dependency on them).

- [ ] **Step 1: Rewrite `currentFlowEmployee`**

Find (currently `tasks.js:4932-4961`):

```javascript
    function currentFlowEmployee() {
        const user = currentWmsUser();
        const shift = state.shift.current || {};
        let id = normalizeIdentifier(user.id);
        const nameKey = normalizeForMatch(user.name);
        const incomingId = normalizeIdentifier(shift.incoming_employee_id);
        const outgoingId = normalizeIdentifier(shift.outgoing_employee_id);
        const incomingName = normalizeForMatch(shift.incoming_name);
        const outgoingName = normalizeForMatch(shift.outgoing_name);
        const zones = new Set();
        if (id && incomingId && id === incomingId) zones.add("incoming");
        if (id && outgoingId && id === outgoingId) zones.add("outgoing");
        if (nameKey && incomingName && nameKey === incomingName) {
            zones.add("incoming");
            if (!id) id = incomingId;
        }
        if (nameKey && outgoingName && nameKey === outgoingName) {
            zones.add("outgoing");
            if (!id) id = outgoingId;
        }
        if (!id) id = nameKey;
        return {
            id,
            name: user.name,
            zones,
            incomingId,
            outgoingId,
            inShift: zones.size > 0,
        };
    }
```

Replace with:

```javascript
    function currentFlowEmployee() {
        const user = currentWmsUser();
        const shift = state.shift.current || {};
        const roster = Array.isArray(shift.roster) ? shift.roster : normalizeShiftRoster(shift);
        let id = normalizeIdentifier(user.id);
        const nameKey = normalizeForMatch(user.name);
        const zones = new Set();
        // Same double fallback (id, then name) the old two-role model used
        // -- covers the known wms_employees full_name rotation issue where
        // an employee's real id doesn't line up with what got stored.
        const match = roster.find((entry) => (id && entry.employee_id === id) || (nameKey && normalizeForMatch(entry.full_name) === nameKey));
        if (match) {
            match.zones.forEach((zone) => zones.add(zone));
            if (!id) id = match.employee_id;
        }
        if (!id) id = nameKey;
        return {
            id,
            name: user.name,
            zones,
            inShift: zones.size > 0,
        };
    }
```

- [ ] **Step 2: Verify with `node --check`**

Run: `node --check tasks.js`
Expected: no output.

- [ ] **Step 3: Search for now-removed fields**

Run: `grep -n "\.incomingId\|\.outgoingId" tasks.js`
Expected: no matches referring to a `currentFlowEmployee()`-returned object's `.incomingId`/`.outgoingId` (Task 5 will independently re-verify `flowActor()`, the one known consumer of these two fields, per that task's own Step 1 -- this grep here is just this task's own sanity check that it didn't leave a dangling reference behind before handing off).

- [ ] **Step 4: Verify live**

Do NOT verify this task alone in the browser -- `flowActor()` (Task 5) still reads `context.incomingId`/`context.outgoingId` at this point in the plan, so the app would be broken if tested live between Task 4 and Task 5. Confirm only via `node --check` and the grep above; live verification happens at the end of Task 5, which fixes `flowActor()` too.

- [ ] **Step 5: Commit**

```bash
git add tasks.js
git commit -m "Флоу: currentFlowEmployee reads zones from the roster"
```

---

## Task 5: Zone-scoring functions + `shiftAssigneeForZone` generalize to granular zones

**Files:**
- Modify: `tasks.js:428-450` (`REVIEW_SECTIONS`/`REQUEST_SECTIONS` region) — replace `FLOW_STRICT_INCOMING_SECTIONS`/`FLOW_STRICT_OUTGOING_SECTIONS` with `FLOW_STRICT_SECTIONS`
- Modify: `tasks.js:4963-4972` (`flowActor`) — stop reading `context.incomingId`/`context.outgoingId`
- Modify: `tasks.js:4910-4931` (`flowTaskZoneKey`, `flowTaskZoneLabel`, `flowZonePolicy`)
- Modify: `tasks.js:5048-5076` (`flowZoneCounts`, `flowZoneMultiplier`)
- Modify: `tasks.js:12298-12308` (`shiftAssigneeForZone`)

**Interfaces:**
- Consumes: `currentFlowEmployee()` (Task 4, now returns granular `zones`), `flowTaskSection(row)` (existing, `tasks.js:4906-4908`, unchanged), `state.shift.current.roster` (Tasks 1/3).
- Produces: `flowTaskZoneKey(row)` now returns the task's own section name (one of the 14 `SHIFT_ROSTER_ZONES` values) instead of `"incoming"|"outgoing"|"neutral"`. `flowZoneCounts(rows)` returns `{[section]: count}` for all 14 sections instead of `{incoming, outgoing, neutral}`. Nothing outside these functions and `flowZoneMultiplier` reads the internal shape of a "zone key" -- callers only ever pass a `row` in and get a score/label out, so this is a safe internal change.

- [ ] **Step 1: Confirm no other reader of `flowActor()`'s old fields**

Run: `grep -n "flowActor()" tasks.js` and read each call site. `flowActor()` itself (`tasks.js:4963-4972`) is the only place that reads `context.incomingId`/`context.outgoingId` -- confirm this is still true before editing (if some other call site was added since this plan was written, it needs the same fix as Step 2 below).

- [ ] **Step 2: Rewrite `flowActor`**

Find (currently `tasks.js:4963-4972`):

```javascript
    function flowActor() {
        const user = currentWmsUser();
        const context = currentFlowEmployee();
        const actorId = (context.zones.has("incoming") ? context.incomingId : "")
            || (context.zones.has("outgoing") ? context.outgoingId : "")
            || normalizeIdentifier(user.id)
            || normalizeIdentifier(context.id)
            || "";
        return { id: actorId, name: user.name || context.name || "" };
    }
```

Replace with:

```javascript
    function flowActor() {
        const user = currentWmsUser();
        const context = currentFlowEmployee();
        const actorId = normalizeIdentifier(user.id) || normalizeIdentifier(context.id) || "";
        return { id: actorId, name: user.name || context.name || "" };
    }
```

(the old version's whole point was picking `incomingId`/`outgoingId` when the logged-in user's own id was blank but they matched a shift role BY NAME -- `context.id` already carries that exact fallback now, from `currentFlowEmployee`'s `if (!id) id = match.employee_id;` line added in Task 4, so this is behavior-preserving, not a simplification that drops a case).

- [ ] **Step 3: Replace the strict-sections constant**

Find (currently `tasks.js:449-450`):

```javascript
    const FLOW_STRICT_INCOMING_SECTIONS = new Set(["Запросы входящего потока", "Коробки на входе"]);
    const FLOW_STRICT_OUTGOING_SECTIONS = new Set(["Списания AWH"]);
```

Replace with:

```javascript
    const FLOW_STRICT_SECTIONS = new Set(["Запросы входящего потока", "Коробки на входе", "Списания AWH"]);
```

- [ ] **Step 4: Rewrite `flowTaskZoneKey`, `flowTaskZoneLabel`, `flowZonePolicy`**

Find (currently `tasks.js:4910-4931`):

```javascript
    function flowTaskZoneKey(row) {
        const section = flowTaskSection(row);
        if (FLOW_STRICT_INCOMING_SECTIONS.has(section)) return "incoming";
        if (FLOW_STRICT_OUTGOING_SECTIONS.has(section)) return "outgoing";
        const zone = normalizeForMatch(row && row.responsibility_zone);
        if (zone.includes("вход")) return "incoming";
        if (zone.includes("исход")) return "outgoing";
        return "neutral";
    }

    function flowTaskZoneLabel(row) {
        const key = flowTaskZoneKey(row);
        if (key === "incoming") return "Входящий поток";
        if (key === "outgoing") return "Исходящий поток";
        return "Нет привязки";
    }

    function flowZonePolicy(row) {
        const section = flowTaskSection(row);
        if (FLOW_STRICT_INCOMING_SECTIONS.has(section) || FLOW_STRICT_OUTGOING_SECTIONS.has(section)) return "strict";
        if (flowTaskZoneKey(row) === "neutral") return "neutral";
        return "flexible";
    }
```

Replace with:

```javascript
    // The task's own участок/section (one of the 14 SHIFT_ROSTER_ZONES
    // values -- taskSectionName/requestSectionName always return one of
    // those, there is no real "no section" case left to handle) IS the
    // zone key now -- no more collapsing everything down to
    // incoming/outgoing/neutral.
    function flowTaskZoneKey(row) {
        return flowTaskSection(row);
    }

    function flowTaskZoneLabel(row) {
        return flowTaskSection(row);
    }

    function flowZonePolicy(row) {
        return FLOW_STRICT_SECTIONS.has(flowTaskSection(row)) ? "strict" : "flexible";
    }
```

- [ ] **Step 5: Rewrite `flowZoneCounts` and `flowZoneMultiplier`**

Find (currently `tasks.js:5048-5076`):

```javascript
    function flowZoneCounts(rows) {
        const counts = { incoming: 0, outgoing: 0, neutral: 0 };
        (rows || []).filter(isActiveReviewTask).forEach((row) => {
            const key = flowTaskZoneKey(row);
            counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
    }

    function flowZoneMultiplier(row, context, counts) {
        const policy = flowZonePolicy(row);
        const zone = flowTaskZoneKey(row);
        const zoneSettings = flowSettings().zone || {};
        if (policy === "neutral") return { value: 1, label: "Без жесткой зоны" };
        const own = context.zones.has(zone);
        let raw = own ? settingNumber(zoneSettings.own, 1.18) : settingNumber(zoneSettings.otherFlexible, 0.82);
        const currentCount = Number(counts[zone]) || 0;
        const ownCounts = Array.from(context.zones).map((key) => Number(counts[key]) || 0);
        const ownMax = ownCounts.length ? Math.max(...ownCounts) : 0;
        if (!own && policy === "flexible" && currentCount >= Math.max(ownMax * 1.3, ownMax + 8)) raw += settingNumber(zoneSettings.overflowBonus, 0.22);
        if (currentCount >= 50) raw += settingNumber(zoneSettings.heavyLoadBonus, 0.14);
        if (policy === "strict") raw += settingNumber(zoneSettings.strictBonus, 0.08);
        const weight = flowWeight("zone");
        const value = 1 + (Math.max(raw, 0.55) - 1) * weight;
        return {
            value: Math.max(value, 0.35),
            label: own ? "Своя зона" : policy === "flexible" ? "Чужая зона, но можно подхватить" : "Жесткая зона",
        };
    }
```

Replace with:

```javascript
    function flowZoneCounts(rows) {
        const counts = {};
        SHIFT_ROSTER_ZONES.forEach((zone) => { counts[zone] = 0; });
        (rows || []).filter(isActiveReviewTask).forEach((row) => {
            const key = flowTaskZoneKey(row);
            counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
    }

    function flowZoneMultiplier(row, context, counts) {
        const policy = flowZonePolicy(row);
        const zone = flowTaskZoneKey(row);
        const zoneSettings = flowSettings().zone || {};
        const own = context.zones.has(zone);
        let raw = own ? settingNumber(zoneSettings.own, 1.18) : settingNumber(zoneSettings.otherFlexible, 0.82);
        const currentCount = Number(counts[zone]) || 0;
        const ownCounts = Array.from(context.zones).map((key) => Number(counts[key]) || 0);
        const ownMax = ownCounts.length ? Math.max(...ownCounts) : 0;
        if (!own && policy === "flexible" && currentCount >= Math.max(ownMax * 1.3, ownMax + 8)) raw += settingNumber(zoneSettings.overflowBonus, 0.22);
        if (currentCount >= 50) raw += settingNumber(zoneSettings.heavyLoadBonus, 0.14);
        if (policy === "strict") raw += settingNumber(zoneSettings.strictBonus, 0.08);
        const weight = flowWeight("zone");
        const value = 1 + (Math.max(raw, 0.55) - 1) * weight;
        return {
            value: Math.max(value, 0.35),
            label: own ? "Своя зона" : policy === "flexible" ? "Чужая зона, но можно подхватить" : "Жесткая зона",
        };
    }
```

(the `policy === "neutral"` early-return is gone because `flowZonePolicy` can no longer return `"neutral"` -- every section is either `"strict"` or `"flexible"` now, so that branch is genuinely unreachable dead code being removed, not a behavior change for any real row: confirm this empirically in Step 7 below rather than just trusting the reasoning).

- [ ] **Step 6: Rewrite `shiftAssigneeForZone`**

Find (currently `tasks.js:12298-12308`):

```javascript
    function shiftAssigneeForZone(zone) {
        const shift = state.shift.current;
        if (!shift) return null;
        const normalized = normalizeForMatch(zone);
        const id = normalized.includes("вход")
            ? shift.incoming_employee_id
            : normalized.includes("исход")
                ? shift.outgoing_employee_id
                : "";
        return id ? employeeById(id) : null;
    }
```

Replace with:

```javascript
    function shiftAssigneeForZone(zone) {
        const shift = state.shift.current;
        if (!shift) return null;
        const roster = Array.isArray(shift.roster) ? shift.roster : normalizeShiftRoster(shift);
        const match = roster.find((entry) => entry.zones.includes(zone));
        return match ? employeeById(match.employee_id) : null;
    }
```

(the one real caller, `taskRecord` at `tasks.js:12430`, passes `options.responsibilityZone` today -- `"Исходящий поток"`-style text that will never match any of the 14 `SHIFT_ROSTER_ZONES` entries verbatim. Step 7 fixes that call site specifically).

- [ ] **Step 7: Fix `taskRecord`'s call site to pass a real участок**

`shiftAssigneeForZone`'s only caller is `taskRecord` (`tasks.js:12428-12430`):

```javascript
    function taskRecord(options) {
        const priority = taskPriority(options.price, options.forceHighPriority);
        const assignee = shiftAssigneeForZone(options.responsibilityZone);
```

`options.responsibilityZone` is the `DEFAULT_MODULES` config field (`"Исходящий поток"`/`"Нет привязки"`) -- not one of the 14 real участок names. The natural alternative, `options.column` (also present on `options` at this point -- see `tasks.js:12496`), is close but NOT reliable: one module (`marketplace_pc`, `tasks.js:300-311`) sets `column: "Маркетплейс / ПЦ"`, a combined display label that isn't in `SHIFT_ROSTER_ZONES` at all -- while `taskSectionName` (the function that actually classifies a saved task's участок for scoring, `tasks.js:4827-4844`) would classify that same module's tasks as plain `"Маркетплейс"` (its substring check for `"маркетплейс"` matches before it would even check for `"пц"`). Wiring `options.column` through as-is would silently make `marketplace_pc` tasks impossible to default-assign, since no roster entry could ever have zone `"Маркетплейс / ПЦ"`.

Fix: compute the participant the SAME way `taskSectionName` will once the row is saved, from the fields `taskRecord` already has on `options`, instead of using `options.column`/`options.responsibilityZone` at all. Replace:

```javascript
        const assignee = shiftAssigneeForZone(options.responsibilityZone);
```

with:

```javascript
        const assignee = shiftAssigneeForZone(taskSectionName({ task_type: options.taskType, title: options.title, source_module: options.sourceModule, upload_type: options.uploadType }));
```

This mirrors exactly how the row's own `task_type`/`title`/`source_module`/`upload_type` fields get set a few lines later in this same function (`tasks.js:12471-12485`: `source_module: options.sourceModule`, `upload_type: options.uploadType`, `task_type: options.taskType`, `title: titleLimit(options.title)`), so `options` is confirmed to already carry all four fields for every caller of `taskRecord` by this point in the function -- if a caller ever omitted one, `taskSectionName` degrades gracefully to `"Другие задачи"`, same as it does for a real saved row missing that field, so this is safe even if some future caller has a gap.

- [ ] **Step 8: Verify with `node --check`**

Run: `node --check tasks.js`
Expected: no output.

- [ ] **Step 9: Verify live -- old-shift compatibility**

Find a real shift opened before this plan's changes (still has `incoming_employee_id`/`outgoing_employee_id`, empty `roster`). As that shift's incoming or outgoing person, open Флоу and note the score/label ("Своя зона" / "Чужая зона, но можно подхватить" / "Жесткая зона") on a handful of real tasks across a few different участки. Compare against what the OLD code would have shown for the same tasks (reason from the old incoming/outgoing split: incoming person owns Запросы/Коробки, outgoing person owns everything else) -- confirm the new granular labels agree with the old binary ones for this shift (e.g. the outgoing person should show "Своя зона" on a ПЦ task, matching what the old code's `own` check would have given via the outgoing→REVIEW_SECTIONS mapping in `normalizeShiftRoster`).

- [ ] **Step 10: Verify live -- new multi-person roster**

Open a shift with 3+ people across overlapping and non-overlapping участки (from Task 3's own verification, or a fresh one). For each of 2-3 different logged-in identities (or by inspecting `flowScoreTask`'s reasons for a task via the debug sandbox's why-panel, which shows the same underlying `zone` reason text -- see `flowWhyBoxHtml`, unchanged by this plan), confirm the zone bonus/label matches that person's actual assigned участки, not a fixed two-way split.

- [ ] **Step 11: Commit**

```bash
git add tasks.js
git commit -m "Флоу: granular zone scoring + assignee lookup from the roster"
```

---

## Task 6: Full regression pass

**Files:** none (verification-only task, matching Флоу Phase 1's own final task's shape).

**Interfaces:** none.

- [ ] **Step 1: Classic (non-Флоу) shift-opening regression**

As a user NOT in `FLOW_ALLOWED_USER_IDS` (Флоу never engages for them, so this exercises only the shift/roster UI, not scoring): open "Открыть смену", confirm the roster editor and чистые списания upload both work exactly as verified in Task 3, save, confirm the classic "Разбор" table still shows tasks normally and that newly-created tasks (trigger a small real or debug-safe upload if practical, otherwise inspect the most recently created real task) get a sensible default `assignee_employee_id` from `shiftAssigneeForZone`.

- [ ] **Step 2: Флоу continuous-loop regression**

As the pilot user, with a real multi-person roster open, run through Флоу's normal loop (get task, verdict, auto-advance, skip) a few times, confirming no console errors and that scores/reasons render sensibly (this exercises `flowScoreTask` → `flowZoneMultiplier` → `flowTaskZoneKey` end to end).

- [ ] **Step 3: `taskSectionForAchievement` agreement check**

Run: `grep -n "function taskSectionForAchievement" tasks.js` and read its body -- it's `return requestSectionName(row) || taskSectionName(row);`, byte-for-byte the same expression `flowTaskSection` (`tasks.js:4906-4908`) uses. Confirm both function bodies still read identically at this point in the plan (neither this plan nor anything else should have touched `taskSectionForAchievement` along the way) -- if they've diverged, something in an earlier task edited the wrong one of the two, and that's a bug to fix before this task closes, not a finding to merely report.

- [ ] **Step 4: Zero-write sanity check**

Run: `supabase db query --linked` against `wms_shifts` filtered to the last ~30 minutes, confirming every write observed during this verification pass corresponds to an action actually taken (shift saves), matching this project's established zero-unexpected-write verification pattern.

- [ ] **Step 5: Final commit**

If Steps 1-4 required any fixes, commit them individually as they're made. If no fixes were needed, this task produces no commit -- note that in the session summary instead.

---

## Self-Review Notes

- **Spec coverage:** Модель данных → Task 1. UI → Tasks 2-3. Скоринг зон → Task 5. Дефолтный assignee → Task 5 Steps 6-7. Обратная совместимость → Task 1 (`normalizeShiftRoster`) + Task 5 Step 9 (live-verified). "Явно не входит" items (dispatcher/QA/coefficient/weight formula/old-column migration) — none touched by any task above; confirmed by re-reading every task's Files/Steps.
- **Placeholder scan:** no TBD/TODO left in any step. Task 5 Step 7 originally deferred "figure out what to pass `shiftAssigneeForZone`" to the implementer -- while self-reviewing, actually checked `taskRecord`'s only call site and every `DEFAULT_MODULES` `column` value, found a real mismatch (`marketplace_pc`'s `column: "Маркетплейс / ПЦ"` vs. `taskSectionName`'s `"Маркетплейс"` classification for the same tasks), and replaced the step with the concrete fix instead of leaving it open.
- **Type consistency:** `normalizeShiftRoster` (Task 1) → `{employee_id, full_name, zones}[]` used identically by `collectShiftRosterFromForm` (Task 3), `currentFlowEmployee` (Task 4), and `shiftAssigneeForZone` (Task 5) — verified the field names match across all four call sites while writing this plan.
