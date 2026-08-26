-- One-time bridge from WEEEK queues into native WMS+ tasks.
-- Safe to run repeatedly: legacy rows are upserted only over previous legacy copies.

create or replace function public.wms_priority_label_from_weeek(p_priority integer)
returns text
language sql
immutable
as $$
  select case p_priority
    when 0 then 'Низкий'
    when 1 then 'Средний'
    when 2 then 'Высокий'
    when 3 then 'Замороженный'
    else 'Без приоритета'
  end;
$$;

create or replace function public.wms_upload_type_from_legacy_source(p_source_module text)
returns text
language sql
immutable
as $$
  select case p_source_module
    when 'manual_packaging_opp' then 'packaging'
    when 'manual_rwp_opp' then 'rwp'
    when 'manual_pm_buffer' then 'pm_buffer'
    when 'manual_presort_opp' then 'presort'
    when 'manual_marketplace_pc' then 'marketplace_pc'
    when 'manual_wmi_mp_pc' then 'wmi_mp_pc'
    when 'manual_no_order' then 'no_order'
    when 'manual_after_sale_movement' then 'after_sale_movement'
    else nullif(p_source_module, '')
  end;
$$;

create or replace function public.wms_legacy_effective_date(p_source_id text, p_due_date date, p_start_date date)
returns date
language sql
immutable
as $$
  select coalesce(
    public.wms_safe_date(substring(coalesce(p_source_id, '') from '\|([0-9]{4}-[0-9]{2}-[0-9]{2})$')),
    p_due_date,
    p_start_date
  );
$$;

create or replace function public.migrate_weeek_tasks_to_wms()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_basic_count integer := 0;
  v_universal_count integer := 0;
