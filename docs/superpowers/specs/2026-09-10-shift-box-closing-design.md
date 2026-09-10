# Закрытие короба смены — Design

## Overview

Extends the existing shift-box mechanism (`wms_no_shk_boxes.outside_opp`,
`intake_submissions.box_id`, `wms_no_shk_box_log_item` — see
[2026-09-08-intake-form-processing-instructions-and-shift-boxes-design.md](2026-09-08-intake-form-processing-instructions-and-shift-boxes-design.md))
with an end-of-shift closing action on the public intake form
(`wmsplus-intake-form`).

Today, a shift box only ever closes via a manual "Принесено" click in the
admin "Без ШК" zone (`no_shk_zone.js`), with no time trigger and no
printing attached. This adds a second, floor-worker-initiated way to close
it: from 19:30 local time, the existing "За смену зафиксировано: N"
counter becomes tappable, walks the worker through a QR-gated hand-off
confirmation, prints one sticker for the box plus one sticker per КГТ item
recorded that shift (each carrying the item's name), and then marks the
box "На полу" — the same effect "Принесено" already produces.

Currently only area `ХАБ` forms shift boxes in practice, but nothing here
is ХАБ-specific; it works off `state.area` like the rest of Part B.

## Scope

- **`wmsplus-intake-form`**: new screens/state in `intake.js` +
  `index.html`. No schema changes here (this repo has no migrations of
  its own — all schema lives in `WMSplus-main/supabase/migrations/`).
- **`WMSplus-main`**: one new migration seeding a print template. No new
  RPC, no new table/column — `wms_no_shk_boxes` is already openly
  readable/writable (`for all using (true)`), and
  `wms_no_shk_box_contents(p_box_id)` (added
  2026-09-08, migration `202609080003`) already returns everything needed
  (`item_text`, `item_type`, ...) without opening `intake_submissions` to
  anon SELECT.

## Global Constraints (carried over from the parent spec)

- No build step in either repo; new dependencies via CDN `<script>` only.
- `data-*` attribute selectors for new interactive elements.
- New/changed SQL ships as a migration under
  `WMSplus-main/supabase/migrations/`.
- `node --check` on every touched `.js` file.
- Live browser verification via each repo's static preview server.
- `intake_submissions` stays anon-INSERT-only — this feature must not
  need to change that.

## Flow

### 1. Time gate

The counter row (`refreshShiftCounter`, `intake.js:47`/`:70`) stays plain
text until local wall-clock time is **≥ 19:30**; from then on it renders
as a tappable element. Checked on every counter refresh (same cadence as
today — screen entry + after each submission), no new timer needed. No
upper bound — it stays tappable through the rest of the day and night
until used.

Only day-shift closing is in scope here; a night-shift equivalent trigger
(if ever wanted) is a separate future ask (see Out of scope).

### 2. "Закрыть коробку" screen

Tapping the counter opens a new screen showing the current count and a
single button, **"Закрыть коробку"**.

At this exact moment, capture `shift_date`/`shift_type`/`area` into local
state and carry those fixed values through the rest of the flow — **do
not** recompute `computeShift()` later (e.g. after the QR scan and
printing finish). Closing typically starts right at/after 19:30, close to
the 20:00 day→night shift boundary; recomputing partway through could
flip `shift_type` mid-flow and make the box lookup in step 4 miss.

If no forming box exists for that `area`/`shift_date`/`shift_type` (i.e.
the counter reads 0), show **"Нечего закрывать"** instead of the button
— no QR scan, no printing.

### 3. QR scan slide

"Отсканируйте QR-код в кабинете ревизии." — reuses the existing
camera+jsQR scanning code (`startQrScan`/`scanQrFrame`, the same
infrastructure `screenStickerScan` already uses), but with different
validation: exact match against the fixed string `WMSP.PLCE.WSHK.FLR`
(not the sticker code's `"*"`-prefix check). A non-matching scan shows an
inline error and keeps scanning, same UX as the sticker scanner today.

### 4. Fetch box + contents

On a successful scan:

1. `select id, box_number, box_type from wms_no_shk_boxes where area=?, shift_date=?, shift_type=?, outside_opp=true limit 1` — same filter shape the live counter already uses (B.5), using the values captured in step 2.
2. `wms_no_shk_box_contents(box_id)` → rows of `{item_text, category, item_type, full_name, created_at, photo_path}`.
3. Partition: rows with `item_type = 'КГТ'` each get their own sticker (step 5b); every other row just contributes to the single box sticker already covered by step 5a (the box template doesn't enumerate contents, so no per-row action needed for them).

### 5. Print jobs

**a) One box sticker** — existing `"Короб «Без ШК»"` template, same data
shape `no_shk_zone.js`'s `printActiveBox` already builds (`box_code`,
`box_number`, `shift`, `date_line1/2`, `area`, `box_type`). Always
printed if a box exists (per step 2's gate).

**b) One sticker per КГТ row** — new template `"КГТ «Без ШК»"` (see
below), `data = { name: item_text, area, date_line1, date_line2 }`.

All rows inserted into `print_jobs` up front; the screen subscribes to
`postgres_changes` UPDATE per job id (same pattern as
`printActiveBox`/`print_test.js`) and shows live progress, e.g. "Короб ✓
· печатаю КГТ 2 из 3…".

### 6. Completion

- **All jobs `printed`** → `wms_no_shk_boxes.update({ outside_opp: false })` on that box id (identical effect to admin's "Принесено"), success screen, return to `screenEntryType`.
- **Any job `failed`** → do **not** flip `outside_opp`; show "Ошибка печати: …" with the failed job's `error_message`, and let the worker press "Закрыть коробку" again to retry.
  - Accepted trade-off: a retry re-runs steps 3-5 from scratch, so a sticker that already printed successfully before the failure will print again (duplicate label). Given failures are rare and someone is standing at the printer watching, this is acceptable — no partial-retry bookkeeping in this phase.

## New print template: "КГТ «Без ШК»"

50×50mm, seeded via a new migration (mirroring how `"Короб «Без ШК»"` was
seeded in `202609020003_no_shk_box_fields_and_label_template.sql` and
tuned in later migrations). Starting layout — adjustable afterward via
`print_templates_admin.html`, no migration needed for further tweaks:

```json
[
  {"type":"text","field":"name","x_mm":5,"y_mm":5,"font_size":14},
  {"type":"text","field":"date_line1","x_mm":5,"y_mm":28,"font_size":20},
  {"type":"text","field":"date_line2","x_mm":5,"y_mm":36,"font_size":20},
  {"type":"text","field":"area","x_mm":5,"y_mm":44,"font_size":10}
]
```

## Out of scope

- Night-shift equivalent closing trigger (only the 19:30 day-shift button
  requested).
- Closing across multiple areas in one action — always just the current
  form's `area` (per decision; matches how the counter itself is already
  scoped).
- Partial retry of only the failed sticker(s) after a print error (see
  step 6's accepted trade-off).
- Any change to the existing admin "Принесено" button — it keeps working
  exactly as it does today, as an alternate manual path to the same
  `outside_opp = false` state.
