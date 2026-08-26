-- Part B1: harden wms_tasks.task_status and make deferred-task reopening real.
--
-- Until now, isWaitingReopenTask()/isReopenedTask() in tasks.js only faked
-- auto-reopen on the client: task_status stayed 'Отложено' in the DB forever,
-- reopen_after never got cleared, and no wms_task_history row was written.
-- This migration adds a real CHECK constraint on task_status and a cron-driven
-- RPC that actually flips the status once reopen_after has passed.

-- 1) Lock task_status down to the 4 literals the app already uses everywhere.
alter table public.wms_tasks
    add constraint wms_tasks_task_status_check
    check (task_status in ('Не начато', 'В работе', 'Отложено', 'Завершено'));

-- 2) Auto-reopen RPC: any 'Отложено' row whose reopen_after has passed goes
-- back to 'Не начато', reopen_after is cleared, reopened_at is stamped, and a
-- wms_task_history row records the transition so the activity feed and
-- Пульс смены stats see it without needing client-side faking.
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
        reopen_after = null,
        reopened_at = now(),
        updated_at = now()
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

grant execute on function public.auto_reopen_wms_tasks() to anon, authenticated, service_role;

comment on function public.auto_reopen_wms_tasks() is
  'Flips wms_tasks rows from Отложено back to Не начато once reopen_after has passed; writes a task_auto_reopened row to wms_task_history for each. Scheduled via pg_cron every 5 minutes.';

-- 3) Schedule it. cron.schedule() upserts by job name on pg_cron >= 1.4, so
-- this is safe to re-run.
select cron.schedule(
  'wms-auto-reopen-tasks-5m',
  '*/5 * * * *',
  $$select public.auto_reopen_wms_tasks();$$
);
