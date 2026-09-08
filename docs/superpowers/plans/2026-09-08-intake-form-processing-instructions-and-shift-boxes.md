# Intake Form: Processing Instructions & Shift Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add slide-by-slide TSD processing instructions to the public
intake form (Шредер / Упаковка / leaking household chemicals), and
automatic per-shift storage-box addressing in the "Без ШК" zone for every
item that doesn't need one of those instructions.

**Architecture:** Two repos sharing one Supabase project
(`bgphllmzmlwurfnbagho`). Schema changes are SQL migrations in
`WMSplus-main/supabase/migrations/`. The public form's own UI/logic lives
in `wmsplus-intake-form/index.html` + `intake.js` (no build step, CDN
script tags). The staff-facing "Без ШК" zone UI lives in
`WMSplus-main/no_shk_zone.js` (rendered inside `tasks.html`). Sequenced in
two phases matching the spec's Part A / Part B split — Phase 1 (Tasks
1-5) ships the instruction screens and is independently testable via the
public form alone; Phase 2 (Tasks 6-8) adds shift boxes on top and is
independently testable via the form's counter plus the zone admin page.
Task 9 is a manual, hardware-dependent check nobody in this session can
perform remotely.

**Tech Stack:** Plain HTML/CSS/JS (no framework, no build step),
`@supabase/supabase-js@2` via CDN (already present), `qrcodejs` via CDN
(new — QR rendering), PostgreSQL/PostgREST (Supabase), Supabase CLI.

**Spec:** [docs/superpowers/specs/2026-09-08-intake-form-processing-instructions-and-shift-boxes-design.md](../specs/2026-09-08-intake-form-processing-instructions-and-shift-boxes-design.md)

## Global Constraints

- No build step in either repo — new dependencies load via CDN `<script>`
  tag, same pattern as the existing `@supabase/supabase-js@2` and `jsQR`
  tags in `wmsplus-intake-form/index.html`.
- All new interactive elements use `data-*` attribute selectors, never
  the shared `.area-btn`/`.primary-btn` classes alone for JS
  identification (project convention).
- `node --check <file>.js` after every JS edit in both repos.
- SQL migrations live in `WMSplus-main/supabase/migrations/`, named
  `YYYYMMDDNNNN_<slug>.sql`, even when the tables they touch are read
  from the separate `wmsplus-intake-form` repo (both point at the same
  Supabase project).
- Migrations are applied with (from `/Users/WBwork/Downloads/WMSplus-main`):
  ```bash
  supabase link --project-ref bgphllmzmlwurfnbagho
  supabase db query --linked -f supabase/migrations/<file>.sql
  ```
  (never `supabase db push` — blocked in this project by a pre-existing
  migration-ledger conflict, per established convention).
- `intake_submissions` stays insert-only for the `anon` role — no task
  in this plan may add a SELECT policy for anon on that table. Aggregate
  reads (counts, responsible-person) go through the
  `wms_no_shk_box_log_item` SQL function (Task 6) instead, which only
  ever touches `wms_no_shk_boxes` (already fully open to anon).
- Priority when more than one instruction-trigger applies to the same
  item: **Шредер > Бытовая химия (Товар льётся) > участок Упаковка**.
- QR code values by area: ХАБ → МХ `PLCE1034816435` / тара
  `WCT1000100010`; Упаковка → МХ `PLCE1034816436` / тара `WCT700100010`.
- Live browser verification (Claude Browser tools against
  `https://wmsplus.github.io/` or a local static server for
  `wmsplus-intake-form`; against this repo's `tasks.html` preview for
  `no_shk_zone.js`) for anything UI-facing.
- Before every `git push` in either repo: `git fetch origin main && git
  log --oneline origin/main..main` to check for a concurrent session's
  interleaved commits.

---

## Task 1: Migration — `intake_submissions` shift/bucket columns

**Repo:** `WMSplus-main`

**Files:**
- Create: `supabase/migrations/202609080001_intake_submissions_shift_bucket_fields.sql`

**Interfaces:**
- Produces: three new nullable columns on `public.intake_submissions` —
  `shift_date date`, `shift_type text` (checked against `'Дневная'`/
  `'Ночная'`), `no_shk_bucket text` (checked against `'Короб смены'`,
  `'Брак Бытовая химия'`, `'Товар с переупаковки'`, `'Шредер'`). Task 2
  populates all three on every "Товар без ШК" insert.

- [ ] **Step 1: Write the migration file**

```sql
-- 202609080001_intake_submissions_shift_bucket_fields.sql
-- Shift storage addressing (see
-- docs/superpowers/specs/2026-09-08-intake-form-processing-instructions-and-shift-boxes-design.md).
-- Every "Товар без ШК" submission now records which shift it belongs to
-- (same 8:00/20:00 boundary the form's header already computes) and which
-- accounting bucket it falls into: 'Короб смены' for anything that didn't
-- need a sticker (counted into a per-area shift box, Task 6-7), or one of
-- the three named buckets for anything that did (bookkeeping label only
-- in this phase -- no viewer UI yet). Nullable: 2ШК/Пустая упаковка rows
-- never touch this table, and existing rows predate this feature.
alter table public.intake_submissions
    add column shift_date date,
    add column shift_type text check (shift_type in ('Дневная', 'Ночная')),
    add column no_shk_bucket text check (no_shk_bucket in (
        'Короб смены', 'Брак Бытовая химия', 'Товар с переупаковки', 'Шредер'
    ));
```

- [ ] **Step 2: Apply the migration**

Run (from `/Users/WBwork/Downloads/WMSplus-main`):
```bash
supabase link --project-ref bgphllmzmlwurfnbagho
supabase db query --linked -f supabase/migrations/202609080001_intake_submissions_shift_bucket_fields.sql
```
Expected: no error output.

- [ ] **Step 3: Verify columns and constraints**

```bash
supabase db query --linked "select column_name, data_type from information_schema.columns where table_name = 'intake_submissions' and column_name in ('shift_date','shift_type','no_shk_bucket') order by column_name;"
```
Expected: 3 rows (`no_shk_bucket`/text, `shift_date`/date, `shift_type`/text).

Then confirm the anon REST path accepts a valid value and rejects an
invalid one:
```bash
ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q'

curl -s -o /dev/null -w "valid bucket status: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":"Task1 verify valid","employee_id":1,"category":"Посылка","photo_path":"task1-verify-ok.png","full_name":"Тест Task1","area":"ХАБ","item_type":"Мелкий товар","shift_date":"2026-09-08","shift_type":"Дневная","no_shk_bucket":"Короб смены"}'

curl -s -o /dev/null -w "invalid bucket status: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":"Task1 verify invalid","employee_id":1,"category":"Посылка","photo_path":"task1-verify-bad.png","full_name":"Тест Task1","area":"ХАБ","item_type":"Мелкий товар","shift_date":"2026-09-08","shift_type":"Дневная","no_shk_bucket":"Не существует"}'
```
Expected: `valid bucket status: 201`, `invalid bucket status: 400` (or
`23514` check-violation body).

- [ ] **Step 4: Clean up the test row**

```bash
supabase db query --linked "delete from intake_submissions where item_text = 'Task1 verify valid';"
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202609080001_intake_submissions_shift_bucket_fields.sql
git commit -m "feat: add shift/bucket columns to intake_submissions"
```

---

## Task 2: Shift computation, bucket priority, sticker-flow routing flag

**Repo:** `wmsplus-intake-form`

**Files:**
- Modify: `intake.js`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `computeShift()` → `{date: 'YYYY-MM-DD', type: 'Дневная'|'Ночная', label: string}`;
  `needsStickerFlow()` → boolean; `computeNoShkBucket()` → one of the 4
  bucket strings from Task 1's check constraint; `state.spillFlag`
  (boolean, default `false`). Task 3/4/5 set `state.spillFlag` and read
  `needsStickerFlow()`/`computeShift()`. Task 7 reads `computeShift()`
  and calls the Task 6 RPC after a non-sticker `finalizeSubmit`.

- [ ] **Step 1: Add `spillFlag` to the state object**

In `intake.js`, find the `state` object (currently ends `stickerCode:
null,`) and add the new field:

```js
    const state = {
        employeeId: localStorage.getItem(LS_EMPLOYEE_ID),
        fullName: localStorage.getItem(LS_FULL_NAME),
        area: localStorage.getItem(LS_AREA),
        itemType: null,
        category: null,
        itemText: null,
        photoPath: null,
        stickerCode: null,
        spillFlag: false,
    };
```

- [ ] **Step 2: Refactor `shiftLabel()` into `computeShift()`**

Replace the existing `pad2`/`formatDate`/`shiftLabel` block with:

```js
    function pad2(n) { return String(n).padStart(2, '0'); }
    function formatDate(d) { return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1); }
    function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

    // Single source of truth for the 8:00/20:00 shift boundary -- both the
    // header label (formatted for display) and the shift_date/shift_type
    // saved on every submission (shift boxes, Task 6-7) come from here so
    // they can never drift apart.
    function computeShift() {
        const now = new Date();
        const hour = now.getHours();
        if (hour >= 8 && hour < 20) {
            return { date: isoDate(now), type: 'Дневная', label: formatDate(now) + ' · Дневная смена' };
        }
        let start, end;
        if (hour >= 20) {
            start = now;
            end = new Date(now);
            end.setDate(end.getDate() + 1);
        } else {
            end = now;
            start = new Date(now);
            start.setDate(start.getDate() - 1);
        }
        return { date: isoDate(start), type: 'Ночная', label: formatDate(start) + '-' + formatDate(end) + ' · Ночная смена' };
    }

    function shiftLabel() {
        return computeShift().label;
    }
```

- [ ] **Step 3: Add `needsStickerFlow()` and `computeNoShkBucket()`**

Add right after the `state` object:

```js
    // Priority when more than one trigger applies to the same item: Шредер
    // > Бытовая химия (Товар льётся) > участок Упаковка. See spec Part A.1.
    function needsStickerFlow() {
        return state.itemType === 'Шредер' || state.area === 'Упаковка' || state.spillFlag;
    }

    function computeNoShkBucket() {
        if (state.itemType === 'Шредер') return 'Шредер';
        if (state.spillFlag) return 'Брак Бытовая химия';
        if (state.area === 'Упаковка') return 'Товар с переупаковки';
        return 'Короб смены';
    }
```

- [ ] **Step 4: Route `handlePhoto` through `needsStickerFlow()`**

In `handlePhoto`, replace the jsQR pre-check condition:
```js
        if (state.itemType === 'Шредер' && typeof jsQR === 'undefined') {
```
with:
```js
        if (needsStickerFlow() && typeof jsQR === 'undefined') {
```

And replace the post-upload branch:
```js
            state.photoPath = photoPath;

            if (state.itemType === 'Шредер') {
                showScreen('screenStickerScan');
                startQrScan();
            } else {
                await finalizeSubmit(photoMsg);
            }
```
with:
```js
            state.photoPath = photoPath;

            if (needsStickerFlow()) {
                showScreen('screenStickerScan');
                startQrScan();
            } else {
                await finalizeSubmit(photoMsg);
            }
```

- [ ] **Step 5: Save the new fields in `finalizeSubmit`, reset `spillFlag` on "again"**

In `finalizeSubmit`, add a `computeShift()` call and the three new
fields to the insert payload:

```js
    async function finalizeSubmit(msgEl) {
        try {
            const shift = computeShift();
            await withRetry(3, 'Сохранение', (m) => { msgEl.textContent = m; }, async () => {
                msgEl.textContent = 'Сохранение...';
                const { error } = await supabaseClient
                    .from('intake_submissions')
                    .insert({
                        item_text: state.itemText,
                        employee_id: Number(state.employeeId),
                        full_name: state.fullName,
                        area: state.area,
                        item_type: state.itemType,
                        category: state.category,
                        photo_path: state.photoPath,
                        sticker_code: state.stickerCode,
                        shift_date: shift.date,
                        shift_type: shift.type,
                        no_shk_bucket: computeNoShkBucket(),
                    });
                if (error) throw error;
            });
            const scanBackBtn = document.getElementById('backToPhotoFromScanBtn');
            if (scanBackBtn) scanBackBtn.disabled = false;
            showScreen('screenSuccess');
        } catch (err) {
            msgEl.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
            msgEl.className = 'msg is-error';
            const scanBackBtn = document.getElementById('backToPhotoFromScanBtn');
            if (scanBackBtn) scanBackBtn.disabled = false;
        }
    }
```

In the `againBtn` click handler, add the reset:
```js
    document.getElementById('againBtn').addEventListener('click', () => {
        state.itemType = null;
        state.category = null;
        state.itemText = null;
        state.photoPath = null;
        state.stickerCode = null;
        state.spillFlag = false;
        showScreen('screenEntryType');
    });
```

- [ ] **Step 6: `node --check`**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```
Expected: no output (exit 0).

- [ ] **Step 7: Live-verify via browser — regression + new Упаковка routing**

Serve the repo locally (any static server, e.g. `npx serve` or Python's
`http.server`) or use the live site, open it in the Claude Browser tool:

1. Complete ID/name, pick area **ХАБ**, "Товар без ШК" → "Мелкий товар"
   → any non-Бытовая-химия category → name → photo. Expected: still goes
   straight to "Заявка отправлена" (unchanged regression check).
2. Pick area **Упаковка**, "Товар без ШК" → "Мелкий товар" → any
   category → name → photo. Expected: now routes to "Отсканируйте
   стикер" (the sticker-scan screen) instead of finishing immediately —
   this is the new `needsStickerFlow()` behavior triggered by
   `area === 'Упаковка'` alone. (No downstream instructions screen
   exists yet — Task 3 adds it; after a successful scan this will
   currently land on "Заявка отправлена", which is fine for this task's
   verification.)

- [ ] **Step 8: Commit**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add intake.js
git commit -m "feat: compute shift/bucket data and route Упаковка through sticker flow"
git push
```

---

## Task 3: Instruction screens (slide sequence, QR rendering)

**Repo:** `wmsplus-intake-form`

**Files:**
- Modify: `index.html`
- Modify: `intake.js`

**Interfaces:**
- Consumes: `needsStickerFlow()`, `computeNoShkBucket()` (Task 2, used
  implicitly via existing `finalizeSubmit`), `state.area`.
- Produces: screens `screenStickerSaved`, `screenInstrSlide`; functions
  `renderQrInto(containerId, text)`, `areaInstrCodes()`,
  `startInstructions(sequence)`. Task 4/5 don't call these directly but
  rely on `finalizeSubmit` now landing on `screenStickerSaved` whenever
  `state.stickerCode` is set.

- [ ] **Step 1: Add the QR library CDN tag**

In `index.html`, right after the existing `jsQR` script tag:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"></script>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
```

- [ ] **Step 2: Add the two new screens to `index.html`**

Insert immediately after the existing `screenStickerScan` section (before
`screenSuccess`):

```html
<section id="screenStickerSaved" class="screen">
    <div id="areaPillStickerSaved" class="area-pill"><span id="areaPillStickerSavedText"></span> ✎</div>
    <div id="shiftHeaderStickerSaved" class="shift-header"></div>
    <div class="screen-card" style="text-align:center;">
        <h1>Стикер сохранён</h1>
        <p style="margin:0 0 16px;font-size:14px;">Теперь необходимо обработать товар через ТСД.</p>
        <button id="instrFullBtn" class="primary-btn" type="button">Инструкция</button>
        <button id="instrSkipBtn" class="secondary-btn" type="button">Пропустить</button>
    </div>
</section>

<section id="screenInstrSlide" class="screen">
    <div id="areaPillInstr" class="area-pill"><span id="areaPillInstrText"></span> ✎</div>
    <div id="shiftHeaderInstr" class="shift-header"></div>
    <button id="backToInstrPrevBtn" class="back-btn" type="button">←</button>
    <div class="screen-card" style="text-align:center;">
        <div id="instrStepIndicator" style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:8px;"></div>
        <h1 id="instrStepText"></h1>
        <div id="instrQrSlot" style="display:flex;justify-content:center;margin:12px 0;"></div>
        <button id="instrNextBtn" class="primary-btn" type="button">Далее</button>
    </div>
