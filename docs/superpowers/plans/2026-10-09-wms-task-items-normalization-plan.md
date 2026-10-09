# ШК как первичная единица хранения — Фаза 1 (wms_task_items) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new table `wms_task_items` that mirrors `wms_tasks.source_payload.task_items` one row per ШК, kept in sync by a trigger, and backfill it from all existing history — with zero change to any application behavior.

**Architecture:** Pure SQL, two migrations. Migration 1 creates the table and a `security definer` trigger function that replaces `wms_task_items` rows for a task whenever `wms_tasks.source_payload` changes (fires regardless of whether the payload was built by a JS client or a SQL RPC). Migration 2 bulk-backfills every existing `wms_tasks` row (including completed/deleted) with a single set-based `insert ... select`, since historical rows won't trigger the sync trigger retroactively.

**Tech Stack:** PostgreSQL (Supabase), plpgsql trigger function. No JS/HTML changes. No build step, no JS test framework — verification is `supabase db query --linked --file` wrapped in `begin; ...; rollback;` before any real apply, then a real (non-transactional) verification query after applying.

**Spec:** `docs/superpowers/specs/2026-10-08-wms-task-items-normalization-design.md`

## Global Constraints

- This is Фаза 1 only: `wms_task_items` must NOT include `task_type`/`opp_verdict`/`task_status`/`responsibility_zone` columns — those are explicitly deferred to Фаза 2 per the spec. Do not add them.
- No RLS, no grants to `anon`/`authenticated` on `wms_task_items` in this phase — nothing outside the trigger touches this table yet (spec: "Права в Фазе 1").
- Trigger function must be `security definer` (spec: many existing `wms_tasks` writes happen directly from the client's anon/authenticated key, not only through `security definer` RPCs — a plain invoker-rights trigger would fail without table grants it's not supposed to have yet).
- Trigger must only fire when `old.source_payload is distinct from new.source_payload` — do not fire on unrelated-column updates.
- Every migration gets tested live via `supabase db query --linked --file <scratch>.sql` wrapped in `begin; ...; rollback;` BEFORE being written as a real migration file and pushed. Never apply untested SQL to this production database.
- Migration apply workaround (required every time `supabase db push --linked` is run in this repo): move these 4 duplicate-timestamp-prefix files aside first, push, then move them back:
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
- Migration file naming: the latest existing prefix in `supabase/migrations/` as of this plan is `202610080001`. This plan's migrations use `202610090001` and `202610090002`. Before creating either file, run `ls supabase/migrations | sort | tail -5` to confirm no collision has appeared since (another session may have added migrations) — if a collision would occur, use the next free `202610090NNN` prefix instead.
- No `node --check`, no browser QA needed for this plan — no JS/HTML file is touched, and nothing in the running application reads `wms_task_items` yet.
- Commit each task separately (not squashed), push to `origin/main` after each task's migration is verified applied — matches this session's established direct-to-main workflow for this repo (no feature branch, no worktree).

---

### Task 1: Create `wms_task_items` table and sync trigger

**Files:**
- Create: `supabase/migrations/202610090001_wms_task_items.sql`

