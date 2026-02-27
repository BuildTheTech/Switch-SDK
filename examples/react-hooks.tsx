/**
 * Switch DEX Aggregator — React Hooks Example
 *
 * Ready-to-use hooks for React / Next.js frontends:
 *   • useAdapters()  — fetches available DEX adapters (cached)
 *   • useCheckTax()  — checks buy/sell tax on a token
 *   • useSwapQuote() — fetches a swap quote with feeOnOutput logic
 *
 * These hooks call YOUR proxy (see nextjs-proxy.ts), not the Switch API
 * directly — so your API key stays server-side.
 *
 * Usage: copy the hooks into your project and import them where needed.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types --

interface AdapterInfo {
  index: number;
  name: string;
  address: string;
}

interface AdaptersResponse {
  adapters: AdapterInfo[];
}

interface CheckTaxResult {
  token: string;
  isTaxToken: boolean;
  buyTaxBps: number;
  sellTaxBps: number;
}

interface SwapPath {
  adapter: string;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut: string;
}

interface SwapQuote {
  totalAmountOut: string;
  expectedOutputAmount: string;
  minAmountOut: string;
  effectiveSlippagePercent: string;
  paths: SwapPath[];
  tx?: { to: string; data: string; value: string };
  txFeeOnOutput?: { to: string; data: string; value: string };
}

// ── Constants --

const NATIVE_PLS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

// Your proxy base path (Next.js catch-all route)
const API_BASE = "/api/swap";

// ── Helper --

async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Determine feeOnOutput based on token taxes & PLS involvement.
 *
 * - Selling a tax token  → fee on output
 * - Buying a tax token   → fee on input
 * - Buying PLS/WPLS      → fee on output (collect PLS)
 * - Selling PLS/WPLS     → fee on input  (collect PLS)
 * - Default              → false
 */
function determineFeeOnOutput(
  fromToken: string,
  toToken: string,
  fromTax: CheckTaxResult | null,
  toTax: CheckTaxResult | null,
): boolean {
  const plsAddresses = [NATIVE_PLS.toLowerCase(), WPLS.toLowerCase()];
  const from = fromToken.toLowerCase();
  const to = toToken.toLowerCase();

  if (fromTax?.isTaxToken && fromTax.sellTaxBps > 0) return true;
  if (toTax?.isTaxToken && toTax.buyTaxBps > 0) return false;
  if (plsAddresses.includes(to)) return true;
  if (plsAddresses.includes(from)) return false;
  return false;
}

// ── useAdapters --

