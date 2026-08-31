# Флоу, Фаза 1 (Движок/UX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Флоу MVP into a true continuous feed — a home-screen
banner that opens an unbroken loop of embedded task cards (auto-advancing
after every verdict/skip, tone-animated), with предсписок handled as a
full-mode handoff during its window — without touching the scoring formula,
the zone/roster model, server-side locking, or the classic (non-Флоу) разбор
path's behavior.

**Architecture:** No parallel UI is built. The existing `#taskDetailModal` /
`renderTaskDetail` — the exact same singleton DOM node and function the
classic разбор table already uses — gets a new CSS-only "embedded" display
mode, toggled by a state flag, so Флоу re-skins it into an inline card instead
of an overlay. Zero business logic in `renderTaskDetail`/
`completeTaskFromDetail`/etc. is duplicated or has its hardcoded element IDs
touched; the classic click-a-table-row path renders the identical DOM through
the identical code, unaffected by anything this plan adds. `completeTaskFromDetail`
gains one new branch (existing tone-celebration → advance-in-flow instead of
close, only when the embedded flag is set) and `issueNextFlowTask` is changed
to open the embedded card directly instead of the separate preview modal
(`renderFlowTaskCard`/`flowTaskModal`), which this plan leaves in place but
Флоу's own auto-loop stops calling.

**Tech Stack:** Vanilla JS (`tasks.js`, single IIFE, no framework, no bundler,
no test runner), static HTML/CSS (`tasks.html`), Supabase JS client. No
automated test suite exists in this repo — every task's verification step is
manual browser verification via the project's static preview server
(`.claude/launch.json` → `preview_start` with name `static`), following this
project's established pattern from its git history: incremental commits,
`node --check tasks.js` after every JS edit, live verification in the Claude
Browser pane, and — for anything touching real Supabase data — the existing
`state.flow.debugMode`-free real-data read paths plus
`supabase db query --linked` zero-write checks where a task could plausibly
write.

**Spec:** [docs/superpowers/specs/2026-08-31-flow-phase1-engine-ux-design.md](../specs/2026-08-31-flow-phase1-engine-ux-design.md)

## Global Constraints

- **Hard constraint, repeated explicitly by the user: do not break the
  existing разбор (task review) flow.** `renderTaskDetail`/`openTaskDetail`/
  `completeTaskFromDetail`/`updateTaskDetailForm` and their ~15 hardcoded
  element IDs (`taskVerdictPicker`, `taskCommentInput`, `completeTaskBtn`,
  `taskDetailHistoryFeed`, etc.) are NOT duplicated, NOT parameterized, and
  NOT otherwise rewritten by this plan. The classic path (clicking a row in
  the Разбор table, or opening a task from a notification) must render and
  behave identically before and after every task in this plan.
- Scoring formula (`flowScoreTask` and its components), the zone/roster model
  (two named shift roles), and task locking (`claimFlowTask`, advisory
  15-minute TTL, conflict modal) are unchanged — out of scope for this phase.
- Выгрузки (file uploads) are not touched and do not become part of the feed.
- No pilot-access tooling is built. The existing `FLOW_ALLOWED_USER_IDS` /
  `flowAccessAllowed()` gate stays exactly as-is; opening Флоу to everyone
  later is a manual one-line change the user makes when ready, not part of
  this plan's deliverables.
- Предсписок's own play mode (`renderPrespisokPlay` and everything under it —
  timer, HUD, verdicts, burn/sparkle/slide animations, counters) is not
  modified. This plan only adds the hook that hands control to it and back.
- Every JS-touching task ends with `node --check tasks.js` passing and a live
  browser verification step before the commit step.

---

## File Structure

- **`tasks.html`**
  - New CSS block (near the existing `.tasks-flow-modal.upload-work` rules,
    `tasks.html:341-365`, and `.task-detail-card` rules, `tasks.html:464-471`):
    an `.is-flow-embedded` modifier that re-skins `#taskDetailModal` from a
    fixed overlay into an inline block, plus a small `.flow-why-box` style for
    the "why this task" panel injected in Task 4.
  - New static markup: the "Флоу — Дай мне задачу" banner, inserted into
    `#tasksHome` (`tasks.html:1137`) immediately before the existing
    `Предразбор` group (`tasks.html:1138`).
