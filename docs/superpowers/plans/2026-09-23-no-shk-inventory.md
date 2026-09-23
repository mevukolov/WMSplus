# «Инвентаризация «Без ШК»» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A link-only, login-gated mobile app where a worker walks the "Без ШК" racks scanning shelves/boxes, paired live with the existing kiosk `display.html`, which shows step instructions, a green/red rack progress map, and a completion animation.

**Architecture:** New pages in WMSplus-main (`mobile-login.html/js`, `mobile-inventory.html/js`) alongside the existing `display.html/js`. Both sides read/write one shared `wms_no_shk_inventory_sessions` row (plus two supporting tables) through Supabase Realtime `postgres_changes` + a periodic poll — the same pattern `display.js`/`print-bridge` already use, not a one-shot broadcast, because this flow must survive a page reload on either device.

**Tech Stack:** Plain HTML/JS/Supabase, no build step (matches every other page in this repo). `qrcodejs` (CDN, already used by `display.html`) to render QR codes. `jsQR` (CDN, already used by `wmsplus-intake-form/intake.js`) to scan them, newly added here.

**Spec:** `docs/superpowers/specs/2026-09-23-no-shk-inventory-design.md`

## Global Constraints

- No build step, no framework — plain script tags, matching every existing page in this repo.
- Anon Supabase role only (no service key) for both new pages — same as `display.html`/`no_shk_zone.js`/`intake.js`. RLS/grants on the new tables must allow anon `select`/`insert`/`update` (no `delete` needed by the app; the plan below never deletes rows except the explicit "reopen a shelf" case, which does need anon `delete` on `wms_no_shk_inventory_box_results`).
- Shelf QR format: `WMSP.PLCE.WSHK.{rack_number}.{shelf_number}` (2-digit zero-padded), already printed on physical labels — do not invent a new format.
- Box QR format: `WMSP.BOX.{box_number, 5-digit zero-padded}` — already printed on physical labels.
- New session-pairing QR format: `WMSP.INV.{session_id}`.
- `shelf.capacity` (not a hardcoded 4) drives the "Короб без наклейки" button threshold.
- Every step-advancing write bumps `wms_no_shk_inventory_sessions.last_activity_at`.
- `node --check` on every `.js` file touched (matches this repo's established practice); live browser verification via a static preview server for anything UI-facing.

---

### Task 1: Migration — inventory tables

**Files:**
- Create: `supabase/migrations/202609230001_no_shk_inventory.sql`

**Interfaces:**
- Produces: tables `wms_no_shk_inventory_sessions`, `wms_no_shk_inventory_shelf_audits`, `wms_no_shk_inventory_box_results` with the exact columns below — every later task's Supabase queries use these names verbatim.

- [ ] **Step 1: Write the migration**

```sql
-- 202609230001_no_shk_inventory.sql
-- "Инвентаризация «Без ШК»" (docs/superpowers/specs/2026-09-23-no-shk-inventory-design.md):
-- a worker walks the racks scanning shelves/boxes with the mobile app,
-- paired live with display.html. These three tables ARE the sync
-- channel between the two devices (not a one-shot broadcast) plus the
-- discrepancy history the spec asks for.

create table public.wms_no_shk_inventory_sessions (
    id uuid primary key default gen_random_uuid(),
    status text not null default 'waiting_for_phone'
        check (status in ('waiting_for_phone', 'in_progress', 'completed', 'abandoned')),
    started_by_id text,
    started_by_name text,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    last_activity_at timestamptz not null default now(),
    step text not null default 'pairing'
        check (step in ('pairing', 'scan_shelf', 'scan_boxes', 'completed')),
    current_shelf_id uuid references public.wms_no_shk_shelves(id)
);

-- At most one session may be actively waiting/running at a time --
-- mobile-inventory.js checks for an existing row before inserting, but
-- a partial unique index makes it actually enforced, not just an
-- app-level convention a race could slip past.
create unique index wms_no_shk_inventory_sessions_active_idx
    on public.wms_no_shk_inventory_sessions ((true))
    where status in ('waiting_for_phone', 'in_progress');

create table public.wms_no_shk_inventory_shelf_audits (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.wms_no_shk_inventory_sessions(id),
    shelf_id uuid not null references public.wms_no_shk_shelves(id),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    boxes_found_count integer not null default 0,
    boxes_missing_sticker_count integer not null default 0,
    boxes_not_found_count integer not null default 0,
    unique (session_id, shelf_id)
);

create table public.wms_no_shk_inventory_box_results (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.wms_no_shk_inventory_sessions(id),
    shelf_id uuid not null references public.wms_no_shk_shelves(id),
    box_id uuid not null references public.wms_no_shk_boxes(id),
    result text not null check (result in ('found', 'missing_sticker', 'not_found')),
    recorded_at timestamptz not null default now()
);

alter table public.wms_no_shk_inventory_sessions enable row level security;
alter table public.wms_no_shk_inventory_shelf_audits enable row level security;
alter table public.wms_no_shk_inventory_box_results enable row level security;

-- Same "anon full access" shape as wms_no_shk_boxes/racks/shelves already use.
create policy wms_no_shk_inventory_sessions_all on public.wms_no_shk_inventory_sessions
    for all using (true) with check (true);
create policy wms_no_shk_inventory_shelf_audits_all on public.wms_no_shk_inventory_shelf_audits
    for all using (true) with check (true);
create policy wms_no_shk_inventory_box_results_all on public.wms_no_shk_inventory_box_results
    for all using (true) with check (true);

grant select, insert, update, delete on public.wms_no_shk_inventory_sessions to anon;
grant select, insert, update, delete on public.wms_no_shk_inventory_shelf_audits to anon;
grant select, insert, update, delete on public.wms_no_shk_inventory_box_results to anon;
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db push --linked` (or the project's established migration-apply command — check `supabase/migrations/` for the most recent applied migration's own commit to confirm the command this repo actually uses).

Verify with a throwaway insert/select through the anon key (mirror how earlier work in this session verified `wms_no_shk_boxes` writes) — confirm:
- Inserting a `wms_no_shk_inventory_sessions` row with `status: 'waiting_for_phone'` succeeds.
- A second insert with the same status while the first still exists fails (unique index working).
- Updating the first row's `status` to `'completed'`, then inserting a new `'waiting_for_phone'` row succeeds (index only blocks concurrent actives).
- Delete all test rows afterward — leave no test data behind.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202609230001_no_shk_inventory.sql
git commit -m "feat: add inventory session/shelf-audit/box-result tables"
```

---

### Task 2: `mobile-login.html` / `mobile-login.js`

**Files:**
- Create: `mobile-login.html`
- Create: `mobile-login.js`

**Interfaces:**
- Consumes: RPC `login_user(p_id, p_pass)` (existing, returns a jsonb user record or null — see `auth.js:33` in this repo for the exact call shape to copy), Supabase anon client (`SUPABASE_URL`/`SUPABASE_ANON_KEY` constants — copy the exact values from `display.js`).
- Produces: `localStorage['wmsplus_mobile_user']` = `JSON.stringify({id, name})` on success. Later tasks (`mobile-inventory.js`) read this key to get the logged-in worker's identity and to gate access (redirect to `mobile-login.html` if absent).

- [ ] **Step 1: Build the page**

`mobile-login.html` — phone-sized single card, ID + password fields, matching this repo's existing visual language (reuse `styles.css`, same as `display.html`/`tasks.html` do — `<link rel="stylesheet" href="styles.css">`). Do NOT include `ui.js` (it can redirect to `login.html` on missing desktop access — wrong login page for this app; same reasoning `display.js` already documents for why it skips `ui.js`).

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>WMS+ mobile — Вход</title>
<link rel="stylesheet" href="styles.css">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body style="display:flex;align-items:center;justify-content:center;min-height:100dvh;margin:0;">
<div class="card" style="padding:28px;width:100%;max-width:360px;">
    <h1>WMS+ mobile</h1>
    <label style="display:block;font-size:13px;font-weight:600;margin:0 0 6px;">Табельный номер</label>
    <input id="idInput" class="field" type="number" inputmode="numeric" placeholder="ID" style="width:100%;margin-bottom:12px;">
    <label style="display:block;font-size:13px;font-weight:600;margin:0 0 6px;">Пароль</label>
    <input id="passInput" class="field" type="password" placeholder="Пароль" style="width:100%;margin-bottom:16px;">
    <button id="loginBtn" class="btn" type="button" style="width:100%;">Войти</button>
    <div id="loginMsg" style="margin-top:12px;font-size:13px;font-weight:600;text-align:center;min-height:18px;"></div>
</div>
<script src="mobile-login.js"></script>
</body>
</html>
```

`mobile-login.js`:

```js
// mobile-login.js — login for the WMS+ mobile app (link-only, no nav
// entry). Reuses the same login_user RPC / users table the desktop
// login.html/auth.js already uses -- no new auth backend. Stores its
// own session under a distinct localStorage key so it never collides
// with the desktop's own 'user' key/cache assumptions.
(function () {
    "use strict";
    const SUPABASE_URL = "https://bgphllmzmlwurfnbagho.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q";
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const LS_KEY = "wmsplus_mobile_user";

    if (localStorage.getItem(LS_KEY)) {
        window.location.href = "mobile-inventory.html";
        return;
    }

    const idInput = document.getElementById("idInput");
    const passInput = document.getElementById("passInput");
    const btn = document.getElementById("loginBtn");
    const msg = document.getElementById("loginMsg");

    async function doLogin() {
        const id = idInput.value.trim();
        const pass = passInput.value;
        if (!id || !pass) {
            msg.textContent = "Введите ID и пароль";
            return;
        }
        btn.disabled = true;
        msg.textContent = "Вхожу...";
        const { data, error } = await supabaseClient.rpc("login_user", { p_id: id, p_pass: pass });
        btn.disabled = false;
        if (error || !data) {
            msg.textContent = "Неверный ID или пароль";
            return;
        }
        localStorage.setItem(LS_KEY, JSON.stringify({ id: data.id, name: data.fio || data.name || "" }));
        window.location.href = "mobile-inventory.html";
    }

    btn.addEventListener("click", doLogin);
    passInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check mobile-login.js`
Expected: no output (pass).

- [ ] **Step 3: Live verify**

Start this repo's static preview server, open `mobile-login.html`, log in with a real (or test) employee ID/password, confirm redirect to `mobile-inventory.html` (a 404 at this step is expected/fine — that page doesn't exist until Task 4) and that `localStorage.wmsplus_mobile_user` is set correctly. Confirm a wrong password shows the error message and does not redirect.

