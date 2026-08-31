-- One-time cleanup, applied 2026-08-29, follow-up to the taskRecord()
-- write removal from earlier this session (writeoff_date_candidates was
-- confirmed dead -- write-only, no downstream reader).
--
-- The write-side fix only stops NEW saves from adding the field; rows
-- upserted before that fix still carry it in source_payload until they
-- happen to get re-uploaded (source_payload is a full replace on
-- conflict, not a merge). trg_set_updated_at_wms_tasks stamps updated_at
-- on any UPDATE regardless of the SET list, so this is scoped to ACTIVE
-- rows only (148 of the 759 total) -- the ones that actually cost
-- anything in the recurring active-task fetch. The other 611 are
-- completed/archived, sit behind the recency-capped inactive query, and
-- bumping their updated_at would falsely push them to the top of that
-- "most recently touched" list -- not worth it for a few KB each.
update public.wms_tasks
set source_payload = source_payload - 'writeoff_date_candidates'
where source_payload ? 'writeoff_date_candidates'
  and is_deleted = false
  and (task_status is null or task_status <> 'Завершено');