- **`tasks.js`**
  - `state.flow` gets one new field: `embedded` (boolean, default `false`) —
    whether the task-detail card is currently being shown in Флоу's inline
    mode vs. the classic overlay.
  - New functions: `setFlowEmbeddedMode(active)`, `flowWhyBoxHtml(score)`,
    `openFlowTaskEmbedded(row, scored)`, `advanceFlowAfterResolution()`,
    `requestFlowExit()`, `flowPrespisokCandidate()`,
    `enterPrespisokFromFlow()`.
  - Modified functions: `issueNextFlowTask` (opens the embedded card instead
    of the separate preview modal), `completeTaskFromDetail` (one new branch
    at its existing celebration call site), `skipFlowTaskFromModal` (advances
    through the same embedded-aware helper instead of calling
    `issueNextFlowTask` directly), `refreshFlowQueue`'s candidate list (folds
    in the предсписок candidate — see Task 8).
  - No changes to: `renderTaskDetail`, `openTaskDetail`, `renderFlowTaskCard`,
    `openFlowTaskCard`, `closeFlowTaskCard`, `claimFlowTask`,
    `flowScoreTask` and its components, `flowLockInfo`/`flowRowIsLockedForOther`.

---

### Task 1: CSS — inline "embedded" mode for the task-detail card

**Files:**
- Modify: `tasks.html:362` (add rule after `.tasks-flow-modal.upload-work.active`)
- Modify: `tasks.html:471` (add rule after `.task-celebration-icon`)

**Interfaces:**
- Consumes: nothing (pure CSS, no JS yet).
- Produces: a `.is-flow-embedded` class on `#taskDetailModal` that later tasks
  toggle from JS. `.flow-why-box` class Task 4 will use.

- [ ] **Step 1: Add the embedded-mode override rule**

In `tasks.html`, right after the line `.tasks-flow-modal.upload-work.active { display: flex; }` (`tasks.html:362`), add:

```css
        .tasks-flow-modal.upload-work.is-flow-embedded {
            position: static;
            inset: auto;
            width: 100%;
            min-height: 0;
            z-index: auto;
            padding: 0;
            background: transparent;
            backdrop-filter: none;
            animation: none;
        }
        .tasks-flow-modal.upload-work.is-flow-embedded.active { display: flex; }
        .is-flow-embedded .task-detail-card { width: 100%; max-height: none; margin: 0; }
```

- [ ] **Step 2: Add the "why this task" box style**

Right after the line `.task-celebration-icon { font-size: 104px; line-height: 1; color: #fff; font-weight: 900; animation: taskCelebrationIconPop .5s .15s cubic-bezier(.2,1.6,.3,1.1) both; }` (`tasks.html:471`), add:

```css
        .flow-why-box { margin: 0 0 12px; padding: 12px 14px; border-radius: 14px; background: #f1f5f9; }
        .flow-why-box strong { display: block; margin-bottom: 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
        .flow-why-box .flow-reason { font-size: 13px; color: #334155; padding: 2px 0; }
```

- [ ] **Step 3: Verify nothing rendered yet changes**

Run: `node --check tasks.js` (should still pass unrelated — this task only
touches `.html`; run it anyway since it's part of every task's checklist).
Open the app via the project's static preview (`preview_start` with name
`static`), click any row in the Разбор table, confirm the task-detail modal
opens exactly as before (still a floating overlay with backdrop) — the new
CSS classes aren't applied to anything yet, so this must be a no-op visually.

- [ ] **Step 4: Commit**

```bash
git add tasks.html
git commit -m "Add dormant CSS for Флоу's inline task-detail embedding"
```

---

### Task 2: Home-screen entry banner

**Files:**
- Modify: `tasks.html:1137-1138` (insert new block between the `<section
  id="tasksHome" class="tasks-home-groups">` opening tag and the first
  `Предразбор` group `<div>`)
