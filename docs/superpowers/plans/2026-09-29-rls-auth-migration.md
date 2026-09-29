# RLS + Auth Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plaintext `login_user` RPC with real Supabase Auth and lock down the 45 tables + 3 views that have no legitimate anonymous consumer, without breaking the app's 4 confirmed public, no-login surfaces.

**Architecture:** Real Supabase Auth (`auth.users`, `signInWithPassword`) with a synthetic `<id>@wms.internal` email so the login screen doesn't change; a blanket `authenticated`-only RLS policy on the 45 tables (no per-row scoping — every logged-in employee keeps seeing/editing everything, per the 2026-09-29 scope decision); a new `service_role`-backed Edge Function for the two admin operations (create employee, reset password) that must never run client-side.

**Tech Stack:** Supabase Auth (GoTrue), Postgres RLS, Supabase Edge Functions (Deno), supabase-js v2, plain Node (native `fetch`, no dependencies) for the one-off migration script.

**Spec:** `docs/superpowers/specs/2026-09-29-rls-auth-migration-design.md`

## Global Constraints

- The 9 confirmed-public tables (`intake_submissions`, `wms_no_shk_boxes`, `wms_no_shk_racks`, `wms_no_shk_shelves`, `wms_no_shk_inventory_box_results`, `wms_no_shk_inventory_sessions`, `wms_no_shk_inventory_shelf_audits`, `opp_reports_cache`, `opp_alert_settings`) are **never** touched by any task in this plan — no new policy, no grant change, no migration references them.
- Login screens (`login.html`, `mobile-login.html`) keep their exact current markup — ID field + password field, nothing added or removed there.
- Every table in the 45-table lock-down list gets a blanket `for all to authenticated using (true) with check (true)` policy — no per-employee row scoping (2026-09-29 scope decision: logged-in-or-not only, not per-role).
- **Two classes of task in this plan carry a hard stop:**
  - Any task that pushes a real code change to `origin/main` for `auth.js`, `mobile-login.js`, `profile.js`, `profile.html`, `access_manager.js`, or `access_manager.html` — this repo's `main` branch is what real employees load, there is no separate staging deploy. These files get written and locally validated (via `python3 -m http.server` against the same production Supabase project) but **stay uncommitted** until the single gated cutover task (Task 12).
  - Any task that runs `supabase db push` for the RLS/grant-revoke migration (Task 8's file) against the live project — this instantly cuts off `anon` access for real. This is Task 11, and it does not run as part of a normal plan execution pass; it requires the user's explicit go-ahead, given separately, naming the agreed cutover window, after everything else in this plan is done and reviewed.
  - Both gated tasks are marked **⛔ GATED** in their heading. An executor (human or agent) must stop and get that explicit go-ahead before running either — proceeding through the rest of the plan and stopping exactly there is the correct, expected behavior, not a failure to "finish."
- The 4 known migration timestamp-prefix collisions in `supabase/migrations` (`202608170001`, `202609020005`, `202609040003`, `202609040004`, each with two files) require the established workaround before any `supabase db push`: move the non-today conflicting files into a temporary `supabase/.migration_holdout/` directory, push, move them back, verify `git status --porcelain supabase/migrations` is clean.
- `SUPABASE_SERVICE_ROLE_KEY` is a secret. It is never pasted into chat, never committed, never hardcoded — only read from an environment variable / gitignored `.env` file, exactly like `print-bridge/.env` already does. Task 2 needs the user to provide it out-of-band (export it in their own shell, or hand the running agent a `.env` file directly on disk) before that task's script can actually run against production.

---

### Task 1: `public.users` schema — add `auth_uid`

**Files:**
- Create: `supabase/migrations/202609290001_users_auth_uid.sql`

**Interfaces:**
- Produces: `public.users.auth_uid` (uuid, nullable, references `auth.users(id)`) — consumed by Task 2 (populated there), Task 3/4 (looked up after login), Task 6 (edge function looks up an employee's `auth_uid` for password reset).

This is purely additive — safe to push immediately, doesn't change any existing behavior, doesn't touch RLS or grants.

- [ ] **Step 1: Write the migration**

```sql
-- 202609290001_users_auth_uid.sql
-- Links each employee row to their real Supabase Auth identity, ahead of
-- retiring the plaintext login_user RPC (see
-- docs/superpowers/specs/2026-09-29-rls-auth-migration-design.md). Purely
-- additive -- users.pass and login_user keep working exactly as today
-- until the cutover.
alter table public.users
    add column if not exists auth_uid uuid references auth.users(id);
```

- [ ] **Step 2: Apply the migration**

Use the holdout workaround for the 4 known timestamp collisions:

```bash
mkdir -p supabase/.migration_holdout
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609020005_wms_shifts_roster.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql supabase/.migration_holdout/ 2>/dev/null
supabase db push
mv supabase/.migration_holdout/*.sql supabase/migrations/
rmdir supabase/.migration_holdout
git status --porcelain supabase/migrations
```

Expected: push succeeds, final `git status --porcelain supabase/migrations` prints nothing (holdout files are back, migration file is a new untracked/staged addition only).

- [ ] **Step 3: Verify**

```bash
supabase db query --linked "select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='users' and column_name='auth_uid';"
```

Expected: one row, `auth_uid`, `uuid`, `YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202609290001_users_auth_uid.sql
git commit -m "Add users.auth_uid ahead of Supabase Auth migration"
git push origin main
```

This migration file is schema-only and safe to push now — it is not one of the gated files (Global Constraints only gate the frontend JS/HTML and Task 8's lock-down migration).

---

### Task 2: One-time employee migration script

**Files:**
- Create: `scripts/migrate-employees-to-auth.mjs`
- Create: `scripts/.env.example`
- Modify: `.gitignore` (add `scripts/.env`)

**Interfaces:**
- Consumes: `public.users` rows (`id`, `pass`), `public.users.auth_uid` column (Task 1).
- Produces: for each migrated employee, a real `auth.users` row (email `<id>@wms.internal`, password = their existing plaintext password) and `public.users.auth_uid` populated. This is what Task 3/4's `signInWithPassword` calls depend on, and what Task 10's test account needs to exist before any local QA can log in for real.

Uses the Admin REST API directly via native `fetch` (Node 18+ has it built in — this repo's environment runs Node 26) instead of installing `@supabase/supabase-js` for a script that's run once. Never commits the real key; mirrors `print-bridge/.env`'s existing convention exactly.

- [ ] **Step 1: Write the script**

```js
// scripts/migrate-employees-to-auth.mjs — one-off: creates a real
// Supabase Auth user (auth.users) for each employee row in public.users
// that doesn't have one yet, using their EXISTING plaintext password
// (Admin API hashes it on the way in). Sets public.users.auth_uid to
// link them. Safe to re-run -- skips any row that already has auth_uid
// set, and skips (with a warning) any employee whose id already has a
// matching auth.users row from a previous partial run.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-employees-to-auth.mjs
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-employees-to-auth.mjs --only=1034305
//
// --only=<id>[,<id>...] restricts the run to specific employee ids -- use
// this first to create just a test account (see the plan's Task 10)
// before running the full unrestricted migration.

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy scripts/.env.example, fill it in, and export it, or run:");
    console.error("  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-employees-to-auth.mjs");
    process.exit(1);
}

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlyIds = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean)) : null;

async function rest(path, options = {}) {
    const res = await fetch(SUPABASE_URL + path, {
        ...options,
        headers: {
            "content-type": "application/json",
            apikey: SERVICE_ROLE_KEY,
            authorization: "Bearer " + SERVICE_ROLE_KEY,
            ...(options.headers || {}),
        },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${options.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
    return body;
}

async function fetchEmployees() {
    let query = "id,pass,auth_uid&auth_uid=is.null&order=id";
    if (onlyIds) query = `id,pass,auth_uid&id=in.(${Array.from(onlyIds).join(",")})&order=id`;
    return rest(`/rest/v1/users?select=${query}`);
}

async function createAuthUser(id, pass) {
    return rest("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ email: `${id}@wms.internal`, password: pass, email_confirm: true }),
    });
}

async function setAuthUid(id, authUid) {
    await rest(`/rest/v1/users?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ auth_uid: authUid }),
    });
}

