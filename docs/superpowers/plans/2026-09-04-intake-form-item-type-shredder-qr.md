# Тип товара, Шредер, сканирование QR — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a type-selection step (Мелкий товар / КГТ / Шредер) ahead
of the existing category/name/photo wizard, with per-type skip rules,
mandatory photo (removing the just-shipped skip-photo feature), and a
live-camera QR scan step for Шредер whose decoded value is stored as
text (no image saved).

**Architecture:** Same repo (`/Users/WBwork/Downloads/wmsplus-intake-form`,
live at `https://wmsplus.github.io/`), same Supabase project. One
migration adds `item_type` and `sticker_code`, makes `category`/
`item_text` nullable, reverts `photo_path` to required, and narrows the
category check list from 13 to 12 (КГТ removed as a category, it's now
a type). `index.html` and `intake.js` are rewritten together again (same
reasoning as the prior wizard plan — too tightly coupled to split).

**Tech Stack:** Plain HTML/CSS/JS (no framework, no build step), `jsQR`
via CDN (`https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js`) for
client-side QR decoding from `getUserMedia` camera frames,
`@supabase/supabase-js@2` via CDN (unchanged).

**Spec:** [docs/superpowers/specs/2026-09-04-intake-form-item-type-shredder-qr-design.md](../specs/2026-09-04-intake-form-item-type-shredder-qr-design.md)

## Global Constraints

- Category list narrows to 12 exact strings (13 minus `КГТ`): Одежда,
  Обувь, Косметика, Бытовая химия, Мебель, Электроника, Ювелирка, Для
  авто, Для животных, Посуда, Еда, Посылка.
- `item_type` is required on every insert, exactly one of `'Мелкий товар'`,
  `'КГТ'`, `'Шредер'`.
- `category` and `item_text` are both nullable now (null for Шредер;
  `item_text` also null when category is `'Посылка'`).
- `photo_path` is required again on every insert — the skip-photo
  button and its handling are fully removed, not just hidden.
- `sticker_code` is nullable, populated only for Шредер submissions,
  holds the raw decoded QR text — never a photo/image.
- Honeypot (`id="c_addr_2"`), compression (1600px/JPEG 0.82), and
  upload/insert retry (3x/1500ms) logic must be carried over unchanged.
- Back navigation must go to wherever the user actually came from on
  THIS pass through the wizard, not a fixed prior screen — see the
  spec's flow diagram for the exact per-path targets.
- "Заполнить ещё раз" resets to the type-selection screen (the wizard's
  new first step), not the category screen.
- Camera access only ever happens on the Шредер sticker-scan screen,
  and the stream must be stopped (`track.stop()`) as soon as a code is
  found or the user navigates away from that screen — never left
  running in the background.
- Mobile scroll-lock, PWA manifest/icons, `localStorage` identity/area
  keys — all unchanged from the prior iteration, not touched by this plan.
- No branch workflow — direct push to `main` in both repos, as
  established all session.
- `node --check` on every `.js` file before considering a task done.

---

## Task 1: Migration — `item_type`, `sticker_code`, nullable category/item_text, required photo again

**Files:**
- Create: `supabase/migrations/202609040004_intake_submissions_item_type.sql`
  (in `/Users/WBwork/Downloads/WMSplus-main`)

**Interfaces:**
- Produces: `public.intake_submissions` gains `item_type` (not null, one
  of the 3 exact values) and `sticker_code` (nullable text); `category`
  and `item_text` lose `not null` but keep a value-list check (now 12
  values) that still applies when non-null; `photo_path` regains
  `not null`. Task 2's `intake.js` inserts using exactly these names.

- [ ] **Step 1: Write the migration file**