begin
  if to_regclass('public.wms_tasks') is null then
    raise exception 'wms_tasks table does not exist';
  end if;

  if to_regclass('public.weeek_tasks_basic') is not null then
    with inserted as (
      insert into public.wms_tasks (
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
        upload_type,
        upload_effective_date,
        task_type,
        title,
        description,
        priority,
        priority_label,
        due_date,
        responsibility_zone,
        task_status,
        opp_verdict,
        tags,
        is_deleted,
        completed_at,
        reopened_at,
        reopen_after,
        created_at,
        updated_at,
        last_seen_at
      )
      select
        b.source_module,
        coalesce(nullif(b.source_table, ''), 'weeek_tasks_basic'),
        b.source_id,
        b.source_row_id,
        coalesce(b.source_payload, '{}'::jsonb)
          || jsonb_build_object(
            'legacy_table', 'weeek_tasks_basic',
            'legacy_id', b.id,
            'weeek_task_id', b.weeek_task_id,
            'weeek_task_url', b.weeek_task_url,
            'target_board_name', b.target_board_name,
            'target_column_name', b.target_column_name,
            'target_custom_fields', coalesce(b.target_custom_fields, '{}'::jsonb),
            'target_tags', coalesce(b.target_tags, '[]'::jsonb),
            'master_status', b.master_status,
            'last_transition', b.last_transition
          ),
        coalesce(b.source_generated_at, b.created_at),
        coalesce(b.source_shk_ids, '{}'::text[]),
        b.source_tare_id,
        b.source_price_sum,
        b.source_last_movement_at,
        coalesce(nullif(b.search_text, ''), concat_ws(' ', b.title, b.task_type, b.target_column_name, b.source_id, array_to_string(b.source_shk_ids, ' '))),
        public.wms_upload_type_from_legacy_source(b.source_module),
        public.wms_legacy_effective_date(b.source_id, b.due_date, b.start_date),
        b.task_type,
        b.title,
        b.description,
        b.priority,
        public.wms_priority_label_from_weeek(b.priority),
        b.due_date,
        coalesce(nullif(b.responsibility_zone, ''), 'Нет привязки'),
        coalesce(nullif(b.task_status, ''), 'Не начато'),
        coalesce(nullif(b.opp_verdict, ''), 'Не выбран'),
        coalesce(b.target_tags, '[]'::jsonb),
        coalesce(b.weeek_deleted, false),
        case when coalesce(b.weeek_completed, false) or coalesce(b.task_status, '') = 'Завершено' then coalesce(b.finalized_at, b.synced_at, b.updated_at) else null end,
        b.reopened_at,
        b.reopen_after,
        coalesce(b.created_at, timezone('utc', now())),
        coalesce(b.updated_at, timezone('utc', now())),
        coalesce(b.last_seen_at, timezone('utc', now()))
      from public.weeek_tasks_basic b
      where nullif(b.source_module, '') is not null
        and nullif(b.source_id, '') is not null
        and nullif(b.task_type, '') is not null
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
        upload_type = excluded.upload_type,
        upload_effective_date = excluded.upload_effective_date,
        title = excluded.title,
        description = excluded.description,
        priority = excluded.priority,
        priority_label = excluded.priority_label,
        due_date = excluded.due_date,
        responsibility_zone = excluded.responsibility_zone,
        task_status = excluded.task_status,
        opp_verdict = excluded.opp_verdict,
        tags = excluded.tags,
        is_deleted = excluded.is_deleted,
        completed_at = excluded.completed_at,
        reopened_at = excluded.reopened_at,
        reopen_after = excluded.reopen_after,
        updated_at = excluded.updated_at,
        last_seen_at = excluded.last_seen_at
      where public.wms_tasks.source_payload ? 'legacy_table'
      returning 1
    )
    select count(*) into v_basic_count from inserted;
  end if;

  if to_regclass('public.weeek_tasks') is not null then
    with inserted as (
      insert into public.wms_tasks (
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
        upload_type,
        upload_effective_date,
        task_type,
        title,
        description,
        priority,
        priority_label,
        due_date,
        responsibility_zone,
        task_status,
        opp_verdict,
        tags,
        is_deleted,
        completed_at,
        reopened_at,
        reopen_after,
        created_at,
        updated_at,
        last_seen_at
      )
      select
        t.source_module,
        coalesce(nullif(t.source_table, ''), 'weeek_tasks'),
        t.source_id,
        t.source_row_id,
        coalesce(t.source_payload, '{}'::jsonb)
          || jsonb_build_object(
            'legacy_table', 'weeek_tasks',
            'legacy_id', t.id,
            'weeek_task_id', t.weeek_task_id,
            'weeek_task_url', t.weeek_task_url,
            'board_key', t.board_key,
            'column_key', t.column_key,
            'target_board_name', t.target_board_name,
            'target_column_name', t.target_column_name,
            'target_custom_fields', coalesce(t.target_custom_fields, '{}'::jsonb),
            'target_tags', coalesce(t.target_tags, '[]'::jsonb),
            'master_status', t.master_status,
            'last_transition', t.last_transition
          ),
        coalesce(t.source_generated_at, t.created_at),
        '{}'::text[],
        null,
        null,
        null,
        concat_ws(' ', t.title, t.task_type, t.target_column_name, t.source_id),
        public.wms_upload_type_from_legacy_source(t.source_module),
        public.wms_legacy_effective_date(t.source_id, t.due_date, t.start_date),
        t.task_type,
        t.title,
        t.description,
        t.priority,
        public.wms_priority_label_from_weeek(t.priority),
        t.due_date,
        'Нет привязки',
        coalesce(nullif(t.task_status, ''), 'Не начато'),
        coalesce(nullif(t.opp_verdict, ''), 'Не выбран'),
        coalesce(t.target_tags, '[]'::jsonb),
        coalesce(t.weeek_deleted, false),
        case when coalesce(t.weeek_completed, false) or coalesce(t.task_status, '') = 'Завершено' then coalesce(t.finalized_at, t.synced_at, t.updated_at) else null end,
        t.reopened_at,
        t.reopen_after,
        coalesce(t.created_at, timezone('utc', now())),
        coalesce(t.updated_at, timezone('utc', now())),
        coalesce(t.last_seen_at, timezone('utc', now()))
      from public.weeek_tasks t
      where nullif(t.source_module, '') is not null
        and nullif(t.source_id, '') is not null
        and nullif(t.task_type, '') is not null
      on conflict (source_module, source_id, task_type)
      do update set
        source_table = excluded.source_table,
        source_row_id = excluded.source_row_id,
        source_payload = excluded.source_payload,
        source_generated_at = excluded.source_generated_at,
        search_text = excluded.search_text,
        upload_type = excluded.upload_type,
        upload_effective_date = excluded.upload_effective_date,
        title = excluded.title,
        description = excluded.description,
        priority = excluded.priority,
        priority_label = excluded.priority_label,
        due_date = excluded.due_date,
        task_status = excluded.task_status,
        opp_verdict = excluded.opp_verdict,
        tags = excluded.tags,
        is_deleted = excluded.is_deleted,
        completed_at = excluded.completed_at,
        reopened_at = excluded.reopened_at,
        reopen_after = excluded.reopen_after,
        updated_at = excluded.updated_at,
        last_seen_at = excluded.last_seen_at
      where public.wms_tasks.source_payload ? 'legacy_table'
      returning 1
    )
    select count(*) into v_universal_count from inserted;
  end if;

  return jsonb_build_object(
    'ok', true,
    'weeek_tasks_basic_migrated', v_basic_count,
    'weeek_tasks_migrated', v_universal_count,
    'total_migrated', v_basic_count + v_universal_count
  );
end;
$$;

grant execute on function public.migrate_weeek_tasks_to_wms() to anon, authenticated, service_role;

comment on function public.migrate_weeek_tasks_to_wms() is
  'Copies legacy WEEEK task queues into native WMS+ wms_tasks without deleting or modifying WEEEK data.';

select public.migrate_weeek_tasks_to_wms();
