create or replace function public.weeek_basic_safe_numeric(p_value text)
returns numeric
language plpgsql
immutable
as $$
begin
  return nullif(p_value, '')::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.weeek_basic_safe_integer(p_value text)
returns integer
language plpgsql
immutable
as $$
begin
  return nullif(p_value, '')::integer;
exception when others then
  return null;
end;
$$;

create or replace function public.weeek_basic_safe_boolean(p_value text)
returns boolean
language plpgsql
immutable
as $$
begin
  return nullif(p_value, '')::boolean;
exception when others then
  return null;
end;
$$;

create or replace function public.weeek_basic_safe_date(p_value text)
returns date
language plpgsql
immutable
as $$
begin
  return nullif(p_value, '')::date;
exception when others then
  return null;
end;
$$;

create or replace function public.weeek_basic_safe_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  return nullif(p_value, '')::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.upsert_weeek_tasks_basic_from_json(p_tasks jsonb)
returns integer
language plpgsql
as $$
declare
  affected_count integer := 0;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;

  with raw_items as (
    select
      source_item as item,
      source_ord as ord
    from jsonb_array_elements(p_tasks) with ordinality as source(source_item, source_ord)
  ),
  prepared as (
    select
      ord,
      item,
      nullif(item->>'source_module', '') as source_module,
      item->>'source_table' as source_table,
      nullif(item->>'source_id', '') as source_id,
      item->>'source_row_id' as source_row_id,
      coalesce(item->'source_payload', '{}'::jsonb) as source_payload,
      public.weeek_basic_safe_timestamptz(item->>'source_generated_at') as source_generated_at,
      case
        when jsonb_typeof(item->'source_shk_ids') = 'array'
          then array(select jsonb_array_elements_text(item->'source_shk_ids'))
        else '{}'::text[]
      end as source_shk_ids,
      nullif(item->>'source_tare_id', '') as source_tare_id,
      public.weeek_basic_safe_numeric(item->>'source_price_sum') as source_price_sum,
      public.weeek_basic_safe_timestamptz(item->>'source_last_movement_at') as source_last_movement_at,
      nullif(item->>'search_text', '') as search_text,
      nullif(item->>'task_type', '') as task_type,
      item->>'board_key' as board_key,
      item->>'column_key' as column_key,
      item->>'title' as title,
      item->>'description' as description,
      coalesce(public.weeek_basic_safe_integer(item->>'priority'), 0) as priority,
      public.weeek_basic_safe_date(item->>'start_date') as start_date,
      public.weeek_basic_safe_date(item->>'due_date') as due_date,
      item->>'target_workspace_id' as target_workspace_id,
      item->>'target_project_id' as target_project_id,
      item->>'target_board_id' as target_board_id,
      item->>'target_board_name' as target_board_name,
      item->>'target_column_id' as target_column_id,
      item->>'target_column_name' as target_column_name,
      case
        when jsonb_typeof(item->'target_assignee_ids') = 'array'
          then array(select jsonb_array_elements_text(item->'target_assignee_ids'))
        else '{}'::text[]
      end as target_assignee_ids,
      coalesce(item->'target_custom_fields', '{}'::jsonb) as target_custom_fields,
      coalesce(item->'target_tags', '[]'::jsonb) as target_tags,
      coalesce(public.weeek_basic_safe_boolean(item->>'enabled'), true) as enabled,
      coalesce(nullif(item->>'master_action', ''), 'upsert') as master_action
    from raw_items
  ),
  deduped as (
    select *
    from (
      select
        prepared.*,
        row_number() over (
          partition by source_module, source_id, task_type
          order by ord desc
        ) as rn
      from prepared
      where source_module is not null
        and source_id is not null
        and task_type is not null
    ) ranked
    where rn = 1
  ),
  upserted as (
    insert into public.weeek_tasks_basic (
      source_module,
      source_table,
      source_id,
      source_row_id,
      source_payload,
      source_generated_at,
      source_shk_ids,
      source_tare_id,
      source_price_sum,
      source_last_movement_at,
      search_text,
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
    select
      source_module,
      source_table,
      source_id,
      source_row_id,
      source_payload,
      source_generated_at,
      source_shk_ids,
      source_tare_id,
      source_price_sum,
      source_last_movement_at,
      search_text,
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
      'queued',
      master_action,
      timezone('utc', now())
    from deduped
    on conflict (source_module, source_id, task_type)
    do update set
      source_table = excluded.source_table,
      source_row_id = excluded.source_row_id,
      source_payload = excluded.source_payload,
      source_generated_at = excluded.source_generated_at,
      source_shk_ids = excluded.source_shk_ids,
      source_tare_id = excluded.source_tare_id,
      source_price_sum = excluded.source_price_sum,
      source_last_movement_at = excluded.source_last_movement_at,
      search_text = excluded.search_text,
      board_key = excluded.board_key,
      column_key = excluded.column_key,
      title = excluded.title,
      description = excluded.description,
      priority = excluded.priority,
      start_date = excluded.start_date,
      due_date = excluded.due_date,
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
        when public.weeek_tasks_basic.task_status = 'Завершено' then public.weeek_tasks_basic.master_status
        when public.weeek_tasks_basic.master_status not in ('queued', 'processing')
          and (
            public.weeek_tasks_basic.source_payload is distinct from excluded.source_payload
            or public.weeek_tasks_basic.source_shk_ids is distinct from excluded.source_shk_ids
            or public.weeek_tasks_basic.source_tare_id is distinct from excluded.source_tare_id
            or public.weeek_tasks_basic.source_price_sum is distinct from excluded.source_price_sum
            or public.weeek_tasks_basic.source_last_movement_at is distinct from excluded.source_last_movement_at
            or public.weeek_tasks_basic.board_key is distinct from excluded.board_key
            or public.weeek_tasks_basic.column_key is distinct from excluded.column_key
            or public.weeek_tasks_basic.title is distinct from excluded.title
            or public.weeek_tasks_basic.description is distinct from excluded.description
            or public.weeek_tasks_basic.priority is distinct from excluded.priority
            or public.weeek_tasks_basic.start_date is distinct from excluded.start_date
            or public.weeek_tasks_basic.due_date is distinct from excluded.due_date
            or public.weeek_tasks_basic.target_workspace_id is distinct from excluded.target_workspace_id
            or public.weeek_tasks_basic.target_project_id is distinct from excluded.target_project_id
            or public.weeek_tasks_basic.target_board_id is distinct from excluded.target_board_id
            or public.weeek_tasks_basic.target_board_name is distinct from excluded.target_board_name
            or public.weeek_tasks_basic.target_column_id is distinct from excluded.target_column_id
            or public.weeek_tasks_basic.target_column_name is distinct from excluded.target_column_name
            or public.weeek_tasks_basic.target_assignee_ids is distinct from excluded.target_assignee_ids
            or public.weeek_tasks_basic.target_custom_fields is distinct from excluded.target_custom_fields
            or public.weeek_tasks_basic.target_tags is distinct from excluded.target_tags
          )
        then 'queued'
        else public.weeek_tasks_basic.master_status
      end
    returning 1
  )
  select count(*) into affected_count
  from upserted;

  return affected_count;
end;
$$;

comment on function public.upsert_weeek_tasks_basic_from_json(jsonb) is
  'Fast set-based ingest helper for manual WEEEK queue. Keeps user verdict/reopen status intact and stores SHK arrays for search.';
