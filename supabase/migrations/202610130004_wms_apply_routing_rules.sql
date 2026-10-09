create or replace function public.wms_routing_rule_matches(p_conditions jsonb, p_status text, p_tare_id text)
returns boolean
language plpgsql
immutable
as $$
declare
    v_cond jsonb;
    v_attr text;
    v_op text;
    v_value jsonb;
    v_actual text;
begin
    if p_conditions is null or jsonb_array_length(p_conditions) = 0 then
        return false;
    end if;
    for v_cond in select * from jsonb_array_elements(p_conditions) loop
        v_attr := v_cond->>'attribute';
        v_op := v_cond->>'operator';
        v_value := v_cond->'value';
        -- last_status в wms_superset_cache -- полная строка вида
        -- "SAS: Статус такой-то" (как присылает WB), а не чистый
        -- 3-буквенный код -- вытаскиваем код тем же способом, что и
        -- latinStatusCode() на JS-стороне.
        v_actual := case v_attr when 'status' then substring(p_status from '[A-Z]{3}') when 'tare_id' then p_tare_id else null end;
        if v_op = 'in' then
            if v_actual is null or not (v_value ? v_actual) then return false; end if;
        elsif v_op = 'eq' then
            if v_actual is distinct from (v_value#>>'{}') then return false; end if;
        else
            return false;
        end if;
    end loop;
    return true;
end;
$$;

create or replace function public.wms_apply_routing_rules(p_shks text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_shk text;
    v_rule record;
    v_status text;
    v_tare_id text;
    v_group_value text;
    v_task_id uuid;
    v_results jsonb := '[]'::jsonb;
begin
    if p_shks is null or array_length(p_shks, 1) is null then
        return v_results;
    end if;

    foreach v_shk in array p_shks loop
        if exists (select 1 from public.wms_shk where shk = v_shk and current_task_id is not null) then
            continue;
        end if;

        select sc.last_status, sc.last_tare into v_status, v_tare_id
        from public.wms_superset_cache sc
        where sc.wh_id = '50144199' and sc.shk = v_shk;

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
                        'status', coalesce(v_status, ''), 'movement', '', 'mx', ''
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
                        'status', coalesce(v_status, ''), 'movement', '', 'mx', ''
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
