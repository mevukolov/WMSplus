-- "Поиск товара без ШК" UX rework: area/category/item_type filters become
-- checkbox multi-select (send arrays, empty/null array = no filter on that
-- dimension), and the employee filter now matches either full name or
-- employee_id (typed as one free-text field). Signature changed (not just
-- defaults), so drop + recreate rather than CREATE OR REPLACE.

drop function if exists public.wms_intake_submissions_search(text, text, text, text, date, date, text, int, int);
drop function if exists public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int);

create function public.wms_intake_submissions_search(
    p_areas text[] default null,
    p_categories text[] default null,
    p_item_types text[] default null,
    p_employee_query text default null,
    p_date_from date default null,
    p_date_to date default null,
    p_query text default null,
    p_limit int default 50,
    p_offset int default 0
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
    sticker_code text
)
language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, employee_id,
           shift_date, shift_type, no_shk_bucket, created_at, photo_path, sticker_code
    from public.intake_submissions
    -- Note: null means "no filter" (all match); a non-null array with zero
    -- elements is a deliberate "nothing selected" from the UI and correctly
    -- matches no rows (area = any('{}') is false for every row).
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
      and (p_query is null or item_text ilike '%' || p_query || '%')
    order by created_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0);
$$;

grant execute on function public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int) to anon;
