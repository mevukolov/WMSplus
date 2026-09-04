-- Флоу Phase 2 (roster): incoming_employee_id/outgoing_employee_id are
-- being replaced by wms_shifts.roster (see 202609020005_wms_shifts_roster.sql)
-- -- saveShiftOpening (tasks.js) stopped writing these two columns for
-- new/updated shifts, but they were NOT NULL with no default, which broke
-- inserting a brand-new shift row (any new day/warehouse) entirely. Drop
-- the NOT NULL constraint so old rows keep their existing values (untouched)
-- and new rows can simply omit them, exactly as the roster migration
-- always intended (the columns "stay in the schema, just stop being
-- written for new/updated shifts").
alter table public.wms_shifts
  alter column incoming_employee_id drop not null,
  alter column outgoing_employee_id drop not null;
