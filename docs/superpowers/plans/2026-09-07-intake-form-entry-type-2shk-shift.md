# Тип заявки, 2 ШК/Пустая упаковка, категории, анимации, смена — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level "what kind of submission" screen ahead of the
existing Без ШК wizard (Товар без ШК / 2 ШК на товаре / Пустая
упаковка), with the two new branches writing into the existing
`2shk_rep` table instead of `intake_submissions`; narrow the Без ШК
category list per item type; add lightweight screen-transition
animations; add a date/shift header.

**Architecture:** Client-only change — no new Supabase migration.
`2shk_rep` already exists, already has open `anon` grants, and gets its
schema/conventions from an already-running Yandex Forms process; this
plan writes into it following those exact conventions rather than
changing it. Same repo (`/Users/WBwork/Downloads/wmsplus-intake-form`),
one combined task again (HTML+JS are too tightly coupled to split, same
reasoning as every prior round this session).

**Tech Stack:** Plain HTML/CSS/JS, unchanged CDN dependencies
(`@supabase/supabase-js@2`, `jsQR`).

**Spec:** [docs/superpowers/specs/2026-09-07-intake-form-entry-type-2shk-shift-design.md](../specs/2026-09-07-intake-form-entry-type-2shk-shift-design.md)

## Global Constraints

- `2shk_rep` schema/conventions (do not change the table): `shk1` text,
  `shk2` text, `eventtype` text, `media` text (a full public URL, not a
  bare storage path — matches existing rows), `wh_id` text, `created_at`
  defaults to `now()`. `eventtype` values must be the exact strings
  `'Два ШК'` and `'Пустая упаковка'` (already used by thousands of
  existing rows). `wh_id` is always the fixed string `'50144199'` for
  submissions from this form. Empty-package rows use `shk2 = ' '`
  (a literal single space, not null/empty string — matches existing
  convention).
- ШК fields validate as digits-only (`/^\d+$/`) client-side before
  allowing photo selection — no length restriction (barcodes vary).
- Photo is mandatory on both new branches, reusing the exact same
  `compressImage`/`withRetry` logic already shipped (1600px/JPEG 0.82,
  3 attempts/1500ms), uploading to the same `intake-photos` bucket.
- Category lists for Без ШК are two separate explicit constants, not
  one list with runtime filtering:
  - Мелкий товар (11): Одежда, Обувь, Косметика, Бытовая химия,
    Электроника, Ювелирка, Для авто, Для животных, Посуда, Еда, Посылка.
  - КГТ (9): Обувь, Бытовая химия, Мебель, Электроника, Для авто, Для
    животных, Посуда, Еда, Посылка.
- Every button group that shares the `.area-btn` CSS class for styling
  (area-selection, item-type, and now entry-type buttons) must be
  selected in JS by a distinct `data-*` attribute (`[data-area]`,
  `[data-type]`, `[data-entry]`), never by the shared class — this repo
  hit a real bug earlier from an unscoped class selector cross-matching
  two button groups; do not reintroduce that risk with a third group.
  This also means the two EXISTING selectors
  (`document.querySelectorAll('#screenArea .area-btn')` and
  `document.querySelectorAll('.type-btn')`) should be changed to
  `[data-area]` and `[data-type]` respectively as part of this task,
  not just the new one.
- "Заполнить ещё раз" resets to the new entry-type screen (not
  `screenItemType`) — area/identity still not re-asked.
- Animations: opacity + small vertical translate, ~150-200ms, respecting
  `prefers-reduced-motion`. No heavy effects.
- Honeypot, compression, retry, mobile scroll-lock, PWA assets — all
  unchanged, must keep working exactly as before.
- No branch workflow — direct push to `main`.
- `node --check` on the final `intake.js`.

---

## Task 1: Entry-type screen, 2ШК/Пустая-упаковка flows, narrower categories, animations, shift header

**Files:**
- Modify: `/Users/WBwork/Downloads/wmsplus-intake-form/index.html`
- Modify: `/Users/WBwork/Downloads/wmsplus-intake-form/intake.js`

**Interfaces:**
- Consumes: the `2shk_rep` table as-is (no migration).
- Produces: the live site's entire flow. Last task in this plan.

