-- 202609100001_kgt_no_shk_label_template.sql
-- Seeds the "КГТ «Без ШК»" sticker template used by the shift-box closing
-- flow (docs/superpowers/specs/2026-09-10-shift-box-closing-design.md):
-- one sticker per КГТ item recorded that shift, carrying the item's own
-- name instead of a box number/QR (a КГТ item never goes into a box).
--
-- name has gone through three revisions chasing "make it fit":
--   1. font_size 14 with a hardcoded 28-char truncation in intake.js --
--      wrong from day one, 28 chars never fit at any font_size tried.
--   2/3. font_size bumped to 24 then 30 for visual prominence over the
--      date lines, which only made the overflow worse (at 30 the label
--      could fit ~6 characters, not 28).
-- Fixed properly now: print-tspl.js's textCommand gained real word-wrap
-- (wrap_width_mm/line_height_mm/max_lines on a text element), so name
-- goes back to a modest font_size 14 (same as the date lines) and wraps
-- across up to 2 lines instead of needing one oversized, truncated line.
-- wrap_width_mm 42 = 50mm label width - x_mm 5 - a 3mm right-edge margin.
-- line_height_mm 9 keeps line 2 (y 7+9=16) well clear of date_line1 at
-- y_mm 28. intake.js no longer truncates item_text itself at all -- the
-- template's own geometry now drives wrapping/truncation entirely, so
-- this can't drift out of sync again, including from a future edit made
-- live via print_templates_admin.html with no code change needed.
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
        {"type":"text","field":"name","x_mm":5,"y_mm":7,"font_size":14,"wrap_width_mm":42,"line_height_mm":9,"max_lines":2},
        {"type":"text","field":"date_line1","x_mm":5,"y_mm":28,"font_size":14},
        {"type":"text","field":"date_line2","x_mm":5,"y_mm":36,"font_size":14},
        {"type":"text","field":"area","x_mm":5,"y_mm":44,"font_size":10}
    ]'::jsonb
where not exists (
    select 1 from public.print_label_templates where name = 'КГТ «Без ШК»'
);
