create extension if not exists pgcrypto;

create table if not exists public.wms_manual_upload_settings (
  module text primary key,
  label text not null,
  source_module text not null,
  upload_type text not null,
  upload_offset_days integer not null default 0,
  task_deadline_days integer not null default 1,
  is_required boolean not null default true,
  responsibility_zone text not null default 'Исходящий поток',
  description text,
  sort_order integer not null default 100,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.wms_manual_upload_runs (
  id uuid primary key default gen_random_uuid(),
  upload_date date not null default (timezone('Europe/Moscow', now())::date),
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
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists wms_manual_upload_runs_effective_daily_uidx
  on public.wms_manual_upload_runs (effective_date, source_module, upload_type);

create index if not exists wms_manual_upload_runs_source_idx
  on public.wms_manual_upload_runs (source_module, upload_type, effective_date desc);

create table if not exists public.wms_tasks (
  id uuid primary key default gen_random_uuid(),
  source_module text not null,
  source_table text,
  source_id text not null,
  source_row_id text,
  source_payload jsonb not null default '{}'::jsonb,
  source_generated_at timestamptz,
  source_shk_ids text[] not null default '{}'::text[],
  source_tare_id text,
  source_price_sum numeric,
  source_last_movement_at timestamptz,
  search_text text,
  upload_type text,
  upload_effective_date date,
  task_type text not null,
  title text not null,
  description text,
  priority integer,
  priority_label text,
  due_date date,
  responsibility_zone text not null default 'Нет привязки',
  task_status text not null default 'Не начато',
  opp_verdict text not null default 'Не выбран',
  assignee_employee_id text,
  assignee_name text,
  tags jsonb not null default '[]'::jsonb,
  is_deleted boolean not null default false,
  completed_at timestamptz,
  reopened_at timestamptz,
  reopen_after timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists wms_tasks_source_uidx
  on public.wms_tasks (source_module, source_id, task_type);

create index if not exists wms_tasks_status_idx
  on public.wms_tasks (task_status, due_date);

create index if not exists wms_tasks_upload_idx
  on public.wms_tasks (upload_effective_date, upload_type);

create index if not exists wms_tasks_source_tare_idx
  on public.wms_tasks (source_tare_id)
  where source_tare_id is not null;

create index if not exists wms_tasks_source_shk_ids_gin_idx
  on public.wms_tasks using gin (source_shk_ids);

create or replace function public.set_updated_at_wms_tasks()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_wms_tasks on public.wms_tasks;
create trigger trg_set_updated_at_wms_tasks
before update on public.wms_tasks
for each row
execute function public.set_updated_at_wms_tasks();

drop trigger if exists trg_set_updated_at_wms_manual_upload_runs on public.wms_manual_upload_runs;
create trigger trg_set_updated_at_wms_manual_upload_runs
before update on public.wms_manual_upload_runs
for each row
execute function public.set_updated_at_wms_tasks();

drop trigger if exists trg_set_updated_at_wms_manual_upload_settings on public.wms_manual_upload_settings;
create trigger trg_set_updated_at_wms_manual_upload_settings
before update on public.wms_manual_upload_settings
for each row
execute function public.set_updated_at_wms_tasks();

insert into public.wms_manual_upload_settings (
  module,
  label,
  source_module,
  upload_type,
  upload_offset_days,
  task_deadline_days,
  is_required,
  responsibility_zone,
  description,
  sort_order
)
values
  ('packaging', 'Переупаковка', 'manual_packaging_opp', 'packaging', -7, 1, true, 'Исходящий поток', 'Контроль зависшего товара и тар на участке Переупаковка.', 10),
  ('rwp', 'RWP', 'manual_rwp_opp', 'rwp', -4, 1, true, 'Исходящий поток', 'Контроль товара, поступившего на стол переупаковки, но не получившего корректной обработки.', 20),
  ('pm', 'ПМ / Почта', 'manual_pm_buffer', 'pm_buffer', 0, 1, true, 'Исходящий поток', 'Контроль бессистемно отгруженных тар на буфере последней мили.', 30),
  ('presort', 'Предсортировка', 'manual_presort_opp', 'presort', 0, 1, true, 'Исходящий поток', 'Контроль товара, зависшего на этапе предсортировки.', 40),
  ('labeling', 'Оклейка', 'manual_presort_opp', 'presort', 0, 1, false, 'Исходящий поток', 'Скрытая ветка предсортировки для строк LGR.', 50),
  ('marketplace_pc', 'Маркетплейс + ПЦ', 'manual_marketplace_pc', 'marketplace_pc', 0, 1, true, 'Исходящий поток', 'Контроль товара, зависшего на участках сортировки для других ЛО.', 60),
  ('marketplace', 'Маркетплейс', 'manual_marketplace_pc', 'marketplace_pc', 0, 1, false, 'Исходящий поток', 'Внутренняя настройка сроков для задач Маркетплейса.', 70),
  ('pc', 'ПЦ', 'manual_marketplace_pc', 'marketplace_pc', 0, 1, false, 'Исходящий поток', 'Внутренняя настройка сроков для задач ПЦ.', 80),
  ('wmi_mp_pc', 'WMI (МП + ПЦ)', 'manual_wmi_mp_pc', 'wmi_mp_pc', 0, 1, true, 'Исходящий поток', 'Контроль ошибок на участках сортировки для других ЛО.', 90),
  ('no_order', 'Без заказа', 'manual_no_order', 'no_order', 0, 1, true, 'Исходящий поток', 'Контроль ошибок при обработке товаров без активного заказа.', 100),
  ('usd', 'USD', 'manual_no_order', 'no_order', 0, 1, false, 'Исходящий поток', 'Скрытая ветка Без заказа для статуса USD.', 105),
  ('tmm', 'TMM', 'manual_no_order', 'no_order', 0, 1, false, 'Исходящий поток', 'Скрытая ветка Без заказа для статуса TMM.', 106),
  ('after_sale_movement', 'Движение после продажи', 'manual_after_sale_movement', 'after_sale_movement', 0, 1, true, 'Исходящий поток', 'Контроль товара, получившего движение после реализации.', 110)
on conflict (module) do update set
  label = excluded.label,
  source_module = excluded.source_module,
  upload_type = excluded.upload_type,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc', now());

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

alter table public.wms_tasks disable row level security;
alter table public.wms_manual_upload_runs disable row level security;
alter table public.wms_manual_upload_settings disable row level security;

grant select on public.wms_tasks to anon, authenticated;
grant select on public.wms_manual_upload_runs to anon, authenticated;
grant select on public.wms_manual_upload_settings to anon, authenticated;
grant execute on function public.save_wms_manual_upload(jsonb, jsonb) to anon, authenticated;
grant all on public.wms_tasks to service_role;
grant all on public.wms_manual_upload_runs to service_role;
grant all on public.wms_manual_upload_settings to service_role;

comment on table public.wms_tasks is 'Native WMS+ task registry for OPP uploads. No external task tracker dependency.';
comment on table public.wms_manual_upload_runs is 'Daily WMS+ manual upload log by effective business date.';
comment on function public.save_wms_manual_upload(jsonb, jsonb) is 'Bulk saves WMS+ tasks and writes a daily upload run. Intended for browser RPC calls from tasks.html.';
