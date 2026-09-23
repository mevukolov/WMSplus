-- display.js's inventory-mode subscription (Task 3) subscribes to
-- postgres_changes on BOTH wms_no_shk_inventory_sessions and
-- wms_no_shk_inventory_shelf_audits. Task 4's fix (202609230002) added
-- only the sessions table to the realtime publication -- shelf_audits was
-- still missing, so rack green/red coloring was silently relying on the
-- 20s poll fallback instead of instant Realtime updates. Same class of
-- gap, same fix.
alter publication supabase_realtime add table public.wms_no_shk_inventory_shelf_audits;
