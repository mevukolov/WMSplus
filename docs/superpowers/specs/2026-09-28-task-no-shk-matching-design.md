# Интеграция "Без ШК" в задачи Разбора — дизайн

**Codebase:** `/Users/WBwork/Downloads/WMSplus-main` — `tasks.html`/`tasks.js` (Разбор), `intake_search.js` (лента "Без ШК" / "Поиск товара без ШК"), Supabase (`bgphllmzmlwurfnbagho`).

## Проблема

Товар, потерявший ШК, может позже всплыть на складе и быть сфотографирован через форму "Без ШК" (таблица `intake_submissions`). Сейчас это два не связанных друг с другом потока: задача Разбора не знает про фото "без ШК", и наоборот. Нужно связать их по вероятному совпадению (НМ + окно дат), показать сотруднику это совпадение прямо в карточке задачи, и дать решить: это тот же товар или нет.

## Существующие строительные блоки (переиспользуем, не дублируем)

- **Пиллы "Два ШК"/"Пустая упаковка"**: вычисляются один раз при создании задачи (`taskRecord`, [tasks.js:14538](tasks.js:14538), через `loadSpecialMap`/`specialInfosForIds`/`mergeTags`), персистятся в `tags` + `source_payload.special_infos`. При каждом открытии карточки — точечный live-подхват новых совпадений (`refreshTaskSpecialTags`, [tasks.js:8990](tasks.js:8990)): запрос идёт ПОСЛЕ первой отрисовки карточки (`void refreshTaskSpecialTags(row)`, не блокирует открытие), обновляет `row.tags`/`row.source_payload`, перерисовывает карточку (если она ещё открыта) и таблицу. Это ровно тот паттерн производительности, который просил пользователь — переиспользуем его один в один для "Без ШК".
- **`intake_submissions`**: таблица ленты "Без ШК" (миграции `202609040001`…`202609250001`). Колонки: `id, created_at, item_text, employee_id, full_name, area, category, item_type (Мелкий товар/КГТ/Шредер), photo_path, sticker_code, shift_date, shift_type, no_shk_bucket, wb_nm_candidates (jsonb, массив nm), wb_nm_checked_at`. `wb_nm_candidates` считается раз в минуту Edge Function `wb-photo-match` (реверс-инжиниренный поиск по фото WB) — уже готовые "вероятные НМ", ничего заново считать не нужно.
- **`intake_search.js`**: самодостаточный IIFE, уже отрисовывает карточку/лайтбокс "без ШК" целиком: фото, НМ-кандидаты ссылками на WB, наименование, участок (`areaPillHtml`), сотрудник, присвоенный стикер (`decodeStickerCode`), кнопка "Присвоить ШК" (`renderAssignRow`/`confirmAssignSticker`/RPC `wms_intake_assign_sticker`). Переиспользуем `openPhotoLightbox(item, id)` для клика по строке истории вместо повторной вёрстки.
- **Фото товара по НМ с WB**: `fetchWbCardInfo(nm)` (через Edge Function `wb-card-lookup`, [tasks.js:14351](tasks.js:14351)) + `buildWbImageCandidatesByNm`/`findFirstLoadableImage` ([tasks.js:14231](tasks.js:14231)/[tasks.js:14316](tasks.js:14316)) — уже используются в "Быстром разборе Без ШК" (`state.quickNoShk`) для той же самой задачи (показать фото карточки WB по НМ). Переиспользуем эти функции напрямую, с отдельным собственным кэшем.
- **История задачи**: `writeTaskHistory(row, eventType, payload)` ([tasks.js:6251](tasks.js:6251)), актёр берётся из `flowActor()` ([tasks.js:5819](tasks.js:5819)) — текущий залогиненный пользователь. `TASK_HISTORY_EVENT_LABELS` ([tasks.js:9124](tasks.js:9124)) — карта event_type → подпись. Клик по строке истории — уже есть делегированный обработчик `[data-history-link]` ([tasks.js:17887](tasks.js:17887)), расширяем по аналогии.
- **Фильтры участков**: `applySectionFilters`/`renderSectionFilters`/`filterOptionsForRows` ([tasks.js:7179](tasks.js:7179), [tasks.js:7250](tasks.js:7250), [tasks.js:7193](tasks.js:7193)) — чекбоксовые попапы по `mode` (review/requests), Set-based (`FILTER_NONE` = ничего не выбрано, пустой Set = выбрано всё). Добавляем новый ключ `specialTags`.
- **Таблица участков**: `reviewRowCellsHtml` ([tasks.js:7953](tasks.js:7953)) — статус-ячейка `<span class='review-pill'>...</span>` + `manualVerdictPillHtml`. Сейчас "Два ШК"/"Пустая упаковка" в таблице НЕ показываются вообще (только в карточке, блок "Теги", `taskTagsBox`, [tasks.js:8971](tasks.js:8971)) — это меняем для всех трёх тегов сразу.

