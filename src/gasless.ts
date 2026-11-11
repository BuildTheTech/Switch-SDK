import {
  Contract,
  Interface,
  TypedDataEncoder,
  ZeroAddress,
  getAddress,
  id,
  keccak256,
  type Provider,
} from "ethers";
import {
  LIMIT_ORDER_EIP712_TYPES,
  NATIVE_PLS,
  SWITCH_ROUTER,
  WPLS,
  GO_SWITCH_ABI,
} from "./constants.js";
import {
  ROBINHOOD_CHAIN,
  ROBINHOOD_SWITCH_CONTRACTS,
  ROBINHOOD_TOKENS,
  selectRobinhoodFeeOnOutput,
} from "./networks/robinhood.js";
import type { LimitOrderConfigResponse } from "./types.js";
import type { LimitOrderNetwork } from "./limit-orders.js";
import type {
  GaslessChainState,
  GaslessDeployment,
  GaslessEligibility,
  GaslessOrder,
  GaslessQuoteDecision,
  GaslessQuoteResponse,
  GaslessTaxInfo,
  GaslessTrade,
  PreparedGaslessSwap,
} from "./gasless-types.js";

export * from "./gasless-types.js";

/** Fixed on-chain gasless protocol fee: 10 bps (0.1%), not an integration setting.
 * Integrations that do not want this fee policy should offer regular swaps only. */
export const GASLESS_PROTOCOL_FEE_BPS = 10;
export const GASLESS_MAX_OPERATOR_PAYOUT_BPS = 5;
export const GASLESS_ORDER_LIFETIME_SECONDS = 180;
export const GASLESS_QUOTE_MAX_AGE_MS = 30_000;
export const GASLESS_MAX_SLIPPAGE_BPS = 100;
export const GASLESS_GAS_PRICE_BOOST_BPS = 13_000;
export const GASLESS_GAS_LIMIT_BPS = 13_000;
export const GASLESS_GAS_HEADROOM_BPS = 11_000;
export const GASLESS_ORDER_TYPES = LIMIT_ORDER_EIP712_TYPES;
export const GASLESS_ORDER_TUPLE =
  "(address maker,address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 deadline,uint256 nonce,bool feeOnOutput,address recipient,bool unwrapOutput,address partnerAddress)";
export const GASLESS_ROUTES_TUPLE =
  "(uint256 amountIn,(address tokenIn,address tokenOut,(address adapter,uint256 amountIn,uint24 fee,bytes data)[] legs)[] hops)[]";
/** V2 only: fillOrder returns maker output, nominal payout, and the realized cap base. */
export const GASLESS_SWITCH_ABI = [
  "function settlementVersion() pure returns (uint256)",
  "function SWITCH_ROUTER() view returns (address)",
  "function WNATIVE() view returns (address)",
  "function getFee() pure returns (uint256)",
  "function MAX_OPERATOR_EXCESS_BPS() pure returns (uint256)",
  "function paused() view returns (bool)",
  "function operatorGateEnabled() pure returns (bool)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function domainSeparator() view returns (bytes32)",
  "function isNonceUsed(address maker,uint256 nonce) view returns (bool)",
  "function invalidateNonce(uint256 nonce)",
  "function invalidateNonces(uint256[] nonces)",
  `function canFillOrder(${GASLESS_ORDER_TUPLE} order,bytes signature) view returns (bool)`,
  `function fillOrder(${GASLESS_ORDER_TUPLE} order,bytes signature,${GASLESS_ROUTES_TUPLE} routes,bool excessOnInput) returns (uint256 makerOutput,uint256 operatorPayout,uint256 capBase)`,
  "event OrderFilled(address indexed maker,address indexed filler,uint256 indexed nonce,address tokenIn,address tokenOut,uint256 amountIn,uint256 makerAmountOut,uint256 fillerProfit,bool excessOnInput,address partnerAddress,bool directFill)",
  "event NonceCancelled(address indexed maker,uint256 indexed nonce)",
  "event GaslessFeePaid(address indexed maker,uint256 indexed nonce,address indexed token,uint256 nominalFee,uint256 protocolReceived,uint256 partnerReceived)",
  ...[
    "InvalidOrder",
    "InvalidSignature",
    "NonceAlreadyUsed",
    "OperatorOnly",
    "InvalidRoute",
    "InsufficientOutput",
    "UnsupportedToken",
    "TradingPaused",
    "RouterFeeNotExempt",
    "NativeTransferFailed",
  ].map((name) => `error ${name}()`),
] as const;

