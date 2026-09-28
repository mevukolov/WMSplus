# Интеграция "Без ШК" в задачи Разбора Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match задачи Разбора against "Без ШК" photos (intake_submissions) by nm + last-movement date window, surface it as a pill + mini-modal with confirm/reject, log to task history, and claim the matched intake_submissions row so it stops surfacing for other tasks.

**Architecture:** A new indexed RPC does the nm+date matching on demand (called once, in the background, the first time a task card is opened — never during list rendering). Matches persist onto the task's own `source_payload.no_shk_matches` so they "stick" without re-querying. Confirming a match calls a second RPC that atomically claims the `intake_submissions` row (race-safe) before the task history line is written. Every piece of UI (fetching the WB product photo, opening the existing "без ШК" card) reuses functions that already exist in this codebase for other flows.

**Tech Stack:** Vanilla JS (`tasks.js`, `intake_search.js`), Supabase Postgres (SQL functions, RLS via `security definer`), no build step, no test framework — verification is `node --check` + manual browser QA.

**Spec:** [docs/superpowers/specs/2026-09-28-task-no-shk-matching-design.md](../specs/2026-09-28-task-no-shk-matching-design.md)

## Global Constraints

- Date window: `intake_submissions.created_at` must fall in `[последнее_движение_задачи − 1 день; последнее_движение_задачи + 5 дней]`.
- Matching runs live, once per task-card-open (never during list/table rendering) — mirrors the existing `refreshTaskSpecialTags` pattern exactly.
- Multiple matching "без ШК" candidates for one task → show all of them in the modal, each with its own decision.
- History line text on confirm is the single fixed string `"Найден без ШК"` — never varies by task context.
- Once a candidate is confirmed by any task, it must stop appearing as a candidate for every other task (`matched_task_id` claim, race-safe).
- Rejecting a candidate writes nothing to `wms_task_history` — only `decision: "rejected"` on the task's own payload.
- Every client-side JS edit is verified with `node --check <file>.js` before being considered done.
- `intake_search.js` stays self-contained (no shared JS state with `tasks.js` — only the one exported `window.__openIntakeSubmissionCard` hook, matching the existing convention already used for the header-menu click-through).

---

## Task 1: SQL migration — schema, indexes, RPCs

**Files:**
- Create: `supabase/migrations/202609280004_no_shk_task_matching.sql`

**Interfaces:**
- Produces: `public.intake_submissions.matched_task_id/matched_shk/matched_at/matched_by_id/matched_by_name` columns; `public.wms_no_shk_task_matches(p_nms text[], p_date_from date, p_date_to date)` RPC returning `(id uuid, item_text text, category text, item_type text, area text, full_name text, employee_id integer, created_at timestamptz, photo_path text, sticker_code text, no_shk_bucket text, wb_nm_candidates jsonb, matched_task_id uuid, matched_shk text)`; `public.wms_intake_mark_matched(p_submission_id uuid, p_task_id uuid, p_shk text, p_actor_id text, p_actor_name text)` RPC returning `(id uuid, matched_task_id uuid, matched_shk text)` (empty result set = already claimed by someone else); `public.wms_intake_submissions_search(...)` updated to also return `matched_task_id`, `matched_shk`.

- [ ] **Step 1: Write the migration file**

```sql
-- 202609280004_no_shk_task_matching.sql
-- Связывает задачи Разбора с фото "Без ШК" (intake_submissions) по
-- вероятному НМ (wb_nm_candidates, уже считает wb-photo-match) и окну дат
-- вокруг последнего движения товара в задаче. Матчинг живёт на клиенте
-- (wms_no_shk_task_matches, вызывается точечно при открытии карточки
-- задачи -- как уже работает связка "Два ШК"/loadSpecialMap), а не
-- фоновым job'ом: окно всего 6 дней, объём intake_submissions не
-- оправдывает отдельный cron. См.
-- docs/superpowers/specs/2026-09-28-task-no-shk-matching-design.md.

alter table public.intake_submissions
    add column if not exists matched_task_id uuid references public.wms_tasks(id),
    add column if not exists matched_shk text,
    add column if not exists matched_at timestamptz,
    add column if not exists matched_by_id text,
    add column if not exists matched_by_name text;

-- Окно матчинга -- всего 6 дней вокруг движения задачи; обычного индекса
-- на created_at достаточно (GIN не оправдан при этом объёме и разбросе).
create index if not exists intake_submissions_created_at_idx
    on public.intake_submissions (created_at);

create or replace function public.wms_no_shk_task_matches(
    p_nms text[],
    p_date_from date,
    p_date_to date
) returns table (
    id uuid,
    item_text text,
    category text,
    item_type text,
    area text,
    full_name text,
    employee_id integer,
    created_at timestamptz,
    photo_path text,
    sticker_code text,
    no_shk_bucket text,
    wb_nm_candidates jsonb,
    matched_task_id uuid,
    matched_shk text
)
language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, employee_id,
           created_at, photo_path, sticker_code, no_shk_bucket,
           wb_nm_candidates, matched_task_id, matched_shk
    from public.intake_submissions
    where matched_task_id is null
      and p_nms is not null and array_length(p_nms, 1) > 0
      and created_at >= p_date_from
      and created_at < p_date_to + interval '1 day'
      and exists (
          select 1
          from jsonb_array_elements_text(coalesce(wb_nm_candidates, '[]'::jsonb)) elem
          where elem = any(p_nms)
      )
    order by created_at desc
    limit 50;
$$;

grant execute on function public.wms_no_shk_task_matches(text[], date, date) to anon;

-- Отдаёт задаче эксклюзивное право на эту запись "без ШК": первый
-- "Опознать" побеждает (матчится task_id is null в условии update), любой
-- следующий по той же записи из другой задачи получит 0 строк -- клиент
-- обязан это проверить и НЕ писать историю задачи при пустом результате.
create or replace function public.wms_intake_mark_matched(
    p_submission_id uuid,
    p_task_id uuid,
    p_shk text,
    p_actor_id text,
    p_actor_name text
) returns table (id uuid, matched_task_id uuid, matched_shk text)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    update public.intake_submissions
    set matched_task_id = p_task_id,
        matched_shk = p_shk,
        matched_at = now(),
        matched_by_id = p_actor_id,
        matched_by_name = p_actor_name
    where intake_submissions.id = p_submission_id
      and intake_submissions.matched_task_id is null
    returning intake_submissions.id, intake_submissions.matched_task_id, intake_submissions.matched_shk;
end;
$$;

grant execute on function public.wms_intake_mark_matched(uuid, uuid, text, text, text) to anon;

-- wms_intake_submissions_search должна отдавать matched_task_id/matched_shk
-- фронту (лента "Без ШК" показывает "ШК опознан: ..." на кнопке). Postgres
-- не даёт CREATE OR REPLACE менять состав RETURNS TABLE -- дропаем и
-- создаём заново (тот же приём, что в 202609250001).
drop function if exists public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int, boolean);

create or replace function public.wms_intake_submissions_search(
    p_areas text[] default null,
    p_categories text[] default null,
    p_item_types text[] default null,
    p_employee_query text default null,
    p_date_from date default null,
    p_date_to date default null,
    p_query text default null,
    p_limit int default 50,
    p_offset int default 0,
    p_unassigned_only boolean default false
) returns table (
    id uuid,
    item_text text,
    category text,
    item_type text,
    area text,
    full_name text,
    employee_id integer,
    shift_date date,
    shift_type text,
    no_shk_bucket text,
    created_at timestamptz,
    photo_path text,
    sticker_code text,
    wb_nm_candidates jsonb,
    matched_task_id uuid,
    matched_shk text
)
language sql
security definer
set search_path = public
stable
as $$
    select id, item_text, category, item_type, area, full_name, employee_id,
           shift_date, shift_type, no_shk_bucket, created_at, photo_path, sticker_code,
           wb_nm_candidates, matched_task_id, matched_shk
    from public.intake_submissions
    where (p_areas is null or area = any(p_areas))
      and (p_categories is null or category = any(p_categories))
      and (p_item_types is null or item_type = any(p_item_types))
      and (
        p_employee_query is null
        or full_name ilike '%' || p_employee_query || '%'
        or employee_id::text ilike '%' || p_employee_query || '%'
      )
      and (p_date_from is null or shift_date >= p_date_from)
      and (p_date_to is null or shift_date <= p_date_to)
      and (not p_unassigned_only or sticker_code is null)
      and (
        p_query is null or trim(p_query) = ''
        or not exists (
            select 1
            from unnest(regexp_split_to_array(lower(trim(p_query)), '\s+')) as qw
            where word_similarity(qw, lower(coalesce(item_text, '') || ' ' || coalesce(category, ''))) < 0.3
        )
      )
    order by created_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0);
$$;

grant execute on function public.wms_intake_submissions_search(text[], text[], text[], text, date, date, text, int, int, boolean) to anon;
```