## A. Матчинг: как считается совпадение

**Окно дат** (подтверждено пользователем): фото "без ШК" должно быть сделано либо за 1 день ДО последнего движения задачи, либо в течение 5 дней ПОСЛЕ него — `intake_submissions.created_at ∈ [движение_задачи − 1 день; движение_задачи + 5 дней]`. "Последнее движение" — то же поле, что уже вычисляет `synthesizeForecastHistoryEntries` (`item.movement`, [tasks.js:9295](tasks.js:9295)), не дата создания задачи.

**Когда считается**: точечно, при каждом открытии карточки задачи — как "Два ШК". Не влияет на рендер списка/таблицы участков (та же exact экономия, что уже даёт `refreshTaskSpecialTags`).

**Новая RPC** `wms_no_shk_task_matches(p_nms text[], p_date_from date, p_date_to date)`:
```sql
create or replace function public.wms_no_shk_task_matches(
    p_nms text[],
    p_date_from date,
    p_date_to date
) returns table (
    id uuid, item_text text, category text, item_type text, area text,
    full_name text, employee_id integer, created_at timestamptz,
    photo_path text, sticker_code text, no_shk_bucket text,
    wb_nm_candidates jsonb, matched_task_id uuid, matched_shk text
)
language sql security definer set search_path = public stable
as $$
    select id, item_text, category, item_type, area, full_name, employee_id,
           created_at, photo_path, sticker_code, no_shk_bucket,
           wb_nm_candidates, matched_task_id, matched_shk
    from public.intake_submissions
    where matched_task_id is null
      and created_at >= p_date_from and created_at < p_date_to + interval '1 day'
      and exists (
          select 1 from jsonb_array_elements_text(coalesce(wb_nm_candidates, '[]'::jsonb)) elem
          where elem = any(p_nms)
      )
    order by created_at desc
    limit 50;
$$;
grant execute on function public.wms_no_shk_task_matches(text[], date, date) to anon;
```
`jsonb_array_elements_text` работает независимо от того, хранятся кандидаты как числа или строки (числовой jsonb-массив тоже разворачивается в текст) — так надёжнее, чем `?|` (который у jsonb гарантированно матчит только строковые элементы). Дополнительный индекс — обычный (не partial, не GIN: окно всего 6 дней, объём таблицы не оправдывает GIN):
```sql
create index if not exists intake_submissions_created_at_idx on public.intake_submissions (created_at);
```

**Условие `matched_task_id is null`** — уже опознанные в другой задаче записи не всплывают кандидатами снова (раздел F).

## B. Хранение состояния на задаче

`source_payload.no_shk_matches` — массив объектов:
```json
{
  "submission_id": "uuid",
  "nm": "123456",
  "matched_at": "2026-09-28T10:00:00Z",
  "decision": "pending",
  "decided_by_id": "",
  "decided_by_name": "",
  "decided_at": "",
  "snapshot": { "item_text": "...", "photo_path": "...", "full_name": "...", "area": "...", "created_at": "...", "sticker_code": null, "item_type": "Мелкий товар" }
}
```
`snapshot` — копия нужных для мини-модалки/истории полей на момент матча (не нужно перезапрашивать `intake_submissions` при каждом открытии/клике по истории).

