# Движок настраиваемых параметров выгрузки — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить универсальный движок настраиваемых условий/параметров (расширение `wms_routing_rules` + новая `wms_module_settings`), на который позже (отдельными будущими заходами) переключат 7 модулей ручной выгрузки — без изменения их поведения в этом плане.

**Architecture:** Два типа настроек. Условные правила — расширение уже рабочего `wms_routing_rules` (Фаза 1) с `output_key`/`output_value`, обобщённым матчером `wms_rule_conditions_match` и единой точкой входа `wms_evaluate_rule`. Нестатичные параметры без условий — новая простая key-value таблица `wms_module_settings` + `wms_module_setting()`. Существующий рабочий код Фазы 1/2a (`wms_apply_routing_rules`, `wms_compute_reroute_target`, `wms_routing_rule_matches`) не трогается по существу — получает один маленький, явно выделенный фикс обратной совместимости.

**Tech Stack:** PostgreSQL (plpgsql), Supabase CLI, vanilla JS (`tasks.js`/`tasks.html`).

**Spec:** `docs/superpowers/specs/2026-10-13-wms-upload-settings-engine-design.md`

## Global Constraints

- Миграции в `supabase/migrations/`, имя `202610130NNN_<описание>.sql`. Следующий свободный префикс — `202610130013`.
- Перед КАЖДЫМ `supabase db push --linked` переместить эти 4 файла в `supabase/.migration_holdout/`, затем вернуть обратно сразу после push:
  `202608170001_weeek_manual_wmi_mp_pc_upload.sql`, `202609020005_wms_shifts_roster.sql`, `202609040003_upsert_wms_external_requests_from_json.sql`, `202609040004_upsert_wms_external_requests_source_shk_ids.sql`.
- Каждая миграция тестируется ЖИВЫМ способом ПЕРЕД применением: один плоский `.sql`-файл, обёрнутый в `begin; ... rollback;`, через `supabase db query --linked --file <path>`. Этот инструмент возвращает только результат ПОСЛЕДНЕГО стейтмента и НЕ поддерживает `\i`/`\gset`/`\gexec` — весь SQL одним файлом, побочные эффекты RPC через `create temp table X as select fn(...) as result`. `CREATE TABLE AS` не принимает голый `INSERT ... RETURNING` — только через `with ins as (insert ... returning ...) select * from ins`. В PL/pgSQL никогда не обращайся к полю record-переменной в одном `if` через `OR` с проверкой `is null` — раздельные `if`. Transition tables (`REFERENCING ... TABLE`) нельзя сочетать с `UPDATE OF <колонки>` в одном триггере.
- Тестовые фикстуры — синтетические (`priority` в тестовом диапазоне 90000+, `module`/`setting_key` с префиксом `test_`), не завязанные на реальные ID прод-строк.
- JS проверяется только через `node --check tasks.js` — браузерного QA в сессии нет.
- Каждая задача — отдельный коммит, сообщение на русском, `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, пушится в `main` сразу после применения.
- `wms_routing_rules.priority` сегодня имеет implicit-named unique constraint `wms_routing_rules_priority_key` (из `priority integer not null unique` в исходной миграции `202610130002_wms_routing_rules.sql`) — именно это имя дропается в Task 1.
- Админка правил маршрутизации сегодня делает `db.from("wms_routing_rules").upsert(rows, { onConflict: "priority" })` (`tasks.js`, `saveRoutingRulesFromModal`) — после Task 1 эта строка **обязана** стать `{ onConflict: "output_key,priority" }`, иначе сохранение правил сломается (новый unique index — составной). Это явно часть Task 5, не отдельный баг — зафиксировано здесь, чтобы не забыть.

---

## Task 1: Схема — `wms_routing_rules` расширение + `wms_module_settings`

**Files:**
- Create: `supabase/migrations/202610130013_wms_upload_settings_schema.sql`

**Interfaces:**
- Consumes: существующая таблица `wms_routing_rules` (Фаза 1, `priority integer not null unique`, `target_task_type text not null`).
- Produces: `wms_routing_rules.output_key text not null default 'zone'`, `wms_routing_rules.output_value jsonb not null`; уникальный индекс `wms_routing_rules_output_key_priority_unique (output_key, priority)`; триггер `wms_routing_rules_default_output_value`; новая таблица `public.wms_module_settings(module text, setting_key text, value jsonb not null, updated_at timestamptz, primary key (module, setting_key))`.

- [ ] **Step 1: Написать миграцию**

```sql
-- supabase/migrations/202610130013_wms_upload_settings_schema.sql
--
-- Фаза 2b, подпроект 1 (движок настроек): wms_routing_rules (Фаза 1)
-- расширяется до универсального условного движка -- не только зона,
-- любой тип решения (output_key), с единым output_value вместо
-- жёстко зашитых target_task_type/grouping_attribute. Старые колонки
-- НЕ удаляются -- на них по-прежнему завязан уже работающий в проде
-- код Фазы 1/2a (wms_apply_routing_rules, wms_compute_reroute_target),
-- который в этом подпроекте не меняется по существу (фикс см.
-- 202610130016).

-- target_task_type было NOT NULL (единственный output Фазы 1) --
-- теперь не каждое правило обязано его иметь (например
-- priority_tier-правило его не использует вообще).
alter table public.wms_routing_rules alter column target_task_type drop not null;

alter table public.wms_routing_rules
    add column if not exists output_key text not null default 'zone',
    add column if not exists output_value jsonb;

-- Бэкофилл: все существующие правила Фазы 1 -- это zone-правила;
-- переносим их target_task_type/grouping_attribute в output_value.
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

-- Защитная сетка: если для output_key='zone' output_value не
-- передан (устаревшая вкладка браузера, прямой insert в обход
-- актуального JS), выводим его из target_task_type/grouping_attribute
-- автоматически, вместо падения на NOT NULL.
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

-- Нестатичные параметры модуля без условий (due-date сдвиги,
-- cheap-пороги, поле группировки и т.п.) -- заполняются конкретными
-- значениями при подключении каждого модуля в будущих подпроектах,
-- не здесь.
create table public.wms_module_settings (
    module text not null,
    setting_key text not null,
    value jsonb not null,
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (module, setting_key)
);

grant select, insert, update, delete on public.wms_module_settings to anon, authenticated;
```

- [ ] **Step 2: Живой тест**

```sql
begin;

<MIGRATION SQL from Step 1>

create temp table test_results (test_name text primary key, actual text, expected text);

-- Регрессия: существующее zone-правило Фазы 1 (если есть в проде) не
-- ломается -- проверяем на СИНТЕТИЧЕСКОМ правиле, созданном старым
-- способом (без output_key/output_value, как делает текущий JS).
insert into public.wms_routing_rules (priority, name, is_active, conditions, target_task_type, grouping_attribute)
values (90010, 'settings-engine-test-zone', true, jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('ZZZ'))), 'ПЦ', null)
on conflict (priority) do update set name = excluded.name;