**Before starting:** read the CURRENT live `index.html` and `intake.js`
in `/Users/WBwork/Downloads/wmsplus-intake-form` — this plan gives
itemized edits against whatever the fix wave from the PRIOR plan
(`2026-09-04-intake-form-item-type-shredder-qr.md`) most recently
shipped there. Confirm that fix wave has actually landed (check
`git log` for a commit mentioning `sticker_code` length / migration
replay-safety / QR retry button — if it's not there yet, STOP and tell
the controller rather than building on a stale base).

- [ ] **Step 1: HTML changes**

1. Add a new first screen, `screenEntryType`, inserted right after
   `screenArea` and before `screenItemType`:
   ```html
   <section id="screenEntryType" class="screen">
       <div id="areaPillEntry" class="area-pill"><span id="areaPillEntryText"></span> ✎</div>
       <div id="shiftHeader" class="shift-header"></div>
       <div class="screen-card" style="text-align:center;">
           <h1>Выберите тип заявки</h1>
           <button class="area-btn" data-entry="no-shk" type="button">Товар без ШК</button>
           <button class="area-btn" data-entry="two-shk" type="button">2 ШК на товаре</button>
           <button class="area-btn" data-entry="empty-package" type="button">Пустая упаковка</button>
       </div>
   </section>
   ```

