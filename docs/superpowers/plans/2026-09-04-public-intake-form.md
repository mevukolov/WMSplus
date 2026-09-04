# Публичная форма приёма товара — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, no-login web form (description, employee id, category,
one photo) that writes into a new Supabase table + storage bucket, deployed
at `https://wmsplus.github.io/`.

**Architecture:** Two independent deployment targets sharing one existing
Supabase project (`bgphllmzmlwurfnbagho`, ref already used by the main
WMS+ app). (1) A SQL migration in this repo (WMSplus-main) adds the
`intake_submissions` table and `intake-photos` storage bucket, both
insert-only for the anon role. (2) A brand-new static site (no build step,
plain `index.html` + `intake.js`, same CDN-script-tag pattern as the rest
of this project) lives in its own local folder and gets pushed to a new
repo `wmsplus/wmsplus.github.io`, deployed via GitHub Pages.

**Tech Stack:** Plain HTML/CSS/JS (no framework, no build step),
`@supabase/supabase-js@2` via CDN, PostgreSQL/PostgREST (Supabase), GitHub
Pages, Supabase CLI (`supabase db query --linked`), `gh` CLI.

**Spec:** [docs/superpowers/specs/2026-09-04-public-intake-form-design.md](../specs/2026-09-04-public-intake-form-design.md)

## Global Constraints

- No authentication anywhere in this flow — the form is reachable and
  submittable by anyone with the link.
- Anonymous (`anon`) role gets **insert only** on both the table and the
  storage bucket — no select/update/delete policies for `anon` on either.
- Category values are a fixed list of exactly 13 Russian strings (must
  match verbatim in both the SQL `check` constraint and the HTML
  `<select>`): Одежда, Обувь, Косметика, Бытовая химия, Мебель,
  Электроника, Ювелирка, Для авто, Для животных, Посуда, Еда, Посылка,
  КГТ.
- Exactly one photo per submission, image MIME types only, 8 MB cap,
  enforced at the storage-bucket level.
- Same Supabase project as the main app (`bgphllmzmlwurfnbagho`) — do not
  create a new Supabase project.
- Site must NOT live on `mevukolov.github.io` — deploys to the separate
  `wmsplus` GitHub organization instead, at `wmsplus.github.io`.
- Migrations in this repo are applied with
  `supabase db query --linked -f <file>.sql` (never `supabase db push`,
  which is blocked here by a pre-existing unrelated migration-ledger
  conflict). Run `supabase link --project-ref bgphllmzmlwurfnbagho` first
  if the CLI reports it isn't linked.
- Before every `git push` in this repo: `git fetch origin main && git log
  --oneline origin/main..main` to check for a concurrent session's
  interleaved commits (established practice this session — another
  Claude Code session may be pushing to this same `main` branch).
- `node --check` on any new/modified `.js` file before considering it done.

---

## Task 1: Supabase migration — table, bucket, policies

**Files:**
- Create: `supabase/migrations/202609040001_intake_submissions.sql`

**Interfaces:**
- Produces: table `public.intake_submissions` with columns `id` (uuid pk),
  `created_at` (timestamptz), `item_text` (text), `employee_id` (integer),
  `category` (text, checked against the 13-value list above),
  `photo_path` (text) — and storage bucket `intake-photos` (public,
  8 MB limit, image MIME types only). Both insert-only for `anon`. Task 2
  and Task 3 write rows/files into exactly these two names with exactly
  these column names.

- [ ] **Step 1: Write the migration file**

```sql
-- 202609040001_intake_submissions.sql
-- Public, no-auth intake form (see
-- docs/superpowers/specs/2026-09-04-public-intake-form-design.md).
-- Anonymous clients may only insert -- no select/update/delete policy for
-- anon, so the submitted list and photos are not readable through the
-- public API, only via the Supabase dashboard or `supabase db query`
-- (both bypass RLS).
create table public.intake_submissions (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    item_text text not null,
    employee_id integer not null,
    category text not null check (category in (
        'Одежда', 'Обувь', 'Косметика', 'Бытовая химия', 'Мебель',
        'Электроника', 'Ювелирка', 'Для авто', 'Для животных', 'Посуда',
        'Еда', 'Посылка', 'КГТ'
    )),
    photo_path text not null
);

alter table public.intake_submissions enable row level security;

create policy "intake_submissions_insert_anon" on public.intake_submissions
    for insert to anon with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'intake-photos',
    'intake-photos',
    true,
    8388608,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
);

create policy "intake_photos_insert_anon" on storage.objects
    for insert to anon with check (bucket_id = 'intake-photos');
```

