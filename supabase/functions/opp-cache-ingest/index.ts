import { createClient } from "npm:@supabase/supabase-js@2";

type AnyRecord = Record<string, unknown>;
type MetricInput = {
  metric_key: string;
  metric_name: string;
  group_key?: string | null;
  group_name?: string | null;
  metric_date?: string | null;
  value_num?: number | null;
  value_text?: string | null;
  unit?: string | null;
  severity?: string | null;
  dimensions?: AnyRecord | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CACHE_TABLE = (Deno.env.get("OPP_CACHE_TABLE") || "opp_reports_cache").trim();
const REPORT_RUNS_TABLE = (Deno.env.get("REPORT_RUNS_TABLE") || "report_runs").trim();
const REPORT_METRICS_TABLE = (Deno.env.get("REPORT_METRICS_TABLE") || "report_metrics").trim();
const SETTINGS_TABLE = (Deno.env.get("OPP_ALERT_SETTINGS_TABLE") || "opp_alert_settings").trim();
const DEADLINES_DATA_TYPE = (Deno.env.get("OPP_CACHE_DEADLINES_DATA_TYPE") || "opp_table_deadlines").trim();
const DEFAULT_TTL_MINUTES = Math.max(Number(Deno.env.get("OPP_CACHE_TTL_MINUTES") || "30") || 30, 5);
const INGEST_SECRET = Deno.env.get("OPP_CACHE_INGEST_SECRET") || Deno.env.get("OPP_ALERT_SECRET") || "";
const ALLOWED_SCOPES = new Set(["opp_telegram_shift", "opp_telegram_rolling30"]);
const DEADLINE_LABELS: Record<string, string> = {
  SPS_WMI: "SPS + WMI",
  SMC: "SMC",
  SMS: "SMS",
  WMI_BZ: "WMI Без заказа",
  RWP: "RWP",
  "24": "24",
  ORS: "ORS",
  REPACK: "Упаковка",
};
const DEADLINE_ADJUSTMENT_SETTING_KEYS: Record<string, string> = {
  adjust_sps_wmi: "SPS_WMI",
  adjust_smc: "SMC",
  adjust_sms: "SMS",
  adjust_wmi_bz: "WMI_BZ",
  adjust_rwp: "RWP",
  adjust_24: "24",
  adjust_ors: "ORS",
  adjust_repack: "REPACK",
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function json(status: number, body: AnyRecord) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDeadlineKey(value: unknown): string {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function parseDeadlineNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value).replace(",", ".");
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateOnlyDeadlineOffset(key: string, value: number): number {
  if (key !== "WMI_BZ") return value;
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value - Math.round(value)) < 1e-9) return value;
  return value < 0 ? Math.floor(value) : Math.ceil(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw) return value;
  if (!raw.startsWith("{") && !raw.startsWith("[")) return value;
  try {
    return JSON.parse(raw);
  } catch {
    return value;
  }
}

function extractDeadlinesFromData(rawData: unknown): Record<string, number> {
  const parsed = parseMaybeJson(rawData);
  const out: Record<string, number> = {};

  function put(keyRaw: unknown, valueRaw: unknown) {
    const key = normalizeDeadlineKey(keyRaw);
    const value = parseDeadlineNumber(valueRaw);
    if (!key || value === null) return;
    out[key] = value;
  }

  function parsePairsObject(obj: unknown) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    Object.entries(obj as Record<string, unknown>).forEach(([key, value]) => {
      put(key, value);
    });
  }

  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed)) {
      parsed.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const o = item as Record<string, unknown>;
        put(o.key ?? o.name ?? o.status, o.offset_days ?? o.offset ?? o.value);
      });
    } else {
      const root = parsed as Record<string, unknown>;
      if (Array.isArray(root.deadlines)) {
        root.deadlines.forEach((item) => {
          if (!item || typeof item !== "object") return;
          const o = item as Record<string, unknown>;
          put(o.key ?? o.name ?? o.status, o.offset_days ?? o.offset ?? o.value);
        });
      }
      if (root.values && typeof root.values === "object") {
        parsePairsObject(root.values);
      }
      parsePairsObject(root);
    }
  }

  const sourceText = typeof rawData === "string" ? rawData : "";
  const pairRegex = /["']?([A-Za-z0-9_]+)["']?\s*:\s*["']?(-?\d+(?:[.,]\d+)?)["']?/g;
  let match: RegExpExecArray | null = null;
  while ((match = pairRegex.exec(sourceText)) !== null) {
    put(match[1], match[2]);
  }

  return out;
}

