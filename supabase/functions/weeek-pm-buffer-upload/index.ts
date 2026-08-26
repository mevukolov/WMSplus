import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type PrimaryRow = {
  row_number: number | null;
  corrugated: string;
  transfer: string;
  product: string;
  product_status: string;
  name: string;
  brand: string;
  supplier: string;
  price: number | null;
  mx: string;
  previous_mx: string;
  created_at_raw: string;
  created_at_iso: string | null;
  created_at_date: string | null;
  created_at_label: string;
  previous_mx_date: string;
  responsible: string;
  responsible_id: string;
  shipment_block: string;
};

type CarrierRow = {
  row_number: number | null;
  transfer: string;
  office: string;
  time: string;
  mx: string;
  employee: string;
  carrier: string;
};

type AfterSaleMovementRow = {
  row_number: number | null;
  office: string;
  block: string;
  product: string;
  realized_at_raw: string;
  realized_at_iso: string | null;
  realized_at_date: string | null;
  realized_at_label: string;
  status_id: string;
  status: string;
  status_at_raw: string;
  status_at_iso: string | null;
  status_at_date: string | null;
  status_at_label: string;
  mx: string;
  tare: string;
  employee_id: string;
  employee: string;
};

type PmTask = {
  source_module: string;
  source_table: string;
  source_id: string;
  source_row_id: string | null;
  source_payload: JsonObject;
  source_generated_at: string;
  source_shk_ids: string[];
  source_tare_id: string | null;
  source_price_sum: number | null;
  source_last_movement_at: string | null;
  search_text: string;
  task_type: string;
  board_key: string;
  column_key: string;
  title: string;
  description: string;
  priority: number | null;
  due_date: string | null;
  responsibility_zone: string;
  target_workspace_id: string;
  target_project_id: string;
  target_board_id: string | null;
  target_board_name: string;
  target_column_id: string | null;
  target_column_name: string;
  target_assignee_ids?: string[];
  target_custom_fields: JsonObject;
  target_tags: unknown[];
  enabled: boolean;
  master_action: string;
};

type SpecialShkInfo = {
  matched_shk: string;
  tag_name: string;
  eventtype: string;
  shk1: string;
  shk2: string;
  second_shk: string;
  media: string;
  wh_id: string;
  created_at: string;
  raw: JsonObject;
};

type BuildResult = {
  primary_rows: unknown[];
  carrier_rows: CarrierRow[];
  copied_transfer_ids: string[];
  excluded_transfers: string[];
  tasks: PmTask[];
  skipped: JsonObject[];
  summary: JsonObject;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_SECRET = Deno.env.get("WEEEK_PM_BUFFER_UPLOAD_SECRET") || Deno.env.get("WEEEK_BASIC_PACKAGING_UPLOAD_SECRET") || Deno.env.get("WEEEK_UPLOAD_SECRET") || Deno.env.get("WEEEK_TASK_MASTER_SECRET");

const DEFAULT_SOURCE_MODULE = "manual_pm_buffer";
const DEFAULT_SOURCE_TABLE = "xlsx:manual_pm_buffer";
const DEFAULT_PM_TASK_TYPE = "Разбор ОПП // ПМ";
const DEFAULT_MAIL_TASK_TYPE = "Разбор ОПП // Почта";
const DEFAULT_PRESORT_TASK_TYPE = "Разбор ОПП // Предсортировка";
const DEFAULT_LABELING_TASK_TYPE = "Разбор ОПП // Оклейка";
const DEFAULT_MARKETPLACE_TASK_TYPE = "Разбор ОПП // Маркетплейс";
const DEFAULT_PC_TASK_TYPE = "Разбор ОПП // ПЦ";
const DEFAULT_WMI_MP_PC_TASK_TYPE = "Разбор ОПП // WMI (МП + ПЦ)";
const DEFAULT_NO_ORDER_TASK_TYPE = "Разбор ОПП // Без заказа";
const DEFAULT_USD_TASK_TYPE = "Разбор ОПП // USD";
const DEFAULT_TMM_TASK_TYPE = "Разбор ОПП // TMM";
const DEFAULT_AFTER_SALE_MOVEMENT_TASK_TYPE = "Разбор ОПП // Движение после продажи";
const DEFAULT_PM_ROUTE_KEY = "manual_pm_buffer_pm";
const DEFAULT_MAIL_ROUTE_KEY = "manual_pm_buffer_mail";
const DEFAULT_PRESORT_ROUTE_KEY = "manual_presort_opp";
const DEFAULT_LABELING_ROUTE_KEY = "manual_labeling_opp";
const DEFAULT_MARKETPLACE_ROUTE_KEY = "manual_marketplace_opp";
const DEFAULT_PC_ROUTE_KEY = "manual_pc_opp";
const DEFAULT_WMI_MP_PC_ROUTE_KEY = "manual_wmi_mp_pc";
const DEFAULT_NO_ORDER_ROUTE_KEY = "manual_no_order_opp";
const DEFAULT_USD_ROUTE_KEY = "manual_usd_opp";
const DEFAULT_TMM_ROUTE_KEY = "manual_tmm_opp";
const DEFAULT_AFTER_SALE_MOVEMENT_ROUTE_KEY = "manual_after_sale_movement_opp";
const DEFAULT_TARGET_WORKSPACE_ID = "1021782";
const DEFAULT_TARGET_PROJECT_ID = "2";
const DEFAULT_TARGET_BOARD_NAME = "❗️ Активные задачи";
const DEFAULT_WH_ID = "50144199";
const SHIFTS_TABLE = "weeek_shifts";
const EMPLOYEES_TABLE = "weeek_employees";
const DEFAULT_PM_COLUMN_NAME = "ПМ";
const DEFAULT_MAIL_COLUMN_NAME = "Почта";
const DEFAULT_PRESORT_COLUMN_NAME = "Предсортировка";
const DEFAULT_LABELING_COLUMN_NAME = "Другие задачи";
const DEFAULT_MARKETPLACE_COLUMN_NAME = "Маркетплейс";
const DEFAULT_PC_COLUMN_NAME = "ПЦ";
const DEFAULT_WMI_MP_PC_COLUMN_NAME = "WMI (МП + ПЦ)";
const DEFAULT_NO_ORDER_COLUMN_NAME = "Без заказа";
const DEFAULT_HIDDEN_NO_ORDER_COLUMN_NAME = "Другие задачи";
const DEFAULT_AFTER_SALE_MOVEMENT_COLUMN_NAME = "Движение после продажи";
const DEFAULT_PRIORITY = 0;
const DEFAULT_MIN_PRICE = 2000;
const DEFAULT_PM_DEADLINE_DAYS = 2;
const DEFAULT_MAIL_DEADLINE_DAYS = 3;
const DEFAULT_PRESORT_DEADLINE_DAYS = 2;
const DEFAULT_LABELING_DEADLINE_DAYS = 2;
const DEFAULT_MARKETPLACE_DEADLINE_DAYS = 2;
const DEFAULT_PC_DEADLINE_DAYS = 2;
const DEFAULT_WMI_MP_PC_DEADLINE_DAYS = 2;
const DEFAULT_NO_ORDER_DEADLINE_DAYS = 2;
const DEFAULT_AFTER_SALE_MOVEMENT_DEADLINE_DAYS = 2;
const DEFAULT_TASK_TYPE_FIELD_ID = "a25e22e9-f7fb-4640-963b-5ba1ad75cfe9";
const DEFAULT_PRICE_FIELD_ID = "a2624094-7335-45be-bcfd-9a2be15b368a";
const DEFAULT_PRESORT_TASK_TYPE_OPTION_ID = "a2805e55-a51a-4bad-ac3e-98f6d411874f";
const DEFAULT_WMI_MP_PC_TASK_TYPE_OPTION_ID = "a285bada-9b14-49b8-a1c2-cb6b344b6bec";
const DEFAULT_NO_ORDER_TASK_TYPE_OPTION_ID = "a285bbb5-901a-4a4e-912e-82bc6385284d";
const DEFAULT_USD_TASK_TYPE_OPTION_ID = "";
const DEFAULT_TMM_TASK_TYPE_OPTION_ID = "";
const DEFAULT_AFTER_SALE_MOVEMENT_TASK_TYPE_OPTION_ID = "a285cb92-1279-45e1-88a5-972c40bd76e7";
const DEFAULT_MAIL_TAG_NAME = "почта";
const DEFAULT_IDENTIFICATION_TAG_NAME = "Идентификация из ОПП";
const TWO_SHK_TAG_NAME = "Два ШК";
const EMPTY_PACKAGE_TAG_NAME = "Пустая упаковка";
const DEFAULT_TITLE_MAX_LENGTH = 180;
const RPC_BATCH_SIZE = 250;
const SOURCE_PAYLOAD_ROWS_SAMPLE_LIMIT = 25;
const DESCRIPTION_ROWS_LIMIT = 60;
const SEARCH_TEXT_IDS_LIMIT = 80;
const SOURCE_ROW_ID_LIMIT = 80;
const UPLOAD_RUNS_TABLE = "weeek_manual_upload_runs";
const TWO_SHK_TABLE = "2shk_rep";
const DEFAULT_UPLOAD_TYPE = "pm_buffer";
const PM_BUFFER_STATUSES = new Set(["sms", "swt"]);
const PRESORT_STATUSES = new Set(["sps", "pwt", "gws", "wmi"]);
const LABELING_STATUS = "lgr";
const NO_ORDER_HIDDEN_USD_STATUS = "usd";
const NO_ORDER_HIDDEN_TMM_STATUS = "tmm";
const PRESORT_EXCLUDED_MX_PARTS = ["пред сортировка мп", "сортировка в сетки"];
const MAIL_ROUTES = new Set([
  101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115,
  201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215,
  301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315,
  401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415,
]);

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

function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch (_error) {
    return 0;
  }
}

function numberStats(values: number[]): JsonObject {
  const normalized = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!normalized.length) return { count: 0, min: 0, avg: 0, p95: 0, max: 0 };
  const sum = normalized.reduce((acc, value) => acc + value, 0);
  const p95Index = Math.min(Math.ceil(normalized.length * 0.95) - 1, normalized.length - 1);
  return {
    count: normalized.length,
    min: normalized[0],
    avg: Math.round((sum / normalized.length) * 10) / 10,
    p95: normalized[p95Index],
    max: normalized[normalized.length - 1],
  };
}

