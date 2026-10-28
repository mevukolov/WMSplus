-- Убираем текстовую строку из этикетки генератора ШК -- пользователь
-- хочет на термоэтикетке только QR, без дублирующего значения текстом.
update public.print_label_templates
set elements = '[
    {"type": "qr", "field": "shk", "x_mm": 10, "y_mm": 10, "width_mm": 30}
]'::jsonb,
    updated_at = timezone('utc', now())
where name = 'Генератор ШК';
