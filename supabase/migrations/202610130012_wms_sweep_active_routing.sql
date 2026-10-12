-- Фаза 2a: ручной sweep при сохранении правила в админке. В отличие
-- от триггеров (освобождение задачи, изменение статуса), обходит
-- защиту "Не начато" -- у review-задач физически нет presence-сигнала
-- "карточка открыта у оператора" (только task_status, который
-- одинаков и для реально открытой карточки, и для нетронутого
-- бэклога), и раз админ сознательно меняет правило, это осознанно
-- принятый риск (см. спеку, раздел "Риски и компромиссы").
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

create or replace function public.wms_sweep_active_routing()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
    v_count integer := 0;
begin
    for v_row in
        select task_id, shk from public.wms_task_items where task_status <> 'Завершено'
    loop
        if public.wms_reclassify_active_item(v_row.task_id, v_row.shk, true) then
            v_count := v_count + 1;
        end if;
    end loop;
    return v_count;
end;
$$;

grant execute on function public.wms_sweep_active_routing() to anon, authenticated;
