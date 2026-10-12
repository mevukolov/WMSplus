# Фаза 2a: ретроактивная пересборка маршрутизации — дизайн

## Контекст

Фаза 1 (`docs/superpowers/specs/2026-10-12-wms-routing-rules-phase1-design.md`,
реализована и в проде) дала администратору движок правил
(`wms_routing_rules` + `wms_apply_routing_rules`), но он применяется
только к **осиротевшим** ШК (без активной задачи) при актуализации
Superset — вперёд, никогда не трогает уже существующие активные
задачи.

Пользователь с самого начала хотел большего: правила должны
переоценивать и уже активные ШК при изменении их статуса, а не только
новые поступления. Полный объём («переклассифицировать активные
задачи» + «любое изменение статуса запускает проверку» + «подключить
`save_wms_manual_upload` и весь Предразбор») оказался слишком большим
для одной спеки — решили разбить на:

- **Фаза 2a** (эта спека) — ретроактивная переоценка уже активных ШК.
  Чисто бэкенд: ничего не меняет в том, как JS классифицирует новые
  выгрузки.
- **Фаза 2b** (отдельный будущий заход) — замена JS-хардкода в ~11
  `build*Preview`-функциях и в `save_wms_manual_upload` на обращение к
  движку правил при построении НОВОЙ выгрузки.

## Границы Фазы 2a

**В объёме:**
- Переоценка правил для ШК, у которых уже есть активная строка в
  `wms_task_items`, при изменении их статуса/тары.
- Переоценка при освобождении задачи (переход в "Завершено"/"Отложено").
- Пересчёт всех активных ШК при сохранении правила администратором
  (sweep), с подтверждением в интерфейсе.

**Вне объёма:**
- `save_wms_manual_upload` и JS-классификация в `build*Preview` —
  не трогаем вообще (Фаза 2b).
- Группировка переклассифицированных активных ШК по `tare_id` в новую
  задачу — не делаем. Переклассификация активного ШК не создаёт новую
  `wms_tasks` строку и не передвигает ШК между задачами: меняется
  только зона (`task_type`/`zone_payload`) НА ЕГО СОБСТВЕННОЙ строке
  `wms_task_items`, задача (`task_id`) остаётся той же — переиспользуем
  существующий механизм "расхождения" (тот же, что уже обслуживает
  возврат ШК из "Чистых списаний" в `save_wms_manual_upload`).
- Путь для осиротевших ШК (Фаза 1) не меняется по сути — расширяется
  только триггер, который его вызывает.

## Источник истины для "есть ли активная задача"

**Важно:** `wms_shk.current_task_id` — это кэш-указатель, а не гарантия
(так и задумано с момента "реестра ШК"). Сегодня в этой же сессии была
найдена и исправлена похожая проблема в `save_wms_manual_upload`:
массив `wms_tasks.source_shk_ids` может рассинхронизироваться с
реальными активными строками `wms_task_items` (19 реальных случаев на
проде). Чтобы не повторить тот же класс бага здесь, Фаза 2a **не**
использует `wms_shk.current_task_id` для решения "есть ли активная
задача" — вместо этого смотрит напрямую в `wms_task_items`:

```sql
select ti.task_id, ti.task_type, t.task_status
from public.wms_task_items ti
join public.wms_tasks t on t.id = ti.task_id
where ti.shk = <шк> and ti.task_status <> 'Завершено'
```

Если строка найдена — ШК активен, применяется логика раздела
"Переклассификация активного ШК". Если нет — это путь осиротевшего ШК
(логика Фазы 1, без изменений).

## Триггер 1: изменение статуса/тары в `wms_superset_cache`

Сегодня `last_status`/`last_tare` в `wms_superset_cache` меняются
только во время актуализации Superset — единственный путь записи.
Вместо явного JS-вызова (как в Фазе 1) заводится настоящий DB-триггер,
который ловит это универсально.

