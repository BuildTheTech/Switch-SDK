import { Contract, type Provider } from "ethers";
import {
  GASLESS_SWITCH_ABI,
  assertGaslessOperator,
  assessGaslessOperatorProfit,
  encodeGaslessFill,
  gaslessGasBudget,
  type GaslessDeployment,
  type GaslessOrder,
  type GaslessRoute,
} from "../src/gasless-index.js";

/** Validate an execution proposal from your routing engine. Does not broadcast. */
export async function checkGaslessExecution(input: {
  provider: Provider;
  deployment: GaslessDeployment;
  operator: string;
  order: GaslessOrder;
  signature: string;
  routes: GaslessRoute[];
  receivedInput?: string;
  quoteGasPriceWei: bigint;
  /** Obtained by tracing the exact fill: actual after-tax payout converted to native. */
  valueActualPayoutNative(call: {
    to: string;
    data: string;
    value: string;
    from: string;
    gasPrice: bigint;
  }): Promise<bigint>;
}) {
  await assertGaslessOperator(input.provider, input.deployment, input.operator);
  const block = await input.provider.getBlock("latest");
  if (!block) throw Error("Current chain block unavailable");
  const call = encodeGaslessFill({ ...input, chainTimestamp: block.timestamp });
  const settlement = new Contract(
    input.deployment.contract,
    GASLESS_SWITCH_ABI,
    input.provider,
  );
  // Necessary signature/balance/nonce checks, not a profitability assertion.
  if (!(await settlement.canFillOrder(input.order, input.signature)))
    return {
      eligible: false as const,
      reason: "Order is not currently fillable",
    };
  const rawPrice = (await input.provider.getFeeData()).gasPrice;
  if (!rawPrice) throw Error("Current gas price unavailable");
  const initial = gaslessGasBudget(1n, rawPrice, input.quoteGasPriceWei);
  const transaction = {
    ...call,
    from: input.operator,
    gasPrice: initial.gasPrice,
  };
  const estimate = await input.provider.estimateGas(transaction);
  const budget = gaslessGasBudget(estimate, rawPrice, input.quoteGasPriceWei);
  const measuredPayout = await input.valueActualPayoutNative(transaction);
  const profit = assessGaslessOperatorProfit(
    measuredPayout,
    budget.gasLimit,
    budget.gasPrice,
  );
  // Operators can reserve further headroom, but never increase the contract cap.
  if (!profit.eligible || measuredPayout <= budget.gasBudgetNative)
    return {
      eligible: false as const,
      reason: "Payout does not cover padded gas",
    };
  await input.provider.call({ ...transaction, gasLimit: budget.gasLimit });
  // Recheck deadline/nonce/role/gas immediately before using this proposal; serialize wallet nonces.
  return {
    eligible: true as const,
    transaction: { ...transaction, gasLimit: budget.gasLimit },
    profit,
  };
}