- [ ] **Step 2: Verify the file is valid SQL and apply it**

Run: `cd /Users/WBwork/Downloads/WMSplus-main && supabase db push`

Expected: the new migration applies cleanly (no `LegacyDbPushMissingRemoteError` — if it happens due to unrelated pre-existing duplicate-prefix files elsewhere in `supabase/migrations`, use the established holdout workaround: temporarily `mv` the colliding files to `supabase/.migration_holdout/`, push, move them back, verify `git status --porcelain supabase/migrations` is clean). Tell the user explicitly this migration needs pushing if the sandbox blocks the push — do not silently skip it.

- [ ] **Step 3: Sanity-check the new RPCs from SQL**

Run (via `supabase db query` or the Supabase SQL editor):
```sql
select proname from pg_proc where proname in ('wms_no_shk_task_matches', 'wms_intake_mark_matched');
select column_name from information_schema.columns where table_name = 'intake_submissions' and column_name like 'matched_%';
```
Expected: both function names listed; 5 `matched_*` columns listed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202609280004_no_shk_task_matching.sql
git commit -m "Add DB schema/RPCs for matching tasks against intake_submissions (Без ШК)"
```

---

## Task 2: `tasks.js` — background matching (no UI yet)

**Files:**
- Modify: `tasks.js:775` (state object — add `noShkMatch` sibling to `achievements`)
- Modify: `tasks.js:8437` (`openTaskDetail` — add the fire-and-forget refresh call, mirroring `refreshTaskSpecialTags`)
- Modify: `tasks.js` (new functions, placed next to `refreshTaskSpecialTags` around line 9022)

**Interfaces:**
- Consumes: `taskItems(row)`, `taskPayload(row)`, `supabaseDb()`, `parseDateTime(value)` → `{date, ts, iso, ...}`, `addDays(isoDate, days)`, `normalizeIdentifier`, `normalizeText`, `flowActor()` → `{id, name}`, `WMS_TASKS_TABLE` constant, `renderTaskDetail(row)`, `renderReview()`.
- Produces: `taskNoShkMatches(row)` → array of match objects `{submission_id, nm, matched_at, decision, decided_by_id, decided_by_name, decided_at, snapshot}` (consumed by Task 3/4/5); `refreshTaskNoShkMatches(row)` → async, no return value, persists to `row.source_payload.no_shk_matches` and re-renders if still open.

- [ ] **Step 1: Add `state.noShkMatch`**

In `tasks.js`, the `state` object currently ends like this (verify exact current text before editing — line numbers drift):
```js
        achievements: {
            earned: new Map(),
            loading: false,
            error: "",
            syncDisabled: false,
            cleaning: false,
            loadPromise: null,
        },
    };
```
Change to:
```js
        achievements: {
            earned: new Map(),
            loading: false,
            error: "",
            syncDisabled: false,
            cleaning: false,
            loadPromise: null,
        },
        noShkMatch: {
            rowId: "",
            photoCache: {},
            cardInfoCache: {},
        },
    };
```

- [ ] **Step 2: Add `taskNoShkMatches` and `refreshTaskNoShkMatches`**

Add these two functions directly after `refreshTaskSpecialTags` (the function ending `row.tags = mergedTags; row.source_payload = nextPayload; if (state.taskDetail && state.taskDetail.rowId === row.id) renderTaskDetail(row); renderReview(); }` — currently around `tasks.js:9018`-`9022`):

```js
    function taskNoShkMatches(row) {
        const matches = taskPayload(row).no_shk_matches;
        return Array.isArray(matches) ? matches : [];
    }

    // Live per-task top-up, same shape as refreshTaskSpecialTags above: runs
    // after the card has already painted (fire-and-forget from
    // openTaskDetail), never during list rendering. Persists what it finds
    // onto the task itself so it "sticks" -- next open reads it straight
    // from source_payload, no re-query needed.
    async function refreshTaskNoShkMatches(row) {
        if (!row || !row.id || state.flow.debugMode) return;
        const items = taskItems(row);
        const nms = Array.from(new Set(items.map((item) => normalizeIdentifier(item.nm)).filter(Boolean)));
        if (!nms.length) return;
        let latestMovementIso = "";
        let latestMovementTs = -Infinity;
        items.forEach((item) => {
            const parsed = parseDateTime(item.movement);
            if (parsed.iso && parsed.ts > latestMovementTs) {
                latestMovementTs = parsed.ts;
                latestMovementIso = parsed.iso;
            }
        });
        const movementDate = parseDateTime(latestMovementIso).date;
        if (!movementDate) return;
        const dateFrom = addDays(movementDate, -1);
        const dateTo = addDays(movementDate, 5);
        const db = supabaseDb();
        if (!db) return;
        let candidates;
        try {
            const { data, error } = await db.rpc("wms_no_shk_task_matches", { p_nms: nms, p_date_from: dateFrom, p_date_to: dateTo });
            if (error) throw error;
            candidates = Array.isArray(data) ? data : [];
        } catch (_error) {
            return;
        }
        if (!candidates.length) return;
        const existing = taskNoShkMatches(row);
        const knownIds = new Set(existing.map((match) => match.submission_id));
        const additions = [];
        candidates.forEach((submission) => {
            if (!submission || !submission.id || knownIds.has(submission.id)) return;
            const wbCandidates = Array.isArray(submission.wb_nm_candidates) ? submission.wb_nm_candidates.map((nm) => normalizeIdentifier(nm)) : [];
            const matchedItem = items.find((item) => wbCandidates.includes(normalizeIdentifier(item.nm))) || items[0];
            additions.push({
                submission_id: submission.id,
                nm: matchedItem ? normalizeIdentifier(matchedItem.nm) : (nms[0] || ""),
                matched_at: new Date().toISOString(),
                decision: "pending",
                decided_by_id: "",
                decided_by_name: "",
                decided_at: "",
                snapshot: {
                    item_text: normalizeText(submission.item_text),
                    photo_path: normalizeText(submission.photo_path),
                    full_name: normalizeText(submission.full_name),
                    area: normalizeText(submission.area),
                    created_at: normalizeText(submission.created_at),
                    sticker_code: normalizeText(submission.sticker_code) || null,
                    item_type: normalizeText(submission.item_type),
                },
            });
        });
        if (!additions.length) return;
        const mergedMatches = existing.concat(additions);
        const nextPayload = { ...taskPayload(row), no_shk_matches: mergedMatches };
        try {
            const { error } = await db.from(WMS_TASKS_TABLE).update({ source_payload: nextPayload }).eq("id", row.id);
            if (error) throw error;
        } catch (error) {
            console.warn("Без ШК live match refresh failed:", error);
            return;
        }
        row.source_payload = nextPayload;
        if (state.taskDetail && state.taskDetail.rowId === row.id) renderTaskDetail(row);
        renderReview();
    }
```

- [ ] **Step 3: Wire it into `openTaskDetail`**

Current code (verify exact text first — `tasks.js:8464`-`8478`):
```js
        if (row.__isLight) {
            const wrap = $("taskDetailWrap");
            if (wrap) wrap.innerHTML = "<div class='empty-state'>Загружаю карточку…</div>";
            row = await hydrateFullTaskRow(row);
            if (!state.taskDetail || state.taskDetail.rowId !== id) return;
            // Same height-FLIP the history feed already uses (measure before,
            // render, animate the jump) instead of snapping straight from the
            // one-line loading placeholder to the full card.
            animateTaskDetailCardResize(() => renderTaskDetail(row));
            void refreshTaskSpecialTags(row);
            return;
        }
        renderTaskDetail(row);
        void refreshTaskSpecialTags(row);
    }
