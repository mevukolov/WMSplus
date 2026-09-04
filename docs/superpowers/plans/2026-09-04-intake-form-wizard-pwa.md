# Форма приёма товара — мастер, участки, PWA — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-screen intake form (`wmsplus.github.io`) into an
installable PWA with one-time device identity + work area, and a
step-by-step per-submission wizard (category icons → name → optional
photo) instead of one long form.

**Architecture:** Same repo (`/Users/WBwork/Downloads/wmsplus-intake-form`,
deployed at `https://wmsplus.github.io/`), same Supabase project
(`bgphllmzmlwurfnbagho`). One migration adds two required columns
(`full_name`, `area`) and makes `photo_path` optional. `index.html` and
`intake.js` are rewritten together (they're too tightly coupled by
element IDs to split into separate tasks — a reviewer could not approve
one without the other). A new manifest + generated icon files make "Add
to Home Screen" open the page as a standalone app instead of inside
Safari's browser chrome.

**Tech Stack:** Plain HTML/CSS/JS (no framework, no build step), Web App
Manifest, `@supabase/supabase-js@2` via CDN (unchanged), PostgreSQL/
PostgREST (Supabase), `sips` (macOS built-in) for PNG verification.

**Spec:** [docs/superpowers/specs/2026-09-04-intake-form-wizard-pwa-design.md](../specs/2026-09-04-intake-form-wizard-pwa-design.md)

## Global Constraints

- No real authentication anywhere — identity is just three `localStorage`
  keys on the device, not a security boundary.
- `localStorage` keys, exact names: `wmsplus_intake_employee_id`,
  `wmsplus_intake_full_name`, `wmsplus_intake_area`.
- Category list unchanged (13 values, exact strings) — now paired with an
  emoji each (see Task 3).
- Honeypot field must be preserved exactly as it works today: hidden
  input `id="c_addr_2" name="c_addr_2"`, checked before any network call,
  silently no-ops if filled.
- The existing photo-compression (`createImageBitmap` → downscale to max
  1600px side → re-encode JPEG quality 0.82, falls back to the original
  file if decoding fails) and upload/insert retry (3 attempts, 1500ms
  pause between, status message shows attempt count) logic already works
  and must be carried over unchanged into the new flow, not rewritten
  from scratch or regressed.
- `photo_path` becomes nullable — the "Пропустить" path must insert a row
  with `photo_path: null`.
- New required fields on every insert: `full_name` (the person's full
  name, 1–200 characters), `area` (exactly one of `'ХАБ'`, `'Упаковка'`,
  `'Маркетплейс'`).
- Mobile viewport must not scroll: `overflow: hidden` on `html`/`body`
  under `max-width: 768px`, every screen sized to fit `100dvh`.
- Same Supabase project and anon key as the rest of this repo — do not
  create a new project or change the key.
- This repo has no branch workflow — work happens directly on `main`,
  matching every prior commit in this repo.
- Before every `git push`: `git fetch origin main && git log --oneline
  origin/main..main` to check for a concurrent session's commits (this
  repo is otherwise only touched by this session, but the sibling
  `WMSplus-main` repo the migration lives in has an established pattern
  of concurrent pushes — check anyway, it's free).
- `node --check` on every `.js` file before considering a task done.

---

## Task 1: Migration — `full_name`, `area`, optional `photo_path`

**Files:**
- Create: `supabase/migrations/202609040003_intake_submissions_wizard_fields.sql`
  (in `/Users/WBwork/Downloads/WMSplus-main`)

**Interfaces:**
- Produces: `public.intake_submissions` gains `full_name` (text, not
  null, 1–200 chars) and `area` (text, not null, one of `'ХАБ'`,
  `'Упаковка'`, `'Маркетплейс'`); `photo_path` loses its `not null`.
  Task 3's `intake.js` inserts rows using exactly these column names.

- [ ] **Step 1: Write the migration file**

The live table currently holds exactly 5 rows — the site owner's own
manual tests from testing an earlier fix (`item_text` values `тест4`,
`тест5`, `тест7`, `тест8`, `тест9`, all the same `employee_id`, no real
production data). Confirmed via `supabase db query --linked` before
writing this plan. Delete them first so `full_name`/`area` can be added
as `NOT NULL` cleanly on an empty table, instead of inventing a fake
backfill value for data that was never real:

