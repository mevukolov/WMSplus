# Фаза 2a движка маршрутизации: ретроактивная пересборка — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить движок правил маршрутизации (Фаза 1, в проде) так, чтобы он переоценивал уже активные ШК (не только осиротевшие) при изменении их статуса, при освобождении задачи, и по ручному sweep администратора.

**Architecture:** Два новых переиспользуемых SQL-функции (`wms_compute_reroute_target` — чистый расчёт, `wms_reclassify_active_item` — применение с защитой "Не начато") становятся общим ядром, которое вызывают: расширенная `wms_apply_routing_rules` (путь осиротевших ШК, Фаза 1), новый STATEMENT-триггер на `wms_superset_cache` (изменение статуса/тары), новый ROW-триггер на `wms_tasks` (освобождение задачи), и новая пара sweep-функций, вызываемая из админки после сохранения правила.

**Tech Stack:** PostgreSQL (plpgsql), Supabase CLI (`supabase db push --linked`, `supabase db query --linked`), vanilla JS (`tasks.js`).

**Spec:** `docs/superpowers/specs/2026-10-13-wms-routing-rules-phase2a-design.md`

## Global Constraints

- Миграции в `supabase/migrations/`, имя файла `202610130NNN_<описание>.sql`. Следующий свободный префикс — `202610130008` (последняя существующая миграция на момент написания плана — `202610130007`).
- Перед КАЖДЫМ `supabase db push --linked` переместить эти 4 файла (дублирующийся timestamp-префикс ломает push) в `supabase/.migration_holdout/`, затем вернуть обратно сразу после push:
  `202608170001_weeek_manual_wmi_mp_pc_upload.sql`, `202609020005_wms_shifts_roster.sql`, `202609040003_upsert_wms_external_requests_from_json.sql`, `202609040004_upsert_wms_external_requests_source_shk_ids.sql`.
- Каждая миграция тестируется ЖИВЫМ способом на реальной БД ПЕРЕД применением: один плоский `.sql`-файл, обёрнутый в `begin; ... rollback;`, запускаемый через `supabase db query --linked --file <path>`. Этот инструмент возвращает только результат ПОСЛЕДНЕГО стейтмента и НЕ поддерживает psql-метакоманды (`\i`, `\gset`) — весь SQL пишется одним файлом (функции + тесты вместе), а промежуточные результаты (включая `insert ... returning`) сохраняются через `create temp table X as <statement>`, не через переменные psql. Финальный `select` — из `test_results (test_name text primary key, actual text, expected text)` с колонкой `pass`.
- Тестовые данные — ПОЛНОСТЬЮ СИНТЕТИЧЕСКИЕ, создаются внутри самой тестовой транзакции (`source_module = 'phase2a_test'`) и откатываются — не завязываемся на конкретные ID реальных прод-строк, которые могут измениться к моменту выполнения плана.
- JS проверяется только через `node --check tasks.js` — браузерного QA в этой сессии нет (auth guard требует реальной Supabase-сессии).
- `wh_id` захардкожен как `'50144199'` везде в движке — тот же хардкод, что и во всех остальных функциях этой подсистемы (Фаза 1).
- Каждая задача — отдельный коммит, сообщение на русском, заканчивается строкой `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, пушится в `main` сразу после применения (коммиты не копятся).
- `REVIEW_SECTIONS` (`tasks.js:428`) — список зон-значений, которые реально хранятся в `wms_tasks.task_type`/`wms_routing_rules.target_task_type` для управляемых правилами задач (напр. `"ПЦ"`, `"Маркетплейс"` — БЕЗ префикса `"Разбор ОПП // "`; это уже так в Фазе 1, не новое поведение). Тестовые фикстуры используют эти же bare-значения.

---

## Task 1: Ядро — `wms_compute_reroute_target` + `wms_reclassify_active_item`

**Files:**
- Create: `supabase/migrations/202610130008_wms_reclassify_active_item.sql`
- Modify: `tasks.js` (TASK_HISTORY_EVENT_LABELS ~9281-9300, `taskHistoryFeedItemHtml` ~9338-9354)

**Interfaces:**
- Consumes: `public.wms_routing_rule_matches(jsonb, text, text) returns boolean` (Фаза 1, существует), таблицы `wms_routing_rules`, `wms_task_items`, `wms_tasks`, `wms_task_history`, `wms_superset_cache` (все существуют).
- Produces: `public.wms_compute_reroute_target(p_task_id uuid, p_shk text) returns table(current_zone text, target_zone text, rule_id uuid, rule_name text)`; `public.wms_reclassify_active_item(p_task_id uuid, p_shk text, p_bypass_active_guard boolean default false) returns boolean`; новый `event_type = 'task_item_rerouted_by_rule'` в `wms_task_history`. Используются в Task 2 (замена orphan-гейта), Task 4 (триггер освобождения), Task 5 (sweep).

- [ ] **Step 1: Написать миграцию**

```sql
-- supabase/migrations/202610130008_wms_reclassify_active_item.sql
--
-- Ядро ретроактивной пересборки (Фаза 2a): дано активный ШК с
-- известным task_id -- пересчитать его зону по текущим правилам.
-- Разбито на чистую read-only функцию (что бы изменилось) и обёртку,
-- которая применяет это с учётом защиты "Не начато" (операторская
-- работа с review-карточкой не оставляет никакого другого следа в
-- БД, кроме task_status -- более точного presence-сигнала система не
-- хранит, см. спеку). p_bypass_active_guard=true используется только
-- ручным sweep (Task 5).

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
        where is_active = true
        order by priority asc
    loop
        if public.wms_routing_rule_matches(v_rule.conditions, v_status, v_tare_id) then
            exit;
        end if;
        v_rule := null;
    end loop;

    if v_rule is null or v_rule.target_task_type = v_item_task_type then
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

