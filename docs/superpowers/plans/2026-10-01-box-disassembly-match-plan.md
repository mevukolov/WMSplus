# Короб "Без ШК": сплит-панель опознания при разборе — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При клике на товар во время разбора короба "Без ШК" открывать сплит-панель: слева — текущая карточка товара, справа — поиск/автоподбор совпадений по открытым задачам и по "чистым списаниям" (`pure_losses_rep`), с опознанием без обязательного физического стикера.

**Architecture:** Переиспользуем максимум существующего кода (поиск по `pure_losses_rep`, вердикт по задаче, read-only просмотр содержимого короба) и добавляем новое только там, где реально нет готового: живой RPC сопоставления с задачами на один товар, сам UI правой панели, обобщение "решённости" товара, освобождение полки/новая зона при завершении короба.

**Tech Stack:** Vanilla JS (без сборки), Supabase (Postgres + PostgREST + RPC), `pg_trgm` для нечёткого сопоставления (уже используется в этой же сессии).

**Spec:** `docs/superpowers/specs/2026-10-01-box-disassembly-match-design.md`

## Global Constraints

- Миграции применяются ТОЛЬКО через уже задокументированный обходной путь (дубли префиксов дат ломают `supabase db push`): переместить 4 файла-дубля из `supabase/migrations/` в `supabase/.migration_holdout/`, выполнить `supabase db push --linked`, вернуть файлы обратно. Список файлов-дублей: `202608170001_weeek_manual_wmi_mp_pc_upload.sql`, `202609020005_wms_shifts_roster.sql`, `202609040003_upsert_wms_external_requests_from_json.sql`, `202609040004_upsert_wms_external_requests_source_shk_ids.sql`.
- После каждой миграции — подтвердить через `supabase db query --linked "<SQL>"` на реальных данных, не только "применилось без ошибки".
- После каждого изменения `tasks.js`, `intake_search.js`, `no_shk_zone.js` — `node --check <file>` обязателен перед коммитом.
- Пороговые значения нечёткого сопоставления — те же, что уже в проде: `similarity(название) >= 0.5`, `similarity(бренд) >= 0.35`, через `pg_trgm.similarity_threshold` выставленный в `0.35` для работы индексного оператора `%`.
- Коммитить после каждой задачи отдельным коммитом (однострочные сообщения на русском, в стиле уже сделанных в этой сессии коммитов).
- Визуальная QA нового CSS/разметки — тем же методом, что использовался всю сессию: вытащить текущий `<style>`-блок `tasks.html` в скретч-файл, собрать образец разметки по реальным render-функциям, открыть в Browser pane. Живой логин с реальными данными для этого приложения недоступен (подтверждено в этой сессии — фейковый `localStorage.user` не проходит проверку, Supabase Auth обязателен), поэтому глубокая интерактивная проверка финального потока в бою — не часть этого плана; сверка задним числом на реальных данных делается через `supabase db query --linked`.

---

### Task 1: Миграция — `matched_pure_loss_id`, новый RPC опознания по списанию, ужесточение клейма по задаче

**Files:**
- Create: `supabase/migrations/202610010008_intake_matched_pure_loss.sql`

**Interfaces:**
- Produces: столбец `intake_submissions.matched_pure_loss_id text`; RPC `wms_intake_mark_matched_pure_loss(p_submission_id uuid, p_pure_loss_id text, p_shk text, p_actor_id text, p_actor_name text) returns table(id uuid, matched_pure_loss_id text, matched_shk text)`; обновлённый `wms_intake_mark_matched` (та же сигнатура, но WHERE учитывает оба пути клейма).

- [ ] **Step 1: Написать миграцию**

Текущее определение `wms_intake_mark_matched` (проверено `pg_get_functiondef` в сессии):
```sql
create or replace function public.wms_intake_mark_matched(p_submission_id uuid, p_task_id uuid, p_shk text, p_actor_id text, p_actor_name text)
 returns table (id uuid, matched_task_id uuid, matched_shk text)
 language plpgsql security definer set search_path to 'public'
as $function$
begin
    return query
    update public.intake_submissions
    set matched_task_id = p_task_id, matched_shk = p_shk, matched_at = now(),
        matched_by_id = p_actor_id, matched_by_name = p_actor_name
    where intake_submissions.id = p_submission_id
      and intake_submissions.matched_task_id is null
    returning intake_submissions.id, intake_submissions.matched_task_id, intake_submissions.matched_shk;
end;
$function$
```

Файл `supabase/migrations/202610010008_intake_matched_pure_loss.sql`:
```sql
-- Опознание товара "без ШК" теперь может прийти по двум независимым путям --
-- по задаче (matched_task_id, уже есть) и по строке "чистых списаний"
-- pure_losses_rep (новое). matched_pure_loss_id хранит идентификатор
-- pure_losses_rep текстом -- точное имя PK-колонки той таблицы определяется
-- динамически на клиенте тем же способом, что buildNoShkPureUpdateFilters
-- (tasks.js) уже делает для обновления самой pure_losses_rep, так что здесь
-- просто текст, не foreign key.
alter table public.intake_submissions
    add column if not exists matched_pure_loss_id text;

-- Клейм по задаче и клейм по списанию должны исключать друг друга --
-- иначе один и тот же товар можно опознать дважды разными путями.
create or replace function public.wms_intake_mark_matched(p_submission_id uuid, p_task_id uuid, p_shk text, p_actor_id text, p_actor_name text)
 returns table (id uuid, matched_task_id uuid, matched_shk text)
 language plpgsql security definer set search_path to 'public'
as $function$
begin
    return query
    update public.intake_submissions
    set matched_task_id = p_task_id, matched_shk = p_shk, matched_at = now(),
        matched_by_id = p_actor_id, matched_by_name = p_actor_name
    where intake_submissions.id = p_submission_id
      and intake_submissions.matched_task_id is null
      and intake_submissions.matched_pure_loss_id is null
    returning intake_submissions.id, intake_submissions.matched_task_id, intake_submissions.matched_shk;
end;
$function$;

create or replace function public.wms_intake_mark_matched_pure_loss(p_submission_id uuid, p_pure_loss_id text, p_shk text, p_actor_id text, p_actor_name text)
 returns table (id uuid, matched_pure_loss_id text, matched_shk text)
 language plpgsql security definer set search_path to 'public'
as $function$
begin
    return query
    update public.intake_submissions
    set matched_pure_loss_id = p_pure_loss_id, matched_shk = p_shk, matched_at = now(),
        matched_by_id = p_actor_id, matched_by_name = p_actor_name
    where intake_submissions.id = p_submission_id
      and intake_submissions.matched_task_id is null
      and intake_submissions.matched_pure_loss_id is null
    returning intake_submissions.id, intake_submissions.matched_pure_loss_id, intake_submissions.matched_shk;
end;
$function$;

grant execute on function public.wms_intake_mark_matched_pure_loss(uuid, text, text, text, text) to anon;

-- wms_no_shk_box_contents -- короб-грид и разобранные короба должны видеть
-- оба пути опознания, не только sticker_code. Return-тип меняется (новые
-- out-параметры), поэтому дроп обязателен -- CREATE OR REPLACE не может
-- менять форму RETURNS TABLE.
drop function if exists public.wms_no_shk_box_contents(uuid);

create function public.wms_no_shk_box_contents(p_box_id uuid)
 returns table (
    id uuid, item_text text, category text, item_type text, area text,
    full_name text, created_at timestamptz, photo_path text, sticker_code text,
    wb_nm_candidates jsonb, wb_nm_checked_at timestamptz,
    matched_task_id uuid, matched_pure_loss_id text, matched_shk text
 )
 language sql stable security definer set search_path to 'public'
as $function$
    select id, item_text, category, item_type, area, full_name, created_at, photo_path, sticker_code,
           wb_nm_candidates, wb_nm_checked_at, matched_task_id, matched_pure_loss_id, matched_shk
    from public.intake_submissions
    where box_id = p_box_id
    order by created_at asc;
$function$;

grant execute on function public.wms_no_shk_box_contents(uuid) to anon;
```

- [ ] **Step 2: Применить миграцию через обходной путь**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609020005_wms_shifts_roster.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql supabase/.migration_holdout/ 2>/dev/null
supabase db push --linked
mv supabase/.migration_holdout/202608170001_weeek_manual_wmi_mp_pc_upload.sql supabase/migrations/ 2>/dev/null
mv supabase/.migration_holdout/202609020005_wms_shifts_roster.sql supabase/migrations/ 2>/dev/null
mv supabase/.migration_holdout/202609040003_upsert_wms_external_requests_from_json.sql supabase/migrations/ 2>/dev/null
mv supabase/.migration_holdout/202609040004_upsert_wms_external_requests_source_shk_ids.sql supabase/migrations/ 2>/dev/null
```

- [ ] **Step 3: Проверить на реальных данных**

```bash
supabase db query --linked "select column_name from information_schema.columns where table_name='intake_submissions' and column_name='matched_pure_loss_id';"
supabase db query --linked "select proname from pg_proc where proname in ('wms_intake_mark_matched_pure_loss','wms_no_shk_box_contents');"
```
Ожидается: первая команда вернёт одну строку (`matched_pure_loss_id`), вторая — обе функции.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202610010008_intake_matched_pure_loss.sql
git commit -m "Добавляем matched_pure_loss_id и RPC опознания товара без ШК по списанию"
```

