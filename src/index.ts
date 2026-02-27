/**
 * Switch SDK — Main entry point
 *
 * Re-exports all types and constants for convenience.
 *
 * @example
 * ```ts
 * import { SWITCH_ROUTER, NATIVE_PLS, type BestPathResponse } from "@switch-win/sdk";
 * ```
 *
 * @example
 * ```ts
 * import { buildLimitOrder, submitLimitOrder, type LimitOrderParams } from "@switch-win/sdk";
 * ```
 */

// Types — Swap
export type {
  BestPathResponse,
  SwapTransaction,
  SwapPath,
  SwapPathLeg,
  RouteAllocationPlan,
  SingleRouteAllocation,
  HopAllocationPlan,
  HopAdapterAllocationPlan,
  TokenTaxResponse,
  ErrorResponse,
  QuoteResponse,
  AdapterInfo,
  AdaptersResponse,
  CheckTaxResponse,
  CheckTaxResult,
} from "./types.js";

// Types — Limit Orders
export type {
  LimitOrderParams,
  SignedLimitOrder,
  CreateLimitOrderRequest,
  CancelLimitOrderRequest,
  LimitOrderStatus,
  LimitOrderRecord,
  CreateLimitOrderResponse,
  CancelLimitOrderResponse,
  ListLimitOrdersResponse,
  LimitOrderPair,
  LimitOrderStats,
  LimitOrderMutationResponse,
} from "./types.js";

export { isErrorResponse } from "./types.js";

// Constants — Swap
export {
  API_BASE,
  QUOTE_ENDPOINT,
  ADAPTERS_ENDPOINT,
  CHECK_TAX_ENDPOINT,
  CHAIN_ID,
  SWITCH_ROUTER,
  NATIVE_PLS,
  WPLS,
  FEE_DENOMINATOR,
  MAX_FEE_BPS,
  MAX_SLIPPAGE_BPS,
  DEFAULT_SLIPPAGE_BPS,
  BLUE_CHIPS,
  ERC20_ABI,
  GO_SWITCH_ABI,
  SWITCH_ROUTER_ERRORS,
} from "./constants.js";

// Constants — Limit Orders
export {
  SWITCH_LIMIT_ORDER,
  SWITCH_PLS_FLOW,
  LIMIT_ORDER_API_BASE,
  LIMIT_ORDERS_ENDPOINT,
  LIMIT_ORDER_PAIRS_ENDPOINT,
  LIMIT_ORDER_STATS_ENDPOINT,
  LIMIT_ORDER_EIP712_DOMAIN,
  LIMIT_ORDER_EIP712_TYPES,
  LIMIT_ORDER_ABI,
  LIMIT_ORDER_ERRORS,
  PLS_FLOW_ABI,
  PLS_FLOW_ERRORS,
} from "./constants.js";

// Limit Order helpers
export {
  buildLimitOrder,
  getEIP712SigningParams,
  getApprovalTarget,
  getRouterApprovalTarget,
  shouldUnwrapOutput,
  getPLSFlowAddress,
  isNativePLS,
  submitLimitOrder,
  cancelLimitOrder,
  fetchLimitOrders,
  fetchLimitOrder,
  fetchLimitOrderPairs,
  fetchLimitOrderStats,
} from "./limit-orders.js";

export type {
  BuildLimitOrderOptions,
  ListLimitOrdersOptions,
} from "./limit-orders.js";
