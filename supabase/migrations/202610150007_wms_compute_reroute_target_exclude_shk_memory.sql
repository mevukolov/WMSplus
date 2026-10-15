-- "Запомнить ШК" (202610150006) создаёт задачи с произвольно выбранной
-- вручную зоной (source_module='shk_memory') -- их нельзя защитить
-- литералом task_type, как уже защищены "Чистые списания" и т.п. (зона
-- у них любая). Добавляем guard по source_module: такие задачи не
-- участвуют в Sweep/автотриггере актуализации -- тот же приём, тот же
-- единственный choke-point (wms_compute_reroute_target), которым уже
-- идут и Sweep, и авто-реклассификация при новой выгрузке.
create or replace function public.wms_compute_reroute_target(p_task_id uuid, p_shk text)
 returns table(current_zone text, target_zone text, rule_id uuid, rule_name text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
    v_item_task_type text;
    v_status text;
    v_tare_id text;
    v_mx text;
    v_rule record;
    v_canonical_target text;
    v_source_module text;
begin
    select ti.task_type, t.source_module into v_item_task_type, v_source_module
    from public.wms_task_items ti
    join public.wms_tasks t on t.id = ti.task_id
    where ti.task_id = p_task_id and ti.shk = p_shk and ti.task_status <> 'Завершено';

    if v_item_task_type is null or v_source_module = 'shk_memory' or v_item_task_type in (
        'Чистые списания',
        'Разбор ОПП // USD',
        'Разбор ОПП // TMM',
        'Разбор ОПП // Движение после продажи',
        'Предсписок',
        'Разбор ОПП // ПМ',
        'Разбор ОПП // Почта'
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
        where is_active = true and output_key = 'zone'
        order by priority asc
    loop
        if (
            (v_rule.from_zone is null and v_item_task_type <> 'Разбор ОПП // Без заказа')
            or v_rule.from_zone = v_item_task_type
        ) and public.wms_rule_conditions_match(v_rule.conditions, jsonb_build_object(
            'status', v_status, 'tare_id', v_tare_id, 'mx', v_mx,
            'route_number', public.wms_route_number_from_mx(v_mx)
        )) then
            exit;
        end if;
        v_rule := null;
    end loop;

    if v_rule is null then
        return;
    end if;

    v_canonical_target := case
        when v_rule.target_task_type like 'Разбор ОПП // %' then v_rule.target_task_type
        when v_rule.target_task_type in ('Другие задачи', 'Движение после продажи') then v_rule.target_task_type
        else 'Разбор ОПП // ' || v_rule.target_task_type
    end;

    if v_canonical_target = v_item_task_type then
        return;
    end if;

    current_zone := v_item_task_type;
    target_zone := v_canonical_target;
    rule_id := v_rule.id;
    rule_name := v_rule.name;
    return next;
end;
$function$;
