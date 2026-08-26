create table if not exists public.report_runs (
  id bigserial primary key,
  created_at timestamptz not null default timezone('utc', now()),
  generated_at timestamptz null,
  wh_id text null,
  mechanism text not null,
  report_scope text null,
  shift_id text null,
  shift_date date null,
  period_from date null,
  period_to date null,
  status text not null default 'success',
  source text null,
  source_ref text null,
  run_key text null,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.report_metrics (
  id bigserial primary key,
  run_id bigint not null references public.report_runs(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  metric_key text not null,
  metric_name text not null,
  group_key text null,
  group_name text null,
  metric_date date null,
  value_num numeric null,
  value_text text null,
  unit text null,
  severity text null,
  dimensions jsonb not null default '{}'::jsonb
);

create index if not exists report_runs_created_at_idx
  on public.report_runs (created_at desc);

create index if not exists report_runs_mechanism_created_at_idx
  on public.report_runs (mechanism, created_at desc);

create index if not exists report_runs_wh_scope_created_at_idx
  on public.report_runs (wh_id, report_scope, created_at desc);

create index if not exists report_runs_shift_idx
  on public.report_runs (wh_id, shift_date desc, shift_id);

create index if not exists report_runs_run_key_idx
  on public.report_runs (run_key);

create index if not exists report_metrics_run_id_idx
  on public.report_metrics (run_id);

create index if not exists report_metrics_metric_idx
  on public.report_metrics (metric_key, group_key);

create index if not exists report_metrics_metric_date_idx
  on public.report_metrics (metric_date desc);

create or replace view public.report_metrics_flat as
select
  r.id as run_id,
  r.created_at,
  r.generated_at,
  r.wh_id,
  r.mechanism,
  r.report_scope,
  r.shift_id,
  r.shift_date,
  r.period_from,
  r.period_to,
  r.status as run_status,
  r.source,
  r.source_ref,
  r.run_key,
  m.id as metric_id,
  m.metric_key,
  m.metric_name,
  m.group_key,
  m.group_name,
  m.metric_date,
  m.value_num,
  m.value_text,
  m.unit,
  m.severity,
  m.dimensions
from public.report_runs r
join public.report_metrics m on m.run_id = r.id;

create or replace view public.opp_shift_report_runs as
select
  r.id as run_id,
  r.created_at,
  r.generated_at,
  r.wh_id,
  r.shift_id,
  r.shift_date,
  r.period_from,
  r.period_to,
  max(m.value_num) filter (where m.metric_key = 'due_unique_shk' and m.group_key is null) as due_unique_shk,
  max(m.value_num) filter (where m.metric_key = 'analyzed_unique_shk' and m.group_key is null) as analyzed_unique_shk,
  max(m.value_num) filter (where m.metric_key = 'analyzed_percent' and m.group_key is null) as analyzed_percent,
  max(m.value_num) filter (where m.metric_key = 'due_sum_price' and m.group_key is null) as due_sum_price,
  max(m.value_num) filter (where m.metric_key = 'analyzed_sum_price' and m.group_key is null) as analyzed_sum_price,
  max(m.value_num) filter (where m.metric_key = 'sum_percent' and m.group_key is null) as sum_percent,
  max(m.value_num) filter (where m.metric_key = 'expensive_due_unique_shk' and m.group_key is null) as expensive_due_unique_shk,
  max(m.value_num) filter (where m.metric_key = 'expensive_analyzed_unique_shk' and m.group_key is null) as expensive_analyzed_unique_shk,
  max(m.value_num) filter (where m.metric_key = 'expensive_analyzed_percent' and m.group_key is null) as expensive_analyzed_percent
from public.report_runs r
left join public.report_metrics m on m.run_id = r.id
where r.mechanism = 'Анализ таблицы ОПП'
group by
  r.id,
  r.created_at,
  r.generated_at,
  r.wh_id,
  r.shift_id,
  r.shift_date,
  r.period_from,
  r.period_to;

create or replace view public.opp_shift_detail_latest_metrics as
select
  run_id,
  created_at,
  generated_at,
  wh_id,
  mechanism,
  report_scope,
  shift_id,
  shift_date,
  period_from,
  period_to,
  metric_id,
  metric_key,
  metric_name,
  group_key,
  group_name,
  metric_date,
  value_num,
  value_text,
  unit,
  severity,
  dimensions
from (
  select
    f.*,
    row_number() over (
      partition by f.wh_id, f.shift_date, f.group_key, f.metric_key
      order by f.created_at desc, f.run_id desc, f.metric_id desc
    ) as rn
  from public.report_metrics_flat f
  where f.mechanism = 'Анализ таблицы ОПП'
    and f.group_key is not null
    and f.metric_key in (
      'analyzed_percent',
      'sum_percent',
      'expensive_analyzed_percent'
    )
) latest
where rn = 1;

alter table public.report_runs disable row level security;
alter table public.report_metrics disable row level security;

grant select on public.report_runs to anon, authenticated;
grant select on public.report_metrics to anon, authenticated;
grant select on public.report_metrics_flat to anon, authenticated;
grant select on public.opp_shift_report_runs to anon, authenticated;
grant select on public.opp_shift_detail_latest_metrics to anon, authenticated;

grant all on public.report_runs to service_role;
grant all on public.report_metrics to service_role;
grant usage, select on sequence public.report_runs_id_seq to service_role;
grant usage, select on sequence public.report_metrics_id_seq to service_role;
