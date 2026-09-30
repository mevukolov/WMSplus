-- Backend for the new standalone "Поиск" page (search.html/search.js) --
-- a login-required but menu-less page (no entry in `pages`, so
-- ui.js/checkUserAccess never restricts it -- reachable only by direct
-- link) that searches across intake_submissions ("без ШК"), wms_tasks
-- (regular "Разбор ОПП" tasks, plus the "Два ШК"/"Пустая упаковка" tags
-- already persisted on them), and bare "2shk_rep" fixations that never
-- got folded into a task.
--
-- wms_tasks and "2shk_rep" both already grant authenticated full table
-- access with a blanket RLS policy (see 202609290002's *_authenticated_all
-- policies), so these two RPCs aren't working around RLS -- they exist so
-- the page does one fast server-side-filtered round trip per domain
-- instead of replicating tasks.js's multi-query client-side merge
-- (queryTaskSearch/loadSpecialMap) for a page that has none of that
-- state already in memory.

-- Regular task search: matches a scanned/typed identifier against
-- source_shk_ids/source_tare_id/source_id, or free text against
-- title/search_text (search_text is the denormalized blob tasks.js's own
-- upload path already builds from title+item names+ШК -- see queryTaskSearch
-- for the client-side sibling this mirrors). p_tags, when given, requires
-- the task carry at least one of them (used for the "Два ШК"/"Пустая
-- упаковка" incident filters); null/empty means no tag restriction (used
-- for "Разбор ОПП" or no filter at all -- that decision lives client-side).
create or replace function public.wms_search_tasks(
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
           t.source_price_sum, t.task_status, t.opp_verdict, t.tags, t.created_at, t.due_date
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

-- Bare "2shk_rep" fixations -- ones with no wms_task carrying either shk1
-- or shk2 in source_shk_ids (a task that DOES exist already surfaces this
-- exact fixation via its "Два ШК"/"Пустая упаковка" tag + special-info
-- panel, see taskSpecialInfos in tasks.js -- showing it again here would
-- just be the same event twice). eventtype is free text (see
-- specialTagName in tasks.js for the client-side sibling of this
-- classification); p_tags null/empty means both types.
create or replace function public.wms_search_two_shk_unmatched(
    p_query text default null,
    p_date date default null,
    p_tags text[] default null
)
returns table (
    shk1 text,
    shk2 text,
    event_type text,
    media text,
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
    select r.shk1, r.shk2, r.eventtype, r.media, r.wh_id, r.created_at
    from public."2shk_rep" r, q
    where (p_date is null or r.created_at::date = p_date)
      and (q.ident is null or r.shk1 = q.ident or r.shk2 = q.ident)
      and (
          p_tags is null or array_length(p_tags, 1) is null
          or ('Пустая упаковка' = any(p_tags) and r.eventtype ilike '%пуст%')
          or ('Два ШК' = any(p_tags) and (r.eventtype ilike '%два%' or r.eventtype ilike '%2%шк%' or trim(r.eventtype) = '2'))
      )
      and not exists (
          select 1 from public.wms_tasks t
          where t.is_deleted = false
            and (
                t.source_shk_ids @> array[r.shk1]
                or (r.shk2 is not null and r.shk2 <> '' and t.source_shk_ids @> array[r.shk2])
            )
      )
    order by r.created_at desc
    limit 40;
$$;

grant execute on function public.wms_search_two_shk_unmatched(text, date, text[]) to authenticated;
