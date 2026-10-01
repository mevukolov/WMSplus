-- Real bug, not just cosmetic: the review card's right side (and
-- confirmNoShkMatch's "which item did we just find") picks the task item
-- by matching the stored `nm` field against each task_items[].nm. `nm`
-- is the CANDIDATE's own (photo-guessed) nm -- for the fuzzy Path 2 that
-- by definition differs from the task's own nm, so the lookup silently
-- misses and falls back to task_items[0], showing the wrong product's
-- name/status whenever a tare task has more than one item.
--
-- Fix: persist `task_nm` -- the task's own item nm that was actually
-- matched against -- alongside `nm` (the candidate's). Also carries the
-- candidate's `box_id` through into the snapshot, needed by the new
-- "Оклейте товар под ШК" flow to show where the physical item is.
create or replace function public.wms_no_shk_bulk_match_and_persist()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
    v_existing jsonb;
    v_known_ids text[];
    v_additions jsonb;
    v_next jsonb;
    v_count integer := 0;
begin
    perform set_config('pg_trgm.similarity_threshold', '0.35', true);

    for v_row in (
        with open_tasks as (
            select id from public.wms_tasks
            where is_deleted = false
              and opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
        ),
        wb_candidates as (
            select s.id as submission_id, elem as nm, s.created_at, s.box_id,
                   s.item_text, s.photo_path, s.full_name, s.area, s.sticker_code, s.item_type
            from public.intake_submissions s,
                 jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) as elem
            where s.matched_task_id is null
        ),
        pairs as (
            -- Path 1: exact nm equality (original behavior).
            select ti.task_id, sn.*, ti.nm as task_nm, 1 as path_rank, null::double precision as match_score
            from public.wms_task_nm_index ti
            join wb_candidates sn on sn.nm = ti.nm
            where ti.movement is not null
              and sn.created_at >= (ti.movement - interval '1 day')
              and sn.created_at < (ti.movement + interval '6 day')

            union all

            -- Path 2: similar brand AND similar name via wms_nm_directory.
            select ti.task_id, sn.*, ti.nm as task_nm, 2 as path_rank,
                   (similarity(lower(trim(dc.name)), lower(trim(dt.name)))
                    + similarity(lower(trim(dc.brand)), lower(trim(dt.brand)))) / 2 as match_score
            from public.wms_task_nm_index ti
            join open_tasks ot on ot.id = ti.task_id
            join public.wms_nm_directory dt
                on dt.nm = ti.nm
               and dt.brand is not null and trim(dt.brand) <> '' and lower(trim(dt.brand)) <> 'нет бренда'
               and dt.name is not null and trim(dt.name) <> ''
            join public.wms_nm_directory dc
                on lower(trim(dc.name)) % lower(trim(dt.name))
               and lower(trim(dc.brand)) % lower(trim(dt.brand))
               and similarity(lower(trim(dc.name)), lower(trim(dt.name))) >= 0.5
               and similarity(lower(trim(dc.brand)), lower(trim(dt.brand))) >= 0.35
               and dc.brand is not null and trim(dc.brand) <> '' and lower(trim(dc.brand)) <> 'нет бренда'
               and dc.name is not null and trim(dc.name) <> ''
               and dc.nm <> dt.nm
            join wb_candidates sn on sn.nm = dc.nm
            where ti.movement is not null
              and sn.created_at >= (ti.movement - interval '1 day')
              and sn.created_at < (ti.movement + interval '6 day')
        ),
        best_pairs as (
            select distinct on (task_id, submission_id)
                   task_id, submission_id, nm, task_nm, created_at, box_id,
                   item_text, photo_path, full_name, area, sticker_code, item_type
            from pairs
            order by task_id, submission_id, path_rank asc, match_score desc nulls last
        )
        select task_id,
               jsonb_agg(distinct jsonb_build_object(
                   'submission_id', submission_id,
                   'nm', nm,
                   'task_nm', task_nm,
                   'matched_at', to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   'decision', 'pending',
                   'decided_by_id', '',
                   'decided_by_name', '',
                   'decided_at', '',
                   'snapshot', jsonb_build_object(
                       'item_text', item_text,
                       'photo_path', photo_path,
                       'full_name', full_name,
                       'area', area,
                       'created_at', to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'sticker_code', sticker_code,
                       'item_type', item_type,
                       'box_id', box_id
                   )
               )) as candidates
        from best_pairs
        group by task_id
    ) loop
        v_existing := null;
        v_known_ids := null;
        v_additions := null;

        select coalesce(t.source_payload->'no_shk_matches', '[]'::jsonb)
        into v_existing
        from public.wms_tasks t
        where t.id = v_row.task_id
          and t.is_deleted = false
          and t.opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение');

        if v_existing is null then
            continue;
        end if;

        select array_agg(elem->>'submission_id') into v_known_ids
        from jsonb_array_elements(v_existing) elem;

        select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_additions
        from jsonb_array_elements(v_row.candidates) elem
        where v_known_ids is null or not (elem->>'submission_id' = any(v_known_ids));

        if jsonb_array_length(v_additions) = 0 then
            continue;
        end if;

        v_next := v_existing || v_additions;

        update public.wms_tasks
        set source_payload = jsonb_set(coalesce(source_payload, '{}'::jsonb), '{no_shk_matches}', v_next, true),
            has_pending_no_shk_match = true,
            updated_at = now()
        where id = v_row.task_id;

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

