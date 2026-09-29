# RLS + Auth Migration — Design Spec

> **For agentic workers:** this spec argues the design; `docs/superpowers/plans/` will carry
> the task-by-task implementation plan derived from it (written next, via
> superpowers:writing-plans).

**Goal:** Close the two critical findings from the 2026-09-29 WMS+ audit —
(1) RLS disabled or ineffective on 45 of 54 `public` tables, with `anon`
holding `DELETE/INSERT/UPDATE/TRUNCATE` on most of them, and (2) employee
passwords stored and compared in plaintext — without breaking any of the
app's four confirmed public, no-login surfaces.

**Architecture:** Replace the custom `login_user(id, pass)` RPC + plaintext
`users.pass` with real Supabase Auth (`auth.users`, `signInWithPassword`),
using a synthetic `<id>@wms.internal` email so the login screen itself
doesn't change. Every table that has no evidence of a legitimate anon
consumer switches to an `authenticated`-only RLS policy and has its `anon`
grants revoked (45 tables); the 9 tables already tied to a confirmed public
surface are left untouched.

**Tech Stack:** Supabase Auth (GoTrue), Postgres RLS, Supabase Admin API
(service_role, used only in a one-off local migration script and inside one
new Edge Function — never client-side), supabase-js v2 (already in use
everywhere).

## Background — what was found

No file in this repo defines `login_user`; it exists only live on the
project (not tracked in `supabase/migrations`):

```sql
CREATE OR REPLACE FUNCTION public.login_user(p_id text, p_pass text)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER
AS $function$
  select to_jsonb(u) from public.users u
  where u.id = p_id and u.pass = p_pass
  limit 1;
$function$
```

It compares `pass` as plaintext and returns the **entire row, including
`pass`**, which `auth.js:53-61` then stores verbatim in
`localStorage['user']`. `profile.js` reads it back for the "change
password" screen and compares it as a string. `mobile-login.js` calls the
exact same RPC for the warehouse-floor mobile login
(`localStorage['wmsplus_mobile_user']`). `access_manager.js` (admin screen)
inserts/updates `users.pass` directly when creating or editing an employee.

There is no session concept distinguishing "a logged-in employee" from
"anyone with the anon key" — every request from every page, logged in or
not, uses the identical, publicly-embedded anon JWT
(`role: anon`). Postgres/PostgREST cannot tell these apart. `accesses`
(e.g. `opp_tasks`) is read by `ui.js` to filter which menu items render —
it is never checked by RLS, any SQL function, or any trigger. It is purely
cosmetic today; per the user's decision (2026-09-29), it stays cosmetic —
this migration only distinguishes logged-in vs not.

**All 54 `public` tables, by current RLS state** (queried live 2026-09-29):

10 already have RLS **enabled** with an explicit named policy — but "RLS
enabled" turns out not to mean "someone decided this should be public."
Cross-checking each of the 10 against every file that actually queries it
(not just against the 4 confirmed public surfaces) splits them in two:

- **7 are genuinely tied to a confirmed public surface**, and stay
  untouched: `intake_submissions` (the external intake form),
  `wms_no_shk_boxes`, `wms_no_shk_racks`, `wms_no_shk_shelves`,
  `wms_no_shk_inventory_box_results`, `wms_no_shk_inventory_sessions`,
  `wms_no_shk_inventory_shelf_audits` (`display.js`'s kiosk reads +
  realtime, `mobile-inventory.js`'s scanning).
- **3 have RLS "enabled" with a `using (true)` policy that grants `ALL` to
  `public`, but no confirmed public consumer at all** — every caller found
  (`opp_admin.js`, `opp_dashboard.js` for `mistakes_rep`;
  `print-tspl.js`/`tasks.js`/`no_shk_zone.js`/`print_test.js` for
  `print_jobs` and `print_label_templates`) is a gated page, or
  `mobile-inventory.js` (which migrates to real auth in this same plan
  anyway, §3). These three — `mistakes_rep`, `print_jobs`,
  `print_label_templates` — get the same treatment as the 42 below, not a
  pass.

2 more have RLS **explicitly disabled** by a dedicated migration
(`202603240002_opp_reports_cache_disable_rls.sql`,
`202607130002_opp_alert_settings.sql`), each granting only `SELECT` to
`anon, authenticated` and reserving writes for `service_role` — a real,
documented decision, unlike the 42 below. Stay untouched:
`opp_reports_cache`, `opp_alert_settings`.

So **9 tables are confirmed-public and stay exactly as they are**
(the 7 + these 2), and **45 tables get locked down to `authenticated`**
(the 3 above + the 42 that never had RLS touched at all):
`2shk_rep`, `cron_job_backup_20260819`, `linear_emp_rep`, `losses_rep`,
`mistakes_rep`, `nm_rep`, `opp_telegram_alert_log`, `pages`, `places`,
`print_jobs`, `print_label_templates`, `pure_losses_rep`,
`report_metrics`, `report_runs`, `shk_rep`, `sort_groups_rep`,
`sort_squares_rep`, `tmc_rep`, `users`, `weeek_employees`,
`weeek_manual_upload_runs`,
`weeek_manual_upload_runs_backup_20260817_165515`,
`weeek_manual_upload_settings`, `weeek_shifts`, `weeek_task_routes`,
`weeek_tasks`, `weeek_tasks_basic`,
`weeek_tasks_basic_backup_20260817_165515`, `wh_data_rep`, `wh_rep`,
`wiki_rep`, `wms_achievements`, `wms_employees`,
`wms_flow_score_settings`, `wms_manual_upload_runs`,
`wms_manual_upload_settings`, `wms_no_shk_sticker_events`,
`wms_prespisok_actions`, `wms_prespisok_runs`, `wms_shifts`,
`wms_superset_cache`, `wms_task_history`, `wms_task_nm_index`,
`wms_tasks`, `wms_writeoff_terms`.

**Confirmed public, no-login surfaces** (verified by reading every file in
the repo that calls `createClient(`, cross-checked with the user for
anything outside the repo — confirmed complete, nothing else exists):

1. **`wmsplus-intake-form`** — a *separate repository*, not in this
   codebase. Writes to `intake_submissions` only. Already hardened
   (`202609040002_intake_submissions_hardening.sql`): `anon` has `INSERT`
   with `with check (true)` and nothing else.
2. **`display.html`/`display.js`** — unattended wall kiosk, "meant to work
   from a bare link with no session at all" (its own header comment).
   Reads + realtime-subscribes to `wms_no_shk_racks`, `wms_no_shk_boxes`,
   `wms_no_shk_inventory_sessions`, `wms_no_shk_inventory_shelf_audits`.
3. **`opp_shift_iframe.html`/`.js`** + the paired Google Apps Script
   (`google_apps_script_opp_shift_iframe.gs`, itself using the anon key
   from Script Properties) — a public dashboard widget embedded in a
   Google Sheet. Reads `opp_reports_cache`, `opp_alert_settings`.
4. **`mobile-login.html`/`mobile-inventory.html`** — warehouse-floor mobile
   scanning, gated by its *own* login screen (reusing `login_user`), reads
   and writes `wms_no_shk_boxes`/`racks`/`shelves` and the three
   `wms_no_shk_inventory_*` tables. Unlike #2 and #3 this one **does**
   authenticate a person — it migrates to real Supabase Auth alongside the
   main app (same `login_user` replacement), it just isn't the reason
   those particular tables stay open to `anon` (the kiosk is).

Every table those four surfaces touch is already inside the 9-table
confirmed-public set above. **None of the 45 tables being locked down has
a legitimate anon consumer anywhere.** That is the entire basis for this
migration's scope: touch exactly the 45, touch nothing else.

## Approach chosen, and why not the alternatives

**Chosen: real Supabase Auth**, `authenticated`-only RLS on the 45 tables,
`anon` grants revoked there. Almost every existing `.from(table)` call in
tasks.js/intake_search.js/no_shk_zone.js/pure_losses*/etc. needs **zero**
code changes — supabase-js persists the session against the same
`SUPABASE_URL`/anon key and attaches it automatically, so a query written
today keeps working, it just runs as `authenticated` instead of `anon`
once the user is signed in. Passwords become Supabase-managed (bcrypt),
never touch the wire or the client after the one-time migration.

**Rejected — custom-signed JWTs verified via `request.jwt.claims`.** Would
give the same RLS capability but means building and maintaining token
issuance, expiry and refresh by hand — reimplementing what GoTrue already
does, for no benefit here.

**Rejected — grant-narrowing without a real session (stopgap-only).**
Revoke `DELETE/UPDATE/TRUNCATE` from `anon`, push writes through
`SECURITY DEFINER` RPCs, leave `SELECT` public. Faster, but `wms_tasks`,
`wms_employees` etc. stay world-readable, and it does nothing for the
plaintext-password problem — that fix is mandatory regardless, so it
doesn't actually save the hard part of the work, only defers the RLS half
of it.

## Design

### 1. `public.users` schema

Add `auth_uid uuid references auth.users(id)`. Keep `id` (the employee's
tab number — everything in the app keys off it, e.g. `wms_tasks.assignee_employee_id`)
as the primary key, unchanged, so no other table's foreign keys move.
`pass` stays in place *through the cutover* (see Rollout) and is dropped
only once the new login has been stable for a few days.

### 2. One-time employee migration (pre-cutover, no user-facing effect)

A local script (not committed — reads `SUPABASE_SERVICE_ROLE_KEY` from an
env var the same way `print-bridge/index.js` already does, run once by
hand), for every row in `public.users`:

```
auth.admin.createUser({
  email: `${id}@wms.internal`,
  password: <existing plaintext users.pass>,
  email_confirm: true,
})
```

then `update public.users set auth_uid = <new id> where id = <employee id>`.
This runs *before* the cutover deploy — the old `login_user` RPC keeps
working exactly as today throughout, since nothing about the old path is
touched yet. Any employee added after this script ran (before cutover)
needs a second, smaller pass covering just the delta — noted for the plan.

### 3. Login rewrite — `auth.js` and `mobile-login.js`

Both replace their `supabaseClient.rpc('login_user', ...)` call with:

```js
const { data, error } = await supabaseClient.auth.signInWithPassword({
  email: `${id}@wms.internal`,
  password: pass,
});
```

On success, fetch the matching `public.users` row (`select * from users
where auth_uid = auth.uid()` — now legal for the caller under the new RLS
policy, see §6) and populate `localStorage['user']` /
`localStorage['wmsplus_mobile_user']` exactly as today, **minus the `pass`
field**, which no longer exists anywhere in the payload. Every other page's
`localStorage.getItem('user')` gate (four call sites in `ui.js`, described
below) is **unchanged** — it continues to answer "is someone logged in"
for the UI, while the real security boundary is now the Supabase session
that `supabaseClient` carries automatically (its own
`sb-bgphllmzmlwurfnbagho-auth-token` localStorage entry, separate from the
app's `user` key, managed entirely by supabase-js). Login screen markup
does not change — still one ID field, one password field.

### 4. Self-service password change — `profile.js`

Currently compares `currentUser.pass`/`oldPass` as strings. Replaces with
`supabaseClient.auth.updateUser({ password: newPass })` — valid because
the caller already holds a live session; no old-password re-entry needed
(same UX every other app with a "logged in already proves who you are"
password-change screen uses). Drop the old-password field from the form.

### 5. Admin-side employee creation/reset — `access_manager.js`

Creating a user or resetting someone's password needs `service_role`
(`auth.admin.createUser`/`updateUserById`), which must never reach the
browser. New Edge Function `admin-manage-employee` (service_role inside,
same pattern as the existing edge functions): takes the caller's own JWT,
looks up their own `public.users` row via `auth.uid()`, and — since real
per-role permissions are explicitly out of scope for this pass — for now
only checks that the caller is authenticated at all (matches "all staff
equal" scope decision; tightening this to a real admin flag is a listed
follow-up, not blocking). Performs the create/update via Admin API,
returns the new employee's `id`. `access_manager.js` calls this instead of
inserting into `users` directly.

### 6. RLS rollout — the 45 tables

One migration, applied together with the code deploy at cutover. For the
42 that never had RLS touched, per table:

```sql
alter table public.<t> enable row level security;

create policy <t>_authenticated_all on public.<t>
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.<t> from anon;
```

For the 3 that already have RLS enabled with a stale permissive policy
(`mistakes_rep`, `print_jobs`, `print_label_templates`), drop that policy
first so it doesn't keep matching alongside the new one:

```sql
drop policy <existing_policy_name> on public.<t>;

create policy <t>_authenticated_all on public.<t>
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.<t> from anon;
```

`using/with check (true)` — not narrower — because the scope decision was
"logged in or not," not per-employee row scoping; every authenticated
employee keeps seeing and editing everything they can today. The 9
already-reviewed tables (7 tied to a confirmed public surface +
`opp_reports_cache` + `opp_alert_settings`) are **not touched at all** by
this migration — no new policy, no grant change, byte-for-byte as they are
now.

### 7. Everything that stays exactly as it is

`print-bridge/index.js` and every Edge Function use `service_role`, which
bypasses RLS entirely — unaffected. The four public surfaces (§ Background)
keep working unmodified: `display.js`, `opp_shift_iframe.js`, and
`wmsplus-intake-form` never authenticate and don't need to — their tables
aren't in the 45. `mobile-inventory.html`'s reads/writes to those same
tables keep working too regardless of its own login state, though it gets
the real-auth treatment anyway (§3) for the writes that matter for audit
trail integrity. Supabase Storage (the `photo_path` bucket behind
`intake_submissions`) is untouched — out of scope, has its own separate
policy system.

## Rollout

1. **Pre-cutover** (any time, invisible to users): run the employee
   migration script (§2). Old login keeps working throughout.
2. **Cutover window** (user picks the time, separately, closer to
   execution): deploy together, in one shot — new `auth.js`,
   `mobile-login.js`, `profile.js`, `access_manager.js`, the
   `admin-manage-employee` edge function, and the RLS/grant migration
   (§6). The moment the migration runs, every existing `localStorage['user']`
   /`localStorage['wmsplus_mobile_user']` session becomes non-functional
   for anything beyond viewing already-rendered UI — the next Supabase call
   fails until the employee logs in again through the new flow. This is
   expected and unavoidable with a hard cutover; staff need to know in
   advance they'll be logged out.
3. **Grace period** (a few days): `login_user` RPC and `users.pass` stay in
   the database, unused but present, as a fast rollback path.
4. **Cleanup** (after the grace period, confirmed stable): drop
   `login_user`, drop `users.pass`.

## Rollback

A single prepared "undo" migration, tested ahead of the cutover, that for
the same 45 tables runs `revoke ... from anon` → `grant <today's exact
privileges, per table> to anon` and `alter table ... disable row level
security` — disabling RLS makes any policy (new or dropped) moot, so this
restores today's exact behavior for all 45, including the 3 that had a
stale policy dropped in §6, in under a minute if something breaks right
after cutover. Keeping `login_user`/`users.pass` through the grace
period (§ Rollout) means reverting `login.html` to a kept-but-unreferenced
copy of the old `auth.js` is also a real option during that window, not
just the RLS side.

## Testing before the real cutover

Everything through step 2 of Rollout (employee migration, new
auth.js/mobile-login.js/profile.js/access_manager.js code, the RLS
migration itself) gets validated against **this same production project**
using a dedicated test employee account created via the same migration
path, *before* the actual cutover moment — sign in as the test account,
confirm reads/writes across tasks.js/pure_losses/intake_search/no_shk_zone
still work end to end, confirm `display.js`/`opp_shift_iframe.js`/the
intake form's write path are unaffected (checked by hitting them
un-authenticated, exactly as their real users do), confirm the rollback
migration actually restores today's grants. Only once all of that is green
does the real cutover (revoking `anon` on the 45 tables for everyone) fire,
in the agreed window.

## Out of scope (explicitly, for this pass)

- Turning `accesses` into real per-role DB permissions (user's decision,
  2026-09-29) — a natural follow-up once this lands, not part of it.
- Touching any of the 9 already-reviewed, confirmed-public tables.
- Supabase Storage bucket policies.
- The shared edge-function "secret" finding from the audit (identical
  value across ~12 functions) — separate issue, unrelated to RLS/auth.
- Rotating the anon key itself — not needed; the key stays public by
  design in a Supabase project, RLS is what's supposed to make that safe.
