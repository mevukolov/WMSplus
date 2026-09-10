# Закрытие короба смены Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a floor worker close the day's shift box from the public intake form: from 19:30, tap the existing shift counter, scan a fixed location QR in the revision office, print one sticker for the box plus one sticker per КГТ item recorded that shift (each carrying the item's name), then flip the box to "На полу" — same effect the admin's existing "Принесено" button already produces.

**Architecture:** No schema changes. Everything needed already exists from the 2026-09-08 shift-box feature: `wms_no_shk_boxes.outside_opp` (open RLS), the `wms_no_shk_box_contents(p_box_id)` RPC (open to anon), and the `print_label_templates` → `print_jobs` → print-bridge pipeline. This plan adds one new print template row, copies `print-tspl.js` into the intake-form repo (two separate static sites, no shared module system), a small pure-logic module for testable helpers, and new screens/wiring in `intake.js`/`index.html`.

**Tech Stack:** Plain HTML/JS, `@supabase/supabase-js@2`, `jsQR` (already loaded), no build step, no framework.

**Spec:** [`docs/superpowers/specs/2026-09-10-shift-box-closing-design.md`](../specs/2026-09-10-shift-box-closing-design.md) — read it alongside this plan; it also references the parent [`2026-09-08-intake-form-processing-instructions-and-shift-boxes-design.md`](../specs/2026-09-08-intake-form-processing-instructions-and-shift-boxes-design.md).

## Global Constraints

- No build step in either repo; new dependencies load via CDN `<script>` only.
- `data-*` attribute selectors for new interactive elements (existing convention, e.g. `data-shift-counter`, `data-entry`).
- New SQL ships as a migration under `WMSplus-main/supabase/migrations/`, named `YYYYMMDDNNNN_<slug>.sql`. Apply it with `supabase db query --linked -f supabase/migrations/<file>.sql` — **never** `supabase db push` (blocked in this project by a pre-existing migration-ledger conflict, per established convention).
- `intake_submissions` stays anon-INSERT-only — nothing in this plan may add SELECT access to it. All reads go through `wms_no_shk_boxes` (already open) and `wms_no_shk_box_contents` (already granted to anon).
- `node --check` on every touched `.js` file.
- Live browser verification via each repo's static preview server: `WMSplus-main` → `.claude/launch.json` config `static` (port 8781, falls back to whatever port the preview tool actually opens); `wmsplus-intake-form` → its own `.claude/launch.json` config `static` (port 8955).
- Testing against the shared production Supabase project (`bgphllmzmlwurfnbagho`) uses obviously-labeled throwaway data, deleted immediately after each verification step — never leave test rows behind (established convention this session: test `wms_no_shk_boxes`/`intake_submissions`/`print_jobs` rows get a recognizable marker, e.g. item name `ТЕСТ_ЗАКРЫТИЕ_КОРОБА`, and are deleted right after the step that needed them).
- Reuse exact existing names, do not rename: `wms_no_shk_boxes` columns `id, box_number, box_type, area, shift_date, shift_type, outside_opp, total_items`; RPC `wms_no_shk_box_contents(p_box_id uuid)` returning `item_text, category, item_type, full_name, created_at, photo_path`; `print_jobs` columns `template_id, data, tspl, status, error_message, created_by`; `print_label_templates` columns `id, name, width_mm, height_mm, elements`.

---

### Task 1: Seed the "КГТ «Без ШК»" print label template

**Files:**
- Create: `WMSplus-main/supabase/migrations/202609100001_kgt_no_shk_label_template.sql`

**Interfaces:**
- Produces: a `print_label_templates` row named exactly `КГТ «Без ШК»`, with `elements` fields `name`, `date_line1`, `date_line2`, `area` — these exact field names are what Task 5 fills in via `data = {...}` when building the TSPL payload.

- [ ] **Step 1: Write the migration**

```sql
-- 202609100001_kgt_no_shk_label_template.sql
-- Seeds the "КГТ «Без ШК»" sticker template used by the shift-box closing
-- flow (docs/superpowers/specs/2026-09-10-shift-box-closing-design.md):
-- one sticker per КГТ item recorded that shift, carrying the item's own
-- name instead of a box number/QR (a КГТ item never goes into a box).
insert into public.print_label_templates (name, width_mm, height_mm, elements) values (
    'КГТ «Без ШК»',
    50,
    50,
    '[
        {"type":"text","field":"name","x_mm":5,"y_mm":5,"font_size":14},
        {"type":"text","field":"date_line1","x_mm":5,"y_mm":28,"font_size":20},
        {"type":"text","field":"date_line2","x_mm":5,"y_mm":36,"font_size":20},
        {"type":"text","field":"area","x_mm":5,"y_mm":44,"font_size":10}
    ]'::jsonb
);
```

- [ ] **Step 2: Apply it**

Run (from `/Users/WBwork/Downloads/WMSplus-main`):
```bash
supabase db query --linked -f supabase/migrations/202609100001_kgt_no_shk_label_template.sql
```
Expected: no error output.

- [ ] **Step 3: Verify**