- Modify: `tasks.js` (new listener near the other home-card wiring — see
  Task 2's Step 3 for the exact anchor)

**Interfaces:**
- Consumes: `showFlowPage()` (existing, `tasks.js:1928`), `flowAccessAllowed()`
  (existing, `tasks.js:8363`).
- Produces: `#startFlowBanner` button in the DOM, gated by the same
  `[data-dev-only]` mechanism as the rest of Флоу's UI.

- [ ] **Step 1: Add the banner markup**

In `tasks.html`, between line 1137 (`<section id="tasksHome"
class="tasks-home-groups">`) and line 1138 (`<div class="tasks-home-group">`
for Предразбор), insert:

```html
        <div class="flow-home-banner" data-dev-only>
            <span class="flow-home-banner-kicker">Флоу</span>
            <button id="startFlowBanner" class="flow-home-banner-btn" type="button">Дай мне задачу</button>
        </div>
```

- [ ] **Step 2: Add the banner CSS**

Add near the other `.tasks-home-*` rules in `tasks.html` (search for
`.tasks-home-groups` to find that block; add immediately after it):

```css
        .flow-home-banner { margin-bottom: 18px; padding: 22px; border-radius: 18px; background: linear-gradient(120deg, #623cea, #8b5cf6); color: #fff; text-align: center; }
        .flow-home-banner.is-disabled { opacity: .5; pointer-events: none; }
        .flow-home-banner-kicker { display: block; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .8; margin-bottom: 10px; }
        .flow-home-banner-btn { font-size: 22px; padding: 16px 36px; border-radius: 16px; background: #fff; color: #623cea; border: 0; font-weight: 800; cursor: pointer; }
        .flow-home-banner-btn:hover { transform: translateY(-2px); }
```

- [ ] **Step 3: Wire the button and extend the access gate**

`renderFlowAccessGate()` (`tasks.js:8375-8382`) already does
`document.querySelectorAll("[data-dev-only]")` and toggles `.is-disabled` +
`disabled` — since the new banner's wrapper carries `data-dev-only` too, it is
automatically covered with no code change needed there. Only the click
listener is new. Find the existing `$("openFlow").addEventListener(...)` line
(search `tasks.js` for `"openFlow"`) and add a sibling listener right after
it:

```js
    $("startFlowBanner").addEventListener("click", () => { void showFlowPage(); });
```

- [ ] **Step 4: Verify**

Run: `node --check tasks.js`. In the browser, as the pilot user (whatever ID
is currently in `FLOW_ALLOWED_USER_IDS`), reload the app — the banner should
appear above "Предразбор" and clicking it should open the Флоу page exactly
as clicking the existing "Флоу" card under "В разработке" does. Log in (or
simulate via `currentWmsUser()`) as a non-pilot user and confirm the banner
renders disabled/dimmed (`.is-disabled`) and the click does nothing, matching
the existing dev-only cards' behavior.

- [ ] **Step 5: Commit**

```bash
git add tasks.html tasks.js
git commit -m "Add Флоу entry banner above Предразбор on the home screen"
```

---

### Task 3: Embedded-mode toggle + "why this task" injection

**Files:**
- Modify: `tasks.js` — add `state.flow.embedded = false;` to the `flow: { ... }`
  state object (`tasks.js:574-593`, add the new field inside that block).
- Modify: `tasks.js` — new functions placed right after `closeFlowTaskCard`
  (`tasks.js:5556-5559`).

**Interfaces:**
- Consumes: `state.flow.currentScore` (existing, set by `claimFlowTask`'s
  caller — see Task 4), `$` helper.
- Produces: `setFlowEmbeddedMode(active)` and `flowWhyBoxHtml(score)`, used by
  Task 4 and Task 5.

- [ ] **Step 1: Add the state field**

In `tasks.js`, inside the `flow: { ... }` block of the top-level `state`
object (`tasks.js:574-593`), add a line right after `currentScore: null,`:

```js
            embedded: false,
```

- [ ] **Step 2: Add `setFlowEmbeddedMode` and `flowWhyBoxHtml`**

Right after `closeFlowTaskCard` (`tasks.js:5556-5559`), add:

```js
    // Toggles #taskDetailModal between the classic floating overlay and
    // Флоу's inline card (see the .is-flow-embedded CSS added in Task 1).
    // Does not touch renderTaskDetail or any of its ~15 hardcoded element
    // IDs -- same DOM node, same function, only its own wrapper's CSS class
    // changes.
    function setFlowEmbeddedMode(active) {
        state.flow.embedded = Boolean(active);
        const modal = $("taskDetailModal");
        if (modal) modal.classList.toggle("is-flow-embedded", state.flow.embedded);
    }

    function flowWhyBoxHtml(score) {
        if (!score || !Array.isArray(score.reasons) || !score.reasons.length) return "";
        return "<div class='flow-why-box'><strong>Почему эта задача</strong>"
            + score.reasons.slice(0, 8).map((reason) => "<div class='flow-reason'>" + escapeHtml(reason) + "</div>").join("")
            + "</div>";
    }
```

- [ ] **Step 3: Verify**

Run: `node --check tasks.js`. Nothing calls these functions yet, so there is
no visible behavior change — this step only confirms the file still parses.
Open the app, click a Разбор table row again, confirm the classic modal still
opens as an overlay (unaffected, since `setFlowEmbeddedMode` is never called
outside Флоу yet).

- [ ] **Step 4: Commit**

```bash
git add tasks.js
git commit -m "Add embedded-mode toggle and why-this-task box for Флоу"
```

---

### Task 4: Claim → embedded card (replace the separate preview step)

**Files:**
- Modify: `tasks.js:5393-5436` (`issueNextFlowTask`)
- Modify: `tasks.js:7794-7807` (`renderTaskDetail`'s `target.innerHTML =`
  assembly, to splice in the why-box only when embedded)

**Interfaces:**
- Consumes: `setFlowEmbeddedMode` (Task 3), `flowWhyBoxHtml` (Task 3),
  `claimFlowTask` (existing, unchanged), `openTaskDetail` (existing,
  unchanged signature).
- Produces: clicking "Дай мне задачу" (or its "Открыть текущую" re-entry
  state) now shows the claimed task's full detail card inline immediately,
  no intermediate `renderFlowTaskCard` preview.

- [ ] **Step 1: Point `issueNextFlowTask` at the embedded card**

In `tasks.js`, inside `issueNextFlowTask` (`tasks.js:5393-5436`), find:

```js
            const row = await claimFlowTask(next.row, next);
            state.flow.currentRowId = row.id;
            state.flow.currentScore = next;
            refreshFlowQueue();
            state.flow.status = "Задача выдана и закреплена на " + flowSettingNumber("lockTtlMinutes", 15) + " минут: " + displayTaskTitle(row) + ".";
            state.flow.statusTone = "good";
            renderFlowPage();
            openFlowTaskCard(row.id);
```

Replace the last line (`openFlowTaskCard(row.id);`) with:

```js
            setFlowEmbeddedMode(true);
            openTaskDetail(row.id, "flow");
```

Also find, earlier in the same function:

```js
        const currentRow = state.flow.currentRowId ? findTaskRow(state.flow.currentRowId) : null;
        if (currentRow && isActiveReviewTask(currentRow)) {
            openFlowTaskCard(currentRow.id);
            return;
        }
```

Replace its body with:

```js
        const currentRow = state.flow.currentRowId ? findTaskRow(state.flow.currentRowId) : null;
        if (currentRow && isActiveReviewTask(currentRow)) {
            setFlowEmbeddedMode(true);
            openTaskDetail(currentRow.id, "flow");
            return;
        }
```

- [ ] **Step 2: Splice the why-box into the embedded card only**

In `renderTaskDetail` (`tasks.js:7721` onward), find the `target.innerHTML =`
assembly (`tasks.js:7794-7807`):

```js
        target.innerHTML = "<div class='task-detail-head'><div>"
            + "<div class='task-detail-created'>Создано " + escapeHtml(formatRuDateTime(row.created_at)) + "</div>"
            + "<div class='task-detail-title-row'><h3 class='task-detail-title copyable' data-copy-value='" + escapeHtml(displayTaskTitle(row)) + "' title='Нажми, чтобы скопировать'>" + escapeHtml(displayTaskTitle(row)) + "</h3><div class='task-detail-price' style='" + priceStyle(row.source_price_sum) + "'>" + escapeHtml(formatMoney(row.source_price_sum)) + "</div>" + countdownHtml + "</div>"
            + "<div class='review-table-subtitle'>" + escapeHtml(row.task_type || "-") + "</div></div>" + taskDetailActionButtons(row, readOnly) + "</div>"
            + "<div class='task-detail-body'>"
            + "<div class='task-info-grid'>" + taskDetailInfo(row) + "</div>"
            + taskTagsBox(row)
            + incomingFlowShkInfoBox(row)
            + taskTareInfoBox(row, readOnly)
            + "<div class='task-chat-panel'>"
            + "<div id='taskDetailHistoryFeed' class='task-chat-history'>Загрузка истории…</div>"
            + reviewBlock
            + "</div>"
            + "</div>";
```

Replace the `"<div class='task-detail-body'>"` line with:

```js
            + "<div class='task-detail-body'>"
            + (state.flow.embedded && state.taskDetail.source === "flow" ? flowWhyBoxHtml(state.flow.currentScore) : "")
```

(Every other line in that block is unchanged — only this one line gains the
conditional why-box. This is an additive, always-safe-when-false branch: for
the classic path, `state.flow.embedded` is `false`, so this evaluates to `""`
exactly as before.)

- [ ] **Step 3: Reset embedded mode when the task-detail modal closes outside Флоу**

Find `closeTaskDetail` (`tasks.js:6846-6852`):

```js
    function closeTaskDetail() {
        if (state.taskDetail && state.taskDetail.countdownTimer) {
            clearInterval(state.taskDetail.countdownTimer);
            state.taskDetail.countdownTimer = null;
        }
        setFlowModalOpen("taskDetailModal", false);
    }
```

Replace with:

```js
    function closeTaskDetail() {
        if (state.taskDetail && state.taskDetail.countdownTimer) {
            clearInterval(state.taskDetail.countdownTimer);
            state.taskDetail.countdownTimer = null;
        }
        setFlowModalOpen("taskDetailModal", false);
        if (state.flow.embedded) setFlowEmbeddedMode(false);
    }
```

(This only fires when the modal is actually closed — the classic path already
calls `closeTaskDetail` on its own "×"/close actions, so this is a no-op for
it since `state.flow.embedded` is always `false` there.)

- [ ] **Step 4: Verify**

Run: `node --check tasks.js`. In the browser:
1. Classic path — click a Разбор table row. Confirm: still opens as a
   floating overlay (no why-box, since `state.taskDetail.source` is
   `"review"` not `"flow"`), verdict picker/history/etc. all identical to
   before this plan started.
2. Флоу path — as the pilot user, click the new banner (or existing Флоу
   card) to reach the Флоу page, click "Получить задачу". Confirm: no
   separate preview card appears — the task-detail card renders inline (no
   backdrop, sits within the Флоу page), with a "Почему эта задача" box at
   the top of the body showing the score reasons.
3. Close the embedded card via its own "×" (`closeTaskDetail`) and confirm
   `state.flow.embedded` resets (re-open the classic path again afterward and
   confirm it's back to a normal floating overlay — check via
   `document.getElementById("taskDetailModal").classList.contains("is-flow-embedded")`
   returning `false` in devtools).

- [ ] **Step 5: Commit**

```bash
git add tasks.js
git commit -m "Флоу: claim opens the embedded task-detail card directly"
```

---

### Task 5: Auto-advance after a verdict is saved

**Files:**
- Modify: `tasks.js:8916` (inside `completeTaskFromDetail`)
- Modify: `tasks.js:9028` (the no-shk-review-style second celebration call
  site — confirm during implementation whether it needs the same branch;
  see Step 2)

**Interfaces:**
- Consumes: `playTaskCompletionCelebration(tone)` (existing, unchanged,
  `tasks.js:6856-6874`), `state.flow.embedded` (Task 3).
- Produces: `advanceFlowAfterResolution()`, called instead of `closeTaskDetail`
  when a verdict resolves while embedded.

- [ ] **Step 1: Add `advanceFlowAfterResolution`**

Right after `setFlowEmbeddedMode`/`flowWhyBoxHtml` (added in Task 3), add:

```js
    // After a verdict/skip resolves inside the embedded card, stay in
    // embedded mode and immediately claim+show the next task -- this is
    // what makes Флоу feel like one continuous feed instead of "resolve,
    // then click Получить задачу again".
    function advanceFlowAfterResolution() {
        if (!state.flow.embedded) { closeTaskDetail(); return; }
        state.flow.currentRowId = "";
        state.flow.currentScore = null;
        void issueNextFlowTask();
    }
```

- [ ] **Step 2: Hook it into `completeTaskFromDetail`'s celebration**

In `completeTaskFromDetail` (`tasks.js:8794-8923`), find:

```js
            if (!incomingFlow && tone) void playTaskCompletionCelebration(tone).then(closeTaskDetail);
            else closeTaskDetail();
```

Replace with:

```js
            const afterCelebration = state.flow.embedded ? advanceFlowAfterResolution : closeTaskDetail;
            if (!incomingFlow && tone) void playTaskCompletionCelebration(tone).then(afterCelebration);
            else afterCelebration();
```

- [ ] **Step 3: Check the second celebration call site**

`tasks.js:9028` (`void playTaskCompletionCelebration("yellow").then(closeTaskDetail);`)
is inside a different function — read the ~15 lines around it during
implementation to confirm whether it's reachable while `state.taskDetail.source
=== "flow"` (i.e. whether Флоу's embedded card can trigger this particular
code path, likely a defer/expensive-writeoff-confirm flow). If it is
reachable from the embedded card, apply the identical replacement as Step 2.
If it's only reachable from a context Флоу never opens (e.g. a modal only
launched from the classic table), leave it untouched and note that in the
commit message.

- [ ] **Step 4: Verify**

Run: `node --check tasks.js`. In the browser, as the pilot user, go through
the Флоу banner, get a task, fill in a verdict, submit. Confirm: the existing
tone-colored celebration overlay plays (same as today's classic path), and
immediately after, a new task claims and renders inline — no manual click
needed. Then verify the classic path once more (table row click → complete a
verdict) still closes the modal as before, not advancing anywhere (since
`state.flow.embedded` is `false` there).

- [ ] **Step 5: Commit**

```bash
git add tasks.js
git commit -m "Флоу: auto-advance to the next task after a verdict resolves"
```

---

### Task 6: Auto-advance after skip

**Files:**
- Modify: `tasks.js:7713-7719` (`taskDetailActionButtons`)
- Modify: `tasks.js:7816` area (`renderTaskDetail`'s event wiring)
- Modify: `tasks.js:5662-5667` (inside `skipFlowTaskFromModal`)

**Interfaces:**
- Consumes: `advanceFlowAfterResolution` (Task 5), `openFlowSkipModal`
  (existing, `tasks.js:5573-5583`, unchanged).
- Produces: a skip control on the embedded card (Task 4 removed the only
  place skip used to live — `renderFlowTaskCard`'s preview card — from
  Флоу's loop, so the embedded card needs its own), and skip advancing the
  same way completion does.

- [ ] **Step 1: Add a skip button to the embedded card's action row**

In `tasks.js`, `taskDetailActionButtons(row, readOnly)` (`tasks.js:7713-7719`), find the non-readOnly branch:

```js
        const defer = isPrespisokTask(row) ? "" : "<button id='openDeferTaskBtn' class='btn btn-square' type='button' title='Отложить'>◴</button>";
        return "<div class='task-detail-actions'>" + defer + "<button id='closeTaskDetail' class='btn btn-square' type='button'>×</button></div>";
```

Replace with:

```js
        const defer = isPrespisokTask(row) ? "" : "<button id='openDeferTaskBtn' class='btn btn-square' type='button' title='Отложить'>◴</button>";
        const flowSkip = (state.flow.embedded && state.taskDetail.source === "flow") ? "<button id='flowSkipFromEmbedded' class='btn btn-square' type='button' title='Скипнуть с причиной'>⏭</button>" : "";
        return "<div class='task-detail-actions'>" + defer + flowSkip + "<button id='closeTaskDetail' class='btn btn-square' type='button'>×</button></div>";
```

- [ ] **Step 2: Wire its click handler**

In `renderTaskDetail`, find the existing line
`$("closeTaskDetail").addEventListener("click", closeTaskDetail);`
(`tasks.js:7816`). Add right after it:

```js
        const flowSkipBtn = $("flowSkipFromEmbedded");
        if (flowSkipBtn) flowSkipBtn.addEventListener("click", () => openFlowSkipModal(row.id));
```

- [ ] **Step 3: Replace `skipFlowTaskFromModal`'s advance call**

In `tasks.js`, inside `skipFlowTaskFromModal` (`tasks.js:5599-5675`), find:

```js
            closeFlowSkipModal();
            closeFlowTaskCard();
            refreshFlowQueue();
            renderFlowPage();
            toast("Скип записан. Беру следующую.", "success");
            void issueNextFlowTask();
```

Replace the last line with:

```js
            closeFlowSkipModal();
            closeFlowTaskCard();
            refreshFlowQueue();
            renderFlowPage();
            toast("Скип записан. Беру следующую.", "success");
            advanceFlowAfterResolution();
```

(`closeFlowTaskCard()` on the line above targets `#flowTaskModal`, the
separate preview card Task 4 stopped opening from Флоу's own loop — it's now
inert for Флоу but harmless to leave, since it still matters for anyone
reaching skip through `renderFlowCurrent`'s "Скипнуть" button outside the
embedded flow, which this plan does not remove. `openFlowSkipModal` itself
opens `#flowSkipModal`, a separate DOM node from `#taskDetailModal`, so it
keeps its normal floating-overlay CSS untouched by Task 1's
`.is-flow-embedded` modifier — it will still layer correctly on top of the
now-inline card.)

