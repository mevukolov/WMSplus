-- 202609240003_no_shk_boxes_shortage.sql
-- A box the mobile inventory app expected on a shelf but didn't scan
-- there this pass (wms_no_shk_inventory_box_results.result = 'not_found')
-- must stop appearing on that shelf. It's tracked separately from "На
-- полу" (shelf_id null, a normal in-progress placement state) via this
-- flag, so display.js/no_shk_zone.js can render it in its own
-- "Недостача" section instead of silently mixing it into the floor.

alter table public.wms_no_shk_boxes
    add column shortage boolean not null default false;
