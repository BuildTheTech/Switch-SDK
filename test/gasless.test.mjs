import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  Interface,
  MaxUint256,
  TypedDataEncoder,
  ZeroAddress,
  verifyTypedData,
} from "ethers";
import {
  GASLESS_DEPLOYMENTS,
  GASLESS_SWITCH_ABI,
  assessGaslessQuote,
  buildGaslessOrder,
  createGaslessNonce,
  gaslessAddress,
  gaslessGasBudget,
  gaslessUint,
  getGaslessSigningParams,
  readGaslessChainState,
  selectGaslessFeeOnOutput,
  validateGaslessConfig,
} from "../dist/gasless.js";
import {
  GaslessSwapClient,
  GaslessSubmissionError,
} from "../dist/gasless-client.js";
import {
  createGaslessBrowserStore,
  parseGaslessPending,
} from "../dist/gasless-store.js";
import {
  assessGaslessOperatorProfit,
  cappedGaslessPayout,
  classifySwitchOrder,
  encodeGaslessFill,
  gaslessExcessOnInput,
  selectGaslessPriorityOrders,
} from "../dist/gasless-operators.js";
import { NATIVE_PLS } from "../dist/constants.js";
import { getEIP712SigningParams } from "../dist/limit-orders.js";
import {
  config,
  d,
  fakeApi,
  fakeProvider,
  fakeSigner,
  fixture,
  HEX,
  memoryStore,
  noTax,
  recordFor,
  router,
  token,
  USDC,
  wallet,
} from "./helpers.mjs";

test("recipient checksum typos fail before approval or signing", () => {
  const bad = wallet.address.replace(/[a-fA-F]/, (letter) =>
    letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase(),
  );
  assert.equal(gaslessAddress(wallet.address.toLowerCase()), wallet.address);
  assert.throws(() => gaslessAddress(bad), { code: "INVALID_ADDRESS" });
  assert.throws(() => gaslessAddress("recipient.eth"), { code: "INVALID_ADDRESS" });
});

test("both pinned deployments use a separate V2 domain", async () => {
  const f = fixture();
  const p = assessGaslessQuote(f.quote, f.trade, d, f.state, f.now);
  assert.equal(p.eligible, true);
  const order = buildGaslessOrder(p.prepared, { nonce: 12, now: f.now });
  for (const deployment of Object.values(GASLESS_DEPLOYMENTS)) {
    validateGaslessConfig(config(deployment), deployment);
    assert.throws(
      () => getEIP712SigningParams(deployment.contract),
      /dedicated signing domain/,
    );
    const { domain, types } = getGaslessSigningParams(deployment);
    const sig = await wallet.signTypedData(domain, types, order);
    assert.equal(verifyTypedData(domain, types, order, sig), wallet.address);
    assert.notEqual(
      TypedDataEncoder.hash(domain, types, order),
      TypedDataEncoder.hash(
        { ...domain, name: "SwitchLimitOrder" },
        types,
        order,
      ),
    );
  }
});

test("API outage releases a lock only after the chain has passed its signed deadline", async () => {
  const f = fixture();
  const order = buildGaslessOrder(
    assessGaslessQuote(f.quote, f.trade, d, f.state).prepared,
  );
  const store = memoryStore();
  await store.reserve({
    network: "pulsechain",
    chainId: 369,
    contract: d.contract,
    order,
    state: "signing",
  });
  const offline = async () => {
    throw Error("API offline");
  };
  const active = new GaslessSwapClient({
    network: "pulsechain",
    provider: fakeProvider(),
    fetch: offline,
  });
  await assert.rejects(() => active.reconcile(store));
  assert.ok(await store.load());
  const closed = new GaslessSwapClient({
    network: "pulsechain",
    provider: fakeProvider({ blockTimestamp: order.deadline + 1 }),
    fetch: offline,
  });
  assert.equal((await closed.reconcile(store)).status, "closed");
  assert.equal(await store.load(), null);
});

for (const [key, value] of [
  ["gaslessContract", config().limitOrderContract],
  ["gaslessSettlementVersion", 1],
  ["gaslessProtocolFeeBps", 30],
  ["gaslessMaxOperatorPayoutBps", 50],
  ["gaslessApprovalSpender", d.router],
  ["orderSubmissionLimitOrderContracts", []],
]) {
  test(`reject configuration drift in ${key}`, () =>
    assert.throws(() =>
      validateGaslessConfig({ ...config(), [key]: value }, d),
    ));
}

