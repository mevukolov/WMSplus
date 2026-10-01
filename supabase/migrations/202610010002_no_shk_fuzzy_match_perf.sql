-- 202610010001's Path 2 probes wms_nm_directory via a trigram index for
-- every (task, directory) pair -- measured at ~13s for the inner query on
-- real data (641104 shared buffers). ~49% of those probes (1527 of 2975)
-- turned out to belong to tasks that are already closed and get discarded
-- later anyway (the opp_verdict exclusion only happened after the
-- expensive join, in the per-row loop). Filtering to still-open tasks
-- before the directory probe is a pure perf win, no behavior change --
-- cuts the expensive probe set roughly in half.
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
            select s.id as submission_id, elem as nm, s.created_at,
                   s.item_text, s.photo_path, s.full_name, s.area, s.sticker_code, s.item_type
            from public.intake_submissions s,
                 jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) as elem
            where s.matched_task_id is null
        ),
        pairs as (
            -- Path 1: exact nm equality (original behavior).
            select ti.task_id, sn.*
            from public.wms_task_nm_index ti
            join wb_candidates sn on sn.nm = ti.nm
            where ti.movement is not null
              and sn.created_at >= (ti.movement - interval '1 day')
              and sn.created_at < (ti.movement + interval '6 day')

            union all

            -- Path 2: similar brand AND similar name via wms_nm_directory,
            -- restricted up front to tasks that are still open so the
            -- expensive trigram probe never runs for already-closed tasks.
            select ti.task_id, sn.*
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
        )
        select task_id,
               jsonb_agg(distinct jsonb_build_object(
                   'submission_id', submission_id,
                   'nm', nm,
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
                       'item_type', item_type
                   )
               )) as candidates
        from pairs
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
