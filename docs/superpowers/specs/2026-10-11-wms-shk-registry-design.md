# ШК как постоянная сущность — реестр `wms_shk` + собственная история

**Статус:** новый кандидат после полного завершения кандидата D (Фазы 1-3,
docs/superpowers/specs/2026-10-08-...-normalization-design.md,
...-phase2-zone-design.md, ...-phase3-residual-gaps-design.md). Продолжает
«словарь понятий» (docs/superpowers/specs/2026-10-02-wms-entity-glossary-design.md).

**Контекст:** после кандидата D ШК существует только как строка
`wms_task_items`, привязанная к конкретному `task_id`. Один и тот же
физический ШК за свою жизнь проходит через несколько разных `task_id`
(Предсортировка → может АВХ → может Чистые списания) — физически разные
строки, нет записи, которая переживает смену задачи.

**Мотивация (3 конкретных сценария, подтверждённых пользователем):**
1. Единый профиль/таймлайн ШК для оператора/админа — вся жизнь одним
   экраном, без прыжков по разным задачам/отчётам.
2. Запрет на две активные задачи на один ШК одновременно — на уровне БД,
   не только на уровне логики дедупа в коде.
3. Атрибуты ШК вне контекста задачи (nm/наименование и т.д.) — у `nm`
   уже есть свой справочник (`wms_nm_directory`), у «внешнего статуса» уже
   есть `wms_superset_cache` (кандидат A) — у самого ШК как идентичности
   дома пока нет.

Дополнительное требование, прозвучавшее в брейншторминге: ШК должен
**хранить** свою историю взаимодействий (как сегодня хранит задача), а не
только позволять её на лету собрать запросом.

## Почему не тяжелее и не легче

**Не консолидация всех источников** (`shk_rep`/`pure_losses_rep`/
`2shk_rep`/`wms_superset_cache` в одну супер-таблицу) — ни один из трёх
сценариев этого не требует, риск и объём несоразмерны пользе.

**Не просто запрос/вью без новой таблицы** — отклонено, потому что
сценарий #2 (запрет на БД-уровне) физически требует настоящей строки,
которую можно ограничить constraint-ом; вью ничего не ограничивает.

**Не правка ~10 разрозненных писателей истории** — казалось, что «хранить
историю на ШК» требует находить и чинить каждое место, которое сегодня
пишет `wms_task_history` (как минимум ~10 JS-функций + несколько SQL).
Но вся запись и так идёт в ОДНУ таблицу (`wms_task_history`) — JS-функции
через общий `writeTaskHistory()`, SQL — прямым `insert`. Значит один
триггер `AFTER INSERT` на саму таблицу `wms_task_history` ловит
абсолютно всё, независимо от того, кто и как записал исходную строку. Ни
один существующий писатель не трогается.

## Схема

### `wms_shk` — идентичность ШК

```sql
create table public.wms_shk (
    shk text primary key,
    nm text,
    name text,
    current_task_id uuid references public.wms_tasks(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
```

`current_task_id` — удобный **указатель-кэш** («куда сейчас кликнуть» на
экране профиля), НЕ механизм защиты от дублей (см. ниже). `nm`/`name` —
канонические атрибуты, которым сегодня негде жить постоянно вне контекста
конкретной задачи.

### `wms_shk_history` — постоянный журнал, не зависящий от жизни задачи

```sql
create table public.wms_shk_history (
    id uuid primary key default gen_random_uuid(),
    shk text not null references public.wms_shk(shk),
    task_id uuid references public.wms_tasks(id) on delete set null,
    event_type text not null,
    actor_employee_id text,
    actor_name text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index wms_shk_history_shk_idx on public.wms_shk_history (shk, created_at desc);
```

`task_id` — `on delete set null`, не каскад: если когда-нибудь строка
`wms_tasks` будет физически удалена, история ШК не пострадает (именно та
проблема, из-за которой в брейншторминге была отклонена идея «удалять
задачу после разбора»). Зеркалит `wms_task_history` построчно: если
событие было на таре с несколькими товарами, в историю каждого из них
попадает своя запись — ровно так, как просил пользователь.

### Защита от дублей — НЕ на `wms_shk`, а на `wms_task_items`

```sql
create unique index wms_task_items_shk_active_unique
    on public.wms_task_items (shk)
    where task_status <> 'Завершено';
```

Проверено на живых данных (2026-10-11): нарушителей нет (`0` строк), можно
применять без риска падения миграции. Это и есть сценарий #2 — физически
невозможно создать вторую незавершённую строку для одного ШК.

## Триггеры

### 1. Поддержание `wms_shk`/`current_task_id` — из `wms_task_items`