function get(row: AnyRecord | null | undefined, keys: string[]): unknown {
  if (!row) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return undefined;
}

function getText(row: AnyRecord | null | undefined, keys: string[]): string {
  return text(get(row, keys));
}

function getNum(row: AnyRecord | null | undefined, keys: string[]): number {
  return num(get(row, keys));
}

function asRecordArray(value: unknown): AnyRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AnyRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parsePayload(value: unknown): AnyRecord | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as AnyRecord;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as AnyRecord : null;
  } catch {
    return null;
  }
}

function parseGeneratedAt(payload: AnyRecord): string | null {
  const raw = text(payload.generated_at ?? payload.generatedAt);
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

async function loadBaseDeadlines(whId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("wh_data_rep")
    .select("data")
    .eq("wh_id", whId)
    .eq("data_type", DEADLINES_DATA_TYPE)
    .limit(20);

  if (error) throw new Error(`Не удалось прочитать ${DEADLINES_DATA_TYPE}: ${error.message}`);

  const out: Record<string, number> = {};
  for (const row of Array.isArray(data) ? data : []) {
    Object.assign(out, extractDeadlinesFromData((row as AnyRecord).data));
  }
  return out;
}

async function loadDeadlineAdjustments(whId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .select("setting_key, setting_value")
    .eq("wh_id", whId)
    .eq("alert_type", "deadline_adjustments")
    .eq("is_active", true);

  if (error) throw new Error(`Не удалось прочитать deadline_adjustments: ${error.message}`);

  const out: Record<string, number> = {};
  for (const row of Array.isArray(data) ? data : []) {
    const settingKey = text((row as AnyRecord).setting_key);
    const deadlineKey = DEADLINE_ADJUSTMENT_SETTING_KEYS[settingKey];
    const value = parseDeadlineNumber((row as AnyRecord).setting_value);
    if (!deadlineKey || value === null) continue;
    out[deadlineKey] = value;
  }
  return out;
}

function buildDeadlineItems(
  baseDeadlines: Record<string, number>,
  configuredDeadlines: Record<string, number>,
): AnyRecord[] {
  const keys = new Set([...Object.keys(baseDeadlines), ...Object.keys(configuredDeadlines)]);
  return Array.from(keys)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const baseOffset = baseDeadlines[key];
      const hasBaseOffset = Number.isFinite(baseOffset);
      const hasConfiguredOffset = Number.isFinite(configuredDeadlines[key]);
      const configuredOffset = hasConfiguredOffset ? configuredDeadlines[key] : baseOffset;
      const offset = hasBaseOffset ? baseOffset : configuredOffset;
      const effectiveOffsetRaw = Number.isFinite(configuredOffset) ? configuredOffset : offset;
      const effectiveOffset = normalizeDateOnlyDeadlineOffset(key, effectiveOffsetRaw);
      const dayAdjustment = hasBaseOffset && Number.isFinite(effectiveOffset)
        ? effectiveOffset - baseOffset
        : 0;
      return {
        key,
        display_key: DEADLINE_LABELS[key] || key,
        offset_days: offset,
        day_adjustment: dayAdjustment,
        effective_offset_days: effectiveOffset,
        source: hasConfiguredOffset ? "settings" : "base",
      };
    })
    .filter((item) => Number.isFinite(item.offset_days) && Number.isFinite(item.effective_offset_days));
}

async function buildDeadlineSettingsResponse(whId: string): Promise<AnyRecord> {
  const base = await loadBaseDeadlines(whId);
  const configured = await loadDeadlineAdjustments(whId);
  const items = buildDeadlineItems(base, configured);
  const effective: Record<string, number> = {};
  const adjustments: Record<string, number> = {};
  items.forEach((item) => {
    effective[text(item.key)] = num(item.effective_offset_days);
    adjustments[text(item.key)] = num(item.day_adjustment);
  });

  return {
    base,
    configured,
    effective,
    adjustments,
    items,
    deadlines: items,
  };
}

