-- Задачи, закрытые автоматически системой по подтверждённому движению ШК
-- (opp_verdict = 'Система - Движение', completeTaskBySystemMovement --
-- отображается в истории как "Закрыто автоматически / Подтверждено движение
-- ШК: ...") тоже физически уже разобраны -- их не нужно сверять с лентой
-- "Без ШК", как и задачи с вердиктом 'Найден/Релиз/Списан'
-- (202609280007_no_shk_skip_final_verdict.sql).

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
    for v_row in (
        select ti.task_id,
               jsonb_agg(distinct jsonb_build_object(
                   'submission_id', sn.submission_id,
                   'nm', sn.nm,
                   'matched_at', to_char(sn.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   'decision', 'pending',
                   'decided_by_id', '',
                   'decided_by_name', '',
                   'decided_at', '',
                   'snapshot', jsonb_build_object(
                       'item_text', sn.item_text,
                       'photo_path', sn.photo_path,
                       'full_name', sn.full_name,
                       'area', sn.area,
                       'created_at', to_char(sn.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'sticker_code', sn.sticker_code,
                       'item_type', sn.item_type
                   )
               )) as candidates
        from public.wms_task_nm_index ti
        join (
            select s.id as submission_id, elem as nm, s.created_at,
                   s.item_text, s.photo_path, s.full_name, s.area, s.sticker_code, s.item_type
            from public.intake_submissions s,
                 jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) as elem
            where s.matched_task_id is null
        ) sn on sn.nm = ti.nm
        where ti.movement is not null
          and sn.created_at >= (ti.movement - interval '1 day')
          and sn.created_at < (ti.movement + interval '6 day')
        group by ti.task_id
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

create or replace function public.wms_no_shk_pending_tasks(p_limit int default 100)
returns setof public.wms_tasks
language sql
security definer
set search_path = public
stable
as $$
    select *
    from public.wms_tasks
    where is_deleted = false
      and has_pending_no_shk_match = true
      and opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
    order by updated_at desc
    limit greatest(p_limit, 0);
$$;

update public.wms_tasks
set has_pending_no_shk_match = false
where opp_verdict = 'Система - Движение'
  and has_pending_no_shk_match = true;
