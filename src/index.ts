/**
 * Switch SDK — Main entry point
 *
 * Re-exports all types and constants for convenience.
 *
 * @example
 * ```ts
 * import { SWITCH_ROUTER, NATIVE_PLS, type BestPathResponse } from "@switch-win/sdk";
 * ```
 */

// Types
export type {
  BestPathResponse,
  SwapTransaction,
  SwapPath,
  SwapPathLeg,
  RouteAllocationPlan,
  SingleRouteAllocation,
  HopAllocationPlan,
  HopAdapterAllocationPlan,
  ErrorResponse,
  QuoteResponse,
} from "./types.js";

export { isErrorResponse } from "./types.js";

// Constants
export {
  API_BASE,
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