/** Pinned V2 deployments. A future migration requires an explicit trusted override. */
export const GASLESS_DEPLOYMENTS: Readonly<
  Record<LimitOrderNetwork, Readonly<GaslessDeployment>>
> = {
  pulsechain: {
    network: "pulsechain",
    chainId: 369,
    contract: "0xB5bd12E009D625d8b122d0Ff9EdeD8bA2cEdeaeB",
    router: SWITCH_ROUTER,
    wrappedNative: WPLS,
    explorer: "https://scan.pulsechain.com",
  },
  robinhood: {
    network: "robinhood",
    chainId: ROBINHOOD_CHAIN.id,
    contract: "0xc39cB531f71059fd427a63bF8a2f4b822D6B9b02",
    router: ROBINHOOD_SWITCH_CONTRACTS.router,
    wrappedNative: ROBINHOOD_TOKENS.WETH.address,
    explorer: ROBINHOOD_CHAIN.blockExplorerUrl,
  },
};

/** Historical V1 gasless addresses for indexing/cancellation, never new submissions. */
export const GASLESS_LEGACY_CONTRACTS: Readonly<
  Record<LimitOrderNetwork, readonly string[]>
> = {
  pulsechain: ["0xC28C70527740A85E98f7C8f800694f05c43814C5"],
  robinhood: ["0xC9daFAA2ef5482Eab0014fAc7c44E7F8C9005A3F"],
};

export class GaslessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "GaslessError";
  }
}

export const sameAddress = (a: unknown, b: string): boolean =>
  typeof a === "string" &&
  /^0x[\da-f]{40}$/i.test(a) &&
  a.toLowerCase() === b.toLowerCase();

export function gaslessUint(value: unknown, allowZero = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,77})$/.test(value))
    throw new GaslessError(
      "INVALID_INTEGER",
      "Expected a uint256 decimal string.",
    );
  const n = BigInt(value);
  if (n >= 1n << 256n || (!allowZero && n === 0n))
    throw new GaslessError(
      "INVALID_INTEGER",
      "Amount is outside the supported uint256 range.",
    );
  return n;
}

export function gaslessAddress(value: string, allowZero = false): string {
  // Reject invalid mixed-case checksums and implicit name resolution.
  if (
    typeof value !== "string" ||
    !/^0x[\da-f]{40}$/i.test(value) ||
    (!allowZero && sameAddress(value, ZeroAddress))
  )
    throw new GaslessError(
      "INVALID_ADDRESS",
      "Expected an explicit nonzero address.",
    );
  try {
    return getAddress(value);
  } catch {
    throw new GaslessError("INVALID_ADDRESS", "Address checksum is invalid.");
  }
}

export function normalizeGaslessTrade(
  trade: GaslessTrade,
): Required<GaslessTrade> {
  const result = {
    maker: gaslessAddress(trade.maker),
    tokenIn: gaslessAddress(trade.tokenIn),
    tokenOut: gaslessAddress(trade.tokenOut),
    amountIn: gaslessUint(trade.amountIn).toString(),
    recipient: gaslessAddress(trade.recipient ?? trade.maker),
    partnerAddress: gaslessAddress(trade.partnerAddress ?? ZeroAddress, true),
    slippageBps: trade.slippageBps ?? 50,
  };
  if (
    !Number.isInteger(result.slippageBps) ||
    result.slippageBps < 0 ||
    result.slippageBps > GASLESS_MAX_SLIPPAGE_BPS
  )
    throw new GaslessError(
      "INVALID_SLIPPAGE",
      "Gasless supports 0–100 bps of price slippage.",
    );
  if (sameAddress(result.tokenIn, result.tokenOut))
    throw new GaslessError("SAME_TOKEN", "Select two different tokens.");
  return result;
}

export function getGaslessSigningParams(deployment: GaslessDeployment) {
  return {
    domain: {
      name: "GaslessSwitch",
      version: "2",
      chainId: deployment.chainId,
      verifyingContract: gaslessAddress(deployment.contract),
    },
    // Mutable arrays are accepted by ethers v6 and v5 signTypedData implementations.
    types: {
      LimitOrder: GASLESS_ORDER_TYPES.LimitOrder.map((field) => ({ ...field })),
    },
  };
}

