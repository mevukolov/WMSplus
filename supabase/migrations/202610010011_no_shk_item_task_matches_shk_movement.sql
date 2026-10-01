-- Правая панель разбора короба должна показывать ШК и дату последнего
-- движения прямо на карточке задачи, не только название -- wms_task_nm_index
-- уже хранит оба поля per-item, просто нужно их вернуть из RPC. Return-тип
-- меняется (новые out-параметры), поэтому дроп обязателен.
drop function if exists public.wms_no_shk_item_task_matches(uuid, text);

create function public.wms_no_shk_item_task_matches(
    p_submission_id uuid,
    p_query text default null
) returns table (
    task_id uuid,
    task_nm text,
    title text,
    price numeric,
    is_tare boolean,
    match_name text,
    match_brand text,
    shk text,
    movement timestamptz
) language plpgsql
security definer
set search_path = public
stable
as $$
declare
    v_candidate_nms text[];
    v_query text := nullif(trim(coalesce(p_query, '')), '');
begin
    perform set_config('pg_trgm.similarity_threshold', '0.35', true);

    if v_query is not null then
        if v_query ~ '^[0-9]+$' then
            return query
            select distinct ti.task_id, ti.nm, t.title, t.source_price_sum,
                   (t.source_tare_id is not null and t.source_tare_id <> '0'),
                   coalesce(d.name, ''), coalesce(d.brand, ''), ti.shk, ti.movement
            from public.wms_task_nm_index ti
            join public.wms_tasks t on t.id = ti.task_id
            left join public.wms_nm_directory d on d.nm = ti.nm
            where t.is_deleted = false
              and t.opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
              and (ti.nm = v_query
                   or exists (select 1 from jsonb_array_elements_text(coalesce(t.source_shk_ids, '[]'::jsonb)) s where s = v_query))
            limit 60;
            return;
        end if;

        return query
        select distinct ti.task_id, ti.nm, t.title, t.source_price_sum,
               (t.source_tare_id is not null and t.source_tare_id <> '0'),
               d.name, d.brand, ti.shk, ti.movement
        from public.wms_nm_directory d
        join public.wms_task_nm_index ti on ti.nm = d.nm
        join public.wms_tasks t on t.id = ti.task_id
        where t.is_deleted = false
          and t.opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
          and (lower(d.name) like '%' || lower(v_query) || '%' or lower(d.brand) like '%' || lower(v_query) || '%')
        limit 60;
        return;
    end if;

    select array_agg(distinct elem) into v_candidate_nms
    from public.intake_submissions s, jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) elem
    where s.id = p_submission_id;

    if v_candidate_nms is null or array_length(v_candidate_nms, 1) = 0 then
        return;
    end if;

    return query
    select distinct ti.task_id, ti.nm, t.title, t.source_price_sum,
           (t.source_tare_id is not null and t.source_tare_id <> '0'),
           coalesce(d.name, ''), coalesce(d.brand, ''), ti.shk, ti.movement
    from public.wms_task_nm_index ti
    join public.wms_tasks t on t.id = ti.task_id
    left join public.wms_nm_directory d on d.nm = ti.nm
    where t.is_deleted = false
      and t.opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
      and ti.nm = any(v_candidate_nms)

    union

    select distinct ti.task_id, ti.nm, t.title, t.source_price_sum,
           (t.source_tare_id is not null and t.source_tare_id <> '0'),
           dt.name, dt.brand, ti.shk, ti.movement
    from public.wms_task_nm_index ti
    join public.wms_tasks t on t.id = ti.task_id
    join public.wms_nm_directory dt
        on dt.nm = ti.nm
       and dt.brand is not null and trim(dt.brand) <> '' and lower(trim(dt.brand)) <> 'нет бренда'
       and dt.name is not null and trim(dt.name) <> ''
    join public.wms_nm_directory dc
        on dc.nm = any(v_candidate_nms)
       and lower(trim(dc.name)) % lower(trim(dt.name))
       and lower(trim(dc.brand)) % lower(trim(dt.brand))
       and similarity(lower(trim(dc.name)), lower(trim(dt.name))) >= 0.5
       and similarity(lower(trim(dc.brand)), lower(trim(dt.brand))) >= 0.35
       and dc.brand is not null and trim(dc.brand) <> '' and lower(trim(dc.brand)) <> 'нет бренда'
       and dc.name is not null and trim(dc.name) <> ''
    where t.is_deleted = false
      and t.opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
    limit 60;
end;
$$;

grant execute on function public.wms_no_shk_item_task_matches(uuid, text) to anon;
