# Warehouse Game Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new, standalone `warehouse.html` page that renders a static 5×5 isometric grid with one visually distinct starting plot at its center — the first, purely visual increment of a mobile warehouse-building game.

**Architecture:** A single self-contained HTML file (markup + inline `<style>` + inline `<script>`, no separate JS file, no build step). A tiny login-gate script mirrors the existing site's `localStorage.user` check. The isometric look comes from a `display:grid` container of 25 tile `<div>`s rotated as a whole via CSS 3D transforms (`rotateX`/`rotateZ`); the center tile gets an extra `translateZ` + distinct styling to read as a built structure versus flat ground.

**Tech Stack:** Vanilla HTML/CSS/JS. No dependencies (this increment makes no Supabase calls, so the Supabase JS UMD bundle other pages load is not needed here).

**Spec:** `docs/superpowers/specs/2026-09-18-warehouse-game-skeleton-design.md`

## Global Constraints

- New file only: `warehouse.html` at repo root. No other repo file is modified (not linked from `index.html`, `tasks.html`, or any menu/sidebar).
- Self-contained: all CSS and JS inline in `warehouse.html`. No bundler, no npm packages, no CDN libraries.
- No Supabase calls, no new tables, no writes — this increment is visual-only (per spec's Non-goals).
- Grid is exactly 5×5 tiles, 0-indexed. The center tile is at `[2, 2]` (row 2, column 2) and is the only tile rendered as the starting plot; the other 24 tiles render as flat empty ground.
- Grid tile data lives in one JS array/constant so a later increment can extend it without restructuring the render function (per spec's Visual/geometry section).
- Login gate: if `localStorage.getItem('user')` is missing or fails to parse as JSON, redirect to `login.html`. No per-page `accesses` check (per spec's Routing/access section — this page has no `accesses` entry).
- Mobile-first viewport (`width=device-width, initial-scale=1`), grid must not cause horizontal overflow at 375px width.
- No automated test framework in this repo — verification is manual (script syntax check + browser QA).

---

### Task 1: Create the warehouse.html skeleton

**Files:**
- Create: `warehouse.html`

**Interfaces:**
- Produces: a `GRID_TILES` JS array in `warehouse.html`'s inline script — an array of `{ row, col, type }` objects, one entry per tile (25 entries for a fully-enumerated 5×5 grid; `type` is `"plot"` for the center tile at `row:2, col:2` and `"ground"` for the other 24). This is the shape any future increment (buying tiles, expanding the grid) will read and extend — do not change this shape without updating this plan's description of it.

- [ ] **Step 1: Write `warehouse.html`**

Create `/Users/WBwork/Downloads/WMSplus-main/warehouse.html` with this exact content:

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Склад</title>
<style>
  :root {
    --ground: #d9c9a3;
    --ground-line: #c2ae7c;
    --plot: #8b6f4e;
    --plot-top: #a9855c;
    --bg: #eef2f7;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    height: 100%;
    background: var(--bg);
    font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    overflow-x: hidden;
  }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100%;
    padding: 16px;
  }
  h1 {
    font-size: 20px;
    color: #1f2937;
    margin: 0 0 24px;
  }
  .iso-stage {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    perspective: 1400px;
    padding: 40px 0;
  }
  .iso-grid {
    display: grid;
    grid-template-columns: repeat(5, 48px);
    grid-template-rows: repeat(5, 48px);
    gap: 3px;
    transform: rotateX(55deg) rotateZ(45deg);
    transform-style: preserve-3d;
  }
  .iso-tile {
    background: var(--ground);
    border: 1px solid var(--ground-line);
    border-radius: 4px;
  }
  .iso-tile.plot {
    background: var(--plot-top);
    border: 1px solid var(--plot);
    border-radius: 4px;
    transform: translateZ(22px);
    box-shadow: 0 -22px 0 0 var(--plot);
  }
</style>
</head>
<body>
  <h1>Склад</h1>
  <div class="iso-stage">
    <div class="iso-grid" id="isoGrid"></div>
  </div>

  <script>
    (function () {
      var raw = localStorage.getItem("user");
      var user = null;
      try { user = raw ? JSON.parse(raw) : null; } catch (e) { user = null; }
      if (!user) {
        window.location.href = "login.html";
        return;
      }

      var GRID_SIZE = 5;
      var GRID_TILES = [];
      for (var row = 0; row < GRID_SIZE; row++) {
        for (var col = 0; col < GRID_SIZE; col++) {
          GRID_TILES.push({
            row: row,
            col: col,
            type: (row === 2 && col === 2) ? "plot" : "ground",
          });
        }
      }

      function renderGrid(tiles) {
        var container = document.getElementById("isoGrid");
        tiles.forEach(function (tile) {
          var el = document.createElement("div");
          el.className = "iso-tile" + (tile.type === "plot" ? " plot" : "");
          el.style.gridRow = String(tile.row + 1);
          el.style.gridColumn = String(tile.col + 1);
          container.appendChild(el);
        });
      }

      renderGrid(GRID_TILES);
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the inline script has no syntax errors**

The `<script>` block can't be checked in place by `node --check` (it only accepts `.js` files), so extract it to a throwaway file and check that instead:

```bash
cd /Users/WBwork/Downloads/WMSplus-main
python3 -c "
import re
html = open('warehouse.html').read()
m = re.search(r'<script>(.*?)</script>', html, re.S)
open('/tmp/warehouse_script_check.js', 'w').write(m.group(1))
"
node --check /tmp/warehouse_script_check.js
rm /tmp/warehouse_script_check.js
```

Expected: no output from `node --check` (silence means valid syntax).

- [ ] **Step 3: Manual browser verification — grid renders correctly**

Start a fresh local server (kill any stale one on the same port first, use a fresh port to dodge HTTP caching of anything edited later):

```bash
cd /Users/WBwork/Downloads/WMSplus-main
python3 -m http.server 9101 >/tmp/warehouse_http.log 2>&1 &
sleep 1
```

Using the Browser tool: open a new tab, set a fake logged-in user, then navigate to the page:
1. `tabs_create` a new tab.
2. `navigate` to `http://localhost:9101/warehouse.html` once, so `localStorage` is scoped to that origin.
3. Run via the JS execution tool: `localStorage.setItem('user', JSON.stringify({id:'qa-fake', name:'QA', accesses:[]}));`
4. `navigate` again to `http://localhost:9101/warehouse.html`.
5. Take a screenshot. Confirm: page title "Склад", an isometric diamond-shaped grid is visible, and the center tile is visually raised/distinct (darker, offset upward) from the other 24 flat tiles.
6. Read console messages with `onlyErrors: true`. Confirm no errors.
7. Run in the JS execution tool: `document.querySelectorAll('.iso-tile').length` — confirm it returns `25`. Run: `document.querySelectorAll('.iso-tile.plot').length` — confirm it returns `1`.

- [ ] **Step 4: Manual browser verification — mobile viewport + login redirect**

Still in the same tab:
1. Resize the viewport to `375x812` (mobile preset).
2. Reload the page, take a screenshot. Confirm the grid is fully visible with no horizontal scrollbar (check `document.documentElement.scrollWidth <= document.documentElement.clientWidth` via the JS execution tool — expect `true`).
3. Run in the JS execution tool: `localStorage.removeItem('user');`
4. `navigate` to `http://localhost:9101/warehouse.html` again.
5. Confirm the tab's resulting URL ends in `login.html` (the redirect fired).

Clean up: close the QA tab, then stop the local server:

```bash
pkill -f "http.server 9101"
```

- [ ] **Step 5: Commit**

```bash
cd /Users/WBwork/Downloads/WMSplus-main
git add warehouse.html
git commit -m "$(cat <<'EOF'
Добавить скелет игры "Склад" — изометрическая сетка 5x5

Первая итерация мобильной изометрической игры-симулятора склада:
отдельная страница warehouse.html, не привязанная к навигации,
открывается только по прямому адресу. Пока только визуал — сетка
5x5 CSS-тайлов с одним выделенным стартовым участком в центре,
без валюты и игровой логики (это следующие итерации).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```
