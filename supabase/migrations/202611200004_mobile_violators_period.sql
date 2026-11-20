-- Period-aware version of the mobile violators list.  It retains the
-- directory lookup inside a security-definer function, so the mobile anon
-- client never receives access to the whole employee directory.

create or replace function public.mobile_violators(p_period_days integer)
returns table (
    employee_id text,
    full_name text,
    violation_count bigint,
    total_task_price numeric
)
language sql
stable
security definer
set search_path = public
as $$
    with period as (
        select case when p_period_days in (7, 30) then p_period_days else 7 end as days
    ), grouped as (
        select
            coalesce(
                nullif(btrim(v.culprit_employee_id), ''),
                case when btrim(coalesce(v.culprit_name, '')) ~ '^[0-9]+$'
                    then btrim(v.culprit_name)
                end
            ) as employee_id,
            count(*) as violation_count,
            coalesce(sum(v.task_price), 0) as total_task_price
        from public.wms_violations as v
        cross join period
        where v.created_at >= timezone('utc', now()) - make_interval(days => period.days)
        group by 1
        having count(*) >= 3
    )
    select
        grouped.employee_id,
        coalesce(
            nullif(btrim(directory.linear_emp_name), ''),
            nullif(btrim(employee.full_name), ''),
            'ID ' || grouped.employee_id
        ) as full_name,
        grouped.violation_count,
        grouped.total_task_price
    from grouped
    left join lateral (
        select l.linear_emp_name
        from public.linear_emp_rep as l
        where l.linear_emp_id::text = grouped.employee_id
          and nullif(btrim(coalesce(l.linear_emp_name, '')), '') is not null
        order by l.linear_emp_name
        limit 1
    ) as directory on true
    left join lateral (
        select e.full_name
        from public.wms_employees as e
        where e.employee_id = grouped.employee_id
        limit 1
    ) as employee on true
    where grouped.employee_id is not null
    order by grouped.violation_count desc, full_name;
$$;

grant execute on function public.mobile_violators(integer) to anon, authenticated;
