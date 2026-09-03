-- 202609020008_no_shk_box_label_add_shift.sql
-- Add the shift (День/Ночь) to the box label, next to the box number.
update public.print_label_templates
set elements = '[
    {"type":"qr","field":"box_code","x_mm":5,"y_mm":5,"width_mm":20},
    {"type":"text","field":"box_number","x_mm":30,"y_mm":5,"font_size":14},
    {"type":"text","field":"shift","x_mm":30,"y_mm":13,"font_size":10},
    {"type":"text","field":"date_line1","x_mm":5,"y_mm":28,"font_size":20},
    {"type":"text","field":"date_line2","x_mm":5,"y_mm":36,"font_size":20},
    {"type":"text","field":"area","x_mm":5,"y_mm":44,"font_size":10},
    {"type":"text","field":"box_type","x_mm":30,"y_mm":44,"font_size":10}
]'::jsonb,
    updated_at = now()
where name = 'Короб «Без ШК»';