async function main() {
    const employees = await fetchEmployees();
    console.log(`${employees.length} employee(s) to migrate${onlyIds ? ` (--only=${Array.from(onlyIds).join(",")})` : ""}.`);

    let ok = 0;
    let failed = 0;
    for (const emp of employees) {
        if (!emp.pass) {
            console.warn(`skip ${emp.id}: no password set`);
            failed += 1;
            continue;
        }
        try {
            const created = await createAuthUser(emp.id, emp.pass);
            await setAuthUid(emp.id, created.id);
            console.log(`ok   ${emp.id} -> auth_uid ${created.id}`);
            ok += 1;
        } catch (e) {
            console.error(`FAIL ${emp.id}: ${e.message}`);
            failed += 1;
        }
    }
    console.log(`\nDone. ${ok} migrated, ${failed} failed/skipped.`);
    if (failed) process.exit(1);
}

main();
```

- [ ] **Step 2: Write the env template**

```
# Copy to scripts/.env and fill in before running (or export both vars in
# your shell directly). Never commit the real values.
# Find these under Project Settings -> API in the Supabase dashboard.
SUPABASE_URL=https://bgphllmzmlwurfnbagho.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
```

Write this to `scripts/.env.example`.

- [ ] **Step 3: Gitignore the real env file**

Add a line to `.gitignore`:

```
scripts/.env
```

- [ ] **Step 4: Ask the user for the service role key, out of band**

This step cannot be automated further — stop here and ask the user to either:
(a) export `SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_URL`) in the shell this task runs commands in, or
(b) create `scripts/.env` themselves with the real key and confirm it's in place.
Do not ask them to paste the key into chat.

- [ ] **Step 5: Dry-run against a single test employee**

Pick one real employee id from `public.users` to act as the dedicated test account for Task 10 (ask the user which id to use, or use a newly-created throwaway row if they'd rather not repoint a real employee's login during testing — either is fine, it only needs a `pass` value to migrate).

```bash
node scripts/migrate-employees-to-auth.mjs --only=<chosen-id>
```

Expected: `ok <chosen-id> -> auth_uid <uuid>`, `1 migrated, 0 failed`.

- [ ] **Step 6: Verify**

```bash
supabase db query --linked "select id, auth_uid from public.users where id = '<chosen-id>';"
```

Expected: `auth_uid` is a non-null uuid.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate-employees-to-auth.mjs scripts/.env.example .gitignore
git commit -m "Add one-off employee migration script to Supabase Auth"
git push origin main
```

Safe to push — this script only runs when explicitly invoked with a service-role key nobody but the operator has; committing it doesn't execute anything or affect the live app. **Do not run the unrestricted (no `--only`) full migration yet** — that happens once Tasks 3-10 are all validated against the single test account, so a bad migration doesn't need re-running for all employees. Note this for later: the full run is `node scripts/migrate-employees-to-auth.mjs` with no `--only` flag, any time before Task 12 — running it early is safe (per the spec, invisible to users, old login keeps working throughout) but there's no benefit to rushing it ahead of Task 10's validation.

---

### Task 3: Rewrite `auth.js` — desktop login

**Files:**
- Modify: `auth.js:31-70`