test("fee selection follows directional taxes, then frontend token priority", () => {
  const sellTax = { isTaxToken: true, sellTaxBps: 500, buyTaxBps: 0 };
  const buyTax = { isTaxToken: true, sellTaxBps: 0, buyTaxBps: 500 };
  assert.equal(
    selectGaslessFeeOnOutput("pulsechain", HEX, USDC, noTax, noTax),
    true,
  );
  assert.equal(
    selectGaslessFeeOnOutput("pulsechain", USDC, HEX, noTax, noTax),
    false,
  );
  for (const network of ["pulsechain", "robinhood"]) {
    assert.equal(
      selectGaslessFeeOnOutput(network, HEX, USDC, sellTax, noTax),
      true,
    );
    assert.equal(
      selectGaslessFeeOnOutput(network, HEX, USDC, noTax, buyTax),
      false,
    );
    assert.equal(
      selectGaslessFeeOnOutput(network, HEX, USDC, sellTax, buyTax),
      false,
    );
  }
  assert.throws(() =>
    selectGaslessFeeOnOutput(
      "pulsechain",
      HEX,
      USDC,
      { ...noTax, sellTaxBps: NaN },
      noTax,
    ),
  );
});

test("full gas budget uses 30% price, 30% limit, and 10% headroom without double boosting", () => {
  assert.deepEqual(gaslessGasBudget(100n, 100n, 130n), {
    gasLimit: 130n,
    gasPrice: 130n,
    gasBudgetNative: 18590n,
  });
  assert.equal(gaslessGasBudget(1n, 1n, 3n).gasBudgetNative, 7n);
});

for (const feeOnOutput of [false, true]) {
  test(`valid ${feeOnOutput ? "output" : "input"}-fee preview uses actual recipient output and integer minimum`, () => {
    const f = fixture({ feeOnOutput });
    const result = assessGaslessQuote(f.quote, f.trade, d, f.state, f.now);
    assert.equal(result.eligible, true);
    assert.equal(result.prepared.minAmountOut, f.p.minAmountOut);
    assert.equal(result.prepared.expectedOutput, f.p.recipientAmountOut);
    assert.equal(
      result.prepared.payoutToken,
      feeOnOutput ? f.trade.tokenOut : f.trade.tokenIn,
    );
  });
}

