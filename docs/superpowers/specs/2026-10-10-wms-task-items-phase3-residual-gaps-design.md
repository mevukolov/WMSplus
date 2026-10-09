# ШК как первичная единица хранения — Фаза 3: остаточные дыры после Фазы 2

**Статус:** спека на третью фазу (см. дорожные карты в Фазах 1 и 2:
`docs/superpowers/specs/2026-10-08-wms-task-items-normalization-design.md`,
`docs/superpowers/specs/2026-10-09-wms-task-items-phase2-zone-design.md`).

**Переоценка дорожной карты:** Фаза 1 писала «миграция читателей» как единый
большой шаг. После Фазы 2 выяснилось, что расхождение между `wms_tasks` и
`wms_task_items` реально происходит **только для зоны «Чистые списания»** —
для всех остальных зон `wms_task_items` это неизменная копия родителя.
Значит «перевести всех читателей на `wms_task_items`» ничего не даёт для
большинства из них. Пользователь явно выбрал широкую ревизию вместо узкого
патча — полная разведка (см. ниже) нашла короткий, но конкретный список
реальных дыр, оставленных Фазой 2. Эта спека закрывает их все.

**Явно НЕ в этой фазе:** кластер ачивок/продуктивности (`buildStaffStats`,
`eligibleTaskAchievements`, `fetchCompletedAchievementTasks`,
`loadFlowEmployeeStats`) считает работу по строке задачи, а не по ШК — для
тарных задач это не точно независимо от «Чистых списаний». Это отдельный,
более глубокий продуктовый вопрос («что считать единицей работы для
ачивок»), не механическая смена источника данных — выносится в отдельного
будущего кандидата.

## 3.1 — Хотфикс `auto_reopen_wms_tasks` (срочно, активный баг)

**Проблема:** cron-функция (`pg_cron`, каждые 5 минут) сбрасывает
истёкшие `reopen_after` **только на `wms_tasks`**. Разошедшийся ШК из
«Чистых списаний» со своим `reopen_after` на `wms_task_items` (ставится
`completePureLossesItemFromDetail` при отложенном вердикте, например
«Отправлен на аннулирование») никогда не возвращается в обработку —
висит отложенным навсегда.

**Правило:** то же самое, что уже делает функция для `wms_tasks`, но
применённое к `wms_task_items`: `task_status='Отложено' and reopen_after
<= now()` → сброс в `'Не начато'`/`opp_verdict='Не выбран'`/`reopen_after
= null`, с записью в `wms_task_history` (`task_item_auto_reopened`,
payload `{shk}`). `zone_payload` (факты о самом списании — `lr`/
`date_lost`) не трогается — это не часть цикла вердикта.

```sql
create or replace function public.auto_reopen_wms_tasks()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reopened_ids uuid[];
  v_count integer := 0;
  v_reopened_item_tasks uuid[];
  v_reopened_item_shks text[];
  v_reopened_items integer := 0;
begin
  with due as (
    select id
    from public.wms_tasks
    where task_status = 'Отложено'
      and reopen_after is not null
      and reopen_after <= now()
    for update skip locked
  ),
  updated as (
    update public.wms_tasks t
    set task_status = 'Не начато',
        opp_verdict = 'Не выбран',
        reopen_after = null,
        reopened_at = now(),
        updated_at = now(),
        source_payload = coalesce(t.source_payload, '{}'::jsonb) || jsonb_build_object('wms_review', '{}'::jsonb)
    from due
    where t.id = due.id
    returning t.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_reopened_ids from updated;

  v_count := array_length(v_reopened_ids, 1);
  if v_count is null then v_count := 0; end if;

  if v_count > 0 then
    insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload)
    select id, 'task_auto_reopened', null, null, '{}'::jsonb
    from unnest(v_reopened_ids) as id;
  end if;

  -- Фаза 3.1: то же самое для wms_task_items -- сегодня единственный
  -- случай item-level reopen_after -- разошедшийся ШК в зоне "Чистые
  -- списания" (completePureLossesItemFromDetail).
  with due_items as (
    select task_id, shk
    from public.wms_task_items
    where task_status = 'Отложено'
      and reopen_after is not null
      and reopen_after <= now()
    for update skip locked
  ),
  updated_items as (
    update public.wms_task_items i
    set task_status = 'Не начато',
        opp_verdict = 'Не выбран',
        reopen_after = null,
        updated_at = now()
    from due_items
    where i.task_id = due_items.task_id and i.shk = due_items.shk
    returning i.task_id, i.shk
  )
  select coalesce(array_agg(task_id), '{}'::uuid[]), coalesce(array_agg(shk), '{}'::text[])
  into v_reopened_item_tasks, v_reopened_item_shks
  from updated_items;

  v_reopened_items := coalesce(array_length(v_reopened_item_tasks, 1), 0);

  if v_reopened_items > 0 then
    insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload)
    select v_reopened_item_tasks[i], 'task_item_auto_reopened', null, null, jsonb_build_object('shk', v_reopened_item_shks[i])
    from generate_subscripts(v_reopened_item_tasks, 1) as i;
  end if;

  return jsonb_build_object('ok', true, 'reopened_count', v_count, 'reopened_item_count', v_reopened_items);
end;
$$;
```