insert into test_results values ('old_js_insert_output_key_default',
  (select output_key from public.wms_routing_rules where priority = 90010),
  'zone');
insert into test_results values ('trigger_backfills_output_value',
  (select (output_value = jsonb_build_object('target_task_type', 'ПЦ', 'grouping_attribute', null::text))::text from public.wms_routing_rules where priority = 90010),
  'true');

-- Новый non-zone тип правила: target_task_type теперь можно оставить null.
insert into public.wms_routing_rules (priority, name, is_active, conditions, output_key, output_value)
values (90011, 'settings-engine-test-tier', true, jsonb_build_array(jsonb_build_object('attribute', 'price', 'operator', 'gte', 'value', '5000')), 'priority_tier', jsonb_build_object('priority', 2, 'label', 'Высокий'));

insert into test_results values ('non_zone_rule_inserted',
  (select count(*)::text from public.wms_routing_rules where priority = 90011 and output_key = 'priority_tier'),
  '1');

-- Составной индекс: одинаковый priority допустим для РАЗНЫХ output_key.
insert into public.wms_routing_rules (priority, name, is_active, conditions, output_key, output_value)
values (90010, 'settings-engine-test-tier-same-priority', true, jsonb_build_array(jsonb_build_object('attribute', 'price', 'operator', 'lt', 'value', '1000')), 'priority_tier', jsonb_build_object('priority', 0, 'label', 'Низкий'));

insert into test_results values ('same_priority_different_output_key_allowed',
  (select count(*)::text from public.wms_routing_rules where priority = 90010),
  '2');

-- wms_module_settings работает.
insert into public.wms_module_settings (module, setting_key, value)
values ('test_module', 'test_key', '"test_value"'::jsonb)
on conflict (module, setting_key) do update set value = excluded.value;

insert into test_results values ('module_settings_roundtrip',
  (select value::text from public.wms_module_settings where module = 'test_module' and setting_key = 'test_key'),
  '"test_value"');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

- [ ] **Step 3: Запустить тест**

Run: `supabase db query --linked --file <путь>`
Expected: все 5 строк (`old_js_insert_output_key_default`, `trigger_backfills_output_value`, `non_zone_rule_inserted`, `same_priority_different_output_key_allowed`, `module_settings_roundtrip`) — `pass = true`.

- [ ] **Step 4: Применить миграцию**

```bash
mkdir -p supabase/.migration_holdout
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql \
   supabase/migrations/202609020005_wms_shifts_roster.sql \
   supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql \
   supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql \
   supabase/.migration_holdout/
supabase db push --linked
mv supabase/.migration_holdout/*.sql supabase/migrations/
```

- [ ] **Step 5: Проверить, что реальные (не тестовые) правила Фазы 1 не пострадали**

```sql
select priority, output_key, (output_value is not null) as has_output_value
from public.wms_routing_rules
order by priority;
```

Run: `supabase db query --linked --file <scratch>.sql`
Expected: у каждой строки `output_key = 'zone'` и `has_output_value = true` (если правил ещё нет — пустой результат, тоже ок).

- [ ] **Step 6: Коммит и пуш**