```sql
-- 202609040003_intake_submissions_wizard_fields.sql
-- Wizard/PWA redesign (see
-- docs/superpowers/specs/2026-09-04-intake-form-wizard-pwa-design.md):
-- adds who's submitting by name (full_name, alongside the existing
-- employee_id) and which work area they're on, and makes the photo
-- optional (the wizard lets a person skip it and still finish the
-- submission if it fails to upload).
--
-- The rows in the table at the time of this migration are the site
-- owner's own manual test submissions (item_text 'тест4'..'тест9', all
-- the same employee_id) -- deleted here so full_name/area can be added
-- as NOT NULL cleanly, without inventing a fake backfill value.
delete from public.intake_submissions where item_text ~ '^тест[0-9]+$';

alter table public.intake_submissions
    add column full_name text not null;

alter table public.intake_submissions
    add constraint intake_submissions_full_name_length
        check (char_length(full_name) between 1 and 200);

alter table public.intake_submissions
    add column area text not null
        check (area in ('ХАБ', 'Упаковка', 'Маркетплейс'));

alter table public.intake_submissions
    alter column photo_path drop not null;
```

- [ ] **Step 2: Apply the migration**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
supabase link --project-ref bgphllmzmlwurfnbagho
supabase db query --linked -f supabase/migrations/202609040003_intake_submissions_wizard_fields.sql
```
Expected: no error output.

- [ ] **Step 3: Verify via the real REST API (anon key)**

```bash
ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q'

# Missing full_name -> 400
curl -s -o /dev/null -w "missing full_name: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":"x","employee_id":1,"category":"Посылка","area":"ХАБ"}'

# Missing area -> 400
curl -s -o /dev/null -w "missing area: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":"x","employee_id":1,"category":"Посылка","full_name":"Тест Тестов"}'

# Invalid area -> 400
curl -s -o /dev/null -w "invalid area: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":"x","employee_id":1,"category":"Посылка","full_name":"Тест","area":"Склад"}'

# Valid insert WITHOUT photo_path -> 201 (proves the column is now optional)
curl -s -o /dev/null -w "valid, no photo: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"item_text":"Тестовая запись (migration verify, Task 1)","employee_id":1,"category":"Посылка","full_name":"Тест Тестов","area":"ХАБ"}'
```
Expected: `400`, `400`, `400`, `201` in that order.

- [ ] **Step 4: Clean up and confirm the table is empty again**

```bash
cat > /tmp/task1-wizard-cleanup.sql <<'EOF'
delete from public.intake_submissions where item_text like 'Тестовая запись%';
select count(*) as remaining from public.intake_submissions;
EOF
supabase db query --linked -f /tmp/task1-wizard-cleanup.sql
rm -f /tmp/task1-wizard-cleanup.sql
```
Expected: `remaining: 0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
git fetch origin main && git log --oneline origin/main..main
git add supabase/migrations/202609040003_intake_submissions_wizard_fields.sql
git commit -m "Add full_name/area to intake_submissions, make photo_path optional"
git fetch origin main && git log --oneline origin/main..main
git push origin main
```
If the second `fetch` shows new commits, `git rebase origin/main` before
pushing (this migration file doesn't overlap anything a concurrent
session would touch, so it should apply cleanly); if `.DS_Store` blocks
the rebase, `git stash push -- .DS_Store` first and `git stash pop` after.

---

## Task 2: PWA manifest and icons

**Files:**
- Create: `/Users/WBwork/Downloads/wmsplus-intake-form/manifest.json`
- Create: `/Users/WBwork/Downloads/wmsplus-intake-form/icon-192.png`
- Create: `/Users/WBwork/Downloads/wmsplus-intake-form/icon-512.png`
- Create: `/Users/WBwork/Downloads/wmsplus-intake-form/apple-touch-icon.png`

**Interfaces:**
- Produces: three PNG files (192×192, 512×512, 180×180) and a manifest
  referencing the first two. Task 3's `index.html` links to all four by
  these exact filenames from its `<head>`.

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "name": "Приём товара — WMS+",
  "short_name": "Приём товара",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#DED4FF",
  "theme_color": "#623CEA",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: Generate the three icon PNGs**

No icon files exist yet (per the spec, a generated icon, not a supplied
logo). Generate them directly with Python (Pillow is already installed
in this environment — `pip3 install --user Pillow` was run and confirmed
working before this plan was finalized; if `import PIL` fails, re-run
that install first) — a simple purple square with a white box pictogram
(a filled white rounded rectangle for the box body, a horizontal purple
line for the fold seam, a vertical purple line for the tape).

**Do not** generate this via a browser canvas + `toDataURL()` + hand-typed
`base64 -d` — a 512px PNG's base64 payload is large enough that an agent
retyping it as literal text into a subsequent tool call can blow past
output-token limits (this failed exactly that way in an earlier attempt
at this task). Pillow writes the PNG straight to disk — no giant string
ever needs to pass through anyone's output.

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
python3 <<'EOF'
from PIL import Image, ImageDraw

def draw_icon(size):
    img = Image.new('RGB', (size, size), '#623CEA')
    draw = ImageDraw.Draw(img)
    s = size / 512
    box = [106 * s, 176 * s, 106 * s + 300 * s, 176 * s + 220 * s]
    draw.rounded_rectangle(box, radius=16 * s, fill='#FFFFFF')
    line_w = max(1, round(10 * s))
    draw.line([(106 * s, 226 * s), (406 * s, 226 * s)], fill='#623CEA', width=line_w)
    draw.line([(256 * s, 176 * s), (256 * s, 396 * s)], fill='#623CEA', width=line_w)
    return img

draw_icon(512).save('icon-512.png')
draw_icon(192).save('icon-192.png')
draw_icon(180).save('apple-touch-icon.png')
print('done')
EOF
```

