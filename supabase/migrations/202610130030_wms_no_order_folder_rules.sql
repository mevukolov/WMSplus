-- Админ хочет уметь дробить "Без заказа" на подпапки по статусу через
-- настройки (сейчас это зашито в JS: isNoOrderUsdStatus/
-- isNoOrderTmmStatus, видны только как "скрытые ветки" USD/TMM).
-- Это принципиально НЕ то же самое, что wms_routing_rules
-- output_key='zone' -- те правила глобальны (решают, в какую из
-- верхнеуровневых зон попасть, независимо от происхождения ШК), а тут
-- нужно наоборот: правило должно работать ТОЛЬКО внутри уже
-- защищённой (202610130029) семьи "Без заказа"/USD/TMM, никогда не
-- выходя за её пределы и никогда не покидая её в другую зону.
--
-- Решение: новый output_key='no_order_folder' в той же таблице (тот
-- же движок условий status/MX, тот же wms_rule_conditions_match), но
-- отдельная compute-функция с обратным guard'ом: срабатывает только
-- если текущая зона ШК уже одна из трёх "без заказа". Результат
-- читается из output_value->>'target_task_type' (JSON, как и у любого
-- не-zone output_key в текущей админке) -- не из колонки
-- target_task_type, которая для не-zone правил всегда null.
--
-- "Движение после продажи" сюда не входит -- пользователь явно
-- попросил оставить её "просто как она есть", без этой фичи.
create or replace function public.wms_compute_no_order_folder_target(
    p_task_id uuid, p_shk text
) returns table(current_zone text, target_zone text, rule_id uuid, rule_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_item_task_type text;
    v_status text;
    v_tare_id text;
    v_mx text;
    v_rule record;
    v_rule_target text;
begin
    select ti.task_type into v_item_task_type
    from public.wms_task_items ti
    where ti.task_id = p_task_id and ti.shk = p_shk and ti.task_status <> 'Завершено';

    if v_item_task_type is null or v_item_task_type not in (
        'Разбор ОПП // Без заказа',
        'Разбор ОПП // USD',
        'Разбор ОПП // TMM'
    ) then
        return;
    end if;

    select sc.last_status, sc.last_tare, sc.last_mx into v_status, v_tare_id, v_mx
    from public.wms_superset_cache sc
    where sc.wh_id = '50144199' and sc.shk = p_shk;

    if v_status is null then
        select ti.status, ti.mx into v_status, v_mx
        from public.wms_task_items ti
        where ti.task_id = p_task_id and ti.shk = p_shk;
    end if;

    v_rule := null;
    for v_rule in
        select * from public.wms_routing_rules
        where is_active = true and output_key = 'no_order_folder'
        order by priority asc
    loop
        if public.wms_rule_conditions_match(v_rule.conditions, jsonb_build_object('status', v_status, 'tare_id', v_tare_id, 'mx', v_mx)) then
            exit;
        end if;
        v_rule := null;
    end loop;

    if v_rule is null then
        return;
    end if;

    v_rule_target := v_rule.output_value->>'target_task_type';
    if v_rule_target is null or v_rule_target = v_item_task_type then
        return;
    end if;

    current_zone := v_item_task_type;
    target_zone := v_rule_target;
    rule_id := v_rule.id;
    rule_name := v_rule.name;
    return next;
end;
$$;

grant execute on function public.wms_compute_no_order_folder_target(uuid, text) to anon, authenticated;

-- wms_reclassify_active_item -- тот же единственный вызываемый обоими
-- путями (ручной Sweep и автотриггер при актуализации) -- теперь
-- проверяет и zone-движок, и folder-движок. Они взаимоисключающие по
-- построению (zone-движок игнорирует без-заказ-зоны, folder-движок
-- игнорирует все остальные), поэтому elsif безопасен. Guard "Не
-- начато" применяется к обоим одинаково -- backlog ни зоной, ни
-- папкой не трогаем без явного Sweep.
create or replace function public.wms_reclassify_active_item(
    p_task_id uuid, p_shk text, p_bypass_active_guard boolean default false
) returns boolean language plpgsql security definer set search_path = public as $$
declare
    v_target record;
    v_folder_target record;
    v_parent_status text;
    v_unified_type text;
    v_item_changed boolean := false;
    v_parent_changed_rows integer := 0;
begin
    select * into v_target from public.wms_compute_reroute_target(p_task_id, p_shk);
    select * into v_folder_target from public.wms_compute_no_order_folder_target(p_task_id, p_shk);

    if v_target.target_zone is not null or v_folder_target.target_zone is not null then
        select task_status into v_parent_status from public.wms_tasks where id = p_task_id;
        if v_parent_status = 'Не начато' and not p_bypass_active_guard then return false; end if;
    end if;

    if v_target.target_zone is not null then
        update public.wms_task_items set task_type = v_target.target_zone, zone_payload = '{}'::jsonb, updated_at = timezone('utc', now())
            where task_id = p_task_id and shk = p_shk;
        insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
            values (p_task_id, 'task_item_rerouted_by_rule', 'Система', '',
                jsonb_build_object('shk', p_shk, 'rule_id', v_target.rule_id, 'rule_name', v_target.rule_name,
                    'old_zone', v_target.current_zone, 'new_zone', v_target.target_zone, 'sweep', p_bypass_active_guard));
        v_item_changed := true;
    elsif v_folder_target.target_zone is not null then
        update public.wms_task_items set task_type = v_folder_target.target_zone, zone_payload = '{}'::jsonb, updated_at = timezone('utc', now())
            where task_id = p_task_id and shk = p_shk;
        insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
            values (p_task_id, 'task_item_refoldered_by_rule', 'Система', '',
                jsonb_build_object('shk', p_shk, 'rule_id', v_folder_target.rule_id, 'rule_name', v_folder_target.rule_name,
                    'old_zone', v_folder_target.current_zone, 'new_zone', v_folder_target.target_zone, 'sweep', p_bypass_active_guard));
        v_item_changed := true;
    end if;

    select distinct ti.task_type into v_unified_type
        from public.wms_task_items ti join public.wms_tasks t on t.id = ti.task_id
        where ti.task_id = p_task_id and ti.task_status <> 'Завершено' and ti.shk = any(t.source_shk_ids);
    if v_unified_type is not null and (
        select count(distinct ti.task_type) from public.wms_task_items ti join public.wms_tasks t on t.id = ti.task_id
        where ti.task_id = p_task_id and ti.task_status <> 'Завершено' and ti.shk = any(t.source_shk_ids)
    ) = 1 then
        update public.wms_tasks set task_type = v_unified_type, updated_at = timezone('utc', now())
            where id = p_task_id and task_type <> v_unified_type;
        get diagnostics v_parent_changed_rows = row_count;
    end if;
    return v_item_changed or v_parent_changed_rows > 0;
end;
$$;

grant execute on function public.wms_reclassify_active_item(uuid, text, boolean) to anon, authenticated;

-- Превью (показывается при сохранении правила в админке перед
-- confirm'ом Sweep'а) должно учитывать и folder-движок, иначе оно
-- занизит ожидаемое число реклассификаций для новых правил
-- no_order_folder.
create or replace function public.wms_preview_sweep_active_routing()
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer from (
        select ti.task_id, ti.shk
        from public.wms_task_items ti
        cross join lateral public.wms_compute_reroute_target(ti.task_id, ti.shk) rt
        where ti.task_status <> 'Завершено'
        union
        select ti.task_id, ti.shk
        from public.wms_task_items ti
        cross join lateral public.wms_compute_no_order_folder_target(ti.task_id, ti.shk) rt
        where ti.task_status <> 'Завершено'
    ) combined;
$$;

grant execute on function public.wms_preview_sweep_active_routing() to anon, authenticated;
