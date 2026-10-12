# Участки разбора (REVIEW_SECTIONS) -- настраиваемые администратором

## Контекст

`REVIEW_SECTIONS` (tasks.js:428-440) -- захардкоженный список из 11
"участков разбора" (Упаковка/RWP/ПМ/Почта/Предсортировка/Маркетплейс/
ПЦ/WMI (МП + ПЦ)/Без заказа/Движение после продажи/Другие задачи).
Пользователь хочет управлять этим списком из интерфейса, без правки
кода: "По факту у нас будут правила распределения по 'папкам'
(участкам), список которых может меняться."

Область действия: только `REVIEW_SECTIONS`. `REQUEST_SECTIONS`
("Заявки" -- Запросы входящего потока/Списания AWH/Коробки на входе +
спецкейс "2-я линия предсписка") явно исключены пользователем из
текущей задачи.

Фундамент (routing engine, МХ-матчинг, `wms_rule_conditions_match`)
уже в проде -- см. [[2026-10-13-wms-upload-settings-engine-design]].
Эта фича с ним не пересекается по коду, но пользуется тем же паттерном
"захардкоженный дефолт + опциональная таблица поверх" (как
`DEFAULT_MODULES`/`wms_manual_upload_settings`).

## Текущее положение дел (инвентаризация)

`REVIEW_SECTIONS` используется в 10 местах в tasks.js:
- 1909: дефолтные зоны "исходящей" роли при миграции старого формата ростера смены
- 1921: `SHIFT_ROSTER_ZONES = REVIEW_SECTIONS.concat(REQUEST_SECTIONS)` -- константа, вычисляется один раз при загрузке скрипта
- 2889: дефолтный активный участок в Предразборе
- 6080: `reviewGroupedRows()` -- заводит пустые корзины по каждому участку
- 6358: `filterOptionsForRows()` -- список участков для фильтра
- 7014, 7019, 7036: `renderReviewSections()` -- порядок/рендер плиток участков
- 7164: дефолтный активный участок при рендере таблицы
- 12279: `routingRuleRowHtml()` -- выпадающий список "куда класть" в конструкторе правил
- 12396: `addRoutingRuleDraft()` -- дефолтное значение нового правила

`SHIFT_ROSTER_ZONES` (производная от REVIEW_SECTIONS) используется в 3
местах: 1925 (чекбоксы ростера), 2745 (предупреждение о непокрытых
участках), 5031 (счётчики для Флоу).

Классификация задачи по участку (`taskSectionName`, tasks.js:4827)
сегодня НЕ читает `REVIEW_SECTIONS` вообще -- отдельная функция с
подстроковой эвристикой по `task_type`/`title`/`source_module`/
`upload_type`. Возвращает ровно одну строку, которая ПОЧТИ всегда
совпадает с одним из элементов `REVIEW_SECTIONS` -- кроме одного случая
("Чистые списания", task_type-точное совпадение, не входит в список).
Задачи, созданные движком правил (Фаза 1/2a/2b), уже сегодня получают
`task_type`, РАВНЫЙ точному имени зоны (например `"ПЦ"`), без префиксов
вроде `"Разбор ОПП // "` -- в отличие от legacy-задач, созданных старым
JS-кодом напрямую.

Нет ни одного DB-уровневого CHECK/enum, ограничивающего имена участков
-- только клиентский `<select>` в конструкторе правил маршрутизации.

## Дизайн

### 1. Данные

Новая таблица, сидится текущими 11 строками:

```sql
create table public.wms_review_zones (
    name text primary key,
    sort_order integer not null,
    is_active boolean not null default true,
    updated_at timestamptz not null default timezone('utc', now())
);

grant select, insert, update, delete on public.wms_review_zones to anon, authenticated;

insert into public.wms_review_zones (name, sort_order) values
    ('Упаковка', 1), ('RWP', 2), ('ПМ', 3), ('Почта', 4),
    ('Предсортировка', 5), ('Маркетплейс', 6), ('ПЦ', 7),
    ('WMI (МП + ПЦ)', 8), ('Без заказа', 9),
    ('Движение после продажи', 10), ('Другие задачи', 11);
```

