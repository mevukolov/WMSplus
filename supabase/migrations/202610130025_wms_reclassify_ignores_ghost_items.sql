-- Продолжение 202610130024. Та версия считала "сошлись ли ШК на
-- одну зону" по ВСЕМ строкам wms_task_items этой задачи -- но
-- wms_task_items может содержать "призрачные" строки для ШК, которых
-- уже нет в актуальном wms_tasks.source_shk_ids родителя (например,
-- ШК убрали из тары более поздней выгрузкой, а сама строка
-- wms_task_items никогда не чистится). Такой призрачный ШК не виден
-- ни в карточке, ни в поиске задач по ШК (queryTaskSearch в tasks.js
-- ищёт именно по source_shk_ids) -- но раньше мог бесконечно
-- блокировать синхронизацию родителя, т.к. "не сошлось".
-- Теперь в расчёт идут только строки wms_task_items, чей shk
-- действительно есть в source_shk_ids родителя -- то есть
-- "по тому, что сейчас реально находится в карточке".
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

    select distinct ti.task_type into v_unified_type
    from public.wms_task_items ti
    join public.wms_tasks t on t.id = ti.task_id
    where ti.task_id = p_task_id
      and ti.task_status <> 'Завершено'
      and ti.shk = any(t.source_shk_ids);

    if v_unified_type is not null and (
        select count(distinct ti.task_type) from public.wms_task_items ti
        join public.wms_tasks t on t.id = ti.task_id
        where ti.task_id = p_task_id
          and ti.task_status <> 'Завершено'
          and ti.shk = any(t.source_shk_ids)
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
