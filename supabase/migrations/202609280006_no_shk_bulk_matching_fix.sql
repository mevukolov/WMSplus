-- 202609280006_no_shk_bulk_matching_fix.sql
-- wms_sync_task_nm_index's INSERT ... ON CONFLICT DO UPDATE crashed
-- ("cannot affect row a second time") the first time it ran against a real
-- task whose task_items contains two entries sharing the same nm (same
-- article, different ШК -- a real, legitimate shape, e.g. a tare carrying
-- two units of the same product). Postgres refuses to let one INSERT
-- statement's ON CONFLICT DO UPDATE touch the same conflicting row twice.
-- Dedupe by nm before the insert (keep the latest movement per nm) instead.

create or replace function public.wms_sync_task_nm_index() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.wms_task_nm_index where task_id = new.id;
    if new.is_deleted then
        return new;
    end if;
    insert into public.wms_task_nm_index (task_id, nm, movement, shk)
    select new.id, x.nm, max(x.movement), (array_agg(x.shk order by x.movement desc nulls last))[1]
    from (
        select item->>'nm' as nm,
               public.wms_safe_timestamptz(item->>'movement') as movement,
               item->>'shk' as shk
        from jsonb_array_elements(coalesce(new.source_payload->'task_items', '[]'::jsonb)) as item
        where coalesce(item->>'nm', '') <> ''
    ) x
    group by x.nm
    on conflict (task_id, nm) do update set movement = excluded.movement, shk = excluded.shk;
    return new;
end;
$$;

-- Re-run the backfill with the same dedup so tasks that hit the bug above
-- (and any others sharing the same nm-collision shape) get indexed too.
insert into public.wms_task_nm_index (task_id, nm, movement, shk)
select t.id, x.nm, max(x.movement), (array_agg(x.shk order by x.movement desc nulls last))[1]
from public.wms_tasks t,
     lateral (
        select item->>'nm' as nm,
               public.wms_safe_timestamptz(item->>'movement') as movement,
               item->>'shk' as shk
        from jsonb_array_elements(coalesce(t.source_payload->'task_items', '[]'::jsonb)) as item
        where coalesce(item->>'nm', '') <> ''
     ) x
where t.is_deleted = false
group by t.id, x.nm
on conflict (task_id, nm) do update set movement = excluded.movement, shk = excluded.shk;
