/**
 * Switch DEX Aggregator — Complete Swap Example (ethers.js v6)
 *
 * Demonstrates the full swap lifecycle:
 *   1. Fetch adapters (optional — for DEX filtering)
 *   2. Check token taxes (determines feeOnOutput mode)
 *   3. Get quote with exact expectedOutputAmount
 *   4. Approve ERC-20 (if needed)
 *   5. Send swap transaction
 *
 * Usage:
 *   npx tsx examples/swap-ethers.ts
 *
 * Prerequisites:
 *   npm install ethers
 *   Set SWITCH_API_KEY and PRIVATE_KEY environment variables.
 */

import { ethers } from "ethers";
import type {
  BestPathResponse,
  CheckTaxResponse,
  AdaptersResponse,
} from "../src/types";
import {
  API_BASE,
  QUOTE_ENDPOINT,
  ADAPTERS_ENDPOINT,
  CHECK_TAX_ENDPOINT,
  SWITCH_ROUTER,
  NATIVE_PLS,
  WPLS,
  ERC20_ABI,
} from "../src/constants";

// ── Configuration --

const API_KEY = process.env.SWITCH_API_KEY!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const RPC_URL = process.env.RPC_URL ?? "https://rpc.pulsechain.com";

if (!API_KEY) throw new Error("Set SWITCH_API_KEY env var");
if (!PRIVATE_KEY) throw new Error("Set PRIVATE_KEY env var");

// ── Swap parameters --

const FROM_TOKEN = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27"; // WPLS
const TO_TOKEN = "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab"; // PLSX
const AMOUNT = ethers.parseUnits("1000", 18).toString(); // 1000 WPLS
const SLIPPAGE_BPS = 100; // 1%
const FEE_BPS = 30; // 0.30%
const PARTNER_ADDRESS = "0x0000000000000000000000000000000000000000"; // your partner wallet
const RECEIVER_ADDRESS = ""; // custom recipient address, or "" to send to sender

// ── Main --