function taskDebugStats(tasks: PmTask[]): JsonObject {
  return {
    tasks_count: tasks.length,
    task_json_bytes: numberStats(tasks.map((task) => jsonByteLength(task))),
    description_chars: numberStats(tasks.map((task) => normalizeText(task.description).length)),
    search_text_chars: numberStats(tasks.map((task) => normalizeText(task.search_text).length)),
    source_shk_ids_count: numberStats(tasks.map((task) => task.source_shk_ids.length)),
  };
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
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

function isWmsOnlyUpload(body: JsonObject): boolean {
  const targetSystem = normalizeText(body.target_system || body.targetSystem).toLowerCase();
  return targetSystem === "wms"
    || normalizeBoolean(body.wms_only, false)
    || normalizeBoolean(body.supabase_only, false)
    || normalizeBoolean(body.create_weeek_tasks, true) === false;
}

function taskEnabledForUpload(body: JsonObject): boolean {
  return !isWmsOnlyUpload(body);
}

function masterActionForUpload(body: JsonObject): string {
  return isWmsOnlyUpload(body) ? "wms_only" : "upsert";
}

function normalizeInteger(value: unknown, fallbackValue: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.trunc(parsed);
}

function normalizeNumber(value: unknown, fallbackValue: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return parsed;
}

function normalizePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = normalizeText(value)
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");
  if (!raw) return null;
  const parsed = Number(raw.replace(/\.(?=.*\.)/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIdentifier(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toFixed(0);
  const raw = normalizeText(value).replace(/\u00a0/g, "").replace(/\s+/g, "");
  if (!raw) return "";
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(raw)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.trunc(parsed).toFixed(0);
  }
  if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, "");
  return raw;
}

function isGroupableIdentifier(value: unknown): boolean {
  const normalized = normalizeIdentifier(value);
  return Boolean(normalized) && normalized !== "0";
}

function normalizeForMatch(value: unknown): string {
  return normalizeText(value)
    .replace(/ё/g, "е")
    .replace(/Ё/g, "Е")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function truncateText(value: unknown, maxLength = DEFAULT_TITLE_MAX_LENGTH): string {
  const text = normalizeText(value);
  const chars = Array.from(text);
  return chars.length <= maxLength ? text : chars.slice(0, maxLength).join("");
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

function excelSerialToDate(value: number): Date | null {
  if (!Number.isFinite(value)) return null;
  const ms = Math.round((value - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseDateTime(value: unknown): { iso: string | null; isoDate: string | null; label: string; ts: number } {
  if (value instanceof Date && Number.isFinite(value.getTime())) return dateParts(value, value.toISOString());
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = excelSerialToDate(value);
    if (date) return dateParts(date, String(value));
  }

  const raw = normalizeText(value);
  if (!raw) return { iso: null, isoDate: null, label: "", ts: 0 };

  let match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?/);
  if (match) {
    const ms = Number(`${match[7] || "0"}`.slice(0, 3).padEnd(3, "0"));
    return dateParts(new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
      ms,
    )), raw);
  }

  match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return dateParts(new Date(Date.UTC(
      year,
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
    )), raw);
  }

  const parsed = new Date(raw.replace(" ", "T"));
  if (Number.isFinite(parsed.getTime())) return dateParts(parsed, raw);
  return { iso: null, isoDate: null, label: raw, ts: 0 };
}

function dateParts(date: Date, fallbackLabel: string): { iso: string | null; isoDate: string | null; label: string; ts: number } {
  if (!Number.isFinite(date.getTime())) return { iso: null, isoDate: null, label: fallbackLabel, ts: 0 };
  const iso = date.toISOString();
  return {
    iso,
    isoDate: iso.slice(0, 10),
    label: `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`,
    ts: date.getTime(),
  };
}

function addDaysToIsoDate(isoDate: string | null, days: number): string | null {
  if (!isoDate) return null;
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function currentMoscowIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+03:00`;
}

function currentMoscowDate(): string {
  return currentMoscowIso().slice(0, 10);
}

function normalizedResponsibilityZone(value: unknown): string {
  const raw = normalizeText(value);
  if (raw === "Входящий поток" || raw === "Исходящий поток" || raw === "Нет привязки") return raw;
  const normalized = normalizeForMatch(raw);
  if (normalized.includes("вход")) return "Входящий поток";
  if (normalized.includes("исход")) return "Исходящий поток";
  return "Нет привязки";
}

function normalizeIsoDateValue(value: unknown): string {
  const raw = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

type ShiftAssigneeContext = {
  wh_id: string;
  shift_date: string;
  shift_label: string;
  shift_found: boolean;
  incoming_employee: string | null;
  outgoing_employee: string | null;
  incoming_weeek_user_id: string | null;
  outgoing_weeek_user_id: string | null;
};

async function resolveShiftAssignees(body: JsonObject): Promise<ShiftAssigneeContext> {
  const whId = normalizeText(body.wh_id) || DEFAULT_WH_ID;
  const shiftDate = normalizeIsoDateValue(body.assignment_shift_date ?? body.upload_date) || currentMoscowDate();
  const fallback: ShiftAssigneeContext = {
    wh_id: whId,
    shift_date: shiftDate,
    shift_label: shiftDate,
    shift_found: false,
    incoming_employee: null,
    outgoing_employee: null,
    incoming_weeek_user_id: null,
    outgoing_weeek_user_id: null,
  };

  const { data: shift, error: shiftError } = await supabase
    .from(SHIFTS_TABLE)
    .select("shift_date,shift_label,incoming_employee_id,outgoing_employee_id")
    .eq("wh_id", whId)
    .eq("shift_date", shiftDate)
    .maybeSingle();

  if (shiftError) throw new Error(`Failed to read shift assignees: ${shiftError.message}`);
  const shiftRow = asObject(shift);
  if (!shiftRow) return fallback;

  const incomingEmployeeId = normalizeText(shiftRow.incoming_employee_id);
  const outgoingEmployeeId = normalizeText(shiftRow.outgoing_employee_id);
  const employeeIds = Array.from(new Set([incomingEmployeeId, outgoingEmployeeId].filter(Boolean)));
  const employees = new Map<string, JsonObject>();

  if (employeeIds.length) {
    const { data, error } = await supabase
      .from(EMPLOYEES_TABLE)
      .select("id,full_name,weeek_user_id")
      .in("id", employeeIds);
    if (error) throw new Error(`Failed to read shift employees: ${error.message}`);
    for (const employee of (data ?? []) as JsonObject[]) {
      employees.set(normalizeText(employee.id), employee);
    }
  }

  const incoming = employees.get(incomingEmployeeId) ?? null;
  const outgoing = employees.get(outgoingEmployeeId) ?? null;
  return {
    wh_id: whId,
    shift_date: shiftDate,
    shift_label: normalizeText(shiftRow.shift_label) || shiftDate,
    shift_found: true,
    incoming_employee: normalizeText(incoming?.full_name) || null,
    outgoing_employee: normalizeText(outgoing?.full_name) || null,
    incoming_weeek_user_id: normalizeText(incoming?.weeek_user_id) || null,
    outgoing_weeek_user_id: normalizeText(outgoing?.weeek_user_id) || null,
  };
}

function targetAssigneeIdsForZone(zone: unknown, shift: ShiftAssigneeContext | null): string[] {
  if (!shift || !shift.shift_found) return [];
  const normalized = normalizedResponsibilityZone(zone);
  const id = normalized === "Входящий поток"
    ? shift.incoming_weeek_user_id
    : normalized === "Исходящий поток"
      ? shift.outgoing_weeek_user_id
      : null;
  return id ? [id] : [];
}

function applyImmediateAssignees(tasks: PmTask[], shift: ShiftAssigneeContext | null): number {
  let assigned = 0;
  for (const task of tasks) {
    const ids = targetAssigneeIdsForZone(task.responsibility_zone, shift);
    task.target_assignee_ids = ids;
    if (ids.length) assigned += 1;
  }
  return assigned;
}

function priceBasedPriority(price: number | null | undefined, forceHigh = false): number | null {
  if (forceHigh) return 2;
  const value = Number(price ?? 0);
  if (!Number.isFinite(value) || value < 500) return null;
  if (value < 1000) return 3;
  if (value < 5000) return 0;
  if (value < 10000) return 1;
  return 2;
}

function plannedTaskDueDate(body: JsonObject, plannedField = "planned_upload_date"): string | null {
  const planned = normalizeText(body[plannedField]);
  if (planned) return addDaysToIsoDate(planned, 1);

  const businessDate = normalizeText(body.business_date || body.effective_date || body.row_date);
  const offsetDays = normalizeInteger(body.upload_offset_days, 0);
  if (businessDate) return addDaysToIsoDate(addDaysToIsoDate(businessDate, -offsetDays), 1);

  return addDaysToIsoDate(currentMoscowDate(), 1);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function specialTagName(eventType: unknown): string {
  const normalized = normalizeForMatch(eventType);
  const compact = normalized.replace(/\s+/g, "");
  if (normalized.includes("пуст")) return EMPTY_PACKAGE_TAG_NAME;
  if (normalized.includes("два") || compact.includes("2шк") || normalized === "2") return TWO_SHK_TAG_NAME;
  return "";
}

function specialInfoFromRow(row: JsonObject, matchedShk: string): SpecialShkInfo | null {
  const tagName = specialTagName(row.eventtype);
  if (!tagName) return null;
  const shk1 = normalizeIdentifier(row.shk1);
  const shk2 = normalizeIdentifier(row.shk2);
  const secondShk = matchedShk === shk1 ? shk2 : matchedShk === shk2 ? shk1 : (shk2 || shk1);
  return {
    matched_shk: matchedShk,
    tag_name: tagName,
    eventtype: normalizeText(row.eventtype) || tagName,
    shk1,
    shk2,
    second_shk: secondShk,
    media: normalizeText(row.media),
    wh_id: normalizeText(row.wh_id),
    created_at: normalizeText(row.created_at),
    raw: row,
  };
}

function upsertSpecialInfo(map: Map<string, SpecialShkInfo>, row: JsonObject, productIds: Set<string>) {
  const candidates = [normalizeIdentifier(row.shk1), normalizeIdentifier(row.shk2)].filter(Boolean);
  for (const candidate of candidates) {
    if (!productIds.has(candidate) || map.has(candidate)) continue;
    const info = specialInfoFromRow(row, candidate);
    if (info) map.set(candidate, info);
  }
}

async function loadSpecialShkMap(productIdsRaw: string[], body: JsonObject): Promise<Map<string, SpecialShkInfo>> {
  const productIds = Array.from(new Set(productIdsRaw.map(normalizeIdentifier).filter(Boolean)));
  const productSet = new Set(productIds);
  const result = new Map<string, SpecialShkInfo>();
  if (!productIds.length) return result;

  const whId = normalizeText(body.wh_id) || DEFAULT_WH_ID;
  for (const chunk of chunkArray(productIds, 100)) {
    const applyRows = (rows: JsonObject[] | null) => {
      for (const row of rows ?? []) upsertSpecialInfo(result, row, productSet);
    };

    let shk1Query = supabase
      .from(TWO_SHK_TABLE)
      .select("shk1,shk2,eventtype,media,wh_id,created_at")
      .in("shk1", chunk)
      .order("created_at", { ascending: false });
    if (whId) shk1Query = shk1Query.eq("wh_id", whId);
    const shk1 = await shk1Query;
    if (shk1.error) throw new Error(`Failed to read ${TWO_SHK_TABLE} by shk1: ${shk1.error.message}`);
    applyRows((shk1.data ?? []) as JsonObject[]);

    let shk2Query = supabase
      .from(TWO_SHK_TABLE)
      .select("shk1,shk2,eventtype,media,wh_id,created_at")
      .in("shk2", chunk)
      .order("created_at", { ascending: false });
    if (whId) shk2Query = shk2Query.eq("wh_id", whId);
    const shk2 = await shk2Query;
    if (shk2.error) throw new Error(`Failed to read ${TWO_SHK_TABLE} by shk2: ${shk2.error.message}`);
    applyRows((shk2.data ?? []) as JsonObject[]);
  }
  return result;
}

function specialInfoForRows(rows: PrimaryRow[], specialMap?: Map<string, SpecialShkInfo>): SpecialShkInfo[] {
  if (!specialMap || !specialMap.size) return [];
  const result: SpecialShkInfo[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const info = specialMap.get(row.product);
    if (!info) continue;
    const key = `${info.tag_name}|${info.matched_shk}|${info.second_shk}|${info.media}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(info);
  }
  return result;
}

