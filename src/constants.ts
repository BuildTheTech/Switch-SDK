/**
 * Switch DEX Aggregator — Constants
 *
 * Addresses, ABIs, and configuration constants for PulseChain integration.
 *
 * @example
 * ```ts
 * import { SWITCH_ROUTER, NATIVE_PLS, ERC20_ABI } from "@switch-win/sdk/constants";
 * ```
 */

// ── API ─────────────────────────────────────────────────────────────

/** Base URL for the Switch quote API */
export const API_BASE = "https://quote.switch.win";

// ── Chain ───────────────────────────────────────────────────────────

/** PulseChain chain ID */
export const CHAIN_ID = 369;

// ── Contract addresses ──────────────────────────────────────────────

/** SwitchRouter contract — target for all swap transactions */
export const SWITCH_ROUTER = "0x69033829f50244FD1be7BDC8e74aE0fF97E47126";

/**
 * Native PLS sentinel address.
 * Use this as `from` or `to` when swapping native PLS (not WPLS the ERC-20).
 */
export const NATIVE_PLS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** Wrapped PLS (WPLS) ERC-20 token address */
export const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

// ── Fee constants ───────────────────────────────────────────────────

/** Fee denominator — all fees are in basis points (1 bps = 0.01%) */
export const FEE_DENOMINATOR = 10_000;

/** Maximum allowed fee (basis points). 100 bps = 1% */
export const MAX_FEE_BPS = 100;

/** Maximum allowed slippage (basis points). 5000 bps = 50% */
export const MAX_SLIPPAGE_BPS = 5_000;

/** Default slippage if not specified (basis points). 50 bps = 0.50% */
export const DEFAULT_SLIPPAGE_BPS = 50;

// ── Well-known tokens ───────────────────────────────────────────────

/** Well-known blue-chip tokens on PulseChain (lowercased for easy comparison) */
export const BLUE_CHIPS = new Set([
  "0xefd766ccb38eaf1dfd701853bfce31359239f305", // DAI (bridged)
  "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07", // USDC (bridged)
  "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f", // USDT (bridged)
  "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39", // eHEX
  "0x57fde0a71132198bbec939b98976993d8d89d225", // pHEX
  "0x95b303987a60c71504d99aa1b13b4da07b0790ab", // PLSX
  "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d", // INC
  "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c", // WETH (bridged)
]);

// ── ABIs ────────────────────────────────────────────────────────────

/**
 * Minimal ERC-20 ABI for approval and allowance checks.
 * Use with ethers.js:
 * ```ts
 * const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
 * ```
 */
export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
] as const;

/**
 * Minimal ABI fragment for the SwitchRouter goSwitch function.
 * Normally you don't need this — the API returns pre-encoded calldata in `tx.data`.
 * Useful only if you want to decode or manually construct calldata.
 */
export const GO_SWITCH_ABI = [
  "function goSwitch(tuple(uint256 amountIn, tuple(address tokenIn, address tokenOut, tuple(address adapter, uint256 amountIn)[] legs)[] hops)[] _routes, address _to, uint256 _minTotalAmountOut, uint256 _fee, bool _feeOnOutput, bool _unwrapOutput, address _partnerAddress) payable",
] as const;

/**
 * SwitchRouter custom error signatures for decoding reverts.
 */
export const SWITCH_ROUTER_ERRORS = [
  "error FinalAmountOutTooLow()",
  "error ExcessiveFee()",
  "error InsufficientFee()",
  "error MsgValueMismatch()",
  "error ZeroInput()",
] as const;