- [ ] **Step 2: Apply the migration**

Run (from `/Users/WBwork/Downloads/WMSplus-main`):
```bash
supabase link --project-ref bgphllmzmlwurfnbagho
supabase db query --linked -f supabase/migrations/202609040001_intake_submissions.sql
```
Expected: no error output. If it reports "not linked", the `link` command
above fixes it — re-run the `db query` line after.

- [ ] **Step 3: Verify insert is allowed and select is blocked, via the real REST API (anon key)**

This is the exact path the deployed form will use, so it's the correct
thing to test — not just that the SQL ran. Run:

```bash
ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q'

# Insert should succeed (201, empty body since we don't request return=representation)
curl -s -o /dev/null -w "insert status: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"item_text":"Тестовая запись (миграция, Task 1)","employee_id":1,"category":"Посылка","photo_path":"task1-verify.png"}'

# Select should return an empty array -- no select policy for anon
curl -s "https://bgphllmzmlwurfnbagho.supabase.co/rest/v1/intake_submissions?select=id" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

Expected: first line prints `insert status: 201`. Second command prints
`[]` (empty array) — proving the row landed (we'll confirm via SQL next)
but anon truly cannot read it back.

- [ ] **Step 4: Verify a real image upload succeeds and a disallowed file type is rejected**

Shell state (including `$ANON_KEY`) does not persist between separate
command invocations — redeclare it here:

```bash
ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q'

# A minimal valid 1x1 PNG, base64-encoded.
PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
echo "$PNG_B64" | base64 -d > /tmp/task1-verify.png

curl -s -o /dev/null -w "png upload status: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/storage/v1/object/intake-photos/task1-verify.png" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: image/png" --data-binary @/tmp/task1-verify.png

echo "not an image" > /tmp/task1-verify.txt
curl -s -o /dev/null -w "txt upload status: %{http_code}\n" -X POST \
  "https://bgphllmzmlwurfnbagho.supabase.co/storage/v1/object/intake-photos/task1-verify.txt" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: text/plain" --data-binary @/tmp/task1-verify.txt
