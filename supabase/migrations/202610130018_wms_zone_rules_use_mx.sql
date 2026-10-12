-- Подключаем МХ к реальному матчингу "Зоны". До сих пор обе живые
-- функции (wms_apply_routing_rules, wms_compute_reroute_target) брали
-- только last_status/last_tare и сверяли условия через узкий
-- wms_routing_rule_matches(conditions, status, tare_id) -- тот
-- матчер физически не умеет читать МХ (неизвестный атрибут -> null ->
-- условие никогда не матчит). Переключаем обе на обобщённый
-- wms_rule_conditions_match(conditions, attributes jsonb) -- Фаза 2b
-- подпроект 1 -- который уже умеет status/tare_id/mx/price/
-- route_number. Для существующих status/tare_id-правил поведение не
-- меняется (та же экстракция 3-буквенного кода, те же операторы
-- in/eq) -- просто появляется возможность задавать условия и по МХ.
-- wms_routing_rule_matches после этой миграции больше нигде не
-- вызывается -- оставляем как есть (не трогаем работавший код лишний
-- раз), просто неиспользуемая функция.
create or replace function public.wms_apply_routing_rules(p_shks text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_shk text;
    v_active_task_id uuid;
    v_rule record;
    v_status text;
    v_tare_id text;
    v_mx text;
    v_group_value text;
    v_task_id uuid;
    v_results jsonb := '[]'::jsonb;
begin
    if p_shks is null or array_length(p_shks, 1) is null then
        return v_results;
    end if;

    foreach v_shk in array p_shks loop
        v_active_task_id := null;
        select ti.task_id into v_active_task_id
        from public.wms_task_items ti
        where ti.shk = v_shk and ti.task_status <> 'Завершено'
        limit 1;

        if v_active_task_id is not null then
            perform public.wms_reclassify_active_item(v_active_task_id, v_shk, false);
            continue;
        end if;

        select sc.last_status, sc.last_tare, sc.last_mx into v_status, v_tare_id, v_mx
        from public.wms_superset_cache sc
        where sc.wh_id = '50144199' and sc.shk = v_shk;

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
            continue;
        end if;

        v_group_value := case when v_rule.grouping_attribute = 'tare_id' then v_tare_id else null end;

        v_task_id := null;
        if v_group_value is not null then
            select id into v_task_id
            from public.wms_tasks
            where task_type = v_rule.target_task_type
              and routing_group_key = v_group_value
              and is_deleted = false and task_status <> 'Завершено'
            limit 1;
        end if;

        if v_task_id is null then
            insert into public.wms_tasks (
                source_module, source_table, source_id, source_payload,
                source_shk_ids, task_type, title, task_status, opp_verdict,
                responsibility_zone, tags, routing_group_key, last_seen_at
            ) values (
                'routing_engine', 'manual_absorb',
                'routing:' || v_rule.id || ':' || coalesce(v_group_value, v_shk) || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                jsonb_build_object(
                    'item_name', v_shk,
                    'task_items', jsonb_build_array(jsonb_build_object(
                        'shk', v_shk, 'nm', null, 'name', '', 'price', 0,
                        'status', coalesce(v_status, ''), 'movement', '', 'mx', coalesce(v_mx, '')
                    ))
                ),
                array[v_shk], v_rule.target_task_type, 'ШК ' || v_shk, 'Не начато', 'Не выбран',
                'Нет привязки', '[]'::jsonb, v_group_value, now()
            )
            returning id into v_task_id;
        else
            update public.wms_tasks
            set source_payload = jsonb_set(
                    source_payload, '{task_items}',
                    coalesce(source_payload->'task_items', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                        'shk', v_shk, 'nm', null, 'name', '', 'price', 0,
                        'status', coalesce(v_status, ''), 'movement', '', 'mx', coalesce(v_mx, '')
                    ))
                ),
                source_shk_ids = coalesce(source_shk_ids, '{}'::text[]) || array[v_shk],
                last_seen_at = now(),
                updated_at = now()
            where id = v_task_id;
        end if;

        insert into public.wms_task_history (task_id, event_type, payload)
        values (v_task_id, 'task_routed_by_rule', jsonb_build_object('shk', v_shk, 'rule_id', v_rule.id, 'rule_name', v_rule.name));

        v_results := v_results || jsonb_build_object('shk', v_shk, 'task_id', v_task_id, 'rule_id', v_rule.id);
    end loop;

    return v_results;
end;
$$;

grant execute on function public.wms_apply_routing_rules(text[]) to anon, authenticated;

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

    if v_item_task_type is null then
        return;
    end if;

    select sc.last_status, sc.last_tare, sc.last_mx into v_status, v_tare_id, v_mx
    from public.wms_superset_cache sc
    where sc.wh_id = '50144199' and sc.shk = p_shk;

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
