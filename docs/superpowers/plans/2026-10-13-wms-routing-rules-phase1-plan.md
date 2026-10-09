# Движок правил маршрутизации ШК — Фаза 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator configure, through a UI screen, which rules decide where an orphaned ШК (no active task) gets routed and grouped after a Superset status actualization — replacing the idea of hardcoding this per upload type with data the admin edits.

**Architecture:** 6 sequential tasks — 4 SQL migrations (schema for `tare_id`, the rules table, the grouping-key column+index, then the two engine functions together) followed by 2 JS tasks (hook the engine into the existing actualization flow, then a new admin modal mirroring the existing `wms_writeoff_terms` modal pattern). Each SQL task is tested live in a rolled-back transaction before being applied for real.

**Tech Stack:** PostgreSQL (Supabase) migrations, vanilla JS (`tasks.js`/`tasks.html`). No build step, no JS test framework — this session has no browser-based QA available (see Global Constraints).

**Spec:** `docs/superpowers/specs/2026-10-12-wms-routing-rules-phase1-design.md`

## Global Constraints

- The engine only processes ШК with `wms_shk.current_task_id is null` — already-active ШК are never touched by this phase (spec: "Границы Фазы 1").
- `save_wms_manual_upload` is not modified. `wms_pure_losses_absorb_shks` is not modified. Both keep working exactly as today, independently of this new engine.
- A rule's target zone must be one of the existing `REVIEW_SECTIONS` values (`tasks.js:428`) — the admin UI's target-zone field is a `<select>` populated from that array, not free text.
- A rule with an empty `conditions` array must never match anything (spec: "правило без условий никогда не матчится").
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
- Migration file naming: latest existing prefix as of this plan is `202610120004`. This plan uses `202610130001`-`202610130004`. Run `ls supabase/migrations | sort | tail -5` before creating each file to confirm no new collision appeared.
- JS verification is `node --check tasks.js` only. **Live browser QA is not available this session** (auth guard requires a real Supabase session, discovered during Candidate A). State this explicitly when Tasks 5/6 complete — do not claim browser-verified behavior.
- Commit each task separately, push to `origin/main` after each task's verification — matches this session's established direct-to-main workflow.
- **Admin UI scope note (deliberate simplification, not a bug):** the `wms_routing_rules.conditions` column is a JSON array supporting multiple ANDed conditions, but Task 6's admin form only edits **one condition per rule** (matches every example in the spec, which never needed more than one). The schema is not limited to this — extending the form to multiple conditions per rule is a straightforward future addition, not part of this plan.

---

### Task 1: `tare_id` as a persistent attribute on `wms_superset_cache`

**Files:**
- Create: `supabase/migrations/202610130001_superset_cache_last_tare.sql`
- Modify: `tasks.js` — `pushSupersetRowsToCache` (search for `const payloads = latest.map((row) => ({` around line 3592).

**Interfaces:**
- Produces: column `public.wms_superset_cache.last_tare` (text, nullable). Task 4's engine function reads this column directly (`sc.last_tare`).

- [ ] **Step 1: Write the migration file**

```sql
-- Фаза 1 движка правил маршрутизации
-- (docs/superpowers/specs/2026-10-12-wms-routing-rules-phase1-design.md):
-- last_tare уже парсится из Superset-файла (normalizeSupersetRow в
-- tasks.js), но нигде не сохранялся -- без него "группировать по таре"
-- физически не на чем работать.
alter table public.wms_superset_cache add column last_tare text;
```

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610130001_superset_cache_last_tare.sql
cat << 'SQLEOF'

select column_name from information_schema.columns
where table_schema='public' and table_name='wms_superset_cache' and column_name='last_tare';

rollback;
SQLEOF
} > /tmp/test_routing_task1.sql
supabase db query --linked --file /tmp/test_routing_task1.sql
```

Expected: one row, `column_name: last_tare`.

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
cat << 'SQLEOF' > /tmp/verify_routing_task1.sql
select column_name from information_schema.columns
where table_schema='public' and table_name='wms_superset_cache' and column_name='last_tare';
SQLEOF
supabase db query --linked --file /tmp/verify_routing_task1.sql
```

Expected: one row, `column_name: last_tare`.

- [ ] **Step 5: Update `pushSupersetRowsToCache` to persist `last_tare`**

Find in `tasks.js`:

```js
        const payloads = latest.map((row) => ({
            wh_id: WH_ID,
            shk: row.shk,
            nm: row.nm || null,
            name: row.name || null,
            last_office: row.last_office || null,
            last_status: row.last_status || null,
            last_status_at: row.last_status_at || null,
            last_status_ts: row.last_status_ts || null,
            price: row.price || null,
            updated_at: now,
        }));
```

Replace with:

```js
        const payloads = latest.map((row) => ({
            wh_id: WH_ID,
            shk: row.shk,
            nm: row.nm || null,
            name: row.name || null,
            last_office: row.last_office || null,
            last_status: row.last_status || null,
            last_status_at: row.last_status_at || null,
            last_status_ts: row.last_status_ts || null,
            last_tare: row.last_tare || null,
            price: row.price || null,
            updated_at: now,
        }));
```

- [ ] **Step 6: Run `node --check`**

```bash
node --check /Users/WBwork/Downloads/WMSplus-main/tasks.js
```

Expected: no output (success).

- [ ] **Step 7: Commit and push**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
git add supabase/migrations/202610130001_superset_cache_last_tare.sql tasks.js
git commit -m "$(cat <<'EOF'
tare_id как постоянный атрибут ШК (движок правил, шаг 1/6)

last_tare уже парсился из Superset-файла, но нигде не сохранялся --
добавляем колонку в wms_superset_cache и прокидываем в существующий push.
Фундамент под группировку по таре в движке правил.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 2: Таблица `wms_routing_rules`

**Files:**
- Create: `supabase/migrations/202610130002_wms_routing_rules.sql`

**Interfaces:**
- Produces: table `public.wms_routing_rules` (`id`, `priority` unique, `name`, `is_active`, `conditions` jsonb, `target_task_type`, `grouping_attribute`, `created_at`, `updated_at`), grants to `anon, authenticated`. Task 4's engine reads this table; Task 6's admin UI reads/writes it.

- [ ] **Step 1: Write the migration file**

```sql
-- Фаза 1 движка правил маршрутизации. Та же модель прав, что у
-- остальных настроечных таблиц (wms_writeoff_terms) -- без RLS.
create table public.wms_routing_rules (
    id uuid primary key default gen_random_uuid(),
    priority integer not null unique,
    name text not null,
    is_active boolean not null default true,
    conditions jsonb not null default '[]'::jsonb,
    target_task_type text not null,
    grouping_attribute text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.wms_routing_rules to anon, authenticated;
```

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610130002_wms_routing_rules.sql
cat << 'SQLEOF'

insert into public.wms_routing_rules (priority, name, conditions, target_task_type, grouping_attribute)
values (1, 'Тестовое правило', '[{"attribute":"status","operator":"in","value":["SAS"]}]'::jsonb, 'Коробки на входе', 'tare_id');

select name, target_task_type from public.wms_routing_rules where priority = 1;
select has_table_privilege('authenticated', 'public.wms_routing_rules', 'INSERT') as can_insert;

rollback;
SQLEOF
} > /tmp/test_routing_task2.sql
supabase db query --linked --file /tmp/test_routing_task2.sql
```

Expected: `can_insert = true` (the insert itself succeeding without error, visible via no exception thrown, confirms the table/grant works).

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
cat << 'SQLEOF' > /tmp/verify_routing_task2.sql
select count(*) from information_schema.tables where table_schema='public' and table_name='wms_routing_rules';
SQLEOF
supabase db query --linked --file /tmp/verify_routing_task2.sql
```

Expected: `1`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610130002_wms_routing_rules.sql
git commit -m "$(cat <<'EOF'
Таблица wms_routing_rules (движок правил, шаг 2/6)

Схема правил маршрутизации: приоритет, условия (jsonb), целевая зона,
атрибут группировки. Пока ничего её не читает/пишет -- только схема.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 3: Метка группы на `wms_tasks`

**Files:**
- Create: `supabase/migrations/202610130003_wms_tasks_routing_group_key.sql`

**Interfaces:**
- Produces: column `public.wms_tasks.routing_group_key` (text, nullable), unique index `wms_tasks_routing_group_active_unique`. Task 4's engine writes/reads this column.

- [ ] **Step 1: Write the migration file**

```sql
-- Когда движок создаёт новую задачу для группы (зона, значение tare_id),
-- он проставляет routing_group_key -- уникальный индекс не даст случайно
-- завести вторую активную задачу для той же пары (зона, тара).
alter table public.wms_tasks add column routing_group_key text;

create unique index wms_tasks_routing_group_active_unique
    on public.wms_tasks (task_type, routing_group_key)
    where is_deleted = false and task_status <> 'Завершено' and routing_group_key is not null;
```

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610130003_wms_tasks_routing_group_key.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

do $$
declare
    v_error_caught boolean := false;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, routing_group_key)
    values ('test_routing', 'group-a-' || gen_random_uuid(), 'Коробки на входе', 'Группа А', 'TARE123');

    begin
        insert into public.wms_tasks (source_module, source_id, task_type, title, routing_group_key)
        values ('test_routing', 'group-b-' || gen_random_uuid(), 'Коробки на входе', 'Группа Б', 'TARE123');
    exception when unique_violation then
        v_error_caught := true;
    end;

    insert into test_results values ('duplicate_group_rejected', v_error_caught::text, 'true');
end $$;

