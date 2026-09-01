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

// ── API --

/** Base URL for the Switch quote API */
export const API_BASE = "https://quote.switch.win";

// ── API Endpoints --

/** Swap quote endpoint — returns optimal routing and tx calldata */
export const QUOTE_ENDPOINT = `${API_BASE}/swap/quote`;

/** Adapters endpoint — lists all available DEX adapters */
export const ADAPTERS_ENDPOINT = `${API_BASE}/swap/adapters`;

/** Check Tax endpoint — detects fee-on-transfer tokens */
export const CHECK_TAX_ENDPOINT = `${API_BASE}/swap/checkTax`;

// ── Chain --

/** PulseChain chain ID */
export const CHAIN_ID = 369;

// ── Contract addresses --

/**
 * SwitchRouter contract — approval target for swap transactions.
 *
 * **Important:** Do NOT hardcode this address as the `to` field when sending
 * swap transactions. Always use `tx.to` from the quote response — the router
 * contract may be redeployed. This constant is the current approval target;
 * a router migration requires a fresh ERC-20 allowance for the new spender.
 */
export const SWITCH_ROUTER = "0x2dFc8B6e13fF7F04e37Ef97006084805D65a6F19";

/** Previous PulseChain Router retained for historical transactions and trusted legacy drain tooling. */
export const LEGACY_SWITCH_ROUTER =
  "0x0305fcb5dA680EA6fd1B01A96C1949175B99d406";

/**
 * Native PLS sentinel address.
 * Use this as `from` or `to` when swapping native PLS (not WPLS the ERC-20).
 */
export const NATIVE_PLS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** Wrapped PLS (WPLS) ERC-20 token address */
export const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

/** Finvesta's production Liberty-style V3 adapter index in SwitchRouter. */
export const FINVESTA_V3_ADAPTER_INDEX = 20;

/** Verified Finvesta V3 adapter. Not safe for transfer-tax-sensitive hops. */
export const FINVESTA_V3_ADAPTER =
  "0x012c44d0C465819eF3CeAC208e0c1B272087a8b4";

/** Finvesta V3 factory queried by the adapter. */
export const FINVESTA_V3_FACTORY =
  "0x7f5c7C5144b4B4c6e954A5b2D75C318C5467EFDc";

/** Factory-enabled Finvesta fee tiers, in hundredths of one basis point. */
export const FINVESTA_V3_FEE_TIERS = [100, 500, 2500, 10000] as const;

/** Trench V2's production direct-pair adapter index in SwitchRouter. */
export const TRENCH_V2_ADAPTER_INDEX = 21;

/**
 * Verified Trench V2 direct-pair adapter.
 * Eligible for transfer-tax-sensitive hops because input is sent directly to
 * the pair and execution measures the amount actually received.
 */
export const TRENCH_V2_ADAPTER =
  "0xAf48bb0936D9fA522650236917321D89978A8591";

/** Trench V2 factory queried for pairs and pair-specific fees. */
export const TRENCH_V2_FACTORY =
  "0xA024e4574406BEf89e624c75758c700B5bED27C7";

/** Trench V3's production self-quoter adapter index in SwitchRouter. */
export const TRENCH_V3_ADAPTER_INDEX = 22;

/** Verified Trench V3 adapter. Not safe for transfer-tax-sensitive hops. */
export const TRENCH_V3_ADAPTER =
  "0x01957eC5FCC079f1bB388b9f261278daC42cf2E9";

/** Trench V3 factory queried by the adapter. */
export const TRENCH_V3_FACTORY =
  "0xCAeF0a906F3323595A8faA14DF7eDee6F59220af";

/** Factory-enabled Trench V3 fee tiers, in hundredths of one basis point. */
export const TRENCH_V3_FEE_TIERS = [100, 500, 2500, 3000, 10000] as const;

// ── Limit Order contract ────────────────────────────────────────────────

