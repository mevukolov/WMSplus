  import { createClient } from "npm:@supabase/supabase-js@2";
  
  type JsonObject = Record<string, unknown>;
  
  type WeeekTaskRow = {
    id: string;
    source_module: string;
    source_id: string;
    source_payload: JsonObject | null;
    task_type: string;
    opp_verdict: string | null;
    task_status: string | null;
    reopen_after: string | null;
    return_board_id: string | null;
    return_board_name: string | null;
    return_column_id: string | null;
    return_column_name: string | null;
    reopen_count: number | null;
    board_key: string;
    column_key: string | null;
    title: string;
    description: string | null;
    priority: number | null;
    due_date: string | null;
    target_workspace_id: string | null;
    target_project_id: string | null;
    target_board_id: string | null;
    target_board_name: string | null;
    target_column_id: string | null;
    target_column_name: string | null;
    target_assignee_ids: string[] | null;
    target_custom_fields: JsonObject | null;
    target_tags: unknown[] | null;
    master_status: string;
    master_action: string;
    attempt_count: number | null;
    weeek_task_id: string | null;
    weeek_task_url: string | null;
    weeek_workspace_id: string | null;
    weeek_project_id: string | null;
    weeek_board_id: string | null;
    weeek_board_name: string | null;
    weeek_column_id: string | null;
    weeek_column_name: string | null;
    weeek_completed: boolean | null;
    weeek_deleted: boolean | null;
    weeek_updated_at: string | null;
    synced_at: string | null;
    created_at: string | null;
  };
  
  type WeeekRoute = {
    id: string;
    route_key: string;
    task_type: string;
    enabled: boolean;
    active_board_id: string | null;
    active_board_name: string;
    active_default_column_id: string | null;
    active_default_column_name: string;
    inactive_board_id: string | null;
    inactive_board_name: string;
    inactive_wait_column_id: string | null;
    inactive_wait_column_name: string;
    inactive_done_column_id: string | null;
    inactive_done_column_name: string;
    reopen_after_days: number;
    reopen_date_field_id: string | null;
    reopen_date_field_name: string;
    reopened_tag_id: string | null;
    reopened_tag_name: string;
    deferred_verdicts: string[];
    final_verdicts: string[];
    not_started_verdicts: string[];
  };
  
  type WeeekConfig = {
    apiBaseUrl: string;
    appBaseUrl: string;
    apiKey: string;
    workspaceId: string;
    projectId: string;
    taskKind: string;
    deadlineField: string;
    dedupeBySearch: boolean;
    oppVerdictSource: string;
    oppVerdictFieldId: string;
    oppVerdictFieldName: string;
    reopenAfterFieldId: string;
    reopenAfterFieldName: string;
    incomingFlowApiUrl: string;
    incomingFlowAppsScriptSecret: string;
    incomingFlowAttachmentFieldId: string;
    incomingFlowAttachmentFieldName: string;
    incomingFlowGuiltyIdFieldId: string;
    incomingFlowGuiltyIdFieldName: string;
    incomingFlowCommentFieldId: string;
    incomingFlowCommentFieldName: string;
    koledino27lrApiUrl: string;
    koledino27lrAppsScriptSecret: string;
  };
  
  type WeeekTaskMeta = {
    id: string;
    title: string | null;
    projectId: string | null;
    boardId: string | null;
    boardName: string | null;
    boardColumnId: string | null;
    boardColumnName: string | null;
    completed: boolean | null;
    deleted: boolean | null;
    updatedAt: string | null;
    url: string | null;
    oppVerdict: string | null;
    oppVerdictRaw: unknown;
    reopenAfter: string | null;
    completedByName: string | null;
    assigneeIds: string[];
  };
  
type CustomField = {
  id: string;
  name: string;
  type: string;
  options: JsonObject[];
  source: string;
};

