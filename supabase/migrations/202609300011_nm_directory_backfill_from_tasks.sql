-- One-time backfill: wms_nm_directory only started filling going forward
-- (Superset actualization uploads, wb-photo-match top-up) from
-- 202609300005 onward -- but every task ever touched by a past
-- actualization already carries nm/name on its own task_items (see
-- tasks.js's itemNomenclature/applySupersetNomenclatureToItem), for free,
-- no WB lookup needed. Pulls that straight into the directory instead of
-- waiting for those same nm's to resurface via a future actualization
-- upload or a WB photo-candidate match.
--
-- No brand here -- task_items never carried it (brand capture only
-- started with 202609300005's syncNmDirectoryFromSuperset going
-- forward). A task-confirmed name is more trustworthy than a WB photo
-- guess, so this upgrades any existing 'wb'-sourced row for the same nm;
-- it never touches a row already sourced from 'superset' or an earlier
-- backfill pass (nothing new to add there).
insert into public.wms_nm_directory (nm, name, brand, source, updated_at)
select nm, name, null, 'task_backfill', now()
from (
    select distinct on (nm) nm, name
    from (
        select
            coalesce(nullif(trim(item->>'nm'), ''), nullif(trim(item->>'nm_id'), ''), nullif(trim(item->>'nmId'), '')) as nm,
            nullif(trim(item->>'name'), '') as name,
            t.updated_at
        from public.wms_tasks t,
             jsonb_array_elements(coalesce(t.source_payload->'task_items', '[]'::jsonb)) as item
        where t.is_deleted = false
    ) raw
    where nm is not null and name is not null
    order by nm, updated_at desc
) picked
on conflict (nm) do update
    set name = case when wms_nm_directory.source = 'wb' then excluded.name else wms_nm_directory.name end,
        source = case when wms_nm_directory.source = 'wb' then 'task_backfill' else wms_nm_directory.source end,
        updated_at = case when wms_nm_directory.source = 'wb' then excluded.updated_at else wms_nm_directory.updated_at end;