2. Add the `shift-header` CSS rule and a back button + shift-header div
   to EVERY existing screen that doesn't yet have one — the shift
   header must appear on all screens (per spec, "постоянно видимый"),
   and `screenItemType` needs a back button now (it's no longer the
   first wizard screen). Add this CSS:
   ```css
   .shift-header {
       position: fixed;
       top: 14px;
       left: 50%;
       transform: translateX(-50%);
       font-size: 12px;
       font-weight: 600;
       color: var(--muted);
       opacity: .7;
       z-index: 9;
       text-align: center;
       white-space: nowrap;
   }
   ```
   Add exactly these eight `shift-header` divs, one per screen, using
   exactly these ids (each goes as a sibling right next to that
   screen's existing `area-pill` div — or, for `screenEntryType`,
   `screen2Shk`, `screenEmptyPackage`, next to the `area-pill` div
   given in their markup above/below in this same step):

   | Screen | Div to add |
   |---|---|
   | `screenEntryType` | `<div id="shiftHeaderEntry" class="shift-header"></div>` |
   | `screenItemType` | `<div id="shiftHeaderType" class="shift-header"></div>` |
   | `screenCategory` | `<div id="shiftHeaderCategory" class="shift-header"></div>` |
   | `screenItemName` | `<div id="shiftHeaderName" class="shift-header"></div>` |
   | `screenPhoto` | `<div id="shiftHeaderPhoto" class="shift-header"></div>` |
   | `screenStickerScan` | `<div id="shiftHeaderSticker" class="shift-header"></div>` |
   | `screen2Shk` | `<div id="shiftHeader2Shk" class="shift-header"></div>` (already shown in this screen's markup below) |
   | `screenEmptyPackage` | `<div id="shiftHeaderEmpty" class="shift-header"></div>` (already shown in this screen's markup below) |

   You will update all eight from one JS function in Step 2g, matching
   the existing `updateAreaPills()` pattern that already updates every
   `areaPill*Text` span from one place. `screenItemType` currently has
   no `area-pill` div (per the prior plan, it wasn't originally a
   "wizard screen with a pill") — add one now too, for consistency with
   every other post-entry-type screen, following the exact same markup
   pattern as the others (`<div id="areaPillType" class="area-pill"><span id="areaPillTypeText"></span> ✎</div>`) if it doesn't already exist; check the live file first, since the prior plan's task briefs may already have added this — don't duplicate it if it's already there.

3. Add a back button to `screenItemType` (it previously had none — it
   was the first wizard screen; now `screenEntryType` is):
   ```html
   <button id="backToEntryTypeBtn" class="back-btn" type="button">←</button>
   ```

4. Add two new screens, `screen2Shk` and `screenEmptyPackage`, inserted
   right after `screenItemType`'s section and before `screenCategory`
   (exact position relative to other screens doesn't matter — they're
   independently reachable via `showScreen`):
   ```html
   <section id="screen2Shk" class="screen">
       <div id="areaPill2Shk" class="area-pill"><span id="areaPill2ShkText"></span> ✎</div>
       <div id="shiftHeader2Shk" class="shift-header"></div>
       <button id="backToEntryFrom2ShkBtn" class="back-btn" type="button">←</button>
       <div class="screen-card">
           <h1>2 ШК на товаре</h1>
           <label style="display:block;font-size:13px;font-weight:600;margin:0 0 6px;">Введите верный ШК</label>
           <input id="shkCorrectInput" class="field" type="text" inputmode="numeric" placeholder="Верный ШК">
           <label style="display:block;font-size:13px;font-weight:600;margin:14px 0 6px;">Введите неверный ШК</label>
           <input id="shkWrongInput" class="field" type="text" inputmode="numeric" placeholder="Неверный ШК">
           <input id="photo2ShkInput" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" style="display:none;">
           <button id="photo2ShkPickBtn" class="photo-btn" type="button" style="margin-top:16px;">📷 Добавьте фото</button>
           <div id="shk2Msg" class="msg"></div>
       </div>
   </section>

   <section id="screenEmptyPackage" class="screen">
       <div id="areaPillEmpty" class="area-pill"><span id="areaPillEmptyText"></span> ✎</div>
       <div id="shiftHeaderEmpty" class="shift-header"></div>
       <button id="backToEntryFromEmptyBtn" class="back-btn" type="button">←</button>
       <div class="screen-card">
           <h1>Пустая упаковка</h1>
           <label style="display:block;font-size:13px;font-weight:600;margin:0 0 6px;">Введите ШК</label>
           <input id="shkEmptyInput" class="field" type="text" inputmode="numeric" placeholder="ШК">
           <input id="photoEmptyInput" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" style="display:none;">
           <button id="photoEmptyPickBtn" class="photo-btn" type="button" style="margin-top:16px;">📷 Добавьте фото</button>
           <div id="emptyMsg" class="msg"></div>
       </div>
   </section>
   ```

5. Change the `.screen` CSS rule to support animated transitions
   (currently it's shown/hidden via `display:none`/`display:flex`,
   which can't transition). Replace it with:
   ```css
   .screen {
       display: flex;
       flex-direction: column;
       align-items: center;
       justify-content: safe center;
       height: 100dvh;
       width: 100%;
       padding: 24px 20px;
       position: fixed;
       inset: 0;
       overflow-y: auto;
       opacity: 0;
       transform: translateY(8px);
       pointer-events: none;
       transition: opacity 180ms ease, transform 180ms ease;
   }
   .screen.is-active {
       opacity: 1;
       transform: translateY(0);
       pointer-events: auto;
   }
   ```
   Remove the old `.screen { display: none; ... }` / `.screen.is-active { display: flex; }` rules entirely — this replaces them. Add to the existing `@media (prefers-reduced-motion: reduce)` block:
   ```css
   .screen { transition: none; }
   ```

- [ ] **Step 2: JS changes**

**a) Category lists** — replace the single `CATEGORIES` array with two:
```js
const CATEGORIES_SMALL = [
    { name: 'Одежда', emoji: '👕' },
    { name: 'Обувь', emoji: '👟' },
    { name: 'Косметика', emoji: '💄' },
    { name: 'Бытовая химия', emoji: '🧴' },
    { name: 'Электроника', emoji: '🔌' },
    { name: 'Ювелирка', emoji: '💍' },
    { name: 'Для авто', emoji: '🚗' },
    { name: 'Для животных', emoji: '🐾' },
    { name: 'Посуда', emoji: '🍽️' },
    { name: 'Еда', emoji: '🍎' },
    { name: 'Посылка', emoji: '📦' },
];
const CATEGORIES_KGT = [
    { name: 'Обувь', emoji: '👟' },
    { name: 'Бытовая химия', emoji: '🧴' },
    { name: 'Мебель', emoji: '🛋️' },
    { name: 'Электроника', emoji: '🔌' },
    { name: 'Для авто', emoji: '🚗' },
    { name: 'Для животных', emoji: '🐾' },
    { name: 'Посуда', emoji: '🍽️' },
    { name: 'Еда', emoji: '🍎' },
    { name: 'Посылка', emoji: '📦' },
];
```

**b) Category grid becomes a function** — the existing code builds the
grid once at load with a `CATEGORIES.forEach(...)` loop appending to
`categoryGrid`. Turn that into a reusable function:
```js
function renderCategoryGrid(list) {
    categoryGrid.innerHTML = '';
    list.forEach((cat) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'category-btn';
        btn.innerHTML = '<span class="category-emoji">' + cat.emoji + '</span><span class="category-label">' + cat.name + '</span>';
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
        categoryGrid.appendChild(btn);
    });
}
```
(This is the exact same per-button logic that existed before, just
wrapped in a function taking `list` as a parameter instead of running
once against a module-level `CATEGORIES` constant.)

**c) Type-button handler** — change the selector from `.type-btn` to
`[data-type]`, and call `renderCategoryGrid(...)` with the right list
instead of just `showScreen('screenCategory')`:
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
(Keep whatever jsQR-guard logic the prior fix wave added to this
Шредер branch — don't remove it, just fold these changes in around it.)

**d) Area-button selector** — change
`document.querySelectorAll('#screenArea .area-btn')` (or whatever the
current selector is — check the live file) to
`document.querySelectorAll('[data-area]')`. The area buttons' HTML
already has `data-area="ХАБ"` etc. — no HTML change needed for this
one, just the JS selector.

