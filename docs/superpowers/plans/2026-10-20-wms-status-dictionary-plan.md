# Словарь статусов Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (пользователь явно попросил инлайн-исполнение в этой же сессии, без subagent-driven). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Единая таблица `wms_status_dictionary` (отчёт+статус → название/срок списания/срок разбора/участок по умолчанию), поглощающая `wms_writeoff_terms` и JS-хардкод фоллбэк классификации, плюс пересборка журнала покрытия (`wms_upload_coverage_log`) на статусный ключ.

**Architecture:** Новая таблица — точка входа для классификации ШК, сроков и журнала покрытия. `wms_routing_rules` НЕ меняется структурно (движок условий остаётся как есть) — связь со словарём вычисляется на лету сканированием `conditions`. Раскатка в 4 аддитивных этапа: (1) таблица+сид+админка, (2) переключение классификации/сроков, (3) пересборка журнала покрытия, (4) чистка мёртвого кода.

**Tech Stack:** Supabase/Postgres (миграции через `supabase db query --linked --file`), ванильный JS (`tasks.js`), HTML (`tasks.html`).

**Spec:** `docs/superpowers/specs/2026-10-20-wms-status-dictionary-design.md`

## Global Constraints

- Миграции применяются через `supabase db query --linked --file <path>` (НЕ `db push` -- падает с LegacyDbConnectError), затем регистрируются вручную: `insert into supabase_migrations.schema_migrations (version, name, statements) values ('<version>', '<name>', array['select 1']) on conflict (version) do nothing;` (тоже через `db query --file`).
- Следующий свободный префикс миграции: `202610200004` (проверено `ls supabase/migrations | sort | tail`).
- Каждая SQL-задача: сначала `begin;...rollback;` тест (синтетические edge-кейсы + regression-проверка на реальных живых данных), и только потом реальное применение.
- Каждая JS-задача: `node --check tasks.js` после изменения.
- `updated_at` на новых таблицах выставляется вручную в JS при сохранении (`new Date().toISOString()`), без БД-триггера -- тот же паттерн, что уже используют `saveRoutingRulesFromModal`/routing rules admin (`tasks.js:13293-13296`).
- Коммит и пуш в `main` после каждой задачи.
- Явно вне рамок (не трогать ни в одной задаче): движок условий `wms_routing_rules` (conditions/AND-OR/операторы/приоритет/группировка/теги/`upload_offset_days` на уровне правила), filter-правила, экран админки правил маршрутизации как таковой (только новая точка входа + фильтр).
- Живой аудит активных правил (снят перед планом) подтвердил: ВСЕ zone-правила `general`/`no_order`/`packaging` с конкретным статусом используют `{attribute:'status', operator:'in', value:[...]}`. Три правила не привязаны к статусу вовсе (catch-all, см. спеку): `after_sale_movement`/"единственная зона" (`status not_contains '__никогда_не_встретится__'`), `no_order`/"Без заказа (по умолчанию)" (та же сигнатура), `packaging`/"Упаковка (по умолчанию)" (`status not_contains 'RWP'`).

---

## Этап 1: Таблица словаря + сид + экран админки

### Task 1: Миграция -- таблица `wms_status_dictionary`

**Files:**
- Create: `supabase/migrations/202610200004_wms_status_dictionary.sql`

**Interfaces:**
- Produces: таблица `public.wms_status_dictionary` с колонками `id uuid pk, source_format text, status_code text, label text, writeoff_days integer, default_upload_offset_days integer, default_task_type text, is_required_for_coverage boolean, is_active boolean, sort_order integer, created_at timestamptz, updated_at timestamptz`, уникальный индекс `(source_format, status_code)`. `status_code = '*'` зарезервирован под catch-all-строку формата (см. спеку).

- [ ] **Step 1: Написать миграцию**

```sql
-- Словарь статусов (спека 2026-10-20-wms-status-dictionary-design.md):
-- единая таблица (отчёт, статус) -> название/срок списания/срок
-- разбора по умолчанию/участок по умолчанию -- поглощает
-- wms_writeoff_terms и JS-хардкод фоллбэк классификации (этап 2),
-- становится источником обязательных статусов для журнала покрытия
-- (этап 3). status_code = '*' -- зарезервированное значение для
-- catch-all строки формата (правила вида "всё, что не поймали
-- остальные", см. спеку, раздел "Уточнение").
create table public.wms_status_dictionary (
    id uuid primary key default gen_random_uuid(),
    source_format text not null,
    status_code text not null,
    label text not null default '',
    writeoff_days integer,
    default_upload_offset_days integer not null default 0,
    default_task_type text,
    is_required_for_coverage boolean not null default true,
    is_active boolean not null default true,
    sort_order integer not null default 999,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (source_format, status_code)
);

alter table public.wms_status_dictionary
    add constraint wms_status_dictionary_source_format_check
    check (source_format in ('general', 'packaging', 'after_sale_movement', 'no_order'));

create index wms_status_dictionary_format_active_idx
    on public.wms_status_dictionary (source_format, is_active);

comment on table public.wms_status_dictionary is
    'Словарь статусов: единая точка правды (отчёт, статус) -> название/срок списания/срок разбора по умолчанию/участок по умолчанию. status_code=''*'' -- catch-all строка формата (ловит статусы, не перечисленные явно). См. docs/superpowers/specs/2026-10-20-wms-status-dictionary-design.md.';
```

- [ ] **Step 2: Проверить в транзакции**

```bash
cat > /tmp/test_status_dict.sql <<'EOF'
begin;
insert into public.wms_status_dictionary (source_format, status_code, label, default_task_type)
values ('general', 'SPS', 'Статус SPS', 'Разбор ОПП // Предсортировка');
insert into public.wms_status_dictionary (source_format, status_code, label, default_task_type)
values ('general', '*', 'Прочее', null);
-- уникальность (source_format, status_code) должна сработать
select count(*) as should_fail from (
  select 1 from (values (1)) x
) t;
savepoint dup_check;
insert into public.wms_status_dictionary (source_format, status_code, label)
values ('general', 'SPS', 'Дубликат');
rollback to dup_check;
select source_format, status_code, label from public.wms_status_dictionary order by status_code;
rollback;
EOF
supabase db query --linked --file /tmp/test_status_dict.sql
```
Ожидается: вставка дубликата `(general, SPS)` падает на unique-констрейнте (после `savepoint`/`rollback to` транзакция продолжается), финальный select показывает 2 строки (`SPS`, `*`), затем общий `rollback` ничего не оставляет в проде.

- [ ] **Step 3: Применить реально**

```bash
supabase db query --linked --file supabase/migrations/202610200004_wms_status_dictionary.sql
cat > /tmp/register_202610200004.sql <<'EOF'
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('202610200004', 'wms_status_dictionary', array['select 1'])
on conflict (version) do nothing;
EOF
supabase db query --linked --file /tmp/register_202610200004.sql
```

- [ ] **Step 4: Коммит**

```bash
git add supabase/migrations/202610200004_wms_status_dictionary.sql
git commit -m "feat: таблица wms_status_dictionary -- словарь статусов (этап 1/4)"
git push origin main
```

---

### Task 2: Миграция -- сид словаря из живых правил и сроков списания

**Files:**
- Create: `supabase/migrations/202610200005_wms_status_dictionary_seed.sql`

**Interfaces:**
- Consumes: `wms_routing_rules` (conditions, target_task_type, upload_offset_days, source_format, is_active, output_key='zone'), `wms_writeoff_terms` (term_type='status', term_key, label, days_without_movement).
- Produces: заполненные строки `wms_status_dictionary` (не обязаны быть идеальными -- экран админки из Task 4 даёт поправить).

- [ ] **Step 1: Написать сид**

