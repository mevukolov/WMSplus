# ШК как постоянная сущность — реестр wms_shk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every ШК a permanent identity (`wms_shk`) and its own permanent interaction history (`wms_shk_history`), independent of which `wms_tasks` row currently holds it, plus a database-level guarantee that a ШК can never have two simultaneously-active tasks.

**Architecture:** Pure SQL, 4 sequential migrations, in the exact order the spec requires: schema (two new tables) → two trigger functions (one mirrors `wms_task_items` into `wms_shk`, one fans `wms_task_history` out into `wms_shk_history`) → one-time backfill of both new tables from existing data → a unique partial index on `wms_task_items` applied last, as a final belt-and-suspenders check.

**Tech Stack:** PostgreSQL (Supabase) tables, plpgsql triggers, one-off backfill `insert...select`. No JS/HTML changes — the ШК profile screen is explicitly out of scope for this plan (spec: "Экран — отдельный, последующий заход").

**Spec:** `docs/superpowers/specs/2026-10-11-wms-shk-registry-design.md`

## Global Constraints

- Task order matches the spec's own "Порядок применения" exactly: schema → triggers → backfill → unique index last. Do not reorder.
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
- Migration file naming: latest existing prefix as of this plan is `202610110003`. This plan uses `202610120001`-`202610120004`. Run `ls supabase/migrations | sort | tail -5` before creating each file to confirm no new collision appeared.
- No JS to verify (`node --check` not applicable — no `.js` file is touched by this plan).
- Commit each task separately, push to `origin/main` after each task's verification — matches this session's established direct-to-main workflow.

---

### Task 1: Schema — `wms_shk` + `wms_shk_history`

**Files:**
- Create: `supabase/migrations/202610120001_wms_shk_registry.sql`

**Interfaces:**
- Produces: tables `public.wms_shk` (`shk` text PK, `nm`, `name`, `current_task_id` uuid FK → `wms_tasks(id) on delete set null`, `created_at`, `updated_at`) and `public.wms_shk_history` (`id` uuid PK, `shk` text FK → `wms_shk(shk)`, `task_id` uuid FK → `wms_tasks(id) on delete set null`, `event_type`, `actor_employee_id`, `actor_name`, `payload` jsonb, `created_at`), index `wms_shk_history_shk_idx` on `(shk, created_at desc)`. Task 2's trigger functions insert into both of these tables; Task 3's backfill populates them.

- [ ] **Step 1: Write the migration file**

```sql
-- Кандидат "реестр ШК" (docs/superpowers/specs/2026-10-11-wms-shk-registry-design.md):
-- ШК получает постоянную идентичность и собственный журнал истории, не
-- зависящие от того, какая строка wms_tasks держит его сейчас.
create table public.wms_shk (
    shk text primary key,
    nm text,
    name text,
    current_task_id uuid references public.wms_tasks(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

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

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610120001_wms_shk_registry.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

do $$
declare
    v_task_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title)
    values ('test_shk_registry', 'schema-test-' || gen_random_uuid(), 'Тест', 'Тест схемы')
    returning id into v_task_id;

    insert into public.wms_shk (shk, nm, name, current_task_id)
    values ('90909090909', '8001', 'Тестовый товар', v_task_id);

    insert into public.wms_shk_history (shk, task_id, event_type, payload)
    values ('90909090909', v_task_id, 'test_event', '{"note":"schema check"}'::jsonb);

    insert into test_results values ('shk_row_created',
        (select name from public.wms_shk where shk = '90909090909'), 'Тестовый товар');
    insert into test_results values ('history_row_created',
        (select count(*)::text from public.wms_shk_history where shk = '90909090909'), '1');

    -- on delete set null: deleting the task must NOT delete wms_shk/wms_shk_history rows
    delete from public.wms_tasks where id = v_task_id;

    insert into test_results values ('shk_survives_task_deletion',
        (select count(*)::text from public.wms_shk where shk = '90909090909'), '1');
    insert into test_results values ('history_survives_task_deletion',
        (select current_task_id is null from public.wms_shk where shk = '90909090909')::text, 'true');
    insert into test_results values ('history_task_id_nulled',
        (select task_id is null from public.wms_shk_history where shk = '90909090909')::text, 'true');
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_shk_task1.sql
supabase db query --linked --file /tmp/test_shk_task1.sql
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
cat << 'SQLEOF' > /tmp/verify_shk_task1.sql
select
    (select count(*) from information_schema.tables where table_schema='public' and table_name='wms_shk') as wms_shk_exists,
    (select count(*) from information_schema.tables where table_schema='public' and table_name='wms_shk_history') as wms_shk_history_exists;
SQLEOF
supabase db query --linked --file /tmp/verify_shk_task1.sql
```

