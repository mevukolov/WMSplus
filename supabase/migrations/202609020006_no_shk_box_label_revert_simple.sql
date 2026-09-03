-- 202609020006_no_shk_box_label_revert_simple.sql
-- The rotated/cross mockup layout (202609020005) printed crooked on the
-- real DA220 -- revert to the earlier plain layout. Keep one real fix from
-- it: the date is two separate lines (date_line1/date_line2) instead of a
-- single "ДД.ММ.ГГ-ДД.ММ.ГГ" string, which was wide enough to run off the
-- label's right edge for a night shift. Day shift leaves date_line2 empty.
update public.print_label_templates
set elements = '[
    {"type":"qr","field":"box_code","x_mm":5,"y_mm":5,"width_mm":20},
    {"type":"text","field":"box_number","x_mm":30,"y_mm":5,"font_size":16},
    {"type":"text","field":"date_line1","x_mm":5,"y_mm":28,"font_size":20},
    {"type":"text","field":"date_line2","x_mm":5,"y_mm":36,"font_size":20},
    {"type":"text","field":"area","x_mm":5,"y_mm":44,"font_size":10},
    {"type":"text","field":"box_type","x_mm":30,"y_mm":44,"font_size":10}
]'::jsonb,
    updated_at = now()
where name = 'Короб «Без ШК»';
