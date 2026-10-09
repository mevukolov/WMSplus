# ШК как первичная единица хранения — Фаза 2: зона/вердикт на ШК

**Статус:** спека на вторую фазу (см. дорожную карту в
`docs/superpowers/specs/2026-10-08-wms-task-items-normalization-design.md`).
Фаза 1 в проде: таблица `wms_task_items` существует, зеркалит `task_items`
построчно через триггер, забэкофиллена. Эта спека добавляет зону/вердикт на
уровень ШК и убирает костыль `split_from_task_id` — **включая случай ШК из
общей тары**, не только одиночные задачи (решено явно в брейнсторминге: не
откладывать общий случай на Фазу 3).

**Контекст/боль:** см. Фазу 1. Если коротко — `wms_pure_losses_absorb_shks`
сегодня создаёт отдельную строку `wms_tasks` только чтобы дать одному ШК из
общей тары собственный вердикт. Решение: зона/вердикт/статус переезжают на
строку `wms_task_items`, тара никогда не меняет состав.

## Решения, принятые в брейнсторминге

1. Состав тары (`source_payload.task_items`/`source_shk_ids`) **никогда не
   меняется** при переходе ШК в другую зону — зона живёт только на его
   собственной строке `wms_task_items`.
2. Вкладка «Чистые списания» входит в объём этой фазы (не Фазы 3) — иначе
   решение невидимо.
3. Обратный переход (`save_wms_manual_upload`) тоже входит — иначе
   двусторонняя миграция ШК тихо ломается для разошедшихся товаров.
4. Присвоение вердикта разошедшемуся ШК из общей тары **тоже** входит —
   иначе костыль не исчезает для главного сценария, ради которого всё
   затевалось, а просто внешне прячется.
5. `responsibility_zone` в `wms_task_items` **не добавляется** — не
   используется нигде в контуре «Чистые списания», лишняя сущность в этой
   фазе.
6. Зоно-специфичные поля (`pure_losses_lr`/`pure_losses_date_lost`) живут в
   новом `jsonb`-поле `zone_payload`, не в отдельных колонках — завтра
   появится другая зона со своими полями, плодить колонки не нужно.

## 1. Схема `wms_task_items`

```sql
alter table public.wms_task_items
    add column task_type text,
    add column opp_verdict text,
    add column task_status text,
    add column completed_at timestamptz,
    add column reopen_after timestamptz,
    add column zone_payload jsonb not null default '{}'::jsonb;

alter table public.wms_task_items
    add constraint wms_task_items_task_id_shk_key unique (task_id, shk);

grant select, update on public.wms_task_items to anon, authenticated;
```

`completed_at`/`reopen_after` добавлены — вердикт на уровне ШК должен уметь
то же самое "отложено до", что и вердикт на уровне задачи (`DEFERRED_VERDICT_FIELDS`/`reopenAfterForVerdict`), иначе «Отправлен на аннулирование»
(2 дня отсрочки) для разошедшегося ШК не будет работать.

Grant на `update` — впервые таблицу пишет НЕ только `security definer`-RPC,
а напрямую клиентский JS (присвоение вердикта разошедшемуся ШК, см. ниже) —
RLS по-прежнему не включаем, тем же способом, каким уже работают
`wms_tasks`/`wms_superset_cache` (грант без политики).

## 2. Триггер — upsert вместо delete+insert

Старый (Фаза 1) триггер на каждую запись полностью пересобирал строки
`wms_task_items` по `task_id` — это стирало бы разошедшуюся зону при первом
же несвязанном изменении родителя. Новая версия:

```sql
create or replace function public.wms_sync_task_items() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.wms_task_items (
        task_id, shk, nm, name, status, price, mx, movement, row_number, raw,
        task_type, opp_verdict, task_status
    )
    select
        new.id, item->>'shk', item->>'nm', item->>'name', item->>'status',
        nullif(item->>'price', '')::numeric, item->>'mx', item->>'movement',
        nullif(item->>'row_number', '')::integer, item->'raw',
        new.task_type, new.opp_verdict, new.task_status
    from jsonb_array_elements(coalesce(new.source_payload->'task_items', '[]'::jsonb)) item
    where item->>'shk' is not null
    on conflict (task_id, shk) do update set
        nm = excluded.nm,
        name = excluded.name,
        status = excluded.status,
        price = excluded.price,
        mx = excluded.mx,
        movement = excluded.movement,
        row_number = excluded.row_number,
        raw = excluded.raw,
        updated_at = now();
        -- zone-поля (task_type/opp_verdict/task_status/zone_payload/
        -- completed_at/reopen_after) НЕ в списке update -- однажды
        -- заданные (на INSERT или явной записью RPC/UI), они больше не
        -- трогаются этим триггером при любых последующих изменениях
        -- родителя.
    return new;
end;
$$;
```

