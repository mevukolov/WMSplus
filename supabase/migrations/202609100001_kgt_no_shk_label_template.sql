-- 202609100001_kgt_no_shk_label_template.sql
-- Seeds the "КГТ «Без ШК»" sticker template used by the shift-box closing
-- flow (docs/superpowers/specs/2026-09-10-shift-box-closing-design.md):
-- one sticker per КГТ item recorded that shift, carrying the item's own
-- name instead of a box number/QR (a КГТ item never goes into a box).
--
-- name prints largest (font_size 24, up from an original 14) since the
-- item's name is the one thing this sticker exists to show -- it should
-- outrank the date lines (font_size 20) in prominence, not trail them.
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
        {"type":"text","field":"date_line1","x_mm":5,"y_mm":28,"font_size":20},
        {"type":"text","field":"date_line2","x_mm":5,"y_mm":36,"font_size":20},
        {"type":"text","field":"area","x_mm":5,"y_mm":44,"font_size":10}
    ]'::jsonb
where not exists (
    select 1 from public.print_label_templates where name = 'КГТ «Без ШК»'
);