- [ ] **Step 4: Commit**

```bash
git add mobile-login.html mobile-login.js
git commit -m "feat: add WMS+ mobile login page"
```

---

### Task 3: `display.js`/`display.html` — inventory-mode shell

**Files:**
- Modify: `display.html`
- Modify: `display.js`

**Interfaces:**
- Consumes: `wms_no_shk_inventory_sessions` (all columns, Task 1), `wms_no_shk_inventory_shelf_audits` (all columns, Task 1), `wms_no_shk_shelves`/`wms_no_shk_racks` (existing).
- Produces: nothing later tasks call directly — this is the display-side rendering that reacts to state later tasks (4-7) write. Documents the exact CSS/DOM hooks task 8 (completion animation) will extend: element ids `inventoryOverlay`, `inventoryStepText`, `inventoryQrBox`.

- [ ] **Step 1: Add the inventory overlay markup to `display.html`**

Insert right after the existing `#qrOverlay` block (reuse the same full-screen overlay pattern, own id):

```html
<div id="inventoryOverlay" class="qr-overlay" aria-hidden="true">
    <div class="qr-card" id="inventoryCard">
        <p class="qr-card-title" id="inventoryStepText">Инвентаризация «Без ШК»</p>
        <div id="inventoryQrBox" class="qr-code-box"></div>
        <div id="inventoryArrow" style="display:none;font-size:64px;color:var(--accent);margin:8px 0;">→</div>
    </div>
</div>
```

Add CSS (append near the existing `.qr-*` rules): a rack-coloring class pair --

