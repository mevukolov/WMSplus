import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type EmployeeRow = {
  id: string;
  employee_id: string;
  full_name: string;
  telegram: string | null;
  weeek_user_id: string | null;
  is_active: boolean;
};

type ShiftEmployee = Pick<EmployeeRow, "id" | "employee_id" | "full_name">;

type ShiftRow = {
  id: string;
  wh_id: string;
  shift_date: string;
  shift_key: string;
  shift_label: string;
  status: string;
  incoming_employee_id: string;
  outgoing_employee_id: string;
  incoming_process: string;
  outgoing_process: string;
  file_uploaded: boolean;
  file_name: string | null;
  opened_at: string;
  opened_by: string | null;
  source: string;
  payload: JsonObject | null;
  incoming_employee?: ShiftEmployee | null;
  outgoing_employee?: ShiftEmployee | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_SECRET = Deno.env.get("WEEEK_SHIFT_OPENING_SECRET");

const DEFAULT_WH_ID = "50144199";
const DEFAULT_TIMEZONE = "Europe/Moscow";
const EMPLOYEES_TABLE = "weeek_employees";
const SHIFTS_TABLE = "weeek_shifts";
const TABLE_PURE_LOSSES = "pure_losses_rep";
const TABLE_LOSSES = "losses_rep";
const PURE_URL_FILTER_CHUNK_SIZE = 80;
const PURE_INSERT_CHUNK_SIZE = 400;
const AUTO_FOUND_DECISION = "Найден";
const AUTO_FOUND_EMP_ID = "2405";
const AUTO_FOUND_COMMENT = "У товара есть движение";
const PURE_DECISION_COLUMN = "opp_deecision";
const PURE_EMP_COLUMN = "opp_emp";
const PURE_COMMENT_COLUMN = "opp_comment";

const PURE_COLUMN_VARIANTS = {
  shk: ["ШК", "shk", "Шк", "Штрихкод"],
  nm: ["ID номенклатуры", "ID Номенклатуры", "ID НМ", "nm"],
  decription: ["Наименования товара", "Наименование товара", "Товар"],
  brand: ["Наименования бренда", "Наименование бренда", "Бренд"],
  shk_state_before_lost: ["Статус перед списанием", "Статус ШК перед списанием"],
  wh_id: ["ID офиса", "ID офиса статуса перед списанием", "ID офиса статуса перед списания", "wh_id"],
  date_lost: ["Дата последнего списания", "date_lost"],
  lr: ["Лостризон последнего списания", "ЛР последнего списания", "ID списания"],
  price: ["Сумма списания", "Сумма"],
  posted_flag: ["Флаг оприходования", "Оприходовано", "Флаг оприходован"],
} as const;

const NORMALIZED_PURE_COLUMN_VARIANTS = Object.fromEntries(
  Object.entries(PURE_COLUMN_VARIANTS).map(([key, variants]) => [
    key,
    variants.map(normalizeHeaderKey),
  ]),
) as Record<keyof typeof PURE_COLUMN_VARIANTS, string[]>;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function json(status: number, body: JsonObject) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
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

function normalizeSecret(value: unknown): string {
  const raw = normalizeText(value);
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

function normalizeBoolean(value: unknown, fallbackValue = false): boolean {
  if (typeof value === "boolean") return value;
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return fallbackValue;
  if (["1", "true", "yes", "y", "да"].includes(raw)) return true;
  if (["0", "false", "no", "n", "нет"].includes(raw)) return false;
  return fallbackValue;
}

function normalizeHeaderKey(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/ё/g, "е")
    .replace(/['"`]/g, "")
    .replace(/[()[\]]/g, "")
    .replace(/[\s_-]+/g, "");
}

function normalizeToken(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value);
    return String(value).replace(/\.0+$/, "");
  }

  const raw = String(value).trim();
  if (!raw) return "";

  const compact = raw.replace(/\s+/g, "");
  if (/^-?\d+\.0+$/.test(compact)) return compact.replace(/\.0+$/, "");
  return compact;
}

function normalizeShk(value: unknown): string {
  return normalizeToken(value);
}

function toIntegerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);

  const raw = String(value)
    .trim()
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".");

  if (!raw) return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = String(value)
    .trim()
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "");

  if (!raw) return null;

  let normalized = raw;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  if (hasComma && hasDot) {
    const lastComma = raw.lastIndexOf(",");
    const lastDot = raw.lastIndexOf(".");
    normalized = lastComma > lastDot
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (hasComma) {
    normalized = raw.replace(",", ".");
  }

  normalized = normalized.replace(/[^\d.-]/g, "");
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLossReason(value: unknown): string {
  const token = normalizeToken(value);
  if (!token) return "";

  if (/^-?\d+$/.test(token)) return String(parseInt(token, 10));

  const intValue = toIntegerOrNull(token);
  if (intValue !== null) return String(intValue);

  return token;
}

function isTrueLike(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;

  const normalized = String(value).trim().toLowerCase();
  return normalized === "true"
    || normalized === "1"
    || normalized === "yes"
    || normalized === "да";
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

function moscowTodayIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
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

function formatRuDate(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : isoDate;
}

function addIsoDays(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join("-");
}

function parseExcelDateValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpochOffset = 25569;
    const dayMs = 86400 * 1000;
    const ts = (Math.floor(value) - excelEpochOffset) * dayMs;
    const date = new Date(ts);
    if (!Number.isNaN(date.getTime())) {
      return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const datePart = raw.replace("T", " ").split(" ")[0];

  let match = datePart.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const date = new Date(year, Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  match = datePart.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  return null;
}

function formatIsoDateFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function shiftDateFromBody(body: JsonObject): string {
  return normalizeIsoDate(body.shift_date ?? body.date) || moscowTodayIso();
}

function assertSecret(body: JsonObject): void {
  if (!FUNCTION_SECRET) return;
  const expected = normalizeSecret(FUNCTION_SECRET);
  const provided = normalizeSecret(body.secret ?? body.token);
  if (provided !== expected) throw new Error("Invalid shift opening secret");
}

function publicEmployee(row: EmployeeRow): ShiftEmployee {
  return {
    id: row.id,
    employee_id: row.employee_id,
    full_name: row.full_name,
  };
}

async function fetchEmployees(): Promise<ShiftEmployee[]> {
  const { data, error } = await supabase
    .from(EMPLOYEES_TABLE)
    .select("id,employee_id,full_name,telegram,weeek_user_id,is_active")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) throw new Error(`Employees fetch failed: ${error.message}`);
  return ((data || []) as EmployeeRow[]).map(publicEmployee);
}

async function fetchEmployeeById(id: string): Promise<EmployeeRow> {
  const { data, error } = await supabase
    .from(EMPLOYEES_TABLE)
    .select("id,employee_id,full_name,telegram,weeek_user_id,is_active")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(`Employee fetch failed: ${error.message}`);
  if (!data) throw new Error(`Активный сотрудник не найден: ${id}`);
  return data as EmployeeRow;
}

async function fetchEmployeesByIds(ids: string[]): Promise<Map<string, ShiftEmployee>> {
  const cleanIds = Array.from(new Set(ids.map(normalizeText).filter(Boolean)));
  if (!cleanIds.length) return new Map();

  const { data, error } = await supabase
    .from(EMPLOYEES_TABLE)
    .select("id,employee_id,full_name,telegram,weeek_user_id,is_active")
    .in("id", cleanIds);

  if (error) throw new Error(`Shift employees fetch failed: ${error.message}`);
  return new Map(((data || []) as EmployeeRow[]).map((row) => [row.id, publicEmployee(row)]));
}

async function fetchShift(whId: string, shiftDate: string): Promise<ShiftRow | null> {
  const { data, error } = await supabase
    .from(SHIFTS_TABLE)
    .select(
      [
        "id",
        "wh_id",
        "shift_date",
        "shift_key",
        "shift_label",
        "status",
        "incoming_employee_id",
        "outgoing_employee_id",
        "incoming_process",
        "outgoing_process",
        "file_uploaded",
        "file_name",
        "opened_at",
        "opened_by",
        "source",
        "payload",
      ].join(","),
    )
    .eq("wh_id", whId)
    .eq("shift_date", shiftDate)
    .neq("status", "cancelled")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Shift fetch failed: ${error.message}`);
  const shift = (data as ShiftRow | null) || null;
  if (!shift) return null;

  const employees = await fetchEmployeesByIds([shift.incoming_employee_id, shift.outgoing_employee_id]);
  shift.incoming_employee = employees.get(shift.incoming_employee_id) || null;
  shift.outgoing_employee = employees.get(shift.outgoing_employee_id) || null;
  return shift;
}

async function assignShiftTasks(whId: string, shiftDate: string, allowAfterCutoff = false): Promise<JsonObject> {
  const { data, error } = await supabase.rpc("assign_weeek_shift_task_assignees", {
    p_wh_id: whId,
    p_shift_date: shiftDate,
    p_allow_after_cutoff: allowAfterCutoff,
  });

  if (error) throw new Error(`Shift task assignment failed: ${error.message}`);
  return asObject(data);
}

function normalizePureRows(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => row as JsonObject);
}

function buildNormalizedPureRow(row: JsonObject): JsonObject {
  const output: JsonObject = {};
  Object.keys(row || {}).forEach((key) => {
    output[normalizeHeaderKey(key)] = row[key];
  });
  return output;
}

function getPureCellValue(rawRow: JsonObject, normalizedRow: JsonObject, columnKey: keyof typeof PURE_COLUMN_VARIANTS): unknown {
  const variants = PURE_COLUMN_VARIANTS[columnKey] || [];
  for (const name of variants) {
    if (Object.prototype.hasOwnProperty.call(rawRow, name)) return rawRow[name];
  }

  const normalizedVariants = NORMALIZED_PURE_COLUMN_VARIANTS[columnKey] || [];
  for (const normalized of normalizedVariants) {
    if (Object.prototype.hasOwnProperty.call(normalizedRow, normalized)) return normalizedRow[normalized];
  }

  return "";
}

function buildPureRowKey(shkValue: unknown, dateLostValue: unknown, whIdValue: unknown): string {
  return `${normalizeShk(shkValue)}|${normalizeToken(dateLostValue)}|${normalizeToken(whIdValue)}`;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const out: T[][] = [];
  const size = Math.max(Number(chunkSize || 1), 1);
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function addPureCounter(map: Map<string, { count: number; price: number }>, keyValue: unknown, priceValue: unknown): void {
  const key = normalizeText(keyValue) || "Не указано";
  const price = toNumberOrNull(priceValue) ?? 0;
  const current = map.get(key) || { count: 0, price: 0 };
  current.count += 1;
  current.price += price;
  map.set(key, current);
}

function pureCounterRows(map: Map<string, { count: number; price: number }>): JsonObject[] {
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, count: value.count, price: value.price }))
    .sort((left, right) => Number(right.count) - Number(left.count) || normalizeText(left.name).localeCompare(normalizeText(right.name), "ru"));
}

async function loadAutoLossReasonIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from(TABLE_LOSSES)
    .select("writeoff_id,is_auto");

  if (error) throw new Error(`Не удалось загрузить справочник losses_rep (writeoff_id/is_auto): ${error.message}`);

  const autoIds = new Set<string>();
  ((data || []) as JsonObject[]).forEach((row) => {
    if (!isTrueLike(row?.is_auto)) return;
    const normalized = normalizeLossReason(row?.writeoff_id);
    if (normalized) autoIds.add(normalized);
  });
  return autoIds;
}

function preparePureLossesRows(rows: JsonObject[], whId: string, targetDate: string, autoLrSet: Set<string>) {
  const rowsByKey = new Map<string, JsonObject>();
  const postedRowsByKey = new Map<string, JsonObject>();
  const byLr = new Map<string, { count: number; price: number }>();
  const byStatusBeforeLost = new Map<string, { count: number; price: number }>();
  const stats = {
    source_total_rows: rows.length,
    target_date_rows: 0,
    wh_matched_rows: 0,
    auto_lr_matched_rows: 0,
    candidate_rows: 0,
    candidate_sum_price: 0,
    posted_signals: 0,
    skipped_by_date: 0,
    skipped_by_wh: 0,
    skipped_posted_flag: 0,
    skipped_by_is_auto: 0,
    skipped_invalid: 0,
    duplicate_in_file_ignored: 0,
    by_lr: [] as JsonObject[],
    by_status_before_lost: [] as JsonObject[],
  };

  for (const row of rows) {
    const normalizedRow = buildNormalizedPureRow(row);
    const dateObj = parseExcelDateValue(getPureCellValue(row, normalizedRow, "date_lost"));
    if (!dateObj) {
      stats.skipped_invalid += 1;
      continue;
    }

    const dateLost = formatIsoDateFromDate(dateObj);
    if (dateLost !== targetDate) {
      stats.skipped_by_date += 1;
      continue;
    }
    stats.target_date_rows += 1;

    const rowWhId = normalizeToken(getPureCellValue(row, normalizedRow, "wh_id"));
    if (!rowWhId || rowWhId !== whId) {
      stats.skipped_by_wh += 1;
      continue;
    }
    stats.wh_matched_rows += 1;

    const lrRaw = getPureCellValue(row, normalizedRow, "lr");
    const lr = normalizeLossReason(lrRaw);
    if (!lr || !autoLrSet.has(lr)) {
      stats.skipped_by_is_auto += 1;
      continue;
    }
    stats.auto_lr_matched_rows += 1;

    const shk = normalizeShk(getPureCellValue(row, normalizedRow, "shk"));
    if (!shk) {
      stats.skipped_invalid += 1;
      continue;
    }

    const rowKey = buildPureRowKey(shk, dateLost, rowWhId);
    const postedFlag = getPureCellValue(row, normalizedRow, "posted_flag");
    if (isTrueLike(postedFlag)) {
      stats.skipped_posted_flag += 1;
      rowsByKey.delete(rowKey);
      if (postedRowsByKey.has(rowKey)) {
        stats.duplicate_in_file_ignored += 1;
        continue;
      }
      postedRowsByKey.set(rowKey, { shk, wh_id: rowWhId, date_lost: dateLost });
      continue;
    }

    if (postedRowsByKey.has(rowKey)) {
      stats.duplicate_in_file_ignored += 1;
      continue;
    }

    const incoming = {
      shk,
      nm: toIntegerOrNull(getPureCellValue(row, normalizedRow, "nm")),
      decription: normalizeText(getPureCellValue(row, normalizedRow, "decription")),
      brand: normalizeText(getPureCellValue(row, normalizedRow, "brand")),
      shk_state_before_lost: normalizeText(getPureCellValue(row, normalizedRow, "shk_state_before_lost")),
      wh_id: rowWhId,
      date_lost: dateLost,
      lr: toIntegerOrNull(lrRaw) ?? toIntegerOrNull(lr) ?? lr,
      price: toNumberOrNull(getPureCellValue(row, normalizedRow, "price")) ?? 0,
    };

    if (rowsByKey.has(rowKey)) {
      stats.duplicate_in_file_ignored += 1;
      continue;
    }
    rowsByKey.set(rowKey, incoming);
  }

  rowsByKey.forEach((row) => {
    stats.candidate_sum_price += toNumberOrNull(row.price) ?? 0;
    addPureCounter(byLr, row.lr, row.price);
    addPureCounter(byStatusBeforeLost, row.shk_state_before_lost, row.price);
  });

  stats.candidate_rows = rowsByKey.size;
  stats.posted_signals = postedRowsByKey.size;
  stats.by_lr = pureCounterRows(byLr);
  stats.by_status_before_lost = pureCounterRows(byStatusBeforeLost);

  return { rowsByKey, postedRowsByKey, stats };
}

function collectPureShks(prepared: { rowsByKey: Map<string, JsonObject>; postedRowsByKey: Map<string, JsonObject> }): string[] {
  const shks = new Set<string>();
  prepared.rowsByKey.forEach((row) => {
    const shk = normalizeShk(row?.shk);
    if (shk) shks.add(shk);
  });
  prepared.postedRowsByKey.forEach((row) => {
    const shk = normalizeShk(row?.shk);
    if (shk) shks.add(shk);
  });
  return Array.from(shks);
}

async function fetchPureRowsByShkChunk(shksChunk: string[], whId: string, targetDate: string): Promise<JsonObject[]> {
  if (!shksChunk.length) return [];

  const { data, error } = await supabase
    .from(TABLE_PURE_LOSSES)
    .select("*")
    .in("shk", shksChunk)
    .eq("wh_id", whId)
    .eq("date_lost", targetDate);

  if (!error) return (data || []) as JsonObject[];

  if (shksChunk.length > 1) {
    const mid = Math.ceil(shksChunk.length / 2);
    const left = await fetchPureRowsByShkChunk(shksChunk.slice(0, mid), whId, targetDate);
    const right = await fetchPureRowsByShkChunk(shksChunk.slice(mid), whId, targetDate);
    return left.concat(right);
  }

  const oneShk = shksChunk[0];
  throw new Error(`Не удалось проверить ШК ${oneShk} в pure_losses_rep: ${error.message}`);
}

async function loadExistingPureRowsByShk(shks: string[], whId: string, targetDate: string): Promise<Map<string, JsonObject[]>> {
  const result = new Map<string, JsonObject[]>();
  const chunks = chunkArray(shks, PURE_URL_FILTER_CHUNK_SIZE);

  for (const idsChunk of chunks) {
    const data = await fetchPureRowsByShkChunk(idsChunk, whId, targetDate);
    data.forEach((row) => {
      const shk = normalizeShk(row?.shk);
      if (!shk) return;
      if (!result.has(shk)) result.set(shk, []);
      result.get(shk)!.push(row);
    });
  }

  return result;
}

function normalizePureDateValue(value: unknown): string {
  const parsed = parseExcelDateValue(value);
  if (parsed) return formatIsoDateFromDate(parsed);
  return normalizeText(value);
}

function isSamePureShkDateWh(row: JsonObject, shkValue: unknown, dateLostValue: unknown, whIdValue: unknown): boolean {
  const rowShk = normalizeShk(row?.shk);
  const rowDate = normalizePureDateValue(row?.date_lost);
  const rowWh = normalizeToken(row?.wh_id);
  const shk = normalizeShk(shkValue);
  const dateLost = normalizePureDateValue(dateLostValue);
  const whId = normalizeToken(whIdValue);
  return Boolean(rowShk && rowDate && shk && dateLost)
    && rowShk === shk
    && rowDate === dateLost
    && (!whId || rowWh === whId);
}

function extractPureCellStoredValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const objectValue = value as JsonObject;
    if (Object.prototype.hasOwnProperty.call(objectValue, "value")) return objectValue.value;
    if (Object.prototype.hasOwnProperty.call(objectValue, "name")) return objectValue.name;
  }
  return value;
}

function getPureResolutionValue(row: JsonObject, columns: string[]): string {
  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(row, column)) continue;
    const value = normalizeText(extractPureCellStoredValue(row[column]));
    if (value) return value;
  }
  return "";
}

function isPureRowPendingForAutoFound(row: JsonObject): boolean {
  const decision = getPureResolutionValue(row, [PURE_DECISION_COLUMN, "opp_decision", "decision"]);
  const comment = getPureResolutionValue(row, [PURE_COMMENT_COLUMN, "comment"]);
  return !decision && !comment;
}

function getPureRowIdTarget(row: JsonObject): { column: string; value: string } | null {
  for (const column of ["id", "pure_losses_id", "row_id"]) {
    if (!Object.prototype.hasOwnProperty.call(row, column)) continue;
    const value = normalizeToken(row[column]);
    if (value) return { column, value };
  }
  return null;
}

function buildPureAutoFoundUpdateTarget(row: JsonObject, postedSignal: JsonObject): JsonObject {
  return {
    idTarget: getPureRowIdTarget(row),
    shk: normalizeShk(postedSignal?.shk),
    wh_id: normalizeToken(postedSignal?.wh_id),
    date_lost: normalizePureDateValue(postedSignal?.date_lost),
  };
}

function dedupePureAutoFoundTargets(targets: JsonObject[]): JsonObject[] {
  const out: JsonObject[] = [];
  const seen = new Set<string>();
  targets.forEach((item) => {
    const idTarget = asObject(item.idTarget);
    const idColumn = normalizeText(idTarget.column);
    const idValue = normalizeToken(idTarget.value);
    const key = idColumn && idValue
      ? `id:${idColumn}:${idValue}`
      : `key:${buildPureRowKey(item.shk, item.date_lost, item.wh_id)}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function toPureInsertPayload(row: JsonObject): JsonObject {
  return {
    shk: row.shk,
    nm: row.nm,
    decription: row.decription,
    brand: row.brand,
    shk_state_before_lost: row.shk_state_before_lost,
    wh_id: row.wh_id,
    date_lost: row.date_lost,
    lr: row.lr,
    price: row.price,
  };
}

function buildPureSyncPlan(
  rowsByKey: Map<string, JsonObject>,
  postedRowsByKey: Map<string, JsonObject>,
  existingByShk: Map<string, JsonObject[]>,
  whId: string,
) {
  const rowsToInsert: JsonObject[] = [];
  const autoFoundUpdates: JsonObject[] = [];
  const stats = {
    planned_insert_new: 0,
    skipped_same_date: 0,
    planned_auto_mark_found: 0,
  };

  for (const incoming of rowsByKey.values()) {
    const shk = normalizeShk(incoming.shk);
    const existingRows = existingByShk.get(shk) || [];
    const hasSameDate = existingRows.some((row) => isSamePureShkDateWh(row, incoming.shk, incoming.date_lost, whId));
    if (hasSameDate) {
      stats.skipped_same_date += 1;
      continue;
    }
    rowsToInsert.push(toPureInsertPayload(incoming));
    stats.planned_insert_new += 1;
  }

  for (const postedSignal of postedRowsByKey.values()) {
    const shk = normalizeShk(postedSignal.shk);
    const existingRows = existingByShk.get(shk) || [];
    existingRows.forEach((row) => {
      if (!isSamePureShkDateWh(row, postedSignal.shk, postedSignal.date_lost, whId)) return;
      if (!isPureRowPendingForAutoFound(row)) return;
      autoFoundUpdates.push(buildPureAutoFoundUpdateTarget(row, postedSignal));
    });
  }

  const uniqueAutoFoundUpdates = dedupePureAutoFoundTargets(autoFoundUpdates);
  stats.planned_auto_mark_found = uniqueAutoFoundUpdates.length;

  return { rowsToInsert, autoFoundUpdates: uniqueAutoFoundUpdates, stats };
}

function extractMissingColumnName(error: unknown): string {
  const objectError = asObject(error);
  const text = String(objectError.message || objectError.details || "");
  if (!text) return "";
  const match = text.match(/column\s+([^\s]+)\s+does not exist/i)
    || text.match(/could not find(?:\s+the)?\s+"?([a-z0-9_.]+)"?\s+column/i);
  if (!match || !match[1]) return "";
  const token = String(match[1]).replace(/"/g, "");
  const parts = token.split(".");
  return parts[parts.length - 1] || "";
}

function sanitizePureInsertRow(row: JsonObject, unsupportedColumns: Set<string>): JsonObject {
  const out: JsonObject = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    if (unsupportedColumns.has(key) || value === undefined) return;
    out[key] = value;
  });
  return out;
}

async function insertPureRowsAdaptive(rowsChunk: JsonObject[], unsupportedColumns: Set<string>): Promise<number> {
  const preparedRows = rowsChunk
    .map((row) => sanitizePureInsertRow(row, unsupportedColumns))
    .filter((row) => Object.keys(row).length > 0);

  if (!preparedRows.length) return 0;

  const { error } = await supabase
    .from(TABLE_PURE_LOSSES)
    .insert(preparedRows);

  if (!error) return preparedRows.length;

  const missingColumn = extractMissingColumnName(error);
  if (missingColumn && preparedRows.some((row) => Object.prototype.hasOwnProperty.call(row, missingColumn))) {
    unsupportedColumns.add(missingColumn);
    return await insertPureRowsAdaptive(rowsChunk, unsupportedColumns);
  }

  throw new Error(`Не удалось вставить новые строки в pure_losses_rep: ${error.message}`);
}

async function applyPureAutoFoundUpdate(target: JsonObject): Promise<void> {
  const idTarget = asObject(target.idTarget);
  const patch: JsonObject = {
    [PURE_DECISION_COLUMN]: AUTO_FOUND_DECISION,
    [PURE_EMP_COLUMN]: AUTO_FOUND_EMP_ID,
    [PURE_COMMENT_COLUMN]: AUTO_FOUND_COMMENT,
  };

  let query = supabase.from(TABLE_PURE_LOSSES).update(patch);
  if (idTarget.column && idTarget.value) {
    query = query.eq(normalizeText(idTarget.column), normalizeToken(idTarget.value));
  } else {
    query = query
      .eq("shk", normalizeShk(target.shk))
      .eq("wh_id", normalizeToken(target.wh_id))
      .eq("date_lost", normalizePureDateValue(target.date_lost))
      .is(PURE_DECISION_COLUMN, null)
      .is(PURE_COMMENT_COLUMN, null);
  }

  const { error } = await query;
  if (error) throw new Error(`Не удалось обновить строку с движением товара: ${error.message}`);
}

async function applyPureSyncPlan(syncPlan: { rowsToInsert: JsonObject[]; autoFoundUpdates: JsonObject[] }) {
  const unsupportedColumns = new Set<string>();
  let insertedNew = 0;
  let autoMarkedFound = 0;

  const insertChunks = chunkArray(syncPlan.rowsToInsert, PURE_INSERT_CHUNK_SIZE);
  for (const rowsChunk of insertChunks) {
    insertedNew += await insertPureRowsAdaptive(rowsChunk, unsupportedColumns);
  }

  for (const target of syncPlan.autoFoundUpdates) {
    await applyPureAutoFoundUpdate(target);
    autoMarkedFound += 1;
  }

  return { inserted_new: insertedNew, auto_marked_found: autoMarkedFound };
}

async function processPureLossesImport(params: {
  whId: string;
  shiftDate: string;
  rows: JsonObject[];
  fileName: string | null;
  dryRun: boolean;
}) {
  const targetDate = addIsoDays(params.shiftDate, -1);
  const autoLrSet = await loadAutoLossReasonIds();
  const prepared = preparePureLossesRows(params.rows, params.whId, targetDate, autoLrSet);
  const shks = collectPureShks(prepared);
  const existingByShk = await loadExistingPureRowsByShk(shks, params.whId, targetDate);
  const syncPlan = buildPureSyncPlan(prepared.rowsByKey, prepared.postedRowsByKey, existingByShk, params.whId);
  const appliedStats = params.dryRun
    ? { inserted_new: 0, auto_marked_found: 0 }
    : await applyPureSyncPlan(syncPlan);

  return {
    file_name: params.fileName,
    target_date: targetDate,
    target_date_label: formatRuDate(targetDate),
    dry_run: params.dryRun,
    ...prepared.stats,
    ...syncPlan.stats,
    ...appliedStats,
  };
}

function serializeShift(row: ShiftRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    wh_id: row.wh_id,
    shift_date: row.shift_date,
    shift_label: row.shift_label,
    shift_key: row.shift_key,
    status: row.status,
    incoming_process: row.incoming_process,
    outgoing_process: row.outgoing_process,
    incoming_employee: row.incoming_employee || null,
    outgoing_employee: row.outgoing_employee || null,
    file_uploaded: row.file_uploaded,
    file_name: row.file_name,
    opened_at: row.opened_at,
    opened_by: row.opened_by,
  };
}

async function getState(body: JsonObject) {
  const whId = normalizeText(body.wh_id) || DEFAULT_WH_ID;
  const shiftDate = shiftDateFromBody(body);
  const [employees, shift] = await Promise.all([
    fetchEmployees(),
    fetchShift(whId, shiftDate),
  ]);

  return json(200, {
    ok: true,
    action: "get_state",
    wh_id: whId,
    shift_date: shiftDate,
    shift_label: formatRuDate(shiftDate),
    employees,
    shift: serializeShift(shift),
  });
}

async function previewPureLossesImport(body: JsonObject) {
  const whId = normalizeText(body.wh_id) || DEFAULT_WH_ID;
  const shiftDate = shiftDateFromBody(body);
  const fileName = normalizeText(body.file_name ?? body.fileName) || null;
  const rows = normalizePureRows(body.pure_losses_rows ?? body.pureLossesRows ?? body.rows);

  const pureLossesImport = await processPureLossesImport({
    whId,
    shiftDate,
    rows,
    fileName,
    dryRun: true,
  });

  return json(200, {
    ok: true,
    action: "preview_pure_losses_import",
    wh_id: whId,
    shift_date: shiftDate,
    shift_label: formatRuDate(shiftDate),
    pure_losses_import: pureLossesImport,
  });
}

async function openShift(body: JsonObject) {
  const whId = normalizeText(body.wh_id) || DEFAULT_WH_ID;
  const shiftDate = shiftDateFromBody(body);
  const existing = await fetchShift(whId, shiftDate);
  if (existing) {
    let assignment: JsonObject | null = null;
    let assignmentError: string | null = null;
    try {
      assignment = await assignShiftTasks(whId, shiftDate, normalizeBoolean(body.allow_after_cutoff, false));
    } catch (error) {
      assignmentError = String(error instanceof Error ? error.message : error);
    }

    return json(200, {
      ok: true,
      action: "open_shift",
      already_open: true,
      wh_id: whId,
      shift_date: shiftDate,
      shift_label: formatRuDate(shiftDate),
      shift: serializeShift(existing),
      assignment,
      assignment_error: assignmentError,
    });
  }

  const incomingEmployeeId = normalizeText(body.incoming_employee_id ?? body.incomingEmployeeId);
  const outgoingEmployeeId = normalizeText(body.outgoing_employee_id ?? body.outgoingEmployeeId);
  if (!incomingEmployeeId) throw new Error("incoming_employee_id is required");
  if (!outgoingEmployeeId) throw new Error("outgoing_employee_id is required");

  const [incomingEmployee, outgoingEmployee] = await Promise.all([
    fetchEmployeeById(incomingEmployeeId),
    fetchEmployeeById(outgoingEmployeeId),
  ]);

  const fileName = normalizeText(body.file_name ?? body.fileName) || null;
  const fileUploaded = normalizeBoolean(body.file_uploaded ?? body.fileUploaded, Boolean(fileName));
  if (!fileUploaded) throw new Error("file_uploaded is required");

  const payload = asObject(body.payload);
  const pureRows = normalizePureRows(body.pure_losses_rows ?? body.pureLossesRows ?? payload.pure_losses_rows);

  const pureLossesImport = await processPureLossesImport({
    whId,
    shiftDate,
    rows: pureRows,
    fileName,
    dryRun: false,
  });

  const insertPayload = {
    wh_id: whId,
    shift_date: shiftDate,
    shift_key: `shift:${shiftDate}`,
    shift_label: formatRuDate(shiftDate),
    status: "opened",
    incoming_employee_id: incomingEmployee.id,
    outgoing_employee_id: outgoingEmployee.id,
    incoming_process: "Входящий поток",
    outgoing_process: "Исходящий поток",
    file_uploaded: fileUploaded,
    file_name: fileName,
    opened_by: normalizeText(body.opened_by ?? body.openedBy) || null,
    source: normalizeText(body.source) || "iframe",
    payload: {
      ...payload,
      pure_losses_import: pureLossesImport,
      incoming_employee: publicEmployee(incomingEmployee),
      outgoing_employee: publicEmployee(outgoingEmployee),
      file_name: fileName,
    },
  };

  const { error } = await supabase
    .from(SHIFTS_TABLE)
    .insert(insertPayload);

  if (error) {
    const refetched = await fetchShift(whId, shiftDate);
    if (refetched) {
      let assignment: JsonObject | null = null;
      let assignmentError: string | null = null;
      try {
        assignment = await assignShiftTasks(whId, shiftDate, normalizeBoolean(body.allow_after_cutoff, false));
      } catch (assignError) {
        assignmentError = String(assignError instanceof Error ? assignError.message : assignError);
      }

      return json(200, {
        ok: true,
        action: "open_shift",
        already_open: true,
        wh_id: whId,
        shift_date: shiftDate,
        shift_label: formatRuDate(shiftDate),
        shift: serializeShift(refetched),
        assignment,
        assignment_error: assignmentError,
      });
    }
    throw new Error(`Shift insert failed: ${error.message}`);
  }

  const created = await fetchShift(whId, shiftDate);
  let assignment: JsonObject | null = null;
  let assignmentError: string | null = null;
  try {
    assignment = await assignShiftTasks(whId, shiftDate, normalizeBoolean(body.allow_after_cutoff, false));
  } catch (error) {
    assignmentError = String(error instanceof Error ? error.message : error);
  }

  return json(200, {
    ok: true,
    action: "open_shift",
    already_open: false,
    wh_id: whId,
    shift_date: shiftDate,
    shift_label: formatRuDate(shiftDate),
    shift: serializeShift(created),
    pure_losses_import: pureLossesImport,
    assignment,
    assignment_error: assignmentError,
  });
}

async function assignTasksOnly(body: JsonObject) {
  const whId = normalizeText(body.wh_id) || DEFAULT_WH_ID;
  const shiftDate = shiftDateFromBody(body);
  const assignment = await assignShiftTasks(whId, shiftDate, normalizeBoolean(body.allow_after_cutoff, false));
  const shift = await fetchShift(whId, shiftDate);

  return json(200, {
    ok: true,
    action: "assign_tasks",
    wh_id: whId,
    shift_date: shiftDate,
    shift_label: formatRuDate(shiftDate),
    shift: serializeShift(shift),
    assignment,
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  try {
    const body = asObject(await request.json().catch(() => ({})));
    assertSecret(body);

    const action = normalizeText(body.action ?? body.mode) || "get_state";
    if (action === "get_state" || action === "state") return await getState(body);
    if (action === "preview_pure_losses_import" || action === "preview_pure_losses") {
      return await previewPureLossesImport(body);
    }
    if (action === "open_shift" || action === "open") return await openShift(body);
    if (action === "assign_tasks" || action === "assign_shift_tasks") return await assignTasksOnly(body);

    return json(400, { ok: false, error: `Unknown action: ${action}` });
  } catch (error) {
    return json(500, {
      ok: false,
      error: String(error instanceof Error ? error.message : error),
    });
  }
});
