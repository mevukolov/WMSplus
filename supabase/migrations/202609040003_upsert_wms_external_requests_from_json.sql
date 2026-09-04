-- Запросы входящего потока / Коробки на входе / Списания AWH stopped
-- reaching wms_tasks around 2026-08-23..26 when the WEEEK integration was
-- decommissioned: migrate_weeek_tasks_to_wms() (the bridge from weeek_tasks
-- into wms_tasks) was dropped, and the three weeek-*-refresh Edge Functions
-- were left writing into weeek_tasks via upsert_weeek_tasks_from_json --
-- a table nothing reads from any more. Requests kept piling up in the
-- source Google Sheets with nothing ever landing in WMS+.
--
-- This is the native replacement target for those three refresh functions:
-- write straight into wms_tasks on the existing wms_tasks_source_uidx
-- unique index (source_module, source_id, task_type), the same key
-- upsert_weeek_tasks_from_json used against weeek_tasks. On conflict, only
-- the upstream "source of truth" fields are refreshed -- task_status,
-- opp_verdict, assignee_employee_id/name, completed_at, reopened_at,
-- reopen_after and is_deleted are left untouched so a routine re-sync can
-- never reset progress an operator already made on a task.
create or replace function public.upsert_wms_external_requests_from_json(p_tasks jsonb)
returns integer
language plpgsql
as $$
declare
  item jsonb;
  affected_count integer := 0;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(p_tasks)
  loop
    insert into public.wms_tasks (
      source_module,
      source_table,
      source_id,
      source_row_id,
      source_payload,
      source_generated_at,
      task_type,
      title,
      description,
      priority,
      priority_label,
      due_date,
      upload_type,
      upload_effective_date,
      search_text,
      tags,
      last_seen_at
    )
    values (
      item->>'source_module',
      item->>'source_table',
      item->>'source_id',
      item->>'source_row_id',
      coalesce(item->'source_payload', '{}'::jsonb),
      nullif(item->>'source_generated_at', '')::timestamptz,
      item->>'task_type',
      item->>'title',
      item->>'description',
      coalesce(nullif(item->>'priority', '')::integer, 2),
      nullif(item->>'priority_label', ''),
      nullif(item->>'due_date', '')::date,
      nullif(item->>'upload_type', ''),
      nullif(item->>'upload_effective_date', '')::date,
      item->>'search_text',
      coalesce(item->'tags', '[]'::jsonb),
      timezone('utc', now())
    )
    on conflict (source_module, source_id, task_type)
    do update set
      source_table = excluded.source_table,
      source_row_id = excluded.source_row_id,
      source_payload = excluded.source_payload,
      source_generated_at = excluded.source_generated_at,
      title = excluded.title,
      description = excluded.description,
      priority = excluded.priority,
      priority_label = excluded.priority_label,
      due_date = excluded.due_date,
      upload_type = excluded.upload_type,
      upload_effective_date = excluded.upload_effective_date,
      search_text = excluded.search_text,
      tags = excluded.tags,
      last_seen_at = excluded.last_seen_at,
      updated_at = timezone('utc', now());

    affected_count := affected_count + 1;
  end loop;

  return affected_count;
end;
$$;

grant execute on function public.upsert_wms_external_requests_from_json(jsonb) to service_role;

comment on function public.upsert_wms_external_requests_from_json(jsonb) is
  'Native (post-WEEEK) ingest for externally-fed wms_tasks modules (incoming_flow_requests, incoming_boxes, awh_writeoffs). Writes desired source state straight into wms_tasks; never touches task_status, opp_verdict, assignee fields, completed_at, reopened_at, reopen_after or is_deleted so a re-sync cannot undo an operator''s work.';