- [ ] **Step 3: Verify the files**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
for f in icon-192.png icon-512.png apple-touch-icon.png; do
  echo "=== $f ==="
  file "$f"
  sips -g pixelWidth -g pixelHeight "$f"
done
python3 -m json.tool manifest.json > /dev/null && echo "manifest.json: valid JSON"
```
Expected: each `file` line says `PNG image data`; `icon-192.png` reports
192×192, `icon-512.png` reports 512×512, `apple-touch-icon.png` reports
180×180; manifest confirms valid.

Visually confirm the icon looks right: serve the directory locally
(`python3 -m http.server` on a free port) and open `icon-512.png`
directly in the Claude_Browser preview tab, then screenshot it — confirm
it reads as a simple purple square with a white box pictogram, not a
blank or garbled image. Stop the local server afterward.

- [ ] **Step 4: Commit**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add manifest.json icon-192.png icon-512.png apple-touch-icon.png
git commit -m "Add PWA manifest and generated app icons"
```
(No push yet — Task 3 will push everything together so the site doesn't
briefly serve a manifest with no matching `<link>` tag in `index.html`.)

---

## Task 3: Rewrite the wizard flow (`index.html` + `intake.js`)

**Files:**
- Modify (full rewrite): `/Users/WBwork/Downloads/wmsplus-intake-form/index.html`
- Modify (full rewrite): `/Users/WBwork/Downloads/wmsplus-intake-form/intake.js`

**Interfaces:**
- Consumes: `full_name`/`area`/nullable `photo_path` from Task 1; the
  four PWA asset filenames from Task 2 (`manifest.json`, `icon-192.png`,
  `icon-512.png`, `apple-touch-icon.png`).
- Produces: the live site's entire user-facing flow. Nothing later
  depends on this beyond deployment (this is the last task).