**Interfaces:**
- Produces: table `public.wms_task_items` with columns `id, task_id, shk, nm, name, status, price, mx, movement, row_number, raw, created_at, updated_at`; trigger function `public.wms_sync_task_items()`; trigger `wms_tasks_sync_task_items` on `public.wms_tasks`. Task 2 depends on this table existing (its backfill inserts into it) but does NOT depend on the trigger firing — Task 2 populates history directly via its own `insert select`, not by provoking the trigger.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/202610090001_wms_task_items.sql` with exactly this content:

```sql
-- Фаза 1 кандидата D (docs/superpowers/specs/2026-10-08-wms-task-items-normalization-design.md):
-- зеркалим wms_tasks.source_payload.task_items построчно в отдельную таблицу.
-- Ничего в приложении это пока не читает -- чистая структурная подготовка
-- к Фазе 2 (зона/вердикт станут атрибутами ШК, а не группы).
create table public.wms_task_items (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null references public.wms_tasks(id) on delete cascade,
    shk text not null,
    nm text,
    name text,
    status text,
    price numeric,
    mx text,
    movement text,
    row_number integer,
    raw jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index wms_task_items_task_id_idx on public.wms_task_items (task_id);
create index wms_task_items_shk_idx on public.wms_task_items (shk);

-- security definer: много существующих путей пишут в wms_tasks напрямую
-- через клиентский anon/authenticated ключ (db.from(WMS_TASKS_TABLE).update(...)
-- в tasks.js), а не только через security definer RPC -- обычный (invoker-rights)
-- триггер упал бы без grant-ов на wms_task_items, которых мы сознательно
-- не выдаём в этой фазе (см. Global Constraints).
create or replace function public.wms_sync_task_items() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.wms_task_items where task_id = new.id;
    insert into public.wms_task_items (task_id, shk, nm, name, status, price, mx, movement, row_number, raw)
    select
        new.id,
        item->>'shk',
        item->>'nm',
        item->>'name',
        item->>'status',
        nullif(item->>'price', '')::numeric,
        item->>'mx',
        item->>'movement',
        nullif(item->>'row_number', '')::integer,
        item->'raw'
    from jsonb_array_elements(coalesce(new.source_payload->'task_items', '[]'::jsonb)) item
    where item->>'shk' is not null;
    return new;
end;
$$;

-- OLD не существует для INSERT -- WHEN, сравнивающий old/new, нельзя
-- повесить на триггер, слушающий ещё и INSERT. Два отдельных триггера на
-- одну функцию: INSERT всегда синхронизирует, UPDATE -- только если
-- source_payload реально изменился.
create trigger wms_tasks_sync_task_items_insert
    after insert on public.wms_tasks
    for each row
    execute function public.wms_sync_task_items();

create trigger wms_tasks_sync_task_items_update
    after update of source_payload on public.wms_tasks
    for each row
    when (old.source_payload is distinct from new.source_payload)
    execute function public.wms_sync_task_items();
```

(Исправлено при живом тестировании Step 2: PostgreSQL не позволяет `WHEN`,
ссылающийся на `OLD`, в триггере, который слушает ещё и `INSERT` -- `OLD` для
INSERT не существует. Два триггера на одну функцию решают это без потери
семантики.)

- [ ] **Step 2: Test live in a rolled-back transaction**

Run (from the repo root, `supabase` CLI already linked to project `bgphllmzmlwurfnbagho` per this session's established setup):

```bash
{
echo "begin;"
cat supabase/migrations/202610090001_wms_task_items.sql
cat << 'SQLEOF'

-- Test A: insert a task with 2 items -- expect 2 wms_task_items rows
with t as (
    insert into public.wms_tasks (source_module, source_id, task_type, title, source_payload)
    values ('test_phase1', 'test-a-' || gen_random_uuid(), 'Тест', 'Тестовая задача А',
        '{"task_items":[
            {"shk":"11111111111","nm":"1001","name":"Товар А","price":100,"status":"","mx":"","movement":""},
            {"shk":"22222222222","nm":"1002","name":"Товар Б","price":200,"status":"SGR","mx":"М1","movement":"2026-10-01"}
        ]}'::jsonb)
    returning id
)
select t.id as task_id, (select count(*) from public.wms_task_items i where i.task_id = t.id) as item_count
from t;
-- Expected: item_count = 2

-- Test B: task with NO task_items key at all -- expect 0 rows, no error
with t as (
    insert into public.wms_tasks (source_module, source_id, task_type, title, source_payload)
    values ('test_phase1', 'test-b-' || gen_random_uuid(), 'Тест', 'Тестовая задача Б', '{}'::jsonb)
    returning id
)
select t.id as task_id, (select count(*) from public.wms_task_items i where i.task_id = t.id) as item_count
from t;
-- Expected: item_count = 0

-- Test C: update source_payload (add a 3rd item) -- expect full replace to 3 rows
do $$
declare
    v_task_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, source_payload)
    values ('test_phase1', 'test-c-' || gen_random_uuid(), 'Тест', 'Тестовая задача В',
        '{"task_items":[{"shk":"33333333333","nm":"1003","name":"Товар В","price":50,"status":"","mx":"","movement":""}]}'::jsonb)
    returning id into v_task_id;

    update public.wms_tasks
    set source_payload = '{"task_items":[
        {"shk":"33333333333","nm":"1003","name":"Товар В","price":50,"status":"","mx":"","movement":""},
        {"shk":"44444444444","nm":"1004","name":"Товар Г","price":75,"status":"","mx":"","movement":""},
        {"shk":"55555555555","nm":"1005","name":"Товар Д","price":90,"status":"","mx":"","movement":""}
    ]}'::jsonb
    where id = v_task_id;

    raise notice 'Test C item count after update (expect 3): %',
        (select count(*) from public.wms_task_items where task_id = v_task_id);