-- A different zone with the SAME routing_group_key must be allowed --
-- the constraint is per (task_type, routing_group_key), not just key.
do $$
declare
    v_error_caught boolean := false;
begin
    begin
        insert into public.wms_tasks (source_module, source_id, task_type, title, routing_group_key)
        values ('test_routing', 'group-c-' || gen_random_uuid(), 'Предсортировка', 'Другая зона', 'TARE123');
    exception when unique_violation then
        v_error_caught := true;
    end;

    insert into test_results values ('same_key_different_zone_allowed', v_error_caught::text, 'false');
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_routing_task3.sql
supabase db query --linked --file /tmp/test_routing_task3.sql
```

Expected: 2 rows, both `pass: true`.

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
cat << 'SQLEOF' > /tmp/verify_routing_task3.sql
select indexname from pg_indexes where tablename = 'wms_tasks' and indexname = 'wms_tasks_routing_group_active_unique';
SQLEOF
supabase db query --linked --file /tmp/verify_routing_task3.sql
```

Expected: one row, `indexname: wms_tasks_routing_group_active_unique`.

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610130003_wms_tasks_routing_group_key.sql
git commit -m "$(cat <<'EOF'
Метка группы на wms_tasks (движок правил, шаг 3/6)

routing_group_key + уникальный индекс (task_type, routing_group_key) для
активных незавершённых задач -- не даёт завести вторую активную задачу
для той же пары зона+тара.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 4: Движок — `wms_routing_rule_matches` + `wms_apply_routing_rules`

**Files:**
- Create: `supabase/migrations/202610130004_wms_apply_routing_rules.sql`

**Interfaces:**
- Consumes: `wms_superset_cache.last_tare` (Task 1), `wms_routing_rules` (Task 2), `wms_tasks.routing_group_key` (Task 3), `wms_shk.current_task_id` (уже существует с кандидата "реестр ШК").
- Produces: `public.wms_routing_rule_matches(p_conditions jsonb, p_status text, p_tare_id text) returns boolean`; `public.wms_apply_routing_rules(p_shks text[]) returns jsonb`. Task 5 (JS) calls `wms_apply_routing_rules` via RPC.

- [ ] **Step 1: Write the migration file**

```sql
create or replace function public.wms_routing_rule_matches(p_conditions jsonb, p_status text, p_tare_id text)
returns boolean
language plpgsql
immutable
as $$
declare
    v_cond jsonb;
    v_attr text;
    v_op text;
    v_value jsonb;
    v_actual text;
begin
    if p_conditions is null or jsonb_array_length(p_conditions) = 0 then
        return false;
    end if;
    for v_cond in select * from jsonb_array_elements(p_conditions) loop
        v_attr := v_cond->>'attribute';
        v_op := v_cond->>'operator';
        v_value := v_cond->'value';
        v_actual := case v_attr when 'status' then p_status when 'tare_id' then p_tare_id else null end;
        if v_op = 'in' then
            if v_actual is null or not (v_value ? v_actual) then return false; end if;
        elsif v_op = 'eq' then
            if v_actual is distinct from (v_value#>>'{}') then return false; end if;
        else
            return false;
        end if;
    end loop;
    return true;
end;
$$;

create or replace function public.wms_apply_routing_rules(p_shks text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_shk text;
    v_rule record;
    v_status text;
    v_tare_id text;
    v_group_value text;
    v_task_id uuid;
    v_results jsonb := '[]'::jsonb;
begin
    if p_shks is null or array_length(p_shks, 1) is null then
        return v_results;
    end if;

    foreach v_shk in array p_shks loop
        if exists (select 1 from public.wms_shk where shk = v_shk and current_task_id is not null) then
            continue;
        end if;

        select sc.last_status, sc.last_tare into v_status, v_tare_id
        from public.wms_superset_cache sc
        where sc.wh_id = '50144199' and sc.shk = v_shk;

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

        if v_rule is null then
            continue;
        end if;

        v_group_value := case when v_rule.grouping_attribute = 'tare_id' then v_tare_id else null end;

        v_task_id := null;
        if v_group_value is not null then
            select id into v_task_id
            from public.wms_tasks
            where task_type = v_rule.target_task_type
              and routing_group_key = v_group_value
              and is_deleted = false and task_status <> 'Завершено'
            limit 1;
        end if;

        if v_task_id is null then
            insert into public.wms_tasks (
                source_module, source_table, source_id, source_payload,
                source_shk_ids, task_type, title, task_status, opp_verdict,
                responsibility_zone, tags, routing_group_key, last_seen_at
            ) values (
                'routing_engine', 'manual_absorb',
                'routing:' || v_rule.id || ':' || coalesce(v_group_value, v_shk) || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                jsonb_build_object(
                    'item_name', v_shk,
                    'task_items', jsonb_build_array(jsonb_build_object(
                        'shk', v_shk, 'nm', null, 'name', '', 'price', 0,
                        'status', coalesce(v_status, ''), 'movement', '', 'mx', ''
                    ))
                ),
                array[v_shk], v_rule.target_task_type, 'ШК ' || v_shk, 'Не начато', 'Не выбран',
                'Нет привязки', '[]'::jsonb, v_group_value, now()
            )
            returning id into v_task_id;
        else
            update public.wms_tasks
            set source_payload = jsonb_set(
                    source_payload, '{task_items}',
                    coalesce(source_payload->'task_items', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                        'shk', v_shk, 'nm', null, 'name', '', 'price', 0,
                        'status', coalesce(v_status, ''), 'movement', '', 'mx', ''
                    ))
                ),
                source_shk_ids = coalesce(source_shk_ids, '{}'::text[]) || array[v_shk],
                last_seen_at = now(),
                updated_at = now()
            where id = v_task_id;
        end if;

        insert into public.wms_task_history (task_id, event_type, payload)
        values (v_task_id, 'task_routed_by_rule', jsonb_build_object('shk', v_shk, 'rule_id', v_rule.id, 'rule_name', v_rule.name));

        v_results := v_results || jsonb_build_object('shk', v_shk, 'task_id', v_task_id, 'rule_id', v_rule.id);
    end loop;

    return v_results;
end;
$$;

grant execute on function public.wms_apply_routing_rules(text[]) to anon, authenticated;
```

