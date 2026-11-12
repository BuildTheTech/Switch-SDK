# GaslessSwitch V2 integration

GaslessSwitch V2 helpers are published in `@switch-win/sdk` version **1.3.0**.

Gasless swaps use a dedicated settlement contract. A user approves that
contract, signs an EIP-712 order, and submits the signature to the order API.
An approved operator pays settlement gas. Approval, wrapping, and on-chain
cancellation still require native gas. A quote or an accepted order is not a
guarantee of a fill.

## Fixed gasless fee

**Every GaslessSwitch settlement charges a fixed 0.1% protocol fee (10 bps).**
This is enforced by the settlement contract. Integrators cannot customize,
reduce, or waive it through SDK options, the quote API's `fee` parameter,
`partnerAddress`, or regular Router fee settings. Partner fee sharing allocates
the collected protocol fee; it does not change the user's fee rate.

The operator payout is separate and capped at **0.05% of the after-fee base**,
including settlement gas and the operator incentive. It may be lower than the
cap. Request `gasless=true&fee=10`: the checked preview already reserves the
operator payout. Display its expected/minimum output without subtracting the
protocol fee or operator payout a second time. Approval and wrapping gas,
token transfer taxes, and DEX fees can also apply.

**If your integration does not want to offer this fixed gasless fee policy,
offer regular swaps only.** Regular swaps use the Router's applicable fee
policy and on-chain minimum; display the selected quote's `protocolFeeBps`.

## Regular-only integration

1. Show only the regular swap action in your frontend. Leave out the Gasless
   selector and `GaslessSwapClient` quote, approval, signing, and submission flow.
2. Request `/swap/quote` with `gasless` omitted (or `gasless=false`) and the
   integration's regular `fee` setting, subject to the Router's fee minimum.
