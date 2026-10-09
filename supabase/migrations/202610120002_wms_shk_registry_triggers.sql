-- Триггер 1: любая вставка/обновление строки wms_task_items поддерживает
-- актуальную wms_shk -- current_task_id указывает на активную
-- (незавершённую) задачу, или null, если ШК сейчас завершён.
create or replace function public.wms_sync_shk_registry() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.wms_shk (shk, nm, name, current_task_id, updated_at)
    values (
        new.shk, new.nm, new.name,
        case when new.task_status <> 'Завершено' then new.task_id else null end,
        now()
    )
    on conflict (shk) do update set
        nm = coalesce(nullif(excluded.nm, ''), public.wms_shk.nm),
        name = coalesce(nullif(excluded.name, ''), public.wms_shk.name),
        current_task_id = case when new.task_status <> 'Завершено' then new.task_id else null end,
        updated_at = now();
    return new;
end;
$$;

create trigger wms_task_items_sync_shk
    after insert or update on public.wms_task_items
    for each row
    execute function public.wms_sync_shk_registry();

-- Триггер 2: каждая вставка в wms_task_history зеркалится в
-- wms_shk_history -- по одной строке на каждый ШК, СЕЙЧАС числящийся в
-- этой задаче. Ни один из существующих писателей wms_task_history не
-- трогается -- запись и так идёт в одну таблицу, триггер на неё ловит всё.
create or replace function public.wms_fanout_shk_history() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.wms_shk_history (shk, task_id, event_type, actor_employee_id, actor_name, payload, created_at)
    select wi.shk, new.task_id, new.event_type, new.actor_employee_id, new.actor_name, new.payload, new.created_at
    from public.wms_task_items wi
    where wi.task_id = new.task_id;
    return new;
end;
$$;

create trigger wms_task_history_fanout_to_shk
    after insert on public.wms_task_history
    for each row
    execute function public.wms_fanout_shk_history();
