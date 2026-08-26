create or replace function public.preserve_weeek_task_assignees_on_ingest()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
    and coalesce(cardinality(old.target_assignee_ids), 0) > 0
    and coalesce(cardinality(new.target_assignee_ids), 0) = 0
    and coalesce(new.source_module, old.source_module) in ('incoming_boxes', 'incoming_flow_requests', 'koledino_27lr', 'awh_writeoffs')
    and coalesce(old.task_status, '') not in ('Завершено', 'Отложено')
  then
    new.target_assignee_ids := old.target_assignee_ids;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_preserve_weeek_task_assignees_on_ingest on public.weeek_tasks;
create trigger trg_preserve_weeek_task_assignees_on_ingest
before update on public.weeek_tasks
for each row
execute function public.preserve_weeek_task_assignees_on_ingest();

create or replace function public.assign_weeek_shift_task_assignees(
  p_wh_id text default '50144199',
  p_shift_date date default null,
  p_allow_after_cutoff boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  v_wh_id text := coalesce(nullif(p_wh_id, ''), '50144199');
  v_shift_date date := coalesce(p_shift_date, (timezone('Europe/Moscow', now()))::date);
  v_moscow_date date := (timezone('Europe/Moscow', now()))::date;
  v_moscow_time time := (timezone('Europe/Moscow', now()))::time;
  v_cutoff time := time '20:00';
  v_shift record;
  v_assigned_count integer := 0;
  v_incoming_count integer := 0;
  v_outgoing_count integer := 0;
  v_missing jsonb := '[]'::jsonb;
begin
  select
    s.id,
    s.shift_date,
    s.shift_label,
    i.full_name as incoming_name,
    i.weeek_user_id as incoming_weeek_user_id,
    o.full_name as outgoing_name,
    o.weeek_user_id as outgoing_weeek_user_id
  into v_shift
  from public.weeek_shifts s
  join public.weeek_employees i on i.id = s.incoming_employee_id
  join public.weeek_employees o on o.id = s.outgoing_employee_id
  where s.wh_id = v_wh_id
    and s.shift_date = v_shift_date
    and s.status <> 'cancelled'
  order by s.opened_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'action', 'assign_shift_task_assignees',
      'assigned_count', 0,
      'shift_found', false,
      'wh_id', v_wh_id,
      'shift_date', v_shift_date
    );
  end if;

  if v_shift_date = v_moscow_date and v_moscow_time >= v_cutoff and not p_allow_after_cutoff then
    return jsonb_build_object(
      'ok', true,
      'action', 'assign_shift_task_assignees',
      'assigned_count', 0,
      'shift_found', true,
      'cutoff_blocked', true,
      'cutoff_time', '20:00',
      'moscow_time', left(v_moscow_time::text, 8),
      'wh_id', v_wh_id,
      'shift_date', v_shift_date,
      'shift_label', v_shift.shift_label
    );
  end if;

  if nullif(v_shift.incoming_weeek_user_id, '') is null then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'process', 'Входящий поток',
      'employee', v_shift.incoming_name,
      'field', 'weeek_user_id'
    ));
  end if;

  if nullif(v_shift.outgoing_weeek_user_id, '') is null then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'process', 'Исходящий поток',
      'employee', v_shift.outgoing_name,
      'field', 'weeek_user_id'
    ));
  end if;

  with candidates as (
    select
      t.id,
      case
        when t.source_module in ('incoming_boxes', 'incoming_flow_requests', 'koledino_27lr')
          or t.task_type in ('Коробки на входе', 'Запросы входящего потока', 'Коледино + 27LR')
          then nullif(v_shift.incoming_weeek_user_id, '')
        when t.source_module = 'awh_writeoffs'
          or t.task_type = 'Списания AWH'
          then nullif(v_shift.outgoing_weeek_user_id, '')
        else null
      end as assignee_id,
      case
        when t.source_module in ('incoming_boxes', 'incoming_flow_requests', 'koledino_27lr')
          or t.task_type in ('Коробки на входе', 'Запросы входящего потока', 'Коледино + 27LR')
          then 'incoming'
        when t.source_module = 'awh_writeoffs'
          or t.task_type = 'Списания AWH'
          then 'outgoing'
        else 'unknown'
      end as assignment_group
    from public.weeek_tasks t
    where t.enabled = true
      and (
        t.source_module = 'incoming_flow_requests'
        or t.task_type = 'Запросы входящего потока'
        or (
          t.due_date is not null
          and case
            when t.source_module = 'awh_writeoffs' or t.task_type = 'Списания AWH' then t.due_date - 3 <= v_shift_date
            else t.due_date <= v_shift_date
          end
        )
      )
      and coalesce(t.task_status, 'Не начато') not in ('Завершено', 'Отложено')
      and coalesce(t.weeek_completed, false) = false
      and coalesce(t.weeek_deleted, false) = false
      and coalesce(t.master_status, '') <> 'processing'
      and (
        t.source_module in ('incoming_boxes', 'incoming_flow_requests', 'koledino_27lr', 'awh_writeoffs')
        or t.task_type in ('Коробки на входе', 'Запросы входящего потока', 'Коледино + 27LR', 'Списания AWH')
      )
  ), updated as (
    update public.weeek_tasks t
    set
      target_assignee_ids = array[c.assignee_id]::text[],
      master_action = case
        when t.weeek_task_id is not null then 'assign_members'
        else coalesce(nullif(t.master_action, ''), 'upsert')
      end,
      master_status = 'queued',
      master_note = 'Автоназначение исполнителя по смене ' || v_shift.shift_label,
      last_error = null,
      updated_at = timezone('utc', now())
    from candidates c
    where c.id = t.id
      and c.assignee_id is not null
      and (
        coalesce(cardinality(t.weeek_assignee_ids), 0) = 0
        or not (
          t.weeek_assignee_ids @> array[c.assignee_id]::text[]
          and t.weeek_assignee_ids <@ array[c.assignee_id]::text[]
        )
        or coalesce(cardinality(t.target_assignee_ids), 0) = 0
        or not (
          t.target_assignee_ids @> array[c.assignee_id]::text[]
          and t.target_assignee_ids <@ array[c.assignee_id]::text[]
        )
      )
    returning c.assignment_group
  )
  select
    count(*)::integer,
    count(*) filter (where assignment_group = 'incoming')::integer,
    count(*) filter (where assignment_group = 'outgoing')::integer
  into v_assigned_count, v_incoming_count, v_outgoing_count
  from updated;

  return jsonb_build_object(
    'ok', true,
    'action', 'assign_shift_task_assignees',
    'shift_found', true,
    'cutoff_blocked', false,
    'wh_id', v_wh_id,
    'shift_date', v_shift_date,
    'shift_label', v_shift.shift_label,
    'incoming_employee', v_shift.incoming_name,
    'outgoing_employee', v_shift.outgoing_name,
    'assigned_count', coalesce(v_assigned_count, 0),
    'incoming_assigned_count', coalesce(v_incoming_count, 0),
    'outgoing_assigned_count', coalesce(v_outgoing_count, 0),
    'missing_weeek_user_ids', v_missing
  );
end;
$$;

comment on function public.assign_weeek_shift_task_assignees(text, date, boolean) is
  'Assigns or reassigns uncompleted active WEEEK tasks to current incoming/outgoing shift responsibles. AWH tasks are assigned from 3 days before due_date; other dated tasks are assigned when due_date is reached. Blocks current-day assignment after 20:00 Moscow unless explicitly overridden.';
