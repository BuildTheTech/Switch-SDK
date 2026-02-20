/**
 * Switch DEX Aggregator — Next.js API Route Proxy
 *
 * Keeps your API key server-side. Your frontend calls YOUR endpoint,
 * which attaches the key and forwards the request to Switch.
 *
 * File: app/api/swap/[...path]/route.ts  (Next.js App Router catch-all)
 *
 * Proxied routes:
 *   /api/swap/quote     → /swap/quote     (get a swap quote)
 *   /api/swap/adapters  → /swap/adapters  (list DEX adapters)
 *   /api/swap/checkTax  → /swap/checkTax  (check token buy/sell tax)
 *
 * Frontend usage:
 *   const quote    = await fetch("/api/swap/quote?network=pulsechain&from=0x...&to=0x...&amount=1000&sender=0x...");
 *   const adapters = await fetch("/api/swap/adapters");
 *   const tax      = await fetch("/api/swap/checkTax?token=0x...&network=pulsechain");
 */

const SWITCH_API_KEY = process.env.SWITCH_API_KEY;
const SWITCH_API_BASE =
  process.env.SWITCH_API_BASE ?? "https://quote.switch.win";

/** Allowed upstream paths (whitelist to prevent open-proxy abuse). */
const ALLOWED_PATHS = new Set(["quote", "adapters", "checkTax"]);

if (!SWITCH_API_KEY) {
  console.warn(
    "⚠️  SWITCH_API_KEY is not set — swap proxy will not work.",
  );
}

export async function GET(
  request: Request,
  { params }: { params: { path: string[] } },
) {
  if (!SWITCH_API_KEY) {
    return Response.json(
      { error: "Server misconfiguration: API key not set" },
      { status: 500 },
    );
  }

  // Resolve the sub-path, e.g. ["quote"] or ["checkTax"]
  const subPath = params.path?.join("/") ?? "";

  if (!ALLOWED_PATHS.has(subPath)) {
    return Response.json(
      { error: `Unknown endpoint: /swap/${subPath}` },
      { status: 404 },
    );
  }

  const { searchParams } = new URL(request.url);

  // Build the upstream URL and forward all query params
  const url = new URL(`/swap/${subPath}`, SWITCH_API_BASE);
  searchParams.forEach((value, key) => url.searchParams.set(key, value));

  try {
    const upstream = await fetch(url.toString(), {
      headers: { "x-api-key": SWITCH_API_KEY },
      // Don't cache on the edge — quote freshness matters
      cache: "no-store",
    });

    const data = await upstream.json();

    return Response.json(data, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("Switch API proxy error:", err);
    return Response.json(
      { error: "Failed to reach Switch API" },
      { status: 502 },
    );
  }
}
