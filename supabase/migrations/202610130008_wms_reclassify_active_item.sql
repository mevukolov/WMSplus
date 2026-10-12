-- Ядро ретроактивной пересборки (Фаза 2a): дано активный ШК с
-- известным task_id -- пересчитать его зону по текущим правилам.
-- Разбито на чистую read-only функцию (что бы изменилось) и обёртку,
-- которая применяет это с учётом защиты "Не начато" (операторская
-- работа с review-карточкой не оставляет никакого другого следа в
-- БД, кроме task_status -- более точного presence-сигнала система не
-- хранит, см. спеку). p_bypass_active_guard=true используется только
-- ручным sweep.
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
    v_rule record;
begin
    select ti.task_type into v_item_task_type
    from public.wms_task_items ti
    where ti.task_id = p_task_id and ti.shk = p_shk and ti.task_status <> 'Завершено';

    if v_item_task_type is null then
        return;
    end if;

    select sc.last_status, sc.last_tare into v_status, v_tare_id
    from public.wms_superset_cache sc
    where sc.wh_id = '50144199' and sc.shk = p_shk;

    v_rule := null;
    for v_rule in
        select * from public.wms_routing_rules
        where is_active = true
        order by priority asc
    loop
        if public.wms_routing_rule_matches(v_rule.conditions, v_status, v_tare_id) then
            exit;
        end if;
        v_rule := null;
    end loop;

    if v_rule is null or v_rule.target_task_type = v_item_task_type then
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

    return true;
end;
$$;

grant execute on function public.wms_reclassify_active_item(uuid, text, boolean) to anon, authenticated;
