-- Root cause of "Вероятные номенклатуры: проверяется..." showing forever
-- on many (especially old) "Без ШК" items: wms_intake_submissions_search
-- -- the RPC behind "Лента без ШК" (intake_search.js) -- never selected
-- wb_nm_checked_at, only wb_nm_candidates. openPhotoLightbox
-- (intake_search.js) shows the "проверяется..." placeholder whenever
-- !item.wb_nm_checked_at, so with that column always undefined, every
-- item that genuinely got checked but came back with zero candidates
-- (the common case for older items, long since processed by
-- wb-photo-match) looked stuck "checking" forever -- nothing was ever
-- actually retried, the UI just never learned the check had finished.
-- Same class of bug already fixed for wms_no_shk_box_contents in
-- 202609300004; this is the other, more visible place it was missing.
drop function if exists public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int, boolean);

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
    matched_task_id uuid,
    matched_shk text
)
language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, employee_id,
           shift_date, shift_type, no_shk_bucket, created_at, photo_path, sticker_code,
           wb_nm_candidates, wb_nm_checked_at, matched_task_id, matched_shk
    from public.intake_submissions
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
            where word_similarity(qw, lower(coalesce(item_text, '') || ' ' || coalesce(category, ''))) < 0.3
        )
      )
    order by created_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0);
$$;

grant execute on function public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int, boolean) to anon;