---

### Task 2: Новый RPC — живой поиск совпадений по задачам для одного товара

**Files:**
- Create: `supabase/migrations/202610010009_no_shk_item_task_matches.sql`

**Interfaces:**
- Consumes: `wms_task_nm_index`, `wms_nm_directory` (уже существуют, те же пороги 0.5/0.35, что в `wms_no_shk_bulk_match_and_persist`), `intake_submissions.wb_nm_candidates`.
- Produces: RPC `wms_no_shk_item_task_matches(p_submission_id uuid, p_query text default null) returns table(task_id uuid, task_nm text, title text, price numeric, is_tare boolean, match_name text, match_brand text)`. Пустой `p_query` → автоподбор по `wb_nm_candidates` товара (точный nm + нечёткий бренд+название), без окна по дате. Непустой `p_query` → ручной поиск: числовой запрос — точный nm/ШК, текстовый — `ilike` по `wms_nm_directory.name/brand`.

- [ ] **Step 1: Написать миграцию**

```sql
-- Живой аналог wms_no_shk_bulk_match_and_persist, но на ОДИН товар и без
-- окна по дате -- это разовый клик оператора с товаром в руках при разборе
-- короба, не автоматическая очередь на закрытие задачи, так что ложные
-- совпадения дёшево отклонить глазами. Те же пороги similarity, что и там:
-- название >= 0.5, бренд >= 0.35.
create or replace function public.wms_no_shk_item_task_matches(
    p_submission_id uuid,
    p_query text default null
) returns table (
    task_id uuid,
    task_nm text,
    title text,
    price numeric,
    is_tare boolean,
    match_name text,
    match_brand text
) language plpgsql
security definer
set search_path = public
stable
as $$
declare
    v_candidate_nms text[];
    v_query text := nullif(trim(coalesce(p_query, '')), '');
begin
    perform set_config('pg_trgm.similarity_threshold', '0.35', true);

    if v_query is not null then
        if v_query ~ '^[0-9]+$' then
            return query
            select distinct ti.task_id, ti.nm, t.title, t.source_price_sum,
                   (t.source_tare_id is not null and t.source_tare_id <> '0'),
                   coalesce(d.name, ''), coalesce(d.brand, '')
            from public.wms_task_nm_index ti
            join public.wms_tasks t on t.id = ti.task_id
            left join public.wms_nm_directory d on d.nm = ti.nm
            where t.is_deleted = false
              and t.opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
              and (ti.nm = v_query
                   or exists (select 1 from jsonb_array_elements_text(coalesce(t.source_shk_ids, '[]'::jsonb)) s where s = v_query))
            limit 60;
            return;
        end if;

        return query
        select distinct ti.task_id, ti.nm, t.title, t.source_price_sum,
               (t.source_tare_id is not null and t.source_tare_id <> '0'),
               d.name, d.brand
        from public.wms_nm_directory d
        join public.wms_task_nm_index ti on ti.nm = d.nm
        join public.wms_tasks t on t.id = ti.task_id
        where t.is_deleted = false
          and t.opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
          and (lower(d.name) like '%' || lower(v_query) || '%' or lower(d.brand) like '%' || lower(v_query) || '%')
        limit 60;
        return;
    end if;

    select array_agg(distinct elem) into v_candidate_nms
    from public.intake_submissions s, jsonb_array_elements_text(coalesce(s.wb_nm_candidates, '[]'::jsonb)) elem
    where s.id = p_submission_id;

    if v_candidate_nms is null or array_length(v_candidate_nms, 1) = 0 then
        return;
    end if;

    return query
    select distinct ti.task_id, ti.nm, t.title, t.source_price_sum,
           (t.source_tare_id is not null and t.source_tare_id <> '0'),
           coalesce(d.name, ''), coalesce(d.brand, '')
    from public.wms_task_nm_index ti
    join public.wms_tasks t on t.id = ti.task_id
    left join public.wms_nm_directory d on d.nm = ti.nm
    where t.is_deleted = false
      and t.opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
      and ti.nm = any(v_candidate_nms)

    union

    select distinct ti.task_id, ti.nm, t.title, t.source_price_sum,
           (t.source_tare_id is not null and t.source_tare_id <> '0'),
           dt.name, dt.brand
    from public.wms_task_nm_index ti
    join public.wms_tasks t on t.id = ti.task_id
    join public.wms_nm_directory dt
        on dt.nm = ti.nm
       and dt.brand is not null and trim(dt.brand) <> '' and lower(trim(dt.brand)) <> 'нет бренда'
       and dt.name is not null and trim(dt.name) <> ''
    join public.wms_nm_directory dc
        on dc.nm = any(v_candidate_nms)
       and lower(trim(dc.name)) % lower(trim(dt.name))
       and lower(trim(dc.brand)) % lower(trim(dt.brand))
       and similarity(lower(trim(dc.name)), lower(trim(dt.name))) >= 0.5
       and similarity(lower(trim(dc.brand)), lower(trim(dt.brand))) >= 0.35
       and dc.brand is not null and trim(dc.brand) <> '' and lower(trim(dc.brand)) <> 'нет бренда'
       and dc.name is not null and trim(dc.name) <> ''
    where t.is_deleted = false
      and t.opp_verdict not in ('Найден/Релиз/Списан', 'Система - Движение')
    limit 60;
end;
$$;

grant execute on function public.wms_no_shk_item_task_matches(uuid, text) to anon;
```

- [ ] **Step 2: Применить миграцию** (тот же обходной путь, что в Task 1, Step 2)

- [ ] **Step 3: Проверить на реальных данных**

```bash
supabase db query --linked "
select s.id, jsonb_array_length(coalesce(s.wb_nm_candidates,'[]'::jsonb)) as candidates
from intake_submissions s
where s.wb_nm_candidates is not null and jsonb_array_length(s.wb_nm_candidates) > 0
limit 1;
"
```
Взять `id` из результата и прогнать:
```bash
supabase db query --linked "select * from wms_no_shk_item_task_matches('<id из предыдущего шага>'::uuid, null) limit 5;"
supabase db query --linked "select * from wms_no_shk_item_task_matches('<тот же id>'::uuid, 'футболка') limit 5;"
```
Ожидается: обе команды выполняются без ошибки (0 строк — тоже валидный результат, если совпадений действительно нет).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202610010009_no_shk_item_task_matches.sql
git commit -m "Добавляем живой RPC поиска совпадений по задачам для одного товара без ШК"
```

---

### Task 3: Рефакторинг — выносим ядро опознания задачи из `confirmNoShkMatch`

**Files:**
- Modify: `tasks.js:9642-9752` (текущий `confirmNoShkMatch`, итоговые границы могут сместиться на несколько строк после правок предыдущих задач сессии — искать по сигнатуре `async function confirmNoShkMatch(row, index)`)

**Interfaces:**
- Produces: `async function resolveNoShkTaskMatch(row, matchedItem, submissionId, snapshot)` → `Promise<{ ok: boolean, targetRow?: object, matchedItem?: object, hasSticker?: boolean }>`. Используется и `confirmNoShkMatch` (Task 3), и новой правой панелью (Task 5) через `window.__resolveNoShkBoxItemTaskMatch` (Task 6).
- Consumes: `supabaseDb`, `taskItems`, `isTareTask`, `updateTareTaskItems`, `splitTaskFromTare`, `SAVE_RPC`, `WMS_TASKS_TABLE`, `WMS_TASK_SELECT_COLUMNS`, `renderReview`, `refreshExpandedSections`, `writeTaskHistory`, `decodeNoShkStickerCode`, `applyNoShkStickerVerdict`, `flowActor`, `normalizeIdentifier`, `toast` — все уже существуют в той же области `tasks.js`.

Текущее полное тело `confirmNoShkMatch` (для справки, строки `tasks.js:9642-9752`):
```js
    async function confirmNoShkMatch(row, index) {
        const matches = taskNoShkMatches(row).slice();
        const match = matches[index];
        if (!match || match.decision !== "pending") return;
        const db = supabaseDb();
        if (!db) return;
        const items = taskItems(row);
        const matchedItem = matchedItemForNoShk(row, match);
        const shk = matchedItem ? normalizeIdentifier(matchedItem.shk) : "";
        const actor = flowActor();
        const hasSticker = Boolean(match.snapshot && (match.snapshot.sticker_code || match.snapshot.item_type === "Шредер"));
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

        let targetRow = row;
        if (isTareTask(row) && matchedItem && items.length > 1) {
            try {
                const rest = items.filter((item) => item.shk !== matchedItem.shk);
                const tareData = await updateTareTaskItems(row, rest, { edited_at: new Date().toISOString() });
                if (tareData) Object.assign(row, tareData);
                const splitTask = splitTaskFromTare(row, matchedItem);
                const { data: splitData, error: splitError } = await db.rpc(SAVE_RPC, { p_tasks: [splitTask], p_run: {} });
                if (splitError) throw splitError;
                const splitId = Array.isArray(splitData && splitData.task_ids) ? splitData.task_ids[0] : null;
                if (splitId) {
                    const { data: freshRow, error: fetchError } = await db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).eq("id", splitId).maybeSingle();
                    if (fetchError) throw fetchError;
                    if (freshRow) targetRow = freshRow;
                }
                renderReview();
                refreshExpandedSections();
            } catch (error) {
                toast("Не удалось отделить ШК из тары: " + (error && error.message ? error.message : String(error)), "error");
                return;
            }
        }

        const snapshot = match.snapshot || {};
        const commentParts = ["Товар обнаружен без ШК"];
        if (snapshot.sticker_code || snapshot.item_type === "Шредер") {
            const stickerLabel = snapshot.sticker_code ? (decodeNoShkStickerCode(snapshot.sticker_code) || snapshot.sticker_code) : "Шредер";
            commentParts.push("Обработан через стол старшего под ШК: " + stickerLabel);
        }
        await writeTaskHistory(targetRow, "task_no_shk_found", { comment: commentParts.join(". "), submission: snapshot });
        if (snapshot.sticker_code) {
            const stickerLabel = decodeNoShkStickerCode(snapshot.sticker_code) || snapshot.sticker_code;
            await applyNoShkStickerVerdict(targetRow, stickerLabel);
        }
        const confirmedMatch = { ...match, decision: "confirmed", decided_by_id: actor.id || "", decided_by_name: actor.name || "", decided_at: new Date().toISOString() };

        if (targetRow === row) {
            matches[index] = confirmedMatch;
            const saved = await persistNoShkMatches(row, matches);
            if (!saved) return;
        } else {
            matches.splice(index, 1);
            await persistNoShkMatches(row, matches);
            await persistNoShkMatches(targetRow, taskNoShkMatches(targetRow).concat([confirmedMatch]));
            toast("ШК " + (matchedItem ? matchedItem.shk : "") + " извлечён из тары в отдельную задачу.", "success");
        }

        renderNoShkMatchModal(row);
        if (state.taskDetail && state.taskDetail.rowId === row.id) {
            renderTaskDetail(row);
            void loadAndRenderTaskDetailHistory(row);
        }
        renderReview();

        if (hasSticker) {
            await playTaskCompletionCelebration("yellow", $("noShkMatchWrap"));
            closeNoShkMatchModal();
        } else {
            void openNoShkStickerPrompt({ shk, snapshot: match.snapshot || {} });
        }
    }