```sql
-- 202609040004_intake_submissions_item_type.sql
-- Item-type branching + Шредер QR flow (see
-- docs/superpowers/specs/2026-09-04-intake-form-item-type-shredder-qr-design.md).
-- КГТ moves from being a category to being its own top-level item_type,
-- so it's removed from the category check list. Шредер submissions have
-- no category/item_text, and carry a scanned sticker_code instead of
-- relying on the user typing anything. Photo goes back to required now
-- that the skip-photo button is removed.
alter table public.intake_submissions
    add column item_type text not null
        check (item_type in ('Мелкий товар', 'КГТ', 'Шредер'));

alter table public.intake_submissions
    add column sticker_code text;

alter table public.intake_submissions
    drop constraint intake_submissions_category_check;

alter table public.intake_submissions
    alter column category drop not null;

alter table public.intake_submissions
    add constraint intake_submissions_category_check
        check (category is null or category in (
            'Одежда', 'Обувь', 'Косметика', 'Бытовая химия', 'Мебель',
            'Электроника', 'Ювелирка', 'Для авто', 'Для животных', 'Посуда',
            'Еда', 'Посылка'
        ));

alter table public.intake_submissions
    alter column item_text drop not null;

alter table public.intake_submissions
    alter column photo_path set not null;
```

- [ ] **Step 2: Find the real name of the existing category check constraint**

The original migration (`202609040001_intake_submissions.sql`) created
the category check inline as part of `create table`, so Postgres
auto-named it. Before applying Step 1's SQL, confirm the actual
constraint name:

```bash
cd /Users/WBwork/Downloads/WMSplus-main
cat > /tmp/find-category-constraint.sql <<'EOF'
select conname from pg_constraint
where conrelid = 'public.intake_submissions'::regclass
  and pg_get_constraintdef(oid) ilike '%category%';
EOF
supabase link --project-ref bgphllmzmlwurfnbagho
supabase db query --linked -f /tmp/find-category-constraint.sql
rm -f /tmp/find-category-constraint.sql
```
If the returned name isn't `intake_submissions_category_check`, edit
Step 1's SQL file to use the real name in the `drop constraint` line
before applying it.

- [ ] **Step 3: Apply the migration**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
supabase db query --linked -f supabase/migrations/202609040004_intake_submissions_item_type.sql
```
Expected: no error output.

- [ ] **Step 4: Verify via the real REST API (anon key)**

```bash
ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q'

# Missing item_type -> 400
curl -s -o /dev/null -w "missing item_type: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":"x","employee_id":1,"full_name":"Тест","area":"ХАБ","category":"Посылка","photo_path":"x.jpg"}'

# category = 'КГТ' is no longer valid -> 400
curl -s -o /dev/null -w "КГТ as category: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":"x","employee_id":1,"full_name":"Тест","area":"ХАБ","item_type":"Мелкий товар","category":"КГТ","photo_path":"x.jpg"}'

# Missing photo_path -> 400 (required again)
curl -s -o /dev/null -w "missing photo_path: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":"x","employee_id":1,"full_name":"Тест","area":"ХАБ","item_type":"Мелкий товар","category":"Посылка"}'

# Valid Шредер row: no category, no item_text, has sticker_code -> 201
curl -s -o /dev/null -w "valid shredder: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":null,"employee_id":1,"full_name":"Тестовая запись (migration verify, Task 1)","area":"ХАБ","item_type":"Шредер","category":null,"photo_path":"x.jpg","sticker_code":"STICKER-TEST-123"}'

# Valid Мелкий товар row with category + name -> 201
curl -s -o /dev/null -w "valid small item: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":"Тестовая запись (migration verify, Task 1 second row)","employee_id":1,"full_name":"Тест","area":"ХАБ","item_type":"Мелкий товар","category":"Обувь","photo_path":"x.jpg"}'
```
Expected: `400`, `400`, `400`, `201`, `201` in that order.

- [ ] **Step 5: Clean up and confirm**

```bash
cat > /tmp/task1-item-type-cleanup.sql <<'EOF'
delete from public.intake_submissions where full_name like 'Тестовая запись%' or item_text like 'Тестовая запись%';
select count(*) as remaining from public.intake_submissions where full_name like 'Тестовая запись%' or item_text like 'Тестовая запись%';
EOF
supabase db query --linked -f /tmp/task1-item-type-cleanup.sql
rm -f /tmp/task1-item-type-cleanup.sql
```
Expected: `remaining: 0`.

- [ ] **Step 6: Commit**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
git fetch origin main && git log --oneline origin/main..main
git add supabase/migrations/202609040004_intake_submissions_item_type.sql
git commit -m "Add item_type/sticker_code, nullable category/item_text, required photo_path again"
git fetch origin main && git log --oneline origin/main..main
git push origin main
```
If new commits appear, `git rebase origin/main` (stash `.DS_Store` first
if it blocks the rebase, per established practice this session).