Expected: both `1`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610120001_wms_shk_registry.sql
git commit -m "$(cat <<'EOF'
Добавляем wms_shk + wms_shk_history (реестр ШК, шаг 1/4)

Постоянная идентичность ШК и его собственный журнал истории, не
зависящие от жизни конкретной задачи (task_id -- on delete set null, не
каскад). Пока ничего не поддерживает эти таблицы автоматически -- только
схема.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 2: Триггеры — поддержание реестра и зеркало истории

**Files:**
- Create: `supabase/migrations/202610120002_wms_shk_registry_triggers.sql`

**Interfaces:**
- Consumes: `wms_shk`/`wms_shk_history` tables (Task 1).
- Produces: `public.wms_sync_shk_registry()` + trigger `wms_task_items_sync_shk` on `wms_task_items`; `public.wms_fanout_shk_history()` + trigger `wms_task_history_fanout_to_shk` on `wms_task_history`. Task 3's backfill does NOT rely on these triggers firing retroactively (it writes directly) — these triggers only affect NEW activity from this point forward.

- [ ] **Step 1: Write the migration file**

```sql
-- Триггер 1: любая вставка/обновление строки wms_task_items поддерживает
-- актуальную wms_shk -- current_task_id указывает на активную
-- (незавершённую) задачу, или null, если ШК сейчас завершён.
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

-- Триггер 2: каждая вставка в wms_task_history зеркалится в
-- wms_shk_history -- по одной строке на каждый ШК, СЕЙЧАС числящийся в
-- этой задаче. Ни один из существующих писателей wms_task_history не
-- трогается -- запись и так идёт в одну таблицу, триггер на неё ловит всё.
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

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610120002_wms_shk_registry_triggers.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

do $$
declare
    v_task_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload, source_shk_ids)
    values ('test_shk_registry', 'trigger-' || gen_random_uuid(), 'Предсортировка', 'Триггер-тест', 'Не выбран', 'Не начато',
        '{"task_items":[
            {"shk":"11223344556","nm":"9001","name":"Товар Ц","price":10,"status":"","mx":"","movement":""},
            {"shk":"22334455667","nm":"9002","name":"Товар Ч","price":20,"status":"","mx":"","movement":""}
        ]}'::jsonb,
        array['11223344556','22334455667'])
    returning id into v_task_id;

    insert into test_results values ('shk_a_registered',
        (select current_task_id from public.wms_shk where shk = '11223344556')::text, v_task_id::text);
    insert into test_results values ('shk_b_registered',
        (select current_task_id from public.wms_shk where shk = '22334455667')::text, v_task_id::text);

    update public.wms_task_items set task_status = 'Завершено' where task_id = v_task_id and shk = '11223344556';

    insert into test_results values ('completed_item_cleared',
        (select current_task_id from public.wms_shk where shk = '11223344556') is null, true);
    insert into test_results values ('sibling_still_active',
        (select current_task_id from public.wms_shk where shk = '22334455667')::text, v_task_id::text);

    insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
    values (v_task_id, 'test_fanout_event', 'Тест', '', '{"note":"fanout"}'::jsonb);

    insert into test_results values ('fanout_count_both_items',
        (select count(*)::text from public.wms_shk_history where task_id = v_task_id and event_type = 'test_fanout_event'), '2');
    insert into test_results values ('fanout_reached_shk_a',
        (exists(select 1 from public.wms_shk_history where shk = '11223344556' and event_type = 'test_fanout_event'))::text, 'true');
    insert into test_results values ('fanout_reached_shk_b',
        (exists(select 1 from public.wms_shk_history where shk = '22334455667' and event_type = 'test_fanout_event'))::text, 'true');
end $$;

-- Task with empty task_items -- history insert must not error, must fan out to 0 rows.
do $$
declare
    v_empty_task_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, source_payload)
    values ('test_shk_registry', 'empty-' || gen_random_uuid(), 'Тест', 'Пустая задача', '{}'::jsonb)
    returning id into v_empty_task_id;

    insert into public.wms_task_history (task_id, event_type, payload)
    values (v_empty_task_id, 'test_empty_event', '{}'::jsonb);

    insert into test_results values ('empty_task_no_fanout_crash',
        (select count(*)::text from public.wms_shk_history where task_id = v_empty_task_id), '0');
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_shk_task2.sql
supabase db query --linked --file /tmp/test_shk_task2.sql
```

