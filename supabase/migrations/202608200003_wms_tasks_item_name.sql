alter table public.wms_tasks
  add column if not exists source_item_name text;

create index if not exists wms_tasks_source_item_name_idx
  on public.wms_tasks (source_item_name)
  where source_item_name is not null;

create or replace function public.sync_wms_task_item_name()
returns trigger
language plpgsql
as $$
begin
  new.source_item_name := coalesce(
    nullif(new.source_payload->>'item_name', ''),
    nullif(new.source_item_name, '')
  );
  return new;
end;
$$;

drop trigger if exists trg_sync_wms_task_item_name on public.wms_tasks;
create trigger trg_sync_wms_task_item_name
before insert or update of source_payload, source_item_name
on public.wms_tasks
for each row
execute function public.sync_wms_task_item_name();

update public.wms_tasks
set source_item_name = coalesce(
  nullif(source_payload->>'item_name', ''),
  nullif(source_payload->'row'->>'name', ''),
  nullif(source_item_name, '')
)
where source_item_name is null
  and (
    nullif(source_payload->>'item_name', '') is not null
    or nullif(source_payload->'row'->>'name', '') is not null
  );
