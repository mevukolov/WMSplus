-- Баг: "duplicate key value violates unique constraint
-- wms_task_items_shk_active_unique". wms_sync_task_items() вставляет
-- строки нового таска через insert ... on conflict (task_id, shk) --
-- это ловит только повторную синхронизацию ВНУТРИ того же таска. Если
-- ШК физически переложили в другую тару (новый таск), а старая задача
-- ещё не закрыта -- его активная строка wms_task_items всё ещё висит
-- под СТАРЫМ task_id, и insert для НОВОГО task_id падает на отдельный
-- partial-уникальный индекс wms_task_items_shk_active_unique (shk)
-- WHERE task_status <> 'Завершено' (у ШК может быть только одна активная
-- строка во всей таблице, независимо от таска). Postgres допускает
-- только один ON CONFLICT target на insert, а тут их по сути два разных
-- ограничения -- поэтому вместо insert чиним конфликт заранее: если у
-- ШК уже есть активная строка под ДРУГИМ таском, просто переносим её на
-- новый (task_id/task_type/вердикт/статус), а не создаём вторую.
-- Расширенное окно выгрузки (см. 202610190002 и обсуждение до него)
-- резко увеличило частоту таких пересечений -- раньше окно было узким
-- и редко захватывало уже перегруппированные ШК.
create or replace function public.wms_sync_task_items()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    return new;
end;
$function$;
