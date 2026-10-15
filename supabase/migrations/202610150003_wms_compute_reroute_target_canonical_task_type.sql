-- CRITICAL FIX: wms_compute_reroute_target's no-op check compared a rule's
-- target_task_type (often the SHORT zone name, e.g. "Предсортировка" --
-- the admin UI's target dropdown, used by build-time's zoneTaskTypeMap to
-- resolve the real "Разбор ОПП // X" task_type) literally against the
-- item's FULL current task_type ("Разбор ОПП // Предсортировка"). These
-- never matched for most zone rules (from_zone=null, broadly-applicable),
-- so the function treated an ALREADY-correctly-classified item as needing
-- reclassification and the auto-reclassify trigger silently stripped the
-- "Разбор ОПП // " prefix when writing wms_task_items.task_type -- 2410
-- such events over 2026-10-13..15, 910 currently-active tasks corrupted
-- (confirmed live). Corrupted tasks also fall OUT of the protected-zone
-- block-list below (literal match on the full-prefixed string) and out of
-- wms_confirm_pm_carrier_shipments's task_type match (separately fixed).
--
-- Fix: canonicalize target_task_type to the real full task_type before
-- both the no-op comparison AND the returned target_zone (so a genuine
-- reclassification also writes the correct, consistently-prefixed value
-- going forward) -- "Разбор ОПП // " + short name, except the two known
-- zones that are legitimately never prefixed ("Другие задачи",
-- "Движение после продажи") and anything already carrying the prefix
-- (self-scoped default rules already store the full string).
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
begin
    select ti.task_type into v_item_task_type
    from public.wms_task_items ti
    where ti.task_id = p_task_id and ti.shk = p_shk and ti.task_status <> 'Завершено';

    if v_item_task_type is null or v_item_task_type in (
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
