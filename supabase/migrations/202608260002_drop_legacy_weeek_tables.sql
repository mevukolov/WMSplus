-- WEEEK integration removal, DB side.
-- Do NOT apply until scripts/verify_weeek_migration.sql has been run and its
-- query 4 (unmigrated live rows) returns zero rows for both weeek_tasks and
-- weeek_tasks_basic. This mirrors the earlier tasks.js legacy-read guard
-- (already safe, see tasks.js readOptionalRows() call sites) so the app
-- keeps working once these tables are gone -- this migration only needs to
-- ship after that verification, not necessarily bundled with a JS deploy.

-- 1) Final catch-all migration pass, in case anything landed after the
-- manual verification run.
select public.migrate_weeek_tasks_to_wms();

-- 2) Fold the legacy manual-upload run journal into the native table so the
-- upload history calendar keeps showing pre-cutover days. Same unique key
-- (effective_date, source_module, upload_type) as the native table, so this
-- is a plain upsert-free insert that skips anything already recorded there.
insert into public.wms_manual_upload_runs (
  id, upload_date, effective_date, business_date, source_module, upload_type,
  status, file_name, secondary_file_name, rows_count, tasks_count,
  upserted_count, summary, created_at, updated_at
)
select
  id, upload_date, effective_date, business_date, source_module, upload_type,
  status, file_name, secondary_file_name, rows_count, tasks_count,
  upserted_count, summary, created_at, updated_at
from public.weeek_manual_upload_runs
on conflict (effective_date, source_module, upload_type) do nothing;

-- 3) weeek_manual_upload_settings is fully superseded by
-- wms_manual_upload_settings (seeded in 202608200001_wms_tasks_manual_uploads.sql
-- with every legacy module plus newer ones); no data to carry over.

-- 4) Drop the legacy tables now that their data lives in wms_tasks /
-- wms_manual_upload_runs / wms_manual_upload_settings.
drop table if exists public.weeek_task_routes;
drop table if exists public.weeek_tasks_basic;
drop table if exists public.weeek_tasks;
drop table if exists public.weeek_manual_upload_runs;
drop table if exists public.weeek_manual_upload_settings;

-- 5) The bridge function (and its private helpers) has nothing left to copy from.
drop function if exists public.migrate_weeek_tasks_to_wms();
drop function if exists public.wms_priority_label_from_weeek(integer);
drop function if exists public.wms_upload_type_from_legacy_source(text);
drop function if exists public.wms_legacy_effective_date(text, date, date);
