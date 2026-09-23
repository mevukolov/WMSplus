-- 202609230001_no_shk_inventory.sql
-- "Инвентаризация «Без ШК»" (docs/superpowers/specs/2026-09-23-no-shk-inventory-design.md):
-- a worker walks the racks scanning shelves/boxes with the mobile app,
-- paired live with display.html. These three tables ARE the sync
-- channel between the two devices (not a one-shot broadcast) plus the
-- discrepancy history the spec asks for.

create table public.wms_no_shk_inventory_sessions (
    id uuid primary key default gen_random_uuid(),
    status text not null default 'waiting_for_phone'
        check (status in ('waiting_for_phone', 'in_progress', 'completed', 'abandoned')),
    started_by_id text,
    started_by_name text,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    last_activity_at timestamptz not null default now(),
    step text not null default 'pairing'
        check (step in ('pairing', 'scan_shelf', 'scan_boxes', 'completed')),
    current_shelf_id uuid references public.wms_no_shk_shelves(id)
);

-- At most one session may be actively waiting/running at a time --
-- mobile-inventory.js checks for an existing row before inserting, but
-- a partial unique index makes it actually enforced, not just an
-- app-level convention a race could slip past.
create unique index wms_no_shk_inventory_sessions_active_idx
    on public.wms_no_shk_inventory_sessions ((true))
    where status in ('waiting_for_phone', 'in_progress');

create table public.wms_no_shk_inventory_shelf_audits (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.wms_no_shk_inventory_sessions(id),
    shelf_id uuid not null references public.wms_no_shk_shelves(id),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    boxes_found_count integer not null default 0,
    boxes_missing_sticker_count integer not null default 0,
    boxes_not_found_count integer not null default 0,
    unique (session_id, shelf_id)
);

create table public.wms_no_shk_inventory_box_results (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.wms_no_shk_inventory_sessions(id),
    shelf_id uuid not null references public.wms_no_shk_shelves(id),
    box_id uuid not null references public.wms_no_shk_boxes(id),
    result text not null check (result in ('found', 'missing_sticker', 'not_found')),
    recorded_at timestamptz not null default now()
);

alter table public.wms_no_shk_inventory_sessions enable row level security;
alter table public.wms_no_shk_inventory_shelf_audits enable row level security;
alter table public.wms_no_shk_inventory_box_results enable row level security;

-- Same "anon full access" shape as wms_no_shk_boxes/racks/shelves already use.
create policy wms_no_shk_inventory_sessions_all on public.wms_no_shk_inventory_sessions
    for all using (true) with check (true);
create policy wms_no_shk_inventory_shelf_audits_all on public.wms_no_shk_inventory_shelf_audits
    for all using (true) with check (true);
create policy wms_no_shk_inventory_box_results_all on public.wms_no_shk_inventory_box_results
    for all using (true) with check (true);

grant select, insert, update, delete on public.wms_no_shk_inventory_sessions to anon;
grant select, insert, update, delete on public.wms_no_shk_inventory_shelf_audits to anon;
grant select, insert, update, delete on public.wms_no_shk_inventory_box_results to anon;
