// "Вероятные номенклатуры" для ленты «Без ШК»: раз в минуту (см.
// 202609250002_wb_photo_match_cron.sql) забирает пачку строк
// intake_submissions без wb_nm_checked_at (и ещё не исчерпавших
// MAX_CHECK_ATTEMPTS попыток), для каждой прогоняет фото через
// (неофициальный, реверс-инжиниренный) поиск по фото Wildberries и
// сохраняет список найденных артикулов (nm) обратно на строку. Неудачная
// попытка не сдаётся сразу -- см. processRow.
//
// Алгоритм подписи взят из публичного Chrome-расширения
// "wbcon-item-finder-by-picture" (его background.js): search-by-photo.wb.ru
// не часть официального API, ключ статический и общий для всех
// пользователей этого расширения -- WB может инвалидировать его без
// предупреждения. Это прототип, не гарантированно стабильный канал.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_SECRET = Deno.env.get("WB_PHOTO_MATCH_SECRET") || "";
const BATCH_SIZE = Math.max(Number(Deno.env.get("WB_PHOTO_MATCH_BATCH_SIZE") ?? "15") || 15, 1);
const MAX_CANDIDATES = 20;
// A row that fails (bad photo, WB down, network blip) gets retried on
// later runs instead of being given up on after one shot -- but still
// gives up eventually, so one permanently-broken photo can't camp at the
// front of the oldest-first queue forever and starve everything behind
// it. See 202609300008_intake_wb_nm_retry.sql for the attempts column.
const MAX_CHECK_ATTEMPTS = Math.max(Number(Deno.env.get("WB_PHOTO_MATCH_MAX_ATTEMPTS") ?? "5") || 5, 1);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const INTAKE_PHOTO_BASE = `${SUPABASE_URL}/storage/v1/object/public/intake-photos/`;

// ---------------------------------------------------------------------
// Подпись search-by-photo.wb.ru: 3 раунда AES-256-CTR (случайный IV на
// каждом раунде, IV||ciphertext -> base64, результат раунда становится
// открытым текстом следующего) над строкой "RequestUUID:<uuid>". Ключ =
// SHA-256(XOR-деобфусцированный секрет). Deno's Web Crypto делает
// AES-CTR нативно -- ручная реализация AES не нужна.
// ---------------------------------------------------------------------

const ARRAY_KEY = new Uint8Array([
  84, 7, 81, 11, 3, 86, 84, 91, 82, 0, 85, 86, 83, 3, 83, 94, 4, 10, 2, 15,
  6, 3, 81, 90, 7, 5, 7, 4, 1, 82, 5, 87, 4, 85, 89, 80, 82, 0, 89, 7,
  85, 87, 5, 12, 87, 6, 82, 9, 90, 2, 84, 85, 2, 86, 84, 1, 1, 84, 83, 83,
  84, 7, 82, 94,
]);
const SALT = new TextEncoder().encode("b723375b3aac60afa239c149");

function revealKeyMaterial(): string {
  const out = new Uint8Array(ARRAY_KEY.length);
  for (let i = 0; i < ARRAY_KEY.length; i++) out[i] = ARRAY_KEY[i] ^ SALT[i % SALT.length];
  return new TextDecoder().decode(out);
}

let cachedAesKey: CryptoKey | null = null;
async function getAesKey(): Promise<CryptoKey> {
  if (cachedAesKey) return cachedAesKey;
  const revealed = new TextEncoder().encode(revealKeyMaterial());
  const digest = await crypto.subtle.digest("SHA-256", revealed);
  cachedAesKey = await crypto.subtle.importKey("raw", digest, { name: "AES-CTR" }, false, ["encrypt"]);
  return cachedAesKey;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function makeSignature(requestUuid: string): Promise<string> {
  const key = await getAesKey();
  let a: Uint8Array = new TextEncoder().encode(`RequestUUID:${requestUuid}`);
  for (let round = 0; round < 3; round++) {
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 128 }, key, a),
    );
    const combined = new Uint8Array(iv.length + ciphertext.length);
    combined.set(iv, 0);
    combined.set(ciphertext, iv.length);
    a = new TextEncoder().encode(bytesToBase64(combined));
  }
  return new TextDecoder().decode(a);
}

// ---------------------------------------------------------------------

type WbUploadResult = { im_name?: number | string }[];

async function searchByPhoto(photoBytes: Uint8Array, filename: string, contentType: string): Promise<number[]> {
  const requestUuid = crypto.randomUUID();
  const signature = await makeSignature(requestUuid);

  const form = new FormData();
  form.append("image", new Blob([photoBytes], { type: contentType || "image/jpeg" }), filename || "photo.jpg");

  const res = await fetch("https://search-by-photo.wb.ru/uploadsearch", {
    method: "POST",
    headers: {
      requestuuid: requestUuid,
      userid: "0",
      signature,
      "test-properties": "ab_visual_infra=control",
    },
    body: form,
  });
  if (!res.ok) throw new Error(`uploadsearch HTTP ${res.status}`);
  const data = await res.json();
  const result: WbUploadResult = Array.isArray(data?.result) ? data.result : [];
  const nmSet = new Set<number>();
  for (const entry of result) {
    const nm = Number(entry?.im_name);
    if (Number.isFinite(nm) && nm > 0) nmSet.add(nm);
  }
  return Array.from(nmSet).slice(0, MAX_CANDIDATES);
}

