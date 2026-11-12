# 1.3.1 - 2026-11-11

- Clarify that frontends display expected gasless output as the main amount,
  show the slippage-adjusted minimum separately, and sign that exact minimum.
  Add field/editor guidance and update the browser example callback comments.
- Refresh the release documentation to reflect the published 1.3.0 helpers.
  Runtime behavior, fee policy and signed order construction are unchanged.

# 1.3.0 - 2026-11-11

GaslessSwitch V2 support.

- Clarify the mandatory fixed 0.1% gasless protocol fee and the separate capped
  operator payout. Document regular-only integrations for partners who do not
  want to offer that fee policy, including recovery of existing pending orders.
- Type the November 10 API eligibility summary, native gas/payout economics,
  conservative safety margins, funding status and rejection reasons. Existing
  preview eligibility checks honor the stricter live server recommendation.
- Expose that summary on both `GaslessQuoteDecision` branches, preserve API
  rejection reasons through `SERVER_INELIGIBLE`, reject stale/contradictory
  metadata, and retain the conservative reserve when current gas rises.
- Add dedicated PulseChain/Robinhood deployment and EIP-712 validation, full V2
  ABI, tax/fee-side selection, bound settlement previews, and conservative
  operator gas eligibility checks.
- Add refreshed single-click signing/submission, boosted approvals with an
  optional exact amount, atomic browser pending storage, transport recovery,
  chain-confirmed expiry handling, and settlement transaction links.
- Add operator contract classification, priority selection, payout/gas math,
  registration checks and validated fill encoding. Gasless uses a separate
  5 bps total-payout policy; ordinary limit orders retain their own policy.
- Add browser, server proxy, and operator examples and a dedicated integration
  guide. Examples are typechecked; tests are offline and never broadcast.
- Build ESM runtime files and declarations and point package exports to the
  built files, including the new gasless entry points and ABI.
