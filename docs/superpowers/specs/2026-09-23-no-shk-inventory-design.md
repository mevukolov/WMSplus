# «Инвентаризация «Без ШК»» — design spec

## Goal

A new, link-only, login-gated mobile web app ("WMS+ mobile") whose first
(and for now only) feature lets a warehouse worker physically walk the
"Без ШК" storage racks with their phone, scanning each shelf and the
boxes on it, while a paired kiosk display (`display.html`, already built)
shows live step-by-step instructions and a green/red rack progress map.
Discrepancies between what the database thinks is on a shelf and what's
physically found are recorded, not silently dropped.

## Why

Box records drift from physical reality over time (a box gets moved by
hand without anyone updating `shelf_id`, a sticker falls off). This
feature reconciles the two and leaves a paper trail.

## Non-goals (explicitly out of scope for this build)

- Fine-grained per-page permissions (the existing `pages`/`accesses`
  system on desktop) — mobile just requires "logged in", nothing more.
- Concurrent/multiple simultaneous inventory sessions — one global
  session at a time.
- A history *browsing* UI (a page to look through past sessions) — the
  data is saved so one can be built later, but building it isn't part of
  this plan.
- Reordering/prescribing which shelf to scan next — the worker walks in
  whatever physical order is convenient; the system just tracks which
  shelves are done.

## Architecture overview

New pages live in **WMSplus-main** (not a new repo), alongside
`display.html`/`no_shk_zone.js`, following this repo's existing
flat-file, no-build-step convention:

- `mobile-login.html` / `mobile-login.js` — phone-optimized login,
  calls the same `login_user(p_id, p_pass)` RPC and `users` table the
  desktop `auth.js` already uses. Stores its own session in
  `localStorage` under a distinct key (`wmsplus_mobile_user`) so it
  doesn't collide with the desktop's `user` key/cache assumptions.
- `mobile-inventory.html` / `mobile-inventory.js` — the single feature
  screen (post-login landing page; no menu needed for one item).

`display.html`/`display.js` (already built) gain an "inventory mode":
when an inventory session exists, it replaces the idle instruction area
with step text/QR/progress, while the existing racks-row rendering is
reused and extended with green/red coloring.

Both sides talk through **one new Supabase table row per session**
(not a one-shot broadcast like the print-bridge QR trigger) because this
flow must survive a page reload on either device — a broadcast has no
persistence or replay.

## Data model (new tables, new migration)

### `wms_no_shk_inventory_sessions`

One row per inventory run.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | encoded in the pairing QR as `WMSP.INV.{id}` |
| `status` | text | `waiting_for_phone` \| `in_progress` \| `completed` \| `abandoned` |
| `started_by_id` / `started_by_name` | text | from the mobile session |
| `started_at` | timestamptz | |
| `finished_at` | timestamptz, null | |
| `last_activity_at` | timestamptz | bumped on every step-advancing action; drives the 30-minute auto-abandon |
| `step` | text | `pairing` \| `scan_shelf` \| `scan_boxes` \| `completed` |
| `current_shelf_id` | uuid, null, fk → `wms_no_shk_shelves` | |

Only one row may be `waiting_for_phone` or `in_progress` at a time
(enforced at the application level — the mobile app checks before
creating a new one, not a DB constraint, since "no other active
session" is a business rule easiest to check with a plain select before
insert, same pattern this repo already uses for the shift-box "at most
one forming box" unique partial index, but a partial-unique-on-status
index is a reasonable equivalent and the plan should use it for real
enforcement, not just an app-level check that a race could slip past).

### `wms_no_shk_inventory_shelf_audits`

One row per shelf actually audited in a given session — this is what
drives the rack green/red coloring and shelf-level history.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `session_id` | uuid, fk | |
| `shelf_id` | uuid, fk | |
| `started_at` | timestamptz | when this shelf's QR was scanned |
| `finished_at` | timestamptz, null | null while still scanning boxes on it; set when "На полке нет/больше нет коробов" is pressed |
| `boxes_found_count` | integer default 0 | |
| `boxes_missing_sticker_count` | integer default 0 | |
| `boxes_not_found_count` | integer default 0 | computed and written when `finished_at` is set |

