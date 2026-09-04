import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type IncomingFlowRequestRow = {
  request_time: string | null;
  request_time_label: string;
  sender_employee_id: string;
  sender_lo: string;
  requested_shk: string;
  sample_shk: string;
  tare: string;
  source_sheet: string;
  source_row_number: number | null;
  spreadsheet_id: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_SECRET = Deno.env.get("WEEEK_INCOMING_FLOW_REQUESTS_REFRESH_SECRET") || Deno.env.get("WEEEK_INCOMING_BOXES_REFRESH_SECRET");

const DEFAULT_API_URL = "";
const DEFAULT_SPREADSHEET_ID = "1SvVyOHCaceVs0KQznXPvSMtcynMAL165_F0I_6adJB0";
const DEFAULT_SHEET_NAME = "Проверка корректности вложения в тару";
const DEFAULT_START_ROW = 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_ALLOW_EMPTY_SYNC = false;
const DEFAULT_SOURCE_MODULE = "incoming_flow_requests";
const DEFAULT_SOURCE_TABLE = "google_sheets:incoming_flow_requests";
const DEFAULT_TASK_TYPE = "Запросы входящего потока";
const DEFAULT_DESCRIPTION_TASK_TYPE = "Запросы входящего потока";
const DEFAULT_DEADLINE_HOURS = 2;
const DEFAULT_PRIORITY = 2;
const DEFAULT_TITLE_MAX_LENGTH = 100;
const RPC_BATCH_SIZE = 300;

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

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function truncateText(value: unknown, maxLength = DEFAULT_TITLE_MAX_LENGTH): string {
  const text = normalizeText(value);
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return chars.slice(0, maxLength).join("");
}

function normalizeNumber(value: unknown, fallbackValue: number): number {
  if (value === null || value === undefined || normalizeText(value) === "") return fallbackValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.max(Math.trunc(parsed), 1);
}

function normalizeBoolean(value: unknown, fallbackValue: boolean): boolean {
  if (value === null || value === undefined) return fallbackValue;
  if (typeof value === "boolean") return value;
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return fallbackValue;
  if (["1", "true", "yes", "y", "да"].includes(raw)) return true;
  if (["0", "false", "no", "n", "нет"].includes(raw)) return false;
  return fallbackValue;
}

function normalizeTimeoutMs(value: unknown, fallbackValue: number): number {
  return Math.max(normalizeNumber(value, fallbackValue), 10000);
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const raw = normalizeText(value)
    .replace(/\u00A0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");
  if (!raw) return null;
  const parsed = Number(raw.replace(/\.(?=.*\.)/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizePriority(value: unknown, fallbackValue = DEFAULT_PRIORITY): number {
  const parsed = normalizeInteger(value);
  if (parsed === null) return fallbackValue;
  return Math.min(Math.max(parsed, 0), 3);
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

function normalizeIsoDate(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  let match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s|T|$)/);
  if (match) return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;

  match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s|T|$)/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return `${year}-${pad2(match[2])}-${pad2(match[1])}`;
  }

  const parsed = new Date(raw.replace(" ", "T"));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function normalizeIsoDateTime(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  let normalized = raw.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  if (/^\d{4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(normalized)) {
    normalized = `${normalized}+03:00`;
  }
  const parsed = new Date(normalized);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();

  const ruLike = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (ruLike) {
    let year = Number(ruLike[3]);
    if (year < 100) year += 2000;
    const date = `${year}-${pad2(ruLike[2])}-${pad2(ruLike[1])}`;
    const time = `${pad2(ruLike[4] || "0")}:${pad2(ruLike[5] || "0")}:${pad2(ruLike[6] || "0")}`;
    return new Date(`${date}T${time}+03:00`).toISOString();
  }

  const datePart = normalizeIsoDate(raw);
  return datePart ? `${datePart}T00:00:00.000Z` : null;
}

function normalizeSourceGeneratedAt(value: unknown): string | null {
  return normalizeIsoDateTime(value);
}

function addHoursToIsoDateTime(isoDateTime: string | null, hours: number): string | null {
  if (!isoDateTime) return null;
  const date = new Date(isoDateTime);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function formatRuDateTime(value: unknown): string {
  const raw = normalizeText(value);
  const date = new Date(normalizeIsoDateTime(raw) || raw);
  if (!Number.isFinite(date.getTime())) return raw || "-";
  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(",", "");
}

function normalizeIncomingFlowRow(raw: unknown): IncomingFlowRequestRow | null {
  const row = asObject(raw);
  if (!row) return null;

  const requestedShk = normalizeText(row.requested_shk ?? row.requestedShk ?? row.shk ?? row["Искомый ШК"]);
  if (!requestedShk) return null;

  const requestTimeRaw = row.request_time ?? row.requestTime ?? row["Отметка времени"] ?? row.request_time_label;

  return {
    request_time: normalizeIsoDateTime(requestTimeRaw),
    request_time_label: normalizeText(row.request_time_label ?? row.requestTimeLabel ?? row["Отметка времени"] ?? requestTimeRaw),
    sender_employee_id: normalizeText(row.sender_employee_id ?? row.senderEmployeeId ?? row["ID сотрудника"]),
    sender_lo: normalizeText(row.sender_lo ?? row.senderLo ?? row["Наименование ЛО"]),
    requested_shk: requestedShk,
    sample_shk: normalizeText(row.sample_shk ?? row.sampleShk ?? row["Пример разложенного ШК"]),
    tare: normalizeText(row.tare ?? row["Тара"]),
    source_sheet: normalizeText(row.source_sheet ?? row.sourceSheet),
    source_row_number: normalizeInteger(row.source_row_number ?? row.sourceRowNumber),
    spreadsheet_id: normalizeText(row.spreadsheet_id ?? row.spreadsheetId),
  };
}

function parseRowsFromPayload(payload: unknown): { rows: IncomingFlowRequestRow[]; duplicates: number; skipped: number; sourceGeneratedAt: string | null; duplicateRowsInSource: number } {
  const root = asObject(payload);
  const sourceRows = Array.isArray(root?.rows)
    ? root.rows
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(payload)
        ? payload
        : [];
  const sourceGeneratedAt = normalizeSourceGeneratedAt(root?.generated_at ?? root?.generatedAt);
  const deduplicated = new Map<string, IncomingFlowRequestRow>();
  let duplicates = 0;
  let skipped = 0;

  sourceRows.forEach((rawRow) => {
    const normalized = normalizeIncomingFlowRow(rawRow);
    if (!normalized) {
      skipped += 1;
      return;
    }
    if (deduplicated.has(normalized.requested_shk)) duplicates += 1;
    deduplicated.set(normalized.requested_shk, normalized);
  });

  const duplicateRowsInSource = Array.isArray(root?.duplicate_rows) ? root.duplicate_rows.length : 0;
  return { rows: Array.from(deduplicated.values()), duplicates, skipped, sourceGeneratedAt, duplicateRowsInSource };
}

function buildApiUrl(body: JsonObject): string {
  const apiUrl = normalizeText(body.api_url) || normalizeText(Deno.env.get("INCOMING_FLOW_REQUESTS_APPS_SCRIPT_URL")) || DEFAULT_API_URL;
  if (!apiUrl) throw new Error("api_url or INCOMING_FLOW_REQUESTS_APPS_SCRIPT_URL is required");

  const url = new URL(apiUrl);
  const spreadsheetId = normalizeText(body.spreadsheet_id) || DEFAULT_SPREADSHEET_ID;
  const sheetName = normalizeText(body.sheet_name) || DEFAULT_SHEET_NAME;
  const startRow = normalizeNumber(body.start_row ?? DEFAULT_START_ROW, DEFAULT_START_ROW);
  const appsScriptSecret = normalizeText(body.apps_script_secret ?? body.source_secret) || normalizeText(Deno.env.get("INCOMING_FLOW_REQUESTS_APPS_SCRIPT_SECRET"));
  const sourceAction =
    normalizeText(body.apps_script_action ?? body.source_action) ||
    (["list_sheets", "sheets"].includes(normalizeText(body.action ?? body.mode)) ? "list_sheets" : "");

  if (spreadsheetId) url.searchParams.set("spreadsheet_id", spreadsheetId);
  if (sheetName) url.searchParams.set("sheet_name", sheetName);
  if (startRow > 1) url.searchParams.set("start_row", String(startRow));
  if (appsScriptSecret) url.searchParams.set("secret", appsScriptSecret);
  if (sourceAction) url.searchParams.set("action", sourceAction);
  url.searchParams.set("_ts", String(Date.now()));

  return url.toString();
}

async function fetchAppsScriptPayload(body: JsonObject): Promise<JsonObject> {
  const requestTimeoutMs = normalizeTimeoutMs(body.request_timeout_ms, DEFAULT_REQUEST_TIMEOUT_MS);
  const response = await fetch(buildApiUrl(body), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Apps Script API returned non-JSON response");
  }

  const payloadObject = asObject(payload);
  if (!response.ok || payloadObject?.ok === false) {
    throw new Error(String(payloadObject?.error ?? `HTTP ${response.status}`));
  }
  if (!payloadObject) throw new Error("Apps Script API returned an unexpected payload");

  return payloadObject;
}

function buildDescription(row: IncomingFlowRequestRow): string {
  return [
    `Искомый ШК: ${row.requested_shk || "-"}`,
    `Пример разложенного ШК: ${row.sample_shk || "-"}`,
    `Тара: ${row.tare || "-"}`,
    `ЛО-отправитель: ${row.sender_lo || "-"}`,
    `Сотрудник-отправитель: ${row.sender_employee_id || "-"}`,
  ].join("\n");
}

function buildTaskPayload(row: IncomingFlowRequestRow, body: JsonObject, sourceGeneratedAt: string | null): JsonObject {
  const sourceModule = normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE;
  const taskType = normalizeText(body.task_type) || DEFAULT_TASK_TYPE;
  const deadlineHours = normalizeNumber(body.deadline_hours, DEFAULT_DEADLINE_HOURS);
  const dueDateTime = addHoursToIsoDateTime(row.request_time, deadlineHours);
  const descriptionTaskType = normalizeText(body.description_task_type) || DEFAULT_DESCRIPTION_TASK_TYPE;
  const apiUrl = normalizeText(body.api_url) || normalizeText(Deno.env.get("INCOMING_FLOW_REQUESTS_APPS_SCRIPT_URL")) || DEFAULT_API_URL;
  const spreadsheetId = normalizeText(body.spreadsheet_id) || row.spreadsheet_id || DEFAULT_SPREADSHEET_ID;
  const sheetName = normalizeText(body.sheet_name) || row.source_sheet || DEFAULT_SHEET_NAME;
  const title = truncateText(`Запрос входящего потока | ${row.requested_shk} | ${row.sender_lo || "ЛО не указано"}`);
  const dueDate = dueDateTime ? dueDateTime.slice(0, 10) : null;

  return {
    source_module: sourceModule,
    source_table: normalizeText(body.source_table) || DEFAULT_SOURCE_TABLE,
    source_id: row.requested_shk,
    source_row_id: row.source_row_number === null ? null : `${row.source_sheet || sheetName}:${row.source_row_number}`,
    source_payload: {
      ...row,
      description_task_type: descriptionTaskType,
      task_due_datetime: dueDateTime,
      api_url: apiUrl,
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName,
      source_row_number: row.source_row_number,
    },
    source_generated_at: sourceGeneratedAt,
    task_type: taskType,
    title,
    description: buildDescription(row),
    priority: normalizePriority(body.priority, DEFAULT_PRIORITY),
    priority_label: null,
    due_date: dueDate,
    upload_type: sourceModule,
    upload_effective_date: dueDate,
    search_text: [title, taskType, row.requested_shk, row.sample_shk, row.sender_lo].filter(Boolean).join(" "),
    tags: [],
  };
}

async function upsertTasks(tasks: JsonObject[]): Promise<number> {
  let upserted = 0;
  for (let offset = 0; offset < tasks.length; offset += RPC_BATCH_SIZE) {
    const batch = tasks.slice(offset, offset + RPC_BATCH_SIZE);
    const { data, error } = await supabase.rpc("upsert_wms_external_requests_from_json", { p_tasks: batch });
    if (error) throw new Error(`Failed to upsert rows into wms_tasks: ${error.message}`);
    upserted += Number(data ?? batch.length);
  }
  return upserted;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed. Use POST." });

  let body: JsonObject = {};
  try {
    const raw = await req.json().catch(() => ({}));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) body = raw as JsonObject;
  } catch {
    body = {};
  }

  if (FUNCTION_SECRET && normalizeText(body.secret) !== FUNCTION_SECRET) {
    return json(401, { ok: false, error: "Invalid refresh secret" });
  }

  const dryRun = normalizeBoolean(body.dry_run, false);
  const allowEmptySync = normalizeBoolean(body.allow_empty_sync, DEFAULT_ALLOW_EMPTY_SYNC);
  const requestTimeoutMs = normalizeTimeoutMs(body.request_timeout_ms, DEFAULT_REQUEST_TIMEOUT_MS);
  const action = normalizeText(body.action ?? body.mode);
  const startedAt = new Date().toISOString();

  try {
    const payload = await fetchAppsScriptPayload(body);

    if (["list_sheets", "sheets"].includes(action)) {
      return json(200, {
        ok: true,
        action: "list_sheets",
        request_timeout_ms: requestTimeoutMs,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        payload,
      });
    }

    const parsed = parseRowsFromPayload(payload);
    if (!parsed.rows.length && !allowEmptySync) {
      throw new Error("Apps Script returned 0 rows. Refusing to sync empty dataset without allow_empty_sync=true.");
    }

    const tasks = parsed.rows.map((row) => buildTaskPayload(row, body, parsed.sourceGeneratedAt));
    const upsertedRows = dryRun || !tasks.length ? 0 : await upsertTasks(tasks);

    return json(200, {
      ok: true,
      dry_run: dryRun,
      target_table: "wms_tasks",
      source_module: normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE,
      request_timeout_ms: requestTimeoutMs,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      fetched_rows: parsed.rows.length,
      queued_rows: upsertedRows,
      duplicate_rows_in_payload: parsed.duplicates,
      duplicate_rows_marked_in_source: parsed.duplicateRowsInSource,
      skipped_rows: parsed.skipped + (Array.isArray(payload.skipped_rows) ? payload.skipped_rows.length : 0),
      source_generated_at: parsed.sourceGeneratedAt,
      sample: dryRun ? tasks.slice(0, 5) : undefined,
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: String(err instanceof Error ? err.message : err),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  }
});
