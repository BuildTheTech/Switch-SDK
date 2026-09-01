# Switch Limit Orders — Integration Guide

> **Gasless EIP-712 signed limit orders on PulseChain and Robinhood Chain**

**Limit Order API:** `https://quote.switch.win`

| API network | Chain ID | Native currency | Current limit-order contract | Native flow contract |
|---|---:|---|---|---|
| `pulsechain` | 369 | PLS | `0x2afBf0aB8d958a0227742F7a8BdA00c96372E4D7` | `0x0362177FF2ad25a33a879c881a5055575C63a4cE` |
| `robinhood` | 4663 | ETH | `0x1E05115387f314398bbb1A808B25308E71150396` | `0x8170a3B0e2FD2e4333E0Ca9c9414B2D3dd6aF689` |

Pass `network: "pulsechain"` or `network: "robinhood"` to every SDK API
helper. Call `fetchLimitOrderConfig({ network })` at startup and treat its
addresses and EIP-712 domain as the live source of truth.

---

## Table of Contents

0. [Installation](#installation)
1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [Creating a Limit Order](#creating-a-limit-order)
4. [Native Currency Limit Orders (SwitchPLSFlow)](#native-currency-limit-orders-switchplsflow)
5. [Choosing `feeOnOutput`](#choosing-feeonoutput)
6. [Querying Limit Orders](#querying-limit-orders)
7. [Cancelling a Limit Order](#cancelling-a-limit-order)
8. [API Reference](#api-reference)
9. [Types Reference](#types-reference)
10. [Helper Functions](#helper-functions)
11. [EIP-712 Signing Details](#eip-712-signing-details)
12. [On-Chain Revert Errors](#on-chain-revert-errors)

---

## Installation

```bash
npm install @switch-win/sdk
# or
yarn add @switch-win/sdk
# or
pnpm add @switch-win/sdk
```

---

## Overview

Switch Limit Orders let users place **gasless, signed orders** that are filled automatically when market conditions are met. Orders use **EIP-712 typed data signatures** — no tokens are deposited or locked.

**Key properties:**

- **No gas to create** — orders are signed off-chain and submitted to the Switch backend via REST API
- **No token deposit** — tokens stay in the maker's wallet until the order is filled
- **One approval per order type:**
  - `feeOnOutput: false` (default) → approve **SwitchLimitOrder** (`getApprovalTarget()`)
  - `feeOnOutput: true` → approve **SwitchRouter** (`getRouterApprovalTarget()`)
- **EIP-712 signed** — standard typed data signatures, supported by all major wallets
- **Nonce-based replay protection** — each order has a unique nonce per maker
- **Optional expiry** — set a deadline or make the order valid forever
- **Custom recipient** — output tokens can be sent to a different address
- **Native unwrap** — WPLS can be unwrapped to PLS and Robinhood WETH can be
  unwrapped to ETH by setting `unwrapOutput`

> **⚠️ Important:** The `SWITCH_LIMIT_ORDER` address is the **current** default. The contract may be redeployed (e.g. when the router is upgraded). Each order returned by the API includes a `limitOrderContract` field — **always use the contract address from the order for on-chain interactions (approvals, cancellations), not a hardcoded constant.** This ensures your integration works seamlessly across contract versions without code changes.

### Network-aware setup

```ts
import {
  fetchLimitOrderConfig,
  getLimitOrderApprovalTarget,
  getNetworkEIP712SigningParams,
  submitLimitOrder,
} from "@switch-win/sdk/limit-orders";

// `signer` and a completed `order` are assumed below.
const network = "robinhood" as const;
const live = await fetchLimitOrderConfig({ network });
const { domain, types } = getNetworkEIP712SigningParams(
  network,
  live.limitOrderContract,
);
const approvalTarget = getLimitOrderApprovalTarget(network, order.feeOnOutput, {
  limitOrderContract: live.limitOrderContract,
});
const signature = await signer.signTypedData(domain, types, order);
await submitLimitOrder(
  { ...order, signature, limitOrderContract: live.limitOrderContract },
  { network },
);
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. APPROVE — one-time per token + fee mode                             │
│       feeOnOutput=false → approve SwitchLimitOrder (getApprovalTarget)  │
│       feeOnOutput=true  → approve SwitchRouter (getRouterApprovalTarget)│
│                                                                         │
│  2. SIGN — EIP-712 typed data (gasless, no transaction)                 │
│                                                                         │
│  3. SUBMIT — POST /limit-orders to Switch backend                       │
│       ⚠️  CRITICAL: submit IMMEDIATELY after signing and AWAIT success  │
│       The signature is off-chain only — if the POST never arrives,      │
│       the order is permanently lost. See critical notes below.          │
│                                                                         │
│  4. FILL — automated by Switch operators when conditions are met        │
│       Tokens are pulled from the maker's wallet and swapped.            │
│       Output is sent to the maker (or custom recipient).                │
│                                                                         │
│  5. CANCEL (optional)                                                   │
│       invalidateNonce(nonce) on-chain — prevents execution              │
│       The backend indexer observes the cancellation event.              │
└─────────────────────────────────────────────────────────────────────────┘
```

> **⚠️ Why the POST is critical (ERC-20 orders)**
>
> For standard ERC-20 limit orders, the EIP-712 signature is **purely off-chain**.
> Nothing is recorded on-chain until an operator fills the order. The backend
> only knows about the order because your integration POSTed it.
>
> If the POST never arrives — user closes the browser, network error, frontend
> navigates away — **the order is permanently lost**. No one can fill it.
>
> Your integration must:
> 1. Call `submitLimitOrder()` **immediately** after the user signs.
> 2. **Await** the response and confirm `success: true` before showing "order created".
> 3. **Retry** on transient failures — the backend is idempotent on `maker + nonce`.
> 4. Do **not** navigate away or close the signing flow until the backend confirms.
>
> *Native PLS/ETH flow orders are the exception — they are recorded on-chain*
> *first, so the backend discovers them via event indexing even if the POST*
> *never arrives.*

---

## Creating a Limit Order

The full lifecycle in code (ethers.js v6):

```ts
import { ethers } from "ethers";
import {
  buildLimitOrder,
  fetchLimitOrderConfig,
  getLimitOrderApprovalTarget,
  getNetworkEIP712SigningParams,
  submitLimitOrder,
} from "@switch-win/sdk/limit-orders";
import { ERC20_ABI } from "@switch-win/sdk/constants";

const network = "robinhood" as const;
const provider = new ethers.JsonRpcProvider("https://rpc.mainnet.chain.robinhood.com");
const signer = new ethers.Wallet(PRIVATE_KEY, provider);
const maker = await signer.getAddress();
const live = await fetchLimitOrderConfig({ network });

// ── Step 1: Build the order ──
const order = buildLimitOrder({
  maker,
  tokenIn: "0x0Bd7D308f8E1639FAb988Df18A8011f41EAcAD73",   // WETH
  tokenOut: "0x5fc5360D0400a0Fd4F2aF552aDD042D716F1d168",  // USDG
  amountIn: ethers.parseUnits("0.01", 18).toString(),
  minAmountOut: ethers.parseUnits("30", 18).toString(),
  deadline: Math.floor(Date.now() / 1000) + 86400,          // 24h expiry
  // nonce: auto-generated from Date.now()
  // feeOnOutput: false (default — fee taken from input)
  // recipient: maker (default — output goes to maker)
  // unwrapOutput: false (default)
});

// ── Step 2: Approve the correct contract (one-time per token + fee mode) ──
//   feeOnOutput=false (default) → approve this network's LO contract
//   feeOnOutput=true            → approve this network's SwitchRouter
const approvalTarget = getLimitOrderApprovalTarget(network, order.feeOnOutput, {
  limitOrderContract: live.limitOrderContract,
});
const token = new ethers.Contract(order.tokenIn, ERC20_ABI, signer);
const allowance: bigint = await token.allowance(maker, approvalTarget);

if (allowance < BigInt(order.amountIn)) {
  const tx = await token.approve(approvalTarget, ethers.MaxUint256);
  await tx.wait();
}

// ── Step 3: Sign via EIP-712 (gasless!) ──
const { domain, types } = getNetworkEIP712SigningParams(
  network,
  live.limitOrderContract,
);
const signature = await signer.signTypedData(domain, types, order);

// ── Step 4: Submit to the Switch backend ──
// ⚠️ CRITICAL: The signature is off-chain only — if this POST fails,
// the order is lost. Submit IMMEDIATELY after signing, await the
// response, and retry on network failure.
const result = await submitLimitOrder(
  { ...order, signature, limitOrderContract: live.limitOrderContract },
  { network },
);

if ("error" in result) {
  // Retry logic recommended here — the backend is idempotent on maker+nonce
  console.error("Failed:", result.error);
} else {
  console.log("Order created:", result.order.id);
  console.log("Status:", result.order.status); // "ACTIVE"
}
```

### Order Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `maker` | `string` | Yes | — | Maker (signer) address |
| `tokenIn` | `string` | Yes | — | Input token address (token being sold) |
| `tokenOut` | `string` | Yes | — | Output token address (token being bought) |
| `amountIn` | `string` | Yes | — | Amount of tokenIn in wei |
| `minAmountOut` | `string` | Yes | — | Minimum acceptable output in wei |
| `deadline` | `number` | No | `0` | Unix timestamp expiry. `0` = no expiry |
| `nonce` | `number` | No | `Date.now()` | Unique per maker. Auto-generated if omitted |
| `feeOnOutput` | `boolean` | No | `false` | Fee mode — see [Choosing `feeOnOutput`](#choosing-feeonoutput) below |
| `recipient` | `string` | No | `maker` | Address to receive output tokens |
| `unwrapOutput` | `boolean` | No | `false` | Unwrap wrapped native output to PLS/ETH on the selected network |

---

## Native Currency Limit Orders (SwitchPLSFlow)

When selling native **PLS** on PulseChain or native **ETH** on Robinhood
(rather than WPLS/WETH), use the selected network's native-flow contract
instead of the standard EIP-712 signing flow. The deployed contract retains
the legacy `SwitchPLSFlow` name on both networks, but its behavior is
native-currency neutral:

- **No approval needed** — users send the native currency directly to the contract
- **No EIP-712 signature** — the contract creates the order on-chain immediately
- **Single transaction** — wrap + approve + place order all in one tx
- **Fully indexed** — the backend discovers orders via `PLSOrderCreated` events
- **Drain-mode capable** — maintainers can disable new native deposits without
  blocking fills or cancellations of existing orders

> **Current ABI:** native-flow deployments use the seven-argument
> `createOrder(tokenOut, minAmountOut, deadline, feeOnOutput, unwrapOutput,
> partnerAddress, recipient)` signature. The `recipient` argument must be
> present in calldata; pass the zero address to default it to `msg.sender`.
> The older six-argument selector is not compatible with current deployments.

### Native-flow contract address

```ts
import { getNativeFlowAddress, PLS_FLOW_ABI } from "@switch-win/sdk";

const robinhoodNativeFlow = getNativeFlowAddress("robinhood");
// "0x8170a3B0e2FD2e4333E0Ca9c9414B2D3dd6aF689"
```

### Creating a native ETH limit order on Robinhood

```ts
import { ethers } from "ethers";
import { getNativeFlowAddress, isNativeCurrency } from "@switch-win/sdk/limit-orders";
import { PLS_FLOW_ABI } from "@switch-win/sdk/constants";

const network = "robinhood" as const;
const provider = new ethers.JsonRpcProvider("https://rpc.mainnet.chain.robinhood.com");
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
if (isNativeCurrency(NATIVE)) {
  const nativeFlow = new ethers.Contract(
    getNativeFlowAddress(network),
    PLS_FLOW_ABI,
    signer,
  );
  
  const tokenOut = "0x5fc5360D0400a0Fd4F2aF552aDD042D716F1d168"; // USDG
  const amountIn = ethers.parseEther("0.01");
  const minAmountOut = ethers.parseUnits("30", 18);
  const deadline = Math.floor(Date.now() / 1000) + 86400;         // 24h expiry
  const feeOnOutput = false;
  const unwrapOutput = false;

  // Single transaction — no approval, no signing
  const tx = await nativeFlow.createOrder(
    tokenOut,
    minAmountOut,
    deadline,
    feeOnOutput,
    unwrapOutput,
    ethers.ZeroAddress,      // partnerAddress (0x0 = no partner)
    ethers.ZeroAddress,      // recipient (0x0 = defaults to msg.sender)
    { value: amountIn }
  );
  
  const receipt = await tx.wait();
  console.log("Native ETH limit order created in tx:", receipt.hash);
  
  // The backend will automatically detect this order via PLSOrderCreated event.
  // No POST to /limit-orders required (though it's harmless if you do).
}
```

### Native flow vs EIP-712 orders

| Aspect | Native flow (PLS/ETH) | EIP-712 (ERC-20) |
|---|---|---|
| **Input token** | Native currency | Any ERC-20 (including WPLS/WETH) |
| **User experience** | Single transaction | Approve + Sign + Submit |
| **Gas cost** | User pays gas | Gasless signing (user pays on fill) |
| **Order discovery** | On-chain event | Requires successful POST |
| **Maker address** | Native-flow contract | User's wallet |
| **Recipient** | User's wallet (or custom) | User's wallet (or custom) |

### Important: Order Discovery

For native-flow orders, the `maker` field in the order record is the
**native-flow contract address**, not the user's address. The actual user is
stored in the `recipient` field.

When querying orders for a user, use the `owner` parameter instead of `maker`:

```ts
// ✅ Correct — finds both EIP-712 and native-flow orders
const { orders } = await fetchLimitOrders({
  network: "robinhood",
  owner: "0xUserAddress",  // matches maker OR recipient
  status: "ACTIVE",
});

// ❌ Won't find native-flow orders
const { orders } = await fetchLimitOrders({
  network: "robinhood",
  maker: "0xUserAddress",  // only matches maker field
  status: "ACTIVE",
});
```

### Cancelling a native-flow order

Native-flow orders can be cancelled by the original creator (`recipient`):

```ts
const nativeFlow = new ethers.Contract(
  getNativeFlowAddress("robinhood"),
  PLS_FLOW_ABI,
  signer,
);

// Cancel on-chain (only the original creator can call this)
const tx = await nativeFlow.cancelOrder(nonceToCancel);
await tx.wait();

// The backend will detect the NonceCancelled event and update the order status.
// No REST mutation is required.
```

---

## Choosing `feeOnOutput`

The `feeOnOutput` flag is **baked into the signed order** and cannot be changed after signing. It controls which contract the maker must approve **and** how flexibly operators (fillers) can execute the order. Choose carefully — it affects your order's fillability.

### Approval target

| `feeOnOutput` | Maker approves | SDK helper |
|---|---|---|
| `false` (default) | **SwitchLimitOrder** — LO contract pulls tokens from maker, then routes internally | `getApprovalTarget()` |
| `true` | **SwitchRouter** — Router pulls tokens directly from maker to pool(s) | `getRouterApprovalTarget()` |

Only **one** approval is needed per fee mode, but the target is different.

### Operator (filler) flexibility

Operators choose how to take their profit when filling an order: either from **excess input** (route less than `amountIn`, keep the unrouted tokens) or from **output surplus** (route all input, keep output above `minAmountOut`).

| `feeOnOutput` | Excess from input | Excess from output |
|---|---|---|
| `false` | ✅ Always works | ✅ Always works |
| `true` | ⚠️ Requires maker approved **both** LO + Router | ✅ Always works |

When `feeOnOutput=false`, the LO contract pulls all tokens to itself first — operators have full freedom to optimize their profit-taking strategy.

When `feeOnOutput=true`, the Router pulls tokens directly from the maker. If an operator also tries to take excess input via the LO contract, that requires a second approval the maker typically hasn't granted — the transaction would simply revert. The operator loses gas; the maker loses nothing and the order remains active for another operator. In practice, operators use output-side profit for `feeOnOutput=true` orders.

> **Impact on fillability:** `feeOnOutput=true` orders are still fully fillable, but operators have less flexibility. In tight-margin or low-liquidity situations, this *could* reduce the likelihood of a fill since operators cannot optimize their profit-taking strategy on both sides.

### Protected settlement

The current PulseChain and Robinhood deployments charge a 30 bps (0.30%)
limit-order fee. They are exempt from the Router's separate 10 bps regular-swap
fee, so the two fees are not stacked.

For routed fills, operator-retained surplus is capped at 5%. Input-side profit
is capped at 5% of executable input; output-side profit is capped at 5% of the
signed `minAmountOut`. Any additional routing improvement is returned to the
maker.

Direct fills are protected by the configured `directFillQuoter`. The maker must
receive at least the greater of the signed `minAmountOut` and 95% of the best
current direct-adapter quote. A missing or zero protected quote fails closed,
and any post-fee output sent above the protected floor belongs to the maker.

### Tax token decision guide

| Scenario | Recommended `feeOnOutput` | Why |
|---|---|---|
| **Neither token is taxed** | `false` (default) | Maximum operator flexibility → best chance of fill |
| **Input token is taxed** | `true` | Router sends tokens directly from maker → pool in one transfer (one tax). Default mode would do maker → LO → pool (two transfers, two taxes). |
| **Output token is taxed** | `false` (default) | Output goes directly to recipient in one transfer. |
| **Both tokens taxed** | `false` | Supported through tax-safe routes; fee on input avoids another output-token transfer. |

> **Recommendation:** Use `feeOnOutput: false` (the default) unless the input token has a transfer tax. This gives operators the most flexibility and the best chance of filling your order.

---

## Querying Limit Orders

```ts
import {
  fetchLimitOrders,
  fetchLimitOrder,
  fetchLimitOrderPairs,
  fetchLimitOrderStats,
} from "@switch-win/sdk/limit-orders";

// All active orders for a maker
const { orders, total } = await fetchLimitOrders({
  maker: "0xYourAddress",
  status: "ACTIVE",
});

// All orders for a user (includes native-PLS orders where user is recipient)
const { orders: allMyOrders } = await fetchLimitOrders({
  owner: "0xYourAddress",
  status: "ACTIVE",
});

// Single order by maker + nonce
const order = await fetchLimitOrder("0xYourAddress", 1717171717);

// Active trading pairs with order counts
const pairs = await fetchLimitOrderPairs();
// [{ pairKey: "0xwpls:0xplsx", tokenIn: "0x...", tokenOut: "0x...", activeOrders: 42 }]

// Global summary stats
const stats = await fetchLimitOrderStats();
// { active: 150, filled: 3200, cancelled: 45, expired: 12, total: 3407 }
```

### Query Filters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | `"ACTIVE" \| "FILLED" \| "CANCELLED" \| "EXPIRED"` | `"ACTIVE"` | Filter by order status |
| `maker` | `string` | — | Filter by maker address |
| `owner` | `string` | — | Filter by owner (matches maker OR recipient) |
| `partnerAddress` | `string` | — | Filter by partner address stored on the order |
| `tokenIn` | `string` | — | Filter by input token |
| `tokenOut` | `string` | — | Filter by output token |
| `pair` | `string` | — | Filter by pair key (`tokenIn:tokenOut`, lowercased) |
| `limit` | `number` | `100` | Page size (1–500) |
| `offset` | `number` | `0` | Page offset |

> Each order record returned by the API includes the original `partnerAddress` used when the order was created, plus the `limitOrderContract` that should be used for on-chain cancellation/fill interactions.

---

## Cancelling a Limit Order

Cancellation is an **on-chain operation**:

1. **On-chain:** Call `invalidateNonce(nonce)` on the **order's** SwitchLimitOrder contract. This is the authoritative cancellation — it prevents any operator from executing the order even if the backend hasn't been notified yet.

   > **⚠️** Each order includes a `limitOrderContract` field. Always use that address — do not hardcode a single contract constant, as the contract may be redeployed across versions.

The backend indexer observes `NonceCancelled` and updates the orderbook. No
separate REST mutation is required.

```ts
import { ethers } from "ethers";
import { LIMIT_ORDER_ABI } from "@switch-win/sdk/constants";

const signer = new ethers.Wallet(PRIVATE_KEY, provider);
const maker = await signer.getAddress();
const nonceToCancel = 1717171717;

// Step 1: Invalidate the nonce on-chain (prevents fill)
// ⚠️ Use order.limitOrderContract — not a hardcoded address
const contract = new ethers.Contract(order.limitOrderContract, LIMIT_ORDER_ABI, signer);
const tx = await contract.invalidateNonce(nonceToCancel);
await tx.wait();

// The backend indexer observes the event and marks the order CANCELLED.
```

To cancel **multiple orders** at once, use `invalidateNonces(uint256[])`:

```ts
const nonces = [1717171717, 1717171718, 1717171719];
const tx = await contract.invalidateNonces(nonces);
await tx.wait();

// The backend indexer observes each NonceCancelled event.
```

---

## API Reference

**Base URL:** `https://quote.switch.win`

| Method | Path | Description |
|---|---|---|
| `POST` | `/limit-orders` | Submit a signed limit order |
| `GET` | `/limit-orders` | List orders (with query filters) |
| `GET` | `/limit-orders/pairs` | Active pairs with order counts |
| `GET` | `/limit-orders/stats` | Summary statistics |
| `GET` | `/limit-orders/:maker/:nonce` | Single order by maker + nonce |

### `POST /limit-orders`

Submit a signed limit order. The backend verifies the EIP-712 signature before storing.

> **⚠️ CRITICAL — Post immediately after signing.** For standard ERC-20 orders, the
> EIP-712 signature is purely off-chain. Nothing is recorded on-chain until an operator
> fills the order. If this POST never arrives (user closes browser, network
> error, frontend navigates away), **the order is permanently lost**.
>
> Your integration must:
> 1. Call `submitLimitOrder()` **immediately** after the user signs.
> 2. **Await** the response and confirm `success: true` before showing "order created".
> 3. **Retry** on transient failures — the backend is idempotent on `maker + nonce`.
>
> Native PLS/ETH flow orders are the exception — they are recorded on-chain first,
> so the backend discovers them via event indexing even if the POST never arrives.

**Request body:**

```json
{
  "maker": "0x...",
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "amountIn": "1000000000000000000",
  "minAmountOut": "500000000000000000000",
  "deadline": 1717257600,
  "nonce": 1717171717,
  "feeOnOutput": false,
  "recipient": "0x...",
  "unwrapOutput": false,
  "limitOrderContract": "0x...",
  "signature": "0x..."
}
```

**Success response (201):**

```json
{
  "success": true,
  "order": {
    "id": "clx...",
    "maker": "0x...",
    "tokenIn": "0x...",
    "tokenOut": "0x...",
    "amountIn": "1000000000000000000",
    "minAmountOut": "500000000000000000000",
    "deadline": 1717257600,
    "nonce": 1717171717,
    "feeOnOutput": false,
    "recipient": "0x...",
    "unwrapOutput": false,
    "partnerAddress": "0x0000000000000000000000000000000000000000",
    "limitOrderContract": "0x...",
    "signature": "0x...",
    "pairKey": "0x...:0x...",
    "status": "ACTIVE",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

**Error responses:**

| Error | Cause |
|---|---|
| `"Missing required field: ..."` | A required field is missing from the body |
| `"Invalid address format"` | One of the address fields is not a valid hex address |
| `"tokenIn and tokenOut must differ"` | Trying to create an order that swaps a token to itself |
| `"Invalid signature"` | EIP-712 signature verification failed |
| `"Signature does not match maker"` | The recovered signer doesn't match the `maker` field |
| `"Nonce N already used for maker 0x..."` | This nonce has already been used (filled or submitted) |

### `GET /limit-orders`

List orders with optional query filters. See [Query Filters](#query-filters) above.

**Response:**

```json
{
  "total": 42,
  "limit": 100,
  "offset": 0,
  "orders": [
    {
      "id": "clx...",
      "maker": "0x...",
      "recipient": "0x...",
      "tokenIn": "0x...",
      "tokenOut": "0x...",
      "amountIn": "1000000000000000000",
      "minAmountOut": "500000000000000000000",
      "deadline": 1717257600,
      "nonce": 1717171717,
      "feeOnOutput": false,
      "unwrapOutput": false,
      "partnerAddress": "0xYourPartnerAddress",
      "limitOrderContract": "0x...",
      "signature": "0x...",
      "pairKey": "0x...:0x...",
      "status": "ACTIVE",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z",
      "filledTxHash": null,
      "filler": null,
      "fillerProfit": null
    }
  ]
}
```

The backend currently returns the full order record, so integrations should expect at least the fields above and tolerate additional metadata fields in future deployments.

### `GET /limit-orders/pairs`

Returns active trading pairs with order counts.

```json
[
  { "pairKey": "0xwpls:0xplsx", "tokenIn": "0x...", "tokenOut": "0x...", "activeOrders": 12 }
]
```

### `GET /limit-orders/stats`

Summary statistics.

```json
{ "active": 150, "filled": 3200, "cancelled": 45, "expired": 12, "total": 3407 }
```

---

## Types Reference

> All types are available in [`src/types.ts`](src/types.ts).

| Type | Description |
|---|---|
| `LimitOrderParams` | Order fields for EIP-712 signing |
| `SignedLimitOrder` | `LimitOrderParams` + `signature` |
| `CreateLimitOrderRequest` | Alias for `SignedLimitOrder` (POST body) |
| `LimitOrderStatus` | `"ACTIVE" \| "FILLED" \| "CANCELLED" \| "EXPIRED"` |
| `LimitOrderRecord` | Full order record from the API (includes `partnerAddress`, `limitOrderContract`, status, and timestamps) |
| `CreateLimitOrderResponse` | `{ success: true, order: LimitOrderRecord }` |
| `ListLimitOrdersResponse` | `{ total, limit, offset, orders: LimitOrderRecord[] }` |
| `LimitOrderPair` | Active pair with order count |
| `LimitOrderStats` | Global order statistics |
| `LimitOrderMutationResponse` | Submission response + `ErrorResponse` |

---

## Helper Functions

Available from `@switch-win/sdk/limit-orders`:

| Function | Description |
|---|---|
| `buildLimitOrder(options)` | Build a `LimitOrderParams` object with sensible defaults |
| `getEIP712SigningParams()` | Get the `{ domain, types }` for `signTypedData()` |
| `getNetworkEIP712SigningParams(network, contract?)` | Build the correct PulseChain or Robinhood EIP-712 domain |
| `getLimitOrderNetworkConfig(network)` | Get static chain, router, LO, wrapped-native, and native-flow defaults |
| `getLimitOrderApprovalTarget(network, feeOnOutput, overrides?)` | Resolve the correct maker approval target |
| `getApprovalTarget()` | Get approval target for `feeOnOutput: false` orders → SwitchLimitOrder |
| `getRouterApprovalTarget()` | Get approval target for `feeOnOutput: true` orders → SwitchRouter |
| `shouldUnwrapOutput(tokenOut)` | Returns `true` if tokenOut is WPLS (should set `unwrapOutput: true`) |
| `getPLSFlowAddress()` | Get the SwitchPLSFlow contract address for native PLS limit orders |
| `getNativeFlowAddress(network)` | Get the native PLS/ETH flow address for either chain |
| `isNativePLS(tokenIn)` | Returns `true` if tokenIn is native PLS (use PLSFlow instead of EIP-712) |
| `isNativeCurrency(tokenIn)` | Network-neutral native sentinel check |
| `submitLimitOrder(signedOrder)` | POST a signed order to the Switch backend |
| `fetchLimitOrders(options?)` | GET orders with optional filters |
| `fetchLimitOrder(maker, nonce)` | GET a single order by maker + nonce |
| `fetchLimitOrderPairs()` | GET active pairs with order counts |
| `fetchLimitOrderConfig({ network })` | GET live deployments and EIP-712 domain |
| `fetchLimitOrderStats()` | GET global order statistics |

---

## EIP-712 Signing Details

The EIP-712 domain and types must match the on-chain contract exactly:

```ts
// Domain
{
  name: "SwitchLimitOrder",
  version: "2",
  chainId: 369,
  verifyingContract: SWITCH_LIMIT_ORDER  // must match deployed address
}

// Types
{
  LimitOrder: [
    { name: "maker",        type: "address" },
    { name: "tokenIn",      type: "address" },
    { name: "tokenOut",     type: "address" },
    { name: "amountIn",     type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "deadline",     type: "uint256" },
    { name: "nonce",        type: "uint256" },
    { name: "feeOnOutput",  type: "bool"    },
    { name: "recipient",    type: "address" },
    { name: "unwrapOutput", type: "bool"    },
    { name: "partnerAddress", type: "address" },
  ]
}
```

These are exported as `LIMIT_ORDER_EIP712_DOMAIN` and `LIMIT_ORDER_EIP712_TYPES` from `@switch-win/sdk/constants`.

---

## On-Chain Revert Errors

| Error | Meaning |
|---|---|
| `ExcessiveFee()` | Contract fee exceeds the maximum allowed |
| `InsufficientOutput()` | Output fell below `minAmountOut` |
| `InvalidAmount()` | Order amount is zero |
| `InvalidSignature()` | EIP-712 signature doesn't recover to the maker |
| `InvalidTokens()` | tokenIn and tokenOut are the same, or zero address |
| `NonceAlreadyUsed()` | This nonce has already been filled or invalidated |
| `OrderExpired()` | `block.timestamp > deadline` (and deadline > 0) |
| `RouteInputExceedsMax()` | Route's total input exceeds the order's `amountIn` |
| `NativeFlowInputNotFullyConsumed()` | Native-flow output-surplus route did not consume all executable input |
| `RouteTokenInMismatch()` | A route does not start with the signed input token |
| `RouteTokenOutMismatch()` | A route does not end with the signed output token |
| `DirectFillQuoteUnavailable()` | The protected direct-fill quote is missing or zero |
| `DirectFillPriceTooLow()` | The maker would receive less than the protected direct-fill floor |
| `TransferFailed()` | Token transfer failed (insufficient balance or allowance) |

---

*See also: [README.md](README.md) for swap API docs, constants, and general integration info.*

*Last updated: August 2026*