create or replace function public.wms_reclassify_active_item(
    p_task_id uuid,
    p_shk text,
    p_bypass_active_guard boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target record;
    v_parent_status text;
begin
    select * into v_target from public.wms_compute_reroute_target(p_task_id, p_shk);
    if v_target.target_zone is null then
        return false;
    end if;

    select task_status into v_parent_status from public.wms_tasks where id = p_task_id;
    if v_parent_status = 'Не начато' and not p_bypass_active_guard then
        return false;
    end if;

    update public.wms_task_items
    set task_type = v_target.target_zone,
        zone_payload = '{}'::jsonb,
        updated_at = timezone('utc', now())
    where task_id = p_task_id and shk = p_shk;

    insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
    values (
        p_task_id, 'task_item_rerouted_by_rule', 'Система', '',
        jsonb_build_object(
            'shk', p_shk, 'rule_id', v_target.rule_id, 'rule_name', v_target.rule_name,
            'old_zone', v_target.current_zone, 'new_zone', v_target.target_zone,
            'sweep', p_bypass_active_guard
        )
    );

    return true;
end;
$$;

grant execute on function public.wms_reclassify_active_item(uuid, text, boolean) to anon, authenticated;
```

- [ ] **Step 2: Живой тест (begin/rollback) перед применением**

Создать `/private/tmp/claude-502/-Users-WBwork-Desktop-trvj/scratchpad/test_202610130008.sql` (путь — актуальный scratchpad-каталог текущей сессии), собрав файл командой (в реальном выполнении — прочитать текст миграции из Step 1 и подставить вместо `<MIGRATION SQL>`):

```sql
begin;

<MIGRATION SQL from Step 1, без строк "grant execute...">

create temp table test_results (test_name text primary key, actual text, expected text);

-- Фикстура 1: активный ШК, зона "Маркетплейс", задача "Не начато",
-- правило уводит в "ПЦ" -- должно НЕ примениться (защита).
create temp table t1_task as
insert into public.wms_tasks (
    source_module, source_table, source_id, source_payload,
    source_shk_ids, task_type, title, task_status, opp_verdict,
    responsibility_zone, tags, last_seen_at
) values (
    'phase2a_test', 'manual_xlsx', 'phase2a-t1', jsonb_build_object(
        'task_items', jsonb_build_array(jsonb_build_object(
            'shk', '90000000001', 'nm', null, 'name', 't1', 'price', 0,
            'status', '', 'movement', '', 'mx', ''
        ))
    ),
    array['90000000001'], 'Маркетплейс', 'Phase2a test 1', 'Не начато', 'Не выбран',
    'Нет привязки', '[]'::jsonb, now()
) returning id;

insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
values ('50144199', '90000000001', 'XYZ: тестовый статус', null)
on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

insert into public.wms_routing_rules (priority, name, is_active, conditions, target_task_type, grouping_attribute)
values (90001, 'phase2a-test-rule', true, jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('XYZ'))), 'ПЦ', null)
on conflict (priority) do update set name = excluded.name, is_active = excluded.is_active, conditions = excluded.conditions, target_task_type = excluded.target_task_type;

create temp table t1_compute as
select * from public.wms_compute_reroute_target((select id from t1_task), '90000000001');

insert into test_results values ('t1_compute_target', (select target_zone from t1_compute), 'ПЦ');

create temp table t1_apply as
select public.wms_reclassify_active_item((select id from t1_task), '90000000001', false) as applied;

insert into test_results values ('t1_apply_blocked_not_started', (select applied::text from t1_apply), 'false');
insert into test_results values ('t1_item_zone_unchanged',
  (select task_type from public.wms_task_items where task_id = (select id from t1_task) and shk = '90000000001'),
  'Маркетплейс');