type WeeekTag = {
  id: string;
  title: string;
  color: string | null;
};
  
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const FUNCTION_SECRET = Deno.env.get("WEEEK_TASK_MASTER_SECRET") || Deno.env.get("WEEEK_UPLOAD_SECRET");
  
  const TARGET_TABLE = "weeek_tasks";
  const ROUTES_TABLE = "weeek_task_routes";
  const DEFAULT_WEEEK_API_BASE_URL = "https://api.weeek.net/public/v1";
  const DEFAULT_WEEEK_APP_BASE_URL = "https://app.weeek.net";
  const DEFAULT_WORKSPACE_ID = "1021782";
  const DEFAULT_PROJECT_ID = "2";
  const DEFAULT_TASK_KIND = "action";
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT = 50;
  const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
  const DEFAULT_RETRY_DELAY_MINUTES = 10;
  const WEEEK_RATE_DELAY_MS = 1300;
  const SYSTEM_FINAL_OPP_VERDICT = "Найден/Релиз/Списан";
  const SYSTEM_CLOSED_TAG_NAME = "Закрыто системой";
  const INCOMING_FLOW_ROUTE_KEY = "incoming_flow_requests";
  const INCOMING_FLOW_SOURCE_MODULE = "incoming_flow_requests";
  const INCOMING_FLOW_TASK_TYPE = "Запросы входящего потока";
  const KOLEDINO_27LR_ROUTE_KEY = "koledino_27lr";
  const KOLEDINO_27LR_SOURCE_MODULE = "koledino_27lr";
  const KOLEDINO_27LR_TASK_TYPE = "Коледино + 27LR";
  const INCOMING_FLOW_ATTACHMENT_FIELD_NAME = "Вложение";
  const INCOMING_FLOW_GUILTY_ID_FIELD_NAME = "ID виновного";
  const INCOMING_FLOW_COMMENT_FIELD_NAME = "Комментарий ОПП";
  const SELECT_COLUMNS = [
    "id",
    "source_module",
    "source_id",
    "source_payload",
    "task_type",
    "opp_verdict",
    "task_status",
    "reopen_after",
    "return_board_id",
    "return_board_name",
    "return_column_id",
    "return_column_name",
    "reopen_count",
    "board_key",
    "column_key",
    "title",
    "description",
    "priority",
    "due_date",
    "target_workspace_id",
    "target_project_id",
    "target_board_id",
    "target_board_name",
    "target_column_id",
    "target_column_name",
    "target_assignee_ids",
    "target_custom_fields",
    "target_tags",
    "master_status",
    "master_action",
    "attempt_count",
    "weeek_task_id",
    "weeek_task_url",
    "weeek_workspace_id",
    "weeek_project_id",
    "weeek_board_id",
    "weeek_board_name",
    "weeek_column_id",
    "weeek_column_name",
    "weeek_completed",
    "weeek_deleted",
    "weeek_updated_at",
    "synced_at",
    "created_at",
  ].join(",");
  const ROUTE_COLUMNS = [
    "id",
    "route_key",
    "task_type",
    "enabled",
    "active_board_id",
    "active_board_name",
    "active_default_column_id",
    "active_default_column_name",
    "inactive_board_id",
    "inactive_board_name",
    "inactive_wait_column_id",
    "inactive_wait_column_name",
    "inactive_done_column_id",
    "inactive_done_column_name",
    "reopen_after_days",
    "reopen_date_field_id",
    "reopen_date_field_name",
    "reopened_tag_id",
    "reopened_tag_name",
    "deferred_verdicts",
    "final_verdicts",
    "not_started_verdicts",
  ].join(",");
  
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
  
  function unwrapPayload(payload: unknown, keys: string[]): JsonObject {
    const root = asObject(payload) ?? {};
    for (const key of keys) {
      const nested = asObject(root[key]);
      if (nested) return nested;
    }
    return root;
  }
  
  function normalizeText(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }
  
  function normalizeForMatch(value: unknown): string {
    return normalizeText(value)
      .replace(/\*\*/g, "")
      .replace(/ё/g, "е")
      .replace(/Ё/g, "Е")
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function isTruthyFlag(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    const raw = normalizeText(value).toLowerCase();
    return ["1", "true", "yes", "y", "да"].includes(raw);
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
  
  function normalizeNullableBoolean(value: unknown): boolean | null {
    if (value === null || value === undefined || normalizeText(value) === "") return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
    const raw = normalizeText(value).toLowerCase();
    if (["1", "true", "yes", "y", "да"].includes(raw)) return true;
    if (["0", "false", "no", "n", "нет"].includes(raw)) return false;
    return null;
  }
  
  function normalizeNumber(value: unknown, fallbackValue: number): number {
    if (value === null || value === undefined || normalizeText(value) === "") return fallbackValue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.trunc(parsed);
  }
  
  function normalizeLimit(value: unknown): number {
    return Math.min(Math.max(normalizeNumber(value, DEFAULT_LIMIT), 1), MAX_LIMIT);
  }
  
  function normalizeTimeoutMs(value: unknown): number {
    return Math.max(normalizeNumber(value, DEFAULT_REQUEST_TIMEOUT_MS), 10000);
  }
  
  function normalizeId(value: unknown): string {
    return normalizeText(value);
  }
  
  function idForPayload(value: string): string | number {
    return /^\d+$/.test(value) ? Number(value) : value;
  }
  
  function normalizeIsoDateTime(value: unknown): string | null {
    const raw = normalizeText(value);
    if (!raw) return null;

    let normalized = raw.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
    if (/^\d{4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(normalized)) {
      normalized = `${normalized}+03:00`;
    }

    let date = new Date(normalized);
    if (Number.isFinite(date.getTime())) return date.toISOString();

    const ruLike = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (ruLike) {
      let year = Number(ruLike[3]);
      if (year < 100) year += 2000;
      const iso = `${year}-${String(ruLike[2]).padStart(2, "0")}-${String(ruLike[1]).padStart(2, "0")}T${String(ruLike[4] || "0").padStart(2, "0")}:${String(ruLike[5] || "0").padStart(2, "0")}:${String(ruLike[6] || "0").padStart(2, "0")}+03:00`;
      date = new Date(iso);
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }

    return null;
  }
  
  function formatRuDateFromIso(isoDate: string | null): string | null {
    if (!isoDate) return null;
    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : isoDate;
  }
  
  function formatMoscowDateTime(value: unknown): string {
    const date = new Date(normalizeText(value) || Date.now());
    const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
    return safeDate
      .toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(",", "");
  }
  
  function addDays(date: Date, days: number): Date {
    const result = new Date(date.getTime());
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }
  
function truncate(value: string, maxLength = 900): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlLines(lines: string[]): string {
  return lines.map((line) => escapeHtml(line)).join("<br>");
}
  
  function extractList(payload: unknown): JsonObject[] {
    if (Array.isArray(payload)) return payload.map(asObject).filter(Boolean) as JsonObject[];
    const root = asObject(payload);
    if (!root) return [];
  for (const key of ["tasks", "columns", "boardColumns", "board_columns", "boards", "projects", "customFields", "custom_fields", "options", "tags", "results", "data", "items"]) {
      const value = root[key];
      if (Array.isArray(value)) return value.map(asObject).filter(Boolean) as JsonObject[];
    }
    return [];
  }
  
  function getWeeekConfig(body: JsonObject, requireApiKey: boolean): WeeekConfig {
    const apiKey = normalizeText(Deno.env.get("WEEEK_API_KEY"));
    const workspaceId = normalizeText(body.workspace_id) || normalizeText(Deno.env.get("WEEEK_WORKSPACE_ID")) || DEFAULT_WORKSPACE_ID;
    const projectId = normalizeText(body.project_id) || normalizeText(Deno.env.get("WEEEK_PROJECT_ID")) || DEFAULT_PROJECT_ID;
    const apiBaseUrl = (normalizeText(body.weeek_api_base_url) || normalizeText(Deno.env.get("WEEEK_API_BASE_URL")) || DEFAULT_WEEEK_API_BASE_URL).replace(/\/+$/, "");
    const appBaseUrl = (normalizeText(body.weeek_app_base_url) || normalizeText(Deno.env.get("WEEEK_APP_BASE_URL")) || DEFAULT_WEEEK_APP_BASE_URL).replace(/\/+$/, "");
    const taskKind = normalizeText(body.weeek_task_kind) || normalizeText(Deno.env.get("WEEEK_TASK_KIND")) || DEFAULT_TASK_KIND;
    const deadlineField = normalizeText(body.deadline_field ?? Deno.env.get("WEEEK_DEADLINE_FIELD")) || "day";
    const dedupeBySearch = normalizeBoolean(body.dedupe_by_search ?? Deno.env.get("WEEEK_DEDUPE_BY_SEARCH"), true);
    const oppVerdictSource = normalizeText(body.opp_verdict_source) || normalizeText(Deno.env.get("WEEEK_OPP_VERDICT_SOURCE")) || "custom_field";
    const oppVerdictFieldId = normalizeText(body.opp_verdict_field_id) || normalizeText(Deno.env.get("WEEEK_OPP_VERDICT_FIELD_ID"));
    const oppVerdictFieldName = normalizeText(body.opp_verdict_field_name) || normalizeText(Deno.env.get("WEEEK_OPP_VERDICT_FIELD_NAME")) || "Вердикт ОПП";
    const reopenAfterFieldId = normalizeText(body.reopen_after_field_id) || normalizeText(Deno.env.get("WEEEK_REOPEN_AFTER_FIELD_ID"));
    const reopenAfterFieldName = normalizeText(body.reopen_after_field_name) || normalizeText(Deno.env.get("WEEEK_REOPEN_AFTER_FIELD_NAME")) || "Дата переоткрытия";
    const incomingFlowApiUrl = normalizeText(body.incoming_flow_api_url) || normalizeText(Deno.env.get("INCOMING_FLOW_REQUESTS_APPS_SCRIPT_URL"));
    const incomingFlowAppsScriptSecret = normalizeText(body.incoming_flow_apps_script_secret ?? body.incoming_flow_source_secret) || normalizeText(Deno.env.get("INCOMING_FLOW_REQUESTS_APPS_SCRIPT_SECRET"));
    const incomingFlowAttachmentFieldId = normalizeText(body.incoming_flow_attachment_field_id) || normalizeText(Deno.env.get("WEEEK_INCOMING_FLOW_ATTACHMENT_FIELD_ID"));
    const incomingFlowAttachmentFieldName = normalizeText(body.incoming_flow_attachment_field_name) || normalizeText(Deno.env.get("WEEEK_INCOMING_FLOW_ATTACHMENT_FIELD_NAME")) || INCOMING_FLOW_ATTACHMENT_FIELD_NAME;
    const incomingFlowGuiltyIdFieldId = normalizeText(body.incoming_flow_guilty_id_field_id) || normalizeText(Deno.env.get("WEEEK_INCOMING_FLOW_GUILTY_ID_FIELD_ID"));
    const incomingFlowGuiltyIdFieldName = normalizeText(body.incoming_flow_guilty_id_field_name) || normalizeText(Deno.env.get("WEEEK_INCOMING_FLOW_GUILTY_ID_FIELD_NAME")) || INCOMING_FLOW_GUILTY_ID_FIELD_NAME;
    const incomingFlowCommentFieldId = normalizeText(body.incoming_flow_comment_field_id) || normalizeText(Deno.env.get("WEEEK_INCOMING_FLOW_COMMENT_FIELD_ID"));
    const incomingFlowCommentFieldName = normalizeText(body.incoming_flow_comment_field_name) || normalizeText(Deno.env.get("WEEEK_INCOMING_FLOW_COMMENT_FIELD_NAME")) || INCOMING_FLOW_COMMENT_FIELD_NAME;
    const koledino27lrApiUrl = normalizeText(body.koledino_27lr_api_url) || normalizeText(Deno.env.get("KOLEDINO_27LR_APPS_SCRIPT_URL"));
    const koledino27lrAppsScriptSecret = normalizeText(body.koledino_27lr_apps_script_secret ?? body.koledino_27lr_source_secret) || normalizeText(Deno.env.get("KOLEDINO_27LR_APPS_SCRIPT_SECRET"));
  
    const missing = [
      ...(requireApiKey ? [["WEEEK_API_KEY", apiKey]] : []),
      ["WEEEK_PROJECT_ID or body.project_id", projectId],
    ].filter(([, value]) => !value).map(([name]) => name);
  
    if (missing.length) throw new Error(`Missing WEEEK config: ${missing.join(", ")}`);
  
    return {
      apiBaseUrl,
      appBaseUrl,
      apiKey,
      workspaceId,
      projectId,
      taskKind,
      deadlineField,
      dedupeBySearch,
      oppVerdictSource,
      oppVerdictFieldId,
      oppVerdictFieldName,
      reopenAfterFieldId,
      reopenAfterFieldName,
      incomingFlowApiUrl,
      incomingFlowAppsScriptSecret,
      incomingFlowAttachmentFieldId,
      incomingFlowAttachmentFieldName,
      incomingFlowGuiltyIdFieldId,
      incomingFlowGuiltyIdFieldName,
      incomingFlowCommentFieldId,
      incomingFlowCommentFieldName,
      koledino27lrApiUrl,
      koledino27lrAppsScriptSecret,
    };
  }
  
  function weeekHeaders(config: WeeekConfig, includeJson = false): HeadersInit {
    return {
      accept: "application/json",
      ...(includeJson ? { "content-type": "application/json" } : {}),
      authorization: `Bearer ${config.apiKey}`,
    };
  }
  
  function taskUrl(config: WeeekConfig, taskId: string, row?: Partial<WeeekTaskRow>, boardIdOverride?: string | null): string | null {
    const workspaceId = normalizeText(row?.target_workspace_id) || config.workspaceId;
    const projectId = normalizeText(row?.target_project_id) || config.projectId;
    const boardId = normalizeText(boardIdOverride) || normalizeText(row?.target_board_id) || normalizeText(row?.weeek_board_id);
    if (!taskId || !workspaceId || !projectId || !boardId) return null;
    return `${config.appBaseUrl}/ws/${encodeURIComponent(workspaceId)}/project/${encodeURIComponent(projectId)}/board/${encodeURIComponent(boardId)}/task/${encodeURIComponent(taskId)}`;
  }
  
  async function fetchWeeekJson(path: string, config: WeeekConfig, timeoutMs: number): Promise<JsonObject> {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: "GET",
      headers: weeekHeaders(config),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const responseText = await response.text();
    let responsePayload: unknown = null;
    try {
      responsePayload = responseText ? JSON.parse(responseText) : {};
    } catch {
      responsePayload = { raw: responseText };
    }
    if (!response.ok) throw new Error(`WEEEK GET ${response.status}: ${truncate(responseText || response.statusText)}`);
    return asObject(responsePayload) ?? { raw: responseText };
  }
  
async function sendWeeekJson(method: "POST" | "PUT" | "DELETE", path: string, payload: JsonObject, config: WeeekConfig, timeoutMs: number): Promise<JsonObject> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers: weeekHeaders(config, true),
    body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const responseText = await response.text();
    let responsePayload: unknown = null;
    try {
      responsePayload = responseText ? JSON.parse(responseText) : {};
    } catch {
      responsePayload = { raw: responseText };
    }
    if (!response.ok) throw new Error(`WEEEK ${method} ${response.status}: ${truncate(responseText || response.statusText)}`);
    return unwrapPayload(responsePayload, ["task", "data", "item"]);
  }
  
  async function fetchBoards(projectId: string, config: WeeekConfig, timeoutMs: number): Promise<JsonObject[]> {
    const query = new URLSearchParams({ projectId });
    const payload = await fetchWeeekJson(`/tm/boards?${query.toString()}`, config, timeoutMs);
    return extractList(payload);
  }
  
async function fetchBoardColumns(projectId: string, boardId: string, config: WeeekConfig, timeoutMs: number): Promise<JsonObject[]> {
  const query = new URLSearchParams({ boardId, projectId });
  const payload = await fetchWeeekJson(`/tm/board-columns?${query.toString()}`, config, timeoutMs);
  return extractList(payload);
}

function extractTags(payload: unknown): WeeekTag[] {
  return extractList(payload).map((item) => ({
    id: normalizeId(item.id),
    title: normalizeText(item.title ?? item.name),
    color: normalizeText(item.color) || null,
  })).filter((tag) => tag.id && tag.title);
}

async function fetchWorkspaceTags(config: WeeekConfig, timeoutMs: number): Promise<WeeekTag[]> {
  const payload = await fetchWeeekJson("/ws/tags", config, timeoutMs);
  return extractTags(payload);
}

async function createWorkspaceTag(name: string, config: WeeekConfig, timeoutMs: number): Promise<WeeekTag | null> {
  const payload = await sendWeeekJson("POST", "/ws/tags", { title: name }, config, timeoutMs);
  const tag = asObject(payload.tag) ?? asObject(payload);
  const id = normalizeId(tag?.id);
  const title = normalizeText(tag?.title ?? tag?.name) || name;
  return id ? { id, title, color: normalizeText(tag?.color) || null } : null;
}

async function resolveTagId(explicitId: string | null, name: string, config: WeeekConfig, timeoutMs: number, cache: Map<string, string>): Promise<string | null> {
  const normalizedExplicit = normalizeId(explicitId);
  if (normalizedExplicit) return normalizedExplicit;
  const expectedName = normalizeForMatch(name);
  if (!expectedName) return null;

  const cacheKey = `tag:${expectedName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const tags = await fetchWorkspaceTags(config, timeoutMs);
  const existing = tags.find((tag) => normalizeForMatch(tag.title) === expectedName);
  if (existing?.id) {
    cache.set(cacheKey, existing.id);
    return existing.id;
  }

  const created = await createWorkspaceTag(name, config, timeoutMs);
  if (created?.id) {
    cache.set(cacheKey, created.id);
    return created.id;
  }

  return null;
}

function extractTaskTagIds(payload: unknown): string[] {
  const root = unwrapPayload(payload, ["task", "data", "item"]);
  if (!Array.isArray(root.tags)) return [];
  return root.tags.map((tag) => {
    const object = asObject(tag);
    return normalizeId(object?.id ?? tag);
  }).filter(Boolean);
}

function uniqueIds(values: unknown[]): string[] {
  return Array.from(new Set(values.map(normalizeId).filter(Boolean)));
}

function extractAssigneeIdsFromPayload(payload: unknown): string[] {
  const root = unwrapPayload(payload, ["task", "data", "item"]);
  const ids: unknown[] = [];

  for (const key of ["assignees", "members", "users", "executors", "responsibles"]) {
    const value = root[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const object = asObject(item);
      ids.push(
        object?.id,
        object?.userId,
        object?.user_id,
        object?.memberId,
        object?.member_id,
        object?.uuid,
        item,
      );
    }
  }

  ids.push(root.userId, root.user_id, root.executorId, root.executor_id, root.responsibleId, root.responsible_id);
  return uniqueIds(ids);
}

function assigneesMatch(expected: string[], actual: string[]): boolean {
  const expectedSet = new Set(expected.map(normalizeId).filter(Boolean));
  const actualSet = new Set(actual.map(normalizeId).filter(Boolean));
  if (expectedSet.size !== actualSet.size) return false;
  for (const id of expectedSet) {
    if (!actualSet.has(id)) return false;
  }
  return true;
}

function assigneeDiff(source: string[], target: string[]): string[] {
  const targetSet = new Set(target.map(normalizeId).filter(Boolean));
  return Array.from(new Set(source.map(normalizeId).filter(Boolean))).filter((id) => !targetSet.has(id));
}
  
  async function resolveBoardId(projectId: string, explicitId: string | null, name: string, config: WeeekConfig, timeoutMs: number, cache: Map<string, string>): Promise<string> {
    const normalizedExplicit = normalizeId(explicitId);
    if (normalizedExplicit) return normalizedExplicit;
  
    const expectedName = normalizeForMatch(name);
    const cacheKey = `board:${projectId}:${expectedName}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  
    const boards = await fetchBoards(projectId, config, timeoutMs);
    const match = boards.find((board) => normalizeForMatch(board.name ?? board.title) === expectedName);
    const id = normalizeId(match?.id);
    if (!id) {
      const available = boards.map((board) => normalizeText(board.name ?? board.title ?? board.id)).filter(Boolean).join(", ");
      throw new Error(`WEEEK board "${name}" not found. Available: ${available || "none"}`);
    }
  
    cache.set(cacheKey, id);
    return id;
  }
  
  async function resolveColumnId(projectId: string, boardId: string, explicitId: string | null, name: string, config: WeeekConfig, timeoutMs: number, cache: Map<string, string>): Promise<string> {
    const normalizedExplicit = normalizeId(explicitId);
    if (normalizedExplicit) return normalizedExplicit;
  
    const expectedName = normalizeForMatch(name);
    const cacheKey = `column:${projectId}:${boardId}:${expectedName}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  
    const columns = await fetchBoardColumns(projectId, boardId, config, timeoutMs);
    const match = columns.find((column) => normalizeForMatch(column.name ?? column.title) === expectedName);
    const id = normalizeId(match?.boardColumnId ?? match?.board_column_id ?? match?.id);
    if (!id) {
      const available = columns.map((column) => normalizeText(column.name ?? column.title ?? column.id)).filter(Boolean).join(", ");
      throw new Error(`WEEEK board column "${name}" not found. Available: ${available || "none"}`);
    }
  
    cache.set(cacheKey, id);
    return id;
  }
  
  function customFieldFromObject(field: JsonObject | null, source: string): CustomField | null {
    const id = normalizeId(field?.id ?? field?.fieldId ?? field?.field_id ?? field?.customFieldId ?? field?.custom_field_id);
    const name = normalizeText(field?.name ?? field?.title ?? field?.fieldName ?? field?.field_name);
    if (!field || !id || !name) return null;
    const options: JsonObject[] = [];
    for (const key of ["options", "variants", "choices", "items", "selectOptions", "select_options", "values"]) {
      const value = field[key];
      if (Array.isArray(value)) options.push(...value.map(asObject).filter(Boolean) as JsonObject[]);
    }
    for (const key of ["config", "settings", "data"]) {
      const nested = asObject(field[key]);
      if (!nested) continue;
      for (const optionKey of ["options", "variants", "choices", "items", "selectOptions", "select_options", "values"]) {
        const value = nested[optionKey];
        if (Array.isArray(value)) options.push(...value.map(asObject).filter(Boolean) as JsonObject[]);
      }
    }
    return { id, name, type: normalizeText(field.type) || "text", options, source };
  }
  
  function extractCustomFieldsFromPayload(payload: unknown, source: string): CustomField[] {
    const roots: JsonObject[] = [];
    const root = asObject(payload);
    if (root) {
      roots.push(root);
      for (const key of ["project", "board", "data", "item"]) {
        const nested = asObject(root[key]);
        if (nested) roots.push(nested);
      }
    }
  
    const fields: CustomField[] = [];
    for (const currentRoot of roots) {
      const directField = customFieldFromObject(currentRoot, source);
      if (directField) fields.push(directField);
      for (const key of ["customFields", "custom_fields", "fields", "fieldValues", "field_values"]) {
        const value = currentRoot[key];
        if (!Array.isArray(value)) continue;
        for (const rawField of value) {
          const field = customFieldFromObject(asObject(rawField), source);
          if (field) fields.push(field);
        }
      }
    }
    return fields;
  }
  
  function mergeCustomFields(fields: CustomField[]): CustomField[] {
    const seen = new Set<string>();
    const result: CustomField[] = [];
    for (const field of fields) {
      if (seen.has(field.id)) continue;
      seen.add(field.id);
      result.push(field);
    }
    return result;
  }
  
  async function fetchCustomFields(projectId: string, boardId: string | null, config: WeeekConfig, timeoutMs: number): Promise<CustomField[]> {
    const fields: CustomField[] = [];
    const sources = [
      { label: "project", path: `/tm/projects/${encodeURIComponent(projectId)}` },
      { label: "global", path: "/tm/custom-fields" },
    ];
  
    for (const source of sources) {
      try {
        const payload = await fetchWeeekJson(source.path, config, timeoutMs);
        fields.push(...extractCustomFieldsFromPayload(payload, source.label));
        fields.push(...extractList(payload).flatMap((item) => extractCustomFieldsFromPayload(item, source.label)));
      } catch {
        // WEEEK installations can expose custom fields through different endpoints.
      }
    }
  
    try {
      const boards = await fetchBoards(projectId, config, timeoutMs);
      const board = boardId ? boards.find((item) => normalizeId(item.id) === boardId) : null;
      if (board) fields.push(...extractCustomFieldsFromPayload(board, "board"));
      fields.push(...boards.flatMap((item) => extractCustomFieldsFromPayload(item, "boards")));
    } catch {
      // Optional diagnostics endpoint.
    }
  
    return mergeCustomFields(fields);
  }
  
  async function resolveCustomFieldId(projectId: string, boardId: string | null, explicitId: string | null, name: string, config: WeeekConfig, timeoutMs: number, cache: Map<string, string>): Promise<string | null> {
    const normalizedExplicit = normalizeId(explicitId);
    if (normalizedExplicit) return normalizedExplicit;
    const expectedName = normalizeForMatch(name);
    if (!expectedName) return null;
  
    const cacheKey = `field:${projectId}:${boardId || "any"}:${expectedName}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  
    const fields = await fetchCustomFields(projectId, boardId, config, timeoutMs);
    const match = fields.find((field) => normalizeForMatch(field.name) === expectedName);
    const id = normalizeId(match?.id);
    if (id) cache.set(cacheKey, id);
    return id || null;
  }
  
function firstLocation(root: JsonObject): JsonObject | null {
  const locations = root.locations;
  if (!Array.isArray(locations)) return null;
  return asObject(locations[0]);
}

function taskLocationSnapshot(payload: unknown): JsonObject {
  const root = unwrapPayload(payload, ["task", "data", "item"]);
  const locations = Array.isArray(root.locations)
    ? root.locations.map(asObject).filter(Boolean).map((location) => ({
      projectId: normalizeId(location?.projectId ?? location?.project_id),
      boardId: normalizeId(location?.boardId ?? location?.board_id),
      boardColumnId: normalizeId(location?.boardColumnId ?? location?.board_column_id),
    }))
    : [];
  return {
    projectId: normalizeId(root.projectId ?? root.project_id),
    boardId: normalizeId(root.boardId ?? root.board_id),
    boardColumnId: normalizeId(root.boardColumnId ?? root.board_column_id),
    locations,
  };
}

function taskIsInTargetColumn(payload: unknown, expectedBoardId: string | null, expectedColumnId: string): boolean {
  const expectedBoard = normalizeId(expectedBoardId);
  const expectedColumn = normalizeId(expectedColumnId);
  if (!expectedColumn) return false;

  const snapshot = taskLocationSnapshot(payload);
  const directBoard = normalizeId(snapshot.boardId);
  const directColumn = normalizeId(snapshot.boardColumnId);
  if (directColumn === expectedColumn && (!expectedBoard || directBoard === expectedBoard)) return true;

  const locations = Array.isArray(snapshot.locations) ? snapshot.locations : [];
  return locations.some((rawLocation) => {
    const location = asObject(rawLocation);
    if (!location) return false;
    const locationBoard = normalizeId(location.boardId);
    const locationColumn = normalizeId(location.boardColumnId);
    return locationColumn === expectedColumn && (!expectedBoard || locationBoard === expectedBoard);
  });
}

function firstProjectLocation(payload: unknown, projectId: string): JsonObject | null {
  const expectedProject = normalizeId(projectId);
  const snapshot = taskLocationSnapshot(payload);
  const locations = Array.isArray(snapshot.locations) ? snapshot.locations : [];
  const match = locations.find((rawLocation) => {
    const location = asObject(rawLocation);
    return location && normalizeId(location.projectId) === expectedProject;
  });
  return asObject(match) ?? null;
}
  
  function extractEmbeddedStatusName(root: JsonObject): string | null {
    for (const key of ["status", "state", "column", "boardColumn", "board_column"]) {
      const nested = asObject(root[key]);
      const value = normalizeText(nested?.name ?? nested?.title ?? nested?.label);
      if (value) return value;
    }
    return normalizeText(root.statusName ?? root.status_name ?? root.stateName ?? root.state_name ?? root.columnName ?? root.column_name) || null;
  }
  
  function extractCustomFieldValue(payload: unknown, fieldId: string, fieldName: string): { value: string | null; raw: unknown } {
    const roots: JsonObject[] = [];
    const root = asObject(payload);
    if (root) {
      roots.push(root);
      for (const key of ["task", "data", "item", "fields"]) {
        const nested = asObject(root[key]);
        if (nested) roots.push(nested);
      }
    }
  
    const expectedName = normalizeForMatch(fieldName);
    for (const current of roots) {
      for (const key of ["customFields", "custom_fields", "fields", "fieldValues", "field_values"]) {
        const rawFields = current[key];
        if (Array.isArray(rawFields)) {
          for (const rawField of rawFields) {
            const field = asObject(rawField);
            if (!field) continue;
            const id = normalizeId(field.id ?? field.fieldId ?? field.field_id ?? field.customFieldId ?? field.custom_field_id);
            const name = normalizeForMatch(field.name ?? field.title ?? field.fieldName ?? field.field_name);
            if ((fieldId && id === fieldId) || (expectedName && name === expectedName)) {
              const value = field.value ?? field.values ?? field.selectedValue ?? field.selected_value ?? field.option ?? field.options ?? field.name;
              return { value: normalizeCustomFieldValue(value), raw: field };
            }
          }
        } else {
          const fieldsObject = asObject(rawFields);
          if (fieldsObject) {
            if (fieldId && Object.prototype.hasOwnProperty.call(fieldsObject, fieldId)) {
              const value = fieldsObject[fieldId];
              return { value: normalizeCustomFieldValue(value), raw: value };
            }
            if (fieldName && Object.prototype.hasOwnProperty.call(fieldsObject, fieldName)) {
              const value = fieldsObject[fieldName];
              return { value: normalizeCustomFieldValue(value), raw: value };
            }
          }
        }
      }
    }
    return { value: null, raw: null };
  }
  
  function normalizeCustomFieldValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      const parts = value.map(normalizeCustomFieldValue).filter(Boolean) as string[];
      return parts.length ? parts.join(", ") : null;
    }
    const object = asObject(value);
    if (object) return normalizeText(object.name ?? object.title ?? object.label ?? object.value ?? object.id) || null;
    return normalizeText(value) || null;
  }

  function extractPersonName(value: unknown): string | null {
    const object = asObject(value);
    if (!object) return normalizeText(value) || null;

    const direct = normalizeText(
      object.name ??
      object.fullName ??
      object.full_name ??
      object.displayName ??
      object.display_name ??
      object.title ??
      object.login,
    );
    if (direct) return direct;

    const parts = [
      object.lastName ?? object.last_name,
      object.firstName ?? object.first_name,
      object.middleName ?? object.middle_name,
    ].map(normalizeText).filter(Boolean);
    return parts.length ? parts.join(" ") : null;
  }

  function extractCompletedByName(root: JsonObject): string | null {
    const candidates = [
      root.completedBy,
      root.completed_by,
      root.completedUser,
      root.completed_user,
      root.closer,
      root.closedBy,
      root.closed_by,
      root.updatedBy,
      root.updated_by,
      root.user,
    ];

    for (const candidate of candidates) {
      const name = extractPersonName(candidate);
      if (name) return name;
    }

    return null;
  }
  
  function looksLikeOptionId(value: string | null): boolean {
    const raw = normalizeText(value);
    if (!raw) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return true;
    return raw.length >= 18 && /^[a-z0-9_-]+$/i.test(raw) && !/\s/.test(raw);
  }
  
  function optionIdCandidates(option: JsonObject): string[] {
    return [
      option.id,
      option.uuid,
      option.key,
      option.value,
      option.optionId,
      option.option_id,
      option.customFieldOptionId,
      option.custom_field_option_id,
    ].map(normalizeId).filter(Boolean);
  }
  
  function optionLabel(option: JsonObject): string | null {
    const label = normalizeText(option.name ?? option.title ?? option.label ?? option.text ?? option.caption);
    if (label) return label;
    const value = normalizeText(option.value);
    return value && !looksLikeOptionId(value) ? value : null;
  }

  function optionLabelFromRawField(rawField: unknown, rawValue: string | null): string | null {
    const normalizedValue = normalizeText(rawValue);
    if (!looksLikeOptionId(normalizedValue)) return normalizedValue || null;

    const field = asObject(rawField);
    if (!field) return null;

    const options: JsonObject[] = [];
    for (const key of ["options", "variants", "choices", "items", "selectOptions", "select_options", "values"]) {
      const value = field[key];
      if (Array.isArray(value)) options.push(...value.map(asObject).filter(Boolean) as JsonObject[]);
    }
    for (const key of ["config", "settings", "data"]) {
      const nested = asObject(field[key]);
      if (!nested) continue;
      for (const optionKey of ["options", "variants", "choices", "items", "selectOptions", "select_options", "values"]) {
        const value = nested[optionKey];
        if (Array.isArray(value)) options.push(...value.map(asObject).filter(Boolean) as JsonObject[]);
      }
    }

    const option = options.find((item) => optionIdCandidates(item).includes(normalizedValue));
    return option ? optionLabel(option) : null;
  }
  
  async function resolveCustomFieldOptionLabel(
    rawValue: string | null,
    projectId: string | null,
    boardId: string | null,
    fieldId: string,
    fieldName: string,
    config: WeeekConfig,
    timeoutMs: number,
    cache: Map<string, string>,
  ): Promise<string | null> {
    const normalizedValue = normalizeText(rawValue);
    if (!looksLikeOptionId(normalizedValue)) return normalizedValue || null;
  
    const expectedFieldName = normalizeForMatch(fieldName);
    const expectedFieldId = normalizeId(fieldId);
    const cacheKey = `field-option:${projectId || config.projectId}:${boardId || "any"}:${expectedFieldId || expectedFieldName}:${normalizedValue}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  
    const fields = await fetchCustomFields(projectId || config.projectId, boardId, config, timeoutMs);
    const field = fields.find((item) => {
      if (expectedFieldId && normalizeId(item.id) === expectedFieldId) return true;
      return expectedFieldName && normalizeForMatch(item.name) === expectedFieldName;
    });
    if (!field) return normalizedValue || null;
  
    const option = field.options.find((item) => optionIdCandidates(item).includes(normalizedValue));
    const label = option ? optionLabel(option) : null;
    if (label) {
      cache.set(cacheKey, label);
      return label;
    }
  
    return normalizedValue || null;
  }

  async function resolveCustomFieldOptionIdByLabel(
    label: string,
    projectId: string | null,
    boardId: string | null,
    fieldId: string,
    fieldName: string,
    config: WeeekConfig,
    timeoutMs: number,
    cache: Map<string, string>,
  ): Promise<string | null> {
    const expectedLabel = normalizeForMatch(label);
    if (!expectedLabel) return null;

    const expectedFieldName = normalizeForMatch(fieldName);
    const expectedFieldId = normalizeId(fieldId);
    const cacheKey = `field-option-label:${projectId || config.projectId}:${boardId || "any"}:${expectedFieldId || expectedFieldName}:${expectedLabel}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const fields = await fetchCustomFields(projectId || config.projectId, boardId, config, timeoutMs);
    const field = fields.find((item) => {
      if (expectedFieldId && normalizeId(item.id) === expectedFieldId) return true;
      return expectedFieldName && normalizeForMatch(item.name) === expectedFieldName;
    });
    if (!field) return null;

    const option = field.options.find((item) => normalizeForMatch(optionLabel(item)) === expectedLabel);
    const optionId = option ? optionIdCandidates(option)[0] : "";
    if (optionId) {
      cache.set(cacheKey, optionId);
      return optionId;
    }

    return null;
  }
  
  function extractTaskMeta(payload: unknown, config: WeeekConfig, row?: WeeekTaskRow): WeeekTaskMeta {
    const root = unwrapPayload(payload, ["task", "data", "item"]);
    const location = firstLocation(root);
    const id = normalizeId(root.id);
    const opp = extractCustomFieldValue(root, config.oppVerdictFieldId, config.oppVerdictFieldName);
    const statusVerdict = ["status", "auto"].includes(config.oppVerdictSource) ? extractEmbeddedStatusName(root) : null;
    const reopen = extractCustomFieldValue(root, config.reopenAfterFieldId, config.reopenAfterFieldName);
    const boardObject = asObject(root.board ?? location?.board);
    const columnObject = asObject(root.boardColumn ?? root.board_column ?? location?.boardColumn ?? location?.board_column);
    const boardId = normalizeId(root.boardId ?? root.board_id ?? location?.boardId ?? location?.board_id ?? boardObject?.id ?? row?.target_board_id ?? row?.weeek_board_id);
  
    return {
      id,
      title: normalizeText(root.title) || null,
      projectId: normalizeId(root.projectId ?? root.project_id ?? location?.projectId ?? location?.project_id ?? row?.target_project_id ?? config.projectId) || null,
      boardId: boardId || null,
      boardName: normalizeText(boardObject?.name ?? boardObject?.title ?? root.boardName ?? root.board_name ?? row?.target_board_name ?? row?.weeek_board_name) || null,
      boardColumnId: normalizeId(root.boardColumnId ?? root.board_column_id ?? location?.boardColumnId ?? location?.board_column_id ?? columnObject?.id ?? row?.target_column_id ?? row?.weeek_column_id) || null,
      boardColumnName: normalizeText(columnObject?.name ?? columnObject?.title ?? root.boardColumnName ?? root.board_column_name ?? row?.target_column_name ?? row?.weeek_column_name) || null,
      completed: normalizeNullableBoolean(root.isCompleted ?? root.completed),
      deleted: normalizeNullableBoolean(root.isDeleted ?? root.deleted),
      updatedAt: normalizeIsoDateTime(root.updatedAt ?? root.updated_at ?? root.updated),
      url: taskUrl(config, id, row, boardId),
      oppVerdict: config.oppVerdictSource === "status" ? statusVerdict : (opp.value ?? statusVerdict),
      oppVerdictRaw: opp.raw ?? (statusVerdict ? { source: "status", value: statusVerdict } : null),
      reopenAfter: normalizeIsoDateTime(reopen.value),
      completedByName: extractCompletedByName(root),
      assigneeIds: extractAssigneeIdsFromPayload(root),
    };
  }
  
  function includesVerdict(list: string[], value: string | null): boolean {
    const normalized = normalizeForMatch(value);
    return list.map(normalizeForMatch).some((item) => item && (normalized === item || normalized.includes(item)));
  }
  
