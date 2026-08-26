import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_SECRET = Deno.env.get("WMS_TASK_WRITEBACK_SECRET") || "";

const WMS_TASKS_TABLE = "wms_tasks";
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;

const INCOMING_FLOW_DEFAULT_SPREADSHEET_ID = "1SvVyOHCaceVs0KQznXPvSMtcynMAL165_F0I_6adJB0";
const INCOMING_FLOW_DEFAULT_SHEET_NAME = "Проверка корректности вложения в тару";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  };
}

function json(status: number, body: JsonObject) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" },
  });
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeForMatch(value: unknown): string {
  return normalizeText(value).replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/\s+/g, " ").toLowerCase();
}

function normalizeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const parsed = Number(normalizeText(value).replace(/\D+/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function requestTimeoutMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(Math.trunc(parsed), 10000) : DEFAULT_REQUEST_TIMEOUT_MS;
}

function normalizeBoolean(value: unknown): boolean {
  if (value === true) return true;
  const text = normalizeForMatch(value);
  return ["1", "true", "yes", "y", "да"].includes(text);
}

function sourcePayload(row: JsonObject): JsonObject {
  return asObject(row.source_payload);
}

function sourceRowNumber(row: JsonObject): number {
  const payload = sourcePayload(row);
  const direct = normalizeNumber(payload.source_row_number ?? payload.sourceRowNumber);
  if (direct) return direct;
  const sourceRowId = normalizeText(row.source_row_id);
  const match = sourceRowId.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

function sourceSheetName(row: JsonObject, fallback = ""): string {
  const payload = sourcePayload(row);
  return normalizeText(payload.sheet_name ?? payload.source_sheet ?? payload.sourceSheet) || fallback;
}

function taskModule(row: JsonObject): string {
  const combined = [
    row.source_module,
    row.task_type,
    row.upload_type,
    row.title,
  ].map(normalizeForMatch).join(" ");
  if (combined.includes("запрос") && combined.includes("вход")) return "incoming_flow_requests";
  return normalizeText(row.source_module);
}

function appsScriptUrl(row: JsonObject, module: string): string {
  const payload = sourcePayload(row);
  const fromPayload = normalizeText(payload.api_url ?? payload.apps_script_url);
  if (fromPayload) return fromPayload;
  if (module === "incoming_flow_requests") return normalizeText(Deno.env.get("INCOMING_FLOW_REQUESTS_APPS_SCRIPT_URL"));
  return "";
}

function appsScriptSecret(module: string): string {
  if (module === "incoming_flow_requests") return normalizeText(Deno.env.get("INCOMING_FLOW_REQUESTS_APPS_SCRIPT_SECRET"));
  return "";
}

function spreadsheetId(row: JsonObject, module: string): string {
  const payload = sourcePayload(row);
  const fromPayload = normalizeText(payload.spreadsheet_id ?? payload.spreadsheetId);
  if (fromPayload) return fromPayload;
  if (module === "incoming_flow_requests") return INCOMING_FLOW_DEFAULT_SPREADSHEET_ID;
  return "";
}

async function postJson(url: string, body: JsonObject, timeoutMs: number): Promise<JsonObject> {
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  const result = asObject(payload);
  if (!response.ok || result.ok === false) {
    throw new Error(normalizeText(result.error) || text || response.statusText);
  }
  return result;
}

function incomingFlowPayload(row: JsonObject, review: JsonObject, options: JsonObject = {}): JsonObject {
  const module = "incoming_flow_requests";
  const payload = sourcePayload(row);
  const rowNumber = sourceRowNumber(row);
  const attachment = normalizeText(review.attachment || review.verdict);
  const comment = normalizeText(review.comment);
  if (!rowNumber) throw new Error("source_row_number is missing for incoming flow writeback");
  if (!attachment || !comment) throw new Error("Incoming flow writeback requires attachment and comment");
  return {
    action: "update_result",
    secret: appsScriptSecret(module) || undefined,
    spreadsheet_id: spreadsheetId(row, module),
    sheet_name: sourceSheetName(row, INCOMING_FLOW_DEFAULT_SHEET_NAME),
    row_number: rowNumber,
    requested_shk: normalizeText(payload.requested_shk ?? row.source_id),
    attachment,
    comment,
    allow_overwrite: normalizeBoolean(options.allow_overwrite ?? options.overwrite),
  };
}

function buildWritebackPayload(row: JsonObject, review: JsonObject, options: JsonObject = {}): { module: string; url: string; body: JsonObject } {
  const module = taskModule(row);
  if (module !== "incoming_flow_requests") {
    throw new Error(`Writeback is enabled only for incoming_flow_requests. Current module: ${module || "unknown"}`);
  }
  const url = appsScriptUrl(row, module);
  if (!url) throw new Error(`Apps Script URL is not configured for ${module}`);
  return { module, url, body: incomingFlowPayload(row, review, options) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed. Use POST." });

  const startedAt = new Date().toISOString();
  try {
    const body = asObject(await req.json().catch(() => ({})));
    if (FUNCTION_SECRET && normalizeText(body.secret) !== FUNCTION_SECRET) {
      return json(401, { ok: false, error: "Invalid writeback secret" });
    }

    const taskId = normalizeText(body.task_id);
    if (!taskId) throw new Error("task_id is required");
    const review = asObject(body.review);
    const timeoutMs = requestTimeoutMs(body.timeout_ms);
    const writebackOptions = {
      allow_overwrite: normalizeBoolean(body.allow_overwrite ?? body.overwrite),
    };

    const { data, error } = await supabase
      .from(WMS_TASKS_TABLE)
      .select("id,source_module,source_id,source_row_id,source_payload,upload_type,task_type,title")
      .eq("id", taskId)
      .single();
    if (error) throw new Error(`Failed to load WMS task: ${error.message}`);
    if (!data) throw new Error("WMS task not found");

    const row = data as JsonObject;
    const request = buildWritebackPayload(row, review, writebackOptions);
    const sourceResponse = await postJson(request.url, request.body, timeoutMs);

    return json(200, {
      ok: true,
      action: "wms_task_writeback",
      task_id: taskId,
      source_module: request.module,
      source_response: sourceResponse,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    return json(400, {
      ok: false,
      error: error && error.message ? error.message : String(error),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  }
});
