-- Второй файл ПМ ("проверка отгрузки") перестаёт быть частью загрузки --
-- раньше он блокировал сохранение (excludedTransfers), теперь это
-- отдельное пост-сохранное действие: оператор загружает тот же файл
-- ПОСЛЕ того, как задачи ПМ/Почта уже созданы, и совпавшие по номеру
-- передачи переводятся в "Завершено".
create or replace function public.wms_confirm_pm_carrier_shipments(p_transfers text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
          and t.task_type in ('Разбор ОПП // ПМ', 'Разбор ОПП // Почта')
          and t.is_deleted = false
          and t.task_status <> 'Завершено'
          and ti.task_status <> 'Завершено'
          and t.source_tare_id = any(p_transfers)
        returning ti.id
    )
    select count(*) into v_matched_count from matched;

    update public.wms_tasks t
    set task_status = 'Завершено', updated_at = now()
    where t.task_type in ('Разбор ОПП // ПМ', 'Разбор ОПП // Почта')
      and t.is_deleted = false
      and t.task_status <> 'Завершено'
      and t.source_tare_id = any(p_transfers);

    return jsonb_build_object('matched_count', v_matched_count, 'transfer_count', array_length(p_transfers, 1));
end;
$$;

grant execute on function public.wms_confirm_pm_carrier_shipments(text[]) to anon, authenticated;
