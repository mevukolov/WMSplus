-- "Запомнить ШК" (UI: кнопка "+" в "Предразбор" слева от исключения).
-- Три ветки:
--  1) есть активная (не "Завершено") задача по ШК -- заметка пишется
--     строкой в её историю, новая задача не создаётся.
--  2) активной нет, "Создать задачу" включён -- создаётся новая задача
--     (source_module='shk_memory', зона/отложить как заданы), заметка --
--     первая строка её истории.
--  3) активной нет, "Создать задачу" выключен -- лёгкая сразу
--     завершённая задача-заметка (видна в поиске прямо сейчас),
--     заметка помечается pending_future_attach -- см. 202610150005.
-- source_module='shk_memory' -- сентинел, по которому
-- wms_compute_reroute_target (202610150007) исключает такие задачи из
-- Sweep/актуализации: зона здесь выбрана вручную, не правилом.
create or replace function public.wms_remember_shk(
    p_shk text,
    p_comment text,
    p_last_movement_status text default null,
    p_create_task boolean default false,
    p_zone text default null,
    p_reopen_after timestamptz default null,
    p_actor_id text default null,
    p_actor_name text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_shk text := nullif(trim(p_shk), '');
    v_comment text := nullif(trim(p_comment), '');
    v_status text := nullif(trim(p_last_movement_status), '');
    v_full_comment text;
    v_active_task_id uuid;
    v_task_id uuid;
    v_task_type text;
begin
    if v_shk is null then
        raise exception 'ШК обязателен';
    end if;
    if v_comment is null then
        raise exception 'Комментарий обязателен';
    end if;

    v_full_comment := v_comment || case when v_status is not null
        then (chr(10) || 'Статус последнего движения: ' || v_status)
        else '' end;

    select ti.task_id into v_active_task_id
    from public.wms_task_items ti
    join public.wms_tasks t on t.id = ti.task_id
    where ti.shk = v_shk
      and ti.task_status <> 'Завершено'
      and t.is_deleted = false
    order by ti.updated_at desc
    limit 1;

    if v_active_task_id is not null then
        insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
        values (
            v_active_task_id, 'shk_note_added', p_actor_name, p_actor_id,
            jsonb_build_object('shk', v_shk, 'comment', v_full_comment, 'raw_comment', v_comment, 'last_movement_status', v_status)
        );

        insert into public.wms_shk_notes (shk, comment, last_movement_status, actor_name, actor_employee_id, note_task_id, pending_future_attach)
        values (v_shk, v_comment, v_status, p_actor_name, p_actor_id, v_active_task_id, false);

        return jsonb_build_object('ok', true, 'mode', 'attached_active', 'task_id', v_active_task_id);
    end if;

    if p_create_task then
        v_task_type := case
            when p_zone is null or trim(p_zone) = '' then 'Другие задачи'
            when p_zone like 'Разбор ОПП // %' then p_zone
            when p_zone in ('Другие задачи', 'Движение после продажи') then p_zone
            else 'Разбор ОПП // ' || p_zone
        end;

        insert into public.wms_tasks (
            source_module, source_table, source_id, source_payload, source_shk_ids,
            task_type, title, description, task_status, opp_verdict, reopen_after,
            assignee_employee_id, assignee_name
        ) values (
            'shk_memory', 'shk_memory', gen_random_uuid()::text,
            jsonb_build_object('task_items', jsonb_build_array(jsonb_build_object('shk', v_shk, 'status', v_status))),
            array[v_shk],
            v_task_type, 'Запомнить ШК · ' || v_shk, v_comment,
            case when p_reopen_after is not null then 'Отложено' else 'Не начато' end,
            'Не выбран', p_reopen_after, p_actor_id, p_actor_name
        )
        returning id into v_task_id;

        insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
        values (
            v_task_id, 'shk_note_added', p_actor_name, p_actor_id,
            jsonb_build_object('shk', v_shk, 'comment', v_full_comment, 'raw_comment', v_comment, 'last_movement_status', v_status)
        );

        insert into public.wms_shk_notes (shk, comment, last_movement_status, actor_name, actor_employee_id, note_task_id, pending_future_attach)
        values (v_shk, v_comment, v_status, p_actor_name, p_actor_id, v_task_id, false);

        return jsonb_build_object('ok', true, 'mode', 'created_task', 'task_id', v_task_id);
    end if;

    insert into public.wms_tasks (
        source_module, source_table, source_id, source_payload, source_shk_ids,
        task_type, title, description, task_status, opp_verdict, completed_at
    ) values (
        'shk_memory', 'shk_memory', gen_random_uuid()::text,
        jsonb_build_object('task_items', jsonb_build_array(jsonb_build_object('shk', v_shk, 'status', v_status))),
        array[v_shk],
        'Другие задачи', 'Запомнить ШК · ' || v_shk, v_comment, 'Завершено', 'Не выбран', now()
    )
    returning id into v_task_id;

    insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
    values (
        v_task_id, 'shk_note_added', p_actor_name, p_actor_id,
        jsonb_build_object('shk', v_shk, 'comment', v_full_comment, 'raw_comment', v_comment, 'last_movement_status', v_status)
    );

    insert into public.wms_shk_notes (shk, comment, last_movement_status, actor_name, actor_employee_id, note_task_id, pending_future_attach)
    values (v_shk, v_comment, v_status, p_actor_name, p_actor_id, v_task_id, true);

    return jsonb_build_object('ok', true, 'mode', 'fallback_task', 'task_id', v_task_id);
end;
$function$;

grant execute on function public.wms_remember_shk(text, text, text, boolean, text, timestamptz, text, text) to anon, authenticated;
