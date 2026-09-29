// supabase/functions/admin-manage-employee/index.ts — the only place
// allowed to create a Supabase Auth login for an employee or reset one's
// password (needs service_role, which must never reach the browser --
// see docs/superpowers/specs/2026-09-29-rls-auth-migration-design.md,
// section 5). access_manager.js calls this instead of writing
// public.users.pass directly, which is retired.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed. Use POST." });

  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!bearerToken) return json(401, { ok: false, error: "Missing Authorization header." });

  // Re-validate the caller's own session -- also gives us their identity.
  // Belt-and-suspenders alongside the platform's own verify_jwt gate.
  // getUser() must be called WITH the token explicitly -- a bare
  // getUser() checks the client's own (nonexistent, for a freshly
  // constructed client) session, not the Authorization header passed via
  // global.headers, which only affects REST/Storage/Functions calls, not
  // the auth module's own session handling.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(bearerToken);
  if (callerError || !callerData?.user) {
    return json(401, { ok: false, error: "Invalid session." });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json(400, { ok: false, error: "Invalid JSON body." });

  const action = String((body as Record<string, unknown>).action || "");

  if (action === "create") {
    const id = String((body as Record<string, unknown>).id || "").trim();
    const fio = String((body as Record<string, unknown>).fio || "").trim();
    const pass = String((body as Record<string, unknown>).pass || "");
    const accesses = Array.isArray((body as Record<string, unknown>).accesses)
      ? (body as Record<string, unknown>).accesses as string[]
      : [];

    if (!id || !pass) return json(400, { ok: false, error: "id и pass обязательны." });

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: `${id}@wms.internal`,
      password: pass,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      return json(400, { ok: false, error: "Не удалось создать вход: " + (createError?.message || "unknown error") });
    }

    const { error: insertError } = await adminClient.from("users").insert({
      id,
      fio,
      accesses,
      auth_uid: created.user.id,
    });
    if (insertError) {
      // Roll back the auth user so a failed employee row doesn't leave an
      // orphaned, unusable login behind.
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json(400, { ok: false, error: "Не удалось сохранить сотрудника: " + insertError.message });
    }

    return json(200, { ok: true, id });
  }

  if (action === "reset_password") {
    const id = String((body as Record<string, unknown>).id || "").trim();
    const pass = String((body as Record<string, unknown>).pass || "");
    if (!id || !pass) return json(400, { ok: false, error: "id и pass обязательны." });

    const { data: employee, error: lookupError } = await adminClient
      .from("users")
      .select("auth_uid")
      .eq("id", id)
      .maybeSingle();
    if (lookupError || !employee?.auth_uid) {
      return json(404, { ok: false, error: "Сотрудник не найден." });
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(employee.auth_uid, { password: pass });
    if (updateError) {
      return json(400, { ok: false, error: "Не удалось сменить пароль: " + updateError.message });
    }

    return json(200, { ok: true, id });
  }

  return json(400, { ok: false, error: "Unknown action: " + action });
});
