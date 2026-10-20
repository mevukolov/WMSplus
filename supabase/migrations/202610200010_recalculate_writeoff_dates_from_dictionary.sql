-- recalculate_wms_task_writeoff_dates джойнила напрямую на
-- wms_writeoff_terms -- обнаружено перед Task 13 (удаление этой
-- таблицы) живым аудитом всех SQL-функций, ссылающихся на неё
-- (единственная). Источник переключается на wms_status_dictionary
-- (словарь уже проверен на 82/82 паритет сроков списания со старой
-- таблицей, см. коммит 3b76c1a). wh_id-фильтр убран -- у словаря нет
-- этой колонки (система работает с одним складом, p_wh_id остаётся
-- параметром функции только для обратной совместимости сигнатуры).
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
    join public.wms_status_dictionary d
      on d.status_code = public.wms_writeoff_status_key(ti.item->>'status')
     and d.status_code <> '*'
     and d.is_active = true
     and d.writeoff_days is not null
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