-- Фикстура 2: тот же сетап, но задача "Отложено" -- должно примениться.
create temp table t2_task as
insert into public.wms_tasks (
    source_module, source_table, source_id, source_payload,
    source_shk_ids, task_type, title, task_status, opp_verdict,
    responsibility_zone, tags, last_seen_at
) values (
    'phase2a_test', 'manual_xlsx', 'phase2a-t2', jsonb_build_object(
        'task_items', jsonb_build_array(jsonb_build_object(
            'shk', '90000000002', 'nm', null, 'name', 't2', 'price', 0,
            'status', '', 'movement', '', 'mx', ''
        ))
    ),
    array['90000000002'], 'Маркетплейс', 'Phase2a test 2', 'Отложено', 'Не выбран',
    'Нет привязки', '[]'::jsonb, now()
) returning id;

insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
values ('50144199', '90000000002', 'XYZ: тестовый статус', null)
on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

create temp table t2_apply as
select public.wms_reclassify_active_item((select id from t2_task), '90000000002', false) as applied;

insert into test_results values ('t2_apply_applied_deferred', (select applied::text from t2_apply), 'true');
insert into test_results values ('t2_item_zone_changed',
  (select task_type from public.wms_task_items where task_id = (select id from t2_task) and shk = '90000000002'),
  'ПЦ');
insert into test_results values ('t2_history_logged',
  (select count(*)::text from public.wms_task_history where task_id = (select id from t2_task) and event_type = 'task_item_rerouted_by_rule'),
  '1');
insert into test_results values ('t2_history_sweep_false',
  (select (payload->>'sweep') from public.wms_task_history where task_id = (select id from t2_task) and event_type = 'task_item_rerouted_by_rule'),
  'false');

-- Фикстура 3: как фикстура 1 (Не начато), но с bypass=true -- должно примениться (sweep-путь).
create temp table t3_apply as
select public.wms_reclassify_active_item((select id from t1_task), '90000000001', true) as applied;

insert into test_results values ('t3_apply_bypass_applies', (select applied::text from t3_apply), 'true');
insert into test_results values ('t3_item_zone_changed',
  (select task_type from public.wms_task_items where task_id = (select id from t1_task) and shk = '90000000001'),
  'ПЦ');

-- Фикстура 4: уже в целевой зоне -- no-op.
create temp table t4_apply as
select public.wms_reclassify_active_item((select id from t1_task), '90000000001', true) as applied;

insert into test_results values ('t4_noop_already_target', (select applied::text from t4_apply), 'false');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

- [ ] **Step 3: Запустить тест**

Run: `supabase db query --linked --file <путь к файлу из Step 2>`
Expected: все 10 строк `pass = true` (t1_compute_target, t1_apply_blocked_not_started, t1_item_zone_unchanged, t2_apply_applied_deferred, t2_item_zone_changed, t2_history_logged, t2_history_sweep_false, t3_apply_bypass_applies, t3_item_zone_changed, t4_noop_already_target).

Если что-то не проходит — не переходить дальше, разобраться (систематический дебаг: перечитать сообщение об ошибке, не гадать).

- [ ] **Step 4: Применить миграцию в проде**

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

- [ ] **Step 5: Проверить, что функции реально созданы**

```sql
select proname from pg_proc where proname in ('wms_compute_reroute_target', 'wms_reclassify_active_item') order by proname;
```

Run: `supabase db query --linked --file <scratch>.sql`
Expected: обе строки присутствуют.

- [ ] **Step 6: Добавить `task_item_rerouted_by_rule` в JS (label + системное отображение)**

В `tasks.js`, в объект `TASK_HISTORY_EVENT_LABELS` (строка ~9299, сразу после `task_refreshed_same_module`) добавить:

```js
        task_item_rerouted_by_rule: "Переклассифицировано правилом",
```

В функции `taskHistoryFeedItemHtml` (строка ~9353-9354) найти:

```js
        const isRefreshedSameModule = item.event_type === "task_refreshed_same_module";
        const isSystem = isSystemClosed || isForecast || isCreated || isUploadMarker || isRefreshedSameModule || (!rawActorName && !rawActorId);
        const actorDisplay = (isSystemClosed || isForecast || isCreated || isUploadMarker || isRefreshedSameModule) ? "Система" : (rawActorName || rawActorId || "Система");
```

Заменить на:

```js
        const isRefreshedSameModule = item.event_type === "task_refreshed_same_module";
        const isReroutedByRule = item.event_type === "task_item_rerouted_by_rule";
        const isSystem = isSystemClosed || isForecast || isCreated || isUploadMarker || isRefreshedSameModule || isReroutedByRule || (!rawActorName && !rawActorId);
        const actorDisplay = (isSystemClosed || isForecast || isCreated || isUploadMarker || isRefreshedSameModule || isReroutedByRule) ? "Система" : (rawActorName || rawActorId || "Система");
```

- [ ] **Step 7: Проверить синтаксис**

Run: `node --check tasks.js`
Expected: без вывода (успех).