**e) Entry-type screen wiring (new)**:
```js
document.querySelectorAll('[data-entry]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const entry = btn.dataset.entry;
        if (entry === 'no-shk') {
            showScreen('screenItemType');
        } else if (entry === 'two-shk') {
            shkCorrectInput.value = '';
            shkWrongInput.value = '';
            shk2Msg.textContent = '';
            shk2Msg.className = 'msg';
            showScreen('screen2Shk');
        } else if (entry === 'empty-package') {
            shkEmptyInput.value = '';
            emptyMsg.textContent = '';
            emptyMsg.className = 'msg';
            showScreen('screenEmptyPackage');
        }
    });
});
document.getElementById('backToEntryTypeBtn').addEventListener('click', () => showScreen('screenEntryType'));
document.getElementById('backToEntryFrom2ShkBtn').addEventListener('click', () => showScreen('screenEntryType'));
document.getElementById('backToEntryFromEmptyBtn').addEventListener('click', () => showScreen('screenEntryType'));
```

**f) `goToStart()`** — land on `screenEntryType` instead of
`screenItemType` once identity/area are resolved:
```js
function goToStart() {
    if (!state.employeeId || !state.fullName) {
        showScreen('screenId');
    } else if (!state.area) {
        showScreen('screenArea');
    } else {
        updateAreaPills();
        showScreen('screenEntryType');
    }
}
```
Also change the area-selection buttons' click handler (currently ends
with `showScreen('screenItemType')`) to end with
`showScreen('screenEntryType')` instead.

**g) `updateAreaPills()`** — add the three new pill spans to its
existing list (`areaPillEntryText`, `areaPill2ShkText`,
`areaPillEmptyText`), and add a second function, `updateShiftHeaders()`
(below), for the shift-header divs — call both together at every place
`updateAreaPills()` is currently called (every `shiftHeader*` div lives
on a screen only reachable after area is already set, same as the
`areaPill*` spans, so no separate call site is needed beyond that):
```js
function pad2(n) { return String(n).padStart(2, '0'); }
function formatDate(d) { return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1); }

function shiftLabel() {
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 8 && hour < 20) {
        return formatDate(now) + ' · Дневная смена';
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
    return formatDate(start) + '-' + formatDate(end) + ' · Ночная смена';
}

function updateShiftHeaders() {
    const label = shiftLabel();
    [
        'shiftHeaderEntry', 'shiftHeaderType', 'shiftHeaderCategory',
        'shiftHeaderName', 'shiftHeaderPhoto', 'shiftHeaderSticker',
        'shiftHeader2Shk', 'shiftHeaderEmpty',
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = label;
    });
}
```
Call `updateShiftHeaders()` everywhere `updateAreaPills()` is called
(same call sites), and set up a periodic refresh so the header doesn't
go stale if the page stays open across a shift boundary:
```js
setInterval(updateShiftHeaders, 60000);
```
(Place this call once, near the bottom of the script, not inside a
function that runs repeatedly.)

