-- 202609100001_kgt_no_shk_label_template.sql
-- Seeds the "КГТ «Без ШК»" sticker template used by the shift-box closing
-- flow (docs/superpowers/specs/2026-09-10-shift-box-closing-design.md):
-- one sticker per КГТ item recorded that shift, carrying the item's own
-- name instead of a box number/QR (a КГТ item never goes into a box).
insert into public.print_label_templates (name, width_mm, height_mm, elements) values (
    'КГТ «Без ШК»',
    50,
    50,
    '[
        {"type":"text","field":"name","x_mm":5,"y_mm":5,"font_size":14},
        {"type":"text","field":"date_line1","x_mm":5,"y_mm":28,"font_size":20},
        {"type":"text","field":"date_line2","x_mm":5,"y_mm":36,"font_size":20},
        {"type":"text","field":"area","x_mm":5,"y_mm":44,"font_size":10}
    ]'::jsonb
);
