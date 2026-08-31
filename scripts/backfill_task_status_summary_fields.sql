-- One-time backfill, applied 2026-08-29, companion to the
-- status_code_label/movement_status_options precompute added to
-- taskRecord() this session. New tasks get these written at creation;
-- this fills them in for the ~2500 already-active tasks so the planned
-- light list query (Review/Requests table + its movement-status filter)
-- doesn't lose data for tasks created before this change.
--
-- Mirrors the JS exactly:
--   latinStatusCode(v)   = first 3 consecutive uppercase A-Z found in
--                          v.toUpperCase()
--   movement_status_options = per item: latinStatusCode(status) if
--                          found, else the trimmed *original-case*
--                          status text (normalizeText, no case change)
--   status_code_label    = codes only (no raw-text fallback), first 3
--                          joined by "/", "+"N more if there are more
--                          -- note: SQL's DISTINCT here sorts
--                          alphabetically rather than preserving the
--                          JS Set's first-seen order, so the *order* of
--                          codes in this cosmetic title suffix can
--                          differ from what live JS would have shown;
--                          movement_status_options (used for actual
--                          filtering) is order-independent, so that one
--                          matches exactly.
--
-- Scoped to active rows only, same reasoning as the other cleanups this
-- session: trg_set_updated_at_wms_tasks stamps updated_at on any
-- UPDATE, and active tasks' updated_at already moves constantly from
-- normal work, so bumping it here is harmless; the larger archived set
-- isn't part of the query this is optimizing and bumping its
-- updated_at would wrongly disturb the recency-capped inactive list.
with codes as (
  select
    t.id,
    array_agg(distinct code) filter (where code is not null) as status_codes,
    array_agg(distinct coalesce(nullif(code, ''), trim(item->>'status'))) filter (where trim(coalesce(item->>'status','')) <> '') as movement_options
  from public.wms_tasks t
  cross join lateral jsonb_array_elements(coalesce(t.source_payload->'task_items', '[]'::jsonb)) as item
  cross join lateral (select substring(upper(coalesce(item->>'status','')) from '[A-Z]{3}') as code) c
  where t.is_deleted = false
    and (t.task_status is null or t.task_status <> 'Завершено')
  group by t.id
)
update public.wms_tasks t
set source_payload = t.source_payload
  || jsonb_build_object(
       'status_code_label',
       case
         when codes.status_codes is null or array_length(codes.status_codes, 1) is null then ''
         when array_length(codes.status_codes, 1) <= 3 then array_to_string(codes.status_codes[1:3], '/')
         else array_to_string(codes.status_codes[1:3], '/') || '+' || (array_length(codes.status_codes, 1) - 3)
       end,
       'movement_status_options',
       to_jsonb(coalesce(codes.movement_options, '{}'::text[]))
     )
from codes
where t.id = codes.id;
