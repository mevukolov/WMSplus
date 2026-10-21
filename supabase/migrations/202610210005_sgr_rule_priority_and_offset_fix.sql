-- Правило "SGR" (Упаковка) было создано с приоритетом 22 -- после
-- общей ловушки "Упаковка (по умолчанию -- не RWP)" на приоритете 20,
-- которая матчит вообще всё -- SGR-правило было мертво, никогда не
-- срабатывало. Пытались просто поставить приоритет 10 -- упёрлись в
-- глобальный unique index (output_key, priority): диапазон 1-20 весь
-- занят другими форматами (global, не per-формат, как ошибочно
-- объяснялось пользователю раньше). Сдвигаем обе ловушки (Упаковка,
-- Без заказа) на +1, ставим SGR на освободившееся место 20 -- перед
-- ловушкой Упаковки. Заодно выравниваем срок разбора в словаре
-- (packaging, SGR) с правилом -- было 5 (расходилось с -7 в правиле),
-- пользователь подтвердил -7 как верное значение.
-- Проверено: wms_evaluate_rule_batch('zone','packaging', [{status:SGR}])
-- теперь возвращает правило SGR (не ловушку), upload_offset_days=-7,
-- task_deadline_days=5.
update public.wms_routing_rules set priority = 1000 where id = '3995e91f-be07-40b6-aaba-05a4b1a772af';
update public.wms_routing_rules set priority = 22 where id = (select id from public.wms_routing_rules where output_key = 'zone' and priority = 21);
update public.wms_routing_rules set priority = 21 where id = (select id from public.wms_routing_rules where output_key = 'zone' and priority = 20);
update public.wms_routing_rules set priority = 20 where id = '3995e91f-be07-40b6-aaba-05a4b1a772af';
update public.wms_status_dictionary set default_upload_offset_days = -7 where source_format = 'packaging' and status_code = 'SGR';