Expected: 7 rows, all `pass: true`.

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
cat << 'SQLEOF' > /tmp/verify_shk_task2.sql
select
    (select count(*) from pg_trigger where tgrelid = 'public.wms_task_items'::regclass and tgname = 'wms_task_items_sync_shk') as sync_trigger_exists,
    (select count(*) from pg_trigger where tgrelid = 'public.wms_task_history'::regclass and tgname = 'wms_task_history_fanout_to_shk') as fanout_trigger_exists;
SQLEOF
supabase db query --linked --file /tmp/verify_shk_task2.sql
```

Expected: both `1`. **Note:** from this point on, every NEW task/item/history write in production starts populating `wms_shk`/`wms_shk_history` automatically — Task 3's backfill only needs to cover data that existed BEFORE this migration.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610120002_wms_shk_registry_triggers.sql
git commit -m "$(cat <<'EOF'
Триггеры поддержки реестра ШК (шаг 2/4)

wms_sync_shk_registry поддерживает current_task_id из wms_task_items.
wms_fanout_shk_history зеркалит каждую запись wms_task_history в историю
каждого ШК задачи -- ни один из существующих писателей истории не
тронут, триггер на саму таблицу ловит всё.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 3: Бэкофилл — существующие данные до триггеров

**Files:**
- Create: `supabase/migrations/202610120003_backfill_wms_shk_registry.sql`

**Interfaces:**
- Consumes: `wms_shk`/`wms_shk_history` (Task 1); reads existing `wms_task_items`/`wms_task_history` (unchanged by this task).
- Produces: every historical `shk` gets a `wms_shk` row; every historical `wms_task_history` row gets mirrored into `wms_shk_history` for each `shk` currently in that `task_id`.

- [ ] **Step 1: Write the migration file**

```sql
-- Разовый бэкофилл: триггеры из 202610120002 ловят только НОВУЮ
-- активность с этого момента. Эта миграция закрывает всю историю одним
-- проходом -- состав тары не меняется после создания (решение Фазы 2
-- кандидата D), так что текущий состав wms_task_items = состав на любой
-- момент в прошлом для этой задачи.
insert into public.wms_shk (shk, nm, name, current_task_id)
select distinct on (wi.shk)
    wi.shk, wi.nm, wi.name,
    case when wi.task_status <> 'Завершено' then wi.task_id else null end
from public.wms_task_items wi
order by wi.shk, (wi.task_status <> 'Завершено') desc, wi.updated_at desc
on conflict (shk) do nothing;

insert into public.wms_shk_history (shk, task_id, event_type, actor_employee_id, actor_name, payload, created_at)
select wi.shk, h.task_id, h.event_type, h.actor_employee_id, h.actor_name, h.payload, h.created_at
from public.wms_task_history h
join public.wms_task_items wi on wi.task_id = h.task_id
where not exists (
    -- Триггер из 202610120002 уже активен и мог успеть зазеркалить
    -- какие-то строки wms_task_history, вставленные между применением
    -- того шага и этого бэкофилла (прод живой, окно между миграциями не
    -- нулевое) -- без этой проверки такие строки задвоились бы.
    select 1 from public.wms_shk_history sh
    where sh.shk = wi.shk and sh.task_id = h.task_id
      and sh.event_type = h.event_type and sh.created_at = h.created_at
);
```

`distinct on (wi.shk) ... order by wi.shk, (wi.task_status <> 'Завершено') desc, wi.updated_at desc` —
если один и тот же `shk` исторически встречается в нескольких `wms_task_items`
строках (разные `task_id` за его жизнь), берём сначала активную
(незавершённую), если такая есть, иначе — самую свежую по `updated_at`.

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610120003_backfill_wms_shk_registry.sql
cat << 'SQLEOF'

select
    (select count(distinct shk) from public.wms_task_items) as expected_shk_count,
    (select count(*) from public.wms_shk) as actual_shk_count,
    (select count(*)
     from public.wms_task_history h
     join public.wms_task_items wi on wi.task_id = h.task_id) as expected_history_count,
    (select count(*) from public.wms_shk_history) as actual_history_count;

rollback;
SQLEOF
} > /tmp/test_shk_task3.sql
supabase db query --linked --file /tmp/test_shk_task3.sql
```

