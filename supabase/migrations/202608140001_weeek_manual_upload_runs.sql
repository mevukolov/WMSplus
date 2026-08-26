create extension if not exists pgcrypto;

create table if not exists public.weeek_manual_upload_runs (
  id uuid primary key default gen_random_uuid(),
  upload_date date not null,
  effective_date date not null,
  business_date date,
  source_module text not null,
  upload_type text not null,
  status text not null default 'completed',
  file_name text,
  secondary_file_name text,
  rows_count integer not null default 0,
  tasks_count integer not null default 0,
  upserted_count integer not null default 0,
  processed_count integer not null default 0,
  failed_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.weeek_manual_upload_runs
  add column if not exists effective_date date;

update public.weeek_manual_upload_runs
set effective_date = coalesce(effective_date, business_date, upload_date)
where effective_date is null;

alter table public.weeek_manual_upload_runs
  alter column effective_date set not null;

drop index if exists weeek_manual_upload_runs_daily_uidx;
create unique index if not exists weeek_manual_upload_runs_effective_daily_uidx
  on public.weeek_manual_upload_runs (effective_date, source_module, upload_type);

create index if not exists weeek_manual_upload_runs_source_idx
  on public.weeek_manual_upload_runs (source_module, upload_type, effective_date desc);

drop trigger if exists trg_set_updated_at_weeek_manual_upload_runs on public.weeek_manual_upload_runs;
create trigger trg_set_updated_at_weeek_manual_upload_runs
before update on public.weeek_manual_upload_runs
for each row
execute function public.set_updated_at_weeek_tasks();

comment on table public.weeek_manual_upload_runs is
  'Daily log of manual XLSX uploads into weeek_tasks_basic. Used by iframes to prevent accidental repeated uploads and to audit what was uploaded each day.';