- [ ] **Step 8: Коммит и пуш**

```bash
git add supabase/migrations/202610130008_wms_reclassify_active_item.sql tasks.js
git commit -m "$(cat <<'EOF'
Фаза 2a (1/5): ядро переклассификации активного ШК

wms_compute_reroute_target -- чистый расчёт (что бы изменилось для
данного task_id+shk по текущим правилам), wms_reclassify_active_item --
применяет с учётом защиты "Не начато" (p_bypass_active_guard=true для
будущего ручного sweep). Переиспользует механизм расхождения
(task_type/zone_payload на строке wms_task_items), задача не создаётся
заново и не переезжает.

Новый event_type task_item_rerouted_by_rule заведён в JS (лейбл +
системное отображение) в этом же коммите -- чтобы не повторить
сегодняшний баг с task_refreshed_same_module, который сначала
отображался сырой строкой.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 2: Подключить активный путь в `wms_apply_routing_rules`

**Files:**
- Modify: `supabase/migrations/202610130004_wms_apply_routing_rules.sql` — НЕ редактируется напрямую (это применённая миграция); вместо этого создаётся новая миграция с `create or replace function`.
- Create: `supabase/migrations/202610130009_wms_apply_routing_rules_active_path.sql`

**Interfaces:**
- Consumes: `public.wms_reclassify_active_item(uuid, text, boolean)` (Task 1).
- Produces: `public.wms_apply_routing_rules(p_shks text[]) returns jsonb` — та же сигнатура, что и в Фазе 1 (вызывающий код, включая будущие Task 3/4, ничего не меняет в том, как они её вызывают).

Сегодня (Фаза 1) функция для каждого `v_shk` делает:
```sql
if exists (select 1 from public.wms_shk where shk = v_shk and current_task_id is not null) then
    continue;
end if;
```
— то есть любой ШК с заполненным (возможно устаревшим) кэшем `current_task_id` просто пропускается. Меняем на прямой lookup в `wms_task_items` (источник истины, см. спеку) и вызов ядра из Task 1.

- [ ] **Step 1: Написать миграцию**

```sql
-- supabase/migrations/202610130009_wms_apply_routing_rules_active_path.sql
--
-- Фаза 2a: wms_apply_routing_rules (Фаза 1) сегодня пропускает любой
-- ШК, у которого wms_shk.current_task_id заполнен (не глядя, активна
-- ли реально задача) -- путь только для осиротевших. Меняем источник
-- истины на прямой lookup в wms_task_items (тот же класс бага с
-- рассинхроном, что сегодня нашли и починили в save_wms_manual_upload)
-- и подключаем ядро переклассификации активных ШК (Task 1 этого
-- плана) вместо простого пропуска.
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
            where is_active = true
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
```

- [ ] **Step 2: Живой тест**

```sql
begin;

<MIGRATION SQL from Step 1, без grant>

create temp table test_results (test_name text primary key, actual text, expected text);

-- Регрессия: осиротевший ШК -- должен по-прежнему создавать orphan-задачу.
insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
values ('50144199', '90000000010', 'XYZ: тестовый статус', null)
on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

insert into public.wms_routing_rules (priority, name, is_active, conditions, target_task_type, grouping_attribute)
values (90002, 'phase2a-test-rule-2', true, jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('XYZ'))), 'ПЦ', null)
on conflict (priority) do update set name = excluded.name, is_active = excluded.is_active, conditions = excluded.conditions, target_task_type = excluded.target_task_type;

create temp table orphan_result as
select public.wms_apply_routing_rules(array['90000000010']) as result;

insert into test_results values ('orphan_created',
  (select count(*)::text from public.wms_tasks where source_module = 'routing_engine' and '90000000010' = any(source_shk_ids)),
  '1');

-- Активный путь: ШК с активной задачей "Отложено" -- должен переехать, НЕ создавая orphan-задачу.
create temp table active_task as
insert into public.wms_tasks (
    source_module, source_table, source_id, source_payload,
    source_shk_ids, task_type, title, task_status, opp_verdict,
    responsibility_zone, tags, last_seen_at
) values (
    'phase2a_test', 'manual_xlsx', 'phase2a-t5', jsonb_build_object(
        'task_items', jsonb_build_array(jsonb_build_object(
            'shk', '90000000011', 'nm', null, 'name', 't5', 'price', 0,
            'status', '', 'movement', '', 'mx', ''
        ))
    ),
    array['90000000011'], 'Маркетплейс', 'Phase2a test 5', 'Отложено', 'Не выбран',
    'Нет привязки', '[]'::jsonb, now()
) returning id;

insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
values ('50144199', '90000000011', 'XYZ: тестовый статус', null)
on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

create temp table active_result as
select public.wms_apply_routing_rules(array['90000000011']) as result;

insert into test_results values ('active_item_rerouted',
  (select task_type from public.wms_task_items where task_id = (select id from active_task) and shk = '90000000011'),
  'ПЦ');