**Сознательно убрано:** поведение "удалить строки для ШК, пропавших из
`task_items` родителя" (было в Фазе 1). Если ШК реально уберут из состава
(редкий путь, не используется контуром «Чистые списания» — туда ШК никогда
не попадает по этой причине), его строка `wms_task_items` просто останется
как есть, слегка устаревшей. Осознанно принятое ограничение этой фазы — не
усложнять триггер условной защитой от удаления ради кейса, который сегодня
не возникает ни в одном реальном write-пути.

## 3. `wms_pure_losses_absorb_shks` — переписываем, 2 ветки вместо 3

```sql
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
        v_lr := nullif(v_row->>'lr', '')::integer;
        v_date_lost := coalesce(public.wms_safe_timestamptz(v_row->>'date_lost'), now());

        -- Идемпотентность теперь проверяем на уровне ШК, не строки задачи --
        -- зона может быть "Чистые списания" на одной строке wms_task_items,
        -- даже если task_type родителя другой.
        if exists (select 1 from public.wms_task_items where shk = v_shk and task_type = v_zone) then
            continue;
        end if;

        select id into v_task_id
        from public.wms_tasks
        where is_deleted = false and source_shk_ids @> array[v_shk]
        order by created_at asc
        limit 1;

        if v_task_id is null then
            -- Орфан -- ни в одной активной задаче такого ШК нет. Заводим
            -- минимальную строку целиком в зоне (она и так состоит из
            -- одного этого ШК -- "вся строка в зоне" здесь не конфликтует
            -- ни с чем).
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
            -- wms_task_items для этой строки создаёт INSERT-триггер сам,
            -- наследуя task_type='Чистые списания' с родителя -- остаётся
            -- только дописать zone_payload ниже.
        end if;

        -- Единая точка: что бы ни было строкой-источником (найденная
        -- активная задача ИЛИ только что созданный орфан) -- зона/вердикт
        -- пишутся ТОЛЬКО на строку конкретного ШК, состав/task_type
        -- родителя не трогаем вообще.
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

        v_results := v_results || jsonb_build_object('shk', v_shk, 'task_id', v_task_id, 'action', 'zoned_in_place');
    end loop;

    return v_results;
end;
$$;
```

Больше нет `split_from_task_id`, нет пересчёта `priority`/`price_sum`
родителя, нет создания новой строки для ШК из общей тары — состав тары
просто не трогается.

## 4. `save_wms_manual_upload` — обратный переход на уровне ШК

Старая ветка «возврат из зоны» (ищет `wms_tasks.task_type = 'Чистые
списания'` по канонической строке) остаётся как есть — она всё ещё верна
для строк, которые ЦЕЛИКОМ в зоне (орфаны, созданные веткой выше, и
исторические строки до Фазы 2). Добавляется НОВЫЙ, независимый шаг,
выполняющийся после определения `v_canonical_id` (для обеих существующих
веток — и «возврат из зоны», и «кросс-модульное касание»): сброс
разошедшихся ШК внутри `v_source_shk_ids` на уровне `wms_task_items`.

**Точная точка вставки:** сразу после блока
```sql
select id, task_type into v_canonical_id, v_canonical_task_type
from public.wms_tasks
where is_deleted = false
  and source_shk_ids && v_source_shk_ids
  and not (source_module = v_source_module and task_type = v_task_type)
order by created_at asc
limit 1;
```
и **до** `if v_canonical_id is not null and v_canonical_task_type = 'Чистые списания' then` — то есть этот шаг выполняется безусловно (если `v_canonical_id is not null`), а существующие две ветки (`if ... 'Чистые списания' then ... continue;` и `if v_canonical_id is not null then ... continue;`) идут после него без изменений:

```sql
update public.wms_task_items
set task_type = v_task_type,
    opp_verdict = v_opp_verdict,
    task_status = v_task_status,
    completed_at = null,
    reopen_after = null,
    zone_payload = '{}'::jsonb,
    updated_at = timezone('utc', now())
where task_id = v_canonical_id
  and shk = any(v_source_shk_ids)
  and task_type = 'Чистые списания';

if found then
    insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
    select v_canonical_id, 'task_item_returned_from_pure_losses', 'Система', '',
           jsonb_build_object('shk', shk, 'new_module', v_source_module, 'new_task_type', v_task_type)
    from public.wms_task_items
    where task_id = v_canonical_id and shk = any(v_source_shk_ids);
end if;
```

