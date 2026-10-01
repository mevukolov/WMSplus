-- Path 2 (202609300013) required EXACT brand+name equality -- measured on
-- real data this found almost nothing, since "Наименование" varies by a
-- word or two between sources even for the same real product. Moves Path 2
-- to similarity-based matching via pg_trgm, which is already installed.
--
-- Measured on real wms_nm_directory data before picking thresholds: for
-- genuinely-same-product pairs (same WB card, different size/color nm),
-- brand matches exactly 84% of the time and avg similarity is 0.85 --
-- brand is actually a strong, low-noise signal, not a noisy one. The ~16%
-- of same-name pairs with near-zero brand similarity were checked by hand
-- and turned out to be unrelated products from different sellers who
-- copied the same generic listing text (seeds, chargers, screws, etc.) --
-- i.e. low brand similarity is itself a real "different product" signal,
-- not noise to smooth over. So brand and name each get their OWN
-- similarity floor, required independently (AND, not a blended score) --
-- a perfect name match must not paper over an unrelated brand.
--   similarity(name)  >= 0.5   (name carries more real-world noise)
--   similarity(brand) >= 0.35  (small formatting/case/abbreviation slack)
--
-- This still leads to a human decision (Опознать / Не тот товар) in
-- "Быстрая проверка «Без ШК»", not an auto-close -- so recall matters more
-- than for an auto-closing pipeline, but junk pairs still cost the
-- reviewer's time, hence keeping both floors rather than just one.
--
-- Performance: the old equality index can't serve a similarity join, so
-- it's replaced with GIN trigram indexes on the normalized columns. The
-- `%` operator (pg_trgm's indexed similarity-threshold operator) does the
-- actual index-assisted narrowing; pg_trgm.similarity_threshold is set to
-- the lower of the two floors (0.35) so the index never excludes a row
-- that the subsequent exact similarity() check would still accept -- the
-- real 0.5 floor on name is enforced after, as a plain filter.
create extension if not exists pg_trgm;

drop index if exists public.wms_nm_directory_brand_name_idx;

create index if not exists wms_nm_directory_name_trgm_idx
    on public.wms_nm_directory using gin (lower(trim(name)) gin_trgm_ops)
    where name is not null and trim(name) <> '';

create index if not exists wms_nm_directory_brand_trgm_idx
    on public.wms_nm_directory using gin (lower(trim(brand)) gin_trgm_ops)
    where brand is not null and trim(brand) <> '' and lower(trim(brand)) <> 'нет бренда';

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

            -- Path 2: similar brand AND similar name via wms_nm_directory --
            -- catches a different-variant nm WB's photo guess returned for
            -- what is really the same product as the task's own item, even
            -- when the two sides' text isn't byte-identical.
            select ti.task_id, sn.*
            from public.wms_task_nm_index ti
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