Логика: (а) для каждого активного zone-правила с `conditions[0] = {attribute:'status', operator:'in', value:[...]}` -- по строке словаря на каждый статус из `value`, `default_task_type` = `target_task_type` правила с НАИМЕНЬШИМ числом условий для этого статуса (эвристика "самое общее = дефолтное" -- напр. для GWS это правило "GWS (по умолчанию, без спец. МХ)", не "GWS + МХ Сортировка в сетки"), `default_upload_offset_days` = `upload_offset_days` того же правила; (б) для трёх catch-all правил (`not_contains` на несуществующее значение/на `'RWP'`) -- одна строка `status_code='*'` на их `source_format`; (в) `writeoff_days`/`label` -- оверлей из `wms_writeoff_terms` по `term_key = status_code` (across всех source_format, т.к. сроки списания сегодня не привязаны к отчёту).

```sql
-- Сид словаря статусов из текущих живых правил wms_routing_rules и
-- wms_writeoff_terms. Эвристика default_task_type -- правило с
-- НАИМЕНЬШИМ числом условий для этого статуса (самое общее / без
-- спец-условий по MX). Не обязан быть идеальным -- экран админки
-- (Task 4) даёт поправить руками до переключения классификации (этап 2).
with rule_statuses as (
    select
        r.id as rule_id,
        r.source_format,
        r.target_task_type,
        r.upload_offset_days,
        jsonb_array_length(r.conditions) as condition_count,
        status_value
    from public.wms_routing_rules r,
         jsonb_array_elements_text(
             case
                 when r.conditions->0->>'attribute' = 'status' and r.conditions->0->>'operator' = 'in'
                 then r.conditions->0->'value'
                 else '[]'::jsonb
             end
         ) as status_value
    where r.is_active = true and r.output_key = 'zone'
),
ranked as (
    select *, row_number() over (
        partition by source_format, status_value
        order by condition_count asc, upload_offset_days desc
    ) as rn
    from rule_statuses
),
catch_all as (
    select distinct source_format
    from public.wms_routing_rules
    where is_active = true and output_key = 'zone'
      and conditions = jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'not_contains', 'value', '__никогда_не_встретится__'))
    union
    select 'packaging'
    where exists (
        select 1 from public.wms_routing_rules
        where is_active = true and output_key = 'zone' and source_format = 'packaging'
          and conditions = jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'not_contains', 'value', 'RWP'))
    )
)
insert into public.wms_status_dictionary (source_format, status_code, default_task_type, default_upload_offset_days)
select source_format, status_value, target_task_type, upload_offset_days
from ranked
where rn = 1
union all
select source_format, '*', null, 0
from catch_all
on conflict (source_format, status_code) do nothing;

-- Оверлей сроков списания/названий из wms_writeoff_terms (не
-- привязаны к отчёту сегодня -- применяем ко всем форматам, где уже
-- есть строка с таким status_code).
update public.wms_status_dictionary d
set writeoff_days = t.days_without_movement,
    label = coalesce(nullif(t.label, ''), d.label)
from public.wms_writeoff_terms t
where t.term_type = 'status'
  and t.is_active = true
  and d.status_code = t.term_key;
```

- [ ] **Step 2: Проверить в транзакции на реальных данных**

```bash
cat > /tmp/test_seed.sql <<'EOF'
begin;
EOF
cat supabase/migrations/202610200005_wms_status_dictionary_seed.sql >> /tmp/test_seed.sql
cat >> /tmp/test_seed.sql <<'EOF'
select source_format, status_code, default_task_type, default_upload_offset_days, writeoff_days, label
from wms_status_dictionary order by source_format, status_code;
select count(*) as total_rows from wms_status_dictionary;
rollback;
EOF
supabase db query --linked --file /tmp/test_seed.sql
```
Ожидается (сверить со живым аудитом правил, см. Global Constraints): по `general` строки SPS/LGR/PAP/SMC/GWS/WMI/PWT/SMS/SWT/`*`? -- нет, SMS/SWT попадают как ОТДЕЛЬНЫЕ статусы (не catch-all, у них есть явные `in` условия), значит `general` НЕ получает `*`-строку (нет безусловного catch-all в этом формате -- сверено живым аудитом). По `no_order`: USD, TMM, `*`. По `packaging`: RWP, `*`. По `after_sale_movement`: только `*` (единственное правило -- целиком catch-all, конкретных статусов в условиях нет). Если фактический результат расходится -- остановиться и разобраться (systematic-debugging), не подгонять эвристику вслепую.

- [ ] **Step 3: Применить реально, зарегистрировать**

```bash
supabase db query --linked --file supabase/migrations/202610200005_wms_status_dictionary_seed.sql
cat > /tmp/register_202610200005.sql <<'EOF'
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('202610200005', 'wms_status_dictionary_seed', array['select 1'])
on conflict (version) do nothing;
EOF
supabase db query --linked --file /tmp/register_202610200005.sql
```

- [ ] **Step 4: Коммит**

```bash
git add supabase/migrations/202610200005_wms_status_dictionary_seed.sql
git commit -m "feat: сид словаря статусов из живых правил и сроков списания"
git push origin main
```

---

### Task 3: JS -- загрузка словаря в состояние

**Files:**
- Modify: `tasks.js` (рядом с `state.routingRules`, state-объект; рядом с `loadRoutingRules`, ~line 12857)

**Interfaces:**
- Produces: `state.statusDictionary = { rows: [], loaded: false, loading: false, error: "" }`; `async function loadStatusDictionary(force)` -- грузит `wms_status_dictionary` целиком (`select("*").order("source_format").order("sort_order")`), кладёт в `state.statusDictionary.rows`. `function statusDictionaryEntry(sourceFormat, statusCode)` -- точечный поиск по `(source_format, status_code)` в уже загруженных `state.statusDictionary.rows`. `function statusDictionaryCatchAll(sourceFormat)` -- `statusDictionaryEntry(sourceFormat, '*')`.

- [ ] **Step 1: Добавить state-поле**

Рядом с `routingRules: { rows: [], loading: false, loaded: false, error: "", editingIndex: null }` в объекте `state` добавить:
```javascript
statusDictionary: {
    rows: [],
    loading: false,
    loaded: false,
    error: "",
},
```

- [ ] **Step 2: Добавить loader и геттеры**

Рядом с `loadRoutingRules` (~tasks.js:12857):
```javascript
async function loadStatusDictionary(force) {
    if (state.statusDictionary.loaded && !force) return true;
    const db = supabaseDb();
    state.statusDictionary.loading = true;
    state.statusDictionary.error = "";
    if (!db) {
        state.statusDictionary.loading = false;
        state.statusDictionary.error = "Supabase SDK недоступен.";
        return false;
    }
    try {
        const { data, error } = await db
            .from("wms_status_dictionary")
            .select("*")
            .order("source_format", { ascending: true })
            .order("sort_order", { ascending: true });
        if (error) throw error;
        state.statusDictionary.rows = data || [];
        state.statusDictionary.loaded = true;
        return true;
    } catch (error) {
        state.statusDictionary.rows = [];
        state.statusDictionary.error = "Не удалось загрузить словарь статусов: " + (error && error.message ? error.message : String(error));
        console.warn("status dictionary load skipped:", error);
        return false;
    } finally {
        state.statusDictionary.loading = false;
    }
}

function statusDictionaryEntry(sourceFormat, statusCode) {
    const code = normalizeText(statusCode).toUpperCase();
    return (state.statusDictionary.rows || []).find((row) => row.source_format === sourceFormat && row.status_code === code && row.is_active !== false) || null;
}

function statusDictionaryCatchAll(sourceFormat) {
    return (state.statusDictionary.rows || []).find((row) => row.source_format === sourceFormat && row.status_code === "*" && row.is_active !== false) || null;
}
```

- [ ] **Step 3: `node --check tasks.js`**

- [ ] **Step 4: Коммит**

```bash
git add tasks.js
git commit -m "feat: загрузка словаря статусов в состояние клиента"
git push origin main
```

---

### Task 4: Экран админки "Статусы" -- переиспользовать `statusPilotModal`

Пустая модалка-концепт `statusPilotModal`/`openStatusPilotModal` (`tasks.html:2566-2595`, `tasks.js:13959-13963`, кнопка `#openFlow`-соседняя `id="openStatusPilot"`? -- проверить фактический id кнопки в `tasks.html` рядом со строкой 2055, называется примерно "Статусный штурман") уже существует как заглушка с описанием ровно этой фичи ("сначала выбираем статусы и даты, потом WMS+ сам собирает задачи в участки"). Заменяем статичный контент на реальную таблицу словаря.

