/**
 * Switch DEX Aggregator -- API Response Types
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

// -- Top-level response --

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
   * Quoted route output in wei before the Switch protocol fee and slippage.
   * Adapter-native quotes may already include token-tax effects (for example,
   * the Flap Portal quote).
   */
  totalAmountOut: string;
  /**
   * Expected output the user will actually receive, in wei.
   * Accounts for sell tax, protocol fee, and buy tax -- but NOT slippage.
   *
   * Use this for UI display of the estimated received amount. For tax tokens,
   * this is significantly more accurate than applying taxes as linear
   * multipliers to `totalAmountOut`.
   */
  expectedOutputAmount: string;
  /**
   * Minimum acceptable output after taxes, fee, and slippage.
   *
   * Tax accounting is adapter-specific. Use this API value directly rather
   * than recomputing it from the reported tax rates. This is encoded in the
   * `tx` calldata as `_minTotalAmountOut`.
   */
  minAmountOut: string;
  /** Human-readable path descriptions */
  paths: SwapPath[];
  /** Human-readable structured route breakdown for display and analytics. */
  routeAllocation?: RouteAllocationPlan;
  /** Ready-to-send transaction with fee on **input** (default). Only present when `sender` query param is provided. */
  tx?: SwapTransaction;
  /**
   * Ready-to-send transaction with fee on **output**.
   * Only present when `sender` query param is provided.
   *
   * Use this variant when fee-on-output is preferred (e.g. to collect fees in
   * the output token). See the README for recommended strategies.
   */
  txFeeOnOutput?: SwapTransaction;
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
   * Effective slippage in basis points = user slippage + sell tax + buy tax + auto-liq buffer.
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

// -- Transaction (on-chain) --

/** Transaction object ready to be sent on-chain via `signer.sendTransaction()` */
export interface SwapTransaction {
  /** SwitchRouter contract address */
  to: string;
  /** ABI-encoded `goSwitch()` calldata */
  data: string;
  /** Native currency to send (wei). `"0"` for ERC-20 input tokens. */
  value: string;
}

// -- Human-readable paths --

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

// -- Human-readable route allocation --

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
  /** Human-readable DEX adapter name */
  adapter: string;
  /** Input amount routed through this adapter (wei) */
  amountIn: string;
  /** Expected output from this adapter (wei) */
  amountOut: string;
  /** V3 fee tier or concentrated-liquidity tick-spacing hint. Zero for adapters that do not use it. */
  fee?: number;
}

// -- Error response --

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

// -- Adapters endpoint --

/** A single adapter (DEX) returned by `GET /swap/adapters` */
export interface AdapterInfo {
  /** On-chain adapter index (used in the `adapters` query param for `/swap/quote`) */
  index: number;
  /** Human-readable DEX name (e.g. `"PulseXV2"`, `"UniswapV3"`, `"9inchV2"`) */
  name: string;
  /** On-chain adapter contract address */
  address: string;
}

/** Response from `GET /swap/adapters` */
export interface AdaptersResponse {
  adapters: AdapterInfo[];
}

// -- Check Tax endpoint --

/** Response from `GET /swap/checkTax` */
export interface CheckTaxResponse {
  /** Lowercased token address that was checked */
  token: string;
  /** Whether this token has a non-zero transfer tax */
  isTaxToken: boolean;
  /** Buy tax in basis points (applied when the token is the output) */
  buyTaxBps: number;
  /** Sell tax in basis points (applied when the token is the input) */
  sellTaxBps: number;
}

/** Type guard for CheckTaxResponse errors */
export type CheckTaxResult = CheckTaxResponse | ErrorResponse;

// ═══════════════════════════════════════════════════════════════════════════════
// Limit Orders (V2 — EIP-712 signed, approve-only)
// ═══════════════════════════════════════════════════════════════════════════════

// -- Order parameters --

/**
 * Parameters for a limit order — the fields the maker signs via EIP-712.
 *
 * All amounts are raw integer strings in wei (same convention as swap quotes).
 * The `nonce` MUST be unique per maker — once used (filled or cancelled) it
 * cannot be reused.
 */
export interface LimitOrderParams {
  /** Maker (signer) address */
  maker: string;
  /** Input token address (token the maker is selling) */
  tokenIn: string;
  /** Output token address (token the maker wants to receive) */
  tokenOut: string;
  /** Amount of tokenIn the maker is offering (wei) */
  amountIn: string;
  /** Minimum amount of tokenOut the maker will accept (wei) */
  minAmountOut: string;
  /**
   * Unix timestamp after which the order expires. Set to `0` for no expiry.
   * The contract will revert with `OrderExpired()` if `block.timestamp > deadline` (when > 0).
   */
  deadline: number;
  /**
   * Unique nonce per maker. Once a nonce is used (filled or cancelled on-chain),
   * it cannot be reused. Use `Date.now()` or a random integer for uniqueness.
   */
  nonce: number;
  /**
   * If `true`, the contract fee is deducted from the output (tokenOut) instead
   * of the input (tokenIn). Same concept as swap fee modes.
   */
  feeOnOutput: boolean;
  /**
   * Address that receives the output tokens. Defaults to the maker if set
   * to the zero address (`0x0000…`).
   */
  recipient: string;
  /**
   * If `true` and tokenOut is WPLS, the contract unwraps to native PLS
   * before sending to the recipient.
   */
  unwrapOutput: boolean;
  /**
   * Partner address to receive 50% of protocol fees.
   * Use the zero address (`0x0000…`) for no partner.
   */
  partnerAddress: string;
}

