-- "2shk_rep приоритетнее задач": drop the NOT EXISTS-against-wms_tasks
-- filter that used to hide a 2shk_rep fixation once a task existed for its
-- ШК -- now the 2shk_rep record always shows (and search.js renders its
-- group before the tasks group), the fixation itself is the source of
-- truth for "Два ШК"/"Пустая упаковка", a task carrying the same tag is
-- secondary. Also surfaces media2 (2shk_rep has two link columns, search.js
-- renders both as buttons when present) and renames away from
-- "_unmatched" since that's no longer what it does.
drop function if exists public.wms_search_two_shk_unmatched(text, date, text[]);

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
    order by r.created_at desc
    limit 40;
$$;

grant execute on function public.wms_search_two_shk(text, date, text[]) to authenticated;