export function validateGaslessConfig(
  config: LimitOrderConfigResponse,
  deployment: GaslessDeployment,
): void {
  const domain = config.gaslessEip712Domain;
  if (
    !sameAddress(config.gaslessContract, deployment.contract) ||
    !sameAddress(config.gaslessApprovalSpender, deployment.contract) ||
    !sameAddress(config.limitOrderRouter, deployment.router) ||
    config.gaslessSettlementVersion !== 2 ||
    config.gaslessTaxTokensSupported !== true ||
    config.gaslessProtocolFeeBps !== 10 ||
    config.gaslessMaxOperatorPayoutBps !== 5 ||
    domain?.name !== "GaslessSwitch" ||
    domain.version !== "2" ||
    domain.chainId !== deployment.chainId ||
    !sameAddress(domain.verifyingContract, deployment.contract) ||
    !config.orderSubmissionLimitOrderContracts?.some((address) =>
      sameAddress(address, deployment.contract),
    )
  ) {
    throw new GaslessError(
      "CONFIGURATION_CHANGED",
      "Gasless deployment or fee policy changed. Use Regular until the integration is updated.",
    );
  }
}

const PULSE_FEE_PRIORITY = new Map([
  [WPLS.toLowerCase(), 1],
  [NATIVE_PLS.toLowerCase(), 1],
  ["0xefd766ccb38eaf1dfd701853bfce31359239f305", 2],
  ["0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07", 2],
  ["0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f", 2],
  ["0x95b303987a60c71504d99aa1b13b4da07b0790ab", 3],
  ["0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c", 4],
  ["0xb17d901469b9208b17d916112988a3fed19b5ca1", 5],
  ["0x2b591e99afe9f32eaa6214f7b7629768c40eeb39", 6],
  ["0x57fde0a71132198bbec939b98976993d8d89d225", 7],
  ["0xf6f8db0aba00007681f8faf16a0fda1c9b030b11", 8],
]);

export function validateGaslessTaxInfo(tax: GaslessTaxInfo): void {
  if (
    !tax ||
    typeof tax.isTaxToken !== "boolean" ||
    ![tax.sellTaxBps, tax.buyTaxBps].every(
      (n) => Number.isInteger(n) && n >= 0 && n < 10000,
    ) ||
    (!tax.isTaxToken && (tax.sellTaxBps !== 0 || tax.buyTaxBps !== 0))
  )
    throw new GaslessError(
      "TAX_CHECK_UNAVAILABLE",
      "Reliable token tax information is unavailable.",
    );
}

/** Same directional tax rules and preferred fee tokens as the Switch frontend. */
export function selectGaslessFeeOnOutput(
  network: LimitOrderNetwork,
  tokenIn: string,
  tokenOut: string,
  inputTax: GaslessTaxInfo,
  outputTax: GaslessTaxInfo,
): boolean {
  validateGaslessTaxInfo(inputTax);
  validateGaslessTaxInfo(outputTax);
  if (network === "robinhood")
    return selectRobinhoodFeeOnOutput(tokenIn, tokenOut, inputTax, outputTax);
  if (outputTax.isTaxToken && outputTax.buyTaxBps > 0) return false;
  if (inputTax.isTaxToken && inputTax.sellTaxBps > 0) return true;
  const a = PULSE_FEE_PRIORITY.get(tokenIn.toLowerCase()) ?? Infinity;
  const b = PULSE_FEE_PRIORITY.get(tokenOut.toLowerCase()) ?? Infinity;
  return b < a || (a === b && a !== Infinity);
}

export const gaslessCeil = (n: bigint, denominator: bigint): bigint =>
  (n + denominator - 1n) / denominator;

/** gasPrice from the quote is already boosted: take the maximum, never boost it twice. */
export function gaslessGasBudget(
  estimate: bigint,
  rawGasPrice: bigint,
  quoteGasPrice: bigint,
) {
  if (estimate <= 0n || rawGasPrice <= 0n || quoteGasPrice <= 0n)
    throw new GaslessError("INVALID_GAS", "Positive gas inputs are required.");
  const gasLimit = gaslessCeil(estimate * 13000n, 10000n);
  const boosted = gaslessCeil(rawGasPrice * 13000n, 10000n);
  const gasPrice = boosted > quoteGasPrice ? boosted : quoteGasPrice;
  return {
    gasLimit,
    gasPrice,
    gasBudgetNative: gaslessCeil(gasLimit * gasPrice * 11000n, 10000n),
  };
}

