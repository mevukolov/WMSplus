# ШК как первичная единица хранения — Фаза 1: таблица wms_task_items

**Статус:** спека на ПЕРВУЮ фазу многофазной миграции. Фазы 2-4 зафиксированы
ниже как дорожная карта (без деталей реализации) — берутся отдельными
заходами, каждый со своей спекой/планом.

**Контекст:** кандидат D из страглер-фиг плана стандартизации
(`docs/superpowers/specs/2026-10-02-wms-entity-glossary-design.md`). Сегодня
вердикт/статус/зона обработки — это колонки на строке `wms_tasks`
(`opp_verdict`, `task_status`, `task_type`), а состав тары/задачи — JSON-массив
`source_payload.task_items`. Одна строка = один вердикт на ВСЕ ШК внутри неё
одновременно.

**Мотивация:** это уже вызывает реальный костыль. В «Чистых списаниях»
(`wms_pure_losses_absorb_shks`) при переносе одного ШК из тары с другими
активными товарами в зону списания приходится **вынимать его в отдельную
новую строку `wms_tasks`** (`split_from_task_id`) только чтобы дать ему
собственный вердикт — потому что сегодня зона/вердикт физически не может
принадлежать одному ШК внутри общей группы.

**Целевая архитектура (согласована с пользователем):** зона, вердикт, статус
становятся атрибутами ОТДЕЛЬНОГО ШК, а не группы. `wms_tasks`-строка
(«тара»/«задача») становится историческо-смысловой меткой «что пришло вместе»,
а не актуальным «где сейчас» — актуальное состояние каждого ШК живёт на его
собственной строке и может расходиться внутри одной группы.

## Дорожная карта (детали — в будущих спеках)

1. **Фаза 1 (эта спека) — фундамент.** Новая таблица `wms_task_items`,
   зеркалящая `task_items` построчно. Ничего не читает из неё, ничего не
   меняется в поведении. Нулевой риск.
2. **Фаза 2 — костыль уходит.** В `wms_task_items` добавляются
   `task_type`/`opp_verdict`/`task_status`/`responsibility_zone`.
   `wms_pure_losses_absorb_shks` переключается писать расхождение прямо в
   строку ШК вместо создания новой строки `wms_tasks`. Доказывает модель на
   реальной боли.
3. **Фаза 3 — миграция читателей.** Списки/вкладки/фильтры/дашборды по одному
   переключаются читать зону и вердикт с `wms_task_items`, а не с `wms_tasks`.
4. **Фаза 4 — отказ от старого.** `task_type`/`opp_verdict`/`task_status` на
   `wms_tasks` становятся чистым денормализованным кэшем (или убираются),
   JSON-массив `task_items` перестаёт писаться.

## Фаза 1 — детальный дизайн

### Таблица `wms_task_items`

Поля — точное зеркало того, что сегодня нормализует `taskItemFromSourceRow`/
`normalizeTaskItem` при чтении `task_items`, не больше:

| Поле | Тип | Nullable | Комментарий |
|---|---|---|---|
| `id` | uuid, pk, `default gen_random_uuid()` | no | |
| `task_id` | uuid, `references wms_tasks(id) on delete cascade` | no | группа-источник |
| `shk` | text | no | |
| `nm` | text | yes | у ручного добавления ШК (tasks.js:10301) поле отсутствует и сегодня |
| `name` | text | yes | |
| `status` | text | yes | снэпшот статуса движения на момент последней записи `task_items` |
| `price` | numeric | yes | |
| `mx` | text | yes | |
| `movement` | text | yes | НЕ timestamptz — пустые строки и разные форматы в источниках; парсинг на чтении (`parseDateTime`), как и сегодня |
| `row_number` | integer | yes | номер строки в исходном загруженном файле |
| `raw` | jsonb | yes | форма различается по типу загрузки (`receiver_id` / `responsible_id`+`responsible` / `employee_id`) — не раскладываем на колонки, зеркалим как есть |
| `created_at` | timestamptz | no | `default now()` |
| `updated_at` | timestamptz | no | `default now()` |

Индексы: `(task_id)`, `(shk)`.

**Права в Фазе 1:** RLS не включаем, grant-ы клиенту (`anon`/`authenticated`)
не выдаём вовсе — таблицу трогает только `security definer`-триггер (см.
ниже), никакой JS её ещё не читает и не пишет напрямую. Grant на `select`
понадобится только в Фазе 3, когда появится первый читатель.

