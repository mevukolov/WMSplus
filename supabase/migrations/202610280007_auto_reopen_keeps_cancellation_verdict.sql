-- При переоткрытии auto_reopen_wms_tasks() всегда сбрасывал opp_verdict
-- на "Не выбран" -- для обычных отложенных вердиктов это правильно
-- (оператор должен решить заново), но для "Аннулирование после
-- списания" (папка в "Задачах", см. requestSectionName в tasks.js)
-- это ломает саму папку: переоткрытая задача тут же теряет вердикт и
-- возвращается в обычный Предразбор вместо того, чтобы остаться в
-- своей папке. Для этого одного вердикта сохраняем opp_verdict при
-- переоткрытии; для всех остальных поведение не меняется.
create or replace function public.auto_reopen_wms_tasks()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_reopened_ids uuid[];
  v_count integer := 0;
  v_reopened_item_tasks uuid[];
  v_reopened_item_shks text[];
  v_reopened_items integer := 0;
begin
  with due as (
    select id
    from public.wms_tasks
    where task_status = 'Отложено'
      and reopen_after is not null
      and reopen_after <= now()
    for update skip locked
  ),
  updated as (
    update public.wms_tasks t
    set task_status = 'Не начато',
        opp_verdict = case when t.opp_verdict = 'Аннулирование после списания' then t.opp_verdict else 'Не выбран' end,
        reopen_after = null,
        reopened_at = now(),
        updated_at = now(),
        source_payload = coalesce(t.source_payload, '{}'::jsonb) || jsonb_build_object('wms_review', '{}'::jsonb)
    from due
    where t.id = due.id
    returning t.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_reopened_ids from updated;

  v_count := array_length(v_reopened_ids, 1);
  if v_count is null then v_count := 0; end if;

  if v_count > 0 then
    insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload)
    select id, 'task_auto_reopened', null, null, '{}'::jsonb
    from unnest(v_reopened_ids) as id;
  end if;

  with due_items as (
    select task_id, shk
    from public.wms_task_items
    where task_status = 'Отложено'
      and reopen_after is not null
      and reopen_after <= now()
    for update skip locked
  ),
  updated_items as (
    update public.wms_task_items i
    set task_status = 'Не начато',
        opp_verdict = case when i.opp_verdict = 'Аннулирование после списания' then i.opp_verdict else 'Не выбран' end,
        reopen_after = null,
        updated_at = now()
    from due_items
    where i.task_id = due_items.task_id and i.shk = due_items.shk
    returning i.task_id, i.shk
  )
  select coalesce(array_agg(task_id), '{}'::uuid[]), coalesce(array_agg(shk), '{}'::text[])
  into v_reopened_item_tasks, v_reopened_item_shks
  from updated_items;

  v_reopened_items := coalesce(array_length(v_reopened_item_tasks, 1), 0);

  if v_reopened_items > 0 then
    insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload)
    select v_reopened_item_tasks[i], 'task_item_auto_reopened', null, null, jsonb_build_object('shk', v_reopened_item_shks[i])
    from generate_subscripts(v_reopened_item_tasks, 1) as i;
  end if;

  return jsonb_build_object('ok', true, 'reopened_count', v_count, 'reopened_item_count', v_reopened_items);
end;
$$;
