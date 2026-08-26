create or replace function public.weeek_to_numeric(p_value text)
returns numeric
language plpgsql
immutable
as $$
declare
  v_text text;
begin
  v_text := regexp_replace(
    replace(replace(coalesce(p_value, ''), chr(160), ''), ',', '.'),
    '[^0-9.\-]',
    '',
    'g'
  );

  if nullif(v_text, '') is null then
    return null;
  end if;

  return v_text::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.weeek_awh_due_date(
  p_created_at timestamptz,
  p_payload jsonb,
  p_fallback date default null
)
returns date
language plpgsql
stable
as $$
declare
  v_base_date date;
  v_base_days integer;
  v_reduction_days integer;
  v_price numeric;
begin
  v_base_date := (timezone('Europe/Moscow', coalesce(p_created_at, now())))::date;
  v_base_days := coalesce(public.weeek_to_numeric(p_payload->>'deadline_days_base')::integer, 7);

  v_price := coalesce(
    public.weeek_to_numeric(p_payload->>'price'),
    public.weeek_to_numeric(p_payload->>'price_label')
  );

  v_reduction_days := coalesce(
    public.weeek_to_numeric(p_payload->>'deadline_price_reduction_days')::integer,
    case
      when v_price > 10000 then 4
      when v_price > 5000 then 2
      else 0
    end
  );

  return v_base_date + greatest(v_base_days - v_reduction_days, 0);
exception when others then
  return p_fallback;
end;
$$;

create or replace function public.upsert_weeek_tasks_from_json(p_tasks jsonb)
returns integer
language plpgsql
as $$
declare
  item jsonb;
  affected_count integer := 0;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(p_tasks)
  loop
    insert into public.weeek_tasks (
      source_module,
      source_table,
      source_id,
      source_row_id,
      source_payload,
      source_generated_at,
      task_type,
      board_key,
      column_key,
      title,
      description,
      priority,
      start_date,
      due_date,
      target_workspace_id,
      target_project_id,
      target_board_id,
      target_board_name,
      target_column_id,
      target_column_name,
      target_assignee_ids,
      target_custom_fields,
      target_tags,
      enabled,
      master_status,
      master_action,
      last_seen_at
    )
    values (
      item->>'source_module',
      item->>'source_table',
      item->>'source_id',
      item->>'source_row_id',
      coalesce(item->'source_payload', '{}'::jsonb),
      nullif(item->>'source_generated_at', '')::timestamptz,
      item->>'task_type',
      item->>'board_key',
      item->>'column_key',
      item->>'title',
      item->>'description',
      coalesce(nullif(item->>'priority', '')::integer, 0),
      nullif(item->>'start_date', '')::date,
      case
        when item->>'source_module' = 'awh_writeoffs' or item->>'task_type' = 'Списания AWH'
          then public.weeek_awh_due_date(now(), coalesce(item->'source_payload', '{}'::jsonb), nullif(item->>'due_date', '')::date)
        else nullif(item->>'due_date', '')::date
      end,
      item->>'target_workspace_id',
      item->>'target_project_id',
      item->>'target_board_id',
      item->>'target_board_name',
      item->>'target_column_id',
      item->>'target_column_name',
      case
        when jsonb_typeof(item->'target_assignee_ids') = 'array'
          then array(select jsonb_array_elements_text(item->'target_assignee_ids'))
        else '{}'::text[]
      end,
      coalesce(item->'target_custom_fields', '{}'::jsonb),
      coalesce(item->'target_tags', '[]'::jsonb),
      coalesce(nullif(item->>'enabled', '')::boolean, true),
      'queued',
      coalesce(nullif(item->>'master_action', ''), 'upsert'),
      timezone('utc', now())
    )
    on conflict (source_module, source_id, task_type)
    do update set
      source_table = excluded.source_table,
      source_row_id = excluded.source_row_id,
      source_payload = excluded.source_payload,
      source_generated_at = excluded.source_generated_at,
      board_key = excluded.board_key,
      column_key = excluded.column_key,
      title = excluded.title,
      description = excluded.description,
      priority = excluded.priority,
      start_date = excluded.start_date,
      due_date = case
        when excluded.source_module = 'awh_writeoffs' or excluded.task_type = 'Списания AWH'
          then public.weeek_awh_due_date(public.weeek_tasks.created_at, excluded.source_payload, excluded.due_date)
        else excluded.due_date
      end,
      target_workspace_id = excluded.target_workspace_id,
      target_project_id = excluded.target_project_id,
      target_board_id = excluded.target_board_id,
      target_board_name = excluded.target_board_name,
      target_column_id = excluded.target_column_id,
      target_column_name = excluded.target_column_name,
      target_assignee_ids = excluded.target_assignee_ids,
      target_custom_fields = excluded.target_custom_fields,
      target_tags = excluded.target_tags,
      enabled = excluded.enabled,
      master_action = excluded.master_action,
      last_seen_at = excluded.last_seen_at,
      master_status = case
        when public.weeek_tasks.task_status = 'Завершено' then public.weeek_tasks.master_status
        when public.weeek_tasks.master_status not in ('queued', 'processing')
          and (
            public.weeek_tasks.board_key is distinct from excluded.board_key
            or public.weeek_tasks.column_key is distinct from excluded.column_key
            or public.weeek_tasks.title is distinct from excluded.title
            or public.weeek_tasks.description is distinct from excluded.description
            or public.weeek_tasks.priority is distinct from excluded.priority
            or public.weeek_tasks.start_date is distinct from excluded.start_date
            or public.weeek_tasks.due_date is distinct from case
              when excluded.source_module = 'awh_writeoffs' or excluded.task_type = 'Списания AWH'
                then public.weeek_awh_due_date(public.weeek_tasks.created_at, excluded.source_payload, excluded.due_date)
              else excluded.due_date
            end
            or public.weeek_tasks.target_workspace_id is distinct from excluded.target_workspace_id
            or public.weeek_tasks.target_project_id is distinct from excluded.target_project_id
            or public.weeek_tasks.target_board_id is distinct from excluded.target_board_id
            or public.weeek_tasks.target_column_id is distinct from excluded.target_column_id
            or public.weeek_tasks.target_column_name is distinct from excluded.target_column_name
            or public.weeek_tasks.target_assignee_ids is distinct from excluded.target_assignee_ids
            or public.weeek_tasks.target_custom_fields is distinct from excluded.target_custom_fields
            or public.weeek_tasks.target_tags is distinct from excluded.target_tags
          )
        then 'queued'
        else public.weeek_tasks.master_status
      end;

    affected_count := affected_count + 1;
  end loop;

  return affected_count;
end;
$$;

comment on function public.upsert_weeek_tasks_from_json(jsonb) is
  'Generic module ingest helper. AWH due_date is stable and recalculated from original weeek_tasks.created_at, not from each refresh date.';

with recalculated as (
  select
    id,
    due_date as old_due_date,
    public.weeek_awh_due_date(created_at, source_payload, due_date) as new_due_date
  from public.weeek_tasks
  where source_module = 'awh_writeoffs'
     or task_type = 'Списания AWH'
)
update public.weeek_tasks t
set
  due_date = r.new_due_date,
  master_status = case
    when t.task_status = 'Завершено' then t.master_status
    when t.master_status in ('queued', 'processing') then t.master_status
    else 'queued'
  end,
  master_action = case
    when t.task_status = 'Завершено' then t.master_action
    else 'upsert'
  end,
  last_error = null,
  updated_at = timezone('utc', now())
from recalculated r
where r.id = t.id
  and r.new_due_date is not null
  and t.due_date is distinct from r.new_due_date;