function buildFormattedDescription(row: WeeekTaskRow): string {
  const sourcePayload = asObject(row.source_payload);
  const taskType = normalizeText(sourcePayload?.description_task_type ?? sourcePayload?.descriptionTaskType) || normalizeText(row.task_type) || "Задание";
  const infoLines = (normalizeText(row.description) || "-").split(/\r?\n/);
  return htmlLines([
    `Тип задания: ${taskType}`,
    `Дата создания задания: ${formatMoscowDateTime(row.created_at)}`,
    "",
    "-------------------------",
    "Инфо по заданию:",
    ...infoLines,
  ]);
}

function isLikelyPayloadId(value: string): boolean {
  const raw = normalizeText(value);
  return /^\d+$/.test(raw) || looksLikeOptionId(raw);
}

async function applyTargetTags(payload: JsonObject, row: WeeekTaskRow, config: WeeekConfig, timeoutMs: number, cache: Map<string, string>): Promise<void> {
  if (!Array.isArray(row.target_tags) || !row.target_tags.length) return;

  const tagIds: string[] = [];
  for (const rawTag of row.target_tags) {
    const object = asObject(rawTag);
    const explicitId = normalizeId(object?.id ?? object?.tagId ?? object?.tag_id);
    const tagName = normalizeText(object?.name ?? object?.title ?? rawTag);

    if (explicitId) {
      tagIds.push(explicitId);
      continue;
    }

    if (isLikelyPayloadId(tagName)) {
      tagIds.push(tagName);
      continue;
    }

    if (config.apiKey && tagName) {
      const resolvedId = await resolveTagId(null, tagName, config, timeoutMs, cache);
      if (resolvedId) tagIds.push(resolvedId);
    }
  }

  if (tagIds.length) payload.tags = Array.from(new Set(tagIds)).map(idForPayload);
}

