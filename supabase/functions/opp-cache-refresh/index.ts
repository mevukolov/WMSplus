import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type PeriodScope = {
  scope: string;
  from: string;
  to: string;
};

type WarehouseConfig = {
  whId: string;
  apiUrl: string;
  deadlinesMap: Record<string, number>;
  deadlineAdjustmentsMap: Record<string, number>;
};

type DeadlineRequestItem = {
  key: string;
  display_key: string;
  offset_days: number;
  day_adjustment: number;
  effective_offset_days: number;
  source: "settings" | "base";
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const API_DATA_TYPE = (Deno.env.get("OPP_CACHE_API_DATA_TYPE") ?? "opp_table_analisys_script").trim();
const DEADLINES_DATA_TYPE = (Deno.env.get("OPP_CACHE_DEADLINES_DATA_TYPE") ?? "opp_table_deadlines").trim();
const SETTINGS_TABLE = (Deno.env.get("OPP_ALERT_SETTINGS_TABLE") ?? "opp_alert_settings").trim();
const CACHE_TABLE = (Deno.env.get("OPP_CACHE_TABLE") ?? "opp_reports_cache").trim();
const CACHE_TTL_MINUTES = Math.max(Number(Deno.env.get("OPP_CACHE_TTL_MINUTES") ?? "30") || 30, 5);
const API_REQUEST_TIMEOUT_MS = Math.max(Number(Deno.env.get("OPP_CACHE_API_TIMEOUT_MS") ?? "600000") || 600000, 10000);
const TELEGRAM_SHIFT_SCOPE = "opp_telegram_shift";
const TELEGRAM_ROLLING30_SCOPE = "opp_telegram_rolling30";
const SUPPORTED_SCOPES = new Set([
  "opp_admin",
  "opp_dashboard_month",
  "opp_dashboard_shift",
  "opp_dashboard_rolling30",
  TELEGRAM_SHIFT_SCOPE,
  TELEGRAM_ROLLING30_SCOPE,
]);
const DEFAULT_REFRESH_SCOPES_RAW = (
  Deno.env.get("OPP_CACHE_DEFAULT_SCOPES") ??
  `${TELEGRAM_SHIFT_SCOPE},${TELEGRAM_ROLLING30_SCOPE}`
).trim();

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

function json(status: number, body: JsonObject) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeDeadlineKey(value: unknown): string {
  return normalizeKey(value).toUpperCase().replace(/\s+/g, "");
}

function parseDeadlineNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = normalizeKey(value).replace(",", ".");
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

function collectCandidateStrings(value: unknown, out: string[]) {
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number") {
    out.push(String(value).trim());
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectCandidateStrings(item, out));
    return;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectCandidateStrings(item, out));
  }
}

function extractAppsScriptUrlFromData(rawData: unknown): string {
  const data = parseMaybeJson(rawData);
  const regex = /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/(?:exec|dev)(?:\?[^\s"']*)?/i;

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const preferred = ["apps_script_url", "appsScriptUrl", "api_url", "apiUrl", "gas_url", "gasUrl"];
    for (const key of preferred) {
      const val = normalizeKey((data as Record<string, unknown>)[key]);
      if (!val) continue;
      const m = val.match(regex);
      if (m) return m[0];
    }
  }

  const candidates: string[] = [];
  collectCandidateStrings(data, candidates);
  for (const candidate of candidates) {
    const m = candidate.match(regex);
    if (m) return m[0];
  }
  return "";
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

function toMoscowDate(value: Date): Date {
  return new Date(value.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toIsoDate(dateObj: Date): string {
  return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
}

function parseIsoDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const safe = parseIsoDate(isoDate);
  if (!safe) return "";
  const dt = new Date(`${safe}T00:00:00`);
  if (!Number.isFinite(dt.getTime())) return "";
  dt.setDate(dt.getDate() + Number(deltaDays || 0));
  return toIsoDate(dt);
}

function getPeriodsForRefresh(): PeriodScope[] {
  const today = toIsoDate(toMoscowDate(new Date()));
  const monthStart = `${today.slice(0, 7)}-01`;
  const adminFrom = shiftIsoDate(today, -7) || today;
  const rolling30From = shiftIsoDate(today, -29) || today;
  // Для dashboard текущей/предыдущей смены достаточно последних суток.
  // Минимальный диапазон для стабильного refresh без таймаутов.
  const shiftFrom = shiftIsoDate(today, -1) || monthStart;

  return [
    { scope: "opp_admin", from: adminFrom, to: today },
    { scope: "opp_dashboard_month", from: monthStart, to: today },
    { scope: "opp_dashboard_rolling30", from: rolling30From, to: today },
    { scope: "opp_dashboard_shift", from: shiftFrom, to: today },
    { scope: TELEGRAM_ROLLING30_SCOPE, from: rolling30From, to: today },
    { scope: TELEGRAM_SHIFT_SCOPE, from: shiftFrom, to: today },
  ];
}

function normalizeWhFilter(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizeKey(item)).filter(Boolean);
  }
  return [normalizeKey(raw)].filter(Boolean);
}

function normalizeScopeFilter(raw: unknown): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw)
    ? raw
    : String(raw).split(",").map((item) => item.trim()).filter(Boolean);
  const out = new Set<string>();
  list.forEach((item) => {
    const scope = normalizeKey(item);
    if (!scope) return;
    if (!SUPPORTED_SCOPES.has(scope)) return;
    out.add(scope);
  });
  return Array.from(out);
}

