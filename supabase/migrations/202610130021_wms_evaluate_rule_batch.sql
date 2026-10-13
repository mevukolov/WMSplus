-- Пакетная версия wms_evaluate_rule (Фаза 2b подпроект 1) -- та же
-- логика матчинга, но на массив строк за один вызов. Нужна, чтобы
-- ручная выгрузка могла звать движок правил один раз на файл, а не
-- по вызову на строку (уже был случай сегодня, когда небатчевый RPC
-- на несколько тысяч строк тихо упирался в таймаут).
create or replace function public.wms_evaluate_rule_batch(p_output_key text, p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_row jsonb;
    v_row_id text;
    v_attributes jsonb;
    v_rule record;
    v_matched boolean;
    v_rule_id uuid;
    v_rule_name text;
    v_output_value jsonb;
    v_results jsonb := '[]'::jsonb;
begin
    if p_rows is null or jsonb_array_length(p_rows) = 0 then
        return v_results;
    end if;

    for v_row in select * from jsonb_array_elements(p_rows) loop
        v_row_id := v_row->>'row_id';
        v_attributes := v_row - 'row_id';

        v_matched := false;
        v_rule_id := null;
        v_rule_name := null;
        v_output_value := null;
        for v_rule in
            select * from public.wms_routing_rules
            where is_active = true and output_key = p_output_key
            order by priority asc
        loop
            if public.wms_rule_conditions_match(v_rule.conditions, v_attributes) then
                v_matched := true;
                v_rule_id := v_rule.id;
                v_rule_name := v_rule.name;
                v_output_value := v_rule.output_value;
                exit;
            end if;
        end loop;

        v_results := v_results || jsonb_build_object(
            'row_id', v_row_id,
            'rule_id', v_rule_id,
            'rule_name', v_rule_name,
            'output_value', v_output_value
        );
    end loop;

    return v_results;
end;
$$;

grant execute on function public.wms_evaluate_rule_batch(text, jsonb) to anon, authenticated;
