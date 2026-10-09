-- Фаза 1 кандидата D (docs/superpowers/specs/2026-10-08-wms-task-items-normalization-design.md):
-- зеркалим wms_tasks.source_payload.task_items построчно в отдельную таблицу.
-- Ничего в приложении это пока не читает -- чистая структурная подготовка
-- к Фазе 2 (зона/вердикт станут атрибутами ШК, а не группы).
create table public.wms_task_items (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null references public.wms_tasks(id) on delete cascade,
    shk text not null,
    nm text,
    name text,
    status text,
    price numeric,
    mx text,
    movement text,
    row_number integer,
    raw jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index wms_task_items_task_id_idx on public.wms_task_items (task_id);
create index wms_task_items_shk_idx on public.wms_task_items (shk);

-- security definer: много существующих путей пишут в wms_tasks напрямую
-- через клиентский anon/authenticated ключ (db.from(WMS_TASKS_TABLE).update(...)
-- в tasks.js), а не только через security definer RPC -- обычный (invoker-rights)
-- триггер упал бы без grant-ов на wms_task_items, которых мы сознательно
-- не выдаём в этой фазе (см. Global Constraints).
create or replace function public.wms_sync_task_items() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.wms_task_items where task_id = new.id;
    insert into public.wms_task_items (task_id, shk, nm, name, status, price, mx, movement, row_number, raw)
    select
        new.id,
        item->>'shk',
        item->>'nm',
        item->>'name',
        item->>'status',
        nullif(item->>'price', '')::numeric,
        item->>'mx',
        item->>'movement',
        nullif(item->>'row_number', '')::integer,
        item->'raw'
    from jsonb_array_elements(coalesce(new.source_payload->'task_items', '[]'::jsonb)) item
    where item->>'shk' is not null;
    return new;
end;
$$;

-- OLD не существует для INSERT -- WHEN, сравнивающий old/new, нельзя
-- повесить на триггер, слушающий ещё и INSERT. Два отдельных триггера на
-- одну функцию: INSERT всегда синхронизирует, UPDATE -- только если
-- source_payload реально изменился.
create trigger wms_tasks_sync_task_items_insert
    after insert on public.wms_tasks
    for each row
    execute function public.wms_sync_task_items();

create trigger wms_tasks_sync_task_items_update
    after update of source_payload on public.wms_tasks
    for each row
    when (old.source_payload is distinct from new.source_payload)
    execute function public.wms_sync_task_items();
