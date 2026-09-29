-- 202609290002_lock_down_neglected_tables.sql
-- See docs/superpowers/specs/2026-09-29-rls-auth-migration-design.md.
-- Locks down every table/view with no confirmed anon consumer (45 tables
-- + 3 views). The 9 tables tied to a confirmed public, no-login surface
-- (the external "Без ШК" intake form, the display.js kiosk, the
-- opp_shift_iframe.js dashboard widget) are deliberately absent from this
-- file -- do not add them.
--
-- DO NOT `supabase db push` THIS FILE without the user's explicit,
-- separately-given go-ahead naming the agreed cutover window -- it
-- revokes anon's access to every table below for real, the instant it
-- runs, for every current employee session. See the plan's Task 11.
-- Lock down the 42 tables that never had RLS considered at all: enable
-- RLS, add a blanket authenticated-only policy (no per-row scoping --
-- scope decision 2026-09-29 was "logged in or not", not per-employee),
-- and revoke anon's grants.

alter table public."2shk_rep" enable row level security;

create policy "2shk_rep_authenticated_all" on public."2shk_rep"
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public."2shk_rep" from anon;

alter table public.cron_job_backup_20260819 enable row level security;

create policy cron_job_backup_20260819_authenticated_all on public.cron_job_backup_20260819
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.cron_job_backup_20260819 from anon;

alter table public.linear_emp_rep enable row level security;

create policy linear_emp_rep_authenticated_all on public.linear_emp_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.linear_emp_rep from anon;

alter table public.losses_rep enable row level security;

create policy losses_rep_authenticated_all on public.losses_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.losses_rep from anon;

alter table public.nm_rep enable row level security;

create policy nm_rep_authenticated_all on public.nm_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.nm_rep from anon;

alter table public.opp_telegram_alert_log enable row level security;

create policy opp_telegram_alert_log_authenticated_all on public.opp_telegram_alert_log
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.opp_telegram_alert_log from anon;

alter table public.pages enable row level security;

create policy pages_authenticated_all on public.pages
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.pages from anon;

alter table public.places enable row level security;

create policy places_authenticated_all on public.places
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.places from anon;

alter table public.pure_losses_rep enable row level security;

create policy pure_losses_rep_authenticated_all on public.pure_losses_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.pure_losses_rep from anon;

alter table public.report_metrics enable row level security;

create policy report_metrics_authenticated_all on public.report_metrics
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.report_metrics from anon;

alter table public.report_runs enable row level security;

create policy report_runs_authenticated_all on public.report_runs
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.report_runs from anon;

alter table public.shk_rep enable row level security;

create policy shk_rep_authenticated_all on public.shk_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.shk_rep from anon;

alter table public.sort_groups_rep enable row level security;

create policy sort_groups_rep_authenticated_all on public.sort_groups_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.sort_groups_rep from anon;

alter table public.sort_squares_rep enable row level security;

create policy sort_squares_rep_authenticated_all on public.sort_squares_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.sort_squares_rep from anon;

alter table public.tmc_rep enable row level security;

create policy tmc_rep_authenticated_all on public.tmc_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.tmc_rep from anon;

alter table public.users enable row level security;

create policy users_authenticated_all on public.users
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.users from anon;

alter table public.weeek_employees enable row level security;

create policy weeek_employees_authenticated_all on public.weeek_employees
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_employees from anon;

alter table public.weeek_manual_upload_runs enable row level security;

create policy weeek_manual_upload_runs_authenticated_all on public.weeek_manual_upload_runs
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_manual_upload_runs from anon;

alter table public.weeek_manual_upload_runs_backup_20260817_165515 enable row level security;

create policy weeek_manual_upload_runs_backup_20260817_165515_authenticated_all on public.weeek_manual_upload_runs_backup_20260817_165515
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_manual_upload_runs_backup_20260817_165515 from anon;

alter table public.weeek_manual_upload_settings enable row level security;

create policy weeek_manual_upload_settings_authenticated_all on public.weeek_manual_upload_settings
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_manual_upload_settings from anon;

alter table public.weeek_shifts enable row level security;

create policy weeek_shifts_authenticated_all on public.weeek_shifts
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_shifts from anon;

alter table public.weeek_task_routes enable row level security;

create policy weeek_task_routes_authenticated_all on public.weeek_task_routes
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_task_routes from anon;

alter table public.weeek_tasks enable row level security;

create policy weeek_tasks_authenticated_all on public.weeek_tasks
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_tasks from anon;

