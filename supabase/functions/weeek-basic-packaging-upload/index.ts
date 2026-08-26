import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type SourceRow = {
  row_number: number | null;
  warehouse: string;
  block: string;
  shk: string;
  price: number | null;
  tare_id: string;
  supplier_id: string;
  receiver_id: string;
  last_status: string;
  last_movement_raw: string;
  last_movement_iso: string | null;
  last_movement_date: string | null;
  last_movement_label: string;
};

type PackagingTask = {
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
  rows: SourceRow[];
  tasks: PackagingTask[];
  summary: JsonObject;
  skipped: JsonObject[];
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_SECRET = Deno.env.get("WEEEK_BASIC_PACKAGING_UPLOAD_SECRET") || Deno.env.get("WEEEK_UPLOAD_SECRET") || Deno.env.get("WEEEK_TASK_MASTER_SECRET");

const DEFAULT_SOURCE_MODULE = "manual_packaging_opp";
const DEFAULT_SOURCE_TABLE = "xlsx:manual_packaging_opp";
const DEFAULT_TASK_TYPE = "Разбор ОПП // Упаковка";
const DEFAULT_DESCRIPTION_TASK_TYPE = "Разбор ОПП // Упаковка";
const DEFAULT_BOARD_KEY = "manual_packaging_opp";
const DEFAULT_COLUMN_KEY = "packaging";
const DEFAULT_TARGET_WORKSPACE_ID = "1021782";
const DEFAULT_TARGET_PROJECT_ID = "2";
const DEFAULT_TARGET_BOARD_NAME = "❗️ Активные задачи";
const DEFAULT_TARGET_COLUMN_NAME = "Упаковка";
const DEFAULT_WH_ID = "50144199";
const SHIFTS_TABLE = "weeek_shifts";
const EMPLOYEES_TABLE = "weeek_employees";
const DEFAULT_DEADLINE_DAYS = 7;
const DEFAULT_SINGLE_MIN_PRICE = 1000;
const RWP_STATUS = "RWP – Ожидает упаковки на столе переупаковки";
const DEFAULT_TASK_TYPE_FIELD_ID = "a25e22e9-f7fb-4640-963b-5ba1ad75cfe9";
const DEFAULT_TASK_TYPE_OPTION_ID = "";
const DEFAULT_LAST_MOVEMENT_FIELD_ID = "a25e1c97-2c70-4771-9cb8-3637dc2f48d9";
const DEFAULT_PRICE_FIELD_ID = "a2624094-7335-45be-bcfd-9a2be15b368a";
const RPC_BATCH_SIZE = 250;
const SOURCE_PAYLOAD_ROWS_SAMPLE_LIMIT = 25;
const DESCRIPTION_ROWS_LIMIT = 60;
const SEARCH_TEXT_IDS_LIMIT = 80;
const SOURCE_ROW_ID_LIMIT = 80;
const UPLOAD_RUNS_TABLE = "weeek_manual_upload_runs";
const TWO_SHK_TABLE = "2shk_rep";
const DEFAULT_UPLOAD_TYPE = "packaging";
const TWO_SHK_TAG_NAME = "Два ШК";
const EMPTY_PACKAGE_TAG_NAME = "Пустая упаковка";

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

function taskDebugStats(tasks: PackagingTask[]): JsonObject {
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

function normalizeForMatch(value: unknown): string {
  return normalizeText(value)
    .replace(/[–—−]/g, "-")
    .replace(/ё/g, "е")
    .replace(/Ё/g, "Е")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isRwpStatus(value: unknown): boolean {
  return normalizeForMatch(value) === normalizeForMatch(RWP_STATUS);
}

function normalizeNumber(value: unknown, fallbackValue: number): number {
  if (value === null || value === undefined || normalizeText(value) === "") return fallbackValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
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
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return dateParts(value, value.toISOString());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = excelSerialToDate(value);
    if (date) return dateParts(date, String(value));
  }

  const raw = normalizeText(value);
  if (!raw) return { iso: null, isoDate: null, label: "", ts: 0 };

  let match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/);
  if (match) {
    const ms = Number(`${match[7] || "0"}`.slice(0, 3).padEnd(3, "0"));
    const date = new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
      ms,
    ));
    return dateParts(date, raw);
  }

  match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(
      year,
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
    ));
    return dateParts(date, raw);
  }

  const parsed = new Date(raw.replace(" ", "T"));
  if (Number.isFinite(parsed.getTime())) return dateParts(parsed, raw);

  return { iso: null, isoDate: null, label: raw, ts: 0 };
}

