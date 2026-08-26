-- Supabase pg_cron cleanup helper.
-- Run blocks one by one in SQL Editor. Start with section 1.
-- Safer default: deactivate jobs with active = false instead of deleting them.

-- 1) Inventory: all cron jobs with recent run stats.
select
  j.jobid,
  j.jobname,
  j.schedule,
  j.active,
  count(r.*) filter (where r.start_time >= now() - interval '24 hours') as runs_24h,
  count(r.*) filter (
    where r.start_time >= now() - interval '24 hours'
      and coalesce(r.status, '') not in ('succeeded', 'success')
  ) as bad_runs_24h,
  max(r.start_time) as last_start,
  max(r.end_time) as last_end,
  left(regexp_replace(j.command, '\s+', ' ', 'g'), 220) as command_preview
from cron.job j
left join cron.job_run_details r on r.jobid = j.jobid
group by j.jobid, j.jobname, j.schedule, j.active, j.command
order by j.active desc, j.jobname;

-- 2) Definitely obsolete experiments: old box/tracker/plane pipeline.
-- These were replaced by WEEEK flows and should not run in the current setup.
update cron.job
set active = false
where jobname in (
  'box-tracker-refresh-10m',
  'box-tracker-refresh-30m',
  'box-tracker-upload-10m',
  'box-plane-upload-10m',
  'box-plane-status-sync-10m',
  'box-weeek-upload-5m',
  'box-weeek-status-sync-10m'
)
or jobname ilike 'box-tracker-%'
or jobname ilike 'box-plane-%'
or jobname ilike 'box-weeek-%'
returning jobid, jobname, schedule, active;

-- 3) Duplicate WEEEK module-specific processors.
-- Keep refresh jobs if that source still matters, but avoid separate process/sync/reopen per module.
-- The generic weeek-task-master jobs can process/sync/reopen the shared weeek_tasks queue.
update cron.job
set active = false
where jobname in (
  'weeek-koledino-27lr-process-5m',
  'weeek-koledino-27lr-sync-5m',
  'weeek-task-master-process-awh-5m',
  'weeek-task-master-sync-awh-5m',
  'weeek-task-master-reopen-awh-10m',
  'weeek-task-master-process-2m',
  'weeek-task-master-status-5m'
)
returning jobid, jobname, schedule, active;

-- 4) Telegram integration removed (opp-telegram-alerts edge function deleted).
-- See scripts/cleanup_telegram_pg_cron.sql to fully unschedule the jobs that
-- used to call it, instead of just deactivating them here.

-- 5) Recommended active allowlist.
-- After cleanup, this shows active jobs that are NOT in the recommended list.
-- Review these manually; do not blindly delete them.
with recommended(jobname) as (
  values
    -- Classic WEEEK auto-sources. Keep only if these modules are still used.
    ('weeek-incoming-boxes-refresh-10m'),
    ('weeek-incoming-flow-refresh-5m'),
    ('weeek-awh-writeoffs-refresh-10m'),
    ('weeek-koledino-27lr-refresh-10m'),

    -- Generic classic WEEEK queue worker.
    ('weeek-task-master-process-5m'),
    ('weeek-task-master-sync-10m'),
    ('weeek-task-master-reopen-10m'),

    -- Generic manual/basic WEEEK queue worker.
    ('weeek-task-master-basic-process-2m'),
    ('weeek-task-master-basic-sync-10m'),
    ('weeek-task-master-basic-reopen-10m'),

    -- Rare fallback: opening a shift already assigns tails, so this does not need to be frequent.
    ('weeek-shift-assignees-0905-msk'),

    -- Keep only if still used outside the new OPP/WEEEK flow.
    ('mistakes-pm-refresh-4x-msk')
)
select
  j.jobid,
  j.jobname,
  j.schedule,
  j.active,
  left(regexp_replace(j.command, '\s+', ' ', 'g'), 260) as command_preview
from cron.job j
left join recommended r on r.jobname = j.jobname
where j.active = true
  and r.jobname is null
order by j.jobname;

-- 6) Recommended minimal crons for manual/basic WEEEK tasks.
-- Run this block only if these jobs do not already exist.
-- Replace secret if needed.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'weeek-task-master-basic-process-2m') then
    perform cron.schedule(
      'weeek-task-master-basic-process-2m',
      '*/2 * * * *',
      $job$
      select net.http_post(
        url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master-basic',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'secret', '50144199',
          'action', 'process_queue',
          'limit', 20
        ),
        timeout_milliseconds := 120000
      );
      $job$
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'weeek-task-master-basic-sync-10m') then
    perform cron.schedule(
      'weeek-task-master-basic-sync-10m',
      '*/10 * * * *',
      $job$
      select net.http_post(
        url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master-basic',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'secret', '50144199',
          'action', 'sync_statuses',
          'limit', 30
        ),
        timeout_milliseconds := 120000
      );
      $job$
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'weeek-task-master-basic-reopen-10m') then
    perform cron.schedule(
      'weeek-task-master-basic-reopen-10m',
      '*/10 * * * *',
      $job$
      select net.http_post(
        url := 'https://bgphllmzmlwurfnbagho.supabase.co/functions/v1/weeek-task-master-basic',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'secret', '50144199',
          'action', 'reopen_due',
          'limit', 30
        ),
        timeout_milliseconds := 120000
      );
      $job$
    );
  end if;
end $$;

-- 7) Optional rare fallback for assignees.
-- Shift opening already runs assign_weeek_shift_task_assignees().
-- This 09:05 job only catches cases where shift was opened before tasks were uploaded or a previous run failed.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'weeek-shift-assignees-0905-msk') then
    perform cron.schedule(
      'weeek-shift-assignees-0905-msk',
      '5 6 * * *',
      $job$
      select public.assign_weeek_shift_task_assignees(
        '50144199',
        (timezone('Europe/Moscow', now()))::date,
        false
      );
      $job$
    );
  end if;
end $$;

-- 8) Final check: active jobs only.
select jobid, jobname, schedule, active, left(regexp_replace(command, '\s+', ' ', 'g'), 260) as command_preview
from cron.job
where active = true
order by jobname;

-- 9) Rollback examples if something was disabled by mistake:
-- update cron.job set active = true where jobname = 'some-job-name';
-- select cron.unschedule('some-job-name'); -- only when you are 100% sure it should be deleted.
