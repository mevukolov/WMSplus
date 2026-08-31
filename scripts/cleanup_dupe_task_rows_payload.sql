-- One-time cleanup, applied 2026-08-29, companion to the taskRecord()
-- fix that stops writing payload.row/payload.rows (see tasks.js
-- taskRecord()). These duplicated the same data task_items is built
-- from -- taskItems() only reads them as a last-resort fallback when
-- task_items is empty, and a live check found 0 of 12175 tasks actually
-- need that fallback. Together they're ~4.26 MB of the ~10.5 MB active
-- source_payload total (task_items is the other big chunk, kept -- it's
-- the real, actually-read data).
--
-- Scoped to active rows only: trg_set_updated_at_wms_tasks stamps
-- updated_at on any UPDATE, and active tasks' updated_at already moves
-- constantly from normal work, so this is harmless there. Left the
-- larger completed/archived set alone -- bumping updated_at on those
-- would falsely push them to the top of the recency-capped inactive
-- list, and they aren't part of the active-task fetch this is actually
-- optimizing anyway.
update public.wms_tasks
set source_payload = source_payload - 'row' - 'rows'
where is_deleted = false
  and (task_status is null or task_status <> 'Завершено')
  and (source_payload ? 'row' or source_payload ? 'rows');
