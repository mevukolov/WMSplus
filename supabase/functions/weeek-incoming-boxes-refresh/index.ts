import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type IncomingBoxRow = {
  date: string | null;
  box: string;
  shk_qty: number | null;
  comment: string;
  analysis: string;
  analysis_status: string;
  error: string;
  guilty_id: string;
  source_sheet: string;
  source_row_number: number | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_SECRET = Deno.env.get("WEEEK_INCOMING_BOXES_REFRESH_SECRET");

const DEFAULT_API_URL = "";
const DEFAULT_SPREADSHEET_ID = "";
const DEFAULT_SHEET_NAME = "Разбор";
const DEFAULT_START_ROW = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_ALLOW_EMPTY_SYNC = false;
const DEFAULT_SOURCE_MODULE = "incoming_boxes";
const DEFAULT_SOURCE_TABLE = "google_sheets:incoming_boxes";
const DEFAULT_TASK_TYPE = "Коробки на входе";
const DEFAULT_DEADLINE_DAYS = 29;
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

function normalizePriority(value: unknown): number {
  const parsed = normalizeInteger(value);
  if (parsed === null) return 0;
  return Math.min(Math.max(parsed, 0), 3);
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

function normalizeIsoDate(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  let match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s|T|$)/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return `${year}-${pad2(match[2])}-${pad2(match[1])}`;
  }

  match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s|T|$)/);
  if (match) return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;

  return null;
}

function normalizeSourceGeneratedAt(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

function addDaysToIsoDate(isoDate: string | null, days: number): string | null {
  if (!isoDate) return null;
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatRuDateFromIso(isoDate: string | null): string {
  if (!isoDate) return "дата не указана";
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : isoDate;
}

function normalizeIncomingBoxRow(raw: unknown): IncomingBoxRow | null {
  const row = asObject(raw);
  if (!row) return null;

  const box = normalizeText(row.box ?? row.box_id ?? row["Коробка"] ?? row["Номер тары"]);
  if (!box) return null;

  return {
    date: normalizeIsoDate(row.date ?? row["Дата"] ?? row.last_movement_date ?? row["Дата последнего движения"]),
    box,
    shk_qty: normalizeInteger(row.shk_qty ?? row.shkQty ?? row["Кол-во ШК"]),
    comment: normalizeText(row.comment ?? row["Комментарий"] ?? row["Комментарий входящего потока"]),
    analysis: normalizeText(row.analysis ?? row["Разбор"] ?? row["Старший входящего потока"]),
    analysis_status: normalizeText(row.analysis_status ?? row.analysisStatus ?? row["Ст разбора"] ?? row["Вердикт входящего потока"]),
    error: normalizeText(row.error ?? row["Ошибка"]),
    guilty_id: normalizeText(row.guilty_id ?? row.guiltyId ?? row["ID Виновного"]),
    source_sheet: normalizeText(row.source_sheet ?? row.sourceSheet),
    source_row_number: normalizeInteger(row.source_row_number ?? row.sourceRowNumber),
  };
}

function parseRowsFromPayload(payload: unknown): { rows: IncomingBoxRow[]; duplicates: number; skipped: number; sourceGeneratedAt: string | null } {
  const root = asObject(payload);
  const sourceRows = Array.isArray(root?.rows)
    ? root.rows
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(payload)
        ? payload
        : [];
  const sourceGeneratedAt = normalizeSourceGeneratedAt(root?.generated_at ?? root?.generatedAt);
  const deduplicated = new Map<string, IncomingBoxRow>();
  let duplicates = 0;
  let skipped = 0;

  sourceRows.forEach((rawRow) => {
    const normalized = normalizeIncomingBoxRow(rawRow);
    if (!normalized) {
      skipped += 1;
      return;
    }
    if (deduplicated.has(normalized.box)) duplicates += 1;
    deduplicated.set(normalized.box, normalized);
  });

  return { rows: Array.from(deduplicated.values()), duplicates, skipped, sourceGeneratedAt };
}

function buildApiUrl(body: JsonObject): string {
  const apiUrl = normalizeText(body.api_url) || DEFAULT_API_URL;
  if (!apiUrl) throw new Error("api_url is required in request body");

  const url = new URL(apiUrl);
  const spreadsheetId = normalizeText(body.spreadsheet_id) || DEFAULT_SPREADSHEET_ID;
  const sheetName = normalizeText(body.sheet_name) || DEFAULT_SHEET_NAME;
  const startRow = normalizeNumber(body.start_row ?? DEFAULT_START_ROW, DEFAULT_START_ROW);
  const sourceAction =
    normalizeText(body.apps_script_action ?? body.source_action) ||
    (["list_sheets", "sheets"].includes(normalizeText(body.action ?? body.mode)) ? "list_sheets" : "");

  if (spreadsheetId) url.searchParams.set("spreadsheet_id", spreadsheetId);
  if (sheetName) url.searchParams.set("sheet_name", sheetName);
  if (startRow > 1) url.searchParams.set("start_row", String(startRow));
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

function buildDescription(row: IncomingBoxRow): string {
  return [
    `Старший входящего потока: ${row.analysis || "-"}`,
    `Комментарий входящего потока: ${row.comment || "-"}`,
    `Вердикт входящего потока: ${row.analysis_status || "-"}`,
    `Кол-во ШК: ${row.shk_qty ?? "-"}`,
    `Ошибка: ${row.error || "-"}`,
    `ID виновного: ${row.guilty_id || "-"}`,
    `Источник: ${row.source_sheet || "-"}, строка ${row.source_row_number ?? "-"}`,
  ].join("\n");
}

function buildTaskPayload(row: IncomingBoxRow, body: JsonObject, sourceGeneratedAt: string | null): JsonObject {
  const sourceModule = normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE;
  const taskType = normalizeText(body.task_type) || DEFAULT_TASK_TYPE;
  const deadlineDays = normalizeNumber(body.deadline_days, DEFAULT_DEADLINE_DAYS);
  const dueDate = addDaysToIsoDate(row.date, deadlineDays);
  const title = `Коробка ${row.box}${row.date ? ` | ${formatRuDateFromIso(row.date)}` : ""}`;

  return {
    source_module: sourceModule,
    source_table: normalizeText(body.source_table) || DEFAULT_SOURCE_TABLE,
    source_id: row.box,
    source_row_id: row.source_row_number === null ? null : String(row.source_row_number),
    source_payload: row,
    source_generated_at: sourceGeneratedAt,
    task_type: taskType,
    title,
    description: buildDescription(row),
    priority: normalizePriority(body.priority),
    priority_label: null,
    due_date: dueDate,
    upload_type: sourceModule,
    upload_effective_date: row.date,
    search_text: [title, taskType, row.box, row.analysis, row.guilty_id].filter(Boolean).join(" "),
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
      duplicate_boxes_in_source: parsed.duplicates,
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
