# ШК как первичная единица хранения — Фаза 3 (остаточные дыры) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 4 concrete gaps found by a full-codebase audit after Фаза 2 — a live production bug (deferred Чистые-списания items never auto-reopen) plus 3 smaller correctness/defensive fixes.

**Architecture:** 4 independent tasks, each its own migration or JS change — unlike Фаза 2 these do NOT need to ship together (no cross-dependency between them). Task 1 ships first because it fixes an already-live bug; Tasks 2-4 can be done in any order but this plan sequences them in the spec's own order.

**Tech Stack:** PostgreSQL (Supabase) migrations for Tasks 1, 2, 4. Vanilla JS (`tasks.js`) for Task 3. No build step, no JS test framework.

**Spec:** `docs/superpowers/specs/2026-10-10-wms-task-items-phase3-residual-gaps-design.md`

**Note:** the spec's section 3.2 (`wms_reconcile_shks_written_off`) needs no task — the audit found it was already dropped from production back on 2026-10-05 (migration `202610050001_pure_losses_absorb_shks.sql`), confirmed via a live query (`select proname from pg_proc where proname ilike '%reconcile_shks%'` → 0 rows). Nothing to do.

## Global Constraints

- Every SQL migration gets tested live via `supabase db query --linked --file <scratch>.sql` wrapped in `begin; ...; rollback;` BEFORE being written as a real migration file and pushed.
- Migration apply workaround (required every time `supabase db push --linked` runs in this repo): move these 4 files aside first, push, then move them back:
  ```bash
  mkdir -p supabase/.migration_holdout
  mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql \
     supabase/migrations/202609020005_wms_shifts_roster.sql \
     supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql \
     supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql \
     supabase/.migration_holdout/
  supabase db push --linked
  mv supabase/.migration_holdout/*.sql supabase/migrations/
  rmdir supabase/.migration_holdout
  ```
- Migration file naming: latest existing prefix as of this plan is `202610100004`. This plan uses `202610110001`-`202610110003` (3 SQL migrations; Task 3 is JS-only, no migration file). Run `ls supabase/migrations | sort | tail -5` before creating each file to confirm no new collision appeared.
- JS verification is `node --check tasks.js` only. **Live browser QA is not available this session** — the app's auth guard requires a real Supabase Auth session; a fake `localStorage.user` object is not sufficient (discovered and reported to the user during Candidate A, reconfirmed during Фаза 2). State this explicitly when Task 3 completes — do not claim browser-verified behavior.
- Commit each task separately, push to `origin/main` after each task's verification — matches this session's established direct-to-main workflow.

---

### Task 1: Hotfix `auto_reopen_wms_tasks` — also reopen expired `wms_task_items`

**Files:**
- Create: `supabase/migrations/202610110001_auto_reopen_task_items.sql`

**Interfaces:**
- Produces: `public.auto_reopen_wms_tasks()` — same name/signature/return shape (`jsonb` with `ok`, `reopened_count`), plus a new `reopened_item_count` key. Called only by the existing `pg_cron` schedule (no JS caller to update).

- [ ] **Step 1: Write the migration file**

