-- Emergency rollback for 202609290002_lock_down_neglected_tables.sql.
-- Restores exactly today's (2026-09-29) anon privileges. Disabling RLS
-- makes any policy -- new or the 3 stale ones dropped in the forward
-- migration -- moot, so this is a full, exact revert regardless of
-- policy state.

alter table public."2shk_rep" disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public."2shk_rep" to anon;

alter table public.cron_job_backup_20260819 disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.cron_job_backup_20260819 to anon;

alter table public.linear_emp_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.linear_emp_rep to anon;

alter table public.losses_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.losses_rep to anon;

alter table public.mistakes_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.mistakes_rep to anon;

alter table public.nm_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.nm_rep to anon;

alter table public.opp_telegram_alert_log disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.opp_telegram_alert_log to anon;

alter table public.pages disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.pages to anon;

alter table public.places disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.places to anon;

alter table public.print_jobs disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.print_jobs to anon;

alter table public.print_label_templates disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.print_label_templates to anon;

alter table public.pure_losses_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.pure_losses_rep to anon;

alter table public.report_metrics disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.report_metrics to anon;

alter table public.report_runs disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.report_runs to anon;

alter table public.shk_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.shk_rep to anon;

alter table public.sort_groups_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.sort_groups_rep to anon;

alter table public.sort_squares_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.sort_squares_rep to anon;

alter table public.tmc_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.tmc_rep to anon;

alter table public.users disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.users to anon;

alter table public.weeek_employees disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_employees to anon;

alter table public.weeek_manual_upload_runs disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_manual_upload_runs to anon;

alter table public.weeek_manual_upload_runs_backup_20260817_165515 disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_manual_upload_runs_backup_20260817_165515 to anon;

alter table public.weeek_manual_upload_settings disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_manual_upload_settings to anon;

alter table public.weeek_shifts disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_shifts to anon;

alter table public.weeek_task_routes disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_task_routes to anon;

alter table public.weeek_tasks disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_tasks to anon;

alter table public.weeek_tasks_basic disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_tasks_basic to anon;

alter table public.weeek_tasks_basic_backup_20260817_165515 disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.weeek_tasks_basic_backup_20260817_165515 to anon;

alter table public.wh_data_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wh_data_rep to anon;

alter table public.wh_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wh_rep to anon;

alter table public.wiki_rep disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wiki_rep to anon;

alter table public.wms_achievements disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_achievements to anon;

alter table public.wms_employees disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_employees to anon;

alter table public.wms_flow_score_settings disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_flow_score_settings to anon;

alter table public.wms_manual_upload_runs disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_manual_upload_runs to anon;

alter table public.wms_manual_upload_settings disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_manual_upload_settings to anon;

alter table public.wms_no_shk_sticker_events disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_no_shk_sticker_events to anon;

alter table public.wms_prespisok_actions disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_prespisok_actions to anon;

alter table public.wms_prespisok_runs disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_prespisok_runs to anon;

alter table public.wms_shifts disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_shifts to anon;

alter table public.wms_superset_cache disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_superset_cache to anon;

alter table public.wms_task_history disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_task_history to anon;

alter table public.wms_task_nm_index disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_task_nm_index to anon;

alter table public.wms_tasks disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_tasks to anon;

alter table public.wms_writeoff_terms disable row level security;
grant delete, insert, references, select, trigger, truncate, update on public.wms_writeoff_terms to anon;

-- The 3 views (no RLS involved -- view-level grant is the only gate).
grant select on public.opp_shift_detail_latest_metrics to anon;
grant select on public.opp_shift_report_runs to anon;
grant select on public.report_metrics_flat to anon;