alter table public.weeek_tasks_basic enable row level security;

create policy weeek_tasks_basic_authenticated_all on public.weeek_tasks_basic
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_tasks_basic from anon;

alter table public.weeek_tasks_basic_backup_20260817_165515 enable row level security;

create policy weeek_tasks_basic_backup_20260817_165515_authenticated_all on public.weeek_tasks_basic_backup_20260817_165515
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.weeek_tasks_basic_backup_20260817_165515 from anon;

alter table public.wh_data_rep enable row level security;

create policy wh_data_rep_authenticated_all on public.wh_data_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wh_data_rep from anon;

alter table public.wh_rep enable row level security;

create policy wh_rep_authenticated_all on public.wh_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wh_rep from anon;

alter table public.wiki_rep enable row level security;

create policy wiki_rep_authenticated_all on public.wiki_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wiki_rep from anon;

alter table public.wms_achievements enable row level security;

create policy wms_achievements_authenticated_all on public.wms_achievements
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_achievements from anon;

alter table public.wms_employees enable row level security;

create policy wms_employees_authenticated_all on public.wms_employees
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_employees from anon;

alter table public.wms_flow_score_settings enable row level security;

create policy wms_flow_score_settings_authenticated_all on public.wms_flow_score_settings
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_flow_score_settings from anon;

alter table public.wms_manual_upload_runs enable row level security;

create policy wms_manual_upload_runs_authenticated_all on public.wms_manual_upload_runs
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_manual_upload_runs from anon;

alter table public.wms_manual_upload_settings enable row level security;

create policy wms_manual_upload_settings_authenticated_all on public.wms_manual_upload_settings
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_manual_upload_settings from anon;

alter table public.wms_no_shk_sticker_events enable row level security;

create policy wms_no_shk_sticker_events_authenticated_all on public.wms_no_shk_sticker_events
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_no_shk_sticker_events from anon;

alter table public.wms_prespisok_actions enable row level security;

create policy wms_prespisok_actions_authenticated_all on public.wms_prespisok_actions
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_prespisok_actions from anon;

alter table public.wms_prespisok_runs enable row level security;

create policy wms_prespisok_runs_authenticated_all on public.wms_prespisok_runs
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_prespisok_runs from anon;

alter table public.wms_shifts enable row level security;

create policy wms_shifts_authenticated_all on public.wms_shifts
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_shifts from anon;

alter table public.wms_superset_cache enable row level security;

create policy wms_superset_cache_authenticated_all on public.wms_superset_cache
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_superset_cache from anon;

alter table public.wms_task_history enable row level security;

create policy wms_task_history_authenticated_all on public.wms_task_history
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_task_history from anon;

alter table public.wms_task_nm_index enable row level security;

create policy wms_task_nm_index_authenticated_all on public.wms_task_nm_index
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_task_nm_index from anon;

alter table public.wms_tasks enable row level security;

create policy wms_tasks_authenticated_all on public.wms_tasks
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_tasks from anon;

alter table public.wms_writeoff_terms enable row level security;

create policy wms_writeoff_terms_authenticated_all on public.wms_writeoff_terms
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.wms_writeoff_terms from anon;

-- 3 tables already had RLS enabled with a stale permissive policy that
-- granted ALL to `public` (anon included) -- no confirmed public consumer
-- for any of them (see spec, Background). Drop the old policy first so it
-- doesn't keep matching alongside the new one.

drop policy mistakes_rep_select_all on public.mistakes_rep;

create policy mistakes_rep_authenticated_all on public.mistakes_rep
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.mistakes_rep from anon;

drop policy print_jobs_all on public.print_jobs;

create policy print_jobs_authenticated_all on public.print_jobs
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.print_jobs from anon;

drop policy print_label_templates_all on public.print_label_templates;

create policy print_label_templates_authenticated_all on public.print_label_templates
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.print_label_templates from anon;

-- 3 views derived entirely from already-locked-down tables
-- (report_runs, report_metrics) with no confirmed consumer anywhere in
-- this repo or the 4 confirmed public surfaces. Views aren't RLS subjects
-- themselves -- anon's own SELECT grant on the view is the only gate,
-- independent of the underlying tables' policies (the view owner's
-- privileges apply unless the view is security_invoker). Revoking here is
-- both necessary and sufficient.
revoke select on public.opp_shift_detail_latest_metrics from anon;
revoke select on public.opp_shift_report_runs from anon;
revoke select on public.report_metrics_flat from anon;
