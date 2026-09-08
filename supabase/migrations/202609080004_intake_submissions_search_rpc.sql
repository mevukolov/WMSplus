-- "Поиск товара без ШК" -- a standalone admin search across every item
-- ever logged through the public intake form, regardless of area or
-- accounting bucket (shift-box items, Шредер, Товар с переупаковки, Брак
-- Бытовая химия -- literally everything in intake_submissions). All
-- filter arguments are optional (null = no filter on that field); passing
-- none returns the most recent rows. Read-only, same access rationale as
-- wms_no_shk_box_contents: intake_submissions itself stays closed to
-- direct SELECT for every role, this function is the sole, narrow read
-- path, granted to anon on the same basis as the rest of this admin
-- app's tables/functions (no real auth layer exists yet).
create or replace function public.wms_intake_submissions_search(
    p_area text default null,
    p_category text default null,
    p_item_type text default null,
    p_full_name text default null,
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
    photo_path text
)
language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, employee_id,
           shift_date, shift_type, no_shk_bucket, created_at, photo_path
    from public.intake_submissions
    where (p_area is null or area = p_area)
      and (p_category is null or category = p_category)
      and (p_item_type is null or item_type = p_item_type)
      and (p_full_name is null or full_name ilike '%' || p_full_name || '%')
      and (p_date_from is null or shift_date >= p_date_from)
      and (p_date_to is null or shift_date <= p_date_to)
      and (p_query is null or item_text ilike '%' || p_query || '%')
    order by created_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0);
$$;

grant execute on function public.wms_intake_submissions_search(text, text, text, text, date, date, text, int, int) to anon;