insert into test_results values ('active_no_orphan_created',
  (select count(*)::text from public.wms_tasks where source_module = 'routing_engine' and '90000000011' = any(source_shk_ids)),
  '0');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

- [ ] **Step 3: Запустить тест**

Run: `supabase db query --linked --file <путь>`
Expected: все 3 строки (`orphan_created`, `active_item_rerouted`, `active_no_orphan_created`) — `pass = true`.

- [ ] **Step 4: Применить миграцию**

Та же процедура holdout, что в Task 1 Step 4.

- [ ] **Step 5: Коммит и пуш**

```bash
git add supabase/migrations/202610130009_wms_apply_routing_rules_active_path.sql
git commit -m "$(cat <<'EOF'
Фаза 2a (2/5): wms_apply_routing_rules подключает активный путь

Раньше: ШК с заполненным (возможно устаревшим) wms_shk.current_task_id
просто пропускался -- движок работал только с осиротевшими. Теперь:
прямой lookup активной строки в wms_task_items (тот же источник
истины, что и в save_wms_manual_upload после сегодняшнего фикса), и
если найдена -- вызывается wms_reclassify_active_item вместо
пропуска. Путь осиротевших ШК не изменился.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 3: Триггер на `wms_superset_cache` + удаление дублирующего JS-хука

**Files:**
- Create: `supabase/migrations/202610130010_wms_superset_cache_route_trigger.sql`
- Modify: `tasks.js:3256-3261` (`handleActualizeSupersetFile`)

**Interfaces:**
- Consumes: `public.wms_apply_routing_rules(text[])` (Task 2).
- Produces: `public.wms_superset_cache_route_changed() returns trigger`, триггеры `wms_superset_cache_route_insert`, `wms_superset_cache_route_update`.

- [ ] **Step 1: Написать миграцию**

```sql
-- supabase/migrations/202610130010_wms_superset_cache_route_trigger.sql
--
-- Фаза 2a: вместо явного JS-вызова wms_apply_routing_rules после
-- актуализации Superset (Фаза 1), заводим настоящий DB-триггер --
-- last_status/last_tare в wms_superset_cache сегодня меняются только
-- здесь, других путей записи нет. STATEMENT-уровня с transition
-- tables (не ROW) -- актуализация пишет пачками в один upsert-
-- стейтмент на сотни/тысячи строк, ROW-level дёргал бы функцию по
-- одной строке за раз.
create or replace function public.wms_superset_cache_route_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_shks text[];
begin
    if tg_op = 'INSERT' then
        select array_agg(distinct shk) into v_shks from new_rows;
    else
        select array_agg(distinct n.shk) into v_shks
        from new_rows n
        join old_rows o on o.wh_id = n.wh_id and o.shk = n.shk
        where n.last_status is distinct from o.last_status
           or n.last_tare is distinct from o.last_tare;
    end if;
    if v_shks is not null and array_length(v_shks, 1) > 0 then
        perform public.wms_apply_routing_rules(v_shks);
    end if;
    return null;
end;
$$;

drop trigger if exists wms_superset_cache_route_insert on public.wms_superset_cache;
create trigger wms_superset_cache_route_insert
    after insert on public.wms_superset_cache
    referencing new table as new_rows
    for each statement
    execute function public.wms_superset_cache_route_changed();

drop trigger if exists wms_superset_cache_route_update on public.wms_superset_cache;
create trigger wms_superset_cache_route_update
    after update of last_status, last_tare on public.wms_superset_cache
    referencing new table as new_rows old table as old_rows
    for each statement
    execute function public.wms_superset_cache_route_changed();
```

- [ ] **Step 2: Живой тест**

```sql
begin;

<MIGRATION SQL from Step 1>

create temp table test_results (test_name text primary key, actual text, expected text);

insert into public.wms_routing_rules (priority, name, is_active, conditions, target_task_type, grouping_attribute)
values (90003, 'phase2a-test-rule-3', true, jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('XYZ'))), 'ПЦ', null)
on conflict (priority) do update set name = excluded.name, is_active = excluded.is_active, conditions = excluded.conditions, target_task_type = excluded.target_task_type;

-- Регрессия через триггер (без явного вызова wms_apply_routing_rules): INSERT нового orphan-статуса должен сам создать задачу.
insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
values ('50144199', '90000000020', 'XYZ: тест триггера insert', null)
on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

insert into test_results values ('trigger_insert_orphan_created',
  (select count(*)::text from public.wms_tasks where source_module = 'routing_engine' and '90000000020' = any(source_shk_ids)),
  '1');

