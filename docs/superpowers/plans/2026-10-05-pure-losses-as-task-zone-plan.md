# «Чистые списания» как зона разбора внутри wms_tasks — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать «Чистые списания» ещё одной зоной разбора внутри `wms_tasks` (как Предсортировка/АВХ/Коробки на входе — те же `task_type`), с двунаправленным переходом: любая задача → «Чистые списания» при выгрузке списаний, и обратно — при появлении того же ШК в любой другой выгрузке. Переключение `task_type` на той же строке переносит историю автоматически (она привязана к `task_id`, не к зоне).

**Architecture:** Два симметричных изменения в SQL (единственная точка создания/приёма задач — `save_wms_manual_upload`, единственная точка приёма чистых списаний — новая RPC `wms_pure_losses_absorb_shks`), плюс три точечных правки в JS (список вердиктов для новой зоны, группировка зоны в review-UI, откат уже задеплоенного неверного решения).

**Tech Stack:** Postgres/PL\<pgSQL\> (Supabase), vanilla JS (`tasks.js`, `task-verdicts.js`, `pure_losses.js`), миграции через `supabase db push --linked`.

**Spec:** [docs/superpowers/specs/2026-10-05-pure-losses-as-task-zone-design.md](../specs/2026-10-05-pure-losses-as-task-zone-design.md)

## Global Constraints

- Прод-репозиторий, main branch, без worktree — коммитить и пушить прямо в main (установленный рабочий процесс этой сессии).
- Миграции применяются через `supabase db push --linked`. **Перед каждым push** переносить 4 файла с дублирующимися timestamp-префиксами в `supabase/.migration_holdout/` и возвращать их обратно сразу после push:
  `202608170001_weeek_manual_wmi_mp_pc_upload.sql`, `202609020005_wms_shifts_roster.sql`, `202609040003_upsert_wms_external_requests_from_json.sql`, `202609040004_upsert_wms_external_requests_source_shk_ids.sql`.
- Верификация миграций — **живым SQL через `begin; ...; rollback;`** (`supabase db query --linked`), не предположениями. Никогда не оставлять тестовую транзакцию закоммиченной.
- Верификация JS — `node --check <file>.js`.
- Зона называется строкой `'Чистые списания'` везде (точное совпадение с `task_type`, именно так, как уже лежит в `wh_data_rep`/опциях pure_losses).
- Реальное время перехода в «Чистые списания» — `date_lost` из данных чистых списаний, не время обработки файла.
- Триггер обратного перехода — любая выгрузка/задача вообще (не только «Предсортировка»).
- `pure_losses.js`/`pure_losses.html` в рамках этого плана **не трогаются физически** — decision-UI (`applyVerdictSelection` и всё, что к нему ведёт) остаётся работать как и раньше, параллельно с новой зоной. Полный вывод его из эксплуатации — отдельный будущий заход (страглер-фиг, не всё сразу); сейчас операторам нужно будет просто сказать работать через новую зону, а старый UI не ломается и не мешает. Это решение зафиксировано здесь явно, а не оставлено открытым.

---

### Task 1: Список вердиктов и группировка зоны «Чистые списания»

**Files:**
- Modify: `task-verdicts.js` (добавить `ZONE_VERDICTS`, добавить запись в `DEFERRED_VERDICT_FIELDS`)
- Modify: `tasks.js:4705-4722` (`taskSectionName`), `tasks.js:9645` (выбор списка вердиктов)

**Interfaces:**
- Produces: `ZONE_VERDICTS` (объект `{ [task_type]: string[] }`, глобальная константа в `task-verdicts.js`) — используется в Task 1 самим собой (другие задачи плана его не трогают, он чисто UI-уровня).
- Consumes: ничего из других задач плана.

- [ ] **Step 1: Добавить `ZONE_VERDICTS` и запись в `DEFERRED_VERDICT_FIELDS` в `task-verdicts.js`**

Открыть `task-verdicts.js`. После блока `REVIEW_VERDICTS` (после строки `];`, т.е. сразу за существующим массивом) добавить:

```js
// Зона "Чистые списания" внутри wms_tasks (ещё один task_type, как
// Предсортировка/АВХ/Коробки на входе) живёт по своему, урезанному
// набору вердиктов -- "Отправлен на релиз" и "Аннулирование после
// списания" из REVIEW_VERDICTS здесь не нужны, вместо них один новый
// "Отправлен на аннулирование". REVIEW_VERDICTS остаётся общим списком
// для всех остальных зон -- не трогаем.
const PURE_LOSSES_ZONE_VERDICT = "Отправлен на аннулирование";
const ZONE_VERDICTS = {
    "Чистые списания": [
        "Не выбран",
        "Найден/Релиз/Списан",
        "Отправлен запрос",
        "Нет на МХ/Не найден",
        "Отправлен на списание ревизией",
        PURE_LOSSES_ZONE_VERDICT,
        AUTO_WRITEOFF_EXCLUSION_VERDICT,
    ],
};
```

Затем в `DEFERRED_VERDICT_FIELDS` (сразу после записи `[AUTO_WRITEOFF_EXCLUSION_VERDICT]: "Вставьте ссылку на исключение",`) добавить:

```js
    [PURE_LOSSES_ZONE_VERDICT]: "Комментарий",
```

