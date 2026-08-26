-- Manual OPP uploads: due dates from planned upload date, nullable priority, responsibility zones.

alter table public.weeek_manual_upload_settings
  add column if not exists responsibility_zone text not null default 'Исходящий поток';

alter table public.weeek_tasks_basic
  add column if not exists responsibility_zone text not null default 'Нет привязки';

alter table public.weeek_tasks_basic
  alter column priority drop default,
  alter column priority drop not null;

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

create index if not exists weeek_tasks_basic_responsibility_due_idx
  on public.weeek_tasks_basic (responsibility_zone, due_date)
  where enabled = true
    and coalesce(task_status, 'Не начато') not in ('Завершено', 'Отложено');

insert into public.weeek_manual_upload_settings (
  module,
  label,
  source_module,
  upload_type,
  upload_offset_days,
  task_deadline_days,
  pm_deadline_days,
  mail_deadline_days,
  is_required,
  responsibility_zone,
  description,
  sort_order
)
values
  ('packaging', 'Переупаковка', 'manual_packaging_opp', 'packaging', -7, 7, null, null, true, 'Исходящий поток', 'Контроль зависшего товара и тар на участке Переупаковка.', 10),
  ('rwp', 'RWP', 'manual_rwp_opp', 'rwp', -4, 4, null, null, true, 'Исходящий поток', 'Контроль товара, поступившего на стол переупаковки, но не получившего корректной обработки.', 20),
  ('pm', 'ПМ / Почта', 'manual_pm_buffer', 'pm_buffer', 0, null, 2, 3, true, 'Исходящий поток', 'Контроль бессистемно отгруженных тар на буфере последней мили.', 30),
  ('presort', 'Предсортировка', 'manual_presort_opp', 'presort', 0, 2, null, null, true, 'Исходящий поток', 'Контроль товара, зависшего на этапе предсортировки.', 40),
  ('labeling', 'Оклейка', 'manual_presort_opp', 'presort', 0, 2, null, null, false, 'Исходящий поток', 'Скрытая ветка предсортировки для строк LGR.', 50),
  ('marketplace_pc', 'Маркетплейс + ПЦ', 'manual_marketplace_pc', 'marketplace_pc', 0, 2, null, null, true, 'Исходящий поток', 'Контроль товара, зависшего на участках сортировки для других ЛО.', 60),
  ('marketplace', 'Маркетплейс', 'manual_marketplace_pc', 'marketplace_pc', 0, 2, null, null, false, 'Исходящий поток', 'Внутренняя настройка сроков и ответственности для задач Маркетплейса.', 70),
  ('pc', 'ПЦ', 'manual_marketplace_pc', 'marketplace_pc', 0, 2, null, null, false, 'Исходящий поток', 'Внутренняя настройка сроков и ответственности для задач ПЦ.', 80),
  ('wmi_mp_pc', 'WMI (МП + ПЦ)', 'manual_wmi_mp_pc', 'wmi_mp_pc', 0, 2, null, null, true, 'Исходящий поток', 'Контроль ошибок, не получивших корректного движения на участках сортировки для других ЛО.', 90),
  ('no_order', 'Без заказа', 'manual_no_order', 'no_order', 0, 2, null, null, true, 'Исходящий поток', 'Контроль ошибок, возникающих при обработке товаров без активного заказа.', 100),
  ('usd', 'USD', 'manual_no_order', 'no_order', 0, 2, null, null, false, 'Исходящий поток', 'Скрытая ветка Без заказа для статуса USD.', 105),
  ('tmm', 'TMM', 'manual_no_order', 'no_order', 0, 2, null, null, false, 'Исходящий поток', 'Скрытая ветка Без заказа для статуса TMM.', 106),
  ('after_sale_movement', 'Движение после продажи', 'manual_after_sale_movement', 'after_sale_movement', 0, 2, null, null, true, 'Исходящий поток', 'Контроль товара, получившего движение после реализации.', 110)
on conflict (module) do update set
  label = excluded.label,
  source_module = excluded.source_module,
  upload_type = excluded.upload_type,
  description = excluded.description,
  sort_order = excluded.sort_order,
  responsibility_zone = coalesce(nullif(public.weeek_manual_upload_settings.responsibility_zone, ''), excluded.responsibility_zone),
  updated_at = timezone('utc', now());

update public.weeek_task_routes
set active_default_column_name = 'WMI (МП + ПЦ)',
    updated_at = timezone('utc', now())
where route_key = 'manual_wmi_mp_pc';

update public.weeek_task_routes
set active_default_column_name = 'Без заказа',
    updated_at = timezone('utc', now())
where route_key = 'manual_no_order_opp';