function formatWeeekDateTime(value: unknown): string | null {
  const iso = normalizeIsoDateTime(value);
  return iso ? iso.replace(/\.\d{3}Z$/, "Z") : null;
}

type WeeekLocationMode = "locations" | "top_level";
  
  function buildWeeekPayload(row: WeeekTaskRow, config: WeeekConfig, target: { projectId: string; boardId: string | null; columnId: string }, locationMode: WeeekLocationMode = "locations"): JsonObject {
    const projectId = normalizeText(target.projectId) || normalizeText(row.target_project_id) || config.projectId;
    const customFields = asObject(row.target_custom_fields) ?? {};
    const sourcePayload = asObject(row.source_payload);
    const dueDateTime = formatWeeekDateTime(sourcePayload?.task_due_datetime ?? sourcePayload?.due_datetime ?? sourcePayload?.dueDateTime);
    const payload: JsonObject = {
      title: row.title,
      description: buildFormattedDescription(row),
      type: config.taskKind,
      priority: normalizeNumber(row.priority, 0),
    };

    if (locationMode === "top_level") {
      payload.projectId = idForPayload(projectId);
      if (target.boardId) payload.boardId = idForPayload(target.boardId);
      payload.boardColumnId = idForPayload(target.columnId);
    } else {
      const location: JsonObject = {
        projectId: idForPayload(projectId),
        boardColumnId: idForPayload(target.columnId),
      };
      if (target.boardId) location.boardId = idForPayload(target.boardId);
      payload.locations = [location];
    }
  
    if (dueDateTime) {
      payload.dueDateTime = dueDateTime;
    } else if (row.due_date) {
      if (config.deadlineField === "dueDate") payload.dueDate = row.due_date;
      else if (config.deadlineField === "both") {
        payload.day = formatRuDateFromIso(row.due_date);
        payload.dueDate = row.due_date;
      } else payload.day = formatRuDateFromIso(row.due_date);
    }
  
    if (Object.keys(customFields).length) payload.customFields = customFields;
    if (Array.isArray(row.target_assignee_ids) && row.target_assignee_ids.length) payload.members = row.target_assignee_ids;
    return payload;
  }

function payloadForExistingTaskUpdate(payload: JsonObject): JsonObject {
  const updatePayload = { ...payload };
  // WEEEK logs a noisy "task type changed to Action" entry if `type` is sent on every update.
  delete updatePayload.type;
  return updatePayload;
}

function shouldRetryWithTopLevelLocation(err: unknown): boolean {
  const message = String(err instanceof Error ? err.message : err);
  return message.includes("locations.0.boardColumnId") || message.includes("boardColumnId is invalid");
}
  
function buildLocationPayload(projectId: string, boardColumnId: string): JsonObject {
  return {
    projectId: idForPayload(projectId),
    boardColumnId: idForPayload(boardColumnId),
  };
}

async function moveTaskToColumn(taskId: string, projectId: string, boardId: string | null, boardColumnId: string, config: WeeekConfig, timeoutMs: number): Promise<JsonObject> {
  if (!taskId) throw new Error("Cannot move WEEEK task without task id");
  const result: JsonObject = {};
  const beforePayload = await fetchWeeekJson(`/tm/tasks/${encodeURIComponent(taskId)}`, config, timeoutMs);
  const beforeSnapshot = taskLocationSnapshot(beforePayload);
  result.before = beforeSnapshot;
  if (taskIsInTargetColumn(beforePayload, boardId, boardColumnId)) {
    result.skipped = true;
    result.reason = "task is already in target column";
    return result;
  }

  try {
    result.location_delete = await sendWeeekJson("DELETE", `/tm/tasks/${encodeURIComponent(taskId)}/locations`, { projectId: idForPayload(projectId) }, config, timeoutMs);
    result.location_add = await sendWeeekJson("POST", `/tm/tasks/${encodeURIComponent(taskId)}/locations`, buildLocationPayload(projectId, boardColumnId), config, timeoutMs);
    const afterLocationPayload = await fetchWeeekJson(`/tm/tasks/${encodeURIComponent(taskId)}`, config, timeoutMs);
    result.after_location = taskLocationSnapshot(afterLocationPayload);
    if (taskIsInTargetColumn(afterLocationPayload, boardId, boardColumnId)) return result;
  } catch (err) {
    result.location_error = String(err instanceof Error ? err.message : err);
  }

  try {
    if (boardId) result.board = await sendWeeekJson("POST", `/tm/tasks/${encodeURIComponent(taskId)}/board`, { boardId: idForPayload(boardId) }, config, timeoutMs);
    result.boardColumn = await sendWeeekJson("POST", `/tm/tasks/${encodeURIComponent(taskId)}/board-column`, { boardColumnId: idForPayload(boardColumnId) }, config, timeoutMs);
    const afterBoardPayload = await fetchWeeekJson(`/tm/tasks/${encodeURIComponent(taskId)}`, config, timeoutMs);
    result.after_board_column = taskLocationSnapshot(afterBoardPayload);
    if (taskIsInTargetColumn(afterBoardPayload, boardId, boardColumnId)) return result;
    throw new Error(`WEEEK task location did not change to board=${boardId || "-"}, column=${boardColumnId}. Actual: ${JSON.stringify(result.after_board_column)}`);
  } catch (err) {
    result.board_column_error = String(err instanceof Error ? err.message : err);
  }

  const finalPayload = await fetchWeeekJson(`/tm/tasks/${encodeURIComponent(taskId)}`, config, timeoutMs);
  result.final_location = taskLocationSnapshot(finalPayload);
  if (taskIsInTargetColumn(finalPayload, boardId, boardColumnId)) {
    return result;
  }

  const oldLocation = firstProjectLocation(beforePayload, projectId);
  const oldColumnId = normalizeId(oldLocation?.boardColumnId);
  if (oldColumnId) {
    try {
      result.restore_location_delete = await sendWeeekJson("DELETE", `/tm/tasks/${encodeURIComponent(taskId)}/locations`, { projectId: idForPayload(projectId) }, config, timeoutMs);
      result.restore_location_add = await sendWeeekJson("POST", `/tm/tasks/${encodeURIComponent(taskId)}/locations`, buildLocationPayload(projectId, oldColumnId), config, timeoutMs);
    } catch (restoreErr) {
      result.restore_error = String(restoreErr instanceof Error ? restoreErr.message : restoreErr);
    }
  }

  throw new Error(`WEEEK task was not moved. Expected board=${boardId || "-"}, column=${boardColumnId}. Details: ${truncate(JSON.stringify(result), 1200)}`);
}

async function updateTaskCustomFields(taskId: string, customFields: JsonObject, config: WeeekConfig, timeoutMs: number): Promise<JsonObject | null> {
  if (!taskId || !Object.keys(customFields).length) return null;
  return await sendWeeekJson("PUT", `/tm/tasks/${encodeURIComponent(taskId)}`, { customFields }, config, timeoutMs);
}

async function clearTaskCustomField(taskId: string, fieldId: string | null, config: WeeekConfig, timeoutMs: number): Promise<JsonObject | null> {
  if (!taskId || !fieldId) return null;
  try {
    return await updateTaskCustomFields(taskId, { [fieldId]: null }, config, timeoutMs);
  } catch (firstErr) {
    try {
      return await updateTaskCustomFields(taskId, { [fieldId]: "" }, config, timeoutMs);
    } catch (secondErr) {
      return {
        ok: false,
        error: `${String(firstErr instanceof Error ? firstErr.message : firstErr)}; ${String(secondErr instanceof Error ? secondErr.message : secondErr)}`,
      };
    }
  }
}

async function uncompleteTask(taskId: string, config: WeeekConfig, timeoutMs: number): Promise<JsonObject> {
  if (!taskId) throw new Error("Cannot un-complete WEEEK task without task id");
  return await sendWeeekJson("POST", `/tm/tasks/${encodeURIComponent(taskId)}/un-complete`, {}, config, timeoutMs);
}

async function completeTask(taskId: string, config: WeeekConfig, timeoutMs: number): Promise<JsonObject> {
  if (!taskId) throw new Error("Cannot complete WEEEK task without task id");
  try {
    return await sendWeeekJson("POST", `/tm/tasks/${encodeURIComponent(taskId)}/complete`, {}, config, timeoutMs);
  } catch (firstErr) {
    try {
      return await sendWeeekJson("PUT", `/tm/tasks/${encodeURIComponent(taskId)}`, { isCompleted: true }, config, timeoutMs);
    } catch (secondErr) {
      throw new Error(`Failed to complete WEEEK task: ${String(firstErr instanceof Error ? firstErr.message : firstErr)}; ${String(secondErr instanceof Error ? secondErr.message : secondErr)}`);
    }
  }
}

function systemAutoFinalizeReason(row: WeeekTaskRow): string | null {
  const sourcePayload = asObject(row.source_payload);
  if (!sourcePayload) return null;
  if (!isTruthyFlag(sourcePayload.system_auto_finalize)) return null;
  return normalizeText(sourcePayload.system_auto_finalize_reason) || normalizeText(sourcePayload.status) || "Статус источника требует системного закрытия";
}

function systemAutoFinalizeVerdict(row: WeeekTaskRow): string {
  const sourcePayload = asObject(row.source_payload);
  return normalizeText(sourcePayload?.system_opp_verdict) || SYSTEM_FINAL_OPP_VERDICT;
}

function systemAutoFinalizeTagName(row: WeeekTaskRow): string {
  const sourcePayload = asObject(row.source_payload);
  return normalizeText(sourcePayload?.system_tag_name) || SYSTEM_CLOSED_TAG_NAME;
}

function isIncomingFlowRequest(row: WeeekTaskRow, route: WeeekRoute): boolean {
  return route.route_key === INCOMING_FLOW_ROUTE_KEY ||
    route.route_key === KOLEDINO_27LR_ROUTE_KEY ||
    row.source_module === INCOMING_FLOW_SOURCE_MODULE ||
    row.source_module === KOLEDINO_27LR_SOURCE_MODULE ||
    row.task_type === INCOMING_FLOW_TASK_TYPE ||
    row.task_type === KOLEDINO_27LR_TASK_TYPE;
}

type IncomingFlowResolution = {
  attachment: string | null;
  attachmentRaw: unknown;
  comment: string | null;
  guiltyId: string | null;
  completedByName: string;
  missing: string[];
};

async function extractIncomingFlowResolution(row: WeeekTaskRow, meta: WeeekTaskMeta, responsePayload: JsonObject, config: WeeekConfig, timeoutMs: number, cache: Map<string, string>): Promise<IncomingFlowResolution> {
  const projectId = meta.projectId || row.target_project_id || config.projectId;
  const boardId = meta.boardId || row.weeek_board_id || row.target_board_id;
  const attachmentField = extractCustomFieldValue(responsePayload, config.incomingFlowAttachmentFieldId, config.incomingFlowAttachmentFieldName);
  const attachment = optionLabelFromRawField(attachmentField.raw, attachmentField.value) ?? await resolveCustomFieldOptionLabel(
    attachmentField.value,
    projectId,
    boardId,
    config.incomingFlowAttachmentFieldId,
    config.incomingFlowAttachmentFieldName,
    config,
    timeoutMs,
    cache,
  ) ?? attachmentField.value;
  const guiltyId = extractCustomFieldValue(responsePayload, config.incomingFlowGuiltyIdFieldId, config.incomingFlowGuiltyIdFieldName).value;
  const comment = extractCustomFieldValue(responsePayload, config.incomingFlowCommentFieldId, config.incomingFlowCommentFieldName).value;
  const missing = [
    [config.incomingFlowAttachmentFieldName, attachment],
    [config.incomingFlowGuiltyIdFieldName, guiltyId],
    [config.incomingFlowCommentFieldName, comment],
  ].filter(([, value]) => !normalizeText(value)).map(([name]) => String(name));

  return {
    attachment: normalizeText(attachment) || null,
    attachmentRaw: attachmentField.raw,
    comment: normalizeText(comment) || null,
    guiltyId: normalizeText(guiltyId) || null,
    completedByName: meta.completedByName || "Не определено",
    missing,
  };
}

async function postJson(url: string, body: JsonObject, timeoutMs: number): Promise<JsonObject> {
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const responseText = await response.text();
  let payload: unknown = null;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = { raw: responseText };
  }
  const payloadObject = asObject(payload) ?? { raw: responseText };
  if (!response.ok || payloadObject.ok === false) {
    throw new Error(`Apps Script writeback failed: ${truncate(normalizeText(payloadObject.error ?? responseText ?? response.statusText), 900)}`);
  }
  return payloadObject;
}