(Решение по лейблу: "Комментарий" — то же поле, что было у "Аннулирование после списания", одного из двух вердиктов, которые объединяются в этот новый. Без этой записи вердикт не будет считаться отложенным — см. `isDeferred` в `tasks.js`, который проверяет наличие ключа именно в `DEFERRED_VERDICT_FIELDS`.)

Проверить, что `reopenAfterForVerdict` (`tasks.js:10347`) ничего менять не нужно: для любого вердикта, не попавшего в explicit-кейсы `CANCELLATION_AFTER_WRITEOFF_VERDICT`/`AUTO_WRITEOFF_EXCLUSION_VERDICT`, функция уже возвращает `addDaysIso(2)` по умолчанию — ровно нужные 2 дня, без изменений кода.

- [ ] **Step 2: Прогнать синтаксис-чек**

Run: `node --check task-verdicts.js`
Expected: без вывода (успех).

- [ ] **Step 3: Научить `taskSectionName` узнавать зону «Чистые списания»**

В `tasks.js`, функция `taskSectionName` (строка ~4705) сейчас — цепочка `if (combined.includes(...))`, заканчивающаяся `return "Другие задачи";`. Добавить проверку ПЕРЕД веткой `предсорт` (чтобы не зависеть от порядка остальных веток, но и не ломать её):

```js
    function taskSectionName(row) {
        const taskType = normalizeForMatch(row && row.task_type);
        const title = normalizeForMatch(row && row.title);
        const sourceModule = normalizeForMatch(row && row.source_module);
        const combined = [taskType, title, sourceModule, normalizeForMatch(row && row.upload_type)].join(" ");
        if (combined.includes("оклейка") || /\busd\b/.test(combined) || /\btmm\b/.test(combined)) return "Другие задачи";
        if (combined.includes("wmi")) return "WMI (МП + ПЦ)";
        if (combined.includes("почта")) return "Почта";
        if (combined.includes("пм") || combined.includes("pm")) return "ПМ";
        if (combined.includes("rwp")) return "RWP";
        if (combined.includes("упаковка") || combined.includes("переупаковка")) return "Упаковка";
        if (taskType === "чистые списания") return "Чистые списания";
        if (combined.includes("предсорт")) return "Предсортировка";
        if (combined.includes("маркетплейс")) return "Маркетплейс";
        if (combined.includes("пц")) return "ПЦ";
        if (combined.includes("без заказа")) return "Без заказа";
        if (combined.includes("движение после продажи")) return "Движение после продажи";
        return "Другие задачи";
    }
```

(Проверка именно по `taskType === "чистые списания"`, а не по вхождению в `combined`, — значение `task_type` будет выставляться RPC из Task 3/4 буквально строкой `'Чистые списания'`, точное совпадение надёжнее, чем вхождение подстроки, и не пересечётся со случайным текстом в `title`.)

- [ ] **Step 4: Переключить список вердиктов для зоны в `renderTaskDetail`**

В `tasks.js:9645`:

```js
        const verdictOptions = incomingFlow ? INCOMING_FLOW_ATTACHMENT_OPTIONS : REVIEW_VERDICTS;
```

заменить на:

```js
        const verdictOptions = incomingFlow
            ? INCOMING_FLOW_ATTACHMENT_OPTIONS
            : (ZONE_VERDICTS[normalizeText(row.task_type)] || REVIEW_VERDICTS);
```

(`ZONE_VERDICTS` ключуется буквальным `task_type`, не через `taskSectionName` — таких строк одна, `'Чистые списания'`, совпадает с тем, что выставляют RPC из Task 3/4.)

- [ ] **Step 5: Прогнать синтаксис-чек**

Run: `node --check tasks.js`
Expected: без вывода (успех).

- [ ] **Step 6: Коммит**

```bash
git add task-verdicts.js tasks.js
git commit -m "Добавляем вердикты и группировку зоны «Чистые списания»

ZONE_VERDICTS -- отдельный список вердиктов для task_type='Чистые
списания' (Отправлен на релиз + Аннулирование после списания заменены
одним новым Отправлен на аннулирование, 2 дня отложения по уже
существующему дефолту reopenAfterForVerdict). taskSectionName узнаёт
новую зону по точному task_type."
```

---

### Task 2: Откатить неверный вердикт «Система - Автосписание»

**Files:**
- Modify: `task-verdicts.js` (удалить `SYSTEM_AUTO_WRITEOFF_VERDICT` и его запись в `VERDICT_TONE`)
- Modify: `tasks.js` (убрать из `SYSTEM_COMPLETION_VERDICT_KEYS`, `SYSTEM_VERDICT_SET`)

**Interfaces:**
- Consumes: ничего (чистый откат, независим от Task 1).
- Produces: ничего (последующие задачи этот вердикт больше не упоминают).

Проверено: `select count(*) from wms_tasks where opp_verdict = 'Система - Автосписание';` → `0` живых строк на момент написания плана — откат чист, бэкофилл не нужен.

- [ ] **Step 1: Убрать `SYSTEM_AUTO_WRITEOFF_VERDICT` из `task-verdicts.js`**

Удалить блок (объявление константы и её комментарий):

```js
// Задача закрыта автоматически -- её ШК обнаружился в новой выгрузке
// чистых списаний (wms_reconcile_shks_written_off), пока задача ещё
// висела незавершённой. Значение продублировано как литерал в самой RPC
// (SQL не может импортировать эту константу) -- держать строки в синхроне
// при будущих правках.
const SYSTEM_AUTO_WRITEOFF_VERDICT = "Система - Автосписание";
```

