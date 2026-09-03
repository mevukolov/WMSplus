-- 202609020005_no_shk_box_label_redesign.sql
-- Redesign the "Короб «Без ШК»" label to match a reference mockup: rotated
-- vertical area/shift labels top-left, box number + QR top-right, a
-- decorative cross bottom-left, and a large two-line date bottom-right.
-- Field names here (area_label/shift_label/date_line1/date_line2) are what
-- no_shk_zone.js fills in when printing -- box_code/box_number unchanged.
update public.print_label_templates
set elements = '[
    {"type":"qr","field":"box_code","x_mm":25,"y_mm":3,"width_mm":20},
    {"type":"text","field":"box_number","x_mm":25,"y_mm":24,"font_size":11},
    {"type":"text","field":"box_type","x_mm":25,"y_mm":31,"font_size":8},
    {"type":"text","field":"area_label","x_mm":4,"y_mm":46,"font_size":13,"rotation":90},
    {"type":"text","field":"shift_label","x_mm":13,"y_mm":46,"font_size":13,"rotation":90},
    {"type":"cross","x_mm":3,"y_mm":26,"size_mm":13,"thickness_mm":4},
    {"type":"text","field":"date_line1","x_mm":24,"y_mm":32,"font_size":26},
    {"type":"text","field":"date_line2","x_mm":24,"y_mm":40,"font_size":26}
]'::jsonb,
    updated_at = now()
where name = 'Короб «Без ШК»';
