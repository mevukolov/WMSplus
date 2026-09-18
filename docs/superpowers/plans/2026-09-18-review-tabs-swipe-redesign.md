# Разбор Swipe-Tabs Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Разбор" page's two-item toolbar toggle (Участки / Полотно) with a three-tab animated swipe pager — Предразбор / Задачи / Чистые списания — absorbing the standalone "Запросы" page and retiring the "Полотно" canvas mode entirely.

**Architecture:** Pure client-side change to two files (`tasks.html`, `tasks.js`) in a no-build vanilla-JS app. A sliding "thumb" element animates behind three tab buttons; a flex "track" holding three full-width panels slides horizontally via CSS `transform` when the active tab changes. All three panels stay mounted in the DOM at all times — switching tabs never re-fetches or re-mounts content, it only moves the thumb and the track.

**Tech Stack:** Vanilla JS (no framework, no build step), CSS transforms/transitions, Supabase JS client (already loaded via `auth.js`), no new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-18-review-tabs-swipe-redesign-design.md](../specs/2026-09-18-review-tabs-swipe-redesign-design.md)

## Global Constraints

- No build step — new code goes straight into `tasks.html`/`tasks.js`, no bundler, no npm package additions.
- `node --check tasks.js` must pass after every task.
- No Supabase schema/migration changes — this feature touches zero tables, columns, or RPCs.
- Filters/sort stay independent per tab: `state.review` (Предразбор) and `state.requests` (Задачи) remain two separate state objects; only their DOM targets move, not their logic.
- Switching tabs only via clicking the switcher — no touch/drag swipe gesture on the panel content (confirmed with the user during brainstorming).
- Reuse the app's existing spring easing `cubic-bezier(.34,1.56,.64,1)` (already used for `.tasks-menu-item` in `tasks.html`) for both the sliding thumb and the panel track, to match the app's established "liquid" motion language.
- Live verification only via this repo's own static preview server (`python3 -m http.server` from the repo root) with a temporary `localStorage.setItem('user', JSON.stringify({id:'qa-local',name:'QA Local',accesses:[]}))` for read-only QA against the real Supabase project embedded in `auth.js`. Never trigger a real write during QA — see Task 2's note on `scanIncomingFlowDuplicates()`, which is one exception already live in production today (not introduced by this change) and should be treated with the same care as any other live write path.

---

## Task 1: New switcher UI, pager scaffold, and Задачи relocation