/** Current contract state, not just an API-provided address or USD estimate. */
export async function readGaslessChainState(
  provider: Provider,
  deployment: GaslessDeployment,
  now = Date.now(),
): Promise<GaslessChainState> {
  const [network, block, prices] = await Promise.all([
    provider.getNetwork(),
    provider.getBlock("latest"),
    provider.getFeeData(),
  ]);
  if (network.chainId !== BigInt(deployment.chainId))
    throw new GaslessError(
      "WRONG_CHAIN",
      "RPC or wallet is on the wrong network.",
    );
  if (
    !block ||
    now / 1000 - block.timestamp > 90 ||
    block.timestamp > now / 1000 + 15 ||
    !prices.gasPrice ||
    prices.gasPrice <= 0n
  )
    throw new GaslessError(
      "STALE_CHAIN",
      "A recent block and current gas price are required.",
      true,
    );
  const c = new Contract(deployment.contract, GASLESS_SWITCH_ABI, provider);
  const router = new Contract(
    deployment.router,
    ["function FEE_EXEMPT(address) view returns (bool)"],
    provider,
  );
  const overrides = { blockTag: block.number };
  const [
    version,
    fee,
    cap,
    paused,
    boundRouter,
    wrapped,
    gate,
    domain,
    exempt,
  ] = await Promise.all([
    c.settlementVersion(overrides),
    c.getFee(overrides),
    c.MAX_OPERATOR_EXCESS_BPS(overrides),
    c.paused(overrides),
    c.SWITCH_ROUTER(overrides),
    c.WNATIVE(overrides),
    c.operatorGateEnabled(overrides),
    c.domainSeparator(overrides),
    router.FEE_EXEMPT(deployment.contract, overrides),
  ]);
  if (
    version !== 2n ||
    fee !== 10n ||
    cap !== 5n ||
    paused ||
    !gate ||
    !exempt ||
    !sameAddress(boundRouter, deployment.router) ||
    !sameAddress(wrapped, deployment.wrappedNative) ||
    domain.toLowerCase() !==
      TypedDataEncoder.hashDomain(
        getGaslessSigningParams(deployment).domain,
      ).toLowerCase()
  ) {
    throw new GaslessError(
      "CONFIGURATION_CHANGED",
      "Gasless is paused or its on-chain fee, domain, or router policy does not match.",
    );
  }
  return {
    checkedAt: now,
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    rawGasPriceWei: prices.gasPrice.toString(),
  };
}

const routerInterface = new Interface(GO_SWITCH_ABI);

