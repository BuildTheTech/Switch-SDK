import {
  Interface,
  MaxUint256,
  TypedDataEncoder,
  Wallet,
  ZeroAddress,
  keccak256,
} from "ethers";
import { ERC20_ABI, GO_SWITCH_ABI, NATIVE_PLS } from "../dist/constants.js";
import {
  GASLESS_DEPLOYMENTS,
  GASLESS_SWITCH_ABI,
  gaslessGasBudget,
  getGaslessSigningParams,
} from "../dist/gasless.js";

// Public test key. These tests use it only offline and never fund it or contact a chain.
export const wallet = new Wallet(`0x${"11".repeat(32)}`);
export const HEX = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
export const USDC = "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07";
export const d = GASLESS_DEPLOYMENTS.pulsechain;
export const noTax = { isTaxToken: false, sellTaxBps: 0, buyTaxBps: 0 };
export const router = new Interface(GO_SWITCH_ABI);
export const settlement = new Interface(GASLESS_SWITCH_ABI);
export const token = new Interface(ERC20_ABI);
const feeExemption = new Interface([
  "function FEE_EXEMPT(address) view returns (bool)",
]);

export function config(deployment = d) {
  return {
    limitOrderContract:
      deployment.network === "pulsechain"
        ? "0x2afBf0aB8d958a0227742F7a8BdA00c96372E4D7"
        : "0x1E05115387f314398bbb1A808B25308E71150396",
    limitOrderRouter: deployment.router,
    gaslessContract: deployment.contract,
    gaslessApprovalSpender: deployment.contract,
    gaslessSettlementVersion: 2,
    gaslessTaxTokensSupported: true,
    gaslessProtocolFeeBps: 10,
    gaslessMaxOperatorPayoutBps: 5,
    gaslessEip712Domain: getGaslessSigningParams(deployment).domain,
    orderSubmissionLimitOrderContracts: [deployment.contract],
    allLimitOrderContracts: [
      deployment.contract,
      "0xc28c70527740a85e98f7c8f800694f05c43814c5",
    ],
    allPlsFlowContracts: [],
    limitOrderContractVersions: {},
    plsFlowContractVersions: {},
    plsFlowContract: null,
  };
}

export function fixture(options = {}) {
  const deployment = options.deployment ?? d;
  const now = Date.now();
  const trade = {
    maker: wallet.address,
    tokenIn: USDC,
    tokenOut: HEX,
    amountIn: "1000000000",
    slippageBps: 50,
    recipient: wallet.address,
    partnerAddress: ZeroAddress,
    ...options.trade,
  };
  const feeOnOutput = options.feeOnOutput ?? false;
  const native = trade.tokenOut.toLowerCase() === NATIVE_PLS.toLowerCase();
  const out = native ? deployment.wrappedNative : trade.tokenOut;
  const routes = [
    {
      amountIn: trade.amountIn,
      hops: [
        {
          tokenIn: trade.tokenIn,
          tokenOut: out,
          legs: [
            {
              adapter: "0x393e382520b93b8f662dc76295000930c06d689f",
              amountIn: trade.amountIn,
              fee: 0,
              data: "0x",
            },
          ],
        },
      ],
    },
  ];
  const data = router.encodeFunctionData("goSwitch", [
    routes,
    trade.recipient,
    "1",
    10,
    feeOnOutput,
    native,
    trade.partnerAddress,
  ]);
  const budget = gaslessGasBudget(500000n, 1000000000n, 1300000000n);
  const expected = 1000000000000000000000n;
  const capBase = feeOnOutput ? expected + 1000000000000000000n : 999000000n;
  const payout = (capBase * 5n) / 10000n;
  const p = {
    status: "ready",
    version: 2,
    settlementVersion: 2,
    maker: trade.maker,
    chainId: deployment.chainId,
    contract: deployment.contract,
    tokenIn: trade.tokenIn,
    tokenOut: out,
    amountIn: trade.amountIn,
    recipient: trade.recipient,
    unwrapOutput: native,
    feeOnOutput,
    excessOnInput: !feeOnOutput,
    payoutToken: feeOnOutput ? out : trade.tokenIn,
    routeHash: keccak256(data),
    quoteBlockNumber: 100,
    checkedAt: now,
    slippageBps: trade.slippageBps,
    expectedOutputAmount: expected.toString(),
    minAmountOut: (
      (expected * BigInt(10000 - trade.slippageBps)) /
      10000n
    ).toString(),
    recipientAmountOut: expected.toString(),
    operatorPayout: payout.toString(),
    nominalOperatorPayout: payout.toString(),
    payoutCapBase: capBase.toString(),
    operatorPayoutNative: "1000000000000000000",
    estimatedGas: "500000",
    gasLimit: budget.gasLimit.toString(),
    gasPriceWei: budget.gasPrice.toString(),
    gasBudgetNative: budget.gasBudgetNative.toString(),
    gasPriceBoostBps: 13000,
    gasLimitBps: 13000,
    headroomBps: 11000,
    eligible: true,
  };
  const quote = {
    fromToken: trade.tokenIn,
    toToken: trade.tokenOut,
    receiver: trade.recipient,
    totalAmountIn: trade.amountIn,
    totalAmountOut: (expected + 2n).toString(),
    expectedOutputAmount: (expected + 1n).toString(),
    minAmountOut: "1",
    protocolFeeBps: 10,
    feeOnOutput,
    quoteGasPrice: "1300000000",
    quoteBlockNumber: 100,
    selectedTx: { to: deployment.router, value: "0", data },
    paths: [],
    effectiveSlippageBps: 50,
    effectiveSlippagePercent: "0.5",
    gaslessExecution: p,
  };
  const state = {
    checkedAt: now,
    blockNumber: 101,
    blockTimestamp: Math.floor(now / 1000),
    rawGasPriceWei: "1000000000",
  };
  return { now, deployment, trade, routes, quote, p, state };
}