**Interfaces:**
- Consumes: `supabaseClient.auth.signInWithPassword` (supabase-js v2, already loaded via the UMD bundle per `auth.js`'s own header comment), `public.users.auth_uid` (Task 1).
- Produces: `localStorage['user']` shaped exactly as today **minus the `pass` field** — every downstream reader (`ui.js`'s 4 login-gate checks, `tasks.js`, `profile.js`, etc.) is unaffected since none of them read `.pass` off it except `profile.js` (rewritten in Task 5).

- [ ] **Step 1: Replace the RPC call and payload construction**

Replace this block (`auth.js:31-63`):

```js
        try {
            // Вызов RPC-функции login_user(p_id, p_pass)
            const { data, error } = await supabaseClient
                .rpc('login_user', { p_id: id, p_pass: pass });

            if (error) {
                console.error('Supabase RPC error', error);
                loginError.textContent = 'Ошибка сервера';
                loginError.style.display = 'block';
                return;
            }

            if (!data) {
                // нет совпадения
                loginError.textContent = 'Неверный ID или пароль';
                loginError.style.display = 'block';
                return;
            }

            // data — jsonb с записью пользователя (в форме объекта)
            // сохраняем в localStorage в том же формате, который у вас использовался ранее
            // Приведём к ожидаемому формату {id, name/fio, accesses: []}
            const userObj = {
                id: data.id,
                name: data.fio || data.name || '',
                fio: data.fio || '',
                pass: data.pass || '',
                accesses: Array.isArray(data.accesses) ? data.accesses : (data.accesses ? [data.accesses] : [])
            };

            localStorage.setItem('user', JSON.stringify(userObj));
            window.location.href = 'index.html';

        } catch (e) {
```

with:

```js
        try {
            const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                email: id + '@wms.internal',
                password: pass,
            });

            if (authError || !authData?.user) {
                loginError.textContent = 'Неверный ID или пароль';
                loginError.style.display = 'block';
                return;
            }

            const { data, error } = await supabaseClient
                .from('users')
                .select('*')
                .eq('auth_uid', authData.user.id)
                .maybeSingle();

            if (error || !data) {
                console.error('Profile lookup error', error);
                loginError.textContent = 'Не удалось загрузить профиль';
                loginError.style.display = 'block';
                return;
            }

            // Приведём к ожидаемому формату {id, name/fio, accesses: []} --
            // same shape as before, minus `pass`: it's never sent to the
            // client anywhere in the new flow.
            const userObj = {
                id: data.id,
                name: data.fio || data.name || '',
                fio: data.fio || '',
                accesses: Array.isArray(data.accesses) ? data.accesses : (data.accesses ? [data.accesses] : [])
            };

            localStorage.setItem('user', JSON.stringify(userObj));
            window.location.href = 'index.html';

        } catch (e) {
```

- [ ] **Step 2: Syntax check**

```bash
node --check auth.js
```

Expected: no output (success).

- [ ] **Step 3: Leave uncommitted**

Per Global Constraints, `auth.js` is a gated file — do **not** `git add`/`commit`/`push` it here. It gets committed together with the other frontend files in Task 12, after Task 10's end-to-end QA (which exercises this file for the first time, alongside `mobile-login.js`/`profile.js`/`access_manager.js`, against the one test account from Task 2) and Task 11's cutover both succeed.

---

### Task 4: Rewrite `mobile-login.js`

**Files:**
- Modify: `mobile-login.js:33-40`

**Interfaces:**
- Consumes: same as Task 3.
- Produces: `localStorage['wmsplus_mobile_user']` shaped exactly as today (`{id, name}` — it never stored `pass` to begin with).

- [ ] **Step 1: Replace the RPC call**

Replace this block (`mobile-login.js:33-40`):

```js
        try {
            const { data, error } = await supabaseClient.rpc("login_user", { p_id: id, p_pass: pass });
            if (error || !data) {
                msg.textContent = "Неверный ID или пароль";
                return;
            }
            localStorage.setItem(LS_KEY, JSON.stringify({ id: data.id, name: data.fio || data.name || "" }));
            window.location.href = "mobile-inventory.html";
        } catch (e) {
```

with:

```js
        try {
            const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                email: id + "@wms.internal",
                password: pass,
            });
            if (authError || !authData?.user) {
                msg.textContent = "Неверный ID или пароль";
                return;
            }
            const { data, error } = await supabaseClient
                .from("users")
                .select("id, fio")
                .eq("auth_uid", authData.user.id)
                .maybeSingle();
            if (error || !data) {
                msg.textContent = "Не удалось загрузить профиль";
                return;
            }
            localStorage.setItem(LS_KEY, JSON.stringify({ id: data.id, name: data.fio || "" }));
            window.location.href = "mobile-inventory.html";
        } catch (e) {
```

- [ ] **Step 2: Update the file's own header comment**

Replace:

```js
// mobile-login.js — login for the WMS+ mobile app (link-only, no nav
// entry). Reuses the same login_user RPC / users table the desktop
// login.html/auth.js already uses -- no new auth backend. Stores its
// own session under a distinct localStorage key so it never collides
// with the desktop's own 'user' key/cache assumptions.
```

with:

```js
// mobile-login.js — login for the WMS+ mobile app (link-only, no nav
// entry). Uses the same Supabase Auth signInWithPassword flow the
// desktop login.html/auth.js uses (see
// docs/superpowers/specs/2026-09-29-rls-auth-migration-design.md), same
// synthetic <id>@wms.internal email. Stores its own session under a
// distinct localStorage key so it never collides with the desktop's own
// 'user' key/cache assumptions.
```

- [ ] **Step 3: Syntax check**

```bash
node --check mobile-login.js
```

- [ ] **Step 4: Leave uncommitted**

Gated file — same as Task 3, bundled into Task 12.

---

### Task 5: Rewrite password change — `profile.js` and `profile.html`

**Files:**
- Modify: `profile.js:114-133` (`updateLocalUser`)
- Modify: `profile.js:162-191` (`loadCurrentUser`)
- Modify: `profile.js:193-245` (`openPasswordModal`, `submitPasswordChange`)
- Modify: `profile.html:312-336` (password modal markup)

**Interfaces:**
- Consumes: `supabaseClient.auth.updateUser` (supabase-js v2).
- Produces: `localStorage['user']` never contains `pass` after this — consistent with Task 3's `auth.js` output shape.

- [ ] **Step 1: Stop storing `pass` in `updateLocalUser`**

In `profile.js`, replace:

```js
    function updateLocalUser(user, whName) {
        try {
            const raw = JSON.parse(localStorage.getItem("user") || "{}");
            const fresh = {
                ...raw,
                id: user.id,
                fio: user.fio ?? "",
                name: user.fio || raw.name || "",
                pass: user.pass ?? raw.pass ?? "",
                accesses: normalizeAccesses(user.accesses),
                user_wh_id: user.user_wh_id,
                wh_name: whName || ""
            };

            localStorage.setItem("user", JSON.stringify(fresh));
            localStorage.removeItem("user_cache");
        } catch (e) {
            console.error("Cannot sync local user", e);
        }
    }
```

with:

```js
    function updateLocalUser(user, whName) {
        try {
            const raw = JSON.parse(localStorage.getItem("user") || "{}");
            const fresh = {
                ...raw,
                id: user.id,
                fio: user.fio ?? "",
                name: user.fio || raw.name || "",
                accesses: normalizeAccesses(user.accesses),
                user_wh_id: user.user_wh_id,
                wh_name: whName || ""
            };

            localStorage.setItem("user", JSON.stringify(fresh));
            localStorage.removeItem("user_cache");
        } catch (e) {
            console.error("Cannot sync local user", e);
        }
    }
```

- [ ] **Step 2: Remove the `pass` backfill in `loadCurrentUser`**

Replace:

```js
        currentUser = data;
        if ((currentUser.pass === undefined || currentUser.pass === null || currentUser.pass === "") && localUser.pass) {
            currentUser.pass = localUser.pass;
        }
        await loadPagesMap();
```

with:

```js
        currentUser = data;
        await loadPagesMap();
```

- [ ] **Step 3: Rewrite `openPasswordModal` and `submitPasswordChange`**

Replace:

```js
    function openPasswordModal() {
        if (!currentUser) return;

        oldPasswordInput.value = "";
        newPasswordInput.value = "";
        confirmPasswordInput.value = "";

        passwordModal.classList.remove("hidden");
        setTimeout(() => oldPasswordInput.focus(), 0);
    }

    function closePasswordModal() {
        passwordModal.classList.add("hidden");
    }

    async function submitPasswordChange() {
        if (!currentUser) return;

        const oldPass = oldPasswordInput.value.trim();
        const newPass = newPasswordInput.value.trim();
        const confirmPass = confirmPasswordInput.value.trim();

        if (!oldPass || !newPass || !confirmPass) {
            MiniUI.toast("Заполните все поля", { type: "error" });
            return;
        }

        if (String(currentUser.pass || "") !== oldPass) {
            MiniUI.toast("Старый пароль указан неверно", { type: "error" });
            return;
        }

        if (newPass !== confirmPass) {
            MiniUI.toast("Новый пароль и подтверждение не совпадают", { type: "error" });
            return;
        }

        const { error } = await supabaseClient
            .from("users")
            .update({ pass: newPass })
            .eq("id", String(currentUser.id));

        if (error) {
            MiniUI.toast("Не удалось сменить пароль", { type: "error" });
            return;
        }

        currentUser.pass = newPass;
        updateLocalUser(currentUser, currentWhName);

        closePasswordModal();
        MiniUI.toast("Пароль успешно изменен", { type: "success" });
    }
```

with:

```js
    function openPasswordModal() {
        if (!currentUser) return;

        newPasswordInput.value = "";
        confirmPasswordInput.value = "";

        passwordModal.classList.remove("hidden");
        setTimeout(() => newPasswordInput.focus(), 0);
    }

    function closePasswordModal() {
        passwordModal.classList.add("hidden");
    }

    async function submitPasswordChange() {
        if (!currentUser) return;

        const newPass = newPasswordInput.value.trim();
        const confirmPass = confirmPasswordInput.value.trim();

        if (!newPass || !confirmPass) {
            MiniUI.toast("Заполните все поля", { type: "error" });
            return;
        }

        if (newPass !== confirmPass) {
            MiniUI.toast("Новый пароль и подтверждение не совпадают", { type: "error" });
            return;
        }

        const { error } = await supabaseClient.auth.updateUser({ password: newPass });

        if (error) {
            MiniUI.toast("Не удалось сменить пароль", { type: "error" });
            return;
        }

        closePasswordModal();
        MiniUI.toast("Пароль успешно изменен", { type: "success" });
    }
```

- [ ] **Step 4: Remove the old-password field from the DOM lookups**

Near the top of `profile.js`, replace:

```js
    const passwordModal = document.getElementById("password-modal");
    const oldPasswordInput = document.getElementById("old-password");
    const newPasswordInput = document.getElementById("new-password");
```

with:

```js
    const passwordModal = document.getElementById("password-modal");
    const newPasswordInput = document.getElementById("new-password");
```

Then find the array that wires input listeners (`[oldPasswordInput, newPasswordInput, confirmPasswordInput].forEach(...)`, around line 674) and remove `oldPasswordInput` from it:

```js
        [newPasswordInput, confirmPasswordInput].forEach((input) => {
```

- [ ] **Step 5: Remove the old-password field from `profile.html`**

Replace:

```html
<div id="password-modal" class="modal hidden">
    <div class="modal-content" style="width:420px;max-width:92%;padding:22px 24px;box-sizing:border-box;">
        <div style="font-size:20px;font-weight:700;margin-bottom:14px;">Сменить пароль</div>

        <div class="modal-field">
            <div class="modal-field-label">Старый пароль</div>
            <input id="old-password" type="password" class="input" style="width:100%;box-sizing:border-box;">
        </div>

        <div class="modal-field">
            <div class="modal-field-label">Новый пароль</div>
            <input id="new-password" type="password" class="input" style="width:100%;box-sizing:border-box;">
        </div>
```

with:

```html
<div id="password-modal" class="modal hidden">
    <div class="modal-content" style="width:420px;max-width:92%;padding:22px 24px;box-sizing:border-box;">
        <div style="font-size:20px;font-weight:700;margin-bottom:14px;">Сменить пароль</div>

        <div class="modal-field">
            <div class="modal-field-label">Новый пароль</div>
            <input id="new-password" type="password" class="input" style="width:100%;box-sizing:border-box;">
        </div>
```

- [ ] **Step 6: Syntax check**

```bash
node --check profile.js
```

- [ ] **Step 7: Leave uncommitted**

Gated files (`profile.js`, `profile.html`) — bundled into Task 12.

---

### Task 6: New Edge Function `admin-manage-employee`

**Files:**
- Create: `supabase/functions/admin-manage-employee/index.ts`

**Interfaces:**
- Consumes: `Deno.env.get("SUPABASE_URL"/"SUPABASE_SERVICE_ROLE_KEY"/"SUPABASE_ANON_KEY")` (auto-injected by the platform for every Edge Function — same pattern as `supabase/functions/opp-cache-ingest/index.ts:17-18`), the caller's `Authorization` header (their own Supabase Auth session token).
- Produces: HTTP endpoint `POST /functions/v1/admin-manage-employee` with two actions (`create`, `reset_password`) — consumed by Task 7's rewritten `access_manager.js`.

Gated by the platform's own `verify_jwt` (default `true` for a newly created function — rejects any request without a valid Supabase session before this code even runs) plus an explicit `auth.getUser()` re-check inside, which also gives the function the caller's identity. Per the spec (§5) and the 2026-09-29 scope decision, this only checks "is there a valid session at all" — not a specific admin role; tightening that is an explicit, separate follow-up, not blocking here.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/admin-manage-employee/index.ts — the only place
// allowed to create a Supabase Auth login for an employee or reset one's
// password (needs service_role, which must never reach the browser --
// see docs/superpowers/specs/2026-09-29-rls-auth-migration-design.md,
// section 5). access_manager.js calls this instead of writing
// public.users.pass directly, which is retired.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed. Use POST." });

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader) return json(401, { ok: false, error: "Missing Authorization header." });

  // Re-validate the caller's own session -- also gives us their identity.
  // Belt-and-suspenders alongside the platform's own verify_jwt gate.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { authorization: authHeader } },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData?.user) {
    return json(401, { ok: false, error: "Invalid session." });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json(400, { ok: false, error: "Invalid JSON body." });

  const action = String((body as Record<string, unknown>).action || "");

  if (action === "create") {
    const id = String((body as Record<string, unknown>).id || "").trim();
    const fio = String((body as Record<string, unknown>).fio || "").trim();
    const pass = String((body as Record<string, unknown>).pass || "");
    const accesses = Array.isArray((body as Record<string, unknown>).accesses)
      ? (body as Record<string, unknown>).accesses as string[]
      : [];

    if (!id || !pass) return json(400, { ok: false, error: "id и pass обязательны." });

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: `${id}@wms.internal`,
      password: pass,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      return json(400, { ok: false, error: "Не удалось создать вход: " + (createError?.message || "unknown error") });
    }

    const { error: insertError } = await adminClient.from("users").insert({
      id,
      fio,
      accesses,
      auth_uid: created.user.id,
    });
    if (insertError) {
      // Roll back the auth user so a failed employee row doesn't leave an
      // orphaned, unusable login behind.
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json(400, { ok: false, error: "Не удалось сохранить сотрудника: " + insertError.message });
    }

    return json(200, { ok: true, id });
  }

  if (action === "reset_password") {
    const id = String((body as Record<string, unknown>).id || "").trim();
    const pass = String((body as Record<string, unknown>).pass || "");
    if (!id || !pass) return json(400, { ok: false, error: "id и pass обязательны." });

    const { data: employee, error: lookupError } = await adminClient
      .from("users")
      .select("auth_uid")
      .eq("id", id)
      .maybeSingle();
    if (lookupError || !employee?.auth_uid) {
      return json(404, { ok: false, error: "Сотрудник не найден." });
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(employee.auth_uid, { password: pass });
    if (updateError) {
      return json(400, { ok: false, error: "Не удалось сменить пароль: " + updateError.message });
    }

    return json(200, { ok: true, id });
  }

  return json(400, { ok: false, error: "Unknown action: " + action });
});
```

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy admin-manage-employee --project-ref bgphllmzmlwurfnbagho
```