```bash
git add supabase/migrations/202610130013_wms_upload_settings_schema.sql
git commit -m "$(cat <<'EOF'
Движок настроек (1/6): схема -- output_key/output_value + wms_module_settings

wms_routing_rules (Фаза 1) расширена до универсального условного
движка: output_key (тип решения, по умолчанию 'zone' для обратной
совместимости) + output_value (единый jsonb вместо жёстко зашитых
target_task_type/grouping_attribute). target_task_type стал nullable
(не каждый output_key его использует). Приоритет уникален теперь в
пределах output_key, не глобально. Защитный триггер автозаполняет
output_value из старых колонок для zone-правил, если не передан --
подстраховка от рассинхрона со старой админ-формой.

Новая wms_module_settings -- простые key-value параметры модуля без
условий (due-date сдвиги, пороги и т.п.), заполняется позже при
подключении конкретных модулей.

Ничего в поведении Фазы 1/2a не меняется -- старые колонки и
вызывающий их код нетронуты (фикс обратной совместимости см. задачу
4/6). Проверено живым begin/rollback (5/5 pass).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 2: `wms_rule_conditions_match` — обобщённый матчер

**Files:**
- Create: `supabase/migrations/202610130014_wms_rule_conditions_match.sql`

**Interfaces:**
- Consumes: ничего нового (чистая функция).
- Produces: `public.wms_rule_conditions_match(p_conditions jsonb, p_attributes jsonb) returns boolean`. Используется в Task 3 (`wms_evaluate_rule`).

- [ ] **Step 1: Написать миграцию**

```sql
-- supabase/migrations/202610130014_wms_rule_conditions_match.sql
--
-- Обобщённая версия wms_routing_rule_matches (Фаза 1) -- та функция
-- НЕ трогается (её вызывают уже работающие wms_apply_routing_rules/
-- wms_compute_reroute_target с фиксированными p_status/p_tare_id).
-- Эта новая функция принимает произвольный набор атрибутов, нужна
-- для любого output_key, не только зоны.
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
            if v_actual_text is null or v_actual_text !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
            v_actual_num := v_actual_text::numeric;
            if v_op = 'gt' and not (v_actual_num > (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'gte' and not (v_actual_num >= (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'lt' and not (v_actual_num < (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'lte' and not (v_actual_num <= (v_value#>>'{}')::numeric) then return false; end if;
        elsif v_op = 'between' then
            if v_actual_text is null or v_actual_text !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
            v_actual_num := v_actual_text::numeric;
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

- [ ] **Step 2: Живой тест**

```sql
begin;

<MIGRATION SQL from Step 1, без grant>

create temp table test_results (test_name text primary key, actual text, expected text);

-- status: та же 3-буквенная экстракция, что и в wms_routing_rule_matches.
insert into test_results values ('status_in_match',
  (public.wms_rule_conditions_match(
    jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('SGR'))),
    jsonb_build_object('status', 'SGR: тестовый статус')
  ))::text,
  'true');
insert into test_results values ('status_in_no_match',
  (public.wms_rule_conditions_match(
    jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('SGR'))),
    jsonb_build_object('status', 'ABC: другой статус')
  ))::text,
  'false');

-- eq
insert into test_results values ('eq_match',
  (public.wms_rule_conditions_match(
    jsonb_build_array(jsonb_build_object('attribute', 'tare_id', 'operator', 'eq', 'value', '12345')),
    jsonb_build_object('tare_id', '12345')
  ))::text,
  'true');

-- contains (mx substring, регистронезависимо)
insert into test_results values ('contains_match_case_insensitive',
  (public.wms_rule_conditions_match(
    jsonb_build_array(jsonb_build_object('attribute', 'mx', 'operator', 'contains', 'value', 'буфер')),
    jsonb_build_object('mx', 'Общий БУФЕР мультиотгрузки')
  ))::text,
  'true');

-- gt/gte/lt/lte (price)
insert into test_results values ('gte_match',
  (public.wms_rule_conditions_match(
    jsonb_build_array(jsonb_build_object('attribute', 'price', 'operator', 'gte', 'value', '5000')),
    jsonb_build_object('price', '5000')
  ))::text,
  'true');
insert into test_results values ('lt_no_match',
  (public.wms_rule_conditions_match(
    jsonb_build_array(jsonb_build_object('attribute', 'price', 'operator', 'lt', 'value', '1000')),
    jsonb_build_object('price', '1000')
  ))::text,
  'false');

-- between (route_number диапазон)
insert into test_results values ('between_match',
  (public.wms_rule_conditions_match(
    jsonb_build_array(jsonb_build_object('attribute', 'route_number', 'operator', 'between', 'value', jsonb_build_array(101, 115))),
    jsonb_build_object('route_number', '107')
  ))::text,
  'true');
insert into test_results values ('between_no_match_outside_range',
  (public.wms_rule_conditions_match(
    jsonb_build_array(jsonb_build_object('attribute', 'route_number', 'operator', 'between', 'value', jsonb_build_array(101, 115))),
    jsonb_build_object('route_number', '200')
  ))::text,
  'false');

-- несколько условий -- все должны совпасть (AND)
insert into test_results values ('multi_condition_and',
  (public.wms_rule_conditions_match(
    jsonb_build_array(
      jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('GWS')),
      jsonb_build_object('attribute', 'mx', 'operator', 'contains', 'value', 'сортировка в сетки')
    ),
    jsonb_build_object('status', 'GWS: статус', 'mx', 'Сортировка в сетки №3')
  ))::text,
  'true');

-- пустые условия -- никогда не матчит (как и в Фазе 1 wms_routing_rule_matches).
insert into test_results values ('empty_conditions_never_match',
  (public.wms_rule_conditions_match('[]'::jsonb, jsonb_build_object('status', 'SGR')))::text,
  'false');

-- числовой оператор с нечисловым фактическим значением -- false, не падает.
insert into test_results values ('numeric_op_on_non_numeric_no_crash',
  (public.wms_rule_conditions_match(
    jsonb_build_array(jsonb_build_object('attribute', 'price', 'operator', 'gte', 'value', '100')),
    jsonb_build_object('price', 'не число')
  ))::text,
  'false');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

- [ ] **Step 3: Запустить тест**

Run: `supabase db query --linked --file <путь>`
Expected: все 11 строк `pass = true`.

- [ ] **Step 4: Применить миграцию** (holdout-процедура как в Task 1 Step 4)

- [ ] **Step 5: Коммит и пуш**

```bash
git add supabase/migrations/202610130014_wms_rule_conditions_match.sql
git commit -m "$(cat <<'EOF'
Движок настроек (2/6): обобщённый матчер условий

wms_rule_conditions_match(conditions, attributes) -- обобщение
wms_routing_rule_matches (Фаза 1, не трогается) на произвольный набор
атрибутов вместо фиксированных status/tare_id. Новые операторы:
contains (регистронезависимый substring), gt/gte/lt/lte/between
(числовое сравнение, для price/route_number и подобного) вдобавок к
in/eq. status сохраняет ту же 3-буквенную экстракцию, что и раньше.

Проверено живым begin/rollback (11/11 pass, включая пустые условия и
числовой оператор на нечисловом значении -- не падает, просто false).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 3: API движка — `wms_evaluate_rule` + `wms_module_setting`

**Files:**
- Create: `supabase/migrations/202610130015_wms_evaluate_rule.sql`

**Interfaces:**
- Consumes: `public.wms_rule_conditions_match(jsonb, jsonb)` (Task 2), таблицы `wms_routing_rules` (Task 1), `wms_module_settings` (Task 1).
- Produces: `public.wms_evaluate_rule(p_output_key text, p_attributes jsonb) returns jsonb`; `public.wms_module_setting(p_module text, p_setting_key text) returns jsonb`. Это конечные точки входа для будущих подпроектов (подключение модулей).

- [ ] **Step 1: Написать миграцию**

```sql
-- supabase/migrations/202610130015_wms_evaluate_rule.sql
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

- [ ] **Step 2: Живой тест**

```sql
begin;

<MIGRATION SQL from Step 1, без grant>

create temp table test_results (test_name text primary key, actual text, expected text);

insert into public.wms_routing_rules (priority, name, is_active, conditions, output_key, output_value)
values
  (90020, 'evaluate-test-high', true, jsonb_build_array(jsonb_build_object('attribute', 'price', 'operator', 'gte', 'value', '5000')), 'priority_tier', jsonb_build_object('priority', 2, 'label', 'Высокий')),
  (90021, 'evaluate-test-low', true, jsonb_build_array(jsonb_build_object('attribute', 'price', 'operator', 'lt', 'value', '5000')), 'priority_tier', jsonb_build_object('priority', 0, 'label', 'Низкий')),
  (90022, 'evaluate-test-inactive-only', false, jsonb_build_array(jsonb_build_object('attribute', 'price', 'operator', 'gte', 'value', '0')), 'inactive_test_key', jsonb_build_object('priority', 99, 'label', 'Не должно сработать'));

create temp table eval_high as
select public.wms_evaluate_rule('priority_tier', jsonb_build_object('price', '9000')) as result;

insert into test_results values ('evaluate_finds_matching_rule',
  (select result->'output_value'->>'label' from eval_high),
  'Высокий');
insert into test_results values ('evaluate_returns_rule_name',
  (select result->>'rule_name' from eval_high),
  'evaluate-test-high');

create temp table eval_low as
select public.wms_evaluate_rule('priority_tier', jsonb_build_object('price', '100')) as result;

insert into test_results values ('evaluate_picks_lower_priority_rule_when_first_does_not_match',
  (select result->'output_value'->>'label' from eval_low),
  'Низкий');

create temp table eval_none as
select public.wms_evaluate_rule('no_such_output_key', jsonb_build_object('price', '100')) as result;

insert into test_results values ('evaluate_returns_null_when_output_key_unknown',
  (select (result is null)::text from eval_none),
  'true');

create temp table eval_inactive as
select public.wms_evaluate_rule('inactive_test_key', jsonb_build_object('price', '100')) as result;

insert into test_results values ('evaluate_skips_inactive_rules',
  (select (result is null)::text from eval_inactive),
  'true');

insert into public.wms_module_settings (module, setting_key, value)
values ('test_module', 'cheap_row_threshold_rub', '2000');

insert into test_results values ('module_setting_lookup',
  (select public.wms_module_setting('test_module', 'cheap_row_threshold_rub'))::text,
  '2000');
insert into test_results values ('module_setting_missing_returns_null',
  (select (public.wms_module_setting('test_module', 'no_such_key') is null)::text),
  'true');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

- [ ] **Step 3: Запустить тест**

Run: `supabase db query --linked --file <путь>`
Expected: все 7 строк `pass = true`.

- [ ] **Step 4: Применить миграцию** (holdout-процедура)

- [ ] **Step 5: Коммит и пуш**

```bash
git add supabase/migrations/202610130015_wms_evaluate_rule.sql
git commit -m "$(cat <<'EOF'
Движок настроек (3/6): API -- wms_evaluate_rule + wms_module_setting

Единая точка входа для будущих подпроектов (подключение 7 модулей
выгрузки): wms_evaluate_rule(output_key, attributes) находит первое
подходящее активное правило данного типа по приоритету и возвращает
его output_value, или null если ничего не подошло (вызывающая сторона
сама решает, что делать с непокрытым случаем). wms_module_setting --
простой lookup параметра модуля.

Проверено живым begin/rollback (7/7 pass, включая неактивные правила
и несуществующий output_key/setting_key -- null, не ошибка).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 4: Обратная совместимость — Фаза 1/2a фильтрует `output_key='zone'`

**Files:**
- Create: `supabase/migrations/202610130016_wms_routing_rules_zone_filter.sql`

**Interfaces:**
- Consumes: колонка `output_key` (Task 1).
- Produces: те же сигнатуры `wms_apply_routing_rules(text[])` и `wms_compute_reroute_target(uuid, text)` — поведение не меняется для существующих данных, только защита от будущих не-zone правил.

- [ ] **Step 1: Написать миграцию**

```sql
-- supabase/migrations/202610130016_wms_routing_rules_zone_filter.sql
--
-- Движок настроек (Task 1) сделал приоритет уникальным в пределах
-- output_key, а не глобально -- значит в таблице скоро появятся
-- правила других output_key (priority_tier и т.п.), которых текущие
-- Фаза 1/2a функции раньше не ожидали видеть вообще. Сегодня
-- wms_routing_rule_matches просто никогда не смэтчит их (неизвестный
-- atribute -> null -> false) -- не падает, но тратит циклы и хрупко.
-- Явный фильтр output_key = 'zone' -- единственное изменение, больше
-- ничего в этих функциях не меняется.
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

- [ ] **Step 2: Живой тест**

```sql
begin;

<MIGRATION SQL from Step 1, без grant>

create temp table test_results (test_name text primary key, actual text, expected text);

-- non-zone правило с ТЕМ ЖЕ priority, что и у zone-правила ниже --
-- не должно мешать zone-пути (составной индекс это уже разрешает,
-- здесь проверяем именно поведение функций).
insert into public.wms_routing_rules (priority, name, is_active, conditions, output_key, output_value)
values (90030, 'zone-filter-test-tier', true, jsonb_build_array(jsonb_build_object('attribute', 'price', 'operator', 'gte', 'value', '0')), 'priority_tier', jsonb_build_object('priority', 1));

insert into public.wms_routing_rules (priority, name, is_active, conditions, target_task_type, grouping_attribute)
values (90030, 'zone-filter-test-zone', true, jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('ZFT'))), 'ПЦ', null);

insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
values ('50144199', '90030000001', 'ZFT: тест', null)
on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

create temp table apply_result as
select public.wms_apply_routing_rules(array['90030000001']) as result;

insert into test_results values ('orphan_routed_to_zone_rule_not_tier',
  (select task_type from public.wms_tasks where source_module = 'routing_engine' and '90030000001' = any(source_shk_ids)),
  'ПЦ');

-- wms_compute_reroute_target тоже игнорирует non-zone правила.
create temp table active_task as
with ins as (
  insert into public.wms_tasks (
      source_module, source_table, source_id, source_payload,
      source_shk_ids, task_type, title, task_status, opp_verdict,
      responsibility_zone, tags, last_seen_at
  ) values (
      'phase2a_test', 'manual_xlsx', 'zone-filter-t2', jsonb_build_object(
          'task_items', jsonb_build_array(jsonb_build_object(
              'shk', '90030000002', 'nm', null, 'name', 't', 'price', 0,
              'status', '', 'movement', '', 'mx', ''
          ))
      ),
      array['90030000002'], 'Маркетплейс', 'Zone filter test 2', 'Отложено', 'Не выбран',
      'Нет привязки', '[]'::jsonb, now()
  ) returning id
)
select * from ins;

insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
values ('50144199', '90030000002', 'ZFT: тест', null)
on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

create temp table compute_result as
select * from public.wms_compute_reroute_target((select id from active_task), '90030000002');

insert into test_results values ('reroute_target_is_zone_not_tier',
  (select target_zone from compute_result),
  'ПЦ');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

- [ ] **Step 3: Запустить тест**

Run: `supabase db query --linked --file <путь>`
Expected: обе строки `pass = true`.

- [ ] **Step 4: Применить миграцию** (holdout-процедура)

- [ ] **Step 5: Коммит и пуш**

```bash
git add supabase/migrations/202610130016_wms_routing_rules_zone_filter.sql
git commit -m "$(cat <<'EOF'
Движок настроек (4/6): обратная совместимость -- Фаза 1/2a фильтрует output_key='zone'

wms_apply_routing_rules и wms_compute_reroute_target (обе уже в
проде) теперь явно фильтруют output_key='zone' при выборе правил --
единственное изменение, поведение для существующих zone-правил не
меняется. Защита от будущих не-zone правил (priority_tier и т.п.),
которые с этой задачи физически могут появиться в той же таблице с
тем же приоритетом (составной индекс Task 1 это разрешает).

Проверено живым begin/rollback (2/2 pass): non-zone и zone-правило с
одинаковым priority сосуществуют, оба существующих вызывающих пути
видят только своё.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 5: JS — `output_key` в модалке правил маршрутизации

**Files:**
- Modify: `tasks.js` (`routingRuleRowHtml` ~12221, `renderRoutingRulesModal` ~12251, `addRoutingRuleDraft` ~12282, `routingRuleInputRows` ~12296, `saveRoutingRulesFromModal` ~12351)

**Interfaces:**
- Consumes: `output_key`/`output_value` колонки (Task 1), таблица `wms_routing_rules`.
- Produces: админ может выбрать `output_key` для правила; для `zone` по-прежнему виден прежний UI (атрибут/оператор/значение/зона/группировка), для любого другого `output_key` — то же самое, но без селектора зоны/группировки (они относятся только к zone-семантике); сохранение пишет оба представления для zone (старые колонки + `output_value`) и только `output_value` для остальных.

- [ ] **Step 1: Добавить селектор `output_key` в `routingRuleRowHtml`**

Найти (`tasks.js`, текущая точная строка):

```js
    function routingRuleRowHtml(row) {
        const condition = (row.conditions && row.conditions[0]) || {};
        const attribute = condition.attribute || "status";
        const operator = condition.operator || "in";
        const valueText = Array.isArray(condition.value) ? condition.value.join(", ") : normalizeText(condition.value);
        const targetOptions = REVIEW_SECTIONS.map((section) =>
            "<option value='" + escapeHtml(section) + "'" + (row.target_task_type === section ? " selected" : "") + ">" + escapeHtml(section) + "</option>"
        ).join("");
        return "<div class='writeoff-term-row' data-routing-rule-row data-rule-id='" + escapeHtml(row.id || "") + "'>"
            + "<input data-rule-priority type='number' min='1' step='1' value='" + escapeHtml(row.priority || "") + "' placeholder='Приоритет'>"
            + "<input data-rule-name type='text' value='" + escapeHtml(row.name || "") + "' placeholder='Название'>"
            + "<select data-rule-attribute>"
            + "<option value='status'" + (attribute === "status" ? " selected" : "") + ">Статус</option>"
            + "<option value='tare_id'" + (attribute === "tare_id" ? " selected" : "") + ">Тара</option>"
            + "</select>"
            + "<select data-rule-operator>"
            + "<option value='in'" + (operator === "in" ? " selected" : "") + ">один из (через запятую)</option>"
            + "<option value='eq'" + (operator === "eq" ? " selected" : "") + ">равно</option>"
            + "</select>"
            + "<input data-rule-value type='text' value='" + escapeHtml(valueText) + "' placeholder='Значение(я)'>"
            + "<select data-rule-target>" + targetOptions + "</select>"
            + "<select data-rule-grouping>"
            + "<option value=''" + (!row.grouping_attribute ? " selected" : "") + ">Каждый ШК отдельно</option>"
            + "<option value='tare_id'" + (row.grouping_attribute === "tare_id" ? " selected" : "") + ">По таре</option>"
            + "</select>"
            + "<label class='writeoff-term-active'><input data-rule-active type='checkbox' " + (row.is_active === false ? "" : "checked") + "> активно</label>"
            + "<button type='button' class='btn btn-square' data-rule-remove aria-label='Удалить'>×</button>"
            + "</div>";
    }
```

Заменить на (добавлен `<select data-rule-output-key>` сразу после названия; для `zone` зона/группировка видны как раньше, для прочих `output_key` — поле `output_value` как свободный JSON-текст, т.к. его форма зависит от конкретного типа решения и в этом подпроекте нет собственного UI под каждый будущий `output_key`):

```js
    function routingRuleRowHtml(row) {
        const condition = (row.conditions && row.conditions[0]) || {};
        const attribute = condition.attribute || "status";
        const operator = condition.operator || "in";
        const valueText = Array.isArray(condition.value) ? condition.value.join(", ") : normalizeText(condition.value);
        const outputKey = row.output_key || "zone";
        const isZone = outputKey === "zone";
        const targetOptions = REVIEW_SECTIONS.map((section) =>
            "<option value='" + escapeHtml(section) + "'" + (row.target_task_type === section ? " selected" : "") + ">" + escapeHtml(section) + "</option>"
        ).join("");
        const outputValueText = isZone ? "" : JSON.stringify(row.output_value !== undefined ? row.output_value : {});
        return "<div class='writeoff-term-row' data-routing-rule-row data-rule-id='" + escapeHtml(row.id || "") + "'>"
            + "<input data-rule-priority type='number' min='1' step='1' value='" + escapeHtml(row.priority || "") + "' placeholder='Приоритет'>"
            + "<input data-rule-name type='text' value='" + escapeHtml(row.name || "") + "' placeholder='Название'>"
            + "<select data-rule-output-key>"
            + "<option value='zone'" + (isZone ? " selected" : "") + ">Зона</option>"
            + "<option value='priority_tier'" + (outputKey === "priority_tier" ? " selected" : "") + ">Приоритет по цене</option>"
            + "</select>"
            + "<select data-rule-attribute>"
            + "<option value='status'" + (attribute === "status" ? " selected" : "") + ">Статус</option>"
            + "<option value='tare_id'" + (attribute === "tare_id" ? " selected" : "") + ">Тара</option>"
            + "<option value='price'" + (attribute === "price" ? " selected" : "") + ">Цена</option>"
            + "<option value='mx'" + (attribute === "mx" ? " selected" : "") + ">МХ</option>"
            + "<option value='route_number'" + (attribute === "route_number" ? " selected" : "") + ">Номер маршрута</option>"
            + "</select>"
            + "<select data-rule-operator>"
            + "<option value='in'" + (operator === "in" ? " selected" : "") + ">один из (через запятую)</option>"
            + "<option value='eq'" + (operator === "eq" ? " selected" : "") + ">равно</option>"
            + "<option value='contains'" + (operator === "contains" ? " selected" : "") + ">содержит</option>"
            + "<option value='gt'" + (operator === "gt" ? " selected" : "") + ">больше</option>"
            + "<option value='gte'" + (operator === "gte" ? " selected" : "") + ">больше или равно</option>"
            + "<option value='lt'" + (operator === "lt" ? " selected" : "") + ">меньше</option>"
            + "<option value='lte'" + (operator === "lte" ? " selected" : "") + ">меньше или равно</option>"
            + "<option value='between'" + (operator === "between" ? " selected" : "") + ">между (через запятую)</option>"
            + "</select>"
            + "<input data-rule-value type='text' value='" + escapeHtml(valueText) + "' placeholder='Значение(я)'>"
            + "<select data-rule-target" + (isZone ? "" : " style='display:none'") + ">" + targetOptions + "</select>"
            + "<select data-rule-grouping" + (isZone ? "" : " style='display:none'") + ">"
            + "<option value=''" + (!row.grouping_attribute ? " selected" : "") + ">Каждый ШК отдельно</option>"
            + "<option value='tare_id'" + (row.grouping_attribute === "tare_id" ? " selected" : "") + ">По таре</option>"
            + "</select>"
            + "<input data-rule-output-value type='text' value='" + escapeHtml(outputValueText) + "' placeholder='output_value (JSON)'" + (isZone ? " style='display:none'" : "") + ">"
            + "<label class='writeoff-term-active'><input data-rule-active type='checkbox' " + (row.is_active === false ? "" : "checked") + "> активно</label>"
            + "<button type='button' class='btn btn-square' data-rule-remove aria-label='Удалить'>×</button>"
            + "</div>";
    }
```

- [ ] **Step 2: Обновить заголовок таблицы в `renderRoutingRulesModal`**

Найти:

```js
            + "<div class='writeoff-term-head'><span>Приоритет</span><span>Название</span><span>Атрибут</span><span>Оператор</span><span>Значение</span><span>Зона</span><span>Группировка</span><span>Вкл.</span></div>"
```

Заменить на:

```js
            + "<div class='writeoff-term-head'><span>Приоритет</span><span>Название</span><span>Тип</span><span>Атрибут</span><span>Оператор</span><span>Значение</span><span>Зона</span><span>Группировка</span><span>Результат (JSON)</span><span>Вкл.</span></div>"
```

- [ ] **Step 3: `addRoutingRuleDraft` — новый черновик по умолчанию остаётся zone**

Найти:

```js
    function addRoutingRuleDraft() {
        const rows = state.routingRules.rows || [];
        const nextPriority = rows.reduce((max, row) => Math.max(max, Number(row.priority) || 0), 0) + 1;
        state.routingRules.rows = rows.concat({
            priority: nextPriority,
            name: "",
            is_active: true,
            conditions: [{ attribute: "status", operator: "in", value: [] }],
            target_task_type: REVIEW_SECTIONS[0],
            grouping_attribute: null,
        });
        renderRoutingRulesModal();
    }
```

Заменить на (добавлено `output_key: "zone"`; `nextPriority` теперь считается в пределах zone, т.к. у других `output_key` своя независимая очередь приоритетов и общий максимум по всем строкам модалки был бы неверным для них — но поскольку в этом подпроекте UI показывает все правила вперемешку одним списком, простейший безопасный вариант — максимум по всем строкам НЕЗАВИСИМО от output_key; коллизия по `(output_key, priority)` обнаружится при сохранении через upsert и будет видна как перезапись, не поломка):

```js
    function addRoutingRuleDraft() {
        const rows = state.routingRules.rows || [];
        const nextPriority = rows.reduce((max, row) => Math.max(max, Number(row.priority) || 0), 0) + 1;
        state.routingRules.rows = rows.concat({
            priority: nextPriority,
            name: "",
            is_active: true,
            conditions: [{ attribute: "status", operator: "in", value: [] }],
            output_key: "zone",
            target_task_type: REVIEW_SECTIONS[0],
            grouping_attribute: null,
            output_value: null,
        });
        renderRoutingRulesModal();
    }
```

- [ ] **Step 4: `routingRuleInputRows` — читать `output_key`/`output_value` из формы**

Найти:

```js
    function routingRuleInputRows() {
        return Array.from(document.querySelectorAll("[data-routing-rule-row]")).map((row) => {
            const id = row.getAttribute("data-rule-id") || undefined;
            const priority = Math.max(1, Math.trunc(settingNumber(row.querySelector("[data-rule-priority]") && row.querySelector("[data-rule-priority]").value, 0)));
            const name = normalizeText(row.querySelector("[data-rule-name]") && row.querySelector("[data-rule-name]").value);
            const attribute = row.querySelector("[data-rule-attribute]").value;
            const operator = row.querySelector("[data-rule-operator]").value;
            const rawValue = normalizeText(row.querySelector("[data-rule-value]") && row.querySelector("[data-rule-value]").value);
            const value = operator === "in" ? rawValue.split(",").map((part) => part.trim()).filter(Boolean) : rawValue;
            const targetTaskType = row.querySelector("[data-rule-target]").value;
            const groupingAttribute = row.querySelector("[data-rule-grouping]").value || null;
            const isActive = row.querySelector("[data-rule-active]").checked;
            if (!name || !rawValue) return null;
            return {
                ...(id ? { id } : {}),
                priority,
                name,
                is_active: isActive,
                conditions: [{ attribute, operator, value }],
                target_task_type: targetTaskType,
                grouping_attribute: groupingAttribute,
                updated_at: new Date().toISOString(),
            };
        }).filter(Boolean);
    }
```

Заменить на (списки-операторы `in`/`between` читаются как массив через запятую, остальное — текст; для `zone` пишутся И старые колонки, И `output_value`, чтобы `wms_apply_routing_rules`/`wms_compute_reroute_target` (которые читают старые колонки напрямую) и `wms_evaluate_rule` (который читает `output_value`) видели согласованные данные; для прочих `output_key` — `output_value` парсится из текстового JSON-поля, `target_task_type`/`grouping_attribute` остаются `null`):

```js
    function routingRuleInputRows() {
        return Array.from(document.querySelectorAll("[data-routing-rule-row]")).map((row) => {
            const id = row.getAttribute("data-rule-id") || undefined;
            const priority = Math.max(1, Math.trunc(settingNumber(row.querySelector("[data-rule-priority]") && row.querySelector("[data-rule-priority]").value, 0)));
            const name = normalizeText(row.querySelector("[data-rule-name]") && row.querySelector("[data-rule-name]").value);
            const outputKey = (row.querySelector("[data-rule-output-key]") && row.querySelector("[data-rule-output-key]").value) || "zone";
            const attribute = row.querySelector("[data-rule-attribute]").value;
            const operator = row.querySelector("[data-rule-operator]").value;
            const rawValue = normalizeText(row.querySelector("[data-rule-value]") && row.querySelector("[data-rule-value]").value);
            const value = (operator === "in" || operator === "between")
                ? rawValue.split(",").map((part) => part.trim()).filter(Boolean)
                : rawValue;
            const isActive = row.querySelector("[data-rule-active]").checked;
            if (!name || !rawValue) return null;
            const base = {
                ...(id ? { id } : {}),
                priority,
                name,
                is_active: isActive,
                conditions: [{ attribute, operator, value }],
                output_key: outputKey,
                updated_at: new Date().toISOString(),
            };
            if (outputKey === "zone") {
                const targetTaskType = row.querySelector("[data-rule-target]").value;
                const groupingAttribute = row.querySelector("[data-rule-grouping]").value || null;
                return {
                    ...base,
                    target_task_type: targetTaskType,
                    grouping_attribute: groupingAttribute,
                    output_value: { target_task_type: targetTaskType, grouping_attribute: groupingAttribute },
                };
            }
            const rawOutputValue = normalizeText(row.querySelector("[data-rule-output-value]") && row.querySelector("[data-rule-output-value]").value);
            let outputValue;
            try {
                outputValue = rawOutputValue ? JSON.parse(rawOutputValue) : {};
            } catch (error) {
                outputValue = {};
            }
            return {
                ...base,
                target_task_type: null,
                grouping_attribute: null,
                output_value: outputValue,
            };
        }).filter(Boolean);
    }
```

- [ ] **Step 5: `saveRoutingRulesFromModal` — `onConflict` на составной индекс**

Найти:

```js
            const { error } = await db.from("wms_routing_rules").upsert(rows, { onConflict: "priority" });
```

Заменить на:

```js
            const { error } = await db.from("wms_routing_rules").upsert(rows, { onConflict: "output_key,priority" });
```

- [ ] **Step 6: Проверить синтаксис**

Run: `node --check tasks.js`
Expected: без вывода.

- [ ] **Step 7: Коммит и пуш**

```bash
git add tasks.js
git commit -m "$(cat <<'EOF'
Движок настроек (5/6): output_key в модалке правил маршрутизации

routingRuleRowHtml получил селектор output_key (zone/priority_tier),
новые атрибуты условий (price/mx/route_number) и операторы
(contains/gt/gte/lt/lte/between) в выпадающих списках. Для zone
UI/данные не изменились по сути (зона+группировка видны как раньше);
для остальных output_key поле "Результат (JSON)" заменяет
зону/группировку. routingRuleInputRows пишет ОБА представления для
zone (старые колонки target_task_type/grouping_attribute -- для уже
работающих wms_apply_routing_rules/wms_compute_reroute_target --
плюс output_value -- для wms_evaluate_rule), и только output_value
для прочих output_key.

saveRoutingRulesFromModal: onConflict исправлен на составной индекс
"output_key,priority" (Task 1 сменил уникальность приоритета с
глобальной на составную) -- без этого сохранение правил сломалось бы
сразу после Task 1.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 6: JS — новая модалка `moduleSettingsModal`

**Files:**
- Modify: `tasks.js` (добавить `state.moduleSettings`, функции `loadModuleSettings`/`moduleSettingRowHtml`/`renderModuleSettingsModal`/`removeModuleSettingRow`/`addModuleSettingDraft`/`moduleSettingInputRows`/`openModuleSettingsModal`/`closeModuleSettingsModal`/`saveModuleSettingsFromModal` — по образцу уже прочитанных `routingRules*`-функций; добавить слушатели событий и кнопку рядом с существующими)
- Modify: `tasks.html` (новая кнопка-карточка + новая секция модалки, по образцу `routingRulesModal`)

**Interfaces:**
- Consumes: таблица `wms_module_settings` (Task 1).
- Produces: админ может через интерфейс видеть/добавлять/удалять/редактировать пары (модуль, ключ, значение). Ничего не читает эти значения автоматически (это будет в будущих подпроектах подключения модулей) — модалка сама по себе самодостаточна и тестируема.

- [ ] **Step 1: `state.moduleSettings` — рядом с `state.routingRules`**

Найти (`tasks.js`, точная текущая строка 533-539):

```js
        routingRules: {
            rows: [],
            loading: false,
            saving: false,
            loaded: false,
            error: "",
        },
```

Заменить на (добавлен `moduleSettings` сразу после):

```js
        routingRules: {
            rows: [],
            loading: false,
            saving: false,
            loaded: false,
            error: "",
        },
        moduleSettings: {
            rows: [],
            loading: false,
            saving: false,
            loaded: false,
            error: "",
        },
```

- [ ] **Step 2: Функции модалки — добавить сразу после `saveRoutingRulesFromModal`**

Найти конец `saveRoutingRulesFromModal` (точная текущая строка 12379):

```js
        } finally {
            state.routingRules.saving = false;
            if (button) button.disabled = false;
        }
    }

    async function loadWriteoffTerms(force) {
```

Заменить на (вставлены новые функции между ними, `loadWriteoffTerms` не трогается):

```js
        } finally {
            state.routingRules.saving = false;
            if (button) button.disabled = false;
        }
    }

    async function loadModuleSettings(force) {
        if (state.moduleSettings.loaded && !force) return true;
        const db = supabaseDb();
        state.moduleSettings.loading = true;
        state.moduleSettings.error = "";
        renderModuleSettingsModal();
        if (!db) {
            state.moduleSettings.loading = false;
            state.moduleSettings.error = "Supabase SDK недоступен.";
            renderModuleSettingsModal();
            return false;
        }
        try {
            const { data, error } = await db
                .from("wms_module_settings")
                .select("*")
                .order("module", { ascending: true })
                .order("setting_key", { ascending: true });
            if (error) throw error;
            state.moduleSettings.rows = data || [];
            state.moduleSettings.loaded = true;
            return true;
        } catch (error) {
            state.moduleSettings.rows = [];
            state.moduleSettings.error = "Не удалось загрузить параметры: " + (error && error.message ? error.message : String(error));
            console.warn("module settings load skipped:", error);
            return false;
        } finally {
            state.moduleSettings.loading = false;
            renderModuleSettingsModal();
        }
    }

    function moduleSettingRowHtml(row) {
        const valueText = row.value !== undefined && row.value !== null ? JSON.stringify(row.value) : "";
        return "<div class='writeoff-term-row' data-module-setting-row data-setting-module='" + escapeHtml(row.module || "") + "' data-setting-key-original='" + escapeHtml(row.setting_key || "") + "'>"
            + "<input data-setting-module type='text' value='" + escapeHtml(row.module || "") + "' placeholder='Модуль'>"
            + "<input data-setting-key type='text' value='" + escapeHtml(row.setting_key || "") + "' placeholder='Ключ'>"
            + "<input data-setting-value type='text' value='" + escapeHtml(valueText) + "' placeholder='Значение (JSON)'>"
            + "<button type='button' class='btn btn-square' data-setting-remove aria-label='Удалить'>×</button>"
            + "</div>";
    }

    function renderModuleSettingsModal() {
        const target = $("moduleSettingsWrap");
        if (!target) return;
        const rows = state.moduleSettings.rows || [];
        target.innerHTML = (state.moduleSettings.error ? "<div class='status-line error'>" + escapeHtml(state.moduleSettings.error) + "</div>" : "")
            + (state.moduleSettings.loading ? "<div class='status-line'>Загружаю параметры...</div>" : "")
            + "<div class='writeoff-term-head'><span>Модуль</span><span>Ключ</span><span>Значение (JSON)</span></div>"
            + "<div class='writeoff-term-list'>" + rows.map(moduleSettingRowHtml).join("") + "</div>";
        target.querySelectorAll("[data-setting-remove]").forEach((button) => {
            button.addEventListener("click", () => removeModuleSettingRow(button.closest("[data-module-setting-row]")));
        });
    }

    async function removeModuleSettingRow(rowEl) {
        if (!rowEl) return;
        const module = rowEl.getAttribute("data-setting-module");
        const settingKey = rowEl.getAttribute("data-setting-key-original");
        if (module && settingKey) {
            const db = supabaseDb();
            if (db) {
                try {
                    const { error } = await db.from("wms_module_settings").delete().eq("module", module).eq("setting_key", settingKey);
                    if (error) throw error;
                } catch (error) {
                    toast("Не удалось удалить параметр: " + (error && error.message ? error.message : String(error)), "error");
                    return;
                }
            }
        }
        rowEl.remove();
    }

    function addModuleSettingDraft() {
        const rows = state.moduleSettings.rows || [];
        state.moduleSettings.rows = rows.concat({ module: "", setting_key: "", value: null });
        renderModuleSettingsModal();
    }

    function moduleSettingInputRows() {
        return Array.from(document.querySelectorAll("[data-module-setting-row]")).map((row) => {
            const module = normalizeText(row.querySelector("[data-setting-module]") && row.querySelector("[data-setting-module]").value);
            const settingKey = normalizeText(row.querySelector("[data-setting-key]") && row.querySelector("[data-setting-key]").value);
            const rawValue = normalizeText(row.querySelector("[data-setting-value]") && row.querySelector("[data-setting-value]").value);
            if (!module || !settingKey || !rawValue) return null;
            let value;
            try {
                value = JSON.parse(rawValue);
            } catch (error) {
                return null;
            }
            return { module, setting_key: settingKey, value, updated_at: new Date().toISOString() };
        }).filter(Boolean);
    }

    async function openModuleSettingsModal() {
        if (!ensureDevelopmentAccess("Параметры модулей")) return;
        closeFlowModals();
        setFlowModalOpen("moduleSettingsModal", true);
        renderModuleSettingsModal();
        await loadModuleSettings(true);
    }

    function closeModuleSettingsModal() {
        setFlowModalOpen("moduleSettingsModal", false);
    }

    async function saveModuleSettingsFromModal() {
        const db = supabaseDb();
        const status = $("moduleSettingsStatus");
        const button = $("saveModuleSettings");
        const rows = moduleSettingInputRows();
        if (!rows.length) {
            if (status) status.textContent = "Нет строк для сохранения (проверь, что значение -- валидный JSON).";
            return;
        }
        if (!db) {
            if (status) status.textContent = "Supabase недоступен.";
            return;
        }
        if (button) button.disabled = true;
        state.moduleSettings.saving = true;
        if (status) status.textContent = "Сохраняю параметры...";
        try {
            const { error } = await db.from("wms_module_settings").upsert(rows, { onConflict: "module,setting_key" });
            if (error) throw error;
            state.moduleSettings.loaded = false;
            await loadModuleSettings(true);
            if (status) status.textContent = "Параметры сохранены.";
            toast("Параметры модулей сохранены.", "success");
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            state.moduleSettings.error = "Не удалось сохранить параметры: " + message;
            if (status) status.textContent = state.moduleSettings.error;
        } finally {
            state.moduleSettings.saving = false;
            if (button) button.disabled = false;
        }
    }

    async function loadWriteoffTerms(force) {
```

- [ ] **Step 3: HTML — кнопка-карточка**

В `tasks.html`, сразу после существующей карточки `openRoutingRules` (строки 1971-1975), добавить:

```html
                <button id="openModuleSettings" class="tasks-action-card" type="button" data-dev-only>
                    <span class="tasks-action-icon">⚙️</span>
                    <h2 class="tasks-action-title">Параметры модулей</h2>
                    <p class="tasks-action-text">Нестатичные параметры выгрузки (пороги, сдвиги дат и т.п.) без правки кода.</p>
                </button>
```

- [ ] **Step 4: HTML — секция модалки**

В `tasks.html`, сразу после закрывающего `</section>` блока `routingRulesModal` (строка 2830), добавить:

```html
<section id="moduleSettingsModal" class="tasks-flow-modal upload-work" aria-hidden="true">
    <div class="tasks-flow-card tasks-flow-card-wide">
        <div class="work-head">
            <div>
                <h3 class="work-title">Параметры модулей</h3>
                <p class="work-subtitle">Нестатичные параметры выгрузки (пороги цены, сдвиги дат, поле группировки и т.п.) -- ключ-значение на модуль.</p>
            </div>
            <button id="closeModuleSettings" class="btn btn-square" type="button" aria-label="Закрыть">×</button>
        </div>
        <div id="moduleSettingsWrap" class="writeoff-terms-wrap"></div>
        <div class="file-row">
            <button id="addModuleSetting" class="btn btn-outline" type="button">Добавить параметр</button>
            <button id="saveModuleSettings" class="btn btn-rect" type="button">Сохранить параметры</button>
            <button id="reloadModuleSettings" class="btn btn-outline" type="button">Обновить из Supabase</button>
        </div>
        <div id="moduleSettingsStatus" class="review-status"></div>
    </div>
</section>
```

- [ ] **Step 5: Слушатели событий**

В `tasks.js`, сразу после существующей строки (текущая строка 18286):

```js
        $("openRoutingRules").addEventListener("click", () => { void openRoutingRulesModal(); });
```

Добавить:

```js
        $("openModuleSettings").addEventListener("click", () => { void openModuleSettingsModal(); });
```

Сразу после существующего блока (текущие строки 18335-18338):

```js
        $("closeRoutingRules").addEventListener("click", closeRoutingRulesModal);
        $("addRoutingRule").addEventListener("click", addRoutingRuleDraft);
        $("saveRoutingRules").addEventListener("click", () => { void saveRoutingRulesFromModal(); });
        $("reloadRoutingRules").addEventListener("click", () => { void loadRoutingRules(true); });
```

Добавить:

```js
        $("closeModuleSettings").addEventListener("click", closeModuleSettingsModal);
        $("addModuleSetting").addEventListener("click", addModuleSettingDraft);
        $("saveModuleSettings").addEventListener("click", () => { void saveModuleSettingsFromModal(); });
        $("reloadModuleSettings").addEventListener("click", () => { void loadModuleSettings(true); });
```

Сразу после существующей строки (текущая строка 18500):

```js
        $("routingRulesModal").addEventListener("click", (event) => { if (event.target === $("routingRulesModal")) closeRoutingRulesModal(); });
```

Добавить:

```js
        $("moduleSettingsModal").addEventListener("click", (event) => { if (event.target === $("moduleSettingsModal")) closeModuleSettingsModal(); });
```

- [ ] **Step 6: Проверить синтаксис**

Run: `node --check tasks.js`
Expected: без вывода.

- [ ] **Step 7: Живая проверка таблицы через прямой RPC/REST (без браузера)**

Поскольку браузерного QA нет, проверить, что таблица `wms_module_settings` (из Task 1) принимает/отдаёт данные ровно в том формате, который ждёт новый JS-код (`module`, `setting_key`, `value` jsonb), прямым SQL-запросом:

```sql
insert into public.wms_module_settings (module, setting_key, value)
values ('ui_smoke_test', 'example_key', '{"example": true}'::jsonb)
on conflict (module, setting_key) do update set value = excluded.value;

select module, setting_key, value from public.wms_module_settings where module = 'ui_smoke_test';

delete from public.wms_module_settings where module = 'ui_smoke_test';
```

Run: `supabase db query --linked --file <scratch>.sql` (без `begin/rollback` — это прямая проверка формата данных на реальной таблице, с явной очисткой в конце того же файла)
Expected: средний `select` возвращает одну строку `module='ui_smoke_test', setting_key='example_key', value={"example": true}`; после выполнения всего файла строка удалена (проверить отдельным `select count(*) from wms_module_settings where module='ui_smoke_test'` → `0`, если нужна дополнительная уверенность).

- [ ] **Step 8: Коммит и пуш**

```bash
git add tasks.js tasks.html
git commit -m "$(cat <<'EOF'
Движок настроек (6/6): админка для wms_module_settings

Новая модалка "Параметры модулей" -- по образцу уже рабочих
wms_writeoff_terms/wms_routing_rules (список строк, добавление,
посрочное удаление, сохранение разом через upsert). Ключ-значение на
модуль (module, setting_key, value jsonb) -- сама по себе ничего не
подключает к модулям выгрузки, это самостоятельная админ-функция,
данными её наполнят будущие подпроекты подключения конкретных
модулей.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Финальная проверка (после Task 6)

- [ ] `node --check tasks.js` — последний раз, на финальном состоянии файла.
- [ ] Обновить глоссарий `docs/superpowers/specs/2026-10-02-wms-entity-glossary-design.md` — отметить движок настроек как ещё один пройденный изолированный шаг, зафиксировать, что ни один из 7 модулей выгрузки ещё не переключён (следующие подпроекты).
- [ ] Сообщить пользователю: движок готов и в проде, но ПОВЕДЕНИЕ выгрузки пока не изменилось (ни один модуль ещё не читает новые правила/параметры) — это сознательно, фундамент под будущие заходы.
