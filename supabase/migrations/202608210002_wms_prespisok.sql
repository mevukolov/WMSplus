create extension if not exists pgcrypto;

create table if not exists public.wms_prespisok_runs (
  id uuid primary key default gen_random_uuid(),
  wh_id text not null default '50144199',
  run_date date not null,
  status text not null default 'started',
  file_name text,
  total_items integer not null default 0,
  completed_items integer not null default 0,
  excluded_items integer not null default 0,
  elapsed_ms integer not null default 0,
  operator_id text,
  operator_name text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.wms_prespisok_runs
  add column if not exists wh_id text not null default '50144199',
  add column if not exists run_date date,
  add column if not exists status text not null default 'started',
  add column if not exists file_name text,
  add column if not exists total_items integer not null default 0,
  add column if not exists completed_items integer not null default 0,
  add column if not exists excluded_items integer not null default 0,
  add column if not exists elapsed_ms integer not null default 0,
  add column if not exists operator_id text,
  add column if not exists operator_name text,
  add column if not exists started_at timestamptz not null default timezone('utc', now()),
  add column if not exists finished_at timestamptz,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists wms_prespisok_runs_date_idx
  on public.wms_prespisok_runs (wh_id, run_date desc);

create table if not exists public.wms_prespisok_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.wms_prespisok_runs(id) on delete cascade,
  item_key text not null,
  entity_type text not null,
  entity_id text not null,
  verdict text not null,
  extra_value text,
  price numeric,
  source_shk_ids text[] not null default '{}'::text[],
  source_tare_id text,
  task_created boolean not null default false,
  operator_id text,
  operator_name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.wms_prespisok_actions
  add column if not exists run_id uuid references public.wms_prespisok_runs(id) on delete cascade,
  add column if not exists item_key text,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists verdict text,
  add column if not exists extra_value text,
  add column if not exists price numeric,
  add column if not exists source_shk_ids text[] not null default '{}'::text[],
  add column if not exists source_tare_id text,
  add column if not exists task_created boolean not null default false,
  add column if not exists operator_id text,
  add column if not exists operator_name text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default timezone('utc', now());

create unique index if not exists wms_prespisok_actions_run_item_uidx
  on public.wms_prespisok_actions (run_id, item_key);

create index if not exists wms_prespisok_actions_shk_gin_idx
  on public.wms_prespisok_actions using gin (source_shk_ids);

create index if not exists wms_prespisok_actions_tare_idx
  on public.wms_prespisok_actions (source_tare_id);

create or replace function public.set_updated_at_wms_prespisok_runs()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_wms_prespisok_runs on public.wms_prespisok_runs;
create trigger trg_set_updated_at_wms_prespisok_runs
before update on public.wms_prespisok_runs
for each row
execute function public.set_updated_at_wms_prespisok_runs();

alter table public.wms_prespisok_runs disable row level security;
alter table public.wms_prespisok_actions disable row level security;

grant select, insert, update on public.wms_prespisok_runs to anon, authenticated;
grant select, insert on public.wms_prespisok_actions to anon, authenticated;
grant all on public.wms_prespisok_runs to service_role;
grant all on public.wms_prespisok_actions to service_role;

comment on table public.wms_prespisok_runs is 'Daily arcade-style pre-writeoff review sessions in WMS+.';
comment on table public.wms_prespisok_actions is 'Per-item decisions made during WMS+ pre-writeoff review.';