```css
.no-shk-rack.is-audited .no-shk-rack-title { color: #15803d; }
.no-shk-rack.is-audited .no-shk-rack-frame { border-color: #22c55e; }
.no-shk-rack.is-pending .no-shk-rack-title { color: #b91c1c; }
.no-shk-rack.is-pending .no-shk-rack-frame { border-color: #ef4444; }
```

- [ ] **Step 2: Add inventory-mode state and rendering to `display.js`**

```js
// ---------- Inventory mode: driven entirely by wms_no_shk_inventory_sessions.
// Reuses the existing racks-row rendering (renderZoneView already
// builds it every loadZone() cycle) -- inventory mode only overlays
// step instructions/QR on top and adds is-audited/is-pending classes
// to the already-rendered .no-shk-rack elements, it never replaces the
// racks markup itself. ----------
let activeSession = null;
let auditedShelfIdsThisSession = new Set();

async function loadActiveInventorySession() {
    const { data } = await supabaseClient
        .from("wms_no_shk_inventory_sessions")
        .select("id,status,step,current_shelf_id,started_at,finished_at,last_activity_at")
        .in("status", ["waiting_for_phone", "in_progress"])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    activeSession = data || null;
    if (activeSession) {
        const { data: auditRows } = await supabaseClient
            .from("wms_no_shk_inventory_shelf_audits")
            .select("shelf_id,finished_at")
            .eq("session_id", activeSession.id)
            .not("finished_at", "is", null);
        auditedShelfIdsThisSession = new Set((auditRows || []).map((r) => r.shelf_id));
    } else {
        auditedShelfIdsThisSession = new Set();
    }
    renderInventoryOverlay();
    applyRackAuditColors();
}

function renderInventoryOverlay() {
    const overlay = document.getElementById("inventoryOverlay");
    const stepText = document.getElementById("inventoryStepText");
    const qrBox = document.getElementById("inventoryQrBox");
    const arrow = document.getElementById("inventoryArrow");
    if (!overlay) return;

    // Note: "completed" is deliberately NOT included in this early exit --
    // Task 8 adds a step==="completed" branch below that needs the
    // overlay to stay visible for the confetti/checkmark, then hides it
    // itself on a timeout. Only "no session" and "abandoned" close
    // immediately here.
    if (!activeSession || activeSession.status === "abandoned") {
        overlay.classList.remove("is-visible");
        overlay.setAttribute("aria-hidden", "true");
        return;
    }

    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
    arrow.style.display = "none";
    qrBox.innerHTML = "";

    if (activeSession.step === "pairing") {
        stepText.textContent = "Отсканируйте QR телефоном";
        new QRCode(qrBox, { text: "WMSP.INV." + activeSession.id, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    } else if (activeSession.step === "scan_shelf") {
        stepText.textContent = auditedShelfIdsThisSession.size > 0 ? "Отсканируйте следующую полку" : "Отсканируйте полку";
    } else if (activeSession.step === "scan_boxes") {
        stepText.textContent = "Отсканируйте все короба на полке слева направо";
        arrow.style.display = "";
    }
    // Task 8 inserts a step==="completed" branch here (before the
    // function's closing brace), handling the confetti/checkmark/elapsed
    // time and hiding the overlay itself after a pause.
}

// Adds is-audited (green) to every .no-shk-rack whose shelves are ALL
// in auditedShelfIdsThisSession, is-pending (red) otherwise. Runs after
// every zone re-render (loadZone -> renderZoneView already calls this
// at the end, same place checkQrOverlayShouldHide() is called) so rack
// coloring never lags behind a fresh renderZoneView() innerHTML swap.
function applyRackAuditColors() {
    if (!activeSession) {
        document.querySelectorAll(".no-shk-rack").forEach((el) => el.classList.remove("is-audited", "is-pending"));
        return;
    }
    document.querySelectorAll(".no-shk-rack").forEach((rackEl, i) => {
        const rack = racks[i];
        if (!rack) return;
        const shelves = rack.wms_no_shk_shelves || [];
        const allDone = shelves.length > 0 && shelves.every((s) => auditedShelfIdsThisSession.has(s.id));
        rackEl.classList.toggle("is-audited", allDone);
        rackEl.classList.toggle("is-pending", !allDone);
    });
}
```

Wire it in: call `void loadActiveInventorySession();` inside `checkQrOverlayShouldHide()`'s call site in `renderZoneView()` (i.e. add the call right next to it, both run at the end of every render), add a subscription and the abandon-timeout check next to the existing two channel subscriptions near the bottom of the file:

```js
supabaseClient
    .channel("inventory_session_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "wms_no_shk_inventory_sessions" }, () => { void loadActiveInventorySession(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "wms_no_shk_inventory_shelf_audits" }, () => { void loadActiveInventorySession(); })
    .subscribe();

void loadActiveInventorySession();

const INVENTORY_ABANDON_MS = 30 * 60 * 1000;
setInterval(async () => {
    if (!activeSession) return;
    const staleMs = Date.now() - new Date(activeSession.last_activity_at).getTime();
    if (staleMs > INVENTORY_ABANDON_MS) {
        await supabaseClient.from("wms_no_shk_inventory_sessions").update({ status: "abandoned" }).eq("id", activeSession.id);
    }
}, 20000);
```

- [ ] **Step 3: Syntax check**

Run: `node --check display.js`

- [ ] **Step 4: Live verify**

Insert a test `wms_no_shk_inventory_sessions` row directly via SQL (`status: 'waiting_for_phone', step: 'pairing'`), reload `display.html`, confirm the QR overlay appears showing "Отсканируйте QR телефоном" with a scannable QR. Update the row's `step` to `'scan_shelf'` then `'scan_boxes'` via SQL, confirm the display updates live (Realtime) without a manual reload, and the arrow appears for `scan_boxes`. Insert a `wms_no_shk_inventory_shelf_audits` row with `finished_at` set for one real shelf's `shelf_id`, confirm that shelf's rack turns green while others stay red. Set the session `status` to `'completed'`, confirm the overlay disappears. Delete all test rows afterward.

- [ ] **Step 5: Commit**

```bash
git add display.html display.js
git commit -m "feat: inventory-mode overlay and rack coloring on display"
```