`unique(session_id, shelf_id)`. Re-scanning a shelf already audited in
the same session re-opens this same row (`finished_at` back to null,
counts reset, its prior `box_results` rows for this session+shelf
deleted) rather than creating a duplicate — scanning a shelf twice in
one session should be harmless, not produce two conflicting records.

A rack is "green" for the display when every one of its shelves has a
row here for the current session with `finished_at` not null. The
session is complete when the count of distinct shelves with a finished
row equals the total row count of `wms_no_shk_shelves`.

### `wms_no_shk_inventory_box_results`

One row per box outcome — this **is** the discrepancy history the admin
side can report from later.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `session_id` | uuid, fk | |
| `shelf_id` | uuid, fk | the shelf it was being audited against |
| `box_id` | uuid, fk | |
| `result` | text | `found` (QR scanned) \| `missing_sticker` (picked from the list) \| `not_found` (DB said it was here, nobody matched it before the shelf was finished) |
| `recorded_at` | timestamptz | |

`found` and `missing_sticker` rows are written the moment each box is
scanned/selected (not batched at shelf-finish) — this is also what
"already accounted for" filtering reads from live, and what drives the
`< shelf.capacity` button logic. `not_found` rows are computed and
inserted when the shelf is finished: every box currently recorded with
`shelf_id = <this shelf>` that has no `found`/`missing_sticker` row for
this session+shelf gets one.

**What happens to a `not_found` box's own record**: per the earlier
decision, its `shelf_id` is left untouched (not cleared) — the box
still shows wherever the system last knew about it; "not found" is
recorded as a fact about this inventory pass, not an automatic
correction. A future admin report can surface `not_found` rows for
follow-up.

**What happens to a `found`/`missing_sticker` box's own record**:
`wms_no_shk_boxes.shelf_id` is updated to the shelf currently being
audited (the whole point is reconciling reality). `missing_sticker`
additionally queues a `print_jobs` row for the "Короб «Без ШК»"
template using that box's own stored fields — same payload shape
`no_shk_zone.js`'s `printActiveBox()` already builds, so no new
print-side code is needed, only a new call site.

## QR code conventions

Two of the three codes already exist and are reused as-is:

- Shelf: `WMSP.PLCE.WSHK.{rack_number}.{shelf_number}` — the label
  already printed for every shelf (`no_shk_zone.js`'s "Полка «Без ШК»"
  template).
- Box: `WMSP.BOX.{box_number, 5-digit zero-padded}` — existing box
  stickers.
- **New**: session pairing — `WMSP.INV.{session_id}` — generated by the
  mobile app when it creates the session row, displayed by
  `display.js` as a QR, scanned back by the same phone that created it.

## Flow

### 1. Login (mobile-login.html)

Same credentials as desktop (`login_user` RPC). On success, store
`{id, name, fio}` under `wmsplus_mobile_user` and go straight to
`mobile-inventory.html`.

### 2. Opening the feature → pairing

`mobile-inventory.html` on load checks for an existing
`waiting_for_phone`/`in_progress` session:
- If one exists (someone else already started), show "Инвентаризация
  уже идёт (начал(а) {name}, {started_at})" and stop there — no
  "join" flow for v1.
- Otherwise, insert a new session row (`status: waiting_for_phone`,
  `step: pairing`), show "Отсканируйте QR на экране" and start the
  phone's own camera scanner (same jsQR pattern `intake.js` already
  uses for the revision-office QR, ported into `mobile-inventory.js`).

`display.js`, subscribed to inserts/updates on the sessions table,
switches out of its normal idle view into "inventory mode" the moment
it sees a `waiting_for_phone` row: renders the `WMSP.INV.{id}` QR
(`qrcodejs`, same as the existing print-QR overlay) plus "Ожидаю
телефон".

Phone scans that QR, confirms the code matches
`WMSP.INV.{this session's own id}` (proves the phone is physically at
the terminal, not scanning a photo of some other screen), and updates
the session to `status: in_progress, step: scan_shelf`.

### 3. Per-shelf loop

