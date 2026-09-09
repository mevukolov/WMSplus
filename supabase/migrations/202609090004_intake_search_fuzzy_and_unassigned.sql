-- "Лента «Без ШК»" search improvements:
-- 1. p_query now matches against item_text AND category combined, and is
--    word-order-independent + tolerant of Russian declensions/plurals/
--    diminutives (ковёр/ковры/коврик/ковролин) via pg_trgm's
--    word_similarity rather than a plain substring match. Every word the
--    user typed must find *some* similar-enough word in the combined
--    text (order doesn't matter since each word is checked independently).
-- 2. New p_unassigned_only flag ("Без оприхода" checkbox) restricts
--    results to items with no sticker_code yet. Appended as a trailing
--    parameter with a default, so CREATE OR REPLACE can add it without
--    dropping the function (no existing parameter changes).
create extension if not exists pg_trgm;

-- CREATE OR REPLACE does NOT treat "append a trailing defaulted param" as
-- an in-place replace -- Postgres resolves it as a distinct overload by
-- argument list, leaving the old 9-arg version callable too (and
-- ambiguous against the new one for named-parameter RPC calls that omit
-- p_unassigned_only). Drop the old signature explicitly first.
drop function if exists public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int);

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