```

- [ ] **Step 1: Заменить на разбитую версию**

Найти в `tasks.js` функцию `confirmNoShkMatch` (ищется по сигнатуре `async function confirmNoShkMatch(row, index) {`, см. полный текст выше для точного совпадения) и заменить целиком на:

```js
    // Общее ядро "опознать товар как найденный по задаче" -- клейм,
    // разделение тары, история, вердикт по стикеру стола старшего.
    // Не знает про очередь no_shk_matches -- это забота вызывающей
    // стороны (confirmNoShkMatch для очереди, window.__resolveNoShkBoxItemTaskMatch
    // для сплит-панели разбора короба). snapshot нужен только за
    // .sticker_code/.item_type для текста истории -- подходит как
    // match.snapshot (очередь), так и сырой item из wms_no_shk_box_contents
    // (разбор короба), формы совместимы.
    async function resolveNoShkTaskMatch(row, matchedItem, submissionId, snapshot) {
        const db = supabaseDb();
        if (!db) return { ok: false };
        const items = taskItems(row);
        const shk = matchedItem ? normalizeIdentifier(matchedItem.shk) : "";
        const actor = flowActor();
        let markedRow;
        try {
            const { data, error } = await db.rpc("wms_intake_mark_matched", {
                p_submission_id: submissionId,
                p_task_id: row.id,
                p_shk: shk,
                p_actor_id: actor.id || null,
                p_actor_name: actor.name || null,
            });
            if (error) throw error;
            markedRow = Array.isArray(data) ? data[0] : null;
        } catch (error) {
            toast("Не удалось опознать: " + (error && error.message ? error.message : String(error)), "error");
            return { ok: false };
        }
        if (!markedRow) {
            toast("Уже опознан в другой задаче.", "error");
            return { ok: false };
        }

        let targetRow = row;
        if (isTareTask(row) && matchedItem && items.length > 1) {
            try {
                const rest = items.filter((item) => item.shk !== matchedItem.shk);
                const tareData = await updateTareTaskItems(row, rest, { edited_at: new Date().toISOString() });
                if (tareData) Object.assign(row, tareData);
                const splitTask = splitTaskFromTare(row, matchedItem);
                const { data: splitData, error: splitError } = await db.rpc(SAVE_RPC, { p_tasks: [splitTask], p_run: {} });
                if (splitError) throw splitError;
                const splitId = Array.isArray(splitData && splitData.task_ids) ? splitData.task_ids[0] : null;
                if (splitId) {
                    const { data: freshRow, error: fetchError } = await db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).eq("id", splitId).maybeSingle();
                    if (fetchError) throw fetchError;
                    if (freshRow) targetRow = freshRow;
                }
                renderReview();
                refreshExpandedSections();
            } catch (error) {
                toast("Не удалось отделить ШК из тары: " + (error && error.message ? error.message : String(error)), "error");
                return { ok: false };
            }
        }

        const snap = snapshot || {};
        const commentParts = ["Товар обнаружен без ШК"];
        if (snap.sticker_code || snap.item_type === "Шредер") {
            const stickerLabel = snap.sticker_code ? (decodeNoShkStickerCode(snap.sticker_code) || snap.sticker_code) : "Шредер";
            commentParts.push("Обработан через стол старшего под ШК: " + stickerLabel);
        }
        await writeTaskHistory(targetRow, "task_no_shk_found", { comment: commentParts.join(". "), submission: snap });
        const hasSticker = Boolean(snap.sticker_code || snap.item_type === "Шредер");
        if (snap.sticker_code) {
            const stickerLabel = decodeNoShkStickerCode(snap.sticker_code) || snap.sticker_code;
            await applyNoShkStickerVerdict(targetRow, stickerLabel);
        }
        if (targetRow !== row) {
            toast("ШК " + (matchedItem ? matchedItem.shk : "") + " извлечён из тары в отдельную задачу.", "success");
        }
        return { ok: true, targetRow, matchedItem, hasSticker };
    }

    async function confirmNoShkMatch(row, index) {
        const matches = taskNoShkMatches(row).slice();
        const match = matches[index];
        if (!match || match.decision !== "pending") return;
        const matchedItem = matchedItemForNoShk(row, match);
        const result = await resolveNoShkTaskMatch(row, matchedItem, match.submission_id, match.snapshot || {});
        if (!result.ok) return;
        const { targetRow, hasSticker } = result;
        const actor = flowActor();
        const confirmedMatch = { ...match, decision: "confirmed", decided_by_id: actor.id || "", decided_by_name: actor.name || "", decided_at: new Date().toISOString() };

        if (targetRow === row) {
            matches[index] = confirmedMatch;
            const saved = await persistNoShkMatches(row, matches);
            if (!saved) return;
        } else {
            matches.splice(index, 1);
            await persistNoShkMatches(row, matches);
            await persistNoShkMatches(targetRow, taskNoShkMatches(targetRow).concat([confirmedMatch]));
        }

        renderNoShkMatchModal(row);
        if (state.taskDetail && state.taskDetail.rowId === row.id) {
            renderTaskDetail(row);
            void loadAndRenderTaskDetailHistory(row);
        }
        renderReview();

        if (hasSticker) {
            await playTaskCompletionCelebration("yellow", $("noShkMatchWrap"));
            closeNoShkMatchModal();
        } else {
            void openNoShkStickerPrompt({ shk: matchedItem ? normalizeIdentifier(matchedItem.shk) : "", snapshot: match.snapshot || {} });
        }
    }
```

Поведение `confirmNoShkMatch` не меняется ни в одном сценарии (точная копия прежней логики, просто разбитая на две функции) — единственная разница в том, что тост "ШК ... извлечён из тары" теперь печатается из `resolveNoShkTaskMatch`, а не из `confirmNoShkMatch`, текст и условие те же.

- [ ] **Step 2: Синтаксическая проверка**

```bash
node --check tasks.js
```
Ожидается: без ошибок.

- [ ] **Step 3: Проверить, что очередь "Быстрая проверка «Без ШК»" не сломалась**

Это чистый рефакторинг без изменения поведения — риск только в опечатке при переносе. Перечитать получившийся `confirmNoShkMatch` и свежедобавленный `resolveNoShkTaskMatch` целиком и построчно сверить с оригиналом выше (блок "Текущее полное тело") на предмет пропущенных строк/перепутанных переменных.

- [ ] **Step 4: Commit**

```bash
git add tasks.js
git commit -m "Выносим ядро опознания задачи из confirmNoShkMatch в resolveNoShkTaskMatch"
```

---

### Task 4: Сплит-разметка и CSS — правая панель поиска в `#intakeSearchPhotoModal`