Deploying is safe and independent of the gated frontend cutover — the function does nothing until something calls it, and nothing calls it until Task 7's `access_manager.js` (which stays uncommitted/unpushed until Task 12) is live.

- [ ] **Step 3: Smoke-test unauthenticated (expect rejection)**

```bash
curl -s -X POST "https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/admin-manage-employee" \
  -H "content-type: application/json" \
  -d '{"action":"create","id":"9999999","fio":"Test","pass":"x","accesses":[]}'
```

Expected: a 401-shaped JSON error (missing/invalid auth) — confirms the function is not wide open.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/admin-manage-employee/index.ts
git commit -m "Add admin-manage-employee edge function"
git push origin main
```

Safe to push — this is server-side code, not one of the gated client files, and it's already been confirmed to reject unauthenticated calls.

---

### Task 7: Rewrite `access_manager.js` and `access_manager.html`

**Files:**
- Modify: `access_manager.js:97-117` (`openModal`)
- Modify: `access_manager.js:243-278` (`saveUser`)
- Modify: `access_manager.js` (add `EDGE_FUNCTION_URL` constant near the top)
- Modify: `access_manager.html:76` (`m-pass` input)

**Interfaces:**
- Consumes: Task 6's `admin-manage-employee` endpoint (`{action: "create"|"reset_password", id, fio?, pass, accesses?}` → `{ok: true, id}` or `{ok: false, error}`), `supabaseClient.auth.getSession()` (to get the caller's own access token to forward).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Add the endpoint constant**

Near the top of `access_manager.js`, after the `EXTENDED_MENU_ACCESS_CODE` constant:

```js
    const EXTENDED_MENU_ACCESS_CODE = "extended_menu";
    const EDGE_FUNCTION_URL = "https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/admin-manage-employee";
```

- [ ] **Step 2: Stop prefilling the plaintext password on edit**

Replace:

```js
    function openModal(editUser = null) {
        modal.classList.remove("hidden");

        if (editUser) {
            editModeUserId = editUser.id;
            mTitle.textContent = "Редактировать пользователя";
            mId.value = editUser.id;
            mId.disabled = true;
            mFio.value = editUser.fio || "";
            mPass.value = editUser.pass || "";
        } else {
            editModeUserId = null;
            mTitle.textContent = "Новый пользователь";
            mId.value = "";
            mId.disabled = false;
            mFio.value = "";
            mPass.value = "";
        }

        buildAccessCheckboxes(editUser ? editUser.accesses || [] : []);
    }
```

with:

```js
    function openModal(editUser = null) {
        modal.classList.remove("hidden");

        if (editUser) {
            editModeUserId = editUser.id;
            mTitle.textContent = "Редактировать пользователя";
            mId.value = editUser.id;
            mId.disabled = true;
            mFio.value = editUser.fio || "";
            mPass.value = "";
            mPass.placeholder = "Оставьте пустым, чтобы не менять";
        } else {
            editModeUserId = null;
            mTitle.textContent = "Новый пользователь";
            mId.value = "";
            mId.disabled = false;
            mFio.value = "";
            mPass.value = "";
            mPass.placeholder = "Пароль";
        }

        buildAccessCheckboxes(editUser ? editUser.accesses || [] : []);
    }