Это условие НЕ пересекается с условием старой ветки «возврат из зоны целиком»
(та требует `v_canonical_task_type = 'Чистые списания'` — строка целиком;
новый шаг целится в отдельные строки `wms_task_items`, независимо от
`task_type` родителя) — оба механизма сосуществуют, каждый покрывает свой
исторический слой данных.

**Важно про exact-match ветку** (самая первая, `source_module = ... and
source_id = ... and task_type = ...`): туда это НЕ добавляется — повторная
ежедневная выгрузка ПОД ТЕМ ЖЕ источником не считается «появлением в ДРУГОЙ
выгрузке» и не должна снимать зону (см. обоснование в брейнсторминге).

## 5. Вкладка «Чистые списания» — прямой запрос к `wms_task_items`

Сейчас `state.pureLosses.rows` — это фильтр по `state.review.rows`
(гранулярность задачи). При разошедшейся таре это неверно: строка задачи
может содержать и зонированные, и обычные ШК одновременно. Переходим на
гранулярность ШК:

```js
const WMS_TASK_ITEMS_TABLE = "wms_task_items";

async function loadPureLossesRows() {
    if (state.pureLosses.loadPromise) return state.pureLosses.loadPromise;
    state.pureLosses.loadPromise = (async () => {
        state.pureLosses.loading = true;
        renderPureLosses();
        try {
            const db = supabaseDb();
            const { data, error } = await db
                .from(WMS_TASK_ITEMS_TABLE)
                .select("id,task_id,shk,nm,name,price,task_type,opp_verdict,task_status,zone_payload")
                .eq("task_type", "Чистые списания")
                .neq("task_status", "Завершено");
            if (error) throw error;
            state.pureLosses.rows = data || [];
            state.pureLosses.loaded = true;
        } catch (error) {
            console.error("pure losses load failed:", error);
            state.pureLosses.rows = [];
            toast("Не удалось загрузить чистые списания: " + (error && error.message ? error.message : String(error)), "error");
        } finally {
            state.pureLosses.loading = false;
            state.pureLosses.loadPromise = null;
            animateReviewShellHeightChange(() => renderPureLosses());
        }
    })();
    return state.pureLosses.loadPromise;
}

function pureLossesRowLr(row) {
    const value = Number(row && row.zone_payload && row.zone_payload.pure_losses_lr);
    return Number.isFinite(value) ? value : null;
}

function pureLossesRowMonthKey(row) {
    const date = normalizeText(row && row.zone_payload && row.zone_payload.pure_losses_date_lost);
    return date ? date.slice(0, 7) : "";
}
```

`isPureLossesZoneTask(row)` (использовалась для фильтрации обычных
`wms_tasks`-строк в `reviewGroupedRows`, чтобы зона не утекала в «Другие
задачи») — остаётся как есть, продолжает работать на уровне строки задачи
для ОРФАНОВ (где родитель целиком в зоне); для разошедшихся ШК внутри общей
тары родитель и так не меняет `task_type`, так что в `reviewGroupedRows` он
и не должен попадать как зона — там он просто продолжает числиться в своём
обычном участке, что и требуется (сосед по таре не пропадает из
«Предразбора»).

`renderPureLossesTable` переписывается на прямые поля строки
`wms_task_items` (`row.shk`, `row.name`, `row.nm`, `row.price`,
`row.zone_payload.pure_losses_date_lost`) вместо `taskPayload`/`taskItems`.
Клик открывает составной id:

```js
tr.addEventListener("click", () => openTaskDetail(row.task_id + "::" + row.shk, "review"));
```

## 6. Карточка задачи для одного ШК внутри общей тары — составной id

**Формат:** `"<task_id>::<shk>"`. Новый хелпер:

```js
function parseCompositeTaskItemId(id) {
    const raw = normalizeText(id);
    const sep = raw.indexOf("::");
    if (sep < 0) return null;
    return { taskId: raw.slice(0, sep), shk: raw.slice(sep + 2) };
}
```

