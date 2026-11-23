// Test-only Web Push endpoint for the WMS+ mobile PWA.
// A user can save and test only their own browser subscription. The VAPID
// private key stays in Supabase secrets and is never sent to the browser.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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
const VAPID_PUBLIC_KEY = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("WEB_PUSH_VAPID_SUBJECT") || "mailto:wmsplus@wb.ru";

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type SubscriptionPayload = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

function parseSubscription(value: unknown) {
  const candidate = value as SubscriptionPayload | null;
  const endpoint = String(candidate?.endpoint || "").trim();
  const p256dh = String(candidate?.keys?.p256dh || "").trim();
  const auth = String(candidate?.keys?.auth || "").trim();
  if (!endpoint.startsWith("https://") || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

async function authenticatedUser(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const callerClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await callerClient.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed." });

  const user = await authenticatedUser(req);
  if (!user) return json(401, { ok: false, error: "Invalid session." });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const action = String(body?.action || "");

  if (action === "subscribe") {
    const subscription = parseSubscription(body?.subscription);
    if (!subscription) return json(400, { ok: false, error: "Invalid push subscription." });

    const { error } = await adminClient.from("wms_web_push_subscriptions").upsert({
      auth_uid: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      user_agent: req.headers.get("user-agent") || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) return json(500, { ok: false, error: "Не удалось сохранить устройство." });
    return json(200, { ok: true });
  }

  if (action === "test") {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return json(503, { ok: false, error: "Web Push ещё не настроен." });
    }
    const { data: subscriptions, error } = await adminClient
      .from("wms_web_push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("auth_uid", user.id);
    if (error) return json(500, { ok: false, error: "Не удалось загрузить устройства." });
    if (!subscriptions?.length) return json(404, { ok: false, error: "Устройство ещё не подписано." });

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const payload = JSON.stringify({
      title: "WMS+",
      body: "Тестовое уведомление пришло успешно.",
      url: "/",
      tag: "wmsplus-test-push",
    });
    const results = await Promise.allSettled(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 60 });
        return true;
      } catch (sendError) {
        const statusCode = Number((sendError as { statusCode?: number }).statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await adminClient.from("wms_web_push_subscriptions").delete().eq("id", subscription.id);
        }
        throw sendError;
      }
    }));
    const delivered = results.filter((result) => result.status === "fulfilled").length;
    return json(delivered ? 200 : 502, { ok: delivered > 0, delivered });
  }

  return json(400, { ok: false, error: "Unknown action." });
});
