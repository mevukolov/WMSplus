-- recalculate_wms_task_writeoff_dates джойнила wms_status_dictionary по
-- голому 3-буквенному коду статуса, БЕЗ учёта source_format -- если один
-- и тот же код существует в двух форматах с разными сроками (WMI уже
-- живёт в general=4 дня; SGR -- в other=20 дней), пересчёт брал MIN по
-- всем совпадениям, а не срок конкретного формата задачи. Теперь сначала
-- ищем точное совпадение (формат задачи, код статуса), и только если
-- его нет -- падаем на source_format='other' (общий фоллбэк вне формата).
-- Формат задачи выводится из wms_tasks.source_module новой функцией
-- wms_source_format_for_module -- зеркалит JS sourceFormatForModule.
-- Проверено: live-регрессия на всех активных задачах -- 0 отличий от
-- старого поведения (сегодня дублей кодов между форматами нет); синтетика
-- с двумя тестовыми задачами (general WMI и no_order WMI + временная
-- запись словаря (no_order,WMI)=10) -- каждая задача корректно получила
-- СВОЙ срок (4 и 10 дней), без смешивания.
create or replace function public.wms_source_format_for_module(p_source_module text)
returns text
language sql
immutable
as $function$
  select case
    when p_source_module in ('manual_packaging_opp', 'manual_rwp_opp') then 'packaging'
    when p_source_module = 'manual_after_sale_movement' then 'after_sale_movement'
    when p_source_module = 'manual_no_order' then 'no_order'
    when p_source_module in ('manual_general_upload', 'manual_pm_buffer', 'manual_presort_opp', 'manual_marketplace_pc', 'manual_wmi_mp_pc') then 'general'
    else 'other'
  end;
$function$;

create or replace function public.recalculate_wms_task_writeoff_dates(p_wh_id text default '50144199'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  affected_count integer := 0;
begin
  with task_items as (
    select
      t.id,
      t.source_module,
      item.value as item
    from public.wms_tasks t
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(t.source_payload->'task_items') = 'array'
          then t.source_payload->'task_items'
        else '[]'::jsonb
      end
    ) item(value)
    where coalesce(t.is_deleted, false) = false
      and coalesce(t.task_status, '') not in ('Завершено')
  ),
  candidates as (
    select
      ti.id,
      min(public.wms_writeoff_movement_date(ti.item->>'movement') + d.writeoff_days) as new_due_date
    from task_items ti
    join lateral (
      select wd.writeoff_days
      from public.wms_status_dictionary wd
      where wd.status_code = public.wms_writeoff_status_key(ti.item->>'status')
        and wd.status_code <> '*'
        and wd.is_active = true
        and wd.writeoff_days is not null
        and wd.source_format in (public.wms_source_format_for_module(ti.source_module), 'other')
      order by (wd.source_format = public.wms_source_format_for_module(ti.source_module)) desc
      limit 1
    ) d on true
    where public.wms_writeoff_movement_date(ti.item->>'movement') is not null
    group by ti.id
  )
  update public.wms_tasks t
     set due_date = c.new_due_date,
         source_payload = jsonb_set(
           jsonb_set(coalesce(t.source_payload, '{}'::jsonb), '{writeoff_date}', to_jsonb(c.new_due_date::text), true),
           '{writeoff_date_source}', to_jsonb('status_terms_recalculated'::text), true
         ),
         updated_at = timezone('utc', now())
    from candidates c
   where t.id = c.id
     and c.new_due_date is not null
     and t.due_date is distinct from c.new_due_date;

  get diagnostics affected_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'updated_count', affected_count
  );
end;
$function$;
