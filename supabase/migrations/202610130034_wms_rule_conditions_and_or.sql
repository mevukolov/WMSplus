-- Задел на будущее: условия внутри правила теперь можно комбинировать
-- через И/ИЛИ, не только И. Модель простая -- каждое условие (кроме
-- первого) несёт необязательное поле conditions[i].logic: 'and'|'or',
-- говорящее, как оно складывается с НАКОПЛЕННЫМ результатом слева
-- направо (без скобок/приоритета операторов -- "A или Б и В" читается
-- строго последовательно, как в таблице). Отсутствие logic трактуется
-- как 'and' -- это ровно то, что уже лежит во всех 18 текущих правил,
-- так что для них поведение не меняется ни на бит (подтверждено живой
-- регрессией: 0 расхождений со старой функцией по всем активным ШК ×
-- всем zone/no_order_folder правилам перед применением).
create or replace function public.wms_rule_conditions_match(p_conditions jsonb, p_attributes jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
    v_cond jsonb;
    v_attr text;
    v_op text;
    v_logic text;
    v_value jsonb;
    v_actual_text text;
    v_actual_num numeric;
    v_this_match boolean;
    v_result boolean;
    v_first boolean := true;
begin
    if p_conditions is null or jsonb_array_length(p_conditions) = 0 then
        return false;
    end if;
    for v_cond in select * from jsonb_array_elements(p_conditions) loop
        v_attr := v_cond->>'attribute';
        v_op := v_cond->>'operator';
        v_value := v_cond->'value';
        v_logic := coalesce(v_cond->>'logic', 'and');
        v_actual_text := case
            when v_attr = 'status' then substring(p_attributes->>'status' from '[A-Z]{3}')
            else p_attributes->>v_attr
        end;
        v_this_match := true;
        if v_op = 'in' then
            if v_actual_text is null or not (v_value ? v_actual_text) then v_this_match := false; end if;
        elsif v_op = 'eq' then
            if v_actual_text is distinct from (v_value#>>'{}') then v_this_match := false; end if;
        elsif v_op = 'contains' then
            if v_actual_text is null or position(lower(v_value#>>'{}') in lower(v_actual_text)) = 0 then v_this_match := false; end if;
        elsif v_op = 'not_contains' then
            if v_actual_text is not null and position(lower(v_value#>>'{}') in lower(v_actual_text)) > 0 then v_this_match := false; end if;
        elsif v_op in ('gt', 'gte', 'lt', 'lte') then
            if v_actual_text is null or v_actual_text !~ '^-?[0-9]+(\.[0-9]+)?$' then
                v_this_match := false;
            else
                v_actual_num := v_actual_text::numeric;
                if v_op = 'gt' and not (v_actual_num > (v_value#>>'{}')::numeric) then v_this_match := false; end if;
                if v_op = 'gte' and not (v_actual_num >= (v_value#>>'{}')::numeric) then v_this_match := false; end if;
                if v_op = 'lt' and not (v_actual_num < (v_value#>>'{}')::numeric) then v_this_match := false; end if;
                if v_op = 'lte' and not (v_actual_num <= (v_value#>>'{}')::numeric) then v_this_match := false; end if;
            end if;
        elsif v_op = 'between' then
            if v_actual_text is null or v_actual_text !~ '^-?[0-9]+(\.[0-9]+)?$' then
                v_this_match := false;
            else
                v_actual_num := v_actual_text::numeric;
                if not (v_actual_num >= (v_value->>0)::numeric and v_actual_num <= (v_value->>1)::numeric) then v_this_match := false; end if;
            end if;
        else
            v_this_match := false;
        end if;

        if v_first then
            v_result := v_this_match;
            v_first := false;
        elsif v_logic = 'or' then
            v_result := v_result or v_this_match;
        else
            v_result := v_result and v_this_match;
        end if;
    end loop;
    return v_result;
end;
$$;

grant execute on function public.wms_rule_conditions_match(jsonb, jsonb) to anon, authenticated;
