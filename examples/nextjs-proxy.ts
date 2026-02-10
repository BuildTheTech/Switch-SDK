/**
 * Switch DEX Aggregator — Next.js API Route Proxy
 *
 * Keeps your API key server-side. Your frontend calls YOUR endpoint,
 * which attaches the key and forwards the request to Switch.
 *
 * File: app/api/quote/route.ts  (Next.js App Router)
 *
 * Frontend usage:
 *   const res = await fetch("/api/quote?from=0x...&to=0x...&amount=1000000000000000000&sender=0x...");
 *   const quote = await res.json();
 */

const SWITCH_API_KEY = process.env.SWITCH_API_KEY;
const SWITCH_API_BASE =
  process.env.SWITCH_API_BASE ?? "https://quote.switch.win";

if (!SWITCH_API_KEY) {
  console.warn(
    "⚠️  SWITCH_API_KEY is not set — quote proxy will not work.",
  );
}

export async function GET(request: Request) {
  if (!SWITCH_API_KEY) {
    return Response.json(
      { error: "Server misconfiguration: API key not set" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);

  // Build the upstream URL and forward all query params
  const url = new URL("/swap/quote", SWITCH_API_BASE);
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
      { error: "Failed to fetch quote from Switch API" },
      { status: 502 },
    );
  }
}
