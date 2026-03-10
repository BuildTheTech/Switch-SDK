/**
 * Switch Limit Orders (V2) — Helper Functions
 *
 * Provides a complete toolkit for creating, signing, submitting, querying,
 * and cancelling EIP-712 signed limit orders on PulseChain.
 *
 * ## How it works
 *
 * 1. **Build** order parameters with `buildLimitOrder()`
 * 2. **Sign** via EIP-712 with your wallet (ethers.js `signTypedData`)
 * 3. **Submit** the signed order to the Switch backend with `submitLimitOrder()`
 * 4. The Switch filler bot monitors active orders and fills them when profitable
 * 5. **Cancel** an order on-chain via `invalidateNonce()` + notify backend with `cancelLimitOrder()`
 *
 * @example
 * ```ts
 * import { buildLimitOrder, submitLimitOrder, fetchLimitOrders } from "@switch-win/sdk/limit-orders";
 * ```
 */

import type {
  LimitOrderParams,
  SignedLimitOrder,
  CreateLimitOrderResponse,
  CancelLimitOrderResponse,
  ListLimitOrdersResponse,
  LimitOrderRecord,
  LimitOrderPair,
  LimitOrderStats,
  LimitOrderStatus,
  ErrorResponse,
} from "./types.js";

import {
  LIMIT_ORDERS_ENDPOINT,
  LIMIT_ORDER_PAIRS_ENDPOINT,
  LIMIT_ORDER_STATS_ENDPOINT,
  LIMIT_ORDER_EIP712_DOMAIN,
  LIMIT_ORDER_EIP712_TYPES,
  SWITCH_LIMIT_ORDER,
  SWITCH_ROUTER,
  SWITCH_PLS_FLOW,
  WPLS,
} from "./constants.js";

// ── Re-export EIP-712 constants for convenience ─────────────────────────────

export { LIMIT_ORDER_EIP712_DOMAIN, LIMIT_ORDER_EIP712_TYPES } from "./constants.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Order Construction
// ═══════════════════════════════════════════════════════════════════════════════

/** Options for building a limit order */
export interface BuildLimitOrderOptions {
  /** Maker (signer) address */
  maker: string;
  /** Input token address (token being sold) */
  tokenIn: string;
  /** Output token address (token being bought) */
  tokenOut: string;
  /** Amount of tokenIn to sell (wei string) */
  amountIn: string;
  /** Minimum amount of tokenOut to accept (wei string) */
  minAmountOut: string;
  /**
   * Order expiry as a Unix timestamp. Defaults to `0` (no expiry).
   * Tip: use `Math.floor(Date.now() / 1000) + 86400` for 24-hour expiry.
   */
  deadline?: number;
  /**
   * Unique nonce. Defaults to `Date.now()` (milliseconds) which is
   * practically unique for a single maker. You can also use a random integer.
   */
  nonce?: number;
  /**
   * Fee mode — `true` to take fee from output, `false` from input. Default `false`.
   *
   * This choice is **permanent once signed** and has two major effects:
   *
   * ### 1. Determines the approval target
   *
   * | `feeOnOutput` | Maker must approve | Helper |
   * |---|---|---|
   * | `false` (default) | **SwitchLimitOrder** | `getApprovalTarget()` |
   * | `true` | **SwitchRouter** | `getRouterApprovalTarget()` |
   *
   * ### 2. Constrains how operators (fillers) can take profit
   *
   * When `feeOnOutput=false`, the LO contract holds all input tokens
   * after pulling them from the maker. Operators can freely choose to
   * take their profit from either the input side or the output side.
   *
   * When `feeOnOutput=true`, the Router pulls tokens directly from the
   * maker. If an operator also wants to take excess *input* tokens,
   * the LO contract would need a **second** approval (from the maker
   * to the LO contract) — which the maker typically hasn't granted.
   * This means operators are effectively limited to taking profit
   * from the output side only. The order is still fully fillable,
   * but operators have less flexibility. In low-liquidity or
   * tight-margin situations, this could reduce the chance of a fill.
   *
   * ### 3. Tax (fee-on-transfer) token guidelines
   *
   * - **Tax input token** → set `feeOnOutput: true`
   *   (Router sends tokens directly from maker to pool — one transfer,
   *   one tax. Avoids the double sell-tax of maker → LO → pool.)
   * - **Tax output token** → set `feeOnOutput: false` (default)
   *   (Output goes directly to recipient in one transfer.)
   * - **Both tokens tax** → not supported (frontend blocks this)
   *
   * **Bottom line:** Use `feeOnOutput: false` (default) unless the input
   * token is a tax token. This gives operators maximum flexibility and
   * the best chance of your order being filled.
   */
  feeOnOutput?: boolean;
  /**
   * Recipient address for the output tokens. Defaults to the maker address.
   * Set to a different address to send output to another wallet.
   */
  recipient?: string;
  /**
   * If `true` and tokenOut is WPLS, the contract unwraps to native PLS
   * before sending to the recipient. Default `false`.
   */
  unwrapOutput?: boolean;
  /**
   * Partner address to receive 50% of protocol fees.
   * Defaults to the zero address (no partner).
   */
  partnerAddress?: string;
}

