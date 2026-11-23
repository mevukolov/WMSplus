-- Mobile supervisor workflow: personal employee pins and documented
-- conversations about violations. Both records belong to the authenticated
-- supervisor, never to the employee being discussed.

create table if not exists public.wms_mobile_employee_pins (
    manager_auth_uid uuid not null default auth.uid() references auth.users(id) on delete cascade,
    employee_id text not null check (btrim(employee_id) <> ''),
    employee_name text not null default '',
    created_at timestamptz not null default timezone('utc', now()),
    primary key (manager_auth_uid, employee_id)
);

create table if not exists public.wms_mobile_violation_talks (
    id uuid primary key default gen_random_uuid(),
    manager_auth_uid uuid not null default auth.uid() references auth.users(id) on delete cascade,
    employee_id text not null check (btrim(employee_id) <> ''),
    -- Every violation created at or before this instant is considered
    -- discussed. Later rows remain new and are offered at the next talk.
    covered_until timestamptz not null default timezone('utc', now()),
    summary jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists wms_mobile_employee_pins_manager_idx
    on public.wms_mobile_employee_pins (manager_auth_uid, created_at desc);
create index if not exists wms_mobile_violation_talks_manager_employee_idx
    on public.wms_mobile_violation_talks (manager_auth_uid, employee_id, covered_until desc);

alter table public.wms_mobile_employee_pins enable row level security;
alter table public.wms_mobile_violation_talks enable row level security;

grant select, insert, delete on public.wms_mobile_employee_pins to authenticated;
grant select, insert on public.wms_mobile_violation_talks to authenticated;

drop policy if exists wms_mobile_employee_pins_owner on public.wms_mobile_employee_pins;
create policy wms_mobile_employee_pins_owner
    on public.wms_mobile_employee_pins
    for all to authenticated
    using (manager_auth_uid = auth.uid())
    with check (manager_auth_uid = auth.uid());

drop policy if exists wms_mobile_violation_talks_owner on public.wms_mobile_violation_talks;
create policy wms_mobile_violation_talks_owner
    on public.wms_mobile_violation_talks
    for all to authenticated
    using (manager_auth_uid = auth.uid())
    with check (manager_auth_uid = auth.uid());

-- The list contains only violations that appeared after the supervisor's
-- latest conversation with that employee. Thus an employee disappears from
-- the list immediately after a conversation and comes back only for new
-- cases. Three conversations in the past 30 days flag a repeat offender.
drop function if exists public.mobile_violators(integer);
create function public.mobile_violators(p_period_days integer)
returns table (
    employee_id text,
    full_name text,
    violation_count bigint,
    total_task_price numeric,
    talk_count_30 bigint,
    is_repeat_offender boolean
)
language sql
stable
security definer
set search_path = public
as $$
    with period as (
        select case when p_period_days in (7, 30) then p_period_days else 7 end as days
    ), resolved as (
        select
            coalesce(
                nullif(btrim(v.culprit_employee_id), ''),
                case when btrim(coalesce(v.culprit_name, '')) ~ '^[0-9]+$'
                    then btrim(v.culprit_name)
                end
            ) as employee_id,
            v.created_at,
            v.task_price
        from public.wms_violations as v
    ), last_talk as (
        select employee_id, max(covered_until) as covered_until
        from public.wms_mobile_violation_talks
        where manager_auth_uid = auth.uid()
        group by employee_id
    ), talk_counts as (
        select employee_id, count(*) as count_30
        from public.wms_mobile_violation_talks
        where manager_auth_uid = auth.uid()
          and created_at >= timezone('utc', now()) - interval '30 days'
        group by employee_id
    ), grouped as (
        select
            v.employee_id,
            count(*) as violation_count,
            coalesce(sum(v.task_price), 0) as total_task_price
        from resolved as v
        cross join period
        left join last_talk as t on t.employee_id = v.employee_id
        where v.employee_id is not null
          and v.created_at >= timezone('utc', now()) - make_interval(days => period.days)
          and v.created_at > coalesce(t.covered_until, '-infinity'::timestamptz)
        group by v.employee_id
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
        grouped.total_task_price,
        coalesce(talk_counts.count_30, 0) as talk_count_30,
        coalesce(talk_counts.count_30, 0) >= 3 as is_repeat_offender
    from grouped
    left join talk_counts on talk_counts.employee_id = grouped.employee_id
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
    order by is_repeat_offender desc, grouped.violation_count desc, full_name;
$$;

grant execute on function public.mobile_violators(integer) to authenticated;