```

- [ ] **Step 3: Split create (via edge function) from edit (direct update + optional reset)**

Replace:

```js
    async function saveUser() {
        const id = mId.value.trim();
        const fio = mFio.value.trim();
        const pass = mPass.value.trim();

        if (!id) {
            MiniUI.toast("ID обязателен", { type: "warning" });
            return;
        }

        const checks = modal.querySelectorAll("#special-accesses input[type=checkbox], #access-groups input[type=checkbox]");
        const accesses = Array.from(checks)
            .filter(ch => ch.checked)
            .map(ch => ch.value);

        const payload = {
            id,
            fio,
            pass,
            accesses
        };

        const { error } = await supabaseClient
            .from("users")
            .upsert(payload);

        if (error) {
            MiniUI.toast("Ошибка сохранения", { type: "error" });
            return;
        }

        MiniUI.toast("Сохранено", { type: "success" });

        closeModal();
        await loadUsers();
    }
```

with:

```js
    async function callAdminEndpoint(payload) {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const token = sessionData?.session?.access_token;
        const res = await fetch(EDGE_FUNCTION_URL, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer " + token },
            body: JSON.stringify(payload),
        });
        const result = await res.json().catch(() => ({ ok: false, error: res.statusText }));
        if (!res.ok || !result.ok) throw new Error(result.error || res.statusText);
        return result;
    }

    async function saveUser() {
        const id = mId.value.trim();
        const fio = mFio.value.trim();
        const pass = mPass.value.trim();

        if (!id) {
            MiniUI.toast("ID обязателен", { type: "warning" });
            return;
        }

        const checks = modal.querySelectorAll("#special-accesses input[type=checkbox], #access-groups input[type=checkbox]");
        const accesses = Array.from(checks)
            .filter(ch => ch.checked)
            .map(ch => ch.value);

        if (!editModeUserId) {
            if (!pass) {
                MiniUI.toast("Пароль обязателен для нового пользователя", { type: "warning" });
                return;
            }
            try {
                await callAdminEndpoint({ action: "create", id, fio, pass, accesses });
            } catch (e) {
                MiniUI.toast("Ошибка создания: " + e.message, { type: "error" });
                return;
            }
            MiniUI.toast("Сохранено", { type: "success" });
            closeModal();
            await loadUsers();
            return;
        }

        const { error } = await supabaseClient
            .from("users")
            .update({ fio, accesses })
            .eq("id", editModeUserId);

        if (error) {
            MiniUI.toast("Ошибка сохранения", { type: "error" });
            return;
        }

        if (pass) {
            try {
                await callAdminEndpoint({ action: "reset_password", id: editModeUserId, pass });
            } catch (e) {
                MiniUI.toast("Пользователь сохранён, но пароль не сброшен: " + e.message, { type: "error" });
                closeModal();
                await loadUsers();
                return;
            }
        }

        MiniUI.toast("Сохранено", { type: "success" });
        closeModal();
        await loadUsers();
    }
```

- [ ] **Step 4: Mask the password field in the HTML**

In `access_manager.html`, replace:

```html
            <input id="m-pass" class="input" placeholder="Пароль">
```

with:

```html
            <input id="m-pass" type="password" class="input" placeholder="Пароль">
```

- [ ] **Step 5: Syntax check**

```bash
node --check access_manager.js
```

- [ ] **Step 6: Leave uncommitted**

Gated files (`access_manager.js`, `access_manager.html`) — bundled into Task 12.

---

### Task 8: Write the RLS lock-down migration (written, NOT applied yet)

**Files:**
- Create: `supabase/migrations/202609290002_lock_down_neglected_tables.sql`

**Interfaces:**
- Produces: the exact migration Task 11 applies. Nothing consumes this at write time — it is deliberately inert until Task 11's gated push.

Covers all 45 tables from the spec's lock-down list plus 3 views discovered during this plan's own verification pass (`opp_shift_detail_latest_metrics`, `opp_shift_report_runs`, `report_metrics_flat` — all three are derived entirely from `report_runs`/`report_metrics`, already in the 45, with no consumer found anywhere in this repo or the 4 confirmed public surfaces; views aren't RLS subjects themselves, so a plain `revoke select ... from anon` is both necessary and sufficient for them). Every `anon` privilege set and every stale policy name below was read live from the production database on 2026-09-29 (`information_schema.role_table_grants`, `pg_policies`) — not assumed.

- [ ] **Step 1: Write the migration file**

```sql
-- 202609290002_lock_down_neglected_tables.sql
-- See docs/superpowers/specs/2026-09-29-rls-auth-migration-design.md.
-- Locks down every table/view with no confirmed anon consumer (45 tables
-- + 3 views). The 9 tables tied to a confirmed public, no-login surface
-- (the external "Без ШК" intake form, the display.js kiosk, the
-- opp_shift_iframe.js dashboard widget) are deliberately absent from this
-- file -- do not add them.
--
-- DO NOT `supabase db push` THIS FILE without the user's explicit,
-- separately-given go-ahead naming the agreed cutover window -- it
-- revokes anon's access to every table below for real, the instant it
-- runs, for every current employee session. See the plan's Task 11.
-- Lock down the 42 tables that never had RLS considered at all: enable
-- RLS, add a blanket authenticated-only policy (no per-row scoping --
-- scope decision 2026-09-29 was "logged in or not", not per-employee),
-- and revoke anon's grants.

alter table public."2shk_rep" enable row level security;

create policy "2shk_rep_authenticated_all" on public."2shk_rep"
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public."2shk_rep" from anon;

alter table public.cron_job_backup_20260819 enable row level security;

create policy cron_job_backup_20260819_authenticated_all on public.cron_job_backup_20260819
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.cron_job_backup_20260819 from anon;

alter table public.linear_emp_rep enable row level security;

create policy linear_emp_rep_authenticated_all on public.linear_emp_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.linear_emp_rep from anon;

alter table public.losses_rep enable row level security;

create policy losses_rep_authenticated_all on public.losses_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.losses_rep from anon;

alter table public.nm_rep enable row level security;

create policy nm_rep_authenticated_all on public.nm_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.nm_rep from anon;

alter table public.opp_telegram_alert_log enable row level security;

create policy opp_telegram_alert_log_authenticated_all on public.opp_telegram_alert_log
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.opp_telegram_alert_log from anon;

alter table public.pages enable row level security;

create policy pages_authenticated_all on public.pages
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.pages from anon;

alter table public.places enable row level security;

create policy places_authenticated_all on public.places
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.places from anon;

alter table public.pure_losses_rep enable row level security;

create policy pure_losses_rep_authenticated_all on public.pure_losses_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.pure_losses_rep from anon;

alter table public.report_metrics enable row level security;

create policy report_metrics_authenticated_all on public.report_metrics
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.report_metrics from anon;

alter table public.report_runs enable row level security;

create policy report_runs_authenticated_all on public.report_runs
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.report_runs from anon;

alter table public.shk_rep enable row level security;

create policy shk_rep_authenticated_all on public.shk_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.shk_rep from anon;

alter table public.sort_groups_rep enable row level security;

create policy sort_groups_rep_authenticated_all on public.sort_groups_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.sort_groups_rep from anon;

alter table public.sort_squares_rep enable row level security;

create policy sort_squares_rep_authenticated_all on public.sort_squares_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.sort_squares_rep from anon;

alter table public.tmc_rep enable row level security;

create policy tmc_rep_authenticated_all on public.tmc_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.tmc_rep from anon;

alter table public.users enable row level security;

create policy users_authenticated_all on public.users
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.users from anon;

alter table public.weeek_employees enable row level security;

create policy weeek_employees_authenticated_all on public.weeek_employees
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_employees from anon;

alter table public.weeek_manual_upload_runs enable row level security;

create policy weeek_manual_upload_runs_authenticated_all on public.weeek_manual_upload_runs
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_manual_upload_runs from anon;

alter table public.weeek_manual_upload_runs_backup_20260817_165515 enable row level security;

create policy weeek_manual_upload_runs_backup_20260817_165515_authenticated_all on public.weeek_manual_upload_runs_backup_20260817_165515
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_manual_upload_runs_backup_20260817_165515 from anon;

