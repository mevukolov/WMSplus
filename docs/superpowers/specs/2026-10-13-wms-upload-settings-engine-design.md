# Движок настраиваемых параметров выгрузки — дизайн

## Контекст

Это первый подпроект Фазы 2b (подключение обычной ручной выгрузки к
гибкой настройке — последний крупный кусок исходного желания
пользователя "уйти от фиксированных фильтров при выгрузке... хочется
гибкие настройки в самом интерфейсе для администратора").

Брейншторм показал, что реальный объём классификации при выгрузке —
не просто "статус → зона": это ~7 функций `build*Preview` (tasks.js),
каждая со своими предикатами статуса, полем группировки (`corrugated`
/ `tare_id` / `transfer` / без группировки), порогами отсечения
дешёвых строк, due-date сдвигами, и в случае "ПМ/Почта" — отдельным
списком из 60 номеров маршрутов и сверкой со вторым загруженным
файлом. Пользователь явно подтвердил цель: "мне нужна именно гибкость
условий всех... редактировать ценовой порог, список маршрутов,
привязку статусов итд. Полная гибкость и без хардкода" — и выбрал
путь "один универсальный движок условий" вместо нескольких целевых
таблиц.

Из-за масштаба решили разбить Фазу 2b на подпроекты: **этот документ
— только сам движок** (таблицы, функции оценки, админка). Переключение
7 модулей выгрузки на этот движок (замена `isPcStatus`/`isMarketplaceStatus`
и т.д., перенос `appendGroupedTasks`/`taskRecord` в SQL) — отдельные
будущие заходы, каждый со своей спекой, после того как движок
проверен в проде.

## Границы

**В объёме:**
- Расширение `wms_routing_rules` до универсального условного движка
  (новые атрибуты, операторы, `output_key`/`output_value`).
- Новая таблица `wms_module_settings` для нестатичных параметров без
  условий (due-date сдвиги, cheap-пороги, поле группировки и т.п.).
- SQL-функции оценки: `wms_rule_conditions_match`, `wms_evaluate_rule`,
  `wms_module_setting`.
- Админка: селектор `output_key` в существующей модалке правил +
  новая модалка для параметров модуля.
- Обратная совместимость с Фазой 1/2a — существующие zone-правила и
  вызывающий их код (`wms_apply_routing_rules`,
  `wms_compute_reroute_target`, `wms_reclassify_active_item`) не
  должны сломаться или regress'нуть.

**Вне объёма (следующие подпроекты):**
- Подключение любого из 7 `build*Preview` к этому движку.
- Перенос `appendGroupedTasks`/`taskRecord`/группировки по таре в SQL.
- Список маршрутов (`MAIL_ROUTES`), пороги цены и т.д. для конкретных
  модулей как ДАННЫЕ в новых таблицах — сами таблицы/движок готовы их
  принять, но заполнение реальными значениями для реальных модулей
  происходит при подключении каждого модуля, не здесь.

## Два типа настроек

Не всё из найденного — условное правило. Due-date сдвиги, поле
группировки, cheap-порог — это просто именованные параметры модуля
(число/строка), не что-то, что зависит от данных конкретной строки
выгрузки. Пытаться выразить это как "правило без условий, которое
всегда срабатывает" — неестественно и неудобно для админки. Поэтому:

- **Условные правила** (`wms_routing_rules`, расширенная) — для
  всего, что зависит от данных строки: зона по статусу/таре, уровень
  приоритета по цене, "почта vs ПМ" по номеру маршрута, список
  маршрутов как `in`-условие.
- **Параметры модуля** (`wms_module_settings`, новая) — для
  статичных на уровне модуля чисел/строк: due-date сдвиги, cheap-порог,
  поле группировки.

## Схема данных

### `wms_routing_rules` — расширение (Фаза 1 таблица, не пересоздаётся)

```sql
-- target_task_type было NOT NULL (единственный output Фазы 1) --
-- теперь не каждое правило обязано его иметь (например priority_tier
-- правило его не использует вообще).
alter table public.wms_routing_rules alter column target_task_type drop not null;

alter table public.wms_routing_rules
    add column if not exists output_key text not null default 'zone',
    add column if not exists output_value jsonb;

-- Бэкофилл: все существующие правила Фазы 1 -- это zone-правила;
-- переносим их target_task_type/grouping_attribute в output_value,
-- колонки сохраняем (ничего не удаляем -- и так, и так работает,
-- output_value -- просто новый единый способ читать то же самое).
update public.wms_routing_rules
set output_value = jsonb_build_object(
    'target_task_type', target_task_type,
    'grouping_attribute', grouping_attribute
)
where output_value is null;

alter table public.wms_routing_rules alter column output_value set not null;

-- Приоритет был глобально уникален -- теперь уникален В ПРЕДЕЛАХ
-- output_key (у разных типов решений независимые очереди правил).
alter table public.wms_routing_rules drop constraint if exists wms_routing_rules_priority_key;
create unique index if not exists wms_routing_rules_output_key_priority_unique
    on public.wms_routing_rules (output_key, priority);

-- Защитная сетка: существующая админ-форма (routingRuleInputRows,
-- tasks.js) сегодня пишет target_task_type/grouping_attribute и
-- ничего не знает про output_value. JS обновляется в рамках этого же
-- подпроекта (см. "Админка"), чтобы писать output_value всегда -- но
-- триггер защищает от рассинхрона (устаревшая вкладка браузера,
-- будущий прямой insert и т.п.): если для output_key='zone'
-- output_value не передан, выводим его из
-- target_task_type/grouping_attribute автоматически, вместо падения
-- на NOT NULL.
create or replace function public.wms_routing_rules_default_output_value()
returns trigger
language plpgsql
as $$
begin
    if new.output_value is null and new.output_key = 'zone' then
        new.output_value := jsonb_build_object(
            'target_task_type', new.target_task_type,
            'grouping_attribute', new.grouping_attribute
        );
    end if;
    return new;
end;
$$;

drop trigger if exists wms_routing_rules_default_output_value on public.wms_routing_rules;
create trigger wms_routing_rules_default_output_value
    before insert or update on public.wms_routing_rules
    for each row
    execute function public.wms_routing_rules_default_output_value();
```

`conditions` (уже существующая колонка, формат не меняется структурно
— jsonb-массив объектов `{attribute, operator, value}`) получает новые
допустимые значения `attribute` и `operator` (см. ниже) — существующие
zone-правила с `attribute: 'status'|'tare_id'`, `operator: 'in'|'eq'`
продолжают работать без изменений.

### `wms_module_settings` — новая таблица

```sql
create table public.wms_module_settings (
    module text not null,
    setting_key text not null,
    value jsonb not null,
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (module, setting_key)
);

grant select, insert, update, delete on public.wms_module_settings to anon, authenticated;
```

Пример будущих строк (заполняются при подключении конкретного модуля,
не в этом подпроекте): `('no_order', 'cheap_row_threshold_rub', '2000')`,
`('packaging', 'due_date_offset_days', '-7')`,
`('presort', 'grouping_field', '"corrugated"')`.

## Условия: новые атрибуты и операторы

Текущий матчер Фазы 1 (`wms_routing_rule_matches(conditions, status, tare_id)`)
**не трогается** — это единственная точка входа, которой сегодня
пользуются уже работающие в проде `wms_apply_routing_rules`,
`wms_compute_reroute_target` (обе из Фазы 1/2a), и ломать её ради
нового функционала — неоправданный риск. Вместо этого — новая,
более общая функция, принимающая произвольный набор атрибутов:

```sql
create or replace function public.wms_rule_conditions_match(p_conditions jsonb, p_attributes jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
    v_cond jsonb;
    v_attr text;
    v_op text;
    v_value jsonb;
    v_actual_text text;
    v_actual_num numeric;
begin
    if p_conditions is null or jsonb_array_length(p_conditions) = 0 then
        return false;
    end if;
    for v_cond in select * from jsonb_array_elements(p_conditions) loop
        v_attr := v_cond->>'attribute';
        v_op := v_cond->>'operator';
        v_value := v_cond->'value';
        v_actual_text := case
            when v_attr = 'status' then substring(p_attributes->>'status' from '[A-Z]{3}')
            else p_attributes->>v_attr
        end;
        if v_op = 'in' then
            if v_actual_text is null or not (v_value ? v_actual_text) then return false; end if;
        elsif v_op = 'eq' then
            if v_actual_text is distinct from (v_value#>>'{}') then return false; end if;
        elsif v_op = 'contains' then
            if v_actual_text is null or position(lower(v_value#>>'{}') in lower(v_actual_text)) = 0 then return false; end if;
        elsif v_op in ('gt', 'gte', 'lt', 'lte') then
            v_actual_num := nullif(v_actual_text, '')::numeric;
            if v_actual_num is null then return false; end if;
            if v_op = 'gt' and not (v_actual_num > (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'gte' and not (v_actual_num >= (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'lt' and not (v_actual_num < (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'lte' and not (v_actual_num <= (v_value#>>'{}')::numeric) then return false; end if;
        elsif v_op = 'between' then
            v_actual_num := nullif(v_actual_text, '')::numeric;
            if v_actual_num is null then return false; end if;
            if not (v_actual_num >= (v_value->>0)::numeric and v_actual_num <= (v_value->>1)::numeric) then return false; end if;
        else
            return false;
        end if;
    end loop;
    return true;
end;
$$;

grant execute on function public.wms_rule_conditions_match(jsonb, jsonb) to anon, authenticated;
```

`p_attributes` — произвольный jsonb-объект вида
`{"status": "...", "tare_id": "...", "price": "1234", "mx": "...", "route_number": "107"}`
— вызывающая сторона кладёт туда всё, что знает про строку; правило
само решает, какие ключи ему нужны. Числовые атрибуты передаются как
текст (jsonb не различает число/текст при `->>'...'`) и приводятся к
`numeric` только операторами сравнения — так `price`/`route_number`
работают единообразно с текстовыми атрибутами вроде `status`/`mx`.

`'in'` для числового атрибута (например, список маршрутов) по-прежнему
работает — сравнение по тексту (`'107' = any(['107','108',...])`),
приведение к числу не требуется, если значения в `value` заданы как
строки. Это сознательное упрощение: админ вводит список маршрутов как
текстовые значения через запятую (как сегодня `wms_routing_rules`
UI уже делает для статусов), числовое сравнение (`gt`/`between`) нужно
только там, где диапазон, а не перечисление.

## API движка

```sql
create or replace function public.wms_evaluate_rule(p_output_key text, p_attributes jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_rule record;
begin
    v_rule := null;
    for v_rule in
        select * from public.wms_routing_rules
        where is_active = true and output_key = p_output_key
        order by priority asc
    loop
        if public.wms_rule_conditions_match(v_rule.conditions, p_attributes) then
            exit;
        end if;
        v_rule := null;
    end loop;

    if v_rule is null then
        return null;
    end if;

    return jsonb_build_object('rule_id', v_rule.id, 'rule_name', v_rule.name, 'output_value', v_rule.output_value);
end;
$$;

grant execute on function public.wms_evaluate_rule(text, jsonb) to anon, authenticated;

create or replace function public.wms_module_setting(p_module text, p_setting_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select value from public.wms_module_settings where module = p_module and setting_key = p_setting_key;
$$;

grant execute on function public.wms_module_setting(text, text) to anon, authenticated;
```

`wms_evaluate_rule` возвращает `null`, если ни одно активное правило
данного `output_key` не подошло — вызывающая сторона (будущий код
подключения модуля) сама решает, что делать: по договорённости этого
брейншторма — строка отбрасывается, администратору показывается
счётчик непокрытых случаев (реализуется в каждом модуле при его
подключении, не здесь).

## Обратная совместимость с Фазой 1/2a

Бэкофилл выше (`output_value` из `target_task_type`/`grouping_attribute`,
`output_key = 'zone'` по умолчанию) не меняет поведение существующих
вызовов `wms_apply_routing_rules`/`wms_compute_reroute_target` — они
по-прежнему читают `target_task_type`/`grouping_attribute` напрямую
(эти колонки остаются), а не через `output_value`/`wms_evaluate_rule`.
Единственное реальное изменение для них — уникальность приоритета
теперь на `(output_key, priority)`, а не глобально на `priority`: их
запросы (`where is_active = true order by priority asc`, без фильтра
по `output_key`) при появлении будущих НЕ-zone правил начнут видеть и
их тоже. Чтобы не полагаться на то, что `wms_routing_rule_matches`
просто никогда не смэтчит чужой `attribute` (работает, но хрупко и
тратит циклы впустую) — оба существующих вызывающих места получают
явный фильтр `output_key = 'zone'`:

```sql
-- wms_apply_routing_rules (Фаза 1/2a, не меняется кроме одной строки
-- условия в запросе к wms_routing_rules):
create or replace function public.wms_apply_routing_rules(p_shks text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_shk text;
    v_active_task_id uuid;
    v_rule record;
    v_status text;
    v_tare_id text;
    v_group_value text;
    v_task_id uuid;
    v_results jsonb := '[]'::jsonb;
begin
    if p_shks is null or array_length(p_shks, 1) is null then
        return v_results;
    end if;

    foreach v_shk in array p_shks loop
        v_active_task_id := null;
        select ti.task_id into v_active_task_id
        from public.wms_task_items ti
        where ti.shk = v_shk and ti.task_status <> 'Завершено'
        limit 1;

        if v_active_task_id is not null then
            perform public.wms_reclassify_active_item(v_active_task_id, v_shk, false);
            continue;
        end if;

        select sc.last_status, sc.last_tare into v_status, v_tare_id
        from public.wms_superset_cache sc
        where sc.wh_id = '50144199' and sc.shk = v_shk;

        v_rule := null;
        for v_rule in
            select * from public.wms_routing_rules
            where is_active = true and output_key = 'zone'
            order by priority asc
        loop
            if public.wms_routing_rule_matches(v_rule.conditions, v_status, v_tare_id) then
                exit;
            end if;
            v_rule := null;
        end loop;

        if v_rule is null then
            continue;
        end if;

        v_group_value := case when v_rule.grouping_attribute = 'tare_id' then v_tare_id else null end;

        v_task_id := null;
        if v_group_value is not null then
            select id into v_task_id
            from public.wms_tasks
            where task_type = v_rule.target_task_type
              and routing_group_key = v_group_value
              and is_deleted = false and task_status <> 'Завершено'
            limit 1;
        end if;

        if v_task_id is null then
            insert into public.wms_tasks (
                source_module, source_table, source_id, source_payload,
                source_shk_ids, task_type, title, task_status, opp_verdict,
                responsibility_zone, tags, routing_group_key, last_seen_at
            ) values (
                'routing_engine', 'manual_absorb',
                'routing:' || v_rule.id || ':' || coalesce(v_group_value, v_shk) || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                jsonb_build_object(
                    'item_name', v_shk,
                    'task_items', jsonb_build_array(jsonb_build_object(
                        'shk', v_shk, 'nm', null, 'name', '', 'price', 0,
                        'status', coalesce(v_status, ''), 'movement', '', 'mx', ''
                    ))
                ),
                array[v_shk], v_rule.target_task_type, 'ШК ' || v_shk, 'Не начато', 'Не выбран',
                'Нет привязки', '[]'::jsonb, v_group_value, now()
            )
            returning id into v_task_id;
        else
            update public.wms_tasks
            set source_payload = jsonb_set(
                    source_payload, '{task_items}',
                    coalesce(source_payload->'task_items', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                        'shk', v_shk, 'nm', null, 'name', '', 'price', 0,
                        'status', coalesce(v_status, ''), 'movement', '', 'mx', ''
                    ))
                ),
                source_shk_ids = coalesce(source_shk_ids, '{}'::text[]) || array[v_shk],
                last_seen_at = now(),
                updated_at = now()
            where id = v_task_id;
        end if;

        insert into public.wms_task_history (task_id, event_type, payload)
        values (v_task_id, 'task_routed_by_rule', jsonb_build_object('shk', v_shk, 'rule_id', v_rule.id, 'rule_name', v_rule.name));

        v_results := v_results || jsonb_build_object('shk', v_shk, 'task_id', v_task_id, 'rule_id', v_rule.id);
    end loop;

    return v_results;
end;
$$;

grant execute on function public.wms_apply_routing_rules(text[]) to anon, authenticated;

-- wms_compute_reroute_target (Фаза 2a, не меняется кроме одной строки
-- условия в запросе к wms_routing_rules):
create or replace function public.wms_compute_reroute_target(
    p_task_id uuid, p_shk text
) returns table(current_zone text, target_zone text, rule_id uuid, rule_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_item_task_type text;
    v_status text;
    v_tare_id text;
    v_rule record;
begin
    select ti.task_type into v_item_task_type
    from public.wms_task_items ti
    where ti.task_id = p_task_id and ti.shk = p_shk and ti.task_status <> 'Завершено';

    if v_item_task_type is null then
        return;
    end if;

    select sc.last_status, sc.last_tare into v_status, v_tare_id
    from public.wms_superset_cache sc
    where sc.wh_id = '50144199' and sc.shk = p_shk;

    v_rule := null;
    for v_rule in
        select * from public.wms_routing_rules
        where is_active = true and output_key = 'zone'
        order by priority asc
    loop
        if public.wms_routing_rule_matches(v_rule.conditions, v_status, v_tare_id) then
            exit;
        end if;
        v_rule := null;
    end loop;

    if v_rule is null then
        return;
    end if;

    if v_rule.target_task_type = v_item_task_type then
        return;
    end if;

    current_zone := v_item_task_type;
    target_zone := v_rule.target_task_type;
    rule_id := v_rule.id;
    rule_name := v_rule.name;
    return next;
end;
$$;

grant execute on function public.wms_compute_reroute_target(uuid, text) to anon, authenticated;
```

Это единственное изменение в уже работающем коде Фазы 1/2a в рамках
этого подпроекта — не меняет сигнатур, не меняет наблюдаемого
поведения (сегодня в таблице только zone-правила, фильтр сейчас
no-op), тестируется тем же живым begin/rollback способом.

## Админка

Существующая модалка правил маршрутизации (`routingRulesModal`,
`tasks.js`) получает выпадающий список `output_key` в каждой строке
(значения: `zone` как сегодня, плюс пока единственный пример второго
типа для проверки механизма — `priority_tier`, чтобы было видно, что
движок реально универсален, без завязки на зоны). Форма одной строки
правила не меняется структурно — условия/приоритет/активность остаются
как есть; поле "целевое значение" становится общим вводом под
`output_value`, где для `output_key = 'zone'` это по-прежнему
`target_task_type` + `grouping_attribute` (записываются в ОБЕ формы —
и в старые колонки для существующих SQL-вызовов Фазы 1/2a, и в
`output_value` для нового движка), а для любого другого `output_key`
— просто единое jsonb-значение (например, для `priority_tier`:
`{"priority": 2, "label": "Высокий"}`). `routingRuleInputRows()`
(`tasks.js`) обновляется, чтобы формировать оба представления при
`output_key = 'zone'`, и только `output_value` иначе — БД-триггер
(выше) остаётся защитной сеткой, а не основным механизмом.

Новая отдельная модалка `moduleSettingsModal` — таблица (модуль,
ключ, значение), тот же паттерн список-строк-с-сохранением-разом, что
`wms_writeoff_terms`/`wms_routing_rules` уже используют.

## Тестирование

Тем же способом, что и весь день: живые `begin/rollback` тесты с
assertion-таблицей на синтетических фикстурах; `node --check` для JS;
без браузерного QA (ограничение всей сессии).

## Риски и компромиссы

- **Движок без единого подключённого модуля** — после этого
  подпроекта ничего в поведении выгрузки не меняется (все 7 модулей
  по-прежнему работают на старом JS-хардкоде). Это сознательно: нужен
  проверенный в проде фундамент до того, как на него переключать живой
  путь записи.
- **`output_value`/`p_attributes` как jsonb без строгой схемы на
  уровне БД** — гибкость ценой отсутствия проверки на вставке (опечатка
  в `attribute`/`output_key` просто не даст правилу сработать, без
  ошибки). Админ увидит эффект как "правило не работает", не как явную
  ошибку валидации — тот же компромисс, что уже принят в Фазе 1 для
  `conditions`.
- **`'in'` на текстовом сравнении для числовых атрибутов** (список
  маршрутов) — упрощение, работает для перечислений, не для
  диапазонов (для диапазонов есть `between`/`gt`/`lt`).
