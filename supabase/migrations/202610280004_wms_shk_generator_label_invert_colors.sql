-- Эта этикетка должна печататься чёрным QR на белом фоне -- наоборот,
-- чем все остальные термоэтикетки ("Без ШК"), которые печатают
-- белым на чёрном и пользователя это устраивает. Полярность теперь
-- переключается per-element флагом invert (print-tspl.js), здесь
-- включаем его только для этого шаблона.
update public.print_label_templates
set elements = '[
    {"type": "qr", "field": "shk", "x_mm": 10, "y_mm": 10, "width_mm": 30, "invert": true}
]'::jsonb,
    updated_at = timezone('utc', now())
where name = 'Генератор ШК';
