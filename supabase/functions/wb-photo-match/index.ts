// "Вероятные номенклатуры" для ленты «Без ШК»: раз в минуту (см.
// 202609250002_wb_photo_match_cron.sql) забирает пачку строк
// intake_submissions без wb_nm_checked_at, для каждой прогоняет фото
// через (неофициальный, реверс-инжиниренный) поиск по фото Wildberries
// и сохраняет список найденных артикулов (nm) обратно на строку.
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

async function processRow(row: { id: string; photo_path: string }): Promise<void> {
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
    // Помечаем строку проверенной (пустым списком) даже при ошибке --
    // иначе один битый файл/сетевой сбой будет вечно переигрываться
    // каждую минуту и съедать бюджет пачки у остальных строк.
    console.error("wb-photo-match: row failed", row.id, err);
    await supabase
      .from("intake_submissions")
      .update({ wb_nm_candidates: [], wb_nm_checked_at: nowIso })
      .eq("id", row.id);
  }
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
    .select("id, photo_path")
    .is("wb_nm_checked_at", null)
    .not("photo_path", "is", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) return json(500, { ok: false, error: error.message });
  if (!rows || !rows.length) return json(200, { ok: true, processed: 0 });

  for (const row of rows as { id: string; photo_path: string }[]) {
    await processRow(row);
  }

  return json(200, { ok: true, processed: rows.length });
});