function dateParts(date: Date, fallbackLabel: string): { iso: string | null; isoDate: string | null; label: string; ts: number } {
  if (!Number.isFinite(date.getTime())) return { iso: null, isoDate: null, label: fallbackLabel, ts: 0 };
  const iso = date.toISOString();
  const isoDate = iso.slice(0, 10);
  const label = `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
  return { iso, isoDate, label, ts: date.getTime() };
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

function applyImmediateAssignees(tasks: PackagingTask[], shift: ShiftAssigneeContext | null): number {
  let assigned = 0;
  for (const task of tasks) {
    const ids = targetAssigneeIdsForZone(task.responsibility_zone, shift);
    task.target_assignee_ids = ids;
    if (ids.length) assigned += 1;
  }
  return assigned;
}

function priceBasedPriority(price: number | null | undefined): number | null {
  const value = Number(price ?? 0);
  if (!Number.isFinite(value) || value < 500) return null;
  if (value < 1000) return 3;
  if (value < 5000) return 0;
  if (value < 10000) return 1;
  return 2;
}

function plannedTaskDueDate(body: JsonObject): string | null {
  const planned = normalizeText(body.planned_upload_date);
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

function upsertSpecialInfo(map: Map<string, SpecialShkInfo>, row: JsonObject, shkIds: Set<string>) {
  const candidates = [normalizeIdentifier(row.shk1), normalizeIdentifier(row.shk2)].filter(Boolean);
  for (const candidate of candidates) {
    if (!shkIds.has(candidate) || map.has(candidate)) continue;
    const info = specialInfoFromRow(row, candidate);
    if (info) map.set(candidate, info);
  }
}

async function loadSpecialShkMap(shkIdsRaw: string[], body: JsonObject): Promise<Map<string, SpecialShkInfo>> {
  const shkIds = Array.from(new Set(shkIdsRaw.map(normalizeIdentifier).filter(Boolean)));
  const shkSet = new Set(shkIds);
  const result = new Map<string, SpecialShkInfo>();
  if (!shkIds.length) return result;

  const whId = normalizeText(body.wh_id) || DEFAULT_WH_ID;
  for (const chunk of chunkArray(shkIds, 100)) {
    const applyRows = (rows: JsonObject[] | null) => {
      for (const row of rows ?? []) upsertSpecialInfo(result, row, shkSet);
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

function specialInfoForRows(rows: SourceRow[], specialMap?: Map<string, SpecialShkInfo>): SpecialShkInfo[] {
  if (!specialMap || !specialMap.size) return [];
  const result: SpecialShkInfo[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const info = specialMap.get(row.shk);
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

function splitSpecialRows(rows: SourceRow[], specialMap?: Map<string, SpecialShkInfo>): { regularRows: SourceRow[]; specialRows: SourceRow[] } {
  if (!specialMap || !specialMap.size) return { regularRows: rows, specialRows: [] };
  const regularRows: SourceRow[] = [];
  const specialRows: SourceRow[] = [];
  for (const row of rows) {
    if (specialMap.has(row.shk)) specialRows.push(row);
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

function rowFromArray(row: unknown[], rowNumber: number): SourceRow | null {
  return normalizeSourceRow({
    row_number: rowNumber,
    warehouse: row[0],
    block: row[1],
    shk: row[2],
    price: row[3],
    tare_id: row[4],
    supplier_id: row[5],
    receiver_id: row[6],
    last_status: row[7],
    last_movement: row[8],
  });
}

function rowFromObject(row: JsonObject, rowNumber: number): SourceRow | null {
  return normalizeSourceRow({
    row_number: pick(row, ["row_number", "source_row_number"]) ?? rowNumber,
    warehouse: pick(row, ["warehouse", "Склад"]),
    block: pick(row, ["block", "Блок"]),
    shk: pick(row, ["shk", "ID товара", "Искомый ШК", "ШК"]),
    price: pick(row, ["price", "cost", "Стоимость", "Цена"]),
    tare_id: pick(row, ["tare_id", "ID тары", "Тара"]),
    supplier_id: pick(row, ["supplier_id", "ID постав", "ID поставщика"]),
    receiver_id: pick(row, ["receiver_id", "ID приём", "ID прием", "ID приёмки", "ID приемки"]),
    last_status: pick(row, ["last_status", "Статус крайнего движения", "Статус кр"]),
    last_movement: pick(row, ["last_movement", "Время крайнего движения", "Время крайнего движ"]),
  });
}

function normalizeSourceRow(raw: JsonObject): SourceRow | null {
  const shk = normalizeIdentifier(raw.shk);
  if (!shk) return null;
  const lastMovement = parseDateTime(raw.last_movement);
  const rowNumberRaw = normalizeText(raw.row_number);
  const rowNumber = rowNumberRaw ? Number(rowNumberRaw) : null;
  return {
    row_number: Number.isFinite(rowNumber) ? Math.trunc(Number(rowNumber)) : null,
    warehouse: normalizeText(raw.warehouse),
    block: normalizeText(raw.block),
    shk,
    price: normalizePrice(raw.price),
    tare_id: normalizeIdentifier(raw.tare_id),
    supplier_id: normalizeIdentifier(raw.supplier_id),
    receiver_id: normalizeIdentifier(raw.receiver_id),
    last_status: normalizeText(raw.last_status),
    last_movement_raw: normalizeText(raw.last_movement),
    last_movement_iso: lastMovement.iso,
    last_movement_date: lastMovement.isoDate,
    last_movement_label: lastMovement.label,
  };
}

function normalizeRows(rows: unknown[]): { rows: SourceRow[]; duplicateShkCount: number; invalidCount: number } {
  const byShk = new Map<string, SourceRow>();
  let duplicateShkCount = 0;
  let invalidCount = 0;

  rows.forEach((raw, index) => {
    let sourceRow: SourceRow | null = null;
    const rowNumber = index + 1;

    if (Array.isArray(raw)) {
      const firstValues = raw.slice(0, 9).map(normalizeText).join(" ").toLowerCase();
      if (rowNumber === 1 && firstValues.includes("id товара")) return;
      sourceRow = rowFromArray(raw, rowNumber);
    } else {
      const object = asObject(raw);
      sourceRow = object ? rowFromObject(object, rowNumber) : null;
    }

    if (!sourceRow) {
      invalidCount += 1;
      return;
    }

    const previous = byShk.get(sourceRow.shk);
    if (previous) {
      duplicateShkCount += 1;
      const previousTs = parseDateTime(previous.last_movement_iso || previous.last_movement_raw).ts;
      const currentTs = parseDateTime(sourceRow.last_movement_iso || sourceRow.last_movement_raw).ts;
      if (currentTs >= previousTs) byShk.set(sourceRow.shk, sourceRow);
      return;
    }

    byShk.set(sourceRow.shk, sourceRow);
  });

  return { rows: Array.from(byShk.values()), duplicateShkCount, invalidCount };
}

function sumPrices(rows: SourceRow[]): number | null {
  const sum = rows.reduce((acc, row) => acc + (row.price ?? 0), 0);
  return Number.isFinite(sum) ? Math.round(sum * 100) / 100 : null;
}

function newestRow(rows: SourceRow[]): SourceRow {
  return [...rows].sort((a, b) => parseDateTime(b.last_movement_iso || b.last_movement_raw).ts - parseDateTime(a.last_movement_iso || a.last_movement_raw).ts)[0] || rows[0];
}

function compactSourceRow(row: SourceRow): JsonObject {
  return {
    row_number: row.row_number,
    shk: row.shk,
    price: row.price,
    tare_id: row.tare_id,
    supplier_id: row.supplier_id,
    receiver_id: row.receiver_id,
    last_status: row.last_status,
    last_movement: row.last_movement_raw,
    last_movement_date: row.last_movement_date,
  };
}

function compactRowsPayload(rows: SourceRow[]): JsonObject {
  return {
    rows_count: rows.length,
    rows_sample_limit: SOURCE_PAYLOAD_ROWS_SAMPLE_LIMIT,
    rows_sample: rows.slice(0, SOURCE_PAYLOAD_ROWS_SAMPLE_LIMIT).map(compactSourceRow),
  };
}

function sourceRowIdFromRows(rows: SourceRow[]): string | null {
  const ids = rows.map((row) => row.row_number).filter((value) => value !== null);
  if (!ids.length) return null;
  const sample = ids.slice(0, SOURCE_ROW_ID_LIMIT).join(",");
  return ids.length > SOURCE_ROW_ID_LIMIT ? `${sample},+${ids.length - SOURCE_ROW_ID_LIMIT}` : sample;
}

function limitedShkIds(shkIds: string[]): string[] {
  return shkIds.slice(0, SEARCH_TEXT_IDS_LIMIT);
}

function buildTargetCustomFields(row: SourceRow, price: number | null, body: JsonObject): JsonObject {
  const customFields = { ...(asObject(body.target_custom_fields) ?? {}) };
  const taskTypeFieldId = normalizeText(body.task_type_field_id) || normalizeText(Deno.env.get("WEEEK_TASK_TYPE_FIELD_ID")) || DEFAULT_TASK_TYPE_FIELD_ID;
  const taskType = normalizeText(body.task_type);
  const defaultTaskTypeOptionId = taskType === "Разбор ОПП // RWP"
    ? normalizeText(Deno.env.get("WEEEK_MANUAL_RWP_TASK_TYPE_OPTION_ID"))
    : normalizeText(Deno.env.get("WEEEK_MANUAL_PACKAGING_TASK_TYPE_OPTION_ID"));
  const taskTypeOptionId = normalizeText(body.task_type_option_id) || defaultTaskTypeOptionId || DEFAULT_TASK_TYPE_OPTION_ID;
  const lastMovementFieldId = normalizeText(body.last_movement_field_id) || normalizeText(Deno.env.get("WEEEK_LAST_MOVEMENT_FIELD_ID")) || DEFAULT_LAST_MOVEMENT_FIELD_ID;
  const priceFieldId = normalizeText(body.price_field_id) || normalizeText(body.cost_field_id) || normalizeText(Deno.env.get("WEEEK_PRICE_FIELD_ID")) || DEFAULT_PRICE_FIELD_ID;

  if (taskTypeFieldId && taskTypeOptionId && !Object.prototype.hasOwnProperty.call(customFields, taskTypeFieldId)) {
    customFields[taskTypeFieldId] = taskTypeOptionId;
  }

  if (lastMovementFieldId && row.last_movement_iso && !Object.prototype.hasOwnProperty.call(customFields, lastMovementFieldId)) {
    customFields[lastMovementFieldId] = row.last_movement_iso.replace(/\.\d{3}Z$/, "Z");
  }

  if (priceFieldId && price !== null && !Object.prototype.hasOwnProperty.call(customFields, priceFieldId)) {
    customFields[priceFieldId] = price;
  }

  return customFields;
}

function buildSingleDescription(row: SourceRow): string {
  return [
    `Искомый ШК: ${row.shk}`,
    `Статус крайнего движения: ${row.last_status || "-"}`,
  ].join("\n");
}

function buildTareDescription(tareId: string, rows: SourceRow[], primaryRow: SourceRow): string {
  const shkLines = rows
    .slice(0, DESCRIPTION_ROWS_LIMIT)
    .map((row, index) => `${index + 1}. ${row.shk} | ${row.price ?? "-"} ₽ | ${row.last_status || "-"} | ${row.last_movement_label || row.last_movement_raw || "-"}`);
  if (rows.length > DESCRIPTION_ROWS_LIMIT) shkLines.push(`...и еще ${rows.length - DESCRIPTION_ROWS_LIMIT} ШК. Полный список сохранен в source_shk_ids.`);
  return [
    `Искомый ШК: ${primaryRow.shk}`,
    `ID тары: ${tareId}`,
    `Статус крайнего движения: ${primaryRow.last_status || "-"}`,
    "",
    "ШК в таре:",
    ...shkLines,
  ].join("\n");
}

function buildSearchText(values: unknown[]): string {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean))).join(" ");
}

async function buildTasks(rawRows: unknown[], body: JsonObject): Promise<BuildResult> {
  const normalized = normalizeRows(rawRows);
  const rowFilter = normalizeText(body.row_filter) || normalizeText(body.filter_mode);
  const dateFilter = normalizeText(body.row_date || body.business_date || body.effective_date);
  const statusRows = normalized.rows.filter((row) => {
    if (rowFilter === "only_rwp") return isRwpStatus(row.last_status);
    if (rowFilter === "exclude_rwp") return !isRwpStatus(row.last_status);
    return true;
  });
  const rows = dateFilter ? statusRows.filter((row) => row.last_movement_date === dateFilter) : statusRows;
  const singleMinPrice = normalizeNumber(body.single_min_price, DEFAULT_SINGLE_MIN_PRICE);
  const groupByTare = normalizeBoolean(body.group_by_tare, true);
  const titlePrefix = normalizeText(body.title_prefix) || "Упаковка";
  const sourceModule = normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE;
  const taskType = normalizeText(body.task_type) || DEFAULT_TASK_TYPE;
  const descriptionTaskType = normalizeText(body.description_task_type) || DEFAULT_DESCRIPTION_TASK_TYPE;
  const boardKey = normalizeText(body.board_key) || DEFAULT_BOARD_KEY;
  const columnKey = normalizeText(body.column_key) || DEFAULT_COLUMN_KEY;
  const targetWorkspaceId = normalizeText(body.workspace_id) || normalizeText(body.target_workspace_id) || DEFAULT_TARGET_WORKSPACE_ID;
  const targetProjectId = normalizeText(body.project_id) || normalizeText(body.target_project_id) || DEFAULT_TARGET_PROJECT_ID;
  const targetBoardId = normalizeText(body.board_id) || normalizeText(body.target_board_id) || null;
  const targetBoardName = normalizeText(body.board_name) || normalizeText(body.target_board_name) || DEFAULT_TARGET_BOARD_NAME;
  const targetColumnId = normalizeText(body.board_column_id) || normalizeText(body.target_column_id) || null;
  const targetColumnName = normalizeText(body.board_column_name) || normalizeText(body.target_column_name) || DEFAULT_TARGET_COLUMN_NAME;
  const sourceTable = normalizeText(body.source_table) || DEFAULT_SOURCE_TABLE;
  const sourceGeneratedAt = currentMoscowIso();
  const dueDate = plannedTaskDueDate(body);
  const responsibilityZone = normalizedResponsibilityZone(body.responsibility_zone);
  const specialMap = await loadSpecialShkMap(rows.map((row) => row.shk), body);
  const splitRows = splitSpecialRows(rows, specialMap);

  const byTare = new Map<string, SourceRow[]>();
  const noTareRows: SourceRow[] = [];
  for (const row of splitRows.regularRows) {
    if (!groupByTare || !isGroupableIdentifier(row.tare_id)) {
      noTareRows.push(row);
      continue;
    }
    const group = byTare.get(row.tare_id) ?? [];
    group.push(row);
    byTare.set(row.tare_id, group);
  }

  const tasks: PackagingTask[] = [];
  const skipped: JsonObject[] = [];
  const groupedTareIds: string[] = [];
  let skippedSingleLowPrice = 0;

  for (const [tareId, groupRows] of byTare.entries()) {
    if (groupRows.length > 1) {
      const sorted = [...groupRows].sort((a, b) => a.shk.localeCompare(b.shk, "ru"));
      const primaryRow = newestRow(sorted);
      const priceSum = sumPrices(sorted);
      const shkIds = sorted.map((row) => row.shk);
      const specialInfos = specialInfoForRows(sorted, specialMap);
      groupedTareIds.push(tareId);
      tasks.push({
        source_module: sourceModule,
        source_table: sourceTable,
        source_id: tareId,
        source_row_id: sourceRowIdFromRows(sorted),
	        source_payload: {
	          entity_type: "tare",
	          description_task_type: descriptionTaskType,
	          tare_id: tareId,
	          ...compactRowsPayload(sorted),
	          shk_count: shkIds.length,
	          price_sum: priceSum,
	        },
        source_generated_at: sourceGeneratedAt,
        source_shk_ids: shkIds,
        source_tare_id: tareId,
        source_price_sum: priceSum,
        source_last_movement_at: primaryRow.last_movement_iso,
        search_text: buildSearchText([tareId, ...limitedShkIds(shkIds), ...sorted.slice(0, SEARCH_TEXT_IDS_LIMIT).map((row) => row.last_status)]),
        task_type: taskType,
        board_key: boardKey,
        column_key: columnKey,
        title: `${titlePrefix} | Тара ${tareId}`,
        description: withSpecialDescription(buildTareDescription(tareId, sorted, primaryRow), specialInfos),
	        priority: priceBasedPriority(priceSum),
	        due_date: dueDate,
	        responsibility_zone: responsibilityZone,
        target_workspace_id: targetWorkspaceId,
        target_project_id: targetProjectId,
        target_board_id: targetBoardId,
        target_board_name: targetBoardName,
        target_column_id: targetColumnId,
        target_column_name: targetColumnName,
        target_custom_fields: buildTargetCustomFields(primaryRow, priceSum, body),
        target_tags: mergeTargetTags(Array.isArray(body.target_tags) ? body.target_tags : [], specialInfos),
        enabled: taskEnabledForUpload(body),
      master_action: masterActionForUpload(body),
      });
      continue;
    }

    noTareRows.push(groupRows[0]);
  }

  for (const row of noTareRows) {
    const price = row.price ?? 0;
    if (price < singleMinPrice) {
      skippedSingleLowPrice += 1;
      skipped.push({ reason: "single_low_price", shk: row.shk, tare_id: row.tare_id, price: row.price });
      continue;
    }

    const specialInfos = specialInfoForRows([row], specialMap);
    tasks.push({
      source_module: sourceModule,
      source_table: sourceTable,
      source_id: row.shk,
      source_row_id: row.row_number === null ? null : String(row.row_number),
	      source_payload: {
	        entity_type: "shk",
	        description_task_type: descriptionTaskType,
	        row: compactSourceRow(row),
	      },
      source_generated_at: sourceGeneratedAt,
      source_shk_ids: [row.shk],
      source_tare_id: row.tare_id || null,
      source_price_sum: row.price,
      source_last_movement_at: row.last_movement_iso,
      search_text: buildSearchText([row.shk, row.tare_id, row.last_status]),
      task_type: taskType,
      board_key: boardKey,
      column_key: columnKey,
      title: `${titlePrefix} | ${row.shk}`,
      description: withSpecialDescription(buildSingleDescription(row), specialInfos),
	      priority: priceBasedPriority(row.price),
	      due_date: dueDate,
	      responsibility_zone: responsibilityZone,
      target_workspace_id: targetWorkspaceId,
      target_project_id: targetProjectId,
      target_board_id: targetBoardId,
      target_board_name: targetBoardName,
      target_column_id: targetColumnId,
      target_column_name: targetColumnName,
      target_custom_fields: buildTargetCustomFields(row, row.price, body),
      target_tags: mergeTargetTags(Array.isArray(body.target_tags) ? body.target_tags : [], specialInfos),
      enabled: taskEnabledForUpload(body),
      master_action: masterActionForUpload(body),
    });
  }

  for (const row of splitRows.specialRows) {
    const specialInfos = specialInfoForRows([row], specialMap);
    tasks.push({
      source_module: sourceModule,
      source_table: sourceTable,
      source_id: row.shk,
      source_row_id: row.row_number === null ? null : String(row.row_number),
      source_payload: {
        entity_type: "special_shk",
        description_task_type: descriptionTaskType,
        row: compactSourceRow(row),
        special_shk: specialInfos.map((info) => ({
          tag_name: info.tag_name,
          matched_shk: info.matched_shk,
          second_shk: info.second_shk,
          media: info.media,
        })),
      },
      source_generated_at: sourceGeneratedAt,
      source_shk_ids: [row.shk],
      source_tare_id: row.tare_id || null,
      source_price_sum: row.price,
      source_last_movement_at: row.last_movement_iso,
      search_text: buildSearchText([row.shk, row.tare_id, row.last_status, ...specialInfos.map((info) => info.tag_name)]),
      task_type: taskType,
      board_key: boardKey,
      column_key: columnKey,
      title: `${titlePrefix} | ${row.shk}`,
      description: withSpecialDescription(buildSingleDescription(row), specialInfos),
      priority: priceBasedPriority(row.price),
      due_date: dueDate,
      responsibility_zone: responsibilityZone,
      target_workspace_id: targetWorkspaceId,
      target_project_id: targetProjectId,
      target_board_id: targetBoardId,
      target_board_name: targetBoardName,
      target_column_id: targetColumnId,
      target_column_name: targetColumnName,
      target_custom_fields: buildTargetCustomFields(row, row.price, body),
      target_tags: mergeTargetTags(Array.isArray(body.target_tags) ? body.target_tags : [], specialInfos),
      enabled: taskEnabledForUpload(body),
      master_action: masterActionForUpload(body),
    });
  }

  const uniqueTares = Array.from(byTare.keys()).filter(Boolean);
  return {
    rows,
    tasks,
    skipped,
    summary: {
      found_shk_count: rows.length,
      duplicate_shk_count: normalized.duplicateShkCount,
      invalid_row_count: normalized.invalidCount,
      filtered_out_count: normalized.rows.length - rows.length,
      date_filter: dateFilter || null,
      date_filtered_out_count: statusRows.length - rows.length,
      row_filter: rowFilter || "none",
      tare_count: uniqueTares.length,
      grouped_tare_count: groupedTareIds.length,
      special_2shk_matches_count: specialMap.size,
      special_2shk_task_count: splitRows.specialRows.length,
      tasks_to_create_count: tasks.length,
      skipped_single_low_price_count: skippedSingleLowPrice,
      single_min_price: singleMinPrice,
      total_price_sum: sumPrices(tasks.map((task) => ({ price: task.source_price_sum } as SourceRow))),
    },
  };
}

type TraceMark = (stage: string, extra?: JsonObject) => void;

async function upsertTasks(tasks: PackagingTask[], mark?: TraceMark, debugProfile = false): Promise<number> {
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

async function readUploadCalendar(startDate: string, endDate: string): Promise<JsonObject[]> {
  const { data, error } = await supabase
    .from(UPLOAD_RUNS_TABLE)
    .select("*")
    .gte("effective_date", startDate)
    .lte("effective_date", endDate)
    .order("effective_date", { ascending: true });
  if (error) throw new Error(`Failed to read manual upload calendar: ${error.message}`);
  return (Array.isArray(data) ? data : []) as JsonObject[];
}

async function writeUploadRun(params: {
  sourceModule: string;
  uploadType: string;
  uploadDate: string;
  businessDate: string | null;
  fileName: string;
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
  const url = `${SUPABASE_URL}/functions/v1/weeek-task-master-basic`;
  const response = await fetch(url, {
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
        console.log(JSON.stringify({ event: "weeek_basic_packaging_upload_trace", ...entry }));
      } catch (_error) {
        console.log(`weeek_basic_packaging_upload_trace ${stage}`);
      }
    }
  };
  try {
    mark("request_read_start");
    const raw = await req.json().catch(() => ({}));
    const body = asObject(raw) ?? {};
    debugProfile = normalizeBoolean(body.debug_profile, false);
    const secret = normalizeText(body.secret);
    if (FUNCTION_SECRET && secret !== FUNCTION_SECRET) return json(401, { ok: false, error: "Invalid basic packaging upload secret" });

    const action = normalizeText(body.action) || "preview";
    const dryRun = normalizeBoolean(body.dry_run, action === "preview");
    const sourceModule = normalizeText(body.source_module) || DEFAULT_SOURCE_MODULE;
    const uploadType = normalizeText(body.upload_type) || DEFAULT_UPLOAD_TYPE;
    const uploadDate = normalizeText(body.upload_date) || currentMoscowDate();
    const defaultBusinessDate = addDaysToIsoDate(uploadDate, -DEFAULT_DEADLINE_DAYS) || uploadDate;
    const effectiveDate = normalizeText(body.effective_date) || normalizeText(body.business_date) || defaultBusinessDate;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    traceSourceModule = sourceModule;
    traceAction = action;
    mark("request_parsed", {
      upload_type: uploadType,
      effective_date: effectiveDate,
      debug_profile: debugProfile,
    });

    if (["calendar", "runs_calendar"].includes(action)) {
      const startDate = normalizeText(body.start_date) || addDaysToIsoDate(currentMoscowDate(), -28) || currentMoscowDate();
      const endDate = normalizeText(body.end_date) || addDaysToIsoDate(currentMoscowDate(), 7) || currentMoscowDate();
      const runs = await readUploadCalendar(startDate, endDate);
      return json(200, {
        ok: true,
        action: "calendar",
        start_date: startDate,
        end_date: endDate,
        runs,
        required_upload_types: normalizeInteger(body.required_upload_types, 3),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }

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
      const limit = Math.min(Math.max(normalizeInteger(body.limit, 50), 1), 50);
      const processAll = normalizeBoolean(body.process_all, false);
      const maxBatches = Math.min(Math.max(normalizeInteger(body.max_batches, 20), 1), 50);

      if (!processAll) {
        const masterResponse = await callTaskMaster({
          action: "process_queue",
          dry_run: dryRun,
          source_module: sourceModule,
          limit,
        });
        return json(200, { ok: true, action, target_table: "weeek_tasks_basic", started_at: startedAt, finished_at: new Date().toISOString(), master: masterResponse });
      }

      const batches: JsonObject[] = [];
      let processedCount = 0;
      let failedCount = 0;
      let selectedCount = 0;
      for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
        const masterResponse = await callTaskMaster({
          action: "process_queue",
          dry_run: dryRun,
          source_module: sourceModule,
          limit,
        });
        batches.push(masterResponse);
        const selectedRows = Number(masterResponse.selected_rows ?? 0);
        selectedCount += selectedRows;
        processedCount += Number(masterResponse.processed_count ?? 0);
        failedCount += Number(masterResponse.failed_count ?? 0);
        if (selectedRows < limit || selectedRows === 0) break;
      }

      return json(200, {
        ok: true,
        action,
        target_table: "weeek_tasks_basic",
        process_all: true,
        batch_count: batches.length,
        selected_count: selectedCount,
        processed_count: processedCount,
        failed_count: failedCount,
        batches,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }

    if (!rows.length) return json(400, { ok: false, error: "rows must be a non-empty array" });
    mark("input_rows_ready", {
      rows_count: rows.length,
      ...(debugProfile ? { rows_json_bytes: jsonByteLength(rows) } : {}),
    });

    const buildStarted = performance.now();
    const result = await buildTasks(rows, body);
    mark("tasks_built", {
      build_elapsed_ms: elapsedMs(buildStarted),
      tasks_count: result.tasks.length,
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
      due_date: task.due_date,
      source_shk_ids: task.source_shk_ids,
      source_tare_id: task.source_tare_id,
      source_price_sum: task.source_price_sum,
      responsibility_zone: task.responsibility_zone,
      target_assignee_ids: task.target_assignee_ids ?? [],
    }));

    if (action === "preview" || dryRun) {
      return json(200, {
        ok: true,
        action: "preview",
        dry_run: true,
        target_table: "weeek_tasks_basic",
        summary: result.summary,
        assignment,
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
    let masterResponse: JsonObject | null = null;
    if (normalizeBoolean(body.process_queue, false) && result.tasks.length) {
      const limit = Math.min(Math.max(normalizeInteger(body.process_limit, 50), 1), 50);
      const processAll = normalizeBoolean(body.process_all, false);
      const maxBatches = Math.min(Math.max(normalizeInteger(body.max_batches, 20), 1), 50);
      if (!processAll) {
        masterResponse = await callTaskMaster({
          action: "process_queue",
          dry_run: false,
          source_module: sourceModule,
          limit,
        });
      } else {
        const batches: JsonObject[] = [];
        let processedCount = 0;
        let failedCount = 0;
        let selectedCount = 0;
        for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
          const batchResponse = await callTaskMaster({
            action: "process_queue",
            dry_run: false,
            source_module: sourceModule,
            limit,
          });
          batches.push(batchResponse);
          const selectedRows = Number(batchResponse.selected_rows ?? 0);
          selectedCount += selectedRows;
          processedCount += Number(batchResponse.processed_count ?? 0);
          failedCount += Number(batchResponse.failed_count ?? 0);
          if (selectedRows < limit || selectedRows === 0) break;
        }
        masterResponse = {
          process_all: true,
          batch_count: batches.length,
          selected_count: selectedCount,
          processed_count: processedCount,
          failed_count: failedCount,
          batches,
        };
      }
    }

    const processedCount = Number(masterResponse?.processed_count ?? 0);
    const failedCount = Number(masterResponse?.failed_count ?? 0);
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
      master: masterResponse,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    if (debugProfile) {
      responseBody.debug_trace = debugTrace;
      responseBody.debug_stats = taskDebugStats(result.tasks);
    }
    mark("upload_run_start", {
      rows_count: result.rows.length,
      tasks_count: result.tasks.length,
    });
    const uploadRunStarted = performance.now();
    const uploadRun = await writeUploadRun({
      sourceModule,
      uploadType,
      uploadDate,
      businessDate: normalizeText(body.business_date) || effectiveDate || defaultBusinessDate,
      fileName: normalizeText(body.file_name),
      rowsCount: result.rows.length,
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
