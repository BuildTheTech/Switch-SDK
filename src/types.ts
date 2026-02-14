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
  /** Recipient address for output tokens. Same as `sender` unless a custom `receiver` was specified. */
  receiver?: string;
  /** Total input amount in wei */
  totalAmountIn: string;
  /**
   * Raw DEX output in wei — reflects price impact only.
   * This is the amount the pools would return before any taxes, fees, or slippage are applied.
   */
  totalAmountOut: string;
  /**
   * Minimum acceptable output after taxes, fee, and slippage.
   *
   * Calculated as:
   * `totalAmountOut × (1 − sellTax) × (1 − fee) × (1 − buyTax) × (1 − slippage)`
   *
   * This is the value encoded in the `tx` calldata as `_minTotalAmountOut`.
   */
  minAmountOut: string;
  /** Human-readable path descriptions */
  paths: SwapPath[];
  /** Structured route breakdown (matches on-chain structs) */
  routeAllocation?: RouteAllocationPlan;
  /** Ready-to-send transaction. Only present when `sender` query param is provided. */
  tx?: SwapTransaction;
  /**
   * Transfer tax info for the input token.
   * Present when the API detects whether the token has a fee-on-transfer mechanism.
   */
  fromTokenTax?: TokenTaxResponse;
  /**
   * Transfer tax info for the output token.
   * Present when the API detects whether the token has a fee-on-transfer mechanism.
   * If `toTokenTax.isTaxToken` is true, `minAmountOut` already accounts for the buy tax.
   */
  toTokenTax?: TokenTaxResponse;
  /**
   * Effective slippage in basis points = user slippage + sell tax + buy tax.
   *
   * For example, if a user requests 50 bps (0.5%) slippage but the input token has
   * a 120 bps (1.2%) sell tax, effectiveSlippageBps = 170.
   *
   * Display this in your UI so users understand the total tolerance applied.
   */
  effectiveSlippageBps: number;
  /**
   * Human-readable effective slippage percentage.
   *
   * Examples: `"0.5"` (no tax), `"1.7"` (0.5% user + 1.2% sell tax), `"4.5"` (0.5% + 2% sell + 2% buy).
   */
  effectiveSlippagePercent: string;
}

// ── Transaction ─────────────────────────────────────────────────────

/** Transfer tax information for a token (fee-on-transfer) */
export interface TokenTaxResponse {
  /** Whether this token has a transfer tax */
  isTaxToken: boolean;
  /**
   * Buy tax in basis points.
   * Applied when the token is acquired (i.e. when it is the output token).
   * For example, 500 = 5% buy tax.
   */
  buyTaxBps: number;
  /**
   * Sell tax in basis points.
   * Applied when the token is sold (i.e. when it is the input token).
   * For example, 500 = 5% sell tax.
   */
  sellTaxBps: number;
}

// ── Transaction (on-chain) ──────────────────────────────────────────

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
  /** Human-readable DEX adapter name (e.g. `"PulseXV2"`, `"UniswapV3"`, `"9inchV2"`) */
  adapter: string;
  /** Input amount for this path (wei) */
  amountIn: string;
  /** Expected output for this path (wei) */
  amountOut: string;
  /** Ordered list of token addresses traversed (e.g. `[tokenIn, intermediate, tokenOut]`) */
  path: string[];
  /** Human-readable adapter names used at each hop */
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
  /** Human-readable DEX adapter name */
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
