-- Same ШК should never grow more than one wms_tasks row, regardless of
-- which module (Предразбор upload, Предсписок, later Чистые списания)
-- touches it -- ШК barcodes are never reused for a different physical item
-- in this warehouse, so ШК alone is a safe, permanent identity key.
--
-- Before this migration, save_wms_manual_upload() de-duplicated only by
-- (source_module, source_id, task_type) -- a key that is, by construction,
-- different for every module. Two different modules touching the same ШК
-- always produced two unrelated wms_tasks rows with no cross-link, which is
-- exactly the bug this migration fixes:
--   1) save_wms_manual_upload() now checks, for any row that is genuinely
--      new for its own (module, source_id, task_type) key, whether an
--      existing non-deleted task from a DIFFERENT module/task_type already
--      covers one of its ШК. If so, it does not insert a second row -- it
--      appends a 'task_cross_module_touch' wms_task_history event onto the
--      existing (canonical) task and folds the new ШК coverage into it.
--      A module refreshing its OWN previously-created row (exact key match)
--      is unaffected -- that is normal re-sync, not a new occurrence.
--   2) A one-time backfill merges the ~1200 ШК that already ended up with
--      duplicate cross-module rows: the earliest task per ШК is kept as
--      canonical, the others' info is preserved as history on it, and the
--      duplicates are soft-deleted (is_deleted = true, never removed).

