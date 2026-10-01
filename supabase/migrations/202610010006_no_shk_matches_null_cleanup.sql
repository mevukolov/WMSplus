-- Root cause of "Загрузка..." never finishing / "Cannot read properties
-- of null (reading 'decision')": the one-time task_nm/box_id backfill in
-- 202610010004 used jsonb_set(..., to_jsonb(fixed.box_id), true) for
-- rows missing a box_id. jsonb_set is a STRICT function -- when its
-- new_value argument is SQL NULL (which to_jsonb(NULL::uuid) produces,
-- not a jsonb 'null'), the WHOLE jsonb_set call returns SQL NULL instead
-- of the object with a null field. jsonb_agg then aggregated that SQL
-- NULL as a literal JSON null array element -- so any match whose
-- submission had no box_id got replaced with bare `null` in
-- source_payload.no_shk_matches, which the client's .filter(m =>
-- m.decision === "pending") then crashed on for every task in the list
-- (noShkQueueRowHtml, tasks.js:9845), killing the whole queue render.
--
-- One-time repair: strip any non-object element from every task's
-- no_shk_matches array, preserving the order and content of everything
-- else. The ongoing wms_no_shk_bulk_match_and_persist() function was
-- never affected -- it builds entries with jsonb_build_object, which is
-- NOT strict and correctly emits {"box_id": null} rather than going null
-- itself.
update public.wms_tasks t
set source_payload = jsonb_set(
    t.source_payload,
    '{no_shk_matches}',
    (
        select coalesce(jsonb_agg(m.elem order by m.ord), '[]'::jsonb)
        from jsonb_array_elements(t.source_payload->'no_shk_matches') with ordinality as m(elem, ord)
        where jsonb_typeof(m.elem) = 'object'
    ),
    true
)
where jsonb_typeof(t.source_payload->'no_shk_matches') = 'array'
  and exists (
      select 1
      from jsonb_array_elements(t.source_payload->'no_shk_matches') elem2
      where jsonb_typeof(elem2) <> 'object'
  );
