-- Public kiosk display: expose only daily aggregate counts needed by its
-- charts. The display runs without a session, so it must never read raw
-- task, employee, barcode, or pure-loss rows directly.
create or replace function public.wms_display_dashboard_trends(p_days integer default 14)
returns table (
    chart_key text,
    snapshot_date date,
    series_key text,
    metric_count integer
)
language sql
stable
security definer
set search_path = public
as $$
    with bounds as (
        select greatest(1, least(coalesce(p_days, 14), 60)) as days_count,
               (now() at time zone 'Europe/Moscow')::date as today
    ),
    date_bounds as (
        select today - (days_count - 1) as first_day, today
        from bounds
    ),
    pure_source as (
        select
            nullif(substring(p.date_lost from '^[0-9]{4}-[0-9]{2}-[0-9]{2}'), '')::date as snapshot_date,
            coalesce(nullif(btrim(p.lr::text), ''), 'Без LR') as series_key
        from public.pure_losses_rep p
        where p.wh_id = '50144199'
    ),
    pure_by_lr as (
        select p.snapshot_date, p.series_key, count(*)::integer as metric_count
        from pure_source p
        cross join date_bounds b
        where p.snapshot_date between b.first_day and b.today
        group by p.snapshot_date, p.series_key
    ),
    pure_total as (
        select p.snapshot_date, count(*)::integer as metric_count
        from pure_source p
        cross join date_bounds b
        where p.snapshot_date between b.first_day and b.today
        group by p.snapshot_date
    )
    select 'active'::text, s.snapshot_date, s.zone, s.active_count
    from public.wms_active_tasks_daily_snapshot s
    cross join date_bounds b
    where s.snapshot_date between b.first_day and b.today

    union all

    select 'pulse'::text, s.snapshot_date, 'Задач', s.tasks_count
    from public.wms_staff_shift_pulse_daily_snapshot s
    cross join date_bounds b
    where s.snapshot_date between b.first_day and b.today

    union all

    select 'pulse'::text, s.snapshot_date, 'Без ШК', s.no_shk_count
    from public.wms_staff_shift_pulse_daily_snapshot s
    cross join date_bounds b
    where s.snapshot_date between b.first_day and b.today

    union all

    select 'pulse'::text, s.snapshot_date, 'Запросы', s.requests_count
    from public.wms_staff_shift_pulse_daily_snapshot s
    cross join date_bounds b
    where s.snapshot_date between b.first_day and b.today

    union all

    select 'pure'::text, snapshot_date, series_key || ' LR', metric_count
    from pure_by_lr

    union all

    select 'pure'::text, snapshot_date, 'Всего', metric_count
    from pure_total;
$$;

revoke all on function public.wms_display_dashboard_trends(integer) from public;
grant execute on function public.wms_display_dashboard_trends(integer) to anon, authenticated;
