import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_SECRET = Deno.env.get("WEEEK_MANUAL_UPLOAD_SETTINGS_SECRET") ||
  Deno.env.get("WEEEK_BASIC_PACKAGING_UPLOAD_SECRET") ||
  Deno.env.get("WEEEK_UPLOAD_SECRET") ||
  Deno.env.get("WEEEK_TASK_MASTER_SECRET");

const SETTINGS_TABLE = "weeek_manual_upload_settings";
const ALLOWED_MODULES = new Set(["packaging", "rwp", "pm", "presort", "labeling", "marketplace_pc", "marketplace", "pc", "wmi_mp_pc", "no_order", "usd", "tmm", "after_sale_movement"]);
const ALLOWED_RESPONSIBILITY_ZONES = new Set(["Входящий поток", "Исходящий поток", "Нет привязки"]);

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

function normalizeInteger(value: unknown): number | null {
  if (value === null || value === undefined || normalizeText(value) === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function normalizeBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || normalizeText(value) === "") return null;
  if (typeof value === "boolean") return value;
  const raw = normalizeText(value).toLowerCase();
  if (["1", "true", "yes", "y", "да"].includes(raw)) return true;
  if (["0", "false", "no", "n", "нет"].includes(raw)) return false;
  return null;
}

async function listSettings(): Promise<JsonObject[]> {
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Failed to read manual upload settings: ${error.message}`);
  return (Array.isArray(data) ? data : []) as JsonObject[];
}

async function updateSetting(body: JsonObject): Promise<JsonObject> {
  const moduleName = normalizeText(body.module);
  if (!ALLOWED_MODULES.has(moduleName)) {
    throw new Error(`Unsupported module: ${moduleName || "(empty)"}`);
  }

  const patch: JsonObject = {};
  const uploadOffsetDays = normalizeInteger(body.upload_offset_days);
  const taskDeadlineDays = normalizeInteger(body.task_deadline_days);
  const pmDeadlineDays = normalizeInteger(body.pm_deadline_days);
  const mailDeadlineDays = normalizeInteger(body.mail_deadline_days);
  const isRequired = normalizeBoolean(body.is_required);
  const responsibilityZone = normalizeText(body.responsibility_zone);
  const updatedBy = normalizeText(body.updated_by);

  if (uploadOffsetDays !== null) patch.upload_offset_days = uploadOffsetDays;
  if (taskDeadlineDays !== null) patch.task_deadline_days = taskDeadlineDays;
  if (pmDeadlineDays !== null) patch.pm_deadline_days = pmDeadlineDays;
  if (mailDeadlineDays !== null) patch.mail_deadline_days = mailDeadlineDays;
  if (isRequired !== null) patch.is_required = isRequired;
  if (responsibilityZone) {
    if (!ALLOWED_RESPONSIBILITY_ZONES.has(responsibilityZone)) {
      throw new Error(`Unsupported responsibility_zone: ${responsibilityZone}`);
    }
    patch.responsibility_zone = responsibilityZone;
  }
  if (updatedBy) patch.updated_by = updatedBy;

  if (!Object.keys(patch).length) {
    throw new Error("No editable fields provided");
  }

  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .update(patch)
    .eq("module", moduleName)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to update manual upload setting: ${error.message}`);
  if (!data) throw new Error(`Setting not found: ${moduleName}`);
  return data as JsonObject;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed. Use POST." });

  const startedAt = new Date().toISOString();
  try {
    const raw = await req.json().catch(() => ({}));
    const body = asObject(raw) ?? {};
    const secret = normalizeText(body.secret);
    if (FUNCTION_SECRET && secret !== FUNCTION_SECRET) {
      return json(401, { ok: false, error: "Invalid manual upload settings secret" });
    }

    const action = normalizeText(body.action) || "list_settings";
    if (action === "list_settings" || action === "list") {
      const settings = await listSettings();
      return json(200, {
        ok: true,
        action: "list_settings",
        settings,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }

    if (action === "update_setting" || action === "update") {
      const setting = await updateSetting(body);
      const settings = await listSettings();
      return json(200, {
        ok: true,
        action: "update_setting",
        setting,
        settings,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }

    return json(400, { ok: false, error: `Unsupported action: ${action}` });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  }
});