Новая функция `refreshTaskNoShkMatches(row)` (аналог `refreshTaskSpecialTags`, [tasks.js:8990](tasks.js:8990)):
1. Собрать nm задачи: `taskItems(row).map(i => i.nm).filter(Boolean)`, дату движения (макс. `item.movement` по всем товарам задачи).
2. Если нет ни nm, ни движения — выйти.
3. `db.rpc("wms_no_shk_task_matches", { p_nms: nms, p_date_from, p_date_to })`.
4. Смёрджить с уже персистнутыми `no_shk_matches` по `submission_id` — новые добавляются как `pending`, существующие (с любым decision) не трогаются.
5. Если появилось хоть одно новое — записать `source_payload` в БД, обновить `row` в памяти, перерисовать карточку (если ещё открыта) и таблицу — один в один как `refreshTaskSpecialTags` делает для тегов ([tasks.js:9018](tasks.js:9018)–[tasks.js:9021](tasks.js:9021)).

Вызывается там же, где `refreshTaskSpecialTags`: `openTaskDetail` ([tasks.js:8473](tasks.js:8473), [tasks.js:8477](tasks.js:8477)) — `void refreshTaskNoShkMatches(row);` рядом со старым вызовом, тоже fire-and-forget после первой отрисовки.

**При создании задачи** — матчинг НЕ считаем (в отличие от "Два ШК", где `loadSpecialMap` уже вызывается пачкой на весь upload). Причина: тройной scope by design — "Без ШК" фото может появиться и до, и после создания задачи, а сам матчинг требует диапазона дат непосредственно от `item.movement`, который для только что загруженной пачки уже известен, но гонять RPC на каждую строку большого upload (потенциально тысячи) — то самое лишнее нагружение, от которого пользователь просил беречь производительность. Первое открытие карточки покроет это так же, как "Два ШК" сейчас закрывает пробел ретроактивно (см. комментарий на [tasks.js:8984](tasks.js:8984)). Таблица до первого открытия соответствующей задачи пилл не покажет — это тот же принятый trade-off, что уже есть у "Два ШК"/"Пустая упаковка" сегодня, не новая деградация.

**Пилл "Без ШК"** показывается, если `no_shk_matches.length > 0` — независимо от `decision` (отклонённые совпадения не "стирают" пилл, по требованию пользователя).

## C. UI

### Пилл в таблице и карточке
Новая функция `specialTagPillsHtml(row)`:
```js
function specialTagPillsHtml(row) {
    const tags = new Set(reviewTags(row));
    if (taskNoShkMatches(row).length) tags.add("Без ШК");
    const order = ["Без ШК", "Два ШК", "Пустая упаковка"];
    return order.filter((t) => tags.has(t))
        .map((t) => "<button type='button' class='review-pill tone-special' data-special-pill='" + escapeHtml(t) + "'>" + escapeHtml(t) + "</button>")
        .join("");
}
```
- В `reviewRowCellsHtml` ([tasks.js:7961](tasks.js:7961)): `"<td>...</td>" + manualVerdictPillHtml(row) + specialTagPillsHtml(row)`.
- В карточке задачи (`taskDetailInfo`/рядом с текущим статусом в `renderTaskDetail`) — тот же вызов `specialTagPillsHtml(row)`.
- Клик по пиллу `[data-special-pill='Без ШК']` → `openNoShkMatchModal(row)`. Клик по `[data-special-pill='Два ШК']`/`['Пустая упаковка']` — оставляем текущее поведение (открывает существующий `specialInfoModal` через `taskSpecialInfos`, как сейчас из `taskTagsBox`).

### Мини-модалка совпадений (новая)
Новый модал `noShkMatchModal` в `tasks.html`, список карточек — одна на каждый элемент `no_shk_matches`:
- Фото "без ШК" (`snapshot.photo_path`) — новый маленький локальный хелпер в `tasks.js`, `noShkPhotoUrl(path)`, дублирующий `buildIntakePhotoUrl` из `intake_search.js` (тот же публичный bucket `intake-photos`, тот же URL-паттерн) — не шарим функцию между файлами, тем же способом, каким сам `intake_search.js` объявляет себя самодостаточным.
- Фото товара по НМ с WB — `buildWbImageCandidatesByNm(nm, {...}) + findFirstLoadableImage`, кэш `state.noShkMatch.photoCache[nm]` (свой, не смешиваем с `state.quickNoShk`).
- Наименование WB — `fetchWbCardInfo(nm)`, кэш `state.noShkMatch.cardInfoCache[nm]`.
- Кто сфотографировал (`snapshot.full_name`), участок (`snapshot.area`, `areaPillHtml`-стиль).
- Если `snapshot.item_type === 'Шредер'` или `snapshot.sticker_code` — строка "Присвоенный ШК: <decodeStickerCode(sticker_code) || 'Шредер'>".
- Если `decision === 'pending'` — кнопки "Опознать"/"Не тот товар".
- Если `decision === 'rejected'` — текст "Соответствие не подтверждено. <decided_by_name>" вместо кнопок.
- Если `decision === 'confirmed'` — текст "Опознано: <decided_by_name>, <decided_at>" + кликабельная строка "Открыть карточку без ШК" (вызывает тот же `window.__openIntakeSubmissionCard`, см. раздел D).

