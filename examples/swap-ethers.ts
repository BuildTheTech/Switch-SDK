/**
 * Switch DEX Aggregator — Complete Swap Example (ethers.js v6)
 *
 * Demonstrates the full swap lifecycle: quote → approve → send.
 *
 * Usage:
 *   npx tsx examples/swap-ethers.ts
 *
 * Prerequisites:
 *   npm install ethers
 *   Set SWITCH_API_KEY and PRIVATE_KEY environment variables.
 */

import { ethers } from "ethers";
import type { BestPathResponse } from "../src/types";
import {
  API_BASE,
  SWITCH_ROUTER,
  NATIVE_PLS,
  ERC20_ABI,
} from "../src/constants";

// ── Configuration ───────────────────────────────────────────────────

const API_KEY = process.env.SWITCH_API_KEY!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const RPC_URL = process.env.RPC_URL ?? "https://rpc.pulsechain.com";

if (!API_KEY) throw new Error("Set SWITCH_API_KEY env var");
if (!PRIVATE_KEY) throw new Error("Set PRIVATE_KEY env var");

// ── Swap parameters ─────────────────────────────────────────────────

const FROM_TOKEN = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27"; // WPLS
const TO_TOKEN = "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab"; // PLSX
const AMOUNT = ethers.parseUnits("1000", 18).toString(); // 1000 WPLS
const SLIPPAGE_BPS = 100; // 1%
const FEE_BPS = 30; // 0.30%
const FEE_ON_OUTPUT = true;
const PARTNER_ADDRESS = "0x0000000000000000000000000000000000000000"; // your partner wallet
const RECEIVER_ADDRESS = ""; // custom recipient address, or "" to send to sender

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const sender = await signer.getAddress();

  console.log(`Sender: ${sender}`);
  console.log(`Swapping ${AMOUNT} wei of ${FROM_TOKEN} → ${TO_TOKEN}`);

  // ── 1. Fetch quote with tx calldata ───────────────────────────
  const params = new URLSearchParams({
    network: "pulsechain",
    from: FROM_TOKEN,
    to: TO_TOKEN,
    amount: AMOUNT,
    sender,
    slippage: String(SLIPPAGE_BPS),
  });
  if (FEE_BPS > 0) params.set("fee", String(FEE_BPS));
  if (FEE_ON_OUTPUT) params.set("feeOnOutput", "true");
  if (PARTNER_ADDRESS !== "0x0000000000000000000000000000000000000000") {
    params.set("partnerAddress", PARTNER_ADDRESS);
  }
  if (RECEIVER_ADDRESS) params.set("receiver", RECEIVER_ADDRESS);

  const url = `${API_BASE}/swap/quote?${params}`;
  console.log(`\nFetching quote: ${url}\n`);

  const res = await fetch(url, {
    headers: { "x-api-key": API_KEY },
  });

  if (!res.ok) {
    throw new Error(`Quote request failed: ${res.status} ${res.statusText}`);
  }

  const quote = (await res.json()) as BestPathResponse | { error: string };

  if ("error" in quote) {
    throw new Error(`Quote error: ${quote.error}`);
  }

  if (!quote.tx) {
    throw new Error("No tx object in response — did you provide sender?");
  }

  console.log(`Expected output: ${quote.totalAmountOut}`);
  console.log(`Min output:      ${quote.minAmountOut}`);
  console.log(`Eff. slippage:   ${quote.effectiveSlippagePercent}%`);
  console.log(`Paths:           ${quote.paths.length}`);

  // ── 2. Approve ERC-20 (skip for native PLS) ──────────────────
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

  // ── 3. Send swap transaction ──────────────────────────────────
  console.log("\nSending swap transaction...");
  const txResponse = await signer.sendTransaction({
    to: quote.tx.to,
    data: quote.tx.data,
    value: quote.tx.value,
  });

  console.log(`Tx hash: ${txResponse.hash}`);
  const receipt = await txResponse.wait();
  console.log(`\nSwap confirmed in block ${receipt!.blockNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