/**
 * Build a `LimitOrderParams` object ready for EIP-712 signing.
 *
 * @param options - Order parameters
 * @returns A fully-populated `LimitOrderParams` object
 *
 * @example
 * ```ts
 * const order = buildLimitOrder({
 *   maker: "0xYourAddress",
 *   tokenIn: WPLS,
 *   tokenOut: "0xPLSXAddress",
 *   amountIn: ethers.parseUnits("1000", 18).toString(),
 *   minAmountOut: ethers.parseUnits("500000", 18).toString(),
 * });
 * ```
 */
export function buildLimitOrder(options: BuildLimitOrderOptions): LimitOrderParams {
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  return {
    maker: options.maker,
    tokenIn: options.tokenIn,
    tokenOut: options.tokenOut,
    amountIn: options.amountIn,
    minAmountOut: options.minAmountOut,
    deadline: options.deadline ?? 0,
    nonce: options.nonce ?? Date.now(),
    feeOnOutput: options.feeOnOutput ?? false,
    recipient: options.recipient ?? options.maker,
    unwrapOutput: options.unwrapOutput ?? false,
    partnerAddress: options.partnerAddress ?? ZERO_ADDRESS,
  };
}

/**
 * Get the EIP-712 domain and types needed for signing a limit order.
 *
 * Pass the returned values directly to your wallet's `signTypedData` method.
 *
 * @example
 * ```ts
 * // ethers.js v6
 * const { domain, types } = getEIP712SigningParams();
 * const signature = await signer.signTypedData(domain, types, order);
 *
 * // ethers.js v5
 * const signature = await signer._signTypedData(domain, types, order);
 * ```
 */
export function getEIP712SigningParams() {
  return {
    domain: LIMIT_ORDER_EIP712_DOMAIN,
    types: LIMIT_ORDER_EIP712_TYPES,
  } as const;
}

/**
 * Get the approval target for `feeOnOutput: false` orders (the default).
 *
 * When `feeOnOutput` is `false`, the **SwitchLimitOrder** contract pulls
 * tokens from the maker via `safeTransferFrom`, then forwards them to the
 * router internally. The maker must `approve(SWITCH_LIMIT_ORDER, amountIn)`.
 *
 * For `feeOnOutput: true` orders, use {@link getRouterApprovalTarget} instead.
 *
 * @returns The SwitchLimitOrder contract address
 */
export function getApprovalTarget(): string {
  return SWITCH_LIMIT_ORDER;
}