Загрузка фото/WB-инфо асинхронная, не блокирует открытие модалки (та же лениво-подгружаемая схема, что у `quickNoShkCardInfoHtml`/`loadQuickNoShkCardInfo`, [tasks.js:4639](tasks.js:4639)–[tasks.js:4658](tasks.js:4658)) — модалка открывается сразу со скелетоном "Смотрю карточку на WB...", дозаполняется по прилёту.

### Клик по строке истории
`intake_search.js` — единственная точка входа наружу, добавляется рядом с объявлением `openPhotoLightbox`:
```js
window.__openIntakeSubmissionCard = function (item) {
    if (!item || !item.photo_path) return;
    const id = "ext" + (++itemAutoId);
    itemsById.set(id, item);
    openPhotoLightbox(item, id);
};
```
`tasks.js`, делегированный обработчик рядом с `[data-history-link]` ([tasks.js:17887](tasks.js:17887)):
```js
const noShkRow = event.target.closest && event.target.closest("[data-history-no-shk]");
if (noShkRow && window.__openIntakeSubmissionCard) {
    window.__openIntakeSubmissionCard(JSON.parse(noShkRow.dataset.historyNoShk));
}
```
Payload строки истории несёт `snapshot` целиком (см. раздел D) — клик открывает карточку без повторного запроса к БД.

## D. История задачи

`TASK_HISTORY_EVENT_LABELS` — новая запись: `task_no_shk_found: "Найден без ШК"`.

По кнопке "Опознать" (для конкретного элемента `no_shk_matches`):
1. `db.rpc("wms_intake_mark_matched", { p_submission_id, p_task_id: row.id, p_shk, p_actor_id, p_actor_name })` (раздел F). `p_shk` — ШК того конкретного товара задачи, чей nm совпал (`taskItems(row).find(i => i.nm === match.nm)?.shk`, а не произвольный первый ШК задачи — на многотоварной задаче это разные вещи). Если RPC вернула 0 строк (уже опознано в другой задаче) — тост с ошибкой, дальше не идём.
2. Комментарий: `"Товар обнаружен без ШК"` + (если у snapshot был `sticker_code`/`item_type === 'Шредер'`) доп. строка `"Обработан через стол старшего под ШК: " + decodeStickerCode(sticker_code)`.
3. `writeTaskHistory(row, "task_no_shk_found", { comment, submission: snapshot })` — фиксированный текст события "Найден без ШК" (`TASK_HISTORY_EVENT_LABELS.task_no_shk_found`), актёр — текущий пользователь (`flowActor()`, уже внутри `writeTaskHistory`).
4. Обновить `no_shk_matches[i].decision = 'confirmed'`, `decided_by_id/name/at`, сохранить `source_payload`, перерисовать карточку.

`taskHistoryFeedItemHtml` ([tasks.js:9180](tasks.js:9180)) — добавляем `isNoShkFound = item.event_type === "task_no_shk_found"`, рендерим строку кликабельной: `data-history-no-shk='<JSON.stringify(payload.submission)>'` (аналогично `data-history-link`), `verdict` = `"Найден без ШК"` (фикс. текст, без ветвления по контексту — подтверждено пользователем), `comment` = `payload.comment`.

По кнопке "Не тот товар": `no_shk_matches[i].decision = 'rejected'`, `decided_by_id/name/at`, сохранить `source_payload`, перерисовать модалку. **В `wms_task_history` ничего не пишется.** `intake_submissions` не трогается.

## E. Фильтры