insert into public.weeek_task_routes (
  route_key,
  task_type,
  active_board_id,
  active_board_name,
  active_default_column_id,
  active_default_column_name,
  inactive_board_id,
  inactive_board_name,
  inactive_wait_column_id,
  inactive_wait_column_name,
  inactive_done_column_id,
  inactive_done_column_name,
  reopen_after_days,
  reopen_date_field_id,
  reopen_date_field_name,
  reopened_tag_name,
  deferred_verdicts,
  final_verdicts,
  not_started_verdicts
)
values
  (
    'manual_usd_opp',
    'Разбор ОПП // USD',
    '3',
    '❗️ Активные задачи',
    null,
    'Другие задачи',
    '7',
    '❌ Неактивные задачи',
    null,
    'Ожидание',
    null,
    'Разбор завершен',
    2,
    'a25fe442-940f-4bd9-86c0-eeb25de06655',
    'Дата переоткрытия',
    'Переоткрытое задание',
    array['Отправлен на релиз','Отправлен на списание ревизией','Отправлен запрос'],
    array['Найден/Релиз/Списан','Нет на МХ/Не найден'],
    array['Не выбран','Новая','Не начато']
  ),
  (
    'manual_tmm_opp',
    'Разбор ОПП // TMM',
    '3',
    '❗️ Активные задачи',
    null,
    'Другие задачи',
    '7',
    '❌ Неактивные задачи',
    null,
    'Ожидание',
    null,
    'Разбор завершен',
    2,
    'a25fe442-940f-4bd9-86c0-eeb25de06655',
    'Дата переоткрытия',
    'Переоткрытое задание',
    array['Отправлен на релиз','Отправлен на списание ревизией','Отправлен запрос'],
    array['Найден/Релиз/Списан','Нет на МХ/Не найден'],
    array['Не выбран','Новая','Не начато']
  )
on conflict (route_key) do update set
  task_type = excluded.task_type,
  active_board_id = excluded.active_board_id,
  active_board_name = excluded.active_board_name,
  active_default_column_id = excluded.active_default_column_id,
  active_default_column_name = excluded.active_default_column_name,
  inactive_board_id = excluded.inactive_board_id,
  inactive_board_name = excluded.inactive_board_name,
  inactive_wait_column_id = excluded.inactive_wait_column_id,
  inactive_wait_column_name = excluded.inactive_wait_column_name,
  inactive_done_column_id = excluded.inactive_done_column_id,
  inactive_done_column_name = excluded.inactive_done_column_name,
  reopen_after_days = excluded.reopen_after_days,
  reopen_date_field_id = excluded.reopen_date_field_id,
  reopen_date_field_name = excluded.reopen_date_field_name,
  reopened_tag_name = excluded.reopened_tag_name,
  deferred_verdicts = excluded.deferred_verdicts,
  final_verdicts = excluded.final_verdicts,
  not_started_verdicts = excluded.not_started_verdicts,
  updated_at = timezone('utc', now());

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
      public.weeek_basic_safe_integer(item->>'priority') as priority,
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
      coalesce(nullif(item->>'master_action', ''), 'upsert') as master_action,
      coalesce(nullif(item->>'responsibility_zone', ''), 'Нет привязки') as responsibility_zone
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
      responsibility_zone,
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
      responsibility_zone,
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
      responsibility_zone = excluded.responsibility_zone,
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
            or public.weeek_tasks_basic.responsibility_zone is distinct from excluded.responsibility_zone
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
  'Fast set-based ingest helper for manual WEEEK queue. Supports nullable priority and responsibility_zone.';

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
  v_basic_assigned_count integer := 0;
  v_basic_incoming_count integer := 0;
  v_basic_outgoing_count integer := 0;
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
      'basic_assigned_count', 0,
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
      'basic_assigned_count', 0,
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

  with basic_candidates as (
    select
      t.id,
      case
        when coalesce(t.responsibility_zone, 'Нет привязки') = 'Входящий поток' then nullif(v_shift.incoming_weeek_user_id, '')
        when coalesce(t.responsibility_zone, 'Нет привязки') = 'Исходящий поток' then nullif(v_shift.outgoing_weeek_user_id, '')
        else null
      end as assignee_id,
      case
        when coalesce(t.responsibility_zone, 'Нет привязки') = 'Входящий поток' then 'incoming'
        when coalesce(t.responsibility_zone, 'Нет привязки') = 'Исходящий поток' then 'outgoing'
        else 'unknown'
      end as assignment_group
    from public.weeek_tasks_basic t
    where t.enabled = true
      and coalesce(t.responsibility_zone, 'Нет привязки') in ('Входящий поток', 'Исходящий поток')
      and t.due_date is not null
      and t.due_date <= v_shift_date
      and coalesce(t.task_status, 'Не начато') not in ('Завершено', 'Отложено')
      and coalesce(t.weeek_completed, false) = false
      and coalesce(t.weeek_deleted, false) = false
      and coalesce(t.master_status, '') <> 'processing'
  ), basic_updated as (
    update public.weeek_tasks_basic t
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
    from basic_candidates c
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
  into v_basic_assigned_count, v_basic_incoming_count, v_basic_outgoing_count
  from basic_updated;

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
    'assigned_count', coalesce(v_assigned_count, 0) + coalesce(v_basic_assigned_count, 0),
    'incoming_assigned_count', coalesce(v_incoming_count, 0) + coalesce(v_basic_incoming_count, 0),
    'outgoing_assigned_count', coalesce(v_outgoing_count, 0) + coalesce(v_basic_outgoing_count, 0),
    'classic_assigned_count', coalesce(v_assigned_count, 0),
    'basic_assigned_count', coalesce(v_basic_assigned_count, 0),
    'basic_incoming_assigned_count', coalesce(v_basic_incoming_count, 0),
    'basic_outgoing_assigned_count', coalesce(v_basic_outgoing_count, 0),
    'missing_weeek_user_ids', v_missing
  );
end;
$$;

comment on function public.assign_weeek_shift_task_assignees(text, date, boolean) is
  'Assigns uncompleted WEEEK tasks to current incoming/outgoing shift responsibles. Also assigns manual weeek_tasks_basic rows by responsibility_zone and due_date. Blocks current-day assignment after 20:00 Moscow unless explicitly overridden.';
