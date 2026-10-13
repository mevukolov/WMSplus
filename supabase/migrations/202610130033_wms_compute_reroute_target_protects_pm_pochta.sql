-- Обнаружено при проверке breakdown перед Sweep'ом после включения
-- SMS/SWT-правил (17,18): 297 реальных активных ШК в "Разбор ОПП //
-- Почта" уехали бы обратно в "ПМ". Корневая причина -- "почтовый
-- маршрут" решается по НОМЕРУ, извлечённому из MX в момент загрузки
-- (konкретное место парковки/буфера, напр. "Ворота1.205_Буфер 205" --
-- маршрут 205, почтовый). Но wms_task_items.mx/wms_superset_cache.last_mx
-- со временем переписывается на MX СЛЕДУЮЩЕГО этапа обработки (напр.
-- "Сортировка в коробки ННЛА.3" после того, как ШК физически уехал с
-- буфера на сортировку) -- эта МХ больше не про маршрут парковки
-- вообще, число "3" в ней просто номер стола сортировки, случайно
-- попадающее не в почтовый диапазон. В отличие от статуса (PAP/SMC/
-- WMI/...), MX здесь -- не стабильный, переиспользуемый сигнал
-- маршрутизации, а одноразовый снимок на момент создания задачи.
-- Переоценивать "почта/ПМ" по текущему MX после того, как ШК уже
-- физически ушёл с буфера -- семантически неверно.
--
-- Решение: "Разбор ОПП // ПМ"/"Разбор ОПП // Почта" -- защищены от
-- движка реклассификации так же, как и другие provenance/снимочные
-- зоны (Чистые списания/Без заказа/После продажи/Предсписок).
-- Правила 17/18 (SMS/SWT -> Почта/ПМ) ОСТАЮТСЯ активными и продолжают
-- работать для НОВЫХ загрузок (buildPmPreview читает MX строки из
-- самого файла выгрузки прямо сейчас, без этой проблемы устаревания) --
-- защита касается только повторной переклассификации уже созданных
-- задач.
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

    if v_item_task_type is null or v_item_task_type in (
        'Чистые списания',
        'Разбор ОПП // Без заказа',
        'Разбор ОПП // USD',
        'Разбор ОПП // TMM',
        'Разбор ОПП // Движение после продажи',
        'Предсписок',
        'Разбор ОПП // ПМ',
        'Разбор ОПП // Почта'
    ) then
        return;
    end if;

    select sc.last_status, sc.last_tare, sc.last_mx into v_status, v_tare_id, v_mx
    from public.wms_superset_cache sc
    where sc.wh_id = '50144199' and sc.shk = p_shk;

    if v_status is null then
        select ti.status, ti.mx into v_status, v_mx
        from public.wms_task_items ti
        where ti.task_id = p_task_id and ti.shk = p_shk;
    end if;

    v_rule := null;
    for v_rule in
        select * from public.wms_routing_rules
        where is_active = true and output_key = 'zone'
        order by priority asc
    loop
        if public.wms_rule_conditions_match(v_rule.conditions, jsonb_build_object(
            'status', v_status, 'tare_id', v_tare_id, 'mx', v_mx,
            'route_number', public.wms_route_number_from_mx(v_mx)
        )) then
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