/**
 * SwitchLimitOrder contract address on PulseChain.
 *
 * This is the current protected production limit order contract.
 * For integrators, treat this as user-facing V3.
 * The EIP-712 domain `verifyingContract` MUST match this address.
 */
export const SWITCH_LIMIT_ORDER = "0x2afBf0aB8d958a0227742F7a8BdA00c96372E4D7";

/**
 * Previous production SwitchLimitOrder contract on PulseChain.
 *
 * For integrators, treat this as user-facing V1.
 */
export const SWITCH_LIMIT_ORDER_V1 = "0x0e884072a891b406c0d814907a1e2310fe5f5deb";

/**
 * Second production SwitchLimitOrder deployment, retained for legacy orders.
 *
 * Use this if you want explicit user-facing version naming in integrations.
 */
export const SWITCH_LIMIT_ORDER_V2 =
  "0x8e3881bdF81Fc0211383B2e576076B654F7aFD86";

/** Current protected production SwitchLimitOrder contract alias. */
export const SWITCH_LIMIT_ORDER_V3 = SWITCH_LIMIT_ORDER;

/**
 * SwitchPLSFlow contract address on PulseChain.
 *
 * Used for native PLS limit orders. Users send PLS to this contract,
 * which wraps to WPLS and creates the limit order on their behalf.
 * No EIP-712 signing required — single transaction.
 *
 * This is the current protected production PLSFlow contract.
 * For integrators, treat this as user-facing V3.
 */
export const SWITCH_PLS_FLOW = "0x0362177FF2ad25a33a879c881a5055575C63a4cE";

/**
 * Previous production SwitchPLSFlow contract on PulseChain.
 *
 * For integrators, treat this as user-facing V1.
 */
export const SWITCH_PLS_FLOW_V1 = "0x88c9e2C83b6B7c707602e548481e58E920694E64";

/**
 * Second production SwitchPLSFlow deployment, retained for legacy orders.
 *
 * Use this if you want explicit user-facing version naming in integrations.
 */
export const SWITCH_PLS_FLOW_V2 =
  "0xCf5606bdC750d8626Cec32CA2E1BB207968db1D5";

/** Current protected production SwitchPLSFlow contract alias. */
export const SWITCH_PLS_FLOW_V3 = SWITCH_PLS_FLOW;

/** Direct-fill market-price guard bound to the current PulseChain Router. */
export const SWITCH_DIRECT_FILL_QUOTER =
  "0x23A95b0f69c993CFe6180a266A93F7560102e929";

/** Router adapter for current protected limit-order liquidity (adapter index 17). */
export const SWITCH_LIMIT_ORDER_ADAPTER =
  "0x7B9761484301a8FE4a2BA47194F7646eEF8e1cDd";

/** Narrow PulseChain bridge used to add and remove limit-order operators. */
export const LIMIT_ORDER_ADMIN =
  "0x9C8B9012AfC0489dE612F7039665212EB88be127";

/** PulseChain paid operator-seat and adapter-access registry. */
export const OPERATOR_ACCESS_REGISTRY =
  "0x7dA1AB04A712479569cCaD783Ca6114b763e36Ad";

// ── Limit Order API endpoints ───────────────────────────────────────────────

/** Base URL for the Switch backend API (limit orders) */
export const LIMIT_ORDER_API_BASE = "https://quote.switch.win";

/** Limit orders REST endpoint */
export const LIMIT_ORDERS_ENDPOINT = `${LIMIT_ORDER_API_BASE}/limit-orders`;

/** Limit order pairs endpoint */
export const LIMIT_ORDER_PAIRS_ENDPOINT = `${LIMIT_ORDERS_ENDPOINT}/pairs`;

/** Limit order stats endpoint */
export const LIMIT_ORDER_STATS_ENDPOINT = `${LIMIT_ORDERS_ENDPOINT}/stats`;

// ── Fee constants --

/** Fee denominator — all fees are in basis points (1 bps = 0.01%) */
export const FEE_DENOMINATOR = 10_000;