**Files:**
- Modify: `tasks.html:908-916` (toolbar/switcher CSS)
- Modify: `tasks.html:1919-1968` (reviewPage toolbar markup, pager scaffold, requestsPage's inner grid/wrap markup relocated in)
- Modify: `tasks.js:546-573` (state.review: add `activeTab`)
- Modify: `tasks.js:2355-2380` (showReviewPage/showRequestsPage — fold entry side effects into one function)
- Modify: `tasks.js:16579,16648,16659-16661` (event listener wiring)
- Add: `setReviewTab(index)`, `slidePagerTo(index)` functions in `tasks.js` (placed next to `renderReview`, ~`tasks.js:7134` area)

**Interfaces:**
- Produces: `setReviewTab(index)` — `index` is `0` (Предразбор), `1` (Задачи), or `2` (Чистые списания). Called by the three tab buttons' click listeners and by nothing else in this task. Sets `state.review.activeTab = index`, moves `#reviewViewThumb` via `translateX`, toggles each tab button's `.active` class, toggles `#reviewToolbarPresortOnly`'s `hidden` class, slides `#reviewPagerTrack` via `slidePagerTo(index)`, and (only when `index === 1`) calls `void scanIncomingFlowDuplicates();`.
- Produces: `state.review.activeTab` (number, default `0`) — read by Task 2's rewritten `refreshOpenSectionModal`.
- Consumes: existing `renderReview`, `renderRequests`, `openActualizeTasks`/`openShkExclusion` handlers, `scanIncomingFlowDuplicates` — none of these change signature or behavior in this task.

### Step 1: Add `state.review.activeTab`

`tasks.js:546-573` currently ends the `review` object with:

```js
            activeSection: "",
            modalMode: "",
            sort: { key: "price", dir: "desc" },
            filters: createReviewFilterState(),
        },
```

Change to (add `activeTab`, keep `modalMode` for now — Task 2 removes it once its last reader is rewritten):

```js
            activeSection: "",
            activeTab: 0,
            modalMode: "",
            sort: { key: "price", dir: "desc" },
            filters: createReviewFilterState(),
        },
```

### Step 2: Replace the switcher CSS

`tasks.html:908-916` currently reads:

```css
        .review-shell { padding: 16px; }
        .review-toolbar { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 14px; }
        .review-view-wrap { display: inline-flex; align-items: center; gap: 10px; }
        .review-tool-square { width: 42px; height: 42px; border: 0; border-radius: 12px; background: #fff; color: var(--accent-dark); box-shadow: var(--shadow-sm); font-size: 20px; font-weight: 900; cursor: pointer; }
        .review-tool-square:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); color: var(--accent); }
        .review-tool-divider { width: 1px; height: 34px; background: #dbe3ec; }
        .review-view-tabs { display: inline-flex; gap: 8px; padding: 4px; border-radius: 14px; background: #f1f5f9; }
        .review-view-tab { border: 0; border-radius: 11px; padding: 9px 13px; background: transparent; color: #64748b; font-weight: 800; cursor: pointer; }
        .review-view-tab.active { background: #fff; color: var(--accent-dark); box-shadow: var(--shadow-sm); }
```

Replace with (drops the per-button active background/shadow — the thumb now supplies it — and adds the thumb, the 3-way width math, and the pager CSS):

```css
        .review-shell { padding: 16px; }
        .review-toolbar { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 14px; }
        .review-view-wrap { display: inline-flex; align-items: center; gap: 10px; }
        .review-tool-square { width: 42px; height: 42px; border: 0; border-radius: 12px; background: #fff; color: var(--accent-dark); box-shadow: var(--shadow-sm); font-size: 20px; font-weight: 900; cursor: pointer; }
        .review-tool-square:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); color: var(--accent); }
        .review-tool-divider { width: 1px; height: 34px; background: #dbe3ec; }
        .review-view-tabs { display: inline-flex; gap: 8px; padding: 4px; border-radius: 14px; background: #f1f5f9; }
        .review-view-tabs-3 { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; }
        .review-view-thumb { position: absolute; top: 4px; left: 4px; width: calc((100% - 8px) / 3); height: calc(100% - 8px); border-radius: 11px; background: #fff; box-shadow: var(--shadow-sm); transition: transform .38s cubic-bezier(.34,1.56,.64,1); z-index: 0; }
        .review-view-tabs-3 .review-view-tab { position: relative; z-index: 1; border: 0; border-radius: 11px; padding: 9px 13px; background: transparent; color: #64748b; font-weight: 800; cursor: pointer; text-align: center; transition: color .2s ease; }
        .review-view-tabs-3 .review-view-tab.active { color: var(--accent-dark); background: transparent; box-shadow: none; }
        .review-view-tab { border: 0; border-radius: 11px; padding: 9px 13px; background: transparent; color: #64748b; font-weight: 800; cursor: pointer; }
        .review-view-tab.active { background: #fff; color: var(--accent-dark); box-shadow: var(--shadow-sm); }
        .review-pager-viewport { overflow: hidden; }
        .review-pager-track { display: flex; transition: transform .38s cubic-bezier(.34,1.56,.64,1); }
        .review-pager-panel { flex: 0 0 100%; min-width: 0; }
        .review-toolbar-presort-only { display: inline-flex; align-items: center; gap: 10px; }
        .review-toolbar-presort-only.hidden { display: none; }
```

(`.review-view-tabs`/`.review-view-tab`/`.review-view-tab.active` without the `-3`/`-tabs-3` qualifier stay — they're still used elsewhere, e.g. `requestsViewSections`' old single-button block, which Task 2 deletes along with the rest of `requestsPage`; leaving the unqualified rules in place until then keeps that markup looking correct in the interim.)

### Step 3: Replace the toolbar and page body markup

`tasks.html:1919-1946` currently reads:

```html
    <section id="reviewPage" class="tasks-page">
        <div class="tasks-page-head">
            <button id="homeFromReview" class="btn btn-outline" type="button" aria-label="Назад">←</button>
            <div>
                <h2 class="tasks-page-title">Разбор</h2>
                <p class="tasks-page-note">Вот актуальные задачи на сегодня</p>
            </div>
        </div>
        <section class="card review-shell">
            <div class="review-toolbar">
                <div>
                    <div class="review-view-wrap">
                        <button id="openActualizeTasks" class="review-tool-square" type="button" title="Актуализировать активные задачи">▤</button>
                        <button id="openShkExclusion" class="review-tool-square" type="button" title="Добавить ШК в исключения">⛔</button>
                        <span class="review-tool-divider" aria-hidden="true"></span>
                        <div class="review-view-tabs" aria-label="Вид разбора">
                            <button id="reviewViewSections" class="review-view-tab active" type="button">Участки</button>
                            <button id="reviewViewCanvas" class="review-view-tab" type="button">Полотно</button>
                        </div>
                    </div>
                </div>
                <div id="reviewStatus" class="review-status">Задачи еще не загружены.</div>
            </div>
            <div id="writebackFailuresBanner" class="status-line warn" style="display:none;"></div>
            <div id="reviewSectionsGrid" class="review-sections-grid"></div>
            <div id="reviewTableWrap" class="review-table-card"></div>
        </section>
    </section>
```

Replace with:

```html
    <section id="reviewPage" class="tasks-page">
        <div class="tasks-page-head">
            <button id="homeFromReview" class="btn btn-outline" type="button" aria-label="Назад">←</button>
            <div>
                <h2 class="tasks-page-title">Разбор</h2>
                <p class="tasks-page-note">Вот актуальные задачи на сегодня</p>
            </div>
        </div>
        <section class="card review-shell">
            <div class="review-toolbar">
                <div>
                    <div class="review-view-wrap">
                        <div id="reviewToolbarPresortOnly" class="review-toolbar-presort-only">
                            <button id="openActualizeTasks" class="review-tool-square" type="button" title="Актуализировать активные задачи">▤</button>
                            <button id="openShkExclusion" class="review-tool-square" type="button" title="Добавить ШК в исключения">⛔</button>
                            <span class="review-tool-divider" aria-hidden="true"></span>
                        </div>
                        <div class="review-view-tabs review-view-tabs-3" aria-label="Вид разбора">
                            <span id="reviewViewThumb" class="review-view-thumb" aria-hidden="true"></span>
                            <button id="reviewTabPresort" class="review-view-tab active" type="button" data-tab-index="0" aria-selected="true">Предразбор</button>
                            <button id="reviewTabTasks" class="review-view-tab" type="button" data-tab-index="1" aria-selected="false">Задачи</button>
                            <button id="reviewTabPureLosses" class="review-view-tab" type="button" data-tab-index="2" aria-selected="false">Чистые списания</button>
                        </div>
                    </div>
                </div>
                <div id="reviewStatus" class="review-status">Задачи еще не загружены.</div>
            </div>
            <div id="writebackFailuresBanner" class="status-line warn" style="display:none;"></div>
            <div class="review-pager-viewport">
                <div id="reviewPagerTrack" class="review-pager-track">
                    <div class="review-pager-panel">
                        <div id="reviewSectionsGrid" class="review-sections-grid"></div>
                        <div id="reviewTableWrap" class="review-table-card"></div>
                    </div>
                    <div class="review-pager-panel">
                        <div id="requestsStatus" class="review-status" style="margin-bottom:10px;">Задачи еще не загружены.</div>
                        <div id="requestsSectionsGrid" class="review-sections-grid"></div>
                        <div id="requestsTableWrap" class="review-table-card"></div>
                    </div>
                    <div class="review-pager-panel">
                        <div class="card" style="padding:32px;text-align:center;">
                            <h3 style="margin:0 0 8px;">Чистые списания</h3>
                            <p class="empty-state" style="margin:0;">Группировка по критериям — в разработке.</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    </section>
```

Note: `requestsSectionsGrid`/`requestsTableWrap`/`requestsStatus` are moved here from `requestsPage` (still `tasks.html:1948-1968` at this point — Task 2 deletes that whole section once nothing references it). Leaving the old `requestsPage` section's copies of these same ids in place at the same time as this task's new copies would create **duplicate DOM ids**, which breaks `$(id)` lookups (this codebase's `$` helper is `document.getElementById`, first-match-wins in query but ambiguous/fragile in practice) — so this step must delete the old `<div id="requestsSectionsGrid">`/`<div id="requestsTableWrap">`/`<div id="requestsStatus">` lines from inside `requestsPage` in the same edit, even though the rest of `requestsPage` (its outer `<section>`, back button, heading) is not removed until Task 2. Replace `requestsPage`'s body (`tasks.html:1956-1967`, i.e. everything from `<section class="card review-shell">` through its matching `</section>`) with an empty shell so the page still parses correctly in the interim:

```html
        <section class="card review-shell"></section>
```

### Step 4: `setReviewTab`/`slidePagerTo` and rewiring `showReviewPage`

Delete `showRequestsPage` (`tasks.js:2368-2380`) entirely — its two real effects (`renderRequests()` and `scanIncomingFlowDuplicates()`) move into `setReviewTab`, and its page-activation effects are superseded by `showReviewPage` now covering both tabs.

Replace `showReviewPage` (`tasks.js:2355-2366`):

```js
    function showReviewPage() {
        state.view = "review";
        closeFlowModals();
        $("tasksHome").style.display = "none";
        $("flowPage").classList.remove("active");
        $("uploadsPage").classList.remove("active");
        $("requestsPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
        $("reviewPage").classList.add("active");
        renderReview();
        void ensureReviewTasksLoaded();
    }
```

with:

```js
    function showReviewPage() {
        state.view = "review";
        closeFlowModals();
        $("tasksHome").style.display = "none";
        $("flowPage").classList.remove("active");
        $("uploadsPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
        $("reviewPage").classList.add("active");
        renderReview();
        renderRequests();
        void ensureReviewTasksLoaded();
    }

    function setReviewTab(index) {
        state.review.activeTab = index;
        $("reviewViewThumb").style.transform = "translateX(" + (index * 100) + "%)";
        [
            [$("reviewTabPresort"), 0],
            [$("reviewTabTasks"), 1],
            [$("reviewTabPureLosses"), 2],
        ].forEach(([button, tabIndex]) => {
            const active = tabIndex === index;
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", active ? "true" : "false");
        });
        $("reviewToolbarPresortOnly").classList.toggle("hidden", index !== 0);
        slidePagerTo(index);
        if (index === 1) void scanIncomingFlowDuplicates();
    }

    function slidePagerTo(index) {
        $("reviewPagerTrack").style.transform = "translateX(-" + (index * 100) + "%)";
    }
```

(`$("requestsPage").classList.remove("active")` is dropped from `showReviewPage` here since `requestsPage` no longer needs toggling once its content lives inside `reviewPage` — it still exists as an emptied shell until Task 2 deletes it outright, and nothing else navigates to it, so leaving its stale `.active` state alone for one task is harmless.)

### Step 5: Rewire the toolbar's own listeners

`tasks.js:16659-16661` currently reads:

```js
        $("reviewViewSections").addEventListener("click", renderReview);
        $("reviewViewCanvas").addEventListener("click", openReviewCanvasModal);
        $("requestsViewSections").addEventListener("click", renderRequests);
```

Replace with:

```js
        $("reviewTabPresort").addEventListener("click", () => setReviewTab(0));
        $("reviewTabTasks").addEventListener("click", () => setReviewTab(1));
        $("reviewTabPureLosses").addEventListener("click", () => setReviewTab(2));
```

(`requestsViewSections` no longer exists once Step 3 empties `requestsPage`'s body — its listener line is deleted here, one task ahead of the rest of `requestsPage`'s removal, which is fine since the element it targeted is already gone.)

**Correction found during execution:** `$("openRequests").addEventListener("click", showRequestsPage);` (`tasks.js:16579`) references `showRequestsPage`, which this step's edit above just deleted — leaving that line in place throws an uncaught `ReferenceError` during `init()`, which silently aborts every listener registration *after* it in the same function, including the three new tab listeners from this same step. Delete this line now, in Task 1, not Task 2:

```js
        $("openRequests").addEventListener("click", showRequestsPage);
```

The `openRequests` home tile itself stays in the DOM until Task 2 (clicking it is inert with no listener — harmless for one task). `tasks.js:16648` (`$("homeFromRequests").addEventListener("click", showHome);`) has no such problem — `showHome` still exists — so that one line only *does* wait for Task 2 as originally planned.

### Step 6: Verify

- [ ] Run `node --check tasks.js` — expect no output (success).
- [ ] Start the static server: `python3 -m http.server 8977` from `/Users/WBwork/Downloads/WMSplus-main`.
- [ ] In the Browser tool, navigate to `http://localhost:8977/tasks.html`, run `localStorage.setItem('user', JSON.stringify({id:'qa-local',name:'QA Local',accesses:[]}))`, then navigate to `http://localhost:8977/tasks.html` again (fresh tab if the first attempt lands on `index.html` instead — this app's own login-redirect logic is flaky about this from a cold `location.href` set; a brand-new tab via the Browser tool's own tab-creation, then one `navigate` call, has been the reliable pattern this session).
- [ ] Open "Разбор". Confirm three tabs render: Предразбор (active by default), Задачи, Чистые списания.
- [ ] Click "Задачи": confirm the thumb slides to the middle third, confirm the ▤/⛔ toolbar buttons disappear, confirm the panel slides to show the (real, live) requests section-card grid with real counts, confirm clicking one of its three cards opens the shared modal with a real table.
- [ ] Click "Чистые списания": confirm the thumb slides to the last third, confirm the static placeholder card shows.
- [ ] Click back to "Предразбор": confirm the ▤/⛔ buttons reappear, confirm the original section-card grid and its modal drill-down still work exactly as before this change.
- [ ] Confirm the still-present home tile "Запросы" and the old `requestsPage` (now an empty shell if navigated to directly) are visibly broken/empty — expected at this point in the plan; Task 2 removes them.
- [ ] Stop the server (`pkill -f "http.server 8977"`), clear `localStorage` in the test tab, close the tab.

---

## Task 2: Delete Полотно + standalone Запросы, fix `refreshOpenSectionModal`, final sweep

**Files:**
- Modify: `tasks.js:546-573` (remove `modalMode`)
- Modify: `tasks.js` — `refreshOpenSectionModal` (currently `tasks.js:2755-2760`)
- Modify: `tasks.js` — delete `renderReviewCanvasTable`, `reviewCanvasRows`, `sortedCanvasRows`, `openReviewCanvasModal` (currently spanning roughly `tasks.js:7267-7325`; exact span confirmed by reading the file at implementation time, since Task 1's edits shift line numbers)
- Modify: `tasks.js:602-605` (delete `state.reviewCanvas`)
- Modify: `tasks.js` — `sectionFilterState`, `resetSectionFilters`, `applySectionFilters`, `renderSectionFilters` (drop `"canvas"` branches)
- Modify: `tasks.js:16579`, `16648` (delete the two listeners for `openRequests`/`homeFromRequests`)
- Modify: `tasks.js` — delete `$("requestsPage").classList...` lines inside `showHome`, `showFlow`, `showUploads`, `showInactivePage` (currently `tasks.js:2073`, `2307`, `2347`, `2463`)
- Modify: `tasks.html` — delete `<section id="requestsPage">` (post-Task-1, an emptied shell) and the `#openRequests` home tile (`tasks.html:1734-1738` before Task 1's edits — re-locate by id search, since Task 1 shifts surrounding lines)

**Interfaces:**
- Consumes: `state.review.activeTab` (produced by Task 1).
- Produces: nothing new — this task only deletes dead code and repairs the one function (`refreshOpenSectionModal`) that depended on the flags being deleted.

### Step 1: Rewrite `refreshOpenSectionModal`

Currently (`tasks.js:2755-2760`):

```js
    function refreshOpenSectionModal() {
        if (!$("reviewSectionModal") || !$("reviewSectionModal").classList.contains("active")) return;
        if (state.view === "requests") renderRequestsTable(requestsGroupedRows());
        else if (state.review.modalMode === "canvas") renderReviewCanvasTable();
        else renderReviewTable(reviewGroupedRows());
    }
```

Replace with:

```js
    function refreshOpenSectionModal() {
        if (!$("reviewSectionModal") || !$("reviewSectionModal").classList.contains("active")) return;
        if (state.review.activeTab === 1) renderRequestsTable(requestsGroupedRows());
        else renderReviewTable(reviewGroupedRows());
    }
```

### Step 2: Delete canvas-mode functions

Four functions to delete, in two separate locations (confirm exact current
line numbers with `grep -n "function openReviewCanvasModal\|function
renderReviewCanvasTable\|function sortedCanvasRows\|function
reviewCanvasRows" tasks.js` before editing — Task 1 shifts the file's line
numbers from what's quoted below).

`reviewCanvasRows` sits alone, well away from the other three (next to
`requestsGroupedRows`). Delete this whole function:

```js
    function reviewCanvasRows() {
        return (state.review.rows || []).filter((row) => isActiveReviewTask(row) && !isPrespisokTask(row) && !requestSectionName(row));
    }
```

`sortedCanvasRows`, `openReviewCanvasModal`, and `renderReviewCanvasTable`
sit together, immediately before `setRequestsStatus`. Delete this whole
contiguous block (all three functions):

```js
    function sortedCanvasRows(rows) {
        const previous = state.review.sort;
        state.review.sort = state.reviewCanvas.sort || { key: "price", dir: "desc" };
        const sorted = sortedReviewRows(rows);
        state.review.sort = previous;
        return sorted;
    }

    function openReviewCanvasModal() {
        state.review.modalMode = "canvas";
        resetSectionFilters("canvas");
        renderReviewCanvasTable();
        setFlowModalOpen("reviewSectionModal", true);
    }

    function renderReviewCanvasTable() {
        const baseRows = reviewCanvasRows();
        const filteredRows = applySectionFilters("canvas", baseRows);
        const rows = sortedCanvasRows(filteredRows);
        const target = $("reviewSectionTableWrap");
        if (!target) return;
        if (!state.review.loaded) {
            target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Полотно разбора</h3><div class='review-table-subtitle'>Задачи еще не загружены.</div></div><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div><div class='empty-state'>Подождите загрузку задач из Supabase.</div>";
            const closeBtn = $("closeReviewSectionModal");
            if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
            return;
        }
        const body = rows.map((row) => "<tr class='review-click-row' data-task-detail='" + escapeHtml(row.id) + "'>" + reviewRowCellsHtml(row, { withSection: true }) + "</tr>").join("");
        const previousSort = state.review.sort;
        state.review.sort = state.reviewCanvas.sort || { key: "price", dir: "desc" };
        target.innerHTML = "<div class='review-table-head'><div><h3 class='review-table-title'>Полотно разбора</h3><div class='review-table-subtitle'>Все активные задачи разбора: " + rows.length + " из " + baseRows.length + ".</div></div><div class='file-row' style='margin-top:0'><button id='refreshReviewTasks' class='btn btn-outline' type='button'>Обновить</button><button id='closeReviewSectionModal' class='btn btn-square' type='button'>×</button></div></div>"
            + renderSectionFilters("canvas", baseRows, rows)
            + (rows.length ? "<div class='review-table-scroll'><table class='review-data-table review-data-table-4col'><thead><tr>"
            + reviewSortHead("title", "Задача")
            + reviewSortHead("name", "Наименование")
            + reviewSortHead("price", "Стоимость")
            + reviewSortHead("status", "Статус")
            + "</tr></thead><tbody>" + body + "</tbody></table></div>" : "<div class='empty-state'>По выбранным фильтрам задач нет.</div>");
        state.review.sort = previousSort;
        const refresh = $("refreshReviewTasks");
        if (refresh) refresh.addEventListener("click", () => { void loadReviewTasks(); });
        const closeBtn = $("closeReviewSectionModal");
        if (closeBtn) closeBtn.addEventListener("click", closeReviewSectionModal);
        bindSectionFilterEvents(target, "canvas", renderReviewCanvasTable);
        target.querySelectorAll("[data-review-sort]").forEach((button) => {
            button.addEventListener("click", () => {
                const key = button.dataset.reviewSort || "price";
                const current = state.reviewCanvas.sort || { key: "price", dir: "desc" };
                state.reviewCanvas.sort = current.key === key
                    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
                    : { key, dir: key === "price" ? "desc" : "asc" };
                renderReviewCanvasTable();
            });
        });
        target.querySelectorAll("[data-task-detail]").forEach((row) => {
            row.addEventListener("click", () => openTaskDetail(row.dataset.taskDetail, "review"));
        });
    }
```

### Step 3: Delete `state.reviewCanvas`

Currently (`tasks.js:602-605`):

```js
        reviewCanvas: {
            sort: { key: "price", dir: "desc" },
            filters: createReviewFilterState(),
        },
```

Delete this block entirely.

### Step 4: Remove `modalMode`

In the `state.review` object (see Task 1 Step 1's result), delete the `modalMode: "",` line. Then delete its two remaining write sites — `state.review.modalMode = "section";` inside `openReviewSectionModal` and `state.review.modalMode = "";` inside `closeReviewSectionModal` (both single-line deletions; confirm exact current line numbers with `grep -n "modalMode" tasks.js` since only these two plus the Step 1 declaration should remain after Step 2 already removed the canvas write site).

### Step 5: Drop the `"canvas"` branches in the shared filter helpers

`sectionFilterState`:

```js
    function sectionFilterState(mode) {
        const holder = mode === "requests" ? state.requests : mode === "canvas" ? state.reviewCanvas : state.review;
        if (!holder.filters) holder.filters = createReviewFilterState();
        return holder.filters;
    }
```

becomes:

```js
    function sectionFilterState(mode) {
        const holder = mode === "requests" ? state.requests : state.review;
        if (!holder.filters) holder.filters = createReviewFilterState();
        return holder.filters;
    }
```

`resetSectionFilters`:

```js
    function resetSectionFilters(mode) {
        const holder = mode === "requests" ? state.requests : mode === "canvas" ? state.reviewCanvas : state.review;
        holder.filters = createReviewFilterState();
    }
```

becomes:

```js
    function resetSectionFilters(mode) {
        const holder = mode === "requests" ? state.requests : state.review;
        holder.filters = createReviewFilterState();
    }
```

`applySectionFilters` — delete this one line:

```js
            if (mode === "canvas" && !filterMatchesSet(taskSectionName(row), filters.sectionNames)) return false;
```

`renderSectionFilters` — delete this one line (the `sectionNames`/"Участок" filter control, which only ever applied to the flattened canvas view):

```js
            + (mode === "canvas" ? control("sectionNames", "Участок", filterSummaryText(mode, "sectionNames", options.sectionNames), renderFilterCheckboxes(mode, "sectionNames", options.sectionNames)) : "")
```

### Step 6: Delete the standalone Запросы page and its home tile

`tasks.html`: after Task 1 Step 3, `requestsPage` has shrunk to:

```html
    <section id="requestsPage" class="tasks-page">
        <div class="tasks-page-head">
            <button id="homeFromRequests" class="btn btn-outline" type="button" aria-label="Назад">←</button>
            <div>
                <h2 class="tasks-page-title">Запросы</h2>
                <p class="tasks-page-note">Запросы входящего потока, списания AWH и коробки на входе.</p>
            </div>
        </div>
        <section class="card review-shell"></section>
    </section>
```

Delete this entire block.

`tasks.html`: delete the home tile (locate via `grep -n 'id="openRequests"'`):

```html
                <button id="openRequests" class="tasks-action-card" type="button">
                    <span class="tasks-action-icon">?</span>
                    <h2 class="tasks-action-title">Запросы</h2>
                    <p class="tasks-action-text">Запросы входящего потока, списания AWH и коробки на входе отдельно от предразбора.</p>
                </button>
```

### Step 7: Delete the remaining `requestsPage` JS references

(`$("openRequests").addEventListener("click", showRequestsPage);` was
already deleted in Task 1 Step 5 — see that step's correction — nothing
left to do for it here.)

Delete this listener line (`grep -n 'homeFromRequests' tasks.js`):

```js
        $("homeFromRequests").addEventListener("click", showHome);
```

Four `$("requestsPage").classList.remove("active")` calls remain after
Task 1 (Task 1 already removed the two that lived in `showReviewPage` and
in the deleted `showRequestsPage`) — one line each inside `showHome`,
`showFlowPage`, `showUploads`, and `showInactivePage`. Confirm with
`grep -n 'requestsPage' tasks.js` (expect exactly 4 hits, all
`.classList.remove("active")`), then delete each:

In `showHome`:
```js
    function showHome() {
        state.view = "home";
        closeFlowModals();
        $("tasksHome").style.display = "grid";
        $("flowPage").classList.remove("active");
        $("uploadsPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("requestsPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
```
— delete the `$("requestsPage")` line, leaving the other four `.remove("active")` calls untouched.

In `showFlowPage`:
```js
        $("tasksHome").style.display = "none";
        $("uploadsPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("requestsPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
        $("flowPage").classList.add("active");
```
— delete the `$("requestsPage")` line.

In `showUploads`:
```js
        $("tasksHome").style.display = "none";
        $("flowPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("requestsPage").classList.remove("active");
        $("inactivePage").classList.remove("active");
        $("uploadsPage").classList.add("active");
```
— delete the `$("requestsPage")` line.

In `showInactivePage`:
```js
    function showInactivePage() {
        state.view = "inactive";
        closeFlowModals();
        $("tasksHome").style.display = "none";
        $("flowPage").classList.remove("active");
        $("uploadsPage").classList.remove("active");
        $("reviewPage").classList.remove("active");
        $("requestsPage").classList.remove("active");
        $("inactivePage").classList.add("active");
```
— delete the `$("requestsPage")` line.

### Step 8: Verify

- [ ] Run `node --check tasks.js` — expect no output.
- [ ] Full-repo grep sweep, each expected to return **zero** matches:
  - `grep -n "requestsPage\|openRequests\b\|homeFromRequests" tasks.js tasks.html`
  - `grep -n "reviewViewCanvas\|openReviewCanvasModal\|renderReviewCanvasTable\|reviewCanvasRows\|sortedCanvasRows\|state.reviewCanvas\|reviewCanvas:" tasks.js tasks.html`
  - `grep -n "modalMode" tasks.js`
  - `grep -n '"canvas"' tasks.js`
- [ ] Live static-server QA (same setup as Task 1 Step 6):
  - Confirm the home screen no longer shows a "Запросы" tile.
  - Confirm "Разбор" still opens with three working tabs (Предразбор/Задачи/Чистые списания), thumb and panel slide correctly, ▤/⛔ visibility toggles correctly.
  - Open a Предразбор section's modal, then trigger any background refresh path that calls `refreshOpenSectionModal` (e.g. use the task search box to open a task's detail and close it, or wait for `loadReviewTasks()`'s periodic refresh if one is running) — confirm the modal's table still repaints with `state.review.activeTab === 0` routing to `renderReviewTable`.
  - Switch to "Задачи", open one of its section modals, confirm the same background-refresh path routes to `renderRequestsTable` instead (`state.review.activeTab === 1`).
  - Note: switching to "Задачи" fires the live `scanIncomingFlowDuplicates()` — this is pre-existing behavior (identical to today's standalone "Запросы" page), not new, but avoid clicking into that tab repeatedly during QA beyond what's needed to confirm it renders.
  - Clear `localStorage`, close the tab, stop the server.

## Testing

Both tasks' own verification steps constitute this plan's full test coverage — there is no automated test suite in this repo (manual browser QA via the static preview server is the established method, used identically for every change this session).

## Out of scope

- The actual "group by criteria" design for Чистые списания.
- Touch/drag swipe gesture on the panel content.
- Any change to `pure_losses.html`.