**Сознательно исключено из Фазы 1:** `task_type`, `opp_verdict`, `task_status`,
`responsibility_zone`. У них пока нет собственной семантики (всегда были бы
равны родителю) — добавляются в Фазе 2 вместе с логикой расхождения. Это не
забывчивость, а явная граница фазы.

### Синхронизация — триггер, не правка писателей

```sql
create or replace function public.wms_sync_task_items() returns trigger
language plpgsql
security definer  -- см. ниже про права
set search_path = public
as $$
begin
  delete from wms_task_items where task_id = new.id;
  insert into wms_task_items (task_id, shk, nm, name, status, price, mx, movement, row_number, raw)
  select new.id, item->>'shk', item->>'nm', item->>'name', item->>'status',
         nullif(item->>'price', '')::numeric, item->>'mx', item->>'movement',
         nullif(item->>'row_number', '')::integer, item->'raw'
  from jsonb_array_elements(coalesce(new.source_payload->'task_items', '[]'::jsonb)) item
  where item->>'shk' is not null;
  return new;
end;
$$;

create trigger wms_tasks_sync_task_items
  after insert or update of source_payload on public.wms_tasks
  for each row
  when (old.source_payload is distinct from new.source_payload)
  execute function public.wms_sync_task_items();
```

**Права:** много существующих путей пишут в `wms_tasks` напрямую через
клиентский Supabase-ключ (`db.from(WMS_TASKS_TABLE).update(...)` в tasks.js,
не только через `security definer` RPC) — то есть UPDATE может выполняться от
имени `anon`/`authenticated`. Обычный (не-definer) триггер исполнялся бы с
правами ВЫЗЫВАЮЩЕГО и упал бы без grant-ов на `wms_task_items`. Поэтому
функция триггера — `security definer` (как и большинство существующих RPC в
проекте, например `wms_pure_losses_absorb_shks`), выполняется с правами
владельца независимо от того, кто вызвал исходный UPDATE/INSERT.

Это работает одинаково независимо от того, кто собрал `task_items` — JS-клиент
(`save_wms_manual_upload` просто сохраняет присланный `source_payload` как
есть) или SQL сам (`wms_pure_losses_absorb_shks`) — триггер видит только
итоговый JSONB и не завязан на конкретный писатель. Любой будущий писатель
автоматически покрыт — не нужно искать и не забыть ни одного места.

`when (old.source_payload is distinct from new.source_payload)` — пропускает
UPDATE-ы, не трогающие payload (например, обновление только `updated_at` или
несвязанных полей), чтобы не гонять replace зря.

### Бэкофилл

Один проход по ВСЕМ существующим строкам `wms_tasks` (включая завершённые и
мягко удалённые — цель Фазы 1 полное зеркало истории, а не рабочая выборка),
той же логикой извлечения, что и в теле триггера.

### Тестирование (до применения в проде)

Через `begin; ...; rollback;` (`supabase db query --linked --file`):
- обычная задача с одним ШК;
- тара с несколькими ШК;
- задача без `task_items` вовсе (пустой/отсутствующий массив) — не должна
  падать, просто ноль строк;
- UPDATE, не трогающий `source_payload` — не должен вызывать replace
  (проверить явно, что `wms_task_items.updated_at`/строки не тронуты);
- бэкофилл — сверка количества строк: `count(distinct shk) across task_items
  jsonb` вручную посчитанный запросом, должен совпасть с `count(*) from
  wms_task_items` на тех же строках.

### Риски и границы

- Полная замена строк при каждой записи `source_payload` — приемлемо, тара
  редко больше нескольких ШК, частота записи та же, что и сегодня у
  `wms_tasks`.
- Эта таблица в Фазе 1 ничем не читается и не используется в UI — чистое
  добавление, ноль изменений в поведении приложения. Откат — просто `drop
  trigger`/`drop table`, без побочных эффектов на существующий код.
- Фаза 2 изменит семантику: когда зона/вердикт станут писаться НЕ только из
  родителя, триггер придётся научить не затирать уже разошедшиеся строки при
  несвязанных изменениях родителя — явно отмечено как задача Фазы 2, не
  Фазы 1.