async function processRow(row: { id: string; photo_path: string; wb_nm_check_attempts: number | null }): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    const photoRes = await fetch(INTAKE_PHOTO_BASE + row.photo_path);
    if (!photoRes.ok) throw new Error(`photo fetch HTTP ${photoRes.status}`);
    const contentType = photoRes.headers.get("content-type") || "image/jpeg";
    const photoBytes = new Uint8Array(await photoRes.arrayBuffer());
    const filename = row.photo_path.split("/").pop() || "photo.jpg";
    const nmList = await searchByPhoto(photoBytes, filename, contentType);
    await supabase
      .from("intake_submissions")
      .update({ wb_nm_candidates: nmList, wb_nm_checked_at: nowIso })
      .eq("id", row.id);
  } catch (err) {
    // A failed attempt (bad photo, WB down, network blip) no longer gives
    // up immediately -- bump the attempt counter and leave
    // wb_nm_checked_at null so the next run's query (which excludes rows
    // past MAX_CHECK_ATTEMPTS) picks this row back up. Only once attempts
    // actually reach the cap do we give up for good, same as the old
    // one-shot behavior -- still needed so one permanently-broken photo
    // can't sit at the front of the oldest-first queue forever.
    console.error("wb-photo-match: row failed", row.id, err);
    const attempts = (row.wb_nm_check_attempts ?? 0) + 1;
    const giveUp = attempts >= MAX_CHECK_ATTEMPTS;
    await supabase
      .from("intake_submissions")
      .update({
        wb_nm_check_attempts: attempts,
        ...(giveUp ? { wb_nm_candidates: [], wb_nm_checked_at: nowIso } : {}),
      })
      .eq("id", row.id);
  }
}

// ---------------------------------------------------------------------
// wms_nm_directory top-up: a global nm -> name/brand cache (see
// 202609300005_nm_directory.sql), used by the "Без ШК" search
// (wms_search_no_shk_items) to match on WB's guessed name/brand, not just
// the operator's own item_text. Superset actualization (tasks.js) already
// fills this for free for any nm that ends up on a real task -- this covers
// the rest: candidate nm's from photo search that never make it onto a
// task (rejected matches, or nothing matched yet).
//
// card.wb.ru/u-card.wb.ru are behind WB's own anti-bot (wbaas): confirmed
// by hand that even a spoofed Referer/Origin still gets a 403 -- it needs
// an IP-bound session cookie only a real, challenge-solving browser can
// mint. But every card is ALSO published as a plain static JSON file on
// WB's basket CDN, with no auth, no rate limit, no anti-bot at all:
//   https://basket-{NN}.wbbasket.ru/vol{VOL}/part{PART}/{nm}/info/ru/card.json
// See 202609300009_wb_basket_cache.sql for VOL/PART math and why NN has
// to be discovered by probing rather than computed.
// ---------------------------------------------------------------------

const BASKET_PROBE_MAX = 60; // highest basket seen in manual testing was 47 -- some headroom as WB adds more over time

function basketCardUrl(nm: number, basketNo: number): string {
  const vol = Math.floor(nm / 100000);
  const part = Math.floor(nm / 1000);
  const n = String(basketNo).padStart(2, "0");
  return `https://basket-${n}.wbbasket.ru/vol${vol}/part${part}/${nm}/info/ru/card.json`;
}

type WbBasketCard = { imt_name?: string; selling?: { brand_name?: string } };

async function probeBasket(nm: number, basketNo: number): Promise<{ basketNo: number; data: WbBasketCard } | null> {
  try {
    const res = await fetch(basketCardUrl(nm, basketNo));
    if (!res.ok) return null;
    const data = await res.json();
    return { basketNo, data };
  } catch {
    return null;
  }
}

async function getCachedBasketNo(vol: number): Promise<number | null> {
  const { data } = await supabase.from("wms_wb_basket_cache").select("basket_no").eq("vol", vol).maybeSingle();
  return data ? data.basket_no : null;
}

async function setCachedBasketNo(vol: number, basketNo: number): Promise<void> {
  await supabase.from("wms_wb_basket_cache").upsert({ vol, basket_no: basketNo, updated_at: new Date().toISOString() });
}

function extractNameBrand(data: WbBasketCard): { name: string; brand: string } {
  return { name: String(data.imt_name ?? "").trim(), brand: String(data.selling?.brand_name ?? "").trim() };
}

