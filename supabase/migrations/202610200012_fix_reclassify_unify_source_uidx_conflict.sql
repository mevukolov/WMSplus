-- Баг: при завершении задачи триггер wms_tasks_route_on_release дергает
-- wms_reclassify_active_item, который в конце пытается "подровнять"
-- task_type родительской задачи под вычисленную целевую зону. Если для
-- того же (source_module, source_id) уже существует ДРУГАЯ задача с таким
-- task_type (например, повторная выгрузка того же ШК создала новую задачу
-- под другим участком, пока старая уже завершена под прежним), UPDATE
-- падает с duplicate key value violates unique constraint
-- "wms_tasks_source_uidx". Воспроизведено и исправление проверено
-- begin/rollback на реальной задаче (ШК 58985085753, id
-- 4b713199-db6d-4d40-976e-3fb0ccd57457 конфликтовал с завершённой
-- f17a5846-fa91-428b-8f80-07f01fe1773e, обе task_type="Разбор ОПП // ПЦ").
-- Фикс: unify-update пропускается (task_type остаётся как есть), если
-- целевая комбинация уже занята другой задачей -- не блокирует завершение.
create or replace function public.wms_reclassify_active_item(p_task_id uuid, p_shk text, p_bypass_active_guard boolean default false)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_target record;
    v_parent_status text;
    v_unified_type text;
    v_item_changed boolean := false;
    v_parent_changed_rows integer := 0;
    v_source_module text;
    v_source_id text;
begin
    select * into v_target from public.wms_compute_reroute_target(p_task_id, p_shk);

    if v_target.target_zone is not null then
        select task_status into v_parent_status from public.wms_tasks where id = p_task_id;
        if v_parent_status = 'Не начато' and not p_bypass_active_guard then return false; end if;

        update public.wms_task_items set task_type = v_target.target_zone, zone_payload = '{}'::jsonb, updated_at = timezone('utc', now())
            where task_id = p_task_id and shk = p_shk;
        insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
            values (p_task_id, 'task_item_rerouted_by_rule', 'Система', '',
                jsonb_build_object('shk', p_shk, 'rule_id', v_target.rule_id, 'rule_name', v_target.rule_name,
                    'old_zone', v_target.current_zone, 'new_zone', v_target.target_zone, 'sweep', p_bypass_active_guard));
        v_item_changed := true;
    end if;

    select distinct ti.task_type into v_unified_type
        from public.wms_task_items ti join public.wms_tasks t on t.id = ti.task_id
        where ti.task_id = p_task_id and ti.task_status <> 'Завершено' and ti.shk = any(t.source_shk_ids);
    if v_unified_type is not null and (
        select count(distinct ti.task_type) from public.wms_task_items ti join public.wms_tasks t on t.id = ti.task_id
        where ti.task_id = p_task_id and ti.task_status <> 'Завершено' and ti.shk = any(t.source_shk_ids)
    ) = 1 then
        select source_module, source_id into v_source_module, v_source_id from public.wms_tasks where id = p_task_id;
        update public.wms_tasks set task_type = v_unified_type, updated_at = timezone('utc', now())
            where id = p_task_id and task_type <> v_unified_type
              and not exists (
                  select 1 from public.wms_tasks t2
                  where t2.id <> p_task_id
                    and t2.source_module = v_source_module
                    and t2.source_id = v_source_id
                    and t2.task_type = v_unified_type
              );
        get diagnostics v_parent_changed_rows = row_count;
    end if;
    return v_item_changed or v_parent_changed_rows > 0;
end;
$function$;
