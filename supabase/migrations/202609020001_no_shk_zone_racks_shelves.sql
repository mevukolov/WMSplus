-- 202609020001_no_shk_zone_racks_shelves.sql
-- Physical storage structure for the "Без ШК" zone (racks -> shelves with
-- capacity). First step: structure only, no linking to actual boxes/SHK
-- yet -- that's a later step toward physical navigation through WMS.
create table public.wms_no_shk_racks (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now()
);

create table public.wms_no_shk_shelves (
    id uuid primary key default gen_random_uuid(),
    rack_id uuid not null references public.wms_no_shk_racks(id) on delete cascade,
    name text not null,
    capacity integer not null default 0,
    created_at timestamptz not null default now()
);

create index wms_no_shk_shelves_rack_id_idx on public.wms_no_shk_shelves (rack_id);

alter table public.wms_no_shk_racks enable row level security;
alter table public.wms_no_shk_shelves enable row level security;

-- Same open-policy pattern as the rest of this app -- gated by the app's
-- own login (auth.js), not Supabase Auth/RLS roles.
create policy "wms_no_shk_racks_all" on public.wms_no_shk_racks
    for all using (true) with check (true);
create policy "wms_no_shk_shelves_all" on public.wms_no_shk_shelves
    for all using (true) with check (true);
