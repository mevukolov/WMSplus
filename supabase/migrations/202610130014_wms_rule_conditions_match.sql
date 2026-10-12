-- Обобщённая версия wms_routing_rule_matches (Фаза 1) -- та функция
-- НЕ трогается (её вызывают уже работающие wms_apply_routing_rules/
-- wms_compute_reroute_target с фиксированными p_status/p_tare_id).
-- Эта новая функция принимает произвольный набор атрибутов, нужна
-- для любого output_key, не только зоны.
create or replace function public.wms_rule_conditions_match(p_conditions jsonb, p_attributes jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
    v_cond jsonb;
    v_attr text;
    v_op text;
    v_value jsonb;
    v_actual_text text;
    v_actual_num numeric;
begin
    if p_conditions is null or jsonb_array_length(p_conditions) = 0 then
        return false;
    end if;
    for v_cond in select * from jsonb_array_elements(p_conditions) loop
        v_attr := v_cond->>'attribute';
        v_op := v_cond->>'operator';
        v_value := v_cond->'value';
        v_actual_text := case
            when v_attr = 'status' then substring(p_attributes->>'status' from '[A-Z]{3}')
            else p_attributes->>v_attr
        end;
        if v_op = 'in' then
            if v_actual_text is null or not (v_value ? v_actual_text) then return false; end if;
        elsif v_op = 'eq' then
            if v_actual_text is distinct from (v_value#>>'{}') then return false; end if;
        elsif v_op = 'contains' then
            if v_actual_text is null or position(lower(v_value#>>'{}') in lower(v_actual_text)) = 0 then return false; end if;
        elsif v_op in ('gt', 'gte', 'lt', 'lte') then
            if v_actual_text is null or v_actual_text !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
            v_actual_num := v_actual_text::numeric;
            if v_op = 'gt' and not (v_actual_num > (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'gte' and not (v_actual_num >= (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'lt' and not (v_actual_num < (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'lte' and not (v_actual_num <= (v_value#>>'{}')::numeric) then return false; end if;
        elsif v_op = 'between' then
            if v_actual_text is null or v_actual_text !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
            v_actual_num := v_actual_text::numeric;
            if not (v_actual_num >= (v_value->>0)::numeric and v_actual_num <= (v_value->>1)::numeric) then return false; end if;
        else
            return false;
        end if;
    end loop;
    return true;
end;
$$;

grant execute on function public.wms_rule_conditions_match(jsonb, jsonb) to anon, authenticated;