alter table public.weeek_manual_upload_settings enable row level security;

create policy weeek_manual_upload_settings_authenticated_all on public.weeek_manual_upload_settings
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_manual_upload_settings from anon;

alter table public.weeek_shifts enable row level security;

create policy weeek_shifts_authenticated_all on public.weeek_shifts
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_shifts from anon;

alter table public.weeek_task_routes enable row level security;

create policy weeek_task_routes_authenticated_all on public.weeek_task_routes
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_task_routes from anon;

alter table public.weeek_tasks enable row level security;

create policy weeek_tasks_authenticated_all on public.weeek_tasks
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_tasks from anon;

alter table public.weeek_tasks_basic enable row level security;

create policy weeek_tasks_basic_authenticated_all on public.weeek_tasks_basic
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_tasks_basic from anon;

alter table public.weeek_tasks_basic_backup_20260817_165515 enable row level security;

create policy weeek_tasks_basic_backup_20260817_165515_authenticated_all on public.weeek_tasks_basic_backup_20260817_165515
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_tasks_basic_backup_20260817_165515 from anon;

alter table public.wh_data_rep enable row level security;

create policy wh_data_rep_authenticated_all on public.wh_data_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wh_data_rep from anon;

alter table public.wh_rep enable row level security;

create policy wh_rep_authenticated_all on public.wh_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wh_rep from anon;

alter table public.wiki_rep enable row level security;

create policy wiki_rep_authenticated_all on public.wiki_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wiki_rep from anon;

alter table public.wms_achievements enable row level security;

create policy wms_achievements_authenticated_all on public.wms_achievements
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_achievements from anon;

alter table public.wms_employees enable row level security;

create policy wms_employees_authenticated_all on public.wms_employees
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_employees from anon;

alter table public.wms_flow_score_settings enable row level security;

create policy wms_flow_score_settings_authenticated_all on public.wms_flow_score_settings
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_flow_score_settings from anon;

alter table public.wms_manual_upload_runs enable row level security;

create policy wms_manual_upload_runs_authenticated_all on public.wms_manual_upload_runs
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_manual_upload_runs from anon;

alter table public.wms_manual_upload_settings enable row level security;

create policy wms_manual_upload_settings_authenticated_all on public.wms_manual_upload_settings
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_manual_upload_settings from anon;

alter table public.wms_no_shk_sticker_events enable row level security;

create policy wms_no_shk_sticker_events_authenticated_all on public.wms_no_shk_sticker_events
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_no_shk_sticker_events from anon;

alter table public.wms_prespisok_actions enable row level security;

create policy wms_prespisok_actions_authenticated_all on public.wms_prespisok_actions
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_prespisok_actions from anon;

alter table public.wms_prespisok_runs enable row level security;

create policy wms_prespisok_runs_authenticated_all on public.wms_prespisok_runs
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_prespisok_runs from anon;

alter table public.wms_shifts enable row level security;

create policy wms_shifts_authenticated_all on public.wms_shifts
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_shifts from anon;

alter table public.wms_superset_cache enable row level security;

create policy wms_superset_cache_authenticated_all on public.wms_superset_cache
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_superset_cache from anon;

alter table public.wms_task_history enable row level security;

create policy wms_task_history_authenticated_all on public.wms_task_history
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_task_history from anon;

alter table public.wms_task_nm_index enable row level security;

create policy wms_task_nm_index_authenticated_all on public.wms_task_nm_index
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_task_nm_index from anon;

alter table public.wms_tasks enable row level security;

create policy wms_tasks_authenticated_all on public.wms_tasks
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_tasks from anon;

alter table public.wms_writeoff_terms enable row level security;

create policy wms_writeoff_terms_authenticated_all on public.wms_writeoff_terms
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_writeoff_terms from anon;

-- 3 tables already had RLS enabled with a stale permissive policy that
-- granted ALL to `public` (anon included) -- no confirmed public consumer
-- for any of them (see spec, Background). Drop the old policy first so it
-- doesn't keep matching alongside the new one.

drop policy mistakes_rep_select_all on public.mistakes_rep;

create policy mistakes_rep_authenticated_all on public.mistakes_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.mistakes_rep from anon;

drop policy print_jobs_all on public.print_jobs;

create policy print_jobs_authenticated_all on public.print_jobs
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.print_jobs from anon;

drop policy print_label_templates_all on public.print_label_templates;

create policy print_label_templates_authenticated_all on public.print_label_templates
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.print_label_templates from anon;

-- 3 views derived entirely from already-locked-down tables
-- (report_runs, report_metrics) with no confirmed consumer anywhere in
-- this repo or the 4 confirmed public surfaces. Views aren't RLS subjects
-- themselves -- anon's own SELECT grant on the view is the only gate,
-- independent of the underlying tables' policies (the view owner's
-- privileges apply unless the view is security_invoker). Revoking here is
-- both necessary and sufficient.
revoke select on public.opp_shift_detail_latest_metrics from anon;
revoke select on public.opp_shift_report_runs from anon;
revoke select on public.report_metrics_flat from anon;
```

- [ ] **Step 2: Lint the SQL (syntax only, do not apply)**

```bash
supabase db lint --linked -f supabase/migrations/202609290002_lock_down_neglected_tables.sql 2>&1 || true
```

If `db lint` isn't applicable to a single ad-hoc file in this CLI version, fall back to a local syntax sanity check instead — do not apply it to prod to "test" it:

```bash
grep -c "^alter table\|^create policy\|^revoke\|^drop policy" supabase/migrations/202609290002_lock_down_neglected_tables.sql
```

Expected: exactly `138` (42 `alter table` + 45 `create policy` + 48 `revoke` [45 tables + 3 views] + 3 `drop policy` — verified against this exact file during plan-writing) — a sanity check that nothing got truncated, not a real apply.

- [ ] **Step 3: Commit (the file only — do not push-apply it)**

```bash
git add supabase/migrations/202609290002_lock_down_neglected_tables.sql
git commit -m "Write RLS lock-down migration for 45 neglected tables (not yet applied)"
git push origin main
```

Pushing this commit to `origin/main` is safe and expected — it puts the migration *file* in the repo's history. It does **not** run the migration; `supabase db push` is a separate, deliberate command that Task 11 runs only after explicit go-ahead. A committed-but-unapplied migration file sitting in `supabase/migrations/` has zero effect on the live database.

---

### Task 9: Write the rollback script (written, verified by inspection only)

**Files:**
- Create: `supabase/rollback/202609290002_lock_down_neglected_tables_ROLLBACK.sql`

**Interfaces:**
- Produces: the exact undo script Task 11 keeps on hand and runs immediately if the cutover breaks something.

Lives outside `supabase/migrations/` on purpose — it is not part of the normal linear migration history (Supabase's migration model has no native "undo" concept; this is applied ad-hoc via `supabase db query --linked` if and when needed, not via `db push`). Every `grant` statement restores the *exact* privilege set read live from production in Task 8 — not a guessed default — confirmed uniform across all 45 tables (`DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`) except where noted.

- [ ] **Step 1: Write the rollback file**

```sql
-- Emergency rollback for 202609290002_lock_down_neglected_tables.sql.
-- Restores exactly today's (2026-09-29) anon privileges. Disabling RLS
-- makes any policy -- new or the 3 stale ones dropped in the forward
-- migration -- moot, so this is a full, exact revert regardless of
-- policy state.

alter table public."2shk_rep" disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public."2shk_rep" to anon;

alter table public.cron_job_backup_20260819 disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.cron_job_backup_20260819 to anon;

alter table public.linear_emp_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.linear_emp_rep to anon;

alter table public.losses_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.losses_rep to anon;

alter table public.mistakes_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.mistakes_rep to anon;

alter table public.nm_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.nm_rep to anon;