- [ ] **Step 2: Test live in a rolled-back transaction**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
{
echo "begin;"
cat supabase/migrations/202610130004_wms_apply_routing_rules.sql
cat << 'SQLEOF'

create temp table test_results (test_name text primary key, actual text, expected text);

insert into public.wms_routing_rules (priority, name, conditions, target_task_type, grouping_attribute)
values (9001, 'Тест: SAS в одну тару', '[{"attribute":"status","operator":"in","value":["SAS"]}]'::jsonb, 'Коробки на входе', 'tare_id');

do $$
declare
    v_result jsonb;
    v_task_1 uuid;
    v_task_2 uuid;
begin
    insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
    values
        ('50144199', '81818181811', 'SAS: тест', 'TARE-X'),
        ('50144199', '82828282822', 'SAS: тест', 'TARE-X'),
        ('50144199', '83838383833', 'SAS: тест', 'TARE-Y')
    on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

    select public.wms_apply_routing_rules(array['81818181811','82828282822','83838383833']) into v_result;

    select current_task_id into v_task_1 from public.wms_shk where shk = '81818181811';
    select current_task_id into v_task_2 from public.wms_shk where shk = '82828282822';

    insert into test_results values ('same_tare_same_task', (v_task_1 = v_task_2)::text, 'true');
    insert into test_results values ('different_tare_different_task',
        ((select current_task_id from public.wms_shk where shk = '83838383833') <> v_task_1)::text, 'true');
    insert into test_results values ('task_has_routing_group_key',
        (select routing_group_key from public.wms_tasks where id = v_task_1), 'TARE-X');
end $$;

-- Already-active shk must be skipped entirely.
do $$
declare
    v_existing_task uuid;
    v_before uuid;
    v_after uuid;
begin
    insert into public.wms_tasks (source_module, source_id, task_type, title, source_shk_ids)
    values ('test_routing', 'existing-' || gen_random_uuid(), 'Предсортировка', 'Уже активна', array['84848484844'])
    returning id into v_existing_task;
    insert into public.wms_task_items (task_id, shk, task_status) values (v_existing_task, '84848484844', 'Не начато');

    insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
    values ('50144199', '84848484844', 'SAS: тест', 'TARE-Z')
    on conflict (wh_id, shk) do update set last_status = excluded.last_status, last_tare = excluded.last_tare;

    select current_task_id into v_before from public.wms_shk where shk = '84848484844';
    perform public.wms_apply_routing_rules(array['84848484844']);
    select current_task_id into v_after from public.wms_shk where shk = '84848484844';

    insert into test_results values ('active_shk_untouched', (v_before = v_after)::text, 'true');
end $$;

-- No matching rule -- shk stays orphaned, no task created.
do $$
declare
    v_result jsonb;
begin
    insert into public.wms_superset_cache (wh_id, shk, last_status, last_tare)
    values ('50144199', '85858585855', 'ZZZ: не матчится', null)
    on conflict (wh_id, shk) do update set last_status = excluded.last_status;

    select public.wms_apply_routing_rules(array['85858585855']) into v_result;

    insert into test_results values ('no_match_no_task', jsonb_array_length(v_result)::text, '0');
    insert into test_results values ('no_match_shk_stays_orphan',
        (select current_task_id from public.wms_shk where shk = '85858585855') is null, true);
end $$;

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
SQLEOF
} > /tmp/test_routing_task4.sql
supabase db query --linked --file /tmp/test_routing_task4.sql
```

Expected: 6 rows, all `pass: true`.

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
cat << 'SQLEOF' > /tmp/verify_routing_task4.sql
select proname from pg_proc where proname in ('wms_routing_rule_matches', 'wms_apply_routing_rules') order by proname;
SQLEOF
supabase db query --linked --file /tmp/verify_routing_task4.sql
```