---

## Task 2: Rewrite the wizard (`index.html` + `intake.js`) — type step, skip rules, mandatory photo, QR scan

**Files:**
- Modify (full rewrite): `/Users/WBwork/Downloads/wmsplus-intake-form/index.html`
- Modify (full rewrite): `/Users/WBwork/Downloads/wmsplus-intake-form/intake.js`

**Interfaces:**
- Consumes: `item_type`/`sticker_code`/nullable `category`+`item_text`/
  required `photo_path` from Task 1.
- Produces: the live site's entire wizard flow. Last task in this plan.

- [ ] **Step 1: Write `index.html`**

Start from the CURRENT live file (`/Users/WBwork/Downloads/wmsplus-intake-form/index.html`,
commit `3610498` — includes the PWA head tags, the `.screen`/`overflow-y:auto`/
`safe-area-inset` fixes, honeypot, and all 7 existing screens) and make
these changes:

1. Add the jsQR CDN script tag in `<head>`, after the existing
   supabase-js tag:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"></script>
   ```

2. Add a new first wizard screen, `screenItemType`, inserted right
   after `screenArea` and before `screenCategory`. Reuse the existing
   `.area-btn` class as-is (same visual style as the area-selection
   buttons) — `type-btn` is added only as a second class, purely as a
   JS selector hook; it contributes no CSS of its own, so no new CSS
   rule is needed for this screen:
   ```html
   <section id="screenItemType" class="screen">
       <div id="areaPillType" class="area-pill"><span id="areaPillTypeText"></span> ✎</div>
       <div class="screen-card" style="text-align:center;">
           <h1>Выберите тип товара</h1>
           <button class="area-btn type-btn" data-type="Мелкий товар" type="button">Мелкий товар</button>
           <button class="area-btn type-btn" data-type="КГТ" type="button">КГТ</button>
           <button class="area-btn type-btn" data-type="Шредер" type="button">Шредер</button>
       </div>
   </section>
   ```

3. Add a back button to `screenCategory` (it didn't need one before —
   it was the first wizard step; now `screenItemType` is):
   ```html
   <button id="backToTypeBtn" class="back-btn" type="button">←</button>
   ```
   Insert this as the first child of `<section id="screenCategory" ...>`,
   alongside the existing `areaPillCategory` div.

4. On `screenPhoto`, delete the `Пропустить` button entirely:
   ```html
   <button id="skipPhotoBtn" class="secondary-btn" type="button">Пропустить</button>
   ```
   Remove this line completely — no replacement.

5. Add a new screen, `screenStickerScan`, inserted right after
   `screenPhoto` and before `screenSuccess`:
   ```html
   <section id="screenStickerScan" class="screen">
       <div id="areaPillSticker" class="area-pill"><span id="areaPillStickerText"></span> ✎</div>
       <button id="backToPhotoFromScanBtn" class="back-btn" type="button">←</button>
       <div class="screen-card" style="text-align:center;">
           <h1>Отсканируйте стикер</h1>
           <p style="margin:0 0 16px;font-size:14px;">Надёжно упакуйте товар, наклейте пустой стикер и наведите камеру на его QR-код.</p>
           <video id="qrVideo" playsinline muted style="width:100%;max-width:320px;border-radius:var(--radius-md);background:#000;"></video>
           <canvas id="qrCanvas" style="display:none;"></canvas>
           <div id="stickerMsg" class="msg"></div>
       </div>
   </section>
   ```

6. Every existing `areaPillCategoryText`/`areaPillNameText`/
   `areaPillPhotoText` pattern needs a matching `areaPillTypeText` (from
   step 2 above) and `areaPillStickerText` (from step 5 above) — both
   already included in the markup above, just make sure
   `updateAreaPills()` in `intake.js` (Step 2 below) updates all five,
   not just three.

- [ ] **Step 2: Write `intake.js`**

Start from the current live file (commit `3610498` — includes
`compressImage`, `withRetry`, the identity/area screens, and the
CDN-failure guard, all unchanged by this task) and make these changes:

**a) `CATEGORIES` array** — remove the `КГТ` entry entirely (12 left):
```js
const CATEGORIES = [
    { name: 'Одежда', emoji: '👕' },
    { name: 'Обувь', emoji: '👟' },
    { name: 'Косметика', emoji: '💄' },
    { name: 'Бытовая химия', emoji: '🧴' },
    { name: 'Мебель', emoji: '🛋️' },
    { name: 'Электроника', emoji: '🔌' },
    { name: 'Ювелирка', emoji: '💍' },
    { name: 'Для авто', emoji: '🚗' },
    { name: 'Для животных', emoji: '🐾' },
    { name: 'Посуда', emoji: '🍽️' },
    { name: 'Еда', emoji: '🍎' },
    { name: 'Посылка', emoji: '📦' },
];
```

**b) `updateAreaPills()`** — update all five pill spans:
```js
function updateAreaPills() {
    ['areaPillTypeText', 'areaPillCategoryText', 'areaPillNameText', 'areaPillPhotoText', 'areaPillStickerText'].forEach((id) => {
        document.getElementById(id).textContent = state.area || '';
    });
}
```

**c) `goToStart()`** — after identity/area are resolved, land on the
new first wizard screen instead of category:
```js
function goToStart() {
    if (!state.employeeId || !state.fullName) {
        showScreen('screenId');
    } else if (!state.area) {
        showScreen('screenArea');
    } else {
        updateAreaPills();
        showScreen('screenItemType');
    }
}
```
Also change the area-selection buttons' click handler (currently ends
with `showScreen('screenCategory')`) to end with
`showScreen('screenItemType')` instead.

**d) `state` object** — add the new fields:
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
};
let photoBackTarget = 'screenCategory';
let qrStream = null;
let qrAnimFrame = null;
```