**Files:**
- Modify: `tasks.html:2566-2595` (контент `statusPilotModal`)
- Modify: `tasks.js:13959-13967` (`openStatusPilotModal`/`closeStatusPilotModal`)

**Interfaces:**
- Consumes: `state.statusDictionary.rows`, `loadStatusDictionary`, `SOURCE_FORMAT_OPTIONS` (уже существует, `tasks.js:12926-12931`), `sourceFormatLabel` (уже существует, `tasks.js:13000-13003`).
- Produces: `function renderStatusDictionaryModal()`, `function statusDictionaryRowHtml(row)`, `function openStatusDictionaryEditForm(id)` (id уже существующей строки или `null` для новой), `function saveStatusDictionaryRow(formEl)`.

- [ ] **Step 1: Найти точный id кнопки-входа**

```bash
grep -n "Статусный штурман\|openStatusPilot" tasks.html tasks.js
```
Переименовать видимый текст кнопки и подзаголовок модалки с "Статусный штурман" / концепт-описания на "Статусы" / "Словарь статусов -- единая точка правды для сроков, маршрутизации и журнала покрытия." (id кнопки/модалки можно оставить как есть -- `statusPilotModal`/`openStatusPilot`, переименование id не обязательно для функциональности).

- [ ] **Step 2: Заменить статичный HTML модалки на контейнер таблицы**

В `tasks.html`, внутри `<section id="statusPilotModal">`, заменить `<div class="status-pilot-grid">...</div>` и `<div class="status-pilot-note">` на:
```html
<div class="status-pilot-toolbar">
    <button id="addStatusDictionaryRow" class="btn btn-rect" type="button">+ Добавить статус</button>
    <div id="statusDictionaryStatus" class="status-line"></div>
</div>
<div id="statusDictionaryWrap"></div>
```

- [ ] **Step 3: Рендер таблицы**

В `tasks.js`, рядом с `routingRuleSummaryRowHtml`:
```javascript
function statusDictionaryRowHtml(row, index) {
    const required = row.is_required_for_coverage !== false;
    const active = row.is_active !== false;
    return "<div class='routing-rule-summary-row" + (active ? "" : " inactive") + "' data-status-dict-row data-status-dict-index='" + index + "' tabindex='0' role='button'>"
        + "<span class='routing-rule-summary-format'>" + escapeHtml(sourceFormatLabel(row.source_format)) + "</span>"
        + "<span class='routing-rule-summary-name'>" + escapeHtml(row.status_code === "*" ? "Прочее" : row.status_code) + "</span>"
        + "<span class='routing-rule-summary-target'>" + escapeHtml(row.label || "-") + "</span>"
        + "<span class='routing-rule-summary-target'>→ " + escapeHtml(row.default_task_type || "по правилам") + "</span>"
        + "<span class='routing-rule-summary-meta'>списание: " + (row.writeoff_days === null || row.writeoff_days === undefined ? "-" : row.writeoff_days + "д") + "</span>"
        + "<span class='routing-rule-summary-meta'>разбор: " + (row.default_upload_offset_days || 0) + "д</span>"
        + "<span class='routing-rule-summary-status'>" + (required ? "обязателен" : "необязателен") + "</span>"
        + "</div>";
}

function renderStatusDictionaryModal() {
    const target = $("statusDictionaryWrap");
    if (!target) return;
    const rows = state.statusDictionary.rows || [];
    const byFormat = new Map();
    rows.forEach((row, index) => {
        const key = row.source_format;
        const group = byFormat.get(key) || [];
        group.push({ row, index });
        byFormat.set(key, group);
    });
    target.innerHTML = (state.statusDictionary.error ? "<div class='status-line error'>" + escapeHtml(state.statusDictionary.error) + "</div>" : "")
        + (state.statusDictionary.loading ? "<div class='status-line'>Загружаю словарь...</div>" : "")
        + (!rows.length && !state.statusDictionary.loading ? "<div class='empty-state'>Словарь пуст. Нажмите \"Добавить статус\".</div>" : "")
        + SOURCE_FORMAT_OPTIONS.map((opt) => {
            const group = byFormat.get(opt.value) || [];
            if (!group.length) return "";
            return "<div class='routing-rule-section-group'>"
                + "<div class='routing-rule-section-heading'>" + escapeHtml(opt.label) + " (" + group.length + ")</div>"
                + "<div class='routing-rule-summary-list'>" + group.map((item) => statusDictionaryRowHtml(item.row, item.index)).join("") + "</div>"
                + "</div>";
        }).join("");
    target.querySelectorAll("[data-status-dict-row]").forEach((rowEl) => {
        const open = () => openStatusDictionaryEditForm(Number(rowEl.getAttribute("data-status-dict-index")));
        rowEl.addEventListener("click", open);
        rowEl.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
    });
}
```

- [ ] **Step 4: Открытие/закрытие модалки грузит словарь**

Заменить `openStatusPilotModal`/`closeStatusPilotModal` (`tasks.js:13959-13967`):
```javascript
async function openStatusPilotModal() {
    if (!ensureDevelopmentAccess("Статусы")) return;
    closeFlowModals();
    setFlowModalOpen("statusPilotModal", true);
    renderStatusDictionaryModal();
    await loadStatusDictionary(true);
    renderStatusDictionaryModal();
}

function closeStatusPilotModal() {
    setFlowModalOpen("statusPilotModal", false);
}
```

- [ ] **Step 5: Форма редактирования строки (инлайн, по образцу routing rule edit modal)**

Добавить минимальную форму-модалку (переиспользовать `routingRuleEditModal`-подобный паттерн: отдельный `<section>` в `tasks.html` с полями `source_format` (select из `SOURCE_FORMAT_OPTIONS`), `status_code` (text, disabled при редактировании существующей строки), `label`, `writeoff_days` (number, пусто = null), `default_upload_offset_days` (number), `default_task_type` (text), `is_required_for_coverage`/`is_active` (checkbox)) с функциями `openStatusDictionaryEditForm(index)` (index=null для новой строки), `closeStatusDictionaryEditForm()`, `saveStatusDictionaryRow()` -- `upsert` в `wms_status_dictionary` через `db.from("wms_status_dictionary").upsert(row, {onConflict: "source_format,status_code"})`, `updated_at` выставляется вручную (`new Date().toISOString()`), затем `await loadStatusDictionary(true); renderStatusDictionaryModal();`.

- [ ] **Step 6: Wiring**

Рядом с `$("openWriteoffTerms").addEventListener(...)` (`tasks.js:20285`), убедиться что кнопка входа в `statusPilotModal` уже на месте (она уже есть -- просто подтвердить, что обработчик вызывает `openStatusPilotModal()`). Добавить `$("addStatusDictionaryRow").addEventListener("click", () => openStatusDictionaryEditForm(null));`.

- [ ] **Step 7: `node --check tasks.js`**

- [ ] **Step 8: Ручная проверка на реальных данных**

Через `supabase db query --linked` прочитать текущие строки `wms_status_dictionary` (уже заполнены Task 2), убедиться что рендер-функция (прочитать код глазами, проверить, что HTML-структура не ломает `escapeHtml`/не содержит синтаксических ошибок в шаблонных строках) корректно обработает все значения, включая `status_code='*'`, `writeoff_days=null`, `default_task_type=null`.

- [ ] **Step 9: Коммит**

```bash
git add tasks.js tasks.html
git commit -m "feat: экран админки Статусы -- словарь вместо концепт-заглушки"
git push origin main
```

---

### Task 5: `rulesForStatus` -- связь словаря с правилами без новой колонки

**Files:**
- Modify: `tasks.js` (рядом с `routingRuleSummaryRowHtml`/`renderRoutingRulesModal`, ~13005-13053)