function getDefaultScopeFilter(): string[] {
  const defaults = normalizeScopeFilter(DEFAULT_REFRESH_SCOPES_RAW);
  return defaults.length ? defaults : [TELEGRAM_SHIFT_SCOPE, TELEGRAM_ROLLING30_SCOPE];
}

function buildDeadlineRequestItems(
  deadlinesMap: Record<string, number>,
  configuredDeadlinesMap: Record<string, number> = {},
): DeadlineRequestItem[] {
  const keys = new Set([...Object.keys(deadlinesMap), ...Object.keys(configuredDeadlinesMap)]);
  return Array.from(keys)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const baseOffset = deadlinesMap[key];
      const hasBaseOffset = Number.isFinite(baseOffset);
      const hasConfiguredOffset = Number.isFinite(configuredDeadlinesMap[key]);
      const configuredOffset = hasConfiguredOffset ? configuredDeadlinesMap[key] : baseOffset;
      const offset = hasBaseOffset ? baseOffset : configuredOffset;
      const effectiveOffsetRaw = Number.isFinite(configuredOffset) ? configuredOffset : offset;
      const effectiveOffset = normalizeDateOnlyDeadlineOffset(key, effectiveOffsetRaw);
      const dayAdjustment = hasBaseOffset && Number.isFinite(effectiveOffset)
        ? effectiveOffset - baseOffset
        : 0;
      return {
        key,
        offset_days: offset,
        day_adjustment: dayAdjustment,
        effective_offset_days: effectiveOffset,
        display_key: DEADLINE_LABELS[key] || key,
        source: hasConfiguredOffset ? "settings" : "base",
      };
    })
    .filter((item) => Number.isFinite(item.offset_days) && Number.isFinite(item.effective_offset_days));
}

function buildDeadlineSettingsMeta(
  deadlinesMap: Record<string, number>,
  configuredDeadlinesMap: Record<string, number> = {},
): JsonObject {
  const base: Record<string, number> = {};
  const configured: Record<string, number> = {};
  const effective: Record<string, number> = {};
  const adjustments: Record<string, number> = {};
  const items = buildDeadlineRequestItems(deadlinesMap, configuredDeadlinesMap);

  Object.entries(deadlinesMap).forEach(([key, value]) => {
    if (Number.isFinite(value)) base[key] = value;
  });
  Object.entries(configuredDeadlinesMap).forEach(([key, value]) => {
    if (Number.isFinite(value)) configured[key] = value;
  });
  items.forEach((item) => {
    effective[item.key] = item.effective_offset_days;
    adjustments[item.key] = item.day_adjustment;
  });

  return {
    base,
    configured,
    effective,
    adjustments,
    items,
  };
}

function buildDeadlinesRequestPayload(deadlinesMap: Record<string, number>, configuredDeadlinesMap: Record<string, number> = {}): string {
  const items = buildDeadlineRequestItems(deadlinesMap, configuredDeadlinesMap);
  if (!items.length) return "";
  return JSON.stringify({ deadlines: items });
}

