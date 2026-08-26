-- Run manually in the Supabase SQL Editor BEFORE applying
-- supabase/migrations/202608260002_drop_legacy_weeek_tables.sql.
-- Goal: prove every live weeek_tasks / weeek_tasks_basic row has a
-- matching wms_tasks row before the legacy tables are dropped.

-- 1) Catch any straggler rows not yet copied into wms_tasks.
select public.migrate_weeek_tasks_to_wms();

-- 2) Row-count comparison: weeek_tasks_basic vs its wms_tasks copies.
select
  (select count(*) from public.weeek_tasks_basic where coalesce(weeek_deleted, false) = false) as basic_live_rows,
  (select count(*) from public.wms_tasks where source_payload ->> 'legacy_table' = 'weeek_tasks_basic') as basic_migrated_rows;

-- 3) Row-count comparison: weeek_tasks vs its wms_tasks copies.
select
  (select count(*) from public.weeek_tasks where coalesce(weeek_deleted, false) = false) as tasks_live_rows,
  (select count(*) from public.wms_tasks where source_payload ->> 'legacy_table' = 'weeek_tasks') as tasks_migrated_rows;

-- 4) List any live legacy rows that still have no wms_tasks counterpart
-- (should return zero rows in both queries before dropping).
select b.id, b.source_module, b.source_id, b.task_type, b.title
from public.weeek_tasks_basic b
where coalesce(b.weeek_deleted, false) = false
  and nullif(b.source_module, '') is not null
  and nullif(b.source_id, '') is not null
  and nullif(b.task_type, '') is not null
  and not exists (
    select 1 from public.wms_tasks w
    where w.source_payload ->> 'legacy_id' = b.id::text
      and w.source_payload ->> 'legacy_table' = 'weeek_tasks_basic'
  );

select t.id, t.source_module, t.source_id, t.task_type, t.title
from public.weeek_tasks t
where coalesce(t.weeek_deleted, false) = false
  and nullif(t.source_module, '') is not null
  and nullif(t.source_id, '') is not null
  and nullif(t.task_type, '') is not null
  and not exists (
    select 1 from public.wms_tasks w
    where w.source_payload ->> 'legacy_id' = t.id::text
      and w.source_payload ->> 'legacy_table' = 'weeek_tasks'
  );

-- 5) Row counts for the manual-upload journal tables, for reference only.
-- These are pure audit logs (no task data), archived into
-- wms_manual_upload_runs_archive / wms_manual_upload_settings_archive
-- by the drop migration itself -- no manual action needed here, this is
-- just a before/after sanity count.
select count(*) as legacy_runs_rows from public.weeek_manual_upload_runs;
select count(*) as legacy_settings_rows from public.weeek_manual_upload_settings;

-- If, and only if, query 4 returns zero rows in both halves, it is safe to
-- apply supabase/migrations/202608260002_drop_legacy_weeek_tables.sql.