**Interfaces:**
- Consumes: `state.routingRules.rows` (уже загружен при открытии модалки правил).
- Produces: `function ruleReferencesStatus(conditions, statusCode)` (true/false), `function rulesForStatus(sourceFormat, statusCode)` (массив `{row, index}>` активных правил этого формата, чьи `conditions` ссылаются на `statusCode`), `state.routingRules.statusFilter` (строка статуса или `null`), обновлённый `renderRoutingRulesModal()` с переключателем "этот статус / все правила", обновлённый `openRoutingRulesModal(statusFilter)` (необязательный параметр).

- [ ] **Step 1: Написать `ruleReferencesStatus`/`rulesForStatus`**

```javascript
function ruleReferencesStatus(conditions, statusCode) {
    const code = normalizeText(statusCode).toUpperCase();
    return (Array.isArray(conditions) ? conditions : []).some((condition) => {
        if (!condition || condition.attribute !== "status") return false;
        if (condition.operator === "in") return Array.isArray(condition.value) && condition.value.map((v) => normalizeText(v).toUpperCase()).includes(code);
        if (condition.operator === "eq") return normalizeText(condition.value).toUpperCase() === code;
        return false; // contains/not_contains/числовые операторы на status -- неопределимо статически, правило не связывается с конкретным статусом
    });
}

function rulesForStatus(sourceFormat, statusCode) {
    return (state.routingRules.rows || [])
        .map((row, index) => ({ row, index }))
        .filter((item) => item.row.source_format === sourceFormat && item.row.is_active !== false && ruleReferencesStatus(item.row.conditions, statusCode));
}
```

- [ ] **Step 2: Переключатель в модалке правил**

В `renderRoutingRulesModal()` (`tasks.js:13024-13053`): если `state.routingRules.statusFilter` задан -- фильтровать `zoneRows`/`filterRows` через `rulesForStatus(statusFilter.sourceFormat, statusFilter.statusCode)` вместо полного списка, и рендерить над списком переключатель:
```javascript
const filter = state.routingRules.statusFilter;
const toggleHtml = filter
    ? "<div class='routing-rule-status-filter'>Статус <strong>" + escapeHtml(filter.statusCode) + "</strong> (" + escapeHtml(sourceFormatLabel(filter.sourceFormat)) + ") <button type='button' class='btn btn-outline' data-clear-status-filter>Показать все правила</button></div>"
    : "";
```
(вставить `toggleHtml` перед остальным содержимым `target.innerHTML`; при `filter` задан -- `zoneRows`/`filterRows` берутся из `rulesForStatus(...)` пересечённого с уже отсортированным списком, а не из полного `indexed`). Обработчик `data-clear-status-filter` -- `state.routingRules.statusFilter = null; renderRoutingRulesModal();`.

- [ ] **Step 3: `openRoutingRulesModal` принимает фильтр**

```javascript
async function openRoutingRulesModal(statusFilter) {
    if (!ensureDevelopmentAccess("Правила маршрутизации")) return;
    closeFlowModals();
    state.routingRules.editingIndex = null;
    state.routingRules.statusFilter = statusFilter || null;
    setFlowModalOpen("routingRulesModal", true);
    renderRoutingRulesModal();
    await loadRoutingRules(true);
}
```

- [ ] **Step 4: Клик по строке словаря открывает правила этого статуса**

В `statusDictionaryRowHtml`/обработчике клика (Task 4, Step 3) -- рядом с `openStatusDictionaryEditForm(index)` добавить отдельную кнопку/ссылку "Правила" в разметке строки, вызывающую `openRoutingRulesModal({ sourceFormat: row.source_format, statusCode: row.status_code })` (не вместо формы редактирования, а дополнительно -- напр. отдельный `<button data-status-dict-rules>` внутри `statusDictionaryRowHtml`, с `event.stopPropagation()` в обработчике, чтобы не триггерить и открытие формы редактирования одним кликом).

- [ ] **Step 5: `node --check tasks.js`**

- [ ] **Step 6: Коммит**

```bash
git add tasks.js
git commit -m "feat: связь словаря статусов с правилами маршрутизации (без новой колонки)"
git push origin main
```

---

## Этап 2: Классификация и сроки переключаются на словарь

### Task 6: Сроки списания читаются из словаря

**Files:**
- Modify: `tasks.js:1679-1739` (`activeWriteoffStatusTerms`, `writeoffDateInfoForRow`, `writeoffDateInfoForRows`)

**Interfaces:**
- Consumes: `state.statusDictionary.rows` (должен быть загружен до вызова -- добавить `loadStatusDictionary()` туда же, откуда сегодня вызывается `loadWriteoffTerms()`).
- Produces: те же сигнатуры `activeWriteoffStatusTerms()`/`writeoffDateInfoForRow(row, termMap)`/`writeoffDateInfoForRows(rows, fallbackDate)` -- вызывающий код не меняется.

- [ ] **Step 1: Прочитать текущий код перед правкой**

```bash
sed -n '1679,1739p' tasks.js
```

- [ ] **Step 2: Переписать `activeWriteoffStatusTerms` на источник из словаря**

```javascript
function activeWriteoffStatusTerms() {
    const map = new Map();
    (state.statusDictionary.rows || []).forEach((row) => {
        if (row.status_code === "*" || row.is_active === false) return;
        if (row.writeoff_days === null || row.writeoff_days === undefined) return;
        const key = normalizeWriteoffTermKey(row.status_code, "status");
        if (!key) return;
        map.set(key, { term_key: key, label: row.label || row.status_code, days_without_movement: row.writeoff_days });
    });
    return map;
}
```
(`writeoffDateInfoForRow`/`writeoffDateInfoForRows` не меняются -- они уже работают через `termMap`, которую строит `activeWriteoffStatusTerms`; `normalizeWriteoffTermKey` остаётся как есть, пригодится и дальше для LR-срока, если он есть отдельно от статусного -- если в словаре LR-термины не планируются, `normalizeWriteoffTermType`/LR-ветка просто никогда не матчится, что безопасно.)

- [ ] **Step 3: Убедиться, что словарь грузится там же, где раньше грузились сроки списания**

```bash
grep -n "loadWriteoffTerms()" tasks.js
```
Каждый вызов `loadWriteoffTerms()` заменить на `loadStatusDictionary()` (или добавить рядом, если `loadWriteoffTerms` вызывается в месте, где словарь ещё не загружен для других целей -- проверить по месту).

- [ ] **Step 4: `node --check tasks.js`**

- [ ] **Step 5: Живая проверка на реальных данных**

Через `supabase db query --linked` сравнить: для каждого `term_key` в живой `wms_writeoff_terms` (`is_active=true`) есть соответствующая строка в `wms_status_dictionary` с тем же `writeoff_days` (после Task 2 seed + возможных ручных правок в Task 4). Если расхождение -- поправить строку словаря через экран админки (Task 4), не трогая код.

- [ ] **Step 6: Коммит**

```bash
git add tasks.js
git commit -m "feat: срок списания читается из словаря статусов вместо wms_writeoff_terms"
git push origin main
```

---

### Task 7: Классификация `general` -- фоллбэк на словарь вместо хардкода

**Files:**
- Modify: `tasks.js:17037-17045` (`hardcodeZoneFor` внутри `buildGeneralPreview`), срок разбора в том же файле (`dated.push`/`offsetDays` расчёт рядом, ~17056-17063)

**Interfaces:**
- Consumes: `statusDictionaryEntry("general", row.product_status)`, `statusDictionaryCatchAll("general")`.
- Produces: та же сигнатура `hardcodeZoneFor(row)` -- вызывающий код (`decidedByRow`/`zone = decided ? decided.zone : hardcodeZoneFor(row)`) не меняется; плюс срок разбора фоллбэка теперь тоже из словаря, а не `0` по умолчанию.

- [ ] **Step 1: Прочитать текущий код перед правкой**

```bash
sed -n '17012,17078p' tasks.js
```

- [ ] **Step 2: Заменить `hardcodeZoneFor` на обёртку над словарём**

```javascript
function hardcodeZoneFor(row) {
    const entry = statusDictionaryEntry("general", sourceRowStatus(row).toUpperCase()) || statusDictionaryCatchAll("general");
    return entry ? entry.default_task_type : null;
}
```
(`isPresortStatus`/`isLabelingStatus`/`isMarketplaceStatus`/`isPcStatus`/`isWmiMpPcStatus`/`isPmBufferStatus` остаются в файле нетронутыми -- удаление отдельной задачей в этапе 4, не сейчас, чтобы было куда откатиться.)