Актуализация пишет пачками (upsert на сотни/тысячи строк разом за один
SQL-стейтмент), поэтому триггер — **STATEMENT-level** с transition
tables, а не ROW-level (который дёргал бы функцию по одной строке за
раз):

```sql
create or replace function public.wms_superset_cache_route_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_shks text[];
begin
    if tg_op = 'INSERT' then
        select array_agg(distinct shk) into v_shks from new_rows;
    else
        select array_agg(distinct n.shk) into v_shks
        from new_rows n
        join old_rows o on o.wh_id = n.wh_id and o.shk = n.shk
        where n.last_status is distinct from o.last_status
           or n.last_tare is distinct from o.last_tare;
    end if;
    if v_shks is not null and array_length(v_shks, 1) > 0 then
        perform public.wms_apply_routing_rules(v_shks);
    end if;
    return null;
end;
$$;

create trigger wms_superset_cache_route_insert
    after insert on public.wms_superset_cache
    referencing new table as new_rows
    for each statement
    execute function public.wms_superset_cache_route_changed();

create trigger wms_superset_cache_route_update
    after update of last_status, last_tare on public.wms_superset_cache
    referencing new table as new_rows old table as old_rows
    for each statement
    execute function public.wms_superset_cache_route_changed();
```

(Два отдельных триггера на INSERT и UPDATE, потому что `OLD TABLE`
недоступна для чистого INSERT — для него кандидатами считаются все
вставленные строки без сравнения.)

**JS-сторона:** убираем дублирующий явный вызов
`.rpc("wms_apply_routing_rules", ...)` из цепочки
`handleActualizeSupersetFile` (добавлен в Фазе 1) — триггер теперь
срабатывает автоматически внутри той же транзакции, что и upsert в
кэш, к моменту ответа на upsert работа уже сделана. Оставляем
`loadReviewTasks()`/`renderReview()` для обновления экрана.

## Переклассификация активного ШК (общая логика)

Вся логика "дано: активный ШК с известным task_id — пересчитать его
зону" живёт в одном месте, которое переиспользуют все три триггера
(статус ШК, освобождение задачи, sweep) — чтобы не разъезжаться по
трём копипастам, как чуть не случилось сегодня с
`save_wms_manual_upload`. Разбита на два слоя: чистая (read-only)
функция, которая вычисляет,
*что бы произошло*, и обёртка, которая *применяет* это с учётом
защиты. Dry run (для sweep) и сам sweep/триггеры переиспользуют один и
тот же расчёт — не два похожих, но разных куска логики.

```sql
-- Read-only: что бы изменилось для (task_id, shk), если применить
-- правила прямо сейчас. Не пишет ничего, не знает о защите "Не начато".
create or replace function public.wms_compute_reroute_target(
    p_task_id uuid, p_shk text
) returns table(current_zone text, target_zone text, rule_id uuid, rule_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_item_task_type text;
    v_status text;
    v_tare_id text;
    v_rule record;
begin
    select ti.task_type into v_item_task_type
    from public.wms_task_items ti
    where ti.task_id = p_task_id and ti.shk = p_shk and ti.task_status <> 'Завершено';

    if v_item_task_type is null then
        return; -- строка уже не активна -- нет результата
    end if;

    select sc.last_status, sc.last_tare into v_status, v_tare_id
    from public.wms_superset_cache sc
    where sc.wh_id = '50144199' and sc.shk = p_shk;

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

    if v_rule is null or v_rule.target_task_type = v_item_task_type then
        return; -- правило не найдено, или уже в нужной зоне -- нет результата
    end if;

    current_zone := v_item_task_type;
    target_zone := v_rule.target_task_type;
    rule_id := v_rule.id;
    rule_name := v_rule.name;
    return next;
end;
$$;

-- Применяет (p_task_id, p_shk), если wms_compute_reroute_target нашёл
-- расхождение и защита "Не начато" его пропускает (или обойдена).
create or replace function public.wms_reclassify_active_item(
    p_task_id uuid,
    p_shk text,
    p_bypass_active_guard boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target record;
    v_parent_status text;
begin
    select * into v_target from public.wms_compute_reroute_target(p_task_id, p_shk);
    if v_target.target_zone is null then
        return false;
    end if;

    select task_status into v_parent_status from public.wms_tasks where id = p_task_id;
    if v_parent_status = 'Не начато' and not p_bypass_active_guard then
        return false; -- активная работа -- откладываем до освобождения/sweep
    end if;

    update public.wms_task_items
    set task_type = v_target.target_zone,
        zone_payload = '{}'::jsonb,
        updated_at = timezone('utc', now())
    where task_id = p_task_id and shk = p_shk;

    insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
    values (
        p_task_id, 'task_item_rerouted_by_rule', 'Система', '',
        jsonb_build_object(
            'shk', p_shk, 'rule_id', v_target.rule_id, 'rule_name', v_target.rule_name,
            'old_zone', v_target.current_zone, 'new_zone', v_target.target_zone,
            'sweep', p_bypass_active_guard
        )
    );

    return true;
end;
$$;
```