/**
 * A signed limit order — the order parameters plus the EIP-712 signature.
 * This is what gets submitted to the Switch backend via `POST /limit-orders`.
 */
export interface SignedLimitOrder extends LimitOrderParams {
  /** EIP-712 signature of the order struct, produced by the maker's wallet */
  signature: string;
  /**
   * SwitchLimitOrder deployment used in the EIP-712 domain.
   * Include this when submitting Robinhood orders or orders signed against an
   * older supported deployment so the backend verifies the correct domain.
   */
  limitOrderContract?: string;
}

// -- API request/response types --

/** Body for `POST /limit-orders` */
export type CreateLimitOrderRequest = SignedLimitOrder;

/** @deprecated Current hosted API cancellation is on-chain only. */
export interface CancelLimitOrderRequest {
  /** Maker address */
  maker: string;
  /** Nonce of the order to cancel */
  nonce: number;
}

/** Order status in the backend database */
export type LimitOrderStatus = "ACTIVE" | "FILLED" | "CANCELLED" | "EXPIRED";

/**
 * A limit order record as returned by the Switch backend API.
 *
 * Includes all order parameters plus metadata fields added by the backend.
 */
export interface LimitOrderRecord {
  /** Unique database ID (cuid) */
  id: string;
  /** Maker address (lowercased) */
  maker: string;
  /** Recipient address (lowercased) */
  recipient: string;
  /** Input token address (lowercased) */
  tokenIn: string;
  /** Output token address (lowercased) */
  tokenOut: string;
  /** Input amount in wei */
  amountIn: string;
  /** Minimum output amount in wei */
  minAmountOut: string;
  /** Expiry timestamp (0 = no expiry) */
  deadline: number;
  /** Unique nonce for this maker */
  nonce: number;
  /** Fee mode flag */
  feeOnOutput: boolean;
  /** Unwrap wrapped-native output to PLS/ETH on the selected network */
  unwrapOutput: boolean;
  /** Partner address for fee sharing */
  partnerAddress: string;
  /** LO contract address this order targets for cancellation/fill */
  limitOrderContract?: string;
  /** EIP-712 signature */
  signature: string;
  /** Pair key in format `tokenIn:tokenOut` (lowercased) */
  pairKey: string;
  /** Sell tax on input token in basis points, when known */
  tokenInSellTaxBps?: number;
  /** Buy tax on input token in basis points, when known */
  tokenInBuyTaxBps?: number;
  /** Sell tax on output token in basis points, when known */
  tokenOutSellTaxBps?: number;
  /** Buy tax on output token in basis points, when known */
  tokenOutBuyTaxBps?: number;
  /** Current order status */
  status: LimitOrderStatus;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
  /** Filler address for filled orders */
  filler?: string | null;
  /** Filler profit in tokenIn units for filled orders */
  fillerProfit?: string | null;
  /** Block number where the order was filled (if status is FILLED) */
  filledBlock?: number | null;
  /** Transaction hash of the fill (if status is FILLED) */
  filledTxHash?: string | null;
}

/** Response from `POST /limit-orders` (success) */
export interface CreateLimitOrderResponse {
  success: true;
  order: LimitOrderRecord;
}

/** @deprecated Current hosted API cancellation is on-chain only. */
export interface CancelLimitOrderResponse {
  success: true;
}

/** Response from `GET /limit-orders` */
export interface ListLimitOrdersResponse {
  /** Total matching orders */
  total: number;
  /** Page size used */
  limit: number;
  /** Page offset used */
  offset: number;
  /** Array of order records */
  orders: LimitOrderRecord[];
}

/** Response from `GET /limit-orders/pairs` */
export interface LimitOrderPair {
  /** Pair key in format `tokenIn:tokenOut` */
  pairKey: string;
  /** Input token address */
  tokenIn: string;
  /** Output token address */
  tokenOut: string;
  /** Number of active orders for this pair */
  activeOrders: number;
}

/** Response from `GET /limit-orders/stats` */
export interface LimitOrderStats {
  active: number;
  filled: number;
  cancelled: number;
  expired: number;
  total: number;
}

/** Response from `GET /limit-orders/config`. */
export interface LimitOrderConfigResponse {
  limitOrderContract: string;
  allLimitOrderContracts: string[];
  plsFlowContract: string | null;
  allPlsFlowContracts: string[];
  limitOrderContractVersions: Record<string, string>;
  plsFlowContractVersions: Record<string, string>;
  eip712Domain: {
    name: "SwitchLimitOrder";
    version: "2";
    chainId: number;
    verifyingContract: string;
  };
}

/** Union type for limit order mutation responses */
export type LimitOrderMutationResponse =
  | CreateLimitOrderResponse
  | CancelLimitOrderResponse
  | ErrorResponse;
