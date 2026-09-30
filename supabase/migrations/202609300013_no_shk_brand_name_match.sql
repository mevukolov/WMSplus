-- "Быстрая проверка «Без ШК»" (renderReviewNoShkCheckModal / wms_no_shk_
-- pending_tasks) наполняется wms_no_shk_bulk_match_and_persist, которая
-- до сих пор матчила только по точному nm -- а nm у WB это точный SKU
-- (разные цвета/размеры одного товара -- разные nm), так что точное
-- попадание редкое. Добавляет второй, независимый путь: совпадение по
-- бренду + наименованию (регистро- и пробело-нечувствительно) через
-- wms_nm_directory, в том же окне дат, что и у nm-пути. Both a real
-- brand and a real name required -- пустой/служебный WB-плейсхолдер
-- "Нет бренда" исключён явно, иначе получим ложные совпадения между
-- вообще не связанными товарами без бренда с похожим названием.
--
-- Оба пути объединяются UNION ALL и дедуплицируются на уровне
-- jsonb_agg(distinct ...) -- как и раньше, просто теперь source-пар
-- для группировки больше.
create index if not exists wms_nm_directory_brand_name_idx
    on public.wms_nm_directory (lower(trim(brand)), lower(trim(name)))
    where brand is not null and trim(brand) <> '' and lower(trim(brand)) <> 'нет бренда'
      and name is not null and trim(name) <> '';

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
        with wb_candidates as (
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

            -- Path 2: same brand+name via wms_nm_directory -- catches a
            -- different-variant nm WB's photo guess returned for what is
            -- really the same product as the task's own item.
            select ti.task_id, sn.*
            from public.wms_task_nm_index ti
            join public.wms_nm_directory dt
                on dt.nm = ti.nm
               and dt.brand is not null and trim(dt.brand) <> '' and lower(trim(dt.brand)) <> 'нет бренда'
               and dt.name is not null and trim(dt.name) <> ''
            join public.wms_nm_directory dc
                on lower(trim(dc.brand)) = lower(trim(dt.brand))
               and lower(trim(dc.name)) = lower(trim(dt.name))
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