```sql
create or replace function public.wms_sync_shk_registry() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.wms_shk (shk, nm, name, current_task_id, updated_at)
    values (
        new.shk, new.nm, new.name,
        case when new.task_status <> 'Завершено' then new.task_id else null end,
        now()
    )
    on conflict (shk) do update set
        nm = coalesce(nullif(excluded.nm, ''), public.wms_shk.nm),
        name = coalesce(nullif(excluded.name, ''), public.wms_shk.name),
        current_task_id = case when new.task_status <> 'Завершено' then new.task_id else null end,
        updated_at = now();
    return new;
end;
$$;

create trigger wms_task_items_sync_shk
    after insert or update on public.wms_task_items
    for each row
    execute function public.wms_sync_shk_registry();
```

На вставку новой строки ШК — инициализирует `wms_shk` (создаёт, если
первый раз видим этот `shk` вообще). На любое обновление (включая переход
в `'Завершено'`) — пересчитывает `current_task_id`: если строка стала
завершённой, пропадает из «активных» (`null`); полагается на уникальный
индекс выше, что одновременно другой активной строки для этого же `shk`
не существует.

### 2. Зеркало истории — из `wms_task_history`

```sql
create or replace function public.wms_fanout_shk_history() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.wms_shk_history (shk, task_id, event_type, actor_employee_id, actor_name, payload, created_at)
    select wi.shk, new.task_id, new.event_type, new.actor_employee_id, new.actor_name, new.payload, new.created_at
    from public.wms_task_items wi
    where wi.task_id = new.task_id;
    return new;
end;
$$;

create trigger wms_task_history_fanout_to_shk
    after insert on public.wms_task_history
    for each row
    execute function public.wms_fanout_shk_history();
```

Если у задачи на момент события нет ни одной строки `wms_task_items`
(пустой `task_items`) — просто ничего не зеркалится, ничего не падает.

## Бэкофилл

Два прохода по истории, в порядке:
1. `wms_shk` — по одной строке на каждый `shk`, когда-либо встреченный в
   `wms_task_items` (112695 строк по состоянию на 2026-10-11, см. Фазу 1
   кандидата D), `current_task_id` — вычисляется так же, как в триггере
   (активная незавершённая строка, если есть).
2. `wms_shk_history` — по каждой существующей строке `wms_task_history`
   (53935 строк по состоянию на 2026-10-11) создать по одной записи на
   каждый `shk`, СЕЙЧАС числящийся в `wms_task_items` этого `task_id`.
   Это исторически корректно: с решения Фазы 2 кандидата D состав тары
   никогда не меняется после создания, так что текущий состав = состав на
   любой момент в прошлом для этой задачи.

**Порядок применения:** схема → триггеры → бэкофилл → только ПОСЛЕ
бэкофилла и повторной проверки отсутствия дублей — уникальный индекс
`wms_task_items_shk_active_unique` (хотя живая проверка выше уже
подтвердила его безопасность, применяем последним шагом как
дополнительную гарантию «ничего не успело измениться между проверкой и
применением»).

## Явно вне объёма

- Никакая консолидация с `shk_rep`/`pure_losses_rep`/`2shk_rep`/
  `wms_superset_cache` — профиль-экран ШК (если его будут строить) просто
  дополнительно джойнит эти таблицы по `shk`, не копирует их данные в
  `wms_shk`.
- UI (экран профиля ШК) — эта спека только про данные (таблицы +
  триггеры + бэкофилл). Экран — отдельный, последующий заход, когда
  данные уже накоплены и проверены.
- Миграция существующих ~10 писателей `wms_task_history` — не нужна,
  фан-аут триггер их не касается.

## Тестирование

`begin; ...; rollback;` для каждой миграции, как и для кандидата D:
- Новая задача с 2 ШК → обе строки `wms_shk` создались, `current_task_id`
  указывает на неё.
- Завершение одного из 2 ШК → его `current_task_id` стал `null`, сосед не
  тронут.
- Запись в `wms_task_history` для задачи с 3 ШК → 3 строки в
  `wms_shk_history`, с одинаковым `task_id`/`event_type`/`payload`,
  разным `shk`.
- Задача без `task_items` вообще → `insert` в `wms_task_history` не
  падает, просто не создаёт строк в `wms_shk_history`.
- Попытка руками создать вторую незавершённую строку `wms_task_items` для
  уже занятого `shk` (до навешивания индекса — в тесте) → после
  применения индекса такая попытка должна упасть с ошибкой уникальности.
- Бэкофилл: сверка `count(distinct shk) from wms_task_items` равно
  `count(*) from wms_shk`; сверка `count(*) from wms_task_history` ×
  (среднее число ШК на задачу) примерно равно `count(*) from
  wms_shk_history` (точное число — через независимый пересчёт запросом,
  не переиспользуя код самого бэкофилла).