/** Maximum allowed fee (basis points). 100 bps = 1% */
export const MAX_FEE_BPS = 100;

/** Current regular-swap protocol fee on PulseChain and Robinhood Chain. */
export const DEFAULT_SWAP_FEE_BPS = 10;

/** Current limit-order protocol fee on both supported networks. */
export const LIMIT_ORDER_FEE_BPS = 30;

/** Maximum operator excess retained by protected limit-order contracts. */
export const MAX_OPERATOR_EXCESS_BPS = 500;

/** Maximum allowed slippage (basis points). 5000 bps = 50% */
export const MAX_SLIPPAGE_BPS = 5_000;

/** Default slippage if not specified (basis points). 50 bps = 0.50% */
export const DEFAULT_SLIPPAGE_BPS = 50;

// ── Well-known tokens --

/** Well-known blue-chip tokens on PulseChain (lowercased for easy comparison) */
export const BLUE_CHIPS = new Set([
  "0xefd766ccb38eaf1dfd701853bfce31359239f305", // DAI (bridged)
  "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07", // USDC (bridged)
  "0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f", // USDT (bridged)
  "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39", // pHEX
  "0x57fde0a71132198bbec939b98976993d8d89d225", // eHEX
  "0x95b303987a60c71504d99aa1b13b4da07b0790ab", // PLSX
  "0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d", // INC
  "0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c", // WETH (bridged)
]);

// ── ABIs --

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
  "function goSwitch(tuple(uint256 amountIn, tuple(address tokenIn, address tokenOut, tuple(address adapter, uint256 amountIn, uint24 fee, bytes data)[] legs)[] hops)[] _routes, address _to, uint256 _minTotalAmountOut, uint256 _fee, bool _feeOnOutput, bool _unwrapOutput, address _partnerAddress) payable",
] as const;

/**
 * SwitchRouter custom error signatures for decoding reverts.
 */
export const SWITCH_ROUTER_ERRORS = [
  "error InsufficientFee()",
  "error ExcessiveFee()",
  "error FinalAmountOutTooLow()",
  "error EmptySplit()",
  "error SplitMixedTokenIn()",
  "error SplitMixedTokenOut()",
  "error ZeroInput()",
  "error MsgValueMismatch()",
  "error PathNeedsBeginWithWPLS()",
  "error PathNeedsEndWithWPLS()",
  "error AdapterNotApproved(address)",
  "error EmptyHop()",
  "error FeeNotSupported()",
] as const;

/**
 * 4-byte error selectors for SwitchRouter reverts.
 *
 * Useful for matching raw revert data from `eth_call` or failed transactions.
 * Key = selector hex, value = human-readable error name.
 *
 * @example
 * ```ts
 * const selector = revertData.slice(0, 10); // "0x4a2ab023"
 * const name = SWITCH_ROUTER_ERROR_SELECTORS[selector]; // "FinalAmountOutTooLow"
 * ```
 */