Expected: 2 rows (both function names).

- [ ] **Step 5: Commit and push**

```bash
git add supabase/migrations/202610130004_wms_apply_routing_rules.sql
git commit -m "$(cat <<'EOF'
Движок правил маршрутизации (шаг 4/6)

wms_routing_rule_matches + wms_apply_routing_rules -- для осиротевших ШК
находит первое подходящее активное правило по приоритету, направляет в
целевую зону, группирует по tare_id если задано. Не трогает ШК с уже
активной задачей. Обобщает то, что wms_pure_losses_absorb_shks делает
жёстко для одной зоны -- без замены самого этого RPC.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

### Task 5: Вызов движка после актуализации Superset

**Files:**
- Modify: `tasks.js` — `handleActualizeSupersetFile` (search for `void pushSupersetRowsToCache(rows)` around line 3249).

**Interfaces:**
- Consumes: RPC `wms_apply_routing_rules` (Task 4).
- Produces: no new functions — extends the existing promise chain.

- [ ] **Step 1: Update the actualize chain**

Find:

```js
            void pushSupersetRowsToCache(rows).then(() => hydrateSupersetCache(rows.map((row) => row.shk))).then(() => renderReview()).catch((error) => console.warn("superset cache push skipped:", error));
```

Replace with:

```js
            void pushSupersetRowsToCache(rows)
                .then(() => hydrateSupersetCache(rows.map((row) => row.shk)))
                .then(() => db.rpc("wms_apply_routing_rules", { p_shks: rows.map((row) => row.shk) }))
                .then(() => loadReviewTasks())
                .then(() => renderReview())
                .catch((error) => console.warn("superset cache push skipped:", error));
```

`loadReviewTasks()` is added before the final `renderReview()` so any
new tasks the engine just created actually show up without requiring a
manual page refresh — `renderReview()` alone only redraws from
already-loaded state, it does not re-fetch.

- [ ] **Step 2: Run `node --check`**

```bash
node --check /Users/WBwork/Downloads/WMSplus-main/tasks.js
```

Expected: no output (success).

- [ ] **Step 3: Commit and push**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
git add tasks.js
git commit -m "$(cat <<'EOF'
Подключаем движок правил к актуализации Superset (шаг 5/6)

После push в кэш и его подтягивания -- вызываем wms_apply_routing_rules
для тех же ШК, затем перезагружаем список задач, чтобы новые задачи
сразу появились на экране.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

**Live browser QA is not available this session** — state this explicitly when reporting this task done.

---

### Task 6: Админка правил — модалка по образцу `wms_writeoff_terms`

**Files:**
- Modify: `tasks.html` — add a new action card (near `openWriteoffTerms`, `tasks.html:1966`) and a new modal section (near `writeoffTermsModal`, `tasks.html:2787`).
- Modify: `tasks.js` — add `state.routingRules`, `loadRoutingRules`, `routingRuleRowHtml`, `renderRoutingRulesModal`, `routingRuleInputRows`, `addRoutingRuleDraft`, `removeRoutingRuleRow`, `openRoutingRulesModal`, `closeRoutingRulesModal`, `saveRoutingRulesFromModal`; wire up event listeners (near the existing `openWriteoffTerms`/`closeWriteoffTerms` listeners, `tasks.js:18077` and `tasks.js:18125`).

**Interfaces:**
- Consumes: `wms_routing_rules` table (Task 2); `REVIEW_SECTIONS` array (`tasks.js:428`, already exists) for the target-zone dropdown options.
- Produces: no new interfaces other tasks depend on — this is the final, user-facing piece.

- [ ] **Step 1: Add the HTML action card**

In `tasks.html`, find:

```html
                <button id="openWriteoffTerms" class="tasks-action-card" type="button" data-dev-only>
                    <span class="tasks-action-icon">⌛</span>
                    <h2 class="tasks-action-title">Сроки списания</h2>
                    <p class="tasks-action-text">Статусы WMS, дни без движения до списания и отдельная настройка 26LR.</p>
                </button>
```

Add immediately after it:

```html
                <button id="openRoutingRules" class="tasks-action-card" type="button" data-dev-only>
                    <span class="tasks-action-icon">🧭</span>
                    <h2 class="tasks-action-title">Правила маршрутизации</h2>
                    <p class="tasks-action-text">Куда класть осиротевшие ШК по статусу/таре после актуализации Superset -- без правки кода.</p>
                </button>
