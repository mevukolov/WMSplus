# Intake Form: Processing Instructions & Shift Boxes — Design

## Overview

Two connected features on top of the existing public intake form
(`wmsplus-intake-form`, site `https://wmsplus.github.io/`) and the "Без ШК"
storage zone (`no_shk_zone.js` in this repo, `WMSplus-main`):

1. **Processing instructions**: for items that need a physical sticker
   scanned before they can be handed off (Шредер, leaking household
   chemicals, anything entered on the Упаковка area), show a slide-by-slide
   TSD (ТСД) processing guide after the sticker scan, instead of going
   straight to the success screen.
2. **Shift storage addressing**: every item that does *not* need a sticker
   gets counted into a per-area, per-shift "box" that appears in the
   existing "Без ШК" zone as a new "Вне ОПП" state, with a live counter on
   the intake form and an automatically-computed responsible person. Items
   that *do* need a sticker are tagged into one of three named buckets
   instead, purely for future accounting — no new UI for those buckets in
   this phase.

Both features live entirely inside the "Товар без ШК" entry-type branch of
the intake form. The "2 ШК на товаре" and "Пустая упаковка" branches
(writing to `2shk_rep`) are untouched by this spec.

Both repos share one Supabase project (`bgphllmzmlwurfnbagho`), so the
public form can write directly into the same tables the "Без ШК" zone
admin UI reads — no bridge or sync process needed.

## Global Constraints

- No build step in either repo. New browser dependencies load via CDN
  `<script>` tag, same pattern as `@supabase/supabase-js@2` and `jsQR`.
- `data-*` attribute selectors for all new interactive elements (project
  convention — see prior specs).
- New/changed SQL ships as migrations under
  `WMSplus-main/supabase/migrations/`, named `YYYYMMDDNNNN_<slug>.sql`,
  even though the tables they touch are queried from the separate
  `wmsplus-intake-form` repo.
