-- Bug found via user report: after auto_reopen_wms_tasks() flips a task back
-- to 'Не начато', opp_verdict and source_payload.wms_review (comment,
-- verdict, extra_value, completed_by_*) were never cleared. Since the
-- compose form derives its pre-filled verdict/comment from exactly those
-- fields, a reopened task's card looked like a verdict had already been
-- picked for the *new* cycle, when it was actually leftover from the
-- previous (already-recorded-in-history) completion.
--
-- The old completion is safely preserved in wms_task_history (written at
-- completion time as an independent payload snapshot), so it's safe to
-- reset these fields on the task row itself.
create or replace function public.auto_reopen_wms_tasks()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reopened_ids uuid[];
  v_count integer := 0;
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
        opp_verdict = 'Не выбран',
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

  return jsonb_build_object('ok', true, 'reopened_count', v_count);
end;
$$;
