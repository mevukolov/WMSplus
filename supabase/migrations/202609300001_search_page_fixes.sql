-- Two fixes for the "Поиск" page (search.html/search.js) reported after
-- first use:
--
-- 1. The "без ШК" domain was calling the shared wms_intake_submissions_search,
--    which (as of a later migration than the one this page was originally
--    built against) matches via pg_trgm word_similarity() at a 0.3
--    threshold -- loose enough that "куртка" pulled in "Корм для куриц"
--    ahead of the actual "Куртка" row. That fuzziness is presumably
--    deliberate for the existing "Лента без ШК" intake-search feature
--    (typo tolerance for warehouse staff), so it's left alone -- this page
--    gets its own strict-substring RPC instead of retuning a shared one.
--
-- 2. wms_search_tasks (202609290005) didn't return search_text, so the
--    page couldn't show which part of a task actually matched a free-text
--    query that hit search_text but not title -- add it to the output.

create or replace function public.wms_search_no_shk_items(
    p_query text default null,
    p_date date default null
)
returns table (
    id uuid,
    item_text text,
    category text,
    item_type text,
    area text,
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
    with q as (
        select nullif('%' || regexp_replace(regexp_replace(trim(coalesce(p_query, '')), '[%_]', ' ', 'g'), '\s+', ' ', 'g') || '%', '%%') as pattern
    )
    select s.id, s.item_text, s.category, s.item_type, s.area, s.full_name,
           s.created_at, s.photo_path, s.sticker_code
    from public.intake_submissions s, q
    where (p_date is null or s.shift_date = p_date)
      and (
          q.pattern is null
          or s.item_text ilike q.pattern
          or s.category ilike q.pattern
          or s.item_type ilike q.pattern
      )
    order by s.created_at desc
    limit 40;
$$;

grant execute on function public.wms_search_no_shk_items(text, date) to authenticated;

drop function if exists public.wms_search_tasks(text, date, text[]);

create function public.wms_search_tasks(
    p_query text default null,
    p_date date default null,
    p_tags text[] default null
)
returns table (
    id uuid,
    title text,
    task_type text,
    source_shk_ids text[],
    source_tare_id text,
    source_id text,
    source_price_sum numeric,
    task_status text,
    opp_verdict text,
    tags jsonb,
    search_text text,
    created_at timestamptz,
    due_date date
)
language sql
security definer
set search_path = public
stable
as $$
    with q as (
        select
            nullif(regexp_replace(trim(coalesce(p_query, '')), '\s+', '', 'g'), '') as ident,
            nullif('%' || regexp_replace(regexp_replace(trim(coalesce(p_query, '')), '[%_]', ' ', 'g'), '\s+', ' ', 'g') || '%', '%%') as pattern
    )
    select t.id, t.title, t.task_type, t.source_shk_ids, t.source_tare_id, t.source_id,
           t.source_price_sum, t.task_status, t.opp_verdict, t.tags, t.search_text, t.created_at, t.due_date
    from public.wms_tasks t, q
    where t.is_deleted = false
      and (p_date is null or t.created_at::date = p_date)
      and (p_tags is null or array_length(p_tags, 1) is null or t.tags ?| p_tags)
      and (
          (q.ident is not null and (
              t.source_shk_ids @> array[q.ident]
              or t.source_tare_id = q.ident
              or t.source_id ilike q.pattern
          ))
          or (q.pattern is not null and (t.title ilike q.pattern or t.search_text ilike q.pattern))
          or (q.ident is null and q.pattern is null)
      )
    order by t.updated_at desc
    limit 40;
$$;

grant execute on function public.wms_search_tasks(text, date, text[]) to authenticated;
