-- Фикс бэкофилла 202610200007: для статуса с НЕСКОЛЬКИМИ активными
-- правилами бэкофилл писал одну запись с rule_key='__default__' (не
-- мог по историческим данным определить, какое именно правило
-- обработало каждый item). Но живой requiredStatusUnitsForModule
-- (tasks.js) для такого статуса требует запись на КАЖДОЕ его активное
-- правило отдельно (вариант 2 спеки) -- '__default__' не совпадает ни
-- с одним из них, и день выглядит "не покрыт", хотя данные реально
-- есть. Подтверждено живой симуляцией dayCoveredForModule: 16-18.10
-- общего формата ошибочно показывали непокрытыми через SMS/SWT/PWT/
-- GWS/WMI -- у всех пяти по 2-3 активных правила.
--
-- Решение: для каждой уже забэкофилленной записи вида (date, format,
-- status, '__default__'), где у статуса этого формата СЕГОДНЯ 2+
-- активных zone-правил, добавляем по записи на каждое правило вместо
-- неё (небольшая намеренная неточность для истории -- не можем знать,
-- какое правило сработало ИМЕННО тогда, принимаем "все подходящие"
-- как покрытые; для новых выгрузок вперёд logUploadCoverage уже пишет
-- точно, см. Task 11). Старые '__default__' строки для этих статусов
-- удаляются отдельным statement'ом (CTE не переживает границу
-- statement'а в одном файле), чтобы не плодить лишний недостижимый
-- rule_key.
with multi_rule_statuses as (
    select source_format, status_value, array_agg(id::text) as rule_ids
    from public.wms_routing_rules r,
         jsonb_array_elements_text(
             case when r.conditions->0->>'attribute' = 'status' and r.conditions->0->>'operator' = 'in'
                  then r.conditions->0->'value' else '[]'::jsonb end
         ) as status_value
    where r.is_active = true and r.output_key = 'zone'
    group by source_format, status_value
    having count(*) > 1
),
to_expand as (
    select l.business_date, l.source_format, l.status_code, m.rule_ids
    from public.wms_upload_coverage_log l
    join multi_rule_statuses m on m.source_format = l.source_format and m.status_value = l.status_code
    where l.rule_key = '__default__'
)
insert into public.wms_upload_coverage_log (business_date, source_format, status_code, rule_key, checked_at)
select business_date, source_format, status_code, rule_id, timezone('utc', now())
from to_expand, unnest(rule_ids) as rule_id
on conflict (business_date, source_format, status_code, rule_key) do nothing;

with multi_rule_statuses as (
    select source_format, status_value
    from public.wms_routing_rules r,
         jsonb_array_elements_text(
             case when r.conditions->0->>'attribute' = 'status' and r.conditions->0->>'operator' = 'in'
                  then r.conditions->0->'value' else '[]'::jsonb end
         ) as status_value
    where r.is_active = true and r.output_key = 'zone'
    group by source_format, status_value
    having count(*) > 1
)
delete from public.wms_upload_coverage_log l
using multi_rule_statuses m
where l.source_format = m.source_format and l.status_code = m.status_value and l.rule_key = '__default__';