```

Expected: `png upload status: 200` (or `201`), `txt upload status: 4xx`
(rejected — the bucket only allows `image/*`).

- [ ] **Step 5: Confirm both landed via direct SQL (bypasses RLS, proves the data is really there)**

```bash
cat > /tmp/task1-check.sql <<'EOF'
select item_text, employee_id, category, photo_path from public.intake_submissions
  where item_text like 'Тестовая запись%' order by created_at desc;
select name, bucket_id from storage.objects
  where bucket_id = 'intake-photos' order by created_at desc;
EOF
supabase db query --linked -f /tmp/task1-check.sql
```

Expected: one row with `item_text = 'Тестовая запись (миграция, Task 1)'`,
and `task1-verify.png` listed in `storage.objects` (NOT `task1-verify.txt`
— it was rejected before it could be stored).

- [ ] **Step 6: Clean up the test data**

```bash
cat > /tmp/task1-cleanup.sql <<'EOF'
delete from public.intake_submissions where item_text like 'Тестовая запись%';
delete from storage.objects where bucket_id = 'intake-photos' and name like 'task1-verify%';
EOF
supabase db query --linked -f /tmp/task1-cleanup.sql
rm -f /tmp/task1-verify.png /tmp/task1-verify.txt /tmp/task1-check.sql /tmp/task1-cleanup.sql
```

- [ ] **Step 7: Commit**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
git fetch origin main && git log --oneline origin/main..main
git add supabase/migrations/202609040001_intake_submissions.sql
git commit -m "Add intake_submissions table + intake-photos bucket (insert-only, anon)"
git fetch origin main && git log --oneline origin/main..main
git push origin main
```

---

## Task 2: Standalone form page (`index.html` + `intake.js`)

**Files:**
- Create: `/Users/WBwork/Downloads/wmsplus-intake-form/index.html`
- Create: `/Users/WBwork/Downloads/wmsplus-intake-form/intake.js`

**Interfaces:**
- Consumes: `public.intake_submissions` columns and `intake-photos` bucket
  from Task 1, exactly as named there.
- Produces: a working static page, verified end-to-end against the real
  (already-migrated) Supabase project. Task 3 pushes these two files
  as-is to the new repo — nothing here should reference the old domain,
  a build step, or any file outside this folder.

- [ ] **Step 1: Create the folder and write `index.html`**

```bash
mkdir -p /Users/WBwork/Downloads/wmsplus-intake-form
```

```html
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Приём товара — WMS+</title>
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
    * { box-sizing: border-box; }
    body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        color: var(--muted);
    }
    .card {
        background: var(--card);
        border-radius: var(--radius-lg);
        border: 1px solid rgba(36,32,56,.08);
        padding: 28px;
        width: 100%;
        max-width: 440px;
    }
    h1 { font-size: 22px; margin: 0 0 20px; color: var(--muted); }
    label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        margin: 16px 0 6px;
        color: var(--muted);
    }
    label:first-of-type { margin-top: 0; }
    .field {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid rgba(36,32,56,.18);
        border-radius: var(--radius-md);
        font-size: 15px;
        font-family: inherit;
        color: var(--muted);
        background: #fff;
    }
    textarea.field { resize: vertical; min-height: 64px; }
    .honeypot { position: absolute; left: -9999px; top: -9999px; opacity: 0; height: 0; }
    button[type="submit"] {
        width: 100%;
        margin-top: 22px;
        padding: 12px;
        border: 0;
        border-radius: var(--radius-md);
        background: var(--accent);
        color: #fff;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
    }
    button[type="submit"]:disabled { opacity: .6; cursor: default; }
    .msg { margin-top: 14px; font-size: 14px; font-weight: 600; display: none; }
    .msg.is-visible { display: block; }
    .msg.is-error { color: var(--danger); }
    .success { display: none; text-align: center; }
    .success.is-visible { display: block; }
    .success h1 { color: var(--secondary); }
    .success button {
        margin-top: 18px;
        padding: 12px 20px;
        border: 0;
        border-radius: var(--radius-md);
        background: var(--accent);
        color: #fff;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
    }
</style>
</head>
<body>
<div class="card">
    <form id="intakeForm">
        <h1>Приём товара</h1>

        <label for="itemText">Описание товара</label>
        <textarea id="itemText" class="field" required></textarea>

        <label for="employeeId">Табельный номер</label>
        <input id="employeeId" class="field" type="number" inputmode="numeric" required>

        <label for="category">Категория</label>
        <select id="category" class="field" required>
            <option value="" disabled selected>Выберите категорию</option>
            <option>Одежда</option>
            <option>Обувь</option>
            <option>Косметика</option>
            <option>Бытовая химия</option>
            <option>Мебель</option>
            <option>Электроника</option>
            <option>Ювелирка</option>
            <option>Для авто</option>
            <option>Для животных</option>
            <option>Посуда</option>
            <option>Еда</option>
            <option>Посылка</option>
            <option>КГТ</option>
        </select>

        <label for="photo">Фото</label>
        <input id="photo" class="field" type="file" accept="image/*" required>

        <input type="text" name="website" id="hpField" class="honeypot" autocomplete="off" tabindex="-1" aria-hidden="true">

        <button type="submit" id="submitBtn">Отправить</button>
        <div id="formMsg" class="msg"></div>
    </form>

    <div id="successScreen" class="success">
        <h1>Заявка отправлена</h1>
        <p>Спасибо! Данные сохранены.</p>
        <button id="againBtn" type="button">Отправить ещё одну</button>
    </div>
</div>
<script src="intake.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `intake.js`**

```js
// intake.js
const SUPABASE_URL = 'https://bgphllmzmlwurfnbagho.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const form = document.getElementById('intakeForm');
const submitBtn = document.getElementById('submitBtn');
const formMsg = document.getElementById('formMsg');
const successScreen = document.getElementById('successScreen');
const againBtn = document.getElementById('againBtn');

function showMsg(text, isError) {
    formMsg.textContent = text;
    formMsg.className = 'msg is-visible' + (isError ? ' is-error' : '');
}

function clearMsg() {
    formMsg.className = 'msg';
    formMsg.textContent = '';
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg();

    // Honeypot: bots fill every field, real users never see or fill this one.
    if (document.getElementById('hpField').value) return;

    const itemText = document.getElementById('itemText').value.trim();
    const employeeId = document.getElementById('employeeId').value;
    const category = document.getElementById('category').value;
    const photoInput = document.getElementById('photo');
    const file = photoInput.files[0];

    if (!itemText || !employeeId || !category || !file) {
        showMsg('Заполните все поля.', true);
        return;
    }

    submitBtn.disabled = true;
    showMsg('Отправка...', false);

    try {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const photoPath = Date.now() + '-' + crypto.randomUUID() + '.' + ext;

        const { error: uploadError } = await supabaseClient.storage
            .from('intake-photos')
            .upload(photoPath, file, { contentType: file.type || 'image/jpeg' });
        if (uploadError) throw uploadError;

        const { error: insertError } = await supabaseClient
            .from('intake_submissions')
            .insert({
                item_text: itemText,
                employee_id: Number(employeeId),
                category: category,
                photo_path: photoPath,
            });
        if (insertError) throw insertError;

        form.reset();
        form.style.display = 'none';
        successScreen.classList.add('is-visible');
    } catch (err) {
        showMsg('Не получилось отправить: ' + (err.message || 'ошибка сети'), true);
        submitBtn.disabled = false;
    }
});

againBtn.addEventListener('click', () => {
    successScreen.classList.remove('is-visible');
    form.style.display = '';
    submitBtn.disabled = false;
    clearMsg();
});
```

- [ ] **Step 3: Syntax-check**

```bash
node --check /Users/WBwork/Downloads/wmsplus-intake-form/intake.js
```
Expected: no output (exit 0).

- [ ] **Step 4: Serve locally and verify the happy path end-to-end against the real Supabase project**

```bash
cd /Users/WBwork/Downloads/wmsplus-intake-form && (python3 -m http.server 8793 &>/tmp/intake-form-server.log &) && sleep 1 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8793/index.html
```
Expected: `200`.

Open `http://localhost:8793/index.html` in the Claude_Browser preview tab.
Since these tools can't drive a native OS file picker, build the test
file with JS and drop it directly onto the `<input type="file">` via
`javascript_tool`:

```js
(function(){
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const byteChars = atob(b64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const file = new File([bytes], 'test.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  document.getElementById('photo').files = dt.files;
  document.getElementById('itemText').value = 'Тестовая запись (автопроверка формы, Task 2)';
  document.getElementById('employeeId').value = '4242';
  document.getElementById('category').value = 'Посылка';
  return 'form filled';
})();
```

Then submit and check the result:
```js
document.getElementById('intakeForm').requestSubmit();
```
Wait ~1s, then:
```js
document.getElementById('successScreen').classList.contains('is-visible');
```
Expected: `true`. Take a screenshot to visually confirm the success
message renders correctly (no native alert, matches the flat/no-shadow
style).

- [ ] **Step 5: Verify the honeypot silently blocks a bot-like submission**

Reload the page, then via `javascript_tool`:
```js
(function(){
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const byteChars = atob(b64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const file = new File([bytes], 'test.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  document.getElementById('photo').files = dt.files;
  document.getElementById('itemText').value = 'Тестовая запись (медовая ловушка, НЕ должна попасть в базу)';
  document.getElementById('employeeId').value = '1';
  document.getElementById('category').value = 'Посылка';
  document.getElementById('hpField').value = 'http://spam.example';
  return 'form filled with honeypot';
})();
```
```js
document.getElementById('intakeForm').requestSubmit();
```
Wait ~1s, then check `document.getElementById('successScreen').classList.contains('is-visible')` —
expected `false` (the handler returned before doing anything).

- [ ] **Step 6: Verify required-field validation blocks an incomplete submit**

Reload the page, fill only `itemText`, leave the rest empty, call
`document.getElementById('intakeForm').requestSubmit();` — expected: the
browser's native "fill out this field" validation stops submission (no
network request fires; confirm with `read_network_requests`, no POST to
`/rest/v1/intake_submissions` or `/storage/v1/object/`).

- [ ] **Step 7: Confirm via SQL that only the Step 4 row landed (not the honeypot one), then clean up**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
cat > /tmp/task2-check.sql <<'EOF'
select item_text from public.intake_submissions where item_text like 'Тестовая запись%' order by created_at;
EOF
supabase db query --linked -f /tmp/task2-check.sql
```
Expected: exactly one row, `Тестовая запись (автопроверка формы, Task 2)`
— the honeypot one must NOT appear.

```bash
cat > /tmp/task2-cleanup.sql <<'EOF'
delete from public.intake_submissions where item_text like 'Тестовая запись%';
delete from storage.objects where bucket_id = 'intake-photos' and name like '%.png' and created_at > now() - interval '1 hour';
EOF
supabase db query --linked -f /tmp/task2-cleanup.sql
rm -f /tmp/task2-check.sql /tmp/task2-cleanup.sql
```

- [ ] **Step 8: Stop the local server and commit**

```bash
pkill -f "http.server 8793" 2>/dev/null
cd /Users/WBwork/Downloads/wmsplus-intake-form
git init -b main
git add index.html intake.js
git commit -m "Add public intake form (description, employee id, category, photo)"
```

---

## Task 3: Create the `wmsplus/wmsplus.github.io` repo and deploy

**Files:**
- None new — pushes the two files from Task 2 as-is.

**Interfaces:**
- Consumes: the local git repo at `/Users/WBwork/Downloads/wmsplus-intake-form`
  from Task 2, and the `wmsplus` GitHub organization (already created by
  the user, confirmed reachable via `gh api orgs/wmsplus`).
- Produces: a live site at `https://wmsplus.github.io/`.

- [ ] **Step 1: Create the repo and push**

```bash
gh repo create wmsplus/wmsplus.github.io --public \
  --description "Приём товара — форма без авторизации (WMS+)"
cd /Users/WBwork/Downloads/wmsplus-intake-form
git remote add origin https://github.com/wmsplus/wmsplus.github.io.git
git push -u origin main
```

- [ ] **Step 2: Enable Pages (if not already auto-enabled by the special repo name) and poll for the build**

```bash
gh api repos/wmsplus/wmsplus.github.io/pages >/dev/null 2>&1 || \
  gh api repos/wmsplus/wmsplus.github.io/pages -X POST -f "source[branch]=main" -f "source[path]=/"

for i in $(seq 1 20); do
  build_status=$(gh api repos/wmsplus/wmsplus.github.io/pages/builds/latest --jq '.status' 2>/dev/null)
  echo "attempt $i: status=$build_status"
  if [ "$build_status" = "built" ]; then break; fi
  sleep 6
done
```
Expected: eventually prints `status=built`.

- [ ] **Step 3: Confirm the live site actually loads**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://wmsplus.github.io/"
curl -s "https://wmsplus.github.io/" | grep -c "Приём товара"
```
Expected: `200`, then `1` (the heading is present in the served HTML).

- [ ] **Step 4: One real end-to-end submission against the deployed URL**

Open `https://wmsplus.github.io/` in the Claude_Browser preview tab and
repeat the exact fill+submit script from Task 2 Step 4 (same base64 PNG,
`itemText` changed to `'Тестовая запись (продовая проверка, Task 3)'`),
then confirm `successScreen` becomes visible, then confirm via SQL:

```bash
cd /Users/WBwork/Downloads/WMSplus-main
cat > /tmp/task3-check.sql <<'EOF'
select item_text from public.intake_submissions where item_text like 'Тестовая запись%' order by created_at;
EOF
supabase db query --linked -f /tmp/task3-check.sql
```
Expected: one row, `Тестовая запись (продовая проверка, Task 3)`.

- [ ] **Step 5: Final cleanup of all test data**

```bash
cat > /tmp/task3-cleanup.sql <<'EOF'
delete from public.intake_submissions where item_text like 'Тестовая запись%';
delete from storage.objects where bucket_id = 'intake-photos' and name like '%.png' and created_at > now() - interval '1 hour';
EOF
supabase db query --linked -f /tmp/task3-cleanup.sql
rm -f /tmp/task3-check.sql /tmp/task3-cleanup.sql
```

- [ ] **Step 6: Report the live URL**

`https://wmsplus.github.io/` is the link to hand to whoever fills the form.
