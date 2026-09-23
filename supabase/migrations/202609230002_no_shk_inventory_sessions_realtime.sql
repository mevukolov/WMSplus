-- mobile-inventory.js (Task 4) subscribes to postgres_changes UPDATE
-- events on wms_no_shk_inventory_sessions to recover a phone left open on
-- a session that got marked 'abandoned' (display.js's 30-minute
-- staleness check). That subscription is a no-op unless the table is
-- part of the supabase_realtime publication -- it was not (only
-- print_jobs was), so the reload-on-abandon path silently never fired.
-- Discovered and fixed during Task 4's live verification.
alter publication supabase_realtime add table public.wms_no_shk_inventory_sessions;
