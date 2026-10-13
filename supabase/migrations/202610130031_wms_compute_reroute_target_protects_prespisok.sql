-- "Предсписок" -- отдельный терминальный workflow финальной проверки
-- перед списанием (своя RPC wms_prespisok_actions, свой таймер/режим
-- "арена последнего шанса"), не обычный участок разбора. Обнаружено
-- при полной проверке breakdown перед включением SPS/GWS-default/
-- WMI-default/PWT-default/RWP правил: 7 активных ШК в "Предсписке"
-- попали бы под эти правила и уехали бы в "Предсортировку" --
-- то есть движок вытащил бы их из финальной проверки прямо в разбор.
-- Тот же класс риска и то же решение, что и для "Чистые списания"/
-- "Без заказа"/"Движение после продажи" -- постоянная защита в
-- единой точке wms_compute_reroute_target.
create or replace function public.wms_compute_reroute_target(
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
begin
    select ti.task_type into v_item_task_type
    from public.wms_task_items ti
    where ti.task_id = p_task_id and ti.shk = p_shk and ti.task_status <> 'Завершено';

    if v_item_task_type is null or v_item_task_type in (
        'Чистые списания',
        'Разбор ОПП // Без заказа',
        'Разбор ОПП // USD',
        'Разбор ОПП // TMM',
        'Разбор ОПП // Движение после продажи',
        'Предсписок'
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
        if public.wms_rule_conditions_match(v_rule.conditions, jsonb_build_object('status', v_status, 'tare_id', v_tare_id, 'mx', v_mx)) then
            exit;
        end if;
        v_rule := null;
    end loop;

    if v_rule is null then
        return;
    end if;

    if v_rule.target_task_type = v_item_task_type then
        return;
    end if;

    current_zone := v_item_task_type;
    target_zone := v_rule.target_task_type;
    rule_id := v_rule.id;
    rule_name := v_rule.name;
    return next;
end;
$$;

grant execute on function public.wms_compute_reroute_target(uuid, text) to anon, authenticated;
