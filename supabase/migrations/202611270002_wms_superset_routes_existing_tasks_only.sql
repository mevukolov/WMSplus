-- A Superset refresh can reclassify active items. Task creation belongs
-- to the intake workflows, including for barcodes with completed tasks.
create or replace function public.wms_apply_routing_rules(p_shks text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_shk text;
    v_active_task_id uuid;
begin
    foreach v_shk in array coalesce(p_shks, '{}'::text[]) loop
        select ti.task_id into v_active_task_id
        from public.wms_task_items ti
        where ti.shk = v_shk and ti.task_status <> 'Завершено'
        limit 1;

        if v_active_task_id is not null then
            perform public.wms_reclassify_active_item(v_active_task_id, v_shk, false);
        end if;
    end loop;

    return '[]'::jsonb;
end;
$$;