-- Активный ШК: изменение статуса через UPDATE должно само переклассифицировать.
create temp table active_task as
insert into public.wms_tasks (
    source_module, source_table, source_id, source_payload,
    source_shk_ids, task_type, title, task_status, opp_verdict,
    responsibility_zone, tags, last_seen_at
) values (
    'phase2a_test', 'manual_xlsx', 'phase2a-t6', jsonb_build_object(
        'task_items', jsonb_build_array(jsonb_build_object(
            'shk', '90000000021', 'nm', null, 'name', 't6', 'price', 0,
            'status', '', 'movement', '', 'mx', ''
        ))
    ),
    array['90000000021'], 'Маркетплейс', 'Phase2a test 6', 'Отложено', 'Не выбран',
    'Нет привязки', '[]'::jsonb, now()
) returning id;

insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
values ('50144199', '90000000021', 'AAA: исходный', null)
on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

-- этот update должен сработать с ДРУГИМ статусом -- insert выше это не статус-изменение, сам insert уже мог бы применить правило XYZ если бы совпал; тут статус AAA не матчится ни с одним правилом, поэтому не применится. Теперь меняем статус на XYZ, что уже совпадает:
update public.wms_superset_cache set last_status = 'XYZ: новый статус' where wh_id = '50144199' and shk = '90000000021';

insert into test_results values ('trigger_update_active_rerouted',
  (select task_type from public.wms_task_items where task_id = (select id from active_task) and shk = '90000000021'),
  'ПЦ');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

- [ ] **Step 3: Запустить тест**

Run: `supabase db query --linked --file <путь>`
Expected: `trigger_insert_orphan_created` и `trigger_update_active_rerouted` — `pass = true`.

- [ ] **Step 4: Применить миграцию** (та же holdout-процедура)

- [ ] **Step 5: Убрать дублирующий JS-вызов**

В `tasks.js`, в `handleActualizeSupersetFile` (строки ~3256-3261) найти:

```js
            void pushSupersetRowsToCache(rows)
                .then(() => hydrateSupersetCache(rows.map((row) => row.shk)))
                .then(() => supabaseDb().rpc("wms_apply_routing_rules", { p_shks: rows.map((row) => row.shk) }))
                .then(() => loadReviewTasks())
                .then(() => renderReview())
                .catch((error) => console.warn("superset cache push skipped:", error));
```

Заменить на (убрана строка с явным `.rpc("wms_apply_routing_rules", ...)` — триггер из Step 1 теперь делает это сам внутри транзакции upsert'а):

```js
            void pushSupersetRowsToCache(rows)
                .then(() => hydrateSupersetCache(rows.map((row) => row.shk)))
                .then(() => loadReviewTasks())
                .then(() => renderReview())
                .catch((error) => console.warn("superset cache push skipped:", error));
```

- [ ] **Step 6: Проверить синтаксис**

Run: `node --check tasks.js`
Expected: без вывода.

- [ ] **Step 7: Коммит и пуш**

```bash
git add supabase/migrations/202610130010_wms_superset_cache_route_trigger.sql tasks.js
git commit -m "$(cat <<'EOF'
Фаза 2a (3/5): DB-триггер на wms_superset_cache вместо JS-хука

STATEMENT-триггер (с transition tables -- актуализация пишет пачками)
на INSERT/UPDATE OF last_status, last_tare -- ловит любое изменение
статуса/тары ШК и сам вызывает wms_apply_routing_rules с реально
изменившимися ШК. Убрали дублирующий явный .rpc(...) из
handleActualizeSupersetFile (Фаза 1) -- к моменту ответа на upsert
работа внутри той же транзакции уже сделана.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 4: Триггер освобождения задачи на `wms_tasks`

**Files:**
- Create: `supabase/migrations/202610130011_wms_tasks_route_on_release.sql`

**Interfaces:**
- Consumes: `public.wms_reclassify_active_item(uuid, text, boolean)` (Task 1).
- Produces: `public.wms_tasks_route_released_items() returns trigger`, триггер `wms_tasks_route_on_release`.

- [ ] **Step 1: Написать миграцию**

```sql
-- supabase/migrations/202610130011_wms_tasks_route_on_release.sql
--
-- Фаза 2a: отложенная пересборка. Пока задача "Не начато", триггер на
-- wms_superset_cache (Task 3) молча пропускает несовпадения зоны (защита
-- в wms_reclassify_active_item). Этот триггер разрешает их в момент,
-- когда задача наконец освобождается -- переходит в "Завершено" или
-- "Отложено".
create or replace function public.wms_tasks_route_released_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
begin
    for v_row in
        select shk from public.wms_task_items
        where task_id = new.id and task_status <> 'Завершено'
    loop
        perform public.wms_reclassify_active_item(new.id, v_row.shk, false);
    end loop;
    return null;
end;
$$;

drop trigger if exists wms_tasks_route_on_release on public.wms_tasks;
create trigger wms_tasks_route_on_release
    after update of task_status on public.wms_tasks
    for each row
    when (new.task_status in ('Завершено', 'Отложено')
          and old.task_status is distinct from new.task_status)
    execute function public.wms_tasks_route_released_items();
```

- [ ] **Step 2: Живой тест**

```sql
begin;

<MIGRATION SQL from Step 1>

create temp table test_results (test_name text primary key, actual text, expected text);

insert into public.wms_routing_rules (priority, name, is_active, conditions, target_task_type, grouping_attribute)
values (90004, 'phase2a-test-rule-4', true, jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('XYZ'))), 'ПЦ', null)
on conflict (priority) do update set name = excluded.name, is_active = excluded.is_active, conditions = excluded.conditions, target_task_type = excluded.target_task_type;

