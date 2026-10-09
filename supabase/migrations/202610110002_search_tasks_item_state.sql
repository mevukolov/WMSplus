-- Фаза 3.3: поиск по конкретному ШК возвращал вердикт/статус/зону ВСЕЙ
-- строки задачи, даже если именно этот ШК разошёлся с родителем (зона
-- "Чистые списания"). Тот же паттерн, что уже использовался для
-- wms_no_shk_item_task_matches (кандидат A) -- left join на
-- wms_task_items по найденному идентификатору, coalesce в пользу строки
-- конкретного ШК.
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
    select t.id, t.title,
           coalesce(wi.task_type, t.task_type) as task_type,
           t.source_shk_ids, t.source_tare_id, t.source_id,
           t.source_price_sum,
           coalesce(wi.task_status, t.task_status) as task_status,
           coalesce(wi.opp_verdict, t.opp_verdict) as opp_verdict,
           t.tags, t.source_payload -> 'special_infos', t.search_text, t.created_at, t.due_date
    from public.wms_tasks t
    cross join q
    left join public.wms_task_items wi on wi.task_id = t.id and wi.shk = q.ident
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
