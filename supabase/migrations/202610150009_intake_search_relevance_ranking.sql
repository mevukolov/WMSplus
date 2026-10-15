-- Лента "Без ШК": wms_intake_submissions_search ordered purely by
-- created_at desc, even with a search query -- the word_similarity match
-- (threshold 0.3) only filtered which rows qualified, never how well they
-- matched. A loose multi-word fuzzy query ("футболка") could pull in
-- dozens of barely-qualifying rows, and the best actual match could land
-- on page 2 just because it's older than today's barely-relevant uploads.
--
-- First attempt (sum of word_similarity against item_text+category+ALL
-- wb_nm_candidates concatenated into one haystack) looked right in
-- isolation but failed on real data: some submissions carry dozens of
-- wb_nm_candidates, and concatenating them all into one blob means any
-- ONE coincidental candidate containing the query word scores 1.0 --
-- confirmed live, a "Трусы" ("underwear") row outranked genuine
-- "Футболка" rows because one of its ~20 candidate names happened to be
-- "...женская футболка с коротким рукавом". The candidate list is a
-- noisy secondary signal (automated WB-photo matching), not the
-- operator's own label -- it must never outweigh a genuine item_text/
-- category match.
--
-- Fix: score item_text+category and the wb_nm candidate blob SEPARATELY,
-- weight the operator's own label 3x over the candidate blob, take the
-- better of the two per query word, sum across words ("чем больше
-- совпало -- тем выше"). Inclusion threshold (0.3) still checks either
-- haystack, preserving the existing broad-match recall -- only the
-- ranking changes. No query -- unchanged plain created_at desc.
create or replace function public.wms_intake_submissions_search(
    p_areas text[] default null,
    p_categories text[] default null,
    p_item_types text[] default null,
    p_employee_query text default null,
    p_date_from date default null,
    p_date_to date default null,
    p_query text default null,
    p_limit int default 50,
    p_offset int default 0,
    p_unassigned_only boolean default false
) returns table (
    id uuid,
    item_text text,
    category text,
    item_type text,
    area text,
    full_name text,
    employee_id integer,
    shift_date date,
    shift_type text,
    no_shk_bucket text,
    created_at timestamptz,
    photo_path text,
    sticker_code text,
    wb_nm_candidates jsonb,
    wb_nm_checked_at timestamptz,
    wb_nm_info jsonb,
    matched_task_id uuid,
    matched_shk text
)
language sql
security definer
set search_path = public
stable
as $$
    with matched as (
        select s.*,
               lower(coalesce(s.item_text, '') || ' ' || coalesce(s.category, '')) as label_haystack,
               lower(coalesce((
                   select string_agg(coalesce(d.name, '') || ' ' || coalesce(d.brand, ''), ' ')
                   from jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) cand(nm)
                   join public.wms_nm_directory d on d.nm = cand.nm
               ), '')) as nm_haystack
        from public.intake_submissions s
        where (p_areas is null or s.area = any(p_areas))
          and (p_categories is null or s.category = any(p_categories))
          and (p_item_types is null or s.item_type = any(p_item_types))
          and (
            p_employee_query is null
            or s.full_name ilike '%' || p_employee_query || '%'
            or s.employee_id::text ilike '%' || p_employee_query || '%'
          )
          and (p_date_from is null or s.shift_date >= p_date_from)
          and (p_date_to is null or s.shift_date <= p_date_to)
          and (not p_unassigned_only or s.sticker_code is null)
    ),
    scored as (
        select m.*, sim.relevance, sim.worst_word_sim
        from matched m
        cross join lateral (
            select
                coalesce(sum(greatest(
                    word_similarity(qw, m.label_haystack) * 3,
                    word_similarity(qw, m.nm_haystack)
                )), 0) as relevance,
                coalesce(min(greatest(
                    word_similarity(qw, m.label_haystack),
                    word_similarity(qw, m.nm_haystack)
                )), 1) as worst_word_sim
            from unnest(regexp_split_to_array(lower(trim(coalesce(p_query, ''))), '\s+')) as qw
            where qw <> ''
        ) sim
    )
    select scored.id, scored.item_text, scored.category, scored.item_type, scored.area, scored.full_name,
           scored.employee_id, scored.shift_date, scored.shift_type, scored.no_shk_bucket, scored.created_at,
           scored.photo_path, scored.sticker_code, scored.wb_nm_candidates, scored.wb_nm_checked_at,
           (
               select jsonb_agg(jsonb_build_object('nm', cand.nm, 'name', d.name, 'brand', d.brand) order by cand.ord)
               from jsonb_array_elements_text(coalesce(scored.wb_nm_candidates, '[]'::jsonb)) with ordinality as cand(nm, ord)
               left join public.wms_nm_directory d on d.nm = cand.nm
           ) as wb_nm_info,
           scored.matched_task_id, scored.matched_shk
    from scored
    where p_query is null or trim(p_query) = '' or worst_word_sim >= 0.3
    order by
        case when p_query is null or trim(p_query) = '' then null else relevance end desc nulls last,
        created_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0);
$$;

grant execute on function public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int, boolean) to anon;