async function writeBackIncomingFlowResult(row: WeeekTaskRow, resolution: IncomingFlowResolution, config: WeeekConfig, timeoutMs: number): Promise<JsonObject> {
  const sourcePayload = asObject(row.source_payload) ?? {};
  const writebackMode = normalizeText(sourcePayload.writeback_mode);
  const isKoledino27lr = writebackMode === KOLEDINO_27LR_ROUTE_KEY ||
    row.source_module === KOLEDINO_27LR_SOURCE_MODULE ||
    row.task_type === KOLEDINO_27LR_TASK_TYPE;
  const apiUrl = normalizeText(sourcePayload.api_url) || (isKoledino27lr ? config.koledino27lrApiUrl : config.incomingFlowApiUrl);
  const appsScriptSecret = isKoledino27lr ? config.koledino27lrAppsScriptSecret : config.incomingFlowAppsScriptSecret;
  const rowNumber = normalizeNumber(sourcePayload.source_row_number, 0);
  if (!apiUrl) throw new Error(isKoledino27lr ? "KOLEDINO_27LR_APPS_SCRIPT_URL is required for Koledino + 27LR writeback" : "INCOMING_FLOW_REQUESTS_APPS_SCRIPT_URL is required for incoming flow writeback");
  if (!rowNumber) throw new Error(`source_row_number is missing for source_id=${row.source_id}`);
  if (!resolution.attachment || !resolution.comment || !resolution.guiltyId) {
    throw new Error("Cannot write back incoming flow result without all required fields");
  }

  return await postJson(apiUrl, {
    action: "update_result",
    secret: appsScriptSecret || undefined,
    spreadsheet_id: normalizeText(sourcePayload.spreadsheet_id),
    sheet_name: normalizeText(sourcePayload.sheet_name ?? sourcePayload.source_sheet),
    row_number: rowNumber,
    requested_shk: row.source_id,
    attachment: resolution.attachment,
    comment: resolution.comment,
    opp_employee: resolution.completedByName,
    guilty_id: resolution.guiltyId,
  }, timeoutMs);
}
  
  async function getRouteForRow(row: WeeekTaskRow): Promise<WeeekRoute> {
    const { data, error } = await supabase
      .from(ROUTES_TABLE)
      .select(ROUTE_COLUMNS)
      .eq("enabled", true)
      .or(`route_key.eq.${row.board_key},task_type.eq.${row.task_type}`)
      .order("route_key", { ascending: true })
      .limit(1)
      .maybeSingle();
  
    if (error) throw new Error(`Failed to read route for ${row.board_key}: ${error.message}`);
    if (!data) throw new Error(`WEEEK route not found for board_key=${row.board_key}, task_type=${row.task_type}`);
    return data as WeeekRoute;
  }
  
  async function fetchQueueRows(body: JsonObject, limit: number): Promise<WeeekTaskRow[]> {
    const sourceModule = normalizeText(body.source_module);
    const taskId = normalizeText(body.id ?? body.task_id);
    const sourceId = normalizeText(body.source_id);
    const retryDelayMinutes = Math.max(normalizeNumber(body.retry_delay_minutes, DEFAULT_RETRY_DELAY_MINUTES), 0);
  
    let query = supabase
      .from(TARGET_TABLE)
      .select(SELECT_COLUMNS)
      .eq("enabled", true)
      .in("master_status", ["queued", "failed"])
      .neq("task_status", "Завершено")
      .or("task_status.neq.Отложено,master_action.eq.system_finalize")
      .order("updated_at", { ascending: true })
      .limit(limit);
  
    if (taskId) query = query.eq("id", taskId);
    if (sourceModule) query = query.eq("source_module", sourceModule);
    if (sourceId) query = query.eq("source_id", sourceId);
    if (!taskId && !sourceId && retryDelayMinutes > 0) {
      const retryBefore = new Date(Date.now() - retryDelayMinutes * 60 * 1000).toISOString();
      query = query.or(`last_attempt_at.is.null,last_attempt_at.lt.${retryBefore}`);
    }
  
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read ${TARGET_TABLE}: ${error.message}`);
    return (data ?? []) as WeeekTaskRow[];
  }
  
  async function fetchStatusRows(body: JsonObject, limit: number): Promise<WeeekTaskRow[]> {
    const sourceModule = normalizeText(body.source_module);
    const taskId = normalizeText(body.id ?? body.task_id);
    const sourceId = normalizeText(body.source_id);
    let query = supabase
      .from(TARGET_TABLE)
      .select(SELECT_COLUMNS)
      .not("weeek_task_id", "is", null)
      .order("synced_at", { ascending: true, nullsFirst: true })
      .limit(limit);
  
    if (taskId) query = query.eq("id", taskId);
    if (sourceModule) query = query.eq("source_module", sourceModule);
    if (sourceId) query = query.eq("source_id", sourceId);
  
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read WEEEK status rows from ${TARGET_TABLE}: ${error.message}`);
    return (data ?? []) as WeeekTaskRow[];
  }
  
  async function updateTaskRow(id: string, patch: JsonObject) {
    const { error } = await supabase.from(TARGET_TABLE).update(patch).eq("id", id);
    if (error) throw new Error(`Failed to update ${TARGET_TABLE} row ${id}: ${error.message}`);
  }

  async function assignMembersOnly(row: WeeekTaskRow, config: WeeekConfig, timeoutMs: number, dryRun: boolean): Promise<JsonObject> {
    const taskId = normalizeText(row.weeek_task_id);
    if (!taskId) throw new Error("Cannot assign WEEEK members without weeek_task_id");

    const members = Array.isArray(row.target_assignee_ids) ? row.target_assignee_ids.filter(Boolean) : [];
    if (!members.length) throw new Error("Cannot assign WEEEK members: target_assignee_ids is empty");

    const requestPayload = {
      desired_assignee_ids: members,
      strategy: "replace_extra_then_add_missing",
    };
    if (dryRun) {
      return {
        id: row.id,
        source_id: row.source_id,
        action: "dry_run_assign_members",
        weeek_task_id: taskId,
        weeek_payload: requestPayload,
      };
    }

    const nowIso = new Date().toISOString();
    await updateTaskRow(row.id, {
      master_status: "processing",
      last_attempt_at: nowIso,
      last_error: null,
      last_request: requestPayload,
      attempt_count: (row.attempt_count ?? 0) + 1,
    });

    const attemptResults: JsonObject[] = [];
    let responsePayload = await fetchWeeekJson(`/tm/tasks/${encodeURIComponent(taskId)}`, config, timeoutMs);
    let meta = extractTaskMeta(responsePayload, config, row);

    const extraAssignees = assigneeDiff(meta.assigneeIds, members);
    if (extraAssignees.length) {
      try {
        attemptResults.push({
          label: "official_remove_extra_assignees_endpoint",
          method: "DELETE",
          path: `/tm/tasks/${encodeURIComponent(taskId)}/assignees`,
          payload: { assignees: extraAssignees },
          update_response: await sendWeeekJson("DELETE", `/tm/tasks/${encodeURIComponent(taskId)}/assignees`, { assignees: extraAssignees }, config, timeoutMs),
        });
        responsePayload = await fetchWeeekJson(`/tm/tasks/${encodeURIComponent(taskId)}`, config, timeoutMs);
        meta = extractTaskMeta(responsePayload, config, row);
      } catch (err) {
        attemptResults.push({
          label: "official_remove_extra_assignees_endpoint",
          method: "DELETE",
          path: `/tm/tasks/${encodeURIComponent(taskId)}/assignees`,
          payload: { assignees: extraAssignees },
          error: String(err instanceof Error ? err.message : err),
        });
      }
    }

    const missingAssignees = assigneeDiff(members, meta.assigneeIds);
    if (missingAssignees.length) {
      const payloadAttempts: Array<{ method: "POST" | "PUT"; path: string; payload: JsonObject; label: string }> = [
        {
          method: "POST",
          path: `/tm/tasks/${encodeURIComponent(taskId)}/assignees`,
          payload: { assignees: missingAssignees },
          label: "official_add_missing_assignees_endpoint",
        },
        {
          method: "PUT",
          path: `/tm/tasks/${encodeURIComponent(taskId)}`,
          payload: { members },
          label: "legacy_put_members",
        },
        {
          method: "PUT",
          path: `/tm/tasks/${encodeURIComponent(taskId)}`,
          payload: { assignees: members },
          label: "legacy_put_assignees",
        },
        {
          method: "PUT",
          path: `/tm/tasks/${encodeURIComponent(taskId)}`,
          payload: { userIds: members },
          label: "legacy_put_user_ids",
        },
        ...(members.length === 1 ? [{
          method: "PUT" as const,
          path: `/tm/tasks/${encodeURIComponent(taskId)}`,
          payload: { userId: members[0] },
          label: "legacy_put_user_id",
        }] : []),
      ];

      for (const attempt of payloadAttempts) {
        try {
          const updatePayload = await sendWeeekJson(attempt.method, attempt.path, attempt.payload, config, timeoutMs);
          const fetchedPayload = await fetchWeeekJson(`/tm/tasks/${encodeURIComponent(taskId)}`, config, timeoutMs);
          const fetchedMeta = extractTaskMeta(fetchedPayload, config, row);
          attemptResults.push({
            label: attempt.label,
            method: attempt.method,
            path: attempt.path,
            payload: attempt.payload,
            update_response: updatePayload,
            fetched_assignee_ids: fetchedMeta.assigneeIds,
          });
          responsePayload = fetchedPayload;
          meta = fetchedMeta;
          if (assigneesMatch(members, fetchedMeta.assigneeIds)) break;
        } catch (err) {
          attemptResults.push({
            label: attempt.label,
            method: attempt.method,
            path: attempt.path,
            payload: attempt.payload,
            error: String(err instanceof Error ? err.message : err),
          });
        }
      }
    }

    if (!assigneesMatch(members, meta.assigneeIds)) {
      const extraAfterAdd = assigneeDiff(meta.assigneeIds, members);
      if (extraAfterAdd.length) {
        try {
          attemptResults.push({
            label: "official_remove_remaining_extra_assignees_endpoint",
            method: "DELETE",
            path: `/tm/tasks/${encodeURIComponent(taskId)}/assignees`,
            payload: { assignees: extraAfterAdd },
            update_response: await sendWeeekJson("DELETE", `/tm/tasks/${encodeURIComponent(taskId)}/assignees`, { assignees: extraAfterAdd }, config, timeoutMs),
          });
          responsePayload = await fetchWeeekJson(`/tm/tasks/${encodeURIComponent(taskId)}`, config, timeoutMs);
          meta = extractTaskMeta(responsePayload, config, row);
        } catch (err) {
          attemptResults.push({
            label: "official_remove_remaining_extra_assignees_endpoint",
            method: "DELETE",
            path: `/tm/tasks/${encodeURIComponent(taskId)}/assignees`,
            payload: { assignees: extraAfterAdd },
            error: String(err instanceof Error ? err.message : err),
          });
        }
      }
    }

    if (!responsePayload) {
      await updateTaskRow(row.id, {
        master_status: "failed",
        last_error: "WEEEK assignee update did not return task payload",
        last_response: { attempts: attemptResults },
        last_attempt_at: new Date().toISOString(),
      });
      throw new Error("WEEEK assignee update did not return task payload");
    }
    if (!assigneesMatch(members, meta.assigneeIds)) {
      const errorMessage = `WEEEK accepted assignee update but task assignees are still different. Expected only: ${members.join(", ")}. Actual: ${meta.assigneeIds.join(", ") || "none"}`;
      await updateTaskRow(row.id, {
        master_status: "failed",
        last_error: errorMessage,
        last_response: { attempts: attemptResults, final_task: responsePayload },
        last_attempt_at: new Date().toISOString(),
      });
      throw new Error(errorMessage);
    }

    const syncedAt = new Date().toISOString();

    await updateTaskRow(row.id, {
      weeek_task_id: meta.id || taskId,
      weeek_task_url: meta.url || row.weeek_task_url || taskUrl(config, taskId, row, row.weeek_board_id || row.target_board_id),
      weeek_workspace_id: normalizeText(row.target_workspace_id) || config.workspaceId,
      weeek_project_id: meta.projectId || row.weeek_project_id || row.target_project_id || config.projectId,
      weeek_board_id: meta.boardId || row.weeek_board_id,
      weeek_board_name: meta.boardName || row.weeek_board_name,
      weeek_column_id: meta.boardColumnId || row.weeek_column_id,
      weeek_column_name: meta.boardColumnName || row.weeek_column_name,
      weeek_assignee_ids: meta.assigneeIds,
      weeek_completed: meta.completed ?? row.weeek_completed,
      weeek_deleted: meta.deleted ?? row.weeek_deleted,
      weeek_updated_at: meta.updatedAt || row.weeek_updated_at,
      synced_at: syncedAt,
      master_status: "synced",
      master_action: "upsert",
      last_error: null,
      last_request: requestPayload,
      last_response: { attempts: attemptResults, final_task: responsePayload },
    });

    return {
      id: row.id,
      source_id: row.source_id,
      action: "assigned_members",
      weeek_task_id: meta.id || taskId,
      members: meta.assigneeIds,
    };
  }
  
  async function findExistingWeeekTask(row: WeeekTaskRow, projectId: string, boardId: string, boardColumnId: string, config: WeeekConfig, timeoutMs: number): Promise<JsonObject | null> {
    const query = new URLSearchParams({ projectId, boardId, boardColumnId, search: row.source_id, perPage: "50", all: "1" });
    const payload = await fetchWeeekJson(`/tm/tasks?${query.toString()}`, config, timeoutMs);
    const tasks = extractList(payload);
    const sourceId = normalizeText(row.source_id);
    return tasks.find((task) => normalizeText(task.title).includes(sourceId)) ?? null;
  }
  
  async function resolveActiveTarget(row: WeeekTaskRow, route: WeeekRoute, config: WeeekConfig, timeoutMs: number, cache: Map<string, string>) {
    const projectId = normalizeText(row.target_project_id) || config.projectId;
    const boardId = await resolveBoardId(projectId, route.active_board_id || row.target_board_id, route.active_board_name || row.target_board_name || "❗️ Активные задачи", config, timeoutMs, cache);
    const columnId = await resolveColumnId(projectId, boardId, route.active_default_column_id || row.target_column_id, route.active_default_column_name || row.target_column_name || "Коробки на входе", config, timeoutMs, cache);
    return { projectId, boardId, boardName: route.active_board_name, columnId, columnName: route.active_default_column_name };
  }
  
  async function resolveInactiveWaitTarget(row: WeeekTaskRow, route: WeeekRoute, config: WeeekConfig, timeoutMs: number, cache: Map<string, string>) {
    const projectId = normalizeText(row.target_project_id) || config.projectId;
    const boardId = await resolveBoardId(projectId, route.inactive_board_id, route.inactive_board_name, config, timeoutMs, cache);
    const columnId = await resolveColumnId(projectId, boardId, route.inactive_wait_column_id, route.inactive_wait_column_name, config, timeoutMs, cache);
    return { projectId, boardId, boardName: route.inactive_board_name, columnId, columnName: route.inactive_wait_column_name };
  }
  
  async function resolveInactiveDoneTarget(row: WeeekTaskRow, route: WeeekRoute, config: WeeekConfig, timeoutMs: number, cache: Map<string, string>) {
    const projectId = normalizeText(row.target_project_id) || config.projectId;
    const boardId = await resolveBoardId(projectId, route.inactive_board_id, route.inactive_board_name, config, timeoutMs, cache);
    const columnId = await resolveColumnId(projectId, boardId, route.inactive_done_column_id, route.inactive_done_column_name, config, timeoutMs, cache);
    return { projectId, boardId, boardName: route.inactive_board_name, columnId, columnName: route.inactive_done_column_name };
  }
  
  async function processOneRow(row: WeeekTaskRow, config: WeeekConfig, timeoutMs: number, dryRun: boolean, cache: Map<string, string>): Promise<JsonObject> {
    if (row.master_action === "assign_members" && normalizeText(row.weeek_task_id)) {
      return await assignMembersOnly(row, config, timeoutMs, dryRun);
    }

    const route = await getRouteForRow(row);
    const systemReason = systemAutoFinalizeReason(row);
    const target = dryRun
      ? (systemReason
        ? { projectId: normalizeText(row.target_project_id) || config.projectId, boardId: route.inactive_board_id || "DRY_RUN_INACTIVE_BOARD_ID", boardName: route.inactive_board_name, columnId: route.inactive_done_column_id || "DRY_RUN_DONE_COLUMN_ID", columnName: route.inactive_done_column_name }
        : { projectId: normalizeText(row.target_project_id) || config.projectId, boardId: route.active_board_id || "DRY_RUN_ACTIVE_BOARD_ID", boardName: route.active_board_name, columnId: route.active_default_column_id || "DRY_RUN_ACTIVE_COLUMN_ID", columnName: route.active_default_column_name })
      : (systemReason
        ? await resolveInactiveDoneTarget(row, route, config, timeoutMs, cache)
        : await resolveActiveTarget(row, route, config, timeoutMs, cache));
    const requestPayload = buildWeeekPayload(row, config, target);
    await applyTargetTags(requestPayload, row, config, timeoutMs, cache);
    const nowIso = new Date().toISOString();
  
    if (dryRun) {
      const dryMeta: WeeekTaskMeta = {
        id: normalizeText(row.weeek_task_id) || "DRY_RUN_TASK_ID",
        title: row.title,
        projectId: target.projectId,
        boardId: target.boardId,
        boardName: target.boardName,
        boardColumnId: target.columnId,
        boardColumnName: target.columnName,
        completed: false,
        deleted: false,
        updatedAt: null,
        url: null,
        oppVerdict: row.opp_verdict,
        oppVerdictRaw: null,
        reopenAfter: null,
        completedByName: null,
        assigneeIds: [],
      };
      return systemReason
        ? { id: row.id, source_id: row.source_id, action: "dry_run", route_key: route.route_key, weeek_payload: requestPayload, system_finalize: await transitionToSystemFinalized(row, route, dryMeta, requestPayload, config, timeoutMs, true, cache) }
        : { id: row.id, source_id: row.source_id, action: "dry_run", route_key: route.route_key, weeek_payload: requestPayload };
    }
  
    await updateTaskRow(row.id, {
      master_status: "processing",
      last_attempt_at: nowIso,
      last_error: null,
      last_request: requestPayload,
      attempt_count: (row.attempt_count ?? 0) + 1,
    });
  
    const existingTask = !row.weeek_task_id && config.dedupeBySearch
      ? await findExistingWeeekTask(row, target.projectId, target.boardId, target.columnId, config, timeoutMs)
      : null;
    const existingMeta = existingTask ? extractTaskMeta(existingTask, config, row) : null;
    const taskId = normalizeText(row.weeek_task_id) || existingMeta?.id || "";
    let usedRequestPayload = requestPayload;
    let responsePayload: JsonObject;
    let action = taskId ? (existingMeta?.id && !row.weeek_task_id ? "updated_existing" : "updated") : "created";
    if (taskId) {
      const updatePayload = payloadForExistingTaskUpdate(requestPayload);
      usedRequestPayload = updatePayload;
      responsePayload = await sendWeeekJson("PUT", `/tm/tasks/${encodeURIComponent(taskId)}`, updatePayload, config, timeoutMs);
    } else {
      try {
        responsePayload = await sendWeeekJson("POST", "/tm/tasks", requestPayload, config, timeoutMs);
      } catch (err) {
        if (!shouldRetryWithTopLevelLocation(err)) throw err;
        const retryPayload = buildWeeekPayload(row, config, target, "top_level");
        await applyTargetTags(retryPayload, row, config, timeoutMs, cache);
        usedRequestPayload = { primary: requestPayload, retry: retryPayload, retry_reason: String(err instanceof Error ? err.message : err) };
        await updateTaskRow(row.id, { last_request: usedRequestPayload });
        responsePayload = await sendWeeekJson("POST", "/tm/tasks", retryPayload, config, timeoutMs);
        action = "created_with_top_level_location_retry";
      }
    }
    const meta = extractTaskMeta(responsePayload, config, row);
    if (!meta.id) throw new Error("WEEEK task response does not contain task id");

    if (systemReason) {
      return await transitionToSystemFinalized(row, route, meta, responsePayload, config, timeoutMs, false, cache);
    }
  
    const syncedAt = new Date().toISOString();
    const expectedAssignees = Array.isArray(row.target_assignee_ids) ? row.target_assignee_ids.filter(Boolean) : [];
    const assigneeSyncPending = expectedAssignees.length > 0 && !assigneesMatch(expectedAssignees, meta.assigneeIds);
    await updateTaskRow(row.id, {
      weeek_task_id: meta.id,
      weeek_task_url: meta.url || taskUrl(config, meta.id, row, target.boardId),
      weeek_workspace_id: normalizeText(row.target_workspace_id) || config.workspaceId,
      weeek_project_id: meta.projectId || target.projectId,
      weeek_board_id: meta.boardId || target.boardId,
      weeek_board_name: meta.boardName || target.boardName,
      weeek_column_id: meta.boardColumnId || target.columnId,
      weeek_column_name: meta.boardColumnName || target.columnName,
      weeek_assignee_ids: meta.assigneeIds,
      weeek_completed: meta.completed,
      weeek_deleted: meta.deleted,
      weeek_updated_at: meta.updatedAt,
      synced_at: syncedAt,
      opp_verdict: meta.oppVerdict ?? row.opp_verdict ?? "Не выбран",
      opp_verdict_raw: meta.oppVerdictRaw ?? null,
      opp_verdict_synced_at: syncedAt,
      task_status: row.task_status || "Не начато",
      master_status: assigneeSyncPending ? "queued" : "synced",
      master_action: assigneeSyncPending ? "assign_members" : "upsert",
      last_error: null,
      last_request: usedRequestPayload,
      last_response: responsePayload,
    });
  
    return {
      id: row.id,
      source_id: row.source_id,
      action: assigneeSyncPending ? `${action}_assignee_sync_queued` : action,
      route_key: route.route_key,
      weeek_task_id: meta.id,
      weeek_task_url: meta.url,
      task_status: row.task_status || "Не начато",
      assignee_sync_pending: assigneeSyncPending,
      expected_assignees: expectedAssignees,
      actual_assignees: meta.assigneeIds,
    };
  }
  
  async function markNeedsAttention(row: WeeekTaskRow, errorMessage: string, responsePayload: JsonObject, meta: WeeekTaskMeta, oppVerdict: string) {
    const syncedAt = new Date().toISOString();
    await updateTaskRow(row.id, {
      master_status: "needs_attention",
      last_error: errorMessage,
      last_response: responsePayload,
      synced_at: syncedAt,
      opp_verdict: oppVerdict,
      opp_verdict_raw: meta.oppVerdictRaw ?? null,
      opp_verdict_synced_at: syncedAt,
      weeek_completed: meta.completed,
      weeek_deleted: meta.deleted,
      weeek_updated_at: meta.updatedAt,
    });
  }

  function scheduledReopenAt(row: WeeekTaskRow, meta: WeeekTaskMeta): string | null {
    return normalizeIsoDateTime(row.reopen_after) || normalizeIsoDateTime(meta.reopenAfter);
  }

  async function skipAlreadyDeferred(row: WeeekTaskRow, meta: WeeekTaskMeta, responsePayload: JsonObject, oppVerdict: string, reopenAfter: string, dryRun: boolean): Promise<JsonObject> {
    if (dryRun) {
      return { id: row.id, source_id: row.source_id, action: "dry_run_deferred_waiting", opp_verdict: oppVerdict, reopen_after: reopenAfter };
    }

    const syncedAt = new Date().toISOString();
    await updateTaskRow(row.id, {
      opp_verdict: oppVerdict,
      opp_verdict_raw: meta.oppVerdictRaw ?? null,
      opp_verdict_synced_at: syncedAt,
      task_status: "Отложено",
      reopen_after: reopenAfter,
      weeek_task_url: meta.url ?? row.weeek_task_url,
      weeek_workspace_id: normalizeText(row.target_workspace_id) || row.weeek_workspace_id,
      weeek_project_id: meta.projectId ?? row.weeek_project_id,
      weeek_board_id: meta.boardId ?? row.weeek_board_id,
      weeek_board_name: meta.boardName ?? row.weeek_board_name,
      weeek_column_id: meta.boardColumnId ?? row.weeek_column_id,
      weeek_column_name: meta.boardColumnName ?? row.weeek_column_name,
      weeek_completed: meta.completed,
      weeek_deleted: meta.deleted,
      weeek_updated_at: meta.updatedAt,
      synced_at: syncedAt,
      master_status: "synced",
      last_error: null,
      last_response: { task: responsePayload, skipped_transition: "already_deferred", reopen_after: reopenAfter },
    });

    return { id: row.id, source_id: row.source_id, action: "deferred_waiting", opp_verdict: oppVerdict, reopen_after: reopenAfter };
  }
  
  async function transitionToDeferred(row: WeeekTaskRow, route: WeeekRoute, meta: WeeekTaskMeta, responsePayload: JsonObject, config: WeeekConfig, timeoutMs: number, dryRun: boolean, cache: Map<string, string>): Promise<JsonObject> {
    const existingReopenAfter = scheduledReopenAt(row, meta);
    if (existingReopenAfter) {
      const oppVerdict = meta.oppVerdict ?? row.opp_verdict ?? "Не выбран";
      return await skipAlreadyDeferred(row, meta, responsePayload, oppVerdict, existingReopenAfter, dryRun);
    }

    const target = dryRun
      ? { projectId: meta.projectId || normalizeText(row.target_project_id) || config.projectId, boardId: route.inactive_board_id || "DRY_RUN_INACTIVE_BOARD_ID", boardName: route.inactive_board_name, columnId: route.inactive_wait_column_id || "DRY_RUN_WAIT_COLUMN_ID", columnName: route.inactive_wait_column_name }
      : await resolveInactiveWaitTarget(row, route, config, timeoutMs, cache);
    const reopenAfter = existingReopenAfter || addDays(new Date(), route.reopen_after_days || 2).toISOString();
  const reopenDateFieldId = dryRun
    ? (route.reopen_date_field_id || "DRY_RUN_REOPEN_DATE_FIELD_ID")
    : await resolveCustomFieldId(target.projectId, target.boardId, route.reopen_date_field_id, route.reopen_date_field_name || config.reopenAfterFieldName, config, timeoutMs, cache);
  const customFields: JsonObject = {};
  if (reopenDateFieldId) customFields[reopenDateFieldId] = reopenAfter;
  const fieldPayload = Object.keys(customFields).length ? { customFields } : {};
  const locationPayload = buildLocationPayload(target.projectId, target.columnId);

  if (dryRun) {
    return { id: row.id, source_id: row.source_id, action: "dry_run_defer", field_payload: fieldPayload, location_payload: locationPayload, reopen_after: reopenAfter };
  }

  const taskId = row.weeek_task_id || meta.id;
  const fieldResponse = await updateTaskCustomFields(taskId, customFields, config, timeoutMs);
  const moveResponse = await moveTaskToColumn(taskId, target.projectId, target.boardId, target.columnId, config, timeoutMs);
  const syncedAt = new Date().toISOString();
  await updateTaskRow(row.id, {
      opp_verdict: meta.oppVerdict ?? row.opp_verdict ?? "Не выбран",
      opp_verdict_raw: meta.oppVerdictRaw ?? null,
      opp_verdict_synced_at: syncedAt,
      task_status: "Отложено",
      reopen_after: reopenAfter,
      deferred_at: syncedAt,
      last_transition: "deferred",
      return_board_id: meta.boardId || row.weeek_board_id || row.target_board_id,
      return_board_name: meta.boardName || row.weeek_board_name || row.target_board_name,
      return_column_id: meta.boardColumnId || row.weeek_column_id || row.target_column_id,
      return_column_name: meta.boardColumnName || row.weeek_column_name || row.target_column_name,
      weeek_board_id: target.boardId,
      weeek_board_name: target.boardName,
      weeek_column_id: target.columnId,
      weeek_column_name: target.columnName,
      weeek_completed: true,
    synced_at: syncedAt,
    master_status: "synced",
    last_error: null,
    last_response: { task: responsePayload, custom_fields: fieldResponse, transition: moveResponse },
  });
  
    return { id: row.id, source_id: row.source_id, action: "deferred", opp_verdict: meta.oppVerdict, reopen_after: reopenAfter, moved_to: target.columnName };
  }
  
  async function transitionToFinalized(row: WeeekTaskRow, route: WeeekRoute, meta: WeeekTaskMeta, responsePayload: JsonObject, config: WeeekConfig, timeoutMs: number, dryRun: boolean, cache: Map<string, string>): Promise<JsonObject> {
  const target = dryRun
    ? { projectId: meta.projectId || normalizeText(row.target_project_id) || config.projectId, boardId: route.inactive_board_id || "DRY_RUN_INACTIVE_BOARD_ID", boardName: route.inactive_board_name, columnId: route.inactive_done_column_id || "DRY_RUN_DONE_COLUMN_ID", columnName: route.inactive_done_column_name }
    : await resolveInactiveDoneTarget(row, route, config, timeoutMs, cache);
  const movePayload = buildLocationPayload(target.projectId, target.columnId);

  if (dryRun) return { id: row.id, source_id: row.source_id, action: "dry_run_finalize", move_payload: movePayload };

  const moveResponse = await moveTaskToColumn(row.weeek_task_id || meta.id, target.projectId, target.boardId, target.columnId, config, timeoutMs);
    const syncedAt = new Date().toISOString();
    await updateTaskRow(row.id, {
      opp_verdict: meta.oppVerdict ?? row.opp_verdict ?? "Не выбран",
      opp_verdict_raw: meta.oppVerdictRaw ?? null,
      opp_verdict_synced_at: syncedAt,
      task_status: "Завершено",
      reopen_after: null,
      finalized_at: syncedAt,
      last_transition: "finalized",
      weeek_board_id: target.boardId,
      weeek_board_name: target.boardName,
      weeek_column_id: target.columnId,
      weeek_column_name: target.columnName,
      weeek_completed: true,
      synced_at: syncedAt,
      master_status: "synced",
      last_error: null,
      last_response: { task: responsePayload, transition: moveResponse },
    });
  
    return { id: row.id, source_id: row.source_id, action: "finalized", opp_verdict: meta.oppVerdict, moved_to: target.columnName };
  }

  async function transitionToSystemFinalized(row: WeeekTaskRow, route: WeeekRoute, meta: WeeekTaskMeta, responsePayload: JsonObject, config: WeeekConfig, timeoutMs: number, dryRun: boolean, cache: Map<string, string>): Promise<JsonObject> {
    const systemReason = systemAutoFinalizeReason(row);
    const oppVerdict = systemAutoFinalizeVerdict(row);
    const tagName = systemAutoFinalizeTagName(row);
    const target = dryRun
      ? { projectId: meta.projectId || normalizeText(row.target_project_id) || config.projectId, boardId: route.inactive_board_id || "DRY_RUN_INACTIVE_BOARD_ID", boardName: route.inactive_board_name, columnId: route.inactive_done_column_id || "DRY_RUN_DONE_COLUMN_ID", columnName: route.inactive_done_column_name }
      : await resolveInactiveDoneTarget(row, route, config, timeoutMs, cache);
    const taskId = row.weeek_task_id || meta.id;
    const taskUpdatePayload: JsonObject = {};
    const customFields: JsonObject = {};

    const oppVerdictFieldId = dryRun
      ? (config.oppVerdictFieldId || "DRY_RUN_OPP_VERDICT_FIELD_ID")
      : await resolveCustomFieldId(target.projectId, target.boardId, config.oppVerdictFieldId, config.oppVerdictFieldName, config, timeoutMs, cache);
    if (!oppVerdictFieldId) throw new Error(`WEEEK custom field "${config.oppVerdictFieldName}" not found for system finalization`);
    const oppVerdictOptionId = dryRun
      ? "DRY_RUN_OPP_VERDICT_OPTION_ID"
      : await resolveCustomFieldOptionIdByLabel(oppVerdict, target.projectId, target.boardId, oppVerdictFieldId || config.oppVerdictFieldId, config.oppVerdictFieldName, config, timeoutMs, cache);

    if (oppVerdictFieldId) customFields[oppVerdictFieldId] = oppVerdictOptionId || oppVerdict;
    if (Object.keys(customFields).length) taskUpdatePayload.customFields = customFields;

    const tagId = dryRun ? "DRY_RUN_SYSTEM_CLOSED_TAG_ID" : await resolveTagId(null, tagName, config, timeoutMs, cache);
    if (tagId) {
      const currentTagIds = extractTaskTagIds(responsePayload);
      taskUpdatePayload.tags = Array.from(new Set([...currentTagIds, tagId])).map(idForPayload);
    }

    const movePayload = buildLocationPayload(target.projectId, target.columnId);
    if (dryRun) {
      return {
        id: row.id,
        source_id: row.source_id,
        action: "dry_run_system_finalized",
        opp_verdict: oppVerdict,
        tag_name: tagName,
        reason: systemReason,
        task_update_payload: taskUpdatePayload,
        move_payload: movePayload,
      };
    }

    const updateResponse = Object.keys(taskUpdatePayload).length
      ? await sendWeeekJson("PUT", `/tm/tasks/${encodeURIComponent(taskId)}`, taskUpdatePayload, config, timeoutMs)
      : null;
    const completeResponse = meta.completed === true
      ? { skipped: true, reason: "task is already completed" }
      : await completeTask(taskId, config, timeoutMs);
    const moveResponse = await moveTaskToColumn(taskId, target.projectId, target.boardId, target.columnId, config, timeoutMs);
    const syncedAt = new Date().toISOString();

    await updateTaskRow(row.id, {
      opp_verdict: oppVerdict,
      opp_verdict_raw: { source: "system", reason: systemReason, source_payload: asObject(row.source_payload) ?? {} },
      opp_verdict_synced_at: syncedAt,
      task_status: "Завершено",
      reopen_after: null,
      finalized_at: syncedAt,
      last_transition: "system_finalized",
      weeek_task_id: taskId,
      weeek_task_url: meta.url || row.weeek_task_url || taskUrl(config, taskId, row, target.boardId),
      weeek_workspace_id: normalizeText(row.target_workspace_id) || config.workspaceId,
      weeek_project_id: meta.projectId || target.projectId,
      weeek_board_id: target.boardId,
      weeek_board_name: target.boardName,
      weeek_column_id: target.columnId,
      weeek_column_name: target.columnName,
      weeek_completed: true,
      weeek_deleted: meta.deleted,
      weeek_updated_at: meta.updatedAt,
      synced_at: syncedAt,
      master_status: "synced",
      master_action: "upsert",
      last_error: null,
      last_response: { task: responsePayload, update: updateResponse, complete: completeResponse, transition: moveResponse },
    });

    return { id: row.id, source_id: row.source_id, action: "system_finalized", opp_verdict: oppVerdict, tag_name: tagName, reason: systemReason, moved_to: target.columnName };
  }

  async function syncIncomingFlowRequest(row: WeeekTaskRow, route: WeeekRoute, meta: WeeekTaskMeta, responsePayload: JsonObject, config: WeeekConfig, timeoutMs: number, dryRun: boolean, cache: Map<string, string>): Promise<JsonObject> {
    const resolution = await extractIncomingFlowResolution(row, meta, responsePayload, config, timeoutMs, cache);
    const taskId = row.weeek_task_id || meta.id;
    const syncedAt = new Date().toISOString();
    const basePatch = {
      weeek_task_url: meta.url ?? row.weeek_task_url,
      weeek_workspace_id: normalizeText(row.target_workspace_id) || config.workspaceId,
      weeek_project_id: meta.projectId,
      weeek_board_id: meta.boardId,
      weeek_board_name: meta.boardName,
      weeek_column_id: meta.boardColumnId,
      weeek_column_name: meta.boardColumnName,
      weeek_completed: meta.completed,
      weeek_deleted: meta.deleted,
      weeek_updated_at: meta.updatedAt,
      synced_at: syncedAt,
      opp_verdict: resolution.attachment ?? row.opp_verdict ?? "Не выбран",
      opp_verdict_raw: {
        source: "incoming_flow_fields",
        attachment_raw: resolution.attachmentRaw ?? null,
        comment: resolution.comment,
        guilty_id: resolution.guiltyId,
        completed_by: resolution.completedByName,
      },
      opp_verdict_synced_at: syncedAt,
    };

    if (meta.completed !== true) {
      const shouldRetryWriteback = normalizeForMatch(row.task_status) === normalizeForMatch("Завершено") && !resolution.missing.length;
      if (shouldRetryWriteback) {
        if (dryRun) {
          return {
            id: row.id,
            source_id: row.source_id,
            action: "dry_run_incoming_flow_writeback_retry",
            attachment: resolution.attachment,
            completed_by: resolution.completedByName,
          };
        }

        const writebackResponse = await writeBackIncomingFlowResult(row, resolution, config, timeoutMs);
        await updateTaskRow(row.id, {
          ...basePatch,
          task_status: "Завершено",
          master_status: "synced",
          last_transition: "incoming_flow_writeback_retried",
          last_error: null,
          last_response: { task: responsePayload, incoming_flow_fields: resolution, source_writeback: writebackResponse },
        });

        return {
          id: row.id,
          source_id: row.source_id,
          action: "incoming_flow_writeback_retried",
          attachment: resolution.attachment,
          completed_by: resolution.completedByName,
          written_back: true,
          source_writeback: writebackResponse,
        };
      }

      if (dryRun) {
        return {
          id: row.id,
          source_id: row.source_id,
          action: "dry_run_incoming_flow_sync",
          attachment: resolution.attachment,
          missing: resolution.missing,
          task_status: row.task_status || "Не начато",
        };
      }

      await updateTaskRow(row.id, {
        ...basePatch,
        task_status: row.task_status || "Не начато",
        master_status: "synced",
        last_error: null,
        last_response: { task: responsePayload, incoming_flow_fields: resolution },
      });

      return { id: row.id, source_id: row.source_id, action: "incoming_flow_synced", attachment: resolution.attachment, task_status: row.task_status || "Не начато" };
    }

    if (resolution.missing.length) {
      const message = `Задача отмечена выполненной, но не заполнены обязательные поля: ${resolution.missing.join(", ")}`;
      if (dryRun) {
        return { id: row.id, source_id: row.source_id, action: "dry_run_incoming_flow_incomplete", missing: resolution.missing, error: message };
      }

      const uncompleteResponse = await uncompleteTask(taskId, config, timeoutMs);
      await updateTaskRow(row.id, {
        ...basePatch,
        weeek_completed: false,
        task_status: "Не начато",
        master_status: "needs_attention",
        last_transition: "incoming_flow_incomplete",
        last_error: message,
        last_response: { task: responsePayload, incoming_flow_fields: resolution, uncomplete: uncompleteResponse },
      });

      return { id: row.id, source_id: row.source_id, action: "incoming_flow_incomplete", missing: resolution.missing, error: message };
    }

    const target = dryRun
      ? { projectId: meta.projectId || normalizeText(row.target_project_id) || config.projectId, boardId: route.inactive_board_id || route.active_board_id || "DRY_RUN_BOARD_ID", boardName: route.inactive_board_name, columnId: route.inactive_done_column_id || "DRY_RUN_DONE_COLUMN_ID", columnName: route.inactive_done_column_name }
      : await resolveInactiveDoneTarget(row, route, config, timeoutMs, cache);
    const movePayload = buildLocationPayload(target.projectId, target.columnId);

    if (dryRun) {
      return {
        id: row.id,
        source_id: row.source_id,
        action: "dry_run_incoming_flow_finalize",
        attachment: resolution.attachment,
        completed_by: resolution.completedByName,
        move_payload: movePayload,
      };
    }

    const moveResponse = await moveTaskToColumn(taskId, target.projectId, target.boardId, target.columnId, config, timeoutMs);
    const writebackResponse = await writeBackIncomingFlowResult(row, resolution, config, timeoutMs);

    await updateTaskRow(row.id, {
      ...basePatch,
      task_status: "Завершено",
      reopen_after: null,
      finalized_at: syncedAt,
      last_transition: "incoming_flow_finalized",
      weeek_board_id: target.boardId,
      weeek_board_name: target.boardName,
      weeek_column_id: target.columnId,
      weeek_column_name: target.columnName,
      weeek_completed: true,
      master_status: "synced",
      master_action: "upsert",
      last_error: null,
      last_response: { task: responsePayload, incoming_flow_fields: resolution, transition: moveResponse, source_writeback: writebackResponse },
    });

    return {
      id: row.id,
      source_id: row.source_id,
      action: "incoming_flow_finalized",
      attachment: resolution.attachment,
      completed_by: resolution.completedByName,
      moved_to: target.columnName,
      written_back: true,
      source_writeback: writebackResponse,
    };
  }
  
  async function syncOneStatus(row: WeeekTaskRow, config: WeeekConfig, timeoutMs: number, dryRun: boolean, cache: Map<string, string>): Promise<JsonObject> {
    if (!row.weeek_task_id) throw new Error(`Task row ${row.id} has no weeek_task_id`);
    const route = await getRouteForRow(row);
    const responsePayload = await fetchWeeekJson(`/tm/tasks/${encodeURIComponent(row.weeek_task_id)}`, config, timeoutMs);
    const meta = extractTaskMeta(responsePayload, config, row);
    const rawOppVerdict = meta.oppVerdict ?? row.opp_verdict ?? "Не выбран";
    const oppVerdict = await resolveCustomFieldOptionLabel(
      rawOppVerdict,
      meta.projectId || row.target_project_id || config.projectId,
      meta.boardId || row.weeek_board_id || row.target_board_id,
      config.oppVerdictFieldId,
      config.oppVerdictFieldName,
      config,
      timeoutMs,
      cache,
    ) ?? rawOppVerdict;
    const resolvedMeta = { ...meta, oppVerdict };

    if (isIncomingFlowRequest(row, route)) {
      return await syncIncomingFlowRequest(row, route, resolvedMeta, responsePayload, config, timeoutMs, dryRun, cache);
    }
  
    if (resolvedMeta.completed === true) {
      if (includesVerdict(route.deferred_verdicts, oppVerdict)) {
        const existingReopenAfter = scheduledReopenAt(row, resolvedMeta);
        if (existingReopenAfter) {
          return skipAlreadyDeferred(row, resolvedMeta, responsePayload, oppVerdict, existingReopenAfter, dryRun);
        }
        return transitionToDeferred(row, route, resolvedMeta, responsePayload, config, timeoutMs, dryRun, cache);
      }
      if (includesVerdict(route.final_verdicts, oppVerdict)) return transitionToFinalized(row, route, resolvedMeta, responsePayload, config, timeoutMs, dryRun, cache);
      if (!includesVerdict(route.not_started_verdicts, oppVerdict)) {
        const message = `Задача завершена, но Вердикт ОПП не распознан: ${oppVerdict}`;
        if (!dryRun) await markNeedsAttention(row, message, responsePayload, resolvedMeta, oppVerdict);
        return { id: row.id, source_id: row.source_id, action: dryRun ? "dry_run_needs_attention" : "needs_attention", error: message };
      }
      const message = "Задача завершена, но Вердикт ОПП пустой или не выбран";
      if (!dryRun) await markNeedsAttention(row, message, responsePayload, resolvedMeta, oppVerdict);
      return { id: row.id, source_id: row.source_id, action: dryRun ? "dry_run_needs_attention" : "needs_attention", error: message };
    }
  
    const syncedAt = new Date().toISOString();
    const taskStatus = includesVerdict(route.not_started_verdicts, oppVerdict) ? "Не начато" : (row.task_status || "Не начато");
    if (dryRun) {
      return { id: row.id, source_id: row.source_id, action: "dry_run_sync_status", opp_verdict: oppVerdict, task_status: taskStatus };
    }
  
    await updateTaskRow(row.id, {
      weeek_task_url: meta.url ?? row.weeek_task_url,
      weeek_workspace_id: normalizeText(row.target_workspace_id) || config.workspaceId,
      weeek_project_id: meta.projectId,
      weeek_board_id: meta.boardId,
      weeek_board_name: meta.boardName,
      weeek_column_id: meta.boardColumnId,
      weeek_column_name: meta.boardColumnName,
      weeek_completed: meta.completed,
      weeek_deleted: meta.deleted,
      weeek_updated_at: meta.updatedAt,
      synced_at: syncedAt,
      opp_verdict: oppVerdict,
      opp_verdict_raw: meta.oppVerdictRaw ?? null,
      opp_verdict_synced_at: syncedAt,
      task_status: taskStatus,
      last_response: responsePayload,
      last_error: null,
    });
  
    return { id: row.id, source_id: row.source_id, action: "synced_status", opp_verdict: oppVerdict, task_status: taskStatus };
  }
  
  async function listQueue(body: JsonObject, limit: number): Promise<JsonObject> {
    const rows = await fetchQueueRows({ ...body, retry_delay_minutes: 0 }, limit);
    return { ok: true, action: "list_queue", target_table: TARGET_TABLE, selected_rows: rows.length, rows };
  }
  
  async function listRoutes(): Promise<JsonObject> {
    const { data, error } = await supabase.from(ROUTES_TABLE).select(ROUTE_COLUMNS).order("route_key", { ascending: true });
    if (error) throw new Error(`Failed to read routes: ${error.message}`);
    return { ok: true, action: "list_routes", routes: data ?? [] };
  }
  
  async function reopenDueTasks(body: JsonObject, config: WeeekConfig, timeoutMs: number, dryRun: boolean, limit: number, cache: Map<string, string>): Promise<JsonObject> {
    const nowIso = new Date().toISOString();
    const sourceModule = normalizeText(body.source_module);
    const taskId = normalizeText(body.id ?? body.task_id);
    const sourceId = normalizeText(body.source_id);
    let query = supabase
      .from(TARGET_TABLE)
      .select(SELECT_COLUMNS)
      .eq("enabled", true)
      .eq("task_status", "Отложено")
      .not("reopen_after", "is", null)
      .lte("reopen_after", nowIso)
      .order("reopen_after", { ascending: true })
      .limit(limit);

    if (taskId) query = query.eq("id", taskId);
    if (sourceModule) query = query.eq("source_module", sourceModule);
    if (sourceId) query = query.eq("source_id", sourceId);

    const { data, error } = await query;
  
    if (error) throw new Error(`Failed to read due deferred tasks: ${error.message}`);
    const rows = (data ?? []) as WeeekTaskRow[];
    const results: JsonObject[] = [];
    let reopenedCount = 0;
    let failedCount = 0;
  
    for (const row of rows) {
      try {
        const route = await getRouteForRow(row);
      const projectId = normalizeText(row.target_project_id) || config.projectId;
      const activeBoardId = await resolveBoardId(projectId, route.active_board_id || row.return_board_id, route.active_board_name, config, timeoutMs, cache);
      const activeColumnId = await resolveColumnId(projectId, activeBoardId, route.active_default_column_id, route.active_default_column_name, config, timeoutMs, cache);
      const activeColumnName = route.active_default_column_name;
      const taskUpdatePayload: JsonObject = {};
      const locationPayload = buildLocationPayload(projectId, activeColumnId);
      const reopenDateFieldId = dryRun
        ? (route.reopen_date_field_id || "DRY_RUN_REOPEN_DATE_FIELD_ID")
        : await resolveCustomFieldId(projectId, row.weeek_board_id || route.inactive_board_id, route.reopen_date_field_id, route.reopen_date_field_name || config.reopenAfterFieldName, config, timeoutMs, cache);

      if (dryRun) {
        results.push({ id: row.id, source_id: row.source_id, action: "dry_run_reopen", task_update_payload: taskUpdatePayload, location_payload: locationPayload, clear_reopen_field_id: reopenDateFieldId });
        continue;
      }

      const taskId = row.weeek_task_id || "";
      const currentTaskPayload = await fetchWeeekJson(`/tm/tasks/${encodeURIComponent(taskId)}`, config, timeoutMs);
      const currentMeta = extractTaskMeta(currentTaskPayload, config, row);
      const desiredCustomFields = asObject(row.target_custom_fields) ?? {};
      if (Object.keys(desiredCustomFields).length) taskUpdatePayload.customFields = desiredCustomFields;
      const reopenedTagId = await resolveTagId(route.reopened_tag_id, route.reopened_tag_name, config, timeoutMs, cache).catch(() => null);
      if (reopenedTagId) {
        const currentTagIds = extractTaskTagIds(currentTaskPayload);
        taskUpdatePayload.tags = Array.from(new Set([...currentTagIds, reopenedTagId])).map(idForPayload);
      }
      const uncompleteResponse = currentMeta.completed === false
        ? { skipped: true, reason: "task is already uncompleted" }
        : await uncompleteTask(taskId, config, timeoutMs);
      const clearReopenDateResponse = await clearTaskCustomField(taskId, reopenDateFieldId, config, timeoutMs);
      const updateResponse = Object.keys(taskUpdatePayload).length
        ? await sendWeeekJson("PUT", `/tm/tasks/${encodeURIComponent(taskId)}`, taskUpdatePayload, config, timeoutMs)
        : null;
      const moveResponse = await moveTaskToColumn(taskId, projectId, activeBoardId, activeColumnId, config, timeoutMs);
      const syncedAt = new Date().toISOString();
      await updateTaskRow(row.id, {
          task_status: "Не начато",
          reopen_after: null,
          reopen_count: (row.reopen_count ?? 0) + 1,
          reopened_at: syncedAt,
          last_transition: "reopened",
          master_status: "synced",
          master_action: "upsert",
          weeek_board_id: activeBoardId,
          weeek_board_name: route.active_board_name,
          weeek_column_id: activeColumnId,
          weeek_column_name: activeColumnName,
        weeek_completed: false,
        synced_at: syncedAt,
        last_error: null,
        last_response: { current_task: currentTaskPayload, uncomplete: uncompleteResponse, clear_reopen_date: clearReopenDateResponse, update: updateResponse, transition: moveResponse },
      });
        reopenedCount += 1;
        results.push({ id: row.id, source_id: row.source_id, action: "reopened", moved_to: activeColumnName });
      } catch (err) {
        failedCount += 1;
        const errorMessage = String(err instanceof Error ? err.message : err);
        if (!dryRun) await updateTaskRow(row.id, { master_status: "failed", last_error: errorMessage, last_attempt_at: new Date().toISOString() });
        results.push({ id: row.id, source_id: row.source_id, action: "failed_reopen", error: errorMessage });
      }
      await sleep(WEEEK_RATE_DELAY_MS);
    }
  
    return { ok: true, action: "reopen_due", dry_run: dryRun, selected_rows: rows.length, reopened_count: reopenedCount, failed_count: failedCount, results };
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
      return json(401, { ok: false, error: "Invalid task master secret" });
    }
  
    const dryRun = normalizeBoolean(body.dry_run, false);
    const limit = normalizeLimit(body.limit);
    const timeoutMs = normalizeTimeoutMs(body.request_timeout_ms);
    const action = normalizeText(body.action ?? body.mode) || "process_queue";
    const startedAt = new Date().toISOString();
    const cache = new Map<string, string>();
  
    try {
      const noApiActions = ["list_queue", "queue", "list_routes", "routes"];
      const config = getWeeekConfig(body, !dryRun && !noApiActions.includes(action));
  
      if (["list_queue", "queue"].includes(action)) {
        const result = await listQueue(body, limit);
        return json(200, { ...result, started_at: startedAt, finished_at: new Date().toISOString() });
      }
  
      if (["list_routes", "routes"].includes(action)) {
        const result = await listRoutes();
        return json(200, { ...result, started_at: startedAt, finished_at: new Date().toISOString() });
      }
  
      if (["reopen_due", "reopen_deferred"].includes(action)) {
      const result = await reopenDueTasks(body, config, timeoutMs, dryRun, limit, cache);
        return json(200, { ...result, started_at: startedAt, finished_at: new Date().toISOString() });
      }
  
      if (["list_boards", "boards"].includes(action)) {
        const projectId = normalizeText(body.project_id) || config.projectId;
        const boards = await fetchBoards(projectId, config, timeoutMs);
        return json(200, { ok: true, action, project_id: projectId, boards: boards.map((board) => ({ id: normalizeId(board.id), name: normalizeText(board.name ?? board.title) })), started_at: startedAt, finished_at: new Date().toISOString() });
      }
  
      if (["list_columns", "columns", "board_columns"].includes(action)) {
        const projectId = normalizeText(body.project_id) || config.projectId;
        const boardId = normalizeText(body.board_id);
        if (!boardId) throw new Error("board_id is required for list_columns");
        const columns = await fetchBoardColumns(projectId, boardId, config, timeoutMs);
        return json(200, { ok: true, action, project_id: projectId, board_id: boardId, columns: columns.map((column) => ({ id: normalizeId(column.id), boardColumnId: normalizeId(column.boardColumnId ?? column.board_column_id), name: normalizeText(column.name ?? column.title) })), started_at: startedAt, finished_at: new Date().toISOString() });
      }
  
    if (["list_custom_fields", "custom_fields"].includes(action)) {
      const projectId = normalizeText(body.project_id) || config.projectId;
      const boardId = normalizeText(body.board_id) || null;
      const fields = await fetchCustomFields(projectId, boardId, config, timeoutMs);
      return json(200, {
          ok: true,
          action,
          project_id: projectId,
          board_id: boardId,
          custom_fields: fields.map((field) => ({
            id: field.id,
            name: field.name,
            type: field.type,
            source: field.source,
            options: field.options.map((option) => ({
              ids: optionIdCandidates(option),
              label: optionLabel(option),
            })),
          })),
          started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }

    if (["list_tags", "tags"].includes(action)) {
      const tags = await fetchWorkspaceTags(config, timeoutMs);
      return json(200, { ok: true, action, tags, started_at: startedAt, finished_at: new Date().toISOString() });
    }

    if (["sync_statuses", "sync_status", "status_sync"].includes(action)) {
        const rows = await fetchStatusRows(body, limit);
        const results: JsonObject[] = [];
        let syncedCount = 0;
        let failedCount = 0;
        for (const row of rows) {
          try {
            results.push(await syncOneStatus(row, config, timeoutMs, dryRun, cache));
            syncedCount += dryRun ? 0 : 1;
          } catch (err) {
            const errorMessage = String(err instanceof Error ? err.message : err);
            failedCount += 1;
            if (!dryRun) await updateTaskRow(row.id, { last_error: errorMessage, synced_at: new Date().toISOString() });
            results.push({ id: row.id, source_id: row.source_id, action: "failed_sync_status", error: errorMessage });
          }
          await sleep(WEEEK_RATE_DELAY_MS);
        }
        return json(200, { ok: true, action, dry_run: dryRun, target_table: TARGET_TABLE, selected_rows: rows.length, synced_count: syncedCount, failed_count: failedCount, started_at: startedAt, finished_at: new Date().toISOString(), results });
      }
  
      if (!["process_queue", "process", "upsert"].includes(action)) throw new Error(`Unknown action: ${action}`);
  
      const rows = await fetchQueueRows(body, limit);
      const results: JsonObject[] = [];
      let processedCount = 0;
      let failedCount = 0;
      for (const row of rows) {
        try {
          results.push(await processOneRow(row, config, timeoutMs, dryRun, cache));
          processedCount += dryRun ? 0 : 1;
        } catch (err) {
          const errorMessage = String(err instanceof Error ? err.message : err);
          failedCount += 1;
          if (!dryRun) await updateTaskRow(row.id, { master_status: "failed", last_error: errorMessage, last_attempt_at: new Date().toISOString() });
          results.push({ id: row.id, source_id: row.source_id, action: "failed", error: errorMessage });
        }
        await sleep(WEEEK_RATE_DELAY_MS);
      }
  
      return json(200, { ok: true, action, dry_run: dryRun, target_table: TARGET_TABLE, selected_rows: rows.length, processed_count: processedCount, failed_count: failedCount, started_at: startedAt, finished_at: new Date().toISOString(), results });
    } catch (err) {
      return json(500, { ok: false, error: String(err instanceof Error ? err.message : err), started_at: startedAt, finished_at: new Date().toISOString() });
    }
  });
