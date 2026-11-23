-- Shared mobile follow-up workflow. Conversation contents stay private; the
-- application receives common progress only through aggregate RPCs.

drop policy if exists wms_mobile_violation_talks_read on public.wms_mobile_violation_talks;
drop policy if exists wms_mobile_violation_talks_read_own on public.wms_mobile_violation_talks;
drop policy if exists wms_mobile_violation_talks_insert on public.wms_mobile_violation_talks;

create policy wms_mobile_violation_talks_read_own
    on public.wms_mobile_violation_talks
    for select to authenticated
    using (manager_auth_uid = auth.uid());

create policy wms_mobile_violation_talks_insert
    on public.wms_mobile_violation_talks
    for insert to authenticated
    with check (manager_auth_uid = auth.uid());

-- The list contains only violations that appeared after the warehouse-wide
-- latest conversation. No conversation row itself is exposed to the client.
create or replace function public.mobile_violators(p_period_days integer)
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
        group by employee_id
    ), talk_counts as (
        select employee_id, count(*) as count_30
        from public.wms_mobile_violation_talks
        where created_at >= timezone('utc', now()) - interval '30 days'
        group by employee_id
    ), grouped as (
        select v.employee_id, count(*) as violation_count, coalesce(sum(v.task_price), 0) as total_task_price
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
        coalesce(nullif(btrim(directory.linear_emp_name), ''), nullif(btrim(employee.full_name), ''), 'ID ' || grouped.employee_id) as full_name,
        grouped.violation_count,
        grouped.total_task_price,
        coalesce(talk_counts.count_30, 0) as talk_count_30,
        coalesce(talk_counts.count_30, 0) >= 3 as is_repeat_offender
    from grouped
    left join talk_counts on talk_counts.employee_id = grouped.employee_id
    left join lateral (
        select l.linear_emp_name from public.linear_emp_rep as l
        where l.linear_emp_id::text = grouped.employee_id
          and nullif(btrim(coalesce(l.linear_emp_name, '')), '') is not null
        order by l.linear_emp_name limit 1
    ) as directory on true
    left join lateral (
        select e.full_name from public.wms_employees as e
        where e.employee_id = grouped.employee_id limit 1
    ) as employee on true
    order by is_repeat_offender desc, grouped.violation_count desc, full_name;
$$;

-- Pins remain personal, but the unresolved count is warehouse-wide.
create or replace function public.mobile_pinned_employees()
returns table (
    employee_id text,
    full_name text,
    open_violation_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
    with pins as (
        select employee_id, employee_name, created_at
        from public.wms_mobile_employee_pins
        where manager_auth_uid = auth.uid()
    ), last_talk as (
        select employee_id, max(covered_until) as covered_until
        from public.wms_mobile_violation_talks
        group by employee_id
    ), resolved as (
        select
            coalesce(nullif(btrim(v.culprit_employee_id), ''), case when btrim(coalesce(v.culprit_name, '')) ~ '^[0-9]+$' then btrim(v.culprit_name) end) as employee_id,
            v.created_at
        from public.wms_violations as v
    )
    select
        pins.employee_id,
        pins.employee_name as full_name,
        count(resolved.created_at) filter (where resolved.created_at > coalesce(last_talk.covered_until, '-infinity'::timestamptz)) as open_violation_count
    from pins
    left join last_talk on last_talk.employee_id = pins.employee_id
    left join resolved on resolved.employee_id = pins.employee_id
    group by pins.employee_id, pins.employee_name, pins.created_at
    order by pins.created_at desc;
$$;

create or replace function public.mobile_employee_violation_follow_up(p_employee_id text)
returns table (
    covered_until timestamptz,
    talk_count_30 bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select
        max(t.covered_until) as covered_until,
        count(*) filter (where t.created_at >= timezone('utc', now()) - interval '30 days') as talk_count_30
    from public.wms_mobile_violation_talks as t
    where t.employee_id = nullif(btrim(p_employee_id), '');
$$;

grant execute on function public.mobile_employee_violation_follow_up(text) to authenticated;
grant execute on function public.mobile_violators(integer) to authenticated;
grant execute on function public.mobile_pinned_employees() to authenticated;