export const SWITCH_ROUTER_ERROR_SELECTORS: Record<string, string> = {
  "0x025dbdd4": "InsufficientFee",
  "0x2977da44": "ExcessiveFee",
  "0x4a2ab023": "FinalAmountOutTooLow",
  "0x5725cad2": "EmptySplit",
  "0xdceb8b7a": "SplitMixedTokenIn",
  "0x45a68c8c": "SplitMixedTokenOut",
  "0xaf458c07": "ZeroInput",
  "0xbc6f88c5": "MsgValueMismatch",
  "0x906478dc": "PathNeedsBeginWithWPLS",
  "0x037ccaee": "PathNeedsEndWithWPLS",
  "0x0c48343e": "AdapterNotApproved",
  "0xb19ef58a": "EmptyHop",
  "0x73620122": "FeeNotSupported",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Limit Order — EIP-712 Constants
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * EIP-712 domain for SwitchLimitOrder.
 *
 * Must match the domain used in the contract's constructor:
 * `EIP712("SwitchLimitOrder", "2")`
 *
 * **Important:** Update `verifyingContract` when the contract is deployed.
 */
export const LIMIT_ORDER_EIP712_DOMAIN = {
  name: "SwitchLimitOrder",
  version: "2",
  chainId: CHAIN_ID,
  verifyingContract: SWITCH_LIMIT_ORDER,
} as const;

/**
 * EIP-712 type definition for the LimitOrder struct.
 *
 * Used with `ethers.signTypedData(domain, types, value)` or equivalent.
 * Must match the struct order and types in `SwitchLimitOrder.sol`.
 */
export const LIMIT_ORDER_EIP712_TYPES = {
  LimitOrder: [
    { name: "maker", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "feeOnOutput", type: "bool" },
    { name: "recipient", type: "address" },
    { name: "unwrapOutput", type: "bool" },
    { name: "partnerAddress", type: "address" },
  ],
} as const;

/**
 * Minimal ABI for the SwitchLimitOrder contract.
 *
 * Includes only the functions relevant to order makers:
 * - `invalidateNonce(uint256)` — cancel a single order on-chain
 * - `invalidateNonces(uint256[])` — cancel multiple orders on-chain
 * - `isNonceUsed(address,uint256)` — check if a nonce has been used
 * - `canFillOrder(order,signature)` — check if an order is fillable
 *
 * The full ABI is available at `@switch-win/sdk/abi/limit-order`.
 */
export const LIMIT_ORDER_ABI = [
  "function SWITCH_ROUTER() view returns (address)",
  "function MAX_OPERATOR_EXCESS_BPS() view returns (uint256)",
  "function getFee() view returns (uint256)",
  "function operatorGateEnabled() view returns (bool)",
  "function directFillQuoter() view returns (address)",
  "function plsFlowContract() view returns (address)",
  "function invalidateNonce(uint256 _nonce) external",
  "function invalidateNonces(uint256[] calldata _nonces) external",
  "function isNonceUsed(address maker, uint256 nonce) view returns (bool)",
  "function canFillOrder(tuple(address maker, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, uint256 nonce, bool feeOnOutput, address recipient, bool unwrapOutput, address partnerAddress) order, bytes signature) view returns (bool)",
] as const;

/**
 * SwitchLimitOrder custom error signatures for decoding reverts.
 */
export const LIMIT_ORDER_ERRORS = [
  "error InvalidSignature()",
  "error NonceAlreadyUsed()",
  "error OrderExpired()",
  "error InsufficientOutput()",
  "error InvalidAmount()",
  "error ExcessiveFee()",
  "error RouteInputExceedsMax()",
  "error InvalidTokens()",
  "error TransferFailed()",
  "error OperatorOnly()",
  "error NativeFlowInputNotFullyConsumed()",
  "error RouteTokenInMismatch()",
  "error RouteTokenOutMismatch()",
  "error InvalidDirectFillQuoter()",
  "error DirectFillQuoteUnavailable()",
  "error DirectFillPriceTooLow()",
  "error OperatorManagerOnly()",
] as const;

/**
 * 4-byte error selectors for SwitchLimitOrder reverts.
 *
 * @example
 * ```ts
 * const selector = revertData.slice(0, 10); // "0x8baa579f"
 * const name = LIMIT_ORDER_ERROR_SELECTORS[selector]; // "InvalidSignature"
 * ```
 */
export const LIMIT_ORDER_ERROR_SELECTORS: Record<string, string> = {
  "0x8baa579f": "InvalidSignature",
  "0x1fb09b80": "NonceAlreadyUsed",
  "0xc56873ba": "OrderExpired",
  "0xbb2875c3": "InsufficientOutput",
  "0x2c5211c6": "InvalidAmount",
  "0x2977da44": "ExcessiveFee",
  "0xb6972a87": "RouteInputExceedsMax",
  "0x672215de": "InvalidTokens",
  "0x90b8ec18": "TransferFailed",
  "0xae5e3e00": "OperatorOnly",
  "0x42e89a78": "NativeFlowInputNotFullyConsumed",
  "0x54346455": "RouteTokenInMismatch",
  "0xa587e83b": "RouteTokenOutMismatch",
  "0xdcd56106": "InvalidDirectFillQuoter",
  "0x0e4c7aa9": "DirectFillQuoteUnavailable",
  "0xca8ecf0e": "DirectFillPriceTooLow",
  "0xb68f3df5": "OperatorManagerOnly",
};

/**
 * Minimal ABI for the SwitchPLSFlow contract.
 *
 * Used for creating native PLS limit orders in a single transaction.
 * The contract wraps PLS to WPLS and places the limit order on behalf
 * of the sender. `recipient` is required in calldata by current deployments;
 * pass the zero address to default settlement to `msg.sender`.
 */
export const PLS_FLOW_ABI = [
  "function createOrder(address tokenOut, uint256 minAmountOut, uint256 deadline, bool feeOnOutput, bool unwrapOutput, address partnerAddress, address recipient) payable returns (uint256 nonce)",
  "function cancelOrder(uint256 nonce) external",
  "function getOrder(uint256 nonce) view returns (tuple(address originalMaker, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, uint256 createdAt, bool feeOnOutput, bool unwrapOutput, bool active, address recipient, address partnerAddress))",
  "function globalNonceCounter() view returns (uint256)",
  "function getGlobalNonce() view returns (uint256)",
  "function orderCreationEnabled() view returns (bool)",
  "function isOrderActive(uint256 nonce) view returns (bool)",
  "function totalLockedWPLS() view returns (uint256)",
  "function SWITCH_LIMIT_ORDER() view returns (address)",
  "function SWITCH_ROUTER() view returns (address)",
  "function WNATIVE() view returns (address)",
  "event PLSOrderCreated(address indexed originalMaker, uint256 indexed nonce, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, address recipient)",
  "event PLSOrderCancelled(address indexed originalMaker, uint256 indexed nonce, uint256 refundAmount)",
  "event PLSOrderFilled(address indexed originalMaker, uint256 indexed nonce, uint256 amountIn)",
  "event PLSOrderInputExcessRefunded(address indexed originalMaker, uint256 indexed nonce, uint256 amount)",
  "event OrderCreationEnabledUpdated(bool enabled)",
] as const;

/**
 * SwitchPLSFlow custom error signatures for decoding reverts.
 */
export const PLS_FLOW_ERRORS = [
  "error ZeroAmount()",
  "error InvalidToken()",
  "error OrderNotActive()",
  "error NotOrderOwner()",
  "error TransferFailed()",
  "error OrderAlreadyFilled()",
  "error AccountingMismatch()",
  "error OrderNotEligibleForAdminCancel()",
  "error OnlyLimitOrder()",
  "error OrderNotFilled()",
  "error InvalidDeadline()",
  "error OrderCreationDisabled()",
] as const;

/**
 * 4-byte error selectors for SwitchPLSFlow reverts.
 */
export const PLS_FLOW_ERROR_SELECTORS: Record<string, string> = {
  "0x1f2a2005": "ZeroAmount",
  "0xc1ab6dc1": "InvalidToken",
  "0x1d4ecc5b": "OrderNotActive",
  "0xf6412b5a": "NotOrderOwner",
  "0x90b8ec18": "TransferFailed",
  "0xee3b3d4b": "OrderAlreadyFilled",
  "0xc5ec2f3b": "AccountingMismatch",
  "0x40db5c93": "OrderNotEligibleForAdminCancel",
  "0x08ff2059": "OnlyLimitOrder",
  "0x789bae35": "OrderNotFilled",
  "0x769d11e4": "InvalidDeadline",
  "0x86ec3378": "OrderCreationDisabled",
};
