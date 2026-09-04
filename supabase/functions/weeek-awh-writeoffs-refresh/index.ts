import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type AwhWriteoffRow = {
  status: string;
  lo: string;
  waybill: string;
  box: string;
  shk_qty: number | null;
  unload_time_lo: string | null;
  unload_time_lo_label: string;
  car_number: string;
  price: number | null;
  price_label: string;
  acceptance_time_lo: string | null;
  acceptance_time_lo_label: string;
  acceptance_employee_id: string;
  writeoff_reason: string;
  comment: string;
  material_link: string;
  revision_comment: string;
  source_sheet: string;
  source_row_number: number | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_SECRET = Deno.env.get("WEEEK_AWH_WRITEOFFS_REFRESH_SECRET") || Deno.env.get("WEEEK_INCOMING_BOXES_REFRESH_SECRET");

const DEFAULT_API_URL = "";
const DEFAULT_SPREADSHEET_ID = "1dLD7T-Nw3AlIwjaPCj9ukDc6NJvWEtPVht91Jm15Duk";
const DEFAULT_SHEET_PREFIX = "Списание";
const DEFAULT_LO_FILTER = "СЦ Нижний Новгород Ларина";
const DEFAULT_START_ROW = 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_ALLOW_EMPTY_SYNC = false;
const DEFAULT_SOURCE_MODULE = "awh_writeoffs";
const DEFAULT_SOURCE_TABLE = "google_sheets:awh_writeoffs";
const DEFAULT_TASK_TYPE = "Списания AWH";
const DEFAULT_DESCRIPTION_TASK_TYPE = "Списания на администрацию ЛО";
const DEFAULT_DEADLINE_DAYS = 7;
const DEFAULT_PRICE_DEADLINE_REDUCE_5000_DAYS = 2;
const DEFAULT_PRICE_DEADLINE_REDUCE_10000_DAYS = 4;
const DEFAULT_PRIORITY = 1;
const SYSTEM_FINAL_SOURCE_STATUSES = ["Аннулирован", "Списано на виновного", "Найден"];
const SYSTEM_FINAL_OPP_VERDICT = "Найден/Релиз/Списан";
const SYSTEM_CLOSED_TAG_NAME = "Закрыто системой";
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

function normalizeForMatch(value: unknown): string {
  return normalizeText(value)
    .replace(/ё/g, "е")
    .replace(/Ё/g, "Е")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isSystemFinalStatus(value: unknown): boolean {
  const normalized = normalizeForMatch(value);
  return SYSTEM_FINAL_SOURCE_STATUSES.some((status) => normalizeForMatch(status) === normalized);
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
  const normalized = raw.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  const parsed = new Date(normalized);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();

  const datePart = normalizeIsoDate(raw);
  return datePart ? `${datePart}T00:00:00.000Z` : null;
}

function normalizeSourceGeneratedAt(value: unknown): string | null {
  return normalizeIsoDateTime(value);
}

function currentMoscowIsoDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysToIsoDate(isoDate: string | null, days: number): string | null {
  if (!isoDate) return null;
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function deadlineReductionDaysByPrice(row: AwhWriteoffRow, body: JsonObject): number {
  const reduceOver5000 = normalizeNumber(body.price_deadline_reduce_5000_days, DEFAULT_PRICE_DEADLINE_REDUCE_5000_DAYS);
  const reduceOver10000 = normalizeNumber(body.price_deadline_reduce_10000_days, DEFAULT_PRICE_DEADLINE_REDUCE_10000_DAYS);
  const price = row.price;
  if (price === null || !Number.isFinite(price)) return 0;
  if (price > 10000) return reduceOver10000;
  if (price > 5000) return reduceOver5000;
  return 0;
}

function formatRuDateFromIso(isoDate: string | null): string {
  if (!isoDate) return "дата не указана";
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : isoDate;
}

function formatRuDateTime(value: unknown): string {
  const raw = normalizeText(value);
  const isoDate = normalizeIsoDate(raw);
  if (!isoDate) return raw || "-";

  const timeMatch = raw.match(/(?:\s|T)(\d{1,2}):(\d{2})/);
  const timePart = timeMatch ? ` ${pad2(timeMatch[1])}:${timeMatch[2]}` : "";
  return `${formatRuDateFromIso(isoDate)}${timePart}`;
}

function normalizeAwhRow(raw: unknown): AwhWriteoffRow | null {
  const row = asObject(raw);
  if (!row) return null;

  const box = normalizeText(row.box ?? row.box_id ?? row["Короб"] ?? row["Коробка"] ?? row["Номер тары"]);
  if (!box) return null;

  const unloadRaw = row.unload_time_lo ?? row.unloadTimeLo ?? row["Время выгрузки на ЛО"] ?? row.unload_time_lo_label;
  const priceRaw = row.price ?? row["Стоимость"] ?? row.price_label;

  return {
    status: normalizeText(row.status ?? row["Статус"]),
    lo: normalizeText(row.lo ?? row["ЛО"]),
    waybill: normalizeText(row.waybill ?? row["Путевой"] ?? row["Путевой лист"]),
    box,
    shk_qty: normalizeInteger(row.shk_qty ?? row.shkQty ?? row["Кол-во шк"] ?? row["Кол-во ШК"]),
    unload_time_lo: normalizeIsoDateTime(unloadRaw),
    unload_time_lo_label: normalizeText(row.unload_time_lo_label ?? row.unloadTimeLoLabel ?? row["Время выгрузки на ЛО"] ?? unloadRaw),
    car_number: normalizeText(row.car_number ?? row.carNumber ?? row["Номер Авто."] ?? row["Номер Авто"]),
    price: normalizeDecimal(priceRaw),
    price_label: normalizeText(row.price_label ?? row.priceLabel ?? row["Стоимость"] ?? priceRaw),
    acceptance_time_lo: normalizeIsoDateTime(row.acceptance_time_lo ?? row.acceptanceTimeLo ?? row["Время приемки на ЛО"] ?? row.acceptance_time_lo_label),
    acceptance_time_lo_label: normalizeText(row.acceptance_time_lo_label ?? row.acceptanceTimeLoLabel ?? row["Время приемки на ЛО"]),
    acceptance_employee_id: normalizeText(row.acceptance_employee_id ?? row.acceptanceEmployeeId ?? row["ID Сотрудника приемки"]),
    writeoff_reason: normalizeText(row.writeoff_reason ?? row.writeoffReason ?? row["Причина списания"]),
    comment: normalizeText(row.comment ?? row["Комментарий"]),
    material_link: normalizeText(row.material_link ?? row.materialLink ?? row["Ссылка на материал (видео и скрины)"] ?? row["Ссылка на материал"]),
    revision_comment: normalizeText(row.revision_comment ?? row.revisionComment ?? row["Комментарий ревизии"]),
    source_sheet: normalizeText(row.source_sheet ?? row.sourceSheet),
    source_row_number: normalizeInteger(row.source_row_number ?? row.sourceRowNumber),
  };
}

function parseRowsFromPayload(payload: unknown): { rows: AwhWriteoffRow[]; duplicates: number; skipped: number; sourceGeneratedAt: string | null } {
  const root = asObject(payload);
  const sourceRows = Array.isArray(root?.rows)
    ? root.rows
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(payload)
        ? payload
        : [];
  const sourceGeneratedAt = normalizeSourceGeneratedAt(root?.generated_at ?? root?.generatedAt);
  const deduplicated = new Map<string, AwhWriteoffRow>();
  let duplicates = 0;
  let skipped = 0;

  sourceRows.forEach((rawRow) => {
    const normalized = normalizeAwhRow(rawRow);
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
  const sheetPrefix = normalizeText(body.sheet_prefix) || DEFAULT_SHEET_PREFIX;
  const loFilter = normalizeText(body.lo ?? body.lo_filter) || DEFAULT_LO_FILTER;
  const startRow = normalizeNumber(body.start_row ?? DEFAULT_START_ROW, DEFAULT_START_ROW);
  const appsScriptSecret = normalizeText(body.apps_script_secret ?? body.source_secret) || normalizeText(Deno.env.get("AWH_WRITEOFFS_APPS_SCRIPT_SECRET"));
  const sourceAction =
    normalizeText(body.apps_script_action ?? body.source_action) ||
    (["list_sheets", "sheets"].includes(normalizeText(body.action ?? body.mode)) ? "list_sheets" : "");

  if (spreadsheetId) url.searchParams.set("spreadsheet_id", spreadsheetId);
  if (sheetPrefix) url.searchParams.set("sheet_prefix", sheetPrefix);
  if (loFilter) url.searchParams.set("lo", loFilter);
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

function buildDescription(row: AwhWriteoffRow): string {
  return [
    `Путевой лист: ${row.waybill || "-"}`,
    `Кол-во ШК: ${row.shk_qty ?? "-"}`,
    `Время выгрузки на ЛО: ${formatRuDateTime(row.unload_time_lo_label || row.unload_time_lo)}`,
  ].join("\n");
}

function buildTaskPayload(row: AwhWriteoffRow, body: JsonObject, sourceGeneratedAt: string | null): JsonObject {
  const sourceModule = normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE;
  const taskType = normalizeText(body.task_type) || DEFAULT_TASK_TYPE;
  const deadlineDays = normalizeNumber(body.deadline_days, DEFAULT_DEADLINE_DAYS);
  const deadlineReductionDays = deadlineReductionDaysByPrice(row, body);
  const taskDate = currentMoscowIsoDate();
  const dueDate = addDaysToIsoDate(taskDate, Math.max(deadlineDays - deadlineReductionDays, 0));
  const unloadDate = normalizeIsoDate(row.unload_time_lo_label || row.unload_time_lo);
  const descriptionTaskType = normalizeText(body.description_task_type) || DEFAULT_DESCRIPTION_TASK_TYPE;
  // Was routed through Weeek's own "task master" automation as
  // master_action "system_finalize" -- that queue is gone, and actually
  // auto-closing a task here (vs. just flagging it) is a separate decision
  // from "make the sync work at all" (see chat), so this stays informational
  // in source_payload only for now, same shape as before.
  const shouldSystemFinalize = isSystemFinalStatus(row.status);
  const title = `Коробка ${row.box}${unloadDate ? ` | ${formatRuDateFromIso(unloadDate)}` : ""}`;

  return {
    source_module: sourceModule,
    source_table: normalizeText(body.source_table) || DEFAULT_SOURCE_TABLE,
    source_id: row.box,
    source_row_id: row.source_row_number === null ? `${row.source_sheet || "-"}` : `${row.source_sheet || "-"}:${row.source_row_number}`,
    source_payload: {
      ...row,
      description_task_type: descriptionTaskType,
      system_auto_finalize: shouldSystemFinalize,
      system_auto_finalize_reason: shouldSystemFinalize ? `Статус источника: ${row.status}` : "",
      system_opp_verdict: shouldSystemFinalize ? SYSTEM_FINAL_OPP_VERDICT : "",
      system_tag_name: shouldSystemFinalize ? SYSTEM_CLOSED_TAG_NAME : "",
      deadline_days_base: deadlineDays,
      deadline_price_reduction_days: deadlineReductionDays,
    },
    source_generated_at: sourceGeneratedAt,
    task_type: taskType,
    title,
    description: buildDescription(row),
    priority: normalizePriority(body.priority, DEFAULT_PRIORITY),
    priority_label: null,
    due_date: dueDate,
    upload_type: sourceModule,
    upload_effective_date: unloadDate,
    search_text: [title, taskType, row.box, row.waybill, row.lo].filter(Boolean).join(" "),
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
