-- Root cause of Path 2 (бренд+наименование, 202609300013) never firing:
-- Superset's own "Наименование" column isn't a product title -- it's a
-- composite per-SKU label the warehouse's own 1C/WMS export builds as
-- "<description> <brand> арт <article> р <size> код <nm>", with the nm
-- itself baked into the tail. Two different nm's (size/color variants of
-- the same product) can never share that string by construction, since
-- each one's own nm is embedded in it -- confirmed live: after stripping
-- the " арт ..." tail, real groups of 5-12 different nm's share the same
-- base description (e.g. "Ботинки демисезонные черные челси на
-- платформе Tonakolli" x12). WB's own imt_name (source='wb', from the
-- basket CDN) never had this problem -- only superset/task_backfill rows
-- need the strip.
update public.wms_nm_directory
set name = regexp_replace(name, '\s+арт\s+.*$', '')
where source in ('superset', 'task_backfill')
  and name ~ '\sарт\s';
