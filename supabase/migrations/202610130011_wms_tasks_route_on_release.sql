-- Фаза 2a: отложенная пересборка. Пока задача "Не начато", триггер на
-- wms_superset_cache молча пропускает несовпадения зоны (защита в
-- wms_reclassify_active_item). Этот триггер разрешает их в момент,
-- когда задача наконец освобождается -- переходит в "Завершено" или
-- "Отложено".
create or replace function public.wms_tasks_route_released_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
begin
    for v_row in
        select shk from public.wms_task_items
        where task_id = new.id and task_status <> 'Завершено'
    loop
        perform public.wms_reclassify_active_item(new.id, v_row.shk, false);
    end loop;
    return null;
end;
$$;

drop trigger if exists wms_tasks_route_on_release on public.wms_tasks;
create trigger wms_tasks_route_on_release
    after update of task_status on public.wms_tasks
    for each row
    when (new.task_status in ('Завершено', 'Отложено')
          and old.task_status is distinct from new.task_status)
    execute function public.wms_tasks_route_released_items();
