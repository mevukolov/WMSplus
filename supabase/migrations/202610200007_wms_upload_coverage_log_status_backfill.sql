-- Бэкофилл из wms_task_items.status (не из окна рана -- та ошибка уже
-- стоила отдельного фикса сегодня, см. 202610200003). status на
-- КОНКРЕТНОМ item'е -- источник истины по которому статусу принадлежит
-- строка, а дата -- с родительской задачи (upload_effective_date).
-- rule_key: если для (source_format статуса, статус) есть РОВНО одно
-- активное zone-правило -- его id; если правил несколько или их
-- вообще нет -- '__default__' (упрощение бэкофилла: различать, КАКОЕ
-- именно из нескольких правил обработало конкретный item, по
-- историческим данным не всегда однозначно -- '__default__' в этом
-- случае безопасная недооценка покрытия, не переоценка).
--
-- catch-all зоны (Упаковка/Без заказа/Движение после продажи) в
-- словаре -- строка status_code='*', но РЕАЛЬНЫЙ статус item'а в этой
-- зоне почти никогда буквально не равен '*' (это условный код "всё,
-- что не поймали более узкие правила", см. спеку). Если task_type
-- item'а -- это ИМЕННО catch-all-таргет своего формата, статус в
-- журнале пишем как '*', а не как реальный 3-буквенный код item'а --
-- иначе проверка exists() ниже (scoped на дословные статусы словаря)
-- просто не нашла бы для них совпадения, и catch-all-зоны остались бы
-- без бэкофилла вовсе (так и было до этого фикса -- живой тест
-- показал 0 строк для Упаковка/Без заказа/Движение после продажи).
with item_status as (
    select
        t.upload_effective_date as business_date,
        t.task_type,
        upper((regexp_match(ti.status, '[A-Za-z]{3}'))[1]) as raw_status_code
    from public.wms_task_items ti
    join public.wms_tasks t on t.id = ti.task_id
    where t.upload_effective_date is not null and ti.status is not null
),
with_format as (
    select
        business_date,
        case
            when task_type in ('Разбор ОПП // Упаковка', 'Разбор ОПП // RWP') then 'packaging'
            when task_type in ('Разбор ОПП // Без заказа', 'Разбор ОПП // USD', 'Разбор ОПП // TMM') then 'no_order'
            when task_type = 'Разбор ОПП // Движение после продажи' then 'after_sale_movement'
            else 'general'
        end as source_format,
        case
            when task_type in ('Разбор ОПП // Упаковка', 'Разбор ОПП // Без заказа', 'Разбор ОПП // Движение после продажи') then '*'
            else raw_status_code
        end as status_code
    from item_status
    where raw_status_code is not null
),
rule_counts as (
    select source_format, status_value, count(*) as n, max(id::text) as single_rule_id
    from public.wms_routing_rules r,
         jsonb_array_elements_text(
             case when r.conditions->0->>'attribute' = 'status' and r.conditions->0->>'operator' = 'in'
                  then r.conditions->0->'value' else '[]'::jsonb end
         ) as status_value
    where r.is_active = true and r.output_key = 'zone'
    group by source_format, status_value
)
insert into public.wms_upload_coverage_log (business_date, source_format, status_code, rule_key, checked_at)
select distinct
    w.business_date,
    w.source_format,
    w.status_code,
    coalesce((select single_rule_id from rule_counts rc where rc.source_format = w.source_format and rc.status_value = w.status_code and rc.n = 1), '__default__'),
    timezone('utc', now())
from with_format w
-- scoped на статусы, которые реально относятся к одному из 4 форматов
-- этой фичи (см. риск у Task 13 в плане) -- только те, что есть в
-- словаре (явно семплированы из wms_routing_rules + явный '*' для
-- catch-all), иначе статусы из других контуров (Чистые списания и
-- т.п.) тоже попали бы в журнал покрытия и портили бы расчёт
-- "обязательных статусов формата".
where exists (
    select 1 from public.wms_status_dictionary d
    where d.source_format = w.source_format and d.status_code = w.status_code and d.is_active = true
)
on conflict (business_date, source_format, status_code, rule_key) do nothing;