---

### Task 4: `mobile-inventory.js` — pairing

**Files:**
- Create: `mobile-inventory.html`
- Create: `mobile-inventory.js`

**Interfaces:**
- Consumes: `localStorage['wmsplus_mobile_user']` (Task 2), `wms_no_shk_inventory_sessions` (Task 1), `jsQR` (CDN, `https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js` — same version `wmsplus-intake-form/intake.js` already uses).
- Produces: module-level `let activeSession` (the phone's own view of the session row) and `function startScanner(onMatch)` / `function stopScanner()` — a reusable camera-scan pair later tasks (5-7) call again for shelf codes and box codes. `onMatch(decodedText)` is called once per successful jsQR decode; the caller is responsible for validating the text and calling `stopScanner()` when done with that particular scan step.

- [ ] **Step 1: Build the page shell**

`mobile-inventory.html` — one screen with a status/instruction area, a `<video>`/`<canvas>` pair for the camera (copy the exact markup shape `wmsplus-intake-form/index.html` uses for `#closeQrVideo`/`#closeQrCanvas`), and a button area for the step-specific buttons Task 6/7 will populate.

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>WMS+ mobile — Инвентаризация</title>
<link rel="stylesheet" href="styles.css">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"></script>
</head>
<body style="display:flex;flex-direction:column;align-items:center;min-height:100dvh;margin:0;padding:20px;box-sizing:border-box;">
<div class="card" style="padding:24px;width:100%;max-width:420px;text-align:center;">
    <h1 id="stepTitle">Инвентаризация «Без ШК»</h1>
    <p id="stepMsg" style="margin:0 0 16px;font-size:14px;color:#64748b;"></p>
    <video id="invVideo" playsinline muted style="width:100%;max-width:320px;border-radius:var(--radius-md);background:#000;display:none;"></video>
    <canvas id="invCanvas" style="display:none;"></canvas>
    <div id="stepButtons" style="display:flex;flex-direction:column;gap:10px;margin-top:16px;"></div>
</div>
<script src="mobile-inventory.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `mobile-inventory.js` pairing logic**

```js
// mobile-inventory.js — "Инвентаризация «Без ШК»", the mobile side.
// Paired live with display.js through wms_no_shk_inventory_sessions --
// see docs/superpowers/specs/2026-09-23-no-shk-inventory-design.md.
(function () {
    "use strict";
    const SUPABASE_URL = "https://bgphllmzmlwurfnbagho.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncGhsbG16bWx3dXJmbmJhZ2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NTQwNzIsImV4cCI6MjA3ODUzMDA3Mn0.a1_Wbtpbs9P-_UDqwjGqAIjvwK5WbT_M3B7g5BHtR2Q";
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const LS_KEY = "wmsplus_mobile_user";

    const userRaw = localStorage.getItem(LS_KEY);
    if (!userRaw) {
        window.location.href = "mobile-login.html";
        return;
    }
    const user = JSON.parse(userRaw);

    const stepTitle = document.getElementById("stepTitle");
    const stepMsg = document.getElementById("stepMsg");
    const video = document.getElementById("invVideo");
    const canvas = document.getElementById("invCanvas");
    const stepButtons = document.getElementById("stepButtons");

    let activeSession = null;
    let scanStream = null;
    let scanRafId = null;

    // ---------- Reusable camera scanner (shelf codes here, box codes in
    // Task 6, pairing code below) -- mirrors intake.js's
    // startCloseQrScan/scanCloseQrFrame pattern (wmsplus-intake-form repo).
    async function startScanner(onMatch) {
        stopScanner();
        video.style.display = "";
        try {
            scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        } catch (error) {
            stepMsg.textContent = "Не удалось открыть камеру: " + error.message;
            return;
        }
        video.srcObject = scanStream;
        await video.play();
        const ctx = canvas.getContext("2d");
        function tick() {
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                if (code && code.data) {
                    onMatch(code.data);
                    return; // caller decides whether to restart via stopScanner()+startScanner() again
                }
            }
            scanRafId = requestAnimationFrame(tick);
        }
        scanRafId = requestAnimationFrame(tick);
    }

    function stopScanner() {
        if (scanRafId) { cancelAnimationFrame(scanRafId); scanRafId = null; }
        if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
        video.style.display = "none";
    }

    // ---------- Pairing ----------
    async function findActiveSession() {
        const { data } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .select("id,status,step,started_by_name,started_at")
            .in("status", ["waiting_for_phone", "in_progress"])
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        return data || null;
    }

    async function startPairing() {
        const existing = await findActiveSession();
        if (existing) {
            stepTitle.textContent = "Инвентаризация уже идёт";
            stepMsg.textContent = "Начал(а): " + (existing.started_by_name || "неизвестно") + " в " + new Date(existing.started_at).toLocaleTimeString("ru-RU");
            return;
        }

        const { data, error } = await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .insert({ status: "waiting_for_phone", step: "pairing", started_by_id: String(user.id), started_by_name: user.name })
            .select("id")
            .single();
        if (error || !data) {
            stepMsg.textContent = "Не удалось начать инвентаризацию: " + (error ? error.message : "");
            return;
        }
        activeSession = { id: data.id };

        stepTitle.textContent = "Отсканируйте QR на экране";
        stepMsg.textContent = "Экран, на который выводится инвентаризация";
        void startScanner(async (text) => {
            if (text !== "WMSP.INV." + activeSession.id) return; // not our pairing code, keep scanning
            stopScanner();
            const { error: updateError } = await supabaseClient
                .from("wms_no_shk_inventory_sessions")
                .update({ status: "in_progress", step: "scan_shelf", last_activity_at: new Date().toISOString() })
                .eq("id", activeSession.id);
            if (updateError) {
                stepMsg.textContent = "Ошибка: " + updateError.message;
                return;
            }
            stepTitle.textContent = "Отсканируйте полку";
            stepMsg.textContent = "";
            // Task 5 implements the shelf-scan step from here.
        });
    }

    // Recovers a phone left open on a session that got marked abandoned
    // (by display.js's own 30-minute staleness check, or by this same
    // check running on ANOTHER idle phone) -- whichever side notices
    // first wins, both react the same way: reload back to the start
    // screen instead of sitting stuck on a dead scan prompt.
    supabaseClient
        .channel("mobile_inventory_session_watch")
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wms_no_shk_inventory_sessions" }, (payload) => {
            if (activeSession && payload.new.id === activeSession.id && payload.new.status === "abandoned") {
                window.location.reload();
            }
        })
        .subscribe();

    void startPairing();
})();
```

- [ ] **Step 3: Syntax check**

Run: `node --check mobile-inventory.js`

- [ ] **Step 4: Live verify**

With Task 3's display already showing the pairing QR (start one via SQL insert like Task 3's own verification, OR let this task's own insert create it), open `mobile-inventory.html` on a phone (or this environment's camera-capable test path), confirm it inserts a session row, the display picks it up and shows the QR, scanning that QR from the phone flips the session to `in_progress`/`scan_shelf` and both screens show "Отсканируйте полку". Confirm opening `mobile-inventory.html` a second time (second phone/tab) while the first session is still active shows "Инвентаризация уже идёт" instead of creating a second row.