И из `VERDICT_TONE` строку:

```js
    "Система - Автосписание": "red",
```

- [ ] **Step 2: Убрать регистрацию из `tasks.js`**

Из `SYSTEM_COMPLETION_VERDICT_KEYS`:

```js
    const SYSTEM_COMPLETION_VERDICT_KEYS = new Set([
        SYSTEM_MOVEMENT_VERDICT,
        SYSTEM_NO_SHK_NOT_FOUND_VERDICT,
        SYSTEM_NO_SHK_FOUND_VERDICT,
        SYSTEM_AUTO_WRITEOFF_VERDICT,
    ].map((item) => normalizeForMatch(item)));
```

убрать строку `SYSTEM_AUTO_WRITEOFF_VERDICT,`. Из `SYSTEM_VERDICT_SET`:

```js
    const SYSTEM_VERDICT_SET = new Set([
        SYSTEM_MOVEMENT_VERDICT,
        SYSTEM_NO_SHK_NOT_FOUND_VERDICT,
        SYSTEM_NO_SHK_FOUND_VERDICT,
        SYSTEM_INCOMING_FLOW_DUPLICATE_VERDICT,
        SYSTEM_AUTO_WRITEOFF_VERDICT,
    ]);
```

убрать строку `SYSTEM_AUTO_WRITEOFF_VERDICT,`.

- [ ] **Step 3: Прогнать синтаксис-чеки**

Run: `node --check task-verdicts.js && node --check tasks.js`
Expected: без вывода.

- [ ] **Step 4: Коммит**

```bash
git add task-verdicts.js tasks.js
git commit -m "Откатываем вердикт «Система - Автосписание»

Неверное промежуточное решение -- закрывало задачу на месте вместо
переноса в зону «Чистые списания». 0 живых строк с этим вердиктом
в проде, откат чист, без бэкофилла."
```

---

### Task 3: RPC прямого перехода — любая задача → «Чистые списания»

**Files:**
- Create: `supabase/migrations/202610050001_pure_losses_absorb_shks.sql`

**Interfaces:**
- Consumes: ничего из предыдущих задач плана (чистая SQL-миграция).
- Produces: `public.wms_pure_losses_absorb_shks(p_rows jsonb, p_actor_id text default null, p_actor_name text default null) returns jsonb` — вызывается из Task 5. `p_rows` — jsonb-массив объектов `{shk, nm, name, price, date_lost}` (`date_lost` — ISO-строка с датой/временем списания). Возвращает jsonb-массив `{shk, task_id, action}`, `action` одно из `'repurposed' | 'extracted_new_row' | 'created_new'`.
- Заменяет (дропает) `public.wms_reconcile_shks_written_off(text[], text, text, text)` — старая RPC больше не вызывается никем после Task 5.

Данные пользователя при каждой загрузке чистых списаний в `pure_losses.js::prepareIncomingRows` уже имеют форму `{shk, nm, decription, brand, shk_state_before_lost, wh_id, date_lost, lr, price}` (проверено по коду, `pure_losses.js:5039-5049`) — `name` в `p_rows` — это их `decription`.

- [ ] **Step 1: Написать миграцию**

```sql
-- Прямой переход: любая задача -> зона "Чистые списания", при выгрузке
-- чистых списаний. Заменяет wms_reconcile_shks_written_off (миграции
-- 202610020004/202610020005) -- та версия просто закрывала задачу на
-- месте вердиктом "Система - Автосписание" (откачен в Task 2 плана),
-- не перенося её в зону для дальнейшего разбора и без поддержки
-- обратного перехода. См.
-- docs/superpowers/specs/2026-10-05-pure-losses-as-task-zone-design.md.
--
-- Для каждой строки {shk, nm, name, price, date_lost}:
--   1) одиночная существующая незавершённая задача с этим ШК (не уже
--      в зоне "Чистые списания") -- переключаем её на месте
--      (task_type/status/verdict/payload), история остаётся на той же
--      строке (привязана к task_id, не к зоне);
--   2) ШК внутри тары с другими активными товарами -- вынимаем его из
--      тары на месте (как раньше), и ДЛЯ НЕГО создаём новую строку в
--      зоне "Чистые списания" (тару целиком переиспользовать нельзя);
--   3) задачи с этим ШК нет вообще -- создаём новую строку в зоне
--      напрямую;
--   4) ШК уже лежит в зоне "Чистые списания" -- ничего не делаем
--      (идемпотентность при повторной загрузке того же файла).
drop function if exists public.wms_reconcile_shks_written_off(text[], text, text, text);

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

        -- Уже в зоне "Чистые списания" -- идемпотентность, не трогаем.
        if exists (
            select 1 from public.wms_tasks
            where is_deleted = false and task_type = v_zone and v_shk = any(source_shk_ids)
        ) then
            continue;
        end if;

        select * into v_task
        from public.wms_tasks
        where is_deleted = false
          and task_type <> v_zone
          and v_shk = any(source_shk_ids)
        order by created_at asc
        limit 1;

        if v_task.id is not null then
            v_items := coalesce(v_task.source_payload->'task_items', '[]'::jsonb);
            v_removed_shk := array[v_shk];

            select coalesce(jsonb_agg(item), '[]'::jsonb) into v_remaining
            from jsonb_array_elements(v_items) item
            where not (item->>'shk' = any(v_removed_shk));

            if jsonb_array_length(v_items) <= 1 or jsonb_array_length(v_remaining) = 0 then
                -- Одиночная задача (или последний товар тары) -- переключаем
                -- ту же строку в зону целиком, свежая на разбор.
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
                -- Товар из тары с другими активными товарами -- вынимаем
                -- его из тары на месте (пересчёт как в старой RPC), и для
                -- него отдельно создаём новую строку в зоне.
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
            -- Задачи с этим ШК нет вообще -- создаём новую строку в зоне.
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

grant execute on function public.wms_pure_losses_absorb_shks(jsonb, text, text) to authenticated;
```