async function fetchWbCardNameBrand(nmStr: string): Promise<{ name: string; brand: string } | null> {
  const nm = Number(nmStr);
  if (!Number.isFinite(nm) || nm <= 0) return null;
  const vol = Math.floor(nm / 100000);

  const cached = await getCachedBasketNo(vol);
  if (cached != null) {
    const hit = await probeBasket(nm, cached);
    if (hit) return extractNameBrand(hit.data);
    // Cached basket no longer has this vol (rare -- WB rarely moves data
    // once written) -- fall through to a full reprobe below.
  }

  const attempts = Array.from({ length: BASKET_PROBE_MAX }, (_, i) => i + 1)
    .filter((n) => n !== cached)
    .map((n) => probeBasket(nm, n));
  const results = await Promise.all(attempts);
  const hit = results.find((r): r is { basketNo: number; data: WbBasketCard } => r !== null);
  if (!hit) return null;
  await setCachedBasketNo(vol, hit.basketNo);
  return extractNameBrand(hit.data);
}

const NM_DIRECTORY_BATCH_SIZE = Math.max(Number(Deno.env.get("WB_NM_DIRECTORY_BATCH_SIZE") ?? "15") || 15, 1);

async function topUpNmDirectory(): Promise<number> {
  // Recent submissions only -- candidates recur heavily across photos of
  // the same product, so this stays small in practice even though each
  // row can carry up to 20 candidate nm's. neq '[]' excludes both null
  // and empty-array rows in one filter (SQL's null <> anything evaluates
  // to null, which WHERE treats as false) -- most recently-checked rows
  // are actually [] (nothing found), so a plain "is not null" filter here
  // was mostly returning those instead of rows that ever had candidates.
  const { data: subRows, error: subErr } = await supabase
    .from("intake_submissions")
    .select("wb_nm_candidates")
    .neq("wb_nm_candidates", "[]")
    .order("created_at", { ascending: false })
    .limit(60);
  if (subErr || !subRows) return 0;

  const candidateNms = new Set<string>();
  for (const row of subRows as { wb_nm_candidates: unknown }[]) {
    const list = Array.isArray(row.wb_nm_candidates) ? row.wb_nm_candidates : [];
    for (const nm of list) {
      const s = String(nm ?? "").trim();
      if (s) candidateNms.add(s);
    }
  }
  if (!candidateNms.size) return 0;

  // Capped before the "already known" check -- keeps the IN clause small
  // regardless of how many distinct candidates a busy batch turns up.
  const allNms = Array.from(candidateNms).slice(0, 200);
  const { data: known, error: knownErr } = await supabase
    .from("wms_nm_directory")
    .select("nm")
    .in("nm", allNms);
  if (knownErr) return 0;
  const knownSet = new Set((known || []).map((r: { nm: string }) => r.nm));
  const missing = allNms.filter((nm) => !knownSet.has(nm)).slice(0, NM_DIRECTORY_BATCH_SIZE);
  if (!missing.length) return 0;

  let filled = 0;
  for (const nm of missing) {
    const card = await fetchWbCardNameBrand(nm);
    if (!card || (!card.name && !card.brand)) continue;
    const { error: upErr } = await supabase
      .from("wms_nm_directory")
      .upsert({ nm, name: card.name || null, brand: card.brand || null, source: "wb", updated_at: new Date().toISOString() });
    if (!upErr) filled += 1;
  }
  return filled;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed. Use POST." });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const secretValue = (body as Record<string, unknown>).secret;
  const secret = typeof secretValue === "string" ? secretValue : "";
  if (!FUNCTION_SECRET || secret !== FUNCTION_SECRET) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  const { data: rows, error } = await supabase
    .from("intake_submissions")
    .select("id, photo_path, wb_nm_check_attempts")
    .is("wb_nm_checked_at", null)
    .not("photo_path", "is", null)
    .lt("wb_nm_check_attempts", MAX_CHECK_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) return json(500, { ok: false, error: error.message });

  const processedRows = (rows || []) as { id: string; photo_path: string; wb_nm_check_attempts: number | null }[];
  for (const row of processedRows) {
    await processRow(row);
  }

  let matchedCount = 0;
  // Only worth a bulk-match pass when this batch actually produced new
  // candidates -- an empty batch has nothing new for it to find.
  if (processedRows.length) {
    const { error: matchError, data } = await supabase.rpc("wms_no_shk_bulk_match_and_persist");
    if (matchError) console.error("wb-photo-match: bulk match failed", matchError);
    else matchedCount = data ?? 0;
  }

  // Runs every invocation regardless of whether this batch found new
  // photos -- missing directory entries can still be sitting on
  // candidates from earlier batches that this same run didn't touch.
  let nmDirectoryFilled = 0;
  try {
    nmDirectoryFilled = await topUpNmDirectory();
  } catch (err) {
    console.error("wb-photo-match: nm directory top-up failed", err);
  }

  return json(200, {
    ok: true,
    processed: processedRows.length,
    matched_tasks: matchedCount,
    nm_directory_filled: nmDirectoryFilled,
  });
});