/**
 * Get the approval target for `feeOnOutput: true` orders.
 *
 * When `feeOnOutput` is `true`, the **SwitchRouter** pulls tokens directly
 * from the maker via `goSwitchFrom` (one transfer, one tax — ideal for tax
 * input tokens). The maker must `approve(SWITCH_ROUTER, amountIn)`.
 *
 * For `feeOnOutput: false` orders (default), use {@link getApprovalTarget} instead.
 *
 * @returns The SwitchRouter contract address
 */
export function getRouterApprovalTarget(): string {
  return SWITCH_ROUTER;
}

/**
 * Determine whether `unwrapOutput` should be set for a given output token.
 *
 * Returns `true` only if `tokenOut` is WPLS (the output will be unwrapped
 * to native PLS by the contract).
 */
export function shouldUnwrapOutput(tokenOut: string): boolean {
  return tokenOut.toLowerCase() === WPLS.toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLSFlow (Native PLS Limit Orders)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the SwitchPLSFlow contract address.
 *
 * Use this contract to create native PLS limit orders (sell PLS for any token)
 * in a single transaction — no EIP-712 signing required.
 *
 * @returns The SwitchPLSFlow contract address
 */
export function getPLSFlowAddress(): string {
  return SWITCH_PLS_FLOW;
}

/**
 * Check if the input token is native PLS (should use PLSFlow instead of EIP-712).
 *
 * When the user wants to sell native PLS (not WPLS), they should use the
 * PLSFlow contract instead of the standard EIP-712 signing flow.
 *
 * @param tokenIn - The input token address
 * @returns `true` if tokenIn is the native PLS sentinel address
 */
export function isNativePLS(tokenIn: string): boolean {
  const NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  return tokenIn.toLowerCase() === NATIVE_SENTINEL.toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════════
// API Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Submit a signed limit order to the Switch backend.
 *
 * The backend verifies the EIP-712 signature and stores the order. No gas
 * is required — this is an off-chain operation.
 *
 * **⚠️ CRITICAL:** For standard ERC-20 orders, the EIP-712 signature is
 * purely off-chain — nothing is recorded on-chain until the bot fills it.
 * If this POST fails or never fires (e.g. user closes their browser after
 * signing), the **order is permanently lost**. Your integration should:
 *
 * 1. Call `submitLimitOrder()` **immediately** after the user signs.
 * 2. **Await** the response and verify `success: true` before showing
 *    the order as "created" in your UI.
 * 3. If the POST fails, **retry** automatically (the backend is
 *    idempotent on `maker + nonce`, so retries are safe).
 * 4. Do **not** navigate away or close the signing flow until the
 *    backend confirms the order.
 *
 * PLSFlow (native PLS) orders are an exception — they are recorded
 * on-chain first, so the backend can discover them via event indexing
 * even if the POST never arrives.
 *
 * @param signedOrder - Order parameters + EIP-712 signature
 * @returns The created order record, or an error
 *
 * @example
 * ```ts
 * const order = buildLimitOrder({ ... });
 * const signature = await signer.signTypedData(domain, types, order);
 * const result = await submitLimitOrder({ ...order, signature });
 *
 * if ("error" in result) {
 *   console.error(result.error);
 * } else {
 *   console.log("Order created:", result.order.id);
 * }
 * ```
 */
export async function submitLimitOrder(
  signedOrder: SignedLimitOrder,
): Promise<CreateLimitOrderResponse | ErrorResponse> {
  const res = await fetch(LIMIT_ORDERS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedOrder),
  });

  return res.json() as Promise<CreateLimitOrderResponse | ErrorResponse>;
}

/**
 * Cancel a limit order on the Switch backend (marks it CANCELLED in the DB).
 *
 * **Important:** This only removes the order from the backend orderbook. To
 * prevent the order from being filled on-chain, you MUST also call
 * `invalidateNonce(nonce)` on the SwitchLimitOrder contract. See the
 * cancellation guide in the README.
 *
 * @param maker - Maker address
 * @param nonce - Nonce of the order to cancel
 * @returns Success confirmation or error
 */