- [ ] **Step 2: Применить миграцию**

```bash
mkdir -p supabase/.migration_holdout
for f in 202608170001_weeek_manual_wmi_mp_pc_upload.sql 202609020005_wms_shifts_roster.sql 202609040003_upsert_wms_external_requests_from_json.sql 202609040004_upsert_wms_external_requests_source_shk_ids.sql; do
  mv "supabase/migrations/$f" "supabase/.migration_holdout/$f"
done
supabase db push --linked
for f in supabase/.migration_holdout/*.sql; do mv "$f" "supabase/migrations/$(basename "$f")"; done
rmdir supabase/.migration_holdout
```

Expected: `"Finished supabase db push."`, миграция `202610050001_pure_losses_absorb_shks.sql` в списке применённых.

- [ ] **Step 3: Проверить живьём — одиночная задача (repurposed)**

Найти реальную одиночную незавершённую задачу (`select id, source_shk_ids[1] as shk from wms_tasks where is_deleted=false and task_status<>'Завершено' and array_length(source_shk_ids,1)=1 limit 1;`), затем внутри `begin;...;rollback;`:

```sql
begin;
select wms_pure_losses_absorb_shks(
    jsonb_build_array(jsonb_build_object('shk', '<найденный_shk>', 'nm', '123456', 'name', 'Тест', 'price', 777, 'date_lost', '2026-09-01T10:00:00Z')),
    'test-actor', 'QA Test'
) as r1;
select jsonb_build_object('task_type', task_type, 'task_status', task_status, 'opp_verdict', opp_verdict) as after_state from wms_tasks where id = '<найденный_id>';
select event_type, created_at from wms_task_history where task_id = '<найденный_id>' order by created_at desc limit 1;
rollback;
```

Expected: `after_state.task_type = 'Чистые списания'`, `task_status = 'Не начато'`, `opp_verdict = 'Не выбран'`; история — `task_moved_to_pure_losses` с `created_at = 2026-09-01T10:00:00Z` (не текущее время).

- [ ] **Step 4: Проверить живьём — тара (extracted_new_row)**

Найти тарную задачу с несколькими активными товарами (как в прошлой сессии: `select id, source_shk_ids[1] from wms_tasks where is_deleted=false and task_status<>'Завершено' and array_length(source_shk_ids,1)>1 limit 1;`), прогнать такой же `begin;...;rollback;` с одним из её ШК.

Expected: `r1` возвращает `action: 'extracted_new_row'` с новым `task_id`; исходная тара теряет ровно один элемент (`array_length` уменьшился на 1), `task_type` исходной тары **не изменился**; новая строка имеет `task_type='Чистые списания'`, `source_payload.split_from_task_id` указывает на исходную тару.

- [ ] **Step 5: Проверить живьём — идемпотентность**

Повторно вызвать `wms_pure_losses_absorb_shks` (в новой `begin;...;rollback;`) с тем же ШК, который по итогам Step 3 (если бы закоммитили) уже в зоне. Поскольку Step 3 был рукотворно отменён (`rollback`), для реальной проверки идемпотентности — закоммитить ОДИН тестовый вызов на заведомо тестовом/неважном ШК (или просто пропустить живую проверку идемпотентности и доверять логике `exists (...) then continue`, которая зеркалит уже проверенный паттерн из прошлой версии RPC) — **решение: пропустить отдельную живую проверку идемпотентности**, т.к. любой коммит правит реальные прод-данные, а логика идентична уже проверенному паттерну dedup.

- [ ] **Step 6: Коммит**

```bash
git add supabase/migrations/202610050001_pure_losses_absorb_shks.sql
git commit -m "Добавляем wms_pure_losses_absorb_shks: прямой переход в зону «Чистые списания»

Заменяет wms_reconcile_shks_written_off -- вместо закрытия задачи на
месте теперь переключает её (или создаёт новую строку) в task_type
'Чистые списания', время перехода -- реальная дата списания, не время
обработки файла. Проверено вживую (begin/rollback): одиночная задача,
тара, откат чист."
```

---

### Task 4: RPC обратного перехода — встроить в `save_wms_manual_upload`

**Files:**
- Create: `supabase/migrations/202610050002_save_upload_returns_from_pure_losses.sql`

**Interfaces:**
- Consumes: ничего напрямую из Task 3 (симметричная, но независимая логика), но логически зависит от того, что зона называется `'Чистые списания'` — та же константа, что в Task 1/3.
- Produces: обновлённая `public.save_wms_manual_upload(jsonb, jsonb)` — сигнатура не меняется, вызывающий код (все существующие сайты вызова в `tasks.js`) не трогается.