/** Fetch the list of supported DEX adapters (cached for session). */
export function useAdapters() {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [allIndices, setAllIndices] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AdaptersResponse>("/adapters?network=pulsechain")
      .then((data) => {
        if (!cancelled) {
          setAdapters(data.adapters);
          setAllIndices(new Set(data.adapters.map((a) => a.index)));
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { adapters, allIndices, loading, error };
}

// ── useCheckTax --

/** Check buy/sell tax for a single token address. */
export function useCheckTax(token: string | undefined) {
  const [tax, setTax] = useState<CheckTaxResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setTax(null); return; }
    let cancelled = false;

    setLoading(true);
    setError(null);

    apiFetch<CheckTaxResult>("/checkTax", { token, network: "pulsechain" })
      .then((data) => {
        if (!cancelled) setTax(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [token]);

  return { tax, loading, error };
}

// ── useSwapQuote --

interface UseSwapQuoteParams {
  fromToken: string;
  toToken: string;
  amount: string;        // wei string
  sender: string;
  slippageBps?: number;
  feeBps?: number;
  partnerAddress?: string;
  receiver?: string;
  /**
   * Optional set of enabled adapter indices. When provided and smaller than
   * allIndices, only these DEXes are used for routing. Omit or pass the full
   * set to route through all DEXes.
   */
  enabledDexes?: Set<number>;
  /** Full set of adapter indices (from useAdapters). Needed to detect subset. */
  allDexIndices?: Set<number>;
  /** Set to false to pause fetching (e.g. while user is typing). */
  enabled?: boolean;
}

/**
 * Fetches a swap quote with automatic feeOnOutput determination.
 *
 * 1. Checks taxes on both tokens
 * 2. Determines feeOnOutput based on tax info & PLS involvement
 * 3. Requests quote with the correct feeOnOutput flag
 *
 * Returns the full quote plus the chosen tx object and feeOnOutput flag.
 */
export function useSwapQuote({
  fromToken,
  toToken,
  amount,
  sender,
  slippageBps = 50,
  feeBps,
  partnerAddress,
  receiver,
  enabledDexes,
  allDexIndices,
  enabled = true,
}: UseSwapQuoteParams) {
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [feeOnOutput, setFeeOnOutput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce: cancel in-flight requests when inputs change
  const abortRef = useRef<AbortController | null>(null);

  const fetchQuote = useCallback(async () => {
    if (!enabled || !fromToken || !toToken || !amount || amount === "0" || !sender) {
      setQuote(null);
      return;
    }

    // Cancel previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      // Step 1 — check taxes on both tokens (parallel)
      const [fromTax, toTax] = await Promise.all([
        apiFetch<CheckTaxResult>("/checkTax", { token: fromToken, network: "pulsechain" }),
        apiFetch<CheckTaxResult>("/checkTax", { token: toToken, network: "pulsechain" }),
      ]);

      if (controller.signal.aborted) return;

      // Step 2 — determine fee mode
      const feeMode = determineFeeOnOutput(fromToken, toToken, fromTax, toTax);
      setFeeOnOutput(feeMode);

      // Step 3 — fetch quote
      const params: Record<string, string> = {
        network: "pulsechain",
        from: fromToken,
        to: toToken,
        amount,
        sender,
        slippage: String(slippageBps),
        feeOnOutput: String(feeMode),
      };
      if (feeBps) params.fee = String(feeBps);
      if (partnerAddress) params.partnerAddress = partnerAddress;
      if (receiver) params.receiver = receiver;
      // Only send adapter filter when a subset of DEXes is enabled
      if (enabledDexes && allDexIndices && enabledDexes.size > 0 && enabledDexes.size < allDexIndices.size) {
        params.adapters = Array.from(enabledDexes).sort((a, b) => a - b).join(",");
      }

      const data = await apiFetch<SwapQuote>("/quote", params);
      if (controller.signal.aborted) return;

      setQuote(data);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Quote fetch failed");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [fromToken, toToken, amount, sender, slippageBps, feeBps, partnerAddress, receiver, enabledDexes, allDexIndices, enabled]);

  useEffect(() => {
    fetchQuote();
    return () => abortRef.current?.abort();
  }, [fetchQuote]);

  // The tx object the caller should submit — already matched to fee mode
  const chosenTx = feeOnOutput ? (quote?.txFeeOnOutput ?? quote?.tx) : quote?.tx;

  return {
    quote,
    chosenTx,
    feeOnOutput,
    loading,
    error,
    /** Manually re-fetch the quote (e.g. on a countdown timer). */
    refetch: fetchQuote,
  };
}

// ── Example component --

/**
 * Minimal swap card showing how to compose the hooks above.
 * Includes DEX toggles so users can enable/disable individual liquidity sources.
 * Replace with your own UI — this is just a starting point.
 */
export function SwapCard() {
  const { adapters, allIndices } = useAdapters();
  const [enabledDexes, setEnabledDexes] = useState<Set<number>>(new Set());

  // Initialize enabledDexes once adapters load
  useEffect(() => {
    if (allIndices.size > 0 && enabledDexes.size === 0) {
      setEnabledDexes(new Set(allIndices));
    }
  }, [allIndices]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDex = (index: number) => {
    const next = new Set(enabledDexes);
    if (next.has(index)) {
      if (next.size > 1) next.delete(index); // keep at least one
    } else {
      next.add(index);
    }
    setEnabledDexes(next);
  };

  const FROM = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27"; // WPLS
  const TO = "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab";   // PLSX

  const { tax: fromTax } = useCheckTax(FROM);
  const { tax: toTax } = useCheckTax(TO);

  const {
    quote,
    chosenTx,
    feeOnOutput,
    loading,
    error,
  } = useSwapQuote({
    fromToken: FROM,
    toToken: TO,
    amount: String(1000n * 10n ** 18n),
    sender: "0x0000000000000000000000000000000000000000", // replace with connected wallet
    slippageBps: 100,
    enabledDexes,
    allDexIndices: allIndices,
  });

  return (
    <div style={{ fontFamily: "monospace", padding: 24 }}>
      <h2>Switch Swap</h2>

      {/* DEX toggles */}
      <div style={{ marginBottom: 16 }}>
        <strong>DEX Sources:</strong>
        {adapters.map((a) => (
          <label key={a.index} style={{ display: "block", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={enabledDexes.has(a.index)}
              onChange={() => toggleDex(a.index)}
            />{" "}
            {a.name}
          </label>
        ))}
      </div>

      {fromTax?.isTaxToken && (
        <p style={{ color: "orange" }}>
          ⚠ From token has {fromTax.sellTaxBps / 100}% sell tax
        </p>
      )}
      {toTax?.isTaxToken && (
        <p style={{ color: "orange" }}>
          ⚠ To token has {toTax.buyTaxBps / 100}% buy tax
        </p>
      )}

      {loading && <p>Fetching quote...</p>}
      {error && <p style={{ color: "red" }}>Error: {error}</p>}

      {quote && (
        <div>
          <p>DEX output: {quote.totalAmountOut}</p>
          <p>You receive: {quote.expectedOutputAmount}</p>
          <p>Min output: {quote.minAmountOut}</p>
          <p>Slippage: {quote.effectiveSlippagePercent}%</p>
          <p>Fee mode: {feeOnOutput ? "output" : "input"}</p>
          <p>Paths: {quote.paths.length}</p>

          <button
            disabled={!chosenTx}
            onClick={() => {
              // Send chosenTx via your wallet (ethers / wagmi / viem)
              console.log("Submit tx:", chosenTx);
            }}
          >
            Swap
          </button>
        </div>
      )}
    </div>
  );
}
