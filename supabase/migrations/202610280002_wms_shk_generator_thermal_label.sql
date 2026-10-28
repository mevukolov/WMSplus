-- Шаблон термоэтикетки для генератора ШК (shk_generator.html/js, кнопка
-- "Печать термоэтикетки") -- QR сгенерированного ШК + он же человекочитаемым
-- текстом ниже, по образцу уже существующих шаблонов "Короб/Полка «Без ШК»".
insert into public.print_label_templates (name, width_mm, height_mm, elements)
values (
    'Генератор ШК',
    50,
    50,
    '[
        {"type": "qr", "field": "shk", "x_mm": 10, "y_mm": 5, "width_mm": 30},
        {"type": "text", "field": "shk", "x_mm": 2, "y_mm": 40, "font_size": 10, "wrap_width_mm": 46, "max_lines": 2}
    ]'::jsonb
);
