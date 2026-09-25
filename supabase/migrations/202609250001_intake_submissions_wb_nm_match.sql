-- "Вероятные номенклатуры" в ленте «Без ШК»: для каждого фото товара без
-- ШК храним список артикулов (nm) WB, которые вернул поиск по фото --
-- заполняется Edge Function wb-photo-match (см. 202609250002), раз в
-- минуту подбирающей необработанные строки.

alter table public.intake_submissions
    add column if not exists wb_nm_candidates jsonb,
    add column if not exists wb_nm_checked_at timestamptz;

-- Быстрая выборка следующей необработанной пачки (фото есть, ещё не
-- проверяли через WB). Партиционируется самим условием -- индекс не
-- растёт после того, как бэклог разобран, т.к. проверенные строки
-- выпадают из него.
create index if not exists intake_submissions_wb_nm_unchecked_idx
    on public.intake_submissions (created_at)
    where wb_nm_checked_at is null and photo_path is not null;

-- wms_intake_submissions_search должна отдавать новую колонку фронту.
-- Postgres не даёт CREATE OR REPLACE менять состав RETURNS TABLE --
-- дропаем и создаём заново (тот же приём, что в 202609090004).
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
    wb_nm_candidates jsonb
)
language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, employee_id,
           shift_date, shift_type, no_shk_bucket, created_at, photo_path, sticker_code,
           wb_nm_candidates
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
