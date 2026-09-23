-- 202609100001_kgt_no_shk_label_template.sql
-- Seeds the "КГТ «Без ШК»" sticker template used by the shift-box closing
-- flow (docs/superpowers/specs/2026-09-10-shift-box-closing-design.md):
-- one sticker per КГТ item recorded that shift, carrying the item's own
-- name instead of a box number/QR (a КГТ item never goes into a box).
--
-- name prints larger than the date lines (font_size 24 vs 14) so the
-- item's name -- the one thing this sticker exists to show -- stays
-- visually most prominent. An earlier revision pushed name to font_size
-- 30 (multiplier 3) to escape a rounding collision with the date lines,
-- but that blew the name field's character budget past the label's
-- actual printable width and item names started running off the right
-- edge. Fixed properly this time by going the other way: date_line1/2
-- drop to font_size 14 (multiplier 1, was 20/multiplier 2) so name
-- (multiplier 2) is still a clear step above them without needing to be
-- oversized itself. intake.js's kgtLabelNameMaxLen() now also computes
-- the actual truncation length from this template's own x_mm/font_size/
-- width_mm at print time instead of a hardcoded character count, so this
-- class of drift (font_size changed, truncation length silently not)
-- can't happen again -- including for future edits made live via
-- print_templates_admin.html, with no code change needed.
-- y_mm nudged from 5 to 7 to keep it clear of the date lines starting at
-- y_mm 28.
--
-- insert ... select ... where not exists guards against a duplicate row:
-- print_label_templates.name has no unique constraint, and this insert
-- was not previously idempotent, so re-running this migration (or someone
-- hand-creating a same-named template) would create a second row and
-- break the .maybeSingle() lookups both intake.js and no_shk_zone.js do
-- by name.
insert into public.print_label_templates (name, width_mm, height_mm, elements)
select
    'КГТ «Без ШК»',
    50,
    50,
    '[
        {"type":"text","field":"name","x_mm":5,"y_mm":7,"font_size":24},
        {"type":"text","field":"date_line1","x_mm":5,"y_mm":28,"font_size":14},
        {"type":"text","field":"date_line2","x_mm":5,"y_mm":36,"font_size":14},
        {"type":"text","field":"area","x_mm":5,"y_mm":44,"font_size":10}
    ]'::jsonb
where not exists (
    select 1 from public.print_label_templates where name = 'КГТ «Без ШК»'
);