- `node --check` on every touched `.js` file.
- Live browser verification (this repo's static preview server / the
  intake form's own pages) for anything UI-facing.
- Preserve the existing privacy property of `intake_submissions`: the
  anonymous client may still only INSERT, never SELECT — the shift-box
  counter and responsible-person computation must not require opening
  read access to that table.

## Part A — Processing instructions

### A.1 Trigger matrix

All of this applies only inside "Товар без ШК". Priority order when more
than one trigger is true for the same item: **Шредер > Бытовая химия
льётся > участок Упаковка**.

| Condition | Sticker scan? | Instructions? | QR code pair | `no_shk_bucket` |
|---|---|---|---|---|
| `item_type = 'Шредер'` (any area) | yes (existing `screenStickerScan`) | yes | area's pair (see A.2) | `Шредер` |
| `category = 'Бытовая химия'` and "Товар льётся" pressed, area ≠ Маркетплейс | yes | yes | area's pair | `Брак Бытовая химия` |
| `area = 'Упаковка'`, anything else (any item_type/category not already covered above) | yes | yes | Упаковка pair | `Товар с переупаковки` |
| `category = 'Бытовая химия'`, "Товар льётся" **not** pressed | no | no | — | `Короб смены` (goes through the normal shift-box path, Part B) |
| `area = 'Маркетплейс'` and (`item_type = 'Шредер'` OR "Товар льётся" pressed) | no | no (special screen instead, A.4) | — | nothing saved at all |
| Everything else | no | no | — | `Короб смены` |

### A.2 QR code pairs by area

| Area | МХ Стола руководителя (QR "PLCE...") | Тара переупаковки (QR "WCT...") |
|---|---|---|
| ХАБ | `PLCE1034816435` | `WCT1000100010` |
| Упаковка | `PLCE1034816436` | `WCT700100010` |

(Маркетплейс never reaches the instruction screens — see A.4.)

### A.3 Screen flow

Sticker scan (`screenStickerScan`) succeeds exactly as it does today —
`finalizeSubmit` still fires immediately after a successful scan, saving
the row to `intake_submissions` with `sticker_code` set. **After** that
save succeeds, instead of jumping straight to `screenSuccess`, show a new
screen:

**`screenStickerSaved`** — "Стикер сохранён", body text: "Теперь
необходимо обработать товар через ТСД.", two buttons:
`data-instr-choice="full"` **Инструкция** and `data-instr-choice="skip"`
**Пропустить**.

Both choices lead into a shared slide sequence, one `.screen` per slide,
each with **Назад**/**Далее** and a step indicator ("Шаг N из M"). Slide
content is a plain instance of the reusable `.screen` show/hide mechanism
already used across the wizard (see `showScreen` in `intake.js`) — no new
CSS animation architecture needed, reuse what Task 1 already built.

**Полная инструкция (10 слайдов, `data-instr-choice="full"`):**

1. Войдите в ТСД под своим бейджиком.
2. Перейдите в модуль «Стол старшего».
3. Перейдите в процесс «Стол старшего».
4. Отсканируйте МХ Стола руководителя. *(renders QR for the area's PLCE
   code)*
5. Отсканируйте тару ПЕРЕУПАКОВКИ, если нужно. *(renders QR for the
   area's WCT code)*
6. Не сканируйте тару сортировки, нажмите «Пропустить».
7. Далее в интерфейсе нажмите «Нет стикера», затем «Нет баркода», затем
   «Нет акциза».
8. Далее необходимо отсканировать приклеенный ранее на вещь стикер.
9. Отсканируйте тару ПЕРЕУПАКОВКИ. *(renders QR for the area's WCT code,
   same value as step 5)*
10. Отнесите товар на Идентификацию.

**Короткая инструкция (4 слайда, `data-instr-choice="skip"`):**

1. Отсканируйте МХ Стола руководителя. *(QR, area's PLCE code)*
2. Отсканируйте тару ПЕРЕУПАКОВКИ, если нужно. *(QR, area's WCT code)*
3. Отсканируйте приклеенный ранее на вещь стикер.
4. Отсканируйте тару ПЕРЕУПАКОВКИ *(QR, area's WCT code)* и передайте
   товар на переупаковку.

The final slide of **either** sequence replaces Далее with **Завершить**,
which returns to `screenEntryType` (same behavior as the existing
`againBtn` handler — reset `state.itemType`/`category`/`itemText`/
`photoPath`/`stickerCode`).

Back navigation: **Назад** on slide 1 of either sequence returns to
`screenStickerSaved`; from there, no way back into the sticker scan
(matches today's flow — once saved, saved).

### A.4 Household chemicals — "Товар льётся"

On `screenItemName`, when `state.category === 'Бытовая химия'`, render an
additional red button below the existing **Далее**:
`data-spill-btn="true"` **Товар льётся**. Name entry is still required
before this button does anything (same validation as **Далее**).

- If area ≠ Маркетплейс: pressing it validates the name exactly like
  **Далее**, sets `state.itemText`, then proceeds to `screenPhoto` with a
  flag (e.g. `state.requiresSticker = true`) so `handlePhoto` routes to
  `screenStickerScan` after upload instead of finalizing immediately —
  same branch the Шредер flow already uses in `handlePhoto`, just driven
  by this flag instead of `state.itemType === 'Шредер'`.
- If area = Маркетплейс: pressing it validates the name, then **does not
  submit anything** — shows a dedicated screen (A.5) instead of
  proceeding to photo.

When category is Бытовая химия but **Далее** (not the red button) is
pressed, behavior is unchanged from every other category: photo, then
normal `finalizeSubmit` (no sticker, no instructions) — *except* on
Упаковка, where every item already goes through the sticker+instructions
path per A.1 regardless of this button.

### A.5 Маркетплейс — "Отнесите товар на ХАБ"

New screen `screenTakeToHub`, reached when area = Маркетплейс and either:
- `item_type = 'Шредер'` is pressed on `screenItemType` (instead of
  proceeding to `screenPhoto` as normal), or
- **Товар льётся** is pressed on `screenItemName` (per A.4).

Content: "Отнесите товар на ХАБ." with a single button returning to
`screenEntryType`. Nothing is uploaded or written to any table — any
photo already picked (not applicable here, since both triggers happen
before the photo step) or name typed is simply discarded when the user
leaves this screen.

### A.6 QR rendering

Add `qrcode` (davidshimjs/qrcode.js API surface — `new QRCode(el, {text,
width, height})`) via CDN `<script>` tag in `index.html`, same loading
pattern as the existing `jsQR` tag. Each instruction slide that needs a
QR renders it into a dedicated `<div data-qr-slot>` container sized
generously enough for a TSD camera to scan comfortably (target similar
physical size to the existing sticker-scan viewfinder — implementer picks
concrete pixel dimensions during the plan, no more than the slide's
comfortable content width).

## Part B — Shift storage addressing

### B.1 What counts as "no sticker" vs "bucketed"

Directly from the A.1 matrix: any submission through the "Товар без ШК"
branch where `sticker_code` ends up `null` is a **shift-box** item.
Every submission where `sticker_code` is set is a **bucketed** item
(`Брак Бытовая химия` / `Товар с переупаковки` / `Шредер`, per A.1's
priority order). Маркетплейс's discarded Шредер/"Товар льётся" attempts
are neither — nothing is written for them at all.

### B.2 New `intake_submissions` columns

Migration adds three nullable columns (all populated by the client at
insert time for every row in the "Товар без ШК" branch; still null for
2ШК/Пустая-упаковка rows, which don't touch this table):

- `shift_date date` — the shift's calendar date, computed with the exact
  same 8:00/20:00 boundary rule `intake.js`'s existing `shiftLabel()`
  already implements for the header display (a night shift starting
  20:00 on day N belongs to `shift_date = N`).
- `shift_type text check (shift_type in ('Дневная', 'Ночная'))`.
- `no_shk_bucket text check (no_shk_bucket in ('Короб смены', 'Брак Бытовая химия', 'Товар с переупаковки', 'Шредер'))`
  — bookkeeping label only, per A.1's table. Not read by any code path in
  this phase; exists so a future admin view can query it.

### B.3 `wms_no_shk_boxes` changes

Migration on the existing table (`WMSplus-main/supabase/migrations/`,
same one `no_shk_zone.js` already reads/writes):

- Widen the `area` check constraint to also allow `'ХАБ'` and
  `'Маркетплейс'`, alongside the existing `'Сортировка'`/`'Переупаковка'`.
  Existing manually-created boxes are unaffected.
- Add `outside_opp boolean not null default false` — `true` means "Вне
  ОПП / Формируется" (the shift is still filling this box; it has not
  been physically carried into the zone yet). Every pre-existing and
  every manually-created box defaults to `false`, so today's "На полу" /
  shelved behavior in `no_shk_zone.js` is untouched.
- Add `total_items integer not null default 0` and
  `contributor_counts jsonb not null default '{}'::jsonb` (map of
  `full_name -> count`, used to (re)compute `responsible_name`).
- Partial unique index on `(area, shift_date, shift_type)` where
  `outside_opp = true`, so at most one "currently forming" box exists per
  area per shift at a time.

### B.4 Atomic increment function

A single `security definer` SQL function (new migration), callable by the
anon role via `supabaseClient.rpc(...)`:

```
wms_no_shk_box_log_item(p_area text, p_shift_date date, p_shift_type text, p_full_name text)
  returns table (box_id uuid, total_items integer)
```

Behavior, in one atomic statement/transaction:
1. `INSERT ... ON CONFLICT (area, shift_date, shift_type) WHERE outside_opp
   DO NOTHING` to create the forming box row if it doesn't exist yet
   (`responsible_name` seeded to `p_full_name`, `box_type` defaulted to
   `'Короб'`), then resolve its `id` either way.
2. Merge `p_full_name`'s count up by 1 in `contributor_counts`, increment
   `total_items` by 1.
3. Recompute `responsible_name` as the key with the highest count in the
   updated `contributor_counts` (ties broken by whichever key Postgres's
   `jsonb_each` visits first — acceptable, not worth engineering around).
4. Return the box id and new `total_items`.

`intake.js` calls this once, right after a successful shift-box
`finalizeSubmit` (i.e., whenever `sticker_code` is null in the "Товар без
ШК" branch), passing the same `shift_date`/`shift_type` just written to
the row and `state.fullName`.

This keeps `intake_submissions` itself closed to anon SELECT — the
function only ever touches `wms_no_shk_boxes`, which is already fully
open (`for all using (true)`) to every role including anon, per its
existing RLS policy.

### B.5 Live counter on the form

On every screen in the "Товар без ШК" branch **except** when
`state.area === 'Упаковка'` (which has no shift-box concept — everything
there is bucketed), show a small fixed row near the existing shift-header:
"За смену зафиксировано: N". Populated by a plain `select total_items
from wms_no_shk_boxes where area = ? and shift_date = ? and shift_type =
? and outside_opp = true` (that table is openly readable, no RPC needed
for reads) — refreshed on screen entry and immediately after each
shift-box submission's RPC call returns. Shows `0` if no forming box
exists yet for the current area/shift.

### B.6 "Без ШК" zone UI (`no_shk_zone.js`)

New section on the zone's main view, alongside the existing "На полу"
section: **"Вне ОПП"**, listing every box where `outside_opp = true`,
each tile showing the same tooltip/detail info the existing box tiles
show (date+shift label via the existing `computeDateLabel`, area,
responsible name) plus `total_items`.

Each "Вне ОПП" box gets a **"Принесено"** button (in its detail modal,
alongside the existing print/remove actions) that sets `outside_opp =
false` on that row. Once flipped, the box immediately behaves like any
other floor box (`shelf_id` is already `null`, so it falls straight into
the existing "На полу" rendering — no other code path changes).

### B.7 Out of scope for this phase

- No dedicated viewer/screen for the three virtual buckets (`Брак
  Бытовая химия` / `Товар с переупаковки` / `Шредер`) — `no_shk_bucket`
  is written correctly on every row; a future admin view can query it.
- No automatic time-based box handoff — "Принесено" is always a manual
  click (per user decision).
- No changes to `2ШК`/`Пустая упаковка` branches or `2shk_rep`.

## Open assumption flagged for review

The final step of the short ("Пропустить") instruction sequence reads
"...и передайте товар на переупаковку" per the user's final message in
this conversation (differs from an earlier draft of the same message,
which ended the *short* sequence with "...на Идентификацию" instead —
the full 10-step sequence unambiguously ends with "Отнесите товар на
Идентификацию" in both drafts). This spec uses the final wording as
authoritative. Flag if that's a typo.
