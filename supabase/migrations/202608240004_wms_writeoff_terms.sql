create extension if not exists pgcrypto;

create table if not exists public.wms_writeoff_terms (
  id uuid primary key default gen_random_uuid(),
  wh_id text not null default '50144199',
  term_type text not null default 'status',
  term_key text not null,
  label text not null,
  days_without_movement integer not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint wms_writeoff_terms_type_check check (term_type in ('status', 'lr')),
  constraint wms_writeoff_terms_days_check check (days_without_movement >= 0),
  constraint wms_writeoff_terms_uniq unique (wh_id, term_type, term_key)
);

create index if not exists wms_writeoff_terms_active_idx
  on public.wms_writeoff_terms (wh_id, term_type, term_key)
  where is_active = true;

create or replace function public.set_updated_at_wms_writeoff_terms()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_wms_writeoff_terms on public.wms_writeoff_terms;
create trigger trg_set_updated_at_wms_writeoff_terms
before update on public.wms_writeoff_terms
for each row
execute function public.set_updated_at_wms_writeoff_terms();

insert into public.wms_writeoff_terms (
  wh_id,
  term_type,
  term_key,
  label,
  days_without_movement,
  sort_order
)
values
  ('50144199', 'status', 'SGR', 'SGR', 8, 10),
  ('50144199', 'status', 'RWP', 'RWP', 5, 20),
  ('50144199', 'status', 'SMS', 'SMS', 2, 30),
  ('50144199', 'status', 'SWT', 'SWT', 2, 40),
  ('50144199', 'status', 'SPS', 'SPS', 1, 50),
  ('50144199', 'status', 'PWT', 'PWT', 1, 60),
  ('50144199', 'status', 'GWS', 'GWS', 1, 70),
  ('50144199', 'status', 'WMI', 'WMI', 1, 80),
  ('50144199', 'status', 'LGR', 'LGR', 1, 90),
  ('50144199', 'status', 'PAP', 'PAP', 1, 100),
  ('50144199', 'status', 'SMC', 'SMC', 1, 110),
  ('50144199', 'status', 'USD', 'USD', 1, 120),
  ('50144199', 'status', 'TMM', 'TMM', 1, 130),
  ('50144199', 'status', 'ORS', 'ORS', 1, 140),
  ('50144199', 'status', 'SAS', 'SAS', 1, 150),
  ('50144199', 'status', 'EPR', 'EPR', 1, 160),
  ('50144199', 'lr', '26LR', '26LR', 0, 1000)
on conflict (wh_id, term_type, term_key)
do update set
  label = excluded.label,
  days_without_movement = public.wms_writeoff_terms.days_without_movement,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc', now());

alter table public.wms_writeoff_terms disable row level security;

grant select, insert, update, delete on public.wms_writeoff_terms to anon, authenticated;
grant all on public.wms_writeoff_terms to service_role;

create or replace function public.wms_writeoff_status_key(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  match text[];
begin
  match := regexp_match(upper(coalesce(p_value, '')), '[A-Z]{3}');
  return coalesce(match[1], '');
end;
$$;

create or replace function public.wms_writeoff_movement_date(p_value text)
returns date
language plpgsql
immutable
as $$
declare
  raw text := btrim(coalesce(p_value, ''));
begin
  if raw = '' then
    return null;
  end if;

  if raw ~ '^\d{4}-\d{2}-\d{2}' then
    return substring(raw from 1 for 10)::date;
  end if;

  if raw ~ '^\d{2}\.\d{2}\.\d{4}' then
    return to_date(substring(raw from 1 for 10), 'DD.MM.YYYY');
  end if;

  if raw ~ '^\d{2}\.\d{2}\.\d{2}' then
    return to_date(substring(raw from 1 for 8), 'DD.MM.YY');
  end if;

  return null;
exception when others then
  return null;
end;
$$;

create or replace function public.recalculate_wms_task_writeoff_dates(p_wh_id text default '50144199')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  with task_items as (
    select
      t.id,
      item.value as item
    from public.wms_tasks t
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(t.source_payload->'task_items') = 'array'
          then t.source_payload->'task_items'
        else '[]'::jsonb
      end
    ) item(value)
    where coalesce(t.is_deleted, false) = false
      and coalesce(t.task_status, '') not in ('Завершено')
  ),
  candidates as (
    select
      ti.id,
      min(public.wms_writeoff_movement_date(ti.item->>'movement') + terms.days_without_movement) as new_due_date
    from task_items ti
    join public.wms_writeoff_terms terms
      on terms.wh_id = p_wh_id
     and terms.term_type = 'status'
     and terms.is_active = true
     and terms.term_key = public.wms_writeoff_status_key(ti.item->>'status')
    where public.wms_writeoff_movement_date(ti.item->>'movement') is not null
    group by ti.id
  )
  update public.wms_tasks t
     set due_date = c.new_due_date,
         source_payload = jsonb_set(
           jsonb_set(coalesce(t.source_payload, '{}'::jsonb), '{writeoff_date}', to_jsonb(c.new_due_date::text), true),
           '{writeoff_date_source}', to_jsonb('status_terms_recalculated'::text), true
         ),
         updated_at = timezone('utc', now())
    from candidates c
   where t.id = c.id
     and c.new_due_date is not null
     and t.due_date is distinct from c.new_due_date;

  get diagnostics affected_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'updated_count', affected_count
  );
end;
$$;

grant execute on function public.recalculate_wms_task_writeoff_dates(text) to anon, authenticated, service_role;

comment on table public.wms_writeoff_terms is
  'WMS+ writeoff date settings. Status terms are used for task due_date/date of writeoff; LR terms such as 26LR are stored for later logic.';
