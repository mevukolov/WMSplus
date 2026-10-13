# Движок правил в ручной выгрузке: пилот marketplace_pc -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the manual-upload `marketplace_pc` module decide Маркетплейс-vs-ПЦ through the same rules engine (`wms_rule_conditions_match`) that already drives Superset-actualization routing, instead of its own hardcoded JS predicates -- with zero behavior change until the rules are explicitly activated afterward.

**Architecture:** A new batched RPC (`wms_evaluate_rule_batch`) wraps the existing matcher for a whole file's worth of rows in one round trip. A new `not_contains` matcher operator closes the negation gap needed for the MX-buffer exclusion. `buildMarketplacePcPreview` is rewritten to call the engine first and fall back, per row, to today's hardcoded `isMarketplaceStatus`/`isPcStatus`/`mxHasBuffer` whenever no active rule matches -- which is 100% of rows today, since the 8 relevant draft rules stay `is_active = false` through this entire plan. Because the RPC is a real network call, `buildPreviewForModule` (the module dispatcher) and its 9 call sites become `async`/`await`.

**Tech Stack:** Supabase Postgres (SQL migrations, plpgsql), vanilla JS (tasks.js). No build step.

**Spec:** `docs/superpowers/specs/2026-10-13-wms-zone-rules-manual-upload-pilot-design.md`

## Global Constraints

- Direct-to-main workflow, no branch/worktree -- matches every other change made in this repo today.
- Every SQL migration tested live via `begin; ...; rollback;` through `supabase db query --linked --file <scratch>.sql` BEFORE real application. Scratch files go in the scratchpad directory, never the repo.
- Applying any migration requires the holdout workaround: move these 4 files out of `supabase/migrations/` into `supabase/.migration_holdout/`, run `supabase db push --linked`, then move them back: `202608170001_weeek_manual_wmi_mp_pc_upload.sql`, `202609020005_wms_shifts_roster.sql`, `202609040003_upsert_wms_external_requests_from_json.sql`, `202609040004_upsert_wms_external_requests_source_shk_ids.sql`.
- Every JS change verified with `node --check tasks.js`. No browser QA available this session -- `checkUserAccess` needs a real Supabase Auth session, so state explicitly that only static checks were run.
- The 8 existing draft rules (`wms_routing_rules`, `output_key='zone'`, targets Маркетплейс/ПЦ/WMI (МП + ПЦ)) stay `is_active = false` through every task in this plan. Activating them is a separate, later, explicitly-requested step -- not part of this plan.
- Commit after each task (one commit per migration/logical JS change, this session's established granularity).

---

### Task 1: `not_contains` operator in the matcher

**Files:**
- Create: `supabase/migrations/202610130020_wms_rule_conditions_not_contains.sql`

**Interfaces:**
- Produces: `wms_rule_conditions_match(jsonb, jsonb)` gains operator `not_contains` -- condition `{"attribute": a, "operator": "not_contains", "value": v}` passes when the attribute is null/missing OR does not contain `v` (case-insensitive substring), matching `!mxHasBuffer(row)`'s semantics. Consumed by Task 3 (the 8 rules' new condition) and, indirectly, by Task 4 (whatever the engine decides is what the JS fallback already agrees with).

- [ ] **Step 1: Confirm the next free migration prefix**

Run: `ls supabase/migrations | sort | tail -5`
Expected: newest is `202610130019_wms_review_zones.sql`. If something newer exists, use the next free `2026101300NN` prefix instead of `20` below.

- [ ] **Step 2: Write the migration**