**h) `againBtn` handler** — reset to `screenEntryType`:
```js
document.getElementById('againBtn').addEventListener('click', () => {
    state.itemType = null;
    state.category = null;
    state.itemText = null;
    state.photoPath = null;
    state.stickerCode = null;
    showScreen('screenEntryType');
});
```

**i) 2ШК and Пустая-упаковка submission logic (new)** — add these
functions and event wiring. Reuses `compressImage`/`withRetry` exactly
as already defined elsewhere in the file:
```js
function isDigitsOnly(v) {
    return /^\d+$/.test(v);
}

function buildPublicPhotoUrl(path) {
    return 'https://bgphllmzmlwurfnbagho.supabase.co/storage/v1/object/public/intake-photos/' + path;
}

async function uploadCompressedPhoto(rawFile, onStatus) {
    onStatus('Сжимаем фото...');
    const file = await compressImage(rawFile);
    if (file.size > 8 * 1024 * 1024) {
        throw new Error('Фото слишком большое (максимум 8 МБ).');
    }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = Date.now() + '-' + crypto.randomUUID() + '.' + ext;
    await withRetry(3, 'Загрузка фото', onStatus, async () => {
        onStatus('Загрузка фото...');
        const { error } = await supabaseClient.storage
            .from('intake-photos')
            .upload(path, file, { contentType: file.type || 'image/jpeg' });
        if (error) throw error;
    });
    return path;
}

const shkCorrectInput = document.getElementById('shkCorrectInput');
const shkWrongInput = document.getElementById('shkWrongInput');
const photo2ShkInput = document.getElementById('photo2ShkInput');
const photo2ShkPickBtn = document.getElementById('photo2ShkPickBtn');
const shk2Msg = document.getElementById('shk2Msg');

photo2ShkPickBtn.addEventListener('click', () => {
    const correct = shkCorrectInput.value.trim();
    const wrong = shkWrongInput.value.trim();
    if (!isDigitsOnly(correct) || !isDigitsOnly(wrong)) {
        shk2Msg.textContent = 'ШК должен состоять только из цифр.';
        shk2Msg.className = 'msg is-error';
        return;
    }
    shk2Msg.textContent = '';
    shk2Msg.className = 'msg';
    photo2ShkInput.click();
});

photo2ShkInput.addEventListener('change', () => {
    const file = photo2ShkInput.files[0];
    if (file) submit2Shk(file);
});

async function submit2Shk(rawFile) {
    if (document.getElementById('c_addr_2').value) return;
    const correct = shkCorrectInput.value.trim();
    const wrong = shkWrongInput.value.trim();
    photo2ShkPickBtn.disabled = true;
    shk2Msg.className = 'msg';
    try {
        const path = await uploadCompressedPhoto(rawFile, (m) => { shk2Msg.textContent = m; });
        await withRetry(3, 'Сохранение', (m) => { shk2Msg.textContent = m; }, async () => {
            shk2Msg.textContent = 'Сохранение...';
            const { error } = await supabaseClient.from('2shk_rep').insert({
                shk1: correct,
                shk2: wrong,
                eventtype: 'Два ШК',
                media: buildPublicPhotoUrl(path),
                wh_id: '50144199',
            });
            if (error) throw error;
        });
        showScreen('screenSuccess');
    } catch (err) {
        shk2Msg.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
        shk2Msg.className = 'msg is-error';
    } finally {
        photo2ShkPickBtn.disabled = false;
        photo2ShkInput.value = '';
    }
}

const shkEmptyInput = document.getElementById('shkEmptyInput');
const photoEmptyInput = document.getElementById('photoEmptyInput');
const photoEmptyPickBtn = document.getElementById('photoEmptyPickBtn');
const emptyMsg = document.getElementById('emptyMsg');

photoEmptyPickBtn.addEventListener('click', () => {
    const shk = shkEmptyInput.value.trim();
    if (!isDigitsOnly(shk)) {
        emptyMsg.textContent = 'ШК должен состоять только из цифр.';
        emptyMsg.className = 'msg is-error';
        return;
    }
    emptyMsg.textContent = '';
    emptyMsg.className = 'msg';
    photoEmptyInput.click();
});

photoEmptyInput.addEventListener('change', () => {
    const file = photoEmptyInput.files[0];
    if (file) submitEmptyPackage(file);
});

async function submitEmptyPackage(rawFile) {
    if (document.getElementById('c_addr_2').value) return;
    const shk = shkEmptyInput.value.trim();
    photoEmptyPickBtn.disabled = true;
    emptyMsg.className = 'msg';
    try {
        const path = await uploadCompressedPhoto(rawFile, (m) => { emptyMsg.textContent = m; });
        await withRetry(3, 'Сохранение', (m) => { emptyMsg.textContent = m; }, async () => {
            emptyMsg.textContent = 'Сохранение...';
            const { error } = await supabaseClient.from('2shk_rep').insert({
                shk1: shk,
                shk2: ' ',
                eventtype: 'Пустая упаковка',
                media: buildPublicPhotoUrl(path),
                wh_id: '50144199',
            });
            if (error) throw error;
        });
        showScreen('screenSuccess');
    } catch (err) {
        emptyMsg.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
        emptyMsg.className = 'msg is-error';
    } finally {
        photoEmptyPickBtn.disabled = false;
        photoEmptyInput.value = '';
    }
}
```

