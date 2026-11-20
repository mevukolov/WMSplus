-- При завершении задачи wms_tasks_route_on_release срабатывал раньше,
-- чем wms_tasks_sync_items_from_status. Поэтому для каждого ШК уже
-- закрываемой тары запускалась дорогая wms_reclassify_active_item():
-- она обходит правила маршрутизации и пишет историю, хотя после
-- завершения ШК больше не участвует в активной маршрутизации.
--
-- Реклассификация нужна только при ручном отложении: такая задача
-- остаётся активной и её ШК должны пересчитаться. При «Завершено»
-- дочерние статусы синхронизирует wms_tasks_sync_items_from_status,
-- без ненужного цикла маршрутизации в той же транзакции.

drop trigger if exists wms_tasks_route_on_release on public.wms_tasks;

create trigger wms_tasks_route_on_release
    after update of task_status on public.wms_tasks
    for each row
    when (
        new.task_status = 'Отложено'
        and old.task_status is distinct from new.task_status
    )
    execute function public.wms_tasks_route_released_items();
