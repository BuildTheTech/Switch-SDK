import { API_BASE } from "../constants.js";

/** API network value used by Switch endpoints. */
export const ROBINHOOD_NETWORK = "robinhood" as const;

/** Robinhood Chain mainnet metadata. */
export const ROBINHOOD_CHAIN = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrl: "https://robinhoodchain.blockscout.com",
} as const;

/** Native-ETH sentinel accepted by the Switch quote API. */
export const ROBINHOOD_NATIVE_ETH =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** Switch contracts deployed on Robinhood Chain. */
export const ROBINHOOD_SWITCH_CONTRACTS = {
  /** ERC-20 approval target. Use quote.tx.to when submitting a swap. */
  router: "0x8730C3e2cF2c8CDa8E6166837A1Ed26f46aa9E59",
  routerView: "0xFF6b56d3F444eB5b7FA1db047F57140C84810376",
  limitOrder: "0x752c50DDd3B426cAE3D7A995F313Ac74ac6B0230",
  nativeEthFlow: "0x029FfC6aF9112eA078f1D6f4a98826DDB2136cf6",
  uniswapV2Adapter: "0x7a14d7A8509a66209D4332843b983b29bF5604A4",
  uniswapV3Adapter: "0xbcA08f296d9Ba0dc19Aa0E05D355365cE29A3205",
  uniswapV4Adapter: "0xB9885d3C55e79499bf887F2fBe445e01A8cFFf1c",
  limitOrderAdapter: "0x412F625072c10e58C619D1e0b3C95cd3d5689871",
  swapHoodV2Adapter: "0x6D8746f02e52944c13824fA691c6f4186E463354",
  swapHoodV3Adapter: "0x9645dE0AcB48F0AAefdBEb423F0558457907DE98",
  up33Adapter: "0x388179D2FB0ABcE9b03068916aF8a3c4dfD023c8",
  sheriffV2Adapter: "0xBDB3EB0355981500f58C9bc77c3E61762844A146",
  sheriffAlgebraAdapter: "0xaC4da986100724983042Ec28c28db243E2f828CB",
  aeonAlgebraAdapter: "0x20615954FB87360139e7DdDB519359498EbD1904",
  catnipV2Adapter: "0x5b2Ca358d56490Dc86224D502522314De7707237",
  pancakeSwapV2Adapter: "0x3B6e71A59553143937Fef74a7B50AFD24528786E",
  pancakeSwapV3Adapter: "0xD2Adac87bab4f0f99CF2a21c552c88d1C9825cCC",
  robinSwapV3Adapter: "0x798f77D63b46b0E019de206E111e5ea5CC16BEc8",
  sushiSwapV3Adapter: "0xca3EA0Fd6E31f94c81B6586836790adE638313ED",
  gigaV2Adapter: "0xa379c7D17F7fEe735773879D4069886B117AB54a",
  gigaV3Adapter: "0xcAa612CDe3d3FbE97Be97eB5f79BC91597432d55",
  flapAdapter: "0x6af2A4475C44d5833575150Bf7C3D3FE6Bf4F344",
  ramsesV3Adapter: "0xdBf182774C60932c6fe1Bf3FFaB8Ca28CCb0dC17",
  ramsesV2Adapter: "0x5fe3b873c222e76f7630b40052f07ee06196E6d3",
  limitOrderAdapterIndex: 3,
} as const;

export interface RobinhoodAdapter {
  readonly index: number;
  readonly name: string;
  readonly address: string;
  /** Whether the backend may use this adapter for transfer-tax routes. */
  readonly taxSafe: boolean;
}

/**
 * Snapshot of the ordered production adapter registry verified on 2026-08-09.
 *
 * Adapter registration can change. Fetch
 * `GET /swap/adapters?network=robinhood` when runtime freshness matters.
 */
