-- 202609020003_no_shk_box_fields_and_label_template.sql
-- Boxes in the "Без ШК" zone now carry the fields needed to identify and
-- label them physically: which shift/date brought them in, what kind of
-- item, which area, who brought it. Values are stored as the exact
-- Russian display strings (matching this app's existing convention, e.g.
-- responsibility_zone) rather than an enum code.
alter table public.wms_no_shk_boxes
    add column shift_date date not null default current_date,
    add column shift_type text not null default 'Дневная' check (shift_type in ('Дневная', 'Ночная')),
    add column box_type text not null default 'Короб' check (box_type in ('Короб', 'КГТ')),
    add column area text not null default 'Сортировка' check (area in ('Сортировка', 'Переупаковка')),
    add column responsible_name text not null default '';

-- Seed the box label template so printing a box's sticker (no_shk_zone.js)
-- can reuse the existing print_label_templates -> print_jobs pipeline
-- (print-tspl.js / print-bridge) exactly like any other template, and the
-- layout stays editable later via the visual template editor without a
-- code change. Field names here (box_code/box_number/date_label/area/
-- box_type) are what no_shk_zone.js fills in when printing.
insert into public.print_label_templates (name, width_mm, height_mm, elements) values (
    'Короб «Без ШК»',
    50,
    50,
    '[
        {"type":"qr","field":"box_code","x_mm":5,"y_mm":5,"width_mm":20},
        {"type":"text","field":"box_number","x_mm":30,"y_mm":5,"font_size":16},
        {"type":"text","field":"date_label","x_mm":5,"y_mm":28,"font_size":26},
        {"type":"text","field":"area","x_mm":5,"y_mm":40,"font_size":10},
        {"type":"text","field":"box_type","x_mm":30,"y_mm":40,"font_size":10}
    ]'::jsonb
);
