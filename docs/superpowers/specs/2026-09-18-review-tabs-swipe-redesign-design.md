# Разбор: свайп-переключатель (Предразбор / Задачи / Чистые списания) — Design

## Overview

Replaces the "Разбор" page's current two-item toolbar toggle (**Участки** /
**Полотно**, `tasks.html:1934-1937`, `tasks.js` `reviewViewSections`/
`reviewViewCanvas`) with a three-item animated pager: **Предразбор**,
**Задачи**, **Чистые списания**.

- **Полотно** (canvas mode — a shortcut that opens the section-table modal
  pre-flattened across all sections, `renderReviewCanvasTable`/
  `reviewCanvasRows`/`sortedCanvasRows`/`openReviewCanvasModal`/
  `state.reviewCanvas`) is deleted outright, code and all.
- **Участки** is renamed to **Предразбор**. No behavior change — same
  section-card grid (`reviewSectionsGrid`), same per-section modal
  (`renderReviewTable` → `reviewSectionTableWrap`), same actualize (▤) and
  ШК-exclusion (⛔) toolbar buttons.
- **Задачи** absorbs the entire standalone "Запросы" page (`requestsPage`,
  `openRequests` home tile, `REQUEST_SECTIONS`, `renderRequestsSections`,
  `requestsGroupedRows`, `openRequestsSectionModal`, `renderRequestsTable`,
  `state.requests`) as a tab inside "Разбор". The standalone page and its
  home-screen tile are removed; "Задачи" is the only way to reach this
  content going forward.
- **Чистые списания** is a placeholder tab — no data, no page navigation to
  `pure_losses.html`. It's the seed for a future reimagining of clean-writeoff
  review grouped by criteria instead of by участок; that grouping isn't
  designed yet, so this ships as a static "in progress" card.

