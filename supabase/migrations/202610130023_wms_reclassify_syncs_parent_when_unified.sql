-- Фаза 2a переклассифицирует только wms_task_items.task_type (строго
-- per-ШК -- чтобы разошедшиеся ШК внутри одной тары могли иметь
-- разные зоны). Но карточка задачи и "Предразбор" берут папку из
-- wms_tasks.task_type (родитель), который этот механизм никогда не
-- трогал -- даже когда в задаче всего один ШК и расхождения нет,
-- оператор видел "Sweep прошёл", но карточка оставалась в старой
-- папке. Если ПОСЛЕ переклассификации все ещё активные ШК задачи
-- сошлись на одну и ту же зону (нет расхождения) -- переносим и
-- родителя, чтобы Предразбор сразу отражал результат.
create or replace function public.wms_reclassify_active_item(
    p_task_id uuid,
    p_shk text,
    p_bypass_active_guard boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target record;
    v_parent_status text;
    v_unified_type text;
begin
    select * into v_target from public.wms_compute_reroute_target(p_task_id, p_shk);
    if v_target.target_zone is null then
        return false;
    end if;

    select task_status into v_parent_status from public.wms_tasks where id = p_task_id;
    if v_parent_status = 'Не начато' and not p_bypass_active_guard then
        return false;
    end if;

    update public.wms_task_items
    set task_type = v_target.target_zone,
        zone_payload = '{}'::jsonb,
        updated_at = timezone('utc', now())
    where task_id = p_task_id and shk = p_shk;

    insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
    values (
        p_task_id, 'task_item_rerouted_by_rule', 'Система', '',
        jsonb_build_object(
            'shk', p_shk, 'rule_id', v_target.rule_id, 'rule_name', v_target.rule_name,
            'old_zone', v_target.current_zone, 'new_zone', v_target.target_zone,
            'sweep', p_bypass_active_guard
        )
    );

    select distinct task_type into v_unified_type
    from public.wms_task_items
    where task_id = p_task_id and task_status <> 'Завершено';

    if v_unified_type is not null and (
        select count(distinct task_type) from public.wms_task_items
        where task_id = p_task_id and task_status <> 'Завершено'
    ) = 1 then
        update public.wms_tasks
        set task_type = v_unified_type, updated_at = timezone('utc', now())
        where id = p_task_id and task_type <> v_unified_type;
    end if;

    return true;
end;
$$;

grant execute on function public.wms_reclassify_active_item(uuid, text, boolean) to anon, authenticated;