- [ ] **Step 1: Написать миграцию**

Текущая версия `save_wms_manual_upload` (миграция `202609280001_wms_tasks_shk_dedup.sql`) при нахождении канонической задачи из другого модуля просто дописывает `task_cross_module_touch` в историю, не трогая `task_status`/`task_type`. Меняем: если у найденной канонической задачи `task_type = 'Чистые списания'` — переключаем её обратно (task_type/status/verdict/payload из новой выгрузки), вместо простой пометки.

```sql
-- Обратный переход: ШК, лежащий в зоне "Чистые списания", снова
-- всплывает в ЛЮБОЙ другой выгрузке/задаче -- переключаем его обратно,
-- вместо простой исторической пометки, которую делает текущий код для
-- межмодульных совпадений. См.
-- docs/superpowers/specs/2026-10-05-pure-losses-as-task-zone-design.md.
-- Единственное изменение -- новая ветка внутри уже существующего блока
-- "genuinely new for this module, но ШК уже у кого-то другого"; сама
-- дедупликация (поиск v_canonical_id) не меняется.
create or replace function public.save_wms_manual_upload(p_tasks jsonb, p_run jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
  task_ids uuid[] := '{}'::uuid[];
  run_row public.wms_manual_upload_runs%rowtype;
  item jsonb;
  v_source_module text;
  v_source_table text;
  v_source_id text;
  v_source_payload jsonb;
  v_source_generated_at timestamptz;
  v_source_shk_ids text[];
  v_source_tare_id text;
  v_source_price_sum numeric;
  v_source_last_movement_at timestamptz;
  v_search_text text;
  v_upload_type text;
  v_upload_effective_date date;
  v_task_type text;
  v_title text;
  v_description text;
  v_priority integer;
  v_priority_label text;
  v_due_date date;
  v_responsibility_zone text;
  v_task_status text;
  v_opp_verdict text;
  v_assignee_employee_id text;
  v_assignee_name text;
  v_tags jsonb;
  v_existing_id uuid;
  v_canonical_id uuid;
  v_canonical_task_type text;
  v_row_id uuid;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(p_tasks)
  loop
    v_source_module := nullif(item->>'source_module', '');
    v_source_id := nullif(item->>'source_id', '');
    v_task_type := nullif(item->>'task_type', '');
    if v_source_module is null or v_source_id is null or v_task_type is null then
      continue;
    end if;

    v_source_table := item->>'source_table';
    v_source_payload := coalesce(item->'source_payload', '{}'::jsonb);
    v_source_generated_at := public.wms_safe_timestamptz(item->>'source_generated_at');
    v_source_shk_ids := case
      when jsonb_typeof(item->'source_shk_ids') = 'array'
        then array(select jsonb_array_elements_text(item->'source_shk_ids'))
      else '{}'::text[]
    end;
    v_source_tare_id := nullif(item->>'source_tare_id', '');
    v_source_price_sum := public.wms_safe_numeric(item->>'source_price_sum');
    v_source_last_movement_at := public.wms_safe_timestamptz(item->>'source_last_movement_at');
    v_search_text := nullif(item->>'search_text', '');
    v_upload_type := nullif(item->>'upload_type', '');
    v_upload_effective_date := public.wms_safe_date(item->>'upload_effective_date');
    v_title := item->>'title';
    v_description := item->>'description';
    v_priority := public.wms_safe_integer(item->>'priority');
    v_priority_label := nullif(item->>'priority_label', '');
    v_due_date := public.wms_safe_date(item->>'due_date');
    v_responsibility_zone := coalesce(nullif(item->>'responsibility_zone', ''), 'Нет привязки');
    v_task_status := coalesce(nullif(item->>'task_status', ''), 'Не начато');
    v_opp_verdict := coalesce(nullif(item->>'opp_verdict', ''), 'Не выбран');
    v_assignee_employee_id := nullif(item->>'assignee_employee_id', '');
    v_assignee_name := nullif(item->>'assignee_name', '');
    v_tags := coalesce(item->'tags', '[]'::jsonb);

    select id into v_existing_id
    from public.wms_tasks
    where source_module = v_source_module and source_id = v_source_id and task_type = v_task_type;

    if v_existing_id is not null then
      update public.wms_tasks set
        source_table = v_source_table,
        source_row_id = item->>'source_row_id',
        source_payload = v_source_payload,
        source_generated_at = v_source_generated_at,
        source_shk_ids = v_source_shk_ids,
        source_tare_id = v_source_tare_id,
        source_price_sum = v_source_price_sum,
        source_last_movement_at = v_source_last_movement_at,
        search_text = v_search_text,
        upload_type = v_upload_type,
        upload_effective_date = v_upload_effective_date,
        title = v_title,
        description = v_description,
        priority = v_priority,
        priority_label = v_priority_label,
        due_date = v_due_date,
        responsibility_zone = v_responsibility_zone,
        assignee_employee_id = coalesce(v_assignee_employee_id, assignee_employee_id),
        assignee_name = coalesce(v_assignee_name, assignee_name),
        tags = v_tags,
        last_seen_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
      where id = v_existing_id;
      task_ids := task_ids || v_existing_id;
      affected_count := affected_count + 1;
      continue;
    end if;

    v_canonical_id := null;
    v_canonical_task_type := null;
    if array_length(v_source_shk_ids, 1) > 0 then
      select id, task_type into v_canonical_id, v_canonical_task_type
      from public.wms_tasks
      where is_deleted = false
        and source_shk_ids && v_source_shk_ids
        and not (source_module = v_source_module and task_type = v_task_type)
      order by created_at asc
      limit 1;
    end if;

    if v_canonical_id is not null and v_canonical_task_type = 'Чистые списания' then
      -- Возврат из зоны "Чистые списания" -- переключаем ту же строку
      -- обратно в обычный разбор, значения берём из новой выгрузки.
      -- История остаётся на этой же строке (task_id не меняется).
      update public.wms_tasks set
        source_module = v_source_module,
        source_table = v_source_table,
        source_row_id = item->>'source_row_id',
        source_payload = v_source_payload,
        source_generated_at = v_source_generated_at,
        source_shk_ids = v_source_shk_ids,
        source_tare_id = v_source_tare_id,
        source_price_sum = v_source_price_sum,
        source_last_movement_at = v_source_last_movement_at,
        search_text = v_search_text,
        upload_type = v_upload_type,
        upload_effective_date = v_upload_effective_date,
        task_type = v_task_type,
        title = v_title,
        description = v_description,
        priority = v_priority,
        priority_label = v_priority_label,
        due_date = v_due_date,
        responsibility_zone = v_responsibility_zone,
        task_status = v_task_status,
        opp_verdict = v_opp_verdict,
        completed_at = null,
        reopen_after = null,
        assignee_employee_id = v_assignee_employee_id,
        assignee_name = v_assignee_name,
        tags = v_tags,
        last_seen_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
      where id = v_canonical_id;

      insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
      values (
        v_canonical_id,
        'task_returned_from_pure_losses',
        'Система',
        '',
        jsonb_build_object(
          'new_module', v_source_module,
          'new_task_type', v_task_type,
          'new_source_id', v_source_id
        )
      );

      task_ids := task_ids || v_canonical_id;
      affected_count := affected_count + 1;
      continue;
    end if;

    if v_canonical_id is not null then
      update public.wms_tasks
      set source_shk_ids = (
            select array(select distinct unnest(coalesce(source_shk_ids, '{}'::text[]) || v_source_shk_ids))
          ),
          last_seen_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where id = v_canonical_id;

      if not exists (
        select 1 from public.wms_task_history
        where task_id = v_canonical_id
          and event_type = 'task_cross_module_touch'
          and payload->>'new_source_id' = v_source_id
      ) then
        insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
        values (
          v_canonical_id,
          'task_cross_module_touch',
          'Система',
          '',
          jsonb_build_object(
            'new_module', v_source_module,
            'new_source_id', v_source_id,
            'new_task_type', v_task_type,
            'new_title', v_title,
            'new_verdict', nullif(v_opp_verdict, 'Не выбран'),
            'new_status', v_task_status,
            'new_shk_ids', to_jsonb(v_source_shk_ids)
          )
        );
      end if;
      task_ids := task_ids || v_canonical_id;
      affected_count := affected_count + 1;
      continue;
    end if;

    insert into public.wms_tasks (
      source_module, source_table, source_id, source_row_id, source_payload,
      source_generated_at, source_shk_ids, source_tare_id, source_price_sum,
      source_last_movement_at, search_text, upload_type, upload_effective_date,
      task_type, title, description, priority, priority_label, due_date,
      responsibility_zone, task_status, opp_verdict, assignee_employee_id,
      assignee_name, tags, last_seen_at
    ) values (
      v_source_module, v_source_table, v_source_id, item->>'source_row_id', v_source_payload,
      v_source_generated_at, v_source_shk_ids, v_source_tare_id, v_source_price_sum,
      v_source_last_movement_at, v_search_text, v_upload_type, v_upload_effective_date,
      v_task_type, v_title, v_description, v_priority, v_priority_label, v_due_date,
      v_responsibility_zone, v_task_status, v_opp_verdict, v_assignee_employee_id,
      v_assignee_name, v_tags, timezone('utc', now())
    )
    returning id into v_row_id;
    task_ids := task_ids || v_row_id;
    affected_count := affected_count + 1;
  end loop;

  if p_run is not null and jsonb_typeof(p_run) = 'object' and nullif(p_run->>'source_module', '') is not null then
    insert into public.wms_manual_upload_runs (
      upload_date, effective_date, business_date, source_module, upload_type,
      status, file_name, secondary_file_name, rows_count, tasks_count,
      upserted_count, summary
    )
    values (
      coalesce(public.wms_safe_date(p_run->>'upload_date'), timezone('Europe/Moscow', now())::date),
      coalesce(public.wms_safe_date(p_run->>'effective_date'), public.wms_safe_date(p_run->>'business_date'), timezone('Europe/Moscow', now())::date),
      public.wms_safe_date(p_run->>'business_date'),
      p_run->>'source_module',
      coalesce(nullif(p_run->>'upload_type', ''), p_run->>'source_module'),
      coalesce(nullif(p_run->>'status', ''), 'completed'),
      p_run->>'file_name',
      p_run->>'secondary_file_name',
      coalesce(public.wms_safe_integer(p_run->>'rows_count'), 0),
      coalesce(public.wms_safe_integer(p_run->>'tasks_count'), affected_count),
      affected_count,
      coalesce(p_run->'summary', '{}'::jsonb)
    )
    on conflict (effective_date, source_module, upload_type)
    do update set
      upload_date = excluded.upload_date,
      business_date = excluded.business_date,
      status = excluded.status,
      file_name = excluded.file_name,
      secondary_file_name = excluded.secondary_file_name,
      rows_count = excluded.rows_count,
      tasks_count = excluded.tasks_count,
      upserted_count = excluded.upserted_count,
      summary = excluded.summary,
      updated_at = timezone('utc', now())
    returning * into run_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upserted_count', affected_count,
    'task_ids', to_jsonb(task_ids),
    'upload_run', case when run_row.id is null then null else to_jsonb(run_row) end
  );
end;
$$;

grant execute on function public.save_wms_manual_upload(jsonb, jsonb) to anon, authenticated;
```