The three tabs live in one pager inside the existing `reviewPage`; switching
between them is a horizontal slide (see [Flow §3](#3-content-pager)), not a
page navigation. Тулбар actions scoped to a single tab (▤/⛔) show only while
that tab is active.

## Scope

- **`WMSplus-main/tasks.html`**: toolbar switcher markup, new pager
  container/panels, removal of `requestsPage` section and its home tile,
  new CSS for the sliding tab indicator and the panel pager.
- **`WMSplus-main/tasks.js`**: rename/rewire the switcher's event handlers,
  relocate `renderRequestsSections`/`requestsGroupedRows`/
  `openRequestsSectionModal`/`renderRequestsTable`/`state.requests` calls
  into the new tab's DOM ids, delete all canvas-mode code, delete
  `showRequestsPage` and its nav wiring, add the pager's own switch
  function and the placeholder tab's render.
- No Supabase schema changes, no new tables/columns, no new RPCs — this is
  a pure client-side navigation/UI change over data this page already
  loads (`state.review.rows`, same source for both Предразбор and Задачи,
  since `wms_tasks` is one shared table).

## Global Constraints

- No build step — `<script>` includes only, same as the rest of this repo.
- `node --check tasks.js` after every edit round.
- Live browser verification via the repo's static preview server
  (`python3 -m http.server`), same pattern used for every prior change this
  session — read-only checks against the real Supabase project embedded in
  `auth.js`; no writes triggered during QA.
- Filters/sort stay independent per tab exactly as today: `state.review`
  (Предразбор) and `state.requests` (Задачи) remain two separate state
  objects — this redesign only relocates their DOM targets, it does not
  merge their state.
- Switching only via clicking the switcher (no touch/drag swipe on the
  content itself — confirmed with the user).
- Match the app's existing "liquid" motion language: reuse the
  `cubic-bezier(.34,1.56,.64,1)` spring easing already used for the header
  menu icons (`tasks.html` `.tasks-menu-item`), for both the switcher's
  sliding indicator and the panel pager.

## Flow

### 1. Switcher markup and sliding indicator

Replace the two-button `.review-view-tabs` in `reviewPage`'s toolbar
(`tasks.html:1934-1937`) with three buttons plus one indicator element:

```html
<div class="review-view-tabs review-view-tabs-3" aria-label="Вид разбора">
    <span id="reviewViewThumb" class="review-view-thumb" aria-hidden="true"></span>
    <button id="reviewTabPresort" class="review-view-tab active" type="button" data-tab-index="0">Предразбор</button>
    <button id="reviewTabTasks" class="review-view-tab" type="button" data-tab-index="1">Задачи</button>
    <button id="reviewTabPureLosses" class="review-view-tab" type="button" data-tab-index="2">Чистые списания</button>
</div>
```

`.review-view-thumb` is `position:absolute`, sized to one tab's width via
`width: calc(100% / 3)`, and moved with
`transform: translateX(calc(100% * <index>))` on a
`transition: transform .38s cubic-bezier(.34,1.56,.64,1)`. Its width/position
recompute is pure CSS (no JS measurement needed) since all three tabs share
equal width in the flex row. The three `.review-view-tab` buttons drop their
own `background`/`box-shadow` on `.active` (the thumb now supplies that
visual) and keep only the text-color swap.

A single `setReviewTab(index)` function drives all of this: sets
`$("reviewViewThumb").style.transform = "translateX(" + (index * 100) + "%)"`
directly (no CSS attribute-selector indirection needed), toggles each
button's `.active` class for text color and `aria-selected`, and calls
`slidePagerTo(index)` (Flow §3). Replaces today's two separate listeners
(`reviewViewSections` → `renderReview`, `reviewViewCanvas` →
`openReviewCanvasModal`) with three listeners all calling `setReviewTab`.

### 2. Toolbar tool buttons scoped to Предразбор

`#openActualizeTasks` and `#openShkExclusion` (the ▤ and ⛔ buttons,
`tasks.html:1931-1932`) get wrapped in a container that
`setReviewTab` shows only for index `0`:

```js
$("reviewToolbarPresortOnly").classList.toggle("hidden", index !== 0);
```

No change to what those buttons do — only whether they're visible.

### 3. Content pager

Below the toolbar, the three panels replace today's single
`reviewSectionsGrid` + `reviewTableWrap` pair:

```html
<div class="review-pager-viewport">
    <div id="reviewPagerTrack" class="review-pager-track">
        <div class="review-pager-panel">
            <!-- existing: reviewSectionsGrid + reviewTableWrap, unchanged ids -->
        </div>
        <div class="review-pager-panel">
            <!-- relocated: requestsSectionsGrid + requestsTableWrap, unchanged ids -->
        </div>
        <div class="review-pager-panel">
            <!-- new: static placeholder card -->
        </div>
    </div>
</div>
```

`.review-pager-viewport { overflow: hidden; }`,
`.review-pager-track { display:flex; transition: transform .38s
cubic-bezier(.34,1.56,.64,1); }`, `.review-pager-panel { flex: 0 0 100%;
min-width: 0; }`. `slidePagerTo(index)` sets
`track.style.transform = 'translateX(-' + (index * 100) + '%)'`. All three
panels stay mounted at all times — switching never re-fetches or re-renders
from scratch, it only moves the track and (for Предразбор/Задачи) whatever
their own render functions already keep current in the background. Height
is not animated: the viewport's height follows whichever panel is tallest
via normal flow (the track is a flex row, so the viewport's height equals
the tallest panel unless constrained) — acceptable per the agreed scope
(no drag-to-swipe, so a height jump on switch reads as part of the same
slide motion, not a separate jarring resize).

`reviewSectionsGrid`/`reviewTableWrap` keep their ids and all existing
render logic (`renderReview`, `renderReviewSections`, `renderReviewLanding`,
`openReviewSectionModal`) untouched — they just live inside the first panel
`<div>` instead of directly under `.review-shell`.

`requestsSectionsGrid`/`requestsTableWrap` (today under the standalone
`requestsPage`) move into the second panel, keeping their ids and all
existing functions (`renderRequests`, `renderRequestsSections`,
`requestsGroupedRows`, `openRequestsSectionModal`, `renderRequestsTable`,
`sortedRequestRows`) untouched. `loadReviewTasks()`'s `finally` block
already calls both `renderReview()` and `renderRequests()` unconditionally
(`tasks.js:2678` area) — both panels' content is always current regardless
of which tab is showing, so `setReviewTab` itself doesn't need to trigger
any fetch or render, only the visual switch. The one call site gated on
the old page model, `if (state.view === "requests") renderRequests();`
(`tasks.js:2452`, inside the incoming-flow duplicate auto-close routine),
is already redundant today — the `loadReviewTasks()` call two lines above
it re-renders both unconditionally — so it's simply deleted, not replaced.

### 4. Modal-refresh routing (a required side effect of removing two mode flags)

`refreshOpenSectionModal()` (`tasks.js:2755-2760`) currently picks which
table to re-render inside the shared `reviewSectionModal` by checking two
now-disappearing flags: `state.view === "requests"` (the standalone page)
and `state.review.modalMode === "canvas"`. With both gone, it needs a
different way to know whether the currently-open modal is showing a
Предразбор section or a Задачи section (Чистые списания never opens this
modal — no drill-down there). Add `activeTab: 0` to `state.review` (set by
`setReviewTab`, §1) and rewrite:

```js
function refreshOpenSectionModal() {
    if (!$("reviewSectionModal") || !$("reviewSectionModal").classList.contains("active")) return;
    if (state.review.activeTab === 1) renderRequestsTable(requestsGroupedRows());
    else renderReviewTable(reviewGroupedRows());
}
```

`state.review.modalMode` (set to `"section"`/`"canvas"`/`""` today) becomes
dead once the canvas branch that's its only reader is deleted — remove the
field and its three write sites (`openReviewSectionModal`,
`closeReviewSectionModal`, `openReviewCanvasModal` — the last of which is
deleted wholesale anyway) rather than leaving an unread flag behind.

### 5. Чистые списания placeholder

Third panel is fully static — no ids, no JS, just a centered card reusing
the existing `.empty-state`-style treatment:

```html
<div class="review-pager-panel">
    <div class="card" style="padding:32px;text-align:center;">
        <h3 style="margin:0 0 8px;">Чистые списания</h3>
        <p class="empty-state" style="margin:0;">Группировка по критериям — в разработке.</p>
    </div>
</div>
```

### 6. Deletions

- `tasks.html`: `<section id="requestsPage">` block removed entirely; its
  home-screen tile (`#openRequests` button, `tasks.html:1734` area) removed;
  the old two-button `.review-view-tabs` markup replaced per §1.
- `tasks.js`: delete `showRequestsPage`, its nav-button listener
  (`$("openRequests").addEventListener(...)`), the `requestsPage`
  active/inactive toggles scattered across the page-switching functions
  (`showReviewPage`/`showFlow`/etc. — anywhere that currently does
  `$("requestsPage").classList.remove("active")`), and all canvas-mode
  code: `renderReviewCanvasTable`, `reviewCanvasRows`, `sortedCanvasRows`,
  `openReviewCanvasModal`, `state.reviewCanvas`, and every remaining
  `"canvas"` branch in the shared filter helpers (`refreshOpenSectionModal`
  is handled separately in §4, not a plain deletion) — the `mode ===
  "canvas"` ternaries in `sectionFilterState` (2 call sites), the `mode ===
  "canvas"` check in `applySectionFilters`'s section-name filter, and the
  `mode === "canvas" ? control(...)` line in `renderSectionFilters` — each
  collapses to just the `"requests"`/default `state.review` branch once
  canvas is gone — plus the `reviewViewCanvas` id references.
- `tasks.html`: CSS rules that only ever applied to the deleted canvas
  table or the old two-button switcher get removed if nothing else uses
  them (confirm via grep before deleting each one — `.review-data-table`
  itself stays, it's shared with Предразбор/Задачи/inactive-tasks tables).

## Testing

- `node --check tasks.js`.
- Live static-server QA (as done throughout this session): confirm all
  three tabs render, confirm the thumb slides to the correct third-width
  position for each tab, confirm Предразбор's ▤/⛔ buttons are hidden on
  the other two tabs, confirm a Предразбор section click and a Задачи
  section click both still open the shared modal with correct data,
  confirm no leftover references to `requestsPage`/`openRequests`/
  `reviewViewCanvas`/`openReviewCanvasModal` (grep sweep), confirm the
  home screen no longer shows a "Запросы" tile.
- No new Supabase calls introduced — QA stays read-only exactly as in prior
  rounds this session.

## Out of scope

- The actual "group by criteria" design for Чистые списания — user is
  still deciding; this ships a static placeholder only.
- Touch/drag swipe gesture on the panel content.
- Any change to `pure_losses.html` itself.