3. Follow the [regular swap integration flow](README.md#swap-integration-flow):
   approve the regular Router when needed, then submit the regular quote's `tx`
   from the user's wallet. The user pays network gas for that transaction.

The `gaslessEligibility` field on an ordinary quote is informational
(`not_checked`); receiving that field does not opt the integration into gasless.
If removing Gasless from an existing integration, retain status/recovery for
already signed pending orders until they are settled, cancelled, or confirmed
expired before allowing another trade against that wallet's pending lock.

## Deployments and fee policy

Verified against the public config endpoints on November 9, 2026:

| Network | Chain | GaslessSwitch V2 |
| --- | ---: | --- |
| PulseChain | 369 | `0xB5bd12E009D625d8b122d0Ff9EdeD8bA2cEdeaeB` |
| Robinhood | 4663 | `0xc39cB531f71059fd427a63bF8a2f4b822D6B9b02` |

| Property | Gasless swaps | Ordinary limit orders |
| --- | --- | --- |
| EIP-712 name / version | `GaslessSwitch` / `2` | `SwitchLimitOrder` / `2` |
| Protocol fee | Fixed 10 bps (0.1%); not configurable by integrators | 30 bps (0.3%) |
| Contract payout cap | 5 bps (0.05%) of realized after-fee base | Separate 500 bps protection |
| Gas reimbursement | Included in the 5 bps payout | Operator's own profitability policy |
| Maker approval | GaslessSwitch in both fee modes | Depends on signed fee mode |
| Route/direct fills | Route fills only | Both, subject to contract protection |
| SDK expiry | 180 seconds | User-selected |

The cap is **0.05% of the after-fee token base**, not 0.05% of the excess and
not a 0.5% minimum profit target. Slippage never increases it. The registered
operator role comes through the existing operator-access administration.
`readGaslessChainState` also checks pause status, the immutable Router and
wrapped-native addresses, domain separator, operator gate, and Router fee
exemption. No extra regular Router fee is added to settlement.

Fetch `GET /limit-orders/config?network=pulsechain` or `network=robinhood`.
Validate the `gasless*` fields against the trusted deployment. Do not sign or
approve an address simply because an API returned it. The SDK pins V2;
legacy gasless V1 contracts remain historical/drain targets. A deliberate
migration can use the client's `deployment` override after verifying it.

## Frontend flow

1. Connect the actual maker wallet and verify its chain. Keep amounts as raw
   decimal integer strings; never convert a token amount through `Number`.
2. Check both tokens' directional taxes. Input sell tax prefers output fees;
   output buy tax, including both-tax pairs, prefers input fees. Otherwise use
   the same known-token fee priority as the regular Switch frontend.
3. Request `gasless=true`, `fee=10`, the selected `feeOnOutput`, actual maker,
   recipient, partner, amount, and user slippage. Leave adapter filters unset.
4. Require the settlement preview's `eligible` flag and conservative server
   recommendation. Default to Gasless when eligible; explain why Regular is
   required when it is not. Unknown is not eligible. Do not silently send a
   Regular transaction in response to a Gasless signing click.
5. Check maker balance and allowance to GaslessSwitch. Default the unlimited
   approval toggle on, allow users to turn it off, and explain the spender and
   approval cost. Wait for successful confirmation before signing.
6. A Sign click owns refresh, visible quote update, signing, and POST. Freeze
   the trade intent while preparing/signing; abort on account, chain, pair,
   amount, recipient, partner, or slippage changes. Update the main expected
   output and the separate minimum received before the wallet prompt. The order
   signs the refreshed minimum, while the main amount stays on expected output.
7. Persist the pending order before opening the wallet. Persist the signature
   before POST. Keep the pending lock on uncertain submission. Never generate
   a replacement nonce merely because a request timed out. Block Regular and
   Wrap actions against the same wallet's trade while that lock remains.
8. Poll order status, not quotes. After a fill, show the settlement link and
   leave quotes paused until the user starts another swap or edits the form.

Use an ethers v6 `Provider` / `Signer` with the client. The standalone signing
params can also be passed to ethers v5 `_signTypedData`.

```ts
import { BrowserProvider } from "ethers";
import { GaslessSwapClient, createGaslessBrowserStore } from "@switch-win/sdk/gasless";

const provider = new BrowserProvider(window.ethereum, "any");
const signer = await provider.getSigner();
const maker = await signer.getAddress();
const client = new GaslessSwapClient({
  network: "pulsechain",
  provider,
  quoteEndpoint: "/api/switch/swap/quote",
  taxEndpoint: "/api/switch/swap/checkTax",
  ordersEndpoint: "/api/switch/limit-orders",
});
const store = createGaslessBrowserStore("pulsechain", maker);
const trade = {
  maker,
  tokenIn: "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",
  tokenOut: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
  amountIn: "100000000", // 100 USDC (6 decimals)
  slippageBps: 50,
};
const decision = await client.quote(trade);
if (!decision.eligible) {
  showRegularOption(decision.reason);
} else {
  displayQuote(decision.prepared);
  // Later, on the user's click, after any required approval:
  await client.signAndSubmit({
    trade, signer, store, displayed: decision.prepared,
    onPrepared: displayQuote, // Update main expected output and separate minimum before the prompt.
    onPending: displayOrderProgress,
  });
}
```

The complete [browser flow example](examples/gasless-swap.ts) handles approvals,
request cancellation, intent changes, pending recovery, and quote suspension.
Its UI callbacks are integration points, not a new design system. Reuse your
swap confirmation modal. Display these stages accurately:

- Wallet signature requested / signed.
- Order accepted by the API (a request in progress is not accepted).
- Waiting for an operator; show the fixed deadline countdown with tabular
  numerals and fixed width so the layout does not move.
- Confirmed settlement with a transaction link, or cancellation/chain expiry.

## What makes a quote eligible

The current API provides this through `gaslessExecution` and the additive
`gaslessEligibility` summary (live on both APIs November 10, 2026).
It replays GaslessSwitch V2 against
the quote's pinned block, measures actual recipient and operator balance
deltas, estimates settlement gas, and values the payout through a native-token
conversion route. Simulation uses ephemeral maker funding/signature/allowance
stand-ins: it does **not** prove the real maker's balance, approval, or
signature. The client checks those separately before submission.

The server now discounts the native payout valuation by 10% and requires that
stressed payout to exceed twice its already-padded gas budget. It also checks
that a registered operator has real native funds covering that conservative
reserve, and requires at least 50 bps (0.5%) of user-selected slippage. It never
raises slippage silently or increases the 5 bps payout cap. These are server
recommendation rules in addition to the client's independent checks below.

Read `gaslessEligibility.economics` for formatted PLS/ETH payout, estimated gas,
padded budget, conservative reserve, required payout and shortfall. Raw values
use decimal wei strings; `netAfterGasBudgetNativeWei` can be negative.
`checkedAt` and `expiresAt` are milliseconds. The same summary appears under
`gaslessExecution.eligibility`. `reasonCode` and `reason` explain rejection.
Normal quotes report `status: "not_checked"` without settlement simulation.
A `gaslessExecution.status` of `ready` only means simulation completed; it
does not imply `eligible: true`. Require the checked flag and exact binding.

`operatorLivenessVerified` is explicitly false: registration and native funds
do not prove that a worker is online. Integrators must not turn this estimate
into a fill guarantee. Borderline swaps now recommend Regular more often.

The SDK requires all of the following:

- A ready V2 preview matching chain, contract, maker, normalized tokens, full
  input, recipient, native unwrap flag, fee side, payout token, slippage, quote
  block, and `keccak256(selectedTx.data)`.
- Decodable `goSwitch` route bytes targeting the trusted Router, with the
  expected fee, recipient and partner, connected route endpoints, and zero
  native value. These bytes identify the preview route; they are **never**
  sent as a maker transaction for a gasless swap.
- Preview and current gas checks no older than 30 seconds, a recent quote
  block, and the verified current on-chain settlement policy.
- `gasLimit >= ceil(estimatedGas * 1.30)`.
- Gas price at least the maximum of the API quote's price, preview price,
  and `ceil(currentRawGasPrice * 1.30)`.
- Budget at least `ceil(gasLimit * gasPrice * 1.10)` and actual payout valued
  in native currency **strictly greater** than that budget.
- Nominal payout within the 5 bps cap, measured payout no greater than nominal,
  and actual recipient output at least the signed minimum.

No flat USD threshold or fixed gas-unit guess can replace this. Route length,
token transfers, tax hooks, payout liquidity, and gas price can make a larger
swap unsuitable too. Rejection codes distinguish stale checks, missing
previews, changed configuration, unknown taxes, and insufficient operator gas.
An unavailable check may be retried with backoff; insufficient payout normally
requires a larger amount or Regular. Never loosen the cap to make it pass.

These checks improve the execution estimate. Prices, gas, token rules, and
operator availability can still change during the three-minute order window;
an operator independently simulates the signed order before filling it.

## API eligibility response

`GET /swap/quote` returns `gaslessEligibility` on every successful quote.
An ordinary quote returns `not_checked`; it does not run a settlement check.
To request a check, include `network`, `gasless=true`, `fee=10`, the selected
`feeOnOutput`, `from`, `to`, raw `amount`, actual maker as `sender`, recipient
as `receiver`, and user slippage in **basis points** (`slippage=50` means 0.5%).
Keep API credentials on your server. `GaslessSwapClient.quote()` already sends
these fields, checks directional taxes/fee mode, and validates the response.
The 5 bps payout is reserved by the preview: do not send `fee=15` for gasless.

The response is also present as `gaslessExecution.eligibility`. Public types
`GaslessEligibility` and `GaslessEligibilityReason` are exported from the root
SDK and `@switch-win/sdk/gasless`. The client exposes the summary as
`decision.eligibility` on both branches, including rejected quotes:

```ts
const decision = await client.quote(trade);
const check = decision.eligibility;
if (check?.economics) {
  showGasCosts({
    currency: check.nativeSymbol,
    payout: check.economics.operatorPayoutNative,
    estimatedGas: check.economics.estimatedGasCostNative,
    conservativeReserve: check.economics.conservativeGasBudgetNative,
    requiredPayout: check.economics.requiredOperatorPayoutNative,
  });
}
if (!decision.eligible) {
  showRegularOption(decision.reason);
  // SERVER_INELIGIBLE preserves check.reasonCode, check.reason and economics.
  // Offer a deliberate retry with backoff only when decision.retryable is true.
} else {
  displayQuote(decision.prepared);
  // Use signAndSubmit on the user's click; it rechecks/refreshes before signing.
}
```

The formatted amounts are exact native decimal strings (PLS or ETH), not USD.
Raw `*Wei` fields are integer strings; keep them as strings/BigInt. The net
`netAfterGasBudgetNativeWei` is signed and can be negative. Economics/operator
details may be absent when verification was unavailable; display unknown
rather than inventing zero gas costs. `checkedAt`/`expiresAt` are milliseconds.

| `reasonCode` | Meaning and frontend action |
| --- | --- |
| `READY` | Server check passed; still require the SDK's complete `decision.eligible` check. |
| `NOT_REQUESTED` | Request a gasless quote with the required parameters. |
| `GAS_NOT_COVERED` | The capped payout does not cover padded gas; increase amount or use Regular. |
| `INSUFFICIENT_SAFETY_MARGIN` | Covers basic gas but fails the conservative reserve; increase amount or use Regular. |
| `OPERATOR_GAS_UNAVAILABLE` | Verified operator lacks the reserved native gas funds; use Regular or retry later. |
| `NO_APPROVED_OPERATOR` | No configured approved operator could be verified; use Regular or retry later. |
| `SLIPPAGE_BUFFER_TOO_SMALL` | User tolerance is below 50 bps; offer Regular or an explicit user change. |
| `STALE_PREVIEW` | Refresh the quote before signing. |
| `EXECUTION_UNVERIFIED` / `PAYOUT_UNVALUED` | Simulation/native valuation could not be trusted; offer Regular or a bounded retry. |

The client rejects stale, contradictory or mismatched summary/preview fields.
For policy-v1 metadata it also reapplies the 2x reserve and 10% payout haircut
using freshly checked gas prices, so a server `READY` can become a local
rejection before signing. Always use `decision.eligible` to gate the action;
`decision.eligibility` describes the original server check, not a guarantee.
Older V2 endpoints without this additive metadata retain the existing bound
preview/fee/cap/gas checks and expose no `decision.eligibility` summary.

Treat `ineligible`, `unavailable`, and `not_checked` as unavailable for signing.
Never automatically raise slippage or the operator cap. Offer a separate
Regular quote with the integration's Regular fee policy when selected. Refresh
after a trade edit or approval/signing delay, then freeze the displayed minimum
before signing. Once signed, poll that order's status rather than requesting
new quotes. `operatorLivenessVerified: false` means the API does not prove a
worker is online, even when an approved wallet has sufficient native funds.

## Amounts, fees, taxes, and slippage

### Expected output versus signed minimum

Use the same main output metric for Gasless and Regular: **expected output
after costs, before the user's slippage allowance**.

| SDK field | Frontend / signing use |
| --- | --- |
| `prepared.expectedOutput` | Main "Get" or "Expected output" amount, including the checked protocol fee, operator payout and token-tax effects. |
| `prepared.minAmountOut` | Separate "Minimum received" amount after slippage, and the exact `minAmountOut` used in the signed order. |

Keep the main field on `expectedOutput` while preparing and signing. Update
both amounts in `onPrepared` when a stale quote refreshes, before the wallet
prompt opens. Do not replace the main estimate with the lower minimum: that
makes Gasless look worse than a Regular quote displaying its expected output.

For example, a checked expected output of 1,000 tokens with 0.5% user slippage
shows **1,000** in the main field and **995 minimum received** separately.
The order signs **995**, so the operator can execute within that tolerance.

Both fields are raw integer strings in output-token units. Format them using
the token's decimals for display; never rebuild the signing minimum from a
rounded display value or use `expectedOutput` as the order's `minAmountOut`.
`signAndSubmit()` / `buildGaslessOrder()` already use the checked minimum.

### Fee and tax calculations

The regular quote fields describe its ordinary Router call. For the gasless
UI use the checked `prepared.expectedOutput` and `prepared.minAmountOut`,
which come from actual V2 settlement simulation. Do not use the ordinary
quote's `minAmountOut`, or subtract another 0.05% from the preview.

Send `fee=10`, not `15`: the gasless preview reserves the operator payout
separately. Output-fee arithmetic for an untaxed unchanged route is roughly
`gross * 0.999 * 0.9995`; integer rounding and actual tax transfers matter.
For input fees the cap reduces the amount routed, and AMM price impact makes
an output-side percentage subtraction inaccurate.

For Regular fallback, obtain a separate Regular quote and display its actual
`protocolFeeBps`. The current Switch frontend requests 15 bps for Regular;
the current Router floor is 10 bps on both chains. Neither value changes
GaslessSwitch's fixed 10 bps settlement fee.

The signed minimum is `floor(previewExpected * (10000 - slippageBps) / 10000)`.
User slippage allows market movement. Better output belongs to the recipient;
it does not authorize a bigger operator payout. For an output-fee fill the
contract pays `min(afterFeeOutput - minimum, floor(afterFeeOutput * 5/10000))`.
For an input-fee fill it pays
`min(afterFeeInput - routedInput, floor(afterFeeInput * 5/10000))`, refunding
any additional unused input to the maker. A smaller surplus automatically
means a smaller payout, and it is fillable only if that payout still covers gas.

Tax-token support is conditional on successful simulation of that exact token,
route, maker and recipient. Do not ban every tax token, assume all adapters are
tax-safe, or apply the displayed tax twice. The preview measures settlement
transfers and payout transfer tax; unsupported/mutable tax behavior fails
closed. Ordinary LO route builders still need their tax-safe adapter rules.

## Approvals and native currency

`client.approvalRequest()` builds an approval; `client.approve()` requests the
wallet transaction. Both fee modes approve **GaslessSwitch V2**, never the
Router or ordinary LimitOrder. Unlimited is the default; pass
`{ unlimited: false }` for an exact-amount approval. A token requiring zero
allowance first can use `{ resetToZero: true }`; confirm it, then build the
desired approval with a fresh gas price. Do not blindly zero every allowance.

The approval takes the maximum of freshly boosted RPC gas and the provided
`quoteGasPriceWei`. An API quote's gas price is already boosted and is not
multiplied again. Its gas limit is estimated for the actual approve call and
padded by 30%. Native balance and wallet policy can still prevent confirmation.

Raw PLS/ETH cannot be spent by an off-chain signature. Offer **Wrap and use
Gasless** or **Regular**, explain that wrapping requires gas, and wait for the
wrap receipt before a fresh approval/quote. Do not use PLSFlow for gasless
swaps. Native output is supported: the API receives the native sentinel, but
the signed tuple uses WPLS/WETH with `unwrapOutput=true`.

No Permit2 is used. Do not request Permit2 approvals or signatures.

## Submission, recovery, and cancellation

POST the complete signed tuple plus `signature` and the explicit gasless
`limitOrderContract` to `/limit-orders?network=...`. The type remains
`LimitOrder`, but the EIP-712 domain is `GaslessSwitch`, version `2`, with the
gasless verifying contract. Ordinary LO signing helpers are not interchangeable.
The hosted API currently verifies EOA signatures; generic ERC-1271 maker
submission is not supported by this client even though the contract supports it.

`GaslessPendingStore` must be durable and atomically reserve a slot per maker
and network. The supplied browser store uses localStorage and Web Locks to
serialize tabs. If those APIs are unavailable, provide an equivalent atomic
application store. Do not fall back silently to volatile memory for a browser
integration. Corrupted or inaccessible storage must block a new order until
the previous signature's status is recovered.

On a lost POST response, `GaslessSubmissionError.pending` retains the original
signature and nonce. `client.retrySubmission(store)` first checks that exact
order, then can resend the original payload while sufficiently far from expiry.
The API returns an error on duplicate nonces; it is not an idempotent-success
endpoint. A record only counts as confirmation if its contract and **all**
signed fields match. Never change a signed minimum, fee side, recipient,
deadline or nonce during retry.

`client.reconcile(store)` makes a status request and, when needed, a chain
read. Use a non-overlapping loop at five-second intervals with backoff on
failure. `FILLED` includes `settlementTxUrl` when the indexer has the hash.
Local-clock expiry, API `EXPIRED`, a missing record, and transport failure do
not independently release the pending lock. A confirmed chain expiry can
release it even during an API outage. The chain must pass the signed
deadline, or an exact matching fill/cancellation must be observed. A closed
window is not proof that no fill occurred; check history for the final result.

Closing the modal does not cancel. For early cancellation call
`invalidateNonce(pending.order.nonce)` on `pending.contract` with the maker,
wait for confirmation, and reconcile. Cancellation costs native gas and can
race an operator's fill. Never use a DELETE request or the ordinary LO address.

## Proxying and package checks

Keep API credentials server-side. The SDK accepts explicit quote, tax and order
endpoint overrides so browsers use their own proxy; see the
[restricted Next.js proxy example](examples/gasless-nextjs-proxy.ts). Apply
your hosting body limit, session/origin protections and rate limits. Forward
`gasless`, fee side, sender/receiver, partner and slippage unchanged. Avoid
overlapping quote searches: debounce edits, abort obsolete requests, and never
poll quotes while an order is pending or immediately after settlement.

This SDK revision builds ESM JavaScript and declarations into `dist`; package
exports use that output rather than unresolved TypeScript source files.
`npm pack` is local and does not publish. Run the tests before creating a local
tarball for an integration test:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack
```

Use a patched Node.js release for development and keep the lockfile. None of
the examples run a transaction on import. See the
[operator execution example](examples/gasless-operator.ts) and the dedicated
[operator repository](https://github.com/BuildTheTech/Switch-Operators-SDK)
(`GASLESS.md` in the companion local checkout).
