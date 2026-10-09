-- Когда движок создаёт новую задачу для группы (зона, значение tare_id),
-- он проставляет routing_group_key -- уникальный индекс не даст случайно
-- завести вторую активную задачу для той же пары (зона, тара).
alter table public.wms_tasks add column routing_group_key text;

create unique index wms_tasks_routing_group_active_unique
    on public.wms_tasks (task_type, routing_group_key)
    where is_deleted = false and task_status <> 'Завершено' and routing_group_key is not null;