- [ ] **Step 4: Verify**

Run: `node --check tasks.js`. In the browser, in the Флоу embedded card,
click the new skip ("⏭") button, submit a reason. Confirm the next task
auto-claims and renders inline exactly like after a completed verdict.
Separately, confirm the classic path is unaffected: click a table row to
open a task normally — the skip button must NOT appear (`state.flow.embedded`
is `false` there), only the existing defer/close buttons.

- [ ] **Step 5: Commit**

```bash
git add tasks.js
git commit -m "Флоу: skip button on the embedded card, auto-advances like completion"
```

---

### Task 7: Exit control ("×") for the Флоу session

**Files:**
- Modify: `tasks.js` — new `requestFlowExit()` near `setFlowEmbeddedMode`.
- Modify: `tasks.html` — no new markup; reuses the existing embedded card's
  `#closeTaskDetail` button (already present via `taskDetailActionButtons`),
  wired to a Флоу-aware handler only when embedded.

**Interfaces:**
- Consumes: `showHome()` (existing, `tasks.js:1703-1716`).
- Produces: closing the embedded card while in Флоу returns to the home
  screen (not just closes the modal into a blank Флоу page).

- [ ] **Step 1: Add `requestFlowExit`**

Right after `advanceFlowAfterResolution` (Task 5), add:

```js
    // The embedded card's own "×" already calls closeTaskDetail (which
    // resets embedded mode -- Task 4 Step 3). This wraps that with a return
    // to the home screen so exiting Флоу doesn't strand the user on an
    // empty Флоу page.
    function requestFlowExit() {
        closeTaskDetail();
        showHome();
    }
```

- [ ] **Step 2: Route the embedded card's close button through it**

In `renderTaskDetail`, find the existing close-button wiring added/confirmed
in Task 4 Step 3 / Task 6 Step 3 area — specifically
`$("closeTaskDetail").addEventListener("click", closeTaskDetail);`
(`tasks.js:7816`). Replace it with:

```js
        $("closeTaskDetail").addEventListener("click", () => {
            if (state.flow.embedded && state.taskDetail.source === "flow") requestFlowExit();
            else closeTaskDetail();
        });
```

- [ ] **Step 3: Verify**

Run: `node --check tasks.js`. In the browser:
1. Flow path — get a task via the banner, click the card's "×". Confirm it
   returns to the home screen (not a blank Флоу page), and the banner is
   clickable again to start a fresh feed.
2. Classic path — click a table row to open a task, click its "×". Confirm
   it still just closes the modal (stays wherever it was — the Разбор table),
   exactly as before this plan.

- [ ] **Step 4: Commit**