- [ ] **Step 2: Применить миграцию** (тот же holdout-манёвр, что в Task 3 Step 2, с файлом `202610050002_save_upload_returns_from_pure_losses.sql`)

- [ ] **Step 3: Проверить живьём**

Создать тестовую ситуацию: взять любую реальную задачу, временно (внутри `begin;...;rollback;`) поставить ей `task_type='Чистые списания'`, затем вызвать `save_wms_manual_upload` с одной записью, чьи `source_shk_ids` пересекаются с этой задачей, но с другим `source_module`/`task_type`:

```sql
begin;
update wms_tasks set task_type='Чистые списания' where id = '<тестовый_id>';
select save_wms_manual_upload(
    jsonb_build_array(jsonb_build_object(
        'source_module', 'test_predrazbor', 'source_id', 'test-return-1', 'task_type', 'Предсортировка',
        'source_shk_ids', jsonb_build_array((select source_shk_ids[1] from wms_tasks where id='<тестовый_id>')),
        'title', 'Возврат теста', 'task_status', 'Не начато', 'opp_verdict', 'Не выбран'
    )),
    '{}'::jsonb
) as r1;
select jsonb_build_object('task_type', task_type, 'task_status', task_status) as after_state from wms_tasks where id = '<тестовый_id>';
select event_type from wms_task_history where task_id='<тестовый_id>' order by created_at desc limit 1;
rollback;
```

