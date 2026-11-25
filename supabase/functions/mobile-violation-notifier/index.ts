// Sends Web Push for notifications created by the database trigger.  This
// endpoint is intentionally not a user endpoint: only Postgres pg_net may
// call it with the shared secret stored in Supabase Vault.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const NOTIFIER_SECRET = Deno.env.get("MOBILE_VIOLATION_NOTIFIER_SECRET") || "";
const VAPID_PUBLIC_KEY = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("WEB_PUSH_VAPID_SUBJECT") || "mailto:wmsplus@wb.ru";

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sameSecret(request: Request) {
  const supplied = request.headers.get("x-mobile-notifier-secret") || "";
  return Boolean(NOTIFIER_SECRET) && supplied === NOTIFIER_SECRET;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed." });
  if (!sameSecret(request)) return json(401, { ok: false, error: "Unauthorized." });
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json(503, { ok: false, error: "Web Push is not configured." });
  }

  const body = await request.json().catch(() => null) as { violation_id?: unknown } | null;
  const violationId = String(body?.violation_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(violationId)) return json(400, { ok: false, error: "Invalid violation id." });

  const { data: notifications, error: notificationsError } = await adminClient
    .from("wms_mobile_notifications")
    .select("id,auth_uid,title,body")
    .eq("violation_id", violationId)
    .is("pushed_at", null);
  if (notificationsError) return json(500, { ok: false, error: "Notification lookup failed." });
  if (!notifications?.length) return json(200, { ok: true, delivered: 0 });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  let delivered = 0;
  for (const notification of notifications) {
    const { data: subscriptions, error: subscriptionsError } = await adminClient
      .from("wms_web_push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("auth_uid", notification.auth_uid);
    if (subscriptionsError || !subscriptions?.length) continue;

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      url: "/#notifications",
      tag: "wmsplus-violation-" + violationId,
    });
    const results = await Promise.allSettled(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 3600 });
        return true;
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode || 0);
        if (status === 404 || status === 410) {
          await adminClient.from("wms_web_push_subscriptions").delete().eq("id", subscription.id);
        }
        throw error;
      }
    }));
    const deliveredForUser = results.filter((result) => result.status === "fulfilled").length;
    if (deliveredForUser) {
      delivered += deliveredForUser;
      await adminClient
        .from("wms_mobile_notifications")
        .update({ pushed_at: new Date().toISOString() })
        .eq("id", notification.id);
    }
  }
  return json(200, { ok: true, delivered });
});
