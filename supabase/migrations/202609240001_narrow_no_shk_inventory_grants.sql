-- 202609240001_narrow_no_shk_inventory_grants.sql
-- Final whole-branch review (2026-09-24) of docs/superpowers/plans/2026-09-23-no-shk-inventory.md
-- flagged that 202609230001 granted delete uniformly across all three
-- inventory tables, but the app only ever deletes from
-- wms_no_shk_inventory_box_results (startShelfScan()'s "re-scanning an
-- already-audited shelf this session should redo it cleanly" reset).
-- wms_no_shk_inventory_sessions and wms_no_shk_inventory_shelf_audits are
-- audit-log-shaped tables nothing in the app ever deletes from, and the
-- anon key that can reach them is embedded in a public, link-only page --
-- narrowing removes an unused capability to delete the audit trail.
revoke delete on public.wms_no_shk_inventory_sessions from anon;
revoke delete on public.wms_no_shk_inventory_shelf_audits from anon;