## 3.2 — `wms_reconcile_shks_written_off` — уже решено

Разведка нашла, что эта функция (дореформенная, до разворота на зону)
**уже удалена** миграцией `202610050001_pure_losses_absorb_shks.sql`
(`drop function if exists ...`) 2026-10-05, задолго до текущей сессии
работы над Фазой 2. Проверено прямым запросом к проду — функции не
существует. Работы не требуется, пункт закрыт без изменений.

## 3.3 — `wms_search_tasks`: приоритет состоянию конкретного ШК

**Проблема:** функция ищет задачи по идентификатору (`t.source_shk_ids @>
array[q.ident]` и т.д.) и возвращает **вердикт/статус/зону всей строки**,
даже если запрос был именно про один конкретный ШК, который мог разойтись
с родителем.

**Решение:** тот же паттерн, что уже использовался для
`wms_no_shk_item_task_matches` (кандидат A) — `left join` на
`wms_task_items` по найденному идентификатору, `coalesce` в пользу
значения строки ШК. Если `q.ident` не ШК (например, поиск по заголовку
текстом) — джойн просто ничего не найдёт, откат на значения родителя как
сегодня.

```sql
create or replace function public.wms_search_tasks(
    p_query text default null,
    p_date date default null,
    p_tags text[] default null
)
returns table (
    id uuid,
    title text,
    task_type text,
    source_shk_ids text[],
    source_tare_id text,
    source_id text,
    source_price_sum numeric,
    task_status text,
    opp_verdict text,
    tags jsonb,
    special_infos jsonb,
    search_text text,
    created_at timestamptz,
    due_date date
)
language sql
security definer
set search_path = public
stable
as $$
    with q as (
        select
            nullif(regexp_replace(trim(coalesce(p_query, '')), '\s+', '', 'g'), '') as ident,
            nullif('%' || regexp_replace(regexp_replace(trim(coalesce(p_query, '')), '[%_]', ' ', 'g'), '\s+', ' ', 'g') || '%', '%%') as pattern
    )
    select t.id, t.title,
           coalesce(wi.task_type, t.task_type) as task_type,
           t.source_shk_ids, t.source_tare_id, t.source_id,
           t.source_price_sum,
           coalesce(wi.task_status, t.task_status) as task_status,
           coalesce(wi.opp_verdict, t.opp_verdict) as opp_verdict,
           t.tags, t.source_payload -> 'special_infos', t.search_text, t.created_at, t.due_date
    from public.wms_tasks t, q
    left join public.wms_task_items wi on wi.task_id = t.id and wi.shk = q.ident
    where t.is_deleted = false
      and (p_date is null or t.created_at::date = p_date)
      and (p_tags is null or array_length(p_tags, 1) is null or t.tags ?| p_tags)
      and (
          (q.ident is not null and (
              t.source_shk_ids @> array[q.ident]
              or t.source_tare_id = q.ident
              or t.source_id ilike q.pattern
          ))
          or (q.pattern is not null and (t.title ilike q.pattern or t.search_text ilike q.pattern))
          or (q.ident is null and q.pattern is null)
      )
    order by t.updated_at desc;
$$;
```

Сигнатура и грант не меняются (`grant execute ... to authenticated;` —
остаётся как в текущей миграции, повторять не нужно, функция та же).

`wms_search_two_shk`/`wms_search_no_shk_items` в этой же миграции не
трогаем — они не читают `wms_tasks` вообще (отдельные таблицы `2shk_rep`/
`intake_submissions`), вне скоупа.

## 3.4 — Защита «Отложить»/«Переоткрыть» для синтетической строки

**Проблема:** Фаза 2 заguard-ила только «Завершить»
(`completeTaskFromDetail` → `completePureLossesItemFromDetail`).
`deferTaskFromModal`/`reopenTaskFromConfirm` пишут `db.from(WMS_TASKS_TABLE)
.update(...).eq("id", id)`, где `id` — составной `"<task_id>::<shk>"` для
синтетической строки. `wms_tasks.id` — колонка `uuid`, PostgREST попытается
скастовать составную строку в uuid и упадёт с ошибкой типа — не тихая
порча данных, но сломанная кнопка без объяснения.