Expected: `r1.task_ids` содержит `<тестовый_id>` (не создана новая строка); `after_state.task_type = 'Предсортировка'`; последняя запись истории — `task_returned_from_pure_losses`.

- [ ] **Step 4: Коммит**

```bash
git add supabase/migrations/202610050002_save_upload_returns_from_pure_losses.sql
git commit -m "Добавляем обратный переход из зоны «Чистые списания» в save_wms_manual_upload

Если межмодульная дедупликация находит каноническую задачу с
task_type='Чистые списания' -- переключаем её обратно на значения
новой выгрузки, вместо простой исторической пометки. Проверено вживую
(begin/rollback), откат чист."
```

---

### Task 5: Переключить вызов в `pure_losses.js` на новую RPC

**Files:**
- Modify: `pure_losses.js` (`reconcileShksWrittenOffInTasks` и её вызов в `processImport`)

**Interfaces:**
- Consumes: `public.wms_pure_losses_absorb_shks(p_rows jsonb, p_actor_id text, p_actor_name text)` из Task 3.
- Produces: ничего (конечная точка цепочки).

Старая функция передавала только список ШК (`incomingShks`, плоский массив строк) — новой RPC нужны `{shk, nm, name, price, date_lost}` на каждую строку. Эти данные уже есть в `prepared.rowsByKey`/`prepared.postedRowsByKey` (объекты `{shk, nm, decription, brand, shk_state_before_lost, wh_id, date_lost, lr, price}`, `pure_losses.js:5039-5049`) — используем их прямо, не `incomingShks`.

- [ ] **Step 1: Переписать `reconcileShksWrittenOffInTasks`**

Текущая версия (добавлена в этой же сессии):

```js
    async function reconcileShksWrittenOffInTasks(shks, currentUserWhId) {
        if (!Array.isArray(shks) || !shks.length) return [];
        const user = getCurrentUser() || {};
        const actorId = user.id || user.employee_id || user.employeeId || user.user_id || user.userId || null;
        const actorName = user.name || user.fio || user.full_name || user.fullName || null;
        try {
            const { data, error } = await supabaseClient.rpc("wms_reconcile_shks_written_off", {
                p_shks: shks,
                p_actor_id: actorId ? String(actorId) : null,
                p_actor_name: actorName || null,
                p_comment: "Найден в выгрузке чистых списаний (wh_id " + currentUserWhId + ")",
            });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.warn("reconcile shks written off skipped:", error);
            return [];
        }
    }
```

Заменить на:

```js
    // Жизненный цикл ШК: выгрузка -> (возможно) предсписок -> чистые
    // списания. С момента попадания в чистые списания эта зона
    // (task_type='Чистые списания' внутри wms_tasks) авторитетна -- см.
    // wms_pure_losses_absorb_shks. prepared.rowsByKey/postedRowsByKey
    // уже несут {shk, nm, decription, price, date_lost} на каждую строку
    // (prepareIncomingRows) -- именно их передаём, а не плоский список ШК.
    function buildPureLossesAbsorbRows(prepared) {
        const rows = [];
        const seen = new Set();
        const addFrom = (map) => {
            (map instanceof Map ? map : new Map()).forEach((row) => {
                const shk = normalizeShk(row?.shk);
                if (!shk || seen.has(shk)) return;
                seen.add(shk);
                rows.push({
                    shk,
                    nm: row.nm != null ? String(row.nm) : "",
                    name: row.decription || "",
                    price: Number(row.price) || 0,
                    date_lost: row.date_lost || "",
                });
            });
        };
        addFrom(prepared?.rowsByKey);
        addFrom(prepared?.postedRowsByKey);
        return rows;
    }

    async function absorbShksIntoPureLossesZone(prepared) {
        const rows = buildPureLossesAbsorbRows(prepared);
        if (!rows.length) return [];
        const user = getCurrentUser() || {};
        const actorId = user.id || user.employee_id || user.employeeId || user.user_id || user.userId || null;
        const actorName = user.name || user.fio || user.full_name || user.fullName || null;
        try {
            const { data, error } = await supabaseClient.rpc("wms_pure_losses_absorb_shks", {
                p_rows: rows,
                p_actor_id: actorId ? String(actorId) : null,
                p_actor_name: actorName || null,
            });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.warn("absorb shks into pure losses zone skipped:", error);
            return [];
        }
    }
```

- [ ] **Step 2: Обновить вызов в `processImport`**

Текущее:

```js
            await applySyncPlan(syncPlan);
            const reconciled = await reconcileShksWrittenOffInTasks(incomingShks, currentUserWhId);

            renderSummary(syncPlan.stats);
            await refreshLastUploadedDate(currentUserWhId);
            await refreshMainDashboard(currentUserWhId);
            if (!pureTableModalEl?.classList.contains("hidden")) {
                await loadPureTableRows(currentUserWhId, { silent: true });
            }

            const updated = syncPlan.stats.insertedNew + syncPlan.stats.autoMarkedFound;
            const reconciledNote = reconciled.length ? ` Закрыто/извлечено из задач: ${reconciled.length}.` : "";
            window.MiniUI?.toast?.(`Обновление завершено. Изменено строк: ${updated}.${reconciledNote}`, { type: "success" });
```

Заменить на:

```js
            await applySyncPlan(syncPlan);
            const absorbed = await absorbShksIntoPureLossesZone(prepared);

            renderSummary(syncPlan.stats);
            await refreshLastUploadedDate(currentUserWhId);
            await refreshMainDashboard(currentUserWhId);
            if (!pureTableModalEl?.classList.contains("hidden")) {
                await loadPureTableRows(currentUserWhId, { silent: true });
            }

            const updated = syncPlan.stats.insertedNew + syncPlan.stats.autoMarkedFound;
            const absorbedNote = absorbed.length ? ` Перенесено в зону «Чистые списания»: ${absorbed.length}.` : "";
            window.MiniUI?.toast?.(`Обновление завершено. Изменено строк: ${updated}.${absorbedNote}`, { type: "success" });
```

(`incomingShks`/`collectIncomingShks` остаются как есть — используются дальше в `processImport` для `loadExistingRowsByShk` независимо от этой правки, не трогаем.)

- [ ] **Step 3: Прогнать синтаксис-чек**

Run: `node --check pure_losses.js`
Expected: без вывода.

- [ ] **Step 4: Коммит**

```bash
git add pure_losses.js
git commit -m "Переключаем pure_losses.js на wms_pure_losses_absorb_shks

Передаём {shk, nm, name, price, date_lost} на каждую строку (из
prepared.rowsByKey/postedRowsByKey) вместо плоского списка ШК -- новой
RPC нужна цена и реальная дата списания для переноса в зону «Чистые
списания»."
```

---

## Самопроверка (выполнена при написании плана)

**Покрытие спеки:**
- Прямой переход (одиночная/тара/новая) — Task 3. ✅
- Обратный переход (любая выгрузка) — Task 4. ✅
- Реальное время перехода (`date_lost`, не `now()`) — Task 3 Step 1 (`v_date_lost`, `created_at` явно переопределён). ✅
- Вердикты зоны + 2 дня отложения — Task 1. ✅
- `taskSectionName` — Task 1 Step 3. ✅
- Откат старого решения — Task 2. ✅
- `pure_losses.js`/`pure_losses.html` — Global Constraints явно фиксирует «не трогаем физически в этом плане», обоснование дано. ✅

**Проверка типов/имён между задачами:** `ZONE_VERDICTS`/`PURE_LOSSES_ZONE_VERDICT` (Task 1) используются только внутри самой Task 1 (чисто UI, не нужны SQL-задачам). Строка зоны `'Чистые списания'` — ровно одна и та же буквальная строка в Task 1 (`taskSectionName`, `ZONE_VERDICTS`), Task 3 (`v_zone`), Task 4 (`v_canonical_task_type = 'Чистые списания'`) — свёрено построчно при написании, не разошлось. `event_type` названия (`task_moved_to_pure_losses`, `task_returned_from_pure_losses`) — использованы одинаково в Task 3/4, не пересекаются с существующими `event_type` (`task_cross_module_touch` и др.) — не конфликтуют.

**Плейсхолдеров не найдено** — весь SQL/JS код в каждом шаге конечный, без TODO/заглушек.
