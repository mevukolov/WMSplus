-- "ШК в предсписке" history marker (task history feed): needs a fast
-- lookup from a task's ШК/тара to the предсписок run(s) it was uploaded
-- in. The full item list is already written into wms_prespisok_runs.payload
-- on every upload (prespisokCompactPayload -> items_full/items), so this
-- adds no new write -- just two extra columns on the SAME row that
-- upsertPrespisokRun("started") already writes at upload time, populated
-- from the same in-memory item list.
alter table public.wms_prespisok_runs
  add column if not exists shk_ids text[] not null default '{}'::text[],
  add column if not exists tare_ids text[] not null default '{}'::text[];

create index if not exists wms_prespisok_runs_shk_gin_idx
  on public.wms_prespisok_runs using gin (shk_ids);

create index if not exists wms_prespisok_runs_tare_gin_idx
  on public.wms_prespisok_runs using gin (tare_ids);
