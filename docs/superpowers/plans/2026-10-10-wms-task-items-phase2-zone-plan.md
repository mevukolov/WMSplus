# ШК как первичная единица хранения — Фаза 2 (зона на ШК) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move zone/verdict/status ownership for "Чистые списания" from the whole `wms_tasks` row to the individual `wms_task_items` row, including the shared-tara case — removing the `split_from_task_id` row-creation costyl entirely, with the UI (tab + item-scoped verdict completion) working end to end.

**Architecture:** 6 sequential tasks — 4 SQL migrations (schema, trigger, forward RPC, reverse-transition RPC) followed by 2 JS changes (list tab, item-scoped task-detail mechanism via a composite `"<task_id>::<shk>"` id). Each SQL task is tested live in a rolled-back transaction before being applied for real. JS tasks are verified with `node --check tasks.js` only — this session has no browser-based QA available (see Global Constraints).

**Tech Stack:** PostgreSQL (Supabase) migrations, vanilla JS (`tasks.js`). No build step, no JS test framework.

**Spec:** `docs/superpowers/specs/2026-10-09-wms-task-items-phase2-zone-design.md`

## Global Constraints

- Tara composition (`wms_tasks.source_payload.task_items`/`source_shk_ids`) is **never modified** when a ШК's zone changes — zone lives exclusively on its own `wms_task_items` row (spec decision #1).
- `responsibility_zone` is **not** added to `wms_task_items` — unused in the "Чистые списания" flow (spec decision #5).
- Zone-specific extra fields (`pure_losses_lr`/`pure_losses_date_lost`) live in a generic `zone_payload jsonb` column, not dedicated columns (spec decision #6).
- No RLS on `wms_task_items` — same convention as `wms_tasks`/`wms_superset_cache` (grants only, no policy).
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
- Migration file naming: latest existing prefix as of this plan is `202610090002`. This plan uses `202610100001`-`202610100004`. Run `ls supabase/migrations | sort | tail -5` before creating each file to confirm no new collision appeared.
- JS verification is `node --check tasks.js` only. **Live browser QA is not available this session** — the app's auth guard (`checkUserAccess` in `ui.js`) now requires a real Supabase Auth session; a fake `localStorage.user` object is not sufficient (discovered and reported to the user earlier this session, during Candidate A). State this explicitly when reporting Task 5/6 done — do not claim browser-verified behavior.
- Commit each task separately, push to `origin/main` after each task's verification — matches this session's established direct-to-main workflow.

---

### Task 1: Schema — add zone columns to `wms_task_items` + grants

**Files:**
- Create: `supabase/migrations/202610100001_wms_task_items_zone_columns.sql`

**Interfaces:**
- Produces: columns `task_type text`, `opp_verdict text`, `task_status text`, `completed_at timestamptz`, `reopen_after timestamptz`, `zone_payload jsonb not null default '{}'::jsonb` on `public.wms_task_items`; unique constraint `wms_task_items_task_id_shk_key` on `(task_id, shk)`; `select`/`update` grants to `anon, authenticated`. Task 2's trigger rewrite and Task 3/4's RPC rewrites depend on this constraint existing (needed for `on conflict (task_id, shk)` in Task 2, and for the plain `update ... where task_id = .. and shk = ..` statements in Tasks 3/4/5/6 to target exactly one row).

- [ ] **Step 1: Write the migration file**

```sql
-- Фаза 2 кандидата D (docs/superpowers/specs/2026-10-09-wms-task-items-phase2-zone-design.md):
-- зона/вердикт/статус переезжают на уровень ШК. responsibility_zone
-- сознательно не добавляется -- не используется в контуре "Чистые
-- списания". Зоно-специфичные поля (lr/date_lost) идут в zone_payload,
-- не отдельными колонками -- под будущие зоны со своими полями.
alter table public.wms_task_items
    add column task_type text,
    add column opp_verdict text,
    add column task_status text,
    add column completed_at timestamptz,
    add column reopen_after timestamptz,
    add column zone_payload jsonb not null default '{}'::jsonb;

alter table public.wms_task_items
    add constraint wms_task_items_task_id_shk_key unique (task_id, shk);

-- Grant на update -- впервые таблицу пишет не только security definer RPC,
-- а напрямую клиентский JS (вкладка "Чистые списания" читает её,
-- completePureLossesItemFromDetail пишет в неё). RLS не включаем -- тот
-- же принцип, каким уже работают wms_tasks/wms_superset_cache.
grant select, update on public.wms_task_items to anon, authenticated;
```

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610100001_wms_task_items_zone_columns.sql
cat << 'SQLEOF'

select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='wms_task_items'
  and column_name in ('task_type','opp_verdict','task_status','completed_at','reopen_after','zone_payload')
order by column_name;

select conname from pg_constraint where conrelid = 'public.wms_task_items'::regclass and conname = 'wms_task_items_task_id_shk_key';

rollback;
SQLEOF
} > /tmp/test_phase2_task1.sql
supabase db query --linked --file /tmp/test_phase2_task1.sql
```

Expected: first query returns 6 rows (all 6 new columns listed), second query returns 1 row with the constraint name. No errors (in particular, no duplicate-key error from the unique constraint — Phase 1's backfill never produced duplicate `(task_id, shk)` pairs since it was a straight 1:1 mirror of a JSON array with no repeated `shk` values per task expected in practice; if this step errors with a duplicate-key violation, STOP and investigate which `task_id` has a repeated `shk` before proceeding — do not relax the constraint to work around it).

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
cat << 'SQLEOF' > /tmp/verify_phase2_task1.sql
select count(*) as new_column_count from information_schema.columns
where table_schema='public' and table_name='wms_task_items'
  and column_name in ('task_type','opp_verdict','task_status','completed_at','reopen_after','zone_payload');
select has_table_privilege('authenticated', 'public.wms_task_items', 'UPDATE') as can_update;
SQLEOF
supabase db query --linked --file /tmp/verify_phase2_task1.sql
```

Expected: `new_column_count = 6`, `can_update = true`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610100001_wms_task_items_zone_columns.sql
git commit -m "$(cat <<'EOF'
Добавляем зону/вердикт на wms_task_items (Фаза 2, кандидат D, шаг 1/6)

task_type/opp_verdict/task_status/completed_at/reopen_after/zone_payload
+ unique(task_id, shk). Чистая схема, поведение пока не меняется.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 2: Trigger rewrite — upsert instead of delete+insert

**Files:**
- Create: `supabase/migrations/202610100002_wms_sync_task_items_upsert.sql`

**Interfaces:**
- Consumes: `wms_task_items_task_id_shk_key` unique constraint (Task 1).
- Produces: `public.wms_sync_task_items()` function body replaced (same name, same two triggers from Phase 1 keep pointing at it — no trigger DDL changes needed, `create or replace function` is enough). Tasks 3-6 depend on zone columns surviving unrelated parent updates, which this task guarantees.

- [ ] **Step 1: Write the migration file**

```sql
-- Фаза 2: старый (Фаза 1) триггер полностью пересобирал строки при
-- каждой записи source_payload -- это стёрло бы разошедшуюся зону при
-- первом же несвязанном изменении родителя. Новая версия -- upsert,
-- зона/вердикт/zone_payload НЕ в списке update на conflict: однажды
-- заданные (на INSERT или явной записью RPC/UI), больше не трогаются
-- этой функцией.
--
-- Сознательно убрано поведение "удалить строки для ШК, пропавших из
-- task_items родителя" (было в Фазе 1) -- принятое ограничение, см.
-- спеку, раздел 2.
create or replace function public.wms_sync_task_items() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.wms_task_items (
        task_id, shk, nm, name, status, price, mx, movement, row_number, raw,
        task_type, opp_verdict, task_status
    )
    select
        new.id, item->>'shk', item->>'nm', item->>'name', item->>'status',
        nullif(item->>'price', '')::numeric, item->>'mx', item->>'movement',
        nullif(item->>'row_number', '')::integer, item->'raw',
        new.task_type, new.opp_verdict, new.task_status
    from jsonb_array_elements(coalesce(new.source_payload->'task_items', '[]'::jsonb)) item
    where item->>'shk' is not null
    on conflict (task_id, shk) do update set
        nm = excluded.nm,
        name = excluded.name,
        status = excluded.status,
        price = excluded.price,
        mx = excluded.mx,
        movement = excluded.movement,
        row_number = excluded.row_number,
        raw = excluded.raw,
        updated_at = now();
    return new;
end;
$$;
```

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610100002_wms_sync_task_items_upsert.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

-- Test A: brand new task -- item row initializes task_type from parent
do $$
declare
    v_task_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload)
    values ('test_phase2', 'test-a-' || gen_random_uuid(), 'Предсортировка', 'Тестовая задача А', 'Не выбран', 'Не начато',
        '{"task_items":[{"shk":"77777777777","nm":"2001","name":"Товар Ж","price":100,"status":"","mx":"","movement":""}]}'::jsonb)
    returning id into v_task_id;

    insert into test_results values ('A_inherits_task_type',
        (select task_type from public.wms_task_items where task_id = v_task_id and shk = '77777777777'),
        'Предсортировка');
