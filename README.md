# Switch SDK

[![npm version](https://img.shields.io/npm/v/@switch-win/sdk.svg)](https://www.npmjs.com/package/@switch-win/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@switch-win/sdk.svg)](https://www.npmjs.com/package/@switch-win/sdk)

> **Official integration kit for the Switch DEX Aggregator on PulseChain and Robinhood Chain**

Everything partners need to integrate Switch swaps and limit orders — API docs, TypeScript types, ABIs, constants, and ready-to-use examples.

**Swap API:** `https://quote.switch.win` &nbsp;|&nbsp; **Swap chains:** PulseChain (369), Robinhood Chain (4663) &nbsp;|&nbsp; **Limit orders:** PulseChain and Robinhood Chain

---

## Contents

```
Switch-SDK/
├── README.md                          # This file — swap API & general integration guide
├── LIMIT-ORDERS.md                    # Limit order integration guide (includes PLSFlow)
├── src/
│   ├── index.ts                       # Main entry — re-exports everything
│   ├── types.ts                       # TypeScript types (swap + limit orders)
│   ├── constants.ts                   # PulseChain addresses, ABIs, EIP-712, PLSFlow config
│   ├── networks/
│   │   └── robinhood.ts               # Robinhood metadata, contracts, tokens, quote URL helper
│   └── limit-orders.ts               # Limit order helpers (build, sign, submit, query, PLSFlow)
├── abi/
│   ├── SwitchRouterABI.json           # Full SwitchRouter contract ABI
│   └── SwitchLimitOrderABI.json      # Full SwitchLimitOrder contract ABI
├── examples/
│   ├── swap-ethers.ts                 # Complete swap example (ethers.js v6)
│   ├── swap-web3py.py                 # Complete swap example (web3.py)
│   ├── limit-order-ethers.ts          # Complete limit order example (ethers.js v6)
│   ├── nextjs-proxy.ts               # Next.js API route proxy for key security
│   └── react-hooks.tsx                # React hooks for quote, adapters & tax
└── package.json
```

---

## Table of Contents

0. [Installation](#installation)

### Swaps

1. [Quickstart](#quickstart)
2. [Robinhood Chain](#robinhood-chain)
3. [Authentication](#authentication)
4. [Swap Integration Flow](#swap-integration-flow)
5. [Swap API Reference](#swap-api-reference)
6. [Error Handling](#error-handling)
7. [Partner Fee Sharing](#partner-fee-sharing)

### Limit Orders

8. [Limit Orders](#limit-orders) — full guide in [`LIMIT-ORDERS.md`](LIMIT-ORDERS.md)

### General

9. [Constants & Addresses](#constants--addresses)
10. [Full Integration Examples](#full-integration-examples)
11. [Rate Limits](#rate-limits)
12. [Support](#support)

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

## Quickstart

Get a swap quote and execute it in **three steps**:

```bash
# 1. Get quote with tx calldata
curl -H "x-api-key: YOUR_KEY" \
  "https://quote.switch.win/swap/quote?network=pulsechain&from=0xA1077a294dDE1B09bB078844df40758a5D0f9a27&to=0x95B303987A60C71504D99Aa1b13B4DA07b0790ab&amount=1000000000000000000&sender=0xYOUR_WALLET&slippage=100"

# 2. Approve the SwitchRouter to spend your input token (ERC-20 only; skip for native currency)

# 3. Send the transaction using the `tx` object from the response:
#    { to: "0x0305...", data: "0x...", value: "0" }
#    ⚠️ Always use tx.to — do NOT hardcode the router address
```

### Using the SDK types (TypeScript)

```ts
import { SWITCH_ROUTER, QUOTE_ENDPOINT } from "@switch-win/sdk/constants";
import type { BestPathResponse } from "@switch-win/sdk/types";

// 1. Get quote
const res = await fetch(
  `${QUOTE_ENDPOINT}?network=pulsechain&from=${fromToken}&to=${toToken}&amount=${amount}&sender=${wallet}&slippage=100`,
  { headers: { "x-api-key": KEY } },
);
const quote: BestPathResponse = await res.json();

// 2. Approve SwitchRouter (ERC-20 only — skip for native currency)
const token = new ethers.Contract(fromToken, ["function approve(address,uint256)"], signer);
await (await token.approve(SWITCH_ROUTER, amount)).wait();

// 3. Send the swap — always use quote.tx which includes the correct router address
await signer.sendTransaction(quote.tx);
```

> **⚠️ Always use `tx.to` from the quote response** when sending swap transactions. Do NOT hardcode the router address — the contract may be redeployed.

For a production integration with tax token handling, adapter filtering, and fee mode selection, see [Swap Integration Flow](#swap-integration-flow) and the [full examples](examples/).

### Robinhood Chain

Robinhood uses the same quote endpoint; set `network=robinhood`. The dedicated
module includes canonical chain metadata, deployed Switch contracts, vetted
routing hubs, and a URL builder that always includes the correct network.
The production router exposes nineteen adapters across Uniswap, SwapHood,
Up33, Sheriff, Aeon, Catnip, PancakeSwap, RobinSwap, SushiSwap, GIGA, Flap,
Ramses, and Switch limit orders. `ROBINHOOD_ADAPTERS` contains a typed snapshot;
fetch `/swap/adapters?network=robinhood` when runtime freshness matters.

For network configuration, deployed addresses, tax handling, execution, and
the complete frontend token list, see [`ROBINHOOD.md`](ROBINHOOD.md).

```ts
import {
  ROBINHOOD_NATIVE_ETH,
  ROBINHOOD_TOKENS,
  buildRobinhoodQuoteUrl,
} from "@switch-win/sdk/networks/robinhood";

const url = buildRobinhoodQuoteUrl({
  from: ROBINHOOD_NATIVE_ETH,
  to: ROBINHOOD_TOKENS.USDG.address,
  amount: 1_000_000_000_000_000n,
  sender: walletAddress,
  slippage: 100, // 1%, matching the Robinhood frontend default
});

const response = await fetch(url, {
  headers: { "x-api-key": process.env.SWITCH_API_KEY! },
});
```

Always approve `ROBINHOOD_SWITCH_CONTRACTS.router` for ERC-20 input, but submit
the transaction to `quote.tx.to` so integrations remain safe across router
upgrades. Robinhood limit-order deployment constants and EIP-712 domain values
are exported from `src/networks/robinhood.ts`.

---

## Authentication

Every request **must** include an API key via one of:

| Method | Header | Value |
|---|---|---|
| Custom header | `x-api-key` | `<your-api-key>` |
| Bearer token | `Authorization` | `Bearer <your-api-key>` |

> Contact the Switch team to obtain an API key.

**Example:**

```bash
curl -H "x-api-key: YOUR_KEY" "https://quote.switch.win/swap/quote?network=pulsechain&from=0xA1077a294dDE1B09bB078844df40758a5D0f9a27&to=0x95B303987A60C71504D99Aa1b13B4DA07b0790ab&amount=1000000000000000000&sender=0xYourWallet"
```

### Keeping Your API Key Secure

Your API key is a secret credential — **never expose it in client-side code** (browser JavaScript, mobile app bundles, public repositories, etc.). Anyone who obtains your key can make requests on your behalf and consume your rate limit.

**Recommended architecture:** Route all Switch API calls through your own backend server, which holds the key privately and proxies requests to Switch.

```
┌──────────┐        ┌─────────────────┐        ┌─────────────────┐
│  Browser  │──────▶│  Your Backend   │──────▶│  Switch API     │
│  / App    │ (no   │  (holds key)    │ x-api- │  quote.switch.win│
│           │  key) │                 │  key   │                 │
└──────────┘        └─────────────────┘        └─────────────────┘
```

**Best practices:**

| Do | Don't |
|---|---|
| Store the key in server-side environment variables (`process.env`, `.env` files excluded from git) | Embed the key in frontend JavaScript, HTML, or mobile app code |
| Use a backend proxy endpoint (e.g. `/api/quote`) that attaches the key before forwarding to Switch | Commit `.env` files or key values to version control |
| Restrict your backend proxy with CORS to only your own domain(s) | Log or print API keys in production |
| Rotate your key immediately if you suspect it has been leaked | Share a single key across unrelated projects |

> See [`examples/nextjs-proxy.ts`](examples/nextjs-proxy.ts) for a ready-to-use Next.js API route that keeps your key server-side.

---

## Swap Integration Flow

For the most accurate swap quotes — especially with tax tokens — follow this **three-step flow**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Step 1: GET /swap/adapters                                                │
│  → Get available DEXes (cache for hours — rarely changes)                  │
│  → Optionally let users disable specific DEXes                             │
├────────────────────────────────────────────────────────────────────────────┤
│  Step 2: GET /swap/checkTax?token=<fromToken>&network=pulsechain           │
│          GET /swap/checkTax?token=<toToken>&network=pulsechain             │
│  → Detect transfer taxes on both tokens                                    │
│  → Determine feeOnOutput based on tax results + your fee strategy          │
├────────────────────────────────────────────────────────────────────────────┤
│  Step 3: GET /swap/quote?...&feeOnOutput=true/false&adapters=0,3,7        │
│  → Pass feeOnOutput + adapter filter for an exact expectedOutputAmount     │
│  → Display quote and execute swap                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

### Why `feeOnOutput` matters for accuracy

The SwitchRouter contract supports two fee modes:

- **`feeOnOutput=true`** — The full input is routed through DEX pools, then the protocol fee is deducted from the output.
- **`feeOnOutput=false`** — The protocol fee is deducted from the input *before* routing, and the reduced amount enters the DEX pools.

Due to AMM curve concavity (Jensen's inequality), `AMM(amount × 0.9975) ≠ AMM(amount) × 0.9975`. This means the backend **must know which mode you'll use** to compute an exact `expectedOutputAmount`. If the backend routes as `feeOnOutput=true` but you send the `tx` (fee on input), the expected output will be slightly over-estimated (always in the user's favor — they receive more than quoted).

By passing `feeOnOutput` explicitly, the backend adjusts routing to match the actual on-chain execution, giving you a spot-on estimate.

### Determining `feeOnOutput` with tax tokens

When tax tokens are involved, use the `checkTax` results to decide:

```ts
import type { CheckTaxResponse } from "@switch-win/sdk/types";
import { NATIVE_PLS, WPLS } from "@switch-win/sdk/constants";

function determineFeeOnOutput(
  fromToken: string,
  toToken: string,
  fromTax: CheckTaxResponse,
  toTax: CheckTaxResponse,
): boolean {
  const plsAddresses = [NATIVE_PLS.toLowerCase(), WPLS.toLowerCase()];
  const fromAddr = fromToken.toLowerCase();
  const toAddr = toToken.toLowerCase();

  const isSellTax = fromTax.isTaxToken && fromTax.sellTaxBps > 0;
  const isBuyTax = toTax.isTaxToken && toTax.buyTaxBps > 0;

  // Both tokens are taxed — use fee on input to avoid extra output transfers.
  if (isSellTax && isBuyTax) return false;

  // Only output token is tax — fee on input (avoids router holding output tokens)
  if (isBuyTax) return false;

  // Only input token is tax — fee on output (fee collected in the non-tax output token)
  if (isSellTax) return true;

  // No tax tokens — decide based on PLS preference:
  // Buying PLS → fee on output (collect PLS)
  if (plsAddresses.includes(toAddr)) return true;
  // Selling PLS → fee on input (collect PLS)
  if (plsAddresses.includes(fromAddr)) return false;

  // Default: fee on output
  return true;
}
```

### Why fee-on-input for tax tokens?

Tax tokens (fee-on-transfer tokens) charge a percentage on every `transfer()` / `transferFrom()` call. The SwitchRouter's settlement path differs based on the fee mode:

**`feeOnOutput=false` (fee on input) — recommended for tax tokens:**
```
User ──transferFrom──▶ Router ──swap──▶ Pool ──transfer──▶ User
         (1 sell tax)                      (1 buy tax)
Fee portion: User ──transferFrom──▶ FeeClaimer (1 sell tax on fee amount)
```
The output token is transferred **once** (pool → user directly). Only 1 buy tax hit.

**`feeOnOutput=true` (fee on output) — avoid when output is a tax token:**
```
User ──transferFrom──▶ Router ──swap──▶ Pool ──transfer──▶ Router ──transfer──▶ User
         (1 sell tax)                      (1 buy tax)         (2nd buy tax!)
Fee portion: Router ──transfer──▶ FeeClaimer (3rd buy tax on fee amount!)
```
The output token is transferred **three times** through different addresses, each incurring a buy tax. The user receives significantly less than expected.

**Bottom line:** When the output token has a buy tax, always use `feeOnOutput=false` so the router routes output directly to the user in a single transfer. This applies to both regular swaps and limit orders.

### Executing the Swap

Once you have a quote, execute it in two steps:

#### Step 1 — Approve Token Spend (ERC-20 inputs only)

If the input token is an **ERC-20** rather than the chain's native currency, the user must approve the network's SwitchRouter contract to spend `amount` tokens before submitting the swap.

Before sending an approval transaction, check whether the user already has sufficient allowance to avoid wasting gas on a redundant approve:

```ts
import { SWITCH_ROUTER, ERC20_ABI } from "@switch-win/sdk/constants";

const token = new ethers.Contract(fromToken, ERC20_ABI, signer);
const currentAllowance = await token.allowance(sender, SWITCH_ROUTER);

if (currentAllowance < BigInt(amount)) {
  const approveTx = await token.approve(SWITCH_ROUTER, amount);
  await approveTx.wait();
}
```

> **Tip:** If the input is native **PLS**, no approval is needed — the value is sent with the transaction.

#### Step 2 — Send the Transaction

Use the `tx` object from the quote response directly:

```js
const { tx } = quoteResponse;

const txResponse = await signer.sendTransaction({
  to:    tx.to,
  data:  tx.data,
  value: tx.value,   // "0" for ERC-20 inputs, amountIn for native currency
});

const receipt = await txResponse.wait();
console.log("Swap confirmed:", receipt.hash);
```

That's it. The `tx.data` already encodes the correct `goSwitch()` call with your routes, slippage protection, fee, and partner address.

> **⚠️ Always use `tx.to` from the response** — do NOT hardcode the router address. The `SWITCH_ROUTER` constant is provided for **token approvals only**. The router contract may be redeployed; `tx.to` always points to the current production router.

The `tx` object does not include a `gas` field. Most wallet libraries (ethers.js, web3.py, MetaMask) auto-estimate gas when `gas` is omitted. For multi-hop split swaps, `500,000`–`1,000,000` gas is typically sufficient:

```js
const txResponse = await signer.sendTransaction({
  ...quote.tx,
  gasLimit: 800_000, // optional: override if auto-estimate is unreliable
});
```

> See [`examples/swap-ethers.ts`](examples/swap-ethers.ts) for a complete working example.

### Important Notes

**Quote freshness:** Quotes reflect current on-chain liquidity and are **cached for ~10 seconds**. DEX prices can shift between when you fetch a quote and when the transaction lands on-chain — this is what `minAmountOut` (slippage protection) guards against. Fetch a fresh quote immediately before sending the transaction.

**Token amounts are in wei:** All amounts (`amount`, `totalAmountIn`, `totalAmountOut`, `minAmountOut`, etc.) are **raw integer strings in the token's smallest unit** (wei). To convert a human-readable amount to wei, multiply by `10^decimals`:

| Token | Decimals | 1.0 token in wei |
|---|---|---|
| PLS / WPLS | 18 | `"1000000000000000000"` |
| USDC (bridged) | 6 | `"1000000"` |
| USDT (bridged) | 6 | `"1000000"` |

```js
// ethers.js v6
const amountWei = ethers.parseUnits("1.5", 18).toString(); // "1500000000000000000"
```

**Native PLS vs WPLS:**
- Use `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` (the native sentinel address) to swap **native PLS**.
- The router handles wrapping/unwrapping automatically:
  - **Selling native PLS:** Send PLS as `msg.value` — the router wraps it to WPLS internally.
  - **Buying native PLS:** The router unwraps WPLS and sends native PLS to the recipient.
- If you want to swap **WPLS the ERC-20 token** directly (without wrapping/unwrapping), use the WPLS address `0xA1077a294dDE1B09bB078844df40758a5D0f9a27`.

---

## Swap API Reference

### List Adapters

```
GET /swap/adapters?network=pulsechain
```

Returns all available DEX adapters with their on-chain indices and contract addresses. Use the indices to filter which DEXes the router considers via the `adapters` query param on `/swap/quote`.

| Param | Required | Type | Description |
|---|---|---|---|
| `network` | **Yes** | string | Target blockchain network: `"pulsechain"` or `"robinhood"`. |

#### Authentication

Requires API key (same as all endpoints).

#### Example Request

```bash
curl -H "x-api-key: YOUR_KEY" "https://quote.switch.win/swap/adapters?network=pulsechain"
```

#### Example Response

```json
{
  "adapters": [
    { "index": 0,  "name": "UniswapV2",       "address": "0x971eeb4a5080834f7df2b9d7a11dfbeaa7bc187e" },
    { "index": 1,  "name": "SushiV2",         "address": "0x5ef53d5eb4f011d9bed35e7112945f0dc96b3822" },
    { "index": 2,  "name": "PulseXV1",        "address": "0x6f5ccfca1f1d3fff70202463df05573cc1668cb6" },
    { "index": 3,  "name": "PulseXV2",        "address": "0x393e382520b93b8f662dc76295000930c06d689f" },
    { "index": 4,  "name": "9inchV2",         "address": "0x4810beadf72a1f297f4e5ff71424d98b2bf4441e" },
    { "index": 5,  "name": "DextopV2",        "address": "0xd096faccdd475f2c86f3c668958fcd435e32bdc2" },
    { "index": 6,  "name": "9mmV2",           "address": "0x67a25e62309e39e7b46f3b6f868bcf336c4ce8e2" },
    { "index": 7,  "name": "UniswapV3",       "address": "0xc39cb531f71059fd427a63bf8a2f4b822d6b9b02" },
    { "index": 8,  "name": "9mmV3",           "address": "0x32a63187814d6b81badc6c13dc9d46a8050fad12" },
    { "index": 9,  "name": "9inchV3",         "address": "0xe46ef88400997a84336e1a3c14d2528da90572b6" },
    { "index": 10, "name": "pDexV3",          "address": "0xb718836aca6ddb8745a0cecc687467dda648bdf2" },
    { "index": 11, "name": "DextopV3",        "address": "0x8b8024ca2a4fdb34697620b80320e76c41a67124" },
    { "index": 12, "name": "Phux",            "address": "0x98ae0249da42f789b9745b248d346a727f37e937" },
    { "index": 13, "name": "Tide",            "address": "0xf72c3a301b533eff7e3efa32549f9c934a4f4b29" },
    { "index": 14, "name": "PulseXStable",    "address": "0xf3b9742c859d089b6a2e3b3228dabb2c842b57d2" },
    { "index": 15, "name": "AgoraX",          "address": "0x79ea0ec76b510d08bf4ca9a4a53a1f9f80ea1697" },
    { "index": 16, "name": "JoltOTC",         "address": "0x033372eb8df4baad260e20d716742a825f1f113f" },
    { "index": 17, "name": "SwitchLimitOrder", "address": "0xa799f49dcdec9056293187faa5f6f3727942a4ca" },
    { "index": 18, "name": "SwitchX",         "address": "0xf8744452598883792f235b92452127f4a8587db3" },
    { "index": 19, "name": "LibertySwapV3",   "address": "0xba24bb413ab32f02073385850907ebcf0a357e70" },
    { "index": 20, "name": "FinvestaV3",      "address": "0x012c44d0c465819ef3ceac208e0c1b272087a8b4" }
  ]
}
```

Finvesta is a Liberty-style V3 venue with fee tiers `100`, `500`, `2500`, and
`10000`. It can be selected for normal routes, but it is not transfer-tax safe.
Always treat the live `/swap/adapters` response as the runtime source of truth.

#### Using adapter indices to filter routing

Pass adapter indices as a comma-separated `adapters` param to `/swap/quote`:

```bash
# Route only through PulseXV2 (index 3):
GET /swap/quote?...&adapters=3

# Route through PulseXV2 + UniswapV3:
GET /swap/quote?...&adapters=3,7

# Exclude nothing (default — omit the param):
GET /swap/quote?...
```

This is useful for building a DEX toggle UI where users can enable/disable specific liquidity sources.

### Check Token Tax

```
GET /swap/checkTax
```

Detects whether a token has a fee-on-transfer mechanism (tax token) and returns the buy/sell tax rates in basis points. Use this **before** fetching a quote to:

1. Display a tax warning to the user
2. Determine the optimal `feeOnOutput` mode
3. Pass that mode to `/swap/quote` for an exact estimate

#### Query Parameters

| Parameter | Required | Type | Description |
|---|---|---|---|
| `token` | **Yes** | address | Token address to check (0x + 40 hex chars) |
| `network` | No | string | Target blockchain: `"pulsechain"` or `"robinhood"`. |

#### Latency

| Scenario | Typical Latency |
|---|---|
| Cached result (previously checked token) | **< 1 ms** |
| Uncached (first check for this token) | **50–200 ms** |

Tax results are cached server-side, so repeated checks for the same token are essentially free. You can safely call this for both `from` and `to` tokens in parallel before every quote.

#### Example Request

```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://quote.switch.win/swap/checkTax?token=0x95B303987A60C71504D99Aa1b13B4DA07b0790ab&network=pulsechain"
```

#### Example Response (non-tax token)

```json
{
  "token": "0x95b303987a60c71504d99aa1b13b4da07b0790ab",
  "isTaxToken": false,
  "buyTaxBps": 0,
  "sellTaxBps": 0
}
```

#### Example Response (tax token)

```json
{
  "token": "0x1234567890abcdef1234567890abcdef12345678",
  "isTaxToken": true,
  "buyTaxBps": 500,
  "sellTaxBps": 300
}
```

In this example, the token has a 5% buy tax and a 3% sell tax.

#### Tax Tokens Deep Dive

Some tokens on PulseChain charge a percentage fee on every `transfer()` call — commonly called **tax tokens** or **fee-on-transfer tokens**. When you swap into or out of one of these tokens, the actual amount received differs from the quoted DEX output because the token's own contract skims a fee during the transfer.

The API automatically detects tax tokens via empirical simulation and returns the tax rates in the quote response:

```jsonc
{
  // Selling a token with 1.2% sell tax
  "fromTokenTax": { "isTaxToken": true, "buyTaxBps": 100, "sellTaxBps": 120 },
  // Buying a non-tax token
  "toTokenTax":   { "isTaxToken": false, "buyTaxBps": 0, "sellTaxBps": 0 },
  // minAmountOut already accounts for the 1.2% sell tax + user slippage
  "minAmountOut": "...",
  // Effective slippage = user slippage (0.5%) + sell tax (1.2%) = 1.7%
  "effectiveSlippageBps": 170,
  "effectiveSlippagePercent": "1.7"
}
```

**How it works:**

- If `fromToken` is a tax token, its **`sellTaxBps`** reduces the effective input reaching the DEX pools. This is the relevant tax when the token is being **sold** (sent out of the user's wallet).
- If `toToken` is a tax token, its **`buyTaxBps`** reduces what the user ultimately receives. This is the relevant tax when the token is being **bought** (received into the user's wallet).
- Both taxes (if applicable) **plus** the user's slippage tolerance are factored into `minAmountOut`, so the transaction won't revert unexpectedly.

**Key fields for integrators:**

| Field | Description |
|---|---|
| `fromTokenTax.sellTaxBps` | Sell tax applied when `fromToken` is the input (e.g. 120 = 1.2%) |
| `toTokenTax.buyTaxBps` | Buy tax applied when `toToken` is the output (e.g. 500 = 5%) |
| `effectiveSlippageBps` | User slippage + sell tax + buy tax in basis points |
| `effectiveSlippagePercent` | Same as above, as a human-readable `%` string (e.g. `"1.7"`) |
| `expectedOutputAmount` | Best estimate of what the user actually receives (after taxes + fee, before slippage). Display this in your UI. |
| `minAmountOut` | Minimum output with taxes + fee + slippage already applied — use this directly |

**UI recommendations:**

- Display a warning when `fromTokenTax.isTaxToken` or `toTokenTax.isTaxToken` is `true`.
- Show the tax percentage to the user (e.g. "1.2% sell tax") so they understand the impact.
- Display `effectiveSlippagePercent` as the total slippage indicator — e.g. "Slippage: 1.7% (includes 1.2% sell tax)".
- Use `minAmountOut` directly from the API response — it already includes taxes, fees, and slippage. **Do not re-compute it client-side.**

```ts
// Example: display effective slippage in your UI
const label = `Slippage: ${quote.effectiveSlippagePercent}%`;
const fromIsTax = quote.fromTokenTax?.isTaxToken ?? false;
const toIsTax   = quote.toTokenTax?.isTaxToken ?? false;

if (fromIsTax) {
  // Show: "Slippage: 1.7% (includes 1.2% sell tax)"
  label += ` (includes ${quote.fromTokenTax!.sellTaxBps / 100}% sell tax)`;
}
if (toIsTax) {
  // Show: "Slippage: 5.5% (includes 5% buy tax)"
  label += ` (includes ${quote.toTokenTax!.buyTaxBps / 100}% buy tax)`;
}
```

### Get Swap Quote

```
GET /swap/quote
```

Returns the optimal split-route for a swap and (optionally) a ready-to-send transaction object.

#### Query Parameters

| Parameter | Required | Type | Default | Description |
|---|---|---|---|---|
| `network` | **Yes** | string | — | Target blockchain network: `"pulsechain"` or `"robinhood"`. |
| `from` | **Yes** | address | — | Input token address. Use `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` for the network's native currency (PLS or ETH). |
| `to` | **Yes** | address | — | Output token address. Use `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` for the network's native currency (PLS or ETH). |
| `amount` | **Yes** | string | — | Input amount in **wei** (raw integer string, no decimals). Max: 10²⁷. |
| `sender` | No* | address | — | Sender wallet address. **Required to receive `tx` calldata in the response.** |
| `receiver` | No | address | `sender` | Custom recipient address. If omitted, output tokens are sent to `sender`. |
| `slippage` | No | integer | `50` | Slippage tolerance in **basis points** (bps). `50` = 0.50 %. Range: `0`–`5000`. |
| `fee` | No | integer | `30` | Protocol fee in basis points (0.30 %). Range: `30`–`100`. Defaults to `30` if omitted. |
| `partnerAddress` | No | address | `0x0…0` | Your partner wallet to receive 50 % of collected fees. Omit or pass `0x0` for no partner. |
| `feeOnOutput` | No | string | `"false"` | Controls fee mode. `"true"` = fee deducted from output. `"false"` = fee deducted from input (default). Affects `expectedOutputAmount` accuracy — see [Swap Integration Flow](#swap-integration-flow). |
| `adapters` | No | string | — | Comma-separated adapter indices to restrict routing (e.g. `"3"` for PulseXV2 only, `"3,7"` for PulseXV2 + UniswapV3). Get available indices from [List Adapters](#list-adapters). |

> \* If `sender` is omitted, the response will still contain routing data, `minAmountOut`, and tax info, but the `tx` object will be absent. This is useful for **showing estimated swap output before the user connects their wallet** — you can display prices, routes, and tax warnings without requiring a wallet connection. Once the user connects, re-fetch the quote with `sender` to get the ready-to-send `tx` object.

#### Example Request

```
GET /swap/quote?network=pulsechain&from=0xA1077a294dDE1B09bB078844df40758a5D0f9a27&to=0x95B303987A60C71504D99Aa1b13B4DA07b0790ab&amount=1000000000000000000&sender=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&slippage=100&fee=30&partnerAddress=0xYourPartnerWallet&feeOnOutput=true
```

#### Example Response

```jsonc
{
  "fromToken": "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
  "toToken": "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab",
  "receiver": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "totalAmountIn": "1000000000000000000",
  "totalAmountOut": "52934810000000000000",
  "expectedOutputAmount": "52801533000000000000",  // after sell tax + protocol fee + buy tax (no slippage)
  "minAmountOut": "52405461900000000000",   // totalAmountOut adjusted for tax + fee + slippage
  "fromTokenTax": { "isTaxToken": false, "buyTaxBps": 0, "sellTaxBps": 0 },
  "toTokenTax":   { "isTaxToken": false, "buyTaxBps": 0, "sellTaxBps": 0 },
  "paths": [ /* ... detailed path info ... */ ],
  "routeAllocation": {
    "amountIn": "1000000000000000000",
    "totalAmountOut": "52934810000000000000",
    "routes": [
      {
        "amountIn": "600000000000000000",
        "hops": [
          {
            "tokenIn": "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
            "tokenOut": "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab",
            "totalAmountOut": "31893000000000000000",
            "legs": [
              {
                "adapter": "PulseXV2",
                "amountIn": "600000000000000000",
                "amountOut": "31893000000000000000"
              }
            ]
          }
        ]
      },
      {
        "amountIn": "400000000000000000",
        "hops": [
          {
            "tokenIn": "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
            "tokenOut": "0x57fde0a71132198bbec939b98976993d8d89d225",
            "totalAmountOut": "2100000000",
            "legs": [
              {
                "adapter": "UniswapV3",
                "amountIn": "400000000000000000",
                "amountOut": "2100000000"
              }
            ]
          },
          {
            "tokenIn": "0x57fde0a71132198bbec939b98976993d8d89d225",
            "tokenOut": "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab",
            "totalAmountOut": "21041810000000000000",
            "legs": [
              {
                "adapter": "9inchV2",
                "amountIn": "2100000000",
                "amountOut": "21041810000000000000"
              }
            ]
          }
        ]
      }
    ]
  },
  // Transaction object — only present when `sender` is provided
  // ⚠️ Always use tx.to from this response — do NOT hardcode the router address
  "tx": {
    "to": "0x0305fcb5dA680EA6fd1B01A96C1949175B99d406",
    "data": "0x...",     // ABI-encoded goSwitch() calldata with feeOnOutput = false
    "value": "0"          // "0" for ERC-20 input; amountIn for native-currency input
  },
  // Same swap but with fee taken from the output token instead
  "txFeeOnOutput": {
    "to": "0x0305fcb5dA680EA6fd1B01A96C1949175B99d406",
    "data": "0x...",     // ABI-encoded goSwitch() calldata with feeOnOutput = true
    "value": "0"
  }
}
```

### Response Schema

> TypeScript interfaces for all types below are available in [`src/types.ts`](src/types.ts).

#### `BestPathResponse`

| Field | Type | Description |
|---|---|---|
| `fromToken` | `string` | Input token address |
| `toToken` | `string` | Output token address |
| `receiver` | `string?` | Recipient address for output tokens. Same as `sender` unless a custom `receiver` was specified. |
| `totalAmountIn` | `string` | Total input amount in wei |
| `totalAmountOut` | `string` | Quoted route output in wei before the Switch protocol fee and slippage. Protocol-native quoters such as Flap Portal may already include their token-tax effect. |
| `expectedOutputAmount` | `string` | Expected output the user will actually receive, in wei. Accounts for sell tax, protocol fee, and buy tax — but NOT slippage. This is the most accurate value to display as the estimated received amount. When `feeOnOutput` is passed correctly, this is **exact** (matches on-chain execution). |
| `minAmountOut` | `string` | Minimum acceptable output after adapter-specific tax accounting, fee, and slippage. Use the API value directly; do not recompute it by multiplying the reported tax rates. This is encoded in `tx.data` as `_minTotalAmountOut`. |
| `paths` | `SwapPath[]` | Human-readable path descriptions |
| `routeAllocation` | `RouteAllocationPlan` | Human-readable structured route breakdown for display and analytics. It is not a drop-in on-chain ABI value. |
| `tx` | `SwapTransaction?` | Ready-to-send transaction (fee on input). Only present when `sender` is provided. |
| `txFeeOnOutput` | `SwapTransaction?` | Ready-to-send transaction (fee on output). Only present when `sender` is provided. Choose between `tx` and `txFeeOnOutput` at send time. |
| `fromTokenTax` | `TokenTaxResponse?` | Transfer tax info for the input token. See [Tax Tokens Deep Dive](#tax-tokens-deep-dive). |
| `toTokenTax` | `TokenTaxResponse?` | Transfer tax info for the output token. See [Tax Tokens Deep Dive](#tax-tokens-deep-dive). |
| `effectiveSlippageBps` | `number` | User slippage + `fromTokenTax.sellTaxBps` + `toTokenTax.buyTaxBps` combined in basis points. |
| `effectiveSlippagePercent` | `string` | Same as `effectiveSlippageBps` as a human-readable percentage (e.g. `"1.7"`). |

#### `SwapPath`

A human-readable summary of each route split. Useful for display purposes (e.g. showing the user "60% via PulseXV2, 40% via UniswapV3").

| Field | Type | Description |
|---|---|---|
| `adapter` | `string` | Human-readable DEX adapter name (e.g. `"PulseXV2"`, `"UniswapV3"`) |
| `amountIn` | `string` | Input amount for this path (wei) |
| `amountOut` | `string` | Expected output for this path (wei) |
| `path` | `string[]` | Ordered list of token addresses traversed (e.g. `[tokenIn, intermediate, tokenOut]`) |
| `adapters` | `string[]` | Human-readable adapter names used at each hop |
| `percentage` | `number?` | Percentage of total input routed through this path |
| `legs` | `SwapPathLeg[]?` | Detailed breakdown of each hop-leg in this path |

#### `SwapPathLeg`

| Field | Type | Description |
|---|---|---|
| `tokenIn` | `string` | Leg input token |
| `tokenOut` | `string` | Leg output token |
| `adapter` | `string?` | Human-readable DEX adapter name |
| `amountIn` | `string` | Input amount (wei) |
| `amountOut` | `string` | Output amount (wei) |
| `percentage` | `number?` | Percentage of the hop routed through this adapter |

#### `SwapTransaction`

| Field | Type | Description |
|---|---|---|
| `to` | `string` | SwitchRouter contract address |
| `data` | `string` | ABI-encoded `goSwitch()` calldata |
| `value` | `string` | Native PLS to send (wei). `"0"` for ERC-20 input tokens. |

#### `TokenTaxResponse`

Present on every quote response as `fromTokenTax` and `toTokenTax`. Reports whether each token charges a fee on transfer ("tax token").

| Field | Type | Description |
|---|---|---|
| `isTaxToken` | `boolean` | `true` if the token has a non-zero transfer tax |
| `buyTaxBps` | `number` | Buy tax in basis points — applied when the token is *acquired* (i.e. it is the output token). `500` = 5 %. |
| `sellTaxBps` | `number` | Sell tax in basis points — applied when the token is *sold* (i.e. it is the input token). `500` = 5 %. |

> When a tax token is involved, `minAmountOut` already accounts for the tax so the on-chain slippage check passes correctly.

#### `RouteAllocationPlan`

| Field | Type | Description |
|---|---|---|
| `amountIn` | `string` | Total input in wei |
| `totalAmountOut` | `string` | Total expected output in wei |
| `routes` | `SingleRouteAllocation[]` | Array of split routes |

#### `SingleRouteAllocation`

| Field | Type | Description |
|---|---|---|
| `amountIn` | `string` | Input amount for this route portion |
| `hops` | `HopAllocationPlan[]` | Sequential hops in this route |

#### `HopAllocationPlan`

| Field | Type | Description |
|---|---|---|
| `tokenIn` | `string` | Hop input token |
| `tokenOut` | `string` | Hop output token |
| `totalAmountOut` | `string` | Total output from all legs in this hop |
| `legs` | `HopAdapterAllocationPlan[]` | Adapter legs executing this hop (can be split across DEXes) |

#### `HopAdapterAllocationPlan`

| Field | Type | Description |
|---|---|---|
| `adapter` | `string` | Human-readable DEX adapter name (e.g. `"PulseXV2"`) |
| `amountIn` | `string` | Input amount routed through this adapter |
| `amountOut` | `string` | Expected output from this adapter |
| `fee` | `number?` | V3 fee tier or concentrated-liquidity tick-spacing hint; zero when unused |

Use the API-provided `tx.data` for execution. If you intentionally construct
router or limit-order calldata yourself, each on-chain adapter leg is
`{ adapter, amountIn, fee, data }`; `data` is required and should be `0x` for
adapters that need no payload. The display-oriented `routeAllocation` does not
contain enough information to encode every route family.

---

## Error Handling

Errors are returned as JSON with an `error` field:

```json
{ "error": "Missing required parameters: from, to, amount" }
```

### HTTP Status Codes

| HTTP Status | Meaning |
|---|---|
| `200` | Successful response |
| `400` | Invalid parameters (missing, malformed, out of range) |
| `401` | Missing API key |
| `403` | Invalid API key |
| `429` | Rate limit exceeded (per-key total **or** per-IP sub-limit) |
| `502` | Backend routing failure |

### Quote Errors (`/swap/quote`)

| Error | Cause |
|---|---|
| `"Missing required parameter: network"` | `network` query param absent |
| `"This network is not supported at this time."` | `network` is not a supported value (`"pulsechain"` or `"robinhood"`) |
| `"Missing required parameters: from, to, amount"` | One or more required query params absent |
| `"Invalid from address (must be 0x + 40 hex chars)"` | `from` is not a valid hex address |
| `"Invalid to address (must be 0x + 40 hex chars)"` | `to` is not a valid hex address |
| `"Cannot swap token to itself"` | `from` and `to` are the same address |
| `"Amount must be a valid integer string"` | `amount` is not a parseable integer |
| `"Amount must be greater than 0"` | `amount` is zero or negative |
| `"Amount exceeds maximum allowed value"` | `amount` exceeds 10²⁷ (1 billion tokens @ 18 decimals) |
| `"Slippage must be a number between 0 and 5000 (basis points)"` | `slippage` out of range |
| `"Fee must be a number between 30 and 100 (basis points). Minimum fee is 0.30%."` | `fee` out of range or below minimum |
| `"receiver must be a valid Ethereum address (0x + 40 hex chars)"` | Malformed receiver address |
| `"partnerAddress must be a valid Ethereum address (0x + 40 hex chars)"` | Malformed partner address |
| `"Failed to find route"` | No viable swap path exists, or route computation timed out (30s limit) |

### Tax Check Errors (`/swap/checkTax`)

| Error | Cause |
|---|---|
| `"Invalid or missing token address (must be 0x + 40 hex chars)"` | Missing or malformed `token` param |
| `"This network is not supported at this time."` | Unsupported `network` value |

### On-Chain Revert Errors

If the swap transaction reverts on-chain, the SwitchRouter contract returns one of these custom errors:

| Error | Meaning |
|---|---|
| `FinalAmountOutTooLow()` | Output after fees fell below `_minTotalAmountOut` — price moved beyond your slippage tolerance. Retry with a fresh quote or increase slippage. |
| `ExcessiveFee()` | `_fee` exceeds the contract maximum (100 bps / 1 %). |
| `InsufficientFee()` | `_fee` is below the protocol's `MIN_FEE`. Contact the Switch team if you need a lower fee. |
| `MsgValueMismatch()` | For native-currency swaps, `msg.value` must exactly equal the route's total `amountIn`. |
| `ZeroInput()` | No input amount was provided. |

---

## Partner Fee Sharing

Switch supports a **50/50 fee-sharing** model for integration partners:

1. Set a `fee` (e.g. `30` = 0.30 %, minimum `30` = 0.30 %) and your `partnerAddress` when calling the API.
2. The SwitchRouter contract automatically splits collected fees **during the swap**:
   - **50 %** sent to the protocol
   - **50 %** sent directly to your `partnerAddress`

No claiming step is required — your share arrives in the same transaction as the swap.

> If `partnerAddress` is omitted or `0x0`, the fee accrues entirely to the protocol.

### Fee on Input vs Fee on Output

Every quote response includes **two** transaction objects (when `sender` is provided):

| Field | `feeOnOutput` | How it works | User experience |
|---|---|---|---|
| `tx` (default) | `false` | Fee is deducted from the input amount *before* routing. The user sends the full `amount` but less gets routed through DEX pools. | User sends exactly `amount` tokens. Output is slightly lower because less was routed. |
| `txFeeOnOutput` | `true` | Full input is routed through DEX pools, then the fee is deducted from the output *before* delivery. | User sends exactly `amount` tokens. The gross output is higher but the fee is taken from it. |

Both modes produce similar net results. **Fee on input** (`tx`) is the default and most common choice. **Fee on output** (`txFeeOnOutput`) can be preferable when you want to collect fees in the output token.

Since every response contains both variants, you can **decide which to use at send time** — no need to re-fetch the quote.

> **Note:** The `minAmountOut` in the API response already accounts for the fee in both modes, so the on-chain slippage check will pass correctly regardless of which variant you send.

### Choosing the Right Mode

The best fee mode depends on your use case. The example below shows a **combination strategy** that prioritizes avoiding tax tokens, collecting PLS/WPLS, and favoring blue-chip tokens — but you can create your own strategy tailored to your specific needs:

```ts
import { NATIVE_PLS, WPLS, BLUE_CHIPS } from "@switch-win/sdk/constants";
import type { BestPathResponse } from "@switch-win/sdk/types";

const MY_PROJECT_TOKEN = "0xYourProjectTokenAddress".toLowerCase();
const plsAddresses = [NATIVE_PLS.toLowerCase(), WPLS.toLowerCase()];

function shouldFeeOnOutput(from: string, to: string, quote?: BestPathResponse): boolean {
  const fromAddr = from.toLowerCase();
  const toAddr   = to.toLowerCase();

  // Priority 1: If either token is your project token, take fee in the opposite
  if (fromAddr === MY_PROJECT_TOKEN) return true;   // fee on output = collect output
  if (toAddr === MY_PROJECT_TOKEN)   return false;  // fee on input  = collect input

  // Priority 2: Avoid collecting tax tokens (fee revenue lost to transfer tax)
  if (quote) {
    const fromIsTax = quote.fromTokenTax?.isTaxToken ?? false;
    const toIsTax   = quote.toTokenTax?.isTaxToken ?? false;
    if (fromIsTax && toIsTax) return false;
    if (fromIsTax && !toIsTax) return true;   // collect non-tax output
    if (toIsTax && !fromIsTax) return false;  // collect non-tax input
  }

  // Priority 3: Prefer collecting PLS/WPLS
  if (plsAddresses.includes(fromAddr)) return false; // fee on input  = collect PLS
  if (plsAddresses.includes(toAddr))   return true;  // fee on output = collect PLS

  // Priority 4: Prefer collecting blue chips
  if (BLUE_CHIPS.has(toAddr) && !BLUE_CHIPS.has(fromAddr)) return true;
  if (BLUE_CHIPS.has(fromAddr) && !BLUE_CHIPS.has(toAddr)) return false;

  // Default: fee on input
  return false;
}
```

Then send the chosen transaction:

```ts
const useFeeOnOutput = shouldFeeOnOutput(from, to, quote);
const chosenTx = useFeeOnOutput ? quote.txFeeOnOutput! : quote.tx!;
await signer.sendTransaction(chosenTx);
```

> **Tip:** You can choose differently on every swap — adapt dynamically based on the token pair. The strategy above covers the most common scenarios (project tokens, tax avoidance, PLS preference, blue chips), but feel free to adjust the priority order, add project-specific logic, or implement a completely different approach that suits your integration best.

---

## Limit Orders

Switch Limit Orders let users place **gasless, signed orders** that are filled automatically when market conditions are met — no gas to create, no token deposits, EIP-712 signed.

**→ Full integration guide: [`LIMIT-ORDERS.md`](LIMIT-ORDERS.md)**

Covers both `pulsechain` and `robinhood`: creating orders, live deployment
discovery, approvals, `feeOnOutput` decision rules, native PLS/ETH flows,
querying, cancellation, API types, and EIP-712 details. Use
`fetchLimitOrderConfig({ network })` at startup and include `network` in every
orderbook request.

---

## Constants & Addresses

PulseChain constants are importable from [`src/constants.ts`](src/constants.ts).
Robinhood constants are available from
[`src/networks/robinhood.ts`](src/networks/robinhood.ts); see the complete
[`ROBINHOOD.md`](ROBINHOOD.md) integration reference.

> **⚠️ Do not hardcode the SwitchRouter address.** The router contract may be redeployed from time to time. Always use the `tx.to` (or `txFeeOnOutput.to`) address returned by the `/bestPath` API response when building your transaction. This ensures your integration automatically picks up router upgrades without code changes.

| Name | Value |
|---|---|
| **Chain** | PulseChain (Chain ID `369`); Robinhood Chain uses ID `4663` and network-specific exports |
| **SwitchRouter** | `0x0305fcb5dA680EA6fd1B01A96C1949175B99d406` |
| **SwitchLimitOrder** (V2 — current) | `0x8e3881bdF81Fc0211383B2e576076B654F7aFD86` |
| **SwitchLimitOrder** (V1 — legacy) | `0x0e884072a891b406C0D814907A1E2310fE5F5Deb` |
| **SwitchPLSFlow** (V2 — current) | `0xCf5606bdC750d8626Cec32CA2E1BB207968db1D5` |
| **SwitchPLSFlow** (V1 — legacy) | `0x88c9e2C83b6B7c707602e548481e58E920694E64` |
| **Native PLS sentinel** | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` |
| **WPLS** | `0xA1077a294dDE1B09bB078844df40758a5D0f9a27` |
| **Finvesta V3 adapter** | Index `20`; `0x012c44d0C465819eF3CeAC208e0c1B272087a8b4` (not transfer-tax safe) |
| **Finvesta V3 factory** | `0x7f5c7C5144b4B4c6e954A5b2D75C318C5467EFDc` |
| **Finvesta fee tiers** | `100`, `500`, `2500`, `10000` |
| **Fee denominator** | `10000` (basis points) |
| **Max slippage** | `5000` bps (50 %) |
| **Max fee** | `100` bps (1 %) |
| **Min fee** | `30` bps (0.30 %) — enforced on-chain by `MIN_FEE` |
| **Default slippage** | `50` bps (0.50 %) |
| **Swap API base** | `https://quote.switch.win` |
| **Limit Order API base** | `https://quote.switch.win` |

---

## Full Integration Examples

Complete runnable examples are in the [`examples/`](examples/) directory:

| File | Language | Description |
|---|---|---|
| [`swap-ethers.ts`](examples/swap-ethers.ts) | TypeScript | Full 5-step swap flow with ethers.js v6 (adapters → checkTax → quote → approve → send) |
| [`swap-web3py.py`](examples/swap-web3py.py) | Python | Full 5-step swap flow with web3.py |
| [`limit-order-ethers.ts`](examples/limit-order-ethers.ts) | TypeScript | Full limit order lifecycle (build → approve → sign → submit → query → cancel) |
| [`nextjs-proxy.ts`](examples/nextjs-proxy.ts) | TypeScript | Next.js catch-all proxy for `/swap/*` endpoints (keeps API key server-side) |
| [`react-hooks.tsx`](examples/react-hooks.tsx) | React/TSX | `useAdapters`, `useCheckTax`, `useSwapQuote` hooks + example `SwapCard` component |

---

## Rate Limits

All requests require a valid API key. The API enforces **dual-bucket rate limiting** — both checks must pass:

| Bucket | Scope | Default Limit | Description |
|---|---|---|---|
| Per-key | All IPs sharing one API key | 100 req/min | Total throughput for the key (configurable per key) |
| Per-IP | Each unique IP within a key | 10 req/min | Prevents one caller from monopolising a shared key |

Both limits apply simultaneously. A single IP can never exceed 10/min, and all IPs combined can never push a key past its total limit.

Every successful response includes informational headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
```

### IP Whitelisting for Backend Servers

If your backend proxies Switch quotes to end users (server-to-server calls), ask the Switch team to **whitelist your server IP(s)** for your API key. Whitelisted IPs skip the 10/min per-IP sub-limit but still count toward the key's total — giving your backend access to the key's full allocation.

If you receive a `429 Too Many Requests` response, back off and retry after a short delay using exponential backoff.

To request a new API key, IP whitelisting, or rate limit changes, contact the Switch team (see [Support](#support)).

---

## Support

For API key requests, integration help, or feature requests, contact the Switch team:

- **Website:** [switch.win](https://switch.win)
- **Telegram:**
  - [@BrandonDavisR2R](https://t.me/BrandonDavisR2R)
  - [@bttscott](https://t.me/bttscott)
  - [@shanebtt](https://t.me/shanebtt)

---

## License

MIT

---

*Last updated: February 2026*