**e) Pill-pencil listeners** — add the two new pills to the existing
loop that opens `screenArea`:
```js
['areaPillType', 'areaPillCategory', 'areaPillName', 'areaPillPhoto', 'areaPillSticker'].forEach((id) => {
    document.getElementById(id).addEventListener('click', () => {
        stopQrScan();
        showScreen('screenArea');
    });
});
```
(`stopQrScan()` — defined in part (j) below — is a no-op if no scan is
in progress; calling it unconditionally here is just a safety net in
case someone taps the pill while the camera happens to be open.)

**f) Type-selection screen wiring** (new):
```js
document.querySelectorAll('.type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        state.itemType = btn.dataset.type;
        if (state.itemType === 'Шредер') {
            state.category = null;
            state.itemText = null;
            photoBackTarget = 'screenItemType';
            showScreen('screenPhoto');
        } else {
            showScreen('screenCategory');
        }
    });
});
document.getElementById('backToTypeBtn').addEventListener('click', () => showScreen('screenItemType'));
```

**g) Category screen wiring** — modify the existing category-button
click handler to branch on `Посылка`:
```js
CATEGORIES.forEach((cat) => {
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
```

**h) `submitItemName()`** — set the back-target before navigating, and
keep the existing `photoMsg` clear (from the prior fix round):
```js
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
    photoMsg.textContent = '';
    photoMsg.className = 'msg';
    showScreen('screenPhoto');
}
```