end $$;

-- Test B: item diverges (simulating what the RPC will do in Task 3), then
-- an UNRELATED parent update must NOT reset it back
do $$
declare
    v_task_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload)
    values ('test_phase2', 'test-b-' || gen_random_uuid(), 'Предсортировка', 'Тестовая задача Б', 'Не выбран', 'Не начато',
        '{"task_items":[
            {"shk":"88888888888","nm":"2002","name":"Товар З","price":50,"status":"","mx":"","movement":""},
            {"shk":"99999999999","nm":"2003","name":"Товар И","price":60,"status":"","mx":"","movement":""}
        ]}'::jsonb)
    returning id into v_task_id;

    update public.wms_task_items set task_type = 'Чистые списания', opp_verdict = 'Не выбран', task_status = 'Не начато'
    where task_id = v_task_id and shk = '88888888888';

    -- Unrelated change: parent's source_payload re-written with a
    -- different price for the OTHER item -- a realistic re-upload.
    update public.wms_tasks
    set source_payload = '{"task_items":[
        {"shk":"88888888888","nm":"2002","name":"Товар З","price":50,"status":"","mx":"","movement":""},
        {"shk":"99999999999","nm":"2003","name":"Товар И","price":65,"status":"","mx":"","movement":""}
    ]}'::jsonb
    where id = v_task_id;

    insert into test_results values ('B_diverged_item_survives',
        (select task_type from public.wms_task_items where task_id = v_task_id and shk = '88888888888'),
        'Чистые списания');
    insert into test_results values ('B_sibling_snapshot_updated',
        (select price::text from public.wms_task_items where task_id = v_task_id and shk = '99999999999'),
        '65');
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_phase2_task2.sql
supabase db query --linked --file /tmp/test_phase2_task2.sql
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
cat << 'SQLEOF' > /tmp/verify_phase2_task2.sql
select prosrc ilike '%on conflict%' as has_upsert
from pg_proc where proname = 'wms_sync_task_items';
SQLEOF
supabase db query --linked --file /tmp/verify_phase2_task2.sql
```

Expected: `has_upsert = true`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610100002_wms_sync_task_items_upsert.sql
git commit -m "$(cat <<'EOF'
Переписываем триггер синхронизации на upsert (Фаза 2, шаг 2/6)

Зона/вердикт больше не затираются при несвязанном изменении родителя --
только product-снэпшот (name/price/nm/status/mx/movement/raw) обновляется
на conflict, zone-поля трогаются только при первой вставке строки.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 3: Rewrite `wms_pure_losses_absorb_shks` — zone on item, no new row for shared tara

**Files:**
- Create: `supabase/migrations/202610100003_pure_losses_absorb_shks_item_zone.sql`

**Interfaces:**
- Consumes: `wms_task_items` zone columns (Task 1), upsert trigger (Task 2).
- Produces: `public.wms_pure_losses_absorb_shks(p_rows jsonb, p_actor_id text, p_actor_name text)` — same signature as before, callers (`pure_losses.js`, `tasks.js`'s shift-opening absorb call) need no changes. Returned `action` values change from `repurposed`/`extracted_new_row`/`created_new` to `zoned_in_place`/`created_new` — if any JS reads `.action` from the result to brand a toast message, check `pure_losses.js`/`tasks.js` for `.action ===` string matches before this task's Step 5 commit and update them to match (see Step 2.5 below).

- [ ] **Step 1: Write the migration file**

```sql
-- Фаза 2 (docs/superpowers/specs/2026-10-09-wms-task-items-phase2-zone-design.md,
-- раздел 3): состав тары больше не меняется. Зона/вердикт пишутся только
-- на строку конкретного ШК в wms_task_items. 2 ветки вместо 3 -- больше
-- нет split_from_task_id, нет пересчёта priority/price_sum родителя.
create or replace function public.wms_pure_losses_absorb_shks(
    p_rows jsonb,
    p_actor_id text default null,
    p_actor_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_zone constant text := 'Чистые списания';
    v_row jsonb;
    v_shk text;
    v_nm text;
    v_name text;
    v_price numeric;
    v_lr integer;
    v_date_lost timestamptz;
    v_task_id uuid;
    v_results jsonb := '[]'::jsonb;
begin
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        return v_results;
    end if;

    for v_row in select * from jsonb_array_elements(p_rows) loop
        v_shk := nullif(trim(v_row->>'shk'), '');
        if v_shk is null then
            continue;
        end if;
        v_nm := nullif(trim(v_row->>'nm'), '');
        v_name := coalesce(nullif(trim(v_row->>'name'), ''), 'Без наименования');
        v_price := coalesce((v_row->>'price')::numeric, 0);
        v_lr := nullif(v_row->>'lr', '')::integer;
        v_date_lost := coalesce(public.wms_safe_timestamptz(v_row->>'date_lost'), now());

        if exists (select 1 from public.wms_task_items where shk = v_shk and task_type = v_zone) then
            continue;
        end if;

        select id into v_task_id
        from public.wms_tasks
        where is_deleted = false and source_shk_ids @> array[v_shk]
        order by created_at asc
        limit 1;

        if v_task_id is null then
            insert into public.wms_tasks (
                source_module, source_table, source_id, source_payload,
                source_generated_at, source_shk_ids, source_price_sum,
                search_text, task_type, title, task_status, opp_verdict,
                responsibility_zone, tags, last_seen_at
            ) values (
                'pure_losses', 'manual_absorb',
                'pure_losses:' || v_shk || ':' || to_char(v_date_lost at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                jsonb_build_object(
                    'item_name', v_name,
                    'task_items', jsonb_build_array(jsonb_build_object(
                        'shk', v_shk, 'nm', v_nm, 'name', v_name, 'price', v_price,
                        'status', '', 'movement', '', 'mx', ''
                    ))
                ),
                v_date_lost, array[v_shk], v_price,
                concat_ws(' ', v_zone, v_shk, v_nm, v_name), v_zone, 'ШК ' || v_shk, 'Не начато', 'Не выбран',
                'Нет привязки', '[]'::jsonb, now()
            )
            returning id into v_task_id;
        end if;

        update public.wms_task_items
        set task_type = v_zone,
            opp_verdict = 'Не выбран',
            task_status = 'Не начато',
            completed_at = null,
            reopen_after = null,
            zone_payload = jsonb_build_object(
                'pure_losses_lr', v_lr,
                'pure_losses_date_lost', to_char(v_date_lost at time zone 'utc', 'YYYY-MM-DD')
            ),
            name = v_name,
            nm = coalesce(v_nm, nm),
            price = v_price,
            updated_at = now()
        where task_id = v_task_id and shk = v_shk;

        insert into public.wms_task_history (task_id, event_type, actor_employee_id, actor_name, payload, created_at)
        values (v_task_id, 'task_moved_to_pure_losses', p_actor_id, p_actor_name,
                jsonb_build_object('shk', v_shk, 'date_lost', v_date_lost, 'lr', v_lr), v_date_lost);

        v_results := v_results || jsonb_build_object('shk', v_shk, 'task_id', v_task_id, 'action', 'zoned_in_place');
    end loop;

    return v_results;
end;
$$;
```

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610100003_pure_losses_absorb_shks_item_zone.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

-- Test A: shk is the ONLY item in its task -- zones in place, no new row,
-- parent's own task_type is untouched (stays whatever it was)
do $$
declare
    v_parent_id uuid;
    v_result jsonb;
    v_task_count_before integer;
    v_task_count_after integer;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload, source_shk_ids)
    values ('test_phase2', 'solo-' || gen_random_uuid(), 'Предсортировка', 'Соло задача', 'Не выбран', 'Не начато',
        '{"task_items":[{"shk":"11122233344","nm":"3001","name":"Соло товар","price":30,"status":"","mx":"","movement":""}]}'::jsonb,
        array['11122233344'])
    returning id into v_parent_id;

    select count(*) into v_task_count_before from public.wms_tasks;

    select public.wms_pure_losses_absorb_shks(
        jsonb_build_array(jsonb_build_object('shk','11122233344','nm','3001','name','Соло товар','price',30,'lr',32,'date_lost','2026-10-01')),
        'test_actor', 'Test Actor'
    ) into v_result;

    select count(*) into v_task_count_after from public.wms_tasks;

    insert into test_results values ('A_no_new_task_row', (v_task_count_after - v_task_count_before)::text, '0');
    insert into test_results values ('A_item_zoned', (select task_type from public.wms_task_items where task_id = v_parent_id and shk = '11122233344'), 'Чистые списания');
    insert into test_results values ('A_parent_task_type_unchanged', (select task_type from public.wms_tasks where id = v_parent_id), 'Предсортировка');
    insert into test_results values ('A_action_reported', v_result->0->>'action', 'zoned_in_place');
end $$;

-- Test B: shk is ONE of several in a shared tara -- only its own row
-- zones, sibling item AND the parent row are completely untouched
do $$
declare
    v_parent_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload, source_shk_ids, source_price_sum)
    values ('test_phase2', 'shared-' || gen_random_uuid(), 'Предсортировка', 'Общая тара', 'Не выбран', 'Не начато',
        '{"task_items":[
            {"shk":"22233344455","nm":"3002","name":"Товар К","price":40,"status":"","mx":"","movement":""},
            {"shk":"33344455566","nm":"3003","name":"Товар Л","price":45,"status":"","mx":"","movement":""}
        ]}'::jsonb,
        array['22233344455','33344455566'], 85)
    returning id into v_parent_id;

    perform public.wms_pure_losses_absorb_shks(
        jsonb_build_array(jsonb_build_object('shk','22233344455','nm','3002','name','Товар К','price',40,'lr',26,'date_lost','2026-10-02')),
        'test_actor', 'Test Actor'
    );

    insert into test_results values ('B_zoned_item', (select task_type from public.wms_task_items where task_id = v_parent_id and shk = '22233344455'), 'Чистые списания');
    insert into test_results values ('B_sibling_untouched', (select task_type from public.wms_task_items where task_id = v_parent_id and shk = '33344455566'), 'Предсортировка');
    insert into test_results values ('B_parent_shk_ids_unchanged', (select array_length(source_shk_ids,1)::text from public.wms_tasks where id = v_parent_id), '2');
    insert into test_results values ('B_parent_price_unchanged', (select source_price_sum::text from public.wms_tasks where id = v_parent_id), '85');
end $$;

-- Test C: shk not found anywhere -- orphan, creates a new task (same as before)
do $$
declare
    v_result jsonb;
begin
    select public.wms_pure_losses_absorb_shks(
        jsonb_build_array(jsonb_build_object('shk','44455566677','nm','3004','name','Орфан товар','price',20,'lr',11,'date_lost','2026-10-03')),
        'test_actor', 'Test Actor'
    ) into v_result;

    insert into test_results values ('C_orphan_action', v_result->0->>'action', 'created_new');
    insert into test_results values ('C_orphan_item_zoned', (select task_type from public.wms_task_items where task_id = (v_result->0->>'task_id')::uuid and shk = '44455566677'), 'Чистые списания');
end $$;

-- Test D: idempotency -- same shk fed twice does nothing the second time
do $$
declare
    v_before_count integer;
    v_after_count integer;
begin
    select count(*) into v_before_count from public.wms_task_items where shk = '11122233344' and task_type = 'Чистые списания';
    perform public.wms_pure_losses_absorb_shks(
        jsonb_build_array(jsonb_build_object('shk','11122233344','nm','3001','name','Соло товар','price',30,'lr',32,'date_lost','2026-10-01')),
        'test_actor', 'Test Actor'
    );
    select count(*) into v_after_count from public.wms_task_items where shk = '11122233344' and task_type = 'Чистые списания';
    insert into test_results values ('D_idempotent', (v_after_count = v_before_count)::text, 'true');
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_phase2_task3.sql
supabase db query --linked --file /tmp/test_phase2_task3.sql
```

Expected: 9 rows, all `pass: true`.

- [ ] **Step 2.5: Check for `.action` string matches in JS before committing**

```bash
grep -n "\.action\b" pure_losses.js tasks.js | grep -i "repurposed\|extracted_new_row\|created_new\|zoned_in_place"
```

If this prints any lines matching the OLD action strings (`repurposed`, `extracted_new_row`), update them to check for `zoned_in_place` instead (the new RPC never returns `repurposed`/`extracted_new_row` — only `zoned_in_place`/`created_new`). If nothing prints, the result's `action` field is not branched on anywhere and no JS change is needed here.

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
cat << 'SQLEOF' > /tmp/verify_phase2_task3.sql
select prosrc ilike '%split_from_task_id%' as still_has_old_costyl
from pg_proc where proname = 'wms_pure_losses_absorb_shks';
SQLEOF
supabase db query --linked --file /tmp/verify_phase2_task3.sql
```

Expected: `still_has_old_costyl = false`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610100003_pure_losses_absorb_shks_item_zone.sql
# if Step 2.5 required JS changes, also: git add pure_losses.js tasks.js
git commit -m "$(cat <<'EOF'
Переписываем wms_pure_losses_absorb_shks: зона на ШК, без split_from_task_id (Фаза 2, шаг 3/6)

2 ветки вместо 3. Тара из нескольких ШК больше не создаёт новую строку
wms_tasks для одного отделённого товара -- зона/вердикт пишутся прямо на
его строку wms_task_items, состав тары не меняется.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 4: `save_wms_manual_upload` — per-item reverse-transition

**Files:**
- Modify: `supabase/migrations` — create a new migration (NOT edit an old one; this function has an existing `create or replace`, this task adds another on top).
- Create: `supabase/migrations/202610100004_save_upload_per_item_return_from_zone.sql`

**Interfaces:**
- Consumes: `wms_task_items` zone columns (Task 1).
- Produces: `public.save_wms_manual_upload(p_tasks jsonb, p_run jsonb)` — same signature, same existing behavior for every branch except the new addition below.

- [ ] **Step 1: Write the migration file**

This is a full `create or replace function` of `save_wms_manual_upload` — copy its CURRENT complete body from `supabase/migrations/202610050002_save_upload_returns_from_pure_losses.sql` (the latest version) and insert exactly one new block. Read that file first:

```bash
cat /Users/WBwork/Downloads/WMSplus-main/supabase/migrations/202610050002_save_upload_returns_from_pure_losses.sql
```

Copy its entire `create or replace function public.save_wms_manual_upload(...)` body into the new migration file verbatim, with ONE insertion: immediately after this existing block —

```sql
    select id, task_type into v_canonical_id, v_canonical_task_type
    from public.wms_tasks
    where is_deleted = false
      and source_shk_ids && v_source_shk_ids
      and not (source_module = v_source_module and task_type = v_task_type)
    order by created_at asc
    limit 1;
```

— and BEFORE this existing line —

```sql
    if v_canonical_id is not null and v_canonical_task_type = 'Чистые списания' then
```

— insert the new per-item reset block:

```sql
    -- Фаза 2 (docs/superpowers/specs/2026-10-09-wms-task-items-phase2-zone-design.md,
    -- раздел 4): разошедшиеся ШК (зона на wms_task_items, а не на всей
    -- строке родителя) тоже должны уметь выехать из зоны при появлении в
    -- ДРУГОЙ выгрузке. Независимо от того, какая из двух веток ниже
    -- сработает (или ни одна -- если v_canonical_id вообще null, это
    -- обновление безопасно затронет 0 строк).
    update public.wms_task_items
    set task_type = v_task_type,
        opp_verdict = v_opp_verdict,
        task_status = v_task_status,
        completed_at = null,
        reopen_after = null,
        zone_payload = '{}'::jsonb,
        updated_at = timezone('utc', now())
    where task_id = v_canonical_id
      and shk = any(v_source_shk_ids)
      and task_type = 'Чистые списания';

    if found then
        insert into public.wms_task_history (task_id, event_type, actor_name, actor_employee_id, payload)
        select v_canonical_id, 'task_item_returned_from_pure_losses', 'Система', '',
               jsonb_build_object('shk', shk, 'new_module', v_source_module, 'new_task_type', v_task_type)
        from public.wms_task_items
        where task_id = v_canonical_id and shk = any(v_source_shk_ids);
    end if;

```

Everything else in the function (the exact-match branch at the top, both existing `if v_canonical_id is not null ...` branches, the brand-new-insert branch, the `wms_manual_upload_runs` upsert, the final `return`) stays byte-for-byte identical to `202610050002_save_upload_returns_from_pure_losses.sql`. Do not add this new block inside the exact-match branch (the one keyed on `source_module = v_source_module and source_id = v_source_id and task_type = v_task_type`, which `continue`s before `v_canonical_id` is even computed) — a same-source re-upload must NOT release a zoned item (see spec section 4, "Важно про exact-match ветку").

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610100004_save_upload_per_item_return_from_zone.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

-- Setup: a shared-tara task with one item already zoned (simulating
-- Task 3's output), plus an untouched sibling.
do $$
declare
    v_parent_id uuid;
    v_upload_result jsonb;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload, source_shk_ids)
    values ('awh', 'return-test-' || gen_random_uuid(), 'АВХ', 'Тара для возврата', 'Не выбран', 'Не начато',
        '{"task_items":[
            {"shk":"55566677788","nm":"4001","name":"Товар М","price":70,"status":"","mx":"","movement":""},
            {"shk":"66677788899","nm":"4002","name":"Товар Н","price":80,"status":"","mx":"","movement":""}
        ]}'::jsonb,
        array['55566677788','66677788899'])
    returning id into v_parent_id;

    update public.wms_task_items set task_type = 'Чистые списания', opp_verdict = 'Не выбран', task_status = 'Не начато'
    where task_id = v_parent_id and shk = '55566677788';

    -- Upload under a DIFFERENT module/task_type containing BOTH shks --
    -- simulates the zoned item reappearing in a regular AVH re-scan.
    select public.save_wms_manual_upload(
        jsonb_build_array(jsonb_build_object(
            'source_module', 'awh_rescan',
            'source_id', 'rescan-' || v_parent_id,
            'task_type', 'АВХ',
            'title', 'Повторное сканирование',
            'source_shk_ids', jsonb_build_array('55566677788', '66677788899'),
            'source_payload', '{}'::jsonb
        ))
    ) into v_upload_result;

    insert into test_results values ('zoned_item_released',
        (select task_type from public.wms_task_items where task_id = v_parent_id and shk = '55566677788'), 'АВХ');
    insert into test_results values ('sibling_already_non_zoned_unaffected',
        (select task_type from public.wms_task_items where task_id = v_parent_id and shk = '66677788899'), 'АВХ');
    insert into test_results values ('parent_row_composition_unchanged',
        (select array_length(source_shk_ids,1)::text from public.wms_tasks where id = v_parent_id), '2');
end $$;

-- Exact-match re-upload (SAME source_module/source_id/task_type) must
-- NOT release a zoned item.
do $$
declare
    v_parent_id uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, opp_verdict, task_status, source_payload, source_shk_ids)
    values ('awh', 'exact-match-test', 'АВХ', 'Тара без изменений', 'Не выбран', 'Не начато',
        '{"task_items":[{"shk":"77788899900","nm":"4003","name":"Товар О","price":90,"status":"","mx":"","movement":""}]}'::jsonb,
        array['77788899900'])
    returning id into v_parent_id;

    update public.wms_task_items set task_type = 'Чистые списания', opp_verdict = 'Не выбран', task_status = 'Не начато'
    where task_id = v_parent_id and shk = '77788899900';

    perform public.save_wms_manual_upload(
        jsonb_build_array(jsonb_build_object(
            'source_module', 'awh',
            'source_id', 'exact-match-test',
            'task_type', 'АВХ',
            'title', 'Тара без изменений',
            'source_shk_ids', jsonb_build_array('77788899900'),
            'source_payload', '{}'::jsonb
        ))
    );

    insert into test_results values ('exact_match_does_not_release',
        (select task_type from public.wms_task_items where task_id = v_parent_id and shk = '77788899900'), 'Чистые списания');
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_phase2_task4.sql
supabase db query --linked --file /tmp/test_phase2_task4.sql
```

Expected: 4 rows, all `pass: true`.

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
cat << 'SQLEOF' > /tmp/verify_phase2_task4.sql
select prosrc ilike '%task_item_returned_from_pure_losses%' as has_new_branch
from pg_proc where proname = 'save_wms_manual_upload';
SQLEOF
supabase db query --linked --file /tmp/verify_phase2_task4.sql
```

Expected: `has_new_branch = true`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610100004_save_upload_per_item_return_from_zone.sql
git commit -m "$(cat <<'EOF'
save_wms_manual_upload: возврат из зоны на уровне ШК (Фаза 2, шаг 4/6)

Разошедшийся ШК (зона на его собственной строке wms_task_items, не на
всей строке родителя) теперь тоже корректно выезжает из "Чистых
списаний" при появлении в другой выгрузке -- без этого шага двусторонняя
миграция тихо ломалась бы для общих тар. Повторная выгрузка под тем же
источником (exact-match) по-прежнему зону не снимает.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 5: JS — «Чистые списания» tab reads `wms_task_items` directly

**Files:**
- Modify: `tasks.js` (`loadPureLossesRows`, `pureLossesRowLr`, `pureLossesRowMonthKey`, `renderPureLossesTable` — approximate current line numbers 11474-11726; use these to locate, but match by function name/content with the Edit tool, not by line number, since earlier tasks in this plan don't touch `tasks.js` and this task doesn't touch lines before ~6038, so numbers should still be close).
- Modify: `tasks.js` near line 37 (next to `const WMS_MATCH_SUGGESTIONS_TABLE = "wms_match_suggestions";`) to add a new table constant.

**Interfaces:**
- Consumes: `wms_task_items` columns from Task 1 (`task_type, opp_verdict, task_status, zone_payload, shk, nm, name, price, task_id`), with `select` grant.
- Produces: `state.pureLosses.rows` is now an array of `wms_task_items` rows (shape: `{id, task_id, shk, nm, name, price, task_type, opp_verdict, task_status, zone_payload}`), not `wms_tasks` rows. Task 6 depends on `renderPureLossesTable`'s click handler emitting composite ids in the `"<task_id>::<shk>"` format.

- [ ] **Step 1: Add the table constant**

Find this line in `tasks.js` (near the top, with the other `*_TABLE` constants):

```js
    const WMS_MATCH_SUGGESTIONS_TABLE = "wms_match_suggestions";
```

Add immediately after it:

```js
    const WMS_TASK_ITEMS_TABLE = "wms_task_items";
```

- [ ] **Step 2: Replace `loadPureLossesRows`**

Find the current function (starts with the comment block `// Вкладка "Чистые списания" теперь смотрит на зону внутри wms_tasks...`) and replace the whole function body:

```js
    async function loadPureLossesRows() {
        if (state.pureLosses.loadPromise) return state.pureLosses.loadPromise;
        state.pureLosses.loadPromise = (async () => {
            state.pureLosses.loading = true;
            renderPureLosses();
            try {
                const db = supabaseDb();
                const { data, error } = await db
                    .from(WMS_TASK_ITEMS_TABLE)
                    .select("id,task_id,shk,nm,name,price,task_type,opp_verdict,task_status,zone_payload")
                    .eq("task_type", "Чистые списания")
                    .neq("task_status", "Завершено");
                if (error) throw error;
                state.pureLosses.rows = data || [];
                state.pureLosses.loaded = true;
            } catch (error) {
                console.error("pure losses load failed:", error);
                state.pureLosses.rows = [];
                toast("Не удалось загрузить чистые списания: " + (error && error.message ? error.message : String(error)), "error");
            } finally {
                state.pureLosses.loading = false;
                state.pureLosses.loadPromise = null;
                animateReviewShellHeightChange(() => renderPureLosses());
            }
        })();
        return state.pureLosses.loadPromise;
    }
```

- [ ] **Step 3: Replace `pureLossesRowLr` and `pureLossesRowMonthKey`**

```js
    function pureLossesRowLr(row) {
        const value = Number(row && row.zone_payload && row.zone_payload.pure_losses_lr);
        return Number.isFinite(value) ? value : null;
    }
```

```js
    function pureLossesRowMonthKey(row) {
        const date = normalizeText(row && row.zone_payload && row.zone_payload.pure_losses_date_lost);
        return date ? date.slice(0, 7) : "";
    }
```

- [ ] **Step 4: Replace `renderPureLossesTable`'s body builder and click handler**

Keep the function's existing early-return guards (`sectionExpanded`/`loading`/`loaded` checks) and the `grouped`/`lr`/`rows` lookup lines unchanged. Replace only the `const body = rows.map(...)` block through the end of the function:

```js
        const body = rows.map((row) => {
            const name = normalizeText(row.name) || "Наименование не найдено";
            const nm = normalizeIdentifier(row.nm);
            const dateLabel = formatRuDate(normalizeText(row.zone_payload && row.zone_payload.pure_losses_date_lost));
            const compositeId = row.task_id + "::" + row.shk;
            return "<tr class='review-data-row' data-pure-losses-task='" + escapeHtml(compositeId) + "'>"
                + "<td class='review-wrap-cell'><div class='review-task-title'>" + escapeHtml(name) + "</div>" + (nm ? "<div class='review-task-sub'>НМ: " + escapeHtml(nm) + "</div>" : "") + "</td>"
                + "<td>" + escapeHtml(row.shk || "-") + "</td>"
                + "<td>" + escapeHtml(dateLabel) + "</td>"
                + "<td class='review-price-cell' style='" + priceStyle(row.price) + "'>" + escapeHtml(formatMoney(row.price)) + "</td>"
                + "</tr>";
        }).join("");
        target.innerHTML = "<div class='review-table-scroll'><table class='review-data-table'><thead><tr><th>Наименование</th><th>ШК</th><th>Дата списания</th><th>Стоимость</th></tr></thead><tbody>" + body + "</tbody></table></div>";
        target.querySelectorAll("[data-pure-losses-task]").forEach((tr) => {
            tr.addEventListener("click", () => openTaskDetail(tr.dataset.pureLossesTask, "review"));
        });
```

Note the price sort line just above (`rows = (grouped.get(lr) || []).slice().sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));`) already reads `row.price` directly — this already matches the new `wms_task_items` row shape (it read `row.price` before too, which on a `wms_tasks` row was `undefined`/coincidentally-absent; no change needed there, it now resolves correctly for the new row shape).

- [ ] **Step 5: Run `node --check`**

```bash
node --check /Users/WBwork/Downloads/WMSplus-main/tasks.js
```

Expected: no output (success).

- [ ] **Step 6: Commit and push**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
git add tasks.js
git commit -m "$(cat <<'EOF'
Вкладка "Чистые списания": прямой запрос к wms_task_items (Фаза 2, шаг 5/6)

Гранулярность задачи была неверна для разошедшейся тары -- строка задачи
могла содержать и зонированные, и обычные ШК одновременно.
loadPureLossesRows/renderPureLossesTable переходят на гранулярность ШК,
клик по строке теперь открывает составной id "<task_id>::<shk>" (см.
следующий коммит).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

**Note:** after this task alone (before Task 6), clicking a row in the tab passes a composite id into `openTaskDetail`, which does not yet understand that format — it will silently fail to find a row (`findTaskRow` won't match the composite id) and `openTaskDetail` returns early without opening anything. This is an expected, temporary intermediate state; Task 6 completes the wiring. If you need to pause between Task 5 and Task 6, say so — don't leave this half-done state deployed without flagging it.

---

### Task 6: JS — composite-id task-detail (`openPureLossesItemDetail` / `completePureLossesItemFromDetail`)

**Files:**
- Modify: `tasks.js` — `findTaskRow` (~line 7621), `openTaskDetail` (~line 7655), `completeTaskFromDetail` (~line 10967). Add two new functions near them.

**Interfaces:**
- Consumes: composite id format `"<task_id>::<shk>"` produced by Task 5's `renderPureLossesTable`; `WMS_TASK_ITEMS_TABLE` constant from Task 5; `wms_task_items` `update` grant from Task 1.
- Produces: `parseCompositeTaskItemId(id)`, `openPureLossesItemDetail(taskId, shk, compositeId)`, `completePureLossesItemFromDetail(id, options)` — new functions other code does not yet call elsewhere (only `openTaskDetail`/`completeTaskFromDetail` call them, added in this task).

- [ ] **Step 1: Add `parseCompositeTaskItemId` and `openPureLossesItemDetail`**

Add these two new functions directly above `findTaskRow` (search for `function findTaskRow(id) {`):

```js
    function parseCompositeTaskItemId(id) {
        const raw = normalizeText(id);
        const sep = raw.indexOf("::");
        if (sep < 0) return null;
        return { taskId: raw.slice(0, sep), shk: raw.slice(sep + 2) };
    }

    async function openPureLossesItemDetail(taskId, shk, compositeId) {
        const db = supabaseDb();
        if (!db) return;
        let parentRow = findTaskRow(taskId);
        if (!parentRow) {
            const { data } = await db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).eq("id", taskId).maybeSingle();
            parentRow = data;
        }
        const { data: item, error } = await db
            .from(WMS_TASK_ITEMS_TABLE)
            .select("task_id,shk,nm,name,price,task_type,opp_verdict,task_status,zone_payload,completed_at,reopen_after")
            .eq("task_id", taskId).eq("shk", shk).maybeSingle();
        if (error || !item || !parentRow) return;
        const syntheticRow = {
            ...parentRow,
            id: compositeId,
            task_type: item.task_type,
            opp_verdict: item.opp_verdict,
            task_status: item.task_status,
            completed_at: item.completed_at,
            reopen_after: item.reopen_after,
            source_shk_ids: [item.shk],
            source_tare_id: null,
            source_price_sum: item.price,
            title: "ШК " + item.shk,
            source_payload: {
                ...taskPayload(parentRow),
                item_name: item.name,
                task_items: [{ shk: item.shk, nm: item.nm, name: item.name, price: item.price, status: "", movement: "", mx: "" }],
                pure_losses_lr: item.zone_payload && item.zone_payload.pure_losses_lr,
                pure_losses_date_lost: item.zone_payload && item.zone_payload.pure_losses_date_lost,
            },
            __syntheticParentId: taskId,
            __syntheticShk: item.shk,
        };
        if (state.taskDetail && state.taskDetail.countdownTimer) clearInterval(state.taskDetail.countdownTimer);
        state.taskDetail = { rowId: compositeId, source: "review", syntheticRow, editRowId: "", deferRowId: "", reopenRowId: "", splitRowId: "", splitShk: "", expensiveConfirmRowId: "", countdownTimer: null };
        setFlowModalOpen("taskDetailModal", true);
        renderTaskDetail(syntheticRow);
    }
```

- [ ] **Step 2: Update `findTaskRow`**

Find:

```js
    function findTaskRow(id) {
        return (state.review.rows || []).find((row) => row.id === id)
            || (state.inactive.rows || []).find((row) => row.id === id)
            || (state.taskSearch.rows || []).find((row) => row.id === id)
            || (state.noShkQueue.rows || []).find((row) => row.id === id)
            || null;
    }
```

Replace with:

```js
    function findTaskRow(id) {
        if (state.taskDetail && state.taskDetail.rowId === id && state.taskDetail.syntheticRow) {
            return state.taskDetail.syntheticRow;
        }
        return (state.review.rows || []).find((row) => row.id === id)
            || (state.inactive.rows || []).find((row) => row.id === id)
            || (state.taskSearch.rows || []).find((row) => row.id === id)
            || (state.noShkQueue.rows || []).find((row) => row.id === id)
            || null;
    }
```

- [ ] **Step 3: Update `openTaskDetail`**

Find the function signature:

```js
    async function openTaskDetail(id, source) {
        let row = findTaskRow(id);
        if (!row) return;
```

Replace just the signature line and the line right after it:

```js
    async function openTaskDetail(id, source) {
        const composite = parseCompositeTaskItemId(id);
        if (composite) return openPureLossesItemDetail(composite.taskId, composite.shk, id);
        let row = findTaskRow(id);
        if (!row) return;
```

Everything after that (the flow-lock check, embedded-mode reset, etc.) is unchanged — composite ids now return early before reaching it.

- [ ] **Step 4: Add `completePureLossesItemFromDetail` and update `completeTaskFromDetail`**

Find:

```js
    async function completeTaskFromDetail(id, options) {
        const opts = options || {};
```

Replace with:

```js
    async function completeTaskFromDetail(id, options) {
        if (state.taskDetail && state.taskDetail.rowId === id && state.taskDetail.syntheticRow) {
            return completePureLossesItemFromDetail(id, options);
        }
        const opts = options || {};
```

Then add this new function directly above `completeTaskFromDetail`:

```js
    async function completePureLossesItemFromDetail(id, options) {
        const synthetic = state.taskDetail.syntheticRow;
        const db = supabaseDb();
        if (!db) return;
        const user = currentWmsUser();
        const verdict = normalizeText($("taskVerdictInput") && $("taskVerdictInput").value) || "Не выбран";
        const rawComment = normalizeText($("taskCommentInput") && $("taskCommentInput").value);
        const extraLabel = DEFERRED_VERDICT_FIELDS[verdict] || "";
        const extraValue = normalizeText($("taskExtraInput") && $("taskExtraInput").value);
        const tone = VERDICT_TONE[verdict] || "";
        if ((tone === "red" && !rawComment) || verdict === "Не выбран" || (extraLabel && !extraValue)) {
            const status = $("taskDetailStatus");
            if (status) status.textContent = "Заполни вердикт и обязательное поле по выбранному вердикту.";
            return;
        }
        const now = new Date().toISOString();
        const isDeferred = Object.prototype.hasOwnProperty.call(DEFERRED_VERDICT_FIELDS, verdict);
        const reopenAfter = isDeferred ? reopenAfterForVerdict(verdict, synthetic, null) : null;
        const button = $("completeTaskBtn");
        if (button) button.disabled = true;
        try {
            const { error } = await db
                .from(WMS_TASK_ITEMS_TABLE)
                .update({
                    opp_verdict: verdict,
                    task_status: isDeferred ? "Отложено" : "Завершено",
                    completed_at: now,
                    reopen_after: reopenAfter,
                    updated_at: now,
                })
                .eq("task_id", synthetic.__syntheticParentId)
                .eq("shk", synthetic.__syntheticShk);
            if (error) throw error;
            void writeTaskHistory(
                { id: synthetic.__syntheticParentId },
                isDeferred ? "task_deferred" : "task_completed",
                {
                    title: displayTaskTitle(synthetic),
                    verdict,
                    comment: rawComment,
                    extra_label: extraLabel,
                    extra_value: extraValue,
                    completed_by_id: user.id || null,
                    completed_by_name: user.name || null,
                    reopen_after: reopenAfter,
                    shk: synthetic.__syntheticShk,
                }
            );
            state.pureLosses.rows = (state.pureLosses.rows || []).filter(
                (row) => !(row.task_id === synthetic.__syntheticParentId && row.shk === synthetic.__syntheticShk)
            );
            setReviewStatus(isDeferred ? "ШК отложен до " + formatRuDateTime(reopenAfter) + "." : "ШК завершён.", "good");
            renderPureLosses();
            closeTaskDetail();
        } catch (error) {
            console.error("pure losses item complete failed:", error);
            const status = $("taskDetailStatus");
            if (status) status.textContent = "Не удалось сохранить: " + (error && error.message ? error.message : String(error));
        } finally {
            if (button) button.disabled = false;
        }
    }
```

- [ ] **Step 5: Run `node --check`**

```bash
node --check /Users/WBwork/Downloads/WMSplus-main/tasks.js
```

Expected: no output (success).

- [ ] **Step 6: Commit and push**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
git add tasks.js
git commit -m "$(cat <<'EOF'
Item-scoped карточка для составного id (Фаза 2, шаг 6/6)

openPureLossesItemDetail/completePureLossesItemFromDetail -- вердикт
разошедшемуся ШК внутри общей тары пишется в его собственную строку
wms_task_items, соседи по таре не трогаются. "Отделить ШК"/"Редактировать
тару" не показываются для синтетической строки (source_tare_id: null
делает isTareTask(row) ложным) -- этого достаточно, отдельного скрытия
кода не требуется.

Закрывает Фазу 2 кандидата D целиком -- split_from_task_id больше нигде
не используется.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

**Live browser QA is not available this session** (auth guard requires a real Supabase session — see Global Constraints). Report this limitation explicitly when this task completes; do not claim the UI was visually verified.

---

## Self-Review

**Spec coverage:** every numbered section of the spec maps onto a task —
section 1 (schema) → Task 1; section 2 (trigger) → Task 2; section 3
(forward RPC) → Task 3; section 4 (reverse-transition) → Task 4; section 5
(tab) → Task 5; section 6 (composite id / item-scoped detail) → Task 6. The
"Явно вне объёма" section's `source_tare_id: null` detail is reflected in
Task 6 Step 1's synthetic row. The spec's testing scenarios (upsert survives
unrelated update, solo vs shared-tara absorb, exact-match vs cross-module
reverse) each have a concrete test block in the matching task.

**Placeholder scan:** no TBD/TODO; every code step contains complete,
literal SQL or JS, copied from or directly matching the spec's own code
blocks.

**Type consistency:** `WMS_TASK_ITEMS_TABLE` (Task 5) is the one constant
Task 6 also consumes — same name, same string value, declared once. The
composite id format `"<task_id>::<shk>"` is produced in Task 5's
`renderPureLossesTable` and consumed by Task 6's `parseCompositeTaskItemId`
— same separator (`"::"`) on both sides. `zone_payload` field names
(`pure_losses_lr`/`pure_losses_date_lost`) match exactly between Task 3's
SQL writer and Task 5/6's JS readers.
