-- display.js's new box-scan-flash subscription (inventory_box_scan_flash
-- channel) subscribes to postgres_changes INSERT on
-- wms_no_shk_inventory_box_results. Same gap class caught twice before in
-- this feature (sessions table, then shelf_audits table): a table can be
-- subscribed to in JS but silently receive nothing if it's not also
-- registered in this Postgres publication.
alter publication supabase_realtime add table public.wms_no_shk_inventory_box_results;
