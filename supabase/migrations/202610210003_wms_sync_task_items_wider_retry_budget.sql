-- Та же ошибка (wms_task_items_task_id_shk_key) снова всплыла -- на этот
-- раз в Предсписке, при "Создать задачу" (save_wms_manual_upload ->
-- wms_sync_task_items). Фикс от 202610210001 (ретрай при unique_violation)
-- уже стоит и работает, но его бюджет (5 попыток, суммарно ~0.5с) не
-- всегда перекрывает конкурентов: в cron.job нет ничего, что бы напрямую
-- спорило за эти строки (auto_reopen_wms_tasks раз в 5 мин использует
-- for update skip locked -- безопасно), но внешние edge-функции
-- (weeek-incoming-flow-requests-refresh, weeek-awh-writeoffs-refresh и
-- т.п.) дёргаются каждые 5-10 минут и тоже пишут в wms_tasks -- реальный
-- источник фоновой гонки вне контроля клиента. Расширяем бюджет ретрая
-- (10 попыток, больше суммарное время ожидания) -- строго безопасно,
-- поведение в отсутствие гонки не меняется.
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
            if v_attempt >= 10 then
                raise;
            end if;
            perform pg_sleep(least(0.5, 0.05 * v_attempt));
        end;
    end loop;
    return new;
end;
$function$;