function specialInfoForProducts(productIds: string[], specialMap?: Map<string, SpecialShkInfo>): SpecialShkInfo[] {
  if (!specialMap || !specialMap.size) return [];
  const result: SpecialShkInfo[] = [];
  const seen = new Set<string>();
  for (const productId of productIds.map(normalizeIdentifier).filter(Boolean)) {
    const info = specialMap.get(productId);
    if (!info) continue;
    const key = `${info.tag_name}|${info.matched_shk}|${info.second_shk}|${info.media}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(info);
  }
  return result;
}

function specialPrefixLines(infos: SpecialShkInfo[]): string[] {
  const lines: string[] = [];
  for (const info of infos) {
    lines.push(info.tag_name);
    lines.push(`ШК: ${info.matched_shk || "-"}`);
    lines.push(`Второй ШК: ${info.second_shk || "-"}`);
    if (info.media) lines.push(`Ссылка: ${info.media}`);
    lines.push("");
  }
  return lines;
}

function withSpecialDescription(description: string, infos: SpecialShkInfo[]): string {
  if (!infos.length) return description;
  return [...specialPrefixLines(infos), description].join("\n");
}

function mergeTargetTags(baseTags: unknown[] | undefined, infos: SpecialShkInfo[]): unknown[] {
  const result = Array.isArray(baseTags) ? [...baseTags] : [];
  const existing = new Set(result.map((tag) => {
    const obj = asObject(tag);
    return normalizeForMatch(obj ? obj.name : tag);
  }).filter(Boolean));
  for (const info of infos) {
    const key = normalizeForMatch(info.tag_name);
    if (!key || existing.has(key)) continue;
    result.push({ name: info.tag_name });
    existing.add(key);
  }
  return result;
}

function splitSpecialRows(rows: PrimaryRow[], specialMap?: Map<string, SpecialShkInfo>): { regularRows: PrimaryRow[]; specialRows: PrimaryRow[] } {
  if (!specialMap || !specialMap.size) return { regularRows: rows, specialRows: [] };
  const regularRows: PrimaryRow[] = [];
  const specialRows: PrimaryRow[] = [];
  for (const row of rows) {
    if (specialMap.has(row.product)) specialRows.push(row);
    else regularRows.push(row);
  }
  return { regularRows, specialRows };
}

function pick(row: JsonObject, names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  }
  const normalizedEntries = Object.entries(row).map(([key, value]) => [key.replace(/\s+/g, " ").trim().toLowerCase(), value] as const);
  for (const name of names) {
    const expected = name.replace(/\s+/g, " ").trim().toLowerCase();
    const found = normalizedEntries.find(([key]) => key === expected || key.includes(expected) || expected.includes(key));
    if (found) return found[1];
  }
  return undefined;
}

function normalizePrimaryRow(raw: JsonObject): PrimaryRow | null {
  const transfer = normalizeIdentifier(raw.transfer);
  const product = normalizeIdentifier(raw.product);
  if (!transfer || !product) return null;
  const createdAt = parseDateTime(raw.created_at);
  const rowNumberRaw = normalizeText(raw.row_number);
  const rowNumber = rowNumberRaw ? Number(rowNumberRaw) : null;
  return {
    row_number: Number.isFinite(rowNumber) ? Math.trunc(Number(rowNumber)) : null,
    corrugated: normalizeIdentifier(raw.corrugated),
    transfer,
    product,
    product_status: normalizeText(raw.product_status),
    name: normalizeText(raw.name),
    brand: normalizeText(raw.brand),
    supplier: normalizeText(raw.supplier),
    price: normalizePrice(raw.price),
    mx: normalizeText(raw.mx),
    previous_mx: normalizeText(raw.previous_mx),
    created_at_raw: normalizeText(raw.created_at),
    created_at_iso: createdAt.iso,
    created_at_date: createdAt.isoDate,
    created_at_label: createdAt.label,
    previous_mx_date: normalizeText(raw.previous_mx_date),
    responsible: normalizeText(raw.responsible),
    responsible_id: normalizeIdentifier(raw.responsible_id),
    shipment_block: normalizeText(raw.shipment_block),
  };
}

function primaryFromArray(row: unknown[], rowNumber: number): PrimaryRow | null {
  return normalizePrimaryRow({
    row_number: rowNumber,
    corrugated: row[0],
    transfer: row[1],
    product: row[2],
    product_status: row[3],
    name: row[4],
    brand: row[5],
    supplier: row[6],
    price: row[7],
    mx: row[8],
    previous_mx: row[9],
    created_at: row[10],
    previous_mx_date: row[11],
    responsible: row[12],
    responsible_id: row[13],
    shipment_block: row[14],
  });
}

function primaryFromObject(row: JsonObject, rowNumber: number): PrimaryRow | null {
  return normalizePrimaryRow({
    row_number: pick(row, ["row_number", "source_row_number"]) ?? rowNumber,
    corrugated: pick(row, ["corrugated", "Гофра"]),
    transfer: pick(row, ["transfer", "Передача", "Тара"]),
    product: pick(row, ["product", "Товар", "ID товара", "ШК"]),
    product_status: pick(row, ["product_status", "Статус товара"]),
    name: pick(row, ["name", "Наименование"]),
    brand: pick(row, ["brand", "Бренд"]),
    supplier: pick(row, ["supplier", "Поставщик"]),
    price: pick(row, ["price", "Стоимость", "Цена"]),
    mx: pick(row, ["mx", "MX", "МХ"]),
    previous_mx: pick(row, ["previous_mx", "Предыдущее MX", "Предыдущее МХ"]),
    created_at: pick(row, ["created_at", "Дата создания"]),
    previous_mx_date: pick(row, ["previous_mx_date", "Дата предыдущего МХ", "Дата предыдущего MX"]),
    responsible: pick(row, ["responsible", "Ответственный"]),
    responsible_id: pick(row, ["responsible_id", "ID Ответственного"]),
    shipment_block: pick(row, ["shipment_block", "Блок отгрузки"]),
  });
}

function normalizeCarrierRow(raw: JsonObject): CarrierRow | null {
  const transfer = normalizeIdentifier(raw.transfer);
  if (!transfer) return null;
  const rowNumberRaw = normalizeText(raw.row_number);
  const rowNumber = rowNumberRaw ? Number(rowNumberRaw) : null;
  return {
    row_number: Number.isFinite(rowNumber) ? Math.trunc(Number(rowNumber)) : null,
    transfer,
    office: normalizeText(raw.office),
    time: normalizeText(raw.time),
    mx: normalizeText(raw.mx),
    employee: normalizeText(raw.employee),
    carrier: normalizeText(raw.carrier),
  };
}

function carrierFromArray(row: unknown[], rowNumber: number): CarrierRow | null {
  return normalizeCarrierRow({
    row_number: rowNumber,
    transfer: row[1],
    office: row[2],
    time: row[3],
    mx: row[4],
    employee: row[5],
    carrier: row[6],
  });
}

function carrierFromObject(row: JsonObject, rowNumber: number): CarrierRow | null {
  return normalizeCarrierRow({
    row_number: pick(row, ["row_number", "source_row_number"]) ?? rowNumber,
    transfer: pick(row, ["transfer", "Тара", "Передача"]),
    office: pick(row, ["office", "Офис"]),
    time: pick(row, ["time", "Время"]),
    mx: pick(row, ["mx", "MX", "МХ"]),
    employee: pick(row, ["employee", "Сотрудник"]),
    carrier: pick(row, ["carrier", "Перевозчик"]),
  });
}

function normalizePrimaryRows(rows: unknown[]): { rows: PrimaryRow[]; invalidCount: number } {
  const result: PrimaryRow[] = [];
  let invalidCount = 0;
  rows.forEach((raw, index) => {
    const rowNumber = index + 1;
    let row: PrimaryRow | null = null;
    if (Array.isArray(raw)) {
      const firstValues = raw.slice(0, 15).map(normalizeText).join(" ").toLowerCase();
      if (rowNumber === 1 && firstValues.includes("передача") && firstValues.includes("товар")) return;
      row = primaryFromArray(raw, rowNumber);
    } else {
      const object = asObject(raw);
      row = object ? primaryFromObject(object, rowNumber) : null;
    }
    if (row) result.push(row);
    else invalidCount += 1;
  });
  return { rows: result, invalidCount };
}

function normalizeCarrierRows(rows: unknown[]): { rows: CarrierRow[]; invalidCount: number } {
  const result: CarrierRow[] = [];
  let invalidCount = 0;
  rows.forEach((raw, index) => {
    const rowNumber = index + 1;
    let row: CarrierRow | null = null;
    if (Array.isArray(raw)) {
      const firstValues = raw.slice(0, 7).map(normalizeText).join(" ").toLowerCase();
      if (rowNumber === 1 && firstValues.includes("тара") && firstValues.includes("мх")) return;
      row = carrierFromArray(raw, rowNumber);
    } else {
      const object = asObject(raw);
      row = object ? carrierFromObject(object, rowNumber) : null;
    }
    if (row) result.push(row);
    else invalidCount += 1;
  });
  return { rows: result, invalidCount };
}

function normalizeAfterSaleMovementRow(raw: JsonObject): AfterSaleMovementRow | null {
  const product = normalizeIdentifier(raw.product);
  if (!product) return null;
  const realizedAt = parseDateTime(raw.realized_at);
  const statusAt = parseDateTime(raw.status_at);
  const rowNumberRaw = normalizeText(raw.row_number);
  const rowNumber = rowNumberRaw ? Number(rowNumberRaw) : null;
  return {
    row_number: Number.isFinite(rowNumber) ? Math.trunc(Number(rowNumber)) : null,
    office: normalizeText(raw.office),
    block: normalizeText(raw.block),
    product,
    realized_at_raw: normalizeText(raw.realized_at),
    realized_at_iso: realizedAt.iso,
    realized_at_date: realizedAt.isoDate,
    realized_at_label: realizedAt.label,
    status_id: normalizeIdentifier(raw.status_id),
    status: normalizeText(raw.status),
    status_at_raw: normalizeText(raw.status_at),
    status_at_iso: statusAt.iso,
    status_at_date: statusAt.isoDate,
    status_at_label: statusAt.label,
    mx: normalizeText(raw.mx),
    tare: normalizeIdentifier(raw.tare),
    employee_id: normalizeIdentifier(raw.employee_id),
    employee: normalizeText(raw.employee),
  };
}

function afterSaleMovementFromArray(row: unknown[], rowNumber: number): AfterSaleMovementRow | null {
  return normalizeAfterSaleMovementRow({
    row_number: rowNumber,
    office: row[0],
    block: row[1],
    product: row[2],
    realized_at: row[3],
    status_id: row[4],
    status: row[5],
    status_at: row[6],
    mx: row[7],
    tare: row[8],
    employee_id: row[9],
    employee: row[10],
  });
}

function afterSaleMovementFromObject(row: JsonObject, rowNumber: number): AfterSaleMovementRow | null {
  return normalizeAfterSaleMovementRow({
    row_number: pick(row, ["row_number", "source_row_number"]) ?? rowNumber,
    office: pick(row, ["office", "Офис"]),
    block: pick(row, ["block", "Блок"]),
    product: pick(row, ["product", "Товар", "ID товара", "ШК"]),
    realized_at: pick(row, ["realized_at", "Дата реализации"]),
    status_id: pick(row, ["status_id", "ID статуса после реализации"]),
    status: pick(row, ["status", "Статус после реализации"]),
    status_at: pick(row, ["status_at", "Дата статуса"]),
    mx: pick(row, ["mx", "MX", "МХ"]),
    tare: pick(row, ["tare", "Тара"]),
    employee_id: pick(row, ["employee_id", "ID сотрудника"]),
    employee: pick(row, ["employee", "Сотрудник"]),
  });
}

function normalizeAfterSaleMovementRows(rows: unknown[]): { rows: AfterSaleMovementRow[]; invalidCount: number } {
  const result: AfterSaleMovementRow[] = [];
  let invalidCount = 0;
  rows.forEach((raw, index) => {
    const rowNumber = index + 1;
    let row: AfterSaleMovementRow | null = null;
    if (Array.isArray(raw)) {
      const firstValues = raw.slice(0, 11).map(normalizeText).join(" ").toLowerCase();
      if (rowNumber === 1 && firstValues.includes("товар") && firstValues.includes("дата статуса")) return;
      row = afterSaleMovementFromArray(raw, rowNumber);
    } else {
      const object = asObject(raw);
      row = object ? afterSaleMovementFromObject(object, rowNumber) : null;
    }
    if (row) result.push(row);
    else invalidCount += 1;
  });
  return { rows: result, invalidCount };
}

function routeNumberFromMx(mx: string): number | null {
  const matches = normalizeText(mx).match(/\d{1,3}/g);
  if (!matches?.length) return null;
  const parsed = Number(matches[matches.length - 1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMailRoute(routeNumber: number | null): boolean {
  return routeNumber !== null && MAIL_ROUTES.has(routeNumber);
}

function isPmBufferStatus(status: unknown): boolean {
  return PM_BUFFER_STATUSES.has(normalizeForMatch(status));
}

function isMultiShipmentBufferMx(mx: unknown): boolean {
  return normalizeForMatch(mx).includes("буфер мультиотгрузки");
}

function isGateMx(mx: unknown): boolean {
  return normalizeForMatch(mx).includes("ворота");
}

function mxHasPresortExclusion(mx: unknown): boolean {
  const normalized = normalizeForMatch(mx);
  return PRESORT_EXCLUDED_MX_PARTS.some((part) => normalized.includes(part));
}

function isPresortStatus(row: PrimaryRow): boolean {
  const status = normalizeForMatch(row.product_status);
  if (status === "sps") return true;
  if (status === "pwt") return !mxHasPresortExclusion(row.mx);
  if ((status === "gws" || status === "wmi") && !mxHasPresortExclusion(row.mx)) return true;
  return false;
}

function isLabelingStatus(row: PrimaryRow): boolean {
  return normalizeForMatch(row.product_status) === LABELING_STATUS;
}

function mxIncludes(row: PrimaryRow, part: string): boolean {
  return normalizeForMatch(row.mx).includes(normalizeForMatch(part));
}

function isMarketplaceStatus(row: PrimaryRow): boolean {
  const status = normalizeForMatch(row.product_status);
  if (status === "pap") return true;
  return (status === "gws" || status === "pwt") && mxIncludes(row, "Пред сортировка МП");
}

function isPcStatus(row: PrimaryRow): boolean {
  const status = normalizeForMatch(row.product_status);
  if (status === "smc") return true;
  return (status === "gws" || status === "pwt") && mxIncludes(row, "Сортировка в сетки");
}

function mxHasBuffer(row: PrimaryRow): boolean {
  return normalizeForMatch(row.mx).includes("буфер");
}

function isWmiMpPcStatus(row: PrimaryRow): boolean {
  const status = normalizeForMatch(row.product_status);
  if (status !== "wmi") return false;
  return mxIncludes(row, "Пред сортировка МП") || mxIncludes(row, "Сортировка в сетки");
}

function isNoOrderUsdStatus(row: PrimaryRow): boolean {
  return normalizeForMatch(row.product_status) === NO_ORDER_HIDDEN_USD_STATUS;
}

function isNoOrderTmmStatus(row: PrimaryRow): boolean {
  return normalizeForMatch(row.product_status) === NO_ORDER_HIDDEN_TMM_STATUS;
}

function sumPrices(rows: PrimaryRow[]): number {
  const sum = rows.reduce((acc, row) => acc + (row.price ?? 0), 0);
  return Math.round(sum * 100) / 100;
}

function compactPrimaryRow(row: PrimaryRow): JsonObject {
  return {
    row_number: row.row_number,
    transfer: row.transfer,
    product: row.product,
    product_status: row.product_status,
    price: row.price,
    mx: row.mx,
    created_at: row.created_at_raw,
    created_at_date: row.created_at_date,
  };
}

function compactPrimaryRowsPayload(rows: PrimaryRow[]): JsonObject {
  return {
    rows_count: rows.length,
    rows_sample_limit: SOURCE_PAYLOAD_ROWS_SAMPLE_LIMIT,
    rows_sample: rows.slice(0, SOURCE_PAYLOAD_ROWS_SAMPLE_LIMIT).map(compactPrimaryRow),
  };
}

function compactAfterSaleMovementRow(row: AfterSaleMovementRow): JsonObject {
  return {
    row_number: row.row_number,
    product: row.product,
    status: row.status,
    status_at: row.status_at_raw,
    status_at_date: row.status_at_date,
    mx: row.mx,
    tare: row.tare,
    employee_id: row.employee_id,
    employee: row.employee,
  };
}

function sourceRowIdFromRows(rows: PrimaryRow[]): string | null {
  const ids = rows.map((row) => row.row_number).filter((value) => value !== null);
  if (!ids.length) return null;
  const sample = ids.slice(0, SOURCE_ROW_ID_LIMIT).join(",");
  return ids.length > SOURCE_ROW_ID_LIMIT ? `${sample},+${ids.length - SOURCE_ROW_ID_LIMIT}` : sample;
}

function limitedProductIds(productIds: string[]): string[] {
  return productIds.slice(0, SEARCH_TEXT_IDS_LIMIT);
}

function buildPrimaryRowLines(rows: PrimaryRow[], limit = DESCRIPTION_ROWS_LIMIT): string[] {
  const lines = rows
    .slice(0, limit)
    .map((row, index) => `${index + 1}. ${row.product} | ${row.product_status || "-"} | ${row.price ?? "-"} ₽ | ${row.mx || "-"}`);
  if (rows.length > limit) lines.push(`...и еще ${rows.length - limit} ШК. Полный список сохранен в source_shk_ids.`);
  return lines;
}

function buildTargetCustomFields(taskType: string, price: number | null, body: JsonObject): JsonObject {
  const customFields = { ...(asObject(body.target_custom_fields) ?? {}) };
  const taskTypeFieldId = normalizeText(body.task_type_field_id) || normalizeText(Deno.env.get("WEEEK_TASK_TYPE_FIELD_ID")) || DEFAULT_TASK_TYPE_FIELD_ID;
  const pmTaskTypeOptionId = normalizeText(body.pm_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_PM_BUFFER_PM_TASK_TYPE_OPTION_ID"));
  const mailTaskTypeOptionId = normalizeText(body.mail_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_PM_BUFFER_MAIL_TASK_TYPE_OPTION_ID"));
  const presortTaskTypeOptionId = normalizeText(body.presort_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_PRESORT_TASK_TYPE_OPTION_ID")) || DEFAULT_PRESORT_TASK_TYPE_OPTION_ID;
  const labelingTaskTypeOptionId = normalizeText(body.labeling_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_LABELING_TASK_TYPE_OPTION_ID"));
  const marketplaceTaskTypeOptionId = normalizeText(body.marketplace_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_MARKETPLACE_TASK_TYPE_OPTION_ID"));
  const pcTaskTypeOptionId = normalizeText(body.pc_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_PC_TASK_TYPE_OPTION_ID"));
  const wmiMpPcTaskTypeOptionId = normalizeText(body.wmi_mp_pc_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_WMI_MP_PC_TASK_TYPE_OPTION_ID")) || DEFAULT_WMI_MP_PC_TASK_TYPE_OPTION_ID;
  const noOrderTaskTypeOptionId = normalizeText(body.no_order_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_NO_ORDER_TASK_TYPE_OPTION_ID")) || DEFAULT_NO_ORDER_TASK_TYPE_OPTION_ID;
  const usdTaskTypeOptionId = normalizeText(body.usd_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_USD_TASK_TYPE_OPTION_ID")) || DEFAULT_USD_TASK_TYPE_OPTION_ID;
  const tmmTaskTypeOptionId = normalizeText(body.tmm_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_TMM_TASK_TYPE_OPTION_ID")) || DEFAULT_TMM_TASK_TYPE_OPTION_ID;
  const afterSaleMovementTaskTypeOptionId = normalizeText(body.after_sale_movement_task_type_option_id) || normalizeText(Deno.env.get("WEEEK_AFTER_SALE_MOVEMENT_TASK_TYPE_OPTION_ID")) || DEFAULT_AFTER_SALE_MOVEMENT_TASK_TYPE_OPTION_ID;
  let taskTypeOptionId = pmTaskTypeOptionId;
  if (taskType === DEFAULT_MAIL_TASK_TYPE) taskTypeOptionId = mailTaskTypeOptionId;
  if (taskType === DEFAULT_PRESORT_TASK_TYPE) taskTypeOptionId = presortTaskTypeOptionId;
  if (taskType === DEFAULT_LABELING_TASK_TYPE) taskTypeOptionId = labelingTaskTypeOptionId;
  if (taskType === DEFAULT_MARKETPLACE_TASK_TYPE) taskTypeOptionId = marketplaceTaskTypeOptionId;
  if (taskType === DEFAULT_PC_TASK_TYPE) taskTypeOptionId = pcTaskTypeOptionId;
  if (taskType === DEFAULT_WMI_MP_PC_TASK_TYPE) taskTypeOptionId = wmiMpPcTaskTypeOptionId;
  if (taskType === DEFAULT_NO_ORDER_TASK_TYPE) taskTypeOptionId = noOrderTaskTypeOptionId;
  if (taskType === DEFAULT_USD_TASK_TYPE) taskTypeOptionId = usdTaskTypeOptionId;
  if (taskType === DEFAULT_TMM_TASK_TYPE) taskTypeOptionId = tmmTaskTypeOptionId;
  if (taskType === DEFAULT_AFTER_SALE_MOVEMENT_TASK_TYPE) taskTypeOptionId = afterSaleMovementTaskTypeOptionId;
  const priceFieldId = normalizeText(body.price_field_id) || normalizeText(body.cost_field_id) || normalizeText(Deno.env.get("WEEEK_PRICE_FIELD_ID")) || DEFAULT_PRICE_FIELD_ID;

  if (taskTypeFieldId && taskTypeOptionId && !Object.prototype.hasOwnProperty.call(customFields, taskTypeFieldId)) {
    customFields[taskTypeFieldId] = taskTypeOptionId;
  }
  if (priceFieldId && price !== null && !Object.prototype.hasOwnProperty.call(customFields, priceFieldId)) {
    customFields[priceFieldId] = price;
  }
  return customFields;
}

function buildDescription(taskType: string, transfer: string, rows: PrimaryRow[], nonSmsRows: PrimaryRow[], statusLabel = "SMS/SWT"): string {
  const productLines = buildPrimaryRowLines(rows);
  const nonSmsLines = nonSmsRows
    .slice(0, DESCRIPTION_ROWS_LIMIT)
    .map((row) => `Есть товар со статусом ${row.product_status || "-"}: ${row.product}`);
  if (nonSmsRows.length > DESCRIPTION_ROWS_LIMIT) nonSmsLines.push(`...и еще ${nonSmsRows.length - DESCRIPTION_ROWS_LIMIT} ШК со статусом не ${statusLabel}.`);
  return [
    `Передача: ${transfer}`,
    `Статус крайнего движения: ${statusLabel}`,
    "",
    "ШК в таре:",
    ...productLines,
    ...(nonSmsLines.length ? ["", ...nonSmsLines] : []),
  ].join("\n");
}

function buildPmParkingDescription(routeLabel: string, transfers: string[], rows: PrimaryRow[], statusLabel = "SMS/SWT"): string {
  const transferLines = transfers
    .slice(0, DESCRIPTION_ROWS_LIMIT)
    .map((transfer, index) => `${index + 1}. ${transfer}`);
  if (transfers.length > DESCRIPTION_ROWS_LIMIT) transferLines.push(`...и еще ${transfers.length - DESCRIPTION_ROWS_LIMIT} передач. Полный список сохранен в source_payload.`);
  return [
    `Парковка: ${routeLabel}`,
    `Статус крайнего движения: ${statusLabel}`,
    `Передач: ${transfers.length}`,
    `Строк в исходной таблице: ${rows.length}`,
    "",
    "Передачи:",
    ...transferLines,
  ].join("\n");
}

function buildPresortDescription(taskType: string, groupLabel: string, rows: PrimaryRow[]): string {
  const productLines = buildPrimaryRowLines(rows);
  return [
    `Тип задания: ${taskType}`,
    `Группировка: ${groupLabel}`,
    "",
    "ШК в таре:",
    ...productLines,
  ].join("\n");
}

function buildSearchText(values: unknown[]): string {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean))).join(" ");
}

function filterPrimaryRowsByBusinessDate(rows: PrimaryRow[], body: JsonObject): { rows: PrimaryRow[]; dateFilter: string; filteredOutCount: number } {
  const dateFilter = normalizeText(body.row_date || body.business_date || body.effective_date);
  if (!dateFilter) return { rows, dateFilter: "", filteredOutCount: 0 };
  const filtered = rows.filter((row) => row.created_at_date === dateFilter);
  return { rows: filtered, dateFilter, filteredOutCount: rows.length - filtered.length };
}

async function buildPmBufferTasks(primaryRawRows: unknown[], carrierRawRows: unknown[], body: JsonObject): Promise<BuildResult> {
  const primary = normalizePrimaryRows(primaryRawRows);
  const carrier = normalizeCarrierRows(carrierRawRows);
  const datedPrimary = filterPrimaryRowsByBusinessDate(primary.rows, body);
  const minPrice = normalizeNumber(body.min_price, DEFAULT_MIN_PRICE);
  const sourceGeneratedAt = currentMoscowIso();
  const dueDate = plannedTaskDueDate(body);
  const responsibilityZone = normalizedResponsibilityZone(body.responsibility_zone);
  const sourceModule = normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE;
  const sourceTable = normalizeText(body.source_table) || DEFAULT_SOURCE_TABLE;
  const targetWorkspaceId = normalizeText(body.workspace_id) || normalizeText(body.target_workspace_id) || DEFAULT_TARGET_WORKSPACE_ID;
  const targetProjectId = normalizeText(body.project_id) || normalizeText(body.target_project_id) || DEFAULT_TARGET_PROJECT_ID;
  const targetBoardId = normalizeText(body.board_id) || normalizeText(body.target_board_id) || null;
  const targetBoardName = normalizeText(body.board_name) || normalizeText(body.target_board_name) || DEFAULT_TARGET_BOARD_NAME;
  const pmColumnName = normalizeText(body.pm_column_name) || DEFAULT_PM_COLUMN_NAME;
  const mailColumnName = normalizeText(body.mail_column_name) || DEFAULT_MAIL_COLUMN_NAME;
  const mailTagName = normalizeText(body.mail_tag_name) || DEFAULT_MAIL_TAG_NAME;

  const primaryRows = datedPrimary.rows;
  const specialMap = await loadSpecialShkMap(primaryRows.map((row) => row.product), body);
  const bufferRows = primaryRows.filter((row) => isPmBufferStatus(row.product_status));
  const copiedTransferIds = Array.from(new Set(bufferRows.map((row) => row.transfer).filter(isGroupableIdentifier))).sort((a, b) => a.localeCompare(b, "ru"));
  const carrierExcludedTransfers = new Set(
    carrier.rows
      .filter((row) => normalizeForMatch(row.mx).includes("отгрузка сторонним перевозчиком"))
      .map((row) => row.transfer)
      .filter(Boolean),
  );

  const carrierGateMxByTransfer = new Map<string, string>();
  for (const row of carrier.rows) {
    if (!row.transfer || carrierExcludedTransfers.has(row.transfer)) continue;
    if (!isGateMx(row.mx)) continue;
    if (!carrierGateMxByTransfer.has(row.transfer)) carrierGateMxByTransfer.set(row.transfer, row.mx);
  }

  const allRowsByTransfer = new Map<string, PrimaryRow[]>();
  for (const row of primaryRows) {
    const group = allRowsByTransfer.get(row.transfer) ?? [];
    group.push(row);
    allRowsByTransfer.set(row.transfer, group);
  }

  const tasks: PmTask[] = [];
  const skipped: JsonObject[] = [];
  let cheapCount = 0;
  let excludedByCarrierCount = 0;
  let pmTaskCount = 0;
  let mailTaskCount = 0;
  let specialTaskCount = 0;

  const pushTransferTask = (params: {
    rows: PrimaryRow[];
    transfer: string;
    taskType: string;
    boardKey: string;
    columnName: string;
    columnKey: string;
    title: string;
    routeNumber: number | null;
    routeMx: string;
    mail: boolean;
    sourceId: string;
    entityType: string;
  }) => {
    if (!params.rows.length) return;
    const primaryRow = firstMeaningfulRow(params.rows) || params.rows[0];
    const productIds = Array.from(new Set(params.rows.map((row) => row.product).filter(Boolean)));
    const priceSum = sumPrices(params.rows);
    const nonSmsRows = params.rows.filter((row) => !isPmBufferStatus(row.product_status));
    const specialInfos = specialInfoForRows(params.rows, specialMap);
    const baseTags = params.mail && mailTagName ? [{ name: mailTagName }] : [];
    tasks.push({
      source_module: sourceModule,
      source_table: sourceTable,
      source_id: params.sourceId,
      source_row_id: sourceRowIdFromRows(params.rows),
      source_payload: {
        entity_type: params.entityType,
        description_task_type: params.taskType,
        transfer: params.transfer,
        route_number: params.routeNumber,
        route_mx: params.routeMx,
        ...compactPrimaryRowsPayload(params.rows),
        sms_rows_count: params.rows.filter((row) => isPmBufferStatus(row.product_status)).length,
        non_sms_rows_count: nonSmsRows.length,
        price_sum: priceSum,
        business_date: datedPrimary.dateFilter || primaryRow?.created_at_date || currentMoscowDate(),
        planned_upload_date: normalizeText(body.planned_upload_date) || null,
        special_shk: specialInfos.map((info) => ({
          tag_name: info.tag_name,
          matched_shk: info.matched_shk,
          second_shk: info.second_shk,
          media: info.media,
        })),
      },
      source_generated_at: sourceGeneratedAt,
      source_shk_ids: productIds,
      source_tare_id: params.transfer,
      source_price_sum: priceSum,
      source_last_movement_at: primaryRow?.created_at_iso ?? null,
      search_text: buildSearchText([params.transfer, params.routeMx, params.taskType, ...limitedProductIds(productIds)]),
      task_type: params.taskType,
      board_key: params.boardKey,
      column_key: params.columnKey,
      title: truncateText(params.title),
      description: withSpecialDescription(buildDescription(params.taskType, params.transfer, params.rows, nonSmsRows, "SMS/SWT"), specialInfos),
      priority: priceBasedPriority(priceSum),
      due_date: dueDate,
      responsibility_zone: responsibilityZone,
      target_workspace_id: targetWorkspaceId,
      target_project_id: targetProjectId,
      target_board_id: targetBoardId,
      target_board_name: targetBoardName,
      target_column_id: null,
      target_column_name: params.columnName,
      target_custom_fields: buildTargetCustomFields(params.taskType, priceSum, body),
      target_tags: mergeTargetTags(baseTags, specialInfos),
      enabled: taskEnabledForUpload(body),
      master_action: masterActionForUpload(body),
    });
  };

  for (const transfer of copiedTransferIds) {
    if (carrierExcludedTransfers.has(transfer)) {
      excludedByCarrierCount += 1;
      skipped.push({ reason: "third_party_carrier", transfer });
      continue;
    }

    const groupRows = allRowsByTransfer.get(transfer) ?? [];
    const originalPriceSum = sumPrices(groupRows);
    if (originalPriceSum < minPrice) {
      cheapCount += 1;
      skipped.push({ reason: "low_price_transfer", transfer, price_sum: originalPriceSum });
      continue;
    }

    const bufferGroupRows = groupRows.filter((row) => isPmBufferStatus(row.product_status));
    const primaryRow = bufferGroupRows[0] || groupRows[0];
    const primaryMx = primaryRow?.mx || "";
    const routeMx = isMultiShipmentBufferMx(primaryMx) ? (carrierGateMxByTransfer.get(transfer) || primaryMx) : primaryMx;
    const routeNumber = routeNumberFromMx(routeMx);
    const mail = isMailRoute(routeNumber);
    const taskType = mail ? DEFAULT_MAIL_TASK_TYPE : DEFAULT_PM_TASK_TYPE;
    const boardKey = mail ? DEFAULT_MAIL_ROUTE_KEY : DEFAULT_PM_ROUTE_KEY;
    const columnName = mail ? mailColumnName : pmColumnName;
    const columnKey = mail ? "mail" : "pm";
    const routeLabel = routeNumber === null ? "Парковка без номера" : `Парковка ${routeNumber}`;
    const sourceDate = datedPrimary.dateFilter || primaryRow?.created_at_date || currentMoscowDate();
    const split = splitSpecialRows(groupRows, specialMap);

    if (split.regularRows.length) {
      if (mail) mailTaskCount += 1;
      else pmTaskCount += 1;
      pushTransferTask({
        rows: split.regularRows,
        transfer,
        taskType,
        boardKey,
        columnName,
        columnKey,
        title: `Буфер ПМ | ${transfer} - ${routeLabel}`,
        routeNumber,
        routeMx,
        mail,
        sourceId: `${mail ? "mail" : "pm"}:${transfer}|${sourceDate}`,
        entityType: "transfer",
      });
    }

    for (const row of split.specialRows) {
      specialTaskCount += 1;
      if (mail) mailTaskCount += 1;
      else pmTaskCount += 1;
      pushTransferTask({
        rows: [row],
        transfer,
        taskType,
        boardKey,
        columnName,
        columnKey,
        title: `Буфер ПМ | ${transfer} - ${routeLabel} | ${row.product}`,
        routeNumber,
        routeMx,
        mail,
        sourceId: `${mail ? "mail" : "pm"}:special:${row.product}|${sourceDate}`,
        entityType: "special_product",
      });
    }
  }

  return {
    primary_rows: primaryRows,
    carrier_rows: carrier.rows,
    copied_transfer_ids: copiedTransferIds,
    excluded_transfers: Array.from(carrierExcludedTransfers),
    tasks,
    skipped,
    summary: {
      primary_rows_count: primaryRows.length,
      source_primary_rows_count: primary.rows.length,
      date_filter: datedPrimary.dateFilter || null,
      date_filtered_out_count: datedPrimary.filteredOutCount,
      carrier_rows_count: carrier.rows.length,
      invalid_primary_rows_count: primary.invalidCount,
      invalid_carrier_rows_count: carrier.invalidCount,
      sms_rows_count: bufferRows.length,
      sms_transfer_count: copiedTransferIds.length,
      excluded_by_carrier_count: excludedByCarrierCount,
      cheap_transfer_count: cheapCount,
      cheap_parking_count: cheapCount,
      transfer_task_count: tasks.length,
      special_2shk_task_count: specialTaskCount,
      special_2shk_matches_count: specialMap.size,
      tasks_to_create_count: tasks.length,
      pm_tasks_count: pmTaskCount,
      mail_tasks_count: mailTaskCount,
      min_price: minPrice,
    },
  };
}

function sortRowsByCreatedAt(rows: PrimaryRow[]): PrimaryRow[] {
  return rows.slice().sort((a, b) => {
    const aTs = parseDateTime(a.created_at_raw).ts || 0;
    const bTs = parseDateTime(b.created_at_raw).ts || 0;
    if (aTs !== bTs) return aTs - bTs;
    return (a.row_number ?? 0) - (b.row_number ?? 0);
  });
}

function firstMeaningfulRow(rows: PrimaryRow[]): PrimaryRow | null {
  const sorted = sortRowsByCreatedAt(rows);
  return sorted.find((row) => row.created_at_date) || sorted[0] || null;
}

function sourceIdFromRows(prefix: string, key: string, rows: PrimaryRow[]): string {
  const products = Array.from(new Set(rows.map((row) => row.product).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
  const firstRow = firstMeaningfulRow(rows);
  const date = firstRow?.created_at_date || "no-date";
  const firstProduct = products[0] || "no-product";
  const lastProduct = products[products.length - 1] || firstProduct;
  return truncateText(`${prefix}:${key}|${date}|${firstProduct}-${lastProduct}|${products.length}`, 240);
}

function createPresortTask(params: {
  rows: PrimaryRow[];
  taskType: string;
  routeKey: string;
  columnKey: string;
	  title: string;
	  groupKind: string;
	  sourceId: string;
	  sourceTareId: string | null;
	  dueDate: string | null;
	  responsibilityZone: string;
	  forcedPriority?: number | null;
	  targetTags?: unknown[];
	  specialInfos?: SpecialShkInfo[];
	  sourceModule: string;
	  sourceTable: string;
	  sourceGeneratedAt: string;
  targetWorkspaceId: string;
  targetProjectId: string;
  targetBoardId: string | null;
  targetBoardName: string;
  targetColumnName: string;
  body: JsonObject;
}): PmTask {
	  const primaryRow = firstMeaningfulRow(params.rows);
	  const priceSum = sumPrices(params.rows);
	  const productIds = Array.from(new Set(params.rows.map((row) => row.product).filter(Boolean)));
	  const specialInfos = params.specialInfos ?? specialInfoForRows(params.rows);
	  return {
    source_module: params.sourceModule,
    source_table: params.sourceTable,
    source_id: params.sourceId,
    source_row_id: sourceRowIdFromRows(params.rows),
	    source_payload: {
	      entity_type: params.groupKind,
	      description_task_type: params.taskType,
	      group_key: params.sourceTareId || normalizeText(primaryRow?.mx),
	      ...compactPrimaryRowsPayload(params.rows),
	      price_sum: priceSum,
	      created_at_date: primaryRow?.created_at_date || null,
	    },
    source_generated_at: params.sourceGeneratedAt,
    source_shk_ids: productIds,
    source_tare_id: params.sourceTareId,
    source_price_sum: priceSum,
    source_last_movement_at: primaryRow?.created_at_iso ?? null,
    search_text: buildSearchText([params.title, params.sourceTareId, primaryRow?.mx, params.taskType, ...limitedProductIds(productIds)]),
    task_type: params.taskType,
    board_key: params.routeKey,
    column_key: params.columnKey,
	    title: truncateText(params.title),
	    description: withSpecialDescription(buildPresortDescription(params.taskType, params.groupKind, params.rows), specialInfos),
	    priority: params.forcedPriority !== undefined ? params.forcedPriority : priceBasedPriority(priceSum),
	    due_date: params.dueDate,
	    responsibility_zone: params.responsibilityZone,
    target_workspace_id: params.targetWorkspaceId,
    target_project_id: params.targetProjectId,
    target_board_id: params.targetBoardId,
    target_board_name: params.targetBoardName,
    target_column_id: null,
    target_column_name: params.targetColumnName,
    target_custom_fields: buildTargetCustomFields(params.taskType, priceSum, params.body),
    target_tags: mergeTargetTags(params.targetTags, specialInfos),
    enabled: taskEnabledForUpload(params.body),
    master_action: masterActionForUpload(params.body),
  };
}

function appendGroupedManualTasks(params: {
  rows: PrimaryRow[];
  tasks: PmTask[];
  titlePrefix: string;
	  taskType: string;
	  routeKey: string;
	  columnKey: string;
	  sourcePrefix: string;
	  dueDate: string | null;
	  responsibilityZone: string;
	  forcedPriority?: number | null;
	  targetTags?: unknown[];
	  specialMap?: Map<string, SpecialShkInfo>;
	  allowMxGrouping?: boolean;
	  forceTareGrouping?: boolean;
	  sourceModule: string;
  sourceTable: string;
  sourceGeneratedAt: string;
  targetWorkspaceId: string;
  targetProjectId: string;
  targetBoardId: string | null;
  targetBoardName: string;
  targetColumnName: string;
  body: JsonObject;
}): { groupedTareCount: number; groupedMxCount: number; singleCount: number } {
  const split = splitSpecialRows(params.rows, params.specialMap);
  const rowsForGrouping = split.regularRows;
  const usedRows = new Set<PrimaryRow>();
  let groupedTareCount = 0;
  let groupedMxCount = 0;
  let singleCount = 0;

  const byTare = new Map<string, PrimaryRow[]>();
  for (const row of rowsForGrouping) {
    if (!isGroupableIdentifier(row.transfer)) continue;
    const group = byTare.get(row.transfer) ?? [];
    group.push(row);
    byTare.set(row.transfer, group);
  }

  for (const [transfer, groupRows] of byTare.entries()) {
    if (groupRows.length <= 1 && !params.forceTareGrouping) continue;
    groupedTareCount += 1;
    groupRows.forEach((row) => usedRows.add(row));
    params.tasks.push(createPresortTask({
      rows: groupRows,
      taskType: params.taskType,
      routeKey: params.routeKey,
      columnKey: params.columnKey,
	      title: `${params.titlePrefix} | Тара ${transfer}`,
	      groupKind: `Тара ${transfer}`,
	      sourceId: sourceIdFromRows(`${params.sourcePrefix}_tare`, transfer, groupRows),
	      sourceTareId: transfer,
	      dueDate: params.dueDate,
	      responsibilityZone: params.responsibilityZone,
	      forcedPriority: params.forcedPriority,
	      targetTags: params.targetTags,
	      specialInfos: specialInfoForRows(groupRows, params.specialMap),
      sourceModule: params.sourceModule,
      sourceTable: params.sourceTable,
      sourceGeneratedAt: params.sourceGeneratedAt,
      targetWorkspaceId: params.targetWorkspaceId,
      targetProjectId: params.targetProjectId,
      targetBoardId: params.targetBoardId,
      targetBoardName: params.targetBoardName,
      targetColumnName: params.targetColumnName,
      body: params.body,
    }));
  }

  const singleRows: PrimaryRow[] = [];
	  const mxCandidates = new Map<string, PrimaryRow[]>();
	  for (const row of rowsForGrouping.filter((item) => !usedRows.has(item))) {
	    const mx = normalizeText(row.mx);
	    if (params.allowMxGrouping === false || !isGroupableIdentifier(mx)) {
	      singleRows.push(row);
	      continue;
	    }
    const group = mxCandidates.get(mx) ?? [];
    group.push(row);
    mxCandidates.set(mx, group);
  }

  for (const [mx, groupRows] of mxCandidates.entries()) {
    if (groupRows.length <= 10) {
      singleRows.push(...groupRows);
      continue;
    }
    const sorted = sortRowsByCreatedAt(groupRows);
    let cluster: PrimaryRow[] = [];
    let clusterStartTs = 0;
    const flushCluster = () => {
      if (!cluster.length) return;
      if (cluster.length > 10) {
        groupedMxCount += 1;
        params.tasks.push(createPresortTask({
          rows: cluster,
          taskType: params.taskType,
          routeKey: params.routeKey,
          columnKey: params.columnKey,
	          title: `${params.titlePrefix} | ${mx}`,
	          groupKind: `МХ ${mx}`,
	          sourceId: sourceIdFromRows(`${params.sourcePrefix}_mx`, mx, cluster),
	          sourceTareId: null,
	          dueDate: params.dueDate,
	          responsibilityZone: params.responsibilityZone,
	          forcedPriority: params.forcedPriority,
	          targetTags: params.targetTags,
	          specialInfos: specialInfoForRows(cluster, params.specialMap),
          sourceModule: params.sourceModule,
          sourceTable: params.sourceTable,
          sourceGeneratedAt: params.sourceGeneratedAt,
          targetWorkspaceId: params.targetWorkspaceId,
          targetProjectId: params.targetProjectId,
          targetBoardId: params.targetBoardId,
          targetBoardName: params.targetBoardName,
          targetColumnName: params.targetColumnName,
          body: params.body,
        }));
      } else {
        singleRows.push(...cluster);
      }
      cluster = [];
      clusterStartTs = 0;
    };

    for (const row of sorted) {
      const ts = parseDateTime(row.created_at_raw).ts;
      if (!cluster.length) {
        cluster = [row];
        clusterStartTs = ts;
        continue;
      }
      if (ts && clusterStartTs && ts - clusterStartTs <= 4 * 60 * 60 * 1000) {
        cluster.push(row);
      } else {
        flushCluster();
        cluster = [row];
        clusterStartTs = ts;
      }
    }
    flushCluster();
  }

  for (const row of singleRows) {
    singleCount += 1;
    params.tasks.push(createPresortTask({
      rows: [row],
      taskType: params.taskType,
      routeKey: params.routeKey,
      columnKey: params.columnKey,
	      title: `${params.titlePrefix} | ${row.product}`,
	      groupKind: "ШК",
	      sourceId: `${params.sourcePrefix}:${row.product}|${row.created_at_date || "no-date"}`,
	      sourceTareId: null,
	      dueDate: params.dueDate,
	      responsibilityZone: params.responsibilityZone,
	      forcedPriority: params.forcedPriority,
	      targetTags: params.targetTags,
	      specialInfos: specialInfoForRows([row], params.specialMap),
      sourceModule: params.sourceModule,
      sourceTable: params.sourceTable,
      sourceGeneratedAt: params.sourceGeneratedAt,
      targetWorkspaceId: params.targetWorkspaceId,
      targetProjectId: params.targetProjectId,
      targetBoardId: params.targetBoardId,
      targetBoardName: params.targetBoardName,
      targetColumnName: params.targetColumnName,
      body: params.body,
    }));
  }

  for (const row of split.specialRows) {
    singleCount += 1;
    params.tasks.push(createPresortTask({
      rows: [row],
      taskType: params.taskType,
      routeKey: params.routeKey,
      columnKey: params.columnKey,
      title: `${params.titlePrefix} | ${row.product}`,
      groupKind: "ШК",
      sourceId: `${params.sourcePrefix}:special:${row.product}|${row.created_at_date || "no-date"}`,
      sourceTareId: null,
      dueDate: params.dueDate,
      responsibilityZone: params.responsibilityZone,
      forcedPriority: params.forcedPriority,
      targetTags: params.targetTags,
      specialInfos: specialInfoForRows([row], params.specialMap),
      sourceModule: params.sourceModule,
      sourceTable: params.sourceTable,
      sourceGeneratedAt: params.sourceGeneratedAt,
      targetWorkspaceId: params.targetWorkspaceId,
      targetProjectId: params.targetProjectId,
      targetBoardId: params.targetBoardId,
      targetBoardName: params.targetBoardName,
      targetColumnName: params.targetColumnName,
      body: params.body,
    }));
  }

  return { groupedTareCount, groupedMxCount, singleCount };
}

async function buildPresortTasks(primaryRawRows: unknown[], carrierRawRows: unknown[], body: JsonObject): Promise<BuildResult> {
  const primary = normalizePrimaryRows(primaryRawRows);
  const carrier = normalizeCarrierRows(carrierRawRows);
  const datedPrimary = filterPrimaryRowsByBusinessDate(primary.rows, body);
  const sourceGeneratedAt = currentMoscowIso();
  const sourceModule = normalizeText(body.source_module) || "manual_presort_opp";
  const sourceTable = normalizeText(body.source_table) || "xlsx:manual_presort_opp";
  const targetWorkspaceId = normalizeText(body.workspace_id) || normalizeText(body.target_workspace_id) || DEFAULT_TARGET_WORKSPACE_ID;
  const targetProjectId = normalizeText(body.project_id) || normalizeText(body.target_project_id) || DEFAULT_TARGET_PROJECT_ID;
  const targetBoardId = normalizeText(body.board_id) || normalizeText(body.target_board_id) || null;
  const targetBoardName = normalizeText(body.board_name) || normalizeText(body.target_board_name) || DEFAULT_TARGET_BOARD_NAME;
  const presortColumnName = normalizeText(body.presort_column_name) || normalizeText(body.target_column_name) || DEFAULT_PRESORT_COLUMN_NAME;
  const labelingColumnName = normalizeText(body.labeling_column_name) || DEFAULT_LABELING_COLUMN_NAME;
  const presortDueDate = plannedTaskDueDate(body, "presort_planned_upload_date");
  const labelingDueDate = plannedTaskDueDate(body, "labeling_planned_upload_date");
  const presortResponsibilityZone = normalizedResponsibilityZone(body.presort_responsibility_zone || body.responsibility_zone);
  const labelingResponsibilityZone = normalizedResponsibilityZone(body.labeling_responsibility_zone || body.responsibility_zone);

  const primaryRows = datedPrimary.rows;
  const specialMap = await loadSpecialShkMap(primaryRows.map((row) => row.product), body);
  const presortRows = primaryRows.filter(isPresortStatus);
  const labelingRows = primaryRows.filter(isLabelingStatus);
  const tasks: PmTask[] = [];
  const skipped: JsonObject[] = [];
  const presortStats = appendGroupedManualTasks({
    rows: presortRows,
    tasks,
    titlePrefix: "Предсортировка",
    taskType: DEFAULT_PRESORT_TASK_TYPE,
    routeKey: DEFAULT_PRESORT_ROUTE_KEY,
    columnKey: "presort",
    sourcePrefix: "presort",
    dueDate: presortDueDate,
    responsibilityZone: presortResponsibilityZone,
    specialMap,
    allowMxGrouping: false,
    sourceModule,
    sourceTable,
    sourceGeneratedAt,
    targetWorkspaceId,
    targetProjectId,
    targetBoardId,
    targetBoardName,
    targetColumnName: presortColumnName,
    body,
  });

  for (const row of labelingRows) {
    tasks.push(createPresortTask({
      rows: [row],
      taskType: DEFAULT_LABELING_TASK_TYPE,
      routeKey: DEFAULT_LABELING_ROUTE_KEY,
      columnKey: "labeling",
      title: `Оклейка | ${row.product}`,
      groupKind: "ШК",
      sourceId: `${row.product}|${row.created_at_date || "no-date"}`,
      sourceTareId: null,
      dueDate: labelingDueDate,
      responsibilityZone: labelingResponsibilityZone,
      forcedPriority: 2,
      specialInfos: specialInfoForRows([row], specialMap),
      sourceModule,
      sourceTable,
      sourceGeneratedAt,
      targetWorkspaceId,
      targetProjectId,
      targetBoardId,
      targetBoardName,
      targetColumnName: labelingColumnName,
      body,
    }));
  }

  const copiedTransferIds = Array.from(new Set(presortRows.map((row) => row.transfer).filter(isGroupableIdentifier))).sort((a, b) => a.localeCompare(b, "ru"));
  return {
    primary_rows: primaryRows,
    carrier_rows: carrier.rows,
    copied_transfer_ids: copiedTransferIds,
    excluded_transfers: [],
    tasks,
    skipped,
    summary: {
      primary_rows_count: primaryRows.length,
      source_primary_rows_count: primary.rows.length,
      date_filter: datedPrimary.dateFilter || null,
      date_filtered_out_count: datedPrimary.filteredOutCount,
      carrier_rows_count: carrier.rows.length,
      invalid_primary_rows_count: primary.invalidCount,
      invalid_carrier_rows_count: carrier.invalidCount,
      presort_rows_count: presortRows.length,
      labeling_rows_count: labelingRows.length,
      presort_transfer_count: copiedTransferIds.length,
      grouped_tare_count: presortStats.groupedTareCount,
      grouped_mx_count: presortStats.groupedMxCount,
      single_presort_count: presortStats.singleCount,
      special_2shk_matches_count: specialMap.size,
      tasks_to_create_count: tasks.length,
      presort_tasks_count: tasks.filter((task) => task.task_type === DEFAULT_PRESORT_TASK_TYPE).length,
      labeling_tasks_count: tasks.filter((task) => task.task_type === DEFAULT_LABELING_TASK_TYPE).length,
    },
  };
}

async function buildMarketplacePcTasks(primaryRawRows: unknown[], carrierRawRows: unknown[], body: JsonObject): Promise<BuildResult> {
  const primary = normalizePrimaryRows(primaryRawRows);
  const carrier = normalizeCarrierRows(carrierRawRows);
  const sourceGeneratedAt = currentMoscowIso();
  const sourceModule = normalizeText(body.source_module) || "manual_marketplace_pc";
  const sourceTable = normalizeText(body.source_table) || "xlsx:manual_marketplace_pc";
  const targetWorkspaceId = normalizeText(body.workspace_id) || normalizeText(body.target_workspace_id) || DEFAULT_TARGET_WORKSPACE_ID;
  const targetProjectId = normalizeText(body.project_id) || normalizeText(body.target_project_id) || DEFAULT_TARGET_PROJECT_ID;
  const targetBoardId = normalizeText(body.board_id) || normalizeText(body.target_board_id) || null;
  const targetBoardName = normalizeText(body.board_name) || normalizeText(body.target_board_name) || DEFAULT_TARGET_BOARD_NAME;
  const marketplaceColumnName = normalizeText(body.marketplace_column_name) || DEFAULT_MARKETPLACE_COLUMN_NAME;
  const pcColumnName = normalizeText(body.pc_column_name) || DEFAULT_PC_COLUMN_NAME;
  const marketplaceDueDate = plannedTaskDueDate(body, "marketplace_planned_upload_date");
  const pcDueDate = plannedTaskDueDate(body, "pc_planned_upload_date");
  const marketplaceResponsibilityZone = normalizedResponsibilityZone(body.marketplace_responsibility_zone || body.responsibility_zone);
  const pcResponsibilityZone = normalizedResponsibilityZone(body.pc_responsibility_zone || body.responsibility_zone);
  const fallbackDate = normalizeText(body.row_date || body.business_date || body.effective_date);
  const marketplaceDate = normalizeText(body.marketplace_business_date) || fallbackDate;
  const pcDate = normalizeText(body.pc_business_date) || fallbackDate;

  const marketplaceDateRows = marketplaceDate ? primary.rows.filter((row) => row.created_at_date === marketplaceDate) : primary.rows;
  const pcDateRows = pcDate ? primary.rows.filter((row) => row.created_at_date === pcDate) : primary.rows;
  const primaryRows = Array.from(new Set([...marketplaceDateRows, ...pcDateRows]));
  const specialMap = await loadSpecialShkMap(primaryRows.map((row) => row.product), body);
  const bufferRejectedRows = primaryRows.filter((row) => (isMarketplaceStatus(row) || isPcStatus(row)) && mxHasBuffer(row));
  const marketplaceRows = marketplaceDateRows.filter((row) => isMarketplaceStatus(row) && !mxHasBuffer(row));
  const pcRows = pcDateRows.filter((row) => isPcStatus(row) && !isMarketplaceStatus(row) && !mxHasBuffer(row));
  const tasks: PmTask[] = [];
  const skipped: JsonObject[] = bufferRejectedRows.map((row) => ({
    reason: "mx_contains_buffer",
    product: row.product,
    transfer: row.transfer,
    mx: row.mx,
    row_number: row.row_number,
  }));

  const marketplaceStats = appendGroupedManualTasks({
    rows: marketplaceRows,
    tasks,
    titlePrefix: "Маркетплейс",
    taskType: DEFAULT_MARKETPLACE_TASK_TYPE,
    routeKey: DEFAULT_MARKETPLACE_ROUTE_KEY,
    columnKey: "marketplace",
    sourcePrefix: "marketplace",
    dueDate: marketplaceDueDate,
    responsibilityZone: marketplaceResponsibilityZone,
    specialMap,
    allowMxGrouping: false,
    sourceModule,
    sourceTable,
    sourceGeneratedAt,
    targetWorkspaceId,
    targetProjectId,
    targetBoardId,
    targetBoardName,
    targetColumnName: marketplaceColumnName,
    body,
  });

  const pcStats = appendGroupedManualTasks({
    rows: pcRows,
    tasks,
    titlePrefix: "ПЦ",
    taskType: DEFAULT_PC_TASK_TYPE,
    routeKey: DEFAULT_PC_ROUTE_KEY,
    columnKey: "pc",
    sourcePrefix: "pc",
    dueDate: pcDueDate,
    responsibilityZone: pcResponsibilityZone,
    specialMap,
    allowMxGrouping: false,
    sourceModule,
    sourceTable,
    sourceGeneratedAt,
    targetWorkspaceId,
    targetProjectId,
    targetBoardId,
    targetBoardName,
    targetColumnName: pcColumnName,
    body,
  });

  const copiedTransferIds = Array.from(new Set(
    marketplaceRows.concat(pcRows).map((row) => row.transfer).filter(isGroupableIdentifier),
  )).sort((a, b) => a.localeCompare(b, "ru"));

  return {
    primary_rows: primaryRows,
    carrier_rows: carrier.rows,
    copied_transfer_ids: copiedTransferIds,
    excluded_transfers: [],
    tasks,
    skipped,
    summary: {
      primary_rows_count: primaryRows.length,
      source_primary_rows_count: primary.rows.length,
      date_filter: fallbackDate || null,
      marketplace_date_filter: marketplaceDate || null,
      pc_date_filter: pcDate || null,
      date_filtered_out_count: primary.rows.length - primaryRows.length,
      carrier_rows_count: carrier.rows.length,
      invalid_primary_rows_count: primary.invalidCount,
      invalid_carrier_rows_count: carrier.invalidCount,
      marketplace_rows_count: marketplaceRows.length,
      pc_rows_count: pcRows.length,
      mx_buffer_skipped_count: bufferRejectedRows.length,
      special_2shk_matches_count: specialMap.size,
      marketplace_transfer_count: Array.from(new Set(marketplaceRows.map((row) => row.transfer).filter(isGroupableIdentifier))).length,
      pc_transfer_count: Array.from(new Set(pcRows.map((row) => row.transfer).filter(isGroupableIdentifier))).length,
      marketplace_grouped_tare_count: marketplaceStats.groupedTareCount,
      marketplace_grouped_mx_count: marketplaceStats.groupedMxCount,
      marketplace_single_count: marketplaceStats.singleCount,
      pc_grouped_tare_count: pcStats.groupedTareCount,
      pc_grouped_mx_count: pcStats.groupedMxCount,
      pc_single_count: pcStats.singleCount,
      tasks_to_create_count: tasks.length,
      marketplace_tasks_count: tasks.filter((task) => task.task_type === DEFAULT_MARKETPLACE_TASK_TYPE).length,
      pc_tasks_count: tasks.filter((task) => task.task_type === DEFAULT_PC_TASK_TYPE).length,
    },
  };
}

async function buildWmiMpPcTasks(primaryRawRows: unknown[], carrierRawRows: unknown[], body: JsonObject): Promise<BuildResult> {
  const primary = normalizePrimaryRows(primaryRawRows);
  const carrier = normalizeCarrierRows(carrierRawRows);
  const datedPrimary = filterPrimaryRowsByBusinessDate(primary.rows, body);
  const sourceGeneratedAt = currentMoscowIso();
  const sourceModule = normalizeText(body.source_module) || "manual_wmi_mp_pc";
  const sourceTable = normalizeText(body.source_table) || "xlsx:manual_wmi_mp_pc";
  const targetWorkspaceId = normalizeText(body.workspace_id) || normalizeText(body.target_workspace_id) || DEFAULT_TARGET_WORKSPACE_ID;
  const targetProjectId = normalizeText(body.project_id) || normalizeText(body.target_project_id) || DEFAULT_TARGET_PROJECT_ID;
  const targetBoardId = normalizeText(body.board_id) || normalizeText(body.target_board_id) || null;
  const targetBoardName = normalizeText(body.board_name) || normalizeText(body.target_board_name) || DEFAULT_TARGET_BOARD_NAME;
  const targetColumnName = normalizeText(body.wmi_mp_pc_column_name) || normalizeText(body.target_column_name) || DEFAULT_WMI_MP_PC_COLUMN_NAME;
  const dueDate = plannedTaskDueDate(body);
  const responsibilityZone = normalizedResponsibilityZone(body.wmi_mp_pc_responsibility_zone || body.responsibility_zone);

  const primaryRows = datedPrimary.rows;
  const specialMap = await loadSpecialShkMap(primaryRows.map((row) => row.product), body);
  const wmiRows = primaryRows.filter(isWmiMpPcStatus);
  const tasks: PmTask[] = [];
  const skipped: JsonObject[] = [];
  const stats = appendGroupedManualTasks({
    rows: wmiRows,
    tasks,
    titlePrefix: "WMI (МП + ПЦ)",
    taskType: DEFAULT_WMI_MP_PC_TASK_TYPE,
    routeKey: DEFAULT_WMI_MP_PC_ROUTE_KEY,
    columnKey: "wmi_mp_pc",
    sourcePrefix: "wmi_mp_pc",
    dueDate,
    responsibilityZone,
    specialMap,
    sourceModule,
    sourceTable,
    sourceGeneratedAt,
    targetWorkspaceId,
    targetProjectId,
    targetBoardId,
    targetBoardName,
    targetColumnName,
    body,
  });

  const copiedTransferIds = Array.from(new Set(wmiRows.map((row) => row.transfer).filter(isGroupableIdentifier))).sort((a, b) => a.localeCompare(b, "ru"));
  return {
    primary_rows: primaryRows,
    carrier_rows: carrier.rows,
    copied_transfer_ids: copiedTransferIds,
    excluded_transfers: [],
    tasks,
    skipped,
    summary: {
      primary_rows_count: primaryRows.length,
      source_primary_rows_count: primary.rows.length,
      date_filter: datedPrimary.dateFilter || null,
      date_filtered_out_count: datedPrimary.filteredOutCount,
      carrier_rows_count: carrier.rows.length,
      invalid_primary_rows_count: primary.invalidCount,
      invalid_carrier_rows_count: carrier.invalidCount,
      wmi_mp_pc_rows_count: wmiRows.length,
      wmi_mp_pc_transfer_count: copiedTransferIds.length,
      wmi_mp_pc_grouped_tare_count: stats.groupedTareCount,
      wmi_mp_pc_grouped_mx_count: stats.groupedMxCount,
      wmi_mp_pc_single_count: stats.singleCount,
      special_2shk_matches_count: specialMap.size,
      tasks_to_create_count: tasks.length,
      wmi_mp_pc_tasks_count: tasks.length,
    },
  };
}

async function buildNoOrderTasks(primaryRawRows: unknown[], carrierRawRows: unknown[], body: JsonObject): Promise<BuildResult> {
  const primary = normalizePrimaryRows(primaryRawRows);
  const carrier = normalizeCarrierRows(carrierRawRows);
  const datedPrimary = filterPrimaryRowsByBusinessDate(primary.rows, body);
  const sourceGeneratedAt = currentMoscowIso();
  const sourceModule = normalizeText(body.source_module) || "manual_no_order";
  const sourceTable = normalizeText(body.source_table) || "xlsx:manual_no_order";
  const targetWorkspaceId = normalizeText(body.workspace_id) || normalizeText(body.target_workspace_id) || DEFAULT_TARGET_WORKSPACE_ID;
  const targetProjectId = normalizeText(body.project_id) || normalizeText(body.target_project_id) || DEFAULT_TARGET_PROJECT_ID;
  const targetBoardId = normalizeText(body.board_id) || normalizeText(body.target_board_id) || null;
  const targetBoardName = normalizeText(body.board_name) || normalizeText(body.target_board_name) || DEFAULT_TARGET_BOARD_NAME;
  const targetColumnName = normalizeText(body.no_order_column_name) || normalizeText(body.target_column_name) || DEFAULT_NO_ORDER_COLUMN_NAME;
  const hiddenColumnName = normalizeText(body.hidden_no_order_column_name) || DEFAULT_HIDDEN_NO_ORDER_COLUMN_NAME;
  const noOrderDueDate = plannedTaskDueDate(body, "no_order_planned_upload_date");
  const usdDueDate = plannedTaskDueDate(body, "usd_planned_upload_date");
  const tmmDueDate = plannedTaskDueDate(body, "tmm_planned_upload_date");
  const noOrderResponsibilityZone = normalizedResponsibilityZone(body.no_order_responsibility_zone || body.responsibility_zone);
  const usdResponsibilityZone = normalizedResponsibilityZone(body.usd_responsibility_zone || body.responsibility_zone);
  const tmmResponsibilityZone = normalizedResponsibilityZone(body.tmm_responsibility_zone || body.responsibility_zone);
  const identificationTagName = normalizeText(body.identification_tag_name) || DEFAULT_IDENTIFICATION_TAG_NAME;

  const primaryRows = datedPrimary.rows;
  const specialMap = await loadSpecialShkMap(primaryRows.map((row) => row.product), body);
  const usdRows = primaryRows.filter(isNoOrderUsdStatus);
  const tmmRows = primaryRows.filter(isNoOrderTmmStatus);
  const noOrderRows = primaryRows.filter((row) => !isNoOrderUsdStatus(row) && !isNoOrderTmmStatus(row));
  const tasks: PmTask[] = [];
  const skipped: JsonObject[] = [];
  const stats = appendGroupedManualTasks({
    rows: noOrderRows,
    tasks,
    titlePrefix: "Без заказа",
    taskType: DEFAULT_NO_ORDER_TASK_TYPE,
    routeKey: DEFAULT_NO_ORDER_ROUTE_KEY,
    columnKey: "no_order",
    sourcePrefix: "no_order",
    dueDate: noOrderDueDate,
    responsibilityZone: noOrderResponsibilityZone,
    specialMap,
    sourceModule,
    sourceTable,
    sourceGeneratedAt,
    targetWorkspaceId,
    targetProjectId,
    targetBoardId,
    targetBoardName,
    targetColumnName,
    body,
  });

  const usdStats = appendGroupedManualTasks({
    rows: usdRows,
    tasks,
    titlePrefix: "USD",
    taskType: DEFAULT_USD_TASK_TYPE,
    routeKey: DEFAULT_USD_ROUTE_KEY,
    columnKey: "usd",
    sourcePrefix: "usd",
    dueDate: usdDueDate,
    responsibilityZone: usdResponsibilityZone,
    forcedPriority: 2,
    targetTags: identificationTagName ? [{ name: identificationTagName }] : [],
    specialMap,
    allowMxGrouping: false,
    forceTareGrouping: true,
    sourceModule,
    sourceTable,
    sourceGeneratedAt,
    targetWorkspaceId,
    targetProjectId,
    targetBoardId,
    targetBoardName,
    targetColumnName: normalizeText(body.usd_column_name) || hiddenColumnName,
    body,
  });

  const tmmStats = appendGroupedManualTasks({
    rows: tmmRows,
    tasks,
    titlePrefix: "TMM",
    taskType: DEFAULT_TMM_TASK_TYPE,
    routeKey: DEFAULT_TMM_ROUTE_KEY,
    columnKey: "tmm",
    sourcePrefix: "tmm",
    dueDate: tmmDueDate,
    responsibilityZone: tmmResponsibilityZone,
    forcedPriority: 2,
    targetTags: identificationTagName ? [{ name: identificationTagName }] : [],
    specialMap,
    allowMxGrouping: false,
    forceTareGrouping: true,
    sourceModule,
    sourceTable,
    sourceGeneratedAt,
    targetWorkspaceId,
    targetProjectId,
    targetBoardId,
    targetBoardName,
    targetColumnName: normalizeText(body.tmm_column_name) || hiddenColumnName,
    body,
  });

  const copiedTransferIds = Array.from(new Set(primaryRows.map((row) => row.transfer).filter(isGroupableIdentifier))).sort((a, b) => a.localeCompare(b, "ru"));
  return {
    primary_rows: primaryRows,
    carrier_rows: carrier.rows,
    copied_transfer_ids: copiedTransferIds,
    excluded_transfers: [],
    tasks,
    skipped,
    summary: {
      primary_rows_count: primaryRows.length,
      source_primary_rows_count: primary.rows.length,
      date_filter: datedPrimary.dateFilter || null,
      date_filtered_out_count: datedPrimary.filteredOutCount,
      carrier_rows_count: carrier.rows.length,
      invalid_primary_rows_count: primary.invalidCount,
      invalid_carrier_rows_count: carrier.invalidCount,
      no_order_rows_count: noOrderRows.length,
      usd_rows_count: usdRows.length,
      tmm_rows_count: tmmRows.length,
      no_order_transfer_count: copiedTransferIds.length,
      no_order_grouped_tare_count: stats.groupedTareCount,
      no_order_grouped_mx_count: stats.groupedMxCount,
      no_order_single_count: stats.singleCount,
      usd_grouped_tare_count: usdStats.groupedTareCount,
      usd_single_count: usdStats.singleCount,
      tmm_grouped_tare_count: tmmStats.groupedTareCount,
      tmm_single_count: tmmStats.singleCount,
      special_2shk_matches_count: specialMap.size,
      tasks_to_create_count: tasks.length,
      no_order_tasks_count: tasks.filter((task) => task.task_type === DEFAULT_NO_ORDER_TASK_TYPE).length,
      usd_tasks_count: tasks.filter((task) => task.task_type === DEFAULT_USD_TASK_TYPE).length,
      tmm_tasks_count: tasks.filter((task) => task.task_type === DEFAULT_TMM_TASK_TYPE).length,
    },
  };
}

function filterAfterSaleMovementRowsByBusinessDate(rows: AfterSaleMovementRow[], body: JsonObject): { rows: AfterSaleMovementRow[]; dateFilter: string; filteredOutCount: number } {
  const dateFilter = normalizeText(body.row_date || body.business_date || body.effective_date);
  if (!dateFilter) return { rows, dateFilter: "", filteredOutCount: 0 };
  const filtered = rows.filter((row) => row.status_at_date === dateFilter);
  return { rows: filtered, dateFilter, filteredOutCount: rows.length - filtered.length };
}

function buildAfterSaleMovementDescription(row: AfterSaleMovementRow): string {
  return [
    `Тип задания: ${DEFAULT_AFTER_SALE_MOVEMENT_TASK_TYPE}`,
    "",
    "Инфо по заданию:",
    `Искомый ШК: ${row.product}`,
    `Дата реализации: ${row.realized_at_label || row.realized_at_raw || "-"}`,
    `Статус после реализации: ${row.status || "-"}`,
    `Дата статуса: ${row.status_at_label || row.status_at_raw || "-"}`,
    `МХ: ${row.mx || "-"}`,
    `Тара: ${row.tare || "-"}`,
    `Сотрудник: ${row.employee || "-"}`,
    `ID сотрудника: ${row.employee_id || "-"}`,
  ].join("\n");
}

async function buildAfterSaleMovementTasks(primaryRawRows: unknown[], carrierRawRows: unknown[], body: JsonObject): Promise<BuildResult> {
  const primary = normalizeAfterSaleMovementRows(primaryRawRows);
  const carrier = normalizeCarrierRows(carrierRawRows);
  const datedPrimary = filterAfterSaleMovementRowsByBusinessDate(primary.rows, body);
  const sourceGeneratedAt = currentMoscowIso();
  const sourceModule = normalizeText(body.source_module) || "manual_after_sale_movement";
  const sourceTable = normalizeText(body.source_table) || "xlsx:manual_after_sale_movement";
  const targetWorkspaceId = normalizeText(body.workspace_id) || normalizeText(body.target_workspace_id) || DEFAULT_TARGET_WORKSPACE_ID;
  const targetProjectId = normalizeText(body.project_id) || normalizeText(body.target_project_id) || DEFAULT_TARGET_PROJECT_ID;
  const targetBoardId = normalizeText(body.board_id) || normalizeText(body.target_board_id) || null;
  const targetBoardName = normalizeText(body.board_name) || normalizeText(body.target_board_name) || DEFAULT_TARGET_BOARD_NAME;
  const targetColumnName = normalizeText(body.after_sale_movement_column_name) || normalizeText(body.target_column_name) || DEFAULT_AFTER_SALE_MOVEMENT_COLUMN_NAME;
  const dueDate = plannedTaskDueDate(body);
  const responsibilityZone = normalizedResponsibilityZone(body.after_sale_movement_responsibility_zone || body.responsibility_zone);

  const rows = datedPrimary.rows;
  const specialMap = await loadSpecialShkMap(rows.map((row) => row.product), body);
  const tasks: PmTask[] = [];
  const skipped: JsonObject[] = [];
  const seenProducts = new Set<string>();
  let duplicateProductCount = 0;
  let missingStatusDateCount = 0;

  for (const row of rows) {
    if (seenProducts.has(row.product)) {
      duplicateProductCount += 1;
      skipped.push({ reason: "duplicate_product", product: row.product, row_number: row.row_number });
      continue;
    }
    seenProducts.add(row.product);
    if (!row.status_at_date) missingStatusDateCount += 1;
    const specialInfos = specialInfoForProducts([row.product], specialMap);

    tasks.push({
      source_module: sourceModule,
      source_table: sourceTable,
      source_id: row.product,
      source_row_id: row.row_number === null ? null : String(row.row_number),
	      source_payload: {
	        entity_type: "product",
	        description_task_type: DEFAULT_AFTER_SALE_MOVEMENT_TASK_TYPE,
	        row: compactAfterSaleMovementRow(row),
	        status_at_date: row.status_at_date,
	      },
      source_generated_at: sourceGeneratedAt,
      source_shk_ids: [row.product],
      source_tare_id: isGroupableIdentifier(row.tare) ? row.tare : null,
      source_price_sum: null,
      source_last_movement_at: row.status_at_iso,
      search_text: buildSearchText([row.product, row.tare, row.mx, row.status, row.employee, DEFAULT_AFTER_SALE_MOVEMENT_TASK_TYPE]),
      task_type: DEFAULT_AFTER_SALE_MOVEMENT_TASK_TYPE,
      board_key: DEFAULT_AFTER_SALE_MOVEMENT_ROUTE_KEY,
      column_key: "after_sale_movement",
	      title: truncateText(`Движение после продажи | ${row.product}`),
	      description: withSpecialDescription(buildAfterSaleMovementDescription(row), specialInfos),
	      priority: priceBasedPriority(null),
	      due_date: dueDate,
	      responsibility_zone: responsibilityZone,
      target_workspace_id: targetWorkspaceId,
      target_project_id: targetProjectId,
      target_board_id: targetBoardId,
      target_board_name: targetBoardName,
      target_column_id: null,
      target_column_name: targetColumnName,
	      target_custom_fields: buildTargetCustomFields(DEFAULT_AFTER_SALE_MOVEMENT_TASK_TYPE, null, body),
      target_tags: mergeTargetTags([], specialInfos),
      enabled: taskEnabledForUpload(body),
      master_action: masterActionForUpload(body),
    });
  }

  return {
    primary_rows: rows,
    carrier_rows: carrier.rows,
    copied_transfer_ids: [],
    excluded_transfers: [],
    tasks,
    skipped,
    summary: {
      primary_rows_count: rows.length,
      source_primary_rows_count: primary.rows.length,
      date_filter: datedPrimary.dateFilter || null,
      date_filtered_out_count: datedPrimary.filteredOutCount,
      carrier_rows_count: carrier.rows.length,
      invalid_primary_rows_count: primary.invalidCount,
      invalid_carrier_rows_count: carrier.invalidCount,
      after_sale_movement_rows_count: rows.length,
      duplicate_product_count: duplicateProductCount,
      missing_status_date_count: missingStatusDateCount,
      special_2shk_matches_count: specialMap.size,
      tasks_to_create_count: tasks.length,
      after_sale_movement_tasks_count: tasks.length,
    },
  };
}

async function buildTasks(primaryRawRows: unknown[], carrierRawRows: unknown[], body: JsonObject): Promise<BuildResult> {
  const mode = normalizeForMatch(body.mode || body.task_family || body.upload_type || body.source_module);
  if (mode.includes("after_sale_movement") || mode.includes("manual_after_sale_movement") || mode.includes("движение после продажи")) {
    return await buildAfterSaleMovementTasks(primaryRawRows, carrierRawRows, body);
  }
  if (mode.includes("no_order") || mode.includes("manual_no_order") || mode.includes("без заказа")) {
    return await buildNoOrderTasks(primaryRawRows, carrierRawRows, body);
  }
  if (mode.includes("wmi_mp_pc") || mode.includes("manual_wmi_mp_pc") || mode.includes("wmi (мп")) {
    return await buildWmiMpPcTasks(primaryRawRows, carrierRawRows, body);
  }
  if (mode.includes("marketplace") || mode.includes("маркетплейс") || mode.includes("manual_marketplace_pc")) {
    return await buildMarketplacePcTasks(primaryRawRows, carrierRawRows, body);
  }
  if (mode.includes("presort") || mode.includes("предсорт") || mode.includes("manual_presort_opp")) {
    return await buildPresortTasks(primaryRawRows, carrierRawRows, body);
  }
  return await buildPmBufferTasks(primaryRawRows, carrierRawRows, body);
}

type TraceMark = (stage: string, extra?: JsonObject) => void;

async function upsertTasks(tasks: PmTask[], mark?: TraceMark, debugProfile = false): Promise<number> {
  let upserted = 0;
  for (let offset = 0; offset < tasks.length; offset += RPC_BATCH_SIZE) {
    const batch = tasks.slice(offset, offset + RPC_BATCH_SIZE);
    const batchIndex = Math.floor(offset / RPC_BATCH_SIZE) + 1;
    const batchStarted = performance.now();
    mark?.("upsert_batch_start", {
      batch_index: batchIndex,
      batch_rows: batch.length,
      batch_offset: offset,
      ...(debugProfile ? { batch_json_bytes: jsonByteLength(batch) } : {}),
    });
    const { data, error } = await supabase.rpc("upsert_weeek_tasks_basic_from_json", { p_tasks: batch });
    if (error) throw new Error(`Failed to upsert rows into weeek_tasks_basic: ${error.message}`);
    upserted += Number(data ?? batch.length);
    mark?.("upsert_batch_done", {
      batch_index: batchIndex,
      batch_rows: batch.length,
      upserted_total: upserted,
      batch_elapsed_ms: elapsedMs(batchStarted),
    });
  }
  return upserted;
}

async function readUploadRun(sourceModule: string, uploadType: string, effectiveDate: string): Promise<JsonObject | null> {
  const { data, error } = await supabase
    .from(UPLOAD_RUNS_TABLE)
    .select("*")
    .eq("source_module", sourceModule)
    .eq("upload_type", uploadType)
    .eq("effective_date", effectiveDate)
    .maybeSingle();
  if (error) throw new Error(`Failed to read manual upload run: ${error.message}`);
  return (data as JsonObject | null) ?? null;
}

async function writeUploadRun(params: {
  sourceModule: string;
  uploadType: string;
  uploadDate: string;
  businessDate: string | null;
  fileName: string;
  secondaryFileName: string;
  rowsCount: number;
  tasksCount: number;
  upsertedCount: number;
  processedCount: number;
  failedCount: number;
  summary: JsonObject;
  response: JsonObject;
}): Promise<JsonObject | null> {
  const payload = {
    upload_date: params.uploadDate,
    effective_date: params.businessDate || params.uploadDate,
    business_date: params.businessDate,
    source_module: params.sourceModule,
    upload_type: params.uploadType,
    status: params.failedCount > 0 ? "completed_with_errors" : "completed",
    file_name: params.fileName || null,
    secondary_file_name: params.secondaryFileName || null,
    rows_count: params.rowsCount,
    tasks_count: params.tasksCount,
    upserted_count: params.upsertedCount,
    processed_count: params.processedCount,
    failed_count: params.failedCount,
    summary: params.summary,
    response: params.response,
  };
  const { data, error } = await supabase
    .from(UPLOAD_RUNS_TABLE)
    .upsert(payload, { onConflict: "effective_date,source_module,upload_type" })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to write manual upload run: ${error.message}`);
  return (data as JsonObject | null) ?? null;
}