-- One-time repair: recompute task_nm for already-written matches (and
-- backfill snapshot.box_id while at it) by re-deriving which of the
-- task's own nm's each candidate nm actually corresponds to -- exact nm
-- membership first (Path 1 shape), else the best brand+name match among
-- the task's own items (Path 2 shape). Entries no rule can resolve keep
-- their current (possibly wrong) task_nm rather than being blanked.
update public.wms_tasks t
set source_payload = jsonb_set(
    t.source_payload,
    '{no_shk_matches}',
    (
        select jsonb_agg(
            case when fixed.task_nm is not null
                then jsonb_set(
                    jsonb_set(m.elem, '{task_nm}', to_jsonb(fixed.task_nm)),
                    '{snapshot,box_id}', to_jsonb(fixed.box_id), true
                )
                else m.elem
            end
            order by m.ord
        )
        from jsonb_array_elements(t.source_payload->'no_shk_matches') with ordinality as m(elem, ord)
        left join lateral (
            select
                coalesce(
                    (select ti.nm from public.wms_task_nm_index ti where ti.task_id = t.id and ti.nm = (m.elem->>'nm')),
                    (
                        select ti.nm
                        from public.wms_task_nm_index ti
                        join public.wms_nm_directory dt
                            on dt.nm = ti.nm
                           and dt.brand is not null and trim(dt.brand) <> '' and lower(trim(dt.brand)) <> 'нет бренда'
                           and dt.name is not null and trim(dt.name) <> ''
                        join public.wms_nm_directory dc
                            on dc.nm = (m.elem->>'nm')
                           and dc.brand is not null and trim(dc.brand) <> '' and lower(trim(dc.brand)) <> 'нет бренда'
                           and dc.name is not null and trim(dc.name) <> ''
                        where ti.task_id = t.id
                        order by (similarity(lower(trim(dc.name)), lower(trim(dt.name)))
                                  + similarity(lower(trim(dc.brand)), lower(trim(dt.brand)))) desc
                        limit 1
                    )
                ) as task_nm,
                (select s.box_id from public.intake_submissions s where s.id = (m.elem->>'submission_id')::uuid) as box_id
        ) fixed on true
    ),
    true
)
where jsonb_typeof(t.source_payload->'no_shk_matches') = 'array'
  and jsonb_array_length(t.source_payload->'no_shk_matches') > 0;