**i) Photo screen** — delete the existing `skipPhotoBtn` variable
declaration and its `addEventListener('click', ...)` line entirely (no
replacement — the button itself is gone per Step 1.4), delete the
entire old `submitEntry` function (fully replaced by `handlePhoto` here
plus `finalizeSubmit` in part (k) below), and replace the old
`backToNameBtn`/`photoPickBtn`/`photoInput` listeners with these:
```js
document.getElementById('backToNameBtn').addEventListener('click', () => showScreen(photoBackTarget));

photoPickBtn.addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (file) handlePhoto(file);
});

async function handlePhoto(rawFile) {
    // Honeypot: bots fill every field, real users never see or fill this one.
    if (document.getElementById('c_addr_2').value) return;

    photoPickBtn.disabled = true;
    photoMsg.className = 'msg';
    photoMsg.textContent = '';

    try {
        photoMsg.textContent = 'Сжимаем фото...';
        const file = await compressImage(rawFile);
        if (file.size > 8 * 1024 * 1024) {
            photoMsg.textContent = 'Фото слишком большое (максимум 8 МБ).';
            photoMsg.className = 'msg is-error';
            return;
        }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const photoPath = Date.now() + '-' + crypto.randomUUID() + '.' + ext;

        await withRetry(3, 'Загрузка фото', (m) => { photoMsg.textContent = m; }, async () => {
            photoMsg.textContent = 'Загрузка фото...';
            const { error } = await supabaseClient.storage
                .from('intake-photos')
                .upload(photoPath, file, { contentType: file.type || 'image/jpeg' });
            if (error) throw error;
        });

        state.photoPath = photoPath;

        if (state.itemType === 'Шредер') {
            showScreen('screenStickerScan');
            startQrScan();
        } else {
            await finalizeSubmit(photoMsg);
        }
    } catch (err) {
        photoMsg.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
        photoMsg.className = 'msg is-error';
    } finally {
        photoPickBtn.disabled = false;
        photoInput.value = '';
    }
}
```

**j) Sticker-scan screen (new)**:
```js
const stickerMsg = document.getElementById('stickerMsg');

function stopQrScan() {
    if (qrAnimFrame) {
        cancelAnimationFrame(qrAnimFrame);
        qrAnimFrame = null;
    }
    if (qrStream) {
        qrStream.getTracks().forEach((t) => t.stop());
        qrStream = null;
    }
}

async function startQrScan() {
    stickerMsg.textContent = '';
    stickerMsg.className = 'msg';
    const video = document.getElementById('qrVideo');
    try {
        qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = qrStream;
        await video.play();
        qrAnimFrame = requestAnimationFrame(scanQrFrame);
    } catch (err) {
        stickerMsg.textContent = 'Не удалось открыть камеру: ' + (err.message || 'нет доступа');
        stickerMsg.className = 'msg is-error';
    }
}

function scanQrFrame() {
    const video = document.getElementById('qrVideo');
    const canvas = document.getElementById('qrCanvas');
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
            stopQrScan();
            state.stickerCode = code.data;
            finalizeSubmit(stickerMsg);
            return;
        }
    }
    qrAnimFrame = requestAnimationFrame(scanQrFrame);
}

document.getElementById('backToPhotoFromScanBtn').addEventListener('click', () => {
    stopQrScan();
    showScreen('screenPhoto');
});
```

**k) `finalizeSubmit()` (new, replaces the insert portion of the old
`submitEntry`)** — takes the message element to report into, since it's
called from either the photo screen or the sticker-scan screen:
```js
async function finalizeSubmit(msgEl) {
    try {
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
                });
            if (error) throw error;
        });
        showScreen('screenSuccess');
    } catch (err) {
        msgEl.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
        msgEl.className = 'msg is-error';
    }
}
```

**l) `againBtn` handler** — reset to the type screen, clearing all
per-submission state:
```js
document.getElementById('againBtn').addEventListener('click', () => {
    state.itemType = null;
    state.category = null;
    state.itemText = null;
    state.photoPath = null;
    state.stickerCode = null;
    showScreen('screenItemType');
});
```

- [ ] **Step 3: Syntax-check**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```
Expected: no output.

- [ ] **Step 4: Serve locally and verify against the real Supabase project**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form && (python3 -m http.server 8950 &>/tmp/item-type-server.log &) && sleep 1 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8950/index.html
```
Expected: `200`.

Open in a **fresh** Claude_Browser tab (reused tabs can serve stale
cached pages in this tooling), `localStorage.clear(); location.reload();`,
then walk through identity (`4242` / `Тестов Тест`) and area (`ХАБ`) as
in prior verification passes, arriving at `screenItemType`.