end $$;

-- Test D: unrelated-column update must NOT touch wms_task_items rows
do $$
declare
    v_task_id uuid;
    v_before text;
    v_after text;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, source_payload)
    values ('test_phase1', 'test-d-' || gen_random_uuid(), 'Тест', 'Тестовая задача Г',
        '{"task_items":[{"shk":"66666666666","nm":"1006","name":"Товар Е","price":10,"status":"","mx":"","movement":""}]}'::jsonb)
    returning id into v_task_id;

    select string_agg(id::text, ',' order by id) into v_before from public.wms_task_items where task_id = v_task_id;

    update public.wms_tasks set title = title where id = v_task_id;

    select string_agg(id::text, ',' order by id) into v_after from public.wms_task_items where task_id = v_task_id;

    raise notice 'Test D row ids unchanged (expect true): %', (v_before = v_after);
end $$;

rollback;
SQLEOF
} > /tmp/test_wms_task_items.sql
supabase db query --linked --file /tmp/test_wms_task_items.sql
```

Expected: Test A returns `item_count = 2`, Test B returns `item_count = 0`, Test C's `raise notice` prints `3`, Test D's `raise notice` prints `true`. No errors.

If any expectation fails, fix the migration SQL (Step 1) and re-run Step 2 — do not proceed to Step 3 until all four pass.

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

Expected output includes `"migrations":["202610090001_wms_task_items.sql"]` and `"message":"Finished supabase db push."`.

- [ ] **Step 4: Verify against real (non-transactional) data**

```bash
cat << 'SQLEOF' > /tmp/verify_task1.sql
select count(*) as table_exists_check from public.wms_task_items;
select tgname from pg_trigger where tgrelid = 'public.wms_tasks'::regclass and tgname like 'wms_tasks_sync_task_items%' order by tgname;
SQLEOF
supabase db query --linked --file /tmp/verify_task1.sql
```

Expected: first query returns `table_exists_check: 0` (table exists, empty — Task 2 hasn't backfilled yet), second query returns two rows: `wms_tasks_sync_task_items_insert` and `wms_tasks_sync_task_items_update`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610090001_wms_task_items.sql
git commit -m "$(cat <<'EOF'
Добавляем wms_task_items: таблица + триггер синхронизации (Фаза 1, кандидат D)

Зеркалим wms_tasks.source_payload.task_items построчно. Ничего в
приложении пока не читает эту таблицу -- чистая структурная подготовка к
Фазе 2 (docs/superpowers/specs/2026-10-08-wms-task-items-normalization-design.md).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 2: Backfill historical `task_items` into `wms_task_items`

**Files:**
- Create: `supabase/migrations/202610090002_backfill_wms_task_items.sql`

**Interfaces:**
- Consumes: table `public.wms_task_items` from Task 1 (must already exist).
- Produces: every existing `wms_tasks` row (including `is_deleted = true` and `task_status = 'Завершено'`) has its `task_items` mirrored into `wms_task_items`. No new function/trigger produced — this is a one-off data migration.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/202610090002_backfill_wms_task_items.sql` with exactly this content:

```sql
-- Разовый бэкофилл: таблица wms_task_items и триггер появились в
-- 202610090001 и с этого момента ловят ВСЕ новые/изменённые строки
-- wms_tasks сами. Эта миграция закрывает историю ДО того момента --
-- все существующие строки (включая завершённые и мягко удалённые,
-- is_deleted = true -- цель Фазы 1 полное зеркало истории, а не только
-- активная выборка).
insert into public.wms_task_items (task_id, shk, nm, name, status, price, mx, movement, row_number, raw)
select
    t.id,
    item->>'shk',
    item->>'nm',
    item->>'name',
    item->>'status',
    nullif(item->>'price', '')::numeric,
    item->>'mx',
    item->>'movement',
    nullif(item->>'row_number', '')::integer,
    item->'raw'
from public.wms_tasks t,
     jsonb_array_elements(coalesce(t.source_payload->'task_items', '[]'::jsonb)) item
where item->>'shk' is not null;
```

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
{
echo "begin;"
cat supabase/migrations/202610090002_backfill_wms_task_items.sql
cat << 'SQLEOF'

-- Expected number of rows the backfill should produce, computed
-- independently (not reusing the migration's own query verbatim) by
-- counting shk-bearing elements directly from source_payload.
select
    (select count(*)
     from public.wms_tasks t, jsonb_array_elements(coalesce(t.source_payload->'task_items', '[]'::jsonb)) item
     where item->>'shk' is not null) as expected_count,
    (select count(*) from public.wms_task_items) as actual_count;
-- Expected: expected_count = actual_count (both counts are the same
-- query shape here only because the migration itself; the real check
-- is that actual_count is not 0 and not obviously truncated -- compare
-- against the task count below too)

select count(*) as wms_tasks_with_items
from public.wms_tasks t
where jsonb_array_length(coalesce(t.source_payload->'task_items', '[]'::jsonb)) > 0;

rollback;
SQLEOF
} > /tmp/test_backfill.sql
supabase db query --linked --file /tmp/test_backfill.sql
```

Expected: `expected_count = actual_count` in the first query (sanity: the migration's own insert and an independently-written count of the same source data agree — this mainly catches a typo/dropped `where` clause, not a logic error, since both derive from the same `task_items` field name). Record the `actual_count` and `wms_tasks_with_items` numbers — you'll compare `actual_count` against a fresh independent count after the real apply in Step 4.

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
cat << 'SQLEOF' > /tmp/verify_task2.sql
select
    (select count(*) from public.wms_task_items) as backfilled_rows,
    (select count(*)
     from public.wms_tasks t, jsonb_array_elements(coalesce(t.source_payload->'task_items', '[]'::jsonb)) item
     where item->>'shk' is not null) as expected_rows;
SQLEOF
supabase db query --linked --file /tmp/verify_task2.sql
```

Expected: `backfilled_rows = expected_rows`, and both match the `actual_count`/`expected_count` numbers recorded in Step 2 (the transaction was rolled back, so the real apply must reproduce the same numbers independently — if they differ, something else wrote to `wms_tasks` between the test and the apply, which is expected on a live production table under active shift use; a small difference is fine, a large one is not and should be investigated before moving on).

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610090002_backfill_wms_task_items.sql
git commit -m "$(cat <<'EOF'
Бэкофилл: переносим историю task_items в wms_task_items (Фаза 1, кандидат D)

Триггер из 202610090001 ловит только новые/изменённые строки с этого
момента -- эта миграция закрывает всю историю одним проходом, включая
завершённые и мягко удалённые задачи.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Self-Review

**Spec coverage:** every section of the spec maps to a task step —
table schema (Task 1 Step 1), trigger + `security definer` rationale (Task 1
Step 1), no RLS/no grants (Task 1 Step 1 — simply omitted, matching the
spec's "do nothing" instruction), testing scenarios from the spec's
"Тестирование" section (Task 1 Step 2: ordinary task, task with no
`task_items`, unrelated-column no-op; Task 1 Step 2 Test C covers "тара с
несколькими ШК" via the 3-item update), backfill including completed/deleted
rows (Task 2 Step 1 — no `is_deleted`/`task_status` filter, matching the
spec's explicit "включая завершённые и мягко удалённые").

**Placeholder scan:** no TBD/TODO; every code block is complete, runnable SQL
with literal values, not pseudocode.

**Type consistency:** column names/types used in Task 1's `create table` match
exactly what Task 2's `insert into public.wms_task_items (...)` targets
(`task_id, shk, nm, name, status, price, mx, movement, row_number, raw`) —
same order, same extraction expressions in both the trigger function and the
backfill statement.