Note the honeypot check (`document.getElementById('c_addr_2').value`)
is repeated in `submit2Shk`/`submitEmptyPackage`, matching the existing
pattern in `handlePhoto` — this is intentional duplication (each
submission entry point checks it independently), not something to
dedupe as part of this task.

**j) Initial render** — the very bottom of the script currently calls
`goToStart()` as its last line. Before that call, since the category
grid is no longer built at module load (Step 2b changed it to a
function called on demand), make sure nothing else in the file expects
`categoryGrid` to already be populated at load time — it shouldn't
need to be, since `screenCategory` is never the initial screen. No
change needed here beyond confirming this, but double-check the current
file doesn't have some other place besides the old `CATEGORIES.forEach`
that assumed the grid was pre-populated.

- [ ] **Step 3: Syntax-check**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```
Expected: no output.

- [ ] **Step 4: Serve locally and verify against the real Supabase project**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form && (python3 -m http.server 8960 &>/tmp/entrytype-server.log &) && sleep 1 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8960/index.html
```
Expected: `200`.

Open in a **fresh** Claude_Browser tab, `localStorage.clear(); location.reload();`, walk through identity + area to reach `screenEntryType`.

**4a. Entry-type routing.** Confirm `screenEntryType` is active (not `screenItemType`) right after area selection. Click "Товар без ШК" → `screenItemType` active. Click `#backToEntryTypeBtn` → back to `screenEntryType`.

**4b. Category lists differ by sub-type.** From `screenEntryType` → "Товар без ШК" → "Мелкий товар" → confirm `document.querySelectorAll('.category-btn').length === 11` and no button's label is "Мебель". Back to `screenItemType` → "КГТ" → confirm `.category-btn` count is `9` and none of "Одежда"/"Косметика"/"Ювелирка" appear.

**4c. "2 ШК на товаре" end-to-end.** From `screenEntryType`, click "2 ШК на товаре" → `screen2Shk` active. Try submitting with a non-digit ШК (e.g. `shkCorrectInput.value = 'abc'`) — confirm an error message appears and no file picker opens. Then fill both fields with digits (e.g. `'11111111111'` / `'22222222222'`) and attach a synthetic PNG the same way prior rounds have (base64 1×1 PNG via `DataTransfer`, dispatch `change` on `#photo2ShkInput`). Wait for success. Verify via SQL (from `/Users/WBwork/Downloads/WMSplus-main`):
```bash
cat > /tmp/verify-2shk.sql <<'EOF'
select shk1, shk2, eventtype, media, wh_id from public."2shk_rep" where shk1 = '11111111111' order by created_at desc limit 1;
EOF
supabase db query --linked -f /tmp/verify-2shk.sql
```
Expected: one row, `shk2='22222222222'`, `eventtype='Два ШК'`, `media` starts with `https://bgphllmzmlwurfnbagho.supabase.co/storage/v1/object/public/intake-photos/`, `wh_id='50144199'`.

