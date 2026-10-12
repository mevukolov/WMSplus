-- МХ ("Блок/МХ" из актуализации Superset, row.last_mx в tasks.js --
-- уже парсится из файла, просто раньше никуда не сохранялся) теперь
-- хранится в двух местах с разными ролями:
-- 1) wms_superset_cache.last_mx -- быстрый снэпшот для движка правил
--    (та же роль, что last_status/last_tare, обновляется при каждой
--    актуализации).
-- 2) wms_shk.last_mx + событие в wms_shk_history -- постоянная память
--    в реестре ШК: пишется событие ТОЛЬКО когда МХ реально поменялся
--    (не на каждую актуализацию -- иначе лог захлебнётся), last_mx на
--    wms_shk -- кэш-указатель на последнее значение (та же роль, что
--    у current_task_id), не источник истины -- источник истины это
--    сама история событий.
alter table public.wms_superset_cache add column last_mx text;
alter table public.wms_shk add column last_mx text;

-- wms_shk_history.shk -- внешний ключ на wms_shk, а wms_shk сегодня
-- пополняется только через задачи (триггер с wms_task_items). Если
-- при актуализации встретится совсем новый ШК без единой задачи --
-- заводим для него строку в wms_shk заранее (минимальная, только
-- shk), иначе писать историю будет некуда.
create or replace function public.wms_log_shk_mx_batch(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row jsonb;
    v_shk text;
    v_mx text;
    v_previous_mx text;
    v_count integer := 0;
begin
    if p_rows is null then
        return 0;
    end if;

    for v_row in select * from jsonb_array_elements(p_rows) loop
        v_shk := v_row->>'shk';
        v_mx := nullif(v_row->>'mx', '');
        if v_shk is null then
            continue;
        end if;

        insert into public.wms_shk (shk) values (v_shk)
        on conflict (shk) do nothing;

        select last_mx into v_previous_mx from public.wms_shk where shk = v_shk;

        if v_mx is distinct from v_previous_mx then
            insert into public.wms_shk_history (shk, event_type, payload)
            values (v_shk, 'shk_mx_observed', jsonb_build_object('mx', v_mx, 'previous_mx', v_previous_mx));

            update public.wms_shk set last_mx = v_mx, updated_at = now() where shk = v_shk;

            v_count := v_count + 1;
        end if;
    end loop;

    return v_count;
end;
$$;

grant execute on function public.wms_log_shk_mx_batch(jsonb) to anon, authenticated;
