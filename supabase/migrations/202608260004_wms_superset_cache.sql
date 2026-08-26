-- "Быстрая проверка Без ШК" (and the Актуализация movement-check) currently
-- only cache the uploaded Superset export in localStorage
-- (QUICK_NO_SHK_SUPERSET_CACHE_KEY), so switching devices mid-shift forces a
-- full re-upload of the same file someone already fed the app minutes
-- earlier from a different computer. This table lets any device pull
-- whatever the warehouse most recently uploaded, keyed by SHK.
create table if not exists public.wms_superset_cache (
  wh_id text not null,
  shk text not null,
  nm text,
  name text,
  last_office text,
  last_status text,
  last_status_at text,
  last_status_ts bigint,
  price numeric,
  updated_at timestamptz not null default now(),
  primary key (wh_id, shk)
);

create index if not exists wms_superset_cache_updated_idx
  on public.wms_superset_cache (wh_id, updated_at desc);

grant select, insert, update, delete on public.wms_superset_cache to anon, authenticated;