```bash
git add tasks.js
git commit -m "Флоу: exiting the embedded card returns to the home screen"
```

---

### Task 8: Предсписок handoff

**Files:**
- Modify: `tasks.js:5393-5436` (`issueNextFlowTask`) — check for a
  предсписок candidate before falling through to the regular scored queue.
- Modify: `tasks.js` — new `flowPrespisokCandidate()` and
  `enterPrespisokFromFlow()`.

**Interfaces:**
- Consumes: `prespisokWindowInfo()` (existing, `tasks.js:12754-12768`),
  `loadPrespisokState()` (existing, `tasks.js:12890-12919` — confirmed: reads
  `localStorage`, and only when a saved run matches today's date and isn't
  finished does it overwrite `state.prespisok.{rows,items,index,actions,...}`
  from storage, returning `Boolean(state.prespisok.items.length)`; otherwise
  it returns `false` without touching state), `openPrespisokModal()`
  (existing, `tasks.js:13106` onward), `closePrespisokModal()` (existing,
  `tasks.js:13137-13158`).
- Produces: when предсписок's window is open and there's an unfinished local
  предсписок run, Флоу offers "Разобрать предсписок (осталось N)" as a
  candidate; picking it opens предсписок's own full play mode; finishing or
  exiting предсписок returns to the Флоу loop.

