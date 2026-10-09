-- Фаза 3.5: родительская строка wms_tasks считается "Завершено", когда
-- ВСЕ её строки wms_task_items стали "Завершено". Сознательно узкое
-- правило -- срабатывает только когда конкретный ШК переходит в
-- "Завершено", не агрегирует opp_verdict (не определено осмысленно при
-- разных вердиктах), не трогает промежуточные состояния. На практике
-- почти никогда не сработает сегодня (мало реально смешанных тар) --
-- это фундамент на будущее, если появится вторая зона с расхождением.
create or replace function public.wms_sync_parent_task_status_from_items() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_all_done boolean;
begin
    select bool_and(task_status = 'Завершено') into v_all_done
    from public.wms_task_items
    where task_id = new.task_id;

    if v_all_done then
        update public.wms_tasks
        set task_status = 'Завершено', updated_at = now()
        where id = new.task_id and task_status <> 'Завершено';
    end if;
    return new;
end;
$$;

create trigger wms_task_items_sync_parent_status
    after update of task_status on public.wms_task_items
    for each row
    when (new.task_status = 'Завершено')
    execute function public.wms_sync_parent_task_status_from_items();
