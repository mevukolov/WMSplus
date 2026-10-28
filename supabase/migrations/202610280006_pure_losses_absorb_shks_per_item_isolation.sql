-- Тот же баг, что раньше чинили в save_wms_manual_upload (миграция
-- 202610260001): функция обрабатывает пачку ШК в одном цикле БЕЗ
-- изоляции ошибок по строкам -- если хотя бы один ШК в пачке ловит
-- конфликт (напр. wms_task_items_shk_active_unique -- тот же физический
-- ШК уже активен под другой задачей), вся транзакция откатывается и НЕ
-- сохраняется ни одна строка, даже если остальные тысячи были валидны.
-- Реальный случай: ручная загрузка 13029 ШК чистых списаний, 1 конфликт
-- -- откатило все 13029.
--
-- Оборачиваем тело цикла в begin/exception -- тот же приём, что и там:
-- PL/pgSQL создаёт неявный SAVEPOINT на каждую итерацию, упавшая строка
-- откатывается сама, остальные продолжают. Собираем пропущенные строки
-- в skipped_items и возвращаем вместе с results, чтобы UI мог показать
-- "сохранено X, пропущено Y (конфликт...)" вместо немой полной неудачи.
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
    v_lr integer;
    v_date_lost timestamptz;
    v_task_id uuid;
    v_was_orphan boolean;
    v_results jsonb := '[]'::jsonb;
    v_skipped jsonb := '[]'::jsonb;
    v_error_detail text;
begin
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        return jsonb_build_object('results', v_results, 'skipped_items', v_skipped);
    end if;

    for v_row in select * from jsonb_array_elements(p_rows) loop
        v_shk := nullif(trim(v_row->>'shk'), '');
        if v_shk is null then
            continue;
        end if;

        begin
            v_nm := nullif(trim(v_row->>'nm'), '');
            v_name := coalesce(nullif(trim(v_row->>'name'), ''), 'Без наименования');
            v_price := coalesce((v_row->>'price')::numeric, 0);
            v_lr := nullif(v_row->>'lr', '')::integer;
            v_date_lost := coalesce(public.wms_safe_timestamptz(v_row->>'date_lost'), now());

            if exists (select 1 from public.wms_task_items where shk = v_shk and task_type = v_zone) then
                continue;
            end if;

            select id into v_task_id
            from public.wms_tasks
            where is_deleted = false and source_shk_ids @> array[v_shk]
            order by created_at asc
            limit 1;

            v_was_orphan := v_task_id is null;
            if v_was_orphan then
                insert into public.wms_tasks (
                    source_module, source_table, source_id, source_payload,
                    source_generated_at, source_shk_ids, source_price_sum,
                    search_text, task_type, title, task_status, opp_verdict,
                    responsibility_zone, tags, last_seen_at
                ) values (
                    'pure_losses', 'manual_absorb',
                    'pure_losses:' || v_shk || ':' || to_char(v_date_lost at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
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
                returning id into v_task_id;
            end if;

            update public.wms_task_items
            set task_type = v_zone,
                opp_verdict = 'Не выбран',
                task_status = 'Не начато',
                completed_at = null,
                reopen_after = null,
                zone_payload = jsonb_build_object(
                    'pure_losses_lr', v_lr,
                    'pure_losses_date_lost', to_char(v_date_lost at time zone 'utc', 'YYYY-MM-DD')
                ),
                name = v_name,
                nm = coalesce(v_nm, nm),
                price = v_price,
                updated_at = now()
            where task_id = v_task_id and shk = v_shk;

            insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload, created_at)
            values (v_task_id, 'task_moved_to_pure_losses', p_actor_id, p_actor_name,
                    jsonb_build_object('shk', v_shk, 'date_lost', v_date_lost, 'lr', v_lr), v_date_lost);

            v_results := v_results || jsonb_build_object(
                'shk', v_shk, 'task_id', v_task_id,
                'action', case when v_was_orphan then 'created_new' else 'zoned_in_place' end
            );
        exception when others then
            get stacked diagnostics v_error_detail = pg_exception_detail;
            v_skipped := v_skipped || jsonb_build_object(
                'shk', v_shk,
                'error', sqlerrm,
                'detail', coalesce(v_error_detail, '')
            );
        end;
    end loop;

    return jsonb_build_object('results', v_results, 'skipped_items', v_skipped);
end;
$$;