const mutations = {
  "wrong maker": (f) => {
    f.p.maker = USDC;
  },
  "wrong recipient": (f) => {
    f.p.recipient = USDC;
  },
  "wrong contract": (f) => {
    f.p.contract = config().limitOrderContract;
  },
  "wrong chain": (f) => {
    f.p.chainId = 4663;
  },
  "wrong amount": (f) => {
    f.p.amountIn = "1";
  },
  "wrong input": (f) => {
    f.p.tokenIn = HEX;
  },
  "wrong output": (f) => {
    f.p.tokenOut = USDC;
  },
  "wrong route hash": (f) => {
    f.p.routeHash = `0x${"00".repeat(32)}`;
  },
  "wrong fee side": (f) => {
    f.p.feeOnOutput = true;
  },
  "wrong payout side": (f) => {
    f.p.excessOnInput = false;
  },
  "wrong payout token": (f) => {
    f.p.payoutToken = HEX;
  },
  "wrong unwrap": (f) => {
    f.p.unwrapOutput = true;
  },
  "changed slippage": (f) => {
    f.p.slippageBps = 100;
  },
  "wrong minimum": (f) => {
    f.p.minAmountOut = "1";
  },
  "insufficient received output": (f) => {
    f.p.recipientAmountOut = "1";
  },
  "cap bypass": (f) => {
    f.p.nominalOperatorPayout = (
      (BigInt(f.p.payoutCapBase) * 5n) / 10000n +
      1n
    ).toString();
  },
  "payout exceeds nominal": (f) => {
    f.p.operatorPayout = (BigInt(f.p.nominalOperatorPayout) + 1n).toString();
  },
  "understated gas limit": (f) => {
    f.p.gasLimit = "500000";
  },
  "understated gas budget": (f) => {
    f.p.gasBudgetNative = "1";
  },
  "weaker gas policy": (f) => {
    f.p.gasPriceBoostBps = 10000;
  },
  "future proof": (f) => {
    f.p.checkedAt += 1;
  },
  "old proof": (f) => {
    f.p.checkedAt -= 30001;
  },
  "stale chain": (f) => {
    f.state.blockTimestamp -= 91;
  },
  "inconsistent block": (f) => {
    f.p.quoteBlockNumber++;
  },
  "future block": (f) => {
    f.p.quoteBlockNumber = f.quote.quoteBlockNumber = f.state.blockNumber + 4;
  },
  "raw native transfer": (f) => {
    f.quote.selectedTx.value = "1";
  },
  "wrong router": (f) => {
    f.quote.selectedTx.to = USDC;
  },
  "absent preview": (f) => {
    delete f.quote.gaslessExecution;
  },
  "unsupported legacy preview": (f) => {
    f.p.version = 1;
  },
};
for (const [name, mutate] of Object.entries(mutations))
  test(`fail closed: ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.equal(
      assessGaslessQuote(f.quote, f.trade, d, f.state, f.now).eligible,
      false,
    );
  });

test("reject a gas budget shortfall even if API eligible was true", () => {
  const f = fixture();
  f.p.operatorPayoutNative = f.p.gasBudgetNative;
  assert.equal(
    assessGaslessQuote(f.quote, f.trade, d, f.state, f.now).code,
    "INSUFFICIENT_OPERATOR_PAYOUT",
  );
  f.p.operatorPayoutNative = (BigInt(f.p.gasBudgetNative) + 1n).toString();
  f.state.rawGasPriceWei = "2000000000";
  assert.equal(
    assessGaslessQuote(f.quote, f.trade, d, f.state, f.now).eligible,
    false,
  );
});

test("native output is wrapped in signed tuple, native input requires an explicit wrap", () => {
  const f = fixture({ trade: { tokenOut: NATIVE_PLS } });
  const decision = assessGaslessQuote(f.quote, f.trade, d, f.state, f.now);
  assert.equal(decision.eligible, true);
  const order = buildGaslessOrder(decision.prepared, { now: f.now });
  assert.equal(order.tokenOut, d.wrappedNative);
  assert.equal(order.unwrapOutput, true);
  assert.equal(
    assessGaslessQuote(
      f.quote,
      { ...f.trade, tokenIn: NATIVE_PLS, tokenOut: HEX },
      d,
      f.state,
      f.now,
    ).code,
    "NATIVE_INPUT_REQUIRES_WRAP",
  );
});

test("taxed operator receipt is valued after tax and never charged twice", () => {
  const f = fixture();
  f.p.operatorPayout = (
    (BigInt(f.p.nominalOperatorPayout) * 95n) /
    100n
  ).toString();
  assert.equal(
    assessGaslessQuote(f.quote, f.trade, d, f.state, f.now).eligible,
    true,
  );
});

test("uint parsing does not round token amounts or accept overflow", () => {
  assert.equal(
    gaslessUint("64411401494724021134547"),
    64411401494724021134547n,
  );
  for (const n of [64411, "1e18", "01", "-1", "0", (1n << 256n).toString()])
    assert.throws(() => gaslessUint(n));
  for (let i = 0; i < 20; i++)
    assert.ok(Number.isSafeInteger(createGaslessNonce()));
});

test("on-chain pause, fee, cap, fee exemption and wrong RPC chain disable gasless", async () => {
  await readGaslessChainState(fakeProvider(), d);
  for (const options of [
    { paused: true },
    { fee: 30n },
    { cap: 500n },
    { exempt: false },
    { chainId: 4663 },
  ])
    await assert.rejects(() => readGaslessChainState(fakeProvider(options), d));
});

test("approval always targets settlement, defaults unlimited and takes max fresh/API gas price", async () => {
  const f = fixture();
  const provider = fakeProvider();
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider,
    fetch: fakeApi(f).fetcher,
  });
  const request = await client.approvalRequest(f.trade, fakeSigner(provider), {
    quoteGasPriceWei: "1500000000",
  });
  const [spender, amount] = token.decodeFunctionData("approve", request.data);
  assert.equal(spender, d.contract);
  assert.equal(amount, MaxUint256);
  assert.equal(request.gasPrice, 1500000000n);
  assert.equal(request.gasLimit, 65000n);
  const exact = await client.approvalRequest(f.trade, fakeSigner(provider), {
    unlimited: false,
  });
  assert.equal(
    token.decodeFunctionData("approve", exact.data)[1],
    BigInt(f.trade.amountIn),
  );
  const reset = await client.approvalRequest(f.trade, fakeSigner(provider), {
    resetToZero: true,
  });
  assert.equal(token.decodeFunctionData("approve", reset.data)[1], 0n);
});

test("stale displayed quote refreshes and opens wallet once, then POSTs the exact signature", async () => {
  const f = fixture();
  const old = structuredClone(f.quote);
  old.gaslessExecution.checkedAt -= 31000;
  const api = fakeApi(f);
  const provider = fakeProvider();
  const store = memoryStore();
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider,
    fetch: api.fetcher,
  });
  let prompts = 0,
    shown = 0;
  const record = await client.signAndSubmit({
    trade: f.trade,
    store,
    displayed: { quote: old },
    signer: fakeSigner(provider, {
      async signTypedData(...args) {
        prompts++;
        assert.equal(shown, 1);
        assert.equal((await store.load()).state, "signing");
        return wallet.signTypedData(...args);
      },
    }),
    onPrepared() {
      shown++;
    },
  });
  assert.equal(prompts, 1);
  assert.equal(shown, 1);
  assert.equal(record.limitOrderContract, d.contract);
  const request = api.requests.find((r) => r.method === "POST");
  const body = JSON.parse(request.body);
  assert.equal(body.minAmountOut, f.p.minAmountOut);
  assert.equal((await store.load()).state, "submitted");
  const quoteRequest = api.requests.find((r) =>
    r.url.pathname.endsWith("/quote"),
  );
  assert.equal(quoteRequest.url.searchParams.get("gasless"), "true");
  assert.equal(quoteRequest.url.searchParams.get("fee"), "10");
  assert.equal(quoteRequest.url.searchParams.has("adapters"), false);
  await assert.rejects(
    () =>
      client.signAndSubmit({
        trade: f.trade,
        store,
        signer: fakeSigner(provider),
      }),
    { code: "ORDER_PENDING" },
  );
});

test("API rejection and ambiguous submission preserve a signed lock; rejection before signature releases it", async () => {
  const f = fixture();
  const provider = fakeProvider();
  const store = memoryStore();
  const api = fakeApi(f);
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider,
    fetch: async (url, init) => {
      if (init.method === "POST") throw Error("Connection reset");
      return api.fetcher(url, init);
    },
  });
  await assert.rejects(
    () =>
      client.signAndSubmit({
        trade: f.trade,
        store,
        signer: fakeSigner(provider),
      }),
    GaslessSubmissionError,
  );
  assert.equal((await store.load()).state, "uncertain");
  assert.ok((await store.load()).signature);
  const unsigned = memoryStore();
  await assert.rejects(() =>
    client.signAndSubmit({
      trade: f.trade,
      store: unsigned,
      signer: fakeSigner(provider, {
        async signTypedData() {
          throw Error("User rejected");
        },
      }),
    }),
  );
  assert.equal(await unsigned.load(), null);
});

test("accepted POST with lost response reconciles exact order without a new nonce or signature", async () => {
  const f = fixture();
  const api = fakeApi(f, { afterAccept: true });
  const provider = fakeProvider();
  const store = memoryStore();
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider,
    fetch: api.fetcher,
  });
  const record = await client.signAndSubmit({
    trade: f.trade,
    store,
    signer: fakeSigner(provider),
  });
  assert.equal(record.nonce, (await store.load()).order.nonce);
  assert.equal(api.requests.filter((r) => r.method === "POST").length, 1);
  assert.equal((await store.load()).state, "submitted");
});

test("API EXPIRED alone does not unlock pending order and status checks do not quote", async () => {
  const f = fixture();
  const order = buildGaslessOrder(
    assessGaslessQuote(f.quote, f.trade, d, f.state).prepared,
  );
  const pending = {
    network: "pulsechain",
    chainId: 369,
    contract: d.contract,
    order,
    state: "signing",
  };
  const store = memoryStore();
  await store.reserve(pending);
  const api = fakeApi(f, { record: recordFor(pending, { status: "EXPIRED" }) });
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider: fakeProvider(),
    fetch: api.fetcher,
  });
  assert.equal((await client.reconcile(store)).status, "pending");
  assert.ok(await store.load());
  assert.equal(
    api.requests.some((r) => r.url.pathname.endsWith("/quote")),
    false,
  );
  const expired = new GaslessSwapClient({
    network: "pulsechain",
    provider: fakeProvider({ blockTimestamp: order.deadline + 1 }),
    fetch: api.fetcher,
  });
  assert.equal((await expired.reconcile(store)).status, "closed");
  assert.equal(await store.load(), null);
});

test("filled order exposes settlement explorer link; mismatched identity cannot release another order", async () => {
  const f = fixture();
  const order = buildGaslessOrder(
    assessGaslessQuote(f.quote, f.trade, d, f.state).prepared,
  );
  const pending = {
    network: "pulsechain",
    chainId: 369,
    contract: d.contract,
    order,
    state: "signing",
  };
  const store = memoryStore();
  await store.reserve(pending);
  const hash = `0x${"ab".repeat(32)}`;
  const api = fakeApi(f, {
    record: recordFor(pending, { status: "FILLED", filledTxHash: hash }),
  });
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider: fakeProvider(),
    fetch: api.fetcher,
  });
  assert.equal(
    (await client.reconcile(store)).settlementTxUrl,
    `${d.explorer}/tx/${hash}`,
  );
  await store.reserve(pending);
  const bad = new GaslessSwapClient({
    network: "pulsechain",
    provider: fakeProvider(),
    fetch: fakeApi(f, {
      record: recordFor(pending, { minAmountOut: "1", status: "FILLED" }),
    }).fetcher,
  });
  await assert.rejects(() => bad.reconcile(store), {
    code: "ORDER_IDENTITY_MISMATCH",
  });
  assert.ok(await store.load());
});

test("public operator allowlist separates current gasless, limit and historical contracts", () => {
  const f = fixture();
  const base = {
    ...f.trade,
    status: "ACTIVE",
    limitOrderContract: d.contract,
    deadline: f.state.blockTimestamp + 180,
    nonce: 3,
  };
  const orders = [
    base,
    { ...base, nonce: 4, deadline: base.deadline - 10 },
    base,
    { ...base, nonce: 5, deadline: f.state.blockTimestamp },
    { ...base, limitOrderContract: config().limitOrderContract },
    { ...base, limitOrderContract: config().allLimitOrderContracts[1] },
  ];
  assert.deepEqual(
    selectGaslessPriorityOrders(
      orders,
      config(),
      d,
      f.state.blockTimestamp,
    ).map((o) => o.nonce),
    [4, 3],
  );
  assert.equal(classifySwitchOrder(orders[4], config(), d), "limit-order");
  assert.equal(classifySwitchOrder(orders[5], config(), d), "unsupported");
});

test("smaller surplus can cover gas; larger slippage never enlarges 5-bps payout cap", () => {
  assert.equal(cappedGaslessPayout(1n, 100000n), 1n);
  assert.equal(cappedGaslessPayout(99999n, 100000n), 50n);
  assert.equal(assessGaslessOperatorProfit(11n, 2n, 5n).eligible, true);
  assert.equal(assessGaslessOperatorProfit(10n, 2n, 5n).eligible, false);
  assert.equal(gaslessExcessOnInput(true), false);
  assert.equal(gaslessExcessOnInput(false), true);
});

test("gasless fill calldata enforces V2 side, correct signature and after-fee input", async () => {
  const f = fixture();
  const order = buildGaslessOrder(
    assessGaslessQuote(f.quote, f.trade, d, f.state).prepared,
  );
  const params = getGaslessSigningParams(d);
  const signature = await wallet.signTypedData(
    params.domain,
    params.types,
    order,
  );
  const input = {
    deployment: d,
    order,
    signature,
    routes: f.routes,
    chainTimestamp: f.state.blockTimestamp,
    receivedInput: order.amountIn,
  };
  assert.throws(() => encodeGaslessFill(input)); // Full input cannot also pay the input-side fee.
  const routes = structuredClone(f.routes);
  routes[0].amountIn = "998500500";
  const call = encodeGaslessFill({ ...input, routes });
  const decoded = new Interface(GASLESS_SWITCH_ABI).decodeFunctionData(
    "fillOrder",
    call.data,
  );
  assert.equal(call.to, d.contract);
  assert.equal(decoded[3], true);
  assert.throws(() =>
    encodeGaslessFill({
      ...input,
      routes,
      order: { ...order, minAmountOut: "1" },
    }),
  );
});

test("browser pending store uses atomic reservations and rejects corrupted storage", async () => {
  const f = fixture();
  const order = buildGaslessOrder(
    assessGaslessQuote(f.quote, f.trade, d, f.state).prepared,
  );
  const pending = {
    network: "pulsechain",
    chainId: 369,
    contract: d.contract,
    order,
    state: "signing",
  };
  let value = null,
    queue = Promise.resolve();
  const storage = {
    getItem() {
      return value;
    },
    setItem(_, v) {
      value = v;
    },
    removeItem() {
      value = null;
    },
  };
  const locks = {
    request(_, work) {
      const result = queue.then(work);
      queue = result.catch(() => {});
      return result;
    },
  };
  const a = createGaslessBrowserStore("pulsechain", wallet.address, {
    storage,
    locks,
  });
  const b = createGaslessBrowserStore("pulsechain", wallet.address, {
    storage,
    locks,
  });
  const reservations = await Promise.allSettled([
    a.reserve(pending),
    b.reserve(pending),
  ]);
  assert.equal(reservations.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(() =>
    a.update({ ...pending, order: { ...order, minAmountOut: "1" } }),
  );
  await b.release({ ...pending, order: { ...order, nonce: order.nonce + 1 } });
  assert.ok(await a.load());
  await a.release(pending);
  assert.equal(await b.load(), null);
  assert.throws(() => parseGaslessPending("{}", "pulsechain", wallet.address));
  value = "{}";
  await assert.rejects(() => a.load());
  await assert.rejects(() => a.reserve(pending));
});

test("minimal fill ABI matches the compiled full GaslessSwitchV2 ABI", async () => {
  const full = new Interface(
    JSON.parse(
      await readFile(
        new URL("../abi/GaslessSwitchV2ABI.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const minimal = new Interface(GASLESS_SWITCH_ABI);
  for (const name of [
    "fillOrder",
    "canFillOrder",
    "invalidateNonce",
    "settlementVersion",
  ])
    assert.equal(
      minimal.getFunction(name).selector,
      full.getFunction(name).selector,
    );
  assert.deepEqual(
    full.getFunction("fillOrder").outputs.map((o) => o.type),
    ["uint256", "uint256", "uint256"],
  );
});

test("captured live SWITCH -> USDC multipath preview is accepted without recomputing taxes or fees", async () => {
  const quote = JSON.parse(
    await readFile(
      new URL("fixtures/switch-usdc-v2.json", import.meta.url),
      "utf8",
    ),
  );
  const p = quote.gaslessExecution;
  const trade = {
    maker: p.maker,
    tokenIn: p.tokenIn,
    tokenOut: p.tokenOut,
    amountIn: p.amountIn,
    recipient: p.recipient,
    slippageBps: 50,
  };
  const state = {
    checkedAt: p.checkedAt,
    blockNumber: p.quoteBlockNumber,
    blockTimestamp: Math.floor(p.checkedAt / 1000),
    rawGasPriceWei: ((BigInt(p.gasPriceWei) * 10000n) / 13000n).toString(),
  };
  const result = assessGaslessQuote(quote, trade, d, state, p.checkedAt + 1);
  assert.equal(result.eligible, true);
  assert.equal(result.prepared.expectedOutput, "33483493");
  assert.equal(result.prepared.minAmountOut, "33316075");
});

test("a changed refreshed quote still signs exactly once using the new visible minimum", async () => {
  const f = fixture();
  const old = structuredClone(f.quote);
  old.gaslessExecution.checkedAt -= 31000;
  const api = fakeApi(f, {
    quote(original) {
      const quote = structuredClone(original.quote);
      const p = quote.gaslessExecution;
      p.expectedOutputAmount = (
        BigInt(p.expectedOutputAmount) + 10000n
      ).toString();
      p.recipientAmountOut = p.expectedOutputAmount;
      p.minAmountOut = (
        (BigInt(p.expectedOutputAmount) * 9950n) /
        10000n
      ).toString();
      return quote;
    },
  });
  const provider = fakeProvider();
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider,
    fetch: api.fetcher,
  });
  let visibleMinimum;
  const result = await client.signAndSubmit({
    trade: f.trade,
    signer: fakeSigner(provider),
    store: memoryStore(),
    displayed: { quote: old },
    onPrepared(p) {
      visibleMinimum = p.minAmountOut;
    },
  });
  assert.notEqual(result.minAmountOut, f.p.minAmountOut);
  assert.equal(result.minAmountOut, visibleMinimum);
  assert.equal(api.requests.filter((r) => r.method === "POST").length, 1);
});

for (const options of [{ balance: 1n }, { allowance: 0n }, { chainId: 4663 }])
  test(`funds/network preflight prevents wallet prompt and POST (${Object.keys(options)[0]})`, async () => {
    const f = fixture();
    const api = fakeApi(f);
    const provider = fakeProvider(options);
    let prompts = 0;
    const client = new GaslessSwapClient({
      network: "pulsechain",
      provider,
      fetch: api.fetcher,
    });
    await assert.rejects(() =>
      client.signAndSubmit({
        trade: f.trade,
        store: memoryStore(),
        signer: fakeSigner(provider, {
          async signTypedData() {
            prompts++;
            throw Error();
          },
        }),
      }),
    );
    assert.equal(prompts, 0);
    assert.equal(api.requests.filter((r) => r.method === "POST").length, 0);
  });

test("trade mutation while wallet is open retains the signed lock and prevents POST", async () => {
  const f = fixture();
  const api = fakeApi(f);
  const provider = fakeProvider();
  const store = memoryStore();
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider,
    fetch: api.fetcher,
  });
  const signer = fakeSigner(provider, {
    async signTypedData(...args) {
      const signature = await wallet.signTypedData(...args);
      f.trade.amountIn = "1";
      return signature;
    },
  });
  await assert.rejects(
    () => client.signAndSubmit({ trade: f.trade, store, signer }),
    GaslessSubmissionError,
  );
  assert.equal(
    api.requests.some((r) => r.method === "POST"),
    false,
  );
  assert.equal((await store.load()).state, "uncertain");
});

test("expired wallet confirmation is not submitted and RPC outage never unlocks a saved signature", async (t) => {
  const f = fixture();
  const api = fakeApi(f);
  const provider = fakeProvider();
  const store = memoryStore();
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider,
    fetch: api.fetcher,
  });
  const signer = fakeSigner(provider, {
    async signTypedData(...args) {
      const signature = await wallet.signTypedData(...args);
      // Simulate a wallet prompt left open beyond its signed deadline without sleeping.
      t.mock.method(Date, "now", () => f.now + 181000);
      return signature;
    },
  });
  await assert.rejects(
    () => client.signAndSubmit({ trade: f.trade, store, signer }),
    GaslessSubmissionError,
  );
  assert.equal(
    api.requests.some((r) => r.method === "POST"),
    false,
  );
  assert.ok(await store.load());
  const failingProvider = fakeProvider();
  failingProvider.getBlock = async () => {
    throw Error("RPC offline");
  };
  const failing = new GaslessSwapClient({
    network: "pulsechain",
    provider: failingProvider,
    fetch: api.fetcher,
  });
  await assert.rejects(() => failing.reconcile(store));
  assert.ok(await store.load());
});

test("lost POST can be retried with the exact saved payload, never a new nonce", async () => {
  const f = fixture();
  const api = fakeApi(f);
  const provider = fakeProvider();
  const store = memoryStore();
  let rejectPost = true;
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider,
    fetch: async (url, init) => {
      if (init.method === "POST" && rejectPost) throw Error("offline");
      return api.fetcher(url, init);
    },
  });
  await assert.rejects(
    () =>
      client.signAndSubmit({
        trade: f.trade,
        store,
        signer: fakeSigner(provider),
      }),
    GaslessSubmissionError,
  );
  const saved = await store.load();
  rejectPost = false;
  const record = await client.retrySubmission(store);
  assert.equal(record.nonce, saved.order.nonce);
  assert.equal(record.signature, saved.signature);
  assert.equal((await store.load()).state, "submitted");
});

test("tiny swaps and unavailable execution are not recommended", async () => {
  const f = fixture();
  const provider = fakeProvider();
  for (const preview of [
    { status: "unavailable", reason: "simulation unavailable" },
    { ...f.p, eligible: false },
    {
      ...f.p,
      operatorPayoutNative: "1378969811243674291615",
      gasBudgetNative: "1782867852628859812143",
    },
  ]) {
    const result = assessGaslessQuote(
      { ...f.quote, gaslessExecution: preview },
      f.trade,
      d,
      f.state,
      f.now,
    );
    assert.equal(result.eligible, false);
  }
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider,
    fetch: fakeApi(f).fetcher,
  });
  assert.equal(
    (await client.quote({ ...f.trade, tokenIn: NATIVE_PLS })).code,
    "NATIVE_INPUT_REQUIRES_WRAP",
  );
});