```
Change to:
```js
        if (row.__isLight) {
            const wrap = $("taskDetailWrap");
            if (wrap) wrap.innerHTML = "<div class='empty-state'>Загружаю карточку…</div>";
            row = await hydrateFullTaskRow(row);
            if (!state.taskDetail || state.taskDetail.rowId !== id) return;
            // Same height-FLIP the history feed already uses (measure before,
            // render, animate the jump) instead of snapping straight from the
            // one-line loading placeholder to the full card.
            animateTaskDetailCardResize(() => renderTaskDetail(row));
            void refreshTaskSpecialTags(row);
            void refreshTaskNoShkMatches(row);
            return;
        }
        renderTaskDetail(row);
        void refreshTaskSpecialTags(row);
        void refreshTaskNoShkMatches(row);
    }
```

- [ ] **Step 4: Verify syntax**

Run: `node --check tasks.js`
Expected: no output (exit code 0).

- [ ] **Step 5: Manual smoke test (background computation only, no UI yet)**

Serve the repo and use the debug-hook technique already established in this repo's own workflow: temporarily add `window.__wmsDebugRefreshNoShk = refreshTaskNoShkMatches;` right after the `refreshTaskNoShkMatches` function body, reload, in the browser console run `await window.__wmsDebugRefreshNoShk(someLoadedTaskRow)` against a task whose item `nm` and `movement` you've confirmed (via SQL) has a matching `intake_submissions` row with `wb_nm_candidates` containing that nm and `created_at` inside the window. Confirm `someLoadedTaskRow.source_payload.no_shk_matches` now contains the match. Remove the debug hook afterward and confirm `git diff --stat tasks.js` shows no leftover diff from it.

- [ ] **Step 6: Commit**

```bash
git add tasks.js
git commit -m "Add background nm+date matching against intake_submissions (Без ШК)"
```

---

## Task 3: `tasks.js` + `tasks.html` — pill in table/card + specialTags filter

**Files:**
- Modify: `tasks.js:7953` (`reviewRowCellsHtml` — add the pill to the status cell)
- Modify: `tasks.js:9697` (`renderTaskDetail` — add the pill row to the card)
- Modify: `tasks.js:779` (`createReviewFilterState` — add `specialTags` filter key)
- Modify: `tasks.js:7179` (`applySectionFilters` — filter on it)
- Modify: `tasks.js:7193` (`filterOptionsForRows` — expose the 3 fixed options)
- Modify: `tasks.js:7250` (`renderSectionFilters` — render the checkbox control)
- Modify: `tasks.html` (CSS — `.review-pill.tone-special`, `button.review-pill`, `.task-special-pills`)

**Interfaces:**
- Consumes: `taskNoShkMatches(row)` (Task 2), `reviewTags(row)`, `isSpecialTagLabel`, `escapeHtml`.
- Produces: `specialTagPillsHtml(row, options)` → HTML string, `options.interactive` toggles `<button data-special-pill>` (card) vs plain `<span>` (table, non-clickable — avoids the pill's click bubbling into the row's own `openTaskDetail` handler); `taskSpecialTagFilterValues(row)` → `string[]` subset of `["Без ШК", "Два ШК", "Пустая упаковка"]` (consumed by the filter step in this same task).

- [ ] **Step 1: Add `specialTagPillsHtml` and `taskSpecialTagFilterValues`**

Add right after `isSpecialTagLabel` (currently `tasks.js:6986`-`6989`):
```js
    function isSpecialTagLabel(tag) {
        const normalized = normalizeForMatch(tag);
        return normalized === "два шк" || normalized === "пустая упаковка";
    }
```
becomes:
```js
    function isSpecialTagLabel(tag) {
        const normalized = normalizeForMatch(tag);
        return normalized === "два шк" || normalized === "пустая упаковка";
    }

    const SPECIAL_TAG_ORDER = ["Без ШК", "Два ШК", "Пустая упаковка"];

    function taskSpecialTagFilterValues(row) {
        const tags = new Set(reviewTags(row));
        if (taskNoShkMatches(row).length) tags.add("Без ШК");
        return SPECIAL_TAG_ORDER.filter((tag) => tags.has(tag));
    }

    function specialTagPillsHtml(row, options) {
        const interactive = Boolean(options && options.interactive);
        const tags = taskSpecialTagFilterValues(row);
        return tags.map((tag) => interactive
            ? "<button type='button' class='review-pill tone-special' data-special-pill='" + escapeHtml(tag) + "'>" + escapeHtml(tag) + "</button>"
            : "<span class='review-pill tone-special'>" + escapeHtml(tag) + "</span>"
        ).join("");
    }
```
(`taskNoShkMatches` is defined in Task 2, earlier in the file at this point since Task 2 lands first.)

- [ ] **Step 2: Use it in the table's status cell**

Current (`tasks.js:7953`-`7962`):
```js
    function reviewRowCellsHtml(row, options) {
        const opts = options || {};
        const status = displayTaskStatus(row);
        const route = taskRouteLabel(row);
        const taskSub = opts.withSection ? (row.task_type || "-") + " · " + taskSectionName(row) : (row.task_type || "-");
        return "<td class='review-wrap-cell'><div class='review-task-title'>" + escapeHtml(displayTaskTitle(row)) + "</div><div class='review-task-sub'>" + escapeHtml(taskSub) + "</div>" + (route ? "<div class='review-task-route'>" + escapeHtml(route) + "</div>" : "") + "</td>"
            + "<td class='review-wrap-cell review-name-cell'><div class='review-name-clamp'>" + escapeHtml(truncateReviewName(taskItemName(row), 150) || "-") + "</div></td>"
            + "<td class='review-price-cell' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</td>"
            + "<td><span class='review-pill'>" + escapeHtml(status) + "</span>" + manualVerdictPillHtml(row) + "</td>";
    }
```
Change the last line to:
```js
        return "<td class='review-wrap-cell'><div class='review-task-title'>" + escapeHtml(displayTaskTitle(row)) + "</div><div class='review-task-sub'>" + escapeHtml(taskSub) + "</div>" + (route ? "<div class='review-task-route'>" + escapeHtml(route) + "</div>" : "") + "</td>"
            + "<td class='review-wrap-cell review-name-cell'><div class='review-name-clamp'>" + escapeHtml(truncateReviewName(taskItemName(row), 150) || "-") + "</div></td>"
            + "<td class='review-price-cell' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</td>"
            + "<td><span class='review-pill'>" + escapeHtml(status) + "</span>" + manualVerdictPillHtml(row) + specialTagPillsHtml(row) + "</td>";
    }
```

- [ ] **Step 3: Use it in the task detail card**

Current (`tasks.js:9693`-`9703`):
```js
        const predictedTs = predictedWriteoffTs(row);
        const countdownHtml = predictedTs !== null
            ? "<div id='taskWriteoffCountdown' class='task-detail-countdown " + writeoffCountdownTone(predictedTs) + "'>" + escapeHtml(formatWriteoffCountdown(predictedTs)) + "</div>"
            : "";
        target.innerHTML = "<div class='task-detail-head'><div>"
            + "<div class='task-detail-created'>Создано " + escapeHtml(formatRuDateTime(row.created_at)) + "</div>"
            + "<div class='task-detail-title-row'><h3 class='task-detail-title copyable' data-copy-value='" + escapeHtml(displayTaskTitle(row)) + "' title='Нажми, чтобы скопировать'>" + escapeHtml(displayTaskTitle(row)) + "</h3><div class='task-detail-price' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</div>" + countdownHtml + "</div>"
            + "<div class='review-table-subtitle'>" + escapeHtml(row.task_type || "-") + "</div></div>" + taskDetailActionButtons(row, readOnly) + "</div>"
            + "<div class='task-detail-body'>"
            + "<div class='task-info-grid'>" + taskDetailInfo(row) + "</div>"
            + taskTagsBox(row)