- [ ] **Step 1: Write `index.html`**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
<title>Приём товара — WMS+</title>
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Приём товара">
<meta name="theme-color" content="#623CEA">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<style>
    :root {
        --bg: #DED4FF;
        --card: #FFFFFF;
        --muted: #242038;
        --accent: #623CEA;
        --secondary: #10b981;
        --danger: #ef4444;
        --radius-lg: 16px;
        --radius-md: 10px;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body { margin: 0; height: 100%; background: var(--bg); color: var(--muted); overscroll-behavior: none; }
    @media (max-width: 768px) {
        html, body { overflow: hidden; }
    }
    .screen {
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100dvh;
        width: 100%;
        padding: 24px 20px;
        position: relative;
    }
    .screen.is-active { display: flex; }
    .screen-card {
        background: var(--card);
        border-radius: var(--radius-lg);
        border: 1px solid rgba(36,32,56,.08);
        padding: 28px;
        width: 100%;
        max-width: 420px;
    }
    h1 { font-size: 20px; margin: 0 0 20px; text-align: center; }
    .field {
        width: 100%;
        padding: 12px 14px;
        border: 1px solid rgba(36,32,56,.18);
        border-radius: var(--radius-md);
        font-size: 16px;
        font-family: inherit;
        color: var(--muted);
        background: #fff;
    }
    .primary-btn {
        width: 100%;
        margin-top: 16px;
        padding: 13px;
        border: 0;
        border-radius: var(--radius-md);
        background: var(--accent);
        color: #fff;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
    }
    .primary-btn:disabled { opacity: .6; cursor: default; }
    .secondary-btn {
        width: 100%;
        margin-top: 10px;
        padding: 11px;
        border: 1px solid rgba(36,32,56,.18);
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--muted);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
    }
    .secondary-btn:disabled { opacity: .6; cursor: default; }
    .msg { margin-top: 12px; font-size: 13px; font-weight: 600; text-align: center; min-height: 18px; }
    .msg.is-error { color: var(--danger); }

    .area-btn {
        width: 100%;
        max-width: 320px;
        padding: 22px;
        margin-bottom: 14px;
        border: 2px solid var(--accent);
        border-radius: var(--radius-lg);
        background: #fff;
        color: var(--accent);
        font-size: 20px;
        font-weight: 800;
        cursor: pointer;
    }
    .area-btn:active { background: var(--accent); color: #fff; }

    .area-pill {
        position: fixed;
        top: 14px;
        left: 14px;
        display: flex;
        align-items: center;
        gap: 6px;
        background: #fff;
        border: 1px solid rgba(36,32,56,.12);
        border-radius: 999px;
        padding: 7px 12px;
        font-size: 13px;
        font-weight: 700;
        color: var(--muted);
        cursor: pointer;
        z-index: 10;
    }

    .back-btn {
        position: fixed;
        top: 14px;
        right: 14px;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        border: 1px solid rgba(36,32,56,.12);
        background: #fff;
        color: var(--muted);
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 10;
    }

    .category-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        width: 100%;
        max-width: 420px;
    }
    .category-btn {
        aspect-ratio: 1;
        border: 1px solid rgba(36,32,56,.12);
        border-radius: var(--radius-md);
        background: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        cursor: pointer;
        padding: 4px;
    }
    .category-btn:active { background: var(--bg); }
    .category-emoji { font-size: clamp(20px, 5.5vw, 28px); line-height: 1; }
    .category-label { font-size: 10px; font-weight: 600; text-align: center; line-height: 1.15; }

    .selected-category {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: center;
        margin-bottom: 16px;
        font-size: 15px;
        font-weight: 700;
    }
    .selected-category .emoji { font-size: 24px; }

    .photo-btn {
        width: 100%;
        padding: 28px;
        border: 2px dashed rgba(36,32,56,.25);
        border-radius: var(--radius-lg);
        background: #fff;
        color: var(--accent);
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
    }
    .photo-btn:disabled { opacity: .6; cursor: default; }

    .success h1 { color: var(--secondary); }
    .success p { text-align: center; margin: 0 0 6px; }

    .honeypot { position: absolute; left: -9999px; top: -9999px; opacity: 0; height: 0; }
</style>
</head>
<body>

<input type="text" name="c_addr_2" id="c_addr_2" class="honeypot" autocomplete="off" tabindex="-1" aria-hidden="true">

<section id="screenId" class="screen">
    <div class="screen-card">
        <h1>Введите ваш ID</h1>
        <input id="idInput" class="field" type="number" inputmode="numeric" min="1" placeholder="Табельный номер">
        <button id="idNextBtn" class="primary-btn" type="button">Далее</button>
        <div id="idMsg" class="msg"></div>
    </div>
</section>

<section id="screenName" class="screen">
    <div class="screen-card">
        <h1>Введите ваше ФИО</h1>
        <input id="nameInput" class="field" type="text" maxlength="200" placeholder="Фамилия Имя Отчество">
        <button id="nameNextBtn" class="primary-btn" type="button">Далее</button>
        <div id="nameMsg" class="msg"></div>
    </div>
</section>

<section id="screenArea" class="screen">
    <div class="screen-card" style="text-align:center;">
        <h1>Выберите участок</h1>
        <button class="area-btn" data-area="ХАБ" type="button">ХАБ</button>
        <button class="area-btn" data-area="Упаковка" type="button">Упаковка</button>
        <button class="area-btn" data-area="Маркетплейс" type="button">Маркетплейс</button>
        <button id="changeUserBtn" class="secondary-btn" type="button">Сменить пользователя</button>
    </div>