**4a. Мелкий товар + normal category (not Посылка).** Click "Мелкий
товар" → `screenCategory` active (12 buttons, no "КГТ" among them —
confirm via `document.querySelectorAll('.category-btn').length === 12`).
Pick "Обувь" → `screenItemName` active. Fill and submit:
```js
document.getElementById('itemNameInput').value = 'Тестовая запись (item-type: мелкий товар)';
document.getElementById('itemNameNextBtn').click();
```
Expected: `screenPhoto` active, `photoBackTarget` (check via closure —
if not directly inspectable, verify behaviorally in 4e instead) implies
back goes to `screenItemName`. Attach the same synthetic PNG technique
used in prior verification passes; wait for success. Verify via SQL:
`item_type = 'Мелкий товар'`, `category = 'Обувь'`, `item_text` matches,
`photo_path` non-null, `sticker_code` null.

**4b. Мелкий товар + Посылка (skips naming).** From success, click
`#againBtn` → `screenItemType` active (not `screenCategory` — confirms
the "again" target changed). Click "Мелкий товар" → pick "Посылка" →
expected: `screenPhoto` active DIRECTLY (screenItemName never shown).
Attach photo, wait for success. Verify via SQL: `category = 'Посылка'`,
`item_text` is `null`.

**4c. КГТ behaves like Мелкий товар.** From success → again → "КГТ" →
`screenCategory` active (same 12-button grid) → pick any non-Посылка
category → name → photo → success. Verify `item_type = 'КГТ'`.

**4d. Шредер skips both category and name, mandatory photo, then QR scan.**
From success → again → "Шредер" → expected: `screenPhoto` active
IMMEDIATELY (screenCategory and screenItemName both skipped). Attach a
synthetic photo. Wait — expected: `screenStickerScan` active next (NOT
`screenSuccess` yet). Since this sandboxed browser has no real camera,
`getUserMedia` will fail — confirm `#stickerMsg` shows a Russian error
message (not stuck silently, not a native error dialog) and
`document.getElementById('screenStickerScan').classList.contains('is-active')`
stays `true` (correctly does NOT proceed to submission without a scan).
This is expected and correct behavior for this environment — real QR
scanning cannot be verified here (see Step 7's note).

**4e. Back navigation matches wherever you actually came from.** Repeat
4a's path up to `screenPhoto`, click `#backToNameBtn` → expect
`screenItemName` (with the typed name preserved, per existing
behavior). Repeat 4b's path (Посылка) up to `screenPhoto`, click
`#backToNameBtn` → expect `screenCategory` (not `screenItemName`, which
was never shown this time). Repeat 4d's path (Шредер) up to
`screenPhoto`, click `#backToNameBtn` → expect `screenItemType`.

**4f. No skip-photo button exists anywhere.**
```js
document.getElementById('skipPhotoBtn')
```
Expected: `null`.

**4g. Honeypot still works.** Reach `screenPhoto` via any path, set
`document.getElementById('c_addr_2').value = 'spam'`, attach a photo —
expected: `handlePhoto` returns immediately, no upload, no DB row,
`screenPhoto` stays active (confirm via the same network-request-check
pattern used in earlier verification passes).

- [ ] **Step 5: Clean up test data and stop the server**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
cat > /tmp/item-type-cleanup.sql <<'EOF'
delete from public.intake_submissions where item_text like 'Тестовая запись%';
EOF
supabase db query --linked -f /tmp/item-type-cleanup.sql
rm -f /tmp/item-type-cleanup.sql
pkill -f "http.server 8950" 2>/dev/null
```

- [ ] **Step 6: Commit and push**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add index.html intake.js
git commit -m "Add item-type step (Мелкий товар/КГТ/Шредер), mandatory photo, QR sticker scan"
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
curl -s "https://wmsplus.github.io/index.html?_=$(date +%s)" | grep -c "screenItemType"
curl -s "https://wmsplus.github.io/intake.js?_=$(date +%s)" | grep -c "jsQR"
```
Expected: `200`, `≥1`, `≥1`.

**Cannot verify from here:** actual QR decoding against a real printed
sticker on a real phone camera — this sandboxed environment has no
camera device, so Step 4d's verification only confirms the
error-handling path (camera unavailable), not a successful scan. The
final step for the user is to open `https://wmsplus.github.io/` on
their phone, pick "Шредер", take a photo, and confirm the camera opens
and a real QR code gets recognized and the submission completes.
