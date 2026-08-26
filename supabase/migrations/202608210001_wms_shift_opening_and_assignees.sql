create extension if not exists pgcrypto;

create table if not exists public.wms_employees (
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

alter table public.wms_employees
  add column if not exists employee_id text,
  add column if not exists full_name text,
  add column if not exists telegram text,
  add column if not exists weeek_user_id text,
  add column if not exists is_active boolean not null default true,
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists wms_employees_employee_id_uidx
  on public.wms_employees (employee_id);

create index if not exists wms_employees_active_name_idx
  on public.wms_employees (is_active, full_name);

insert into public.wms_employees (employee_id, full_name, telegram, weeek_user_id, is_active)
values
  ('205912', 'Воронова Алена', null, null, true),
  ('1034305', 'Вуколов Максим', null, null, true),
  ('877894', 'Мусаев Роман', null, null, true),
  ('250626', 'Пахомова Виктория', null, null, true),
  ('360763', 'Ткачева Ксения', null, null, true)
on conflict (employee_id) do update set
  full_name = excluded.full_name,
  telegram = coalesce(public.wms_employees.telegram, excluded.telegram),
  weeek_user_id = coalesce(public.wms_employees.weeek_user_id, excluded.weeek_user_id),
  is_active = excluded.is_active,
  updated_at = timezone('utc', now());

do $$
begin
  if to_regclass('public.weeek_employees') is not null then
    execute $copy$
      insert into public.wms_employees (employee_id, full_name, telegram, weeek_user_id, is_active, meta)
      select employee_id, full_name, telegram, weeek_user_id, is_active, coalesce(meta, '{}'::jsonb)
      from public.weeek_employees
      where nullif(employee_id, '') is not null and nullif(full_name, '') is not null
      on conflict (employee_id) do update set
        full_name = excluded.full_name,
        telegram = coalesce(excluded.telegram, public.wms_employees.telegram),
        weeek_user_id = coalesce(excluded.weeek_user_id, public.wms_employees.weeek_user_id),
        is_active = excluded.is_active,
        meta = public.wms_employees.meta || excluded.meta,
        updated_at = timezone('utc', now())
    $copy$;
  end if;
end $$;

create table if not exists public.wms_shifts (
  id uuid primary key default gen_random_uuid(),
  wh_id text not null default '50144199',
  shift_date date not null,
  shift_key text not null,
  shift_label text not null,
  status text not null default 'opened',
  incoming_employee_id uuid not null references public.wms_employees(id),
  outgoing_employee_id uuid not null references public.wms_employees(id),
  incoming_process text not null default 'Входящий поток',
  outgoing_process text not null default 'Исходящий поток',
  file_uploaded boolean not null default false,
  file_name text,
  opened_at timestamptz not null default timezone('utc', now()),
  opened_by text,
  source text not null default 'wms_tasks_page',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint wms_shifts_status_check check (status in ('opened','closed','cancelled'))
);

alter table public.wms_shifts
  add column if not exists wh_id text not null default '50144199',
  add column if not exists shift_date date,
  add column if not exists shift_key text,
  add column if not exists shift_label text,
  add column if not exists status text not null default 'opened',
  add column if not exists incoming_employee_id uuid references public.wms_employees(id),
  add column if not exists outgoing_employee_id uuid references public.wms_employees(id),
  add column if not exists incoming_process text not null default 'Входящий поток',
  add column if not exists outgoing_process text not null default 'Исходящий поток',
  add column if not exists file_uploaded boolean not null default false,
  add column if not exists file_name text,
  add column if not exists opened_at timestamptz not null default timezone('utc', now()),
  add column if not exists opened_by text,
  add column if not exists source text not null default 'wms_tasks_page',
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists wms_shifts_wh_date_uidx
  on public.wms_shifts (wh_id, shift_date)
  where status <> 'cancelled';

create index if not exists wms_shifts_date_idx
  on public.wms_shifts (shift_date desc);

create or replace function public.set_updated_at_wms_employees()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_wms_employees on public.wms_employees;
create trigger trg_set_updated_at_wms_employees
before update on public.wms_employees
for each row
execute function public.set_updated_at_wms_employees();

create or replace function public.set_updated_at_wms_shifts()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_wms_shifts on public.wms_shifts;
create trigger trg_set_updated_at_wms_shifts
before update on public.wms_shifts
for each row
execute function public.set_updated_at_wms_shifts();

create or replace function public.wms_safe_numeric(p_value text)
returns numeric
language plpgsql
immutable
as $$
begin
  return nullif(p_value, '')::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.wms_safe_integer(p_value text)
returns integer
language plpgsql
immutable
as $$
begin
  return nullif(p_value, '')::integer;
exception when others then
  return null;
end;
$$;

create or replace function public.wms_safe_date(p_value text)
returns date
language plpgsql
immutable
as $$
begin
  return nullif(p_value, '')::date;
exception when others then
  return null;
end;
$$;

create or replace function public.wms_safe_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  return nullif(p_value, '')::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.save_wms_manual_upload(p_tasks jsonb, p_run jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
  run_row public.wms_manual_upload_runs%rowtype;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;

  with raw_items as (
    select value as item
    from jsonb_array_elements(p_tasks)
  ), prepared as (
    select
      nullif(item->>'source_module', '') as source_module,
      item->>'source_table' as source_table,
      nullif(item->>'source_id', '') as source_id,
      item->>'source_row_id' as source_row_id,
      coalesce(item->'source_payload', '{}'::jsonb) as source_payload,
      public.wms_safe_timestamptz(item->>'source_generated_at') as source_generated_at,
      case
        when jsonb_typeof(item->'source_shk_ids') = 'array'
          then array(select jsonb_array_elements_text(item->'source_shk_ids'))
        else '{}'::text[]
      end as source_shk_ids,
      nullif(item->>'source_tare_id', '') as source_tare_id,
      public.wms_safe_numeric(item->>'source_price_sum') as source_price_sum,
      public.wms_safe_timestamptz(item->>'source_last_movement_at') as source_last_movement_at,
      nullif(item->>'search_text', '') as search_text,
      nullif(item->>'upload_type', '') as upload_type,
      public.wms_safe_date(item->>'upload_effective_date') as upload_effective_date,
      nullif(item->>'task_type', '') as task_type,
      item->>'title' as title,
      item->>'description' as description,
      public.wms_safe_integer(item->>'priority') as priority,
      nullif(item->>'priority_label', '') as priority_label,
      public.wms_safe_date(item->>'due_date') as due_date,
      coalesce(nullif(item->>'responsibility_zone', ''), 'Нет привязки') as responsibility_zone,
      coalesce(nullif(item->>'task_status', ''), 'Не начато') as task_status,
      coalesce(nullif(item->>'opp_verdict', ''), 'Не выбран') as opp_verdict,
      nullif(item->>'assignee_employee_id', '') as assignee_employee_id,
      nullif(item->>'assignee_name', '') as assignee_name,
      coalesce(item->'tags', '[]'::jsonb) as tags
    from raw_items
    where nullif(item->>'source_module', '') is not null
      and nullif(item->>'source_id', '') is not null
      and nullif(item->>'task_type', '') is not null
  ), upserted as (
    insert into public.wms_tasks (
      source_module,
      source_table,
      source_id,
      source_row_id,
      source_payload,
      source_generated_at,
      source_shk_ids,
      source_tare_id,
      source_price_sum,
      source_last_movement_at,
      search_text,
      upload_type,
      upload_effective_date,
      task_type,
      title,
      description,
      priority,
      priority_label,
      due_date,
      responsibility_zone,
      task_status,
      opp_verdict,
      assignee_employee_id,
      assignee_name,
      tags,
      last_seen_at
    )
    select
      source_module,
      source_table,
      source_id,
      source_row_id,
      source_payload,
      source_generated_at,
      source_shk_ids,
      source_tare_id,
      source_price_sum,
      source_last_movement_at,
      search_text,
      upload_type,
      upload_effective_date,
      task_type,
      title,
      description,
      priority,
      priority_label,
      due_date,
      responsibility_zone,
      task_status,
      opp_verdict,
      assignee_employee_id,
      assignee_name,
      tags,
      timezone('utc', now())
    from prepared
    on conflict (source_module, source_id, task_type)
    do update set
      source_table = excluded.source_table,
      source_row_id = excluded.source_row_id,
      source_payload = excluded.source_payload,
      source_generated_at = excluded.source_generated_at,
      source_shk_ids = excluded.source_shk_ids,
      source_tare_id = excluded.source_tare_id,
      source_price_sum = excluded.source_price_sum,
      source_last_movement_at = excluded.source_last_movement_at,
      search_text = excluded.search_text,
      upload_type = excluded.upload_type,
      upload_effective_date = excluded.upload_effective_date,
      title = excluded.title,
      description = excluded.description,
      priority = excluded.priority,
      priority_label = excluded.priority_label,
      due_date = excluded.due_date,
      responsibility_zone = excluded.responsibility_zone,
      assignee_employee_id = coalesce(excluded.assignee_employee_id, public.wms_tasks.assignee_employee_id),
      assignee_name = coalesce(excluded.assignee_name, public.wms_tasks.assignee_name),
      tags = excluded.tags,
      last_seen_at = excluded.last_seen_at,
      updated_at = timezone('utc', now())
    returning 1
  )
  select count(*) into affected_count from upserted;

  if p_run is not null and jsonb_typeof(p_run) = 'object' and nullif(p_run->>'source_module', '') is not null then
    insert into public.wms_manual_upload_runs (
      upload_date,
      effective_date,
      business_date,
      source_module,
      upload_type,
      status,
      file_name,
      secondary_file_name,
      rows_count,
      tasks_count,
      upserted_count,
      summary
    )
    values (
      coalesce(public.wms_safe_date(p_run->>'upload_date'), timezone('Europe/Moscow', now())::date),
      coalesce(public.wms_safe_date(p_run->>'effective_date'), public.wms_safe_date(p_run->>'business_date'), timezone('Europe/Moscow', now())::date),
      public.wms_safe_date(p_run->>'business_date'),
      p_run->>'source_module',
      coalesce(nullif(p_run->>'upload_type', ''), p_run->>'source_module'),
      coalesce(nullif(p_run->>'status', ''), 'completed'),
      p_run->>'file_name',
      p_run->>'secondary_file_name',
      coalesce(public.wms_safe_integer(p_run->>'rows_count'), 0),
      coalesce(public.wms_safe_integer(p_run->>'tasks_count'), affected_count),
      affected_count,
      coalesce(p_run->'summary', '{}'::jsonb)
    )
    on conflict (effective_date, source_module, upload_type)
    do update set
      upload_date = excluded.upload_date,
      business_date = excluded.business_date,
      status = excluded.status,
      file_name = excluded.file_name,
      secondary_file_name = excluded.secondary_file_name,
      rows_count = excluded.rows_count,
      tasks_count = excluded.tasks_count,
      upserted_count = excluded.upserted_count,
      summary = excluded.summary,
      updated_at = timezone('utc', now())
    returning * into run_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upserted_count', affected_count,
    'upload_run', case when run_row.id is null then null else to_jsonb(run_row) end
  );
end;
$$;

alter table public.wms_employees disable row level security;
alter table public.wms_shifts disable row level security;

grant select, insert, update on public.wms_employees to anon, authenticated;
grant select, insert, update on public.wms_shifts to anon, authenticated;
grant all on public.wms_employees to service_role;
grant all on public.wms_shifts to service_role;
grant execute on function public.save_wms_manual_upload(jsonb, jsonb) to anon, authenticated;

do $$
begin
  if to_regclass('public.pure_losses_rep') is not null then
    execute 'grant select, insert, update on public.pure_losses_rep to anon, authenticated';
  end if;
  if to_regclass('public.losses_rep') is not null then
    execute 'grant select on public.losses_rep to anon, authenticated';
  end if;
end $$;

comment on table public.wms_employees is 'Employee directory for native WMS+ OPP shifts and task assignments.';
comment on table public.wms_shifts is 'Native WMS+ shift openings: responsible employees and pure losses upload stats.';
comment on function public.save_wms_manual_upload(jsonb, jsonb) is 'Bulk saves WMS+ tasks and writes upload run. Preserves assignees assigned from opened WMS+ shifts.';