**Files:**
- Modify: `tasks.html:2761-2785` (секция `#intakeSearchPhotoModal`)
- Modify: `tasks.html:581-601` (CSS `.intake-photo-lightbox` и соседние правила)

**Interfaces:**
- Produces: DOM-узлы `#intakeMatchPanel`, `#intakeMatchQueryInput`, `#intakeMatchQueryBtn`, `#intakeMatchTasksList`, `#intakeMatchPureList` -- потребляются `intake_search.js` в Task 5.

Текущая разметка (`tasks.html:2761-2785`):
```html
<section id="intakeSearchPhotoModal" class="tasks-flow-modal upload-work" aria-hidden="true">
    <div class="tasks-flow-card intake-photo-modal-card">
        <div class="work-head">
            <div><h3 class="work-title">Фото товара</h3></div>
            <button id="closeIntakeSearchPhoto" class="btn btn-square" type="button" aria-label="Закрыть">×</button>
        </div>
        <div id="intakeSearchPhotoWrap" class="intake-photo-lightbox">
            <img id="intakeSearchPhotoImg" alt="Фото товара">
            <div class="intake-photo-lightbox-info">
                <div id="intakeSearchPhotoInfoContent"></div>
                <div id="intakeAssignShkRow" class="intake-assign-row">
                    <button id="intakeAssignShkBtn" class="btn btn-rect intake-assign-btn" type="button">Присвоить ШК</button>
                    <div id="intakeAssignShkForm" class="intake-assign-form" style="display:none;">
                        <div class="intake-assign-input-row">
                            <input id="intakeAssignShkInput" class="input" type="text" placeholder="Отсканируйте стикер">
                            <button id="intakeAssignShkCancel" class="btn btn-square intake-assign-cancel" type="button" aria-label="Отмена">×</button>
                        </div>
                        <div id="intakeAssignShkPreview" class="intake-assign-preview"></div>
                        <div id="intakeAssignShkMsg" class="intake-assign-msg"></div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>
```

- [ ] **Step 1: Добавить третью колонку и свернуть разметку в неё**

Заменить на:
```html
<section id="intakeSearchPhotoModal" class="tasks-flow-modal upload-work" aria-hidden="true">
    <div class="tasks-flow-card intake-photo-modal-card">
        <div class="work-head">
            <div><h3 class="work-title">Фото товара</h3></div>
            <button id="closeIntakeSearchPhoto" class="btn btn-square" type="button" aria-label="Закрыть">×</button>
        </div>
        <div id="intakeSearchPhotoWrap" class="intake-photo-lightbox">
            <img id="intakeSearchPhotoImg" alt="Фото товара">
            <div class="intake-photo-lightbox-info">
                <div id="intakeSearchPhotoInfoContent"></div>
                <div id="intakeAssignShkRow" class="intake-assign-row">
                    <button id="intakeAssignShkBtn" class="btn btn-rect intake-assign-btn" type="button">Присвоить ШК</button>
                    <div id="intakeAssignShkForm" class="intake-assign-form" style="display:none;">
                        <div class="intake-assign-input-row">
                            <input id="intakeAssignShkInput" class="input" type="text" placeholder="Отсканируйте стикер">
                            <button id="intakeAssignShkCancel" class="btn btn-square intake-assign-cancel" type="button" aria-label="Отмена">×</button>
                        </div>
                        <div id="intakeAssignShkPreview" class="intake-assign-preview"></div>
                        <div id="intakeAssignShkMsg" class="intake-assign-msg"></div>
                    </div>
                </div>
            </div>
            <div id="intakeMatchPanel" class="intake-match-panel" style="display:none;">
                <div class="intake-match-search-row">
                    <input id="intakeMatchQueryInput" class="input" type="search" autocomplete="off" placeholder="НМ, бренд или наименование">
                    <button id="intakeMatchQueryBtn" class="btn btn-rect" type="button">Найти</button>
                </div>
                <div id="intakeMatchStatus" class="intake-match-status"></div>
                <div class="intake-match-section">
                    <div class="intake-match-section-title">Задачи</div>
                    <div id="intakeMatchTasksList" class="intake-match-list"></div>
                </div>
                <div class="intake-match-section">
                    <div class="intake-match-section-title">Списания</div>
                    <div id="intakeMatchPureList" class="intake-match-list"></div>
                </div>
            </div>
        </div>
    </div>
</section>
```

- [ ] **Step 2: CSS — расширить карточку и добавить стили панели**

Найти (`tasks.html:581-584`):
```css
        .tasks-flow-card.intake-photo-modal-card { width: min(1200px, 92vw); max-width: min(1200px, 92vw); min-width: 0; height: 85vh; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; }
        .intake-photo-lightbox { flex: 1; min-height: 0; display: flex; gap: 20px; margin-top: 14px; }
        .intake-photo-lightbox img { flex: 1 1 auto; min-width: 0; width: 100%; height: 100%; object-fit: contain; border-radius: 12px; background: #0f0f14; display: block; }
        .intake-photo-lightbox-info { width: min(320px, 34vw); flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
```

Заменить на:
```css
        .tasks-flow-card.intake-photo-modal-card { width: min(1200px, 92vw); max-width: min(1200px, 92vw); min-width: 0; height: 85vh; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; }
        .tasks-flow-card.intake-photo-modal-card.has-match-panel { width: min(1560px, 96vw); max-width: min(1560px, 96vw); }
        .intake-photo-lightbox { flex: 1; min-height: 0; display: flex; gap: 20px; margin-top: 14px; }
        .intake-photo-lightbox img { flex: 1 1 auto; min-width: 0; width: 100%; height: 100%; object-fit: contain; border-radius: 12px; background: #0f0f14; display: block; }
        .intake-photo-lightbox-info { width: min(320px, 34vw); flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
        .intake-match-panel { width: min(420px, 36vw); flex: 0 0 auto; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; border-left: 1px solid rgba(15,23,42,.08); padding-left: 20px; }
        .intake-match-search-row { display: flex; gap: 8px; }
        .intake-match-search-row .input { flex: 1; }
        .intake-match-status { font-size: 12px; color: #64748b; }
        .intake-match-section-title { font-size: 12px; font-weight: 900; color: #64748b; text-transform: uppercase; letter-spacing: .02em; margin-bottom: 6px; }
        .intake-match-list { display: flex; flex-direction: column; gap: 8px; }
        .intake-match-card { position: relative; display: flex; gap: 10px; align-items: center; border: 1px solid rgba(15,23,42,.08); border-radius: 10px; padding: 8px; }
        .intake-match-card-photo { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; background: #f1f5f9; flex: 0 0 auto; }
        .intake-match-card-main { min-width: 0; flex: 1; }
        .intake-match-card-title { font-weight: 800; font-size: 13px; color: #242038; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .intake-match-card-sub { font-size: 12px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .intake-match-card-found-btn { display: none; position: absolute; right: 8px; top: 50%; transform: translateY(-50%); }
        .intake-match-card:hover .intake-match-card-found-btn { display: inline-flex; }
        .intake-match-empty { font-size: 12px; color: #94a3b8; padding: 8px 0; }
```

- [ ] **Step 3: Визуальная QA**

Вытащить обновлённый `<style>` из `tasks.html` в скретч-файл (тем же способом, что использовался всю сессию: `python3 -c "..."` с regex на `<style>(.*?)</style>`), собрать образец разметки с `.intake-match-panel` и 2-3 карточками `.intake-match-card` внутри `.intake-photo-lightbox.has-match-panel`-эквивалента, открыть в Browser pane, скриншотом подтвердить, что кнопка "Опознать" скрыта по умолчанию и появляется при `:hover` (или через прямой JS-вызов `element.dispatchEvent` / добавление класса, если эмуляция реального hover в headless-окружении этой сессии не сработает надёжно — в этой сессии уже была история с CSS-переходами, не отражавшимися в скриншоте без принудительного `requestAnimationFrame`).

- [ ] **Step 4: Commit**

```bash
git add tasks.html
git commit -m "Добавляем разметку и CSS правой панели поиска при опознании товара без ШК"
```

---

### Task 5: `intake_search.js` — логика правой панели (поиск, автоподбор, опознание)

**Files:**
- Modify: `intake_search.js` (вокруг `openPhotoLightbox`, строка 428, и `window.__openIntakeSubmissionCard`, строка 517)

**Interfaces:**
- Consumes: `window.__resolveNoShkBoxItemTaskMatch(submission, taskId, taskNm)` и `window.__resolveNoShkBoxItemPureMatch(submission, pureRow)` (из Task 6, `tasks.js`); RPC `wms_no_shk_item_task_matches`; существующие `fetchNoShkPureRows`/`buildNoShkVisualVariants`/`sortNoShkPureRows` -- ЭТИ функции живут в `tasks.js`, не в `intake_search.js`, поэтому правая панель вызывает их тоже через новый мост `window.__searchNoShkPureRows(queryOrNull, seedNm)` (Task 6), а не напрямую (разные файлы, разные замыкания).
- Produces: `openPhotoLightbox(item, id, isBoxMode)` (новый третий параметр, по умолчанию `false`/falsy — все существующие вызовы без него продолжают работать как раньше).

