-- Жизненный цикл ШК по наблюдению пользователя: сначала выгрузка (задача),
-- потом может повиснуть в предсписке, и в какой-то момент всплывает в
-- выгрузке чистых списаний -- с этого момента именно чистые списания
-- авторитетны, а старую задачу (активную ИЛИ отложенную/неактивную, но не
-- завершённую) нельзя оставлять висеть параллельно с тем же ШК.
--
-- Общая RPC, а не JS в pure_losses.js -- pure_losses.html и tasks.html не
-- связаны между собой (разные страницы, pure_losses.js не подключает
-- tasks.js), а разделение ШК из тарной задачи (splitTaskFromTare в
-- tasks.js) завязано на кучу вспомогательной логики (приоритет, назначение
-- смены, спецтеги) -- дублировать её в другом файле рискованно разойтись.
--
-- Сознательное упрощение v1 (не полный splitTaskFromTare): при выделении
-- ШК из тары с другими товарами ЗАДАЧА НЕ разделяется на новую -- просто
-- убирается элемент из существующей тары на месте (пересчитываются
-- source_shk_ids/source_price_sum/priority/search_text). source_payload.
-- item_name/status_code_label и source_last_movement_at намеренно не
-- пересчитываются -- мелкая визуальная устарелость (ярлык/дата), не потеря
-- данных; пересчитаются сами при следующей живой правке задачи.
create or replace function public.wms_reconcile_shks_written_off(
    p_shks text[],
    p_actor_id text default null,
    p_actor_name text default null,
    p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_verdict constant text := 'Аннулирование после списания';
    v_task record;
    v_items jsonb;
    v_removed_shks text[];
    v_remaining jsonb;
    v_price numeric;
    v_priority integer;
    v_priority_label text;
    v_search_text text;
    v_shk text;
    v_results jsonb := '[]'::jsonb;
begin
    if p_shks is null or array_length(p_shks, 1) is null then
        return v_results;
    end if;

    for v_task in (
        select *
        from public.wms_tasks
        where is_deleted = false
          and task_status <> 'Завершено'
          and source_shk_ids && p_shks
    ) loop
        v_items := coalesce(v_task.source_payload->'task_items', '[]'::jsonb);
        select array_agg(x) into v_removed_shks
        from (
            select unnest(v_task.source_shk_ids)
            intersect
            select unnest(p_shks)
        ) as t(x);

        if v_removed_shks is null or array_length(v_removed_shks, 1) is null then
            continue;
        end if;

        select coalesce(jsonb_agg(item), '[]'::jsonb) into v_remaining
        from jsonb_array_elements(v_items) item
        where not (item->>'shk' = any(v_removed_shks));

        if jsonb_array_length(v_remaining) = 0 then
            -- Либо задача была на один ШК, либо списаны сразу все товары
            -- этой тары -- закрываем задачу целиком, как любое другое
            -- системное закрытие (completeTaskBySystemNoShk, та же форма).
            update public.wms_tasks
            set task_status = 'Завершено',
                opp_verdict = v_verdict,
                completed_at = now(),
                reopen_after = null,
                updated_at = now()
            where id = v_task.id;
        else
            select coalesce(sum((item->>'price')::numeric), 0) into v_price
            from jsonb_array_elements(v_remaining) item;

            if v_price < 500 then v_priority := null; v_priority_label := 'Без приоритета';
            elsif v_price < 1000 then v_priority := 3; v_priority_label := 'Замороженный';
            elsif v_price < 5000 then v_priority := 0; v_priority_label := 'Низкий';
            elsif v_price < 10000 then v_priority := 1; v_priority_label := 'Средний';
            else v_priority := 2; v_priority_label := 'Высокий';
            end if;

            select string_agg(distinct coalesce(item->>'shk', ''), ' ') into v_search_text
            from jsonb_array_elements(v_remaining) item;

            update public.wms_tasks
            set source_payload = jsonb_set(source_payload, '{task_items}', v_remaining),
                source_shk_ids = (
                    select array_agg(item->>'shk') from jsonb_array_elements(v_remaining) item
                ),
                source_price_sum = v_price,
                priority = v_priority,
                priority_label = v_priority_label,
                search_text = concat_ws(' ', title, task_type, source_tare_id, v_search_text),
                updated_at = now()
            where id = v_task.id;
        end if;

        foreach v_shk in array v_removed_shks loop
            insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload)
            values (
                v_task.id,
                'task_shk_written_off',
                p_actor_id,
                p_actor_name,
                jsonb_build_object(
                    'shk', v_shk,
                    'verdict', v_verdict,
                    'comment', p_comment,
                    'action', case when jsonb_array_length(v_remaining) = 0 then 'closed' else 'extracted_from_tare' end
                )
            );
            v_results := v_results || jsonb_build_object(
                'task_id', v_task.id,
                'shk', v_shk,
                'action', case when jsonb_array_length(v_remaining) = 0 then 'closed' else 'extracted_from_tare' end
            );
        end loop;
    end loop;

    return v_results;
end;
$$;

grant execute on function public.wms_reconcile_shks_written_off(text[], text, text, text) to authenticated;