```sql
-- "Не равно"/исключение для wms_rule_conditions_match -- первый
-- реальный случай: !mxHasBuffer(row) в buildMarketplacePcPreview
-- (и аналогичный буфер-кейс у PWT в presort). Чистое добавление
-- нового elsif-случая -- поведение всех остальных операторов не
-- меняется, оба живых вызывающих (wms_apply_routing_rules,
-- wms_compute_reroute_target) не затронуты, пока ни одно правило не
-- использует новый оператор.
create or replace function public.wms_rule_conditions_match(p_conditions jsonb, p_attributes jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
    v_cond jsonb;
    v_attr text;
    v_op text;
    v_value jsonb;
    v_actual_text text;
    v_actual_num numeric;
begin
    if p_conditions is null or jsonb_array_length(p_conditions) = 0 then
        return false;
    end if;
    for v_cond in select * from jsonb_array_elements(p_conditions) loop
        v_attr := v_cond->>'attribute';
        v_op := v_cond->>'operator';
        v_value := v_cond->'value';
        v_actual_text := case
            when v_attr = 'status' then substring(p_attributes->>'status' from '[A-Z]{3}')
            else p_attributes->>v_attr
        end;
        if v_op = 'in' then
            if v_actual_text is null or not (v_value ? v_actual_text) then return false; end if;
        elsif v_op = 'eq' then
            if v_actual_text is distinct from (v_value#>>'{}') then return false; end if;
        elsif v_op = 'contains' then
            if v_actual_text is null or position(lower(v_value#>>'{}') in lower(v_actual_text)) = 0 then return false; end if;
        elsif v_op = 'not_contains' then
            if v_actual_text is not null and position(lower(v_value#>>'{}') in lower(v_actual_text)) > 0 then return false; end if;
        elsif v_op in ('gt', 'gte', 'lt', 'lte') then
            if v_actual_text is null or v_actual_text !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
            v_actual_num := v_actual_text::numeric;
            if v_op = 'gt' and not (v_actual_num > (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'gte' and not (v_actual_num >= (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'lt' and not (v_actual_num < (v_value#>>'{}')::numeric) then return false; end if;
            if v_op = 'lte' and not (v_actual_num <= (v_value#>>'{}')::numeric) then return false; end if;
        elsif v_op = 'between' then
            if v_actual_text is null or v_actual_text !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
            v_actual_num := v_actual_text::numeric;
            if not (v_actual_num >= (v_value->>0)::numeric and v_actual_num <= (v_value->>1)::numeric) then return false; end if;
        else
            return false;
        end if;
    end loop;
    return true;
end;
$$;

grant execute on function public.wms_rule_conditions_match(jsonb, jsonb) to anon, authenticated;
```

Save to `supabase/migrations/202610130020_wms_rule_conditions_not_contains.sql`.

- [ ] **Step 3: Test live via begin/rollback BEFORE real apply**

Write a scratch file in your scratchpad directory with:

```sql
begin;

-- Apply the migration body inline (copy Step 2's create-or-replace here).

create temp table test_results (test_name text primary key, actual text, expected text);

-- not_contains: value present, contains substring -> condition FAILS (match() = false)
insert into test_results values (
    'not_contains_blocks_when_substring_present',
    public.wms_rule_conditions_match(
        jsonb_build_array(jsonb_build_object('attribute', 'mx', 'operator', 'not_contains', 'value', 'буфер')),
        jsonb_build_object('mx', 'Буфер мультиотгрузки 12')
    )::text,
    'false'
);

-- not_contains: value present, does NOT contain substring -> condition PASSES
insert into test_results values (
    'not_contains_passes_when_substring_absent',
    public.wms_rule_conditions_match(
        jsonb_build_array(jsonb_build_object('attribute', 'mx', 'operator', 'not_contains', 'value', 'буфер')),
        jsonb_build_object('mx', 'Сортировка в сетки')
    )::text,
    'true'
);

-- not_contains: attribute missing entirely -> condition PASSES (null treated as "doesn't contain")
insert into test_results values (
    'not_contains_passes_when_attribute_missing',
    public.wms_rule_conditions_match(
        jsonb_build_array(jsonb_build_object('attribute', 'mx', 'operator', 'not_contains', 'value', 'буфер')),
        jsonb_build_object('status', 'PAP')
    )::text,
    'true'
);

-- existing operators unaffected -- spot check 'in' still works
insert into test_results values (
    'existing_in_operator_unaffected',
    public.wms_rule_conditions_match(
        jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'in', 'value', jsonb_build_array('PAP'))),
        jsonb_build_object('status', 'PAP')
    )::text,
    'true'
);

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

Run: `supabase db query --linked --file /path/to/test_not_contains.sql`
Expected: all 4 rows show `pass = t`. If any show `f`, fix the migration and re-run this step before continuing.

- [ ] **Step 4: Apply for real**

```bash
mkdir -p supabase/.migration_holdout
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql supabase/migrations/202609020005_wms_shifts_roster.sql supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql supabase/.migration_holdout/
supabase db push --linked
mv supabase/.migration_holdout/*.sql supabase/migrations/
```

Expected: push reports the new migration applied, no errors. Verify `ls supabase/migrations | wc -l` is back to its pre-push count plus one (the 4 holdout files are back).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202610130020_wms_rule_conditions_not_contains.sql
git commit -m "$(cat <<'EOF'
feat: add not_contains operator to wms_rule_conditions_match

Closes the negation gap found while reviewing the routing engine
today -- the only real case needed so far is !mxHasBuffer(row), used
by buildMarketplacePcPreview and PWT's presort handling. Pure
additional elsif branch; every other operator's behavior is
unchanged, and both live callers (wms_apply_routing_rules,
wms_compute_reroute_target) are unaffected until a rule actually uses
the new operator.
EOF
)"
```

---

### Task 2: `wms_evaluate_rule_batch` RPC

**Files:**
- Create: `supabase/migrations/202610130021_wms_evaluate_rule_batch.sql`

**Interfaces:**
- Consumes: `wms_rule_conditions_match(jsonb, jsonb)` from Task 1 (and its pre-existing operators).
- Produces: `wms_evaluate_rule_batch(p_output_key text, p_rows jsonb) returns jsonb` -- `p_rows` is a jsonb array of `{row_id, <attributes>}`; returns a jsonb array of `{row_id, rule_id, rule_name, output_value}` (nulls when no active rule matched), one entry per input row, same order not guaranteed but `row_id` always correlates. Consumed by Task 4's `evaluateZoneRulesBatch`.

- [ ] **Step 1: Write the migration**

```sql
-- Пакетная версия wms_evaluate_rule (Фаза 2b подпроект 1) -- та же
-- логика матчинга, но на массив строк за один вызов. Нужна, чтобы
-- ручная выгрузка могла звать движок правил один раз на файл, а не
-- по вызову на строку (уже был случай сегодня, когда небатчевый RPC
-- на несколько тысяч строк тихо упирался в таймаут).
create or replace function public.wms_evaluate_rule_batch(p_output_key text, p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_row jsonb;
    v_row_id text;
    v_attributes jsonb;
    v_rule record;
    v_results jsonb := '[]'::jsonb;
begin
    if p_rows is null or jsonb_array_length(p_rows) = 0 then
        return v_results;
    end if;

    for v_row in select * from jsonb_array_elements(p_rows) loop
        v_row_id := v_row->>'row_id';
        v_attributes := v_row - 'row_id';

        v_rule := null;
        for v_rule in
            select * from public.wms_routing_rules
            where is_active = true and output_key = p_output_key
            order by priority asc
        loop
            if public.wms_rule_conditions_match(v_rule.conditions, v_attributes) then
                exit;
            end if;
            v_rule := null;
        end loop;

        v_results := v_results || jsonb_build_object(
            'row_id', v_row_id,
            'rule_id', case when v_rule is null then null else v_rule.id end,
            'rule_name', case when v_rule is null then null else v_rule.name end,
            'output_value', case when v_rule is null then null else v_rule.output_value end
        );
    end loop;

    return v_results;
end;
$$;

grant execute on function public.wms_evaluate_rule_batch(text, jsonb) to anon, authenticated;
```

Save to `supabase/migrations/202610130021_wms_evaluate_rule_batch.sql`.

- [ ] **Step 2: Test live via begin/rollback BEFORE real apply**

Write a scratch file with:

```sql
begin;

-- Apply the migration body inline (copy Step 1's create-or-replace here).

insert into public.wms_routing_rules (priority, name, is_active, conditions, output_key, output_value, target_task_type, grouping_attribute)
values
    (90001, 'test: status=A -> target A', true, jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'eq', 'value', 'A')), 'test_batch', jsonb_build_object('label', 'zone-a'), null, null),
    (90002, 'test: status=B -> target B', true, jsonb_build_array(jsonb_build_object('attribute', 'status', 'operator', 'eq', 'value', 'B')), 'test_batch', jsonb_build_object('label', 'zone-b'), null, null);

create temp table batch_result as
with ins as (
    select public.wms_evaluate_rule_batch(
        'test_batch',
        jsonb_build_array(
            jsonb_build_object('row_id', '0', 'status', 'A'),
            jsonb_build_object('row_id', '1', 'status', 'B'),
            jsonb_build_object('row_id', '2', 'status', 'C')
        )
    ) as results
)
select item as row_result
from ins, jsonb_array_elements(ins.results) item;

create temp table test_results (test_name text primary key, actual text, expected text);

insert into test_results values
    ('row0_matches_rule_a', (select (row_result->'output_value'->>'label') from batch_result where row_result->>'row_id' = '0'), 'zone-a'),
    ('row1_matches_rule_b', (select (row_result->'output_value'->>'label') from batch_result where row_result->>'row_id' = '1'), 'zone-b'),
    ('row2_no_match_is_null', (select row_result->'output_value' from batch_result where row_result->>'row_id' = '2')::text, 'null'),
    ('all_three_rows_returned', (select count(*)::text from batch_result), '3');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

Run: `supabase db query --linked --file /path/to/test_evaluate_rule_batch.sql`
Expected: all 4 rows show `pass = t`. Fix and re-run if anything fails before continuing.

- [ ] **Step 3: Apply for real**

```bash
mkdir -p supabase/.migration_holdout
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql supabase/migrations/202609020005_wms_shifts_roster.sql supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql supabase/.migration_holdout/
supabase db push --linked
mv supabase/.migration_holdout/*.sql supabase/migrations/
```

Expected: push reports the new migration applied, no errors, holdout files restored.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202610130021_wms_evaluate_rule_batch.sql
git commit -m "$(cat <<'EOF'
feat: add wms_evaluate_rule_batch RPC for batched rule evaluation

Same matching logic as wms_evaluate_rule (Фаза 2b подпроект 1), but
over a whole array of rows in one round trip -- avoids a per-row RPC
call from the manual-upload client path. Consumed by the upcoming
buildMarketplacePcPreview rewrite; nothing calls it yet.
EOF
)"
```

---

### Task 3: Add buffer-exclusion condition to the 8 draft rules

**Files:**
- Create: `supabase/migrations/202610130022_wms_zone_rules_add_buffer_exclusion.sql`

**Interfaces:**
- Consumes: `not_contains` operator from Task 1.
- Produces: no new interface -- this task's deliverable is "8 specific rows in `wms_routing_rules` gain one more condition, `is_active` unchanged", verified by a live count/diff.

- [ ] **Step 1: Write the migration**

```sql
-- Воспроизводит !mxHasBuffer(row), который в хардкоде применяется ко
-- всем GWS/WMI/PWT/PAP/SMC-веткам marketplace_pc одинаково. Правила
-- остаются is_active=false -- эта миграция сама по себе не меняет
-- ничего в проде.
update public.wms_routing_rules
set conditions = conditions || jsonb_build_array(jsonb_build_object('attribute', 'mx', 'operator', 'not_contains', 'value', 'буфер'))
where output_key = 'zone'
  and target_task_type in ('Маркетплейс', 'ПЦ', 'WMI (МП + ПЦ)');
```

Save to `supabase/migrations/202610130022_wms_zone_rules_add_buffer_exclusion.sql`.

- [ ] **Step 2: Test live via begin/rollback BEFORE real apply**

Write a scratch file with:

```sql
begin;

-- Snapshot counts before, for comparison.
create temp table before_counts as
select count(*) as total, count(*) filter (where is_active) as active
from public.wms_routing_rules
where output_key = 'zone' and target_task_type in ('Маркетплейс', 'ПЦ', 'WMI (МП + ПЦ)');

-- Apply the migration body inline (copy Step 1's update here).

create temp table test_results (test_name text primary key, actual text, expected text);

insert into test_results values
    ('eight_rows_affected', (
        select count(*)::text from public.wms_routing_rules
        where output_key = 'zone' and target_task_type in ('Маркетплейс', 'ПЦ', 'WMI (МП + ПЦ)')
          and conditions @> jsonb_build_array(jsonb_build_object('attribute', 'mx', 'operator', 'not_contains', 'value', 'буфер'))
    ), '8'),
    ('is_active_unchanged', (
        select case when (select active from before_counts) = count(*) filter (where is_active) then 'unchanged' else 'CHANGED' end
        from public.wms_routing_rules
        where output_key = 'zone' and target_task_type in ('Маркетплейс', 'ПЦ', 'WMI (МП + ПЦ)')
    ), 'unchanged'),
    ('matcher_respects_new_condition', (
        select public.wms_rule_conditions_match(
            conditions,
            jsonb_build_object('status', 'PAP', 'mx', 'Буфер мультиотгрузки 12')
        )::text
        from public.wms_routing_rules
        where target_task_type = 'Маркетплейс' and name = 'Хардкод: PAP -> Маркетплейс'
    ), 'false');

select test_name, actual, expected, (actual = expected) as pass from test_results order by test_name;

rollback;
```

Run: `supabase db query --linked --file /path/to/test_buffer_exclusion.sql`
Expected: all 3 rows show `pass = t`. If the third row's rule name doesn't match exactly (quoting/encoding), adjust the `name =` filter to match what Step 2 of the earlier seeding task actually stored -- re-check with `select name from public.wms_routing_rules where target_task_type = 'Маркетплейс';` first if needed.

- [ ] **Step 3: Apply for real**

```bash
mkdir -p supabase/.migration_holdout
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql supabase/migrations/202609020005_wms_shifts_roster.sql supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql supabase/.migration_holdout/
supabase db push --linked
mv supabase/.migration_holdout/*.sql supabase/migrations/
```

Expected: push reports the new migration applied, no errors, holdout files restored.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202610130022_wms_zone_rules_add_buffer_exclusion.sql
git commit -m "$(cat <<'EOF'
feat: add MX-buffer exclusion condition to the 8 marketplace_pc draft rules

Reproduces !mxHasBuffer(row) -- the one thing the 8 existing draft
rules (PAP/SMC/GWS/WMI/PWT -> Маркетплейс/ПЦ/WMI) didn't yet encode.
Rules stay inactive; this migration has zero live effect on its own.
EOF
)"
```

---

### Task 4: Rewrite `buildMarketplacePcPreview` with engine + fallback

**Files:**
- Modify: `tasks.js` (new helper functions near `isMarketplaceStatus`/`mxHasBuffer`, currently ~line 15055-15086; rewrite of `buildMarketplacePcPreview`, currently ~line 15878-15893)

**Interfaces:**
- Consumes: `wms_evaluate_rule_batch` RPC from Task 2; existing `supabaseDb()`, `moduleDef()`, `appendGroupedTasks()`, `isMarketplaceStatus()`, `isPcStatus()`, `mxHasBuffer()`, `parseDateTime()`, `uploadDateForModule()`, `dueDateForBusinessDate()`, `productIdsFromRows()` -- all pre-existing, unchanged. `SUPERSET_CACHE_CHUNK_SIZE` (established constant, tasks.js:68, value 500).
- Produces: `function zoneRuleAttributesForRow(row): {status, mx}`; `async function evaluateZoneRulesBatch(rows): Promise<Array<string|null>>` (one entry per input row, in the same order, `null` when no active rule matched that row); `async function buildMarketplacePcPreview(sourceRows, businessDate, specialMap)` (same signature as before, now returns a Promise). Consumed by Task 5 (the dispatcher awaits this function's result like any other).

- [ ] **Step 1: Re-locate the insertion point for the helper functions**

Run: `grep -n "function mxHasBuffer" tasks.js`
Confirm the current line (context: right after it sits `isPresortStatus`, `isLabelingStatus`, `isMarketplaceStatus`, `isPcStatus`, `isWmiMpPcStatus` -- this task does not touch any of those, only adds two new functions nearby).

- [ ] **Step 2: Add the two new helper functions**

Find this existing block (unchanged, just the anchor for your insertion):

```js
    function mxHasBuffer(row) { return normalizeForMatch(row && row.mx).includes("буфер"); }
```

Add immediately after it (before `isPresortStatus`):

```js
    function mxHasBuffer(row) { return normalizeForMatch(row && row.mx).includes("буфер"); }

    function zoneRuleAttributesForRow(row) {
        return { status: row.product_status, mx: row.mx };
    }

    async function evaluateZoneRulesBatch(rows) {
        const decisions = new Array(rows.length).fill(null);
        const db = supabaseDb();
        if (!db || !rows.length) return decisions;
        for (let offset = 0; offset < rows.length; offset += SUPERSET_CACHE_CHUNK_SIZE) {
            const chunk = rows.slice(offset, offset + SUPERSET_CACHE_CHUNK_SIZE);
            const payload = chunk.map((row, index) => ({ row_id: String(offset + index), ...zoneRuleAttributesForRow(row) }));
            try {
                const { data, error } = await db.rpc("wms_evaluate_rule_batch", { p_output_key: "zone", p_rows: payload });
                if (error) throw error;
                (data || []).forEach((item) => {
                    const idx = Number(item.row_id);
                    if (Number.isFinite(idx) && item.output_value && item.output_value.target_task_type) {
                        decisions[idx] = item.output_value.target_task_type;
                    }
                });
            } catch (error) {
                console.warn("zone rule batch evaluation failed, falling back to hardcoded classification for this chunk:", error);
            }
        }
        return decisions;
    }
```

(Only one literal `mxHasBuffer` line should exist afterward -- the snippet above repeats it purely as the anchor for the diff; do not duplicate the function itself.)

- [ ] **Step 3: Re-locate and rewrite `buildMarketplacePcPreview`**

Run: `grep -n "function buildMarketplacePcPreview" tasks.js`

Current body (before):

```js
    function buildMarketplacePcPreview(sourceRows, businessDate, specialMap) {
        specialMap = specialMap || new Map();
        const marketplaceDef = moduleDef("marketplace");
        const pcDef = moduleDef("pc");
        const marketplaceDate = state.manualDate ? businessDate : uploadDateForModule("marketplace");
        const pcDate = state.manualDate ? businessDate : uploadDateForModule("pc");
        const marketplaceDateRows = sourceRows.filter((row) => parseDateTime(row.created_at).date === marketplaceDate);
        const pcDateRows = sourceRows.filter((row) => parseDateTime(row.created_at).date === pcDate);
        const marketplaceRows = marketplaceDateRows.filter((row) => isMarketplaceStatus(row) && !mxHasBuffer(row));
        const pcRows = pcDateRows.filter((row) => isPcStatus(row) && !isMarketplaceStatus(row) && !mxHasBuffer(row));
        const marketplace = appendGroupedTasks(marketplaceRows, { module: "marketplace", sourceModule: marketplaceDef.sourceModule, uploadType: marketplaceDef.uploadType, businessDate: marketplaceDate, sourcePrefix: "marketplace", titlePrefix: "Маркетплейс", taskType: marketplaceDef.taskType, descriptionTaskType: marketplaceDef.taskTypeLabel, column: marketplaceDef.column, dueDate: dueDateForBusinessDate("marketplace", marketplaceDate), responsibilityZone: marketplaceDef.responsibilityZone, specialMap });
        const pc = appendGroupedTasks(pcRows, { module: "pc", sourceModule: pcDef.sourceModule, uploadType: pcDef.uploadType, businessDate: pcDate, sourcePrefix: "pc", titlePrefix: "ПЦ", taskType: pcDef.taskType, descriptionTaskType: pcDef.taskTypeLabel, column: pcDef.column, dueDate: dueDateForBusinessDate("pc", pcDate), responsibilityZone: pcDef.responsibilityZone, specialMap });
        const tasks = marketplace.tasks.concat(pc.tasks);
        const targetDates = new Set([marketplaceDate, pcDate]);
        return { mode: "marketplace_pc", sourceRows: sourceRows.length, rowsCount: marketplaceRows.length + pcRows.length, dateFilteredOut: sourceRows.filter((row) => !targetDates.has(parseDateTime(row.created_at).date)).length, marketplaceRows: marketplaceRows.length, pcRows: pcRows.length, groupedTareCount: marketplace.groupedTareCount + pc.groupedTareCount, specialCount: marketplace.specialCount + pc.specialCount, specialCandidateIds: productIdsFromRows(marketplaceRows.concat(pcRows)), tasks, marketplaceTasks: marketplace.tasks.length, pcTasks: pc.tasks.length };
    }
```

New body (after) -- only `function` → `async function` and how `marketplaceRows`/`pcRows` are computed change; everything else (grouping, due dates, return shape) is byte-for-byte identical:

```js
    async function buildMarketplacePcPreview(sourceRows, businessDate, specialMap) {
        specialMap = specialMap || new Map();
        const marketplaceDef = moduleDef("marketplace");
        const pcDef = moduleDef("pc");
        const marketplaceDate = state.manualDate ? businessDate : uploadDateForModule("marketplace");
        const pcDate = state.manualDate ? businessDate : uploadDateForModule("pc");
        const marketplaceDateRows = sourceRows.filter((row) => parseDateTime(row.created_at).date === marketplaceDate);
        const pcDateRows = sourceRows.filter((row) => parseDateTime(row.created_at).date === pcDate);
        const candidateRows = Array.from(new Set(marketplaceDateRows.concat(pcDateRows)));
        const decisions = await evaluateZoneRulesBatch(candidateRows);
        const zoneByRow = new Map();
        candidateRows.forEach((row, index) => { zoneByRow.set(row, decisions[index]); });
        const marketplaceRows = marketplaceDateRows.filter((row) => {
            const decided = zoneByRow.get(row);
            if (decided) return decided === marketplaceDef.column;
            return isMarketplaceStatus(row) && !mxHasBuffer(row);
        });
        const pcRows = pcDateRows.filter((row) => {
            const decided = zoneByRow.get(row);
            if (decided) return decided === pcDef.column;
            return isPcStatus(row) && !isMarketplaceStatus(row) && !mxHasBuffer(row);
        });
        const marketplace = appendGroupedTasks(marketplaceRows, { module: "marketplace", sourceModule: marketplaceDef.sourceModule, uploadType: marketplaceDef.uploadType, businessDate: marketplaceDate, sourcePrefix: "marketplace", titlePrefix: "Маркетплейс", taskType: marketplaceDef.taskType, descriptionTaskType: marketplaceDef.taskTypeLabel, column: marketplaceDef.column, dueDate: dueDateForBusinessDate("marketplace", marketplaceDate), responsibilityZone: marketplaceDef.responsibilityZone, specialMap });
        const pc = appendGroupedTasks(pcRows, { module: "pc", sourceModule: pcDef.sourceModule, uploadType: pcDef.uploadType, businessDate: pcDate, sourcePrefix: "pc", titlePrefix: "ПЦ", taskType: pcDef.taskType, descriptionTaskType: pcDef.taskTypeLabel, column: pcDef.column, dueDate: dueDateForBusinessDate("pc", pcDate), responsibilityZone: pcDef.responsibilityZone, specialMap });
        const tasks = marketplace.tasks.concat(pc.tasks);
        const targetDates = new Set([marketplaceDate, pcDate]);
        return { mode: "marketplace_pc", sourceRows: sourceRows.length, rowsCount: marketplaceRows.length + pcRows.length, dateFilteredOut: sourceRows.filter((row) => !targetDates.has(parseDateTime(row.created_at).date)).length, marketplaceRows: marketplaceRows.length, pcRows: pcRows.length, groupedTareCount: marketplace.groupedTareCount + pc.groupedTareCount, specialCount: marketplace.specialCount + pc.specialCount, specialCandidateIds: productIdsFromRows(marketplaceRows.concat(pcRows)), tasks, marketplaceTasks: marketplace.tasks.length, pcTasks: pc.tasks.length };
    }
```

- [ ] **Step 4: Verify**

Run: `node --check tasks.js`
Expected: no output, exit code 0.

Run: `grep -n "async function buildMarketplacePcPreview\|async function evaluateZoneRulesBatch\|function zoneRuleAttributesForRow" tasks.js`
Expected: all three present exactly once.

State explicitly in your task notes that this is verified via `node --check` and manual code reading only -- no live browser session, consistent with every other JS change today. Note also: at this point in the plan, `buildMarketplacePcPreview` is `async` but its only caller (`buildPreviewForModule`, Task 5) is still synchronous -- this is an intentionally incomplete intermediate state; do not worry that the dispatcher doesn't yet `await` it. Task 5 closes that gap. If you want to sanity-check this task in isolation before Task 5, you cannot run it live (the dispatcher would return a Promise object where callers expect a value) -- that's expected and resolved by the next task, not a bug to chase now.

- [ ] **Step 5: Commit**

```bash
git add tasks.js
git commit -m "$(cat <<'EOF'
feat: buildMarketplacePcPreview calls the rules engine, falls back to hardcode

evaluateZoneRulesBatch() chunks the candidate rows through the new
wms_evaluate_rule_batch RPC (500-row chunks, established convention).
Per row: if an active rule decided a zone, trust it; if none did
(100% of rows today, the 8 relevant rules are still inactive), fall
back to the exact isMarketplaceStatus/isPcStatus/mxHasBuffer logic
this function always used. Function is now async -- its one caller
(buildPreviewForModule) isn't updated yet, that's the next commit.
EOF
)"
```

---

### Task 5: Make `buildPreviewForModule` async, update all 9 call sites

**Files:**
- Modify: `tasks.js` (`buildPreviewForModule` dispatcher, currently ~line 15954-15964, and 9 call sites scattered across `startSpecialBackground`, `handleSingleFile`, `handleCarrierFile`, `skipCarrierFile`, `handleMasterFile`, `buildMasterPreview`, `startMasterSpecialBackground`)

**Interfaces:**
- Consumes: `async function buildMarketplacePcPreview` from Task 4 (callers no longer care that only this one branch is genuinely async -- they now uniformly `await` the dispatcher).
- Produces: `async function buildPreviewForModule(...)` -- same parameters, now returns `Promise<object>` instead of `object`. No later task consumes this directly; this is the final task in the plan.

- [ ] **Step 1: Make the dispatcher async**

Run: `grep -n "function buildPreviewForModule" tasks.js`

Current:

```js
    function buildPreviewForModule(module, rows, carrierRows, businessDate, specialMap) {
```

New:

```js
    async function buildPreviewForModule(module, rows, carrierRows, businessDate, specialMap) {
```

(Only the `function` → `async function` keyword changes. The body -- the 7 `if (module === ...) return build*Preview(...)` lines plus the final fallback `return { mode: module, tasks: [] }` -- stays exactly as-is. An `async` function auto-wraps every `return` in a Promise regardless of whether the returned value was itself a Promise, so the 7 still-synchronous module builders keep working unchanged.)

- [ ] **Step 2: Re-locate and update all 9 call sites**

Run: `grep -n "buildPreviewForModule(" tasks.js`
Expected 10 matches: the definition line itself plus 9 call sites. Match each by its surrounding code below, not by absolute line number (these may have shifted from earlier tasks' edits).

**Site 1** (inside the `async` IIFE in `startSpecialBackground`):

```js
// before
                    const enriched = buildPreviewForModule(module, rows, carrierRows || [], businessDate, specialMap);
// after
                    const enriched = await buildPreviewForModule(module, rows, carrierRows || [], businessDate, specialMap);
```

**Site 2** (`handleSingleFile`, `module === "pm"` branch):

```js
// before
            state.preview = buildPreviewForModule(module, rows, [], state.activeDate);
            renderPreview(state.preview);
            $("copyTransfers").disabled = !(state.preview.copiedTransferIds || []).length;
// after
            state.preview = await buildPreviewForModule(module, rows, [], state.activeDate);
            renderPreview(state.preview);
            $("copyTransfers").disabled = !(state.preview.copiedTransferIds || []).length;
```

**Site 3** (`handleSingleFile`, general branch -- same line text as Site 2's first line, appears a second time further down in the same function; apply the identical `await` insertion there too):

```js
// before
        state.preview = buildPreviewForModule(module, rows, [], state.activeDate);
        renderPreview(state.preview);
        $("saveUpload").disabled = !state.preview.tasks.length;
// after
        state.preview = await buildPreviewForModule(module, rows, [], state.activeDate);
        renderPreview(state.preview);
        $("saveUpload").disabled = !state.preview.tasks.length;
```

**Site 4** (`handleCarrierFile`):

```js
// before
        state.preview = buildPreviewForModule("pm", state.rows.primary || [], rows, state.activeDate);
// after
        state.preview = await buildPreviewForModule("pm", state.rows.primary || [], rows, state.activeDate);
```

**Site 5** (`skipCarrierFile`):

```js
// before
        state.preview = buildPreviewForModule("pm", state.rows.primary || [], [], state.activeDate);
// after
        state.preview = await buildPreviewForModule("pm", state.rows.primary || [], [], state.activeDate);
```

**Site 6** (`handleMasterFile`):

```js
// before
            const pmPreview = buildPreviewForModule("pm", rows, [], uploadDateForModule("pm"));
// after
            const pmPreview = await buildPreviewForModule("pm", rows, [], uploadDateForModule("pm"));
```

**Site 7** (`buildMasterPreview`, inside the `for` loop):

```js
// before
                modules.push({ module: job.module, date: job.date, preview: buildPreviewForModule(job.module, job.rows, job.carrierRows, job.date) });
// after
                modules.push({ module: job.module, date: job.date, preview: await buildPreviewForModule(job.module, job.rows, job.carrierRows, job.date) });
```

**Site 8** (inside the `async` IIFE in `startMasterSpecialBackground` -- the one call inside `.map()`, needs the `Promise.all` rewrite, not a plain `await`):

```js
// before
                    const modules = masterPreviewJobs(dates).map((job) => ({ module: job.module, date: job.date, preview: buildPreviewForModule(job.module, job.rows, job.carrierRows, job.date, specialMap) }));
// after
                    const modules = await Promise.all(masterPreviewJobs(dates).map(async (job) => ({ module: job.module, date: job.date, preview: await buildPreviewForModule(job.module, job.rows, job.carrierRows, job.date, specialMap) })));
```

(This accounts for all 9 call sites: Site 3 above covers 2 occurrences of the same line pattern.)

- [ ] **Step 3: Verify**

Run: `node --check tasks.js`
Expected: no output, exit code 0.

Run: `grep -n "buildPreviewForModule(" tasks.js | grep -v "await buildPreviewForModule\|async function buildPreviewForModule\|\.map(async (job)"`
Expected: zero matches -- every call site now has `await` (directly or via the Task 8 `Promise.all`/`.map(async ...)` pattern), and the only remaining bare `buildPreviewForModule(` text is the function's own definition line and the `.map(async (job) => ...)` wrapper line from Site 8 (which contains `await buildPreviewForModule` inside it, so it's already excluded by the grep's `-v`).

State explicitly that this was verified via `node --check` and manual code reading only -- no live browser session, same limitation as every other JS task today.

- [ ] **Step 4: Commit**

```bash
git add tasks.js
git commit -m "$(cat <<'EOF'
feat: make buildPreviewForModule async, await it at all 9 call sites

Required because buildMarketplacePcPreview (previous commit) is now a
real network call. The other 7 module builders stay synchronous
internally -- async auto-wraps their return values, so only the
calling sites needed updating, not those functions themselves. One
site (startMasterSpecialBackground's .map()) needed Promise.all +
async map callback instead of a plain await; the rest were single
await insertions. Completes the marketplace_pc pilot: all code is
shipped, the 8 relevant rules stay is_active=false, so manual-upload
behavior is unchanged until someone deliberately flips a rule on.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** "Новый оператор not_contains" → Task 1. "Новый RPC: wms_evaluate_rule_batch" → Task 2. "Обновление 8 черновых правил" → Task 3. "buildMarketplacePcPreview: переписанная логика + fallback" → Task 4. "Async-рипл: buildPreviewForModule + 9 вызовов" → Task 5. "Выкатка" Шаг 1 (ship inactive) is exactly what Tasks 1-5 deliver; Шаг 2 (activation) is explicitly excluded per the spec and the dispatch instructions. "Что НЕ входит в объём" and "Следующий этап" require no task here -- verified no task in this plan touches tare grouping, `wms_module_settings`, or any other manual-upload module.
- **Placeholder scan:** no TBD/TODO, no broken/draft code blocks -- a malformed first attempt at Task 2's Step 2 test script was caught during self-review and removed, leaving only the single, correct, literal test script.
- **Type consistency:** `evaluateZoneRulesBatch(rows)` returns `Array<string|null>` in Task 4's definition and is consumed that way (indexed into `zoneByRow`) in the same task's `buildMarketplacePcPreview` rewrite. `zoneRuleAttributesForRow(row)` returns `{status, mx}`, matching exactly what `wms_evaluate_rule_batch`'s attribute bag (Task 2) and `wms_rule_conditions_match`'s `status`/`mx` handling (pre-existing, Task 1 only adds `not_contains`) already expect. `wms_evaluate_rule_batch`'s response shape (`{row_id, rule_id, rule_name, output_value}`) is defined in Task 2 and consumed identically in Task 4's `evaluateZoneRulesBatch` (`item.row_id`, `item.output_value.target_task_type`).
