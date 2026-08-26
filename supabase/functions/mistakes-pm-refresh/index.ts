import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type MistakeRow = {
  emp: string;
  emp_workplace: string;
  mistake: string;
  date: string;
  shk: string;
  emp_logger: string;
  logger_comment: string;
  date_logged: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DEFAULT_API_URL = "";
const DEFAULT_SPREADSHEET_ID = "18Hx5321cI19kq6EFWraSsnUxqTOiUv-ESOn6bBcBWeo";
const DEFAULT_SHEET_NAME = "";
const TARGET_TABLE = "mistakes_rep";
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_START_ROW = 2;
const PM_EMP_WORKPLACE = "ПМ";
const PM_MISTAKE = "Бессистемная отгрузка передачи ПМ";
const PM_EMP_LOGGER = "2405";
const DEFAULT_ALLOW_EMPTY_SYNC = false;
const UPSERT_CONFLICT_COLUMNS = "emp,emp_workplace,mistake,date,shk,emp_logger,logger_comment,date_logged";
const SELECT_COLUMNS = "emp,emp_workplace,mistake,date,shk,emp_logger,logger_comment,date_logged";
const PAGE_SIZE = 1000;
const UPSERT_BATCH_SIZE = 500;

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
  if (["1", "true", "yes", "y"].includes(raw)) return true;
  if (["0", "false", "no", "n"].includes(raw)) return false;
  return fallbackValue;
}

function normalizeTimeoutMs(value: unknown, fallbackValue: number): number {
  return Math.max(normalizeNumber(value, fallbackValue), 10000);
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

function normalizeIsoDate(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  let match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s|T|$)/);
  if (match) {
    return `${match[3]}-${pad2(match[2])}-${pad2(match[1])}`;
  }

  match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s|T|$)/);
  if (match) {
    return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;
  }

  return "";
}

function buildLoggerComment(row: JsonObject): string {
  const direct = normalizeText(row.logger_comment);
  if (direct) return direct;

  const route = normalizeText(row.route ?? row.route_number ?? row.route_id);
  return route ? `Маршрут: ${route}` : "";
}

function buildRowKey(row: MistakeRow): string {
  return [
    row.emp,
    row.emp_workplace,
    row.mistake,
    row.date,
    row.shk,
    row.emp_logger,
    row.logger_comment,
    row.date_logged,
  ].join("\u0001");
}

function normalizeMistakeRow(raw: unknown): MistakeRow | null {
  const row = asObject(raw);
  if (!row) return null;

  const normalized: MistakeRow = {
    emp: normalizeText(row.emp),
    emp_workplace: normalizeText(row.emp_workplace) || PM_EMP_WORKPLACE,
    mistake: normalizeText(row.mistake) || PM_MISTAKE,
    date: normalizeIsoDate(row.date),
    shk: normalizeText(row.shk),
    emp_logger: normalizeText(row.emp_logger) || PM_EMP_LOGGER,
    logger_comment: buildLoggerComment(row),
    date_logged: normalizeIsoDate(row.date_logged),
  };

  if (
    !normalized.emp ||
    !normalized.emp_workplace ||
    !normalized.mistake ||
    !normalized.date ||
    !normalized.shk ||
    !normalized.emp_logger ||
    !normalized.logger_comment ||
    !normalized.date_logged
  ) {
    return null;
  }

  return normalized;
}

function parseRowsFromPayload(payload: unknown): MistakeRow[] {
  const root = asObject(payload);
  const sourceRows = Array.isArray(root?.rows)
    ? root?.rows
    : Array.isArray(root?.data)
      ? root?.data
      : Array.isArray(payload)
        ? payload
        : [];

  const deduplicated = new Map<string, MistakeRow>();

  sourceRows.forEach((rawRow) => {
    const normalized = normalizeMistakeRow(rawRow);
    if (!normalized) return;
    deduplicated.set(buildRowKey(normalized), normalized);
  });

  return Array.from(deduplicated.values());
}