Без RLS (как и у `wms_module_settings`/`wms_routing_rules`) -- тот же
паттерн широких grants, принятый во всём проекте для этого warehouse.

### 2. Клиент: дефолт + загрузка + геттер

`REVIEW_SECTIONS` остаётся в коде как хардкоженный дефолт/фолбэк (тот
же паттерн, что `DEFAULT_MODULES`) -- используется только внутри нового
геттера, нигде больше напрямую.

```js
state.reviewZones = { rows: [], loading: false, saving: false, loaded: false, error: "" };

function activeReviewZones() {
    const rows = (state.reviewZones.rows || [])
        .filter((row) => row.is_active !== false)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((row) => row.name)
        .filter(Boolean);
    return rows.length ? rows : REVIEW_SECTIONS;
}

function shiftRosterZones() {
    return activeReviewZones().concat(REQUEST_SECTIONS);
}

async function loadReviewZones(force) {
    if (state.reviewZones.loaded && !force) return true;
    const db = supabaseDb();
    state.reviewZones.loading = true;
    state.reviewZones.error = "";
    if (!db) {
        state.reviewZones.loading = false;
        return false;
    }
    try {
        const { data, error } = await db
            .from("wms_review_zones")
            .select("*")
            .order("sort_order", { ascending: true });
        if (error) throw error;
        state.reviewZones.rows = data || [];
        state.reviewZones.loaded = true;
        return true;
    } catch (error) {
        state.reviewZones.error = "Не удалось загрузить участки: " + (error && error.message ? error.message : String(error));
        console.warn("review zones load skipped:", error);
        return false;
    } finally {
        state.reviewZones.loading = false;
        renderReviewZonesModal();
    }
}
```

Загрузка запускается один раз, рано, при старте приложения -- рядом с
`void loadWriteoffTerms();` в `init()` (tasks.js:18855):

```js
void loadReviewZones();
```

Это тот же fire-and-forget паттерн, что уже используют
`loadWriteoffTerms`/`loadShiftState`/`loadAchievements` -- к моменту,
когда пользователь реально откроет Предразбор/Флоу/форму открытия
смены, быстрый одиночный запрос почти наверняка уже отработает; до
этого момента `activeReviewZones()` отдаёт захардкоженный дефолт,
который сегодня и так совпадает с реальными данными.

### 3. Замена вызовов (10 + 3 места, механическая правка)

Каждое голое упоминание `REVIEW_SECTIONS` (все 10 мест, перечисленных в
инвентаризации) заменяется на вызов `activeReviewZones()`.
`SHIFT_ROSTER_ZONES` (константа) становится вызовом `shiftRosterZones()`
во всех 3 местах использования. Сама константа `SHIFT_ROSTER_ZONES`
удаляется (больше не вычисляется один раз при загрузке скрипта -- она
не может быть константой, раз зависит от асинхронно загруженных
данных).

### 4. `taskSectionName`: точное совпадение сначала

