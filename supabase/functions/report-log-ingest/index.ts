import { createClient } from "npm:@supabase/supabase-js@2";

type AnyRecord = Record<string, unknown>;
type NormalizedMetric = {
  metric_key: string;
  metric_name: string;
  group_key: string | null;
  group_name: string | null;
  metric_date: string | null;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  severity: string | null;
  dimensions: AnyRecord;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const REPORT_RUNS_TABLE = (Deno.env.get("REPORT_RUNS_TABLE") || "report_runs").trim();
const REPORT_METRICS_TABLE = (Deno.env.get("REPORT_METRICS_TABLE") || "report_metrics").trim();
const INGEST_SECRET =
  Deno.env.get("REPORT_LOG_INGEST_SECRET") ||
  Deno.env.get("OPP_CACHE_INGEST_SECRET") ||
  Deno.env.get("OPP_ALERT_SECRET") ||
  "";

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

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateOrNull(value: unknown): string | null {
  const raw = text(value);
  return isIsoDate(raw) ? raw : null;
}

function timestamptzOrNull(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

function objectOrEmpty(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function getProvidedSecret(req: Request, body: AnyRecord): string {
  const directHeader = req.headers.get("x-report-log-secret");
  if (directHeader?.trim()) return directHeader.trim();

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token) return token;
  }

  const url = new URL(req.url);
  const fromQuery = text(url.searchParams.get("secret") ?? url.searchParams.get("token"));
  if (fromQuery) return fromQuery;

  return text(body.secret);
}

function normalizeMetric(raw: unknown): NormalizedMetric | null {
  const item = objectOrEmpty(raw);
  const metricKey = text(item.metric_key ?? item.metricKey ?? item.key);
  if (!metricKey) return null;

  return {
    metric_key: metricKey,
    metric_name: text(item.metric_name ?? item.metricName ?? item.name) || metricKey,
    group_key: text(item.group_key ?? item.groupKey) || null,
    group_name: text(item.group_name ?? item.groupName) || null,
    metric_date: dateOrNull(item.metric_date ?? item.metricDate),
    value_num: numOrNull(item.value_num ?? item.valueNum ?? item.value),
    value_text: text(item.value_text ?? item.valueText) || null,
    unit: text(item.unit) || null,
    severity: text(item.severity) || null,
    dimensions: objectOrEmpty(item.dimensions),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed. Use POST." });
  }

  let body: AnyRecord;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json(400, { ok: false, error: "Request body must be a JSON object" });
    }
    body = parsed as AnyRecord;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON payload" });
  }

  if (INGEST_SECRET && getProvidedSecret(req, body) !== INGEST_SECRET) {
    return json(401, { ok: false, error: "Invalid report log secret" });
  }

  const mechanism = text(body.mechanism ?? body.mechanism_name ?? body.mechanismName);
  if (!mechanism) return json(400, { ok: false, error: "Missing mechanism" });

  const run = {
    wh_id: text(body.wh_id ?? body.whId) || null,
    mechanism,
    report_scope: text(body.report_scope ?? body.reportScope ?? body.scope) || null,
    shift_id: text(body.shift_id ?? body.shiftId) || null,
    shift_date: dateOrNull(body.shift_date ?? body.shiftDate),
    period_from: dateOrNull(body.period_from ?? body.periodFrom),
    period_to: dateOrNull(body.period_to ?? body.periodTo),
    status: text(body.status) || "success",
    source: text(body.source) || "report-log-ingest",
    source_ref: text(body.source_ref ?? body.sourceRef) || null,
    generated_at: timestamptzOrNull(body.generated_at ?? body.generatedAt),
    run_key: text(body.run_key ?? body.runKey) || null,
    payload: objectOrEmpty(body.payload),
  };

  const rawMetrics = Array.isArray(body.metrics) ? body.metrics : [];
  const metrics = rawMetrics
    .map(normalizeMetric)
    .filter((item): item is NormalizedMetric => Boolean(item));

  const { data, error } = await supabase
    .from(REPORT_RUNS_TABLE)
    .insert(run)
    .select("id")
    .single();

  if (error) {
    return json(500, {
      ok: false,
      error: "Failed to insert report run",
      details: error.message,
      db_code: error.code ?? null,
      db_hint: error.hint ?? null,
    });
  }

  const runId = Number((data as AnyRecord | null)?.id);
  if (!Number.isFinite(runId)) {
    return json(500, { ok: false, error: "report_runs insert did not return id" });
  }

  if (metrics.length) {
    const rows = metrics.map((item) => ({
      ...item,
      run_id: runId,
    }));
    const { error: metricsError } = await supabase.from(REPORT_METRICS_TABLE).insert(rows);
    if (metricsError) {
      return json(500, {
        ok: false,
        error: "Failed to insert report metrics",
        run_id: runId,
        details: metricsError.message,
        db_code: metricsError.code ?? null,
        db_hint: metricsError.hint ?? null,
      });
    }
  }

  return json(200, {
    ok: true,
    run_id: runId,
    metrics_count: metrics.length,
  });
});