```
Change to:
```js
        const predictedTs = predictedWriteoffTs(row);
        const countdownHtml = predictedTs !== null
            ? "<div id='taskWriteoffCountdown' class='task-detail-countdown " + writeoffCountdownTone(predictedTs) + "'>" + escapeHtml(formatWriteoffCountdown(predictedTs)) + "</div>"
            : "";
        const specialPillsHtml = specialTagPillsHtml(row, { interactive: true });
        target.innerHTML = "<div class='task-detail-head'><div>"
            + "<div class='task-detail-created'>Создано " + escapeHtml(formatRuDateTime(row.created_at)) + "</div>"
            + "<div class='task-detail-title-row'><h3 class='task-detail-title copyable' data-copy-value='" + escapeHtml(displayTaskTitle(row)) + "' title='Нажми, чтобы скопировать'>" + escapeHtml(displayTaskTitle(row)) + "</h3><div class='task-detail-price' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</div>" + countdownHtml + "</div>"
            + "<div class='review-table-subtitle'>" + escapeHtml(row.task_type || "-") + "</div></div>" + taskDetailActionButtons(row, readOnly) + "</div>"
            + "<div class='task-detail-body'>"
            + "<div class='task-info-grid'>" + taskDetailInfo(row) + "</div>"
            + (specialPillsHtml ? "<div class='task-special-pills'>" + specialPillsHtml + "</div>" : "")
            + taskTagsBox(row)
```

- [ ] **Step 4: Bind the card pill's click (opens Task 4/5's modal for "Без ШК", reuses the existing special-info modal for the other two)**

Directly after the existing `data-special-tag` binding in `renderTaskDetail` (currently `tasks.js:9760`-`9762`):
```js
        target.querySelectorAll("[data-special-tag]").forEach((button) => {
            button.addEventListener("click", () => openSpecialInfoModal(row.id, button.dataset.specialTag || ""));
        });
```
Add immediately after:
```js
        target.querySelectorAll("[data-special-pill]").forEach((button) => {
            const tag = button.dataset.specialPill || "";
            button.addEventListener("click", () => {
                if (tag === "Без ШК") openNoShkMatchModal(row.id);
                else openSpecialInfoModal(row.id, tag);
            });
        });
```
(`openNoShkMatchModal` is added in Task 5 — this line references it ahead of its definition, which is fine in JS since it runs inside an event handler closure created after the whole file has loaded; `node --check` in Step 6 below still passes since it's only a syntax check.)

- [ ] **Step 5: Add the `specialTags` filter**

`createReviewFilterState` (`tasks.js:779`-`788`) — current:
```js
    function createReviewFilterState() {
        return {
            date: "",
            movementStatuses: new Set(),
            entityTypes: new Set(),
            taskStatuses: new Set(),
            sectionNames: new Set(),
            openKey: "",
        };
    }
```
Change to:
```js
    function createReviewFilterState() {
        return {
            date: "",
            movementStatuses: new Set(),
            entityTypes: new Set(),
            taskStatuses: new Set(),
            specialTags: new Set(),
            sectionNames: new Set(),
            openKey: "",
        };
    }
```

`hasActiveFilters` (`tasks.js:7098`-`7102`) — current:
```js
    function hasActiveFilters(mode) {
        const filters = sectionFilterState(mode);
        if (filters.date) return true;
        return ["movementStatuses", "entityTypes", "taskStatuses"].some((key) => filters[key] && filters[key].size > 0);
    }
```
Change the array to include the new key:
```js
        return ["movementStatuses", "entityTypes", "taskStatuses", "specialTags"].some((key) => filters[key] && filters[key].size > 0);
```

`applySectionFilters` (`tasks.js:7179`-`7191`) — current:
```js
    function applySectionFilters(mode, rows) {
        const filters = sectionFilterState(mode);
        return (rows || []).filter((row) => {
            const date = taskFilterDate(row);
            if (filters.date === FILTER_NONE) return false;
            if (filters.date && date !== filters.date) return false;
            const movementOptions = taskMovementStatusOptions(row);
            if (filters.movementStatuses.size && !movementOptions.some((value) => filters.movementStatuses.has(value))) return false;
            if (!filterMatchesSet(taskEntityFilterValue(row), filters.entityTypes)) return false;
            if (!filterMatchesSet(taskStatusFilterValue(row), filters.taskStatuses)) return false;
            return true;
        });
    }
```
Add one more check before `return true;`:
```js
    function applySectionFilters(mode, rows) {
        const filters = sectionFilterState(mode);
        return (rows || []).filter((row) => {
            const date = taskFilterDate(row);
            if (filters.date === FILTER_NONE) return false;
            if (filters.date && date !== filters.date) return false;
            const movementOptions = taskMovementStatusOptions(row);
            if (filters.movementStatuses.size && !movementOptions.some((value) => filters.movementStatuses.has(value))) return false;
            if (!filterMatchesSet(taskEntityFilterValue(row), filters.entityTypes)) return false;
            if (!filterMatchesSet(taskStatusFilterValue(row), filters.taskStatuses)) return false;
            if (filters.specialTags.size) {
                const rowTags = taskSpecialTagFilterValues(row);
                if (filters.specialTags.has(FILTER_NONE)) return false;
                if (!rowTags.some((tag) => filters.specialTags.has(tag))) return false;
            }
            return true;
        });
    }
```

`filterOptionsForRows` (`tasks.js:7193`-`7200`) — current:
```js
    function filterOptionsForRows(rows) {
        return {
            movementStatuses: sortedUnique((rows || []).flatMap(taskMovementStatusOptions)),
            entityTypes: ["shk", "tare"].filter((value) => (rows || []).some((row) => taskEntityFilterValue(row) === value)),
            taskStatuses: sortedUnique((rows || []).map(taskStatusFilterValue)),
            sectionNames: REVIEW_SECTIONS.filter((section) => (rows || []).some((row) => taskSectionName(row) === section)),
        };
    }
```
Change to:
```js
    function filterOptionsForRows(rows) {
        return {
            movementStatuses: sortedUnique((rows || []).flatMap(taskMovementStatusOptions)),
            entityTypes: ["shk", "tare"].filter((value) => (rows || []).some((row) => taskEntityFilterValue(row) === value)),
            taskStatuses: sortedUnique((rows || []).map(taskStatusFilterValue)),
            specialTags: SPECIAL_TAG_ORDER.filter((tag) => (rows || []).some((row) => taskSpecialTagFilterValues(row).includes(tag))),
            sectionNames: REVIEW_SECTIONS.filter((section) => (rows || []).some((row) => taskSectionName(row) === section)),
        };
    }
```

`renderSectionFilters` (`tasks.js:7250`-`7265`) — current final return:
```js
        return "<div class='review-filter-dropdown" + (entering ? " is-entering" : "") + "'><div class='review-filter-panel'>"
            + control("date", "Дата", dateSummary, "<div class='review-filter-options'><label class='review-filter-check'><input type='checkbox' data-review-filter-date-all='1' " + (!filters.date ? "checked" : "") + "> Выбрать всё</label></div>" + renderFilterCalendar(mode, baseRows))
            + control("movementStatuses", "Статус последнего движения", filterSummaryText(mode, "movementStatuses", options.movementStatuses), renderFilterCheckboxes(mode, "movementStatuses", options.movementStatuses))
            + control("entityTypes", "Тип задачи", filterSummaryText(mode, "entityTypes", options.entityTypes, taskEntityFilterLabel), renderFilterCheckboxes(mode, "entityTypes", options.entityTypes, taskEntityFilterLabel))
            + control("taskStatuses", "Статус", filterSummaryText(mode, "taskStatuses", options.taskStatuses), renderFilterCheckboxes(mode, "taskStatuses", options.taskStatuses) + "<div class='review-filter-empty-note' style='margin-top:8px'>Показано: " + escapeHtml(filteredRows.length) + " из " + escapeHtml(baseRows.length) + "</div>")
            + "</div></div>";
```
Add one more `control(...)` call before the closing tags:
```js
        return "<div class='review-filter-dropdown" + (entering ? " is-entering" : "") + "'><div class='review-filter-panel'>"
            + control("date", "Дата", dateSummary, "<div class='review-filter-options'><label class='review-filter-check'><input type='checkbox' data-review-filter-date-all='1' " + (!filters.date ? "checked" : "") + "> Выбрать всё</label></div>" + renderFilterCalendar(mode, baseRows))
            + control("movementStatuses", "Статус последнего движения", filterSummaryText(mode, "movementStatuses", options.movementStatuses), renderFilterCheckboxes(mode, "movementStatuses", options.movementStatuses))
            + control("entityTypes", "Тип задачи", filterSummaryText(mode, "entityTypes", options.entityTypes, taskEntityFilterLabel), renderFilterCheckboxes(mode, "entityTypes", options.entityTypes, taskEntityFilterLabel))
            + control("taskStatuses", "Статус", filterSummaryText(mode, "taskStatuses", options.taskStatuses), renderFilterCheckboxes(mode, "taskStatuses", options.taskStatuses) + "<div class='review-filter-empty-note' style='margin-top:8px'>Показано: " + escapeHtml(filteredRows.length) + " из " + escapeHtml(baseRows.length) + "</div>")
            + control("specialTags", "Спец-теги", filterSummaryText(mode, "specialTags", options.specialTags), renderFilterCheckboxes(mode, "specialTags", options.specialTags))
            + "</div></div>";
