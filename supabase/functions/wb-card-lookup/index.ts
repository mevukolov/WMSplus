// Proxies the (unofficial, undocumented) card.wb.ru product-detail API for
// "Быстрая проверка Без ШК". The app already scrapes WB's image CDN directly
// from the browser for photos (buildWbImageCandidatesByNm), but that only
// works via <img src> -- reading name/brand/sizes needs the actual JSON,
// and card.wb.ru does not send Access-Control-Allow-Origin, so a browser
// fetch() to it is blocked by CORS. This function does the fetch
// server-to-server (no CORS involved) and re-serves the result with our
// own CORS headers.

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

// No barcode/SKU field exists anywhere in this response (checked against
// both a single-size and a multi-size real product) -- WB does not expose
// a way to tell which size a given ШК belongs to via this endpoint. Sizes
// below are the card's full size list, not matched to any one ШК.
type WbSize = { name?: string; origName?: string };
type WbProduct = { name?: string; brand?: string; sizes?: WbSize[] };

function detailUrls(nm: string): string[] {
  // v4 confirmed working (curl-verified against live nm ids); v2 kept as a
  // fallback in case WB rotates the version again -- both are unofficial
  // and undocumented, so neither is guaranteed to stay stable.
  return [
    `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&spp=30&ab_testing=false&lang=ru&nm=${nm}`,
    `https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-1257786&spp=30&hide_dtype=13&ab_testing=false&lang=ru&nm=${nm}`,
  ];
}

async function fetchWbCard(nm: string): Promise<WbProduct | null> {
  for (const url of detailUrls(nm)) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) continue;
      const data = await res.json();
      const product = data?.data?.products?.[0] ?? data?.products?.[0];
      if (product && (product.name || product.brand)) return product as WbProduct;
    } catch {
      continue;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed. Use GET or POST." });
  }

  const url = new URL(req.url);
  let nm = text(url.searchParams.get("nm"));
  if (!nm && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    nm = text((body as Record<string, unknown>)?.nm);
  }
  const digits = nm.replace(/\D/g, "");
  if (!digits) return json(400, { ok: false, error: "Missing nm" });

  const product = await fetchWbCard(digits);
  if (!product) return json(200, { ok: true, found: false, nm: digits });

  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  const sizeNames = sizes
    .map((size) => text(size.origName || size.name))
    .filter((value) => value && value !== "0");
  return json(200, {
    ok: true,
    found: true,
    nm: digits,
    name: text(product.name),
    brand: text(product.brand),
    sizes: Array.from(new Set(sizeNames)),
  });
});
