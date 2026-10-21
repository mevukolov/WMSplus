-- Баг: "duplicate key value violates unique constraint
-- wms_task_items_task_id_shk_key" при больших выгрузках (сегодня -- "Без
-- заказа", 963 задачи; ранее в этой же сессии -- "В заказе", 407 задач).
-- Проверено: файл выгрузки НЕ содержит дублей ШК (1051 уникальных строк),
-- и "безопасные" формы конкуренции (два параллельных UPDATE на ОДНУ и ту
-- же wms_tasks.id, либо два INSERT НОВЫХ задач с РАЗНЫМИ id) подтверждены
-- живым экспериментом как не воспроизводящие ошибку -- Postgres
-- сериализует их через блокировку строки/ON CONFLICT без исключений.
-- Точный интерливинг, который всё же пробивает ON CONFLICT DO UPDATE на
-- живых данных, остаётся недоказанным (нечто более экзотическое -- гонка
-- между этим триггером и прямым UPDATE wms_task_items из
-- wms_reclassify_active_item/wms_apply_routing_rules, которые не идут
-- через блокировку строки wms_tasks). Вместо дальнейшей охоты за точным
-- интерливингом -- defense in depth: делаем сам триггер идемпотентным к
-- этой гонке, независимо от источника. ON CONFLICT DO UPDATE по дизайну
-- не может быть источником реальной порчи данных при ретрае (итоговое
-- состояние строки то же самое), поэтому ретрай тут строго безопасен.
create or replace function public.wms_sync_task_items()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_attempt integer := 0;
begin
    loop
        v_attempt := v_attempt + 1;
        begin
            update public.wms_task_items ti
            set task_id = new.id,
                task_type = new.task_type,
                opp_verdict = new.opp_verdict,
                task_status = new.task_status,
                updated_at = now()
            from jsonb_array_elements(coalesce(new.source_payload->'task_items', '[]'::jsonb)) item
            where item->>'shk' is not null
              and ti.shk = item->>'shk'
              and ti.task_id <> new.id
              and ti.task_status <> 'Завершено';

            insert into public.wms_task_items (
                task_id, shk, nm, name, status, price, mx, movement, row_number, raw,
                task_type, opp_verdict, task_status
            )
            select
                new.id, item->>'shk', item->>'nm', item->>'name', item->>'status',
                nullif(item->>'price', '')::numeric, item->>'mx', item->>'movement',
                nullif(item->>'row_number', '')::integer, item->'raw',
                new.task_type, new.opp_verdict, new.task_status
            from jsonb_array_elements(coalesce(new.source_payload->'task_items', '[]'::jsonb)) item
            where item->>'shk' is not null
            on conflict (task_id, shk) do update set
                nm = excluded.nm,
                name = excluded.name,
                status = excluded.status,
                price = excluded.price,
                mx = excluded.mx,
                movement = excluded.movement,
                row_number = excluded.row_number,
                raw = excluded.raw,
                updated_at = now();
            exit;
        exception when unique_violation then
            if v_attempt >= 5 then
                raise;
            end if;
            perform pg_sleep(0.05 * v_attempt);
        end;
    end loop;
    return new;
end;
$function$;
