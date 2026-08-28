-- fetchWmsTaskRows(db, "inactive") now orders by updated_at desc and caps
-- at 1000 rows instead of paginating through the whole (8700+ and growing)
-- completed/deferred set -- see the comment above INACTIVE_TASK_ROW_LIMIT
-- in tasks.js. The existing wms_tasks_inactive_price_idx (source_price_sum)
-- doesn't help this shape; add a matching one so it's a real index scan
-- instead of falling back to a sort over the whole filtered set.
create index if not exists wms_tasks_inactive_recency_idx
  on public.wms_tasks (updated_at desc)
  where is_deleted = false and task_status in ('Завершено', 'Отложено');