**Known limitation, explicitly in scope for this task to leave unhandled:**
`loadPrespisokState()` only finds a run this same browser/device has already
loaded into `localStorage` (via uploading the file itself, or a prior visit
to предсписок's own home card, which calls the remote-run fetchers). A device
that has never opened предсписок today but wants Флоу to hand off to a
*remote* run someone else started will not see it as a candidate — Флоу will
simply fall through to its regular task queue. The user can still reach that
remote run manually via предсписок's own home card ("Подключиться к
разбору"). Extending Флоу's candidate check to also poll the remote run
fetchers is not part of this plan.

- [ ] **Step 1: Add `flowPrespisokCandidate`**

Right after `requestFlowExit` (Task 7), add:

```js
    // Предсписок does not score per-ШК in flowScoreTask -- it isn't a
    // wms_tasks row. It participates in Флоу's rotation as a single slot:
    // present whenever the window is open and there's real local work left.
    // Safe to call on every issueNextFlowTask() pass even though
    // loadPrespisokState() overwrites state.prespisok from localStorage --
    // this only runs while предсписок's own UI is closed (Флоу never calls
    // it once handed off), and предсписок persists after every action, so
    // localStorage is always a faithful mirror of state.prespisok whenever
    // this executes.
    function flowPrespisokCandidate() {
        const info = prespisokWindowInfo();
        if (!info.inWindow) return null;
        const hasLocalRun = Boolean(loadPrespisokState());
        if (!hasLocalRun) return null;
        const remaining = Math.max((state.prespisok.items || []).length - (state.prespisok.actions || []).length, 0);
        if (!remaining) return null;
        return { remaining };
    }

    function enterPrespisokFromFlow() {
        void openPrespisokModal();
    }
```

- [ ] **Step 2: Offer it ahead of the regular queue**

In `issueNextFlowTask` (`tasks.js:5393-5436`), find:

```js
        try {
            await ensureReviewTasksLoaded();
            const scored = refreshFlowQueue();
            const next = scored[0];
            if (!next) {
```

Insert a check immediately after `await ensureReviewTasksLoaded();`:

```js
            const prespisokCandidate = flowPrespisokCandidate();
            if (prespisokCandidate) {
                state.flow.claiming = false;
                state.flow.status = "Открываю предсписок: осталось " + prespisokCandidate.remaining + ".";
                state.flow.statusTone = "good";
                renderFlowPage();
                enterPrespisokFromFlow();
                return;
            }
            const scored = refreshFlowQueue();
            const next = scored[0];
            if (!next) {
```

- [ ] **Step 3: Return to Флоу when предсписок finishes or is closed**

`closePrespisokModal()` (`tasks.js:13137-13158`) is предсписок's single exit
point — both manually closing it and closing its finish screen after
completing all items funnel through this one function. Find:

```js
        if (state.prespisok.debugMode) resetPrespisokState();
        setFlowModalOpen("prespisokModal", false);
    }
```

Replace with:

```js
        if (state.prespisok.debugMode) resetPrespisokState();
        setFlowModalOpen("prespisokModal", false);
        if (state.view === "flow") void issueNextFlowTask();
    }
```

(This only fires when предсписок is closed while `state.view === "flow"` —
i.e. only when Флоу is the one that opened it via `enterPrespisokFromFlow`.
Reaching предсписок any other way, e.g. its own home card, leaves
`state.view` as `"home"` and this line is a no-op, matching today's
behavior exactly.)

- [ ] **Step 4: Verify**

This step needs real production data and must go through the same care this
session already established for предсписок: use the existing debug/read-only
verification path (the "Отладка" dev tool) to confirm predsп isok's own play
mode is completely unaffected by this hook, then verify the handoff itself
during predsп isok's real window using a throwaway/observation-only pass —
confirm via `supabase db query --linked` that Флоу's own actions (task claims
it issues before/after the handoff) didn't fire while inside предсписок, and
that no предсписок writes happened outside of predsп isok's own established
write path. Confirm: with the window open and an unfinished predsп isok run
present, "Получить задачу" from the Флоу banner opens predsп isok's real play
screen (own timer/HUD/verdicts) instead of a regular task card; finishing a
predsп isok item or closing predsп isok returns to Флоу's loop.