**Решение:** для «Чистых списаний» откладывание уже полностью покрыто
вердиктом «Отправлен на аннулирование» (авто-отсрочка на 2 дня через
`DEFERRED_VERDICT_FIELDS`/`reopenAfterForVerdict`, уже работает в
`completePureLossesItemFromDetail`) — отдельная кнопка «Отложить» с
произвольной причиной/датой для этого контура избыточна. Переоткрытие
тоже не нужно — завершённые ШК этой зоны не всплывают в списке неактивных
задач (`state.inactive.rows` строится из другого запроса, не из
`wms_task_items`). Поэтому и `openDeferTaskModal`, и `openReopenConfirm`
просто получают ранний выход для синтетической строки — не переписывать
их на item-scoped запись, это была бы ненужная работа под функциональность,
которая уже есть через вердикт.

```js
function openDeferTaskModal(id) {
    const row = findTaskRow(id);
    if (!row) return;
    if (state.taskDetail && state.taskDetail.syntheticRow) {
        toast("Для товара из «Чистых списаний» откладывание -- через вердикт «Отправлен на аннулирование».", "info");
        return;
    }
    // ...существующий код без изменений...
}
```

```js
function openReopenConfirm(id) {
    const row = findTaskRow(id);
    if (!row) return;
    if (state.taskDetail && state.taskDetail.syntheticRow) {
        toast("Переоткрытие недоступно для товара из «Чистых списаний».", "info");
        return;
    }
    // ...существующий код без изменений...
}
```

## 3.5 — Вычисляемый агрегат `task_status` на `wms_tasks`

**Правило (сознательно узкое):** родительская строка считается
`'Завершено'`, когда **ВСЕ** её строки `wms_task_items` стали
`'Завершено'`. Обратное направление (частично/в работе/отложено) не
агрегируется — сегодня нет ни одного реального сценария с содержательной
семантикой для смешанных состояний кроме «всё готово», агрегировать
`opp_verdict` при разных вердиктах тоже не нужно (не определено
осмысленно). Срабатывает только когда конкретный ШК переходит в
`'Завершено'` — не на каждое изменение `wms_task_items`.

```sql
create or replace function public.wms_sync_parent_task_status_from_items() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_all_done boolean;
begin
    select bool_and(task_status = 'Завершено') into v_all_done
    from public.wms_task_items
    where task_id = new.task_id;

    if v_all_done then
        update public.wms_tasks
        set task_status = 'Завершено', updated_at = now()
        where id = new.task_id and task_status <> 'Завершено';
    end if;
    return new;
end;
$$;

create trigger wms_task_items_sync_parent_status
    after update of task_status on public.wms_task_items
    for each row
    when (new.task_status = 'Завершено')
    execute function public.wms_sync_parent_task_status_from_items();
```

На практике это почти никогда не сработает сегодня (мало реально
смешанных тар) — это именно фундамент на будущее, если появится вторая
зона с расхождением, а не фикс конкретного наблюдаемого бага.

## Тестирование

Та же дисциплина `begin; ...; rollback;` для каждой миграции:
- 3.1: создать отложенный ШК на `wms_task_items` с `reopen_after` в
  прошлом, вызвать `auto_reopen_wms_tasks()`, проверить сброс + запись
  истории; убедиться, что обычная (не истёкшая) отсрочка не трогается.
- 3.3: создать тару с двумя ШК, один вручную помечен в `wms_task_items`
  как `'Чистые списания'`/другой вердикт — поиск по ИМЕННО этому ШК
  должен вернуть расходящееся значение; поиск по СОСЕДНЕМУ ШК той же тары
  — значение родителя (не расхождение чужого товара); поиск по
  текстовому паттерну (не идентификатору) — не ломается, джойн не мешает.
- 3.4: `node --check tasks.js`; логическая проверка (нет браузерного QA)
  — убедиться, что guard стоит ДО любого обращения к `db`.
- 3.5: создать тару с двумя ШК, завершить один — родитель должен остаться
  НЕ завершённым; завершить второй — родитель должен стать `'Завершено'`;
  отдельно проверить, что завершение ЕДИНСТВЕННОГО ШК задачи (обычный,
  не чисто-списательный случай) тоже корректно помечает родителя
  (idempotent с уже существующим прямым `completeTaskFromDetail`-путём,
  который и так ставит `'Завершено'` на родителя напрямую — тут триггер
  просто не найдёт работы, `where task_status <> 'Завершено'` защищает от
  двойной записи).
