-- Surface sticker_code (the ШК assigned to a Шредер/Упаковка/Товар-льётся
-- item during the sticker-scan step) in both existing read paths, so the
-- "Открыть содержимое" box feed and the "Поиск товара без ШК" search feed
-- can show it. Postgres won't let CREATE OR REPLACE add a column to a
-- RETURNS TABLE function's result shape -- that's a return-type change --
-- so both are dropped and recreated; the anon EXECUTE grant is re-issued
-- since DROP FUNCTION drops it too.

drop function if exists public.wms_no_shk_box_contents(uuid);
drop function if exists public.wms_intake_submissions_search(text, text, text, text, date, date, text, int, int);

create function public.wms_no_shk_box_contents(p_box_id uuid)
returns table (
    item_text text,
    category text,
    item_type text,
    full_name text,
    created_at timestamptz,
    photo_path text,
    sticker_code text
)
language sql
security definer
set search_path = public
stable
as $$
    select item_text, category, item_type, full_name, created_at, photo_path, sticker_code
    from public.intake_submissions
    where box_id = p_box_id
    order by created_at asc;
$$;

create function public.wms_intake_submissions_search(
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

grant execute on function public.wms_no_shk_box_contents(uuid) to anon;
grant execute on function public.wms_intake_submissions_search(text, text, text, text, date, date, text, int, int) to anon;
