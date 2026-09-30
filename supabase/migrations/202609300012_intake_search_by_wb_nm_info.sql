-- p_query in "Лента без ШК" (wms_intake_submissions_search) only ever
-- fuzzy-matched item_text/category -- the operator's own typed label.
-- Now that wms_nm_directory resolves most photo candidates to a real WB
-- name/brand, a photo the operator mislabeled ("Масло для тела") should
-- still turn up when searching the name WB actually recognized
-- ("оливковое"). Folds every resolved candidate's name+brand into the
-- same haystack the existing word_similarity check already runs against,
-- rather than adding a separate OR-branch -- keeps the "every query word
-- must match something" semantics intact, just widens what counts as
-- "something". Return shape is unchanged from 202609300010, so this is a
-- plain CREATE OR REPLACE, no drop needed.
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
    select s.id, s.item_text, s.category, s.item_type, s.area, s.full_name, s.employee_id,
           s.shift_date, s.shift_type, s.no_shk_bucket, s.created_at, s.photo_path, s.sticker_code,
           s.wb_nm_candidates, s.wb_nm_checked_at,
           (
               select jsonb_agg(jsonb_build_object('nm', cand.nm, 'name', d.name, 'brand', d.brand) order by cand.ord)
               from jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) with ordinality as cand(nm, ord)
               left join public.wms_nm_directory d on d.nm = cand.nm
           ) as wb_nm_info,
           s.matched_task_id, s.matched_shk
    from public.intake_submissions s
    where (p_areas is null or area = any(p_areas))
      and (p_categories is null or category = any(p_categories))
      and (p_item_types is null or item_type = any(p_item_types))
      and (
        p_employee_query is null
        or full_name ilike '%' || p_employee_query || '%'
        or employee_id::text ilike '%' || p_employee_query || '%'
      )
      and (p_date_from is null or shift_date >= p_date_from)
      and (p_date_to is null or shift_date <= p_date_to)
      and (not p_unassigned_only or sticker_code is null)
      and (
        p_query is null or trim(p_query) = ''
        or not exists (
            select 1
            from unnest(regexp_split_to_array(lower(trim(p_query)), '\s+')) as qw
            where word_similarity(qw, lower(
                coalesce(s.item_text, '') || ' ' || coalesce(s.category, '') || ' ' ||
                coalesce((
                    select string_agg(coalesce(d.name, '') || ' ' || coalesce(d.brand, ''), ' ')
                    from jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) cand(nm)
                    join public.wms_nm_directory d on d.nm = cand.nm
                ), '')
            )) < 0.3
        )
      )
    order by s.created_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0);
$$;

grant execute on function public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int, boolean) to anon;