</section>
```

- [ ] **Step 3: Register the two new screens' area-pill/shift-header**

In `intake.js`, `updateAreaPills`, replace:
```js
    function updateAreaPills() {
        [
            'areaPillEntryText', 'areaPillTypeText', 'areaPillCategoryText', 'areaPillNameText',
            'areaPillPhotoText', 'areaPillStickerText', 'areaPill2ShkText', 'areaPillEmptyText',
        ].forEach((id) => {
```
with:
```js
    function updateAreaPills() {
        [
            'areaPillEntryText', 'areaPillTypeText', 'areaPillCategoryText', 'areaPillNameText',
            'areaPillPhotoText', 'areaPillStickerText', 'areaPill2ShkText', 'areaPillEmptyText',
            'areaPillStickerSavedText', 'areaPillInstrText',
        ].forEach((id) => {
```

In `updateShiftHeaders`, replace:
```js
    function updateShiftHeaders() {
        const label = shiftLabel();
        [
            'shiftHeaderEntry', 'shiftHeaderType', 'shiftHeaderCategory',
            'shiftHeaderName', 'shiftHeaderPhoto', 'shiftHeaderSticker',
            'shiftHeader2Shk', 'shiftHeaderEmpty',
        ].forEach((id) => {
```
with:
```js
    function updateShiftHeaders() {
        const label = shiftLabel();
        [
            'shiftHeaderEntry', 'shiftHeaderType', 'shiftHeaderCategory',
            'shiftHeaderName', 'shiftHeaderPhoto', 'shiftHeaderSticker',
            'shiftHeader2Shk', 'shiftHeaderEmpty',
            'shiftHeaderStickerSaved', 'shiftHeaderInstr',
        ].forEach((id) => {
```

In the pencil-click wiring block, replace:
```js
    [
        'areaPillEntry', 'areaPillType', 'areaPillCategory', 'areaPillName',
        'areaPillPhoto', 'areaPillSticker', 'areaPill2Shk', 'areaPillEmpty',
    ].forEach((id) => {
        document.getElementById(id).addEventListener('click', () => {
            stopQrScan();
            showScreen('screenArea');
        });
    });
```
with:
```js
    [
        'areaPillEntry', 'areaPillType', 'areaPillCategory', 'areaPillName',
        'areaPillPhoto', 'areaPillSticker', 'areaPill2Shk', 'areaPillEmpty',
        'areaPillStickerSaved', 'areaPillInstr',
    ].forEach((id) => {
        document.getElementById(id).addEventListener('click', () => {
            stopQrScan();
            showScreen('screenArea');
        });
    });
```

- [ ] **Step 4: Add QR rendering, the instruction data, and slide navigation**

Add near the other helper functions in `intake.js` (after `computeShift`
is a good spot):

```js
    function renderQrInto(containerId, text) {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = '';
        if (typeof QRCode === 'undefined') {
            el.textContent = text;
            return;
        }
        new QRCode(el, { text: text, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    }

    const AREA_INSTR_CODES = {
        'ХАБ': { mx: 'PLCE1034816435', wct: 'WCT1000100010', destination: 'на Идентификацию' },
        'Упаковка': { mx: 'PLCE1034816436', wct: 'WCT700100010', destination: 'на переупаковку' },
    };
    function areaInstrCodes() {
        return AREA_INSTR_CODES[state.area] || AREA_INSTR_CODES['ХАБ'];
    }

    const INSTRUCTIONS_FULL = [
        { text: () => 'Войдите в ТСД под своим бейджиком.' },
        { text: () => 'Перейдите в модуль «Стол старшего».' },
        { text: () => 'Перейдите в процесс «Стол старшего».' },
        { text: () => 'Отсканируйте МХ Стола руководителя.', qr: () => areaInstrCodes().mx },
        { text: () => 'Отсканируйте тару ПЕРЕУПАКОВКИ, если нужно.', qr: () => areaInstrCodes().wct },
        { text: () => 'Не сканируйте тару сортировки, нажмите «Пропустить».' },
        { text: () => 'Далее в интерфейсе нажмите «Нет стикера», затем «Нет баркода», затем «Нет акциза».' },
        { text: () => 'Далее необходимо отсканировать приклеенный ранее на вещь стикер.' },
        { text: () => 'Отсканируйте тару ПЕРЕУПАКОВКИ.', qr: () => areaInstrCodes().wct },
        { text: () => 'Отнесите товар ' + areaInstrCodes().destination + '.' },
    ];

    const INSTRUCTIONS_SHORT = [
        { text: () => 'Отсканируйте МХ Стола руководителя.', qr: () => areaInstrCodes().mx },
        { text: () => 'Отсканируйте тару ПЕРЕУПАКОВКИ, если нужно.', qr: () => areaInstrCodes().wct },
        { text: () => 'Отсканируйте приклеенный ранее на вещь стикер.' },
        { text: () => 'Отсканируйте тару ПЕРЕУПАКОВКИ и передайте товар ' + areaInstrCodes().destination + '.', qr: () => areaInstrCodes().wct },
    ];

    function renderInstrSlide() {
        const steps = state.instrSequence;
        const i = state.instrIndex;
        const step = steps[i];
        document.getElementById('instrStepIndicator').textContent = 'Шаг ' + (i + 1) + ' из ' + steps.length;
        document.getElementById('instrStepText').textContent = step.text();
        const qrSlot = document.getElementById('instrQrSlot');
        qrSlot.innerHTML = '';
        if (step.qr) {
            renderQrInto('instrQrSlot', step.qr());
        }
        document.getElementById('instrNextBtn').textContent = (i === steps.length - 1) ? 'Завершить' : 'Далее';
    }

    function startInstructions(sequence) {
        state.instrSequence = sequence;
        state.instrIndex = 0;
        renderInstrSlide();
        showScreen('screenInstrSlide');
    }

    document.getElementById('instrFullBtn').addEventListener('click', () => startInstructions(INSTRUCTIONS_FULL));
    document.getElementById('instrSkipBtn').addEventListener('click', () => startInstructions(INSTRUCTIONS_SHORT));

    document.getElementById('instrNextBtn').addEventListener('click', () => {
        const steps = state.instrSequence;
        if (state.instrIndex === steps.length - 1) {
            state.itemType = null;
            state.category = null;
            state.itemText = null;
            state.photoPath = null;
            state.stickerCode = null;
            state.spillFlag = false;
            showScreen('screenEntryType');
            return;
        }
        state.instrIndex += 1;
        renderInstrSlide();
    });

    document.getElementById('backToInstrPrevBtn').addEventListener('click', () => {
        if (state.instrIndex === 0) {
            showScreen('screenStickerSaved');
        } else {
            state.instrIndex -= 1;
            renderInstrSlide();
        }
    });
```

- [ ] **Step 5: Route `finalizeSubmit` to `screenStickerSaved` for sticker-flow submissions**

In `finalizeSubmit`, replace:
```js
            const scanBackBtn = document.getElementById('backToPhotoFromScanBtn');
            if (scanBackBtn) scanBackBtn.disabled = false;
            showScreen('screenSuccess');
```
with:
```js
            const scanBackBtn = document.getElementById('backToPhotoFromScanBtn');
            if (scanBackBtn) scanBackBtn.disabled = false;
            if (state.stickerCode) {
                showScreen('screenStickerSaved');
            } else {
                showScreen('screenSuccess');
            }
```

- [ ] **Step 6: `node --check`**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```

- [ ] **Step 7: Live-verify via browser**

1. Area **ХАБ** → "Товар без ШК" → "Шредер" → photo → scan a QR (any QR
   image works for this test, e.g. generate one from arbitrary text and
   point the camera at a screen/printout). Expected: lands on "Стикер
   сохранён" with **Инструкция**/**Пропустить** buttons (not "Заявка
   отправлена" — this is the behavior change from Task 3).
2. Tap **Инструкция**. Expected: "Шаг 1 из 10", step 4 and 5 render a
   visible QR code image, step 4's/9's QR encodes `PLCE1034816435` /
   `WCT1000100010` (verify by reading `instrQrSlot`'s rendered `<img>` or
   `<canvas>` — or scan it with a phone QR reader — should decode to
   that exact string). Step 10 reads "Отнесите товар на Идентификацию.".
   Tap **Далее** through all 10 slides; the button reads **Завершить**
   on slide 10; tapping it returns to "Выберите тип заявки".
3. Repeat, tapping **Пропустить** instead: 4 slides, step 4 reads
   "...и передайте товар на Идентификацию.", **Завершить** returns to
   the entry-type screen.
4. Repeat area **Упаковка**, any category → sticker scan → instructions:
   confirm the QR values are `PLCE1034816436`/`WCT700100010` and the
   destination text reads "...на переупаковку." in both sequences.
5. On slide 2+ of either sequence, tap the back button (←): returns to
   the previous slide. On slide 1, tap back: returns to "Стикер
   сохранён".

- [ ] **Step 8: Commit and push**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add index.html intake.js
git commit -m "feat: add slide-by-slide TSD processing instructions after sticker scan"
git push
```

---

## Task 4: Маркетплейс — "Отнесите товар на ХАБ"

**Repo:** `wmsplus-intake-form`

**Files:**
- Modify: `index.html`
- Modify: `intake.js`

**Interfaces:**
- Consumes: `state.area`, the existing `[data-type]` click handler.
- Produces: screen `screenTakeToHub`. Task 5's Маркетплейс branch
  navigates to this screen by id.

- [ ] **Step 1: Add the screen**

In `index.html`, insert after `screenInstrSlide` (before `screenSuccess`):

```html
<section id="screenTakeToHub" class="screen">
    <div id="areaPillHub" class="area-pill"><span id="areaPillHubText"></span> ✎</div>
    <div id="shiftHeaderHub" class="shift-header"></div>
    <div class="screen-card" style="text-align:center;">
        <h1>Отнесите товар на ХАБ</h1>
        <button id="hubBackBtn" class="primary-btn" type="button">В меню</button>
    </div>
</section>
```

- [ ] **Step 2: Register pill/header/pencil**

In `intake.js`, `updateAreaPills`, extend the array from Task 3:
```js
    function updateAreaPills() {
        [
            'areaPillEntryText', 'areaPillTypeText', 'areaPillCategoryText', 'areaPillNameText',
            'areaPillPhotoText', 'areaPillStickerText', 'areaPill2ShkText', 'areaPillEmptyText',
            'areaPillStickerSavedText', 'areaPillInstrText', 'areaPillHubText',
        ].forEach((id) => {
```

`updateShiftHeaders`, extend:
```js
    function updateShiftHeaders() {
        const label = shiftLabel();
        [
            'shiftHeaderEntry', 'shiftHeaderType', 'shiftHeaderCategory',
            'shiftHeaderName', 'shiftHeaderPhoto', 'shiftHeaderSticker',
            'shiftHeader2Shk', 'shiftHeaderEmpty',
            'shiftHeaderStickerSaved', 'shiftHeaderInstr', 'shiftHeaderHub',
        ].forEach((id) => {
```

Pencil-click wiring, extend:
```js
    [
        'areaPillEntry', 'areaPillType', 'areaPillCategory', 'areaPillName',
        'areaPillPhoto', 'areaPillSticker', 'areaPill2Shk', 'areaPillEmpty',
        'areaPillStickerSaved', 'areaPillInstr', 'areaPillHub',
    ].forEach((id) => {
        document.getElementById(id).addEventListener('click', () => {
            stopQrScan();
            showScreen('screenArea');
        });
    });
```

- [ ] **Step 3: Route Шредер-at-Маркетплейс to the new screen**

Replace the `[data-type]` click handler:
```js
    document.querySelectorAll('[data-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.stickerCode = null;
            state.itemType = btn.dataset.type;
            if (state.itemType === 'Шредер') {
                state.category = null;
                state.itemText = null;
                photoBackTarget = 'screenItemType';
                clearPhotoMsg();
                showScreen('screenPhoto');
            } else {
                renderCategoryGrid(state.itemType === 'КГТ' ? CATEGORIES_KGT : CATEGORIES_SMALL);
                showScreen('screenCategory');
            }
        });
    });
```
with:
```js
    document.querySelectorAll('[data-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.stickerCode = null;
            state.itemType = btn.dataset.type;
            if (state.itemType === 'Шредер' && state.area === 'Маркетплейс') {
                state.category = null;
                state.itemText = null;
                showScreen('screenTakeToHub');
            } else if (state.itemType === 'Шредер') {
                state.category = null;
                state.itemText = null;
                photoBackTarget = 'screenItemType';
                clearPhotoMsg();
                showScreen('screenPhoto');
            } else {
                renderCategoryGrid(state.itemType === 'КГТ' ? CATEGORIES_KGT : CATEGORIES_SMALL);
                showScreen('screenCategory');
            }
        });
    });
```

- [ ] **Step 4: Wire the "В меню" button**

Add near the other terminal-screen handlers:
```js
    document.getElementById('hubBackBtn').addEventListener('click', () => {
        state.itemType = null;
        state.category = null;
        state.itemText = null;
        state.photoPath = null;
        state.stickerCode = null;
        state.spillFlag = false;
        showScreen('screenEntryType');
    });
```

- [ ] **Step 5: `node --check`**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```

- [ ] **Step 6: Live-verify via browser**

1. Area **Маркетплейс** → "Товар без ШК" → tap **Шредер**. Expected:
   immediately shows "Отнесите товар на ХАБ" (no photo step reached).
   Tap **В меню**: returns to "Выберите тип заявки".
2. Confirm via `supabase db query --linked "select count(*) from
   intake_submissions where created_at > now() - interval '10 minutes'
   and item_type = 'Шредер' and area = 'Маркетплейс';"` — expected `0`
   (nothing was written for this attempt).
3. Regression: area **ХАБ** → "Товар без ШК" → **Шредер** still goes to
   the photo screen as before.

- [ ] **Step 7: Commit and push**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add index.html intake.js
git commit -m "feat: Маркетплейс Шредер shows take-to-hub screen instead of processing"
git push
```

---

## Task 5: "Товар льётся" button for household chemicals

**Repo:** `wmsplus-intake-form`

**Files:**
- Modify: `index.html`
- Modify: `intake.js`

**Interfaces:**
- Consumes: `screenTakeToHub` (Task 4), `needsStickerFlow()` (Task 2,
  via `state.spillFlag`), `screenPhoto`/`screenStickerScan` (existing).
- Produces: `state.spillFlag = true` as the trigger `needsStickerFlow()`
  and `computeNoShkBucket()` (Task 2) already key off.

- [ ] **Step 1: Add the button to `screenItemName`**

In `index.html`, replace:
```html
<section id="screenItemName" class="screen">
    <div id="areaPillName" class="area-pill"><span id="areaPillNameText"></span> ✎</div>
    <div id="shiftHeaderName" class="shift-header"></div>
    <button id="backToCategoryBtn" class="back-btn" type="button">←</button>
    <div class="screen-card">
        <div id="selectedCategoryLine" class="selected-category"></div>
        <h1>Наименование</h1>
        <input id="itemNameInput" class="field" type="text" maxlength="2000" placeholder="Что за товар" aria-label="Наименование товара">
        <button id="itemNameNextBtn" class="primary-btn" type="button">Далее</button>
        <div id="itemNameMsg" class="msg"></div>
    </div>
</section>
```
with:
```html
<section id="screenItemName" class="screen">
    <div id="areaPillName" class="area-pill"><span id="areaPillNameText"></span> ✎</div>
    <div id="shiftHeaderName" class="shift-header"></div>
    <button id="backToCategoryBtn" class="back-btn" type="button">←</button>
    <div class="screen-card">
        <div id="selectedCategoryLine" class="selected-category"></div>
        <h1>Наименование</h1>
        <input id="itemNameInput" class="field" type="text" maxlength="2000" placeholder="Что за товар" aria-label="Наименование товара">
        <button id="itemNameNextBtn" class="primary-btn" type="button">Далее</button>
        <button id="spillBtn" class="primary-btn" type="button" style="display:none;background:var(--danger);margin-top:10px;">Товар льётся</button>
        <div id="itemNameMsg" class="msg"></div>
    </div>
</section>
```

- [ ] **Step 2: Toggle the button's visibility per category, reset `spillFlag` on category pick**

In `intake.js`, `renderCategoryGrid`, replace:
```js
            btn.addEventListener('click', () => {
                state.category = cat.name;
                document.getElementById('selectedCategoryLine').innerHTML =
                    '<span class="emoji">' + cat.emoji + '</span><span>' + cat.name + '</span>';
                if (cat.name === 'Посылка') {
                    state.itemText = null;
                    photoBackTarget = 'screenCategory';
                    clearPhotoMsg();
                    showScreen('screenPhoto');
                } else {
                    itemNameInput.value = '';
                    itemNameMsg.textContent = '';
                    itemNameMsg.className = 'msg';
                    showScreen('screenItemName');
                }
            });
```
with:
```js
            btn.addEventListener('click', () => {
                state.category = cat.name;
                state.spillFlag = false;
                document.getElementById('selectedCategoryLine').innerHTML =
                    '<span class="emoji">' + cat.emoji + '</span><span>' + cat.name + '</span>';
                if (cat.name === 'Посылка') {
                    state.itemText = null;
                    photoBackTarget = 'screenCategory';
                    clearPhotoMsg();
                    showScreen('screenPhoto');
                } else {
                    itemNameInput.value = '';
                    itemNameMsg.textContent = '';
                    itemNameMsg.className = 'msg';
                    document.getElementById('spillBtn').style.display = (cat.name === 'Бытовая химия') ? 'block' : 'none';
                    showScreen('screenItemName');
                }
            });
```

- [ ] **Step 3: Extract name validation, wire the button**

Replace the "Wizard step 2: item name" block:
```js
    // ---------- Wizard step 2: item name ----------
    function submitItemName() {
        const val = itemNameInput.value.trim();
        if (!val) {
            itemNameMsg.textContent = 'Введите наименование.';
            itemNameMsg.className = 'msg is-error';
            return;
        }
        state.itemText = val;
        itemNameMsg.textContent = '';
        itemNameMsg.className = 'msg';
        photoBackTarget = 'screenItemName';
        clearPhotoMsg();
        showScreen('screenPhoto');
    }
    document.getElementById('itemNameNextBtn').addEventListener('click', submitItemName);
    itemNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitItemName(); });
    document.getElementById('backToCategoryBtn').addEventListener('click', () => showScreen('screenCategory'));
```
with:
```js
    // ---------- Wizard step 2: item name ----------
    function validateItemName() {
        const val = itemNameInput.value.trim();
        if (!val) {
            itemNameMsg.textContent = 'Введите наименование.';
            itemNameMsg.className = 'msg is-error';
            return false;
        }
        state.itemText = val;
        itemNameMsg.textContent = '';
        itemNameMsg.className = 'msg';
        return true;
    }

    function submitItemName() {
        if (!validateItemName()) return;
        photoBackTarget = 'screenItemName';
        clearPhotoMsg();
        showScreen('screenPhoto');
    }
    document.getElementById('itemNameNextBtn').addEventListener('click', submitItemName);
    itemNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitItemName(); });
    document.getElementById('backToCategoryBtn').addEventListener('click', () => showScreen('screenCategory'));

    document.getElementById('spillBtn').addEventListener('click', () => {
        if (!validateItemName()) return;
        state.spillFlag = true;
        if (state.area === 'Маркетплейс') {
            showScreen('screenTakeToHub');
            return;
        }
        photoBackTarget = 'screenItemName';
        clearPhotoMsg();
        showScreen('screenPhoto');
    });
```

- [ ] **Step 4: `node --check`**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```

- [ ] **Step 5: Live-verify via browser**

1. Area **ХАБ** → "Товар без ШК" → "Мелкий товар" → category **Бытовая
   химия**. Expected: red **Товар льётся** button visible below
   **Далее** on the name screen; any other category → button hidden.
2. Leave name empty, tap **Товар льётся**: shows "Введите наименование."
   error, stays on screen (same validation as **Далее**).
3. Type a name, tap **Товар льётся**: goes to photo → after photo, goes
   to sticker scan (not straight to success) → after scanning, lands on
   "Стикер сохранён" with the ХАБ-coded instructions available (from
   Task 3).
4. Type a name, tap **Далее** (not the red button) instead: goes to
   photo → normal finalize, no sticker scan, no instructions (unchanged
   for the non-leaking case).
5. Area **Маркетплейс** → "Товар без ШК" → "Мелкий товар" → **Бытовая
   химия** → type a name → tap **Товар льётся**. Expected: goes straight
   to "Отнесите товар на ХАБ" (Task 4's screen), no photo step reached.
   Verify nothing was written: `supabase db query --linked "select
   count(*) from intake_submissions where created_at > now() - interval
   '10 minutes' and area = 'Маркетплейс' and category = 'Бытовая
   химия';"` — expected `0`.

- [ ] **Step 6: Commit and push**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add index.html intake.js
git commit -m "feat: add Товар льётся button for household chemicals"
git push
```

---

## Task 6: Migration — `wms_no_shk_boxes` shift-box fields + log-item function

**Repo:** `WMSplus-main`

**Files:**
- Create: `supabase/migrations/202609080002_no_shk_shift_boxes.sql`

**Interfaces:**
- Produces: `wms_no_shk_boxes.area` check widened to include `'ХАБ'`,
  `'Маркетплейс'`; new columns `outside_opp boolean`, `total_items
  integer`, `contributor_counts jsonb`; partial unique index on
  `(area, shift_date, shift_type) where outside_opp`; SQL function
  `wms_no_shk_box_log_item(p_area text, p_shift_date date, p_shift_type
  text, p_full_name text) returns table (box_id uuid, total_items
  integer)`, granted to `anon`. Task 7 calls this function by name with
  these exact parameter names.

- [ ] **Step 1: Confirm the existing area check constraint's name**

```bash
supabase db query --linked "select conname from pg_constraint where conrelid = 'public.wms_no_shk_boxes'::regclass and contype = 'c';"
```
Expected: a row named `wms_no_shk_boxes_area_check` (matches Postgres's
default naming for a column-level check constraint added via `alter
table ... add column area ... check (...)` in migration
`202609020003_no_shk_box_fields_and_label_template.sql`). If the actual
name differs, use that name in Step 2 instead.

- [ ] **Step 2: Write the migration file**

```sql
-- 202609080002_no_shk_shift_boxes.sql
-- Shift storage addressing (see
-- docs/superpowers/specs/2026-09-08-intake-form-processing-instructions-and-shift-boxes-design.md,
-- Part B). Existing wms_no_shk_boxes rows (manually created by zone
-- staff) are untouched: outside_opp defaults to false, so they keep
-- rendering in the existing "На полу"/shelved views exactly as before.
-- New rows created by the public intake form (via
-- wms_no_shk_box_log_item below) start with outside_opp = true ("Вне
-- ОПП / Формируется") and only flip to false when a person clicks
-- "Принесено" in no_shk_zone.js (Task 8).

alter table public.wms_no_shk_boxes
    drop constraint wms_no_shk_boxes_area_check;

alter table public.wms_no_shk_boxes
    add constraint wms_no_shk_boxes_area_check
        check (area in ('Сортировка', 'Переупаковка', 'ХАБ', 'Маркетплейс'));

alter table public.wms_no_shk_boxes
    add column outside_opp boolean not null default false,
    add column total_items integer not null default 0,
    add column contributor_counts jsonb not null default '{}'::jsonb;

-- At most one "currently forming" box per area+shift at a time.
create unique index wms_no_shk_boxes_forming_idx
    on public.wms_no_shk_boxes (area, shift_date, shift_type)
    where outside_opp;

-- Atomic find-or-create + increment + responsible-person recompute for
-- one item logged from the public intake form. security definer so the
-- anonymous intake-form client never needs SELECT on intake_submissions
-- (which stays insert-only) to get a live count -- this function only
-- ever touches wms_no_shk_boxes, which already grants anon full access
-- (see wms_no_shk_boxes_all policy, "for all using (true)").
create or replace function public.wms_no_shk_box_log_item(
    p_area text,
    p_shift_date date,
    p_shift_type text,
    p_full_name text
) returns table (box_id uuid, total_items integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    insert into public.wms_no_shk_boxes (area, shift_date, shift_type, box_type, responsible_name, outside_opp)
    values (p_area, p_shift_date, p_shift_type, 'Короб', p_full_name, true)
    on conflict (area, shift_date, shift_type) where outside_opp
    do nothing;

    select b.id into v_id
    from public.wms_no_shk_boxes b
    where b.area = p_area and b.shift_date = p_shift_date and b.shift_type = p_shift_type and b.outside_opp
    limit 1;

    update public.wms_no_shk_boxes b
    set contributor_counts = jsonb_set(
            b.contributor_counts,
            array[p_full_name],
            to_jsonb(coalesce((b.contributor_counts ->> p_full_name)::integer, 0) + 1)
        ),
        total_items = b.total_items + 1
    where b.id = v_id;

    update public.wms_no_shk_boxes b
    set responsible_name = sub.name
    from (
        select key as name
        from public.wms_no_shk_boxes b2, jsonb_each_text(b2.contributor_counts)
        where b2.id = v_id
        order by value::integer desc
        limit 1
    ) sub
    where b.id = v_id;

    return query select b.id, b.total_items from public.wms_no_shk_boxes b where b.id = v_id;
end;
$$;

grant execute on function public.wms_no_shk_box_log_item(text, date, text, text) to anon;
```

- [ ] **Step 3: Apply the migration**

```bash
supabase db query --linked -f supabase/migrations/202609080002_no_shk_shift_boxes.sql
```
Expected: no error output.

- [ ] **Step 4: Verify via the real REST RPC path (anon key)**

```bash
ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q'

curl -s -X POST "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/rpc/wms_no_shk_box_log_item" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_area":"ХАБ","p_shift_date":"2026-09-08","p_shift_type":"Дневная","p_full_name":"Тест Первый"}'
# Expected: [{"box_id":"<uuid>","total_items":1}]

curl -s -X POST "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/rpc/wms_no_shk_box_log_item" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_area":"ХАБ","p_shift_date":"2026-09-08","p_shift_type":"Дневная","p_full_name":"Тест Первый"}'
# Expected: same box_id, total_items:2

curl -s -X POST "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/rpc/wms_no_shk_box_log_item" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_area":"ХАБ","p_shift_date":"2026-09-08","p_shift_type":"Дневная","p_full_name":"Тест Второй"}'
# Expected: same box_id, total_items:3
```

Then confirm `responsible_name` picked the leader and `outside_opp` is
still true:
```bash
supabase db query --linked "select area, shift_date, shift_type, total_items, contributor_counts, responsible_name, outside_opp from wms_no_shk_boxes where area = 'ХАБ' and shift_date = '2026-09-08' and shift_type = 'Дневная';"
```
Expected: one row, `total_items = 3`, `contributor_counts = {"Тест
Первый": 2, "Тест Второй": 1}`, `responsible_name = 'Тест Первый'`,
`outside_opp = true`.

- [ ] **Step 5: Verify the partial unique index prevents a duplicate forming box**

```bash
supabase db query --linked "insert into wms_no_shk_boxes (area, shift_date, shift_type, box_type, responsible_name, outside_opp) values ('ХАБ', '2026-09-08', 'Дневная', 'Короб', 'x', true);"
```
Expected: a unique-violation error (confirms only one forming box per
area+shift can exist — the RPC's own `on conflict ... do nothing` relies
on this).

- [ ] **Step 6: Clean up the test box**

```bash
supabase db query --linked "delete from wms_no_shk_boxes where area = 'ХАБ' and shift_date = '2026-09-08' and shift_type = 'Дневная' and outside_opp = true;"
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202609080002_no_shk_shift_boxes.sql
git commit -m "feat: add shift-box fields and atomic log-item RPC to wms_no_shk_boxes"
```

---

## Task 7: Live shift counter + RPC call on the form

**Repo:** `wmsplus-intake-form`

**Files:**
- Modify: `index.html`
- Modify: `intake.js`

**Interfaces:**
- Consumes: `wms_no_shk_box_log_item` RPC and `wms_no_shk_boxes` table
  (Task 6), `computeShift()` (Task 2), `state.stickerCode`.
- Produces: nothing consumed by later tasks (Task 8 is independent,
  reading the same table from the other repo).

- [ ] **Step 1: Add the `.shift-counter` CSS rule and extend the transform exclusion list**

In `index.html`'s `<style>`, add after the `.back-btn` rule:
```css
    .shift-counter {
        position: fixed;
        bottom: calc(14px + env(safe-area-inset-bottom));
        left: 50%;
        transform: translateX(-50%);
        font-size: 12px;
        font-weight: 700;
        color: var(--muted);
        background: #fff;
        border: 1px solid rgba(36,32,56,.12);
        border-radius: 999px;
        padding: 6px 14px;
        z-index: 9;
    }
```

Then extend the three-clause `:not()` exclusion chain to a fourth clause
in **all four** places it appears (the transform must stay off
`.shift-counter` for the same reason it's already off `.area-pill`/
`.shift-header`/`.back-btn` — see the existing code comment above the
first rule). Replace:
```css
    .screen > *:not(.area-pill):not(.shift-header):not(.back-btn) {
        transform: translateY(8px);
        transition: transform 180ms ease;
    }
    .screen.is-active > *:not(.area-pill):not(.shift-header):not(.back-btn) {
        transform: translateY(0);
    }
```
with:
```css
    .screen > *:not(.area-pill):not(.shift-header):not(.back-btn):not(.shift-counter) {
        transform: translateY(8px);
        transition: transform 180ms ease;
    }
    .screen.is-active > *:not(.area-pill):not(.shift-header):not(.back-btn):not(.shift-counter) {
        transform: translateY(0);
    }
```

And inside `@media (prefers-reduced-motion: reduce)`, replace:
```css
        .screen,
        .screen.is-active,
        .screen > *:not(.area-pill):not(.shift-header):not(.back-btn),
        .screen.is-active > *:not(.area-pill):not(.shift-header):not(.back-btn) {
            transition: none;
        }
```
with:
```css
        .screen,
        .screen.is-active,
        .screen > *:not(.area-pill):not(.shift-header):not(.back-btn):not(.shift-counter),
        .screen.is-active > *:not(.area-pill):not(.shift-header):not(.back-btn):not(.shift-counter) {
            transition: none;
        }
```

- [ ] **Step 2: Add the counter element to the 4 "Товар без ШК" wizard screens**

Add `<div class="shift-counter" data-shift-counter></div>` as the last
child inside `screenItemType`, `screenCategory`, `screenItemName`, and
`screenPhoto`'s `.screen-card`/content div — one example (repeat the
same single-line addition in the other three):

```html
<section id="screenItemType" class="screen">
    <div id="areaPillType" class="area-pill"><span id="areaPillTypeText"></span> ✎</div>
    <div id="shiftHeaderType" class="shift-header"></div>
    <button id="backToEntryTypeBtn" class="back-btn" type="button">←</button>
    <div class="screen-card" style="text-align:center;">
        <h1>Выберите тип товара</h1>
        <button class="area-btn type-btn" data-type="Мелкий товар" type="button">Мелкий товар</button>
        <button class="area-btn type-btn" data-type="КГТ" type="button">КГТ</button>
        <button class="area-btn type-btn" data-type="Шредер" type="button">Шредер</button>
    </div>
    <div class="shift-counter" data-shift-counter></div>
</section>
```

Apply the same one-line `<div class="shift-counter" data-shift-counter></div>`
addition (as the last child of the `<section>`, after the closing
`</div>` of `.screen-card`) to `screenCategory`, `screenItemName`, and
`screenPhoto`.

- [ ] **Step 3: Add `refreshShiftCounter()` and hook it into `showScreen`**

Replace:
```js
    const screens = Array.from(document.querySelectorAll('.screen'));
    function showScreen(id) {
        screens.forEach((s) => s.classList.toggle('is-active', s.id === id));
    }
```
with:
```js
    const screens = Array.from(document.querySelectorAll('.screen'));
    function showScreen(id) {
        screens.forEach((s) => s.classList.toggle('is-active', s.id === id));
        void refreshShiftCounter();
    }

    // Упаковка has no shift-box concept (every item there is bucketed,
    // never counted into a shift box) -- hide the counter entirely there.
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
        els.forEach((el) => {
            el.style.display = '';
            el.textContent = 'За смену зафиксировано: ' + (error || !data ? 0 : data.total_items);
        });
    }
```

(`refreshShiftCounter` is declared with `function`, so it's hoisted and
safe to reference from `showScreen` above its own definition.)

- [ ] **Step 4: Call the RPC after a non-sticker submission**

In `finalizeSubmit`, replace:
```js
            const scanBackBtn = document.getElementById('backToPhotoFromScanBtn');
            if (scanBackBtn) scanBackBtn.disabled = false;
            if (state.stickerCode) {
                showScreen('screenStickerSaved');
            } else {
                showScreen('screenSuccess');
            }
```
with:
```js
            const scanBackBtn = document.getElementById('backToPhotoFromScanBtn');
            if (scanBackBtn) scanBackBtn.disabled = false;
            if (state.stickerCode) {
                showScreen('screenStickerSaved');
            } else {
                try {
                    await supabaseClient.rpc('wms_no_shk_box_log_item', {
                        p_area: state.area,
                        p_shift_date: shift.date,
                        p_shift_type: shift.type,
                        p_full_name: state.fullName,
                    });
                } catch (rpcErr) {
                    // Non-fatal: the submission itself already saved --
                    // the shift counter is a convenience display, not the
                    // record of truth.
                }
                showScreen('screenSuccess');
            }
```

- [ ] **Step 5: `node --check`**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```

- [ ] **Step 6: Live-verify via browser**

1. Area **ХАБ** → "Товар без ШК" → any non-sticker item (e.g. "Мелкий
   товар" → "Одежда" → name → photo). Before submitting, note the
   counter text at the bottom of `screenItemType`/`screenCategory`/
   `screenItemName`/`screenPhoto` (e.g. "За смену зафиксировано: 0" or
   whatever the current count is). Submit. Go back into "Товар без ШК"
   for area ХАБ again: counter has incremented by 1.
2. Area **Упаковка**: confirm the counter is not shown on any screen
   (hidden per Step 3's `Упаковка` check).
3. Confirm the shift-box row updated: `supabase db query --linked
   "select area, shift_date, shift_type, total_items, responsible_name
   from wms_no_shk_boxes where area = 'ХАБ' and outside_opp = true order
   by created_at desc limit 1;"` — `total_items` matches what the form
   displayed, `responsible_name` is the test account's full name.
4. Sticker-flow items (Шредер/Упаковка/Товар льётся) do **not** call the
   RPC — confirm no extra increment happened for a Шредер submission
   made during this test.

- [ ] **Step 7: Commit and push**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add index.html intake.js
git commit -m "feat: live shift-box counter on the form, log items via RPC"
git push
```

---

## Task 8: "Без ШК" zone — "Вне ОПП" section + "Принесено" button

**Repo:** `WMSplus-main`

**Files:**
- Modify: `no_shk_zone.js`
- Modify: `tasks.html`

**Interfaces:**
- Consumes: `wms_no_shk_boxes.outside_opp`/`total_items` (Task 6).

- [ ] **Step 1: Fetch `outside_opp`/`total_items`, split the floor query, add the outside-boxes query**

In `no_shk_zone.js`, replace:
```js
    const BOX_FIELDS = "id,box_number,shift_date,shift_type,box_type,area,responsible_name,shelf_id,created_at";

    async function loadZone() {
        const client = db();
        if (!client) return;
        const [racksRes, floorRes] = await Promise.all([
            client
                .from("wms_no_shk_racks")
                .select("id,name,rack_number,position,created_at,wms_no_shk_shelves(id,name,shelf_number,capacity,created_at,wms_no_shk_boxes(" + BOX_FIELDS + "))")
                .order("position", { ascending: true })
                .order("created_at", { ascending: true, foreignTable: "wms_no_shk_shelves" }),
            client
                .from("wms_no_shk_boxes")
                .select(BOX_FIELDS)
                .is("shelf_id", null)
                .order("box_number", { ascending: true }),
        ]);
        if (racksRes.error) {
            racks = [];
            renderZoneView("Не удалось загрузить: " + racksRes.error.message);
            renderAdminView();
            return;
        }
        racks = racksRes.data || [];
        floorBoxes = floorRes.error ? [] : (floorRes.data || []);
        renderZoneView();
        renderAdminView();
        if (!boxLabelTemplate) void loadTemplate("Короб «Без ШК»", (tpl) => { boxLabelTemplate = tpl; });
        if (!shelfLabelTemplate) void loadTemplate("Полка «Без ШК»", (tpl) => { shelfLabelTemplate = tpl; });
    }
```
with:
```js
    const BOX_FIELDS = "id,box_number,shift_date,shift_type,box_type,area,responsible_name,shelf_id,outside_opp,total_items,created_at";

    async function loadZone() {
        const client = db();
        if (!client) return;
        const [racksRes, floorRes, outsideRes] = await Promise.all([
            client
                .from("wms_no_shk_racks")
                .select("id,name,rack_number,position,created_at,wms_no_shk_shelves(id,name,shelf_number,capacity,created_at,wms_no_shk_boxes(" + BOX_FIELDS + "))")
                .order("position", { ascending: true })
                .order("created_at", { ascending: true, foreignTable: "wms_no_shk_shelves" }),
            client
                .from("wms_no_shk_boxes")
                .select(BOX_FIELDS)
                .is("shelf_id", null)
                .eq("outside_opp", false)
                .order("box_number", { ascending: true }),
            client
                .from("wms_no_shk_boxes")
                .select(BOX_FIELDS)
                .eq("outside_opp", true)
                .order("created_at", { ascending: true }),
        ]);
        if (racksRes.error) {
            racks = [];
            renderZoneView("Не удалось загрузить: " + racksRes.error.message);
            renderAdminView();
            return;
        }
        racks = racksRes.data || [];
        floorBoxes = floorRes.error ? [] : (floorRes.data || []);
        outsideBoxes = outsideRes.error ? [] : (outsideRes.data || []);
        renderZoneView();
        renderAdminView();
        if (!boxLabelTemplate) void loadTemplate("Короб «Без ШК»", (tpl) => { boxLabelTemplate = tpl; });
        if (!shelfLabelTemplate) void loadTemplate("Полка «Без ШК»", (tpl) => { shelfLabelTemplate = tpl; });
    }
```

Add the new module-level variable next to `floorBoxes`:
```js
    let racks = [];
    let floorBoxes = [];
    let outsideBoxes = [];
```

- [ ] **Step 2: Render the "Вне ОПП" section with a tile that shows `total_items`**

Add a new tile-builder function next to `boxTileHtml`:
```js
    function outsideBoxTileHtml(box, index) {
        const isNew = !seenBoxIds.has(box.id);
        const cls = "no-shk-box " + areaClass(box.area) + (isNew ? " is-new" : "");
        const delay = Math.min(index, 10) * 30;
        return "<div class='" + cls + "' style='animation-delay:" + delay + "ms;' data-box-id='" + box.id + "'>"
            + "<span class='no-shk-box-number'>" + escapeHtmlLocal(box.area) + "</span>"
            + "<span class='no-shk-box-date'>" + escapeHtmlLocal(formatDateShort(box.shift_date)) + " · " + box.total_items + " шт.</span>"
            + "</div>";
    }
```

In `renderZoneView`, replace:
```js
        const floorHtml = "<div class='no-shk-floor'>"
            + "<p class='no-shk-floor-title'>На полу" + (floorBoxes.length ? " (" + floorBoxes.length + ")" : "") + "</p>"
            + "<div class='no-shk-boxes-row'>"
            + (floorBoxes.length
                ? floorBoxes.map(boxTileHtml).join("")
                : "<span style='color:#94a3b8;font-size:12px;'>пусто</span>")
            + "</div></div>";
```
with:
```js
        const outsideHtml = "<div class='no-shk-floor'>"
            + "<p class='no-shk-floor-title'>Вне ОПП" + (outsideBoxes.length ? " (" + outsideBoxes.length + ")" : "") + "</p>"
            + "<div class='no-shk-boxes-row'>"
            + (outsideBoxes.length
                ? outsideBoxes.map(outsideBoxTileHtml).join("")
                : "<span style='color:#94a3b8;font-size:12px;'>пусто</span>")
            + "</div></div>";

        const floorHtml = "<div class='no-shk-floor'>"
            + "<p class='no-shk-floor-title'>На полу" + (floorBoxes.length ? " (" + floorBoxes.length + ")" : "") + "</p>"
            + "<div class='no-shk-boxes-row'>"
            + (floorBoxes.length
                ? floorBoxes.map(boxTileHtml).join("")
                : "<span style='color:#94a3b8;font-size:12px;'>пусто</span>")
            + "</div></div>";
```

Further down in the same function, replace:
```js
        wrap.innerHTML = floorHtml + racksHtml;

        wrap.querySelectorAll("[data-box-id]").forEach((box) => {
            box.addEventListener("click", () => openBoxDetailModal(box.dataset.boxId));
        });
        attachBoxTooltips(wrap);

        const nextSeen = new Set();
        floorBoxes.forEach((box) => nextSeen.add(box.id));
        racks.forEach((rack) => (rack.wms_no_shk_shelves || []).forEach((shelf) => (shelf.wms_no_shk_boxes || []).forEach((box) => nextSeen.add(box.id))));
        seenBoxIds = nextSeen;
```
with:
```js
        wrap.innerHTML = outsideHtml + floorHtml + racksHtml;

        wrap.querySelectorAll("[data-box-id]").forEach((box) => {
            box.addEventListener("click", () => openBoxDetailModal(box.dataset.boxId));
        });
        attachBoxTooltips(wrap);

        const nextSeen = new Set();
        outsideBoxes.forEach((box) => nextSeen.add(box.id));
        floorBoxes.forEach((box) => nextSeen.add(box.id));
        racks.forEach((rack) => (rack.wms_no_shk_shelves || []).forEach((shelf) => (shelf.wms_no_shk_boxes || []).forEach((box) => nextSeen.add(box.id))));
        seenBoxIds = nextSeen;
```

- [ ] **Step 3: `findBoxContext` must also find outside boxes**

Replace:
```js
    function findBoxContext(boxId) {
        for (const rack of racks) {
            for (const shelf of rack.wms_no_shk_shelves || []) {
                const box = (shelf.wms_no_shk_boxes || []).find((b) => b.id === boxId);
                if (box) return { box, shelf, rack };
            }
        }
        const floorBox = floorBoxes.find((b) => b.id === boxId);
        if (floorBox) return { box: floorBox, shelf: null, rack: null };
        return null;
    }
```
with:
```js
    function findBoxContext(boxId) {
        for (const rack of racks) {
            for (const shelf of rack.wms_no_shk_shelves || []) {
                const box = (shelf.wms_no_shk_boxes || []).find((b) => b.id === boxId);
                if (box) return { box, shelf, rack };
            }
        }
        const floorBox = floorBoxes.find((b) => b.id === boxId);
        if (floorBox) return { box: floorBox, shelf: null, rack: null };
        const outsideBox = outsideBoxes.find((b) => b.id === boxId);
        if (outsideBox) return { box: outsideBox, shelf: null, rack: null };
        return null;
    }
```

- [ ] **Step 4: Show box status + a "Принесено" button in the detail modal**

In `tasks.html`, add a new button next to the existing ones in
`noShkBoxDetailModal`:
```html
<section id="noShkBoxDetailModal" class="tasks-flow-modal upload-work" aria-hidden="true">
    <div class="tasks-flow-card task-small-card">
        <div class="work-head">
            <div>
                <h3 class="work-title">Короб</h3>
            </div>
            <button id="closeNoShkBoxDetail" class="btn btn-square" type="button" aria-label="Закрыть">×</button>
        </div>
        <div id="noShkBoxDetailWrap"></div>
        <div class="file-row" style="margin-top:12px;">
            <button id="bringOutsideBoxBtn" class="btn btn-rect" type="button" style="display:none;">Принесено</button>
            <button id="printNoShkBoxBtn" class="btn btn-rect" type="button">Распечатать стикер</button>
            <button id="removeNoShkBoxBtn" class="btn btn-outline" type="button">Убрать с полки</button>
        </div>
        <div id="noShkBoxDetailStatus" class="review-status"></div>
    </div>
</section>
```

In `no_shk_zone.js`, `openBoxDetailModal`, replace:
```js
    function openBoxDetailModal(boxId) {
        const ctx = findBoxContext(boxId);
        if (!ctx) return;
        activeBoxId = boxId;
        const { box, shelf, rack } = ctx;
        const location = shelf ? escapeHtmlLocal(rack.name) + " — " + escapeHtmlLocal(shelf.name) : "На полу";
        $("noShkBoxDetailWrap").innerHTML = "<div style='display:flex;flex-direction:column;gap:6px;font-size:14px;'>"
            + "<div><strong>Короб без ШК " + box.box_number + "</strong></div>"
            + "<div>Дата: " + escapeHtmlLocal(computeDateLabel(box)) + " (" + escapeHtmlLocal(box.shift_type) + ")</div>"
            + "<div>Тип: " + escapeHtmlLocal(box.box_type) + "</div>"
            + "<div>Участок: " + escapeHtmlLocal(box.area) + "</div>"
            + "<div>Ответственный: " + escapeHtmlLocal(box.responsible_name) + "</div>"
            + "<div>Местоположение: " + location + "</div>"
            + "</div>";
        $("removeNoShkBoxBtn").textContent = shelf ? "Убрать с полки (на пол)" : "Удалить короб";
        $("noShkBoxDetailStatus").textContent = "";
        setZoneModalOpen("noShkBoxDetailModal", true);
    }
```
with:
```js
    function openBoxDetailModal(boxId) {
        const ctx = findBoxContext(boxId);
        if (!ctx) return;
        activeBoxId = boxId;
        const { box, shelf, rack } = ctx;
        const location = box.outside_opp ? "Вне ОПП (Формируется)" : (shelf ? escapeHtmlLocal(rack.name) + " — " + escapeHtmlLocal(shelf.name) : "На полу");
        $("noShkBoxDetailWrap").innerHTML = "<div style='display:flex;flex-direction:column;gap:6px;font-size:14px;'>"
            + "<div><strong>Короб без ШК " + box.box_number + "</strong></div>"
            + "<div>Дата: " + escapeHtmlLocal(computeDateLabel(box)) + " (" + escapeHtmlLocal(box.shift_type) + ")</div>"
            + "<div>Тип: " + escapeHtmlLocal(box.box_type) + "</div>"
            + "<div>Участок: " + escapeHtmlLocal(box.area) + "</div>"
            + "<div>Ответственный: " + escapeHtmlLocal(box.responsible_name) + "</div>"
            + "<div>Товаров зафиксировано: " + box.total_items + "</div>"
            + "<div>Местоположение: " + location + "</div>"
            + "</div>";
        $("bringOutsideBoxBtn").style.display = box.outside_opp ? "" : "none";
        $("printNoShkBoxBtn").style.display = box.outside_opp ? "none" : "";
        $("removeNoShkBoxBtn").style.display = box.outside_opp ? "none" : "";
        $("removeNoShkBoxBtn").textContent = shelf ? "Убрать с полки (на пол)" : "Удалить короб";
        $("noShkBoxDetailStatus").textContent = "";
        setZoneModalOpen("noShkBoxDetailModal", true);
    }
```

- [ ] **Step 5: Implement `bringOutsideBox()` and wire the button**

Add near `removeActiveBox`:
```js
    async function bringOutsideBox() {
        const client = db();
        if (!client || !activeBoxId) return;
        const { error } = await client.from("wms_no_shk_boxes").update({ outside_opp: false }).eq("id", activeBoxId);
        if (error) {
            $("noShkBoxDetailStatus").textContent = "Не удалось перенести: " + error.message;
            $("noShkBoxDetailStatus").style.color = "#dc2626";
            return;
        }
        setZoneModalOpen("noShkBoxDetailModal", false);
        await loadZone();
    }
```

Near the other modal button wiring (next to `removeBoxBtn`/`printBoxBtn`):
```js
        const bringOutsideBtn = $("bringOutsideBoxBtn");
        if (bringOutsideBtn) bringOutsideBtn.addEventListener("click", () => void bringOutsideBox());
```

- [ ] **Step 6: `node --check`**

```bash
node --check /Users/WBwork/Downloads/WMSplus-main/no_shk_zone.js
```

- [ ] **Step 7: Live-verify via browser**

1. Create a test forming box directly: `supabase db query --linked
   "insert into wms_no_shk_boxes (area, shift_date, shift_type,
   box_type, responsible_name, outside_opp, total_items) values ('ХАБ',
   current_date, 'Дневная', 'Короб', 'Тест Ответственный', true, 5);"`
2. Open `tasks.html`'s "Без ШК" zone view in the browser. Expected: a
   new "Вне ОПП" section appears above "На полу", showing one tile
   labeled "ХАБ" with "5 шт." and today's date.
3. Click the tile: detail modal opens, shows "Статус"/location "Вне ОПП
   (Формируется)", "Товаров зафиксировано: 5", and a **Принесено**
   button (print/remove buttons hidden). Click **Принесено**.
4. Expected: modal closes, the zone reloads, the box now appears in "На
   полу" instead of "Вне ОПП" (with print/remove buttons showing
   normally when reopened).
5. Clean up: `supabase db query --linked "delete from wms_no_shk_boxes
   where responsible_name = 'Тест Ответственный';"`

- [ ] **Step 8: Commit**

```bash
git add no_shk_zone.js tasks.html
git commit -m "feat: Вне ОПП section and Принесено handoff in the Без ШК zone"
```

---

## Task 9: Manual on-site verification (hardware-dependent, cannot be done remotely)

Nobody in this session has network access to the warehouse's TSD device
or a way to visually confirm on-screen QR legibility under real scanner
hardware/lighting — this task is an explicit manual step for the user,
not something to delegate to an agent.

- [ ] On a real phone/tablet, open the live form (`https://wmsplus.github.io/`)
  and walk through the ХАБ **Шредер** → sticker scan → **Инструкция**
  path on-site, scanning each rendered QR slide (steps 4, 5, 9) with the
  actual ТСД device. Confirm the ТСД reads each code correctly and that
  the values it decodes match `PLCE1034816435` / `WCT1000100010`.
- [ ] Repeat for the **Упаковка** area's codes (`PLCE1034816436` /
  `WCT700100010`), and for the short (**Пропустить**) sequence.
- [ ] Confirm on-screen QR size/contrast is comfortably scannable at
  actual screen brightness in the warehouse's lighting conditions —
  adjust `renderQrInto`'s `width`/`height` (Task 3, currently 220x220)
  if the ТСД struggles.
- [ ] Confirm the "Бытовая химия" → "Товар льётся" flow and the
  Маркетплейс "Отнесите товар на ХАБ" flow read correctly to warehouse
  staff in practice (copy review from an actual floor worker, not just
  a screen read-through).
- [ ] Physically carry a forming shift box's contents to the "Без ШК"
  zone at the end of a real shift and confirm the "Принесено" workflow
  (Task 8) matches how staff actually work — in particular whether the
  responsible-person auto-computation matches who staff would expect.

---

## Self-Review

**Spec coverage:** Part A.1 matrix → Tasks 2 (routing/priority), 4
(Маркетплейс), 5 (Товар льётся). A.2 QR codes → Task 3. A.3 screens →
Task 3. A.4 household chemicals → Task 5. A.5 Маркетплейс → Task 4. A.6
QR rendering → Task 3. B.2 columns → Task 1. B.3 `wms_no_shk_boxes`
changes → Task 6. B.4 RPC → Task 6. B.5 counter → Task 7. B.6 zone UI →
Task 8. B.7 (no bucket viewer) → intentionally not built, matches spec.
Hardware verification → Task 9.

**Placeholder scan:** No TBD/TODO; every step carries real code and
exact copy strings matching the spec's final (corrected) wording.

**Type consistency:** `computeShift()` return shape (`{date, type,
label}`) is defined once in Task 2 and consumed identically in Tasks 3
(implicitly, via `finalizeSubmit`), 7. `needsStickerFlow()`/
`computeNoShkBucket()` defined in Task 2, consumed via `finalizeSubmit`
in Tasks 3/7 without redefinition. `wms_no_shk_box_log_item`'s parameter
names (`p_area`, `p_shift_date`, `p_shift_type`, `p_full_name`) match
exactly between Task 6's SQL and Task 7's `supabaseClient.rpc(...)`
call. `state.spillFlag` introduced in Task 2, set in Task 5, read via
`needsStickerFlow()`/`computeNoShkBucket()` — no other task reintroduces
it under a different name.