alter table public.opp_telegram_alert_log disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.opp_telegram_alert_log to anon;

alter table public.pages disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.pages to anon;

alter table public.places disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.places to anon;

alter table public.print_jobs disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.print_jobs to anon;

alter table public.print_label_templates disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.print_label_templates to anon;

alter table public.pure_losses_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.pure_losses_rep to anon;

alter table public.report_metrics disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.report_metrics to anon;

alter table public.report_runs disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.report_runs to anon;

alter table public.shk_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.shk_rep to anon;

alter table public.sort_groups_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.sort_groups_rep to anon;

alter table public.sort_squares_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.sort_squares_rep to anon;

alter table public.tmc_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.tmc_rep to anon;

alter table public.users disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.users to anon;

alter table public.weeek_employees disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_employees to anon;

alter table public.weeek_manual_upload_runs disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_manual_upload_runs to anon;

alter table public.weeek_manual_upload_runs_backup_20260817_165515 disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_manual_upload_runs_backup_20260817_165515 to anon;

alter table public.weeek_manual_upload_settings disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_manual_upload_settings to anon;

alter table public.weeek_shifts disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_shifts to anon;

alter table public.weeek_task_routes disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_task_routes to anon;

alter table public.weeek_tasks disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_tasks to anon;

alter table public.weeek_tasks_basic disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_tasks_basic to anon;

alter table public.weeek_tasks_basic_backup_20260817_165515 disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_tasks_basic_backup_20260817_165515 to anon;

alter table public.wh_data_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wh_data_rep to anon;

alter table public.wh_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wh_rep to anon;

alter table public.wiki_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wiki_rep to anon;

alter table public.wms_achievements disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_achievements to anon;

alter table public.wms_employees disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_employees to anon;

alter table public.wms_flow_score_settings disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_flow_score_settings to anon;

alter table public.wms_manual_upload_runs disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_manual_upload_runs to anon;

alter table public.wms_manual_upload_settings disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_manual_upload_settings to anon;

alter table public.wms_no_shk_sticker_events disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_no_shk_sticker_events to anon;

alter table public.wms_prespisok_actions disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_prespisok_actions to anon;

alter table public.wms_prespisok_runs disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_prespisok_runs to anon;

alter table public.wms_shifts disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_shifts to anon;

alter table public.wms_superset_cache disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_superset_cache to anon;

alter table public.wms_task_history disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_task_history to anon;

alter table public.wms_task_nm_index disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_task_nm_index to anon;

alter table public.wms_tasks disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_tasks to anon;

alter table public.wms_writeoff_terms disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_writeoff_terms to anon;

-- The 3 views (no RLS involved -- view-level grant is the only gate).
grant select on public.opp_shift_detail_latest_metrics to anon;
grant select on public.opp_shift_report_runs to anon;
grant select on public.report_metrics_flat to anon;
```

- [ ] **Step 2: Verify by inspection — do not apply**

Confirm the table list here is the exact complement of Task 8's (every table Task 8 locks down appears here with a matching `grant`, none of the 9 confirmed-public tables appear in either file):

```bash
# Use the revoke/grant lines, not "alter table" -- 3 of the 45 already had
# RLS enabled, so they appear as "drop policy"/"create policy" in the
# forward file instead of "alter table ... enable row level security".
# Every one of the 45 has exactly one revoke (forward) and one grant
# (rollback) line, so those are the reliable table-list extraction point.
grep -oP '(?<=^revoke all on public\.)[^ ]+(?= from anon;)' supabase/migrations/202609290002_lock_down_neglected_tables.sql | sort -u > /tmp/locked.txt
grep -oP '(?<=^grant delete, insert, references, select, trigger, truncate, update on public\.)[^ ]+(?= to anon;)' supabase/rollback/202609290002_lock_down_neglected_tables_ROLLBACK.sql | sort -u > /tmp/rolled_back.txt
diff /tmp/locked.txt /tmp/rolled_back.txt
wc -l /tmp/locked.txt /tmp/rolled_back.txt
```

Expected: `diff` prints nothing, `wc -l` reports 45 for both files (verified against this exact command during plan-writing — confirmed match).

This is the only pre-cutover testing possible for a rollback script whose entire purpose is undoing a change that, per Global Constraints, hasn't been applied yet. Its real test is Task 11 itself — either it's never needed, or it gets exercised for real if something breaks, which is exactly what it's for.

- [ ] **Step 3: Commit**

```bash
git add supabase/rollback/202609290002_lock_down_neglected_tables_ROLLBACK.sql
git commit -m "Write rollback script for the RLS lock-down migration"
git push origin main
```

Safe — this file has no effect until manually run.

---

### Task 10: Local end-to-end QA against production, before any RLS change

**Files:** none (verification-only task)

**Interfaces:**
- Consumes: the test employee account from Task 2 Step 5, the rewritten-but-uncommitted `auth.js`/`mobile-login.js`/`profile.js`/`access_manager.js` from Tasks 3/4/5/7 (served locally, not from `origin/main`).

At this point RLS has **not** changed — `anon` still has today's full access to all 45 tables. This task only proves the *new login code* works end to end against real production data, using the one migrated test account, while the safety net (today's open grants) is still in place. If anything here fails, nothing about the live app has changed yet — fix and re-run.

- [ ] **Step 1: Serve the working tree locally**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
python3 -m http.server 8990
```

- [ ] **Step 2: Log in as the test employee via the new `auth.js`**

Open the Claude Browser pane at `http://localhost:8990/login.html`, enter the test employee's id and their real (existing, pre-migration) password. Confirm:
- Login succeeds and redirects to `index.html`.
- `localStorage.getItem('user')` (via the browser JS tool) parses to an object with `id`/`fio`/`accesses` and **no `pass` key**.

- [ ] **Step 3: Confirm ordinary reads/writes still work**

Navigate to `tasks.html`, open Разбор, open a real task's detail card, confirm the task list and detail both load (still running under `anon` grants for the underlying tables — this only proves the *session* is real and `.from()` calls aren't broken by the code change, not that RLS is enforced yet, which is Task 11's job). Check the browser console for new errors introduced by this session's changes (pre-existing unrelated noise from earlier this session is expected and fine).

- [ ] **Step 4: Confirm `profile.js`'s password change flow**

Open the Профиль drawer, change the test account's password to a new value via the (now old-password-free) form, confirm success toast, log out, log back in with the *new* password to confirm it actually took effect server-side (not just client-side optimism).

- [ ] **Step 5: Confirm `mobile-login.js`**

Serve the same local directory, open `http://localhost:8990/mobile-login.html`, log in as the same test employee with their current password, confirm redirect to `mobile-inventory.html` and that the page loads real zone/rack data.

- [ ] **Step 6: Confirm `access_manager.js`'s new employee creation, end to end**

Still logged in as the test employee (or another account with access to this page), open `access_manager.html`, create a brand-new throwaway employee (e.g. id `9999998`) with a password, confirm the success toast, then open a fresh incognito-equivalent session (clear `localStorage` or use a private browser context) and log in as `9999998` via `login.html` to confirm the created account really works. Then delete `9999998` from `access_manager.html` to clean up (uses the existing, unchanged delete path — still a direct `.from("users").delete()`, unaffected by this migration).

- [ ] **Step 7: Confirm `access_manager.js`'s password reset**

Use `access_manager.html` to reset the test employee's password to a third value (leave `fio`/`accesses` unchanged, fill only the password field), confirm the toast, log out, log back in with the new password to confirm it took.

If every step above passes, Tasks 3/4/5/6/7's code is validated against real production data and real Supabase Auth, entirely without having touched RLS or grants yet. Proceed to Task 11 only once this task is fully green.

- [ ] **Step 8: Stop the local server**

```bash
pkill -f "http.server 8990"
```

---

