-- Root cause of the intermittent "canceling statement due to statement
-- timeout" error on task-list loads (loadReviewTasks / fetchWmsTaskRows):
-- the anon role (which this client authenticates as -- there's no per-user
-- Supabase Auth session) has a hard 3s statement_timeout. The active/inactive
-- task-list queries filter on (is_deleted, task_status) and sort by
-- source_price_sum, but no index supports that shape, so Postgres falls back
-- to a full sequential scan + in-memory sort over the whole wms_tasks table
-- (10k+ rows and growing forever, since old tasks are never purged). Measured
-- via EXPLAIN ANALYZE: ~680ms for a bare `select id` under warm cache alone,
-- before adding the full source_payload column and JSON serialization on
-- top -- easily pushed past 3s under load or a cold cache.
--
-- These partial indexes mirror the exact WHERE clauses fetchWmsTaskRows()
-- builds for mode="active" and mode="inactive", so Postgres can satisfy both
-- the filter and the ORDER BY source_price_sum DESC via an index scan
-- instead of scanning+sorting the entire table. This reduces query cost on
-- Supabase's side (fewer buffers read, no in-memory sort) -- it doesn't add
-- load, it removes it.
create index if not exists wms_tasks_active_price_idx
  on public.wms_tasks (source_price_sum desc nulls last)
  where is_deleted = false and (task_status is null or task_status <> 'Завершено');

create index if not exists wms_tasks_inactive_price_idx
  on public.wms_tasks (source_price_sum desc nulls last)
  where is_deleted = false and task_status in ('Завершено', 'Отложено');
