create or replace function public.wms_evaluate_rule(p_output_key text, p_attributes jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_rule record;
begin
    v_rule := null;
    for v_rule in
        select * from public.wms_routing_rules
        where is_active = true and output_key = p_output_key
        order by priority asc
    loop
        if public.wms_rule_conditions_match(v_rule.conditions, p_attributes) then
            exit;
        end if;
        v_rule := null;
    end loop;

    if v_rule is null then
        return null;
    end if;

    return jsonb_build_object('rule_id', v_rule.id, 'rule_name', v_rule.name, 'output_value', v_rule.output_value);
end;
$$;

grant execute on function public.wms_evaluate_rule(text, jsonb) to anon, authenticated;

create or replace function public.wms_module_setting(p_module text, p_setting_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select value from public.wms_module_settings where module = p_module and setting_key = p_setting_key;
$$;

grant execute on function public.wms_module_setting(text, text) to anon, authenticated;