**Display**, step `scan_shelf`: "Отсканируйте полку" + the rack grid
(green/red, see below).

**Phone**, step `scan_shelf`: camera scanner active, matching the
`WMSP.PLCE.WSHK.{rack}.{shelf}` pattern. On match: update session
(`current_shelf_id`, `step: scan_boxes`), upsert/reopen the
`shelf_audits` row for (session, shelf).

**Display**, step `scan_boxes`: "Отсканируйте все короба на полке
слева направо" + a directional arrow graphic.

**Phone**, step `scan_boxes`: camera scanner active for
`WMSP.BOX.{n}` codes. Each successful match: if a `box_results` row for
this (session, shelf, box) already exists — a re-scan of the same box,
e.g. camera lag firing twice — show "уже отсканирован" and do nothing
further (no duplicate row, no double count). Otherwise insert a
`box_results` row (`result: found`), update that box's `shelf_id`,
bump `last_activity_at`, increment the shelf audit's
`boxes_found_count` (display picks up the running count live via its
own subscription, so both devices agree without the phone needing to
render its own counter).

Buttons shown below the scanner, condition on the count of
`box_results` rows for (session, current shelf) so far:
- count `== 0`: **"На полке нет коробов"**.
- count `< shelf.capacity` (this shelf's own capacity, not a fixed 4 —
  matches the pattern every other capacity check in this codebase
  already uses `shelf.capacity` dynamically): **"Короб без наклейки"**
  — opens a filterable list of every box in `wms_no_shk_boxes`
  (shelved anywhere + floor + outside ОПП) *excluding* boxes already
  in `box_results` for this session+shelf ("кроме актуального" — read
  as "excluding what's already been accounted for on this shelf this
  pass", not a global exclusion). Picking one inserts a
  `missing_sticker` result row, updates its `shelf_id`, and queues its
  reprint job (§ data model above).
- count `>= 1`: **"На полке больше нет коробов"** instead of the
  count-`==0` button.

Either "no boxes"/"no more boxes" button: set `shelf_audits.finished_at
= now()`, compute and insert `not_found` rows for any box still
recorded on this shelf without a result row this session, clear
`current_shelf_id`, set session `step: scan_shelf` (back to the
top of the loop) — *unless* every shelf now has a finished audit row
for this session, in which case `step: completed`,
`status: completed`, `finished_at: now()`.

**Display**, back to `scan_shelf`: "Отсканируйте следующую полку".

### 4. Completion

**Display**: confetti + green checkmark animation + elapsed time
(`finished_at - started_at`, formatted `чч:мм:сс`), then returns to the
normal idle zone view after a pause.

**Phone**: matching success animation, then routes back to
`mobile-inventory.html`'s own start screen (ready to begin another
session later).

### 5. Racks panel during a session (display)

Reuses the existing racks-row rendering (`display.js`, one row of equal
columns, already built) — no new layout, just a per-rack color: green
if every shelf has a `finished_at`-set audit row for the current
session, red otherwise. This panel is visible through every step of the
flow above, not just at completion.

### 6. Abandoned sessions

No server-side cron is introduced (uncertain whether pg_cron is even
enabled on this Supabase project, and this repo has no precedent for
it). Instead, client-side: `display.js`'s existing periodic poll (it
already polls every 20s) additionally checks the active session's
`last_activity_at`; if stale beyond 30 minutes, it marks the session
`abandoned` and returns to the idle view. `mobile-inventory.js` does
the same check on its own periodic tick so a phone left open on a dead
session also recovers instead of sitting stuck.

## What's reused vs. new

Reused as-is: `login_user` RPC/`users` table, shelf/box QR formats,
`qrcodejs`/jsQR scanning pattern (`intake.js`'s
`startCloseQrScan`/`scanCloseQrFrame`, ported), `print_jobs` pipeline
and the "Короб «Без ШК»" template, `display.js`'s racks-row rendering
and Realtime-plus-poll pattern.

New: 3 tables (above), `mobile-login.html/js`, `mobile-inventory.html/js`,
an "inventory mode" branch inside `display.js`/`display.html`.
