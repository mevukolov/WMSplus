-- Унификация загрузок (спека 2026-10-14-wms-upload-unification-design.md):
-- 1. output_key получает новое допустимое значение 'filter' -- правило
--    этого вида не маршрутизирует, а просто отсекает строку (задача не
--    создаётся). Отдельная rule_kind-колонка не заводится -- output_key
--    уже исторически ровно этот дискриминатор (раньше zone/no_order_folder).
-- 2. source_format -- в какой выгрузке (по формату файла, не по участку)
--    правило вообще участвует: general (ПМ-основной/Предсортировка/
--    Маркетплейс+ПЦ/WMI/Без заказа) / packaging (Упаковка+RWP) /
--    after_sale_movement.
-- 3. force_tare_grouping/force_high_priority/tags/task_deadline_days/
--    upload_offset_days -- замена захардкоженных per-module полей
--    (DEFAULT_MODULES.offsetDays/taskDeadlineDays, appendGroupedTasks'
--    forceTareGrouping/forceHighPriority/tags в build*Preview).
--
-- Дефолты всех новых полей (false/null/0) эквивалентны сегодняшнему
-- поведению -- существующие 18 активных правил ничего не меняют до
-- явного бэкофилла source_format ниже, который тоже чисто
-- информационный на этом шаге (ещё не используется ни одной
-- build-функцией, подключение -- в задачах 3-5).

alter table public.wms_routing_rules
    add column if not exists source_format text,
    add column if not exists force_tare_grouping boolean not null default false,
    add column if not exists force_high_priority boolean not null default false,
    add column if not exists tags text[] not null default '{}',
    add column if not exists task_deadline_days integer,
    add column if not exists upload_offset_days integer not null default 0;

alter table public.wms_routing_rules
    drop constraint if exists wms_routing_rules_output_key_check;
alter table public.wms_routing_rules
    add constraint wms_routing_rules_output_key_check
    check (output_key in ('zone', 'filter'));

-- Бэкофилл source_format по существующему target_task_type. Единственный
-- участник формата packaging сегодня -- правила, ведущие в RWP (Упаковка
-- сама по себе никогда не была явной целью правила, это catch-all внутри
-- buildPackagingPreview). Все остальные сегодняшние target_task_type
-- (WMI (МП + ПЦ), Другие задачи, Маркетплейс, ПМ, Почта, Предсортировка, ПЦ)
-- -- общий формат. Проверено живым запросом по проду перед написанием
-- миграции (distinct target_task_type x output_key), другого формата
-- среди текущих правил нет.
update public.wms_routing_rules
set source_format = case
    when target_task_type = 'RWP' then 'packaging'
    else 'general'
end
where output_key = 'zone' and source_format is null;

alter table public.wms_routing_rules
    alter column source_format set not null;
alter table public.wms_routing_rules
    drop constraint if exists wms_routing_rules_source_format_check;
alter table public.wms_routing_rules
    add constraint wms_routing_rules_source_format_check
    check (source_format in ('general', 'packaging', 'after_sale_movement'));

-- task_deadline_days получает реальные текущие значения, а не остаётся
-- null -- иначе уже на старте все зоны начали бы жить "в долг" дефолтным
-- 1 днём, хотя у ПМ/Почты/Оклейки сегодня другие сроки. Карта 1:1 с
-- DEFAULT_MODULES в tasks.js (taskDeadlineDays/pmDeadlineDays/mailDeadlineDays).
update public.wms_routing_rules
set task_deadline_days = case
    when target_task_type = 'ПМ' then 2
    when target_task_type = 'Почта' then 3
    else 1
end
where output_key = 'zone';

-- force_high_priority/tags -- только у двух правил (USD/TMM), сегодня
-- зашито в buildNoOrderPreview отдельно от самого правила (forceHighPriority
-- true, tags ["Идентификация из ОПП"]). Остальные zone-правила эти поля
-- не трогают (дефолт false/'{}' корректен).
update public.wms_routing_rules
set force_high_priority = true,
    tags = array['Идентификация из ОПП']
where from_zone = 'Разбор ОПП // Без заказа';

-- Уникальный индекс (output_key, priority) не меняется -- output_key='filter'
-- уже даёт filter-правилам свою отдельную нумерацию приоритета бесплатно.

-- wms_evaluate_rule_batch должна теперь учитывать source_format, иначе
-- packaging-only правило может случайно сработать на general-строке с
-- похожими условиями (оба формата используют одинаковые имена атрибутов
-- status/mx/route_number). Новый обязательный параметр p_source_format.
create or replace function public.wms_evaluate_rule_batch(p_output_key text, p_source_format text, p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_row jsonb;
    v_row_id text;
    v_attributes jsonb;
    v_rule record;
    v_rule_id uuid;
    v_rule_name text;
    v_output_value jsonb;
    v_results jsonb := '[]'::jsonb;
begin
    if p_rows is null or jsonb_array_length(p_rows) = 0 then
        return v_results;
    end if;

    for v_row in select * from jsonb_array_elements(p_rows) loop
        v_row_id := v_row->>'row_id';
        v_attributes := v_row - 'row_id';

        v_rule_id := null;
        v_rule_name := null;
        v_output_value := null;
        for v_rule in
            select * from public.wms_routing_rules
            where is_active = true and output_key = p_output_key and source_format = p_source_format
            order by priority asc
        loop
            if public.wms_rule_conditions_match(v_rule.conditions, v_attributes) then
                v_rule_id := v_rule.id;
                v_rule_name := v_rule.name;
                v_output_value := jsonb_build_object(
                    'target_task_type', v_rule.target_task_type,
                    'force_tare_grouping', v_rule.force_tare_grouping,
                    'force_high_priority', v_rule.force_high_priority,
                    'tags', to_jsonb(v_rule.tags),
                    'task_deadline_days', v_rule.task_deadline_days,
                    'upload_offset_days', v_rule.upload_offset_days
                );
                exit;
            end if;
        end loop;

        v_results := v_results || jsonb_build_object(
            'row_id', v_row_id,
            'rule_id', v_rule_id,
            'rule_name', v_rule_name,
            'output_value', v_output_value
        );
    end loop;

    return v_results;
end;
$$;

-- Старая сигнатура (output_key, rows) больше не используется ни одним
-- активным путём после задач 3-5 этого плана, но пока оставляем её как
-- отдельную перегрузку (не ломаем вызовы, которые ещё не переведены) --
-- просто проксирует в новую с source_format='general' (сегодняшнее
-- единственное реальное значение zone-правил, не считая RWP/after_sale,
-- которые эту двухаргументную форму никогда не звали).
create or replace function public.wms_evaluate_rule_batch(p_output_key text, p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    return public.wms_evaluate_rule_batch(p_output_key, 'general', p_rows);
end;
$$;

grant execute on function public.wms_evaluate_rule_batch(text, text, jsonb) to anon, authenticated;
grant execute on function public.wms_evaluate_rule_batch(text, jsonb) to anon, authenticated;
