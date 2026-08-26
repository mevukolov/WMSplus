create or replace function public.apply_wms_upload_offsets(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  updated_count integer := 0;
begin
  if p_rows is null then
    p_rows := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  for item in
    select value from jsonb_array_elements(p_rows)
  loop
    if coalesce(nullif(item->>'module', ''), '') = '' then
      continue;
    end if;

    insert into public.wms_manual_upload_settings (
      module,
      label,
      source_module,
      upload_type,
      upload_offset_days,
      task_deadline_days,
      is_required,
      responsibility_zone,
      description,
      sort_order,
      updated_at
    )
    values (
      item->>'module',
      coalesce(nullif(item->>'label', ''), item->>'module'),
      coalesce(nullif(item->>'source_module', ''), item->>'module'),
      coalesce(nullif(item->>'upload_type', ''), item->>'module'),
      coalesce((nullif(item->>'upload_offset_days', ''))::integer, 0),
      coalesce((nullif(item->>'task_deadline_days', ''))::integer, 1),
      coalesce((nullif(item->>'is_required', ''))::boolean, true),
      coalesce(nullif(item->>'responsibility_zone', ''), 'Исходящий поток'),
      nullif(item->>'description', ''),
      coalesce((nullif(item->>'sort_order', ''))::integer, 100),
      timezone('utc', now())
    )
    on conflict (module) do update
      set label = excluded.label,
          source_module = excluded.source_module,
          upload_type = excluded.upload_type,
          upload_offset_days = excluded.upload_offset_days,
          task_deadline_days = excluded.task_deadline_days,
          is_required = excluded.is_required,
          responsibility_zone = excluded.responsibility_zone,
          description = excluded.description,
          sort_order = excluded.sort_order,
          updated_at = timezone('utc', now());

    updated_count := updated_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'updated_count', updated_count
  );
end;
$$;

grant execute on function public.apply_wms_upload_offsets(jsonb) to anon, authenticated, service_role;