export const ROBINHOOD_ADAPTERS = [
  {
    index: 0,
    name: "UniswapV2",
    address: ROBINHOOD_SWITCH_CONTRACTS.uniswapV2Adapter,
    taxSafe: true,
  },
  {
    index: 1,
    name: "UniswapV3",
    address: ROBINHOOD_SWITCH_CONTRACTS.uniswapV3Adapter,
    taxSafe: false,
  },
  {
    index: 2,
    name: "UniswapV4",
    address: ROBINHOOD_SWITCH_CONTRACTS.uniswapV4Adapter,
    taxSafe: false,
  },
  {
    index: 3,
    name: "SwitchLimitOrders",
    address: ROBINHOOD_SWITCH_CONTRACTS.limitOrderAdapter,
    taxSafe: false,
  },
  {
    index: 4,
    name: "SwapHoodV2",
    address: ROBINHOOD_SWITCH_CONTRACTS.swapHoodV2Adapter,
    taxSafe: true,
  },
  {
    index: 5,
    name: "SwapHoodV3",
    address: ROBINHOOD_SWITCH_CONTRACTS.swapHoodV3Adapter,
    taxSafe: false,
  },
  {
    index: 6,
    name: "Up33",
    address: ROBINHOOD_SWITCH_CONTRACTS.up33Adapter,
    taxSafe: false,
  },
  {
    index: 7,
    name: "SheriffV2",
    address: ROBINHOOD_SWITCH_CONTRACTS.sheriffV2Adapter,
    taxSafe: true,
  },
  {
    index: 8,
    name: "SheriffAlgebra",
    address: ROBINHOOD_SWITCH_CONTRACTS.sheriffAlgebraAdapter,
    taxSafe: false,
  },
  {
    index: 9,
    name: "AeonAlgebra",
    address: ROBINHOOD_SWITCH_CONTRACTS.aeonAlgebraAdapter,
    taxSafe: false,
  },
  {
    index: 10,
    name: "CatnipV2",
    address: ROBINHOOD_SWITCH_CONTRACTS.catnipV2Adapter,
    taxSafe: true,
  },
  {
    index: 11,
    name: "PancakeSwapV2",
    address: ROBINHOOD_SWITCH_CONTRACTS.pancakeSwapV2Adapter,
    taxSafe: true,
  },
  {
    index: 12,
    name: "PancakeSwapV3",
    address: ROBINHOOD_SWITCH_CONTRACTS.pancakeSwapV3Adapter,
    taxSafe: false,
  },
  {
    index: 13,
    name: "RobinSwapV3",
    address: ROBINHOOD_SWITCH_CONTRACTS.robinSwapV3Adapter,
    taxSafe: false,
  },
  {
    index: 14,
    name: "SushiSwapV3",
    address: ROBINHOOD_SWITCH_CONTRACTS.sushiSwapV3Adapter,
    taxSafe: false,
  },
  {
    index: 15,
    name: "GigaV2",
    address: ROBINHOOD_SWITCH_CONTRACTS.gigaV2Adapter,
    taxSafe: true,
  },
  {
    index: 16,
    name: "GigaV3",
    address: ROBINHOOD_SWITCH_CONTRACTS.gigaV3Adapter,
    taxSafe: false,
  },
  {
    index: 17,
    name: "Flap",
    address: ROBINHOOD_SWITCH_CONTRACTS.flapAdapter,
    taxSafe: true,
  },
  {
    index: 18,
    name: "RamsesV3",
    address: ROBINHOOD_SWITCH_CONTRACTS.ramsesV3Adapter,
    taxSafe: false,
  },
  {
    index: 19,
    name: "RamsesV2",
    address: ROBINHOOD_SWITCH_CONTRACTS.ramsesV2Adapter,
    taxSafe: true,
  },
] as const satisfies readonly RobinhoodAdapter[];

/** Adapter indices currently eligible for Robinhood transfer-tax routes. */
export const ROBINHOOD_TAX_SAFE_ADAPTER_INDICES = [
  0, 4, 7, 10, 11, 15, 17, 19,
] as const;

/** Current Robinhood transfer-tax-safe adapter metadata. */
export const ROBINHOOD_TAX_SAFE_ADAPTERS: readonly RobinhoodAdapter[] =
  ROBINHOOD_ADAPTERS.filter((adapter) => adapter.taxSafe);