```js
function taskSectionName(row) {
    const taskType = normalizeForMatch(row && row.task_type);
    const exactZones = activeReviewZones();
    const exactMatch = exactZones.find((zone) => normalizeForMatch(zone) === taskType);
    if (exactMatch) return exactMatch;
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

Только добавлен ранний выход на точное совпадение `task_type` с именем
активной зоны (нормализация та же, что и везде в функции). Остальная
цепочка подстрок -- без изменений, продолжает работать для
legacy-задач. Новая, добавленная администратором зона автоматически
заработает для задач, которые движок правил создаёт с `task_type`,
равным её точному имени -- без правки этой функции. Для зон, на
которые ссылается только JS-хардкод создания задач (а не движок
правил), понадобится отдельная работа (не в этом спеке -- отдельная
history-aware зона потребует и свой путь создания задач, это за
рамками текущего запроса).

### 5. Админ-модалка "Участки разбора"

Мирорит `moduleSettingsModal` (самый близкий по форме существующий
паттерн -- плоский список строк, без group-by типа, как у
`writeoffTermsModal`). Кнопка-вход в общий грид рядом с "Параметры
модулей"/"Правила маршрутизации" (tasks.html:1991).

HTML (`tasks.html`, после блока `moduleSettingsModal`):

```html
<section id="reviewZonesModal" class="tasks-flow-modal upload-work" aria-hidden="true">
    <div class="tasks-flow-card tasks-flow-card-wide">
        <div class="work-head">
            <div>
                <h3 class="work-title">Участки разбора</h3>
                <p class="work-subtitle">Список "папок" Предразбора (Упаковка, RWP, ПЦ и т.д.) -- отсюда их читают Предразбор, Флоу и ростер смены. Порядок задаёт очерёдность показа, выключенный участок скрывается из этих списков (существующие задачи никуда не денутся -- просто попадут в "Другие задачи").</p>
            </div>
            <button id="closeReviewZones" class="btn btn-square" type="button" aria-label="Закрыть">×</button>
        </div>
        <div id="reviewZonesWrap" class="writeoff-terms-wrap"></div>
        <div class="file-row">
            <button id="addReviewZone" class="btn btn-outline" type="button">Добавить участок</button>
            <button id="saveReviewZones" class="btn btn-rect" type="button">Сохранить участки</button>
            <button id="reloadReviewZones" class="btn btn-outline" type="button">Обновить из Supabase</button>
        </div>
        <div id="reviewZonesStatus" class="review-status"></div>
    </div>
</section>
```

Кнопка-вход (`tasks.html`, после `openModuleSettings`):

```html
<button id="openReviewZones" class="tasks-action-card" type="button" data-dev-only>
    <span class="tasks-action-icon">🗂️</span>
    <h2 class="tasks-action-title">Участки разбора</h2>
    <p class="tasks-action-text">Список участков Предразбора (Упаковка, RWP, ПЦ и т.д.) -- без правки кода.</p>
</button>
```

JS (`tasks.js`, рядом с аналогичными функциями module settings):

```js
function reviewZoneRowHtml(row) {
    return "<div class='writeoff-term-row' data-review-zone-row data-zone-name-original='" + escapeHtml(row.name || "") + "'>"
        + "<input data-zone-sort type='number' min='1' step='1' value='" + escapeHtml(row.sort_order || "") + "' placeholder='Порядок'>"
        + "<input data-zone-name type='text' value='" + escapeHtml(row.name || "") + "' placeholder='Название участка'>"
        + "<label class='writeoff-term-active'><input data-zone-active type='checkbox' " + (row.is_active === false ? "" : "checked") + "> активен</label>"
        + "<button type='button' class='btn btn-square' data-zone-remove aria-label='Удалить'>×</button>"
        + "</div>";
}

function renderReviewZonesModal() {
    const target = $("reviewZonesWrap");
    if (!target) return;
    const rows = state.reviewZones.rows || [];
    target.innerHTML = (state.reviewZones.error ? "<div class='status-line error'>" + escapeHtml(state.reviewZones.error) + "</div>" : "")
        + (state.reviewZones.loading ? "<div class='status-line'>Загружаю участки...</div>" : "")
        + "<div class='writeoff-term-head'><span>Порядок</span><span>Название</span><span>Вкл.</span></div>"
        + "<div class='writeoff-term-list'>" + rows.map(reviewZoneRowHtml).join("") + "</div>";
    target.querySelectorAll("[data-zone-remove]").forEach((button) => {
        button.addEventListener("click", () => removeReviewZoneRow(button.closest("[data-review-zone-row]")));
    });
}

async function removeReviewZoneRow(rowEl) {
    if (!rowEl) return;
    const name = rowEl.getAttribute("data-zone-name-original");
    if (name) {
        const db = supabaseDb();
        if (db) {
            try {
                const { error } = await db.from("wms_review_zones").delete().eq("name", name);
                if (error) throw error;
            } catch (error) {
                toast("Не удалось удалить участок: " + (error && error.message ? error.message : String(error)), "error");
                return;
            }
        }
    }
    rowEl.remove();
}

function addReviewZoneDraft() {
    const rows = state.reviewZones.rows || [];
    const nextOrder = rows.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0) + 1;
    state.reviewZones.rows = rows.concat({ name: "", sort_order: nextOrder, is_active: true });
    renderReviewZonesModal();
}