```
(`filterSummaryText`/`renderFilterCheckboxes` already work generically off any `filters[filterKey]` Set — no changes needed there; `FILTER_NONE`/checkbox binding in `bindSectionFilterEvents` also already works generically off `data-review-filter='<key>'`.)

- [ ] **Step 6: CSS**

In `tasks.html`, right after the existing `.review-pill` rules (currently around line 1052-1055):
```css
        .review-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 800; background: #f1f5f9; color: #334155; margin: 2px 0; }
        .review-pill.tone-green { background: #86efac; color: #14532d; }
        .review-pill.tone-yellow { background: #fde047; color: #713f12; }
        .review-pill.tone-red { background: #fca5a5; color: #7f1d1d; }
```
Add:
```css
        .review-pill.tone-green { background: #86efac; color: #14532d; }
        .review-pill.tone-yellow { background: #fde047; color: #713f12; }
        .review-pill.tone-red { background: #fca5a5; color: #7f1d1d; }
        .review-pill.tone-special { background: #fff7ed; color: #9a3412; margin-left: 4px; }
        button.review-pill { border: 0; cursor: pointer; font: inherit; }
        .task-special-pills { margin: 8px 0; display: flex; flex-wrap: wrap; gap: 6px; }
```

- [ ] **Step 7: Verify syntax**

Run: `node --check tasks.js`
Expected: no output.

- [ ] **Step 8: Manual smoke test**

Serve the repo on a fresh port, open the "Разбор" table for a section containing a task whose `source_payload.no_shk_matches` was populated in Task 2's test. Confirm: the "Без ШК" pill shows next to the status pill in the table row; opening that task's card shows the same pill above the tags box; the filter dropdown has a new "Спец-теги" control and filtering by "Без ШК" narrows the table to that task.

- [ ] **Step 9: Commit**

```bash
git add tasks.js tasks.html
git commit -m "Show Без ШК/Два ШК/Пустая упаковка pills in table+card, add specialTags filter"
```

---

## Task 4: `intake_search.js` — export hook + matched button state

**Files:**
- Modify: `intake_search.js` (near `openPhotoLightbox`, and inside `renderAssignRow`)
- Modify: `tasks.html` (CSS — `.intake-assign-btn.is-matched`)

**Interfaces:**
- Consumes: `matched_task_id`/`matched_shk` columns now returned by `wms_intake_submissions_search` (Task 1).
- Produces: `window.__openIntakeSubmissionCard(item)` — global function, `item` is a plain object shaped like a `wms_intake_submissions_search` row (or the smaller snapshot Task 5 builds from `no_shk_matches[i].snapshot`); opens the existing photo lightbox for it. Consumed by Task 5's history-row click handler.

- [ ] **Step 1: Export the lightbox-opening hook**

In `intake_search.js`, directly after the `openPhotoLightbox` function definition (currently ends around line 465 with `setModalOpen("intakeSearchPhotoModal", true); }`):
```js
    function openPhotoLightbox(item, id) {
        ...
        renderAssignRow(item);
        setModalOpen("intakeSearchPhotoModal", true);
    }
```
Add immediately after that closing brace:
```js
    // The one deliberate crack in this file's self-containment: tasks.js's
    // task-history "Найден без ШК" row needs to reopen this exact lightbox
    // for a specific submission it already has a snapshot of (no query
    // needed -- see refreshTaskNoShkMatches's `snapshot` field). Mirrors the
    // existing #openIntakeSearch DOM-click convention already used for
    // cross-file wiring in this app, just as a plain function instead.
    window.__openIntakeSubmissionCard = function (item) {
        if (!item || !item.photo_path) return;
        const id = "ext" + (++itemAutoId);
        itemsById.set(id, item);
        openPhotoLightbox(item, id);
    };
```

- [ ] **Step 2: Show the matched state on the assign button**

Current `renderAssignRow` (lines 478-502):
```js
    function renderAssignRow(item) {
        const btn = $("intakeAssignShkBtn");
        const form = $("intakeAssignShkForm");
        const input = $("intakeAssignShkInput");
        const preview = $("intakeAssignShkPreview");
        const msg = $("intakeAssignShkMsg");
        if (!btn || !form) return;
        btn.style.display = "";
        form.style.display = "none";
        if (input) input.value = "";
        if (preview) { preview.textContent = ""; preview.className = "intake-assign-preview"; }
        if (msg) { msg.textContent = ""; msg.className = "intake-assign-msg"; }
        if (item.sticker_code) {
            const decoded = decodeStickerCode(item.sticker_code) || item.sticker_code;
            btn.disabled = false;
            btn.classList.add("is-assigned");
            btn.textContent = "ШК присвоен: " + decoded;
            btn.setAttribute("data-copy-value", decoded);
        } else {
            btn.disabled = false;
            btn.classList.remove("is-assigned");
            btn.textContent = "Присвоить ШК";
            btn.removeAttribute("data-copy-value");
        }
    }
```
Change to:
```js
    function renderAssignRow(item) {
        const btn = $("intakeAssignShkBtn");
        const form = $("intakeAssignShkForm");
        const input = $("intakeAssignShkInput");
        const preview = $("intakeAssignShkPreview");
        const msg = $("intakeAssignShkMsg");
        if (!btn || !form) return;
        btn.style.display = "";
        form.style.display = "none";
        if (input) input.value = "";
        if (preview) { preview.textContent = ""; preview.className = "intake-assign-preview"; }
        if (msg) { msg.textContent = ""; msg.className = "intake-assign-msg"; }
        btn.classList.remove("is-assigned", "is-matched");
        if (item.matched_task_id) {
            const shk = item.matched_shk || "-";
            btn.disabled = false;
            btn.classList.add("is-matched");
            btn.textContent = "ШК опознан: " + shk;
            if (item.matched_shk) btn.setAttribute("data-copy-value", item.matched_shk);
            else btn.removeAttribute("data-copy-value");
        } else if (item.sticker_code) {
            const decoded = decodeStickerCode(item.sticker_code) || item.sticker_code;
            btn.disabled = false;
            btn.classList.add("is-assigned");
            btn.textContent = "ШК присвоен: " + decoded;
            btn.setAttribute("data-copy-value", decoded);
        } else {
            btn.disabled = false;
            btn.textContent = "Присвоить ШК";
            btn.removeAttribute("data-copy-value");
        }
    }
```
(The `matched_task_id` branch never falls through to the sticker-assignment form-opening click behavior — the button's `data-copy-value` makes the existing `assignBtn` click handler treat it as copy-only, exactly like the `is-assigned` case already does; there is no separate "open form" path for it, so assignment stays blocked once matched.)

- [ ] **Step 3: CSS**

In `tasks.html`, right after the existing `.intake-assign-btn.is-assigned` rule (currently `tasks.html:587`-`588`):
```css
        .intake-assign-btn { width: 100%; box-sizing: border-box; }
        .intake-assign-btn.is-assigned { background: #e2e8f0; color: #94a3b8; opacity: 1; cursor: default; box-shadow: none; }
```
Add:
```css
        .intake-assign-btn { width: 100%; box-sizing: border-box; }
        .intake-assign-btn.is-assigned { background: #e2e8f0; color: #94a3b8; opacity: 1; cursor: default; box-shadow: none; }
        .intake-assign-btn.is-matched { background: #dbeafe; color: #1d4ed8; opacity: 1; cursor: copy; box-shadow: none; }
```

- [ ] **Step 4: Verify syntax**

Run: `node --check intake_search.js`
Expected: no output.

- [ ] **Step 5: Manual smoke test**

Via SQL, set `matched_task_id`/`matched_shk` on one test `intake_submissions` row (any non-null uuid + a test shk string is enough for this check — it doesn't need to point at a real task yet). Serve the repo, open "Поиск товара без ШК" from the header menu, search to find that row, open its lightbox. Confirm the button shows "ШК опознан: <тестовый шк>" in blue and clicking it copies the value (no assignment form opens). In the browser console, confirm `typeof window.__openIntakeSubmissionCard === "function"`. Revert the test SQL update afterward (`update intake_submissions set matched_task_id = null, matched_shk = null where id = '<test id>'`).

- [ ] **Step 6: Commit**

```bash
git add intake_search.js tasks.html
git commit -m "Show matched-via-task state on Без ШК cards, export card-open hook"
```

---

## Task 5: `tasks.js` + `tasks.html` — match modal, confirm/reject, history

**Files:**
- Modify: `tasks.html` (new `<section id="noShkMatchModal">`, CSS)
- Modify: `tasks.js` (new modal render/open/close/confirm/reject functions, `TASK_HISTORY_EVENT_LABELS`, `taskHistoryFeedItemHtml`, delegated click handler, `initEvents` backdrop binding)

**Interfaces:**
- Consumes: `taskNoShkMatches(row)`/`specialTagPillsHtml` (Task 2/3), `window.__openIntakeSubmissionCard` (Task 4), `fetchWbCardInfo(nm)`, `buildWbImageCandidatesByNm(nm, options)`, `findFirstLoadableImage(urls)` (all pre-existing, from the "Быстрый разбор Без ШК" flow), `flowActor()`, `writeTaskHistory(row, eventType, payload)`, `findTaskRow(id)`, `setFlowModalOpen(id, open)`.
- Produces: `openNoShkMatchModal(taskId)` (called from Task 3's pill click handler).

- [ ] **Step 1: Add the modal markup**

In `tasks.html`, right after the `specialInfoModal` section (currently lines 2742-2744):
```html
<section id="specialInfoModal" class="tasks-flow-modal upload-work" aria-hidden="true">
    <div id="specialInfoWrap" class="tasks-flow-card task-small-card"></div>
</section>
```
Add:
```html
<section id="noShkMatchModal" class="tasks-flow-modal upload-work" aria-hidden="true">
    <div id="noShkMatchWrap" class="tasks-flow-card task-small-card"></div>
</section>
```

- [ ] **Step 2: CSS**

In `tasks.html`, right after the existing `.special-info-muted` rule (currently `tasks.html:1129`):
```css
        .special-info-muted { margin-top: 12px; color: #9a3412; font-size: 13px; font-weight: 800; }
```
Add:
```css
        .special-info-muted { margin-top: 12px; color: #9a3412; font-size: 13px; font-weight: 800; }
        #noShkMatchModal { z-index: 4460; }
        .no-shk-match-list { display: grid; gap: 14px; margin-top: 14px; }
        .no-shk-match-card { border: 1px solid rgba(15,23,42,.08); border-radius: 14px; padding: 12px; background: #fff; }
        .no-shk-match-photos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .no-shk-match-photos img { width: 100%; border-radius: 10px; object-fit: cover; max-height: 160px; display: block; background: #f1f5f9; }
        .no-shk-match-wb-loading { display: flex; align-items: center; justify-content: center; min-height: 80px; font-size: 12px; color: #94a3b8; text-align: center; padding: 8px; }
        .no-shk-match-meta { margin-top: 8px; font-size: 12px; color: #64748b; line-height: 1.5; }
        .no-shk-match-meta strong { color: #242038; }
        .no-shk-match-sticker { margin-top: 6px; font-size: 12px; color: #9a3412; font-weight: 800; }
        .no-shk-match-actions { display: flex; gap: 8px; margin-top: 10px; }
        .no-shk-match-actions .btn { flex: 1; }
        .no-shk-match-decision { margin-top: 10px; font-size: 12px; font-weight: 800; color: #64748b; }
        .no-shk-match-decision.is-confirmed { color: #15803d; cursor: pointer; }
        .no-shk-match-decision.is-rejected { color: #dc2626; }
```

- [ ] **Step 3: Add the sticker-decoding helper (self-contained duplicate, matching `intake_search.js`'s own convention)**

Add directly before `refreshTaskSpecialTags` (currently `tasks.js:8990`, right after the `// "Два ШК"/"Пустая упаковка" pills are computed once...` comment block starts):
```js
    // Duplicated from intake_search.js's decodeStickerCode (same file-level
    // self-containment convention that file itself documents) -- the match
    // modal needs to show an already-assigned sticker's plain value too.
    const NO_SHK_STICKER_CHAR_LIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const NO_SHK_STICKER_CHECK_SUM_BITS = 4n + 4n;
    const NO_SHK_STICKER_VALUE_BITS = 42n;
    function decodeNoShkStickerCode(barcode) {
        if (!barcode || barcode.charAt(0) !== "*") return null;
        const body = barcode.slice(1);
        const base = BigInt(NO_SHK_STICKER_CHAR_LIST.length);
        let result = 0n;
        for (let i = 0; i < body.length; i++) {
            const idx = NO_SHK_STICKER_CHAR_LIST.indexOf(body.charAt(body.length - 1 - i));
            if (idx < 0) return null;
            result += BigInt(idx) * (base ** BigInt(i));
        }
        const shkVal = (result >> NO_SHK_STICKER_CHECK_SUM_BITS) & ((1n << NO_SHK_STICKER_VALUE_BITS) - 1n);
        const remaining = result >> (NO_SHK_STICKER_CHECK_SUM_BITS + NO_SHK_STICKER_VALUE_BITS);
        if (remaining !== 0n || shkVal === 0n) return null;
        return shkVal.toString();
    }

    function noShkPhotoUrl(path) {
        return "https://bgphllmzmlwurfnbagho.supabase.co/storage/v1/object/public/intake-photos/" + path;
    }
```

- [ ] **Step 4: Add the modal render/open/close/confirm/reject functions**

Add directly after `refreshTaskNoShkMatches` (the last function added in Task 2):
```js
    function closeNoShkMatchModal() {
        setFlowModalOpen("noShkMatchModal", false);
    }

    function noShkSubmissionFromSnapshot(match) {
        const snapshot = match.snapshot || {};
        return {
            id: match.submission_id,
            item_text: snapshot.item_text,
            item_type: snapshot.item_type,
            area: snapshot.area,
            full_name: snapshot.full_name,
            created_at: snapshot.created_at,
            photo_path: snapshot.photo_path,
            sticker_code: snapshot.sticker_code,
            wb_nm_candidates: [],
        };
    }

    function noShkMatchCardHtml(match, index) {
        const snapshot = match.snapshot || {};
        const nm = normalizeIdentifier(match.nm);
        const hasWbPhoto = nm && Object.prototype.hasOwnProperty.call(state.noShkMatch.photoCache, nm);
        const wbPhoto = hasWbPhoto ? state.noShkMatch.photoCache[nm] : "";
        const hasWbInfo = nm && Object.prototype.hasOwnProperty.call(state.noShkMatch.cardInfoCache, nm);
        const wbInfo = hasWbInfo ? state.noShkMatch.cardInfoCache[nm] : null;
        const wbPhotoHtml = wbPhoto
            ? "<img src='" + escapeHtml(wbPhoto) + "' alt='Фото WB' loading='lazy'>"
            : "<div class='no-shk-match-wb-loading'>" + (hasWbPhoto ? "Фото WB не найдено" : "Ищу фото на WB...") + "</div>";
        const noShkPhotoHtml = snapshot.photo_path
            ? "<img src='" + escapeHtml(noShkPhotoUrl(snapshot.photo_path)) + "' alt='Фото без ШК' loading='lazy'>"
            : "<div class='no-shk-match-wb-loading'>Без фото</div>";
        const nameLine = wbInfo && wbInfo.found && wbInfo.name ? wbInfo.name : (snapshot.item_text || "Без наименования");
        const stickerHtml = (snapshot.item_type === "Шредер" || snapshot.sticker_code)
            ? "<div class='no-shk-match-sticker'>Присвоенный ШК: " + escapeHtml(snapshot.sticker_code ? (decodeNoShkStickerCode(snapshot.sticker_code) || snapshot.sticker_code) : "Шредер") + "</div>"
            : "";
        const decisionHtml = match.decision === "confirmed"
            ? "<div class='no-shk-match-decision is-confirmed' data-no-shk-open-card='" + index + "'>Опознано: " + escapeHtml(match.decided_by_name || match.decided_by_id || "-") + ", " + escapeHtml(formatRuDateTime(match.decided_at)) + " · открыть карточку без ШК</div>"
            : match.decision === "rejected"
            ? "<div class='no-shk-match-decision is-rejected'>Соответствие не подтверждено. " + escapeHtml(match.decided_by_name || match.decided_by_id || "-") + "</div>"
            : "<div class='no-shk-match-actions'>"
                + "<button type='button' class='btn btn-rect' data-no-shk-confirm='" + index + "'>Опознать</button>"
                + "<button type='button' class='btn btn-outline' data-no-shk-reject='" + index + "'>Не тот товар</button>"
                + "</div>";
        return "<article class='no-shk-match-card'>"
            + "<div class='no-shk-match-photos'>" + noShkPhotoHtml + wbPhotoHtml + "</div>"
            + "<div class='no-shk-match-meta'><strong>" + escapeHtml(nameLine) + "</strong><br>"
            + "Сфотографировал: " + escapeHtml(snapshot.full_name || "-") + " · Участок: " + escapeHtml(snapshot.area || "-") + " · " + escapeHtml(formatRuDateTime(snapshot.created_at)) + "</div>"
            + stickerHtml
            + decisionHtml
            + "</article>";
    }

    async function loadNoShkMatchPhoto(nm, row) {
        if (!nm || Object.prototype.hasOwnProperty.call(state.noShkMatch.photoCache, nm)) return;
        const urls = buildWbImageCandidatesByNm(nm, { maxPics: 1, maxHosts: 60 });
        const found = await findFirstLoadableImage(urls);
        state.noShkMatch.photoCache[nm] = found || "";
        if (state.noShkMatch.rowId === row.id && $("noShkMatchModal") && $("noShkMatchModal").classList.contains("active")) renderNoShkMatchModal(row);
    }

    async function loadNoShkMatchCardInfo(nm, row) {
        if (!nm || Object.prototype.hasOwnProperty.call(state.noShkMatch.cardInfoCache, nm)) return;
        const info = await fetchWbCardInfo(nm);
        state.noShkMatch.cardInfoCache[nm] = info;
        if (state.noShkMatch.rowId === row.id && $("noShkMatchModal") && $("noShkMatchModal").classList.contains("active")) renderNoShkMatchModal(row);
    }

    function renderNoShkMatchModal(row) {
        const target = $("noShkMatchWrap");
        if (!target) return;
        const matches = taskNoShkMatches(row);
        const cards = matches.length
            ? matches.map(noShkMatchCardHtml).join("")
            : "<div class='empty-state'>Совпадений не найдено.</div>";
        target.innerHTML = "<div class='work-head'><div><h3 class='work-title'>Без ШК</h3><p class='work-subtitle'>Вероятные совпадения по номенклатуре и дате.</p></div><button id='closeNoShkMatch' class='btn btn-square' type='button' aria-label='Закрыть'>×</button></div>"
            + "<div class='no-shk-match-list'>" + cards + "</div>";
        $("closeNoShkMatch").addEventListener("click", closeNoShkMatchModal);
        target.querySelectorAll("[data-no-shk-confirm]").forEach((button) => {
            button.addEventListener("click", () => { void confirmNoShkMatch(row, Number(button.dataset.noShkConfirm)); });
        });
        target.querySelectorAll("[data-no-shk-reject]").forEach((button) => {
            button.addEventListener("click", () => { void rejectNoShkMatch(row, Number(button.dataset.noShkReject)); });
        });
        target.querySelectorAll("[data-no-shk-open-card]").forEach((el) => {
            el.addEventListener("click", () => {
                const match = matches[Number(el.dataset.noShkOpenCard)];
                if (match && window.__openIntakeSubmissionCard) window.__openIntakeSubmissionCard(noShkSubmissionFromSnapshot(match));
            });
        });
        matches.forEach((match) => {
            const nm = normalizeIdentifier(match.nm);
            if (!nm) return;
            void loadNoShkMatchPhoto(nm, row);
            void loadNoShkMatchCardInfo(nm, row);
        });
    }

    function openNoShkMatchModal(taskId) {
        const row = findTaskRow(taskId);
        if (!row) return;
        state.noShkMatch.rowId = row.id;
        renderNoShkMatchModal(row);
        setFlowModalOpen("noShkMatchModal", true);
    }

    async function persistNoShkMatches(row, matches) {
        const db = supabaseDb();
        if (!db) return false;
        const nextPayload = { ...taskPayload(row), no_shk_matches: matches };
        try {
            const { error } = await db.from(WMS_TASKS_TABLE).update({ source_payload: nextPayload }).eq("id", row.id);
            if (error) throw error;
        } catch (error) {
            toast("Не удалось сохранить: " + (error && error.message ? error.message : String(error)), "error");
            return false;
        }
        row.source_payload = nextPayload;
        return true;
    }

    async function confirmNoShkMatch(row, index) {
        const matches = taskNoShkMatches(row).slice();
        const match = matches[index];
        if (!match || match.decision !== "pending") return;
        const db = supabaseDb();
        if (!db) return;
        const items = taskItems(row);
        const matchedItem = items.find((item) => normalizeIdentifier(item.nm) === normalizeIdentifier(match.nm)) || items[0];
        const shk = matchedItem ? normalizeIdentifier(matchedItem.shk) : "";
        const actor = flowActor();
        let markedRow;
        try {
            const { data, error } = await db.rpc("wms_intake_mark_matched", {
                p_submission_id: match.submission_id,
                p_task_id: row.id,
                p_shk: shk,
                p_actor_id: actor.id || null,
                p_actor_name: actor.name || null,
            });
            if (error) throw error;
            markedRow = Array.isArray(data) ? data[0] : null;
        } catch (error) {
            toast("Не удалось опознать: " + (error && error.message ? error.message : String(error)), "error");
            return;
        }
        if (!markedRow) {
            toast("Уже опознан в другой задаче.", "error");
            return;
        }
        const snapshot = match.snapshot || {};
        const commentParts = ["Товар обнаружен без ШК"];
        if (snapshot.sticker_code || snapshot.item_type === "Шредер") {
            const stickerLabel = snapshot.sticker_code ? (decodeNoShkStickerCode(snapshot.sticker_code) || snapshot.sticker_code) : "Шредер";
            commentParts.push("Обработан через стол старшего под ШК: " + stickerLabel);
        }
        await writeTaskHistory(row, "task_no_shk_found", { comment: commentParts.join(". "), submission: snapshot });
        matches[index] = { ...match, decision: "confirmed", decided_by_id: actor.id || "", decided_by_name: actor.name || "", decided_at: new Date().toISOString() };
        const saved = await persistNoShkMatches(row, matches);
        if (!saved) return;
        renderNoShkMatchModal(row);
        if (state.taskDetail && state.taskDetail.rowId === row.id) {
            renderTaskDetail(row);
            void loadAndRenderTaskDetailHistory(row);
        }
        renderReview();
    }

    async function rejectNoShkMatch(row, index) {
        const matches = taskNoShkMatches(row).slice();
        const match = matches[index];
        if (!match || match.decision !== "pending") return;
        const actor = flowActor();
        matches[index] = { ...match, decision: "rejected", decided_by_id: actor.id || "", decided_by_name: actor.name || "", decided_at: new Date().toISOString() };
        const saved = await persistNoShkMatches(row, matches);
        if (!saved) return;
        renderNoShkMatchModal(row);
    }
```

- [ ] **Step 5: History label + feed rendering**

`TASK_HISTORY_EVENT_LABELS` (currently `tasks.js:9124`-`9141`) — add one entry:
```js
    const TASK_HISTORY_EVENT_LABELS = {
        task_created: "Задача создана",
        task_claimed: "Взято в работу (Flow)",
        task_skipped: "Пропущено (Flow)",
        task_started: "Начато",
        task_completed: "Завершено",
        task_deferred: "Отложено",
        task_sent_to_search: "Передача отправлена на поиск",
        task_reopened: "Переоткрыто вручную",
        task_auto_reopened: "Переоткрыто автоматически",
        task_system_closed: "Закрыто системой (актуализация)",
        task_prespisok_second_line: "Передано на вторую линию предсписка",
        task_prespisok_uploaded: "ШК в предсписке",
        task_cross_module_touch: "Продолжилось в другом модуле",
        task_incoming_flow_request_received: "Получен входящий запрос",
        task_incoming_box_last_movement: "Последнее движение",
        task_incoming_box_analysis: "Разбор",
        task_no_shk_found: "Найден без ШК",
    };
```

`taskHistoryFeedItemHtml` (currently `tasks.js:9180`-`9242`) — current:
```js
        const isForecast = item.event_type === "task_predicted_writeoff";
        const isStatusLine = item.event_type === "task_last_movement_status";
        const isCreated = item.event_type === "task_created";
        const isUploadMarker = item.event_type === "task_prespisok_uploaded";
        const isCrossModuleTouch = item.event_type === "task_cross_module_touch";
        const isSystemClosed = item.event_type === "task_system_closed" || isSystemCompletionVerdict(payload.verdict);
        const isSystem = isSystemClosed || isForecast || isCreated || isUploadMarker || (!rawActorName && !rawActorId);
        const actorDisplay = (isSystemClosed || isForecast || isCreated || isUploadMarker) ? "Система" : (rawActorName || rawActorId || "Система");
        const verdict = isForecast
            ? "Прогнозируемая дата списания"
            : isStatusLine
            ? (normalizeText(payload.status_code) || "Статус ШК")
            : isCreated
            ? "Создана задача"
            : isUploadMarker
            ? "ШК в предсписке"
            : isCrossModuleTouch
            ? "Продолжилось в: " + (normalizeText(payload.new_task_type) || "другом модуле")
            : isSystemClosed
            ? "Закрыто автоматически"
            : (normalizeText(payload.verdict) && normalizeText(payload.verdict) !== "Не выбран" ? payload.verdict : taskHistoryEventLabel(item.event_type));
```
Change to (add `isNoShkFound` and its verdict branch — actor/isSystem lists stay untouched since this event always carries a real `flowActor()`, so the existing fallback `(!rawActorName && !rawActorId)` already does the right thing):
```js
        const isForecast = item.event_type === "task_predicted_writeoff";
        const isStatusLine = item.event_type === "task_last_movement_status";
        const isCreated = item.event_type === "task_created";
        const isUploadMarker = item.event_type === "task_prespisok_uploaded";
        const isCrossModuleTouch = item.event_type === "task_cross_module_touch";
        const isNoShkFound = item.event_type === "task_no_shk_found";
        const isSystemClosed = item.event_type === "task_system_closed" || isSystemCompletionVerdict(payload.verdict);
        const isSystem = isSystemClosed || isForecast || isCreated || isUploadMarker || (!rawActorName && !rawActorId);
        const actorDisplay = (isSystemClosed || isForecast || isCreated || isUploadMarker) ? "Система" : (rawActorName || rawActorId || "Система");
        const verdict = isForecast
            ? "Прогнозируемая дата списания"
            : isStatusLine
            ? (normalizeText(payload.status_code) || "Статус ШК")
            : isCreated
            ? "Создана задача"
            : isUploadMarker
            ? "ШК в предсписке"
            : isCrossModuleTouch
            ? "Продолжилось в: " + (normalizeText(payload.new_task_type) || "другом модуле")
            : isSystemClosed
            ? "Закрыто автоматически"
            : isNoShkFound
            ? "Найден без ШК"
            : (normalizeText(payload.verdict) && normalizeText(payload.verdict) !== "Не выбран" ? payload.verdict : taskHistoryEventLabel(item.event_type));
```

Further down in the same function, current (`tasks.js:9226`-`9234`):
```js
        const attachedLink = normalizeText(payload.extra_value);
        const isClickableLink = /^https?:\/\//i.test(attachedLink);
        if (attachedLink) commentParts.push(attachedLink);
        const historyTone = isSystem ? "" : (VERDICT_TONE[payload.verdict] || "yellow");
        const rowClass = "task-chat-row"
            + (isForecast ? " task-chat-row-forecast" : "")
            + (historyTone ? " task-chat-row-" + historyTone : "")
            + (isClickableLink ? " task-chat-row-linked" : "");
        const linkAttr = isClickableLink ? " data-history-link='" + escapeHtml(attachedLink) + "' title='Открыть ссылку'" : "";
```
Change to:
```js
        const attachedLink = normalizeText(payload.extra_value);
        const isClickableLink = /^https?:\/\//i.test(attachedLink);
        if (attachedLink) commentParts.push(attachedLink);
        const noShkSubmission = isNoShkFound && payload.submission && typeof payload.submission === "object" ? payload.submission : null;
        const historyTone = isSystem ? "" : (VERDICT_TONE[payload.verdict] || "yellow");
        const rowClass = "task-chat-row"
            + (isForecast ? " task-chat-row-forecast" : "")
            + (historyTone ? " task-chat-row-" + historyTone : "")
            + (isClickableLink || noShkSubmission ? " task-chat-row-linked" : "");
        const linkAttr = isClickableLink
            ? " data-history-link='" + escapeHtml(attachedLink) + "' title='Открыть ссылку'"
            : noShkSubmission
            ? " data-history-no-shk='" + escapeHtml(JSON.stringify(noShkSubmission)) + "' title='Открыть карточку без ШК'"
            : "";
```

- [ ] **Step 6: Delegated click handler + modal backdrop close**

Current (`tasks.js:17887`-`17890`):
```js
        document.addEventListener("click", (event) => {
            const row = event.target.closest && event.target.closest("[data-history-link]");
            if (row) window.open(row.dataset.historyLink, "_blank", "noopener");
        });
```
Change to:
```js
        document.addEventListener("click", (event) => {
            const row = event.target.closest && event.target.closest("[data-history-link]");
            if (row) window.open(row.dataset.historyLink, "_blank", "noopener");
            const noShkRow = event.target.closest && event.target.closest("[data-history-no-shk]");
            if (noShkRow && window.__openIntakeSubmissionCard) {
                try { window.__openIntakeSubmissionCard(JSON.parse(noShkRow.dataset.historyNoShk)); } catch (_error) { return; }
            }
        });
```

Current (`tasks.js:17871`):
```js
        $("specialInfoModal").addEventListener("click", (event) => { if (event.target === $("specialInfoModal")) closeSpecialInfoModal(); });
```
Add immediately after:
```js
        $("specialInfoModal").addEventListener("click", (event) => { if (event.target === $("specialInfoModal")) closeSpecialInfoModal(); });
        $("noShkMatchModal").addEventListener("click", (event) => { if (event.target === $("noShkMatchModal")) closeNoShkMatchModal(); });
```

- [ ] **Step 7: Verify syntax**

Run: `node --check tasks.js`
Expected: no output.

- [ ] **Step 8: Manual smoke test — full flow**

Using the same test task/`intake_submissions` pairing set up in Task 2's Step 5 (with a fresh `matched_task_id is null` row so the RPC accepts it):
1. Open the task card, click the "Без ШК" pill → modal opens with one card, photos lazily fill in, name/employee/area show.
2. Click "Опознать" → toast-free success (no error toast), modal card switches to "Опознано: ...", task history feed (scroll the card) shows a new "Найден без ШК" row with the comment; click that row → the existing "без ШК" lightbox opens showing the same photo/name/employee.
3. Via SQL, confirm `intake_submissions.matched_task_id` now equals the task's id and `matched_shk` is set.
4. Set up a second test task with the same nm/date window pointing at the same (now-claimed) `intake_submissions` row; open its card — confirm the RPC no longer returns that row as a candidate (no pill, or a different unrelated match only).
5. Repeat with a fresh unclaimed match and click "Не тот товар" instead — confirm no new history row appears, and reopening the modal shows "Соответствие не подтверждено. <имя>" with no buttons for that card.

- [ ] **Step 9: Commit**

```bash
git add tasks.js tasks.html
git commit -m "Add Без ШК match modal: confirm/reject, task history, claim intake row"
```

---

## Final check

- [ ] Re-read the spec (`docs/superpowers/specs/2026-09-28-task-no-shk-matching-design.md`) section by section against the 5 tasks above — confirm sections A-F each map to at least one task (A→Task1/2, B→Task2, C→Task3, D→Task5, E→Task3, F→Task1/4/5).
- [ ] `node --check tasks.js` and `node --check intake_search.js` both clean.
- [ ] `supabase migration list` shows `202609280004` as pushed (or flag to the user that it still needs pushing).