- [ ] **Step 5: Commit**

```bash
git add mobile-inventory.html mobile-inventory.js
git commit -m "feat: mobile inventory pairing flow"
```

---

### Task 5: `mobile-inventory.js` — shelf scan + box scan + buttons

**Files:**
- Modify: `mobile-inventory.js`

**Interfaces:**
- Consumes: `startScanner`/`stopScanner` (Task 4), `activeSession` (Task 4, extended here with `shelfId`/`shelf` fields), `wms_no_shk_shelves`/`wms_no_shk_boxes`/`wms_no_shk_inventory_shelf_audits`/`wms_no_shk_inventory_box_results` (Task 1).
- Produces: `function startShelfScan()` and `function startBoxScan(shelf)` — Task 7 ("Короб без наклейки") and Task 8 (shelf-finish/completion) call `startShelfScan()` again to loop back to the next shelf.

- [ ] **Step 1: Replace the Task 4 placeholder comment with the shelf-scan step**

```js
    // ---------- Per-shelf loop ----------
    async function startShelfScan() {
        stepTitle.textContent = "Отсканируйте полку";
        stepMsg.textContent = "";
        stepButtons.innerHTML = "";
        await supabaseClient
            .from("wms_no_shk_inventory_sessions")
            .update({ step: "scan_shelf", current_shelf_id: null, last_activity_at: new Date().toISOString() })
            .eq("id", activeSession.id);

        void startScanner(async (text) => {
            // WMSP.PLCE.WSHK.{rack_number}.{shelf_number}
            const match = /^WMSP\.PLCE\.WSHK\.(\d+)\.(\d+)$/.exec(text);
            if (!match) return; // not a shelf code, keep scanning
            const rackNumber = Number(match[1]);
            const shelfNumber = Number(match[2]);
            const { data: shelfRows } = await supabaseClient
                .from("wms_no_shk_shelves")
                .select("id,name,capacity,rack_id,wms_no_shk_racks!inner(rack_number)")
                .eq("shelf_number", shelfNumber)
                .eq("wms_no_shk_racks.rack_number", rackNumber)
                .limit(1);
            const shelf = shelfRows && shelfRows[0];
            if (!shelf) {
                stepMsg.textContent = "Полка не найдена в системе";
                return;
            }
            stopScanner();

            // Reopen (or create) this session's audit row for the shelf --
            // re-scanning an already-audited shelf this session should
            // redo it cleanly, not create a duplicate/conflicting record.
            await supabaseClient.from("wms_no_shk_inventory_box_results").delete().eq("session_id", activeSession.id).eq("shelf_id", shelf.id);
            const { data: existingAudit } = await supabaseClient
                .from("wms_no_shk_inventory_shelf_audits")
                .select("id")
                .eq("session_id", activeSession.id)
                .eq("shelf_id", shelf.id)
                .maybeSingle();
            if (existingAudit) {
                await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
                    .update({ started_at: new Date().toISOString(), finished_at: null, boxes_found_count: 0, boxes_missing_sticker_count: 0, boxes_not_found_count: 0 })
                    .eq("id", existingAudit.id);
            } else {
                await supabaseClient.from("wms_no_shk_inventory_shelf_audits").insert({ session_id: activeSession.id, shelf_id: shelf.id });
            }

            activeSession.shelfId = shelf.id;
            activeSession.shelf = shelf;
            await supabaseClient
                .from("wms_no_shk_inventory_sessions")
                .update({ step: "scan_boxes", current_shelf_id: shelf.id, last_activity_at: new Date().toISOString() })
                .eq("id", activeSession.id);
            void startBoxScan(shelf);
        });
    }

    async function scannedCountForCurrentShelf() {
        const { count } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("id", { count: "exact", head: true })
            .eq("session_id", activeSession.id)
            .eq("shelf_id", activeSession.shelfId);
        return count || 0;
    }

    function renderShelfButtons(scannedCount, shelf) {
        stepButtons.innerHTML = "";
        const finishLabel = scannedCount === 0 ? "На полке нет коробов" : "На полке больше нет коробов";
        const finishBtn = document.createElement("button");
        finishBtn.className = "btn";
        finishBtn.textContent = finishLabel;
        finishBtn.addEventListener("click", () => void finishShelf());
        stepButtons.appendChild(finishBtn);

        if (scannedCount < shelf.capacity) {
            const missingBtn = document.createElement("button");
            missingBtn.className = "btn btn-outline";
            missingBtn.textContent = "Короб без наклейки";
            missingBtn.addEventListener("click", () => void openMissingStickerList());
            stepButtons.appendChild(missingBtn);
        }
    }

    async function startBoxScan(shelf) {
        stepTitle.textContent = "Отсканируйте все короба на полке слева направо";
        stepMsg.textContent = shelf.name;
        const count = await scannedCountForCurrentShelf();
        renderShelfButtons(count, shelf);

        void startScanner(async (text) => {
            const match = /^WMSP\.BOX\.(\d+)$/.exec(text);
            if (!match) return;
            const boxNumber = Number(match[1]);
            const { data: boxRows } = await supabaseClient.from("wms_no_shk_boxes").select("id").eq("box_number", boxNumber).limit(1);
            const box = boxRows && boxRows[0];
            if (!box) { stepMsg.textContent = "Короб №" + boxNumber + " не найден"; return; }

            const { data: dup } = await supabaseClient
                .from("wms_no_shk_inventory_box_results")
                .select("id")
                .eq("session_id", activeSession.id)
                .eq("shelf_id", shelf.id)
                .eq("box_id", box.id)
                .maybeSingle();
            if (dup) { stepMsg.textContent = "Короб №" + boxNumber + " уже отсканирован"; return; }

            await supabaseClient.from("wms_no_shk_inventory_box_results").insert({ session_id: activeSession.id, shelf_id: shelf.id, box_id: box.id, result: "found" });
            await supabaseClient.from("wms_no_shk_boxes").update({ shelf_id: shelf.id }).eq("id", box.id);
            const newCount = await scannedCountForCurrentShelf();
            await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
                .update({ boxes_found_count: newCount })
                .eq("session_id", activeSession.id).eq("shelf_id", shelf.id);
            await supabaseClient.from("wms_no_shk_inventory_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", activeSession.id);

            stepMsg.textContent = "Короб №" + boxNumber + " добавлен (" + shelf.name + ")";
            renderShelfButtons(newCount, shelf);
            // keep scanning -- do NOT stop the scanner here, the loop in
            // startScanner already re-arms via requestAnimationFrame for
            // every call that doesn't return early
        });
    }
```