/** Helper to make authenticated API calls */
async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "x-api-key": API_KEY } });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** Determine feeOnOutput based on tax info and PLS involvement */
function determineFeeOnOutput(
  fromToken: string,
  toToken: string,
  fromTax: CheckTaxResponse,
  toTax: CheckTaxResponse,
): boolean {
  const plsAddresses = [NATIVE_PLS.toLowerCase(), WPLS.toLowerCase()];
  const fromAddr = fromToken.toLowerCase();
  const toAddr = toToken.toLowerCase();

  // Both tax tokens → fee on input to avoid extra output-token transfers.
  if (fromTax.isTaxToken && toTax.isTaxToken) return false;

  // If selling a tax token → fee on output (avoids fee being reduced by sell tax)
  if (fromTax.isTaxToken && fromTax.sellTaxBps > 0) return true;

  // If buying a tax token → fee on input (avoids collecting tax tokens as fee)
  if (toTax.isTaxToken && toTax.buyTaxBps > 0) return false;

  // Buying PLS → fee on output (collect PLS)
  if (plsAddresses.includes(toAddr)) return true;

  // Selling PLS → fee on input (collect PLS)
  if (plsAddresses.includes(fromAddr)) return false;

  // Default
  return true;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const sender = await signer.getAddress();

  console.log(`Sender: ${sender}`);
  console.log(`Swapping ${AMOUNT} wei of ${FROM_TOKEN} → ${TO_TOKEN}`);

  // ── Step 1: Fetch available adapters (optional — cache this) ──
  console.log("\n── Step 1: Fetching adapters ──");
  const { adapters } = await apiFetch<AdaptersResponse>(
    `${ADAPTERS_ENDPOINT}?network=pulsechain`,
  );
  console.log(`Available DEXes: ${adapters.map((a) => a.name).join(", ")}`);

  // ── Step 2: Check token taxes --
  console.log("\n── Step 2: Checking token taxes ──");
  const [fromTax, toTax] = await Promise.all([
    apiFetch<CheckTaxResponse>(
      `${CHECK_TAX_ENDPOINT}?token=${FROM_TOKEN}&network=pulsechain`,
    ),
    apiFetch<CheckTaxResponse>(
      `${CHECK_TAX_ENDPOINT}?token=${TO_TOKEN}&network=pulsechain`,
    ),
  ]);

  console.log(
    `From token: ${fromTax.isTaxToken ? `TAX (sell=${fromTax.sellTaxBps}bps, buy=${fromTax.buyTaxBps}bps)` : "not a tax token"}`,
  );
  console.log(
    `To token:   ${toTax.isTaxToken ? `TAX (sell=${toTax.sellTaxBps}bps, buy=${toTax.buyTaxBps}bps)` : "not a tax token"}`,
  );

  // ── Determine fee mode --
  const feeOnOutput = determineFeeOnOutput(FROM_TOKEN, TO_TOKEN, fromTax, toTax);
  console.log(`Fee mode: fee on ${feeOnOutput ? "output" : "input"}`);

  // ── Step 3: Get quote with feeOnOutput for exact estimate --
  console.log("\n── Step 3: Fetching quote ──");
  const params = new URLSearchParams({
    network: "pulsechain",
    from: FROM_TOKEN,
    to: TO_TOKEN,
    amount: AMOUNT,
    sender,
    slippage: String(SLIPPAGE_BPS),
    feeOnOutput: String(feeOnOutput),
  });
  if (FEE_BPS > 0) params.set("fee", String(FEE_BPS));
  if (PARTNER_ADDRESS !== "0x0000000000000000000000000000000000000000") {
    params.set("partnerAddress", PARTNER_ADDRESS);
  }
  if (RECEIVER_ADDRESS) params.set("receiver", RECEIVER_ADDRESS);

  // (Optional) restrict routing to specific DEXes by index.
  // Get indices from Step 1 (adapters). Omit to use all DEXes.
  // Example: route only through PulseXV2 (3) and UniswapV3 (6):
  // params.set("adapters", "3,6");

  const url = `${QUOTE_ENDPOINT}?${params}`;
  console.log(`URL: ${url}\n`);

  const quote = await apiFetch<BestPathResponse | { error: string }>(url);

  if ("error" in quote) {
    throw new Error(`Quote error: ${quote.error}`);
  }

  if (!quote.tx) {
    throw new Error("No tx object in response — did you provide sender?");
  }

  // Choose the matching tx variant for the fee mode we determined
  const chosenTx = feeOnOutput ? quote.txFeeOnOutput! : quote.tx;

  console.log(`Raw DEX output:     ${quote.totalAmountOut}`);
  console.log(`Expected received:  ${quote.expectedOutputAmount}`);
  console.log(`Min output:         ${quote.minAmountOut}`);
  console.log(`Eff. slippage:      ${quote.effectiveSlippagePercent}%`);
  console.log(`Paths:              ${quote.paths.length}`);

  // ── Step 4: Approve ERC-20 (skip for native PLS) --
  if (FROM_TOKEN.toLowerCase() !== NATIVE_PLS.toLowerCase()) {
    const token = new ethers.Contract(FROM_TOKEN, ERC20_ABI, signer);
    const currentAllowance: bigint = await token.allowance(
      sender,
      SWITCH_ROUTER,
    );

    if (currentAllowance < BigInt(AMOUNT)) {
      console.log("\nApproving SwitchRouter to spend tokens...");
      const approveTx = await token.approve(SWITCH_ROUTER, AMOUNT);
      const approveReceipt = await approveTx.wait();
      console.log(`Approved in tx: ${approveReceipt.hash}`);
    } else {
      console.log("\nSufficient allowance already granted");
    }
  }

  // ── Step 5: Send swap transaction --
  console.log("\nSending swap transaction...");
  const txResponse = await signer.sendTransaction({
    to: chosenTx.to,
    data: chosenTx.data,
    value: chosenTx.value,
  });

  console.log(`Tx hash: ${txResponse.hash}`);
  const receipt = await txResponse.wait();
  console.log(`\nSwap confirmed in block ${receipt!.blockNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