Expected: `expected_shk_count = actual_shk_count` and `expected_history_count = actual_history_count`. Record both pairs of numbers — compare them again against the real counts in Step 4 (a production system is live, so a small drift between the test and the real apply is expected and fine; a large one is not and should be investigated before moving on, same discipline as every prior backfill this session).

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
cat << 'SQLEOF' > /tmp/verify_shk_task3.sql
select
    (select count(distinct shk) from public.wms_task_items) as expected_shk_count,
    (select count(*) from public.wms_shk) as actual_shk_count,
    (select count(*)
     from public.wms_task_history h
     join public.wms_task_items wi on wi.task_id = h.task_id) as expected_history_count,
    (select count(*) from public.wms_shk_history) as actual_history_count;
SQLEOF
supabase db query --linked --file /tmp/verify_shk_task3.sql
```

Expected: both pairs equal (or very close, per the note in Step 2 — this table is live).

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610120003_backfill_wms_shk_registry.sql
git commit -m "$(cat <<'EOF'
Бэкофилл реестра ШК из истории (шаг 3/4)

Переносим всю существующую wms_task_items/wms_task_history в
wms_shk/wms_shk_history одним проходом -- триггеры из предыдущего шага
ловят только новую активность, эта миграция закрывает историю.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 4: Уникальный индекс — запрет двух активных задач на один ШК

**Files:**
- Create: `supabase/migrations/202610120004_wms_task_items_shk_active_unique.sql`

**Interfaces:**
- Consumes: `wms_task_items` (existing). No other task depends on this one — it's the final, independent safety-net constraint.

- [ ] **Step 1: Re-verify zero violations immediately before writing/applying anything**

```bash
cat << 'SQLEOF' > /tmp/recheck_shk_active_dupes.sql
select shk, count(*) as active_rows
from public.wms_task_items
where task_status <> 'Завершено'
group by shk
having count(*) > 1
limit 20;
SQLEOF
supabase db query --linked --file /tmp/recheck_shk_active_dupes.sql
```

Expected: zero rows (this was already confirmed zero on 2026-10-11 when the spec was written; re-check now in case anything changed since). **If this returns ANY rows, STOP — do not proceed with this task.** Investigate those specific `shk` values first (likely a legitimate pre-existing data situation predating this whole migration effort, not something to silently paper over with a partial/weaker index).

- [ ] **Step 2: Write the migration file**

```sql
-- Реальная защита от двух активных задач на один ШК -- частичный
-- уникальный индекс, не wms_shk.current_task_id (та колонка -- просто
-- указатель-кэш, не механизм защиты). Проверено на живых данных дважды
-- (2026-10-11 при написании спеки, и непосредственно перед применением
-- этой миграции) -- нарушителей нет.
create unique index wms_task_items_shk_active_unique
    on public.wms_task_items (shk)
    where task_status <> 'Завершено';