- [ ] **Step 3: Срок разбора фоллбэка -- из словаря**

Найти место расчёта `offsetDays` для строк без сработавшего правила (`const offsetDays = decided ? decided.uploadOffsetDays : 0;`, ~17060) и заменить `0` на вызов словаря:
```javascript
const offsetDays = decided ? decided.uploadOffsetDays : (statusDictionaryEntry("general", sourceRowStatus(row).toUpperCase()) || statusDictionaryCatchAll("general") || {}).default_upload_offset_days || 0;
```

- [ ] **Step 4: `node --check tasks.js`**

- [ ] **Step 5: Живая проверка -- сравнить классификацию до/после на реальном файле**

Используя тот же подход, что и при расследовании сегодняшнего бага сохранения (Node-скрипт, читающий реальный xlsx через `xlsx`, воспроизводящий `buildGeneralPreview`'s control flow) -- прогнать реальный недавний файл "В заказе" ДВАЖДЫ: один раз с текущей (хардкод) версией `hardcodeZoneFor`, один раз с новой (словарь), сравнить итоговый `task_type` на КАЖДУЮ строку, где решение принял фоллбэк (не правило). Любое расхождение -- остановиться, разобраться (чаще всего это пропущенная строка словаря), а не игнорировать.

- [ ] **Step 6: Коммит**

```bash
git add tasks.js
git commit -m "feat: классификация В заказе -- фоллбэк из словаря статусов вместо хардкода"
git push origin main
```

---

### Task 8: Классификация `packaging`/`no_order` -- фоллбэк на словарь

**Files:**
- Modify: `tasks.js:16775-16792` (`buildPackagingPreview`, `isRwpRow`/`offsetDaysForRow`)
- Modify: `tasks.js:17301-17336` (`buildNoOrderPreview`, `effectiveKey`)

**Interfaces:**
- Consumes: `statusDictionaryEntry`/`statusDictionaryCatchAll` (как в Task 7).
- Produces: тот же итоговый эффект (RWP vs Упаковка, USD/TMM vs Без заказа), источник фоллбэка -- словарь.

- [ ] **Step 1: Прочитать оба участка перед правкой**

```bash
sed -n '16775,16792p;17301,17336p' tasks.js
```

- [ ] **Step 2: `buildPackagingPreview` -- `isRwpRow` фоллбэк**

```javascript
function isRwpRow(row) {
    const decided = decidedByRow.get(row);
    if (decided) return decided.zone === "RWP";
    const entry = statusDictionaryEntry("packaging", sourceStatusCode(row.last_status).toUpperCase());
    return Boolean(entry && entry.default_task_type === "Разбор ОПП // RWP");
}
```
(`offsetDaysForRow` уже достаточно общий -- `decided.uploadOffsetDays` или `defForRow.offsetDays` (DEFAULT_MODULES) -- оставить как есть на этом этапе, т.к. DEFAULT_MODULES.offsetDays для packaging/rwp уже корректно отражает дефолты и не завязан на хардкод-предикаты; если после проверки Step 4 расхождений не найдётся, трогать не нужно.)

- [ ] **Step 3: `buildNoOrderPreview` -- `effectiveKey` фоллбэк**

```javascript
function effectiveKey(row, decided) {
    let zone = decided ? decided.zone : null;
    if (!zone) {
        const entry = statusDictionaryEntry("no_order", sourceRowStatus(row).toUpperCase()) || statusDictionaryCatchAll("no_order");
        zone = entry ? entry.default_task_type : null;
        // zoneTaskTypeMap (ниже в этой же функции) ключуется короткими
        // именами ("Без заказа"/"Другие задачи"), не полным task_type --
        // словарь хранит полный task_type, нужен обратный маппинг.
        if (zone === "Разбор ОПП // USD" || zone === "Разбор ОПП // TMM") zone = "Другие задачи";
        else if (zone === "Разбор ОПП // Без заказа") zone = "Без заказа";
    }
    if (zone !== "Другие задачи") return zone;
    if (isNoOrderUsdStatus(row)) return "usd_in_other";
    if (isNoOrderTmmStatus(row)) return "tmm_in_other";
    return "Другие задачи";
}
```
**Важно:** здесь `isNoOrderUsdStatus(row)`/`isNoOrderTmmStatus(row)` вызовы ВНУТРИ `if (zone !== "Другие задачи") return zone;` веткой НЕ заменяются -- это не классификация по зоне (она уже решена выше), а разделение одного зона-ключа "Другие задачи" на под-бакеты usd/tmm для группировки (`ruleSettingsFingerprint`/`byKey`) -- то же значение, то же назначение, трогать не нужно на этом этапе (полная чистка этих двух хелперов -- этап 4, вместе с остальными хардкод-предикатами).

- [ ] **Step 4: Живая проверка на реальных данных (оба формата)**

Тот же подход, что в Task 7 Step 5 -- реальные недавние файлы "Утерянные и обездвиженные товары" и "Товары без движения (Без заказа)", сравнить классификацию до/после для строк, где решение принял фоллбэк.

- [ ] **Step 5: `node --check tasks.js`**

- [ ] **Step 6: Коммит**

```bash
git add tasks.js
git commit -m "feat: классификация Упаковка/Без заказа -- фоллбэк из словаря статусов"
git push origin main
```

(`buildAfterSaleMovementPreview` не трогается в этой задаче -- у него нет JS-хардкод фоллбэка классификации, `def.taskType` уже единственный возможный результат.)

---

## Этап 3: Журнал покрытия на статусный ключ

### Task 9: Миграция -- новая схема `wms_upload_coverage_log`

**Files:**
- Create: `supabase/migrations/202610200006_wms_upload_coverage_log_status_key.sql`

**Interfaces:**
- Produces: пересозданная таблица `wms_upload_coverage_log` с ключом `(business_date, source_format, status_code, rule_key)` вместо `(business_date, target_task_type, source_format)`. `rule_key` -- `id` активного правила (`uuid::text`) или `'__default__'`.

- [ ] **Step 1: Написать миграцию**

```sql
-- Журнал покрытия на статусный ключ (этап 3 спеки
-- 2026-10-20-wms-status-dictionary-design.md). Заменяет ключ
-- (business_date, target_task_type, source_format), введённый
-- миграцией 202610200001, на (business_date, source_format,
-- status_code, rule_key) -- единица учёта теперь статус (и его
-- правило, если их у статуса несколько -- см. спеку, "Вариант 2").
-- Таблица создана сегодня же (202610200001-3), ещё не накопила
-- значимой истории сверх бэкофилла -- пересоздаём, а не alter'им.
drop table public.wms_upload_coverage_log;

create table public.wms_upload_coverage_log (
    business_date date not null,
    source_format text not null,
    status_code text not null,
    rule_key text not null,
    checked_at timestamptz not null default timezone('utc', now()),
    primary key (business_date, source_format, status_code, rule_key)
);

create index wms_upload_coverage_log_status_idx
    on public.wms_upload_coverage_log (source_format, status_code, business_date);

comment on table public.wms_upload_coverage_log is
    'Журнал: какой статус (и, если их несколько у статуса, какое именно правило -- rule_key, иначе ''__default__'') был реально запрошен у WB за бизнес-дату. Заполняется при сохранении выгрузки по показанному оператору окну, не по факту появления строк. См. docs/superpowers/specs/2026-10-20-wms-status-dictionary-design.md.';
```

- [ ] **Step 2: Проверить в транзакции**

```bash
cat > /tmp/test_coverage_v2.sql <<'EOF'
begin;
EOF
cat supabase/migrations/202610200006_wms_upload_coverage_log_status_key.sql >> /tmp/test_coverage_v2.sql
cat >> /tmp/test_coverage_v2.sql <<'EOF'
insert into wms_upload_coverage_log (business_date, source_format, status_code, rule_key)
values ('2026-10-20', 'general', 'SPS', '__default__')
on conflict (business_date, source_format, status_code, rule_key) do update set checked_at = excluded.checked_at;
select count(*) as should_be_1 from wms_upload_coverage_log;
rollback;
EOF
supabase db query --linked --file /tmp/test_coverage_v2.sql
```

- [ ] **Step 3: Применить реально, зарегистрировать**

```bash
supabase db query --linked --file supabase/migrations/202610200006_wms_upload_coverage_log_status_key.sql
cat > /tmp/register_202610200006.sql <<'EOF'
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('202610200006', 'wms_upload_coverage_log_status_key', array['select 1'])
on conflict (version) do nothing;
EOF
supabase db query --linked --file /tmp/register_202610200006.sql
```

- [ ] **Step 4: Коммит**

```bash
git add supabase/migrations/202610200006_wms_upload_coverage_log_status_key.sql
git commit -m "feat: журнал покрытия -- новая схема на статусный ключ"
git push origin main
```

---

### Task 10: Миграция -- бэкофилл журнала из `wms_task_items.status`

**Files:**
- Create: `supabase/migrations/202610200007_wms_upload_coverage_log_status_backfill.sql`

**Interfaces:**
- Consumes: `wms_task_items` (`status`, `task_id`), `wms_tasks` (`task_type`, `upload_effective_date`), `wms_routing_rules` (для сопоставления статус+task_type -> rule_key, если несколько правил).
- Produces: заполненные строки `wms_upload_coverage_log` за историю, аналогично сегодняшнему бэкофиллу (202610200002-3), но по статусу, извлечённому из `wms_task_items.status` через `latinStatusCode`-эквивалент в SQL (regexp).

- [ ] **Step 1: Написать бэкофилл**

```sql
-- Бэкофилл из wms_task_items.status (не из окна рана -- та ошибка уже
-- стоила отдельного фикса сегодня, см. 202610200003). status на
-- КОНКРЕТНОМ item'е -- источник истины по которому статусу принадлежит
-- строка, а дата -- с родительской задачи (upload_effective_date).
-- rule_key: если для (source_format статуса, статус) есть РОВНО одно
-- активное zone-правило -- его id; если правил несколько или их
-- вообще нет -- '__default__' (упрощение бэкофилла: различать, КАКОЕ
-- именно из нескольких правил обработало конкретный item, по
-- историческим данным не всегда однозначно -- '__default__' в этом
-- случае безопасная недооценка покрытия, не переоценка).
with item_status as (
    select
        t.upload_effective_date as business_date,
        t.task_type,
        upper((regexp_match(ti.status, '[A-Za-z]{3}'))[1]) as status_code
    from public.wms_task_items ti
    join public.wms_tasks t on t.id = ti.task_id
    where t.upload_effective_date is not null and ti.status is not null
),
with_format as (
    select
        business_date,
        case
            when task_type like 'Разбор ОПП // Упаковка' or task_type like 'Разбор ОПП // RWP' then 'packaging'
            when task_type = 'Разбор ОПП // Без заказа' or task_type = 'Разбор ОПП // USD' or task_type = 'Разбор ОПП // TMM' then 'no_order'
            when task_type = 'Разбор ОПП // Движение после продажи' then 'after_sale_movement'
            else 'general'
        end as source_format,
        status_code
    from item_status
    where status_code is not null
),
rule_counts as (
    select source_format, status_value, count(*) as n, max(id::text) as single_rule_id
    from public.wms_routing_rules r,
         jsonb_array_elements_text(
             case when r.conditions->0->>'attribute' = 'status' and r.conditions->0->>'operator' = 'in'
                  then r.conditions->0->'value' else '[]'::jsonb end
         ) as status_value
    where r.is_active = true and r.output_key = 'zone'
    group by source_format, status_value
)
insert into public.wms_upload_coverage_log (business_date, source_format, status_code, rule_key, checked_at)
select distinct
    w.business_date,
    w.source_format,
    w.status_code,
    coalesce((select single_rule_id from rule_counts rc where rc.source_format = w.source_format and rc.status_value = w.status_code and rc.n = 1), '__default__'),
    timezone('utc', now())
from with_format w
on conflict (business_date, source_format, status_code, rule_key) do nothing;
```

- [ ] **Step 2: Проверить в транзакции на реальных данных**

```bash
cat > /tmp/test_backfill_v2.sql <<'EOF'
begin;
EOF
cat supabase/migrations/202610200007_wms_upload_coverage_log_status_backfill.sql >> /tmp/test_backfill_v2.sql
cat >> /tmp/test_backfill_v2.sql <<'EOF'
select source_format, status_code, count(*) as n, min(business_date) as earliest, max(business_date) as latest
from wms_upload_coverage_log group by source_format, status_code order by source_format, status_code;
rollback;
EOF
supabase db query --linked --file /tmp/test_backfill_v2.sql
```
Сверить: по `general` должны появиться записи минимум по SPS/LGR/PAP/SMC/GWS/WMI/PWT/SMS/SWT (статусы, реально встречавшиеся в `wms_task_items.status` этих задач) -- если какого-то статуса из живого аудита правил не видно вовсе, разобраться, прежде чем применять реально (возможно, этот статус просто ни разу не встречался физически -- не баг, а следствие реальных данных; подтвердить отдельным прямым запросом к `wms_task_items`, если сомнительно).

- [ ] **Step 3: Применить реально, зарегистрировать**

```bash
supabase db query --linked --file supabase/migrations/202610200007_wms_upload_coverage_log_status_backfill.sql
cat > /tmp/register_202610200007.sql <<'EOF'
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('202610200007', 'wms_upload_coverage_log_status_backfill', array['select 1'])
on conflict (version) do nothing;
EOF
supabase db query --linked --file /tmp/register_202610200007.sql
```

- [ ] **Step 4: Коммит**

```bash
git add supabase/migrations/202610200007_wms_upload_coverage_log_status_backfill.sql
git commit -m "feat: бэкофилл журнала покрытия по статусу из wms_task_items"
git push origin main
```

---

### Task 11: JS -- `dayCoveredForModule`/`logUploadCoverage` на статусный ключ

**Files:**
- Modify: `tasks.js:1787-1962` (весь блок `FORMAT_REQUIRED_ZONE_TASK_TYPES`...`logUploadCoverage`, см. текущие сигнатуры ниже)

**Interfaces:**
- Consumes: `state.statusDictionary.rows` (должен быть загружен до вызова -- добавить `loadStatusDictionary()`/`ensureCoverageLogLoaded` в те же `Promise.all`, что сегодня грузят `ensureZoneOffsetDepthLoaded`/`ensureCoverageLogLoaded`, см. `loadUploadMeta` ~12760-12766 и `openChooser` ~15215-15221), `rulesForStatus` (Task 5).
- Produces: та же публичная сигнатура `dayCoveredForModule(module, isoDate)` (вызывающий код -- `firstMissingUploadDate`/`uploadWindowForModule`/календарь -- не меняется); `logUploadCoverage(db, module)` та же сигнатура (вызывающий код в `saveTasksAndRun`, строки ~19835/19868, не меняется).

- [ ] **Step 1: Прочитать текущий блок перед правкой**

```bash
sed -n '1787,1962p' tasks.js
```

- [ ] **Step 2: Заменить `requiredZonesForModule` на `requiredStatusUnitsForModule`**

Удалить `FORMAT_REQUIRED_ZONE_TASK_TYPES`/`ZONE_TASK_TYPE_BY_RULE_TARGET`/`requiredZonesForModule` (больше не нужны -- источник обязательных элементов теперь словарь+правила, не хардкод-константа). Новая функция -- для формата возвращает массив "единиц покрытия", каждая `{statusCode, ruleKey, offsetDays}`:
```javascript
function requiredStatusUnitsForModule(module) {
    const fmt = sourceFormatForModule(module);
    const units = [];
    (state.statusDictionary.rows || []).forEach((entry) => {
        if (entry.source_format !== fmt || entry.is_required_for_coverage === false || entry.is_active === false) return;
        const rules = rulesForStatus(fmt, entry.status_code).filter((item) => item.row.output_key !== "filter");
        if (!rules.length) {
            units.push({ statusCode: entry.status_code, ruleKey: "__default__", offsetDays: Number(entry.default_upload_offset_days) || 0 });
        } else {
            rules.forEach((item) => units.push({ statusCode: entry.status_code, ruleKey: String(item.row.id), offsetDays: Number(item.row.upload_offset_days) || 0 }));
        }
    });
    return units;
}
```

- [ ] **Step 3: Переписать `zonesShallowestOffsetDays`/`dayCoveredForModule` на единицы покрытия**

```javascript
function shallowestOffsetAmongUnits(units, module) {
    const offsets = units.map((unit) => Math.min(0, unit.offsetDays)).filter((value) => Number.isFinite(value));
    return offsets.length ? Math.max(...offsets) : shallowestOffsetDaysForModule(module);
}

function dayCoveredForModule(module, isoDate) {
    const units = requiredStatusUnitsForModule(module);
    if (!units.length) return Boolean(runForUpload(module, isoDate));
    const earliestCeiling = addDays(state.today, shallowestOffsetAmongUnits(units, module));
    if (earliestCeiling && isoDate > earliestCeiling) return false;
    const dates = state.coverageLog.dates;
    if (!dates) return false;
    return units.every((unit) => {
        const ceiling = addDays(state.today, Math.min(0, unit.offsetDays));
        if (ceiling && isoDate > ceiling) return true;
        const key = unit.statusCode + "::" + unit.ruleKey;
        const set = dates.get(key);
        return Boolean(set && set.has(isoDate));
    });
}
```
(`zoneOffsetDaysForTaskType`/`ZONE_TASK_TYPE_BY_RULE_TARGET` удаляются -- офсет теперь прямо в каждой "единице" из `requiredStatusUnitsForModule`, без реверс-маппинга короткое/полное имя.)

- [ ] **Step 4: `ensureCoverageLogLoaded` читает новую схему**

```javascript
async function ensureCoverageLogLoaded(force) {
    if (state.coverageLog.loaded && !force) return state.coverageLog.dates;
    const db = supabaseDb();
    if (!db) return state.coverageLog.dates;
    state.coverageLog.loading = true;
    try {
        const calendarRange = state.calendarRange || buildCalendarRange();
        const horizonFloor = addDays(state.today, -GAP_SEARCH_HORIZON_DAYS);
        const floor = calendarRange.start && calendarRange.start < horizonFloor ? calendarRange.start : horizonFloor;
        const { data, error } = await db
            .from("wms_upload_coverage_log")
            .select("status_code, rule_key, business_date")
            .gte("business_date", floor);
        if (error) throw error;
        const map = new Map();
        (data || []).forEach((row) => {
            const key = normalizeText(row.status_code) + "::" + normalizeText(row.rule_key);
            const date = normalizeText(row.business_date);
            if (!date) return;
            if (!map.has(key)) map.set(key, new Set());
            map.get(key).add(date);
        });
        state.coverageLog.dates = map;
        state.coverageLog.loaded = true;
    } catch (error) {
        console.warn("coverage log load skipped:", error);
    } finally {
        state.coverageLog.loading = false;
    }
    return state.coverageLog.dates;
}
```

- [ ] **Step 5: `uploadCoverageEntries`/`logUploadCoverage` пишут по единицам**

```javascript
function uploadCoverageEntries(module) {
    const units = requiredStatusUnitsForModule(module);
    if (!units.length) return [];
    const fmt = sourceFormatForModule(module);
    const window = uploadWindowForModule(module);
    const dates = datesBetween(window.start, window.end);
    const entries = [];
    dates.forEach((date) => {
        units.forEach((unit) => {
            entries.push({ business_date: date, source_format: fmt, status_code: unit.statusCode, rule_key: unit.ruleKey });
        });
    });
    return entries;
}

async function logUploadCoverage(db, module) {
    const entries = uploadCoverageEntries(module);
    if (!entries.length) return;
    try {
        const { error } = await db
            .from("wms_upload_coverage_log")
            .upsert(entries, { onConflict: "business_date,source_format,status_code,rule_key" });
        if (error) throw error;
        if (!state.coverageLog.dates) state.coverageLog.dates = new Map();
        entries.forEach((entry) => {
            const key = entry.status_code + "::" + entry.rule_key;
            if (!state.coverageLog.dates.has(key)) state.coverageLog.dates.set(key, new Set());
            state.coverageLog.dates.get(key).add(entry.business_date);
        });
    } catch (error) {
        console.warn("coverage log save skipped:", error);
    }
}
```

- [ ] **Step 6: Прогрузка словаря в тех же местах, что сегодня грузят офсеты правил**

```bash
grep -n "ensureZoneOffsetDepthLoaded\|ensureSourceFormatDepthLoaded" tasks.js
```
В обоих `Promise.all(...)` (`loadUploadMeta` ~12760-12766, `openChooser` ~15215-15221) заменить `ensureZoneOffsetDepthLoaded(...)` на `loadStatusDictionary(...)` + сохранить `ensureSourceFormatDepthLoaded`/`ensureCoverageLogLoaded` как есть (всё ещё нужны: первая -- для `shallowestOffsetDaysForModule`-фоллбэка при пустом словаре, вторая -- сам журнал). `ensureZoneOffsetDepthLoaded` и всё, что осталось от старого zone-based пути (если что-то не удалено в Step 2-3) -- удалить.

- [ ] **Step 7: `node --check tasks.js`**

- [ ] **Step 8: Живая проверка -- сверить календарь до/после**

Для сегодняшней известной даты (из более раннего бага в этой же сессии -- Предсортировка реально доходит только до 17.10) явно прогнать `dayCoveredForModule("general", "2026-10-17")` и `dayCoveredForModule("general", "2026-10-18")` (через Node-симуляцию, как в прошлых живых проверках этой сессии, с реальными `state.statusDictionary.rows`/`state.coverageLog.dates`, выгруженными через `supabase db query`) -- 17.10 должно быть `true` (есть реальные данные, подтверждено сегодня), 18.10 -- `false` (данных нет, тоже подтверждено сегодня). Если результат расходится -- не коммитить, разбираться.

- [ ] **Step 9: Коммит**

```bash
git add tasks.js
git commit -m "feat: журнал покрытия и dayCoveredForModule -- статусный ключ вместо зоны"
git push origin main
```

---

## Этап 4: Чистка мёртвого кода

### Task 12: Удалить хардкод-предикаты классификации

**❌ ОТМЕНЕНА (Step 1 нашёл живого потребителя).** Проверка показала:
предикаты используются не только в build-функциях (уже переключены на
словарь, Task 7-8), но и в `testUploadIsModuleCandidate` (tasks.js
~13628) -- диагностика внутри "Протестировать выгрузку"
(`openRoutingRuleTestModal`), которая НАМЕРЕННО сравнивает текущее
поведение правил с тем, что хотел бы исходный хардкод ("Whether the
module's OWN hardcode would ever have wanted this row, independent of
any rule" -- комментарий в коде), плюс ещё несколько мест того же
тестового экрана (~20374-20427). Это не мёртвый код, а осознанная
тестовая инфраструктура -- удалять нельзя. Предикаты остаются
постоянно, не как переходный мостик.

**Files (не изменяются):**
- Modify: `tasks.js:16217-16241` (`isPresortStatus`/`isLabelingStatus`/`isMarketplaceStatus`/`isPcStatus`/`isWmiMpPcStatus`/`isNoOrderUsdStatus`/`isNoOrderTmmStatus`/`isPmBufferStatus`)
- Modify: `tasks.js:16174` (`isRwpStatus`)

**Interfaces:**
- Consumes: ничего нового.
- Produces: ничего нового -- чистое удаление мёртвого кода.

- [ ] **Step 1: Подтвердить, что функции больше нигде не вызываются**

```bash
grep -n "isPresortStatus(\|isLabelingStatus(\|isMarketplaceStatus(\|isPcStatus(\|isWmiMpPcStatus(\|isPmBufferStatus(\|isRwpStatus(\|isNoOrderUsdStatus(\|isNoOrderTmmStatus(" tasks.js
```
Ожидается: единственные оставшиеся вызовы `isNoOrderUsdStatus`/`isNoOrderTmmStatus` -- внутри `effectiveKey` (Task 8, под-бакеты usd/tmm для группировки -- это НЕ классификация, см. комментарий в Task 8, НЕ удалять). Остальные (`isPresortStatus` и т.д.) не должны встречаться нигде, кроме собственного определения -- если встречаются, значит какой-то вызов пропущен в этапе 2, остановиться и разобраться, прежде чем удалять определение.

- [ ] **Step 2: Удалить неиспользуемые функции**

Удалить `isPresortStatus`/`isLabelingStatus`/`isMarketplaceStatus`/`isPcStatus`/`isWmiMpPcStatus`/`isPmBufferStatus`/`isRwpStatus` целиком (вместе с их JSDoc-комментариями, если есть). Оставить `isNoOrderUsdStatus`/`isNoOrderTmmStatus` (используются для группировки, см. Step 1), `sourceRowStatus`/`sourceStatusCode`/`mxIncludes`/`mxHasPresortExclusion`/`mxHasBuffer`/`mxHasBoxes`/`routeNumberFromMx`/`isMailRoute` (общая инфраструктура, используется в других местах -- не удалять).

- [ ] **Step 3: `node --check tasks.js`**

- [ ] **Step 4: Коммит**

```bash
git add tasks.js
git commit -m "chore: удалить хардкод-предикаты классификации -- заменены словарём статусов"
git push origin main
```

---

### Task 13: Удалить `wms_writeoff_terms` и её админ-экран

**⚠️ ЗАБЛОКИРОВАНО находкой при исполнении Task 6 (живой запрос):**
`wms_writeoff_terms` содержит ~79 статусов, но только 15 встречаются в
активных правилах `wms_routing_rules` (из которых сидировался словарь).
Остальные ~67 -- статусы из контуров ВНЕ 4 форматов выгрузки (напр.
"Чистые списания": SGR -- 32к+ строк `wms_task_items`, TTB -- 15к+, оба
без единого правила). `wms_status_dictionary` сегодня scoped именно на
4 формата (`source_format` NOT NULL, CHECK на 4 значения) -- удалить
`wms_writeoff_terms` сейчас означало бы тихо потерять срок списания для
этих ~67 статусов. Task 6 это уже обходит (словарь первичен,
`wms_writeoff_terms` фоллбэк для всего остального), так что текущее
поведение БЕЗОПАСНО и корректно -- но эта задача (полное удаление) НЕ
должна исполняться, пока явно не решено ОДНО из:
(а) расширить `wms_status_dictionary` на статусы вне 4 форматов (требует
либо relax `source_format` до nullable/добавить 5-е значение вроде
`'other'`, либо завести отдельный механизм), или
(б) оставить `wms_writeoff_terms` постоянно как источник "сроков
списания для всего, что не входит в 4 формата выгрузки" -- т.е. снять
эту задачу из плана вовсе, спека была не вполне точна в части "полного
поглощения".
Спросить пользователя перед исполнением, не решать самостоятельно.

**Files:**
- Create: `supabase/migrations/202610200008_drop_wms_writeoff_terms.sql`
- Modify: `tasks.js` (`loadWriteoffTerms`, `renderWriteoffTermsModal`, `openWriteoffTermsModal`, `writeoffTermInputRows` и связанные -- см. Step 1)
- Modify: `tasks.html` (кнопка `#openWriteoffTerms`, секция `#writeoffTermsModal`)

**Interfaces:**
- Consumes: ничего.
- Produces: ничего -- чистое удаление.

- [ ] **Step 1: Найти всё, что относится к старому экрану**

```bash
grep -n "writeoffTerm\|WriteoffTerm\|WRITEOFF_TERMS\|writeoffTermsModal\|openWriteoffTerms" tasks.js tasks.html
```

- [ ] **Step 2: Удалить JS-функции и HTML**

Удалить: `loadWriteoffTerms`, `renderWriteoffTermsModal`, `openWriteoffTermsModal`, `closeWriteoffTermsModal`, `writeoffTermInputRows`, `writeoffTermRowHtml` (и аналоги -- найдены в Step 1), `state.writeoffTerms`, обработчик `$("openWriteoffTerms").addEventListener(...)` (`tasks.js:20285`), секцию `<section id="writeoffTermsModal">` и кнопку `<button id="openWriteoffTerms">` в `tasks.html`. **Не удалять**: `defaultWriteoffTerms`/`normalizeWriteoffTermType`/`normalizeWriteoffTermKey`/`activeWriteoffStatusTerms`/`writeoffDateInfoForRow`/`writeoffDateInfoForRows`/`writeoffTermSort` -- они уже переписаны на словарь в Task 6 и остаются рабочей частью системы (имена не менялись, только источник данных).

- [ ] **Step 3: `node --check tasks.js`**

- [ ] **Step 4: Миграция -- удалить таблицу**

```sql
-- wms_writeoff_terms выведена из эксплуатации -- сроки списания
-- читаются из wms_status_dictionary (Task 6, этап 2). Данные уже
-- перенесены в словарь сидом (Task 2, миграция 202610200005).
drop table public.wms_writeoff_terms;
```

- [ ] **Step 5: Проверить в транзакции**

```bash
cat > /tmp/test_drop_writeoff.sql <<'EOF'
begin;
drop table public.wms_writeoff_terms;
select count(*) as should_be_0 from information_schema.tables where table_name = 'wms_writeoff_terms';
rollback;
EOF
supabase db query --linked --file /tmp/test_drop_writeoff.sql
```

- [ ] **Step 6: Применить реально, зарегистрировать**

```bash
supabase db query --linked --file supabase/migrations/202610200008_drop_wms_writeoff_terms.sql
cat > /tmp/register_202610200008.sql <<'EOF'
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('202610200008', 'drop_wms_writeoff_terms', array['select 1'])
on conflict (version) do nothing;
EOF
supabase db query --linked --file /tmp/register_202610200008.sql
```

- [ ] **Step 7: Коммит**

```bash
git add tasks.js tasks.html supabase/migrations/202610200008_drop_wms_writeoff_terms.sql
git commit -m "chore: удалить wms_writeoff_terms и её экран -- заменены словарём статусов"
git push origin main
```

---

## Самопроверка плана против спеки

- **Схема словаря** (спека, "Архитектура") -- Task 1. ✓
- **Связь с `wms_routing_rules` без новой колонки** -- Task 5. ✓ Движок условий не тронут ни в одной задаче (проверено: ни один шаг не редактирует `wms_rule_conditions_match`, `wms_evaluate_rule_batch`, `routingRuleConditionHtml`/форму условий).
- **`wms_writeoff_terms` поглощается** -- Task 6 (переключение) + Task 13 (удаление). ✓
- **Классификация ШК** (general/packaging/no_order, фоллбэк на словарь) -- Tasks 7-8. ✓ `after_sale_movement` явно пропущен с объяснением (нет фоллбэка, не нужен).
- **Срок разбора** (словарь при 0/1 правил, правило при 2+) -- Task 11 (`requiredStatusUnitsForModule` строит единицы по правилам ИЛИ дефолту на статус, ровно по одной записи на правило, если их несколько). ✓
- **Журнал покрытия на статусный ключ, вариант 2** -- Tasks 9-11. ✓
- **Catch-all строки (`status_code='*'`)** -- учтены в сиде (Task 2), в классификации (Task 7-8 через `statusDictionaryCatchAll`), в журнале (Task 11 -- `requiredStatusUnitsForModule` обрабатывает `'*'` как обычную строку словаря, без особого случая в коде). ✓
- **Экран админки, клик -> модалка правил с фильтром** -- Tasks 4-5. ✓
- **Поэтапная раскатка, 4 этапа** -- структура плана. ✓
- **Чистка мёртвого кода последней** -- Tasks 12-13, после того как Tasks 6-11 подтверждены живыми проверками. ✓

Заглушек/неопределённых шагов нет -- каждый код-шаг содержит реальный код; шаги "прочитать код перед правкой" содержат точную команду, а не описание "посмотреть что там".
