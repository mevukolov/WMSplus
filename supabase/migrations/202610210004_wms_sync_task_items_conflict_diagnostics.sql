-- Ретрай (202610210001/202610210003) не убрал ошибку -- значит дело не в
-- "не успели подождать своей очереди". Прямая симуляция ТОЧНОГО вызова
-- save_wms_manual_upload для конкретного кейса пользователя (ШК
-- 58485402473, Предсписок) прошла БЕЗ ошибки -- значит причина не
-- воспроизводится так, как я её себе представлял, и дальше гадать вслепую
-- бессмысленно. Вместо ещё одной спекулятивной правки -- ловим точные
-- улики при следующем же реальном срабатывании: таблица-лог + триггер
-- при первом же unique_violation (до всяких ретраев) пишет туда new.id/
-- source_module/task_type и ТОЧНЫЙ DETAIL от Postgres (он содержит
-- "Key (task_id, shk)=(..., ...) already exists" -- именно то значение,
-- с которым было столкновение). Эта запись переживает ретраи и
-- финальный успех/провал (делается в exception-блоке, это отдельный
-- под-уровень транзакции после отката к savepoint).
create table if not exists public.wms_debug_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid,
  source_module text,
  task_type text,
  attempt integer,
  detail text,
  created_at timestamptz not null default timezone('utc', now())
);

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
