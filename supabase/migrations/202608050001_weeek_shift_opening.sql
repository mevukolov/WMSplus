create extension if not exists pgcrypto;

create table if not exists public.weeek_employees (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null unique,
  full_name text not null,
  telegram text,
  weeek_user_id text,
  is_active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.weeek_employees
  add column if not exists employee_id text,
  add column if not exists full_name text,
  add column if not exists telegram text,
  add column if not exists weeek_user_id text,
  add column if not exists is_active boolean not null default true,
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists weeek_employees_employee_id_uidx
  on public.weeek_employees (employee_id);

create index if not exists weeek_employees_active_name_idx
  on public.weeek_employees (is_active, full_name);

create table if not exists public.weeek_shifts (
  id uuid primary key default gen_random_uuid(),
  wh_id text not null default '50144199',
  shift_date date not null,
  shift_key text not null,
  shift_label text not null,
  status text not null default 'opened',
  incoming_employee_id uuid not null references public.weeek_employees(id),
  outgoing_employee_id uuid not null references public.weeek_employees(id),
  incoming_process text not null default 'Входящий поток',
  outgoing_process text not null default 'Исходящий поток',
  file_uploaded boolean not null default false,
  file_name text,
  opened_at timestamptz not null default timezone('utc', now()),
  opened_by text,
  source text not null default 'iframe',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint weeek_shifts_status_check check (status in ('opened','closed','cancelled'))
);

alter table public.weeek_shifts
  add column if not exists wh_id text not null default '50144199',
  add column if not exists shift_date date,
  add column if not exists shift_key text,
  add column if not exists shift_label text,
  add column if not exists status text not null default 'opened',
  add column if not exists incoming_employee_id uuid references public.weeek_employees(id),
  add column if not exists outgoing_employee_id uuid references public.weeek_employees(id),
  add column if not exists incoming_process text not null default 'Входящий поток',
  add column if not exists outgoing_process text not null default 'Исходящий поток',
  add column if not exists file_uploaded boolean not null default false,
  add column if not exists file_name text,
  add column if not exists opened_at timestamptz not null default timezone('utc', now()),
  add column if not exists opened_by text,
  add column if not exists source text not null default 'iframe',
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists weeek_shifts_wh_date_uidx
  on public.weeek_shifts (wh_id, shift_date)
  where status <> 'cancelled';

create index if not exists weeek_shifts_opened_at_idx
  on public.weeek_shifts (opened_at desc);

create index if not exists weeek_shifts_date_idx
  on public.weeek_shifts (shift_date desc);

create or replace function public.set_updated_at_weeek_employees()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_weeek_employees on public.weeek_employees;
create trigger trg_set_updated_at_weeek_employees
before update on public.weeek_employees
for each row
execute function public.set_updated_at_weeek_employees();

create or replace function public.set_updated_at_weeek_shifts()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_weeek_shifts on public.weeek_shifts;
create trigger trg_set_updated_at_weeek_shifts
before update on public.weeek_shifts
for each row
execute function public.set_updated_at_weeek_shifts();

comment on table public.weeek_employees is
  'Employee directory for WEEEK and Telegram automations.';

comment on table public.weeek_shifts is
  'Opened WEEEK operational shifts: who is responsible for incoming and outgoing flow.';
