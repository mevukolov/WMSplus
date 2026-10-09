-- Фаза 2: старый (Фаза 1) триггер полностью пересобирал строки при
-- каждой записи source_payload -- это стёрло бы разошедшуюся зону при
-- первом же несвязанном изменении родителя. Новая версия -- upsert,
-- зона/вердикт/zone_payload НЕ в списке update на conflict: однажды
-- заданные (на INSERT или явной записью RPC/UI), больше не трогаются
-- этой функцией.
--
-- Сознательно убрано поведение "удалить строки для ШК, пропавших из
-- task_items родителя" (было в Фазе 1) -- принятое ограничение, см.
-- спеку, раздел 2.
create or replace function public.wms_sync_task_items() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
$$;
