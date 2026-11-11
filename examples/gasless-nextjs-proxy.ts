/** app/api/switch/[...path]/route.ts. Use your normal origin/session checks and rate limits. */
const READ_PATHS = new Set([
  "swap/quote",
  "swap/checkTax",
  "limit-orders",
  "limit-orders/config",
]);
const STATUS_PATH = /^limit-orders\/0x[\da-f]{40}\/\d{1,16}$/i;

export async function proxySwitch(
  request: Request,
  path: string[],
  apiKey: string,
): Promise<Response> {
  if (!apiKey)
    return Response.json(
      { error: "Switch proxy is not configured" },
      { status: 500 },
    );
  const route = path.join("/");
  const read =
    request.method === "GET" &&
    (READ_PATHS.has(route) || STATUS_PATH.test(route));
  const submit = request.method === "POST" && route === "limit-orders";
  if (!read && !submit)
    return Response.json({ error: "Unsupported route" }, { status: 404 });
  const incoming = new URL(request.url);
  if (
    !["pulsechain", "robinhood"].includes(
      incoming.searchParams.get("network") ?? "",
    )
  )
    return Response.json(
      { error: "Select a supported network" },
      { status: 400 },
    );
  const upstream = new URL(`https://quote.switch.win/${route}`);
  incoming.searchParams.forEach((value, key) =>
    upstream.searchParams.set(key, value),
  );
  let body: string | undefined;
  if (submit) {
    // Enforce a body limit at your hosting/server layer as well.
    body = await request.text();
    if (body.length > 16384)
      return Response.json({ error: "Order body too large" }, { status: 413 });
  }
  try {
    const response = await fetch(upstream, {
      method: request.method,
      body,
      cache: "no-store",
      headers: {
        "x-api-key": apiKey,
        ...(submit ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(submit ? 20000 : 60000),
      ]),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    // A 502 on POST is uncertain: it does not mean the upstream rejected the order.
    return Response.json(
      {
        error: submit
          ? "Submission status uncertain; check the saved order"
          : "Switch API unavailable",
      },
      { status: 502 },
    );
  }
}

// App Router wrappers (adapt params to your installed Next.js version):
// export async function GET(request, context) {
//   return proxySwitch(request, (await context.params).path, process.env.SWITCH_API_KEY!);
// }
// export const POST = GET;
// Keep SWITCH_API_KEY server-side. A status timeout must retain the maker's pending lock.
