import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatEther } from "ethers";
import { assessGaslessQuote } from "../dist/gasless.js";
import { GaslessSwapClient } from "../dist/gasless-client.js";
import { fixture, fakeApi, fakeProvider, d, wallet } from "./helpers.mjs";

function withEligibility(f = fixture()) {
  const budget = BigInt(f.p.gasBudgetNative),
    payout = BigInt(f.p.operatorPayoutNative);
  const summary = {
    policyVersion: 1,
    status: "eligible",
    eligible: true,
    recommendation: "gasless",
    reasonCode: "READY",
    reason: "Payout covers the conservative gas reserve.",
    nativeSymbol: f.deployment.network === "pulsechain" ? "PLS" : "ETH",
    protocolFeeBps: 10,
    maxOperatorPayoutBps: 5,
    requiredGasCoverageBps: 20000,
    payoutValuationHaircutBps: 1000,
    minimumSlippageBps: 50,
    operatorLivenessVerified: false,
    checkedAt: f.now,
    expiresAt: f.now + 30000,
    economics: {
      estimatedGasUnits: f.p.estimatedGas,
      gasLimit: f.p.gasLimit,
      gasPriceWei: f.p.gasPriceWei,
      operatorPayoutNativeWei: payout.toString(),
      operatorPayoutNative: formatEther(payout),
      gasBudgetNativeWei: budget.toString(),
      conservativeGasBudgetNativeWei: (budget * 2n).toString(),
      conservativeGasBudgetNative: formatEther(budget * 2n),
      stressedOperatorPayoutNativeWei: ((payout * 9000n) / 10000n).toString(),
      gasCovered: true,
      safetyMarginCovered: true,
    },
    operator: {
      address: wallet.address,
      nativeBalanceWei: (10n ** 22n).toString(),
      gasAvailable: true,
    },
  };
  f.quote.gaslessEligibility = f.p.eligibility = summary;
  return f;
}
const assess = (f) =>
  assessGaslessQuote(f.quote, f.trade, f.deployment, f.state, f.now);

test("decision exposes native economics for a checked eligible quote", () => {
  const f = withEligibility();
  const result = assess(f);
  assert.equal(result.eligible, true);
  assert.equal(result.eligibility, f.quote.gaslessEligibility);
  assert.equal(result.eligibility.economics.operatorPayoutNative, "1.0");
});

for (const [reasonCode, retryable] of [
  ["GAS_NOT_COVERED", false],
  ["INSUFFICIENT_SAFETY_MARGIN", false],
  ["SLIPPAGE_BUFFER_TOO_SMALL", false],
  ["OPERATOR_GAS_UNAVAILABLE", true],
])
  test(`preserves ${reasonCode} and costs without enabling signing`, () => {
    const f = withEligibility();
    Object.assign(f.quote.gaslessEligibility, {
      status: "ineligible",
      eligible: false,
      recommendation: "regular",
      reasonCode,
      reason: `${reasonCode}: use Regular.`,
    });
    f.p.eligible = false;
    const result = assess(f);
    assert.equal(result.eligible, false);
    assert.equal(result.code, "SERVER_INELIGIBLE");
    assert.equal(result.reason, `${reasonCode}: use Regular.`);
    assert.equal(result.retryable, retryable);
    assert.equal(result.eligibility.economics.operatorPayoutNative, "1.0");
  });

for (const [status, reasonCode] of [
  ["unavailable", "NO_APPROVED_OPERATOR"],
  ["not_checked", "NOT_REQUESTED"],
])
  test(`${status} never counts as eligible even if a legacy flag says true`, () => {
    const f = withEligibility();
    Object.assign(f.quote.gaslessEligibility, {
      status,
      eligible: false,
      recommendation: "regular",
      reasonCode,
    });
    const result = assess(f);
    assert.equal(result.eligible, false);
    assert.equal(result.retryable, true);
    assert.equal(result.eligibility.reasonCode, reasonCode);
  });

test("unavailable simulation retains the API rejection reason", () => {
  const f = withEligibility();
  Object.assign(f.quote.gaslessEligibility, {
    status: "unavailable",
    eligible: false,
    recommendation: "regular",
    reasonCode: "EXECUTION_UNVERIFIED",
    reason: "Could not simulate this tax token.",
  });
  f.quote.gaslessExecution = {
    status: "unavailable",
    reason: "Simulation failed",
    eligibility: f.quote.gaslessEligibility,
  };
  assert.equal(assess(f).reason, "Could not simulate this tax token.");
});

test("accepts nested-only additive metadata and retains older V2 compatibility", () => {
  const f = withEligibility();
  delete f.quote.gaslessEligibility;
  assert.equal(assess(f).eligible, true);
  assert.equal(assess(f).eligibility, f.p.eligibility);
  delete f.p.eligibility;
  assert.equal(assess(f).eligible, true);
  assert.equal(assess(f).eligibility, undefined);
});

