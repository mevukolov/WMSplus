-- Run in Supabase SQL Editor after deploying the opp-telegram-alerts removal.
-- Unschedules every pg_cron job that called the now-deleted opp-telegram-alerts
-- edge function. Unlike scripts/cleanup_pg_cron.sql (which deactivates jobs for
-- review), these jobs are unschedule()'d outright since the target function no
-- longer exists and calling it will just 404 forever.

select cron.unschedule(jobname)
from cron.job
where jobname in (
  'opp-telegram-summary-2030-msk',
  'opp-telegram-lag-0900-msk',
  'opp-telegram-rush-1730-msk',
  'opp-telegram-weekly-trends-friday-1000-msk',
  'opp-telegram-thresholds-30m',
  'opp-24-incidents-0845-msk',
  'opp-24-incidents-1845-msk',
  'opp-24-weekly-stats-friday-1015-msk'
);

-- Verify: should return no rows referencing opp-telegram-alerts afterwards.
select jobid, jobname, schedule, command
from cron.job
where command ilike '%opp-telegram-alerts%';