Run:
```bash
supabase db query --linked "select name, width_mm, height_mm, elements from print_label_templates where name = 'КГТ «Без ШК»';"
```
Expected: one row, `elements` is a 4-item JSON array matching Step 1 exactly (field names `name`/`date_line1`/`date_line2`/`area`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202609100001_kgt_no_shk_label_template.sql
git commit -m "Seed КГТ «Без ШК» print label template"
```

---

### Task 2: Pure helpers module (`shift-close.js`) + tests

Extracting the three non-DOM decisions (time gate, the fixed QR value, and which box-contents rows need their own sticker) into a small pure module — mirroring how `print-tspl.js` already keeps TSPL-building logic separate from `no_shk_zone.js`'s DOM code — makes them runnable under plain `node`, no browser needed.

**Files:**
- Create: `wmsplus-intake-form/shift-close.js`
- Create: `wmsplus-intake-form/shift-close.test.js`

**Interfaces:**
- Produces: `SHIFT_CLOSE_QR_VALUE` (string constant), `isShiftCloseUnlocked(date: Date): boolean`, `partitionBoxContents(rows: Array<{item_type, item_text, ...}>): { kgtItems: Array }`. Task 4 (`intake.js`) loads this file via `<script>` tag and calls all three as plain globals.

- [ ] **Step 1: Write the failing test**

```js
// shift-close.test.js — run with: node shift-close.test.js
const assert = require("node:assert");
const { SHIFT_CLOSE_QR_VALUE, isShiftCloseUnlocked, partitionBoxContents } = require("./shift-close.js");

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

test("SHIFT_CLOSE_QR_VALUE matches the physical QR placed in the revision office", () => {
    assert.strictEqual(SHIFT_CLOSE_QR_VALUE, "WMSP.PLCE.WSHK.FLR");
});

test("isShiftCloseUnlocked is false before 19:30", () => {
    assert.strictEqual(isShiftCloseUnlocked(new Date(2026, 0, 1, 10, 0)), false);
    assert.strictEqual(isShiftCloseUnlocked(new Date(2026, 0, 1, 19, 29)), false);
});

test("isShiftCloseUnlocked is true from 19:30 onward, no upper bound", () => {
    assert.strictEqual(isShiftCloseUnlocked(new Date(2026, 0, 1, 19, 30)), true);
    assert.strictEqual(isShiftCloseUnlocked(new Date(2026, 0, 1, 23, 59)), true);
    assert.strictEqual(isShiftCloseUnlocked(new Date(2026, 0, 1, 3, 0)), true);
});

test("partitionBoxContents pulls out only КГТ rows, preserving order", () => {
    const rows = [
        { item_text: "Носки", item_type: "Мелкий товар" },
        { item_text: "Стол", item_type: "КГТ" },
        { item_text: "Кружка", item_type: "Мелкий товар" },
        { item_text: "Стул", item_type: "КГТ" },
    ];
    const { kgtItems } = partitionBoxContents(rows);
    assert.deepStrictEqual(kgtItems.map((r) => r.item_text), ["Стол", "Стул"]);
});

test("partitionBoxContents handles an empty/missing list", () => {
    assert.deepStrictEqual(partitionBoxContents([]).kgtItems, []);
    assert.deepStrictEqual(partitionBoxContents(undefined).kgtItems, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node wmsplus-intake-form/shift-close.test.js`
Expected: `Error: Cannot find module './shift-close.js'` (file doesn't exist yet).

- [ ] **Step 3: Write the module**

```js
// shift-close.js — pure helpers for the end-of-shift box-closing flow
// (docs/superpowers/specs/2026-09-10-shift-box-closing-design.md). No
// DOM/network, loaded as a plain global-scope <script> like print-tspl.js.

// The physical QR code placed in the revision office ("кабинет ревизии")
// that confirms the worker is physically there before printing/closing.
const SHIFT_CLOSE_QR_VALUE = "WMSP.PLCE.WSHK.FLR";

// Hard gate: the shift counter only becomes tappable from 19:30 local
// time onward (day-shift closing window), no upper bound -- it stays
// tappable through the rest of the day and night until used.
function isShiftCloseUnlocked(date) {
    return (date.getHours() * 60 + date.getMinutes()) >= (19 * 60 + 30);
}

// Splits wms_no_shk_box_contents() rows into the ones that need their own
// КГТ sticker vs everything else, which the box's own single sticker
// already covers (a КГТ item never goes into the box itself).
function partitionBoxContents(rows) {
    const kgtItems = [];
    for (const row of (rows || [])) {
        if (row.item_type === "КГТ") kgtItems.push(row);
    }
    return { kgtItems };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { SHIFT_CLOSE_QR_VALUE, isShiftCloseUnlocked, partitionBoxContents };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node wmsplus-intake-form/shift-close.test.js`
Expected: five `PASS` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add shift-close.js shift-close.test.js
git commit -m "Add pure helpers for the shift-box closing flow"
```

---

### Task 3: Copy `print-tspl.js` into `wmsplus-intake-form`

This repo has never needed to build a TSPL payload before (only `WMSplus-main` prints). The two repos share no module system (two separate static sites), so this is a verbatim copy, same as how `SUPABASE_URL`/`SUPABASE_ANON_KEY` are already duplicated across both repos rather than shared.

**Files:**
- Create: `wmsplus-intake-form/print-tspl.js` (byte-identical copy of `WMSplus-main/print-tspl.js`)
- Modify: `wmsplus-intake-form/index.html` (add script tag)

**Interfaces:**
- Produces: global `buildTsplPayloadBase64(template, data): string` — Task 5 calls this once per print job.

- [ ] **Step 1: Copy the file**

```bash
cp /Users/WBwork/Downloads/WMSplus-main/print-tspl.js /Users/WBwork/Downloads/wmsplus-intake-form/print-tspl.js
```

- [ ] **Step 2: Verify it still passes its own tests unmodified**

```bash
cp /Users/WBwork/Downloads/WMSplus-main/print-tspl.test.js /Users/WBwork/Downloads/wmsplus-intake-form/print-tspl.test.js
node /Users/WBwork/Downloads/wmsplus-intake-form/print-tspl.test.js
```
Expected: all `PASS` lines, exit code 0. (Copying the test file too keeps this module verifiable in its new home the same way it already is in `WMSplus-main`; both copies stay in sync only in that they were identical at copy time — acceptable given neither repo has a shared-package mechanism.)

- [ ] **Step 3: Load it on the page**

In `wmsplus-intake-form/index.html`, add the script tag right before the existing `intake.js` tag (so `buildTsplPayloadBase64` and `shift-close.js`'s exports are both global by the time `intake.js` runs):

```html
<script src="shift-close.js"></script>
<script src="print-tspl.js"></script>
<script src="intake.js"></script>
```

- [ ] **Step 4: `node --check`**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/print-tspl.js
```
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add print-tspl.js print-tspl.test.js index.html
git commit -m "Copy print-tspl.js from WMSplus-main for shift-box closing"
```

---

### Task 4: Tappable counter + "Закрыть коробку" screen (incl. N=0 case)

**Files:**
- Modify: `wmsplus-intake-form/index.html`
- Modify: `wmsplus-intake-form/intake.js`

**Interfaces:**
- Consumes: `isShiftCloseUnlocked` (Task 2), existing `computeShift()`, `state.area`, `showScreen(id)`, the existing `screens` array, the existing `[data-shift-counter]` elements (`intake.js:52` `refreshShiftCounter`).
- Produces: module-level state `shiftCloseBoxId`, `shiftCloseBoxNumber`, `shiftCloseShift`, `shiftCloseReturnTo` — Task 5/6 read these. Screen `screenShiftClose`.

- [ ] **Step 1: Add CSS for the tappable state**

In `wmsplus-intake-form/index.html`, right after the existing `.shift-counter { ... }` block (around line 191-204):

```css
.shift-counter.is-tappable {
    cursor: pointer;
    color: var(--accent);
    border-color: var(--accent);
}
```

- [ ] **Step 2: Add the new screen markup**

In `wmsplus-intake-form/index.html`, insert right after the `screenTakeToHub` section (before `screenSuccess`):

```html
<section id="screenShiftClose" class="screen">
    <div id="areaPillClose" class="area-pill"><span id="areaPillCloseText"></span> ✎</div>
    <div id="shiftHeaderClose" class="shift-header"></div>
    <button id="backToPhotoFromCloseBtn" class="back-btn" type="button">←</button>
    <div class="screen-card" style="text-align:center;">
        <h1>Закрыть коробку</h1>
        <p id="shiftCloseCount" style="margin:0 0 16px;font-size:14px;"></p>
        <button id="shiftCloseStartBtn" class="primary-btn" type="button" style="display:none;">Закрыть коробку</button>
        <div id="shiftCloseMsg" class="msg"></div>
    </div>
</section>
```

- [ ] **Step 3: Wire the counter's tap + the pill/back-button chrome**

In `wmsplus-intake-form/intake.js`, extend the existing area-pill wiring arrays (around lines 157-159 and 390-393) to include the new screen's pill, so the pencil-click-to-change-area affordance stays consistent with every other screen:

```js
// intake.js:157-159 -- add 'areaPillCloseText' to the existing array
[
    'areaPillEntryText', 'areaPillTypeText', 'areaPillCategoryText', 'areaPillNameText',
    'areaPillPhotoText', 'areaPillStickerText', 'areaPill2ShkText', 'areaPillEmptyText',
    'areaPillStickerSavedText', 'areaPillInstrText', 'areaPillHubText', 'areaPillCloseText',
].forEach((id) => {
    document.getElementById(id).textContent = state.area || '';
});
```

```js
// intake.js:390-393 -- add 'areaPillClose' to the existing array
[
    'areaPillEntry', 'areaPillType', 'areaPillCategory', 'areaPillName',
    'areaPillPhoto', 'areaPillSticker', 'areaPill2Shk', 'areaPillEmpty',
    'areaPillStickerSaved', 'areaPillInstr', 'areaPillHub', 'areaPillClose',
].forEach((id) => {
    document.getElementById(id).addEventListener('click', () => {
        stopQrScan();
        showScreen('screenArea');
    });
});
```

Then add the counter-tap wiring and the new screen's own state/handlers, right after `finalizeSubmit` and the `againBtn` handler (after `intake.js:768`):

```js
// ---------- Shift-box closing (end-of-shift, 19:30+) ----------
let shiftCloseReturnTo = 'screenItemType';
let shiftCloseBoxId = null;
let shiftCloseBoxNumber = null;
let shiftCloseShift = null;

document.querySelectorAll('[data-shift-counter]').forEach((el) => {
    el.addEventListener('click', () => {
        if (!el.classList.contains('is-tappable')) return;
        const active = screens.find((s) => s.classList.contains('is-active'));
        if (active) shiftCloseReturnTo = active.id;
        void openShiftClose();
    });
});

async function openShiftClose() {
    showScreen('screenShiftClose');
    const countLine = document.getElementById('shiftCloseCount');
    const startBtn = document.getElementById('shiftCloseStartBtn');
    const msg = document.getElementById('shiftCloseMsg');
    msg.textContent = '';
    msg.className = 'msg';
    startBtn.style.display = 'none';
    countLine.textContent = 'Проверяю...';
    const shift = computeShift();
    const { data, error } = await supabaseClient
        .from('wms_no_shk_boxes')
        .select('id,total_items,box_number')
        .eq('area', state.area)
        .eq('shift_date', shift.date)
        .eq('shift_type', shift.type)
        .eq('outside_opp', true)
        .maybeSingle();
    if (error || !data || !data.total_items) {
        countLine.textContent = 'Нечего закрывать.';
        return;
    }
    shiftCloseBoxId = data.id;
    shiftCloseBoxNumber = data.box_number;
    shiftCloseShift = shift;
    countLine.textContent = 'За смену зафиксировано: ' + data.total_items;
    startBtn.style.display = '';
}

document.getElementById('backToPhotoFromCloseBtn').addEventListener('click', () => {
    showScreen(shiftCloseReturnTo);
});
```

- [ ] **Step 4: Fold the gate + tap-affordance into the existing counter refresh**

Modify `refreshShiftCounter` (`intake.js:52-72`) to compute and apply the tappable state on every refresh (same cadence it already runs at — screen entry + after each submission):

```js
async function refreshShiftCounter() {
    const els = document.querySelectorAll('[data-shift-counter]');
    if (!els.length) return;
    if (!state.area || state.area === 'Упаковка') {
        els.forEach((el) => { el.style.display = 'none'; });
        return;
    }
    const shift = computeShift();
    const { data, error } = await supabaseClient
        .from('wms_no_shk_boxes')
        .select('total_items')
        .eq('area', state.area)
        .eq('shift_date', shift.date)
        .eq('shift_type', shift.type)
        .eq('outside_opp', true)
        .maybeSingle();
    const count = error || !data ? 0 : data.total_items;
    const unlocked = isShiftCloseUnlocked(new Date());
    els.forEach((el) => {
        el.style.display = '';
        el.textContent = 'За смену зафиксировано: ' + count;
        el.classList.toggle('is-tappable', unlocked);
    });
}
```

(Only the last four lines change — `count`/`unlocked` computed once, then applied via `classList.toggle` alongside the existing `textContent` line.)

- [ ] **Step 5: `node --check`**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```
Expected: no output.

- [ ] **Step 6: Live-verify with throwaway data**

```bash
supabase db query --linked "insert into wms_no_shk_boxes (box_number, area, shift_date, shift_type, outside_opp, total_items, responsible_name) values (999901, 'ХАБ', current_date, 'Дневная', true, 3, 'ТЕСТ_ЗАКРЫТИЕ') returning id;"
```
Note the returned `id` for cleanup later.

Open `wmsplus-intake-form/index.html` on the repo's static preview server (port 8955). In the browser console:
```js
localStorage.setItem('wmsplus_intake_employee_id', '1');
localStorage.setItem('wmsplus_intake_full_name', 'Тест Тестов');
localStorage.setItem('wmsplus_intake_area', 'ХАБ');
```
Reload, navigate to `screenItemType` (pick "Товар без ШК" on the entry screen). The counter should read "За смену зафиксировано: 3".

Force the unlocked state for testing (real 19:30 may not have arrived yet) by temporarily running in the console:
```js
document.querySelectorAll('[data-shift-counter]').forEach((el) => el.classList.add('is-tappable'));
```
Click the counter. Expected: navigates to `screenShiftClose`, shows "За смену зафиксировано: 3" and a visible "Закрыть коробку" button. Click the back arrow — expected: returns to `screenItemType`.

Then verify the N=0 path: 
```bash
supabase db query --linked "update wms_no_shk_boxes set outside_opp=false where box_number=999901;"
```
Reload the page, repeat the counter click. Expected: counter reads "За смену зафиксировано: 0" and clicking it (after re-forcing `is-tappable`) shows "Нечего закрывать." with no button.

Clean up:
```bash
supabase db query --linked "delete from wms_no_shk_boxes where box_number=999901;"
```

- [ ] **Step 7: Commit**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add index.html intake.js
git commit -m "Add tappable shift counter and Закрыть коробку screen"
```

---

### Task 5: QR-scan slide for the revision-office location

**Files:**
- Modify: `wmsplus-intake-form/index.html`
- Modify: `wmsplus-intake-form/intake.js`

**Interfaces:**
- Consumes: `SHIFT_CLOSE_QR_VALUE` (Task 2), `jsQR` global (already loaded), `showScreen`.
- Produces: screen `screenShiftCloseQr`; calls `runShiftClosePrint()` (stubbed here, implemented for real in Task 6) on a successful scan.

- [ ] **Step 1: Add the screen markup**

In `wmsplus-intake-form/index.html`, right after `screenShiftClose`:

```html
<section id="screenShiftCloseQr" class="screen">
    <div id="areaPillCloseQr" class="area-pill"><span id="areaPillCloseQrText"></span> ✎</div>
    <div id="shiftHeaderCloseQr" class="shift-header"></div>
    <button id="backToCloseFromQrBtn" class="back-btn" type="button">←</button>
    <div class="screen-card" style="text-align:center;">
        <h1>Отсканируйте QR-код в кабинете ревизии</h1>
        <video id="closeQrVideo" playsinline muted style="width:100%;max-width:320px;border-radius:var(--radius-md);background:#000;"></video>
        <canvas id="closeQrCanvas" style="display:none;"></canvas>
        <div id="closeQrMsg" class="msg"></div>
        <button id="retryCloseQrScanBtn" class="secondary-btn" type="button">Попробовать снова</button>
    </div>
</section>
```

Add `'areaPillCloseQrText'` and `'areaPillCloseQr'` to the same two wiring arrays touched in Task 4 Step 3 (both already-modified lists).

- [ ] **Step 2: Wire the "Закрыть коробку" button to start the scan**

In `intake.js`, right after the `backToPhotoFromCloseBtn` handler added in Task 4:

```js
document.getElementById('shiftCloseStartBtn').addEventListener('click', () => {
    showScreen('screenShiftCloseQr');
    startCloseQrScan();
});
```

- [ ] **Step 3: Write the scan loop**

Mirrors `startQrScan`/`scanQrFrame`/`stopQrScan` (`intake.js:593-663`) exactly, with new element ids and fixed-value validation instead of the `"*"`-prefix sticker check:

```js
const closeQrMsg = document.getElementById('closeQrMsg');
let closeQrStream = null;
let closeQrAnimFrame = null;
let closeQrScanCancelled = false;

function stopCloseQrScan() {
    closeQrScanCancelled = true;
    if (closeQrAnimFrame) {
        cancelAnimationFrame(closeQrAnimFrame);
        closeQrAnimFrame = null;
    }
    if (closeQrStream) {
        closeQrStream.getTracks().forEach((t) => t.stop());
        closeQrStream = null;
    }
}

async function startCloseQrScan() {
    closeQrScanCancelled = false;
    closeQrMsg.textContent = '';
    closeQrMsg.className = 'msg';
    if (typeof jsQR === 'undefined') {
        closeQrMsg.textContent = 'Не удалось загрузить сканер QR. Проверьте подключение к интернету и обновите страницу.';
        closeQrMsg.className = 'msg is-error';
        return;
    }
    const video = document.getElementById('closeQrVideo');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (closeQrScanCancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
        }
        closeQrStream = stream;
        video.srcObject = closeQrStream;
        await video.play();
        if (closeQrScanCancelled) return;
        closeQrAnimFrame = requestAnimationFrame(scanCloseQrFrame);
    } catch (err) {
        if (closeQrScanCancelled) return;
        closeQrMsg.textContent = 'Не удалось открыть камеру: ' + (err.message || 'нет доступа');
        closeQrMsg.className = 'msg is-error';
    }
}

function scanCloseQrFrame() {
    const video = document.getElementById('closeQrVideo');
    const canvas = document.getElementById('closeQrCanvas');
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
            if (code.data !== SHIFT_CLOSE_QR_VALUE) {
                closeQrMsg.textContent = 'Это не тот QR-код. Отсканируйте QR в кабинете ревизии.';
                closeQrMsg.className = 'msg is-error';
                closeQrAnimFrame = requestAnimationFrame(scanCloseQrFrame);
                return;
            }
            stopCloseQrScan();
            void runShiftClosePrint();
            return;
        }
    }
    closeQrAnimFrame = requestAnimationFrame(scanCloseQrFrame);
}

document.getElementById('backToCloseFromQrBtn').addEventListener('click', () => {
    stopCloseQrScan();
    showScreen('screenShiftClose');
});

document.getElementById('retryCloseQrScanBtn').addEventListener('click', () => startCloseQrScan());
```

- [ ] **Step 4: Temporary stub so this task is testable before Task 6 exists**

Add a placeholder just above the code from Step 3 (Task 6 replaces this entire function body):

```js
async function runShiftClosePrint() {
    showScreen('screenShiftClose');
    document.getElementById('shiftCloseMsg').textContent = '(печать ещё не реализована — Task 6)';
}
```

- [ ] **Step 5: `node --check`**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```

- [ ] **Step 6: Live-verify**

Using the same throwaway box row and `localStorage` setup as Task 4 Step 6 (re-insert it if you cleaned it up already), reach `screenShiftClose` and click "Закрыть коробку". Expected: `screenShiftCloseQr` opens, browser prompts for camera permission, video feed appears.

Point the camera at any QR code that is **not** `WMSP.PLCE.WSHK.FLR` (e.g. generate one at any online QR generator with text "test", or use an existing sticker QR) — expected: red error "Это не тот QR-код...", scanning continues (video keeps running).

Generate a QR containing exactly `WMSP.PLCE.WSHK.FLR` (any QR generator, e.g. `qr-code-generator.com`, text input) and scan it — expected: camera stops, screen shows the Step 4 stub message "(печать ещё не реализована — Task 6)".

Click the back arrow from `screenShiftCloseQr` mid-scan (before completing) — expected: camera stops (check the browser's tab/camera indicator turns off), returns to `screenShiftClose`.

Clean up the throwaway box row:
```bash
supabase db query --linked "delete from wms_no_shk_boxes where box_number=999901;"
```

- [ ] **Step 7: Commit**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add index.html intake.js
git commit -m "Add QR-scan slide for shift-box closing location check"
```

---

### Task 6: Fetch contents, print, and complete (success/failure)

**Files:**
- Modify: `wmsplus-intake-form/index.html`
- Modify: `wmsplus-intake-form/intake.js`

**Interfaces:**
- Consumes: `partitionBoxContents` (Task 2), `buildTsplPayloadBase64` (Task 3), `shiftCloseBoxId`/`shiftCloseBoxNumber`/`shiftCloseShift` (Task 4), the `wms_no_shk_box_contents` RPC, `print_label_templates` rows `Короб «Без ШК»` (pre-existing) and `КГТ «Без ШК»` (Task 1).
- Produces: replaces the Task 5 Step 4 stub `runShiftClosePrint()` with the real implementation; on full success, sets `wms_no_shk_boxes.outside_opp = false` for `shiftCloseBoxId`.

- [ ] **Step 1: Add the print-progress screen markup**

In `wmsplus-intake-form/index.html`, right after `screenShiftCloseQr`:

```html
<section id="screenShiftClosePrint" class="screen">
    <div class="screen-card" style="text-align:center;">
        <h1>Печать стикеров</h1>
        <div id="shiftClosePrintList" style="text-align:left;font-size:14px;margin:0 0 16px;"></div>
        <div id="shiftClosePrintMsg" class="msg"></div>
        <button id="shiftClosePrintRetryBtn" class="primary-btn" type="button" style="display:none;">Попробовать снова</button>
    </div>
</section>
```

- [ ] **Step 2: Replace the Task 5 stub**

In `intake.js`, delete the Task 5 Step 4 stub body and replace `runShiftClosePrint` (plus its two small date-formatting helpers and the completion function) with:

```js
function formatDateShortClose(isoDate) {
    const parts = String(isoDate).split('-');
    if (parts.length !== 3) return String(isoDate);
    return parts[2] + '.' + parts[1] + '.' + parts[0].slice(2);
}

function addDaysClose(isoDate, days) {
    const d = new Date(isoDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

let boxLabelTemplateForClose = null;
let kgtLabelTemplate = null;

async function loadCloseTemplates() {
    if (!boxLabelTemplateForClose) {
        const { data } = await supabaseClient.from('print_label_templates').select('id,width_mm,height_mm,elements').eq('name', 'Короб «Без ШК»').maybeSingle();
        boxLabelTemplateForClose = data || null;
    }
    if (!kgtLabelTemplate) {
        const { data } = await supabaseClient.from('print_label_templates').select('id,width_mm,height_mm,elements').eq('name', 'КГТ «Без ШК»').maybeSingle();
        kgtLabelTemplate = data || null;
    }
}

async function finishShiftClosePrint(anyFailed, msg, retryBtn) {
    if (anyFailed) {
        msg.textContent = 'Не всё напечаталось. Проверьте принтер и попробуйте ещё раз.';
        msg.className = 'msg is-error';
        retryBtn.style.display = '';
        return;
    }
    const { error } = await supabaseClient.from('wms_no_shk_boxes').update({ outside_opp: false }).eq('id', shiftCloseBoxId);
    if (error) {
        msg.textContent = 'Стикеры напечатаны, но не удалось закрыть короб: ' + error.message;
        msg.className = 'msg is-error';
        retryBtn.style.display = '';
        return;
    }
    msg.textContent = 'Готово! Короб закрыт.';
    msg.className = 'msg';
    setTimeout(() => { showScreen('screenEntryType'); }, 1500);
}

async function runShiftClosePrint() {
    showScreen('screenShiftClosePrint');
    const list = document.getElementById('shiftClosePrintList');
    const msg = document.getElementById('shiftClosePrintMsg');
    const retryBtn = document.getElementById('shiftClosePrintRetryBtn');
    retryBtn.style.display = 'none';
    msg.textContent = '';
    msg.className = 'msg';
    list.textContent = 'Готовлю печать...';

    await loadCloseTemplates();
    if (!boxLabelTemplateForClose) {
        list.textContent = '';
        msg.textContent = 'Шаблон этикетки «Короб «Без ШК»» не найден.';
        msg.className = 'msg is-error';
        retryBtn.style.display = '';
        return;
    }

    const { data: contentRows, error: contentsError } = await supabaseClient.rpc('wms_no_shk_box_contents', { p_box_id: shiftCloseBoxId });
    if (contentsError) {
        list.textContent = '';
        msg.textContent = 'Не удалось прочитать содержимое короба: ' + contentsError.message;
        msg.className = 'msg is-error';
        retryBtn.style.display = '';
        return;
    }
    const { kgtItems } = partitionBoxContents(contentRows || []);
    if (kgtItems.length && !kgtLabelTemplate) {
        list.textContent = '';
        msg.textContent = 'Шаблон этикетки «КГТ «Без ШК»» не найден.';
        msg.className = 'msg is-error';
        retryBtn.style.display = '';
        return;
    }

    const dateLine1 = formatDateShortClose(shiftCloseShift.date);
    const dateLine2 = shiftCloseShift.type === 'Ночная' ? formatDateShortClose(addDaysClose(shiftCloseShift.date, 1)) : '';

    const jobsToCreate = [{
        label: 'Короб',
        template: boxLabelTemplateForClose,
        data: {
            box_code: 'WMSP.BOX.' + String(shiftCloseBoxNumber).padStart(5, '0'),
            box_number: String(shiftCloseBoxNumber),
            box_type: 'Короб',
            area: state.area,
            date_line1: dateLine1,
            date_line2: dateLine2,
            shift: shiftCloseShift.type === 'Ночная' ? 'Ночь' : 'День',
        },
    }];
    kgtItems.forEach((item, i) => {
        jobsToCreate.push({
            label: 'КГТ ' + (i + 1) + ' из ' + kgtItems.length,
            template: kgtLabelTemplate,
            data: { name: item.item_text, area: state.area, date_line1: dateLine1, date_line2: dateLine2 },
        });
    });

    list.innerHTML = '';
    const jobRows = jobsToCreate.map((j) => {
        const row = document.createElement('div');
        row.textContent = j.label + ': в очереди...';
        list.appendChild(row);
        return { ...j, rowEl: row, jobId: null };
    });

    let insertError = null;
    for (const job of jobRows) {
        const tspl = buildTsplPayloadBase64(job.template, job.data);
        const { data: inserted, error } = await supabaseClient
            .from('print_jobs')
            .insert({ template_id: job.template.id, data: job.data, tspl, created_by: state.employeeId != null ? String(state.employeeId) : null })
            .select('id,status')
            .single();
        if (error) {
            insertError = error;
            job.rowEl.textContent = job.label + ': ошибка постановки в очередь (' + error.message + ')';
            continue;
        }
        job.jobId = inserted.id;
        job.rowEl.textContent = job.label + ': печатаю...';
    }
    if (insertError) {
        msg.textContent = 'Не удалось поставить все стикеры в очередь.';
        msg.className = 'msg is-error';
        retryBtn.style.display = '';
        return;
    }

    msg.textContent = 'Печатаю...';
    let remaining = jobRows.length;
    let anyFailed = false;
    jobRows.forEach((job) => {
        const channel = supabaseClient
            .channel('shift_close_print_job_' + job.jobId)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'print_jobs', filter: 'id=eq.' + job.jobId }, (payload) => {
                const row = payload.new;
                if (row.status === 'printed') {
                    job.rowEl.textContent = job.label + ': напечатано ✓';
                } else if (row.status === 'failed') {
                    job.rowEl.textContent = job.label + ': ошибка (' + (row.error_message || 'неизвестная ошибка') + ')';
                    anyFailed = true;
                } else {
                    return;
                }
                remaining -= 1;
                supabaseClient.removeChannel(channel);
                if (remaining === 0) void finishShiftClosePrint(anyFailed, msg, retryBtn);
            })
            .subscribe();
    });
}

document.getElementById('shiftClosePrintRetryBtn').addEventListener('click', () => {
    void runShiftClosePrint();
});
```

- [ ] **Step 3: `node --check`**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```

- [ ] **Step 4: Live-verify the happy path (no real printer needed — a fake TCP listener stands in, same technique the original print-bridge plan used for its own Task 7)**

Start a throwaway TCP listener standing in for the printer, so `print_jobs` rows actually reach `status = 'printed'` without needing real hardware:
```bash
node -e "require('net').createServer((s) => { s.on('data', () => {}); s.end(); }).listen(19100, () => console.log('fake printer up on 19100'));"
```
Leave that running in one terminal. In another, start a bridge instance pointed at it (using the already-shipped `print-bridge/`):
```bash
cd /Users/WBwork/Downloads/WMSplus-main/print-bridge
PRINTER_IP=127.0.0.1 PRINTER_PORT=19100 node index.js
```
(Uses the same `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` already in `print-bridge/.env` — only `PRINTER_IP`/`PORT` are overridden via env vars for this test run, which take precedence over `.env`'s values per `dotenv`'s own-process-env-wins behavior confirmed earlier this session.)

Seed a throwaway forming box with one small item and two КГТ items directly in the database (simulating what the form would have written over a shift):
```bash
supabase db query --linked "
insert into wms_no_shk_boxes (box_number, area, shift_date, shift_type, outside_opp, total_items, responsible_name)
values (999902, 'ХАБ', current_date, 'Дневная', true, 3, 'ТЕСТ_ЗАКРЫТИЕ')
returning id;"
```
Note the returned box id as `<BOX_ID>`, then:
```bash
supabase db query --linked "
insert into intake_submissions (id, item_text, employee_id, full_name, area, item_type, category, shift_date, shift_type, no_shk_bucket, box_id) values
(gen_random_uuid(), 'ТЕСТ Носки', 1, 'Тест Тестов', 'ХАБ', 'Мелкий товар', 'Одежда', current_date, 'Дневная', 'Короб смены', '<BOX_ID>'),
(gen_random_uuid(), 'ТЕСТ Стол', 1, 'Тест Тестов', 'ХАБ', 'КГТ', 'Мебель', current_date, 'Дневная', 'Короб смены', '<BOX_ID>'),
(gen_random_uuid(), 'ТЕСТ Стул', 1, 'Тест Тестов', 'ХАБ', 'КГТ', 'Мебель', current_date, 'Дневная', 'Короб смены', '<BOX_ID>');"
```

In the browser (same `localStorage` setup as Task 4/5), reach `screenShiftClose` (box_number `999902` now shows "За смену зафиксировано: 3"), click through to the QR scan, scan a QR containing `WMSP.PLCE.WSHK.FLR`.

Expected on `screenShiftClosePrint`: three rows — "Короб: печатаю..." then "Короб: напечатано ✓"; "КГТ 1 из 2: ..." then "✓"; "КГТ 2 из 2: ..." then "✓" — followed by "Готово! Короб закрыт." and an automatic return to `screenEntryType` after ~1.5s.

Verify in the database:
```bash
supabase db query --linked "select data, status from print_jobs where created_at > now() - interval '2 minutes' order by created_at;"
supabase db query --linked "select outside_opp from wms_no_shk_boxes where box_number=999902;"
```
Expected: three `print_jobs` rows, all `status='printed'`, one with `data->>'box_number'='999902'` and two with `data->>'name'` equal to `ТЕСТ Стол`/`ТЕСТ Стул`; `outside_opp` is now `false`.

- [ ] **Step 5: Live-verify the failure path**

Stop the fake-printer listener (Ctrl+C on the `node -e` process from Step 4) and stop the test bridge instance too, but re-seed a fresh throwaway box the same way (Step 4's two `insert` blocks, `box_number` `999903` this time) so there's something to close again. Repeat the QR-scan flow.

Expected: after ~10s (the bridge's own socket timeout) each row shows "ошибка (Таймаут соединения с принтером...)", the screen shows "Не всё напечаталось. Проверьте принтер и попробуйте ещё раз." and a visible "Попробовать снова" button. Verify `outside_opp` is still `true` for `box_number=999903` (the box was *not* closed).

You'll need the fake-printer listener and a bridge instance running again to actually retry successfully — restart both (Step 4's first two commands), click "Попробовать снова", confirm it now succeeds and `outside_opp` flips to `false`.

- [ ] **Step 6: Clean up all test data**

```bash
supabase db query --linked "delete from print_jobs where data->>'area' = 'ХАБ' and (data->>'box_number' in ('999902','999903') or data->>'name' in ('ТЕСТ Стол','ТЕСТ Стул'));"
supabase db query --linked "delete from intake_submissions where item_text like 'ТЕСТ %';"
supabase db query --linked "delete from wms_no_shk_boxes where box_number in (999901,999902,999903);"
```
Stop the fake-printer `node -e` process and the test `print-bridge` instance (Ctrl+C both) — this was a throwaway test run, not the real deployed bridge.

- [ ] **Step 7: Commit**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add index.html intake.js
git commit -m "Print box + КГТ stickers and close the box on shift-close"
```

---

### Task 7: On-site verification against the real printer and physical QR (manual, human-executed)

**Files:** none — this task produces no code. Nobody executing Tasks 1-6 from this environment has the real printer or a physical `WMSP.PLCE.WSHK.FLR` QR code placed in the revision office to scan. **Do not mark this task done by reasoning about it** — it requires being physically on-site.

- [ ] **Step 1: Print and place the location QR**

Generate a QR code containing exactly the text `WMSP.PLCE.WSHK.FLR` (any QR generator/printer works for this one — it's a fixed reference sticker, not a `print_jobs` job) and place it somewhere clearly visible in the revision office ("кабинет ревизии").

- [ ] **Step 2: Run one real end-to-end close**

During a real (or deliberately test) shift on the ХАБ area, log at least one "Мелкий товар" and one "КГТ" item through the normal "Товар без ШК" flow so a forming box with both kinds of contents exists. After 19:30, tap the counter, go through "Закрыть коробку" → scan the real physical QR from Step 1 → confirm the box sticker and the КГТ sticker(s) physically print correctly (position/size/Cyrillic rendering — the same DIRECTION/CODEPAGE concerns already resolved for the existing box template apply here too, since the КГТ template reuses the identical `SIZE`/`GAP`/`DIRECTION`/`CODEPAGE` preamble from `print-tspl.js`).

- [ ] **Step 3: Confirm the box closed**

In the admin "Без ШК" zone (`no_shk_zone.js`), confirm the box that was just closed now shows under "На полу" (not "Вне ОПП") — same as if "Принесено" had been clicked manually.

- [ ] **Step 4: Note any on-site corrections**

If the КГТ sticker's text position/size needs adjusting for the real label stock, do it via `print_templates_admin.html` (no code change needed — the template lives in `print_label_templates`, editable there per the original print-bridge design). If something more fundamental is wrong (wrong DPI, wrong label gap), that would need a `print-tspl.js` constant change in *both* repos (`WMSplus-main` and `wmsplus-intake-form`, since Task 3 made a standalone copy) — not expected, since both templates share the same already-confirmed `PRINTER_DPI`/`GAP` constants, but call it out explicitly if it happens.