create or replace function public.save_wms_manual_upload(p_tasks jsonb, p_run jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
  task_ids uuid[] := '{}'::uuid[];
  run_row public.wms_manual_upload_runs%rowtype;
  item jsonb;
  v_source_module text;
  v_source_table text;
  v_source_id text;
  v_source_payload jsonb;
  v_source_generated_at timestamptz;
  v_source_shk_ids text[];
  v_source_tare_id text;
  v_source_price_sum numeric;
  v_source_last_movement_at timestamptz;
  v_search_text text;
  v_upload_type text;
  v_upload_effective_date date;
  v_task_type text;
  v_title text;
  v_description text;
  v_priority integer;
  v_priority_label text;
  v_due_date date;
  v_responsibility_zone text;
  v_task_status text;
  v_opp_verdict text;
  v_assignee_employee_id text;
  v_assignee_name text;
  v_tags jsonb;
  v_existing_id uuid;
  v_canonical_id uuid;
  v_row_id uuid;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(p_tasks)
  loop
    v_source_module := nullif(item->>'source_module', '');
    v_source_id := nullif(item->>'source_id', '');
    v_task_type := nullif(item->>'task_type', '');
    if v_source_module is null or v_source_id is null or v_task_type is null then
      continue;
    end if;

    v_source_table := item->>'source_table';
    v_source_payload := coalesce(item->'source_payload', '{}'::jsonb);
    v_source_generated_at := public.wms_safe_timestamptz(item->>'source_generated_at');
    v_source_shk_ids := case
      when jsonb_typeof(item->'source_shk_ids') = 'array'
        then array(select jsonb_array_elements_text(item->'source_shk_ids'))
      else '{}'::text[]
    end;
    v_source_tare_id := nullif(item->>'source_tare_id', '');
    v_source_price_sum := public.wms_safe_numeric(item->>'source_price_sum');
    v_source_last_movement_at := public.wms_safe_timestamptz(item->>'source_last_movement_at');
    v_search_text := nullif(item->>'search_text', '');
    v_upload_type := nullif(item->>'upload_type', '');
    v_upload_effective_date := public.wms_safe_date(item->>'upload_effective_date');
    v_title := item->>'title';
    v_description := item->>'description';
    v_priority := public.wms_safe_integer(item->>'priority');
    v_priority_label := nullif(item->>'priority_label', '');
    v_due_date := public.wms_safe_date(item->>'due_date');
    v_responsibility_zone := coalesce(nullif(item->>'responsibility_zone', ''), 'Нет привязки');
    v_task_status := coalesce(nullif(item->>'task_status', ''), 'Не начато');
    v_opp_verdict := coalesce(nullif(item->>'opp_verdict', ''), 'Не выбран');
    v_assignee_employee_id := nullif(item->>'assignee_employee_id', '');
    v_assignee_name := nullif(item->>'assignee_name', '');
    v_tags := coalesce(item->'tags', '[]'::jsonb);

    select id into v_existing_id
    from public.wms_tasks
    where source_module = v_source_module and source_id = v_source_id and task_type = v_task_type;

    if v_existing_id is not null then
      -- This exact (module, source_id, task_type) row already exists --
      -- normal re-sync of its own row, unchanged behaviour.
      update public.wms_tasks set
        source_table = v_source_table,
        source_row_id = item->>'source_row_id',
        source_payload = v_source_payload,
        source_generated_at = v_source_generated_at,
        source_shk_ids = v_source_shk_ids,
        source_tare_id = v_source_tare_id,
        source_price_sum = v_source_price_sum,
        source_last_movement_at = v_source_last_movement_at,
        search_text = v_search_text,
        upload_type = v_upload_type,
        upload_effective_date = v_upload_effective_date,
        title = v_title,
        description = v_description,
        priority = v_priority,
        priority_label = v_priority_label,
        due_date = v_due_date,
        responsibility_zone = v_responsibility_zone,
        assignee_employee_id = coalesce(v_assignee_employee_id, assignee_employee_id),
        assignee_name = coalesce(v_assignee_name, assignee_name),
        tags = v_tags,
        last_seen_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
      where id = v_existing_id;
      task_ids := task_ids || v_existing_id;
      affected_count := affected_count + 1;
      continue;
    end if;

    -- Genuinely new for this module. Before creating a second row, check
    -- whether any of its ШК already belong to a non-deleted task from a
    -- DIFFERENT module/task_type -- if so this is the same physical item
    -- continuing its story elsewhere, not a new one.
    v_canonical_id := null;
    if array_length(v_source_shk_ids, 1) > 0 then
      select id into v_canonical_id
      from public.wms_tasks
      where is_deleted = false
        and source_shk_ids && v_source_shk_ids
        and not (source_module = v_source_module and task_type = v_task_type)
      order by created_at asc
      limit 1;
    end if;

    if v_canonical_id is not null then
      update public.wms_tasks
      set source_shk_ids = (
            select array(select distinct unnest(coalesce(source_shk_ids, '{}'::text[]) || v_source_shk_ids))
          ),
          last_seen_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where id = v_canonical_id;

      -- Guarded by (canonical, source_id): a module's own periodic refresh
      -- of the SAME still-redirected source_id must not re-log this touch
      -- on every re-sync -- only a genuinely new source_id for this ШК
      -- (a new prespisok run, a new upload row, etc.) earns a new entry.
      if not exists (
        select 1 from public.wms_task_history
        where task_id = v_canonical_id
          and event_type = 'task_cross_module_touch'
          and payload->>'new_source_id' = v_source_id
      ) then
        insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
        values (
          v_canonical_id,
          'task_cross_module_touch',
          'Система',
          '',
          jsonb_build_object(
            'new_module', v_source_module,
            'new_source_id', v_source_id,
            'new_task_type', v_task_type,
            'new_title', v_title,
            'new_verdict', nullif(v_opp_verdict, 'Не выбран'),
            'new_status', v_task_status,
            'new_shk_ids', to_jsonb(v_source_shk_ids)
          )
        );
      end if;
      task_ids := task_ids || v_canonical_id;
      affected_count := affected_count + 1;
      continue;
    end if;

    -- Truly new physical item -- normal insert.
    insert into public.wms_tasks (
      source_module, source_table, source_id, source_row_id, source_payload,
      source_generated_at, source_shk_ids, source_tare_id, source_price_sum,
      source_last_movement_at, search_text, upload_type, upload_effective_date,
      task_type, title, description, priority, priority_label, due_date,
      responsibility_zone, task_status, opp_verdict, assignee_employee_id,
      assignee_name, tags, last_seen_at
    ) values (
      v_source_module, v_source_table, v_source_id, item->>'source_row_id', v_source_payload,
      v_source_generated_at, v_source_shk_ids, v_source_tare_id, v_source_price_sum,
      v_source_last_movement_at, v_search_text, v_upload_type, v_upload_effective_date,
      v_task_type, v_title, v_description, v_priority, v_priority_label, v_due_date,
      v_responsibility_zone, v_task_status, v_opp_verdict, v_assignee_employee_id,
      v_assignee_name, v_tags, timezone('utc', now())
    )
    returning id into v_row_id;
    task_ids := task_ids || v_row_id;
    affected_count := affected_count + 1;
  end loop;

  if p_run is not null and jsonb_typeof(p_run) = 'object' and nullif(p_run->>'source_module', '') is not null then
    insert into public.wms_manual_upload_runs (
      upload_date,
      effective_date,
      business_date,
      source_module,
      upload_type,
      status,
      file_name,
      secondary_file_name,
      rows_count,
      tasks_count,
      upserted_count,
      summary
    )
    values (
      coalesce(public.wms_safe_date(p_run->>'upload_date'), timezone('Europe/Moscow', now())::date),
      coalesce(public.wms_safe_date(p_run->>'effective_date'), public.wms_safe_date(p_run->>'business_date'), timezone('Europe/Moscow', now())::date),
      public.wms_safe_date(p_run->>'business_date'),
      p_run->>'source_module',
      coalesce(nullif(p_run->>'upload_type', ''), p_run->>'source_module'),
      coalesce(nullif(p_run->>'status', ''), 'completed'),
      p_run->>'file_name',
      p_run->>'secondary_file_name',
      coalesce(public.wms_safe_integer(p_run->>'rows_count'), 0),
      coalesce(public.wms_safe_integer(p_run->>'tasks_count'), affected_count),
      affected_count,
      coalesce(p_run->'summary', '{}'::jsonb)
    )
    on conflict (effective_date, source_module, upload_type)
    do update set
      upload_date = excluded.upload_date,
      business_date = excluded.business_date,
      status = excluded.status,
      file_name = excluded.file_name,
      secondary_file_name = excluded.secondary_file_name,
      rows_count = excluded.rows_count,
      tasks_count = excluded.tasks_count,
      upserted_count = excluded.upserted_count,
      summary = excluded.summary,
      updated_at = timezone('utc', now())
    returning * into run_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upserted_count', affected_count,
    'task_ids', to_jsonb(task_ids),
    'upload_run', case when run_row.id is null then null else to_jsonb(run_row) end
  );