```

- [ ] **Step 3: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610120004_wms_task_items_shk_active_unique.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

-- A second active row for a shk that already has one must be rejected.
do $$
declare
    v_task_a uuid;
    v_task_b uuid;
    v_error_caught boolean := false;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, source_payload, source_shk_ids)
    values ('test_shk_registry', 'dupe-a-' || gen_random_uuid(), 'Тест', 'Задача А', '{}'::jsonb, '{}'::text[])
    returning id into v_task_a;
    insert into public.wms_tasks (source_module, source_id, task_type, title, source_payload, source_shk_ids)
    values ('test_shk_registry', 'dupe-b-' || gen_random_uuid(), 'Тест', 'Задача Б', '{}'::jsonb, '{}'::text[])
    returning id into v_task_b;

    insert into public.wms_task_items (task_id, shk, task_status) values (v_task_a, '33445566778', 'Не начато');

    begin
        insert into public.wms_task_items (task_id, shk, task_status) values (v_task_b, '33445566778', 'Не начато');
    exception when unique_violation then
        v_error_caught := true;
    end;

    insert into test_results values ('second_active_row_rejected', v_error_caught::text, 'true');
end $$;

-- A COMPLETED duplicate must still be allowed (the index only covers
-- non-'Завершено' rows) -- this is the normal historical case (same shk
-- resolved long ago under an old task, now active again under a new one).
do $$
declare
    v_task_old uuid;
    v_task_new uuid;
    v_error_caught boolean := false;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, source_payload, source_shk_ids)
    values ('test_shk_registry', 'hist-old-' || gen_random_uuid(), 'Тест', 'Старая задача', '{}'::jsonb, '{}'::text[])
    returning id into v_task_old;
    insert into public.wms_tasks (source_module, source_id, task_type, title, source_payload, source_shk_ids)
    values ('test_shk_registry', 'hist-new-' || gen_random_uuid(), 'Тест', 'Новая задача', '{}'::jsonb, '{}'::text[])
    returning id into v_task_new;

    insert into public.wms_task_items (task_id, shk, task_status) values (v_task_old, '44556677889', 'Завершено');

    begin
        insert into public.wms_task_items (task_id, shk, task_status) values (v_task_new, '44556677889', 'Не начато');
    exception when unique_violation then
        v_error_caught := true;
    end;

    insert into test_results values ('completed_historical_row_does_not_block', v_error_caught::text, 'false');
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_shk_task4.sql
supabase db query --linked --file /tmp/test_shk_task4.sql
```

Expected: 2 rows, both `pass: true`.

- [ ] **Step 4: Apply the migration to the live database**

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

If this step fails with a unique-violation error during index creation, that means production data changed between Step 1's re-check and now (a real race) — STOP, do not retry blindly; re-run Step 1's query for real (not in a rollback) to find the actual offending rows and report them before deciding how to proceed.

- [ ] **Step 5: Verify against real (non-transactional) data**

```bash
cat << 'SQLEOF' > /tmp/verify_shk_task4.sql
select indexname from pg_indexes where tablename = 'wms_task_items' and indexname = 'wms_task_items_shk_active_unique';
SQLEOF
supabase db query --linked --file /tmp/verify_shk_task4.sql
```

Expected: one row, `indexname: wms_task_items_shk_active_unique`.

- [ ] **Step 6: Commit and push**

```bash
git add supabase/migrations/202610120004_wms_task_items_shk_active_unique.sql
git commit -m "$(cat <<'EOF'
Уникальный индекс: запрет двух активных задач на один ШК (шаг 4/4)

Частичный уникальный индекс на wms_task_items(shk) where task_status <>
'Завершено' -- реальная защита на уровне БД, не полагается на
wms_shk.current_task_id (тот всего лишь указатель-кэш). Проверено дважды
на живых данных -- нарушителей нет. Закрывает реестр ШК целиком.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Self-Review

**Spec coverage:** схема (`wms_shk`/`wms_shk_history`) → Task 1; оба
триггера → Task 2; бэкофилл в заданном порядке (сначала `wms_shk`, потом
`wms_shk_history`) → Task 3; уникальный индекс, применяемый последним с
повторной проверкой нарушителей прямо перед применением → Task 4. Порядок
задач точно совпадает с разделом спеки «Порядок применения» — ничего не
переставлено.

**Placeholder scan:** TBD/TODO нет; каждый шаг содержит полный, рабочий
SQL, скопированный из самой спеки или прямо ей соответствующий.

**Type consistency:** имена колонок/таблиц (`wms_shk.current_task_id`,
`wms_shk_history.shk`/`task_id`) используются одинаково в Task 1 (DDL),
Task 2 (триггеры), Task 3 (бэкофилл) и Task 4 (индекс) — без расхождений.
