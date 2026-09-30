// Looks up a WB product's name/brand/sizes by nm for "Быстрая проверка
// Без ШК". The app already scrapes WB's image CDN directly from the
// browser for photos (buildWbImageCandidatesByNm), but that only works
// via <img src> -- reading name/brand/sizes needs actual JSON.
//
// card.wb.ru/u-card.wb.ru are behind WB's own anti-bot (wbaas): confirmed
// by hand that even a spoofed Referer/Origin still gets a 403 -- it needs
// an IP-bound session cookie only a real, challenge-solving browser can
// mint. But every card is ALSO published as a plain static JSON file on
// WB's basket CDN, with no auth, no rate limit, no anti-bot at all:
//   https://basket-{NN}.wbbasket.ru/vol{VOL}/part{PART}/{nm}/info/ru/card.json
// VOL = nm div 100000, PART = nm div 1000; NN (which physical basket
// holds a given VOL) isn't derivable by formula -- discovered by probing
// and cached in wms_wb_basket_cache (202609300009), shared with
// wb-photo-match's own directory top-up so neither has to reprobe a vol
// the other already resolved.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

const BASKET_PROBE_MAX = 60; // highest basket seen in manual testing was 47 -- some headroom as WB adds more over time

function basketCardUrl(nm: number, basketNo: number): string {
  const vol = Math.floor(nm / 100000);
  const part = Math.floor(nm / 1000);
  const n = String(basketNo).padStart(2, "0");
  return `https://basket-${n}.wbbasket.ru/vol${vol}/part${part}/${nm}/info/ru/card.json`;
}

// No barcode/SKU field exists anywhere in this response (checked against
// both a single-size and a multi-size real product) -- WB does not expose
// a way to tell which size a given ШК belongs to via this endpoint. Sizes
// below are the card's full size list, not matched to any one ШК.
type WbBasketCard = {
  imt_name?: string;
  selling?: { brand_name?: string };
  sizes_table?: { values?: { tech_size?: string }[] };
};

async function probeBasket(nm: number, basketNo: number): Promise<{ basketNo: number; data: WbBasketCard } | null> {
  try {
    const res = await fetch(basketCardUrl(nm, basketNo));
    if (!res.ok) return null;
    const data = await res.json();
    return { basketNo, data };
  } catch {
    return null;
  }
}

async function getCachedBasketNo(vol: number): Promise<number | null> {
  const { data } = await supabase.from("wms_wb_basket_cache").select("basket_no").eq("vol", vol).maybeSingle();
  return data ? data.basket_no : null;
}

async function setCachedBasketNo(vol: number, basketNo: number): Promise<void> {
  await supabase.from("wms_wb_basket_cache").upsert({ vol, basket_no: basketNo, updated_at: new Date().toISOString() });
}

async function fetchWbCard(nm: number): Promise<WbBasketCard | null> {
  const vol = Math.floor(nm / 100000);

  const cached = await getCachedBasketNo(vol);
  if (cached != null) {
    const hit = await probeBasket(nm, cached);
    if (hit) return hit.data;
  }

  const attempts = Array.from({ length: BASKET_PROBE_MAX }, (_, i) => i + 1)
    .filter((n) => n !== cached)
    .map((n) => probeBasket(nm, n));
  const results = await Promise.all(attempts);
  const hit = results.find((r): r is { basketNo: number; data: WbBasketCard } => r !== null);
  if (!hit) return null;
  await setCachedBasketNo(vol, hit.basketNo);
  return hit.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed. Use GET or POST." });
  }

  const url = new URL(req.url);
  let nmRaw = text(url.searchParams.get("nm"));
  if (!nmRaw && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    nmRaw = text((body as Record<string, unknown>)?.nm);
  }
  const digits = nmRaw.replace(/\D/g, "");
  const nm = Number(digits);
  if (!digits || !Number.isFinite(nm) || nm <= 0) return json(400, { ok: false, error: "Missing nm" });

  const product = await fetchWbCard(nm);
  if (!product) return json(200, { ok: true, found: false, nm: digits });

  const sizeNames = (product.sizes_table?.values || [])
    .map((size) => text(size.tech_size))
    .filter((value) => value && value !== "0");
  return json(200, {
    ok: true,
    found: true,
    nm: digits,
    name: text(product.imt_name),
    brand: text(product.selling?.brand_name),
    sizes: Array.from(new Set(sizeNames)),
  });
});