```sql
-- Фаза 3.1 (docs/superpowers/specs/2026-10-10-wms-task-items-phase3-residual-gaps-design.md):
-- эта cron-функция сбрасывала истёкший reopen_after только на wms_tasks.
-- Разошедшийся ШК из "Чистые списания" со своим reopen_after на
-- wms_task_items (ставится completePureLossesItemFromDetail при
-- отложенном вердикте) никогда не возвращался в обработку -- висел
-- отложенным навсегда. Это уже активный баг в проде с момента Фазы 2.
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

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610110001_auto_reopen_task_items.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

do $$
declare
    v_task_id uuid;
    v_result jsonb;
begin
    -- Expired item -- must reopen.
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload, source_shk_ids)
    values ('test_phase3', 'expired-' || gen_random_uuid(), 'Чистые списания', 'Просроченный', 'Отправлен на аннулирование', 'Не начато',
        '{"task_items":[{"shk":"10101010101","nm":"5001","name":"Товар П","price":30,"status":"","mx":"","movement":""}]}'::jsonb,
        array['10101010101'])
    returning id into v_task_id;

    update public.wms_task_items
    set task_status = 'Отложено', opp_verdict = 'Отправлен на аннулирование', reopen_after = now() - interval '1 hour'
    where task_id = v_task_id and shk = '10101010101';

    -- Not-yet-expired item (different task) -- must NOT reopen.
    perform (
        with t as (
            insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload, source_shk_ids)
            values ('test_phase3', 'future-' || gen_random_uuid(), 'Чистые списания', 'Ещё не просрочен', 'Отправлен на аннулирование', 'Не начато',
                '{"task_items":[{"shk":"20202020202","nm":"5002","name":"Товар Р","price":30,"status":"","mx":"","movement":""}]}'::jsonb,
                array['20202020202'])
            returning id
        )
        update public.wms_task_items
        set task_status = 'Отложено', opp_verdict = 'Отправлен на аннулирование', reopen_after = now() + interval '1 hour'
        from t where task_id = t.id and shk = '20202020202'
    );

    select public.auto_reopen_wms_tasks() into v_result;

    insert into test_results values ('expired_item_reopened',
        (select task_status from public.wms_task_items where task_id = v_task_id and shk = '10101010101'), 'Не начато');
    insert into test_results values ('expired_item_verdict_reset',
        (select opp_verdict from public.wms_task_items where task_id = v_task_id and shk = '10101010101'), 'Не выбран');
    insert into test_results values ('future_item_untouched',
        (select task_status from public.wms_task_items where shk = '20202020202'), 'Отложено');
    insert into test_results values ('reported_item_count', (v_result->>'reopened_item_count')::text, '1');
    insert into test_results values ('history_recorded',
        (exists(select 1 from public.wms_task_history where task_id = v_task_id and event_type = 'task_item_auto_reopened'))::text, 'true');
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_phase3_task1.sql
supabase db query --linked --file /tmp/test_phase3_task1.sql
```

Expected: 5 rows, all `pass: true`.

- [ ] **Step 3: Apply the migration to the live database**

```bash
mkdir -p supabase/.migration_holdout
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql \
   supabase/migrations/202609020005_wms_shifts_roster.sql \
   supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql \
   supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql \
   supabase/.migration_holdout/
supabase db push --linked
mv supabase/.migration_holdout/*.sql supabase/migrations/
rmdir supabase/.migration_holdout
```

- [ ] **Step 4: Verify against real (non-transactional) data**

```bash
cat << 'SQLEOF' > /tmp/verify_phase3_task1.sql
select prosrc ilike '%due_items%' as has_item_reopen_logic
from pg_proc where proname = 'auto_reopen_wms_tasks';
SQLEOF
supabase db query --linked --file /tmp/verify_phase3_task1.sql
```

Expected: `has_item_reopen_logic = true`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610110001_auto_reopen_task_items.sql
git commit -m "$(cat <<'EOF'
Хотфикс: auto_reopen_wms_tasks сбрасывает истёкший reopen_after и на wms_task_items (Фаза 3.1)

Разошедшийся отложенный ШК из "Чистые списания" никогда не возвращался в
обработку -- cron трогал только wms_tasks. Активный баг в проде с момента
Фазы 2, закрыт.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 2: `wms_search_tasks` учитывает состояние конкретного ШК

**Files:**
- Create: `supabase/migrations/202610110002_search_tasks_item_state.sql`

**Interfaces:**
- Produces: `public.wms_search_tasks(p_query text, p_date date, p_tags text[])` — same signature/return columns, `search.js` needs no changes (same column names in the result).

- [ ] **Step 1: Write the migration file**

