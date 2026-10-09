# Движок правил маршрутизации/группировки ШК — Фаза 1

**Статус:** новый кандидат, Фаза 1 (фундамент). Фаза 2 (ретроактивная
пересборка уже активных задач на любое изменение статуса + подключение
`save_wms_manual_upload` и всего «Предразбора» к этому же движку) —
зафиксирована в брейншторминге, отдельный будущий заход, не в этой спеке.

**Контекст:** сегодня решение «в какой участок/зону положить ШК» и «какие
ШК объединить в одну тару» зашито в коде — по одной хардкод-функции под
каждый тип выгрузки, плюс `wms_pure_losses_absorb_shks` жёстко привязана к
одной конкретной зоне («Чистые списания»). Пользователь хочет, чтобы
администратор настраивал это правилами через интерфейс, не трогая код.

## Границы Фазы 1

- Движок обрабатывает только **осиротевшие ШК** — те, у кого
  `wms_shk.current_task_id is null` (нет активной задачи прямо сейчас).
  Уже активные задачи правила пока не трогают.
- Срабатывает после **актуализации Superset** (там приходит статус
  движения) — не после обычной загрузки файла. `save_wms_manual_upload`
  не меняется.
- `wms_pure_losses_absorb_shks` не трогается, работает как есть, отдельно
  от нового движка.
- Целевой участок правило выбирает из **уже существующих** зон (тех же,
  что сегодня в `REVIEW_SECTIONS`) — создание новых UI-разделов не в этой
  фазе.
- Атрибуты для условий/группировки в этой фазе — ровно два: `status`
  (статус движения) и `tare_id` («последняя тара»). Список расширяемый
  позже, не хардкод-ограничение архитектуры.

## 1. `tare_id` как постоянный атрибут

`last_tare` уже парсится из Superset-файла (`normalizeSupersetRow` в
tasks.js), но нигде не сохраняется. Добавляем колонку в уже существующий
`wms_superset_cache` (кандидат A) и прокидываем в уже существующий push:

```sql
alter table public.wms_superset_cache add column last_tare text;
```

```js
// tasks.js, pushSupersetRowsToCache — добавить в payloads.map(...):
last_tare: row.last_tare || null,
```

## 2. Схема правил

```sql
create table public.wms_routing_rules (
    id uuid primary key default gen_random_uuid(),
    priority integer not null unique,
    name text not null,
    is_active boolean not null default true,
    conditions jsonb not null default '[]'::jsonb,
    target_task_type text not null,
    grouping_attribute text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
```

`conditions` — список `{attribute, operator, value}` (все условия через
И), например:
```json
[{"attribute": "status", "operator": "in", "value": ["SAS", "SMC"]}]
```
`operator` в Фазе 1 — только `in` (значение — массив) и `eq` (точное
совпадение). `grouping_attribute` — `"tare_id"` или `null` (каждый ШК —
своя отдельная задача).

`grant select, insert, update, delete on wms_routing_rules to anon,
authenticated;` — та же модель прав, что и у остальных настроечных
таблиц (`wms_writeoff_terms`), без RLS.

## 3. Метка группы на `wms_tasks`

```sql
alter table public.wms_tasks add column routing_group_key text;

create unique index wms_tasks_routing_group_active_unique
    on public.wms_tasks (task_type, routing_group_key)
    where is_deleted = false and task_status <> 'Завершено' and routing_group_key is not null;
```

Когда движок создаёт новую задачу для группы (`target_task_type`,
значение `tare_id`), он проставляет `routing_group_key = <tare_id>` —
уникальный индекс не даст случайно завести вторую активную задачу для той
же пары (зона, тара). Для ШК без группировки (`grouping_attribute is
null`) — `routing_group_key` остаётся `null`, индекс их не касается
(каждый — всегда новая отдельная задача, как и `wms_pure_losses_absorb_shks`
создаёт orphan-строки сегодня).

## 4. Движок — `wms_apply_routing_rules`