- [ ] **Step 5: Commit**

```bash
git add tasks.js
git commit -m "Флоу: hand off to предсписок's own play mode during its window"
```

---

### Task 9: Full regression pass

**Files:** none (verification-only task).

**Interfaces:** none.

- [ ] **Step 1: Classic разбор regression checklist**

In the browser, as a user NOT in `FLOW_ALLOWED_USER_IDS` (so Флоу never
engages): open the Разбор table, click into several different task rows
(including at least one incoming-flow "Запрос" row, which uses
`INCOMING_FLOW_ATTACHMENT_OPTIONS` and the "ID виновного" field). For each:
confirm the modal opens as a floating overlay with backdrop, the verdict
picker/compose bar/history feed/tags/tare box all render and behave exactly
as they did before this plan (compare against this plan's Task 1 Step 3
baseline screenshot if one was taken), submitting a verdict shows the
existing tone-celebration and then closes the modal (no auto-advance, since
`state.flow.embedded` is never `true` for this user).

- [ ] **Step 2: Флоу continuous-loop checklist**

As the pilot user: open the app, use the new home-screen banner, resolve
several tasks in a row (mix of verdict completion and at least one skip),
confirm the feed never returns to a manual "click to get next" state between
items. Exit via "×" mid-loop and confirm it returns to the home screen with
no stuck/loading state. Re-enter and confirm a fresh task claims correctly.

- [ ] **Step 3: Предсписок handoff checklist**

During предсписок's real window (or with `PRESPISOK_TEST_MODE` enabled if
that's how this session has been testing it — confirm the flag's current
value via `grep -n "PRESPISOK_TEST_MODE" tasks.js` before relying on it),
with an unfinished предсписок run present, confirm Флоу routes into
предсписок's own play mode and back out, per Task 8's Step 4.

- [ ] **Step 4: Zero-write sanity check**

Run `supabase db query --linked` against `wms_tasks`/`wms_task_history`/
`wms_prespisok_actions`/`wms_prespisok_runs` filtered to the last ~15 minutes,
matching this session's established pattern, to confirm every write observed
during this verification pass corresponds to an action the tester actually
took (no duplicate writes, no unexpected предсписок writes from the handoff
mechanism itself).

- [ ] **Step 5: Final commit**

If Steps 1-4 required any fixes, commit them individually as they're made
(following this plan's established pattern of one focused commit per fix).
If no fixes were needed, this task produces no commit — note that in the
session summary instead.