</section>

<section id="screenCategory" class="screen">
    <div id="areaPillCategory" class="area-pill"><span id="areaPillCategoryText"></span> ✎</div>
    <div style="width:100%; max-width:420px;">
        <h1>Выберите категорию</h1>
        <div id="categoryGrid" class="category-grid"></div>
    </div>
</section>

<section id="screenItemName" class="screen">
    <div id="areaPillName" class="area-pill"><span id="areaPillNameText"></span> ✎</div>
    <button id="backToCategoryBtn" class="back-btn" type="button">←</button>
    <div class="screen-card">
        <div id="selectedCategoryLine" class="selected-category"></div>
        <h1>Наименование</h1>
        <input id="itemNameInput" class="field" type="text" maxlength="2000" placeholder="Что за товар">
        <button id="itemNameNextBtn" class="primary-btn" type="button">Далее</button>
        <div id="itemNameMsg" class="msg"></div>
    </div>
</section>

<section id="screenPhoto" class="screen">
    <div id="areaPillPhoto" class="area-pill"><span id="areaPillPhotoText"></span> ✎</div>
    <button id="backToNameBtn" class="back-btn" type="button">←</button>
    <div class="screen-card" style="text-align:center;">
        <h1>Фото</h1>
        <input id="photoInput" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" style="display:none;">
        <button id="photoPickBtn" class="photo-btn" type="button">📷 Выбрать фото</button>
        <button id="skipPhotoBtn" class="secondary-btn" type="button">Пропустить</button>
        <div id="photoMsg" class="msg"></div>
    </div>
</section>

<section id="screenSuccess" class="screen success">
    <div class="screen-card" style="text-align:center;">
        <h1>Заявка отправлена</h1>
        <p>Спасибо! Данные сохранены.</p>
        <button id="againBtn" class="primary-btn" type="button">Заполнить ещё раз</button>
    </div>
</section>

<script src="intake.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `intake.js`**

