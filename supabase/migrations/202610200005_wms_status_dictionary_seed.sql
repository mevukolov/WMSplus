-- Сид словаря статусов из текущих живых правил wms_routing_rules и
-- wms_writeoff_terms. Эвристика default_task_type -- правило с
-- НАИМЕНЬШИМ числом условий для этого статуса (самое общее / без
-- спец-условий по MX). Не обязан быть идеальным -- экран админки
-- (Task 4) даёт поправить руками до переключения классификации (этап 2).
--
-- target_task_type в правилах хранит КОРОТКИЕ/промежуточные имена
-- ("ПМ", "Другие задачи"), не полный task_type -- канонизация ниже
-- зеркалит уже проверенную сегодня JS-логику
-- (GENERAL_ZONE_TASK_TYPE_BY_RULE_TARGET/ZONE_TASK_TYPE_BY_RULE_TARGET
-- в tasks.js и zoneTaskTypeMap["usd_in_other"/"tmm_in_other"] в
-- buildNoOrderPreview). "Другие задачи" у no_order -- общее
-- промежуточное имя для ДВУХ разных правил (USD и TMM), различаются
-- только по значению самого статуса, не по target_task_type.
with rule_statuses as (
    select
        r.id as rule_id,
        r.source_format,
        r.target_task_type,
        r.upload_offset_days,
        jsonb_array_length(r.conditions) as condition_count,
        status_value
    from public.wms_routing_rules r,
         jsonb_array_elements_text(
             case
                 when r.conditions->0->>'attribute' = 'status' and r.conditions->0->>'operator' = 'in'
                 then r.conditions->0->'value'
                 else '[]'::jsonb
             end
         ) as status_value
    where r.is_active = true and r.output_key = 'zone'
),
ranked as (
    select *, row_number() over (
        partition by source_format, status_value
        order by condition_count asc, upload_offset_days desc
    ) as rn
    from rule_statuses
),
canonical as (
    select
        source_format,
        status_value,
        case
            when source_format = 'no_order' and status_value = 'USD' then 'Разбор ОПП // USD'
            when source_format = 'no_order' and status_value = 'TMM' then 'Разбор ОПП // TMM'
            when target_task_type = 'Другие задачи' then 'Разбор ОПП // Оклейка'
            when target_task_type like 'Разбор ОПП // %' then target_task_type
            else 'Разбор ОПП // ' || target_task_type
        end as default_task_type,
        upload_offset_days
    from ranked
    where rn = 1
),
catch_all as (
    select distinct source_format
    from public.wms_routing_rules
    where is_active = true and output_key = 'zone'
      and conditions = jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'not_contains', 'value', '__никогда_не_встретится__'))
    union
    select 'packaging'
    where exists (
        select 1 from public.wms_routing_rules
        where is_active = true and output_key = 'zone' and source_format = 'packaging'
          and conditions = jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'not_contains', 'value', 'RWP'))
    )
)
insert into public.wms_status_dictionary (source_format, status_code, default_task_type, default_upload_offset_days)
select source_format, status_value, default_task_type, upload_offset_days
from canonical
union all
select source_format,
       '*',
       case source_format
           when 'no_order' then 'Разбор ОПП // Без заказа'
           when 'packaging' then 'Разбор ОПП // Упаковка'
           when 'after_sale_movement' then 'Разбор ОПП // Движение после продажи'
           else null
       end,
       0
from catch_all
on conflict (source_format, status_code) do nothing;

-- Оверлей сроков списания/названий из wms_writeoff_terms (не
-- привязаны к отчёту сегодня -- применяем ко всем форматам, где уже
-- есть строка с таким status_code).
update public.wms_status_dictionary d
set writeoff_days = t.days_without_movement,
    label = coalesce(nullif(t.label, ''), d.label)
from public.wms_writeoff_terms t
where t.term_type = 'status'
  and t.is_active = true
  and d.status_code = t.term_key;
