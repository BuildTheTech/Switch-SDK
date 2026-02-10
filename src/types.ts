/**
 * Switch DEX Aggregator — API Response Types
 *
 * TypeScript interfaces for all objects returned by the /swap/quote endpoint.
 * Import these to get full type safety when integrating with the Switch API.
 *
 * @example
 * ```ts
 * import type { BestPathResponse } from "@switch-win/sdk/types";
 *
 * const res = await fetch("https://quote.switch.win/swap/quote?...");
 * const quote: BestPathResponse = await res.json();
 * ```
 */

// ── Top-level response ──────────────────────────────────────────────

/** Full response from `GET /swap/quote` */
export interface BestPathResponse {
  /** Input token address */
  fromToken: string;
  /** Output token address */
  toToken: string;
  /** Total input amount in wei */
  totalAmountIn: string;
  /** Expected output amount in wei (before fee and slippage) */
  totalAmountOut: string;
  /**
   * Minimum acceptable output after fee and slippage.
   *
   * Calculated as:
   * `totalAmountOut × (10000 − feeBps) / 10000 × (10000 − slippageBps) / 10000`
   *
   * This is the value encoded in the `tx` calldata as `_minTotalAmountOut`.
   */
  minAmountOut: string;
  /** Routing strategy used (e.g. `"single-route"`, `"dual-route"`, `"multi-path-optimized"`) */
  splitStrategy: string;
  /** Human-readable path descriptions */
  paths: SwapPath[];
  /** Structured route breakdown (matches on-chain structs) */
  routeAllocation?: RouteAllocationPlan;
  /** Ready-to-send transaction. Only present when `sender` query param is provided. */
  tx?: SwapTransaction;
}

// ── Transaction ─────────────────────────────────────────────────────

/** Transaction object ready to be sent on-chain via `signer.sendTransaction()` */
export interface SwapTransaction {
  /** SwitchRouter contract address */
  to: string;
  /** ABI-encoded `goSwitch()` calldata */
  data: string;
  /** Native PLS to send (wei). `"0"` for ERC-20 input tokens. */
  value: string;
}

// ── Human-readable paths ────────────────────────────────────────────

/**
 * Human-readable summary of a single route split.
 * Useful for UI display (e.g. "60% via PulseX, 40% via 9inch").
 */
export interface SwapPath {
  /** Primary adapter address for this path */
  adapter: string;
  /** Input amount for this path (wei) */
  amountIn: string;
  /** Expected output for this path (wei) */
  amountOut: string;
  /** Ordered list of token addresses traversed (e.g. `[tokenIn, intermediate, tokenOut]`) */
  path: string[];
  /** Adapter addresses used at each hop */
  adapters: string[];
  /** Percentage of total input routed through this path */
  percentage?: number;
  /** Detailed breakdown of each hop-leg in this path */
  legs?: SwapPathLeg[];
}

/** A single leg within a swap path */
export interface SwapPathLeg {
  /** Leg input token */
  tokenIn: string;
  /** Leg output token */
  tokenOut: string;
  /** Adapter address */
  adapter?: string;
  /** Input amount (wei) */
  amountIn: string;
  /** Output amount (wei) */
  amountOut: string;
  /** Percentage of the hop routed through this adapter */
  percentage?: number;
}

// ── Route allocation (matches on-chain structs) ─────────────────────

/** Top-level route allocation plan */
export interface RouteAllocationPlan {
  /** Total input in wei */
  amountIn: string;
  /** Total expected output in wei */
  totalAmountOut: string;
  /** Array of split routes */
  routes: SingleRouteAllocation[];
}

/** A single route within the split */
export interface SingleRouteAllocation {
  /** Input amount for this route portion (wei) */
  amountIn: string;
  /** Sequential hops in this route */
  hops: HopAllocationPlan[];
}

/** A single hop within a route */
export interface HopAllocationPlan {
  /** Hop input token */
  tokenIn: string;
  /** Hop output token */
  tokenOut: string;
  /** Total output from all legs in this hop (wei) */
  totalAmountOut: string;
  /** Adapter legs executing this hop (can be split across DEXes) */
  legs: HopAdapterAllocationPlan[];
}

/** A single adapter leg within a hop */
export interface HopAdapterAllocationPlan {
  /** DEX adapter contract address */
  adapter: string;
  /** Input amount routed through this adapter (wei) */
  amountIn: string;
  /** Expected output from this adapter (wei) */
  amountOut: string;
}

// ── Error response ──────────────────────────────────────────────────

/** Error response returned when the API encounters a problem */
export interface ErrorResponse {
  error: string;
}

/** The quote endpoint returns either a successful response or an error */
export type QuoteResponse = BestPathResponse | ErrorResponse;

/** Type guard to check if a response is an error */
export function isErrorResponse(
  response: QuoteResponse,
): response is ErrorResponse {
  return "error" in response;
}
