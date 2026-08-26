import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type Koledino27lrRow = {
  shk: string;
  tare: string;
  layout_block: string;
  price: number | null;
  price_label: string;
  layout_date: string | null;
  layout_date_label: string;
  writeoff_date: string | null;
  writeoff_date_label: string;
  attachment: string;
  movement_where: string;
  status: string;
  loss_reason: string;
  link: string;
  comment: string;
  source_sheet: string;
  source_row_number: number | null;
  spreadsheet_id: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_SECRET = Deno.env.get("WEEEK_KOLEDINO_27LR_REFRESH_SECRET") || Deno.env.get("WEEEK_INCOMING_FLOW_REQUESTS_REFRESH_SECRET") || Deno.env.get("WEEEK_INCOMING_BOXES_REFRESH_SECRET");

const DEFAULT_API_URL = "";
const DEFAULT_SPREADSHEET_ID = "1R49a_7kcsk8cjBfv6GenN5B3e92iTvjYDpUl5wzpimE";
const DEFAULT_SHEET_NAME = "Нижний Ларина";
const DEFAULT_START_ROW = 2;
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_ALLOW_EMPTY_SYNC = false;
const DEFAULT_SOURCE_MODULE = "koledino_27lr";
const DEFAULT_SOURCE_TABLE = "google_sheets:koledino_27lr";
const DEFAULT_TASK_TYPE = "Коледино + 27LR";
const DEFAULT_DESCRIPTION_TASK_TYPE = "Коледино + 27LR";
const DEFAULT_BOARD_KEY = "koledino_27lr";
const DEFAULT_COLUMN_KEY = "to_review";
const DEFAULT_TARGET_WORKSPACE_ID = "1021782";
const DEFAULT_TARGET_PROJECT_ID = "5";
const DEFAULT_TARGET_BOARD_ID = "10";
const DEFAULT_TARGET_BOARD_NAME = "Запросы входящего потока";
const DEFAULT_TARGET_COLUMN_NAME = "К разбору";
const DEFAULT_TASK_TYPE_FIELD_ID = "a25e22e9-f7fb-4640-963b-5ba1ad75cfe9";
const DEFAULT_TASK_TYPE_OPTION_ID = "";
const DEFAULT_REQUEST_TIME_FIELD_ID = "a26a135b-66af-4aa8-9e52-4e7b9d90d2eb";
const DEFAULT_PRICE_FIELD_ID = "a2624094-7335-45be-bcfd-9a2be15b368a";
const DEFAULT_DEADLINE_OFFSET_DAYS = -2;
const DEFAULT_PRIORITY = 1;
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

function normalizeDecimal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = normalizeText(value)
    .replace(/\u00A0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");
  if (!raw) return null;
  const parsed = Number(raw.replace(/\.(?=.*\.)/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
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

  const datePart = normalizeIsoDate(raw);
  return datePart ? `${datePart}T00:00:00.000Z` : null;
}

function normalizeSourceGeneratedAt(value: unknown): string | null {
  return normalizeIsoDateTime(value);
}

function addDaysToIsoDate(isoDate: string | null, days: number): string | null {
  if (!isoDate) return null;
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateToMoscowIsoDateTime(isoDate: string | null): string | null {
  return isoDate ? `${isoDate}T00:00:00+03:00` : null;
}

function formatRuDate(value: unknown): string {
  const iso = normalizeIsoDate(value);
  if (!iso) return normalizeText(value) || "-";
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

function normalizeKoledinoRow(raw: unknown): Koledino27lrRow | null {
  const row = asObject(raw);
  if (!row) return null;

  const shk = normalizeText(row.shk ?? row.requested_shk ?? row["ШК"]);
  if (!shk) return null;

  const priceRaw = row.price ?? row["Цена"] ?? row.price_label;
  const layoutDateRaw = row.layout_date ?? row.layoutDate ?? row["Дата  раскладки"] ?? row["Дата раскладки"] ?? row.layout_date_label;
  const writeoffDateRaw = row.writeoff_date ?? row.writeoffDate ?? row["Дата списания"] ?? row.writeoff_date_label;

  return {
    shk,
    tare: normalizeText(row.tare ?? row["Тара"]),
    layout_block: normalizeText(row.layout_block ?? row.layoutBlock ?? row["Блок раскладки"]),
    price: normalizeDecimal(priceRaw),
    price_label: normalizeText(row.price_label ?? row.priceLabel ?? row["Цена"] ?? priceRaw),
    layout_date: normalizeIsoDate(layoutDateRaw),
    layout_date_label: normalizeText(row.layout_date_label ?? row.layoutDateLabel ?? row["Дата  раскладки"] ?? row["Дата раскладки"] ?? layoutDateRaw),
    writeoff_date: normalizeIsoDate(writeoffDateRaw),
    writeoff_date_label: normalizeText(row.writeoff_date_label ?? row.writeoffDateLabel ?? row["Дата списания"] ?? writeoffDateRaw),
    attachment: normalizeText(row.attachment ?? row["Вложение"]),
    movement_where: normalizeText(row.movement_where ?? row.movementWhere ?? row["Где дано движение"]),
    status: normalizeText(row.status ?? row["Статус"]),
    loss_reason: normalizeText(row.loss_reason ?? row.lossReason ?? row["Причина потери"]),
    link: normalizeText(row.link ?? row["Ссылка"]),
    comment: normalizeText(row.comment ?? row["Комментарий"]),
    source_sheet: normalizeText(row.source_sheet ?? row.sourceSheet),
    source_row_number: normalizeInteger(row.source_row_number ?? row.sourceRowNumber),
    spreadsheet_id: normalizeText(row.spreadsheet_id ?? row.spreadsheetId),
  };
}

function parseRowsFromPayload(payload: unknown): { rows: Koledino27lrRow[]; duplicates: number; skipped: number; sourceGeneratedAt: string | null; duplicateRowsInSource: number } {
  const root = asObject(payload);
  const sourceRows = Array.isArray(root?.rows)
    ? root.rows
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(payload)
        ? payload
        : [];
  const sourceGeneratedAt = normalizeSourceGeneratedAt(root?.generated_at ?? root?.generatedAt);
  const deduplicated = new Map<string, Koledino27lrRow>();
  let duplicates = 0;
  let skipped = 0;

  sourceRows.forEach((rawRow) => {
    const normalized = normalizeKoledinoRow(rawRow);
    if (!normalized) {
      skipped += 1;
      return;
    }
    if (deduplicated.has(normalized.shk)) duplicates += 1;
    deduplicated.set(normalized.shk, normalized);
  });

  const duplicateRowsInSource = Array.isArray(root?.duplicate_rows) ? root.duplicate_rows.length : 0;
  return { rows: Array.from(deduplicated.values()), duplicates, skipped, sourceGeneratedAt, duplicateRowsInSource };
}

function buildApiUrl(body: JsonObject): string {
  const apiUrl = normalizeText(body.api_url) || normalizeText(Deno.env.get("KOLEDINO_27LR_APPS_SCRIPT_URL")) || DEFAULT_API_URL;
  if (!apiUrl) throw new Error("api_url or KOLEDINO_27LR_APPS_SCRIPT_URL is required");

  const url = new URL(apiUrl);
  const spreadsheetId = normalizeText(body.spreadsheet_id) || DEFAULT_SPREADSHEET_ID;
  const sheetName = normalizeText(body.sheet_name) || DEFAULT_SHEET_NAME;
  const startRow = normalizeNumber(body.start_row ?? DEFAULT_START_ROW, DEFAULT_START_ROW);
  const lookbackDays = normalizeNumber(body.lookback_days ?? DEFAULT_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS);
  const appsScriptSecret = normalizeText(body.apps_script_secret ?? body.source_secret) || normalizeText(Deno.env.get("KOLEDINO_27LR_APPS_SCRIPT_SECRET"));
  const sourceAction =
    normalizeText(body.apps_script_action ?? body.source_action) ||
    (["list_sheets", "sheets"].includes(normalizeText(body.action ?? body.mode)) ? "list_sheets" : "");

  if (spreadsheetId) url.searchParams.set("spreadsheet_id", spreadsheetId);
  if (sheetName) url.searchParams.set("sheet_name", sheetName);
  if (startRow > 1) url.searchParams.set("start_row", String(startRow));
  if (lookbackDays !== DEFAULT_LOOKBACK_DAYS) url.searchParams.set("lookback_days", String(lookbackDays));
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

function buildDescription(row: Koledino27lrRow): string {
  return [
    `Искомый ШК: ${row.shk || "-"}`,
    `Тара: ${row.tare || "-"}`,
    `Блок раскладки: ${row.layout_block || "-"}`,
  ].join("\n");
}

function buildTargetCustomFields(row: Koledino27lrRow, body: JsonObject): JsonObject {
  const customFields = { ...(asObject(body.target_custom_fields) ?? {}) };
  const taskTypeFieldId = normalizeText(body.task_type_field_id) || normalizeText(Deno.env.get("WEEEK_TASK_TYPE_FIELD_ID")) || DEFAULT_TASK_TYPE_FIELD_ID;
  const taskTypeOptionId = normalizeText(body.task_type_option_id) || normalizeText(Deno.env.get("WEEEK_KOLEDINO_27LR_TASK_TYPE_OPTION_ID")) || DEFAULT_TASK_TYPE_OPTION_ID;
  const requestTimeFieldId = normalizeText(body.request_time_field_id) || normalizeText(Deno.env.get("WEEEK_KOLEDINO_27LR_REQUEST_TIME_FIELD_ID")) || normalizeText(Deno.env.get("WEEEK_INCOMING_FLOW_REQUEST_TIME_FIELD_ID")) || DEFAULT_REQUEST_TIME_FIELD_ID;
  const priceFieldId = normalizeText(body.price_field_id) || normalizeText(body.cost_field_id) || normalizeText(Deno.env.get("WEEEK_KOLEDINO_27LR_PRICE_FIELD_ID")) || DEFAULT_PRICE_FIELD_ID;

  if (taskTypeFieldId && taskTypeOptionId && !Object.prototype.hasOwnProperty.call(customFields, taskTypeFieldId)) {
    customFields[taskTypeFieldId] = taskTypeOptionId;
  }

  if (requestTimeFieldId && row.layout_date && !Object.prototype.hasOwnProperty.call(customFields, requestTimeFieldId)) {
    customFields[requestTimeFieldId] = dateToMoscowIsoDateTime(row.layout_date);
  }

  if (priceFieldId && row.price !== null && !Object.prototype.hasOwnProperty.call(customFields, priceFieldId)) {
    customFields[priceFieldId] = row.price;
  }

  return customFields;
}

function buildTaskPayload(row: Koledino27lrRow, body: JsonObject, sourceGeneratedAt: string | null): JsonObject {
  const sourceModule = normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE;
  const taskType = normalizeText(body.task_type) || DEFAULT_TASK_TYPE;
  const boardKey = normalizeText(body.board_key) || DEFAULT_BOARD_KEY;
  const columnKey = normalizeText(body.column_key) || DEFAULT_COLUMN_KEY;
  const deadlineOffsetDays = Number(body.deadline_offset_days ?? DEFAULT_DEADLINE_OFFSET_DAYS);
  const dueDate = addDaysToIsoDate(row.writeoff_date, Number.isFinite(deadlineOffsetDays) ? Math.trunc(deadlineOffsetDays) : DEFAULT_DEADLINE_OFFSET_DAYS);
  const descriptionTaskType = normalizeText(body.description_task_type) || DEFAULT_DESCRIPTION_TASK_TYPE;
  const apiUrl = normalizeText(body.api_url) || normalizeText(Deno.env.get("KOLEDINO_27LR_APPS_SCRIPT_URL")) || DEFAULT_API_URL;
  const spreadsheetId = normalizeText(body.spreadsheet_id) || row.spreadsheet_id || DEFAULT_SPREADSHEET_ID;
  const sheetName = normalizeText(body.sheet_name) || row.source_sheet || DEFAULT_SHEET_NAME;

  return {
    source_module: sourceModule,
    source_table: normalizeText(body.source_table) || DEFAULT_SOURCE_TABLE,
    source_id: row.shk,
    source_row_id: row.source_row_number === null ? null : `${row.source_sheet || sheetName}:${row.source_row_number}`,
    source_payload: {
      ...row,
      description_task_type: descriptionTaskType,
      api_url: apiUrl,
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName,
      writeback_mode: "koledino_27lr",
      due_date_label: dueDate ? formatRuDate(dueDate) : "",
    },
    source_generated_at: sourceGeneratedAt,
    task_type: taskType,
    board_key: boardKey,
    column_key: columnKey,
    title: `Коледино + 27LR | ${row.shk}`,
    description: buildDescription(row),
    priority: normalizePriority(body.priority, DEFAULT_PRIORITY),
    due_date: dueDate,
    target_workspace_id: normalizeText(body.workspace_id) || normalizeText(body.target_workspace_id) || DEFAULT_TARGET_WORKSPACE_ID,
    target_project_id: normalizeText(body.project_id) || normalizeText(body.target_project_id) || normalizeText(Deno.env.get("WEEEK_KOLEDINO_27LR_PROJECT_ID")) || normalizeText(Deno.env.get("WEEEK_INCOMING_FLOW_PROJECT_ID")) || DEFAULT_TARGET_PROJECT_ID,
    target_board_id: normalizeText(body.board_id) || normalizeText(body.target_board_id) || normalizeText(Deno.env.get("WEEEK_KOLEDINO_27LR_BOARD_ID")) || DEFAULT_TARGET_BOARD_ID,
    target_board_name: normalizeText(body.board_name) || normalizeText(body.target_board_name) || DEFAULT_TARGET_BOARD_NAME,
    target_column_id: normalizeText(body.board_column_id) || normalizeText(body.target_column_id) || null,
    target_column_name: normalizeText(body.board_column_name) || normalizeText(body.target_column_name) || DEFAULT_TARGET_COLUMN_NAME,
    target_custom_fields: buildTargetCustomFields(row, body),
    target_tags: Array.isArray(body.target_tags) ? body.target_tags : [],
    enabled: true,
    master_action: "upsert",
  };
}

async function upsertTasks(tasks: JsonObject[]): Promise<number> {
  let upserted = 0;
  for (let offset = 0; offset < tasks.length; offset += RPC_BATCH_SIZE) {
    const batch = tasks.slice(offset, offset + RPC_BATCH_SIZE);
    const { data, error } = await supabase.rpc("upsert_weeek_tasks_from_json", { p_tasks: batch });
    if (error) throw new Error(`Failed to upsert rows into weeek_tasks: ${error.message}`);
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
      target_table: "weeek_tasks",
      source_module: normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE,
      request_timeout_ms: requestTimeoutMs,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      fetched_rows: parsed.rows.length,
      queued_rows: upsertedRows,
      duplicate_rows_in_payload: parsed.duplicates,
      duplicate_rows_in_source: parsed.duplicateRowsInSource,
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
