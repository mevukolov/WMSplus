-- Compact, per-day cache for the staff "Shift pulse" modal. The source
-- history remains authoritative; this table only makes reopening completed
-- shifts fast and keeps the already-built barcode details available.
create table if not exists public.wms_staff_shift_pulse_snapshots (
    shift_date date primary key,
    snapshot jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists wms_staff_shift_pulse_snapshots_updated_idx
    on public.wms_staff_shift_pulse_snapshots (updated_at desc);

alter table public.wms_staff_shift_pulse_snapshots enable row level security;

drop policy if exists wms_staff_shift_pulse_snapshots_authenticated_all
    on public.wms_staff_shift_pulse_snapshots;
create policy wms_staff_shift_pulse_snapshots_authenticated_all
    on public.wms_staff_shift_pulse_snapshots
    for all
    to authenticated
    using (true)
    with check (true);

grant select, insert, update, delete on public.wms_staff_shift_pulse_snapshots to authenticated;