export function fakeProvider(options = {}) {
  const deployment = options.deployment ?? d;
  const calls = [];
  const provider = {
    calls,
    async getNetwork() {
      return { chainId: BigInt(options.chainId ?? deployment.chainId) };
    },
    async getBlock() {
      return {
        number: 101,
        timestamp: options.blockTimestamp ?? Math.floor(Date.now() / 1000),
      };
    },
    async getFeeData() {
      return { gasPrice: options.rawGasPrice ?? 1000000000n };
    },
    async estimateGas(request) {
      calls.push({ estimate: request });
      return 50000n;
    },
    async call(request) {
      calls.push(request);
      const to = String(request.to).toLowerCase();
      const abi =
        to === deployment.contract.toLowerCase()
          ? settlement
          : to === deployment.router.toLowerCase()
            ? feeExemption
            : token;
      const parsed = abi.parseTransaction({ data: request.data });
      const values = {
        settlementVersion: 2n,
        getFee: options.fee ?? 10n,
        MAX_OPERATOR_EXCESS_BPS: options.cap ?? 5n,
        paused: options.paused ?? false,
        SWITCH_ROUTER: options.router ?? deployment.router,
        WNATIVE: deployment.wrappedNative,
        operatorGateEnabled: true,
        domainSeparator: TypedDataEncoder.hashDomain(
          getGaslessSigningParams(deployment).domain,
        ),
        FEE_EXEMPT: options.exempt ?? true,
        hasRole: options.approvedOperator ?? true,
        balanceOf: options.balance ?? MaxUint256,
        allowance: options.allowance ?? MaxUint256,
        isNonceUsed: false,
      };
      if (!(parsed.name in values))
        throw Error(`Unexpected fake call ${parsed.name}`);
      return abi.encodeFunctionResult(parsed.name, [values[parsed.name]]);
    },
  };
  return provider;
}

export function memoryStore() {
  let pending = null;
  return {
    async load() {
      return pending && structuredClone(pending);
    },
    async reserve(p) {
      if (pending) throw Error("pending");
      pending = structuredClone(p);
    },
    async update(p) {
      if (!pending || pending.order.nonce !== p.order.nonce)
        throw Error("changed");
      pending = structuredClone(p);
    },
    async release(p) {
      if (pending?.order.nonce === p.order.nonce) pending = null;
    },
  };
}

export function recordFor(pending, overrides = {}) {
  return {
    ...pending.order,
    limitOrderContract: pending.contract,
    signature: pending.signature,
    status: "ACTIVE",
    ...overrides,
  };
}

export function fakeApi(f = fixture(), behavior = {}) {
  const requests = [];
  let record = null;
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(url, "https://integration.test");
    requests.push({ url: parsed, ...init });
    let body;
    if (parsed.pathname.endsWith("/config"))
      body = behavior.config ?? config(f.deployment);
    else if (parsed.pathname.endsWith("/checkTax")) body = noTax;
    else if (parsed.pathname.endsWith("/quote")) {
      body = behavior.quote ? behavior.quote(f) : structuredClone(f.quote);
      body.gaslessExecution.checkedAt = Date.now();
      for (const summary of [
        body.gaslessEligibility,
        body.gaslessExecution.eligibility,
      ]) {
        if (summary) {
          summary.checkedAt = body.gaslessExecution.checkedAt;
          summary.expiresAt = summary.checkedAt + 30000;
        }
      }
    } else if (init.method === "POST") {
      const payload = JSON.parse(init.body);
      record = { ...payload, status: "ACTIVE" };
      if (behavior.afterAccept)
        throw Error("Transport lost after API accepted order");
      body = { success: true, order: record };
    } else body = behavior.record ?? record ?? { error: "Order not found" };
    return Response.json(body);
  };
  return {
    requests,
    fetcher,
    get record() {
      return record;
    },
  };
}

export function fakeSigner(provider, overrides = {}) {
  return {
    provider,
    async getAddress() {
      return wallet.address;
    },
    async signTypedData(domain, types, order) {
      return wallet.signTypedData(domain, types, order);
    },
    ...overrides,
  };
}
