-- Фикс бага из Task 1 (202610130008), найден живым тестом этой
-- миграции: "v_rule is null or v_rule.target_task_type = ..." падает
-- с "record v_rule is not assigned yet", если ни одно правило не
-- подошло -- доступ к полю записи, структурно никогда не
-- присвоенной (v_rule := null без реальной строки), запрещён даже
-- внутри OR. В рабочем коде Фазы 1 эти две проверки всегда разделены
-- -- повторяем тот же паттерн.
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
    v_rule record;
begin
    select ti.task_type into v_item_task_type
    from public.wms_task_items ti
    where ti.task_id = p_task_id and ti.shk = p_shk and ti.task_status <> 'Завершено';

    if v_item_task_type is null then
        return;
    end if;

    select sc.last_status, sc.last_tare into v_status, v_tare_id
    from public.wms_superset_cache sc
    where sc.wh_id = '50144199' and sc.shk = p_shk;

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

-- Фаза 2a: вместо явного JS-вызова wms_apply_routing_rules после
-- актуализации Superset (Фаза 1), заводим настоящий DB-триггер --
-- last_status/last_tare в wms_superset_cache сегодня меняются только
-- здесь, других путей записи нет. STATEMENT-уровня с transition
-- tables (не ROW) -- актуализация пишет пачками в один upsert-
-- стейтмент на сотни/тысячи строк, ROW-level дёргал бы функцию по
-- одной строке за раз.
create or replace function public.wms_superset_cache_route_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_shks text[];
begin
    if tg_op = 'INSERT' then
        select array_agg(distinct shk) into v_shks from new_rows;
    else
        select array_agg(distinct n.shk) into v_shks
        from new_rows n
        join old_rows o on o.wh_id = n.wh_id and o.shk = n.shk
        where n.last_status is distinct from o.last_status
           or n.last_tare is distinct from o.last_tare;
    end if;
    if v_shks is not null and array_length(v_shks, 1) > 0 then
        perform public.wms_apply_routing_rules(v_shks);
    end if;
    return null;
end;
$$;

drop trigger if exists wms_superset_cache_route_insert on public.wms_superset_cache;
create trigger wms_superset_cache_route_insert
    after insert on public.wms_superset_cache
    referencing new table as new_rows
    for each statement
    execute function public.wms_superset_cache_route_changed();

-- Postgres не позволяет сочетать transition tables с "UPDATE OF
-- <колонки>" (0A000: transition tables cannot be specified for
-- triggers with column lists) -- фильтрация по last_status/last_tare
-- уже есть внутри функции (join new_rows/old_rows с IS DISTINCT
-- FROM), поэтому триггер вешаем на любой UPDATE строки целиком.
drop trigger if exists wms_superset_cache_route_update on public.wms_superset_cache;
create trigger wms_superset_cache_route_update
    after update on public.wms_superset_cache
    referencing new table as new_rows old table as old_rows
    for each statement
    execute function public.wms_superset_cache_route_changed();
