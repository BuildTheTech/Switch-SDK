# Gasless SDK validation — November 9, 2026

## November 11 release candidate

The package and npm lockfile now agree on version `1.3.0`. The release guide,
README, examples and editor hints explain the fixed 0.1% gasless protocol fee,
the separate 0.05% total operator payout cap, and regular-only integrations.

The ESM/declaration build, strict library/example typechecks and all 90 offline
tests passed again before the main-branch merge. npm publication is pending.
The November 9–10 records below describe earlier local candidates.

## November 10 addendum

The November 9 results below are historical. Both quote APIs now apply a
stricter server recommendation: a 10% haircut to native payout valuation,
coverage exceeding twice the already-padded gas budget, real registered
operator native funds, and at least 50 bps of user-selected slippage.
Some swaps accepted by the older policy will correctly recommend Regular now.

The unpublished SDK adds optional types for `gaslessEligibility` and nested
`gaslessExecution.eligibility`, including native economics and rejection
reasons. `GaslessQuoteDecision.eligibility` exposes those details on both
branches. `SERVER_INELIGIBLE` preserves the server reason and retry semantics;
the client rejects stale, contradictory, weakened or unbound metadata and
reapplies the 2x reserve/10% payout haircut using fresh gas before signing.
The browser example exposes the summary through an optional UI callback.
Both SDK guides describe the complete response and distinguish a preflight
from an exact simulation of an existing signed order.

All 90 offline tests passed (67 earlier tests plus 23 eligibility regressions),
including a captured live policy-v1 quote, accepted/rejected client metadata,
missing checks, freshness, contradictory flags, operator funds and rising gas.
Strict library/example typechecks and the ESM/declaration build passed.
The packed ESM root/gasless/operator entries and a strict consumer typecheck
with only `lib=ES2022` (no DOM globals) also passed. The package manifest
excludes tests, fixtures, local artifacts and credentials.

New local tarball:
`artifacts/switch-win-sdk-gasless-eligibility-local-20261110.tgz`.
SHA-256: `298f80d6cfca82d9792594e8ec55ce917c883fc41e1adbb2aa75861b819e2b17`.
No SDK version bump, Git push, npm publication, live API/frontend deployment,
or Operator Engine release was performed by this SDK update. The November 9
tarball below is the earlier candidate.

Read-only checks against the updated public APIs accepted a large gasless
swap on each chain, rejected a 0.01 USDC Pulse swap with `GAS_NOT_COVERED`,
and returned `NOT_REQUESTED` for an ordinary quote. Backend validation covered
19 focused tests and a full strict typecheck. No live user order was sent.
Registration and wallet funds do not verify worker liveness; the new response
explicitly reports `operatorLivenessVerified: false`.

## November 9 record

Local branches: `feat/gasless-switch-sdk` in Switch-SDK and
`docs/gasless-switch-integration` in Switch-Operators-SDK. No push, publication,
release change, live deployment, approval, user-wallet signature, or order submission
was performed. The SDK package version remains `1.2.9` as an unreleased local
candidate. The pre-existing Robinhood operator-guide edit was preserved.

Local tarball: `artifacts/switch-win-sdk-gasless-local-20261109.tgz`.
SHA-256: `bc3ec68af5dd7abf2de3a65986740e706bb22638b9b01c96595669f2d345f31a`.

## Local checks

- Strict TypeScript checks passed for the library and all three new examples.
- All 67 offline tests passed. They cover address checksums, domain separation, contract/config
  drift, exact route/trade binding, gas and payout caps, directional taxes,
  native output/input handling, approval spender/boost, changed-quote signing,
  insufficient maker funds, lost/duplicate POST reconciliation, immutable
  signed fields, pending persistence across tabs, RPC/API outage recovery,
  chain expiry, settlement links, operator classification, and fill encoding.
- A captured live SWITCH→USDC multipath response at block `27995175` passes
  the SDK validator with its original checked minimum and output.
- The full V2 ABI was extracted from the compiled GaslessSwitchV2 artifact;
  minimal function selectors and fill return values match it.
- npm and Yarn lockfiles are synchronized. The production dependency audit
  reported zero known vulnerabilities at the time of the check.
- Local `npm pack` created a package containing built ESM, declarations, ABI,
  sources, guides and examples. No tests, fixture signing key, credentials,
  node_modules or local artifacts are in its file manifest.
- Installing that tarball into an isolated consumer passed root/subpath ESM
  imports and strict TypeScript with only `lib=ES2022` (no DOM library).
- The installed consumer bundled for a browser with no bundler warnings.
- Both repositories passed `git diff --check`.

## Read-only live checks

The checks used public RPCs and the existing public frontend quote proxy.
No signer or transaction-sending method was used.

| Check | Result |
| --- | --- |
| PulseChain config and on-chain V2 policy | Passed; policy snapshot block `28016728` |
| Robinhood config and on-chain V2 policy | Passed; policy snapshot block `110367026` |
| 64,411.401494724021134547 SWITCH → USDC | Eligible; output fee; native payout `3117512198583520742931` exceeds padded gas budget `1398582491613515906445` |
| 0.01 USDC → HEX | Correctly ineligible: insufficient operator payout |
| 100,000 HEX → VOUCH (tax token) | Eligible; input fee; native payout `11163697709603321244000` exceeds budget `6897630180497324205254` |
| 0.01 WETH → USDG on Robinhood | Correctly ineligible: insufficient operator payout |
| 0.1 WETH → USDG on Robinhood | Eligible; input fee; native payout `49950000000000` exceeds budget `21198912614880` |

Both gasless deployments report the expected 10 bps protocol fee, 5 bps total
operator cap, V2 domain, Router/wrapped-native bindings, active operator gate,
unpaused trading and Router fee exemption. Both Router fee floors separately
read 10 bps; the current frontend's Regular quote fee is 15 bps. These are
different settings, and gasless explicitly requests its own 10 bps preview.

## Integration limits

The API already supplies the settlement simulation, tax-aware recipient/payout
deltas and full gas estimate required by this SDK; no API deployment is needed
for this flow. The shared orderbook list has no documented gasless-only filter;
the operator guide explicitly requires pagination and a separate bounded
priority/retry lane rather than pretending such a filter exists.

Eligibility is a checked estimate. Market movement, gas changes, mutable token
behavior, operator availability, and wallet confirmation delays can prevent a
fill. Operators must simulate the exact existing signed order at execution.
The hosted API's EOA signature requirement and the legacy/current contract
distinction are documented. The operator repository contains integration
guides, not a newly released worker binary; public 1.1.4 downloads were retained
and 1.1.5 was not published.