- [ ] **Step 1: Передать флаг "режим разбора короба" через всю цепочку**

Найти (`intake_search.js:517`):
```js
    window.__openIntakeSubmissionCard = function (item) {
        if (!item || !item.photo_path) return;
        const id = "ext" + (++itemAutoId);
        itemsById.set(id, item);
        openPhotoLightbox(item, id);
    };
```
Заменить на:
```js
    window.__openIntakeSubmissionCard = function (item, isBoxMode) {
        if (!item || !item.photo_path) return;
        const id = "ext" + (++itemAutoId);
        itemsById.set(id, item);
        openPhotoLightbox(item, id, Boolean(isBoxMode));
    };
```

В `no_shk_zone.js:1347` (клик по тайлу короба, см. Task 6) вызов станет `window.__openIntakeSubmissionCard(item, true)` — остальные вызовы (`intake_search.js:706`, `tasks.js:9481`/`18901` -- точные номера могут сместиться, искать по тексту `window.__openIntakeSubmissionCard(`) не трогаем, они и так передают один аргумент, `isBoxMode` там `undefined` → falsy.

- [ ] **Step 2: Открыть/скрыть панель в `openPhotoLightbox`**

Найти сигнатуру (`intake_search.js:428`):
```js
    function openPhotoLightbox(item, id) {
```
Заменить на:
```js
    function openPhotoLightbox(item, id, isBoxMode) {
```

Найти конец функции (последние строки перед `window.__openIntakeSubmissionCard`, точный текст из уже изученного тела):
```js
        renderAssignRow(item);
        setModalOpen("intakeSearchPhotoModal", true);
    }
```
Заменить на:
```js
        renderAssignRow(item);
        const card = document.querySelector("#intakeSearchPhotoModal .intake-photo-modal-card");
        const panel = $("intakeMatchPanel");
        if (card) card.classList.toggle("has-match-panel", Boolean(isBoxMode));
        if (panel) panel.style.display = isBoxMode ? "" : "none";
        if (isBoxMode) void openNoShkMatchPanel(item);
        setModalOpen("intakeSearchPhotoModal", true);
    }
```

- [ ] **Step 3: Реализовать саму панель**