**4d. "Пустая упаковка" end-to-end.** From `screenEntryType` → "Пустая упаковка" → fill `shkEmptyInput` with e.g. `'33333333333'`, attach a synthetic photo, wait for success. Verify via SQL: one row with `shk1='33333333333'`, `shk2=' '` (a single space — check the exact string, not just truthiness), `eventtype='Пустая упаковка'`.

**4e. Digit-only validation actually blocks non-digit input for both new forms**, confirmed already in 4c for `screen2Shk` — repeat the same non-digit check for `screenEmptyPackage`'s `shkEmptyInput`.

**4f. "Заполнить ещё раз" goes to the entry-type screen.** After any successful submission (4c or 4d), click `#againBtn` — expect `screenEntryType` active, not `screenItemType`.

**4g. Shift header renders a plausible value on every screen that has one.** From `screenEntryType`, check `document.getElementById('shiftHeaderEntry').textContent` is non-empty and contains either "Дневная смена" or "Ночная смена" with a `ДД.ММ`-formatted date (don't assert the exact value, it depends on real time-of-test). Spot-check at least one more screen (e.g. `shiftHeaderCategory` after navigating there) to confirm the same label appears consistently, not just on the first screen.

**4h. Existing flows still work (regression check).** Repeat one full "Товар без ШК" → Мелкий товар → non-Посылка category → name → photo submission, confirm success. Repeat the Шредер path far enough to confirm the type/back-button/category-skip logic still works (camera will fail in this sandboxed environment as before — that's expected, confirm graceful error + retry button per the already-shipped fix wave still present).

**4i. `[data-area]`/`[data-type]` selector changes didn't break anything.** Confirm area selection still correctly sets `state.area` (check `localStorage.getItem('wmsplus_intake_area')` after picking one) and that clicking a `[data-type]` button still only affects `state.itemType`/`state.area` as expected (not cross-contaminated) — this directly re-verifies the bug class this task's Global Constraints called out.

- [ ] **Step 5: Clean up test data and stop the server**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
cat > /tmp/entrytype-cleanup.sql <<'EOF'
delete from public."2shk_rep" where shk1 in ('11111111111', '33333333333');
delete from public.intake_submissions where item_text like 'Тестовая запись%';
EOF
supabase db query --linked -f /tmp/entrytype-cleanup.sql
rm -f /tmp/verify-2shk.sql /tmp/entrytype-cleanup.sql
pkill -f "http.server 8960" 2>/dev/null
```

- [ ] **Step 6: Commit and push**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add index.html intake.js
git commit -m "Add entry-type screen (2ШК/empty-package flows into 2shk_rep), narrower categories, transitions, shift header"
git fetch origin main && git log --oneline origin/main..main
git push origin main
```

- [ ] **Step 7: Confirm the live deployment**

```bash
for i in $(seq 1 20); do
  build_status=$(gh api repos/wmsplus/wmsplus.github.io/pages/builds/latest --jq '.status' 2>/dev/null)
  echo "attempt $i: status=$build_status"
  if [ "$build_status" = "built" ]; then break; fi
  sleep 6
done
curl -s -o /dev/null -w "%{http_code}\n" "https://wmsplus.github.io/"
curl -s "https://wmsplus.github.io/index.html?_=$(date +%s)" | grep -c "screenEntryType"
curl -s "https://wmsplus.github.io/intake.js?_=$(date +%s)" | grep -c "2shk_rep"
```
Expected: `200`, `≥1`, `≥1`.

**Cannot verify from here:** the real, live `2shk_admin.html` (or
whatever process consumes `2shk_rep`) actually displaying these new
rows correctly — this environment has no access to that admin surface.
The final step for the user is to open that admin view after a real
submission and confirm the new rows show up looking right.