```js
// intake.js
(function () {
    if (typeof supabase === 'undefined') {
        document.body.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:center;height:100dvh;padding:24px;text-align:center;font-family:sans-serif;color:#ef4444;font-weight:600;">Не удалось загрузить форму. Проверьте подключение к интернету и обновите страницу.</div>';
        return;
    }

    const SUPABASE_URL = 'https://bgphllmzmlwurfnbagho.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q';
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
        { name: 'КГТ', emoji: '📏' },
    ];

    const LS_EMPLOYEE_ID = 'wmsplus_intake_employee_id';
    const LS_FULL_NAME = 'wmsplus_intake_full_name';
    const LS_AREA = 'wmsplus_intake_area';

    const screens = Array.from(document.querySelectorAll('.screen'));
    function showScreen(id) {
        screens.forEach((s) => s.classList.toggle('is-active', s.id === id));
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // "Load failed" (Safari's generic network-error message) happens
    // intermittently on flaky mobile connections / iOS pausing an
    // in-flight request when the tab backgrounds -- not a code bug.
    // Retrying recovers from exactly that kind of transient failure.
    async function withRetry(attempts, statusPrefix, onStatus, fn) {
        let lastError;
        for (let i = 0; i < attempts; i++) {
            if (i > 0) {
                onStatus(statusPrefix + ' (попытка ' + (i + 1) + ' из ' + attempts + ')...');
                await wait(1500);
            }
            try {
                return await fn();
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError;
    }

    // Re-encodes the photo to a smaller JPEG before upload -- iPhone
    // photos (often several MB of HEIC) were failing/slow on mobile
    // networks. Falls back to the original file if decoding fails.
    async function compressImage(file) {
        try {
            const bitmap = await createImageBitmap(file);
            const maxSide = 1600;
            const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
            const width = Math.round(bitmap.width * scale);
            const height = Math.round(bitmap.height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
            bitmap.close();

            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
            if (!blob) return file;

            const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
            return new File([blob], baseName + '.jpg', { type: 'image/jpeg' });
        } catch (err) {
            return file;
        }
    }

    const state = {
        employeeId: localStorage.getItem(LS_EMPLOYEE_ID),
        fullName: localStorage.getItem(LS_FULL_NAME),
        area: localStorage.getItem(LS_AREA),
        category: null,
        itemText: null,
    };

    function updateAreaPills() {
        document.getElementById('areaPillCategoryText').textContent = state.area || '';
        document.getElementById('areaPillNameText').textContent = state.area || '';
        document.getElementById('areaPillPhotoText').textContent = state.area || '';
    }

    function goToStart() {
        if (!state.employeeId || !state.fullName) {
            showScreen('screenId');
        } else if (!state.area) {
            showScreen('screenArea');
        } else {
            updateAreaPills();
            showScreen('screenCategory');
        }
    }

    // ---------- Screen: ID ----------
    const idInput = document.getElementById('idInput');
    const idMsg = document.getElementById('idMsg');
    function submitId() {
        const val = idInput.value.trim();
        if (!val || Number(val) <= 0) {
            idMsg.textContent = 'Введите корректный ID.';
            idMsg.className = 'msg is-error';
            return;
        }
        state.employeeId = val;
        localStorage.setItem(LS_EMPLOYEE_ID, val);
        idMsg.textContent = '';
        idMsg.className = 'msg';
        showScreen('screenName');
    }
    document.getElementById('idNextBtn').addEventListener('click', submitId);
    idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitId(); });

    // ---------- Screen: full name ----------
    const nameInput = document.getElementById('nameInput');
    const nameMsg = document.getElementById('nameMsg');
    function submitName() {
        const val = nameInput.value.trim();
        if (!val) {
            nameMsg.textContent = 'Введите ФИО.';
            nameMsg.className = 'msg is-error';
            return;
        }
        state.fullName = val;
        localStorage.setItem(LS_FULL_NAME, val);
        nameMsg.textContent = '';
        nameMsg.className = 'msg';
        if (state.area) {
            updateAreaPills();
            showScreen('screenCategory');
        } else {
            showScreen('screenArea');
        }
    }
    document.getElementById('nameNextBtn').addEventListener('click', submitName);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitName(); });

    // ---------- Screen: area ----------
    document.querySelectorAll('.area-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.area = btn.dataset.area;
            localStorage.setItem(LS_AREA, state.area);
            updateAreaPills();
            showScreen('screenCategory');
        });
    });
    document.getElementById('changeUserBtn').addEventListener('click', () => {
        localStorage.removeItem(LS_EMPLOYEE_ID);
        localStorage.removeItem(LS_FULL_NAME);
        localStorage.removeItem(LS_AREA);
        state.employeeId = null;
        state.fullName = null;
        state.area = null;
        idInput.value = '';
        nameInput.value = '';
        showScreen('screenId');
    });

    // ---------- Area pill (pencil) on wizard screens ----------
    ['areaPillCategory', 'areaPillName', 'areaPillPhoto'].forEach((id) => {
        document.getElementById(id).addEventListener('click', () => showScreen('screenArea'));
    });

    // ---------- Wizard step 1: category grid ----------
    const categoryGrid = document.getElementById('categoryGrid');
    const itemNameInput = document.getElementById('itemNameInput');
    const itemNameMsg = document.getElementById('itemNameMsg');
    CATEGORIES.forEach((cat) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'category-btn';
        btn.innerHTML = '<span class="category-emoji">' + cat.emoji + '</span><span class="category-label">' + cat.name + '</span>';
        btn.addEventListener('click', () => {
            state.category = cat.name;
            document.getElementById('selectedCategoryLine').innerHTML =
                '<span class="emoji">' + cat.emoji + '</span><span>' + cat.name + '</span>';
            itemNameInput.value = '';
            itemNameMsg.textContent = '';
            itemNameMsg.className = 'msg';
            showScreen('screenItemName');
        });
        categoryGrid.appendChild(btn);
    });

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
        showScreen('screenPhoto');
    }
    document.getElementById('itemNameNextBtn').addEventListener('click', submitItemName);
    itemNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitItemName(); });
    document.getElementById('backToCategoryBtn').addEventListener('click', () => showScreen('screenCategory'));

    // ---------- Wizard step 3: photo ----------
    const photoInput = document.getElementById('photoInput');
    const photoMsg = document.getElementById('photoMsg');
    const photoPickBtn = document.getElementById('photoPickBtn');
    const skipPhotoBtn = document.getElementById('skipPhotoBtn');
    document.getElementById('backToNameBtn').addEventListener('click', () => showScreen('screenItemName'));

    photoPickBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
        const file = photoInput.files[0];
        if (file) submitEntry(file);
    });
    skipPhotoBtn.addEventListener('click', () => submitEntry(null));

    async function submitEntry(rawFile) {
        // Honeypot: bots fill every field, real users never see or fill this one.
        if (document.getElementById('c_addr_2').value) return;

        photoPickBtn.disabled = true;
        skipPhotoBtn.disabled = true;
        photoMsg.className = 'msg';
        photoMsg.textContent = '';

        try {
            let photoPath = null;

            if (rawFile) {
                if (rawFile.size > 8 * 1024 * 1024) {
                    photoMsg.textContent = 'Фото слишком большое (максимум 8 МБ).';
                    photoMsg.className = 'msg is-error';
                    return;
                }
                photoMsg.textContent = 'Сжимаем фото...';
                const file = await compressImage(rawFile);
                if (file.size > 8 * 1024 * 1024) {
                    photoMsg.textContent = 'Фото слишком большое (максимум 8 МБ).';
                    photoMsg.className = 'msg is-error';
                    return;
                }
                const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
                photoPath = Date.now() + '-' + crypto.randomUUID() + '.' + ext;

                await withRetry(3, 'Загрузка фото', (m) => { photoMsg.textContent = m; }, async () => {
                    photoMsg.textContent = 'Загрузка фото...';
                    const { error } = await supabaseClient.storage
                        .from('intake-photos')
                        .upload(photoPath, file, { contentType: file.type || 'image/jpeg' });
                    if (error) throw error;
                });
            }

            await withRetry(3, 'Сохранение', (m) => { photoMsg.textContent = m; }, async () => {
                photoMsg.textContent = 'Сохранение...';
                const { error } = await supabaseClient
                    .from('intake_submissions')
                    .insert({
                        item_text: state.itemText,
                        employee_id: Number(state.employeeId),
                        full_name: state.fullName,
                        area: state.area,
                        category: state.category,
                        photo_path: photoPath,
                    });
                if (error) throw error;
            });

            showScreen('screenSuccess');
        } catch (err) {
            photoMsg.textContent = 'Не получилось отправить (проверьте связь и попробуйте ещё раз): ' + (err.message || 'ошибка сети');
            photoMsg.className = 'msg is-error';
        } finally {
            photoPickBtn.disabled = false;
            skipPhotoBtn.disabled = false;
            photoInput.value = '';
        }
    }

    document.getElementById('againBtn').addEventListener('click', () => {
        state.category = null;
        state.itemText = null;
        showScreen('screenCategory');
    });

    goToStart();
})();
```

