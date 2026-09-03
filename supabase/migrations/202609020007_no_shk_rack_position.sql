-- 202609020007_no_shk_rack_position.sql
-- Racks need a reorderable display position, separate from rack_number
-- (which is baked into already-printed shelf QR labels and must never
-- change). Admin reordering only ever touches `position`.
alter table public.wms_no_shk_racks add column position integer;
update public.wms_no_shk_racks r
set position = sub.rn
from (
    select id, row_number() over (order by created_at) as rn
    from public.wms_no_shk_racks
) sub
where r.id = sub.id;
alter table public.wms_no_shk_racks alter column position set not null;