Группировка по `tare_id` (Фаза 1, для осиротевших) здесь не
применяется — ШК просто меняет зону внутри своей текущей задачи,
`task_id` не меняется.

**`wms_apply_routing_rules(p_shks text[])` (Фаза 1, расширяется):**
сегодня для каждого ШК из `p_shks` функция проверяет
`wms_shk.current_task_id is not null` и, если так, делает `continue`
(пропускает). Это убирается — вместо кэша смотрим напрямую в
`wms_task_items` (см. раздел "Источник истины" выше). Если активная
строка найдена — вызываем `wms_reclassify_active_item(task_id, shk,
false)` и переходим к следующему ШК; если нет — путь осиротевшего ШК
не меняется (логика Фазы 1 как есть).

## Триггер 2: освобождение задачи

```sql
create or replace function public.wms_tasks_route_released_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
begin
    for v_row in
        select shk from public.wms_task_items
        where task_id = new.id and task_status <> 'Завершено'
    loop
        perform public.wms_reclassify_active_item(new.id, v_row.shk, false);
    end loop;
    return null;
end;
$$;

create trigger wms_tasks_route_on_release
    after update of task_status on public.wms_tasks
    for each row
    when (new.task_status in ('Завершено', 'Отложено')
          and old.task_status is distinct from new.task_status)
    execute function public.wms_tasks_route_released_items();
```

При входе задачи в "Завершено"/"Отложено" заново прогоняет
переклассификацию (та же функция) для всех ещё активных ШК этой
задачи. `p_bypass_active_guard=false` здесь ничего не меняет на
практике — к моменту срабатывания AFTER-триггера `t.task_status` в
`wms_reclassify_active_item` уже читается ОБНОВЛЁННЫМ (новая строка
уже записана), так что "защита Не начато" внутри функции сама себя не
застанет. Это и есть отложенная пересборка: пока задача была "Не
начато", несовпадения зоны копились непримененными — здесь они
наконец разрешаются.

ROW-level (не STATEMENT) — переходы статуса задач происходят по одной
задаче за раз из UI, пачками не идут, в отличие от актуализации
Superset.

## История

Новое событие `task_item_rerouted_by_rule`, аналогично
`task_routed_by_rule` из Фазы 1 (для осиротевших), но для уже активных
ШК. Payload: `{shk, rule_id, rule_name, old_zone, new_zone, sweep}`
(`sweep: true` когда применено через ручной sweep в обход защиты "Не
начато", `false` когда через обычные триггеры 1/2 — видно в истории
задачи, почему именно сейчас произошёл переезд).

Сразу добавляется в JS (`TASK_HISTORY_EVENT_LABELS` и список
"настоящих системных" событий в `taskHistoryFeedItemHtml`) в том же
коммите, который его заводит — чтобы не повторить сегодняшний баг
(`task_refreshed_same_module` отображался сырой строкой и как
"сотрудник Система" с инициалами "СИ" вместо системной иконки, потому
что лейбл/isSystem забыли завести вместе с event_type).

