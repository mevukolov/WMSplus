-- Флоу Phase 2 (roster): per-employee zone list, replacing the old
-- two-named-role model. incoming_employee_id/outgoing_employee_id stay in
-- the schema untouched (may be relied on by reporting outside this repo)
-- -- they just stop being written for shifts saved after this migration.
alter table public.wms_shifts
  add column if not exists roster jsonb not null default '[]'::jsonb;