end;
$$;

grant execute on function public.save_wms_manual_upload(jsonb, jsonb) to anon, authenticated;

-- One-time backfill: merge already-existing cross-module ШК duplicates.
-- Idempotent -- safe to re-run (finds nothing once already merged).
do $$
declare
  shk_row record;
  canonical_id uuid;
  duplicate_row record;
begin
  for shk_row in
    select shk
    from (
      select unnest(source_shk_ids) as shk, source_module
      from public.wms_tasks
      where is_deleted = false and source_shk_ids is not null
    ) x
    group by shk
    having count(distinct source_module) > 1
  loop
    select id into canonical_id
    from public.wms_tasks
    where is_deleted = false and source_shk_ids @> array[shk_row.shk]
    order by created_at asc
    limit 1;

    if canonical_id is null then
      continue;
    end if;

    for duplicate_row in
      select *
      from public.wms_tasks
      where is_deleted = false
        and source_shk_ids @> array[shk_row.shk]
        and id <> canonical_id
    loop
      insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload, created_at)
      values (
        canonical_id,
        'task_cross_module_touch',
        'Система',
        '',
        jsonb_build_object(
          'new_module', duplicate_row.source_module,
          'new_task_type', duplicate_row.task_type,
          'new_title', duplicate_row.title,
          'new_verdict', nullif(duplicate_row.opp_verdict, 'Не выбран'),
          'new_status', duplicate_row.task_status,
          'new_shk_ids', to_jsonb(duplicate_row.source_shk_ids),
          'merged_from_task_id', duplicate_row.id,
          'backfill', true
        ),
        duplicate_row.created_at
      );

      update public.wms_tasks
      set is_deleted = true,
          source_payload = coalesce(source_payload, '{}'::jsonb) || jsonb_build_object('merged_into', canonical_id),
          updated_at = timezone('utc', now())
      where id = duplicate_row.id;
    end loop;
  end loop;
end $$;
