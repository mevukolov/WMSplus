-- Закрытие/отложение задачи сохраняет wms_review в source_payload. Раньше
-- это запускало wms_sync_task_items() даже когда сам список task_items не
-- менялся. На крупных тарах триггер повторно обходил и перераспределял все
-- ШК, из-за чего обычное сохранение вердикта могло упасть по
-- statement_timeout.
--
-- Статус дочерних строк всё так же синхронизирует отдельный триггер
-- wms_tasks_sync_items_from_status (202610150008). Этот триггер нужен
-- только для реального изменения состава/полей task_items.

drop trigger if exists wms_tasks_sync_task_items_update on public.wms_tasks;

create trigger wms_tasks_sync_task_items_update
    after update of source_payload on public.wms_tasks
    for each row
    when ((old.source_payload -> 'task_items') is distinct from (new.source_payload -> 'task_items'))
    execute function public.wms_sync_task_items();
