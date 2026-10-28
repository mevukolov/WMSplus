-- wms_sync_task_items() "крадёт" ещё активные строки wms_task_items из
-- ДРУГИХ задач (ti.task_id <> new.id), когда их ШК встречается в новом
-- source_payload.task_items -- задумано для легитимной переклассификации.
-- Но если у задачи есть ДУБЛЬ (та же физическая тара сохранена под
-- двумя разными task_id -- см. 202610260001 и разговор про
-- source_id/дату, задача на будущее уже исправлена, но старые дубли в
-- базе остались), у ОБЕИХ задач одни и те же ШК. При любом сохранении
-- одной из них (напр. завершение вердиктом -- source_payload меняется,
-- триггер срабатывает) эта update-кража пытается перевесить строки
-- "донора" на task_id=new.id -- но у new.id уже ЕСТЬ своя строка с тем
-- же ШК, и update напрямую бьётся об уникальный индекс (task_id, shk)
-- БЕЗ on conflict (в отличие от insert ниже, у которого он есть) --
-- "Не удалось завершить задачу: duplicate key value violates unique
-- constraint wms_task_items_task_id_shk_key", воспроизведено на
-- тара 5572407563 (28 ШК дублированы между 2 активными задачами).
-- Фикс: не воровать строку, если у new.id уже есть своя строка с этим
-- ШК -- insert ... on conflict ниже и так обновит её свежими данными.
create or replace function public.wms_sync_task_items()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_attempt integer := 0;
    v_detail text;
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
              and ti.task_status <> 'Завершено'
              and not exists (
                  select 1 from public.wms_task_items existing
                  where existing.task_id = new.id and existing.shk = item->>'shk'
              );

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
            get stacked diagnostics v_detail = pg_exception_detail;
            insert into public.wms_debug_sync_conflicts (task_id, source_module, task_type, attempt, detail)
            values (new.id, new.source_module, new.task_type, v_attempt, v_detail);
            if v_attempt >= 10 then
                raise;
            end if;
            perform pg_sleep(least(0.5, 0.05 * v_attempt));
        end;
    end loop;
    return new;
end;
$function$;