- [ ] **Step 3: Syntax-check**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```
Expected: no output.

- [ ] **Step 4: Serve locally and verify every flow end-to-end against the real Supabase project**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form && (python3 -m http.server 8940 &>/tmp/wizard-server.log &) && sleep 1 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8940/index.html
```
Expected: `200`.

Open `http://localhost:8940/index.html` in a **fresh** Claude_Browser tab
(a reused tab can serve a stale cached page in this tooling — always
open a new tab for this kind of check) and clear any prior state first:

```js
localStorage.clear();
location.reload();
```

**4a. Fresh identity + area flow.** After reload, `screenId` should be
`is-active`. Fill and submit:
```js
document.getElementById('idInput').value = '4242';
document.getElementById('idNextBtn').click();
```
Expected: `screenName` now active. Then:
```js
document.getElementById('nameInput').value = 'Тестов Тест Тестович';
document.getElementById('nameNextBtn').click();
```
Expected: `screenArea` now active. Then:
```js
document.querySelector('.area-btn[data-area="ХАБ"]').click();
```
Expected: `screenCategory` now active, and `localStorage.getItem('wmsplus_intake_employee_id')` is `'4242'`, `wmsplus_intake_full_name` is `'Тестов Тест Тестович'`, `wmsplus_intake_area` is `'ХАБ'`. Confirm the area pill text (`#areaPillCategoryText`) reads `ХАБ`.

**4b. Happy path with photo.** Pick a category, fill name, attach a
synthetic PNG (same technique as before — base64 1×1 PNG via
`DataTransfer`), confirm success:
```js
document.querySelectorAll('.category-btn')[0].click(); // Одежда
```
Expected: `screenItemName` active, `#selectedCategoryLine` shows the emoji+name.
```js
document.getElementById('itemNameInput').value = 'Тестовая запись (wizard happy path)';
document.getElementById('itemNameNextBtn').click();
```
Expected: `screenPhoto` active.
```js
(function(){
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const file = new File([bytes], 'test.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById('photoInput');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
  return 'photo attached';
})();
```
Wait ~2s, then check `document.getElementById('screenSuccess').classList.contains('is-active')` → expected `true`.