`finishShelf()` and `openMissingStickerList()` are implemented in Tasks 8 and 6 respectively — declare them as empty stubs for this task only if `node --check` requires it to not throw at call time (it doesn't — `node --check` only checks syntax, not that referenced functions exist), so no stub is actually needed; leave the calls as forward references, Task 6/8 will define them in the same file.

- [ ] **Step 2: Wire `startPairing()`'s success callback to call `startShelfScan()` instead of the placeholder comment**

Replace the `// Task 5 implements the shelf-scan step from here.` comment (Task 4, Step 2) with `void startShelfScan();`.

- [ ] **Step 3: Syntax check**

Run: `node --check mobile-inventory.js`

- [ ] **Step 4: Live verify**

Using a real shelf's printed QR (or a manually rendered one with the correct `WMSP.PLCE.WSHK.{rack}.{shelf}` text for a THROWAWAY test rack/shelf — do not scan a real production shelf's code during this test since it will move real boxes' `shelf_id`), confirm: scanning the shelf code advances both phone and display to `scan_boxes`; scanning a box code (use a throwaway test box) inserts a `found` result, updates the box's `shelf_id`, and the button set updates correctly at 0 / 1 / capacity-reached counts; re-scanning the same box shows "уже отсканирован" without a duplicate row. Clean up all test rows/box `shelf_id` changes afterward.

- [ ] **Step 5: Commit**

```bash
git add mobile-inventory.js
git commit -m "feat: mobile inventory shelf and box scanning"
```

---

### Task 6: `mobile-inventory.js` — "Короб без наклейки"

**Files:**
- Modify: `mobile-inventory.js`

**Interfaces:**
- Consumes: `activeSession.shelfId`/`activeSession.shelf` (Task 5), `renderShelfButtons`/`scannedCountForCurrentShelf` (Task 5).
- Produces: `function openMissingStickerList()` (called from Task 5's "Короб без наклейки" button).

- [ ] **Step 1: Implement the list screen + print integration**

```js
    // ---------- Короб без наклейки ----------
    async function openMissingStickerList() {
        stopScanner();
        stepTitle.textContent = "Выберите короб";
        stepMsg.textContent = "";
        video.style.display = "none";

        const { data: allBoxes } = await supabaseClient
            .from("wms_no_shk_boxes")
            .select("id,box_number,area,shift_date,shift_type,box_type")
            .order("box_number", { ascending: true });
        const { data: alreadyAccounted } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("box_id")
            .eq("session_id", activeSession.id)
            .eq("shelf_id", activeSession.shelfId);
        const excluded = new Set((alreadyAccounted || []).map((r) => r.box_id));
        const candidates = (allBoxes || []).filter((b) => !excluded.has(b.id));

        stepButtons.innerHTML = "";
        const filterInput = document.createElement("input");
        filterInput.className = "field";
        filterInput.placeholder = "Номер короба...";
        filterInput.style.marginBottom = "10px";
        stepButtons.appendChild(filterInput);

        const list = document.createElement("div");
        list.style.cssText = "display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto;";
        stepButtons.appendChild(list);

        function renderList(filterText) {
            list.innerHTML = "";
            const filtered = filterText
                ? candidates.filter((b) => String(b.box_number).includes(filterText))
                : candidates;
            filtered.slice(0, 100).forEach((box) => {
                const item = document.createElement("button");
                item.className = "btn btn-outline";
                item.style.textAlign = "left";
                item.textContent = "№" + box.box_number + " — " + box.area + ", " + box.box_type;
                item.addEventListener("click", () => void selectMissingStickerBox(box));
                list.appendChild(item);
            });
        }
        renderList("");
        filterInput.addEventListener("input", () => renderList(filterInput.value.trim()));

        const backBtn = document.createElement("button");
        backBtn.className = "btn btn-outline";
        backBtn.textContent = "Назад";
        backBtn.addEventListener("click", () => void startBoxScan(activeSession.shelf));
        stepButtons.appendChild(backBtn);
    }

    async function selectMissingStickerBox(box) {
        await supabaseClient.from("wms_no_shk_inventory_box_results").insert({
            session_id: activeSession.id, shelf_id: activeSession.shelfId, box_id: box.id, result: "missing_sticker",
        });
        await supabaseClient.from("wms_no_shk_boxes").update({ shelf_id: activeSession.shelfId }).eq("id", box.id);

        // Reprint this box's own sticker -- same payload shape
        // no_shk_zone.js's printActiveBox() builds for the "Короб «Без
        // ШК»" template.
        const { data: template } = await supabaseClient
            .from("print_label_templates")
            .select("id,width_mm,height_mm,elements")
            .eq("name", "Короб «Без ШК»")
            .maybeSingle();
        if (template) {
            const dateLine1 = box.shift_date;
            const tsplData = {
                box_code: "WMSP.BOX." + String(box.box_number).padStart(5, "0"),
                box_number: String(box.box_number),
                box_type: box.box_type,
                area: box.area,
                date_line1: dateLine1,
                date_line2: box.shift_type === "Ночная" ? dateLine1 : "",
                shift: box.shift_type === "Ночная" ? "Ночь" : "День",
            };
            await supabaseClient.from("print_jobs").insert({
                template_id: template.id, data: tsplData,
                tspl: window.buildTsplPayloadBase64 ? window.buildTsplPayloadBase64(template, tsplData) : null,
                created_by: user.id != null ? String(user.id) : null,
            });
        }

        const newCount = await scannedCountForCurrentShelf();
        await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
            .update({ boxes_missing_sticker_count: (await currentMissingStickerCount()) })
            .eq("session_id", activeSession.id).eq("shelf_id", activeSession.shelfId);
        await supabaseClient.from("wms_no_shk_inventory_sessions").update({ last_activity_at: new Date().toISOString() }).eq("id", activeSession.id);

        stepMsg.textContent = "Стикер короба №" + box.box_number + " поставлен в печать";
        void startBoxScan(activeSession.shelf);
        void newCount; // count is re-read by startBoxScan's own renderShelfButtons call
    }

    async function currentMissingStickerCount() {
        const { count } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("id", { count: "exact", head: true })
            .eq("session_id", activeSession.id).eq("shelf_id", activeSession.shelfId).eq("result", "missing_sticker");
        return count || 0;
    }
```

This task needs `print-tspl.js` loaded on the page for `buildTsplPayloadBase64` — add `<script src="print-tspl.js"></script>` to `mobile-inventory.html` right before `<script src="mobile-inventory.js"></script>` (same file already in this repo, used by `no_shk_zone.js`/`print_test.js` — no copy needed, it's in the same directory).

- [ ] **Step 2: Syntax check**

Run: `node --check mobile-inventory.js`

- [ ] **Step 3: Live verify**

On a throwaway test shelf/box set, trigger "Короб без наклейки", confirm the list loads, filtering by number works, selecting a box inserts a `missing_sticker` result, updates its `shelf_id`, queues a `print_jobs` row (check the row exists with non-null `tspl`), and returns to the box-scan screen with the updated button state. Clean up test data and any queued test print job afterward.

- [ ] **Step 4: Commit**

```bash
git add mobile-inventory.html mobile-inventory.js
git commit -m "feat: mobile inventory missing-sticker box selection and reprint"
```

---

### Task 7: shelf-finish (not_found computation) + step loop + session completion

**Files:**
- Modify: `mobile-inventory.js`

**Interfaces:**
- Consumes: `startShelfScan` (Task 5), `activeSession` (Task 4/5).
- Produces: `function finishShelf()` (called from Task 5's finish button), which is what actually completes a shelf and either loops back or completes the session.

- [ ] **Step 1: Implement `finishShelf()`**

```js
    // ---------- Finishing a shelf ----------
    async function finishShelf() {
        stopScanner();
        const shelf = activeSession.shelf;

        // Boxes the DB currently says are on this shelf but weren't
        // matched (found or missing_sticker) during this pass -> not_found.
        const { data: dbBoxesHere } = await supabaseClient.from("wms_no_shk_boxes").select("id").eq("shelf_id", shelf.id);
        const { data: accountedFor } = await supabaseClient
            .from("wms_no_shk_inventory_box_results")
            .select("box_id")
            .eq("session_id", activeSession.id).eq("shelf_id", shelf.id);
        const accountedIds = new Set((accountedFor || []).map((r) => r.box_id));
        const notFound = (dbBoxesHere || []).filter((b) => !accountedIds.has(b.id));
        if (notFound.length) {
            await supabaseClient.from("wms_no_shk_inventory_box_results").insert(
                notFound.map((b) => ({ session_id: activeSession.id, shelf_id: shelf.id, box_id: b.id, result: "not_found" }))
            );
        }

        await supabaseClient.from("wms_no_shk_inventory_shelf_audits")
            .update({ finished_at: new Date().toISOString(), boxes_not_found_count: notFound.length })
            .eq("session_id", activeSession.id).eq("shelf_id", shelf.id);

        const { count: totalShelves } = await supabaseClient.from("wms_no_shk_shelves").select("id", { count: "exact", head: true });
        const { data: finishedRows } = await supabaseClient
            .from("wms_no_shk_inventory_shelf_audits")
            .select("shelf_id")
            .eq("session_id", activeSession.id)
            .not("finished_at", "is", null);
        const finishedCount = new Set((finishedRows || []).map((r) => r.shelf_id)).size;

        if (totalShelves != null && finishedCount >= totalShelves) {
            await supabaseClient
                .from("wms_no_shk_inventory_sessions")
                .update({ status: "completed", step: "completed", finished_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
                .eq("id", activeSession.id);
            void showCompletion();
            return;
        }

        activeSession.shelfId = null;
        activeSession.shelf = null;
        void startShelfScan();
    }
```

`showCompletion()` is implemented in Task 8 — forward reference only, same reasoning as Task 5's forward references (syntax check doesn't need it defined yet, and it will be by the time this code path actually runs since both live in the same final file).

- [ ] **Step 2: Syntax check**

Run: `node --check mobile-inventory.js`

- [ ] **Step 3: Live verify**

Using a small throwaway rack (1-2 shelves) so a full session is quick to complete: run through pairing → scan each shelf → finish each (mix of "no boxes"/scanned boxes/missing-sticker) → confirm the last shelf's finish transitions the session to `completed` and inserts correct `not_found` rows for any box the DB still had on that shelf but that was never scanned/selected. Confirm a non-final shelf's finish instead loops back to `startShelfScan()`, and that the display's prompt reads "Отсканируйте полку" for the very first shelf and "Отсканируйте следующую полку" for every one after (Task 3's `renderInventoryOverlay` already branches on `auditedShelfIdsThisSession.size` for this — no display.js change needed in this task). Clean up all test data afterward.

- [ ] **Step 4: Commit**

```bash
git add mobile-inventory.js
git commit -m "feat: shelf-finish discrepancy recording and session completion"
```

---

### Task 8: Completion animations (both sides)

**Files:**
- Modify: `display.html`
- Modify: `display.js`
- Modify: `mobile-inventory.js`

**Interfaces:**
- Consumes: `activeSession.finished_at`/`started_at` (Task 1/3), session `status === 'completed'` (Task 7).
- Produces: nothing further consumed — this is the terminal UI for the feature.

- [ ] **Step 1: Display completion — confetti + checkmark + elapsed time**

Add a completion view to `display.html`'s inventory overlay (reuse `#inventoryOverlay`/`#inventoryCard`, add a dedicated inner block toggled by JS):

```html
<div id="inventoryCompleteBlock" style="display:none;">
    <div style="font-size:72px;color:#22c55e;">✓</div>
    <p class="qr-card-title">Инвентаризация завершена</p>
    <p class="qr-card-context" id="inventoryElapsedText"></p>
</div>
```

In `display.js`, add a module-level guard next to `activeSession`/`auditedShelfIdsThisSession` (Task 3) so a completed session re-rendering more than once — e.g. the abandon-timeout interval tick, or another unrelated Realtime event — doesn't re-fire the confetti burst or restart the auto-hide timer on every call:

```js
let completionShownForSessionId = null;
```

Then extend the `if/else if` chain inside `renderInventoryOverlay()` (Task 3) with one more branch, placed after the existing `scan_boxes` branch and before the function's closing `}`:

```js
    } else if (activeSession.step === "completed") {
        document.getElementById("inventoryCompleteBlock").style.display = "";
        stepText.style.display = "none";
        if (completionShownForSessionId !== activeSession.id) {
            completionShownForSessionId = activeSession.id;
            const elapsedMs = new Date(activeSession.finished_at).getTime() - new Date(activeSession.started_at).getTime();
            const totalSec = Math.max(0, Math.round(elapsedMs / 1000));
            const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
            const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
            const ss = String(totalSec % 60).padStart(2, "0");
            document.getElementById("inventoryElapsedText").textContent = hh + ":" + mm + ":" + ss;
            fireConfetti();
            setTimeout(() => {
                overlay.classList.remove("is-visible");
                document.getElementById("inventoryCompleteBlock").style.display = "none";
                stepText.style.display = "";
            }, 5000);
        }
    }
```

(`qrBox.innerHTML = ""` and `arrow.style.display = "none"` already run once, before this whole `if/else if` chain, in Task 3's code — nothing extra needed for those two here. Also add `document.getElementById("inventoryCompleteBlock").style.display = "none";` right alongside them, so switching to a *new* session's `pairing` step after a completed one doesn't leave the checkmark block visible underneath the QR.)

Add a minimal CSS-only confetti burst (no new CDN dependency — a handful of absolutely-positioned divs animated via a keyframe, appended and removed by JS):

```js
function fireConfetti() {
    const colors = ["#623CEA", "#22c55e", "#facc15", "#ef4444", "#38bdf8"];
    for (let i = 0; i < 40; i++) {
        const piece = document.createElement("div");
        piece.style.cssText = "position:fixed;top:-10px;width:8px;height:8px;z-index:200;pointer-events:none;border-radius:2px;"
            + "left:" + Math.random() * 100 + "vw;"
            + "background:" + colors[i % colors.length] + ";"
            + "animation:confetti-fall " + (1.8 + Math.random()) + "s ease-in forwards;"
            + "animation-delay:" + (Math.random() * 0.4) + "s;";
        document.body.appendChild(piece);
        setTimeout(() => piece.remove(), 3000);
    }
}
```

Add the keyframe to `display.html`'s `<style>`:

```css
@keyframes confetti-fall {
    from { transform: translateY(0) rotate(0deg); opacity: 1; }
    to { transform: translateY(110vh) rotate(360deg); opacity: 0; }
}
```

- [ ] **Step 2: Mobile completion**

In `mobile-inventory.js`:

```js
    async function showCompletion() {
        stepButtons.innerHTML = "";
        video.style.display = "none";
        const { data } = await supabaseClient.from("wms_no_shk_inventory_sessions").select("started_at,finished_at").eq("id", activeSession.id).single();
        const elapsedMs = new Date(data.finished_at).getTime() - new Date(data.started_at).getTime();
        const totalSec = Math.max(0, Math.round(elapsedMs / 1000));
        const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
        const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
        const ss = String(totalSec % 60).padStart(2, "0");
        stepTitle.textContent = "✓ Инвентаризация завершена";
        stepMsg.textContent = "Время: " + hh + ":" + mm + ":" + ss;
        setTimeout(() => { window.location.href = "mobile-inventory.html"; }, 3000);
    }
```

- [ ] **Step 3: Syntax check**

Run: `node --check display.js && node --check mobile-inventory.js`

- [ ] **Step 4: Live verify**

Run a full throwaway-data session start to finish (same small test rack as Task 7), confirm both the display (confetti + checkmark + correct `чч:мм:сс`) and phone (checkmark + same elapsed time + auto-return to the start screen) show the completion state, and that the display returns to its normal idle zone view ~5s later. Confirm elapsed time matches wall-clock reality within a few seconds. Clean up all test data afterward.

- [ ] **Step 5: Commit**

```bash
git add display.html display.js mobile-inventory.js
git commit -m "feat: inventory completion animations on display and phone"
```

---

## Manual on-site verification (not agent-executable)

Everything above is verified with throwaway test racks/shelves/boxes.
A real end-to-end pass with a physical phone camera, the real display
monitor, and real warehouse racks needs to be done on-site by the user:
walk a real (small) set of shelves, confirm scan reliability under
real lighting, confirm the printed missing-sticker label is legible
and positions correctly, and confirm the 30-minute abandon timeout
behaves sensibly in practice (or adjust `INVENTORY_ABANDON_MS`/the
spec's 30-minute figure if it's inconvenient in real use).
