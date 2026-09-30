-- A task tagged "Два ШК" carries the actual pair (its own ШК +
-- second_shk) in source_payload.special_infos -- set once at task
-- creation from whatever 2shk_rep had then (see tasks.js's
-- refreshTaskSpecialTags/loadSpecialMap for the write side). The tag pill
-- alone doesn't say what the second ШК even is, so surface this array
-- (not the whole, much larger source_payload) to the search page.
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
    special_infos jsonb,
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
           t.source_price_sum, t.task_status, t.opp_verdict, t.tags,
           t.source_payload -> 'special_infos', t.search_text, t.created_at, t.due_date
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
    order by t.updated_at desc;
$$;

grant execute on function public.wms_search_tasks(text, date, text[]) to authenticated;

-- Same request, applies to all three search RPCs: no LIMIT at all -- a
-- date-only or narrowly-tagged search should return everything that
-- matches, not just the newest 40.
drop function if exists public.wms_search_two_shk(text, date, text[]);

create function public.wms_search_two_shk(
    p_query text default null,
    p_date date default null,
    p_tags text[] default null
)
returns table (
    shk1 text,
    shk2 text,
    event_type text,
    media text,
    media2 text,
    wh_id text,
    created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
    with q as (
        select nullif(regexp_replace(trim(coalesce(p_query, '')), '\s+', '', 'g'), '') as ident
    )
    select r.shk1, r.shk2, r.eventtype, r.media, r.media2, r.wh_id, r.created_at
    from public."2shk_rep" r, q
    where (p_date is null or r.created_at::date = p_date)
      and (q.ident is null or r.shk1 = q.ident or r.shk2 = q.ident)
      and (
          p_tags is null or array_length(p_tags, 1) is null
          or ('Пустая упаковка' = any(p_tags) and r.eventtype ilike '%пуст%')
          or ('Два ШК' = any(p_tags) and (r.eventtype ilike '%два%' or r.eventtype ilike '%2%шк%' or trim(r.eventtype) = '2'))
      )
    order by r.created_at desc;
$$;

grant execute on function public.wms_search_two_shk(text, date, text[]) to authenticated;

drop function if exists public.wms_search_no_shk_items(text, date);

create function public.wms_search_no_shk_items(
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
    order by s.created_at desc;
$$;

grant execute on function public.wms_search_no_shk_items(text, date) to authenticated;