Verify via SQL (from `/Users/WBwork/Downloads/WMSplus-main`):
```bash
cat > /tmp/wizard-check-4b.sql <<'EOF'
select item_text, employee_id, full_name, area, category, photo_path from public.intake_submissions where item_text like 'Тестовая запись (wizard happy path)%';
EOF
supabase db query --linked -f /tmp/wizard-check-4b.sql
```
Expected: one row, `full_name = 'Тестов Тест Тестович'`, `area = 'ХАБ'`,
`category = 'Одежда'`, `photo_path` non-null.

**4c. "Заполнить ещё раз" skips straight to category (no re-asking area/identity).**
```js
document.getElementById('againBtn').click();
```
Expected: `screenCategory` active immediately (not `screenId` or `screenArea`).

**4d. Skip-photo path.** Repeat category → name, then:
```js
document.getElementById('itemNameInput').value = 'Тестовая запись (wizard skip photo)';
document.getElementById('itemNameNextBtn').click();
document.getElementById('skipPhotoBtn').click();
```
Wait ~1.5s, check success screen active. Verify via SQL that this row's
`photo_path` is `null`.

**4e. Back navigation.** From category grid, pick a category, then on
the name screen click `#backToCategoryBtn` — expected: back at
`screenCategory`. Pick a category again, fill name, proceed to photo
screen, click `#backToNameBtn` — expected: back at `screenItemName`
**with the previously typed name still in `#itemNameInput`** (not
cleared).

**4f. Change area via the pencil.** From `screenCategory`, click
`#areaPillCategory` — expected: `screenArea` active. Pick "Упаковка" —
expected: back at `screenCategory`, pill now reads `Упаковка`, and
`localStorage.getItem('wmsplus_intake_area')` is `'Упаковка'` (identity
untouched — `wmsplus_intake_employee_id` still `'4242'`).

**4g. Change user.** Click the area pill again to reach `screenArea`,
then click `#changeUserBtn` — expected: `screenId` active, and all three
`localStorage` keys are now `null`.

**4h. Honeypot still blocks silently.** Reload with
`localStorage.clear()` first, redo the identity+area flow (4a), reach
`screenPhoto`, set the honeypot, and skip:
```js
document.getElementById('c_addr_2').value = 'http://spam.example';
document.getElementById('skipPhotoBtn').click();
```
Expected: no success screen, no new DB row for whatever `item_text` was
used in this run — confirm via the same SQL-check pattern as 4b/4d.

- [ ] **Step 5: Clean up test data and stop the server**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
cat > /tmp/wizard-cleanup.sql <<'EOF'
delete from public.intake_submissions where item_text like 'Тестовая запись%';
EOF
supabase db query --linked -f /tmp/wizard-cleanup.sql
rm -f /tmp/wizard-check-4b.sql /tmp/wizard-cleanup.sql
pkill -f "http.server 8940" 2>/dev/null
```
(Leave any storage object(s) these tests created — same accepted,
undeletable-via-SQL platform limitation as every earlier round.)

- [ ] **Step 6: Commit and push (deploys both this task's files and Task 2's PWA assets together)**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form
git add index.html intake.js
git commit -m "Rewrite as identity+area+wizard flow (category -> name -> optional photo)"
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
curl -s "https://wmsplus.github.io/index.html?_=$(date +%s)" | grep -c "screenCategory"
curl -s -o /dev/null -w "manifest: %{http_code}\n" "https://wmsplus.github.io/manifest.json"
curl -s -o /dev/null -w "icon-512: %{http_code}\n" "https://wmsplus.github.io/icon-512.png"
```
Expected: `200`, `1` (or more — the id appears in both the HTML and the
pill span ids, so ≥1 is fine, just confirms the new markup is live),
`manifest: 200`, `icon-512: 200`.

**Cannot verify from here:** whether iOS Safari's "Add to Home Screen"
actually picks up the manifest/icon correctly and opens in standalone
mode — that depends on real iOS behavior this session has no access to.
The final step for the user is to open `https://wmsplus.github.io/` on
their iPhone, add it to the home screen, and confirm it opens without
Safari's address bar and shows the right icon.
