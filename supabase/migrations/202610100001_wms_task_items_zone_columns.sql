-- Фаза 2 кандидата D (docs/superpowers/specs/2026-10-09-wms-task-items-phase2-zone-design.md):
-- зона/вердикт/статус переезжают на уровень ШК. responsibility_zone
-- сознательно не добавляется -- не используется в контуре "Чистые
-- списания". Зоно-специфичные поля (lr/date_lost) идут в zone_payload,
-- не отдельными колонками -- под будущие зоны со своими полями.
alter table public.wms_task_items
    add column task_type text,
    add column opp_verdict text,
    add column task_status text,
    add column completed_at timestamptz,
    add column reopen_after timestamptz,
    add column zone_payload jsonb not null default '{}'::jsonb;

alter table public.wms_task_items
    add constraint wms_task_items_task_id_shk_key unique (task_id, shk);

-- Grant на update -- впервые таблицу пишет не только security definer RPC,
-- а напрямую клиентский JS (вкладка "Чистые списания" читает её,
-- completePureLossesItemFromDetail пишет в неё). RLS не включаем -- тот
-- же принцип, каким уже работают wms_tasks/wms_superset_cache.
grant select, update on public.wms_task_items to anon, authenticated;
