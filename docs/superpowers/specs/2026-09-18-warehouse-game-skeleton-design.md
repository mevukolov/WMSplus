# Warehouse Game — Skeleton Design

## Overview

A new, standalone page — an isometric warehouse-building simulator, mobile-oriented, accessed only by direct URL (no link from navigation or `index.html`). Long-term vision: the player starts with one warehouse plot and expands it over time, spending an in-game currency ("пики") earned by completing разборы/задачи on the main site. This spec covers **only the first increment**: a static visual skeleton with no game logic, no currency, no persistence beyond what's needed to keep the file self-contained. Future increments (currency display, buying tiles, Supabase-backed progress) get their own specs.

## Goals (this increment)

- A new page, `warehouse.html`, renders a 5×5 isometric grid.
- One tile in the grid center is visually distinct — the player's starting "участок" (a simple built structure). The other 24 tiles are empty ground.
- Mobile-first layout (portrait-oriented viewport), but no device/user-agent gating — any viewport can load it.
- Reuses the existing login gate pattern (`localStorage.user`), consistent with every other page in this repo.

## Non-goals (this increment)

- No currency ("пики") balance, display, or accrual logic.
- No buildable/purchasable actions, no game state beyond the hardcoded starting tile.
- No Supabase schema changes, no new tables, no writes.
- No hook into task/review completion in `tasks.js`.

These are explicitly deferred to later specs, once the skeleton's visual/structural approach is validated.

## Architecture

### File

- New file: `warehouse.html`, at repo root, alongside `tasks.html`/`index.html`.
- Self-contained: markup, `<style>`, and `<script>` all live in this one file — matching the pattern used by most single-purpose pages in this repo (e.g. `profile.html`, `shk_info.html`), not the split `tasks.html`/`tasks.js` pattern (that split exists because `tasks.js` is 16k+ lines; this page starts at a few hundred).
- No new dependencies. No bundler, no npm packages, no CDN libraries beyond what's already used repo-wide (the Supabase JS UMD bundle, included for the login-gate check only — no queries are made in this increment).

### Routing / access

- Not linked from `index.html`, `tasks.html`, or any menu. Reachable only by navigating directly to `/warehouse.html`.
- On load, checks `localStorage.getItem('user')` the same way other pages do. If absent or unparsable, redirect to `login.html` (same redirect target and pattern as the rest of the site). If present, render the page — no additional access-string check (no new `accesses` entry required), since this is a skeleton with no data access yet.

### Visual / geometry

- A single isometric grid, 5×5 tiles, rendered as CSS-transformed `<div>` elements (2D isometric projection via `transform: rotateX() rotateZ()` on a grid container, or an equivalent 2D matrix skew — implementer's choice, no canvas/WebGL/SVG).
- Grid data comes from a small JS array/constant (e.g. `const GRID = [{x:2, y:2, type:'plot'}]`, all other cells implicitly empty ground) — chosen specifically so a future increment can grow this into real state without restructuring the render function.
- The center tile (`x:2,y:2` in a 0-indexed 5×5 grid) renders as the starting "участок" (visually distinct — a raised platform/simple structure), all other 24 tiles render as flat empty ground tiles.
- Page has a minimal header/title only ("Склад" or similar) — no HUD, no currency counter, no buttons. Purely the isometric scene.
- Viewport meta tag set for mobile (`width=device-width, initial-scale=1`), layout sized to read well in a narrow portrait viewport, but not blocked from rendering on desktop.

## Testing / verification

No automated test framework exists in this repo (consistent with `tasks.js`). Verification is manual:
- `node --check warehouse.html`'s inline `<script>` is not directly checkable via `node --check` on an `.html` file — verification instead extracts/checks the script logic runs without console errors when loaded.
- Manual browser check via the repo's established QA pattern: temporary `python3 -m http.server`, fake `localStorage.user`, load `/warehouse.html` directly, confirm: (a) the grid renders with 25 tiles, (b) the center tile is visually distinct, (c) no console errors, (d) removing `localStorage.user` and reloading redirects to `login.html`.
- Resize to a mobile viewport (375×812) and confirm the grid stays legible/doesn't overflow horizontally.