/** Bind every execution check to the exact trade, route bytes, fee side, and chain. */
export function assessGaslessQuote(
  quote: GaslessQuoteResponse,
  tradeInput: GaslessTrade,
  deployment: GaslessDeployment,
  state: GaslessChainState,
  now = Date.now(),
): GaslessQuoteDecision {
  let eligibility: GaslessEligibility | undefined;
  const fail = (
    code: Extract<GaslessQuoteDecision, { eligible: false }>["code"],
    reason: string,
    retryable = false,
  ): GaslessQuoteDecision => ({
    eligible: false,
    code,
    reason,
    retryable,
    ...(eligibility ? { eligibility } : {}),
  });
  try {
    const trade = normalizeGaslessTrade(tradeInput);
    if (sameAddress(trade.tokenIn, NATIVE_PLS))
      return fail(
        "NATIVE_INPUT_REQUIRES_WRAP",
        "Wrap native currency first (wrapping requires gas), or use Regular.",
      );
    const nativeOut = sameAddress(trade.tokenOut, NATIVE_PLS);
    const tokenOut = nativeOut ? deployment.wrappedNative : trade.tokenOut;
    if (
      sameAddress(trade.tokenIn, tokenOut) ||
      sameAddress(trade.recipient, deployment.contract)
    )
      return fail("INVALID_PREVIEW", "Unsupported token pair or recipient.");
    const p = quote?.gaslessExecution;
    eligibility = quote?.gaslessEligibility ?? p?.eligibility;
    const summaries = [quote?.gaslessEligibility, p?.eligibility].filter(
      (summary): summary is GaslessEligibility => summary !== undefined,
    );
    for (const summary of summaries) {
      if (
        !summary ||
        summary.policyVersion !== 1 ||
        !["eligible", "ineligible", "unavailable", "not_checked"].includes(
          summary.status,
        ) ||
        typeof summary.eligible !== "boolean" ||
        summary.eligible !== (summary.status === "eligible") ||
        summary.recommendation !== (summary.eligible ? "gasless" : "regular") ||
        (summary.reasonCode === "READY") !== summary.eligible ||
        typeof summary.reason !== "string" ||
        !summary.reason.length ||
        summary.reason.length > 1000 ||
        summary.nativeSymbol !==
          (deployment.network === "pulsechain" ? "PLS" : "ETH") ||
        summary.protocolFeeBps !== 10 ||
        summary.maxOperatorPayoutBps !== 5 ||
        summary.requiredGasCoverageBps !== 20000 ||
        summary.payoutValuationHaircutBps !== 1000 ||
        summary.minimumSlippageBps !== 50 ||
        summary.operatorLivenessVerified !== false ||
        !Number.isSafeInteger(summary.checkedAt) ||
        summary.checkedAt <= 0 ||
        !Number.isSafeInteger(summary.expiresAt) ||
        summary.expiresAt <= summary.checkedAt ||
        summary.expiresAt > summary.checkedAt + GASLESS_QUOTE_MAX_AGE_MS
      )
        throw Error("Invalid server eligibility summary");
      if (summary.checkedAt > now || summary.expiresAt <= now)
        return fail(
          "STALE_QUOTE",
          "The server gasless eligibility check expired. Refresh before signing.",
          true,
        );
      if (
        eligibility &&
        [
          "status",
          "eligible",
          "recommendation",
          "reasonCode",
          "checkedAt",
          "expiresAt",
        ].some(
          (key) =>
            summary[key as keyof GaslessEligibility] !==
            eligibility![key as keyof GaslessEligibility],
        )
      )
        throw Error("Conflicting server eligibility summaries");
    }
    if (eligibility && !eligibility.eligible)
      return fail(
        "SERVER_INELIGIBLE",
        eligibility.reason,
        eligibility.status !== "ineligible" ||
          ["STALE_PREVIEW", "OPERATOR_GAS_UNAVAILABLE"].includes(
            eligibility.reasonCode,
          ),
      );
    if (!p || p.status !== "ready")
      return fail(
        "PREVIEW_UNAVAILABLE",
        p?.reason ||
          "Operator execution could not be verified. Retry or use Regular.",
        true,
      );
    if (
      !Number.isSafeInteger(now) ||
      now <= 0 ||
      !Number.isSafeInteger(state.blockNumber) ||
      state.blockNumber <= 0 ||
      !Number.isSafeInteger(state.blockTimestamp) ||
      state.blockTimestamp <= 0 ||
      !Number.isSafeInteger(p.checkedAt) ||
      p.checkedAt > now ||
      now - p.checkedAt > GASLESS_QUOTE_MAX_AGE_MS ||
      !Number.isSafeInteger(state.checkedAt) ||
      state.checkedAt > now ||
      now - state.checkedAt > GASLESS_QUOTE_MAX_AGE_MS ||
      now / 1000 - state.blockTimestamp > 90 ||
      state.blockTimestamp > now / 1000 + 15
    )
      return fail(
        "STALE_QUOTE",
        "The operator execution check expired. Refresh before signing.",
        true,
      );
    if (
      quote.protocolFeeBps !== 10 ||
      typeof quote.feeOnOutput !== "boolean" ||
      !sameAddress(quote.fromToken, trade.tokenIn) ||
      !(
        sameAddress(quote.toToken, tokenOut) ||
        (nativeOut && sameAddress(quote.toToken, NATIVE_PLS))
      ) ||
      quote.totalAmountIn !== trade.amountIn
    )
      throw Error("Quote does not match the trade");
    const tx = quote.selectedTx;
    if (
      !tx ||
      !sameAddress(tx.to, deployment.router) ||
      gaslessUint(tx.value, true) !== 0n ||
      typeof tx.data !== "string" ||
      tx.data.length > 200000
    )
      throw Error("Invalid router transaction");
    const decoded = routerInterface.decodeFunctionData("goSwitch", tx.data);
    if (
      !sameAddress(decoded[1], trade.recipient) ||
      BigInt(decoded[3]) !== 10n ||
      decoded[4] !== quote.feeOnOutput ||
      decoded[5] !== nativeOut ||
      !sameAddress(decoded[6], trade.partnerAddress)
    )
      throw Error("Router arguments do not match the trade");
    const routes = decoded[0];
    if (routes.length === 0 || routes.length > 16)
      throw Error("Invalid routes");
    let total = 0n,
      legs = 0;
    for (const route of routes) {
      if (
        route.amountIn <= 0n ||
        route.hops.length === 0 ||
        route.hops.length > 8 ||
        !sameAddress(route.hops[0].tokenIn, trade.tokenIn) ||
        !sameAddress(route.hops[route.hops.length - 1].tokenOut, tokenOut)
      )
        throw Error("Invalid route endpoints");
      total += route.amountIn;
      let previous = trade.tokenIn;
      for (const hop of route.hops) {
        if (!sameAddress(hop.tokenIn, previous) || !hop.legs.length)
          throw Error("Disconnected route");
        gaslessAddress(hop.tokenOut);
        previous = hop.tokenOut;
        for (const leg of hop.legs) {
          gaslessAddress(leg.adapter);
          if (leg.amountIn <= 0n) throw Error("Empty leg");
          legs++;
        }
      }
    }
    if (
      total.toString() !== trade.amountIn ||
      legs > 64 ||
      p.version !== 2 ||
      p.settlementVersion !== 2 ||
      p.chainId !== deployment.chainId ||
      !sameAddress(p.contract, deployment.contract) ||
      !sameAddress(p.maker, trade.maker) ||
      !sameAddress(p.tokenIn, trade.tokenIn) ||
      !sameAddress(p.tokenOut, tokenOut) ||
      p.amountIn !== trade.amountIn ||
      !sameAddress(p.recipient, trade.recipient) ||
      p.unwrapOutput !== nativeOut ||
      p.feeOnOutput !== quote.feeOnOutput ||
      p.excessOnInput !== !quote.feeOnOutput ||
      !sameAddress(
        p.payoutToken,
        quote.feeOnOutput ? tokenOut : trade.tokenIn,
      ) ||
      p.routeHash?.toLowerCase() !== keccak256(tx.data).toLowerCase() ||
      p.quoteBlockNumber !== quote.quoteBlockNumber ||
      !Number.isSafeInteger(p.quoteBlockNumber) ||
      p.quoteBlockNumber <= 0 ||
      p.quoteBlockNumber > state.blockNumber + 3 ||
      p.slippageBps !== trade.slippageBps ||
      p.gasPriceBoostBps !== 13000 ||
      p.gasLimitBps !== 13000 ||
      p.headroomBps !== 11000
    )
      throw Error("Settlement binding mismatch");
    const expected = gaslessUint(p.expectedOutputAmount),
      received = gaslessUint(p.recipientAmountOut);
    const minimum = (expected * BigInt(10000 - trade.slippageBps)) / 10000n;
    const payout = gaslessUint(p.operatorPayout),
      nominal = gaslessUint(p.nominalOperatorPayout),
      capBase = gaslessUint(p.payoutCapBase);
    const nativePayout = gaslessUint(p.operatorPayoutNative),
      limit = gaslessUint(p.gasLimit),
      price = gaslessUint(p.gasPriceWei),
      budget = gaslessUint(p.gasBudgetNative);
    const estimate = gaslessUint(p.estimatedGas),
      raw = gaslessUint(state.rawGasPriceWei),
      quotePrice = gaslessUint(quote.quoteGasPrice);
    if (
      minimum <= 0n ||
      p.minAmountOut !== minimum.toString() ||
      received < minimum ||
      payout > nominal ||
      nominal > (capBase * 5n) / 10000n ||
      limit < gaslessCeil(estimate * 13000n, 10000n) ||
      limit > 20000000n ||
      budget < gaslessCeil(limit * price * 11000n, 10000n)
    )
      throw Error("Settlement accounting mismatch");
    const boosted = gaslessCeil(raw * 13000n, 10000n);
    const gasPrice = [price, quotePrice, boosted].reduce((a, b) =>
      a > b ? a : b,
    );
    const freshBudget = gaslessCeil(limit * gasPrice * 11000n, 10000n);
    const gasBudget = freshBudget > budget ? freshBudget : budget;
    for (const summary of summaries) {
      const economics = summary.economics,
        operator = summary.operator;
      if (
        summary.checkedAt !== p.checkedAt ||
        p.eligible !== true ||
        trade.slippageBps < summary.minimumSlippageBps ||
        !economics ||
        !operator ||
        operator.gasAvailable !== true ||
        economics.gasCovered !== true ||
        economics.safetyMarginCovered !== true ||
        economics.operatorPayoutNativeWei !== p.operatorPayoutNative ||
        economics.estimatedGasUnits !== p.estimatedGas ||
        economics.gasLimit !== p.gasLimit ||
        economics.gasPriceWei !== p.gasPriceWei ||
        economics.gasBudgetNativeWei !== p.gasBudgetNative ||
        gaslessUint(economics.conservativeGasBudgetNativeWei) !== budget * 2n ||
        gaslessUint(economics.stressedOperatorPayoutNativeWei) !==
          (nativePayout * 9000n) / 10000n
      )
        throw Error(
          "Eligibility economics do not match the settlement preview",
        );
      gaslessAddress(operator.address);
      // Preserve the server's safety margin if gas rose while the quote was being fetched.
      const reserve = gasBudget * 2n;
      if (gaslessUint(operator.nativeBalanceWei, true) < reserve)
        return fail(
          "INSUFFICIENT_OPERATOR_PAYOUT",
          "The checked operator's gas funds no longer cover the conservative reserve. Refresh or use Regular.",
          true,
        );
      if ((nativePayout * 9000n) / 10000n <= reserve)
        return fail(
          "INSUFFICIENT_OPERATOR_PAYOUT",
          "The 0.05% payout no longer covers the server's conservative reserve at the current gas price. Refresh or use Regular.",
          true,
        );
    }
    if (p.eligible !== true || nativePayout <= gasBudget)
      return fail(
        "INSUFFICIENT_OPERATOR_PAYOUT",
        p.reason ||
          "The 0.05% total operator payout does not cover the padded gas budget and leave a positive incentive. Use Regular.",
      );
    return {
      eligible: true,
      ...(eligibility ? { eligibility } : {}),
      prepared: {
        deployment,
        trade,
        quote,
        preview: p,
        feeOnOutput: quote.feeOnOutput,
        expectedOutput: received.toString(),
        minAmountOut: minimum.toString(),
        payoutToken: p.payoutToken,
        operatorPayout: payout.toString(),
        gasPriceWei: gasPrice.toString(),
        gasLimit: limit.toString(),
        gasBudgetNative: gasBudget.toString(),
        chainState: state,
      },
    };
  } catch {
    return fail(
      "INVALID_PREVIEW",
      "The quote and operator execution check do not match this swap. Refresh or use Regular.",
      true,
    );
  }
}

