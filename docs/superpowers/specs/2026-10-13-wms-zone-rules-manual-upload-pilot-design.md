# Движок правил в ручной выгрузке: пилот marketplace_pc

## Контекст

Сегодня в проде работают ДВЕ параллельные, никак не связанные системы
классификации ШК по участкам:

1. **Актуализация Superset** -- триггер на `wms_superset_cache`
   (миграция `202610130010`) вызывает `wms_apply_routing_rules`/
   `wms_compute_reroute_target`, которые читают `wms_routing_rules` и
   решают зону через `wms_rule_conditions_match`. Решает зону только
   для "осиротевших" ШК без активной задачи и переклассифицирует уже
   лежащие в работе.
2. **Ручная выгрузка по модулям** (packaging/rwp/pm/presort/
   marketplace_pc/wmi_mp_pc/no_order/after_sale_movement) -- JS-функции
   `build*Preview` в tasks.js решают участок хардкодом (функции вида
   `isMarketplaceStatus`/`isPcStatus`/`mxHasBuffer` и т.п.), НИКОГДА не
   обращаются к движку правил. `save_wms_manual_upload` получает уже
   полностью готовый `task_type` от клиента.

Пользователь явно сформулировал принцип: "как актуализация, так и
выгрузки ручные должны гнаться через одинаковые движки правил" --
обе системы должны принимать решение через ОДИН и тот же механизм
(`wms_rule_conditions_match`), а не через две независимые реализации
одной и той же бизнес-логики на двух языках.

Это первый шаг такого объединения -- пилот на одном, самом маленьком
модуле (`marketplace_pc`, 2 под-зоны: Маркетплейс/ПЦ). Остальные 7
модулей, группировка в тару, `wms_module_settings` -- отдельные,
более поздние суб-проекты, намеренно не в этом спеке.

## Разбор уже найденных пробелов из итогов дня

Исходные 5 пунктов и что с ними происходит в этом пилоте:

