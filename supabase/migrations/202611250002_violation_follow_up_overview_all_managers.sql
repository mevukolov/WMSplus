-- The desktop "Контроль" tab is an operational journal, not a personal
-- dashboard. Some mobile managers do not have user_wh_id filled in, so the
-- former warehouse-profile join accidentally hid their pins and talks.
-- Scope records by the warehouse of the discussed employee instead: this
-- keeps warehouses isolated and still includes every manager of that
-- warehouse, even when the manager's own profile has no warehouse value.

create or replace function public.desktop_violation_follow_up_overview()
returns table (
    record_kind text,
    manager_id text,
    manager_name text,
    employee_id text,
    employee_name text,
    created_at timestamptz,
    covered_until timestamptz,
    summary jsonb
)
language sql
stable
security definer
set search_path = public
as $$
    with viewer_warehouse as (
        select nullif(btrim(u.user_wh_id::text), '') as warehouse_id
        from public.users as u
        where u.auth_uid = auth.uid()
        limit 1
    ), managers as (
        select
            u.auth_uid,
            u.id::text as manager_id,
            coalesce(nullif(btrim(u.fio), ''), 'Сотрудник ОПП') as manager_name
        from public.users as u
        where u.auth_uid is not null
    ), pins as (
        select
            'pin'::text as record_kind,
            manager.manager_id,
            manager.manager_name,
            pin.employee_id,
            coalesce(
                nullif(btrim(directory.linear_emp_name), ''),
                nullif(btrim(employee.full_name), ''),
                nullif(btrim(pin.employee_name), ''),
                'ID ' || pin.employee_id
            ) as employee_name,
            pin.created_at,
            null::timestamptz as covered_until,
            null::jsonb as summary
        from public.wms_mobile_employee_pins as pin
        join managers as manager on manager.auth_uid = pin.manager_auth_uid
        join viewer_warehouse as viewer on viewer.warehouse_id is not null
        left join lateral (
            select l.linear_emp_name
            from public.linear_emp_rep as l
            where l.linear_emp_id::text = pin.employee_id
              and nullif(btrim(coalesce(l.linear_emp_name, '')), '') is not null
            order by l.linear_emp_name
            limit 1
        ) as directory on true
        left join lateral (
            select e.full_name
            from public.wms_employees as e
            where e.employee_id::text = pin.employee_id
              and nullif(btrim(coalesce(e.full_name, '')), '') is not null
            limit 1
        ) as employee on true
        where exists (
            select 1
            from public.linear_emp_rep as warehouse_employee
            where warehouse_employee.linear_emp_id::text = pin.employee_id
              and warehouse_employee.wh_id::text = viewer.warehouse_id
        )
    ), talks as (
        select
            'talk'::text as record_kind,
            manager.manager_id,
            manager.manager_name,
            talk.employee_id,
            coalesce(
                nullif(btrim(directory.linear_emp_name), ''),
                nullif(btrim(employee.full_name), ''),
                nullif(btrim(pin.employee_name), ''),
                'ID ' || talk.employee_id
            ) as employee_name,
            talk.created_at,
            talk.covered_until,
            talk.summary
        from public.wms_mobile_violation_talks as talk
        join managers as manager on manager.auth_uid = talk.manager_auth_uid
        join viewer_warehouse as viewer on viewer.warehouse_id is not null
        left join lateral (
            select l.linear_emp_name
            from public.linear_emp_rep as l
            where l.linear_emp_id::text = talk.employee_id
              and nullif(btrim(coalesce(l.linear_emp_name, '')), '') is not null
            order by l.linear_emp_name
            limit 1
        ) as directory on true
        left join lateral (
            select e.full_name
            from public.wms_employees as e
            where e.employee_id::text = talk.employee_id
              and nullif(btrim(coalesce(e.full_name, '')), '') is not null
            limit 1
        ) as employee on true
        left join lateral (
            select p.employee_name
            from public.wms_mobile_employee_pins as p
            where p.employee_id = talk.employee_id
            order by p.created_at desc
            limit 1
        ) as pin on true
        where exists (
            select 1
            from public.linear_emp_rep as warehouse_employee
            where warehouse_employee.linear_emp_id::text = talk.employee_id
              and warehouse_employee.wh_id::text = viewer.warehouse_id
        )
    )
    select * from pins
    union all
    select * from talks
    order by created_at desc;
$$;

revoke all on function public.desktop_violation_follow_up_overview() from public;
grant execute on function public.desktop_violation_follow_up_overview() to authenticated;