function pct(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

function nullableDateKey(value: unknown): string | null {
  const raw = text(value);
  return isIsoDate(raw) ? raw : null;
}

function getShiftDateKey(shift: AnyRecord): string | null {
  const direct = nullableDateKey(get(shift, ["operational_date_key", "operationalDateKey", "shift_date", "date"]));
  if (direct) return direct;

  const shiftId = getText(shift, ["shift_id", "shiftId"]);
  const match = shiftId.match(/(?:day|night|shift):(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

function detailHasUpload(detail: AnyRecord): boolean {
  const uploadStatus = getText(detail, ["upload_status", "uploadStatus"]);
  const due = getNum(detail, ["due_total_unique_shk", "dueTotal", "due_total", "totalDue"]);
  return due > 0 || /есть/i.test(uploadStatus);
}

function detailSeverity(detail: AnyRecord): string {
  if (!detailHasUpload(detail)) return "critical";

  const due = getNum(detail, ["due_total_unique_shk", "dueTotal", "due_total", "totalDue"]);
  const analyzed = getNum(detail, ["analyzed_due_unique_shk", "analyzed", "analyzedDue"]);
  const dueSum = getNum(detail, ["due_total_sum_price", "dueSumPrice", "due_sum_price"]);
  const analyzedSum = getNum(detail, ["analyzed_due_sum_price", "analyzedSumPrice", "analyzed_sum_price"]);
  const expensiveDue = getNum(detail, ["expensive_due_total_unique_shk", "expensiveDueTotal", "expensive_due_total"]);
  const expensiveAnalyzed = getNum(detail, [
    "expensive_analyzed_due_unique_shk",
    "expensiveAnalyzed",
    "expensive_analyzed",
  ]);

  const analyzedPct = pct(analyzed, due);
  const sumPct = pct(analyzedSum, dueSum);
  const expensivePct = pct(expensiveAnalyzed, expensiveDue);

  if ((analyzedPct !== null && analyzedPct < 70) || (sumPct !== null && sumPct < 70) || (expensivePct !== null && expensivePct < 100)) {
    return "critical";
  }
  if ((analyzedPct !== null && analyzedPct < 85) || (sumPct !== null && sumPct < 85)) {
    return "warning";
  }
  return "ok";
}

function metric(
  metric_key: string,
  metric_name: string,
  value_num: number | null,
  unit: string | null,
  options: Partial<MetricInput> = {},
): MetricInput {
  return {
    metric_key,
    metric_name,
    value_num,
    unit,
    group_key: options.group_key ?? null,
    group_name: options.group_name ?? null,
    metric_date: options.metric_date ?? null,
    value_text: options.value_text ?? null,
    severity: options.severity ?? null,
    dimensions: options.dimensions ?? null,
  };
}

function buildOppShiftMetrics(shift: AnyRecord): MetricInput[] {
  const metrics: MetricInput[] = [];
  const shiftDate = getShiftDateKey(shift);
  const due = getNum(shift, ["total_due_unique_shk", "totalDue", "dueTotal"]);
  const analyzed = getNum(shift, ["analyzed_due_unique_shk", "analyzed", "analyzedDue"]);
  const dueSum = getNum(shift, ["total_due_sum_price", "dueSumPrice"]);
  const analyzedSum = getNum(shift, ["analyzed_due_sum_price", "analyzedSumPrice"]);
  const expensiveDue = getNum(shift, ["expensive_due_total_unique_shk", "expensiveDueTotal"]);
  const expensiveAnalyzed = getNum(shift, ["expensive_analyzed_due_unique_shk", "expensiveAnalyzed"]);

  metrics.push(metric("due_unique_shk", "Всего ШК", due, "shk", { metric_date: shiftDate }));
  metrics.push(metric("analyzed_unique_shk", "Разобрано ШК", analyzed, "shk", { metric_date: shiftDate }));
  metrics.push(metric("analyzed_percent", "Процент разбора ШК", pct(analyzed, due), "percent", { metric_date: shiftDate }));
  metrics.push(metric("due_sum_price", "Стоимость всего", dueSum, "rub", { metric_date: shiftDate }));
  metrics.push(metric("analyzed_sum_price", "Стоимость разобранного", analyzedSum, "rub", { metric_date: shiftDate }));
  metrics.push(metric("sum_percent", "Процент разбора суммы", pct(analyzedSum, dueSum), "percent", { metric_date: shiftDate }));
  metrics.push(metric("expensive_due_unique_shk", "Дорогостой всего", expensiveDue, "shk", { metric_date: shiftDate }));
  metrics.push(metric("expensive_analyzed_unique_shk", "Дорогостой разобрано", expensiveAnalyzed, "shk", { metric_date: shiftDate }));
  metrics.push(metric("expensive_analyzed_percent", "Процент разбора дорогостоя", pct(expensiveAnalyzed, expensiveDue), "percent", { metric_date: shiftDate }));

  const employeeNames = Array.isArray(shift.analyzer_values)
    ? shift.analyzer_values.map((value) => text(value)).filter(Boolean)
    : [];
  if (employeeNames.length) {
    metrics.push(metric("employees", "Сотрудники", null, null, {
      value_text: employeeNames.join(", "),
      metric_date: shiftDate,
      dimensions: { employees: employeeNames },
    }));
  }

  for (const detail of asRecordArray(shift.details)) {
    const groupKey = getText(detail, ["key", "display_key", "displayKey"]) || "unknown";
    const groupName = getText(detail, ["display_key", "displayKey", "key"]) || groupKey;
    const severity = detailSeverity(detail);
    const detailDate = nullableDateKey(get(detail, ["due_for_date", "dueDate"])) ?? shiftDate;
    const detailDue = getNum(detail, ["due_total_unique_shk", "dueTotal", "due_total", "totalDue"]);
    const detailAnalyzed = getNum(detail, ["analyzed_due_unique_shk", "analyzed", "analyzedDue"]);
    const detailDueSum = getNum(detail, ["due_total_sum_price", "dueSumPrice", "due_sum_price"]);
    const detailAnalyzedSum = getNum(detail, ["analyzed_due_sum_price", "analyzedSumPrice", "analyzed_sum_price"]);
    const detailExpensiveDue = getNum(detail, ["expensive_due_total_unique_shk", "expensiveDueTotal", "expensive_due_total"]);
    const detailExpensiveAnalyzed = getNum(detail, [
      "expensive_analyzed_due_unique_shk",
      "expensiveAnalyzed",
      "expensive_analyzed",
    ]);
    const lowQualityCount = getNum(detail, [
      "low_quality_without_comment_unique_shk",
      "lowQualityWithoutComment",
      "low_quality_without_comment",
    ]);
    const lowQualityPercent = getNum(detail, [
      "low_quality_without_comment_percent",
      "lowQualityWithoutCommentPercent",
    ]) || pct(lowQualityCount, detailDue);

    const common = {
      group_key: groupKey,
      group_name: groupName,
      metric_date: detailDate,
      severity,
      dimensions: {
        sheet_names: Array.isArray(detail.sheet_names) ? detail.sheet_names : [],
        due_for_date_label: getText(detail, ["due_for_date_label", "dueForDateLabel"]),
        due_until_label: getText(detail, ["due_until_label", "dueUntilLabel"]),
      },
    };

    metrics.push(metric("upload_status", "Статус выгрузки", null, null, {
      ...common,
      value_text: detailHasUpload(detail) ? "Есть" : "Нет выгрузки",
    }));
    metrics.push(metric("due_unique_shk", "Всего ШК", detailDue, "shk", common));
    metrics.push(metric("analyzed_unique_shk", "Разобрано ШК", detailAnalyzed, "shk", common));
    metrics.push(metric("analyzed_percent", "Процент разбора ШК", pct(detailAnalyzed, detailDue), "percent", common));
    metrics.push(metric("due_sum_price", "Стоимость всего", detailDueSum, "rub", common));
    metrics.push(metric("analyzed_sum_price", "Стоимость разобранного", detailAnalyzedSum, "rub", common));
    metrics.push(metric("sum_percent", "Процент разбора суммы", pct(detailAnalyzedSum, detailDueSum), "percent", common));
    metrics.push(metric("expensive_due_unique_shk", "Дорогостой всего", detailExpensiveDue, "shk", common));
    metrics.push(metric("expensive_analyzed_unique_shk", "Дорогостой разобрано", detailExpensiveAnalyzed, "shk", common));
    metrics.push(metric("expensive_analyzed_percent", "Процент разбора дорогостоя", pct(detailExpensiveAnalyzed, detailExpensiveDue), "percent", common));
    metrics.push(metric("low_quality_without_comment_unique_shk", "Ожидает обработки без комментария", lowQualityCount, "shk", common));
    metrics.push(metric("low_quality_without_comment_percent", "Процент ожидания без комментария", lowQualityPercent, "percent", common));

    const detailEmployees = Array.isArray(detail.analyzer_values)
      ? detail.analyzer_values.map((value) => text(value)).filter(Boolean)
      : [];
    if (detailEmployees.length) {
      metrics.push(metric("employees", "Сотрудники", null, null, {
        ...common,
        value_text: detailEmployees.join(", "),
        dimensions: {
          ...common.dimensions,
          employees: detailEmployees,
        },
      }));
    }

    for (const statusItem of asRecordArray(detail.breakdown_status_counts)) {
      const status = getText(statusItem, ["status", "name", "title"]);
      const count = getNum(statusItem, ["count", "value"]);
      if (!status || count <= 0) continue;
      metrics.push(metric("breakdown_status_count", "Статус разбора", count, "shk", {
        ...common,
        value_text: status,
        dimensions: {
          ...common.dimensions,
          breakdown_status: status,
        },
      }));
    }
  }

  for (const statusItem of asRecordArray(shift.breakdown_status_counts)) {
    const status = getText(statusItem, ["status", "name", "title"]);
    const count = getNum(statusItem, ["count", "value"]);
    if (!status || count <= 0) continue;
    metrics.push(metric("breakdown_status_count", "Статус разбора", count, "shk", {
      value_text: status,
      metric_date: shiftDate,
      dimensions: { breakdown_status: status },
    }));
  }

  return metrics;
}

async function insertReportRun(run: AnyRecord, metrics: MetricInput[]) {
  const { data, error } = await supabase
    .from(REPORT_RUNS_TABLE)
    .insert(run)
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const runId = Number((data as AnyRecord | null)?.id);
  if (!Number.isFinite(runId)) throw new Error("report_runs insert did not return id");

  if (metrics.length) {
    const rows = metrics.map((item) => ({
      run_id: runId,
      metric_key: item.metric_key,
      metric_name: item.metric_name,
      group_key: item.group_key ?? null,
      group_name: item.group_name ?? null,
      metric_date: item.metric_date ?? null,
      value_num: item.value_num ?? null,
      value_text: item.value_text ?? null,
      unit: item.unit ?? null,
      severity: item.severity ?? null,
      dimensions: item.dimensions ?? {},
    }));
    const { error: metricsError } = await supabase.from(REPORT_METRICS_TABLE).insert(rows);
    if (metricsError) throw new Error(metricsError.message);
  }

  return {
    run_id: runId,
    metrics_count: metrics.length,
  };
}

async function logOppCachePayload(params: {
  whId: string;
  cacheScope: string;
  dateFrom: string;
  dateTo: string;
  payload: AnyRecord;
  refreshedAt: string;
}) {
  const { whId, cacheScope, dateFrom, dateTo, payload, refreshedAt } = params;
  if (cacheScope !== "opp_telegram_shift") {
    return {
      logged_runs: 0,
      logged_metrics: 0,
      skipped_reason: "scope_is_not_shift_log_source",
    };
  }

  const generatedAt = parseGeneratedAt(payload);
  const shifts = asRecordArray(payload.shift_dynamics);
  let loggedRuns = 0;
  let loggedMetrics = 0;

  for (const shift of shifts) {
    const shiftId = getText(shift, ["shift_id", "shiftId"]) || `shift:${getShiftDateKey(shift) || dateTo}`;
    const shiftDate = getShiftDateKey(shift) || dateTo;
    const metrics = buildOppShiftMetrics(shift);
    const inserted = await insertReportRun({
      wh_id: whId,
      mechanism: "Анализ таблицы ОПП",
      report_scope: cacheScope,
      shift_id: shiftId,
      shift_date: shiftDate,
      period_from: dateFrom,
      period_to: dateTo,
      status: "success",
      source: "opp-cache-ingest",
      source_ref: cacheScope,
      generated_at: generatedAt,
      run_key: `${whId}:${cacheScope}:${shiftId}:${refreshedAt}`,
      payload: {
        shift,
        cache_scope: cacheScope,
        source_generated_at: payload.generated_at ?? null,
        deadline_source_counts: payload.deadline_source_counts ?? null,
      },
    }, metrics);

    loggedRuns += 1;
    loggedMetrics += inserted.metrics_count;
  }

  return {
    logged_runs: loggedRuns,
    logged_metrics: loggedMetrics,
    skipped_reason: shifts.length ? null : "payload_has_no_shift_dynamics",
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed. Use POST." });
  }

  const body = await req.json().catch(() => ({})) as AnyRecord;
  if (INGEST_SECRET && text(body.secret) !== INGEST_SECRET) {
    return json(401, { ok: false, error: "Invalid ingest secret" });
  }

  const whId = text(body.wh_id ?? body.whId);
  const action = text(body.action ?? body.mode);

  if (action === "get_deadlines" || action === "deadline_settings") {
    if (!whId) return json(400, { ok: false, error: "Missing wh_id" });
    try {
      const deadlineSettings = await buildDeadlineSettingsResponse(whId);
      return json(200, {
        ok: true,
        wh_id: whId,
        ...deadlineSettings,
      });
    } catch (error) {
      return json(500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const cacheScope = text(body.cache_scope ?? body.cacheScope ?? body.scope);
  const dateFrom = text(body.date_from ?? body.dateFrom);
  const dateTo = text(body.date_to ?? body.dateTo);
  const payload = parsePayload(body.payload);
  const ttlMinutes = Math.max(Number(body.ttl_minutes ?? body.ttlMinutes ?? DEFAULT_TTL_MINUTES) || DEFAULT_TTL_MINUTES, 5);

  if (!whId) return json(400, { ok: false, error: "Missing wh_id" });
  if (!ALLOWED_SCOPES.has(cacheScope)) {
    return json(400, { ok: false, error: "Unsupported cache_scope", allowed_scopes: Array.from(ALLOWED_SCOPES) });
  }
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) {
    return json(400, { ok: false, error: "date_from and date_to must be YYYY-MM-DD" });
  }
  if (dateFrom > dateTo) return json(400, { ok: false, error: "date_from cannot be greater than date_to" });
  if (!payload) return json(400, { ok: false, error: "Missing or invalid payload" });

  const now = new Date();
  const staleAfter = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  const row = {
    wh_id: whId,
    cache_scope: cacheScope,
    date_from: dateFrom,
    date_to: dateTo,
    payload,
    source_generated_at: parseGeneratedAt(payload),
    refreshed_at: now.toISOString(),
    stale_after: staleAfter.toISOString(),
  };

  const { error } = await supabase
    .from(CACHE_TABLE)
    .upsert(row, { onConflict: "wh_id,cache_scope,date_from,date_to" });

  if (error) {
    return json(500, { ok: false, error: error.message });
  }

  let logging: AnyRecord = {
    logged_runs: 0,
    logged_metrics: 0,
  };
  try {
    logging = await logOppCachePayload({
      whId,
      cacheScope,
      dateFrom,
      dateTo,
      payload,
      refreshedAt: row.refreshed_at,
    });
  } catch (logError) {
    logging = {
      logged_runs: 0,
      logged_metrics: 0,
      error: logError instanceof Error ? logError.message : String(logError),
    };
  }

  return json(200, {
    ok: true,
    wh_id: whId,
    cache_scope: cacheScope,
    date_from: dateFrom,
    date_to: dateTo,
    refreshed_at: row.refreshed_at,
    stale_after: row.stale_after,
    logging,
  });
});