1. **Группировка в тару** -- не трогаем. `appendGroupedTasks` и вся
   логика "какие статусы объединяем в одну тару" остаются ровно как
   сегодня (хардкод по `row.corrugated`, пороги вроде "дешевле 1000₽
   -- пропустить"). Движок правил решает только "в какую под-зону
   (Маркетплейс/ПЦ) кладём строку", группировка этим решением не
   управляется.
2. **Нет оператора "не равно"** -- закрываем в этом пилоте:
   `wms_rule_conditions_match` получает новый оператор `not_contains`
   (единственный реально нужный сегодня случай --
   `!mxHasBuffer(row)`/МХ-буфер-исключение). Чистое добавление нового
   `elsif`-случая в уже существующий if/elsif-чейн -- поведение всех
   остальных операторов не меняется.
3. **`wms_module_settings` пустая/не используется** -- не трогаем в
   этом пилоте, остаётся отдельной задачей.
4. **Ни одно правило не прогонялось на реальном потоке** -- закрывается
   естественно: после этого пилота у нас впервые появляется путь,
   где активация правил `marketplace_pc` реально повлияет на живую
   ручную выгрузку, с контролируемой, явной активацией (см. "Выкатка"
   ниже).
5. **Движок не подключён к ручной выгрузке (главный)** -- решается этим
   пилотом: `buildMarketplacePcPreview` зовёт новый RPC
   `wms_evaluate_rule_batch` вместо `isMarketplaceStatus`/`isPcStatus`/
   `mxHasBuffer`.

## Архитектура

### 1. Новый RPC: `wms_evaluate_rule_batch`

Пакетная версия уже существующего `wms_evaluate_rule(p_output_key,
p_attributes)` (Фаза 2b подпроект 1) -- та же логика матчинга, но на
массив строк за один вызов (важно для производительности: без этого
ручная выгрузка делала бы по вызову на каждую строку файла, что уже
один раз сегодня приводило к незамеченному таймауту на батче
в несколько тысяч строк).

```sql
create or replace function public.wms_evaluate_rule_batch(p_output_key text, p_rows jsonb)
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
    v_results jsonb := '[]'::jsonb;
begin
    if p_rows is null or jsonb_array_length(p_rows) = 0 then
        return v_results;
    end if;

    for v_row in select * from jsonb_array_elements(p_rows) loop
        v_row_id := v_row->>'row_id';
        v_attributes := v_row - 'row_id';

        v_rule := null;
        for v_rule in
            select * from public.wms_routing_rules
            where is_active = true and output_key = p_output_key
            order by priority asc
        loop
            if public.wms_rule_conditions_match(v_rule.conditions, v_attributes) then
                exit;
            end if;
            v_rule := null;
        end loop;

        v_results := v_results || jsonb_build_object(
            'row_id', v_row_id,
            'rule_id', case when v_rule is null then null else v_rule.id end,
            'rule_name', case when v_rule is null then null else v_rule.name end,
            'output_value', case when v_rule is null then null else v_rule.output_value end
        );
    end loop;

    return v_results;
end;
$$;

grant execute on function public.wms_evaluate_rule_batch(text, jsonb) to anon, authenticated;
```

Контракт: `p_rows` -- jsonb-массив объектов `{row_id, <атрибуты>}`,
`row_id` -- любой уникальный в пределах вызова идентификатор,
выбираемый клиентом (в этом пилоте -- строковый индекс в пачке).
Атрибуты -- тот же мешок, что уже понимает `wms_rule_conditions_match`
(`status`/`mx`/`price`/`tare_id`/`route_number`). Возврат -- jsonb-
массив `{row_id, rule_id, rule_name, output_value}`, `rule_id`/
`output_value` равны `null`, если ни одно активное правило не
подошло.

### 2. Новый оператор `not_contains`

Добавляется в `wms_rule_conditions_match` рядом с уже существующим
`contains` (файл `202610130014_wms_rule_conditions_match.sql`,
единственная точка правки):

```sql
elsif v_op = 'not_contains' then
    if v_actual_text is not null and position(lower(v_value#>>'{}') in lower(v_actual_text)) > 0 then return false; end if;
```

Семантика совпадает с `!mxHasBuffer(row)`: отсутствующий/null МХ
считается "не содержит", условие проходит.

### 3. Обновление 8 черновых правил (миграция, правила остаются `is_active = false`)

К каждому из 8 существующих правил `output_key='zone'` с
`target_task_type` в (`Маркетплейс`, `ПЦ`, `WMI (МП + ПЦ)`)
добавляется условие `{"attribute": "mx", "operator": "not_contains",
"value": "буфер"}` -- воспроизводит `!mxHasBuffer(row)`, который в
хардкоде применяется ко всем этим веткам одинаково.

```sql
update public.wms_routing_rules
set conditions = conditions || jsonb_build_array(jsonb_build_object('attribute', 'mx', 'operator', 'not_contains', 'value', 'буфер'))
where output_key = 'zone'
  and target_task_type in ('Маркетплейс', 'ПЦ', 'WMI (МП + ПЦ)');
```

Правила остаются `is_active = false` -- эта миграция сама по себе не
меняет ничего в проде (условия неактивных правил ни на что не влияют).

### 4. `buildMarketplacePcPreview`: переписанная логика + fallback на хардкод

Ключевой принцип безопасного раската: если движок НЕ нашёл ни одного
активного правила для строки (сегодня -- для 100% строк, все 8
правил выключены), код построчно откатывается на старый хардкод
(`isMarketplaceStatus`/`isPcStatus`/`mxHasBuffer`). Никакого отдельного
флага-переключателя -- единственный источник правды остаётся
`is_active` на `wms_routing_rules`, как и везде в проекте. По мере
включения конкретных правил движок берёт на себя всё больше строк;
хардкод остаётся постоянной подстраховкой на случай непокрытых
правилами случаев и сетевых сбоев RPC.

Новые вспомогательные функции (рядом с `isMarketplaceStatus` и т.п.,
tasks.js ~15055-15086):

```js
function zoneRuleAttributesForRow(row) {
    return { status: row.product_status, mx: row.mx };
}

async function evaluateZoneRulesBatch(rows) {
    const decisions = new Array(rows.length).fill(null);
    const db = supabaseDb();
    if (!db || !rows.length) return decisions;
    for (let offset = 0; offset < rows.length; offset += SUPERSET_CACHE_CHUNK_SIZE) {
        const chunk = rows.slice(offset, offset + SUPERSET_CACHE_CHUNK_SIZE);
        const payload = chunk.map((row, index) => ({ row_id: String(offset + index), ...zoneRuleAttributesForRow(row) }));
        try {
            const { data, error } = await db.rpc("wms_evaluate_rule_batch", { p_output_key: "zone", p_rows: payload });
            if (error) throw error;
            (data || []).forEach((item) => {
                const idx = Number(item.row_id);
                if (Number.isFinite(idx) && item.output_value && item.output_value.target_task_type) {
                    decisions[idx] = item.output_value.target_task_type;
                }
            });
        } catch (error) {
            console.warn("zone rule batch evaluation failed, falling back to hardcoded classification for this chunk:", error);
        }
    }
    return decisions;
}
```

`buildMarketplacePcPreview` (было: tasks.js:15878-15893), теперь
`async`:

```js
async function buildMarketplacePcPreview(sourceRows, businessDate, specialMap) {
    specialMap = specialMap || new Map();
    const marketplaceDef = moduleDef("marketplace");
    const pcDef = moduleDef("pc");
    const marketplaceDate = state.manualDate ? businessDate : uploadDateForModule("marketplace");
    const pcDate = state.manualDate ? businessDate : uploadDateForModule("pc");
    const marketplaceDateRows = sourceRows.filter((row) => parseDateTime(row.created_at).date === marketplaceDate);
    const pcDateRows = sourceRows.filter((row) => parseDateTime(row.created_at).date === pcDate);
    const candidateRows = Array.from(new Set(marketplaceDateRows.concat(pcDateRows)));
    const decisions = await evaluateZoneRulesBatch(candidateRows);
    const zoneByRow = new Map();
    candidateRows.forEach((row, index) => { zoneByRow.set(row, decisions[index]); });
    const marketplaceRows = marketplaceDateRows.filter((row) => {
        const decided = zoneByRow.get(row);
        if (decided) return decided === marketplaceDef.column;
        return isMarketplaceStatus(row) && !mxHasBuffer(row);
    });
    const pcRows = pcDateRows.filter((row) => {
        const decided = zoneByRow.get(row);
        if (decided) return decided === pcDef.column;
        return isPcStatus(row) && !isMarketplaceStatus(row) && !mxHasBuffer(row);
    });
    const marketplace = appendGroupedTasks(marketplaceRows, { module: "marketplace", sourceModule: marketplaceDef.sourceModule, uploadType: marketplaceDef.uploadType, businessDate: marketplaceDate, sourcePrefix: "marketplace", titlePrefix: "Маркетплейс", taskType: marketplaceDef.taskType, descriptionTaskType: marketplaceDef.taskTypeLabel, column: marketplaceDef.column, dueDate: dueDateForBusinessDate("marketplace", marketplaceDate), responsibilityZone: marketplaceDef.responsibilityZone, specialMap });
    const pc = appendGroupedTasks(pcRows, { module: "pc", sourceModule: pcDef.sourceModule, uploadType: pcDef.uploadType, businessDate: pcDate, sourcePrefix: "pc", titlePrefix: "ПЦ", taskType: pcDef.taskType, descriptionTaskType: pcDef.taskTypeLabel, column: pcDef.column, dueDate: dueDateForBusinessDate("pc", pcDate), responsibilityZone: pcDef.responsibilityZone, specialMap });
    const tasks = marketplace.tasks.concat(pc.tasks);
    const targetDates = new Set([marketplaceDate, pcDate]);
    return { mode: "marketplace_pc", sourceRows: sourceRows.length, rowsCount: marketplaceRows.length + pcRows.length, dateFilteredOut: sourceRows.filter((row) => !targetDates.has(parseDateTime(row.created_at).date)).length, marketplaceRows: marketplaceRows.length, pcRows: pcRows.length, groupedTareCount: marketplace.groupedTareCount + pc.groupedTareCount, specialCount: marketplace.specialCount + pc.specialCount, specialCandidateIds: productIdsFromRows(marketplaceRows.concat(pcRows)), tasks, marketplaceTasks: marketplace.tasks.length, pcTasks: pc.tasks.length };
}
```

Разница с оригиналом -- только то, как вычисляются `marketplaceRows`/
`pcRows` (через `zoneByRow`, с built-in fallback). Всё остальное
(группировка, due date, цены, `specialMap`) -- побайтово то же самое.

**Важно про `task_type`:** финальная строка `task_type`, которая
попадёт в `wms_tasks`, как и сегодня берётся из `moduleDef(...).taskType`
(`"Разбор ОПП // Маркетплейс"`/`"Разбор ОПП // ПЦ"`, с припиской).
Движок правил решает только КУДА положить строку (marketplace vs pc),
сравнивая свой bare-ответ (`"Маркетплейс"`/`"ПЦ"`) с
`moduleDef(...).column`, который как раз хранит тот же bare-текст.
Формат итоговых данных в `wms_tasks` не меняется вообще -- меняется
только механизм принятия решения.

### 5. Async-рипл: `buildPreviewForModule` + 9 вызовов

`buildPreviewForModule` (tasks.js:15954-15964) становится `async`:

```js
async function buildPreviewForModule(module, rows, carrierRows, businessDate, specialMap) {
    specialMap = specialMap || new Map();
    if (module === "packaging" || module === "rwp") return buildPackagingPreview(rows, module, businessDate, specialMap);
    if (module === "pm") return buildPmPreview(rows, carrierRows || [], businessDate, specialMap);
    if (module === "presort") return buildPresortPreview(rows, businessDate, specialMap);
    if (module === "marketplace_pc") return buildMarketplacePcPreview(rows, businessDate, specialMap);
    if (module === "wmi_mp_pc") return buildWmiMpPcPreview(rows, businessDate, specialMap);
    if (module === "no_order") return buildNoOrderPreview(rows, businessDate, specialMap);
    if (module === "after_sale_movement") return buildAfterSaleMovementPreview(rows, businessDate, specialMap);
    return { mode: module, tasks: [] };
}
```

(Единственная правка тела -- добавление `async` в сигнатуру; остальные
7 веток по-прежнему синхронны внутри, но async-функция автоматически
оборачивает любой return в Promise -- вызывающему коду важно только,
что результат теперь нужно `await`-ить, независимо от модуля.)

Все 9 вызовов уже находятся внутри `async`-функций или `async`
IIFE -- ни один не требует правки своего КОНТЕЙНЕРА, только добавления
`await`/`Promise.all`:

1. tasks.js:15997 (внутри `async`-IIFE в `startSpecialBackground`):
   `const enriched = buildPreviewForModule(...)` → `const enriched = await buildPreviewForModule(...)`.
2. tasks.js:16043 (`handleSingleFile`, ветка `module === "pm"`):
   `state.preview = buildPreviewForModule(...)` → `state.preview = await buildPreviewForModule(...)`.
3. tasks.js:16051 (`handleSingleFile`, общая ветка): то же самое --
   добавить `await`.
4. tasks.js:16064 (`handleCarrierFile`): добавить `await`.
5. tasks.js:16074 (`skipCarrierFile`): добавить `await`.
6. tasks.js:18426 (`handleMasterFile`): добавить `await`.
7. tasks.js:18518 (`buildMasterPreview`, внутри `for`-цикла): добавить
   `await` перед вызовом.
8. tasks.js:18582 (внутри `async`-IIFE в `startMasterSpecialBackground`)
   -- единственное место, где вызов происходит внутри `.map()`:
   ```js
   // было
   const modules = masterPreviewJobs(dates).map((job) => ({ module: job.module, date: job.date, preview: buildPreviewForModule(job.module, job.rows, job.carrierRows, job.date, specialMap) }));
   // стало
   const modules = await Promise.all(masterPreviewJobs(dates).map(async (job) => ({ module: job.module, date: job.date, preview: await buildPreviewForModule(job.module, job.rows, job.carrierRows, job.date, specialMap) })));
   ```

Все остальные модули (`packaging`/`rwp`/`pm`/`presort`/`wmi_mp_pc`/
`no_order`/`after_sale_movement`) продолжают вычисляться мгновенно
(их функции остаются синхронными) -- `await` на их результате
разрешается на том же тике, задержка появляется только у реального
сетевого RPC для `marketplace_pc`.

## Выкатка

Два отдельных шага, как и с прошлыми посевами сегодня:

**Шаг 1 (этот план):** весь код -- миграции (RPC, `not_contains`,
обновление условий 8 правил) и JS (RPC-вызов, async-рипл) --
выкатывается с правилами как есть, `is_active = false`. Поведение
ручной выгрузки `marketplace_pc` не меняется ни на бит: 100% строк
идёт через fallback-ветку (`isMarketplaceStatus`/`isPcStatus`/
`mxHasBuffer`), идентичную сегодняшней.

**Шаг 2 (отдельно, по явному запросу):** включение конкретных правил
(`is_active = true`) -- после того как шаг 1 проверен живыми
begin/rollback-тестами и задеплоен. Это тот самый момент, когда
правила реально начинают решать за реальный поток (закрывает пункт 4
из итогов дня). Активировать можно по одному правилу и смотреть
эффект, не обязательно все 8 разом.

## Что НЕ входит в объём

- Остальные 7 модулей ручной выгрузки -- отдельные будущие
  суб-проекты, по тому же шаблону (новый `evaluateZoneRulesBatch`-
  хелпер и fallback-паттерн уже переиспользуемы).
- Группировка в тару -- остаётся файловой/хардкодной, как
  зафиксировано в итогах дня.
- `wms_module_settings` -- остаётся пустой, не подключается к этому
  пилоту.
- Изменение формата `task_type`, хранимого в `wms_tasks` -- явно
  подтверждено, что не меняем (см. раздел 4).

## Следующий этап (подтверждено пользователем, не в этом пилоте)

Два пункта из "Что НЕ входит в объём" выше явно подтверждены как
обязательные для следующей фазы, не просто бессрочно отложенные:

- **Группировка в тару через правила** -- сегодня `forceTareGrouping`/
  ключ группировки (`corrugated` vs `tare_id` vs особая логика ПМ/
  Почты) остаются хардкодом; следующий шаг -- перенести и это решение
  в движок (отдельный суб-проект, сложнее текущего пилота -- см.
  раздел "Разбор уже найденных пробелов").
- **Подключить `wms_module_settings`** -- таблица существует и
  API (`wms_module_setting`) готов с Фазы 2b, но ни один модуль ей не
  пользуется; следующий шаг -- найти первый реальный статический
  параметр (не условный, без if-то) и завести его через эту таблицу
  вместо хардкода в `DEFAULT_MODULES`.