## Триггер 3 (ручной): sweep при сохранении правила

Сохранение правила в админке (`saveRoutingRulesFromModal`, Фаза 1) —
редкое и явное действие администратора. В отличие от триггеров 1 и 2,
sweep **не уважает** защиту "Не начато": у review-задач физически нет
presence-сигнала "карточка открыта у оператора" (единственное
состояние "в работе" — "Не начато" — одинаково верно и для реально
открытой карточки, и для нетронутой неделю задачи в очереди; более
точного сигнала система не хранит). Раз админ сознательно поменял
правило, считаем это явным решением принять risk немедленного
переезда — иначе sweep почти ничего не сделает, пока весь бэклог сам
не дойдёт до завершения.

Две отдельные функции — читающая (считает N, ничего не пишет,
безопасна для PostgREST-вызова как обычного RPC без транзакционных
трюков) и применяющая:

```sql
-- Только считает -- вызывает read-only wms_compute_reroute_target для
-- каждой активной строки, ничего не пишет.
create or replace function public.wms_preview_sweep_active_routing()
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer
    from public.wms_task_items ti
    cross join lateral public.wms_compute_reroute_target(ti.task_id, ti.shk) rt
    where ti.task_status <> 'Завершено' and rt.target_zone is not null;
$$;

grant execute on function public.wms_preview_sweep_active_routing() to anon, authenticated;

-- Применяет: перебирает те же строки и реально переносит зону,
-- обходя защиту "Не начато" (p_bypass_active_guard=true).
create or replace function public.wms_sweep_active_routing()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
    v_count integer := 0;
begin
    for v_row in
        select task_id, shk from public.wms_task_items where task_status <> 'Завершено'
    loop
        if public.wms_reclassify_active_item(v_row.task_id, v_row.shk, true) then
            v_count := v_count + 1;
        end if;
    end loop;
    return v_count;
end;
$$;

grant execute on function public.wms_sweep_active_routing() to anon, authenticated;
```

Админка вызывает их по очереди:
1. Сразу после успешного сохранения правил — `wms_preview_sweep_active_routing()`,
   чтобы получить число N (чистое чтение, безопасно вызывать сколько
   угодно раз).
2. Показывает подтверждение: «Sweep переклассифицирует N активных ШК,
   включая невзятые в работу. Продолжить?» — только после явного "Да"
   вызывается `wms_sweep_active_routing()`, которая реально применяет
   изменения.

## Риски и компромиссы

- **Нет presence-сигнала** — защита "Не начато" в триггерах 1/2
  одинаково покрывает и реально открытые карточки, и весь нетронутый
  бэклог. Это известное ограничение, не баг: более точного сигнала в
  системе сегодня нет, и вводить его (напр. "открыл карточку" лок) —
  отдельная, не обсуждавшаяся фича.
- **Sweep без защиты** — осознанно: админ, меняющий правило, может
  выдернуть ШК из-под оператора, который в этот момент читает
  карточку (не сохранял, значит `task_status` ещё "Не начато"). Это
  принятый риск, смягчённый подтверждением с числом.
- **STATEMENT-триггер и транзакционная семантика** — `wms_apply_routing_rules`
  выполняется синхронно внутри той же транзакции, что и upsert в
  `wms_superset_cache`. Если актуализация физически вставляет десятки
  тысяч строк за раз, функция обработает весь список целиком
  (`p_shks text[]`) — то же поведение, что уже проверено в Фазе 1 для
  вызова из JS, просто источник вызова меняется.

## Тестирование

Тем же способом, что и весь день: живые `begin/rollback` тесты с
assertion-таблицей (`test_results`) на реальных ШК/задачах из прода
перед применением каждой миграции; `node --check` для JS; без
браузерного QA (ограничение всей сессии — auth guard требует реальную
Supabase-сессию).
