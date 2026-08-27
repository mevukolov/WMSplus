-- One-time data repair, applied 2026-08-27, companion to the
-- auto_reopen_wms_tasks() fix in
-- 202608270002_fix_auto_reopen_verdict_reset.sql.
--
-- task_status='Не начато' + opp_verdict<>'Не выбран' can only happen via
-- the auto-reopen bug: every other path that sets a non-default opp_verdict
-- (completeTaskFromDetail) also sets task_status to 'Завершено' or
-- 'Отложено', never 'Не начато'. Fresh tasks always start with
-- opp_verdict='Не выбран'. Safe to bulk-clear.
--
-- The prior completion is preserved in wms_task_history regardless.
update public.wms_tasks
set opp_verdict = 'Не выбран',
    source_payload = coalesce(source_payload, '{}'::jsonb) || jsonb_build_object('wms_review', '{}'::jsonb),
    updated_at = now()
where task_status = 'Не начато'
  and coalesce(opp_verdict, 'Не выбран') <> 'Не выбран';