function reviewZoneInputRows() {
    return Array.from(document.querySelectorAll("[data-review-zone-row]")).map((row) => {
        const name = normalizeText(row.querySelector("[data-zone-name]") && row.querySelector("[data-zone-name]").value);
        if (!name) return null;
        return {
            name,
            sort_order: Math.max(1, Math.trunc(settingNumber(row.querySelector("[data-zone-sort]") && row.querySelector("[data-zone-sort]").value, 1))),
            is_active: row.querySelector("[data-zone-active]").checked,
            updated_at: new Date().toISOString(),
        };
    }).filter(Boolean);
}

async function openReviewZonesModal() {
    if (!ensureDevelopmentAccess("Участки разбора")) return;
    closeFlowModals();
    setFlowModalOpen("reviewZonesModal", true);
    renderReviewZonesModal();
    await loadReviewZones(true);
}

function closeReviewZonesModal() {
    setFlowModalOpen("reviewZonesModal", false);
}

async function saveReviewZonesFromModal() {
    const db = supabaseDb();
    const status = $("reviewZonesStatus");
    const button = $("saveReviewZones");
    const rows = reviewZoneInputRows();
    if (!rows.length) {
        if (status) status.textContent = "Нет строк для сохранения.";
        return;
    }
    if (!db) {
        if (status) status.textContent = "Supabase недоступен.";
        return;
    }
    if (button) button.disabled = true;
    state.reviewZones.saving = true;
    if (status) status.textContent = "Сохраняю участки...";
    try {
        const { error } = await db.from("wms_review_zones").upsert(rows, { onConflict: "name" });
        if (error) throw error;
        state.reviewZones.loaded = false;
        await loadReviewZones(true);
        if (status) status.textContent = "Участки сохранены.";
        toast("Участки разбора сохранены.", "success");
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        state.reviewZones.error = "Не удалось сохранить участки: " + message;
        if (status) status.textContent = state.reviewZones.error;
    } finally {
        state.reviewZones.saving = false;
        if (button) button.disabled = false;
    }
}
```

Проводка событий -- рядом с аналогичными строками для routing rules/
module settings (tasks.js:18562-18616, 18781-18782):

```js
$("openReviewZones").addEventListener("click", () => { void openReviewZonesModal(); });
// ...
$("closeReviewZones").addEventListener("click", closeReviewZonesModal);
$("addReviewZone").addEventListener("click", addReviewZoneDraft);
$("saveReviewZones").addEventListener("click", () => { void saveReviewZonesFromModal(); });
$("reloadReviewZones").addEventListener("click", () => { void loadReviewZones(true); });
// ...
$("reviewZonesModal").addEventListener("click", (event) => { if (event.target === $("reviewZonesModal")) closeReviewZonesModal(); });
```

Важно: переименование строки в этой модалке -- это создание НОВОЙ
зоны + удаление старой (upsert по `name` как PK не ловит переименование
автоматически) -- `removeReviewZoneRow` удаляет по исходному имени при
клике на "Удалить", а правка текста в поле "Название" у существующей
строки перед "Сохранить" создаст отдельную новую запись, не тронув
старую (та останется, пока её не удалят явно). Это осознанное упрощение
(тот же компромисс уже существует у `moduleSettingRowHtml` для ключей) --
переименование зоны одновременно с переносом существующих задач на неё
не входит в объём этой фичи.

## Что НЕ входит в объём

- `REQUEST_SECTIONS` -- не трогаем.
- Миграция существующих задач при деактивации/удалении зоны -- не
  делаем ничего; `taskSectionName` для них просто продолжит возвращать
  то же значение (через цепочку подстрок), и `reviewGroupedRows`
  положит такую задачу в "Другие задачи", если её точное имя зоны
  больше не входит в активный список (сегодняшнее поведение для любой
  неизвестной строки).
- Переименование зоны с переносом задач -- не делаем (см. выше).
- Два известных заранее несвязанных момента (зона "Чистые списания" вне
  списка; `marketplace_pc.column` не совпадает ни с одной зоной) --
  не трогаем, существовали и до этой фичи.