function buildApiRequestUrl(
  baseUrl: string,
  whId: string,
  period: PeriodScope,
  deadlinesMap: Record<string, number>,
  adjustmentsMap: Record<string, number> = {},
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("mode", "unique_shk_by_date");
  url.searchParams.set("date_from", period.from);
  url.searchParams.set("date_to", period.to);
  url.searchParams.set("_ts", String(Date.now()));
  if (whId) url.searchParams.set("wh_id", whId);

  const deadlinesJson = buildDeadlinesRequestPayload(deadlinesMap, adjustmentsMap);
  if (deadlinesJson) {
    url.searchParams.set("deadlines_json", deadlinesJson);
  }
  if (
    period.scope === "opp_dashboard_rolling30" ||
    period.scope === "opp_dashboard_shift" ||
    period.scope === "opp_dashboard_month" ||
    period.scope === TELEGRAM_ROLLING30_SCOPE ||
    period.scope === TELEGRAM_SHIFT_SCOPE
  ) {
    url.searchParams.set("skip_period_sheets", "1");
  }
  if (period.scope === "opp_dashboard_shift" || period.scope === TELEGRAM_SHIFT_SCOPE) {
    url.searchParams.set("skip_today_deadline", "1");
    url.searchParams.set("shift_current_only", "1");
  }
  return url.toString();
}

async function fetchOppPayload(
  apiUrl: string,
  whId: string,
  period: PeriodScope,
  deadlinesMap: Record<string, number>,
  adjustmentsMap: Record<string, number> = {},
): Promise<JsonObject> {
  const url = buildApiRequestUrl(apiUrl, whId, period, deadlinesMap, adjustmentsMap);
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`API вернул не JSON (${period.scope}, ${period.from}..${period.to})`);
  }

  if (!response.ok || (payload as Record<string, unknown>)?.ok === false) {
    const p = payload as Record<string, unknown>;
    throw new Error(String(p?.error ?? `HTTP ${response.status}`));
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("API вернул неожиданный формат payload");
  }

  return payload as JsonObject;
}

async function loadDeadlineAdjustments(whFilter: string[]): Promise<Map<string, Record<string, number>>> {
  let query = supabase
    .from(SETTINGS_TABLE)
    .select("wh_id, setting_key, setting_value")
    .eq("alert_type", "deadline_adjustments")
    .eq("is_active", true);

  if (whFilter.length === 1) {
    query = query.eq("wh_id", whFilter[0]);
  } else if (whFilter.length > 1) {
    query = query.in("wh_id", whFilter);
  }

  const { data, error } = await query;
  if (error) {
    console.warn(`Не удалось прочитать ${SETTINGS_TABLE}: ${error.message}`);
    return new Map();
  }

  const out = new Map<string, Record<string, number>>();
  for (const row of Array.isArray(data) ? data : []) {
    const whId = normalizeKey((row as Record<string, unknown>).wh_id);
    const settingKey = normalizeKey((row as Record<string, unknown>).setting_key);
    const deadlineKey = DEADLINE_ADJUSTMENT_SETTING_KEYS[settingKey];
    const value = parseDeadlineNumber((row as Record<string, unknown>).setting_value);
    if (!whId || !deadlineKey || value === null) continue;

    if (!out.has(whId)) out.set(whId, {});
    out.get(whId)![deadlineKey] = value;
  }

  return out;
}

