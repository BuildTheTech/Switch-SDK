# Switch SDK — Robinhood Chain

Production integration reference for Switch swaps on Robinhood Chain mainnet.

| Setting | Value |
|---|---|
| API network | `robinhood` |
| Chain ID | `4663` |
| Native currency | ETH (18 decimals) |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Quote API | `https://quote.switch.win/swap/quote` |
| Tax API | `https://quote.switch.win/swap/checkTax` |
| Supported liquidity | 19 adapters: Uniswap V2/V3/V4, Switch limit orders, SwapHood, Up33, Sheriff, Aeon, Catnip, PancakeSwap, RobinSwap, SushiSwap, GIGA, Flap, and Ramses |
| Limit orders | Available: EIP-712 ERC-20 orders plus native ETH flow |

## Contents

- [Installation](#installation)
- [Authentication](#authentication)
- [Network configuration](#network-configuration)
- [Contracts and native currency](#contracts-and-native-currency)
- [Uniswap V4 routing](#uniswap-v4-routing)
- [Swap integration flow](#swap-integration-flow)
- [Quickstart](#quickstart)
- [Tax-token checks](#tax-token-checks)
- [Selecting `feeOnOutput`](#selecting-feeonoutput)
- [Approving and executing](#approving-and-executing)
- [Swap API reference](#swap-api-reference)
- [Error handling](#error-handling)
- [Partner fee sharing](#partner-fee-sharing)
- [Tokens and routing](#tokens-and-routing)
- [Rate limits](#rate-limits)
- [Current limitations](#current-limitations)

## Installation

```bash
npm install @switch-win/sdk
```

```ts
import {
  ROBINHOOD_CHAIN,
  ROBINHOOD_NATIVE_ETH,
  ROBINHOOD_SWITCH_CONTRACTS,
  ROBINHOOD_UNISWAP_CONTRACTS,
  ROBINHOOD_TOKENS,
  ROBINHOOD_FEE_TOKEN_PRIORITY,
  ROBINHOOD_FRONTEND_DEFAULT_TOKENS,
  ROBINHOOD_FRONTEND_TOKEN_LIST,
  buildRobinhoodQuoteUrl,
  type BestPathResponse,
} from "@switch-win/sdk";
```

The same exports are available from the smaller network entrypoint:

```ts
import {
  ROBINHOOD_CHAIN,
  ROBINHOOD_TOKENS,
  buildRobinhoodQuoteUrl,
} from "@switch-win/sdk/networks/robinhood";
```

## Authentication

Every request to `quote.switch.win` requires a Switch API key in the
`x-api-key` header:

```ts
const headers = {
  "x-api-key": process.env.SWITCH_API_KEY!,
};
```

Do not expose a production API key in browser JavaScript. Browser applications
should call a same-origin server route that attaches the key before forwarding
the request to Switch.

## Network configuration

`ROBINHOOD_CHAIN` can be adapted directly for most wallet libraries:

```ts
const robinhoodWalletChain = {
  chainId: `0x${ROBINHOOD_CHAIN.id.toString(16)}`,
  chainName: ROBINHOOD_CHAIN.name,
  nativeCurrency: ROBINHOOD_CHAIN.nativeCurrency,
  rpcUrls: [...ROBINHOOD_CHAIN.rpcUrls],
  blockExplorerUrls: [ROBINHOOD_CHAIN.blockExplorerUrl],
};

await window.ethereum.request({
  method: "wallet_addEthereumChain",
  params: [robinhoodWalletChain],
});
```

## Contracts and native currency

### Switch deployment

| Contract | Address |
|---|---|
| SwitchRouter | `0x8730C3e2cF2c8CDa8E6166837A1Ed26f46aa9E59` |
| Uniswap V2 adapter | `0x7a14d7A8509a66209D4332843b983b29bF5604A4` |
| Uniswap V3 adapter | `0xbcA08f296d9Ba0dc19Aa0E05D355365cE29A3205` |
| Uniswap V4 adapter | `0x754dDCD05aFbAd1cc7Bc42B9268EB586F579E7F6` |
| SwitchLimitOrder | `0x752c50DDd3B426cAE3D7A995F313Ac74ac6B0230` |
| Native ETH flow | `0x029FfC6aF9112eA078f1D6f4a98826DDB2136cf6` |
| Switch Limit Order adapter (index 3) | `0x412F625072c10e58C619D1e0b3C95cd3d5689871` |
| SwapHood V2 adapter (index 4) | `0x6D8746f02e52944c13824fA691c6f4186E463354` |
| SwapHood V3 adapter (index 5) | `0x9645dE0AcB48F0AAefdBEb423F0558457907DE98` |
| Up33 CL adapter (index 6) | `0x388179D2FB0ABcE9b03068916aF8a3c4dfD023c8` |
| Sheriff V2 adapter (index 7) | `0xBDB3EB0355981500f58C9bc77c3E61762844A146` |
| Sheriff Algebra adapter (index 8) | `0xaC4da986100724983042Ec28c28db243E2f828CB` |
| Aeon Algebra adapter (index 9) | `0x20615954FB87360139e7DdDB519359498EbD1904` |
| Catnip V2 adapter (index 10) | `0x5b2Ca358d56490Dc86224D502522314De7707237` |
| PancakeSwap V2 adapter (index 11) | `0x3B6e71A59553143937Fef74a7B50AFD24528786E` |
| RobinSwap V3 adapter (index 12) | `0x798f77D63b46b0E019de206E111e5ea5CC16BEc8` |
| SushiSwap V3 adapter (index 13) | `0xca3EA0Fd6E31f94c81B6586836790adE638313ED` |
| GIGA V2 adapter (index 14) | `0xa379c7D17F7fEe735773879D4069886B117AB54a` |
| GIGA V3 adapter (index 15) | `0xcAa612CDe3d3FbE97Be97eB5f79BC91597432d55` |
| Flap Portal adapter (index 16) | `0x6af2A4475C44d5833575150Bf7C3D3FE6Bf4F344` |
| Ramses V3 adapter (index 17) | `0xdBf182774C60932c6fe1Bf3FFaB8Ca28CCb0dC17` |
| Ramses V2 adapter (index 18) | `0x5fe3b873c222e76f7630b40052f07ee06196E6d3` |

The V4 adapter was created in
[deployment transaction `0x60d5...34a7`](https://robinhoodchain.blockscout.com/tx/0x60d56466a8162a643a15ecde98322ec05ea23d44d03fbd817df4ddbaef4834a7)
and added to the router in
[activation transaction `0x405b...1098`](https://robinhoodchain.blockscout.com/tx/0x405b49619ebfe4d1a73eb2d4601d8d1e63ae3d6fff0cd811a96c17e146971098).

The router constant is the ERC-20 approval target. Always submit the swap to
`quote.tx.to`; do not replace the API-provided transaction target with a
hardcoded address.

### Native ETH and WETH

Use `ROBINHOOD_NATIVE_ETH` when the user is selling or buying native ETH:

```text
0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
```

Use `ROBINHOOD_TOKENS.WETH.address` for the wrapped ERC-20:

```text
0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
```

Native ETH does not require approval. WETH and every other ERC-20 input token
must be approved for `ROBINHOOD_SWITCH_CONTRACTS.router`.

### Limit orders

Robinhood ERC-20 limit orders use the same EIP-712 `LimitOrder` structure as
PulseChain, with these network-specific domain values:

```ts
import {
  ROBINHOOD_LIMIT_ORDER_EIP712_DOMAIN,
  ROBINHOOD_SWITCH_CONTRACTS,
} from "@switch-win/sdk";

// { name: "SwitchLimitOrder", version: "2", chainId: 4663,
//   verifyingContract: "0x752c...0230" }
await signer.signTypedData(
  ROBINHOOD_LIMIT_ORDER_EIP712_DOMAIN,
  LIMIT_ORDER_EIP712_TYPES,
  order,
);
```

Submit signed orders to `POST /limit-orders?network=robinhood`. For
`feeOnOutput=false`, approve `ROBINHOOD_SWITCH_CONTRACTS.limitOrder`; for
`feeOnOutput=true`, approve `ROBINHOOD_SWITCH_CONTRACTS.router`.

Applications should fetch `/limit-orders/config?network=robinhood` at startup
instead of relying only on static addresses. The SDK exposes this as:

```ts
const config = await fetchLimitOrderConfig({ network: "robinhood" });
const signing = getNetworkEIP712SigningParams(
  "robinhood",
  config.limitOrderContract,
);
const approvalTarget = getLimitOrderApprovalTarget(
  "robinhood",
  order.feeOnOutput,
  { limitOrderContract: config.limitOrderContract },
);
```

Include `limitOrderContract: config.limitOrderContract` with the submitted
signed order. Every returned order also carries its own deployment address;
operators must fill and makers must cancel against that per-order address.

Native ETH input orders are created on-chain through
`ROBINHOOD_SWITCH_CONTRACTS.nativeEthFlow` and are indexed from its events; do
not POST them as signed EOA orders. Native ETH output is represented by WETH in
the order with `unwrapOutput=true`.

## Uniswap V4 routing

Switch's Robinhood V4 integration is designed for canonical Uniswap V4, whose
pools share one `PoolManager`. A V4 pool is identified by its complete
`PoolKey`:

```ts
type PoolKey = {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
};
```

Do not treat V4 pools as V3 pools with another fee-tier list. The `fee`,
`tickSpacing`, and `hooks` values are all part of pool identity, and Robinhood
V4 discovery must preserve the full key. The backend selects the key and
embeds adapter-specific route data in the quote; clients should submit the
returned transaction unchanged rather than reconstructing V4 calldata.

Phase one supports **hookless static-fee pools only** (`hooks` is the zero
address, hook data is empty, and the dynamic-fee flag is not set). Pools with
custom hooks or dynamic fees are not considered until their behavior and
required hook data have been explicitly reviewed and allowed. This restriction
does not reduce V2 or V3 routing coverage.

V4 can represent native ETH as the zero-address currency. Switch routes use
the canonical Robinhood WETH address, so the V4 adapter unwraps WETH when a
selected pool consumes native ETH and wraps native ETH when that pool produces
it. API callers should continue using `ROBINHOOD_NATIVE_ETH` for a native user
input/output and `ROBINHOOD_TOKENS.WETH.address` for the ERC-20.

The Robinhood Uniswap V4 adapter is deployed at
`0x754dDCD05aFbAd1cc7Bc42B9268EB586F579E7F6`, whitelisted in the production
SwitchRouter at adapter index `2`, and exported as
`ROBINHOOD_SWITCH_CONTRACTS.uniswapV4Adapter`. Continue treating
`GET /swap/adapters?network=robinhood` as the source of truth for the adapters
currently available from the quote backend.

The canonical Robinhood V4 infrastructure is available through
`ROBINHOOD_UNISWAP_CONTRACTS`:

| Contract | Address |
|---|---|
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| PositionDescriptor | `0x9639443158e8c5efa35bd45287bf2effd3d8dc06` |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

If either side is detected as a transfer-tax token, the complete route is
restricted to tax-safe adapters `0`, `4`, `7`, `10`, `11`, `14`, `16`, and
`18`. Indices `14` and `18` use direct-pair V2 execution. Flap at index `16`
must execute through its Portal, whose quote already includes Flap token taxes
in both directions; clients must not apply those taxes a second time.

## Swap integration flow

Use the same sequence as a PulseChain integration:

1. Check both tokens with `/swap/checkTax`.
2. Select `feeOnOutput` from the tax results and preferred fee-token order.
3. Request `/swap/quote` with `network=robinhood`, the selected fee mode, and
   `sender` when executable calldata is required.
4. Approve the API-provided router target for ERC-20 input tokens.
5. Submit `quote.tx` for fee-on-input or `quote.txFeeOnOutput` for
   fee-on-output.
6. Show `expectedOutputAmount`, `minAmountOut`, route allocation, and detected
   taxes to the user.

Any swap involving a tax token is routed entirely through the tax-safe adapter
set (`0`, `4`, `7`, `10`, `11`, `14`, `16`, and `18`). This also applies when
both input and output are tax tokens. Direct-pair adapters receive the
post-transfer amount; Flap is quoted separately with its full adapter input
because Portal quoting already models the taxable transfer.

## Quickstart

`amount` is always a raw integer amount in the input token's smallest unit.
The following requests a quote for `0.001 ETH -> USDG`:

```ts
// This simple pair uses fee-on-input. See "Selecting feeOnOutput" below for
// the recommended dynamic selection when community or tax tokens are involved.
const feeOnOutput = false;

const url = buildRobinhoodQuoteUrl({
  from: ROBINHOOD_NATIVE_ETH,
  to: ROBINHOOD_TOKENS.USDG.address,
  amount: 1_000_000_000_000_000n,
  sender: walletAddress,
  slippage: 100, // 1.00%, the Robinhood frontend default
  feeOnOutput,
});

const response = await fetch(url, {
  headers: { "x-api-key": process.env.SWITCH_API_KEY! },
});

if (!response.ok) {
  throw new Error(`Switch quote failed: ${response.status}`);
}

const quote = (await response.json()) as BestPathResponse;
const transaction = feeOnOutput ? quote.txFeeOnOutput : quote.tx;

if (!transaction) {
  throw new Error("Quote did not include the selected transaction variant");
}
```

Equivalent curl request:

```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://quote.switch.win/swap/quote?network=robinhood&from=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&to=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168&amount=1000000000000000&sender=0xYOUR_WALLET&slippage=100"
```

Omit `sender` for a display-only quote. Fetch again with the sender immediately
before execution to receive current transaction calldata.

## Tax-token checks

Robinhood tokens can apply pair-specific transfer taxes. Check both input and
output tokens before requesting or executing a swap:

```ts
async function checkTax(token: string) {
  const query = new URLSearchParams({ network: "robinhood", token });
  const response = await fetch(
    `https://quote.switch.win/swap/checkTax?${query}`,
    { headers: { "x-api-key": process.env.SWITCH_API_KEY! } },
  );

  if (!response.ok) throw new Error(`Tax check failed: ${response.status}`);
  return response.json();
}

const [inputTax, outputTax] = await Promise.all([
  checkTax(tokenIn),
  checkTax(tokenOut),
]);
```

The quote response also includes `fromTokenTax`, `toTokenTax`,
`expectedOutputAmount`, and effective-slippage fields. Display these values to
the user rather than estimating taxes locally.

## Selecting `feeOnOutput`

`feeOnOutput` determines which side of the swap pays the Switch partner or
protocol fee:

| Value | Fee token | Transaction field |
|---|---|---|
| `false` | Input token | `quote.tx` |
| `true` | Output token | `quote.txFeeOnOutput` |

Choose the mode before requesting the executable quote and pass it to
`buildRobinhoodQuoteUrl`. This keeps `expectedOutputAmount`, routing, and the
transaction calldata aligned with the mode that will actually be submitted.

For Robinhood Chain, the recommended selection order is:

1. If both sides are tax tokens, use fee-on-input (`false`) to avoid the extra
   output-token transfers required by fee-on-output.
2. If only the output token has buy tax, use fee-on-input (`false`) to avoid
   routing the taxed output through additional transfers.
3. If only the input token has sell tax, use fee-on-output (`true`) so the fee
   is collected in the non-tax output token.
4. Otherwise, prefer collecting tokens in this order: WETH (with native ETH
   treated equivalently), USDG, WALLET, SEEDCOIN, then CASHCAT.
5. If neither token is preferred, default to fee-on-input (`false`).

The no-tax priority list is:

| Priority | Token | Address |
|---:|---|---|
| 1 | WETH / native ETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` / native sentinel |
| 2 | USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| 3 | WALLET | `0x0339f5459FC690aC85F1782e15782A151b4A9E1b` |
| 4 | SEEDCOIN | `0x58f693A30F124E59b125F7c7b837b0F6bbAF5a45` |
| 5 | CASHCAT | `0x020bfC650A365f8BB26819deAAbF3E21291018b4` |

The ordered ERC-20 addresses are exported as
`ROBINHOOD_FEE_TOKEN_PRIORITY`. When neither side is taxed, the selector takes
the fee from whichever side contains the higher-priority token. If neither
side is listed, it defaults to fee-on-input.

```ts
import {
  buildRobinhoodQuoteUrl,
  selectRobinhoodFeeOnOutput,
  type BestPathResponse,
} from "@switch-win/sdk";

const feeOnOutput = selectRobinhoodFeeOnOutput(
  tokenIn,
  tokenOut,
  inputTax,
  outputTax,
);

const quoteUrl = buildRobinhoodQuoteUrl({
  from: tokenIn,
  to: tokenOut,
  amount: amountIn,
  sender: walletAddress,
  slippage: 100,
  feeOnOutput,
});

const quoteResponse = await fetch(quoteUrl, {
  headers: { "x-api-key": process.env.SWITCH_API_KEY! },
});
if (!quoteResponse.ok) {
  throw new Error(`Switch quote failed: ${quoteResponse.status}`);
}

const quote = (await quoteResponse.json()) as BestPathResponse;
const transaction = feeOnOutput ? quote.txFeeOnOutput : quote.tx;
if (!transaction) {
  throw new Error("Quote did not include the selected transaction variant");
}
```

Do not request one fee mode and submit the other transaction variant. Taxed
output tokens are especially important: `feeOnOutput=true` makes the router
receive and redistribute the output, which can trigger additional transfer-tax
events.

## Approving and executing

For ERC-20 input:

```ts
const token = new ethers.Contract(
  tokenIn,
  ["function approve(address spender, uint256 amount) returns (bool)"],
  signer,
);

await (
  await token.approve(ROBINHOOD_SWITCH_CONTRACTS.router, amountIn)
).wait();
```

Then submit the transaction returned by the API:

```ts
await signer.sendTransaction({
  to: transaction.to,
  data: transaction.data,
  value: transaction.value,
});
```

For native ETH input, skip approval and send the API-provided `value`.

## Swap API reference

All amounts are raw integer strings in the token's smallest unit. All token and
wallet values are EVM addresses.

### List adapters

```http
GET https://quote.switch.win/swap/adapters?network=robinhood
x-api-key: YOUR_KEY
```

Robinhood currently returns:

| Index | Adapter |
|---:|---|
| `0` | Uniswap V2 |
| `1` | Uniswap V3 |
| `2` | Uniswap V4 |
| `3` | Switch Limit Orders |
| `4` | SwapHood V2 |
| `5` | SwapHood V3 |
| `6` | Up33 CL |
| `7` | Sheriff V2 |
| `8` | Sheriff Algebra |
| `9` | Aeon Algebra |
| `10` | Catnip V2 |
| `11` | PancakeSwap V2 |
| `12` | RobinSwap V3 |
| `13` | SushiSwap V3 |
| `14` | GIGA V2 |
| `15` | GIGA V3 |
| `16` | Flap |
| `17` | Ramses V3 |
| `18` | Ramses V2 |

Treat the endpoint response, not this document, as the source of truth for
which adapters are currently selectable.

Do not permanently hard-code the available adapter list in an integration.
Fetch it when presenting routing-source controls. If a quote involves a tax
token, the backend restricts routing to tax-safe adapters `0`, `4`, `7`, `10`,
`11`, `14`, `16`, and `18`; an explicit filter that excludes all of them is
rejected.

### Check token tax

```http
GET https://quote.switch.win/swap/checkTax?network=robinhood&token=0xTOKEN
```

Example response:

```json
{
  "token": "0x...",
  "isTaxToken": true,
  "buyTaxBps": 500,
  "sellTaxBps": 300
}
```

`500` basis points is `5%`. Use the input token's `sellTaxBps` and the output
token's `buyTaxBps`. When both tokens are taxed, use fee-on-input.

### Get swap quote

```http
GET https://quote.switch.win/swap/quote
```

| Query parameter | Required | Description |
|---|:---:|---|
| `network` | Yes | Must be `robinhood`. |
| `from` | Yes | Input token address or `ROBINHOOD_NATIVE_ETH`. |
| `to` | Yes | Output token address or `ROBINHOOD_NATIVE_ETH`. |
| `amount` | Yes | Raw input amount. |
| `sender` | No | Required when transaction calldata is needed. |
| `receiver` | No | Output recipient; defaults to `sender`. |
| `slippage` | No | Basis points; API fallback `50` (`0.5%`). The Switch Robinhood frontend explicitly requests `100` (`1%`). |
| `fee` | No | Partner/protocol fee in basis points. |
| `partnerAddress` | No | Fee-sharing recipient. |
| `feeOnOutput` | No | `true` takes the fee from output; `false` takes it from input. |
| `adapters` | No | Comma-separated indices returned by `/swap/adapters`, such as `0,1,2`. |
| `gasPrice` | No | Quote gas price in wei. |

Omitting `sender` produces a display-only quote. Request a fresh executable
quote with `sender` immediately before execution.

### Quote response

Important response fields:

| Field | Description |
|---|---|
| `fromToken`, `toToken` | Normalized pair addresses. |
| `totalAmountIn` | Gross input amount. |
| `totalAmountOut` | Quoted route output before the Switch fee and slippage. Adapter-native quotes such as Flap Portal may already include token tax. |
| `expectedOutputAmount` | Expected user receipt after tax and fee, before slippage. |
| `minAmountOut` | Minimum output after adapter-specific tax accounting, fee, and slippage; use it directly. |
| `paths` | Human-readable route descriptions. |
| `routeAllocation` | Human-readable split, hop, and adapter allocation. Adapter payloads such as V4 PoolKey data are encoded in the executable transaction and must not be reconstructed from this display object. |
| `fromTokenTax`, `toTokenTax` | Detected tax metadata. |
| `effectiveSlippageBps` | Slippage plus applicable tax buffers. |
| `tx` | Fee-on-input transaction; present when `sender` is supplied. |
| `txFeeOnOutput` | Fee-on-output transaction; present when `sender` is supplied. |

Treat the response as authoritative. Do not recalculate output taxes, route
splits, minimum output, or calldata in the client.

## Error handling

The API can return an `{ "error": "..." }` object for validation or routing
failures. Check both the HTTP status and the response body before using quote
fields.

Common Robinhood errors include:

- Missing or unsupported `network`.
- Invalid token, sender, receiver, or partner address.
- Invalid raw amount, slippage, fee, gas price, or adapter filter.
- A tax-token quote explicitly excluded every tax-safe direct-pair V2 adapter.
- No viable route across the currently active adapters, or insufficient liquidity.
- RPC timeout or public-RPC rate limiting.
- Missing executable transaction because `sender` was omitted.

On-chain reverts can still occur if allowance, wallet balance, slippage,
liquidity, token tax, or chain state changes after quoting. Fetch a fresh quote
before retrying rather than resubmitting stale calldata.

## Partner fee sharing

Pass `fee` in basis points and `partnerAddress` in the quote request. The chosen
fee mode determines the fee token:

- `feeOnOutput=false`: collect from the input token and submit `quote.tx`.
- `feeOnOutput=true`: collect from the output token and submit
  `quote.txFeeOnOutput`.

Always pass `feeOnOutput` while quoting so routing and
`expectedOutputAmount` match the transaction variant you will execute. Partner
fee eligibility and revenue share are controlled by the API-key agreement; do
not assume that supplying an address alone enables sharing.

## Tokens and routing

### Curated frontend token list

The token dropdown contains the following ERC-20 tokens. Native ETH is merged
into the UI separately from this list.

| Symbol | Name | Address | Decimals |
|---|---|---|---:|
| WETH | Wrapped Ether | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | 18 |
| USDG | Global Dollar | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |
| VIRTUAL | Virtuals Protocol | `0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31` | 18 |
| CASHCAT | Cash Cat | `0x020bfC650A365f8BB26819deAAbF3E21291018b4` | 18 |
| WALLET | Robinhood Wallet | `0x0339f5459FC690aC85F1782e15782A151b4A9E1b` | 18 |
| SEEDCOIN | Seedcoin | `0x58f693A30F124E59b125F7c7b837b0F6bbAF5a45` | 18 |
| JUGGERNAUT | The Juggernaut | `0xD7321801CAae694090694Ff55A9323139F043B88` | 18 |
| HOODRAT | Hoodrat | `0x8e62F281f282686fCa6dCB39288069a93fC23F1c` | 18 |
| DIH | Dog In Hood | `0x17bb0C898254406b1Ea2e8E99B0C263e26c9E4a4` | 18 |
| KITSU | KITSU | `0x8d4dFaaA4198b6486E0293Fec914C2B6a821D4DC` | 18 |
| WEN | Wen Lambo | `0xA80eb66b3E0CF66ccB46f8b8C9e7ff5803eEb820` | 18 |
| REPE | Robinhood Pepe | `0x5266eeafF092D6136AB63D18B975A60a0Cc0C8f7` | 18 |
| TENDIES | TENDIES | `0x45242320DBB855EeA8Fd36804C6487E10E97FCF9` | 18 |
| GME | GameStop | `0x7e86381A763F0Ecca2bDF27C54eAC403ddD48123` | 18 |
| 4663 | 4663 | `0xd4052415613B34Af236024B895574c467f65b6dD` | 18 |
| MARIAN | Lady Marian | `0x01637b14B7378B99dE75A64d50656d98488D9a4d` | 18 |
| Index | The Index | `0x56910D4409F3a0C78C64DD8D0545FF0705389870` | 18 |
| VEX | ProjectVex | `0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b` | 18 |
| HOODIE | HOODIE | `0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3` | 18 |
| WISHBONE | WISHBONE | `0x77581054581B9c525E7dd7a0155DE43867532d03` | 18 |
| VLAD | The Green Bull | `0x31BE8f7485e36928C9De86566c62da82d4B6BF81` | 18 |
| AEON | Aeon | `0xd4c93eD1843606f92CccA078941f3d52A585982f` | 18 |

The ordered list is exported as `ROBINHOOD_FRONTEND_TOKEN_LIST`.

These community tokens are frontend conveniences, not an endorsement or a
guarantee of liquidity, price stability, tax behavior, or contract safety.
Always identify tokens by address and obtain a fresh quote and tax check.

### Routing configuration

The production router currently exposes nineteen ordered adapters:

| Index | Venue | Routing family |
|---:|---|---|
| `0` | Uniswap V2 | Direct-pair V2 |
| `1` | Uniswap V3 | V3 tiers `100`, `500`, `3000`, `10000` |
| `2` | Uniswap V4 | Complete hookless static-fee `PoolKey` |
| `3` | Switch limit orders | Signed/on-chain order liquidity |
| `4` | SwapHood V2 | Pair-owned variable-fee V2 |
| `5` | SwapHood V3 | Pancake V3 tiers `100`, `500`, `2500`, `10000` |
| `6` | Up33 | Slipstream CL tick spacings `1`, `10`, `50`, `60`, `100`, `200`, `2000` |
| `7` | Sheriff V2 | Pair-owned variable-fee V2 |
| `8` | Sheriff | Algebra Integral |
| `9` | Aeon | Algebra Integral with plugin-aware fees |
| `10` | Catnip | Direct-pair V2, fixed 30 bps |
| `11` | PancakeSwap | Direct-pair V2, fixed 25 bps |
| `12` | RobinSwap | V3 tiers `100`, `500`, `2500`, `3000`, `10000` |
| `13` | SushiSwap | V3 tiers `500`, `3000`, `10000` |
| `14` | GIGA V2 | Direct-pair V2 using the pair's live quote and pair-owned fee |
| `15` | GIGA V3 | V3 tiers `100`, `500`, `1000`, `2000`, `3000`, `10000` |
| `16` | Flap | Portal-executed bonding curve; Portal quote includes token tax |
| `17` | Ramses V3 | Tick spacings `1`, `5`, `10`, `50`, `100`, `200`, stored in the route `fee` field |
| `18` | Ramses V2 | Direct-pair, pair-owned variable-fee V2 |

V4 pools are discovered by complete `PoolKey`, not by applying a V3 fee-tier
list. Native-ETH V4 currencies are normalized through the WETH/native alias
described above. V3-style and Up33 route legs preserve the exact fee tier or
tick spacing that won the quote for every direct and multi-hop allocation.

Trusted routing hubs are WETH, USDG, VIRTUAL, CASHCAT, HOODRAT, TENDIES,
JUGGERNAUT, MARIAN, and WALLET. The expanded set was selected from the
2026-07-16 pair-connectivity audit and zero-tax checks. VEX is excluded because
it is taxed; INDEX remains an endpoint token but is excluded because its
dominant liquidity depends on V4 hooks that are not yet supported. If either side is
detected as a transfer-tax token, the backend restricts the entire route to
tax-safe adapters `0`, `4`, `7`, `10`, `11`, `14`, `16`, and `18`;
concentrated-liquidity and limit-order adapters are excluded. Flap is the one
non-direct-pair member: only its Portal can execute the curve swap, and the
Portal quote already includes the Flap token tax.

The API may split a quote across routes and adapters. Integrators should render
the returned `paths` or `routeAllocation` instead of assuming a single path.

## Rate limits

Rate limits are assigned to the API key. A `429` response means the integration
must back off. Use request coalescing and short-lived UI caching, avoid polling
unchanged quotes, and debounce amount input before requesting a new route.

For server integrations, contact Switch to coordinate the expected request
rate and IP allowlisting. Do not distribute one production key across
untrusted clients.

## Current limitations

- Rialto liquidity is not integrated.
- Robinhood market routing is limited to the nineteen production adapters
  listed above. Always use `/swap/adapters` as the runtime source of truth.
- The first V4 phase intentionally excludes hooked and dynamic-fee pools.
- A V4 allocation currently selects its best single PoolKey; intra-V4
  multi-pool splitting is not yet enabled. V4 can still split against other
  eligible adapters.
- Contract and token addresses must be treated as chain-specific.

See the main [SDK reference](README.md) for authentication, partner fees,
response types, error handling, and the complete swap API schema.

## Support

- Documentation: <https://docs.switch.win>
- Website: <https://switch.win>
- Quote API: <https://quote.switch.win>

## License

See [LICENSE](LICENSE).
