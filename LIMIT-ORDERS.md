# Switch Limit Orders — Integration Guide

> **Gasless EIP-712 signed limit orders on PulseChain**

**Limit Order API:** `https://quote.switch.win` &nbsp;|&nbsp; **Chain:** PulseChain (369)

---

## Table of Contents

0. [Installation](#installation)
1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [Creating a Limit Order](#creating-a-limit-order)
4. [Native PLS Limit Orders (PLSFlow)](#native-pls-limit-orders-plsflow)
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
- **WPLS unwrap** — if the output token is WPLS, it can be auto-unwrapped to native PLS

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
│       a. invalidateNonce(nonce) on-chain — prevents execution           │
│       b. DELETE /limit-orders — removes from backend orderbook          │
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
> *PLSFlow (native PLS) orders are the exception — they are recorded on-chain*
> *first, so the backend discovers them via event indexing even if the POST*
> *never arrives.*

---

## Creating a Limit Order

The full lifecycle in code (ethers.js v6):

```ts
import { ethers } from "ethers";
import {
  buildLimitOrder,
  getEIP712SigningParams,
  getApprovalTarget,
  getRouterApprovalTarget,
  submitLimitOrder,
} from "@switch-win/sdk/limit-orders";
import { ERC20_ABI } from "@switch-win/sdk/constants";

const provider = new ethers.JsonRpcProvider("https://rpc.pulsechain.com");
const signer = new ethers.Wallet(PRIVATE_KEY, provider);
const maker = await signer.getAddress();

// ── Step 1: Build the order ──
const order = buildLimitOrder({
  maker,
  tokenIn: "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",   // WPLS
  tokenOut: "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab",  // PLSX
  amountIn: ethers.parseUnits("1000", 18).toString(),       // 1000 WPLS
  minAmountOut: ethers.parseUnits("500000", 18).toString(), // min 500k PLSX
  deadline: Math.floor(Date.now() / 1000) + 86400,          // 24h expiry
  // nonce: auto-generated from Date.now()
  // feeOnOutput: false (default — fee taken from input)
  // recipient: maker (default — output goes to maker)
  // unwrapOutput: false (default)
});

// ── Step 2: Approve the correct contract (one-time per token + fee mode) ──
//   feeOnOutput=false (default) → LO contract pulls tokens → approve SWITCH_LIMIT_ORDER
//   feeOnOutput=true            → Router pulls tokens       → approve SWITCH_ROUTER
const approvalTarget = order.feeOnOutput
  ? getRouterApprovalTarget()   // SwitchRouter
  : getApprovalTarget();        // SwitchLimitOrder
const token = new ethers.Contract(order.tokenIn, ERC20_ABI, signer);
const allowance: bigint = await token.allowance(maker, approvalTarget);

if (allowance < BigInt(order.amountIn)) {
  const tx = await token.approve(approvalTarget, ethers.MaxUint256);
  await tx.wait();
}

// ── Step 3: Sign via EIP-712 (gasless!) ──
const { domain, types } = getEIP712SigningParams();
const signature = await signer.signTypedData(domain, types, order);

// ── Step 4: Submit to the Switch backend ──
// ⚠️ CRITICAL: The signature is off-chain only — if this POST fails,
// the order is lost. Submit IMMEDIATELY after signing, await the
// response, and retry on network failure.
const result = await submitLimitOrder({ ...order, signature });

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
| `unwrapOutput` | `boolean` | No | `false` | Unwrap WPLS to native PLS if tokenOut is WPLS |

---

## Native PLS Limit Orders (PLSFlow)

When selling **native PLS** (not WPLS), use the **PLSFlow** contract instead of the standard EIP-712 signing flow. This provides a simpler, single-transaction experience:

- **No approval needed** — users send PLS directly to the contract
- **No EIP-712 signature** — the contract creates the order on-chain immediately
- **Single transaction** — wrap + approve + place order all in one tx
- **Fully indexed** — the backend discovers orders via `PLSOrderCreated` events

### PLSFlow Contract Address

```ts
import { getPLSFlowAddress, PLS_FLOW_ABI } from "@switch-win/sdk";

const SWITCH_PLS_FLOW = getPLSFlowAddress();
// "0x79D1Ce697509D75D79c6cA8f9232ee6ca6Df379a"
```

### Creating a Native PLS Limit Order

```ts
import { ethers } from "ethers";
import { getPLSFlowAddress, isNativePLS } from "@switch-win/sdk/limit-orders";
import { PLS_FLOW_ABI, WPLS } from "@switch-win/sdk/constants";

const provider = new ethers.JsonRpcProvider("https://rpc.pulsechain.com");
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

// Check if we should use PLSFlow
const NATIVE_PLS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
if (isNativePLS(NATIVE_PLS)) {
  const plsFlow = new ethers.Contract(getPLSFlowAddress(), PLS_FLOW_ABI, signer);
  
  const tokenOut = "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab"; // PLSX
  const amountIn = ethers.parseUnits("1000", 18);                 // 1000 PLS
  const minAmountOut = ethers.parseUnits("500000", 18);           // min 500k PLSX
  const deadline = Math.floor(Date.now() / 1000) + 86400;         // 24h expiry
  const feeOnOutput = false;
  const unwrapOutput = false;

  // Single transaction — no approval, no signing
  const tx = await plsFlow.createOrder(
    tokenOut,
    minAmountOut,
    deadline,
    feeOnOutput,
    unwrapOutput,
    { value: amountIn }
  );
  
  const receipt = await tx.wait();
  console.log("PLS limit order created in tx:", receipt.hash);
  
  // The backend will automatically detect this order via PLSOrderCreated event.
  // No POST to /limit-orders required (though it's harmless if you do).
}
```

### PLSFlow vs EIP-712 Orders

| Aspect | PLSFlow (native PLS) | EIP-712 (ERC-20) |
|---|---|---|
| **Input token** | Native PLS only | Any ERC-20 (including WPLS) |
| **User experience** | Single transaction | Approve + Sign + Submit |
| **Gas cost** | User pays gas | Gasless signing (user pays on fill) |
| **Order discovery** | On-chain event | Requires successful POST |
| **Maker address** | PLSFlow contract | User's wallet |
| **Recipient** | User's wallet | User's wallet (or custom) |

### Important: Order Discovery

For PLSFlow orders, the `maker` field in the order record is the **PLSFlow contract address**, not the user's address. The actual user is stored in the `recipient` field.

When querying orders for a user, use the `owner` parameter instead of `maker`:

```ts
// ✅ Correct — finds both EIP-712 orders AND PLSFlow orders
const { orders } = await fetchLimitOrders({
  owner: "0xUserAddress",  // matches maker OR recipient
  status: "ACTIVE",
});

// ❌ Won't find PLSFlow orders
const { orders } = await fetchLimitOrders({
  maker: "0xUserAddress",  // only matches maker field
  status: "ACTIVE",
});
```

### Cancelling a PLSFlow Order

PLSFlow orders can be cancelled by the original creator (the `recipient`):

```ts
const plsFlow = new ethers.Contract(getPLSFlowAddress(), PLS_FLOW_ABI, signer);

// Cancel on-chain (only the original creator can call this)
const tx = await plsFlow.cancelOrder(nonceToCancel);
await tx.wait();

// The backend will detect the NonceCancelled event and update the order status.
// You can optionally also call DELETE /limit-orders to remove it immediately.
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

### Tax token decision guide

| Scenario | Recommended `feeOnOutput` | Why |
|---|---|---|
| **Neither token is taxed** | `false` (default) | Maximum operator flexibility → best chance of fill |
| **Input token is taxed** | `true` | Router sends tokens directly from maker → pool in one transfer (one tax). Default mode would do maker → LO → pool (two transfers, two taxes). |
| **Output token is taxed** | `false` (default) | Output goes directly to recipient in one transfer. |
| **Both tokens taxed** | Not supported | Frontend should block this combination. |

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
| `tokenIn` | `string` | — | Filter by input token |
| `tokenOut` | `string` | — | Filter by output token |
| `pair` | `string` | — | Filter by pair key (`tokenIn:tokenOut`, lowercased) |
| `limit` | `number` | `100` | Page size (1–500) |
| `offset` | `number` | `0` | Page offset |

---

## Cancelling a Limit Order

Cancellation is a **two-step process** — both steps are important:

1. **On-chain:** Call `invalidateNonce(nonce)` on the SwitchLimitOrder contract. This is the authoritative cancellation — it prevents any operator from executing the order even if the backend hasn't been notified yet.

2. **Backend:** Call `DELETE /limit-orders` (or `cancelLimitOrder()`) to remove the order from the active orderbook. This stops operators from even attempting to fill it.

```ts
import { ethers } from "ethers";
import { cancelLimitOrder } from "@switch-win/sdk/limit-orders";
import { SWITCH_LIMIT_ORDER, LIMIT_ORDER_ABI } from "@switch-win/sdk/constants";

const signer = new ethers.Wallet(PRIVATE_KEY, provider);
const maker = await signer.getAddress();
const nonceToCancel = 1717171717;

// Step 1: Invalidate the nonce on-chain (prevents fill)
const contract = new ethers.Contract(SWITCH_LIMIT_ORDER, LIMIT_ORDER_ABI, signer);
const tx = await contract.invalidateNonce(nonceToCancel);
await tx.wait();

// Step 2: Notify the backend (removes from orderbook)
const result = await cancelLimitOrder(maker, nonceToCancel);
if ("error" in result) {
  console.log(result.error); // e.g. "Order not found" or "Order already CANCELLED"
} else {
  console.log("Cancelled successfully");
}
```

To cancel **multiple orders** at once, use `invalidateNonces(uint256[])`:

```ts
const nonces = [1717171717, 1717171718, 1717171719];
const tx = await contract.invalidateNonces(nonces);
await tx.wait();

// Then cancel each on the backend
for (const nonce of nonces) {
  await cancelLimitOrder(maker, nonce);
}
```

---

## API Reference

**Base URL:** `https://quote.switch.win`

| Method | Path | Description |
|---|---|---|
| `POST` | `/limit-orders` | Submit a signed limit order |
| `DELETE` | `/limit-orders` | Cancel an order (by maker + nonce) |
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
> PLSFlow (native PLS) orders are the exception — they are recorded on-chain first,
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

### `DELETE /limit-orders`

Cancel an order by marking it `CANCELLED` in the database.

**Request body:**

```json
{
  "maker": "0x...",
  "nonce": 1717171717
}
```

**Success response:** `{ "success": true }`

### `GET /limit-orders`

List orders with optional query filters. See [Query Filters](#query-filters) above.

**Response:**

```json
{
  "total": 42,
  "limit": 100,
  "offset": 0,
  "orders": [{ ... }, { ... }]
}
```

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
| `CancelLimitOrderRequest` | `{ maker, nonce }` (DELETE body) |
| `LimitOrderStatus` | `"ACTIVE" \| "FILLED" \| "CANCELLED" \| "EXPIRED"` |
| `LimitOrderRecord` | Full order record from the API (includes `id`, `status`, timestamps) |
| `CreateLimitOrderResponse` | `{ success: true, order: LimitOrderRecord }` |
| `CancelLimitOrderResponse` | `{ success: true }` |
| `ListLimitOrdersResponse` | `{ total, limit, offset, orders: LimitOrderRecord[] }` |
| `LimitOrderPair` | Active pair with order count |
| `LimitOrderStats` | Global order statistics |
| `LimitOrderMutationResponse` | Union of mutation responses + `ErrorResponse` |

---

## Helper Functions

Available from `@switch-win/sdk/limit-orders`:

| Function | Description |
|---|---|
| `buildLimitOrder(options)` | Build a `LimitOrderParams` object with sensible defaults |
| `getEIP712SigningParams()` | Get the `{ domain, types }` for `signTypedData()` |
| `getApprovalTarget()` | Get approval target for `feeOnOutput: false` orders → SwitchLimitOrder |
| `getRouterApprovalTarget()` | Get approval target for `feeOnOutput: true` orders → SwitchRouter |
| `shouldUnwrapOutput(tokenOut)` | Returns `true` if tokenOut is WPLS (should set `unwrapOutput: true`) |
| `getPLSFlowAddress()` | Get the SwitchPLSFlow contract address for native PLS limit orders |
| `isNativePLS(tokenIn)` | Returns `true` if tokenIn is native PLS (use PLSFlow instead of EIP-712) |
| `submitLimitOrder(signedOrder)` | POST a signed order to the Switch backend |
| `cancelLimitOrder(maker, nonce)` | DELETE an order from the Switch backend |
| `fetchLimitOrders(options?)` | GET orders with optional filters |
| `fetchLimitOrder(maker, nonce)` | GET a single order by maker + nonce |
| `fetchLimitOrderPairs()` | GET active pairs with order counts |
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
| `TransferFailed()` | Token transfer failed (insufficient balance or allowance) |

---

*See also: [README.md](README.md) for swap API docs, constants, and general integration info.*

*Last updated: February 2026*