Новый ключ `specialTags` в `createReviewFilterState`/`sectionFilterState`, значения — `["Без ШК", "Два ШК", "Пустая упаковка"]`. `taskSpecialTagFilterValues(row)` — объединение `reviewTags(row)` ∩ этих трёх + `"Без ШК"`, если есть `no_shk_matches`. В `applySectionFilters` ([tasks.js:7179](tasks.js:7179)): `if (filters.specialTags.size && !taskSpecialTagFilterValues(row).some(v => filters.specialTags.has(v))) return false;`. В `filterOptionsForRows`/`renderSectionFilters` — новый `control("specialTags", "Спец-теги", ..., renderFilterCheckboxes(...))`, тот же чекбоксовый паттерн, что у `movementStatuses`/`taskStatuses`.

## F. Обратная пометка на `intake_submissions`

Новые колонки:
```sql
alter table public.intake_submissions
    add column matched_task_id uuid references public.wms_tasks(id),
    add column matched_shk text,
    add column matched_at timestamptz,
    add column matched_by_id text,
    add column matched_by_name text;
```

Новая RPC (тот же паттерн, что `wms_intake_assign_sticker`, [supabase/migrations/202609090003_intake_sticker_assignment.sql](supabase/migrations/202609090003_intake_sticker_assignment.sql)):
```sql
create or replace function public.wms_intake_mark_matched(
    p_submission_id uuid, p_task_id uuid, p_shk text,
    p_actor_id text, p_actor_name text
) returns table (id uuid, matched_task_id uuid, matched_shk text)
language plpgsql security definer set search_path = public
as $$
begin
    return query
    update public.intake_submissions
    set matched_task_id = p_task_id, matched_shk = p_shk,
        matched_at = now(), matched_by_id = p_actor_id, matched_by_name = p_actor_name
    where intake_submissions.id = p_submission_id
      and intake_submissions.matched_task_id is null
    returning intake_submissions.id, intake_submissions.matched_task_id, intake_submissions.matched_shk;
end;
$$;
grant execute on function public.wms_intake_mark_matched(uuid, uuid, text, text, text) to anon;
```
Условие `matched_task_id is null` в апдейте — race-safe: если два сотрудника одновременно жмут "Опознать" на один и тот же submission из разных задач, только первый апдейт пройдёт, второй получит 0 строк → клиент не пишет историю, показывает тост.

`wms_no_shk_task_matches` (раздел A) уже фильтрует `matched_task_id is null` — опознанные записи не всплывают кандидатами у других задач.

**`intake_search.js`** — `resultCardHtml`/`renderAssignRow`/`openPhotoLightbox`: если `item.matched_task_id` — кнопка вместо "Присвоить ШК" показывает `"ШК опознан: " + item.matched_shk` (тот же визуальный паттерн, что `.is-assigned`/"ШК присвоен: …", но без возможности кликнуть — уже финальное состояние, не форма). `wms_intake_submissions_search` ([supabase/migrations/202609250001_intake_submissions_wb_nm_match.sql](supabase/migrations/202609250001_intake_submissions_wb_nm_match.sql)) должна вернуть и `matched_task_id`/`matched_shk` — `RETURNS TABLE` меняется (drop + create, как уже делалось в этой же миграции при добавлении `wb_nm_candidates`).

## Тестирование

Ручное, через Supabase (как весь остальной клиентский код в этом репо — build-степа и тестового фреймворка нет):
1. Создать/найти тестовую задачу с известным nm, тестовую запись `intake_submissions` с `wb_nm_candidates`, содержащим этот nm, и `created_at` внутри окна.
2. Открыть карточку задачи — убедиться, что пилл "Без ШК" появляется без задержки первой отрисовки (RPC идёт в фоне).
3. Открыть модалку — проверить фото/НМ-инфо подгружаются лениво, кнопки работают.
4. "Опознать" — проверить: строка в истории, комментарий (в т.ч. со stiker_code сценарием), запись в `intake_submissions.matched_task_id`, кнопка в ленте "без ШК" меняется на "ШК опознан: …", повторный матчинг с другой задачи больше не находит эту запись.
5. "Не тот товар" — история не пишется, при повторном открытии пилла — баннер отказа.
6. Фильтр по "Без ШК"/"Два ШК"/"Пустая упаковка" в таблице участков.
7. `node --check tasks.js` после каждого файла правок.