create temp table active_task as
insert into public.wms_tasks (
    source_module, source_table, source_id, source_payload,
    source_shk_ids, task_type, title, task_status, opp_verdict,
    responsibility_zone, tags, last_seen_at
) values (
    'phase2a_test', 'manual_xlsx', 'phase2a-t7', jsonb_build_object(
        'task_items', jsonb_build_array(jsonb_build_object(
            'shk', '90000000030', 'nm', null, 'name', 't7', 'price', 0,
            'status', '', 'movement', '', 'mx', ''
        ))
    ),
    array['90000000030'], 'Маркетплейс', 'Phase2a test 7', 'Не начато', 'Не выбран',
    'Нет привязки', '[]'::jsonb, now()
) returning id;

insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
values ('50144199', '90000000030', 'XYZ: тест', null)
on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

-- пока "Не начато" -- зона не меняется (проверка через прямой вызов, как в Task 1):
insert into test_results values ('before_release_zone_unchanged',
  (select task_type from public.wms_task_items where task_id = (select id from active_task) and shk = '90000000030'),
  'Маркетплейс');

update public.wms_tasks set task_status = 'Отложено' where id = (select id from active_task);

insert into test_results values ('after_release_zone_changed',
  (select task_type from public.wms_task_items where task_id = (select id from active_task) and shk = '90000000030'),
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
git add supabase/migrations/202610130011_wms_tasks_route_on_release.sql
git commit -m "$(cat <<'EOF'
Фаза 2a (4/5): триггер отложенной пересборки при освобождении задачи

При переходе wms_tasks.task_status в "Завершено" или "Отложено"
заново прогоняет wms_reclassify_active_item для всех ещё активных ШК
этой задачи -- разрешает несовпадения зоны, накопленные, пока задача
была "Не начато" (их применение откладывал триггер из Фазы 2a-3).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 5: Sweep-функции + подтверждение в админке

**Files:**
- Create: `supabase/migrations/202610130012_wms_sweep_active_routing.sql`
- Modify: `tasks.js:12333-12364` (`saveRoutingRulesFromModal`)

**Interfaces:**
- Consumes: `public.wms_compute_reroute_target(uuid, text)` (Task 1), `public.wms_reclassify_active_item(uuid, text, boolean)` (Task 1).
- Produces: `public.wms_preview_sweep_active_routing() returns integer`, `public.wms_sweep_active_routing() returns integer`.

- [ ] **Step 1: Написать миграцию**

```sql
-- supabase/migrations/202610130012_wms_sweep_active_routing.sql
--
-- Фаза 2a: ручной sweep при сохранении правила в админке. В отличие
-- от триггеров (Task 3/4), обходит защиту "Не начато" -- у
-- review-задач физически нет presence-сигнала "карточка открыта у
-- оператора" (только task_status, который одинаков и для реально
-- открытой карточки, и для нетронутого бэклога), и раз админ
-- сознательно меняет правило, это осознанно принятый риск (см. спеку,
-- раздел "Риски и компромиссы").
create or replace function public.wms_preview_sweep_active_routing()
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer
    from public.wms_task_items ti
    cross join lateral public.wms_compute_reroute_target(ti.task_id, ti.shk) rt
    where ti.task_status <> 'Завершено';
$$;

grant execute on function public.wms_preview_sweep_active_routing() to anon, authenticated;

create or replace function public.wms_sweep_active_routing()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
    v_count integer := 0;
begin
    for v_row in
        select task_id, shk from public.wms_task_items where task_status <> 'Завершено'
    loop
        if public.wms_reclassify_active_item(v_row.task_id, v_row.shk, true) then
            v_count := v_count + 1;
        end if;
    end loop;
    return v_count;
end;
$$;

grant execute on function public.wms_sweep_active_routing() to anon, authenticated;
```

- [ ] **Step 2: Живой тест**

```sql
begin;

<MIGRATION SQL from Step 1, без grant>

create temp table test_results (test_name text primary key, actual text, expected text);

insert into public.wms_routing_rules (priority, name, is_active, conditions, target_task_type, grouping_attribute)
values (90005, 'phase2a-test-rule-5', true, jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('XYZ'))), 'ПЦ', null)
on conflict (priority) do update set name = excluded.name, is_active = excluded.is_active, conditions = excluded.conditions, target_task_type = excluded.target_task_type;

create temp table active_task as
insert into public.wms_tasks (
    source_module, source_table, source_id, source_payload,
    source_shk_ids, task_type, title, task_status, opp_verdict,
    responsibility_zone, tags, last_seen_at
) values (
    'phase2a_test', 'manual_xlsx', 'phase2a-t8', jsonb_build_object(
        'task_items', jsonb_build_array(jsonb_build_object(
            'shk', '90000000040', 'nm', null, 'name', 't8', 'price', 0,
            'status', '', 'movement', '', 'mx', ''
        ))
    ),
    array['90000000040'], 'Маркетплейс', 'Phase2a test 8', 'Не начато', 'Не выбран',
    'Нет привязки', '[]'::jsonb, now()
) returning id;

insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
values ('50144199', '90000000040', 'XYZ: тест', null)
on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

insert into test_results values ('preview_counts_not_started_item',
  (select public.wms_preview_sweep_active_routing())::text,
  '1');

insert into test_results values ('preview_is_readonly',
  (select task_type from public.wms_task_items where task_id = (select id from active_task) and shk = '90000000040'),
  'Маркетплейс');

insert into test_results values ('sweep_applies_bypassing_guard',
  (select public.wms_sweep_active_routing())::text,
  '1');

insert into test_results values ('sweep_item_zone_changed',
  (select task_type from public.wms_task_items where task_id = (select id from active_task) and shk = '90000000040'),
  'ПЦ');

insert into test_results values ('preview_zero_after_sweep',
  (select public.wms_preview_sweep_active_routing())::text,
  '0');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

- [ ] **Step 3: Запустить тест**

Run: `supabase db query --linked --file <путь>`
Expected: все 5 строк `pass = true`.

- [ ] **Step 4: Применить миграцию** (holdout-процедура)

- [ ] **Step 5: Добавить подтверждение sweep в админку**

В `tasks.js`, в `saveRoutingRulesFromModal` (строки ~12333-12364) найти блок `try { ... }`:

```js
        try {
            const { error } = await db.from("wms_routing_rules").upsert(rows, { onConflict: "priority" });
            if (error) throw error;
            state.routingRules.loaded = false;
            await loadRoutingRules(true);
            if (status) status.textContent = "Правила сохранены.";
            toast("Правила маршрутизации сохранены.", "success");
        } catch (error) {
```

Заменить на (добавлен блок sweep сразу после успешного сохранения, перед `catch`):

```js
        try {
            const { error } = await db.from("wms_routing_rules").upsert(rows, { onConflict: "priority" });
            if (error) throw error;
            state.routingRules.loaded = false;
            await loadRoutingRules(true);
            if (status) status.textContent = "Правила сохранены.";
            toast("Правила маршрутизации сохранены.", "success");
            try {
                const { data: previewCount, error: previewError } = await db.rpc("wms_preview_sweep_active_routing");
                if (previewError) throw previewError;
                const count = Number(previewCount) || 0;
                if (count > 0 && window.confirm("Sweep переклассифицирует " + count + " активных ШК, включая невзятые в работу. Продолжить?")) {
                    const { error: sweepError } = await db.rpc("wms_sweep_active_routing");
                    if (sweepError) throw sweepError;
                    toast("Sweep применил переклассификацию: " + count + " ШК.", "success");
                    await loadReviewTasks();
                    renderReview();
                }
            } catch (sweepCheckError) {
                console.warn("routing rules sweep skipped:", sweepCheckError);
            }
        } catch (error) {
```

- [ ] **Step 6: Проверить синтаксис**

Run: `node --check tasks.js`
Expected: без вывода.

- [ ] **Step 7: Коммит и пуш**

```bash
git add supabase/migrations/202610130012_wms_sweep_active_routing.sql tasks.js
git commit -m "$(cat <<'EOF'
Фаза 2a (5/5): ручной sweep активных ШК при сохранении правила

wms_preview_sweep_active_routing (read-only, считает N) и
wms_sweep_active_routing (применяет, обходит защиту "Не начато" --
осознанный риск явного действия администратора) -- в админке
вызываются сразу после сохранения правил: сначала preview, и если
N > 0, подтверждение с числом перед реальным применением.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Финальная проверка (после Task 5)

- [ ] `node --check tasks.js` — последний раз, на финальном состоянии файла.
- [ ] Обновить глоссарий `docs/superpowers/specs/2026-10-02-wms-entity-glossary-design.md` — добавить пункт про Фазу 2a (по аналогии с пунктом про Фазу 1), отметить что Фаза 2b (save_wms_manual_upload + JS-классификация в build*Preview) по-прежнему не начата.
- [ ] Сообщить пользователю: что изменилось, какие 2 реальных риска приняты осознанно (отсутствие presence-сигнала; sweep без защиты), и что Фаза 2b остаётся отдельным будущим заходом.