export async function cancelLimitOrder(
  maker: string,
  nonce: number,
): Promise<CancelLimitOrderResponse | ErrorResponse> {
  const res = await fetch(LIMIT_ORDERS_ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maker, nonce }),
  });

  return res.json() as Promise<CancelLimitOrderResponse | ErrorResponse>;
}

/** Filter options for listing limit orders */
export interface ListLimitOrdersOptions {
  /** Filter by order status. Default: `"ACTIVE"` */
  status?: LimitOrderStatus;
  /** Filter by maker address */
  maker?: string;
  /**
   * Filter by owner address. Matches orders where the address is either
   * the `maker` or `recipient` field. Useful for native-PLS (PLSFlow) orders
   * where the maker is the PLSFlow contract but the user is the recipient.
   */
  owner?: string;
  /** Filter by input token address */
  tokenIn?: string;
  /** Filter by output token address */
  tokenOut?: string;
  /** Filter by pair key (`tokenIn:tokenOut`, lowercased) */
  pair?: string;
  /** Page size (1–500). Default: `100` */
  limit?: number;
  /** Page offset. Default: `0` */
  offset?: number;
}

/**
 * Fetch limit orders from the Switch backend with optional filters.
 *
 * @param options - Query filters (all optional)
 * @returns Paginated list of orders
 *
 * @example
 * ```ts
 * // All active orders for a specific maker
 * const { orders, total } = await fetchLimitOrders({
 *   maker: "0xYourAddress",
 *   status: "ACTIVE",
 * });
 *
 * // All filled orders for a token pair
 * const filled = await fetchLimitOrders({
 *   tokenIn: WPLS,
 *   tokenOut: "0xPLSXAddress",
 *   status: "FILLED",
 * });
 * ```
 */
export async function fetchLimitOrders(
  options: ListLimitOrdersOptions = {},
): Promise<ListLimitOrdersResponse> {
  const params = new URLSearchParams();
  if (options.status)   params.set("status", options.status);
  if (options.maker)    params.set("maker", options.maker);
  if (options.owner)    params.set("owner", options.owner);
  if (options.tokenIn)  params.set("tokenIn", options.tokenIn);
  if (options.tokenOut) params.set("tokenOut", options.tokenOut);
  if (options.pair)     params.set("pair", options.pair);
  if (options.limit != null)  params.set("limit", String(options.limit));
  if (options.offset != null) params.set("offset", String(options.offset));

  const url = params.toString()
    ? `${LIMIT_ORDERS_ENDPOINT}?${params}`
    : LIMIT_ORDERS_ENDPOINT;

  const res = await fetch(url);
  return res.json() as Promise<ListLimitOrdersResponse>;
}

/**
 * Fetch a single limit order by maker address and nonce.
 *
 * @param maker - Maker address
 * @param nonce - Order nonce
 * @returns The order record, or an error if not found
 */
export async function fetchLimitOrder(
  maker: string,
  nonce: number,
): Promise<LimitOrderRecord | ErrorResponse> {
  const res = await fetch(`${LIMIT_ORDERS_ENDPOINT}/${maker}/${nonce}`);
  return res.json() as Promise<LimitOrderRecord | ErrorResponse>;
}

/**
 * Fetch active trading pairs with order counts.
 *
 * Useful for displaying which token pairs have open limit orders.
 */
export async function fetchLimitOrderPairs(): Promise<LimitOrderPair[]> {
  const res = await fetch(LIMIT_ORDER_PAIRS_ENDPOINT);
  return res.json() as Promise<LimitOrderPair[]>;
}

/**
 * Fetch summary statistics for all limit orders.
 *
 * Returns counts of active, filled, cancelled, and expired orders.
 */
export async function fetchLimitOrderStats(): Promise<LimitOrderStats> {
  const res = await fetch(LIMIT_ORDER_STATS_ENDPOINT);
  return res.json() as Promise<LimitOrderStats>;
}
