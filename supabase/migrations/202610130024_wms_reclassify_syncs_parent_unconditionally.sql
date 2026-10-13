-- Продолжение 202610130023. Та версия синхронизировала родителя
-- только КАК ПОБОЧНЫЙ ЭФФЕКТ реальной переклассификации ШК (когда
-- wms_compute_reroute_target находит, что текущая зона ШК отличается
-- от целевой). Но если ШК уже стоит на целевой зоне (например,
-- правило вернули на прежнее значение, а ШК там уже оказался из
-- более раннего свипа) -- reroute ничего не находит, функция выходит
-- раньше, и родитель навсегда остаётся отставшим. Теперь синк
-- родителя считается ВСЕГДА при каждом вызове, а не только когда сам
-- ШК только что переехал.
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
    v_item_changed boolean := false;
    v_parent_changed_rows integer := 0;
begin
    select * into v_target from public.wms_compute_reroute_target(p_task_id, p_shk);

    if v_target.target_zone is not null then
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

        v_item_changed := true;
    end if;

    -- Карточка/Предразбор берут папку из wms_tasks.task_type (родитель).
    -- Синхронизируем его, когда все ещё активные ШК сошлись на одной
    -- зоне -- независимо от того, переехал ли именно ЭТОТ ШК прямо
    -- сейчас (см. комментарий выше).
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
        get diagnostics v_parent_changed_rows = row_count;
    end if;

    return v_item_changed or v_parent_changed_rows > 0;
end;
$$;

grant execute on function public.wms_reclassify_active_item(uuid, text, boolean) to anon, authenticated;
