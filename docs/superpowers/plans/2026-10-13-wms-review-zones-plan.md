# Участки разбора (REVIEW_SECTIONS) -- настраиваемые администратором -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 11 hardcoded "участки разбора" (`REVIEW_SECTIONS` in tasks.js) admin-editable through a new Supabase table and an admin modal, with zero behavior change for existing data.

**Architecture:** A new `wms_review_zones` table (seeded with today's 11 names) is loaded once at app boot into `state.reviewZones`. A new getter `activeReviewZones()` returns the DB-backed, active, sorted zone names, falling back to the existing hardcoded `REVIEW_SECTIONS` array when the table is empty or unreachable (same pattern as `DEFAULT_MODULES`). Every place in tasks.js that today reads `REVIEW_SECTIONS`/`SHIFT_ROSTER_ZONES` directly switches to calling this getter. `taskSectionName()` gets an exact-match-first fast path against the active zone list so routing-engine-created tasks (whose `task_type` is already the bare zone name) automatically land in any newly added zone. A new admin modal ("Участки разбора"), mirroring the existing `moduleSettingsModal` pattern, lets an admin add/rename/reorder/deactivate zones.

**Tech Stack:** Supabase Postgres (SQL migrations), vanilla JS (tasks.js), plain HTML/CSS (tasks.html). No build step -- files are served as-is.

**Spec:** `docs/superpowers/specs/2026-10-13-wms-review-zones-design.md`

## Global Constraints

- Scope is `REVIEW_SECTIONS` only. Do not touch `REQUEST_SECTIONS`, `requestSectionName`, or anything under the "Заявки" tab.
- No RLS on the new table -- match the existing wide-open `grant select, insert, update, delete ... to anon, authenticated` convention used by `wms_module_settings`/`wms_routing_rules`/`wms_writeoff_terms`.
- Every SQL migration must be tested live via `begin; ...; rollback;` through `supabase db query --linked --file <scratch>.sql` BEFORE real application. Scratch files go in the scratchpad directory, not the repo.
- Applying any migration requires the holdout workaround: move these 4 files out of `supabase/migrations/` into `supabase/.migration_holdout/`, run `supabase db push --linked`, then move them back:
  `202608170001_weeek_manual_wmi_mp_pc_upload.sql`, `202609020005_wms_shifts_roster.sql`, `202609040003_upsert_wms_external_requests_from_json.sql`, `202609040004_upsert_wms_external_requests_source_shk_ids.sql`.
- Every JS change is verified with `node --check tasks.js` (no syntax errors). There is no browser QA available this session -- `checkUserAccess` requires a real Supabase Auth session, so do not claim visual/interactive verification; say explicitly that only static checks were run.
- Commit after each task (this session's established granularity is one commit per migration/logical change, not one giant commit at the end).
- Direct-to-main workflow, no branch/worktree -- this mirrors every other change made in this repo today.

---

### Task 1: `wms_review_zones` table (migration)

**Files:**
- Create: `supabase/migrations/202610130019_wms_review_zones.sql`

**Interfaces:**
- Produces: table `public.wms_review_zones(name text primary key, sort_order integer not null, is_active boolean not null default true, updated_at timestamptz not null default timezone('utc', now()))`, granted to `anon, authenticated`, seeded with 11 rows (sort_order 1-11, matching today's `REVIEW_SECTIONS` array order in tasks.js:428-440).

- [ ] **Step 1: Confirm the next free migration prefix**

Run: `ls supabase/migrations | sort | tail -5`
Expected: the newest file is `202610130018_wms_zone_rules_use_mx.sql` (or later -- if something landed after that, pick the next free `2026101300NN` prefix instead of `19` and adjust the filename below accordingly).

- [ ] **Step 2: Write the migration**

```sql
-- Участки разбора (REVIEW_SECTIONS в tasks.js) -- сегодня захардкожены
-- в коде, пользователь хочет управлять ими из интерфейса. Таблица --
-- просто список имён с порядком и флагом активности; код продолжает
-- иметь захардкоженный дефолт на случай пустой таблицы/офлайна (см.
-- activeReviewZones() в tasks.js) -- эта таблица не единственный
-- источник истины, а опциональная надстройка над ним.
create table public.wms_review_zones (
    name text primary key,
    sort_order integer not null,
    is_active boolean not null default true,
    updated_at timestamptz not null default timezone('utc', now())
);

grant select, insert, update, delete on public.wms_review_zones to anon, authenticated;

insert into public.wms_review_zones (name, sort_order) values
    ('Упаковка', 1), ('RWP', 2), ('ПМ', 3), ('Почта', 4),
    ('Предсортировка', 5), ('Маркетплейс', 6), ('ПЦ', 7),
    ('WMI (МП + ПЦ)', 8), ('Без заказа', 9),
    ('Движение после продажи', 10), ('Другие задачи', 11);
```

Save this to `supabase/migrations/202610130019_wms_review_zones.sql`.

- [ ] **Step 3: Test live via begin/rollback BEFORE real apply**

Write a scratch file (e.g. `/private/tmp/claude-502/.../scratchpad/test_review_zones.sql`, use your actual scratchpad path) with:

```sql
begin;

-- Apply the migration body inline (copy Step 2's SQL here).

create temp table test_results (test_name text primary key, actual text, expected text);

insert into test_results values
    ('seed_count', (select count(*)::text from public.wms_review_zones), '11'),
    ('first_zone_by_order', (select name from public.wms_review_zones order by sort_order asc limit 1), 'Упаковка'),
    ('last_zone_by_order', (select name from public.wms_review_zones order by sort_order asc limit 1 offset 10), 'Другие задачи');

-- Round-trip: upsert by name (the PK the client will use), confirm it updates in place rather than duplicating.
insert into public.wms_review_zones (name, sort_order, is_active)
values ('ПЦ', 999, false)
on conflict (name) do update set sort_order = excluded.sort_order, is_active = excluded.is_active;

insert into test_results values
    ('upsert_updates_in_place', (select count(*)::text from public.wms_review_zones where name = 'ПЦ'), '1'),
    ('upsert_applied_new_values', (select sort_order::text || '|' || is_active::text from public.wms_review_zones where name = 'ПЦ'), '999|false');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

Run: `supabase db query --linked --file /path/to/test_review_zones.sql`
Expected: every row's `pass` column is `t`. If any row is `f`, fix the migration and re-run this step before continuing -- do not proceed to Step 4 with a failing test.

- [ ] **Step 4: Apply for real**

```bash
mkdir -p supabase/.migration_holdout
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql supabase/migrations/202609020005_wms_shifts_roster.sql supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql supabase/.migration_holdout/
supabase db push --linked
mv supabase/.migration_holdout/*.sql supabase/migrations/
```

Expected: push reports the new migration applied, no errors. Verify the 4 holdout files are back in `supabase/migrations/` afterward (`ls supabase/migrations | wc -l` should match the count from before Step 1 plus one).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202610130019_wms_review_zones.sql
git commit -m "$(cat <<'EOF'
feat: add wms_review_zones table for admin-configurable участки разбора

Seeds today's 11 hardcoded REVIEW_SECTIONS names as rows. The JS side
still keeps the hardcoded array as a fallback default -- this table is
an optional override layer, not yet read by the client (next task).
EOF
)"
```

---

### Task 2: `activeReviewZones()` / `shiftRosterZones()` / `loadReviewZones()`

**Files:**
- Modify: `tasks.js` (state init near line 540, new functions near the `loadWriteoffTerms`/`loadModuleSettings` family around line 12515-12546, `init()` around line 18841-18858)

**Interfaces:**
- Consumes: table `wms_review_zones` from Task 1; existing helpers `supabaseDb()` (tasks.js:1351), the hardcoded `REVIEW_SECTIONS` array (tasks.js:428-440).
- Produces: `state.reviewZones = { rows, loading, saving, loaded, error }`; `function activeReviewZones(): string[]`; `function shiftRosterZones(): string[]`; `async function loadReviewZones(force): Promise<boolean>`. These three functions are consumed by Task 3 (call-site replacements), Task 4 (`taskSectionName`), and Task 5 (the admin modal calls `loadReviewZones`/reads `state.reviewZones`).

- [ ] **Step 1: Add `state.reviewZones`**

Find the state object's `moduleSettings:` block (currently around tasks.js:540-546):

```js
        moduleSettings: {
            rows: [],
            loading: false,
            saving: false,
            loaded: false,
            error: "",
        },
```

Add immediately after it:

```js
        reviewZones: {
            rows: [],
            loading: false,
            saving: false,
            loaded: false,
            error: "",
        },
```

- [ ] **Step 2: Add `activeReviewZones()` and `shiftRosterZones()`**

Find the `SHIFT_ROSTER_ZONES` constant definition (currently tasks.js:1921):

```js
    const SHIFT_ROSTER_ZONES = REVIEW_SECTIONS.concat(REQUEST_SECTIONS);
```

Replace this single line with:

```js
    function activeReviewZones() {
        const rows = (state.reviewZones.rows || [])
            .filter((row) => row.is_active !== false)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            .map((row) => row.name)
            .filter(Boolean);
        return rows.length ? rows : REVIEW_SECTIONS;
    }

    function shiftRosterZones() {
        return activeReviewZones().concat(REQUEST_SECTIONS);
    }
```

(Task 3 replaces the call sites that used the old `SHIFT_ROSTER_ZONES` constant with calls to `shiftRosterZones()`.)

- [ ] **Step 3: Add `loadReviewZones()`**

Find `loadModuleSettings` (currently tasks.js:12515-12546) and add a new function right after its closing brace, before `moduleSettingRowHtml`:

```js
    async function loadReviewZones(force) {
        if (state.reviewZones.loaded && !force) return true;
        const db = supabaseDb();
        state.reviewZones.loading = true;
        state.reviewZones.error = "";
        if (!db) {
            state.reviewZones.loading = false;
            return false;
        }
        try {
            const { data, error } = await db
                .from("wms_review_zones")
                .select("*")
                .order("sort_order", { ascending: true });
            if (error) throw error;
            state.reviewZones.rows = data || [];
            state.reviewZones.loaded = true;
            return true;
        } catch (error) {
            state.reviewZones.error = "Не удалось загрузить участки: " + (error && error.message ? error.message : String(error));
            console.warn("review zones load skipped:", error);
            return false;
        } finally {
            state.reviewZones.loading = false;
            renderReviewZonesModal();
        }
    }
```

Note: `renderReviewZonesModal` is defined in Task 5. This is fine -- JS function declarations are hoisted within the same scope, and this call only ever executes after the modal has been opened at least once (same pattern `loadModuleSettings` already uses with `renderModuleSettingsModal`). `node --check` will still pass because the reference is valid at parse time regardless of definition order.

- [ ] **Step 4: Wire `loadReviewZones()` into app boot**

Find `init()` (currently tasks.js:18841-18858):

```js
        void loadShiftState();
        void loadAchievements();
        void loadWriteoffTerms();
        void loadPrintAlertState();
```

Add `void loadReviewZones();` on its own line, right after `void loadWriteoffTerms();`:

```js
        void loadShiftState();
        void loadAchievements();
        void loadWriteoffTerms();
        void loadReviewZones();
        void loadPrintAlertState();
```

- [ ] **Step 5: Verify**

Run: `node --check tasks.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add tasks.js
git commit -m "$(cat <<'EOF'
feat: load wms_review_zones at boot, add activeReviewZones()/shiftRosterZones()

activeReviewZones() reads the DB-backed zone list, falling back to the
hardcoded REVIEW_SECTIONS array when the table is empty/unreachable --
same default+override pattern as DEFAULT_MODULES. Call-site migration
and the admin modal itself land in the next commits.
EOF
)"
```

---

### Task 3: Replace every `REVIEW_SECTIONS`/`SHIFT_ROSTER_ZONES` call site

**Files:**
- Modify: `tasks.js` (10 `REVIEW_SECTIONS` call sites + 3 `SHIFT_ROSTER_ZONES` call sites, scattered -- exact lines will have shifted from Task 2's edits, re-grep first)

**Interfaces:**
- Consumes: `activeReviewZones()` and `shiftRosterZones()` from Task 2.
- Produces: no new interface -- this task's deliverable is "zero remaining bare references", verified mechanically.

- [ ] **Step 1: Re-locate every call site**

Run: `grep -n "REVIEW_SECTIONS" tasks.js`
Expected output (line numbers will differ from this list since Task 2 inserted code before some of these -- match by surrounding code, not by line number):

```
428:    const REVIEW_SECTIONS = [          <- keep, this is the definition itself
1909:            const outgoingZones = REVIEW_SECTIONS.concat(["Списания AWH"]);
2889:            state.review.activeSection = REVIEW_SECTIONS.find((section) => (grouped.get(section) || []).length) || REVIEW_SECTIONS[0];
6080:        const grouped = new Map(REVIEW_SECTIONS.map((section) => [section, []]));
6358:            sectionNames: REVIEW_SECTIONS.filter((section) => (rows || []).some((row) => taskSectionName(row) === section)),
7014:            ? REVIEW_SECTIONS.slice().sort((a, b) => {
7019:            : REVIEW_SECTIONS;
7036:                const clicked = button.dataset.reviewSection || REVIEW_SECTIONS[0];
7164:        const section = state.review.activeSection || REVIEW_SECTIONS[0];
12279:        const targetOptions = REVIEW_SECTIONS.map((section) =>
12396:            target_task_type: REVIEW_SECTIONS[0],
```

(Inside `activeReviewZones()` itself there is also a `return rows.length ? rows : REVIEW_SECTIONS;` -- that one is correct as-is, do NOT change it.)

Run: `grep -n "SHIFT_ROSTER_ZONES\|shiftRosterZones" tasks.js`
Expected output:

```
1925:        return SHIFT_ROSTER_ZONES.map((zone) => ...
2745:        const uncovered = SHIFT_ROSTER_ZONES.filter((zone) => !covered.has(zone));
5031:        SHIFT_ROSTER_ZONES.forEach((zone) => { counts[zone] = 0; });
```

(`shiftRosterZones()`'s own definition from Task 2 will also show up -- leave that alone.)

- [ ] **Step 2: Replace each `REVIEW_SECTIONS` reference (except the definition and the one inside `activeReviewZones()`) with `activeReviewZones()`**

For each of the 10 call sites listed in Step 1, replace the bare identifier `REVIEW_SECTIONS` with `activeReviewZones()`. Example for the `outgoingZones` line:

```js
// before
const outgoingZones = REVIEW_SECTIONS.concat(["Списания AWH"]);
// after
const outgoingZones = activeReviewZones().concat(["Списания AWH"]);
```

And for an indexed access:

```js
// before
state.review.activeSection = REVIEW_SECTIONS.find((section) => (grouped.get(section) || []).length) || REVIEW_SECTIONS[0];
// after
state.review.activeSection = activeReviewZones().find((section) => (grouped.get(section) || []).length) || activeReviewZones()[0];
```

Apply the same mechanical substitution to all 10 sites (lines ~1909, 2889 (both occurrences on that line), 6080, 6358, 7014, 7019, 7036, 7164, 12279, 12396 from Step 1's grep).

- [ ] **Step 3: Replace each `SHIFT_ROSTER_ZONES` reference with `shiftRosterZones()`**

For each of the 3 call sites:

```js
// before
return SHIFT_ROSTER_ZONES.map((zone) => "<label class='shift-roster-zone'>...");
// after
return shiftRosterZones().map((zone) => "<label class='shift-roster-zone'>...");
```

```js
// before
const uncovered = SHIFT_ROSTER_ZONES.filter((zone) => !covered.has(zone));
// after
const uncovered = shiftRosterZones().filter((zone) => !covered.has(zone));
```

```js
// before
SHIFT_ROSTER_ZONES.forEach((zone) => { counts[zone] = 0; });
// after
shiftRosterZones().forEach((zone) => { counts[zone] = 0; });
```

- [ ] **Step 4: Verify no bare references remain**

Run: `grep -n "REVIEW_SECTIONS\b" tasks.js`
Expected: exactly 2 matches -- the `const REVIEW_SECTIONS = [` definition (line ~428) and the `: REVIEW_SECTIONS;` inside `activeReviewZones()`'s own body. Every other line from Step 1 must be gone.

Run: `grep -n "SHIFT_ROSTER_ZONES\b" tasks.js`
Expected: zero matches (the constant was already removed in Task 2; `shiftRosterZones` the function name does not match this exact pattern since it's lowercase-prefixed camelCase, not the all-caps constant).

Run: `node --check tasks.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add tasks.js
git commit -m "$(cat <<'EOF'
refactor: route all REVIEW_SECTIONS/SHIFT_ROSTER_ZONES reads through the new getters

Mechanical substitution, no behavior change today (activeReviewZones()
still falls back to the same hardcoded array until an admin edits the
new table). Prepares every consumer (Предразбор grid, Флоу counts,
shift roster) to pick up admin-added zones once Task 5's modal ships.
EOF
)"
```

---

### Task 4: `taskSectionName` exact-match-first fast path

**Files:**
- Modify: `tasks.js` (`taskSectionName`, currently lines 4827-4845)

**Interfaces:**
- Consumes: `activeReviewZones()` from Task 2, `normalizeForMatch()` (tasks.js:826, unchanged).
- Produces: `taskSectionName(row)` keeps its existing signature and return type (a zone name string) -- no caller needs to change.

- [ ] **Step 1: Re-locate the function**

Run: `grep -n "function taskSectionName" tasks.js`
Confirm the current line number (will have shifted from Tasks 2-3's insertions).

- [ ] **Step 2: Replace the function body**

Current body (before):

```js
    function taskSectionName(row) {
        const taskType = normalizeForMatch(row && row.task_type);
        const title = normalizeForMatch(row && row.title);
        const sourceModule = normalizeForMatch(row && row.source_module);
        const combined = [taskType, title, sourceModule, normalizeForMatch(row && row.upload_type)].join(" ");
        if (combined.includes("оклейка") || /\busd\b/.test(combined) || /\btmm\b/.test(combined)) return "Другие задачи";
        if (combined.includes("wmi")) return "WMI (МП + ПЦ)";
        if (combined.includes("почта")) return "Почта";
        if (combined.includes("пм") || combined.includes("pm")) return "ПМ";
        if (combined.includes("rwp")) return "RWP";
        if (combined.includes("упаковка") || combined.includes("переупаковка")) return "Упаковка";
        if (taskType === "чистые списания") return "Чистые списания";
        if (combined.includes("предсорт")) return "Предсортировка";
        if (combined.includes("маркетплейс")) return "Маркетплейс";
        if (combined.includes("пц")) return "ПЦ";
        if (combined.includes("без заказа")) return "Без заказа";
        if (combined.includes("движение после продажи")) return "Движение после продажи";
        return "Другие задачи";
    }
```

New body (after) -- adds the exact-match fast path as the first two lines inside the function, everything else byte-for-byte unchanged:

```js
    function taskSectionName(row) {
        const taskType = normalizeForMatch(row && row.task_type);
        const exactMatch = activeReviewZones().find((zone) => normalizeForMatch(zone) === taskType);
        if (exactMatch) return exactMatch;
        const title = normalizeForMatch(row && row.title);
        const sourceModule = normalizeForMatch(row && row.source_module);
        const combined = [taskType, title, sourceModule, normalizeForMatch(row && row.upload_type)].join(" ");
        if (combined.includes("оклейка") || /\busd\b/.test(combined) || /\btmm\b/.test(combined)) return "Другие задачи";
        if (combined.includes("wmi")) return "WMI (МП + ПЦ)";
        if (combined.includes("почта")) return "Почта";
        if (combined.includes("пм") || combined.includes("pm")) return "ПМ";
        if (combined.includes("rwp")) return "RWP";
        if (combined.includes("упаковка") || combined.includes("переупаковка")) return "Упаковка";
        if (taskType === "чистые списания") return "Чистые списания";
        if (combined.includes("предсорт")) return "Предсортировка";
        if (combined.includes("маркетплейс")) return "Маркетплейс";
        if (combined.includes("пц")) return "ПЦ";
        if (combined.includes("без заказа")) return "Без заказа";
        if (combined.includes("движение после продажи")) return "Движение после продажи";
        return "Другие задачи";
    }
```

- [ ] **Step 3: Verify**

Run: `node --check tasks.js`
Expected: no output, exit code 0.

Run: `grep -n "function taskSectionName" -A3 tasks.js`
Expected: the first lines inside the function body show the new `exactMatch` check before the `title`/`sourceModule`/`combined` lines.

- [ ] **Step 4: Commit**

```bash
git add tasks.js
git commit -m "$(cat <<'EOF'
feat: taskSectionName checks active review zones for an exact match first

Routing-engine-created tasks already get task_type set to the bare
zone name (e.g. "ПЦ", no prefix) -- an exact match against the admin's
active zone list now short-circuits before the legacy substring chain,
so a newly admin-added zone works for those tasks without touching
this function again. Legacy substring-matched task_type formats are
unaffected (the exact-match check only fires when task_type equals a
known zone name character-for-character after normalization).
EOF
)"
```

---

### Task 5: "Участки разбора" admin modal

**Files:**
- Modify: `tasks.html` (new `<section id="reviewZonesModal">` block after the existing `moduleSettingsModal` block around line 2872; new entry-point `<button id="openReviewZones">` after `openModuleSettings` around line 1995)
- Modify: `tasks.js` (new render/save/draft functions near the `moduleSettings` function family around line 12624+; new event listeners near the existing routing-rules/module-settings wiring around lines 18562-18616 and 18781-18782)

**Interfaces:**
- Consumes: `state.reviewZones` and `loadReviewZones()` from Task 2; shared helpers `$()`, `escapeHtml()`, `normalizeText()`, `settingNumber()`, `toast()`, `supabaseDb()`, `ensureDevelopmentAccess()` (tasks.js:10586), `setFlowModalOpen()` (tasks.js:1655), `closeFlowModals()` (tasks.js:1677) -- all pre-existing, unchanged.
- Produces: `function reviewZoneRowHtml(row)`, `function renderReviewZonesModal()`, `async function removeReviewZoneRow(rowEl)`, `function addReviewZoneDraft()`, `function reviewZoneInputRows()`, `async function openReviewZonesModal()`, `function closeReviewZonesModal()`, `async function saveReviewZonesFromModal()`. No later task consumes these -- this is the final task.

- [ ] **Step 1: Add the HTML modal block**

Find the end of the `moduleSettingsModal` section in `tasks.html` (currently ends around line 2872 with `</section>`, immediately followed by a blank line then `<section id="specialInfoModal"...`):

```html
        <div id="moduleSettingsStatus" class="review-status"></div>
    </div>
</section>

<section id="specialInfoModal" class="tasks-flow-modal upload-work" aria-hidden="true">
```

Insert a new section between them:

```html
        <div id="moduleSettingsStatus" class="review-status"></div>
    </div>
</section>

<section id="reviewZonesModal" class="tasks-flow-modal upload-work" aria-hidden="true">
    <div class="tasks-flow-card tasks-flow-card-wide">
        <div class="work-head">
            <div>
                <h3 class="work-title">Участки разбора</h3>
                <p class="work-subtitle">Список "папок" Предразбора (Упаковка, RWP, ПЦ и т.д.) -- отсюда их читают Предразбор, Флоу и ростер смены. Порядок задаёт очерёдность показа, выключенный участок скрывается из этих списков (существующие задачи никуда не денутся -- просто попадут в "Другие задачи").</p>
            </div>
            <button id="closeReviewZones" class="btn btn-square" type="button" aria-label="Закрыть">×</button>
        </div>
        <div id="reviewZonesWrap" class="writeoff-terms-wrap"></div>
        <div class="file-row">
            <button id="addReviewZone" class="btn btn-outline" type="button">Добавить участок</button>
            <button id="saveReviewZones" class="btn btn-rect" type="button">Сохранить участки</button>
            <button id="reloadReviewZones" class="btn btn-outline" type="button">Обновить из Supabase</button>
        </div>
        <div id="reviewZonesStatus" class="review-status"></div>
    </div>
</section>

<section id="specialInfoModal" class="tasks-flow-modal upload-work" aria-hidden="true">
```

- [ ] **Step 2: Add the entry-point button**

Find the `openModuleSettings` button in `tasks.html` (currently around line 1991-1995):

```html
                <button id="openModuleSettings" class="tasks-action-card" type="button" data-dev-only>
                    <span class="tasks-action-icon">⚙️</span>
                    <h2 class="tasks-action-title">Параметры модулей</h2>
                    <p class="tasks-action-text">Нестатичные параметры выгрузки (пороги, сдвиги дат и т.п.) без правки кода.</p>
                </button>
```

Add immediately after its closing `</button>`:

```html
                <button id="openReviewZones" class="tasks-action-card" type="button" data-dev-only>
                    <span class="tasks-action-icon">🗂️</span>
                    <h2 class="tasks-action-title">Участки разбора</h2>
                    <p class="tasks-action-text">Список участков Предразбора (Упаковка, RWP, ПЦ и т.д.) -- без правки кода.</p>
                </button>
```

- [ ] **Step 3: Add the JS handler functions**

Find `removeModuleSettingRow`/`addModuleSettingDraft`/`moduleSettingInputRows` (currently tasks.js:12571-12610) and add the following new functions right after `moduleSettingInputRows`'s closing brace, before `openModuleSettingsModal`:

```js
    function reviewZoneRowHtml(row) {
        return "<div class='writeoff-term-row' data-review-zone-row data-zone-name-original='" + escapeHtml(row.name || "") + "'>"
            + "<input data-zone-sort type='number' min='1' step='1' value='" + escapeHtml(row.sort_order || "") + "' placeholder='Порядок'>"
            + "<input data-zone-name type='text' value='" + escapeHtml(row.name || "") + "' placeholder='Название участка'>"
            + "<label class='writeoff-term-active'><input data-zone-active type='checkbox' " + (row.is_active === false ? "" : "checked") + "> активен</label>"
            + "<button type='button' class='btn btn-square' data-zone-remove aria-label='Удалить'>×</button>"
            + "</div>";
    }

    function renderReviewZonesModal() {
        const target = $("reviewZonesWrap");
        if (!target) return;
        const rows = state.reviewZones.rows || [];
        target.innerHTML = (state.reviewZones.error ? "<div class='status-line error'>" + escapeHtml(state.reviewZones.error) + "</div>" : "")
            + (state.reviewZones.loading ? "<div class='status-line'>Загружаю участки...</div>" : "")
            + "<div class='writeoff-term-head'><span>Порядок</span><span>Название</span><span>Вкл.</span></div>"
            + "<div class='writeoff-term-list'>" + rows.map(reviewZoneRowHtml).join("") + "</div>";
        target.querySelectorAll("[data-zone-remove]").forEach((button) => {
            button.addEventListener("click", () => removeReviewZoneRow(button.closest("[data-review-zone-row]")));
        });
    }

    async function removeReviewZoneRow(rowEl) {
        if (!rowEl) return;
        const name = rowEl.getAttribute("data-zone-name-original");
        if (name) {
            const db = supabaseDb();
            if (db) {
                try {
                    const { error } = await db.from("wms_review_zones").delete().eq("name", name);
                    if (error) throw error;
                } catch (error) {
                    toast("Не удалось удалить участок: " + (error && error.message ? error.message : String(error)), "error");
                    return;
                }
            }
        }
        rowEl.remove();
    }

    function addReviewZoneDraft() {
        const rows = state.reviewZones.rows || [];
        const nextOrder = rows.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0) + 1;
        state.reviewZones.rows = rows.concat({ name: "", sort_order: nextOrder, is_active: true });
        renderReviewZonesModal();
    }

    function reviewZoneInputRows() {
        return Array.from(document.querySelectorAll("[data-review-zone-row]")).map((row) => {
            const name = normalizeText(row.querySelector("[data-zone-name]") && row.querySelector("[data-zone-name]").value);
            if (!name) return null;
            return {
                name,
                sort_order: Math.max(1, Math.trunc(settingNumber(row.querySelector("[data-zone-sort]") && row.querySelector("[data-zone-sort]").value, 1))),
                is_active: row.querySelector("[data-zone-active]").checked,
                updated_at: new Date().toISOString(),
            };
        }).filter(Boolean);
    }

    async function openReviewZonesModal() {
        if (!ensureDevelopmentAccess("Участки разбора")) return;
        closeFlowModals();
        setFlowModalOpen("reviewZonesModal", true);
        renderReviewZonesModal();
        await loadReviewZones(true);
    }

    function closeReviewZonesModal() {
        setFlowModalOpen("reviewZonesModal", false);
    }

    async function saveReviewZonesFromModal() {
        const db = supabaseDb();
        const status = $("reviewZonesStatus");
        const button = $("saveReviewZones");
        const rows = reviewZoneInputRows();
        if (!rows.length) {
            if (status) status.textContent = "Нет строк для сохранения.";
            return;
        }
        if (!db) {
            if (status) status.textContent = "Supabase недоступен.";
            return;
        }
        if (button) button.disabled = true;
        state.reviewZones.saving = true;
        if (status) status.textContent = "Сохраняю участки...";
        try {
            const { error } = await db.from("wms_review_zones").upsert(rows, { onConflict: "name" });
            if (error) throw error;
            state.reviewZones.loaded = false;
            await loadReviewZones(true);
            if (status) status.textContent = "Участки сохранены.";
            toast("Участки разбора сохранены.", "success");
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            state.reviewZones.error = "Не удалось сохранить участки: " + message;
            if (status) status.textContent = state.reviewZones.error;
        } finally {
            state.reviewZones.saving = false;
            if (button) button.disabled = false;
        }
    }
```

- [ ] **Step 4: Wire up event listeners**

Find this block in the event-wiring section (currently tasks.js:18562-18563):

```js
        $("openRoutingRules").addEventListener("click", () => { void openRoutingRulesModal(); });
        $("openModuleSettings").addEventListener("click", () => { void openModuleSettingsModal(); });
```

Add immediately after:

```js
        $("openReviewZones").addEventListener("click", () => { void openReviewZonesModal(); });
```

Find this block (currently tasks.js:18612-18616):

```js
        $("closeRoutingRules").addEventListener("click", closeRoutingRulesModal);
        $("addRoutingRule").addEventListener("click", addRoutingRuleDraft);
        $("saveRoutingRules").addEventListener("click", () => { void saveRoutingRulesFromModal(); });
        $("reloadRoutingRules").addEventListener("click", () => { void loadRoutingRules(true); });
        $("closeModuleSettings").addEventListener("click", closeModuleSettingsModal);
```

Add immediately after:

```js
        $("closeReviewZones").addEventListener("click", closeReviewZonesModal);
        $("addReviewZone").addEventListener("click", addReviewZoneDraft);
        $("saveReviewZones").addEventListener("click", () => { void saveReviewZonesFromModal(); });
        $("reloadReviewZones").addEventListener("click", () => { void loadReviewZones(true); });
```

Find this block (currently tasks.js:18781-18782):

```js
        $("routingRulesModal").addEventListener("click", (event) => { if (event.target === $("routingRulesModal")) closeRoutingRulesModal(); });
        $("moduleSettingsModal").addEventListener("click", (event) => { if (event.target === $("moduleSettingsModal")) closeModuleSettingsModal(); });
```

Add immediately after:

```js
        $("reviewZonesModal").addEventListener("click", (event) => { if (event.target === $("reviewZonesModal")) closeReviewZonesModal(); });
```

- [ ] **Step 5: Verify**

Run: `node --check tasks.js`
Expected: no output, exit code 0.

Run: `grep -c "reviewZonesModal\|reviewZonesWrap\|reviewZonesStatus" tasks.html`
Expected: at least 5 (one per id reference in the HTML block from Step 1 plus the entry button area).

Run: `grep -n "openReviewZones\|closeReviewZones\|addReviewZone\|saveReviewZones\|reloadReviewZones" tasks.js`
Expected: every id referenced in Step 4's listeners has a matching element id in tasks.html (cross-check against Step 1/2's HTML), and every function name referenced (`openReviewZonesModal`, `closeReviewZonesModal`, `addReviewZoneDraft`, `saveReviewZonesFromModal`, `loadReviewZones`) is defined somewhere in tasks.js (Step 3 of this task, or Task 2).

State explicitly in your task completion notes that this was verified via `node --check` and manual code reading only -- no live browser session was used, consistent with every other JS change made in this repo today.

- [ ] **Step 6: Commit**

```bash
git add tasks.html tasks.js
git commit -m "$(cat <<'EOF'
feat: add admin modal for Участки разбора (wms_review_zones CRUD)

Mirrors the existing moduleSettingsModal pattern -- flat list of rows
(name/order/active), add/remove/save, reload from Supabase. Completes
the review-zones feature: an admin can now add, reorder, rename, or
deactivate a участок разбора without touching code.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (schema) -> Task 1. Section 2 (getter/loader) -> Task 2. Section 3 (call-site replacement) -> Task 3. Section 4 (`taskSectionName`) -> Task 4. Section 5 (admin modal) -> Task 5. "Что НЕ входит в объём" items require no task (verified: no task touches `REQUEST_SECTIONS`, task migration, or zone renaming-with-task-reassignment).
- **Placeholder scan:** no TBD/TODO; every step has literal code or an exact grep/run command with expected output.
- **Type consistency:** `activeReviewZones()` returns `string[]` everywhere it's defined (Task 2) and everywhere it's called (Tasks 3-5). `shiftRosterZones()` likewise. `state.reviewZones` shape (`rows/loading/saving/loaded/error`) is identical between its Task 2 declaration and every Task 5 read/write. Function names match exactly between Task 5's "Produces" list and its own Step 3 definitions.