```

- [ ] **Step 2: Add the HTML modal section**

Find the closing of `writeoffTermsModal`:

```html
<section id="writeoffTermsModal" class="tasks-flow-modal upload-work" aria-hidden="true">
    <div class="tasks-flow-card tasks-flow-card-wide">
        <div class="work-head">
            <div>
                <h3 class="work-title">Сроки списания</h3>
                <p class="work-subtitle">Эти значения используются при создании новых задач: дата списания = последнее движение + срок статуса.</p>
            </div>
            <button id="closeWriteoffTerms" class="btn btn-square" type="button" aria-label="Закрыть">×</button>
        </div>
        <div id="writeoffTermsWrap" class="writeoff-terms-wrap"></div>
        <div class="file-row">
            <button id="saveWriteoffTerms" class="btn btn-rect" type="button">Сохранить сроки</button>
            <button id="reloadWriteoffTerms" class="btn btn-outline" type="button">Обновить из Supabase</button>
            <button id="recalculateWriteoffDates" class="btn btn-outline" type="button">Пересчитать активные задачи</button>
            <button id="refreshWriteoffRecommendations" class="btn btn-outline" type="button">Рассчитать рекомендации</button>
            <button id="applyWriteoffRecommendations" class="btn btn-rect" type="button">Применить рекомендации</button>
        </div>
        <div id="writeoffTermsStatus" class="review-status"></div>
```

Immediately after that `</section>` for `writeoffTermsModal`, add a new, separate section:

```html
<section id="routingRulesModal" class="tasks-flow-modal upload-work" aria-hidden="true">
    <div class="tasks-flow-card tasks-flow-card-wide">
        <div class="work-head">
            <div>
                <h3 class="work-title">Правила маршрутизации</h3>
                <p class="work-subtitle">Осиротевшие ШК (без активной задачи) после актуализации Superset раскладываются по этим правилам -- по порядку приоритета, первое подходящее побеждает.</p>
            </div>
            <button id="closeRoutingRules" class="btn btn-square" type="button" aria-label="Закрыть">×</button>
        </div>
        <div id="routingRulesWrap" class="writeoff-terms-wrap"></div>
        <div class="file-row">
            <button id="addRoutingRule" class="btn btn-outline" type="button">Добавить правило</button>
            <button id="saveRoutingRules" class="btn btn-rect" type="button">Сохранить правила</button>
            <button id="reloadRoutingRules" class="btn btn-outline" type="button">Обновить из Supabase</button>
        </div>
        <div id="routingRulesStatus" class="review-status"></div>
    </div>