/** Random 48-bit nonce stays exact in the hosted API's safe-integer database. */
export function createGaslessNonce(): number {
  return globalThis.crypto
    .getRandomValues(new Uint8Array(6))
    .reduce((n, byte) => n * 256 + byte, 0);
}

export function buildGaslessOrder(
  prepared: PreparedGaslessSwap,
  options: { nonce?: number; now?: number } = {},
): GaslessOrder {
  const now = options.now ?? Date.now();
  const decision = assessGaslessQuote(
    prepared.quote,
    prepared.trade,
    prepared.deployment,
    prepared.chainState,
    now,
  );
  if (!decision.eligible)
    throw new GaslessError(decision.code, decision.reason, decision.retryable);
  const nonce = options.nonce ?? createGaslessNonce();
  if (!Number.isSafeInteger(nonce) || nonce < 0)
    throw new GaslessError(
      "INVALID_NONCE",
      "Nonce must be a nonnegative safe integer.",
    );
  const t = decision.prepared.trade;
  return {
    maker: t.maker,
    tokenIn: t.tokenIn,
    tokenOut: sameAddress(t.tokenOut, NATIVE_PLS)
      ? prepared.deployment.wrappedNative
      : t.tokenOut,
    amountIn: t.amountIn,
    minAmountOut: decision.prepared.minAmountOut,
    deadline:
      Math.min(Math.floor(now / 1000), prepared.chainState.blockTimestamp) +
      GASLESS_ORDER_LIFETIME_SECONDS,
    nonce,
    feeOnOutput: decision.prepared.feeOnOutput,
    recipient: t.recipient,
    unwrapOutput: sameAddress(t.tokenOut, NATIVE_PLS),
    partnerAddress: t.partnerAddress,
  };
}

export const GASLESS_OPERATOR_ROLE = id("OPERATOR_ROLE");