test("an expired or future server summary cannot open the wallet", () => {
  for (const delta of [-30000, 1]) {
    const f = withEligibility();
    f.p.eligibility.checkedAt += delta;
    f.p.eligibility.expiresAt += delta;
    assert.equal(assess(f).code, "STALE_QUOTE");
  }
});

test("conflicting top-level and nested recommendations fail closed", () => {
  const f = withEligibility();
  f.p.eligibility = {
    ...f.p.eligibility,
    status: "ineligible",
    eligible: false,
    recommendation: "regular",
    reasonCode: "GAS_NOT_COVERED",
  };
  assert.equal(assess(f).code, "INVALID_PREVIEW");
});

for (const [name, mutate] of [
  [
    "weaker policy",
    (f) => {
      f.p.eligibility.requiredGasCoverageBps = 10000;
    },
  ],
  [
    "wrong native symbol",
    (f) => {
      f.p.eligibility.nativeSymbol = "ETH";
    },
  ],
  [
    "unbound gas economics",
    (f) => {
      f.p.eligibility.economics.gasBudgetNativeWei = "1";
    },
  ],
  [
    "missing operator funds",
    (f) => {
      delete f.p.eligibility.operator;
    },
  ],
  [
    "missing economics",
    (f) => {
      delete f.p.eligibility.economics;
    },
  ],
  [
    "inconsistent eligibility flag",
    (f) => {
      f.p.eligibility.eligible = false;
    },
  ],
  [
    "preview mismatch",
    (f) => {
      f.p.eligible = false;
    },
  ],
])
  test(`server metadata rejects ${name}`, () => {
    const f = withEligibility();
    mutate(f);
    assert.equal(assess(f).eligible, false);
  });

test("fresh gas preserves the 2x reserve and 10% payout haircut", () => {
  const f = fixture();
  f.p.operatorPayoutNative = (BigInt(f.p.gasBudgetNative) * 3n).toString();
  withEligibility(f);
  assert.equal(assess(f).eligible, true);
  f.state.rawGasPriceWei = "2000000000";
  const result = assess(f);
  assert.equal(result.eligible, false);
  assert.equal(result.code, "INSUFFICIENT_OPERATOR_PAYOUT");
  assert.match(result.reason, /conservative reserve/);
  assert.equal(result.eligibility.eligible, true); // Original server result; local gas rose.
});

test("positive wallet funding below the conservative reserve is rejected", () => {
  const f = withEligibility();
  f.p.eligibility.operator.nativeBalanceWei = f.p.gasBudgetNative;
  assert.equal(assess(f).eligible, false);
});

test("client preserves server rejection metadata without submitting or signing", async () => {
  const f = withEligibility();
  Object.assign(f.p.eligibility, {
    status: "ineligible",
    eligible: false,
    recommendation: "regular",
    reasonCode: "GAS_NOT_COVERED",
    reason: "Payout is 4 PLS; reserve is 4000 PLS.",
  });
  f.p.eligible = false;
  const api = fakeApi(f);
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider: fakeProvider(),
    fetch: api.fetcher,
  });
  const result = await client.quote(f.trade);
  assert.equal(result.code, "SERVER_INELIGIBLE");
  assert.equal(result.eligibility.reasonCode, "GAS_NOT_COVERED");
  assert.equal(result.reason, "Payout is 4 PLS; reserve is 4000 PLS.");
  assert.ok(api.requests.every((request) => request.method !== "POST"));
});

test("client exposes the checked eligible summary to frontend callbacks", async () => {
  const f = withEligibility();
  const api = fakeApi(f);
  const client = new GaslessSwapClient({
    network: "pulsechain",
    provider: fakeProvider(),
    fetch: api.fetcher,
  });
  const result = await client.quote(f.trade);
  assert.equal(result.eligible, true, result.reason);
  assert.equal(result.eligibility.reasonCode, "READY");
  assert.equal(result.prepared.quote.gaslessEligibility, result.eligibility);
});

test("captured live policy-v1 response passes complete SDK validation", async () => {
  const quote = JSON.parse(
    await readFile(
      new URL("./fixtures/gasless-eligibility-pulse-v1.json", import.meta.url),
      "utf8",
    ),
  );
  const p = quote.gaslessExecution;
  const now = Date.now();
  p.checkedAt = now;
  for (const summary of [quote.gaslessEligibility, p.eligibility]) {
    summary.checkedAt = now;
    summary.expiresAt = now + 30000;
  }
  const trade = {
    maker: p.maker,
    tokenIn: p.tokenIn,
    tokenOut: p.tokenOut,
    amountIn: p.amountIn,
    recipient: p.recipient,
    slippageBps: p.slippageBps,
  };
  const state = {
    checkedAt: now,
    blockNumber: p.quoteBlockNumber,
    blockTimestamp: Math.floor(now / 1000),
    rawGasPriceWei: ((BigInt(p.gasPriceWei) * 10000n) / 13000n).toString(),
  };
  const result = assessGaslessQuote(quote, trade, d, state, now);
  assert.equal(result.eligible, true, result.reason);
  assert.equal(result.eligibility.reasonCode, "READY");
});
