-- Пользователь указал на лишнюю сложность: отдельный output_key
-- 'no_order_folder' существовал только ради одной вещи -- не дать
-- USD/TMM-правилам задевать ШК ГЛОБАЛЬНО (как с остальными zone-
-- правилами), а только когда ШК уже лежит в "Без заказа". Это
-- реальная причина (см. 202610130029/030), но решать её отдельным
-- output_key/отдельным экраном в админке -- overkill. Правильное
-- решение: один общий список "Зона" + необязательное поле
-- from_zone -- правило срабатывает только если ШК СЕЙЧАС лежит именно
-- в этой зоне. Для USD/TMM from_zone = "Разбор ОПП // Без заказа";
-- для всех остальных (99% правил) from_zone = null -- работает
-- глобально, как раньше.
--
-- "Без заказа" защищена от любого from_zone=null правила так же, как
-- раньше (глобальные правила её не задевают), но ТЕПЕРЬ, в отличие от
-- старой блок-листной защиты, через неё можно пройти ЯВНО opt-in
-- правилом с подходящим from_zone -- ровно то, что нужно для USD/TMM,
-- и ничего больше ни для кого не открывает.
--
-- from_zone не проверяется при самой ЗАГРУЗКЕ (wms_evaluate_rule_batch,
-- buildXPreview-функции) -- там у свежей строки ещё нет "текущей зоны",
-- это понятие осмысленно только при реклассификации уже активных ШК.
alter table public.wms_routing_rules add column if not exists from_zone text;

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

-- wms_reclassify_active_item больше не нужно звать две функции и
-- мёрджить их результат -- wms_compute_reroute_target теперь сама
-- решает и обычные, и from_zone-правила.
create or replace function public.wms_reclassify_active_item(
    p_task_id uuid, p_shk text, p_bypass_active_guard boolean default false
) returns boolean language plpgsql security definer set search_path = public as $$
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
        update public.wms_tasks set task_type = v_unified_type, updated_at = timezone('utc', now())
            where id = p_task_id and task_type <> v_unified_type;
        get diagnostics v_parent_changed_rows = row_count;
    end if;
    return v_item_changed or v_parent_changed_rows > 0;
end;
$$;

grant execute on function public.wms_reclassify_active_item(uuid, text, boolean) to anon, authenticated;

create or replace function public.wms_preview_sweep_active_routing()
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer
    from public.wms_task_items ti
    cross join lateral public.wms_compute_reroute_target(ti.task_id, ti.shk) rt
    where ti.task_status <> 'Завершено';
$$;

grant execute on function public.wms_preview_sweep_active_routing() to anon, authenticated;

drop function if exists public.wms_compute_no_order_folder_target(uuid, text);

-- Переносим 2 существующих no_order_folder-правила (USD/TMM) в общий
-- zone-список с from_zone. Приоритеты 19/20 -- следующие свободные в
-- namespace output_key='zone' (1-18 уже заняты).
update public.wms_routing_rules
set output_key = 'zone', priority = 19,
    target_task_type = 'Разбор ОПП // USD',
    output_value = jsonb_build_object('target_task_type', 'Разбор ОПП // USD', 'grouping_attribute', null),
    from_zone = 'Разбор ОПП // Без заказа'
where output_key = 'no_order_folder' and output_value->>'target_task_type' = 'Разбор ОПП // USD';

update public.wms_routing_rules
set output_key = 'zone', priority = 20,
    target_task_type = 'Разбор ОПП // TMM',
    output_value = jsonb_build_object('target_task_type', 'Разбор ОПП // TMM', 'grouping_attribute', null),
    from_zone = 'Разбор ОПП // Без заказа'
where output_key = 'no_order_folder' and output_value->>'target_task_type' = 'Разбор ОПП // TMM';

-- Старые, навсегда неактивные zone-правила "USD -> Другие задачи" /
-- "TMM -> Другие задачи" (приоритет 5/6) теперь полностью вытеснены
-- правильной, безопасной реализацией выше -- удаляем, чтобы в списке
-- не было двух разных "USD"-правил (одно рабочее, одно мёртвое и
-- потенциально опасное, если кто-то случайно включит).
delete from public.wms_routing_rules
where name in ('Хардкод: USD -> Другие задачи', 'Хардкод: TMM -> Другие задачи');