```sql
-- Фаза 3.3: поиск по конкретному ШК возвращал вердикт/статус/зону ВСЕЙ
-- строки задачи, даже если именно этот ШК разошёлся с родителем (зона
-- "Чистые списания"). Тот же паттерн, что уже использовался для
-- wms_no_shk_item_task_matches (кандидат A) -- left join на
-- wms_task_items по найденному идентификатору, coalesce в пользу строки
-- конкретного ШК.
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

grant execute on function public.wms_search_tasks(text, date, text[]) to authenticated;
```

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610110002_search_tasks_item_state.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

do $$
declare
    v_task_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload, source_shk_ids, is_deleted)
    values ('test_phase3', 'search-' || gen_random_uuid(), 'Предсортировка', 'Общая тара для поиска', 'Не выбран', 'Не начато',
        '{"task_items":[
            {"shk":"30303030303","nm":"6001","name":"Товар С","price":40,"status":"","mx":"","movement":""},
            {"shk":"40404040404","nm":"6002","name":"Товар Т","price":50,"status":"","mx":"","movement":""}
        ]}'::jsonb,
        array['30303030303','40404040404'], false)
    returning id into v_task_id;

    update public.wms_task_items set task_type = 'Чистые списания', opp_verdict = 'Отправлен на аннулирование', task_status = 'Отложено'
    where task_id = v_task_id and shk = '30303030303';

    insert into test_results values ('diverged_shk_shows_item_state',
        (select task_type from public.wms_search_tasks('30303030303', null, null) limit 1), 'Чистые списания');
    insert into test_results values ('sibling_shk_shows_parent_state',
        (select task_type from public.wms_search_tasks('40404040404', null, null) limit 1), 'Предсортировка');
    insert into test_results values ('text_search_still_works',
        (select count(*)::text from public.wms_search_tasks('Общая тара для поиска', null, null)), '1');
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_phase3_task2.sql
supabase db query --linked --file /tmp/test_phase3_task2.sql
```

Expected: 3 rows, all `pass: true`.

- [ ] **Step 3: Apply the migration to the live database**

```bash
mkdir -p supabase/.migration_holdout
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql \
   supabase/migrations/202609020005_wms_shifts_roster.sql \
   supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql \
   supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql \
   supabase/.migration_holdout/