/** EIP-712 domain used for Robinhood ERC-20 limit-order signatures. */
export const ROBINHOOD_LIMIT_ORDER_EIP712_DOMAIN = {
  name: "SwitchLimitOrder",
  version: "2",
  chainId: ROBINHOOD_CHAIN.id,
  verifyingContract: ROBINHOOD_SWITCH_CONTRACTS.limitOrder,
} as const;

/** Uniswap contracts used by the Robinhood Switch deployment. */
export const ROBINHOOD_UNISWAP_CONTRACTS = {
  v2Factory: "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f",
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  v3QuoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  v3SwapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
  /** Canonical Uniswap V4 singleton and periphery deployments. */
  v4PoolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  v4PositionDescriptor: "0x9639443158e8c5efa35bd45287bf2effd3d8dc06",
  v4PositionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  v4Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  v4StateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  v4UniversalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

export interface RobinhoodToken {
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

/**
 * Tokens in the Switch Robinhood frontend's curated list.
 *
 * Community-token addresses must never be selected by symbol alone; clones
 * can share the same symbol. The addresses, symbols, and decimals below were
 * checked against Robinhood Chain on 2026-07-11.
 */
export const ROBINHOOD_TOKENS = {
  WETH: {
    address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
  },
  USDG: {
    address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    symbol: "USDG",
    name: "Global Dollar",
    decimals: 6,
  },
  VIRTUAL: {
    address: "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31",
    symbol: "VIRTUAL",
    name: "Virtuals Protocol",
    decimals: 18,
  },
  CASHCAT: {
    address: "0x020bfC650A365f8BB26819deAAbF3E21291018b4",
    symbol: "CASHCAT",
    name: "Cash Cat",
    decimals: 18,
  },
  WALLET: {
    address: "0x0339f5459FC690aC85F1782e15782A151b4A9E1b",
    symbol: "WALLET",
    name: "Robinhood Wallet",
    decimals: 18,
  },
  SEEDCOIN: {
    address: "0x58f693A30F124E59b125F7c7b837b0F6bbAF5a45",
    symbol: "SEEDCOIN",
    name: "Seedcoin",
    decimals: 18,
  },
  JUGGERNAUT: {
    address: "0xD7321801CAae694090694Ff55A9323139F043B88",
    symbol: "JUGGERNAUT",
    name: "The Juggernaut",
    decimals: 18,
  },
  HOODRAT: {
    address: "0x8e62F281f282686fCa6dCB39288069a93fC23F1c",
    symbol: "HOODRAT",
    name: "Hoodrat",
    decimals: 18,
  },
  DIH: {
    address: "0x17bb0C898254406b1Ea2e8E99B0C263e26c9E4a4",
    symbol: "DIH",
    name: "Dog In Hood",
    decimals: 18,
  },
  KITSU: {
    address: "0x8d4dFaaA4198b6486E0293Fec914C2B6a821D4DC",
    symbol: "KITSU",
    name: "KITSU",
    decimals: 18,
  },
  WEN: {
    address: "0xA80eb66b3E0CF66ccB46f8b8C9e7ff5803eEb820",
    symbol: "WEN",
    name: "Wen Lambo",
    decimals: 18,
  },
  REPE: {
    address: "0x5266eeafF092D6136AB63D18B975A60a0Cc0C8f7",
    symbol: "REPE",
    name: "Robinhood Pepe",
    decimals: 18,
  },
  TENDIES: {
    address: "0x45242320DBB855EeA8Fd36804C6487E10E97FCF9",
    symbol: "TENDIES",
    name: "TENDIES",
    decimals: 18,
  },
  GME: {
    address: "0x7e86381A763F0Ecca2bDF27C54eAC403ddD48123",
    symbol: "GME",
    name: "GameStop",
    decimals: 18,
  },
  TOKEN_4663: {
    address: "0xd4052415613B34Af236024B895574c467f65b6dD",
    symbol: "4663",
    name: "4663",
    decimals: 18,
  },
  MARIAN: {
    address: "0x01637b14B7378B99dE75A64d50656d98488D9a4d",
    symbol: "MARIAN",
    name: "Lady Marian",
    decimals: 18,
  },
  INDEX: {
    address: "0x56910D4409F3a0C78C64DD8D0545FF0705389870",
    symbol: "Index",
    name: "The Index",
    decimals: 18,
  },
  VEX: {
    address: "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b",
    symbol: "VEX",
    name: "ProjectVex",
    decimals: 18,
  },
  HOODIE: {
    address: "0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3",
    symbol: "HOODIE",
    name: "HOODIE",
    decimals: 18,
  },
  WISHBONE: {
    address: "0x77581054581B9c525E7dd7a0155DE43867532d03",
    symbol: "WISHBONE",
    name: "WISHBONE",
    decimals: 18,
  },
  VLAD: {
    address: "0x31BE8f7485e36928C9De86566c62da82d4B6BF81",
    symbol: "VLAD",
    name: "The Green Bull",
    decimals: 18,
  },
  AEON: {
    address: "0xd4c93eD1843606f92CccA078941f3d52A585982f",
    symbol: "AEON",
    name: "Aeon",
    decimals: 18,
  },
} as const satisfies Readonly<Record<string, RobinhoodToken>>;

/** Exact ERC-20 ordering used by the Switch Robinhood token dropdown. */
export const ROBINHOOD_FRONTEND_TOKEN_LIST = [
  ROBINHOOD_TOKENS.WETH,
  ROBINHOOD_TOKENS.USDG,
  ROBINHOOD_TOKENS.VIRTUAL,
  ROBINHOOD_TOKENS.CASHCAT,
  ROBINHOOD_TOKENS.WALLET,
  ROBINHOOD_TOKENS.SEEDCOIN,
  ROBINHOOD_TOKENS.JUGGERNAUT,
  ROBINHOOD_TOKENS.HOODRAT,
  ROBINHOOD_TOKENS.DIH,
  ROBINHOOD_TOKENS.KITSU,
  ROBINHOOD_TOKENS.WEN,
  ROBINHOOD_TOKENS.REPE,
  ROBINHOOD_TOKENS.TENDIES,
  ROBINHOOD_TOKENS.GME,
  ROBINHOOD_TOKENS.TOKEN_4663,
  ROBINHOOD_TOKENS.MARIAN,
  ROBINHOOD_TOKENS.INDEX,
  ROBINHOOD_TOKENS.VEX,
  ROBINHOOD_TOKENS.HOODIE,
  ROBINHOOD_TOKENS.WISHBONE,
  ROBINHOOD_TOKENS.VLAD,
  ROBINHOOD_TOKENS.AEON,
] as const satisfies readonly RobinhoodToken[];

/**
 * Tokens used to initialize the Robinhood swap UI.
 *
 * The current default pair is native ETH -> USDG. WETH remains in this set so
 * native/wrapped lookup and token selection use the canonical deployment.
 */
export const ROBINHOOD_FRONTEND_DEFAULT_TOKENS = [
  {
    address: ROBINHOOD_NATIVE_ETH,
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
  },
  ROBINHOOD_TOKENS.WETH,
  ROBINHOOD_TOKENS.USDG,
  ROBINHOOD_TOKENS.VIRTUAL,
  ROBINHOOD_TOKENS.CASHCAT,
  ROBINHOOD_TOKENS.INDEX,
] as const satisfies readonly RobinhoodToken[];

/**
 * Production trusted-hop addresses, ordered by routing usefulness.
 *
 * The 2026-07-16 audit combined Dexscreener pool connectivity with Switch tax
 * simulation, then required multiple meaningful liquidity corridors. VEX is
 * selectable but excluded because it is taxed; INDEX is excluded because its
 * dominant liquidity currently depends on unsupported V4 hooks. Keep this
 * list synchronized with the Robinhood backend and operator bot.
 */
export const ROBINHOOD_TRUSTED_INTERMEDIATES = [
  ROBINHOOD_TOKENS.WETH.address,
  ROBINHOOD_TOKENS.USDG.address,
  ROBINHOOD_TOKENS.VIRTUAL.address,
  ROBINHOOD_TOKENS.CASHCAT.address,
  ROBINHOOD_TOKENS.HOODRAT.address,
  ROBINHOOD_TOKENS.TENDIES.address,
  ROBINHOOD_TOKENS.JUGGERNAUT.address,
  ROBINHOOD_TOKENS.MARIAN.address,
  ROBINHOOD_TOKENS.WALLET.address,
] as const;

/** Preferred Robinhood fee tokens, from highest to lowest priority. */
export const ROBINHOOD_FEE_TOKEN_PRIORITY = [
  ROBINHOOD_TOKENS.WETH.address,
  ROBINHOOD_TOKENS.USDG.address,
  ROBINHOOD_TOKENS.WALLET.address,
  ROBINHOOD_TOKENS.SEEDCOIN.address,
  ROBINHOOD_TOKENS.CASHCAT.address,
] as const;

const ROBINHOOD_FEE_PRIORITY_BY_ADDRESS = new Map<string, number>(
  ROBINHOOD_FEE_TOKEN_PRIORITY.map((address, index) => [
    address.toLowerCase(),
    index + 1,
  ]),
);
ROBINHOOD_FEE_PRIORITY_BY_ADDRESS.set(
  ROBINHOOD_NATIVE_ETH.toLowerCase(),
  1,
);

/** Minimum directional tax data required for fee-mode selection. */
export interface RobinhoodTaxInfo {
  isTaxToken: boolean;
  buyTaxBps: number;
  sellTaxBps: number;
}

/**
 * Select the safer/preferred fee side for a Robinhood swap.
 *
 * Tax safety takes precedence over fee-token preference. Native ETH is treated
 * as equivalent to WETH. `false` means fee on input; `true` means fee on output.
 */
export function selectRobinhoodFeeOnOutput(
  from: string,
  to: string,
  fromTax: RobinhoodTaxInfo,
  toTax: RobinhoodTaxInfo,
): boolean {
  const inputHasSellTax = fromTax.isTaxToken && fromTax.sellTaxBps > 0;
  const outputHasBuyTax = toTax.isTaxToken && toTax.buyTaxBps > 0;

  if (inputHasSellTax && outputHasBuyTax) return false;
  if (outputHasBuyTax) return false;
  if (inputHasSellTax) return true;

  const inputPriority =
    ROBINHOOD_FEE_PRIORITY_BY_ADDRESS.get(from.toLowerCase()) ?? Infinity;
  const outputPriority =
    ROBINHOOD_FEE_PRIORITY_BY_ADDRESS.get(to.toLowerCase()) ?? Infinity;

  if (outputPriority < inputPriority) return true;
  if (inputPriority < outputPriority) return false;
  if (inputPriority !== Infinity) return true;
  return false;
}

export interface RobinhoodQuoteParams {
  from: string;
  to: string;
  /** Raw integer input amount in the input token's smallest unit. */
  amount: string | bigint;
  sender?: string;
  receiver?: string;
  /** Slippage in basis points. */
  slippage?: number;
  /** Partner fee in basis points. */
  fee?: number;
  partnerAddress?: string;
  feeOnOutput?: boolean;
  adapters?: string | readonly number[];
}

/** Build a Robinhood quote URL with the required network value included. */
export function buildRobinhoodQuoteUrl(
  params: RobinhoodQuoteParams,
  apiBase: string = API_BASE,
): string {
  const query = new URLSearchParams({
    network: ROBINHOOD_NETWORK,
    from: params.from,
    to: params.to,
    amount: params.amount.toString(),
  });

  if (params.sender) query.set("sender", params.sender);
  if (params.receiver) query.set("receiver", params.receiver);
  if (params.slippage !== undefined) {
    query.set("slippage", params.slippage.toString());
  }
  if (params.fee !== undefined) query.set("fee", params.fee.toString());
  if (params.partnerAddress) {
    query.set("partnerAddress", params.partnerAddress);
  }
  if (params.feeOnOutput !== undefined) {
    query.set("feeOnOutput", params.feeOnOutput.toString());
  }
  if (params.adapters !== undefined) {
    query.set(
      "adapters",
      Array.isArray(params.adapters)
        ? params.adapters.join(",")
        : String(params.adapters),
    );
  }

  return `${apiBase.replace(/\/$/, "")}/swap/quote?${query.toString()}`;
}