**`findTaskRow`** — в начале добавляется:
```js
function findTaskRow(id) {
    if (state.taskDetail && state.taskDetail.rowId === id && state.taskDetail.syntheticRow) {
        return state.taskDetail.syntheticRow;
    }
    return (state.review.rows || []).find((row) => row.id === id)
        || (state.inactive.rows || []).find((row) => row.id === id)
        || (state.taskSearch.rows || []).find((row) => row.id === id)
        || (state.noShkQueue.rows || []).find((row) => row.id === id)
        || null;
}
```

**`openTaskDetail`** — в начале, до текущей логики:
```js
async function openTaskDetail(id, source) {
    const composite = parseCompositeTaskItemId(id);
    if (composite) return openPureLossesItemDetail(composite.taskId, composite.shk, id);
    // ...существующий код без изменений...
}

async function openPureLossesItemDetail(taskId, shk, compositeId) {
    const db = supabaseDb();
    if (!db) return;
    const parentRow = findTaskRow(taskId) || await (async () => {
        const { data } = await db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).eq("id", taskId).maybeSingle();
        return data;
    })();
    const { data: item, error } = await db
        .from(WMS_TASK_ITEMS_TABLE)
        .select("task_id,shk,nm,name,price,task_type,opp_verdict,task_status,zone_payload,completed_at,reopen_after")
        .eq("task_id", taskId).eq("shk", shk).maybeSingle();
    if (error || !item || !parentRow) return;
    const syntheticRow = {
        ...parentRow,
        id: compositeId,
        task_type: item.task_type,
        opp_verdict: item.opp_verdict,
        task_status: item.task_status,
        completed_at: item.completed_at,
        reopen_after: item.reopen_after,
        source_shk_ids: [item.shk],
        source_tare_id: null, // isTareTask(row) должна вернуть false -- синтетическая строка всегда "один ШК", кнопки "Отделить ШК"/"Редактировать тару" гейтятся на isTareTask и сами скроются
        source_price_sum: item.price,
        title: "ШК " + item.shk,
        source_payload: {
            ...taskPayload(parentRow),
            item_name: item.name,
            task_items: [{ shk: item.shk, nm: item.nm, name: item.name, price: item.price, status: "", movement: "", mx: "" }],
            pure_losses_lr: item.zone_payload && item.zone_payload.pure_losses_lr,
            pure_losses_date_lost: item.zone_payload && item.zone_payload.pure_losses_date_lost,
        },
        __syntheticParentId: taskId,
        __syntheticShk: item.shk,
    };
    if (state.taskDetail && state.taskDetail.countdownTimer) clearInterval(state.taskDetail.countdownTimer);
    state.taskDetail = { rowId: compositeId, source: "review", syntheticRow, editRowId: "", deferRowId: "", reopenRowId: "", splitRowId: "", splitShk: "", expensiveConfirmRowId: "", countdownTimer: null };
    setFlowModalOpen("taskDetailModal", true);
    renderTaskDetail(syntheticRow);
}
```

Flow-lock/embedded-режим и `hydrateFullTaskRow`/`__isLight`-гидратация
намеренно пропускаются — зона «Чистые списания» не участвует в Флоу-очереди,
эти концепции к ней неприменимы.

**`completeTaskFromDetail`** — guard в самом начале, до всей существующей
логики (которая остаётся без изменений для обычных id):

