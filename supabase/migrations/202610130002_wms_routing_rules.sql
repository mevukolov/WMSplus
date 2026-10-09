-- Фаза 1 движка правил маршрутизации. Та же модель прав, что у
-- остальных настроечных таблиц (wms_writeoff_terms) -- без RLS.
create table public.wms_routing_rules (
    id uuid primary key default gen_random_uuid(),
    priority integer not null unique,
    name text not null,
    is_active boolean not null default true,
    conditions jsonb not null default '[]'::jsonb,
    target_task_type text not null,
    grouping_attribute text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.wms_routing_rules to anon, authenticated;
