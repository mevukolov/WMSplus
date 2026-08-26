import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const YANDEX_WEBHOOK_SECRET = Deno.env.get("YANDEX_WEBHOOK_SECRET");
const YANDEX_TARGET_TABLE = Deno.env.get("YANDEX_TARGET_TABLE");
const YANDEX_DELIVERY_ID_COLUMN = (Deno.env.get("YANDEX_DELIVERY_ID_COLUMN") ?? "").trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function json(status: number, body: JsonObject) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const s = value.trim();
    return s.length > 0 ? s : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function normalizeInt8(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(Math.trunc(value));
  }

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (!/^-?\d+$/.test(s)) return null;
    return s;
  }

  return null;
}

function pick(payload: JsonObject, answers: JsonObject | null, keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined) return payload[key];
    if (answers && answers[key] !== undefined) return answers[key];
  }
  return undefined;
}

function buildRow(payload: JsonObject) {
  const answers = asObject(payload.answers) ?? asObject(payload.fields) ?? asObject(payload.data);

  const row: JsonObject = {
    shk1: normalizeInt8(pick(payload, answers, ["shk1", "shk_1", "barcode_1", "code1"])),
    shk2: normalizeInt8(pick(payload, answers, ["shk2", "shk_2", "barcode_2", "code2"])),
    eventtype: normalizeText(pick(payload, answers, ["eventtype", "event_type", "event"])),
    media: normalizeText(pick(payload, answers, ["media", "source", "channel"])),
    wh_id: normalizeText(pick(payload, answers, ["wh_id", "warehouse_id", "wh"])),
  };

  // Remove null keys so DB defaults continue working.
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      delete row[key];
    }
  }

  return row;
}

function getProvidedSecret(req: Request) {
  const directHeader = req.headers.get("x-yandex-webhook-secret");
  if (directHeader && directHeader.trim().length > 0) return directHeader.trim();

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token.length > 0) return token;
  }

  // Fallback for integrations that cannot set custom headers.
  const url = new URL(req.url);
  const fromQuery = (url.searchParams.get("secret") ?? url.searchParams.get("token") ?? "").trim();
  return fromQuery.length > 0 ? fromQuery : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed. Use POST." });
  }

  if (!YANDEX_TARGET_TABLE) {
    return json(500, {
      error: "Server misconfigured: missing YANDEX_TARGET_TABLE",
    });
  }

  const providedSecret = getProvidedSecret(req);
  if (YANDEX_WEBHOOK_SECRET && providedSecret !== YANDEX_WEBHOOK_SECRET) {
    return json(401, { error: "Invalid webhook secret" });
  }

  let payload: JsonObject;
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { error: "Request body must be a JSON object" });
    }
    payload = body as JsonObject;
  } catch {
    return json(400, { error: "Invalid JSON payload" });
  }

  const row: JsonObject = buildRow(payload);
  const deliveryHeader = req.headers.get("x-delivery-id");
  if (YANDEX_DELIVERY_ID_COLUMN && deliveryHeader?.trim()) {
    row[YANDEX_DELIVERY_ID_COLUMN] = deliveryHeader.trim();
  }

  if (Object.keys(row).length === 0) {
    return json(400, {
      error: "No mappable fields in payload",
      expected_fields: ["shk1", "shk2", "eventtype", "media", "wh_id"],
    });
  }

  const { error } = await supabase.from(YANDEX_TARGET_TABLE).insert(row);

  if (error) {
    return json(500, {
      error: "Failed to write payload to Supabase",
      details: error.message,
      db_code: error.code ?? null,
      db_hint: error.hint ?? null,
    });
  }

  return json(200, {
    ok: true,
    table: YANDEX_TARGET_TABLE,
  });
});