async function loadWarehouseConfigs(whFilter: string[]): Promise<WarehouseConfig[]> {
  let query = supabase
    .from("wh_data_rep")
    .select("wh_id, data_type, data")
    .in("data_type", [API_DATA_TYPE, DEADLINES_DATA_TYPE]);

  if (whFilter.length === 1) {
    query = query.eq("wh_id", whFilter[0]);
  } else if (whFilter.length > 1) {
    query = query.in("wh_id", whFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Не удалось прочитать wh_data_rep: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  const grouped = new Map<string, WarehouseConfig>();

  for (const row of rows) {
    const whId = normalizeKey((row as Record<string, unknown>).wh_id);
    const dataType = normalizeKey((row as Record<string, unknown>).data_type);
    const dataValue = (row as Record<string, unknown>).data;
    if (!whId || !dataType) continue;

    if (!grouped.has(whId)) {
      grouped.set(whId, { whId, apiUrl: "", deadlinesMap: {}, deadlineAdjustmentsMap: {} });
    }

    const target = grouped.get(whId)!;

    if (dataType === API_DATA_TYPE) {
      const apiUrl = extractAppsScriptUrlFromData(dataValue);
      if (apiUrl && !target.apiUrl) {
        target.apiUrl = apiUrl;
      }
    }

    if (dataType === DEADLINES_DATA_TYPE) {
      const parsed = extractDeadlinesFromData(dataValue);
      Object.assign(target.deadlinesMap, parsed);
    }
  }

  const adjustmentsByWh = await loadDeadlineAdjustments(whFilter);
  for (const [whId, adjustments] of adjustmentsByWh.entries()) {
    const target = grouped.get(whId);
    if (!target) continue;
    Object.assign(target.deadlineAdjustmentsMap, adjustments);
  }

  return Array.from(grouped.values()).filter((cfg) => Boolean(cfg.apiUrl));
}

async function upsertCacheRow(whId: string, period: PeriodScope, payload: JsonObject) {
  const now = new Date();
  const staleAfter = new Date(now.getTime() + CACHE_TTL_MINUTES * 60 * 1000);
  const sourceGeneratedRaw = normalizeKey(payload.generated_at);
  const sourceGeneratedAt = sourceGeneratedRaw ? new Date(sourceGeneratedRaw) : null;
  const sourceGeneratedIso = sourceGeneratedAt && Number.isFinite(sourceGeneratedAt.getTime())
    ? sourceGeneratedAt.toISOString()
    : null;

  const row = {
    wh_id: whId,
    cache_scope: period.scope,
    date_from: period.from,
    date_to: period.to,
    payload,
    source_generated_at: sourceGeneratedIso,
    refreshed_at: now.toISOString(),
    stale_after: staleAfter.toISOString(),
  };

  const { error } = await supabase
    .from(CACHE_TABLE)
    .upsert(row, { onConflict: "wh_id,cache_scope,date_from,date_to" });

  if (error) {
    throw new Error(`Ошибка записи кэша (${period.scope}): ${error.message}`);
  }
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

  const whFilter = normalizeWhFilter(body.wh_id ?? body.wh_ids);
  const scopeRaw = body.scope ?? body.scopes;
  const requestedScopeFilter = normalizeScopeFilter(scopeRaw);
  const hasRequestedScopeFilter = scopeRaw !== null && scopeRaw !== undefined && normalizeKey(scopeRaw);
  const scopeFilter = hasRequestedScopeFilter ? requestedScopeFilter : getDefaultScopeFilter();
  const dryRun = Boolean(body.dry_run);
  const periods = getPeriodsForRefresh().filter((period) => {
    return scopeFilter.includes(period.scope);
  });

  if (!periods.length) {
    return json(400, {
      ok: false,
      error: "No valid scopes requested",
      supported_scopes: Array.from(SUPPORTED_SCOPES),
    });
  }

  try {
    const configs = await loadWarehouseConfigs(whFilter);
    if (!configs.length) {
      return json(200, {
        ok: true,
        message: "No warehouses with API config found",
        wh_filter: whFilter,
      });
    }

    const startedAt = new Date().toISOString();
    let refreshedCount = 0;
    let failedCount = 0;
    const errors: Array<Record<string, string>> = [];

    for (const cfg of configs) {
      for (const period of periods) {
        try {
          const deadlineSettings = buildDeadlineSettingsMeta(cfg.deadlinesMap, cfg.deadlineAdjustmentsMap);
          const payload = await fetchOppPayload(
            cfg.apiUrl,
            cfg.whId,
            period,
            cfg.deadlinesMap,
            cfg.deadlineAdjustmentsMap,
          );
          payload.deadline_settings = deadlineSettings;
          if (!dryRun) {
            await upsertCacheRow(cfg.whId, period, payload);
          }
          refreshedCount += 1;
        } catch (err) {
          failedCount += 1;
          errors.push({
            wh_id: cfg.whId,
            scope: period.scope,
            error: String(err instanceof Error ? err.message : err),
          });
        }
      }
    }

    return json(200, {
      ok: true,
      dry_run: dryRun,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ttl_minutes: CACHE_TTL_MINUTES,
      scope_filter: scopeFilter,
      requested_scope_filter: requestedScopeFilter,
      default_scope_filter: getDefaultScopeFilter(),
      warehouses: configs.length,
      periods_per_warehouse: periods.length,
      refreshed_count: refreshedCount,
      failed_count: failedCount,
      errors,
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: String(err instanceof Error ? err.message : err),
    });
  }
});
