-- Same corruption fixed in 202610150003 (wms_compute_reroute_target) left
-- some ПМ/Почта tasks with a SHORT task_type ('ПМ'/'Почта' instead of
-- 'Разбор ОПП // ПМ'/'Разбор ОПП // Почта') -- this function's literal
-- task_type in (...) match silently can't find them, so carrier-shipment
-- confirmation would never mark them completed. Match both forms so this
-- keeps working during the window before the already-corrupted tasks get
-- repaired, and stays robust going forward regardless.
create or replace function public.wms_confirm_pm_carrier_shipments(p_transfers text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_matched_count integer;
begin
    if p_transfers is null or array_length(p_transfers, 1) is null then
        return jsonb_build_object('matched_count', 0, 'transfer_count', 0);
    end if;

    with matched as (
        update public.wms_task_items ti
        set task_status = 'Завершено', updated_at = now()
        from public.wms_tasks t
        where t.id = ti.task_id
          and t.task_type in ('Разбор ОПП // ПМ', 'Разбор ОПП // Почта', 'ПМ', 'Почта')
          and t.is_deleted = false
          and t.task_status <> 'Завершено'
          and ti.task_status <> 'Завершено'
          and t.source_tare_id = any(p_transfers)
        returning ti.id
    )
    select count(*) into v_matched_count from matched;

    update public.wms_tasks t
    set task_status = 'Завершено', updated_at = now()
    where t.task_type in ('Разбор ОПП // ПМ', 'Разбор ОПП // Почта', 'ПМ', 'Почта')
      and t.is_deleted = false
      and t.task_status <> 'Завершено'
      and t.source_tare_id = any(p_transfers);

    return jsonb_build_object('matched_count', v_matched_count, 'transfer_count', array_length(p_transfers, 1));
end;
$function$;
