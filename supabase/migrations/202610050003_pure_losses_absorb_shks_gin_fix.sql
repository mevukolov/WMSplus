-- Перфоманс-фикс: wms_pure_losses_absorb_shks искала задачу по ШК через
-- "v_shk = any(source_shk_ids)" -- этот паттерн не использует
-- существующий GIN-индекс wms_tasks_source_shk_ids_gin_idx (он ускоряет
-- &&/@>/<@, но не прямое "x = any(array)"). На единичном вызове незаметно,
-- но при бэкофилле на тысячах ШК подряд упирается в statement timeout.
-- Переписано на "source_shk_ids @> array[v_shk]" -- эквивалентно по
-- смыслу (containment одного элемента), но использует индекс.
create or replace function public.wms_pure_losses_absorb_shks(
    p_rows jsonb,
    p_actor_id text default null,
    p_actor_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_zone constant text := 'Чистые списания';
    v_row jsonb;
    v_shk text;
    v_nm text;
    v_name text;
    v_price numeric;
    v_date_lost timestamptz;
    v_task record;
    v_items jsonb;
    v_removed_shk text[];
    v_remaining jsonb;
    v_remaining_price numeric;
    v_priority integer;
    v_priority_label text;
    v_search_text text;
    v_new_id uuid;
    v_results jsonb := '[]'::jsonb;
begin
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        return v_results;
    end if;

    for v_row in select * from jsonb_array_elements(p_rows) loop
        v_shk := nullif(trim(v_row->>'shk'), '');
        if v_shk is null then
            continue;
        end if;
        v_nm := nullif(trim(v_row->>'nm'), '');
        v_name := coalesce(nullif(trim(v_row->>'name'), ''), 'Без наименования');
        v_price := coalesce((v_row->>'price')::numeric, 0);
        v_date_lost := coalesce(public.wms_safe_timestamptz(v_row->>'date_lost'), now());

        if exists (
            select 1 from public.wms_tasks
            where is_deleted = false and task_type = v_zone and source_shk_ids @> array[v_shk]
        ) then
            continue;
        end if;

        select * into v_task
        from public.wms_tasks
        where is_deleted = false
          and task_type <> v_zone
          and source_shk_ids @> array[v_shk]
        order by created_at asc
        limit 1;

        if v_task.id is not null then
            v_items := coalesce(v_task.source_payload->'task_items', '[]'::jsonb);
            v_removed_shk := array[v_shk];

            select coalesce(jsonb_agg(item), '[]'::jsonb) into v_remaining
            from jsonb_array_elements(v_items) item
            where not (item->>'shk' = any(v_removed_shk));

            if jsonb_array_length(v_items) <= 1 or jsonb_array_length(v_remaining) = 0 then
                update public.wms_tasks
                set task_type = v_zone,
                    task_status = 'Не начато',
                    opp_verdict = 'Не выбран',
                    completed_at = null,
                    reopen_after = null,
                    source_payload = jsonb_set(
                        jsonb_set(coalesce(source_payload, '{}'::jsonb), '{item_name}', to_jsonb(v_name)),
                        '{task_items}',
                        jsonb_build_array(jsonb_build_object(
                            'shk', v_shk, 'nm', v_nm, 'name', v_name, 'price', v_price,
                            'status', '', 'movement', '', 'mx', ''
                        ))
                    ),
                    source_shk_ids = array[v_shk],
                    source_price_sum = v_price,
                    search_text = concat_ws(' ', v_task.title, v_zone, v_shk, v_nm, v_name),
                    updated_at = now()
                where id = v_task.id;

                insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload, created_at)
                values (v_task.id, 'task_moved_to_pure_losses', p_actor_id, p_actor_name,
                        jsonb_build_object('shk', v_shk, 'date_lost', v_date_lost), v_date_lost);

                v_results := v_results || jsonb_build_object('shk', v_shk, 'task_id', v_task.id, 'action', 'repurposed');
            else
                select coalesce(sum((item->>'price')::numeric), 0) into v_remaining_price
                from jsonb_array_elements(v_remaining) item;

                if v_remaining_price < 500 then v_priority := null; v_priority_label := 'Без приоритета';
                elsif v_remaining_price < 1000 then v_priority := 3; v_priority_label := 'Замороженный';
                elsif v_remaining_price < 5000 then v_priority := 0; v_priority_label := 'Низкий';
                elsif v_remaining_price < 10000 then v_priority := 1; v_priority_label := 'Средний';
                else v_priority := 2; v_priority_label := 'Высокий';
                end if;

                select string_agg(distinct coalesce(item->>'shk', ''), ' ') into v_search_text
                from jsonb_array_elements(v_remaining) item;

                update public.wms_tasks
                set source_payload = jsonb_set(source_payload, '{task_items}', v_remaining),
                    source_shk_ids = (select array_agg(item->>'shk') from jsonb_array_elements(v_remaining) item),
                    source_price_sum = v_remaining_price,
                    priority = v_priority,
                    priority_label = v_priority_label,
                    search_text = concat_ws(' ', v_task.title, v_task.task_type, v_task.source_tare_id, v_search_text),
                    updated_at = now()
                where id = v_task.id;

                insert into public.wms_tasks (
                    source_module, source_table, source_id, source_payload,
                    source_generated_at, source_shk_ids, source_price_sum,
                    search_text, task_type, title, task_status, opp_verdict,
                    responsibility_zone, tags, last_seen_at
                ) values (
                    'pure_losses', 'manual_absorb', 'pure_losses:' || v_shk || ':' || to_char(v_date_lost at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                    jsonb_build_object(
                        'item_name', v_name,
                        'task_items', jsonb_build_array(jsonb_build_object(
                            'shk', v_shk, 'nm', v_nm, 'name', v_name, 'price', v_price,
                            'status', '', 'movement', '', 'mx', ''
                        )),
                        'split_from_task_id', v_task.id
                    ),
                    v_date_lost, array[v_shk], v_price,
                    concat_ws(' ', v_zone, v_shk, v_nm, v_name), v_zone, 'ШК ' || v_shk, 'Не начато', 'Не выбран',
                    'Нет привязки', '[]'::jsonb, now()
                )
                returning id into v_new_id;

                insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload, created_at)
                values (v_new_id, 'task_moved_to_pure_losses', p_actor_id, p_actor_name,
                        jsonb_build_object('shk', v_shk, 'date_lost', v_date_lost, 'split_from_task_id', v_task.id), v_date_lost);

                v_results := v_results || jsonb_build_object('shk', v_shk, 'task_id', v_new_id, 'action', 'extracted_new_row');
            end if;
        else
            insert into public.wms_tasks (
                source_module, source_table, source_id, source_payload,
                source_generated_at, source_shk_ids, source_price_sum,
                search_text, task_type, title, task_status, opp_verdict,
                responsibility_zone, tags, last_seen_at
            ) values (
                'pure_losses', 'manual_absorb', 'pure_losses:' || v_shk || ':' || to_char(v_date_lost at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                jsonb_build_object(
                    'item_name', v_name,
                    'task_items', jsonb_build_array(jsonb_build_object(
                        'shk', v_shk, 'nm', v_nm, 'name', v_name, 'price', v_price,
                        'status', '', 'movement', '', 'mx', ''
                    ))
                ),
                v_date_lost, array[v_shk], v_price,
                concat_ws(' ', v_zone, v_shk, v_nm, v_name), v_zone, 'ШК ' || v_shk, 'Не начато', 'Не выбран',
                'Нет привязки', '[]'::jsonb, now()
            )
            returning id into v_new_id;

            insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload, created_at)
            values (v_new_id, 'task_moved_to_pure_losses', p_actor_id, p_actor_name,
                    jsonb_build_object('shk', v_shk, 'date_lost', v_date_lost), v_date_lost);

            v_results := v_results || jsonb_build_object('shk', v_shk, 'task_id', v_new_id, 'action', 'created_new');
        end if;
    end loop;

    return v_results;
end;
$$;