function buildApiUrl(body: JsonObject): string {
  const apiUrl = normalizeText(body.api_url) || DEFAULT_API_URL;
  if (!apiUrl) {
    throw new Error("api_url is required in request body");
  }

  const url = new URL(apiUrl);
  const spreadsheetId = normalizeText(body.spreadsheet_id) || DEFAULT_SPREADSHEET_ID;
  const sheetName = normalizeText(body.sheet_name) || DEFAULT_SHEET_NAME;
  const startRow = normalizeNumber(body.start_row ?? DEFAULT_START_ROW, DEFAULT_START_ROW);

  if (spreadsheetId) url.searchParams.set("spreadsheet_id", spreadsheetId);
  if (sheetName) url.searchParams.set("sheet_name", sheetName);
  if (startRow > 1) url.searchParams.set("start_row", String(startRow));
  url.searchParams.set("_ts", String(Date.now()));

  return url.toString();
}

async function fetchPmPayload(body: JsonObject): Promise<JsonObject> {
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

  if (!payloadObject) {
    throw new Error("Apps Script API returned an unexpected payload");
  }

  return payloadObject;
}

async function upsertRows(rows: MistakeRow[]) {
  for (let offset = 0; offset < rows.length; offset += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from(TARGET_TABLE)
      .upsert(batch, { onConflict: UPSERT_CONFLICT_COLUMNS });

    if (error) {
      throw new Error(`Failed to upsert rows into ${TARGET_TABLE}: ${error.message}`);
    }
  }
}

async function fetchExistingPmRows(): Promise<MistakeRow[]> {
  const out: MistakeRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(TARGET_TABLE)
      .select(SELECT_COLUMNS)
      .eq("emp_workplace", PM_EMP_WORKPLACE)
      .eq("mistake", PM_MISTAKE)
      .eq("emp_logger", PM_EMP_LOGGER)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load existing PM rows: ${error.message}`);
    }

    const page = Array.isArray(data) ? data : [];
    page.forEach((row) => {
      const normalized = normalizeMistakeRow(row);
      if (normalized) out.push(normalized);
    });

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return out;
}

async function deleteRows(rows: MistakeRow[]): Promise<number> {
  let deletedCount = 0;

  for (const row of rows) {
    const { error, count } = await supabase
      .from(TARGET_TABLE)
      .delete({ count: "exact" })
      .match(row);

    if (error) {
      throw new Error(`Failed to delete stale PM row: ${error.message}`);
    }

    deletedCount += Number(count ?? 0);
  }

  return deletedCount;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed. Use POST." });
  }

  let body: JsonObject = {};
  try {
    const raw = await req.json().catch(() => ({}));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      body = raw as JsonObject;
    }
  } catch {
    body = {};
  }

  const dryRun = normalizeBoolean(body.dry_run, false);
  const pruneStale = normalizeBoolean(body.prune_stale, true);
  const allowEmptySync = normalizeBoolean(body.allow_empty_sync, DEFAULT_ALLOW_EMPTY_SYNC);
  const requestTimeoutMs = normalizeTimeoutMs(body.request_timeout_ms, DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const startedAt = new Date().toISOString();
    const payload = await fetchPmPayload(body);
    const rows = parseRowsFromPayload(payload);

    if (!rows.length && !allowEmptySync) {
      throw new Error("Apps Script returned 0 rows. Refusing to sync empty dataset without allow_empty_sync=true.");
    }

    if (!dryRun && rows.length) {
      await upsertRows(rows);
    }

    let deletedCount = 0;
    if (!dryRun && pruneStale) {
      const existingRows = await fetchExistingPmRows();
      const incomingKeys = new Set(rows.map((row) => buildRowKey(row)));
      const staleRows = existingRows.filter((row) => !incomingKeys.has(buildRowKey(row)));
      if (staleRows.length) {
        deletedCount = await deleteRows(staleRows);
      }
    }

    return json(200, {
      ok: true,
      dry_run: dryRun,
      prune_stale: pruneStale,
      allow_empty_sync: allowEmptySync,
      target_table: TARGET_TABLE,
      request_timeout_ms: requestTimeoutMs,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      fetched_rows: rows.length,
      upserted_rows: dryRun ? 0 : rows.length,
      deleted_stale_rows: deletedCount,
      source_generated_at: normalizeText(payload.generated_at) || null,
      skipped_rows: Array.isArray(payload.skipped_rows) ? payload.skipped_rows.length : 0,
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: String(err instanceof Error ? err.message : err),
    });
  }
});
