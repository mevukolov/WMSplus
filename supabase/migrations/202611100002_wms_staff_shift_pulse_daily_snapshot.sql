-- Durable daily figures for the home "Пульс смены" chart. Unlike the
-- detailed modal snapshot, these rows are maintained on every new verdict,
-- defer and sticker assignment, so they are a historical source of truth.
create table if not exists public.wms_staff_shift_pulse_daily_snapshot (
    snapshot_date date primary key,
    tasks_count integer not null default 0,
    no_shk_count integer not null default 0,
    requests_count integer not null default 0,
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists wms_staff_shift_pulse_daily_snapshot_updated_idx
    on public.wms_staff_shift_pulse_daily_snapshot (updated_at desc);

alter table public.wms_staff_shift_pulse_daily_snapshot enable row level security;

drop policy if exists wms_staff_shift_pulse_daily_snapshot_authenticated_read
    on public.wms_staff_shift_pulse_daily_snapshot;
drop policy if exists wms_staff_shift_pulse_daily_snapshot_authenticated_all
    on public.wms_staff_shift_pulse_daily_snapshot;
create policy wms_staff_shift_pulse_daily_snapshot_authenticated_read
    on public.wms_staff_shift_pulse_daily_snapshot
    for select
    to authenticated
    using (true);

grant select on public.wms_staff_shift_pulse_daily_snapshot to authenticated;
revoke insert, update, delete on public.wms_staff_shift_pulse_daily_snapshot from authenticated;

create or replace function public.wms_refresh_staff_shift_pulse_daily_snapshot(p_date date)
returns void
language sql
security definer
set search_path = public
as $$
    with task_events as (
        select h.event_type, h.payload, t.source_module, t.upload_type, t.task_type
        from public.wms_task_history h
        left join public.wms_tasks t on t.id = h.task_id
        where (h.created_at at time zone 'Europe/Moscow')::date = p_date
          and (nullif(btrim(coalesce(h.actor_employee_id, '')), '') is not null
               or nullif(btrim(coalesce(h.actor_name, '')), '') is not null)
          and (
              (h.event_type = 'task_completed'
               and nullif(btrim(coalesce(h.payload->>'verdict', '')), '') is not null
               and coalesce(h.payload->>'verdict', '') <> 'Не выбран')
              or h.event_type = 'task_deferred'
          )
    ),
    task_metrics as (
        select
            count(*)::integer as tasks_count,
            count(*) filter (
                where lower(coalesce(source_module, '')) = 'incoming_flow_requests'
                   or lower(coalesce(upload_type, '')) = 'incoming_flow_requests'
                   or lower(coalesce(task_type, '')) in ('запросы входящего потока', 'запрос входящего потока')
            )::integer as requests_count
        from task_events
    ),
    no_shk_metrics as (
        select count(*)::integer as no_shk_count
        from public.wms_no_shk_sticker_events
        where (created_at at time zone 'Europe/Moscow')::date = p_date
          and (nullif(btrim(coalesce(actor_employee_id, '')), '') is not null
               or nullif(btrim(coalesce(actor_name, '')), '') is not null)
    )
    insert into public.wms_staff_shift_pulse_daily_snapshot (
        snapshot_date, tasks_count, no_shk_count, requests_count, updated_at
    )
    select p_date,
           coalesce(task_metrics.tasks_count, 0),
           coalesce(no_shk_metrics.no_shk_count, 0),
           coalesce(task_metrics.requests_count, 0),
           timezone('utc', now())
    from task_metrics cross join no_shk_metrics
    on conflict (snapshot_date) do update set
        tasks_count = excluded.tasks_count,
        no_shk_count = excluded.no_shk_count,
        requests_count = excluded.requests_count,
        updated_at = excluded.updated_at;
$$;

create or replace function public.wms_capture_staff_shift_pulse_daily_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.wms_refresh_staff_shift_pulse_daily_snapshot(
        (new.created_at at time zone 'Europe/Moscow')::date
    );
    return new;
end;
$$;

drop trigger if exists wms_task_history_staff_shift_pulse_snapshot on public.wms_task_history;
create trigger wms_task_history_staff_shift_pulse_snapshot
after insert on public.wms_task_history
for each row execute function public.wms_capture_staff_shift_pulse_daily_snapshot();

drop trigger if exists wms_no_shk_sticker_staff_shift_pulse_snapshot on public.wms_no_shk_sticker_events;
create trigger wms_no_shk_sticker_staff_shift_pulse_snapshot
after insert on public.wms_no_shk_sticker_events
for each row execute function public.wms_capture_staff_shift_pulse_daily_snapshot();

-- Backfill the dashboard period and a wider 90-day operational history.
select public.wms_refresh_staff_shift_pulse_daily_snapshot(day)
from (
    select distinct (created_at at time zone 'Europe/Moscow')::date as day
    from public.wms_task_history
    where created_at >= timezone('utc', now()) - interval '90 days'
    union
    select distinct (created_at at time zone 'Europe/Moscow')::date as day
    from public.wms_no_shk_sticker_events
    where created_at >= timezone('utc', now()) - interval '90 days'
) days;
