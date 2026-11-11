import { Contract, Interface, verifyTypedData, type Provider } from "ethers";
import type { LimitOrderConfigResponse, LimitOrderRecord } from "./types.js";
import type {
  GaslessDeployment,
  GaslessOrder,
  GaslessRoute,
} from "./gasless-types.js";
import {
  GASLESS_OPERATOR_ROLE,
  GASLESS_SWITCH_ABI,
  GaslessError,
  gaslessAddress,
  gaslessUint,
  getGaslessSigningParams,
  readGaslessChainState,
  sameAddress,
  validateGaslessConfig,
} from "./gasless.js";

/** Never infer gasless from a symbol, short deadline, orderType label, or legacy array. */
export function classifySwitchOrder(
  order: Pick<LimitOrderRecord, "limitOrderContract">,
  config: LimitOrderConfigResponse,
  deployment: GaslessDeployment,
): "gasless" | "limit-order" | "unsupported" {
  validateGaslessConfig(config, deployment);
  if (sameAddress(order.limitOrderContract, deployment.contract))
    return "gasless";
  if (sameAddress(order.limitOrderContract, config.limitOrderContract))
    return "limit-order";
  return "unsupported";
}

export function selectGaslessPriorityOrders(
  orders: readonly LimitOrderRecord[],
  config: LimitOrderConfigResponse,
  deployment: GaslessDeployment,
  chainTimestamp: number,
): LimitOrderRecord[] {
  if (!Number.isSafeInteger(chainTimestamp) || chainTimestamp <= 0)
    throw new GaslessError(
      "INVALID_TIMESTAMP",
      "A chain timestamp is required.",
    );
  const seen = new Set<string>();
  return orders
    .filter((order) => {
      const key = `${order.limitOrderContract?.toLowerCase()}:${order.maker.toLowerCase()}:${order.nonce}`;
      if (
        classifySwitchOrder(order, config, deployment) !== "gasless" ||
        order.status !== "ACTIVE" ||
        !Number.isSafeInteger(order.deadline) ||
        order.deadline <= chainTimestamp ||
        seen.has(key)
      )
        return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.deadline - b.deadline || a.nonce - b.nonce);
}

/** Gasless V2 fixes the excess side from the maker's signed fee mode. */
export function gaslessExcessOnInput(feeOnOutput: boolean): boolean {
  if (typeof feeOnOutput !== "boolean")
    throw new GaslessError(
      "INVALID_FEE_MODE",
      "The signed fee mode is required.",
    );
  return !feeOnOutput;
}

/** Nominal cap before payout transfer tax. Gas is part of this payout, never an add-on. */
export function cappedGaslessPayout(
  availableSurplus: bigint,
  afterFeeBase: bigint,
): bigint {
  if (afterFeeBase <= 0n || availableSurplus <= 0n) return 0n;
  const cap = (afterFeeBase * 5n) / 10000n;
  return availableSurplus < cap ? availableSurplus : cap;
}

/** Use measured after-tax payout valued via an executable payout-token/native route. */
export function assessGaslessOperatorProfit(
  payoutNative: bigint,
  gasLimit: bigint,
  gasPrice: bigint,
  minimumNetNative = 0n,
) {
  if (
    payoutNative < 0n ||
    gasLimit <= 0n ||
    gasPrice <= 0n ||
    minimumNetNative < 0n
  )
    throw new GaslessError("INVALID_GAS", "Invalid payout or full gas budget.");
  const gasBudgetNative = gasLimit * gasPrice;
  const netNative = payoutNative - gasBudgetNative;
  return {
    eligible: netNative > 0n && netNative >= minimumNetNative,
    gasBudgetNative,
    netNative,
  };
}

export async function assertGaslessOperator(
  provider: Provider,
  deployment: GaslessDeployment,
  operator: string,
): Promise<void> {
  const state = await readGaslessChainState(provider, deployment);
  const c = new Contract(deployment.contract, GASLESS_SWITCH_ABI, provider);
  if (
    !(await c.hasRole(GASLESS_OPERATOR_ROLE, gaslessAddress(operator), {
      blockTag: state.blockNumber,
    }))
  )
    throw new GaslessError(
      "OPERATOR_NOT_APPROVED",
      "This operator is not registered on the gasless settlement contract.",
    );
}

/** Encode already-built execution routes. This does NOT quote, simulate, or establish profitability. */
export function encodeGaslessFill(input: {
  deployment: GaslessDeployment;
  order: GaslessOrder;
  signature: string;
  routes: readonly GaslessRoute[];
  /** Actual maker -> settlement balance delta, required for an input-fee fill. */
  receivedInput?: string;
  chainTimestamp: number;
}): { to: string; data: string; value: string } {
  const { deployment, order, signature, routes } = input;
  if (
    !Number.isSafeInteger(order.nonce) ||
    order.nonce < 0 ||
    !Number.isSafeInteger(order.deadline) ||
    !Number.isSafeInteger(input.chainTimestamp) ||
    order.deadline <= input.chainTimestamp ||
    order.deadline === 0 ||
    typeof order.unwrapOutput !== "boolean" ||
    (order.unwrapOutput &&
      !sameAddress(order.tokenOut, deployment.wrappedNative))
  )
    throw new GaslessError(
      "INVALID_ORDER",
      "Invalid or expired gasless order.",
    );
  [order.maker, order.tokenIn, order.tokenOut, order.recipient].forEach((a) =>
    gaslessAddress(a),
  );
  gaslessAddress(order.partnerAddress, true);
  gaslessUint(order.minAmountOut);
  if (
    sameAddress(order.tokenIn, order.tokenOut) ||
    sameAddress(order.recipient, deployment.contract)
  )
    throw new GaslessError(
      "INVALID_ORDER",
      "Invalid gasless token pair or recipient.",
    );
  const { domain, types } = getGaslessSigningParams(deployment);
  if (
    !sameAddress(verifyTypedData(domain, types, order, signature), order.maker)
  )
    throw new GaslessError(
      "INVALID_SIGNATURE",
      "Gasless signature does not match the maker.",
    );
  let total = 0n;
  if (!routes.length || routes.length > 16)
    throw new GaslessError("INVALID_ROUTE", "Execution routes are required.");
  for (const route of routes) {
    const amount = gaslessUint(String(route.amountIn));
    total += amount;
    if (
      !route.hops.length ||
      route.hops.length > 8 ||
      !sameAddress(route.hops[0].tokenIn, order.tokenIn) ||
      !sameAddress(route.hops[route.hops.length - 1].tokenOut, order.tokenOut)
    )
      throw new GaslessError(
        "INVALID_ROUTE",
        "Route endpoints do not match the order.",
      );
    let previous = order.tokenIn;
    for (const hop of route.hops) {
      if (!sameAddress(hop.tokenIn, previous) || !hop.legs.length)
        throw new GaslessError(
          "INVALID_ROUTE",
          "Disconnected execution route.",
        );
      previous = gaslessAddress(hop.tokenOut);
      for (const leg of hop.legs) {
        gaslessAddress(leg.adapter);
        gaslessUint(String(leg.amountIn));
      }
    }
  }
  const amountIn = gaslessUint(order.amountIn);
  if (order.feeOnOutput) {
    if (total !== amountIn)
      throw new GaslessError(
        "INVALID_ROUTE",
        "Output-fee gasless orders route the full signed input.",
      );
  } else {
    const received = gaslessUint(input.receivedInput);
    const available = received - (received * 10n) / 10000n;
    if (received > amountIn || total > available)
      throw new GaslessError(
        "INVALID_ROUTE",
        "Input-fee routes exceed the measured after-fee input.",
      );
  }
  return {
    to: deployment.contract,
    data: new Interface(GASLESS_SWITCH_ABI).encodeFunctionData("fillOrder", [
      order,
      signature,
      routes,
      gaslessExcessOnInput(order.feeOnOutput),
    ]),
    value: "0",
  };
}