</section>
```

- [ ] **Step 3: Add state and data functions**

Find `state.writeoffTerms` in the `const state = {` block (`tasks.js`, search for `writeoffTerms: {`) and add a sibling entry right after that whole `writeoffTerms: { ... },` block:

```js
        routingRules: {
            rows: [],
            loading: false,
            saving: false,
            loaded: false,
            error: "",
        },
```

Add these functions near `loadWriteoffTerms`/`writeoffTermRowHtml` (e.g. directly above `async function loadWriteoffTerms(force) {` at `tasks.js:12173`):

```js
    async function loadRoutingRules(force) {
        if (state.routingRules.loaded && !force) return true;
        const db = supabaseDb();
        state.routingRules.loading = true;
        state.routingRules.error = "";
        renderRoutingRulesModal();
        if (!db) {
            state.routingRules.loading = false;
            state.routingRules.error = "Supabase SDK недоступен.";
            renderRoutingRulesModal();
            return false;
        }
        try {
            const { data, error } = await db
                .from("wms_routing_rules")
                .select("*")
                .order("priority", { ascending: true });
            if (error) throw error;
            state.routingRules.rows = data || [];
            state.routingRules.loaded = true;
            return true;
        } catch (error) {
            state.routingRules.rows = [];
            state.routingRules.error = "Не удалось загрузить правила: " + (error && error.message ? error.message : String(error));
            console.warn("routing rules load skipped:", error);
            return false;
        } finally {
            state.routingRules.loading = false;
            renderRoutingRulesModal();
        }
    }

    function routingRuleRowHtml(row) {
        const condition = (row.conditions && row.conditions[0]) || {};
        const attribute = condition.attribute || "status";
        const operator = condition.operator || "in";
        const valueText = Array.isArray(condition.value) ? condition.value.join(", ") : normalizeText(condition.value);
        const targetOptions = REVIEW_SECTIONS.map((section) =>
            "<option value='" + escapeHtml(section) + "'" + (row.target_task_type === section ? " selected" : "") + ">" + escapeHtml(section) + "</option>"
        ).join("");
        return "<div class='writeoff-term-row' data-routing-rule-row data-rule-id='" + escapeHtml(row.id || "") + "'>"
            + "<input data-rule-priority type='number' min='1' step='1' value='" + escapeHtml(row.priority || "") + "' placeholder='Приоритет'>"
            + "<input data-rule-name type='text' value='" + escapeHtml(row.name || "") + "' placeholder='Название'>"
            + "<select data-rule-attribute>"
            + "<option value='status'" + (attribute === "status" ? " selected" : "") + ">Статус</option>"
            + "<option value='tare_id'" + (attribute === "tare_id" ? " selected" : "") + ">Тара</option>"
            + "</select>"
            + "<select data-rule-operator>"
            + "<option value='in'" + (operator === "in" ? " selected" : "") + ">один из (через запятую)</option>"
            + "<option value='eq'" + (operator === "eq" ? " selected" : "") + ">равно</option>"
            + "</select>"
            + "<input data-rule-value type='text' value='" + escapeHtml(valueText) + "' placeholder='Значение(я)'>"
            + "<select data-rule-target>" + targetOptions + "</select>"
            + "<select data-rule-grouping>"
            + "<option value=''" + (!row.grouping_attribute ? " selected" : "") + ">Каждый ШК отдельно</option>"
            + "<option value='tare_id'" + (row.grouping_attribute === "tare_id" ? " selected" : "") + ">По таре</option>"
            + "</select>"
            + "<label class='writeoff-term-active'><input data-rule-active type='checkbox' " + (row.is_active === false ? "" : "checked") + "> активно</label>"
            + "<button type='button' class='btn btn-square' data-rule-remove aria-label='Удалить'>×</button>"
            + "</div>";
    }

    function renderRoutingRulesModal() {
        const target = $("routingRulesWrap");
        if (!target) return;
        const rows = state.routingRules.rows || [];
        target.innerHTML = (state.routingRules.error ? "<div class='status-line error'>" + escapeHtml(state.routingRules.error) + "</div>" : "")
            + (state.routingRules.loading ? "<div class='status-line'>Загружаю правила...</div>" : "")
            + "<div class='writeoff-term-head'><span>Приоритет</span><span>Название</span><span>Атрибут</span><span>Оператор</span><span>Значение</span><span>Зона</span><span>Группировка</span><span>Вкл.</span></div>"
            + "<div class='writeoff-term-list'>" + rows.map(routingRuleRowHtml).join("") + "</div>";
        target.querySelectorAll("[data-rule-remove]").forEach((button) => {
            button.addEventListener("click", () => removeRoutingRuleRow(button.closest("[data-routing-rule-row]")));
        });
    }

    async function removeRoutingRuleRow(rowEl) {
        if (!rowEl) return;
        const ruleId = rowEl.getAttribute("data-rule-id");
        if (ruleId) {
            const db = supabaseDb();
            if (db) {
                try {
                    const { error } = await db.from("wms_routing_rules").delete().eq("id", ruleId);
                    if (error) throw error;
                } catch (error) {
                    toast("Не удалось удалить правило: " + (error && error.message ? error.message : String(error)), "error");
                    return;
                }
            }
        }
        rowEl.remove();
    }

    function addRoutingRuleDraft() {
        const rows = state.routingRules.rows || [];
        const nextPriority = rows.reduce((max, row) => Math.max(max, Number(row.priority) || 0), 0) + 1;
        state.routingRules.rows = rows.concat({
            priority: nextPriority,
            name: "",
            is_active: true,
            conditions: [{ attribute: "status", operator: "in", value: [] }],
            target_task_type: REVIEW_SECTIONS[0],
            grouping_attribute: null,
        });
        renderRoutingRulesModal();
    }

    function routingRuleInputRows() {
        return Array.from(document.querySelectorAll("[data-routing-rule-row]")).map((row) => {
            const id = row.getAttribute("data-rule-id") || undefined;
            const priority = Math.max(1, Math.trunc(settingNumber(row.querySelector("[data-rule-priority]") && row.querySelector("[data-rule-priority]").value, 0)));
            const name = normalizeText(row.querySelector("[data-rule-name]") && row.querySelector("[data-rule-name]").value);
            const attribute = row.querySelector("[data-rule-attribute]").value;
            const operator = row.querySelector("[data-rule-operator]").value;
            const rawValue = normalizeText(row.querySelector("[data-rule-value]") && row.querySelector("[data-rule-value]").value);
            const value = operator === "in" ? rawValue.split(",").map((part) => part.trim()).filter(Boolean) : rawValue;
            const targetTaskType = row.querySelector("[data-rule-target]").value;
            const groupingAttribute = row.querySelector("[data-rule-grouping]").value || null;
            const isActive = row.querySelector("[data-rule-active]").checked;
            if (!name || !rawValue) return null;
            return {
                ...(id ? { id } : {}),
                priority,
                name,
                is_active: isActive,
                conditions: [{ attribute, operator, value }],
                target_task_type: targetTaskType,
                grouping_attribute: groupingAttribute,
                updated_at: new Date().toISOString(),
            };
        }).filter(Boolean);
    }

    async function openRoutingRulesModal() {
        if (!ensureDevelopmentAccess("Правила маршрутизации")) return;
        closeFlowModals();
        setFlowModalOpen("routingRulesModal", true);
        renderRoutingRulesModal();
        await loadRoutingRules(true);
    }

    function closeRoutingRulesModal() {
        setFlowModalOpen("routingRulesModal", false);
    }

    async function saveRoutingRulesFromModal() {
        const db = supabaseDb();
        const status = $("routingRulesStatus");
        const button = $("saveRoutingRules");
        const rows = routingRuleInputRows();
        if (!rows.length) {
            if (status) status.textContent = "Нет строк для сохранения.";
            return;
        }
        if (!db) {
            if (status) status.textContent = "Supabase недоступен.";
            return;
        }
        if (button) button.disabled = true;
        state.routingRules.saving = true;
        if (status) status.textContent = "Сохраняю правила...";
        try {
            const { error } = await db.from("wms_routing_rules").upsert(rows, { onConflict: "priority" });
            if (error) throw error;
            state.routingRules.loaded = false;
            await loadRoutingRules(true);
            if (status) status.textContent = "Правила сохранены.";
            toast("Правила маршрутизации сохранены.", "success");
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            state.routingRules.error = "Не удалось сохранить правила: " + message;
            if (status) status.textContent = state.routingRules.error;
        } finally {
            state.routingRules.saving = false;
            if (button) button.disabled = false;
        }
    }
```

- [ ] **Step 4: Wire up event listeners**

Find (`tasks.js:18077`):

```js
        $("openWriteoffTerms").addEventListener("click", () => { void openWriteoffTermsModal(); });
```

Add immediately after:

```js
        $("openRoutingRules").addEventListener("click", () => { void openRoutingRulesModal(); });
```

Find (`tasks.js:18125`):

```js
        $("closeWriteoffTerms").addEventListener("click", closeWriteoffTermsModal);
```

Add immediately after:

```js
        $("closeRoutingRules").addEventListener("click", closeRoutingRulesModal);
        $("addRoutingRule").addEventListener("click", addRoutingRuleDraft);
        $("saveRoutingRules").addEventListener("click", () => { void saveRoutingRulesFromModal(); });
        $("reloadRoutingRules").addEventListener("click", () => { void loadRoutingRules(true); });
```

Find (`tasks.js:18286`):

```js
        $("writeoffTermsModal").addEventListener("click", (event) => { if (event.target === $("writeoffTermsModal")) closeWriteoffTermsModal(); });
```

Add immediately after:

```js
        $("routingRulesModal").addEventListener("click", (event) => { if (event.target === $("routingRulesModal")) closeRoutingRulesModal(); });
```

- [ ] **Step 5: Run `node --check`**

```bash
node --check /Users/WBwork/Downloads/WMSplus-main/tasks.js
```

Expected: no output (success).

- [ ] **Step 6: Commit and push**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
git add tasks.html tasks.js
git commit -m "$(cat <<'EOF'
Админка правил маршрутизации (шаг 6/6)

Модалка по образцу wms_writeoff_terms -- список правил (приоритет,
название, одно условие атрибут/оператор/значение, целевая зона из
REVIEW_SECTIONS, группировка по таре или нет, вкл/выкл), добавление и
немедленное удаление строк, одна кнопка сохраняет весь список upsert-ом
по priority. Закрывает Фазу 1 движка правил маршрутизации целиком.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

**Live browser QA is not available this session** — state this explicitly when reporting this task done; the modal's correctness was verified by reading the mirrored `wms_writeoff_terms` pattern carefully, not by clicking through it.

---

## Self-Review

**Spec coverage:** section 1 (`tare_id`) → Task 1; section 2 (rules
schema) → Task 2; section 3 (group key + index) → Task 3; section 4
(engine) → Task 4; section 5 (hook into actualization) → Task 5;
section 6 (admin UI) → Task 6. The spec's testing scenarios each have a
concrete test block in the matching task (grouping by tare_id, already-active
shk untouched, no-match no-op, empty-conditions-never-matches implicitly
covered by Task 4's "no_match" test using a status with zero matching rules).

**Placeholder scan:** no TBD/TODO; every step has complete, literal SQL or
JS/HTML, copied from or directly matching the spec's own code blocks (Task
6's admin UI code is new — written by mirroring the real, fully-read
`wms_writeoff_terms` modal in `tasks.js`/`tasks.html`, not described
abstractly).

**Type consistency:** `wms_apply_routing_rules`'s signature
(`p_shks text[]`) is used identically in Task 4's test and Task 5's JS RPC
call. `routing_group_key`/`grouping_attribute` naming matches between
Task 3 (DB column), Task 4 (engine), and Task 6 (admin UI field name
`grouping_attribute` sent to the same column). `REVIEW_SECTIONS` is read,
never written, by Task 6 — matches its existing definition at
`tasks.js:428`.