### Task 11: ⛔ GATED — apply the RLS lock-down migration to production

**Files:** none (this task runs Task 8's already-written, already-committed migration file)

**⛔ Do not run this task as part of a normal plan execution pass. Stop here and wait for the user to send a separate, explicit message confirming the agreed cutover window has arrived. A plan-execution agent reaching this point should report "Tasks 1-10 complete and verified; Task 11 requires your explicit go-ahead for the cutover window" and stop — that is success, not an incomplete run.**

Once that explicit go-ahead is given:

- [ ] **Step 1: Confirm Task 10 passed**

Re-confirm (don't just assume from memory) that Task 10's 7 verification steps are all still green — if any code changed since, re-run Task 10 first.

- [ ] **Step 2: Apply the migration**

Use the timestamp-collision workaround (same as Task 1):

```bash
mkdir -p supabase/.migration_holdout
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609020005_wms_shifts_roster.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql supabase/.migration_holdout/ 2>/dev/null
supabase db push
mv supabase/.migration_holdout/*.sql supabase/migrations/
rmdir supabase/.migration_holdout
git status --porcelain supabase/migrations
```

This is the moment `anon` loses access to all 45 tables + 3 views, for everyone, immediately. Every employee still on the old `login_user`-based session (i.e., anyone who hasn't gone through Task 12's new login yet) starts seeing failed requests the instant this completes — this is why Task 12 is bundled into the same window, executed right after this step, not on a separate day.

- [ ] **Step 3: Immediately re-run Task 10 against the now-locked-down database**

Using the test account, repeat Task 10 Steps 1-7. This time it proves RLS is actually enforced (not just that the session is real) — every read/write should still succeed for the *authenticated* test account, because `authenticated` has the same `using (true)` access `anon` used to have.

- [ ] **Step 4: Confirm the 4 public surfaces are unaffected**

Without logging in anywhere:
- Open `display.html` locally (or its real deployed URL) — confirm the kiosk view still renders live rack/box/inventory-session data.
- Open `opp_shift_iframe.html` locally — confirm it still reads `opp_reports_cache`/`opp_alert_settings`.
- Confirm (by reading the spec, not by finding a live install of it) that `wmsplus-intake-form` was never touched by this migration — `intake_submissions` does not appear anywhere in `202609290002_lock_down_neglected_tables.sql`.

- [ ] **Step 5: If anything in Steps 3-4 fails, roll back immediately**

```bash
supabase db query --linked "$(cat supabase/rollback/202609290002_lock_down_neglected_tables_ROLLBACK.sql)"
```

If the CLI rejects a single multi-statement string this large, split the rollback file into per-statement calls or apply it via a direct `psql` connection to the project instead — confirm which works during this step, since it's the first real execution of this file. After rolling back, re-verify Task 10 passes again (back to pre-cutover state), then stop and investigate before retrying Task 11.

- [ ] **Step 6: Report status**

If Steps 3-4 are green, Task 11 is done — proceed straight to Task 12 in the same sitting (per the spec, these two are one cutover, not two separate events).

---

### Task 12: ⛔ GATED — deploy the new frontend code

**Files:** commits the already-written, already-locally-validated changes from Tasks 3, 4, 5, 7 (`auth.js`, `mobile-login.js`, `profile.js`, `profile.html`, `access_manager.js`, `access_manager.html`).

**⛔ Runs immediately after Task 11 in the same window, never before it and never separately gated-around on its own — do not commit/push these files at any earlier point in this plan.**

- [ ] **Step 1: Final syntax check on everything being shipped**

```bash
node --check auth.js
node --check mobile-login.js
node --check profile.js
node --check access_manager.js
```

- [ ] **Step 2: Commit and push**

```bash
git add auth.js mobile-login.js profile.js profile.html access_manager.js access_manager.html
git commit -m "Cut over to Supabase Auth login (retires plaintext login_user RPC path)"
git push origin main
```

This is the moment the real, live `login.html`/`mobile-login.html` start requiring the new flow for every employee — anyone with an old `localStorage['user']`/`localStorage['wmsplus_mobile_user']` session finds their next Supabase call failing (Task 11 already revoked `anon`) and needs to log in again through the new screen. This is expected; the user should have already communicated this to staff ahead of the window.

- [ ] **Step 3: Smoke-test the real, live site**

Open the actual production URL (not localhost), log in as the test employee for real, confirm the same checks as Task 10 Steps 3-4 against the live deployment.

- [ ] **Step 4: Report completion**

Cutover is complete. `login_user` RPC and `users.pass` remain in place (unused) through the grace period — Task 13 removes them later, separately gated.

---

### Task 13: ⛔ GATED, days later — cleanup after the grace period

**Files:**
- Create: `supabase/migrations/<date-of-execution>_drop_login_user_and_pass.sql`

**⛔ Do not run this task in the same sitting as Task 11/12, and not automatically after some fixed delay — only on a fresh, explicit go-ahead from the user, given once they've confirmed the new login has been stable for real employees for a few days (per the spec's Rollout §3-4).**

- [ ] **Step 1: Write the cleanup migration**

```sql
-- <date>_drop_login_user_and_pass.sql
-- Cleanup after the Supabase Auth cutover's grace period (see
-- docs/superpowers/specs/2026-09-29-rls-auth-migration-design.md,
-- Rollout step 4) -- confirmed stable, plaintext password storage and the
-- comparison RPC are no longer needed anywhere.
drop function if exists public.login_user(text, text);

alter table public.users drop column if exists pass;
```

- [ ] **Step 2: Apply**

Same holdout workaround as Tasks 1 and 11.

- [ ] **Step 3: Verify**

```bash
supabase db query --linked "select proname from pg_proc where proname='login_user';"
supabase db query --linked "select column_name from information_schema.columns where table_schema='public' and table_name='users' and column_name='pass';"
```

Expected: both queries return zero rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<date-of-execution>_drop_login_user_and_pass.sql
git commit -m "Drop retired login_user RPC and users.pass column"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- §1 `public.users` schema → Task 1.
- §2 employee migration → Task 2.
- §3 login rewrite (`auth.js`, `mobile-login.js`) → Tasks 3, 4.
- §4 self-service password change (`profile.js`) → Task 5.
- §5 admin employee creation/reset → Tasks 6, 7.
- §6 RLS rollout (45 tables) → Task 8 (write), Task 11 (apply) — plus 3 views found during this plan's verification pass, folded into the same migration.
- §7 "everything that stays as it is" (4 public surfaces, print-bridge, Storage) → verified in Task 11 Step 4, never touched by Task 8's migration.
- Rollout §1-4 → Task 2 (pre-cutover), Tasks 11+12 (cutover window), Task 13 (cleanup, separately gated).
- Rollback → Task 9 (written), Task 11 Step 5 (used if needed).
- Testing before cutover → Task 10.
- Out of scope items (accesses-as-roles, the 9 untouched tables, Storage policies, the edge-function-secret finding, anon key rotation) → correctly absent from every task above.

**Placeholder scan:** every task carries complete, literal code — no "add error handling," no "similar to Task N," no unfilled SQL. The one deliberately open item (exact rollback-invocation command for a 145-line multi-statement script) is flagged honestly in Task 11 Step 5 as something to confirm live, not glossed over.

**Type/name consistency:** `EDGE_FUNCTION_URL` (Task 7) matches the deployed function's real URL from Task 6's deploy command. `auth_uid` (Task 1) is the exact column name used in Tasks 2, 3, 4, 6. Migration filenames referenced in Task 9/11 (`202609290002_lock_down_neglected_tables.sql`) match Task 8's `Create:` path exactly. The 45-table list is identical (diffed programmatically) between Task 8's migration and Task 9's rollback.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-29-rls-auth-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Either way, Tasks 11, 12, and 13 stop for your explicit go-ahead exactly as marked — no execution mode overrides that.

**Which approach?**