supabase db push --linked
mv supabase/.migration_holdout/*.sql supabase/migrations/
rmdir supabase/.migration_holdout
```

- [ ] **Step 4: Verify against real (non-transactional) data**

```bash
cat << 'SQLEOF' > /tmp/verify_phase3_task2.sql
select prosrc ilike '%left join public.wms_task_items%' as has_item_join
from pg_proc where proname = 'wms_search_tasks';
SQLEOF
supabase db query --linked --file /tmp/verify_phase3_task2.sql
```

Expected: `has_item_join = true`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610110002_search_tasks_item_state.sql
git commit -m "$(cat <<'EOF'
wms_search_tasks: приоритет состоянию конкретного ШК (Фаза 3.3)

Поиск по разошедшемуся ШК из "Чистые списания" теперь показывает
его собственное состояние, а не состояние всей родительской тары.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 3: Guard «Отложить»/«Переоткрыть» для синтетической строки

**Files:**
- Modify: `tasks.js` — `openDeferTaskModal` (~line 11248), `openReopenConfirm` (~line 11352). Use the Edit tool matching by function body content, not line number, since earlier tasks in this plan don't touch `tasks.js`.

**Interfaces:**
- Consumes: `state.taskDetail.syntheticRow` (set by Фаза 2's `openPureLossesItemDetail`) and `toast()` (existing global helper, already used throughout `tasks.js`).
- Produces: no new functions — both existing functions gain an early-return guard.

- [ ] **Step 1: Guard `openDeferTaskModal`**

Find:

```js
    function openDeferTaskModal(id) {
        const row = findTaskRow(id);
        if (!row) return;
        state.taskDetail.deferRowId = id;
```

Replace with:

```js
    function openDeferTaskModal(id) {
        const row = findTaskRow(id);
        if (!row) return;
        if (state.taskDetail && state.taskDetail.syntheticRow) {
            toast("Для товара из «Чистых списаний» откладывание -- через вердикт «Отправлен на аннулирование».", "info");
            return;
        }
        state.taskDetail.deferRowId = id;
```

- [ ] **Step 2: Guard `openReopenConfirm`**

Find:

```js
    function openReopenConfirm(id) {
        const row = findTaskRow(id);
        if (!row) return;
        state.taskDetail.reopenRowId = id;
```

Replace with:

```js
    function openReopenConfirm(id) {
        const row = findTaskRow(id);
        if (!row) return;
        if (state.taskDetail && state.taskDetail.syntheticRow) {
            toast("Переоткрытие недоступно для товара из «Чистых списаний».", "info");
            return;
        }
        state.taskDetail.reopenRowId = id;
```

- [ ] **Step 3: Run `node --check`**

```bash
node --check /Users/WBwork/Downloads/WMSplus-main/tasks.js
```

Expected: no output (success).

- [ ] **Step 4: Commit and push**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
git add tasks.js
git commit -m "$(cat <<'EOF'
Guard "Отложить"/"Переоткрыть" для синтетической строки (Фаза 3.4)

Обе кнопки писали db.from(WMS_TASKS_TABLE).update(...).eq("id", id) с
составным id "<task_id>::<shk>" -- uuid-колонка не скастует такую строку,
операция падала с ошибкой типа без объяснения. Откладывание для этой
зоны уже полностью покрыто вердиктом "Отправлен на аннулирование" (авто-
отсрочка 2 дня), переоткрытие не нужно (завершённые ШК зоны не попадают
в список неактивных задач) -- вместо item-scoped переписывания даём
понятное сообщение.
EOF
)"
git push origin main
```

**Live browser QA is not available this session** (auth guard requires a real Supabase session). Report this explicitly — the guard's logic was verified by reading the code path, not by clicking the buttons in a browser.

---

### Task 4: Вычисляемый агрегат `task_status` на `wms_tasks`

**Files:**
- Create: `supabase/migrations/202610110003_sync_parent_task_status_from_items.sql`

**Interfaces:**
- Consumes: `wms_task_items.task_status` (Фаза 2).
- Produces: trigger function `public.wms_sync_parent_task_status_from_items()` + trigger `wms_task_items_sync_parent_status` on `public.wms_task_items`. No JS/other SQL depends on this directly — it's a background consistency mechanism.

- [ ] **Step 1: Write the migration file**

```sql
-- Фаза 3.5: родительская строка wms_tasks считается "Завершено", когда
-- ВСЕ её строки wms_task_items стали "Завершено". Сознательно узкое
-- правило -- срабатывает только когда конкретный ШК переходит в
-- "Завершено", не агрегирует opp_verdict (не определено осмысленно при
-- разных вердиктах), не трогает промежуточные состояния. На практике
-- почти никогда не сработает сегодня (мало реально смешанных тар) --
-- это фундамент на будущее, если появится вторая зона с расхождением.
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

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610110003_sync_parent_task_status_from_items.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

do $$
declare
    v_task_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload, source_shk_ids)
    values ('test_phase3', 'aggregate-' || gen_random_uuid(), 'Предсортировка', 'Тара для агрегата', 'Не выбран', 'Не начато',
        '{"task_items":[
            {"shk":"50505050505","nm":"7001","name":"Товар У","price":60,"status":"","mx":"","movement":""},
            {"shk":"60606060606","nm":"7002","name":"Товар Ф","price":70,"status":"","mx":"","movement":""}
        ]}'::jsonb,
        array['50505050505','60606060606'])
    returning id into v_task_id;

    update public.wms_task_items set task_status = 'Завершено' where task_id = v_task_id and shk = '50505050505';
    insert into test_results values ('parent_not_done_yet', (select task_status from public.wms_tasks where id = v_task_id), 'Не начато');

    update public.wms_task_items set task_status = 'Завершено' where task_id = v_task_id and shk = '60606060606';
    insert into test_results values ('parent_done_when_all_items_done', (select task_status from public.wms_tasks where id = v_task_id), 'Завершено');
end $$;

-- Single-item task (the common, already-handled case): completing the
-- one item should not error or double-write oddly when the parent is
-- ALSO completed directly (today's normal completeTaskFromDetail path).
do $$
declare
    v_task_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload, source_shk_ids)
    values ('test_phase3', 'solo-aggregate-' || gen_random_uuid(), 'Предсортировка', 'Соло для агрегата', 'Не выбран', 'Не начато',
        '{"task_items":[{"shk":"70707070707","nm":"7003","name":"Товар Х","price":80,"status":"","mx":"","movement":""}]}'::jsonb,
        array['70707070707'])
    returning id into v_task_id;

    update public.wms_tasks set task_status = 'Завершено', opp_verdict = 'Найден/Релиз/Списан' where id = v_task_id;
    update public.wms_task_items set task_status = 'Завершено' where task_id = v_task_id and shk = '70707070707';

    insert into test_results values ('solo_case_no_crash', (select task_status from public.wms_tasks where id = v_task_id), 'Завершено');
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_phase3_task4.sql
supabase db query --linked --file /tmp/test_phase3_task4.sql
```

Expected: 3 rows, all `pass: true`.

- [ ] **Step 3: Apply the migration to the live database**

```bash
mkdir -p supabase/.migration_holdout
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql \
   supabase/migrations/202609020005_wms_shifts_roster.sql \
   supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql \
   supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql \
   supabase/.migration_holdout/
supabase db push --linked
mv supabase/.migration_holdout/*.sql supabase/migrations/
rmdir supabase/.migration_holdout
```

- [ ] **Step 4: Verify against real (non-transactional) data**

```bash
cat << 'SQLEOF' > /tmp/verify_phase3_task4.sql
select tgname from pg_trigger where tgrelid = 'public.wms_task_items'::regclass and tgname = 'wms_task_items_sync_parent_status';
SQLEOF
supabase db query --linked --file /tmp/verify_phase3_task4.sql
```

Expected: one row, `tgname: wms_task_items_sync_parent_status`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610110003_sync_parent_task_status_from_items.sql
git commit -m "$(cat <<'EOF'
Вычисляемый агрегат task_status на wms_tasks из wms_task_items (Фаза 3.5)

Родитель помечается "Завершено", когда ВСЕ его товары завершены. Узкое
правило -- не агрегирует opp_verdict, не трогает промежуточные статусы.
Фундамент на будущее для следующей зоны с расхождением, закрывает
дорожную карту кандидата D по остаточным дырам после Фазы 2.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Self-Review

**Spec coverage:** 3.1 → Task 1, 3.2 → no task needed (already resolved,
noted in plan header), 3.3 → Task 2, 3.4 → Task 3, 3.5 → Task 4. Every
section of the spec maps to exactly one task or an explicit no-op note.

**Placeholder scan:** no TBD/TODO; every step has complete, literal SQL or
JS matching the spec's own code blocks.

**Type consistency:** `auto_reopen_wms_tasks()`'s return shape
(`reopened_count`/`reopened_item_count`) is self-contained to Task 1, no
other task reads it. `wms_search_tasks`'s column list in Task 2 matches
the existing signature search.js already consumes — no JS changes needed
there. Task 3's guard checks `state.taskDetail.syntheticRow`, the same
field Фаза 2 already sets in `openPureLossesItemDetail` — same name, no
drift. Task 4's trigger reads `wms_task_items.task_status` — same column
Фаза 2 added, same spelling of `'Завершено'` used throughout the
codebase's existing state machine.