Добавить перед `window.__openIntakeSubmissionCard` (после `openPhotoLightbox`'s закрывающей скобки):
```js
    let noShkMatchPanelToken = 0;

    function noShkMatchCardHtml(kind, id, photoUrl, title, sub) {
        const photo = photoUrl
            ? "<img class='intake-match-card-photo' src='" + escapeHtmlLocal(photoUrl) + "' loading='lazy' alt=''>"
            : "<div class='intake-match-card-photo'></div>";
        return "<article class='intake-match-card' data-match-kind='" + kind + "' data-match-id='" + escapeHtmlLocal(String(id)) + "'>"
            + photo
            + "<div class='intake-match-card-main'>"
            + "<div class='intake-match-card-title'>" + escapeHtmlLocal(title || "Без наименования") + "</div>"
            + "<div class='intake-match-card-sub'>" + escapeHtmlLocal(sub || "-") + "</div>"
            + "</div>"
            + "<button type='button' class='btn btn-rect intake-match-card-found-btn' data-match-found='" + kind + ":" + escapeHtmlLocal(String(id)) + "'>Опознать</button>"
            + "</article>";
    }

    async function openNoShkMatchPanel(item) {
        const input = $("intakeMatchQueryInput");
        const btn = $("intakeMatchQueryBtn");
        if (input) input.value = "";
        if (btn) {
            const fresh = btn.cloneNode(true);
            btn.replaceWith(fresh);
        }
        $("intakeMatchQueryBtn").addEventListener("click", () => { void runNoShkMatchSearch(item); });
        if (input) {
            const freshInput = input.cloneNode(true);
            input.replaceWith(freshInput);
            freshInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") { event.preventDefault(); void runNoShkMatchSearch(item); }
            });
        }
        await runNoShkMatchSearch(item);
    }

    async function runNoShkMatchSearch(item) {
        const token = ++noShkMatchPanelToken;
        const status = $("intakeMatchStatus");
        const tasksList = $("intakeMatchTasksList");
        const pureList = $("intakeMatchPureList");
        if (!tasksList || !pureList) return;
        const query = ($("intakeMatchQueryInput") && $("intakeMatchQueryInput").value || "").trim();
        if (status) status.textContent = "Ищу...";
        tasksList.innerHTML = "<div class='intake-match-empty'>Ищу...</div>";
        pureList.innerHTML = "<div class='intake-match-empty'>Ищу...</div>";
        const client = db();
        if (!client) return;
        const [taskResult, pureResult] = await Promise.all([
            client.rpc("wms_no_shk_item_task_matches", { p_submission_id: item.id, p_query: query || null }),
            window.__searchNoShkPureRows ? window.__searchNoShkPureRows(query || null, item) : Promise.resolve({ rows: [] }),
        ]);
        if (token !== noShkMatchPanelToken) return;
        if (status) status.textContent = "";
        const taskRows = taskResult && !taskResult.error && Array.isArray(taskResult.data) ? taskResult.data : [];
        tasksList.innerHTML = taskRows.length
            ? taskRows.map((row) => noShkMatchCardHtml("task", row.task_id, "", row.title || row.match_name || "Без наименования", [row.match_brand, row.is_tare ? "Тара" : ""].filter(Boolean).join(" · "))).join("")
            : "<div class='intake-match-empty'>Совпадений не найдено.</div>";
        tasksList.dataset.rows = JSON.stringify(taskRows);
        const pureRows = (pureResult && pureResult.rows) || [];
        pureList.innerHTML = pureRows.length
            ? pureRows.map((row, index) => noShkMatchCardHtml("pure", index, "", row.__name || "Без наименования", row.__brand || "-")).join("")
            : "<div class='intake-match-empty'>Совпадений не найдено.</div>";
        pureList.dataset.rows = JSON.stringify(pureRows);
        bindNoShkMatchFoundButtons(item, taskRows, pureRows);
    }

    function bindNoShkMatchFoundButtons(item, taskRows, pureRows) {
        document.querySelectorAll("[data-match-found]").forEach((button) => {
            button.addEventListener("click", () => {
                const [kind, idRaw] = button.dataset.matchFound.split(":");
                if (kind === "task") {
                    const row = taskRows.find((candidate) => String(candidate.task_id) === idRaw);
                    if (row) void confirmNoShkTaskMatch(item, row);
                } else {
                    const row = pureRows[Number(idRaw)];
                    if (row) void confirmNoShkPureMatch(item, row);
                }
            });
        });
    }

    async function confirmNoShkTaskMatch(item, taskRow) {
        if (!window.__resolveNoShkBoxItemTaskMatch) return;
        const result = await window.__resolveNoShkBoxItemTaskMatch(item, taskRow.task_id, taskRow.task_nm);
        if (!result || !result.ok) return;
        item.matched_task_id = taskRow.task_id;
        item.matched_shk = result.shk || "";
        if (window.__onNoShkItemAssigned) window.__onNoShkItemAssigned(item);
        setModalOpen("intakeSearchPhotoModal", false);
    }

    async function confirmNoShkPureMatch(item, pureRow) {
        if (!window.__resolveNoShkBoxItemPureMatch) return;
        const result = await window.__resolveNoShkBoxItemPureMatch(item, pureRow);
        if (!result || !result.ok) return;
        const actor = currentAdminActor();
        const client = db();
        if (client) {
            await client.rpc("wms_intake_mark_matched_pure_loss", {
                p_submission_id: item.id,
                p_pure_loss_id: result.pureLossId || "",
                p_shk: result.shk || "",
                p_actor_id: actor.id || null,
                p_actor_name: actor.name || null,
            });
        }
        item.matched_pure_loss_id = result.pureLossId || "";
        item.matched_shk = result.shk || "";
        if (window.__onNoShkItemAssigned) window.__onNoShkItemAssigned(item);
        setModalOpen("intakeSearchPhotoModal", false);
    }
```

Примечание для реализующего: `currentAdminActor()` уже используется в этом файле (`confirmAssignSticker`, строка ~613) — тот же паттерн. `db()` — локальный Supabase-клиент этого файла (уже используется повсеместно). `result.pureLossId` — см. Task 6: `pure_losses_rep`'s PK-колонка называется по-разному в зависимости от окружения (`buildNoShkPureUpdateFilters` уже решает это перебором), поэтому `pureLossId` вычисляется в `tasks.js` через уже существующий `noShkRowSignature(pureRow)`, а не берётся напрямую как `pureRow.id` (которого может не быть под этим именем).

- [ ] **Step 2: Синтаксическая проверка**

```bash
node --check intake_search.js
```

- [ ] **Step 3: Commit**

```bash
git add intake_search.js
git commit -m "Добавляем панель поиска/опознания товара по задачам и списаниям при разборе короба"
```

---

### Task 6: `tasks.js` — мосты для правой панели (поиск по списаниям, опознание обоих типов)

**Files:**
- Modify: `tasks.js` (добавить новые функции рядом с `markNoShkPureAsFound`, строка 5596, и `resolveNoShkTaskMatch` из Task 3)

**Interfaces:**
- Produces: `window.__searchNoShkPureRows(query, seedItem)`, `window.__resolveNoShkBoxItemTaskMatch(submission, taskId, taskNm)`, `window.__resolveNoShkBoxItemPureMatch(submission, pureRow)` — потребляются `intake_search.js` (Task 5).
- Consumes: `fetchNoShkPureRows`, `buildNoShkVisualVariants`, `queryNoShkPureColumn`, `noShkPureName`, `noShkPureBrand`, `noShkPureShk`, `noShkPureNm`, `noShkRowSignature`, `updateNoShkPureRow`, `noShkPurePatchVariants`, `isUnknownColumnError` (все уже в `tasks.js`), `resolveNoShkTaskMatch` (Task 3), `taskItems`, `normalizeIdentifier`, `supabaseDb`, `WMS_TASKS_TABLE`, `WMS_TASK_SELECT_COLUMNS`, `toast`, `renderReview`.

- [ ] **Step 1: Добавить мост поиска по списаниям**

`fetchNoShkPureRows(queryText)` уже ищет текстом. Для автоподбора (query пустой) нужно засеять поиск из собственного nm/бренда/названия товара вместо текста инпута. Добавить после `markNoShkPureAsFound` (конец функции — `tasks.js:5629`, ищется по следующей строке в файле):

```js
    // Поиск по "чистым списаниям" для сплит-панели разбора короба -- мост
    // для intake_search.js (другой файл/замыкание). Пустой query --
    // автоподбор: берём собственные wb_nm_candidates товара, резолвим
    // имя/бренд через wms_nm_directory, и используем это как затравку для
    // того же fetchNoShkPureRows (точный механизм visual-variant фуззи,
    // что и у неподключённого "Разбор «Без ШК»" -- тут просто вызывается
    // напрямую, без обвязки state.noShkReview, которая тому экрану не
    // нужна в этом контексте).
    async function seedQueryFromSubmission(item) {
        const db = supabaseDb();
        if (!db) return "";
        const candidates = Array.isArray(item.wb_nm_candidates) ? item.wb_nm_candidates.map(normalizeIdentifier).filter(Boolean) : [];
        if (!candidates.length) return "";
        try {
            const { data, error } = await db.from("wms_nm_directory").select("nm,name,brand").in("nm", candidates.slice(0, 20)).limit(5);
            if (error || !Array.isArray(data) || !data.length) return "";
            const best = data.find((row) => row.name || row.brand);
            return best ? [best.brand, best.name].filter(Boolean).join(" ") : "";
        } catch (_error) {
            return "";
        }
    }

    window.__searchNoShkPureRows = async function (query, seedItem) {
        let effectiveQuery = normalizeText(query);
        if (!effectiveQuery && seedItem) effectiveQuery = await seedQueryFromSubmission(seedItem);
        if (!effectiveQuery) return { rows: [] };
        const result = await fetchNoShkPureRows(effectiveQuery);
        const rows = (result.rows || []).map((row) => ({ ...row, __name: noShkPureName(row), __brand: noShkPureBrand(row), __shk: noShkPureShk(row), __nm: noShkPureNm(row) }));
        return { rows, error: result.error };
    };

    window.__resolveNoShkBoxItemTaskMatch = async function (submission, taskId, taskNm) {
        const db = supabaseDb();
        if (!db || !submission || !submission.id) return { ok: false };
        let row;
        try {
            const { data, error } = await db.from(WMS_TASKS_TABLE).select(WMS_TASK_SELECT_COLUMNS).eq("id", taskId).maybeSingle();
            if (error) throw error;
            row = data;
        } catch (error) {
            toast("Не удалось загрузить задачу: " + (error && error.message ? error.message : String(error)), "error");
            return { ok: false };
        }
        if (!row) {
            toast("Задача не найдена.", "error");
            return { ok: false };
        }
        const items = taskItems(row);
        const matchedItem = items.find((candidate) => normalizeIdentifier(candidate.nm) === normalizeIdentifier(taskNm)) || items[0] || null;
        const result = await resolveNoShkTaskMatch(row, matchedItem, submission.id, submission);
        if (!result.ok) return { ok: false };
        renderReview();
        return { ok: true, shk: matchedItem ? normalizeIdentifier(matchedItem.shk) : "" };
    };

    window.__resolveNoShkBoxItemPureMatch = async function (_submission, pureRow) {
        try {
            for (const patch of noShkPurePatchVariants(pureRow)) {
                try {
                    await updateNoShkPureRow(pureRow, patch);
                    // pure_losses_rep's own PK column name varies by
                    // environment (see buildNoShkPureUpdateFilters, which
                    // already tries id/pure_id/uuid/pure_losses_id/row_id in
                    // order) -- noShkRowSignature resolves the same way,
                    // falling back to a shk+date+wh_id composite when none
                    // of those columns exist, so matched_pure_loss_id always
                    // gets a real, non-empty value.
                    return { ok: true, shk: noShkPureShk(pureRow), nm: noShkPureNm(pureRow), pureLossId: noShkRowSignature(pureRow) };
                } catch (error) {
                    if (!isUnknownColumnError(error)) throw error;
                }
            }
            throw new Error("Не удалось записать вердикт.");
        } catch (error) {
            toast("Не удалось опознать: " + (error && error.message ? error.message : String(error)), "error");
            return { ok: false };
        }
    };
```

- [ ] **Step 2: Синтаксическая проверка**

```bash
node --check tasks.js
```

- [ ] **Step 3: Проверить ядро записи по списанию на реальных данных**

```bash
supabase db query --linked "select id, shk, nm, decription, brand from pure_losses_rep where opp_deecision is null limit 1;"
```
Убедиться, что строка существует и видна напрямую (не трогать её update'ом — это просто подтверждение, что `pure_losses_rep` доступна с теми же именами колонок, что ожидает `noShkPurePatchVariants`/`updateNoShkPureRow`). Полную сквозную проверку записи (`markNoShkPureAsFound`-эквивалент) сделать вручную через браузер в Task 7 после сборки всей цепочки.

- [ ] **Step 4: Commit**

```bash
git add tasks.js
git commit -m "Добавляем мосты tasks.js->intake_search.js для поиска по списаниям и опознания обоих типов"
```

---

### Task 7: `no_shk_zone.js` — режим разбора короба, обобщённая "решённость", сортировка/подсветка тайла

**Files:**
- Modify: `no_shk_zone.js:1340-1350` (`renderDisassembleGrid`)
- Modify: `no_shk_zone.js:1328-1338` (`disassembleTileHtml`)
- Modify: `no_shk_zone.js:1315-1326` (`refreshDisassembleItems`)
- Modify: `tasks.html` (CSS `.no-shk-disassemble-tile`, строки 981-987)

**Interfaces:**
- Consumes: `window.__onNoShkItemAssigned` (уже существует, строка 1395 — логика "решено → завершить короб" переиспользуется без изменений).

- [ ] **Step 1: Обобщить проверку "решено"**

Найти (`no_shk_zone.js:1328-1338`):
```js
    function disassembleTileHtml(item) {
        const done = Boolean(item.sticker_code);
        const photo = item.photo_path
            ? "<img src='" + escapeHtmlLocal(buildIntakePhotoUrl(item.photo_path)) + "' loading='lazy' alt=''>"
            : "<div class='no-shk-disassemble-tile-noimg'>?</div>";
        return "<div class='" + cls + "' data-item-id='" + escapeHtmlLocal(item.id) + "'>"
            + photo
            + "<div class='no-shk-disassemble-tile-name'>" + escapeHtmlLocal(item.item_text || item.item_type || "Без наименования") + "</div>"
            + (done ? "<span class='no-shk-disassemble-tile-check'>✓</span>" : "")
            + "</div>";
    }
```
(примечание: `cls` в оригинале собирается строкой выше `return` — свериться с живым файлом за точным текстом перед правкой, здесь воспроизведена суть)

Заменить на:
```js
    // "Решено" теперь три равноправных пути: физический стикер, опознание
    // по задаче, опознание по строке "чистых списаний" -- любой из них
    // закрывает товар без требования остальных двух.
    function isDisassembleItemResolved(item) {
        return Boolean(item.sticker_code || item.matched_task_id || item.matched_pure_loss_id);
    }

    function disassembleTileHtml(item) {
        const done = isDisassembleItemResolved(item);
        const cls = "no-shk-disassemble-tile" + (done ? " is-done" : "");
        const photo = item.photo_path
            ? "<img src='" + escapeHtmlLocal(buildIntakePhotoUrl(item.photo_path)) + "' loading='lazy' alt=''>"
            : "<div class='no-shk-disassemble-tile-noimg'>?</div>";
        return "<div class='" + cls + "' data-item-id='" + escapeHtmlLocal(item.id) + "'>"
            + photo
            + "<div class='no-shk-disassemble-tile-name'>" + escapeHtmlLocal(item.item_text || item.item_type || "Без наименования") + "</div>"
            + (done ? "<span class='no-shk-disassemble-tile-check'>✓</span>" : "")
            + "</div>";
    }
```

- [ ] **Step 2: Пересортировать грид перед рендером — решённые в конец**

Найти (`no_shk_zone.js:1340-1350`):
```js
    function renderDisassembleGrid() {
        const wrap = $("noShkDisassembleWrap");
        if (!wrap) return;
        wrap.innerHTML = "<div class='no-shk-disassemble-grid'>" + disassembleItems.map(disassembleTileHtml).join("") + "</div>";
        wrap.querySelectorAll("[data-item-id]").forEach((tile) => {
            tile.addEventListener("click", () => {
                const item = disassembleItems.find((row) => row.id === tile.dataset.itemId);
                if (item && window.__openIntakeSubmissionCard) window.__openIntakeSubmissionCard(item);
            });
        });
    }
```
Заменить на:
```js
    function renderDisassembleGrid() {
        const wrap = $("noShkDisassembleWrap");
        if (!wrap) return;
        // Нерешённые сначала, решённые в конце в порядке решения -- не
        // трогаем порядок внутри каждой группы (stable sort), чтобы
        // "в конце в порядке решения" буквально работало по мере того, как
        // элементы переходят из "нерешён" в "решён".
        const ordered = disassembleItems
            .map((item, index) => ({ item, index, done: isDisassembleItemResolved(item) }))
            .sort((a, b) => (a.done === b.done ? a.index - b.index : (a.done ? 1 : -1)))
            .map((entry) => entry.item);
        wrap.innerHTML = "<div class='no-shk-disassemble-grid'>" + ordered.map(disassembleTileHtml).join("") + "</div>";
        wrap.querySelectorAll("[data-item-id]").forEach((tile) => {
            tile.addEventListener("click", () => {
                const item = disassembleItems.find((row) => row.id === tile.dataset.itemId);
                if (item && window.__openIntakeSubmissionCard) window.__openIntakeSubmissionCard(item, true);
            });
        });
    }
```

- [ ] **Step 3: Обобщить проверку завершения короба**

Найти (`no_shk_zone.js:1315-1326`):
```js
    async function refreshDisassembleItems() {
        if (!disassembleBox) return;
        disassembleItems = await fetchBoxDisassembleItems(disassembleBox.id);
        // An empty box (nothing was ever logged into it) or one where every
        // item already carries a sticker completes immediately -- [].every()
        // is true, so this also covers the empty case with no extra check.
        if (disassembleItems.every((item) => Boolean(item.sticker_code))) {
            void finishDisassemble();
            return;
        }
        renderDisassembleGrid();
    }
```
Заменить на:
```js
    async function refreshDisassembleItems() {
        if (!disassembleBox) return;
        disassembleItems = await fetchBoxDisassembleItems(disassembleBox.id);
        // An empty box (nothing was ever logged into it) or one where every
        // item is already resolved (sticker, task match, or pure-loss
        // match) completes immediately -- [].every() is true, so this also
        // covers the empty case with no extra check.
        if (disassembleItems.every(isDisassembleItemResolved)) {
            void finishDisassemble();
            return;
        }
        renderDisassembleGrid();
    }
```

Также найти `window.__onNoShkItemAssigned` (`no_shk_zone.js:1395-1399`):
```js
    window.__onNoShkItemAssigned = function () {
        if (!disassembleBox) return;
        renderDisassembleGrid();
        if (disassembleItems.every((item) => Boolean(item.sticker_code))) void finishDisassemble();
    };
```
Заменить последнюю строку на:
```js
    window.__onNoShkItemAssigned = function () {
        if (!disassembleBox) return;
        renderDisassembleGrid();
        if (disassembleItems.every(isDisassembleItemResolved)) void finishDisassemble();
    };
```

- [ ] **Step 4: CSS — усилить зелёный фон и притушить фото решённого тайла**

Найти (`tasks.html:986`):
```css
        .no-shk-disassemble-tile.is-done { border-color: #16a34a; }
```
Заменить на:
```css
        .no-shk-disassemble-tile.is-done { border-color: #16a34a; background: #dcfce7; }
        .no-shk-disassemble-tile.is-done img,
        .no-shk-disassemble-tile.is-done .no-shk-disassemble-tile-noimg { filter: brightness(.72); }
```

- [ ] **Step 5: Синтаксическая проверка**

```bash
node --check no_shk_zone.js
```

- [ ] **Step 6: Визуальная QA зелёного/притушенного состояния**

Тем же скретч-методом: вытащить CSS, собрать 4-5 `.no-shk-disassemble-tile` (часть с `.is-done`, часть без) внутри `.no-shk-disassemble-grid`, открыть в Browser pane, скриншотом подтвердить визуальную разницу и порядок (решённые действительно визуально "в конце" в примере разметки).

- [ ] **Step 7: Commit**

```bash
git add no_shk_zone.js tasks.html
git commit -m "Обобщаем 'решённость' товара в разборе короба на три пути опознания, решённые уезжают в конец"
```

---

### Task 8: Освобождение полки, фильтрация и новая зона "Разобранные короба"

**Files:**
- Modify: `no_shk_zone.js:109` (`BOX_FIELDS`)
- Modify: `no_shk_zone.js:111-154` (`loadZone`)
- Modify: `no_shk_zone.js:171-355` область (`renderZoneView`, добавить новую секцию)
- Modify: `no_shk_zone.js:1171-1179` (`completeDisassembleBox`)
- Modify: `tasks.html:2590-2608` (`#noShkZoneModal`, кнопка "Разобранные короба")
- Create: новая миграция для разового бэкафилла уже-разобранных коробов

**Interfaces:**
- Consumes: `openBoxContentsModal(boxId)` (уже существует, `no_shk_zone.js:741` — переиспользуется как есть для просмотра исторического наполнения, без изменений).

- [ ] **Step 1: `completeDisassembleBox` освобождает полку**

Найти (`no_shk_zone.js:1171-1179`):
```js
    async function completeDisassembleBox(boxId, actorName) {
        const client = db();
        if (!client) return;
        const { error } = await client
            .from("wms_no_shk_boxes")
            .update({ disassembled_at: new Date().toISOString(), disassembled_by: actorName })
            .eq("id", boxId);
        if (error) console.error("[no_shk_zone] complete failed:", error.message);
    }
```
Заменить на:
```js
    async function completeDisassembleBox(boxId, actorName) {
        const client = db();
        if (!client) return;
        const { error } = await client
            .from("wms_no_shk_boxes")
            .update({ disassembled_at: new Date().toISOString(), disassembled_by: actorName, shelf_id: null })
            .eq("id", boxId);
        if (error) console.error("[no_shk_zone] complete failed:", error.message);
    }
```

- [ ] **Step 2: Добавить `disassembled_at` в `BOX_FIELDS` и отфильтровать разобранные короба из обычного грида**

Найти (`no_shk_zone.js:109`):
```js
    const BOX_FIELDS = "id,box_number,shift_date,shift_type,box_type,area,responsible_name,shelf_id,outside_opp,total_items,created_at";
```
Заменить на:
```js
    const BOX_FIELDS = "id,box_number,shift_date,shift_type,box_type,area,responsible_name,shelf_id,outside_opp,total_items,created_at,disassembled_at,disassembled_by";
```

Найти в `loadZone` (`no_shk_zone.js:146-149`):
```js
        racks = racksRes.data || [];
        floorBoxes = floorRes.error ? [] : (floorRes.data || []);
        outsideBoxes = outsideRes.error ? [] : (outsideRes.data || []);
        shortageBoxes = shortageRes.error ? [] : (shortageRes.data || []);
```
Заменить на:
```js
        // Разобранные короба больше не занимают визуальное место на
        // стеллаже/на полу -- отфильтровываем на клиенте, а не через
        // embedded-фильтр PostgREST на вложенном wms_no_shk_boxes
        // (двухуровневая вложенность racks->shelves->boxes делает точечный
        // фильтр через .eq()/.is() на embed ненадёжным без лишнего
        // !inner-тестирования; простой клиентский filter() даёт тот же
        // результат гарантированно).
        racks = (racksRes.data || []).map((rack) => ({
            ...rack,
            wms_no_shk_shelves: (rack.wms_no_shk_shelves || []).map((shelf) => ({
                ...shelf,
                wms_no_shk_boxes: (shelf.wms_no_shk_boxes || []).filter((box) => !box.disassembled_at),
            })),
        }));
        floorBoxes = (floorRes.error ? [] : (floorRes.data || [])).filter((box) => !box.disassembled_at);
        outsideBoxes = outsideRes.error ? [] : (outsideRes.data || []);
        shortageBoxes = shortageRes.error ? [] : (shortageRes.data || []);
```

(`outsideBoxes`/`shortageBoxes` не фильтруем — разобранный короб логически не может находиться "вне ОПП" или быть "недостачей", это взаимоисключающие состояния по остальным флагам, трогать не нужно.)

- [ ] **Step 3: Запрос списка разобранных коробов и новая секция в `renderZoneView`**

Добавить новую module-level переменную рядом с объявлением `floorBoxes`/`outsideBoxes`/`shortageBoxes` (искать `let floorBoxes` в начале файла, добавить рядом):
```js
    let disassembledBoxes = [];
```

В `loadZone`, добавить пятый параллельный запрос (найти `Promise.all([` блок, строки 114-139, добавить пятый элемент массива):
```js
            client
                .from("wms_no_shk_boxes")
                .select(BOX_FIELDS)
                .not("disassembled_at", "is", null)
                .order("disassembled_at", { ascending: false })
                .limit(100),
```
и соответствующую деструктуризацию (найти `const [racksRes, floorRes, outsideRes, shortageRes] = await Promise.all([`, заменить на):
```js
        const [racksRes, floorRes, outsideRes, shortageRes, disassembledRes] = await Promise.all([
```
а после присвоения `shortageBoxes` добавить:
```js
        disassembledBoxes = disassembledRes.error ? [] : (disassembledRes.data || []);
```

В `renderZoneView` (`no_shk_zone.js:299-355`), найти:
```js
        wrap.innerHTML = outsideHtml + floorHtml + shortageHtml + racksHtml;
```
Заменить на:
```js
        const disassembledHtml = "<div class='no-shk-floor no-shk-floor-disassembled'>"
            + "<p class='no-shk-floor-title'>Разобранные короба" + (disassembledBoxes.length ? " (" + disassembledBoxes.length + ")" : "") + "</p>"
            + "<div class='no-shk-boxes-row'>"
            + (disassembledBoxes.length
                ? disassembledBoxes.map((box) => "<div class='no-shk-box' data-disassembled-box-id='" + box.id + "'><span class='no-shk-box-number'>№" + box.box_number + "</span><span class='no-shk-box-date'>" + escapeHtmlLocal(formatDateShort(box.shift_date)) + "</span></div>").join("")
                : "<span style='color:#94a3b8;font-size:12px;'>пусто</span>")
            + "</div></div>";

        wrap.innerHTML = outsideHtml + floorHtml + shortageHtml + disassembledHtml + racksHtml;
```

Добавить обработчик кликов рядом с уже существующим (`no_shk_zone.js:344-346`, найти `wrap.querySelectorAll("[data-box-id]")` блок, добавить следом):
```js
        wrap.querySelectorAll("[data-disassembled-box-id]").forEach((el) => {
            el.addEventListener("click", () => void openBoxContentsModal(el.dataset.disassembledBoxId));
        });
```

(Разобранный короб открывается сразу в режим просмотра содержимого, не в обычную детальную карточку — у него больше нет "Убрать с полки"/"Распечатать"/местоположения, это не нужный контекст.)

- [ ] **Step 4: Расширить `contentCardHtml` — показать, чем именно опознан товар**

Найти (`no_shk_zone.js`, функция `contentCardHtml`, искать по сигнатуре):
```js
        const stickerLine = item.sticker_code
            ? "<div style='font-size:12px;color:#64748b;margin-top:2px;'>Присвоенный ШК: " + escapeHtmlLocal(decodeStickerCode(item.sticker_code) || item.sticker_code) + "</div>"
            : "";
        return "<div style='border:1px solid rgba(15,23,42,.08);border-radius:10px;padding:10px;margin-bottom:10px;'>"
            + photo
            + "<div style='margin-top:8px;font-weight:700;font-size:14px;'>" + nameLine + categoryLine + "</div>"
            + "<div style='font-size:12px;color:#64748b;margin-top:2px;'>" + escapeHtmlLocal(item.full_name) + " · " + when + "</div>"
            + stickerLine
            + "</div>";
```
Заменить на:
```js
        const stickerLine = item.sticker_code
            ? "<div style='font-size:12px;color:#64748b;margin-top:2px;'>Присвоенный ШК: " + escapeHtmlLocal(decodeStickerCode(item.sticker_code) || item.sticker_code) + "</div>"
            : "";
        const resolutionLine = item.matched_task_id
            ? "<div style='font-size:12px;color:#15803d;margin-top:2px;font-weight:700;'>Опознан по задаче" + (item.matched_shk ? " (ШК " + escapeHtmlLocal(item.matched_shk) + ")" : "") + "</div>"
            : item.matched_pure_loss_id
            ? "<div style='font-size:12px;color:#15803d;margin-top:2px;font-weight:700;'>Опознан по списанию" + (item.matched_shk ? " (ШК " + escapeHtmlLocal(item.matched_shk) + ")" : "") + "</div>"
            : "";
        return "<div style='border:1px solid rgba(15,23,42,.08);border-radius:10px;padding:10px;margin-bottom:10px;'>"
            + photo
            + "<div style='margin-top:8px;font-weight:700;font-size:14px;'>" + nameLine + categoryLine + "</div>"
            + "<div style='font-size:12px;color:#64748b;margin-top:2px;'>" + escapeHtmlLocal(item.full_name) + " · " + when + "</div>"
            + stickerLine
            + resolutionLine
            + "</div>";
```

- [ ] **Step 5: Разовый бэкафилл уже-разобранных коробов**

Создать `supabase/migrations/202610010010_backfill_disassembled_shelf_release.sql`:
```sql
-- Разовая чистка: все короба, у которых disassembled_at уже проставлен (до
-- этого изменения ничего не освобождало полку), теряют shelf_id задним
-- числом -- иначе они бы остались висеть на стеллажах, несмотря на новый
-- фильтр в loadZone, до тех пор пока их кто-то вручную не тронет.
update public.wms_no_shk_boxes
set shelf_id = null
where disassembled_at is not null
  and shelf_id is not null;
```

- [ ] **Step 6: Кнопка в шапке зоны**

Найти (`tasks.html:2602-2605`):
```html
        <div class="file-row" style="margin-top:0;">
            <button id="openNewBoxBtn" class="btn btn-rect" type="button">+ Добавить короб</button>
            <button id="openMoveBoxesBtn" class="btn btn-outline" type="button">Перемещение коробов</button>
        </div>
```
Не требует изменений — секция "Разобранные короба" уже встроена прямо в `renderZoneView`'s вывод (Step 3), отдельная кнопка-переключатель не нужна по спеке ("просто список"). Пропустить этот шаг, если при реализации выяснится, что список слишком длинный для одной страницы без пагинации — тогда ограничиться уже заложенным `.limit(100)` (Step 3) как достаточным для MVP.

- [ ] **Step 7: Применить миграцию, синтаксис, QA**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
mv supabase/migrations/202608170001_weeek_manual_wmi_mp_pc_upload.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609020005_wms_shifts_roster.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609040003_upsert_wms_external_requests_from_json.sql supabase/.migration_holdout/ 2>/dev/null
mv supabase/migrations/202609040004_upsert_wms_external_requests_source_shk_ids.sql supabase/.migration_holdout/ 2>/dev/null
supabase db push --linked
mv supabase/.migration_holdout/202608170001_weeek_manual_wmi_mp_pc_upload.sql supabase/migrations/ 2>/dev/null
mv supabase/.migration_holdout/202609020005_wms_shifts_roster.sql supabase/migrations/ 2>/dev/null
mv supabase/.migration_holdout/202609040003_upsert_wms_external_requests_from_json.sql supabase/migrations/ 2>/dev/null
mv supabase/.migration_holdout/202609040004_upsert_wms_external_requests_source_shk_ids.sql supabase/migrations/ 2>/dev/null
node --check no_shk_zone.js
```

Проверить бэкафилл:
```bash
supabase db query --linked "select count(*) from wms_no_shk_boxes where disassembled_at is not null and shelf_id is not null;"
```
Ожидается: `0`.

- [ ] **Step 8: Commit**

```bash
git add no_shk_zone.js tasks.html supabase/migrations/202610010010_backfill_disassembled_shelf_release.sql
git commit -m "Освобождаем полку при завершении короба, добавляем зону 'Разобранные короба'"
```

---

## Самопроверка плана (для исполнителя, уже пройдено автором плана)

- **Покрытие спеки:** раздел 1 (сплит-модалка) → Task 4-5; раздел 2 (поиск/автоподбор) → Task 2, 5, 6; раздел 3 (опознание) → Task 3, 5, 6; раздел 4 ("решено" без стикера) → Task 1 (данные), Task 7 (логика); раздел 5 (тайл в конце/зелёный) → Task 7; раздел 6 (зона "Разобранные короба") → Task 8; раздел 7 (историческое наполнение) → Task 8 Step 3-4 (переиспользует существующий `openBoxContentsModal`, не новый код).
- **Пропущенное в спеке, добавленное в план:** ужесточение `wms_intake_mark_matched`'s WHERE (Task 1) — спека не называла это явно, но без этого один товар можно было бы опознать и по задаче, и по списанию одновременно, что ломает "опознан = решено ровно одним путём".
- **Что сознательно не стало отдельной задачей:** секция 7 спеки ("read-only режим `openDisassembleFullscreen`") — при разведке выяснилось, что готовый read-only просмотр (`openBoxContentsModal`) уже существует и ничего не требует кроме как быть вызванным из нового места (Task 8), так что отдельный read-only режим внутри `openDisassembleFullscreen` строить не нужно — это сокращает объём работы, не меняет результат.