async function callTaskMaster(body: JsonObject): Promise<JsonObject> {
  const masterSecret = normalizeText(Deno.env.get("WEEEK_TASK_MASTER_SECRET") || FUNCTION_SECRET);
  if (!masterSecret) throw new Error("Missing WEEEK_TASK_MASTER_SECRET for process_queue");
  const response = await fetch(`${SUPABASE_URL}/functions/v1/weeek-task-master-basic`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: masterSecret, ...body }),
  });
  const text = await response.text();
  let parsed: JsonObject = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (_error) {
    throw new Error(`weeek-task-master-basic returned non-JSON response: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  if (!response.ok || parsed.ok === false) {
    throw new Error(`weeek-task-master-basic failed: ${normalizeText(parsed.error) || `HTTP ${response.status}`}`);
  }
  return parsed;
}

async function processAll(body: JsonObject, dryRun: boolean): Promise<JsonObject> {
  const limit = Math.min(Math.max(normalizeInteger(body.limit, 50), 1), 50);
  const maxBatches = Math.min(Math.max(normalizeInteger(body.max_batches, 20), 1), 50);
  const batches: JsonObject[] = [];
  let processedCount = 0;
  let failedCount = 0;
  let selectedCount = 0;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const masterResponse = await callTaskMaster({
      action: "process_queue",
      dry_run: dryRun,
      source_module: normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE,
      limit,
    });
    batches.push(masterResponse);
    const selectedRows = Number(masterResponse.selected_rows ?? 0);
    selectedCount += selectedRows;
    processedCount += Number(masterResponse.processed_count ?? 0);
    failedCount += Number(masterResponse.failed_count ?? 0);
    if (selectedRows < limit || selectedRows === 0) break;
  }

  return { batch_count: batches.length, selected_count: selectedCount, processed_count: processedCount, failed_count: failedCount, batches };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed. Use POST." });

  const startedAt = new Date().toISOString();
  const traceStart = performance.now();
  const debugTrace: JsonObject[] = [];
  let debugProfile = false;
  let traceSourceModule = "";
  let traceAction = "";
  const mark: TraceMark = (stage, extra = {}) => {
    const entry: JsonObject = {
      stage,
      elapsed_ms: elapsedMs(traceStart),
      source_module: traceSourceModule || undefined,
      action: traceAction || undefined,
      ...extra,
    };
    debugTrace.push(entry);
    if (debugProfile) {
      try {
        console.log(JSON.stringify({ event: "weeek_pm_buffer_upload_trace", ...entry }));
      } catch (_error) {
        console.log(`weeek_pm_buffer_upload_trace ${stage}`);
      }
    }
  };
  try {
    mark("request_read_start");
    const raw = await req.json().catch(() => ({}));
    const body = asObject(raw) ?? {};
    debugProfile = normalizeBoolean(body.debug_profile, false);
    if (FUNCTION_SECRET && normalizeText(body.secret) !== FUNCTION_SECRET) {
      return json(401, { ok: false, error: "Invalid PM buffer upload secret" });
    }

    const action = normalizeText(body.action) || "preview";
    const dryRun = normalizeBoolean(body.dry_run, action === "preview");
    const sourceModule = normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE;
    const uploadType = normalizeText(body.upload_type) || DEFAULT_UPLOAD_TYPE;
    const uploadDate = normalizeText(body.upload_date) || currentMoscowDate();
    const effectiveDate = normalizeText(body.effective_date) || normalizeText(body.business_date) || uploadDate;
    traceSourceModule = sourceModule;
    traceAction = action;
    mark("request_parsed", {
      upload_type: uploadType,
      effective_date: effectiveDate,
      debug_profile: debugProfile,
    });

    if (["status", "upload_status", "run_status"].includes(action)) {
      const run = await readUploadRun(sourceModule, uploadType, effectiveDate);
      return json(200, {
        ok: true,
        action: "status",
        source_module: sourceModule,
        upload_type: uploadType,
        upload_date: uploadDate,
        effective_date: effectiveDate,
        exists: Boolean(run),
        run,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }

    if (action === "process_queue") {
      const master = normalizeBoolean(body.process_all, true)
        ? await processAll(body, dryRun)
        : await callTaskMaster({ action: "process_queue", dry_run: dryRun, source_module: sourceModule, limit: Math.min(Math.max(normalizeInteger(body.limit, 50), 1), 50) });
      return json(200, { ok: true, action, target_table: "weeek_tasks_basic", started_at: startedAt, finished_at: new Date().toISOString(), master });
    }

    const primaryRows = Array.isArray(body.primary_rows) ? body.primary_rows : Array.isArray(body.rows) ? body.rows : [];
    const carrierRows = Array.isArray(body.carrier_rows) ? body.carrier_rows : [];
    if (!primaryRows.length) return json(400, { ok: false, error: "primary_rows must be a non-empty array" });
    mark("input_rows_ready", {
      primary_rows_count: primaryRows.length,
      carrier_rows_count: carrierRows.length,
      ...(debugProfile ? {
        primary_rows_json_bytes: jsonByteLength(primaryRows),
        carrier_rows_json_bytes: jsonByteLength(carrierRows),
      } : {}),
    });

    const buildStarted = performance.now();
    const result = await buildTasks(primaryRows, carrierRows, body);
    mark("tasks_built", {
      build_elapsed_ms: elapsedMs(buildStarted),
      tasks_count: result.tasks.length,
      skipped_count: result.skipped.length,
      ...(debugProfile ? { task_stats: taskDebugStats(result.tasks) } : {}),
    });
    let assignment: JsonObject = { shift_found: false, assigned_count: 0 };
    try {
      const shiftAssignees = await resolveShiftAssignees(body);
      const assignedCount = applyImmediateAssignees(result.tasks, shiftAssignees);
      assignment = {
        ...shiftAssignees,
        assigned_count: assignedCount,
      };
      mark("assignees_resolved", assignment);
    } catch (error) {
      assignment = {
        shift_found: false,
        assigned_count: 0,
        error: String(error instanceof Error ? error.message : error),
      };
      mark("assignees_resolve_failed", assignment);
    }
    const sampleTasks = result.tasks.slice(0, Math.min(result.tasks.length, 10)).map((task) => ({
      source_id: task.source_id,
      title: task.title,
      task_type: task.task_type,
      due_date: task.due_date,
      source_tare_id: task.source_tare_id,
      source_shk_ids: task.source_shk_ids,
      source_price_sum: task.source_price_sum,
      target_column_name: task.target_column_name,
      target_tags: task.target_tags,
      responsibility_zone: task.responsibility_zone,
      target_assignee_ids: task.target_assignee_ids ?? [],
    }));

    if (action === "copy_transfers") {
      return json(200, {
        ok: true,
        action,
        copied_transfer_ids: result.copied_transfer_ids,
        copied_transfer_count: result.copied_transfer_ids.length,
        summary: result.summary,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }

    if (action === "preview" || dryRun) {
      return json(200, {
        ok: true,
        action: "preview",
        dry_run: true,
        target_table: "weeek_tasks_basic",
        summary: result.summary,
        assignment,
        copied_transfer_ids: result.copied_transfer_ids,
        sample_tasks: sampleTasks,
        skipped_sample: result.skipped.slice(0, 20),
        ...(debugProfile ? { debug_trace: debugTrace, debug_stats: taskDebugStats(result.tasks) } : {}),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }

    if (!["upload", "upsert", "queue"].includes(action)) {
      return json(400, { ok: false, error: `Unsupported action: ${action}` });
    }

    mark("upsert_start", { tasks_count: result.tasks.length, rpc_batch_size: RPC_BATCH_SIZE });
    const upsertStarted = performance.now();
    const upsertedCount = await upsertTasks(result.tasks, mark, debugProfile);
    mark("upsert_done", { upserted_count: upsertedCount, upsert_elapsed_ms: elapsedMs(upsertStarted) });
    const master = normalizeBoolean(body.process_queue, false) && result.tasks.length
      ? await processAll({ ...body, source_module: sourceModule }, false)
      : null;

    const processedCount = Number(master?.processed_count ?? 0);
    const failedCount = Number(master?.failed_count ?? 0);
    const responseBody: JsonObject = {
      ok: true,
      action: "upload",
      dry_run: false,
      target_table: "weeek_tasks_basic",
      upserted_count: upsertedCount,
      summary: result.summary,
      assignment,
      sample_tasks: sampleTasks,
      skipped_sample: result.skipped.slice(0, 20),
      master,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    if (debugProfile) {
      responseBody.debug_trace = debugTrace;
      responseBody.debug_stats = taskDebugStats(result.tasks);
    }
    mark("upload_run_start", {
      rows_count: result.primary_rows.length,
      tasks_count: result.tasks.length,
    });
    const uploadRunStarted = performance.now();
    const uploadRun = await writeUploadRun({
      sourceModule,
      uploadType,
      uploadDate,
      businessDate: normalizeText(body.business_date) || effectiveDate || null,
      fileName: normalizeText(body.primary_file_name || body.file_name),
      secondaryFileName: normalizeText(body.carrier_file_name),
      rowsCount: result.primary_rows.length,
      tasksCount: result.tasks.length,
      upsertedCount,
      processedCount,
      failedCount,
      summary: result.summary,
      response: responseBody,
    });
    mark("upload_run_done", { upload_run_elapsed_ms: elapsedMs(uploadRunStarted) });
    if (debugProfile) {
      responseBody.debug_trace = debugTrace;
    }

    return json(200, { ...responseBody, upload_run: uploadRun });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(debugProfile ? { debug_trace: debugTrace } : {}),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  }
});