```sql
create or replace function public.wms_apply_routing_rules(p_shks text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_shk text;
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
        -- только осиротевшие -- у кого прямо сейчас нет активной задачи
        if exists (select 1 from public.wms_shk where shk = v_shk and current_task_id is not null) then
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
            continue; -- ни одно правило не подошло -- оставляем как есть
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
```

Вынесенный в отдельную функцию матчер условий:

```sql
create or replace function public.wms_routing_rule_matches(p_conditions jsonb, p_status text, p_tare_id text)
returns boolean
language plpgsql
immutable
as $$
declare
    v_cond jsonb;
    v_attr text;
    v_op text;
    v_value jsonb;
    v_actual text;
begin
    if p_conditions is null or jsonb_array_length(p_conditions) = 0 then
        return false; -- правило без условий никогда не матчится -- не "ловит всё подряд" по умолчанию
    end if;
    for v_cond in select * from jsonb_array_elements(p_conditions) loop
        v_attr := v_cond->>'attribute';
        v_op := v_cond->>'operator';
        v_value := v_cond->'value';
        v_actual := case v_attr when 'status' then p_status when 'tare_id' then p_tare_id else null end;
        if v_op = 'in' then
            if v_actual is null or not (v_value ? v_actual) then return false; end if;
        elsif v_op = 'eq' then
            if v_actual is distinct from (v_value#>>'{}') then return false; end if;
        else
            return false; -- неизвестный оператор -- безопасный отказ, не пропускаем молча
        end if;
    end loop;
    return true;
end;
$$;
```

Правило без условий **намеренно не матчится никогда** (а не «матчится
всегда») — иначе пустое правило в списке тихо перехватывало бы всё,
что раньше него не поймали другие правила.

## 5. Вызов движка после актуализации

```js
// tasks.js, handleActualizeSupersetFile, рядом с существующим pushSupersetRowsToCache(...):
void pushSupersetRowsToCache(rows)
    .then(() => hydrateSupersetCache(rows.map((row) => row.shk)))
    .then(() => db.rpc("wms_apply_routing_rules", { p_shks: rows.map((row) => row.shk) }))
    .then(() => renderReview())
    .catch((error) => console.warn("routing rules apply skipped:", error));
```

## 6. Админка правил — модалка, по образцу `wms_writeoff_terms`

Тот же паттерн, что уже есть для сроков списания
(`renderWriteoffTermsModal`/`saveWriteoffTermsFromModal`, `state.writeoffTerms`):
список редактируемых строк (приоритет, имя, условие — атрибут/оператор/
значение, целевая зона — выпадающий список из `REVIEW_SECTIONS`,
группировка — ничего/тара, вкл./выкл.), форма добавления новой строки,
одна кнопка «Сохранить» пишет весь список разом в `wms_routing_rules`.
Новый `state.routingRules = { rows: [], loading: false, loaded: false,
error: "" }`, зеркалящий структуру `state.writeoffTerms`.

## Тестирование

`begin; ...; rollback;`, как и для всех предыдущих миграций:
- Правило `status in [SAS] → "Коробки на входе"`, группировка по
  `tare_id`: два осиротевших ШК с одинаковым `tare_id` и статусом SAS —
  должны попасть в ОДНУ новую задачу; третий ШК с другим `tare_id` — в
  отдельную.
- ШК, у которого УЖЕ есть активная задача (`current_task_id is not
  null`) — движок его не трогает вообще, даже если условия правила
  формально совпадают.
- Ни одно правило не подошло — ШК остаётся без изменений (не создаётся
  задача из воздуха).
- Правило с пустым `conditions` — никогда не матчится.
- Повторный вызов движка для уже обработанных ШК — не создаёт вторую
  задачу для той же группы (уникальный индекс + поиск существующей).
- JS: `node --check tasks.js`; живое браузерное QA недоступно в этой
  сессии (тот же auth-барьер) — сказать об этом явно при сдаче.
