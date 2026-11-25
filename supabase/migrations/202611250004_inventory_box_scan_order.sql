-- The left-to-right order in which a worker scans boxes is part of the
-- inventory result, not merely a presentation detail.  Persist it so the
-- mobile shelf and future reports reproduce the real sequence exactly.

alter table public.wms_no_shk_inventory_box_results
    add column if not exists scan_order integer;

with numbered as (
    select
        id,
        row_number() over (
            partition by session_id, shelf_id
            order by recorded_at, id
        ) as calculated_order
    from public.wms_no_shk_inventory_box_results
    where result in ('found', 'missing_sticker')
      and scan_order is null
)
update public.wms_no_shk_inventory_box_results as result
set scan_order = numbered.calculated_order
from numbered
where result.id = numbered.id;

create index if not exists wms_no_shk_inventory_box_results_scan_order_idx
    on public.wms_no_shk_inventory_box_results (session_id, shelf_id, scan_order);

create unique index if not exists wms_no_shk_inventory_box_results_scan_order_unique_idx
    on public.wms_no_shk_inventory_box_results (session_id, shelf_id, scan_order)
    where scan_order is not null;

comment on column public.wms_no_shk_inventory_box_results.scan_order is
    'Порядковый номер сканирования короба на полке слева направо.';