```js
async function completeTaskFromDetail(id, options) {
    if (state.taskDetail && state.taskDetail.rowId === id && state.taskDetail.syntheticRow) {
        return completePureLossesItemFromDetail(id, options);
    }
    // ...существующий код без изменений...
}

async function completePureLossesItemFromDetail(id, options) {
    const synthetic = state.taskDetail.syntheticRow;
    const db = supabaseDb();
    if (!db) return;
    const user = currentWmsUser();
    const verdict = normalizeText($("taskVerdictInput") && $("taskVerdictInput").value) || "Не выбран";
    const rawComment = normalizeText($("taskCommentInput") && $("taskCommentInput").value);
    const extraLabel = DEFERRED_VERDICT_FIELDS[verdict] || "";
    const extraValue = normalizeText($("taskExtraInput") && $("taskExtraInput").value);
    const tone = VERDICT_TONE[verdict] || "";
    if ((tone === "red" && !rawComment) || verdict === "Не выбран" || (extraLabel && !extraValue)) {
        const status = $("taskDetailStatus");
        if (status) status.textContent = "Заполни вердикт и обязательное поле по выбранному вердикту.";
        return;
    }
    const now = new Date().toISOString();
    const isDeferred = Object.prototype.hasOwnProperty.call(DEFERRED_VERDICT_FIELDS, verdict);
    const reopenAfter = isDeferred ? reopenAfterForVerdict(verdict, synthetic, null) : null;
    const button = $("completeTaskBtn");
    if (button) button.disabled = true;
    try {
        const { error } = await db
            .from(WMS_TASK_ITEMS_TABLE)
            .update({
                opp_verdict: verdict,
                task_status: isDeferred ? "Отложено" : "Завершено",
                completed_at: now,
                reopen_after: reopenAfter,
                updated_at: now,
            })
            .eq("task_id", synthetic.__syntheticParentId)
            .eq("shk", synthetic.__syntheticShk);
        if (error) throw error;
        void writeTaskHistory(
            { id: synthetic.__syntheticParentId },
            isDeferred ? "task_deferred" : "task_completed",
            {
                title: displayTaskTitle(synthetic),
                verdict,
                comment: rawComment,
                extra_label: extraLabel,
                extra_value: extraValue,
                completed_by_id: user.id || null,
                completed_by_name: user.name || null,
                reopen_after: reopenAfter,
                shk: synthetic.__syntheticShk,
            }
        );
        state.pureLosses.rows = (state.pureLosses.rows || []).filter(
            (row) => !(row.task_id === synthetic.__syntheticParentId && row.shk === synthetic.__syntheticShk)
        );
        setReviewStatus(isDeferred ? "ШК отложен до " + formatRuDateTime(reopenAfter) + "." : "ШК завершён.", "good");
        renderPureLosses();
        closeTaskDetail();
    } catch (error) {
        console.error("pure losses item complete failed:", error);
        const status = $("taskDetailStatus");
        if (status) status.textContent = "Не удалось сохранить: " + (error && error.message ? error.message : String(error));
    } finally {
        if (button) button.disabled = false;
    }
}
```

Сознательно НЕ переносится в этот путь: writeback в источник (пишется для
обычных задач, у `pure_losses`-происхождения своего источника для
обратной записи нет), ачивки/Флоу-очередь (эта зона не входит в Флоу),
празднование (`playTaskCompletionCelebration`) — всё это специфично для
обычного потока разбора, не для системной зоны списаний.

## Явно вне объёма Фазы 2

- «Отделить ШК»/«Редактировать тару» для составного id не актуальны и не
  требуют отдельного скрытия кодом: синтетическая строка всегда
  `source_tare_id: null` + `source_shk_ids` из одного элемента, поэтому
  `isTareTask(syntheticRow)` возвращает `false` сама по себе, и эти кнопки
  (гейтящиеся на `isTareTask`) не рендерятся — тот же путь, что и для любой
  обычной нетарной задачи сегодня.
- Переоткрытие (`reopenTaskFromDetail`) для составного id не проверялось и
  не поддерживается в этой фазе явно — если потребуется, уйдёт отдельным
  пунктом в Фазу 3.
- Миграция остальных мест чтения `opp_verdict`/`task_status`/`task_type`
  (поиск, дашборды, отчётность) — Фаза 3, не трогается.
- Обобщение item-scoped карточки на зоны, кроме «Чистые списания» — когда
  появится вторая такая зона, реализовывать по аналогии отдельным заходом.

## Тестирование

Та же дисциплина, что в Фазе 1 — `begin; ...; rollback;` перед реальным
применением каждой миграции:
- `wms_sync_task_items`: вставка новой задачи (инициализирует zone-поля из
  родителя), обновление source_payload существующей (zone-поля НЕ меняются
  на уже существующей строке, снэпшот-поля обновляются).
- `wms_pure_losses_absorb_shks`: (а) ШК — единственный в задаче →
  зонируется на месте, родитель не создаёт новую строку; (б) ШК — один из
  нескольких в общей таре → зонируется только его строка, остальные строки
  `wms_task_items` и сама строка `wms_tasks` не меняются вообще; (в) ШК не
  найден нигде → как и раньше, заводится новая лёгкая строка.
- `save_wms_manual_upload`: разошедшийся ШК повторно всплывает в другой
  выгрузке → его строка `wms_task_items` возвращается к новому
  `task_type`/`opp_verdict`, соседи по таре не трогаются; повторная
  выгрузка ПОД ТЕМ ЖЕ источником (exact-match) НЕ снимает зону.
- JS: `node --check tasks.js` после всех правок; живое браузерное QA этой
  сессией недоступно (тот же auth-барьер, что и в Фазе 1 Кандидата А) — об
  этом нужно прямо сказать пользователю при сдаче, не выдавать
  непроверенное за проверенное.
