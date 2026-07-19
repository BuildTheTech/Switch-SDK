/**
 * Switch Limit Orders — Complete Example (ethers.js v6)
 *
 * Demonstrates the full limit order lifecycle:
 *   1. Build order parameters
 *   2. Approve the selected network's current contract to spend input tokens
 *   3. Sign the order via EIP-712
 *   4. Submit the signed order to the Switch backend
 *   5. Query your active orders
 *   6. Cancel an order on-chain
 *
 * Usage:
 *   npx tsx examples/limit-order-ethers.ts
 *
 * Prerequisites:
 *   npm install ethers
 *   Set PRIVATE_KEY environment variable.
 */

import { ethers } from "ethers";
import {
  buildLimitOrder,
  getNetworkEIP712SigningParams,
  getLimitOrderApprovalTarget,
  fetchLimitOrderConfig,
  submitLimitOrder,
  fetchLimitOrders,
  fetchLimitOrder,
  fetchLimitOrderPairs,
  fetchLimitOrderStats,
} from "../src/limit-orders";
import {
  ERC20_ABI,
  LIMIT_ORDER_ABI,
} from "../src/constants";
import type { LimitOrderNetwork } from "../src/limit-orders";

// ── Configuration ───────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const NETWORK = (process.env.SWITCH_NETWORK ?? "pulsechain") as LimitOrderNetwork;
if (NETWORK !== "pulsechain" && NETWORK !== "robinhood") {
  throw new Error("SWITCH_NETWORK must be pulsechain or robinhood");
}
const RPC_URL = process.env.RPC_URL ?? (
  NETWORK === "robinhood"
    ? "https://rpc.mainnet.chain.robinhood.com"
    : "https://pulsechain-rpc.publicnode.com"
);

if (!PRIVATE_KEY) throw new Error("Set PRIVATE_KEY env var");

// ── Order parameters ────────────────────────────────────────────────────────

const TOKEN_IN = process.env.TOKEN_IN ?? (
  NETWORK === "robinhood"
    ? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" // USDG
    : "0xA1077a294dDE1B09bB078844df40758a5D0f9a27" // WPLS
);
const TOKEN_OUT = process.env.TOKEN_OUT ?? (
  NETWORK === "robinhood"
    ? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" // WETH
    : "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab" // PLSX
);
const AMOUNT_IN = process.env.AMOUNT_IN ?? "1000000";
const MIN_AMOUNT_OUT = process.env.MIN_AMOUNT_OUT ?? "1";

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const maker = await signer.getAddress();
  const liveConfig = await fetchLimitOrderConfig({ network: NETWORK });

  console.log(`Maker: ${maker}`);
  console.log(`Limit order: ${AMOUNT_IN} wei of ${TOKEN_IN} → min ${MIN_AMOUNT_OUT} wei of ${TOKEN_OUT}\n`);

  // ── Step 1: Build the order ───────────────────────────────────────────
  console.log("── Step 1: Building order ──");
  const order = buildLimitOrder({
    maker,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amountIn: AMOUNT_IN,
    minAmountOut: MIN_AMOUNT_OUT,
    deadline: Math.floor(Date.now() / 1000) + 86400, // 24-hour expiry
    // nonce: auto-generated from Date.now()
    // feeOnOutput: false (default)
    // recipient: maker (default)
    // unwrapOutput: false (default)
  });

  console.log(`Nonce:    ${order.nonce}`);
  console.log(`Deadline: ${new Date(order.deadline * 1000).toISOString()}`);

  // ── Step 2: Approve the correct contract for this fee mode ────────────
  console.log("\n── Step 2: Approving token spend ──");
  const approvalTarget = getLimitOrderApprovalTarget(
    NETWORK,
    order.feeOnOutput,
    { limitOrderContract: liveConfig.limitOrderContract },
  );
  const token = new ethers.Contract(TOKEN_IN, ERC20_ABI, signer);
  const currentAllowance: bigint = await token.allowance(maker, approvalTarget);

  if (currentAllowance < BigInt(AMOUNT_IN)) {
    console.log(`Approving ${approvalTarget} to spend ${AMOUNT_IN} wei...`);
    const approveTx = await token.approve(approvalTarget, AMOUNT_IN);
    const approveReceipt = await approveTx.wait();
    console.log(`Approved in tx: ${approveReceipt.hash}`);
  } else {
    console.log("Sufficient allowance already granted");
  }

  // ── Step 3: Sign the order via EIP-712 ────────────────────────────────
  console.log("\n── Step 3: Signing order (EIP-712) ──");
  const { domain, types } = getNetworkEIP712SigningParams(
    NETWORK,
    liveConfig.limitOrderContract,
  );
  const signature = await signer.signTypedData(domain, types, order);
  console.log(`Signature: ${signature.slice(0, 20)}...`);

  // ── Step 4: Submit signedorder to the Switch backend ─────────────────
  console.log("\n── Step 4: Submitting order to backend ──");
  const result = await submitLimitOrder(
    { ...order, signature, limitOrderContract: liveConfig.limitOrderContract },
    { network: NETWORK },
  );

  if ("error" in result) {
    throw new Error(`Submit failed: ${result.error}`);
  }

  console.log(`Order created! ID: ${result.order.id}`);
  console.log(`Status: ${result.order.status}`);

  // ── Step 5: Query orders ──────────────────────────────────────────────
  console.log("\n── Step 5: Querying orders ──");

  // Fetch all active orders for this maker
  const { orders, total } = await fetchLimitOrders({
    maker,
    status: "ACTIVE",
    network: NETWORK,
  });
  console.log(`Active orders for ${maker}: ${total}`);
  for (const o of orders) {
    console.log(`  [nonce=${o.nonce}] ${o.tokenIn} → ${o.tokenOut} | ${o.amountIn} → min ${o.minAmountOut}`);
  }

  // Fetch the specific order we just created
  const fetched = await fetchLimitOrder(maker, order.nonce, { network: NETWORK });
  if ("error" in fetched) {
    console.log(`  Lookup failed: ${fetched.error}`);
  } else {
    console.log(`\nFetched order: nonce=${fetched.nonce}, status=${fetched.status}`);
  }

  // Check active pairs
  const pairs = await fetchLimitOrderPairs({ network: NETWORK });
  console.log(`\nActive pairs: ${pairs.length}`);
  for (const p of pairs) {
    console.log(`  ${p.pairKey} — ${p.activeOrders} orders`);
  }

  // Global stats
  const stats = await fetchLimitOrderStats({ network: NETWORK });
  console.log(`\nStats: active=${stats.active}, filled=${stats.filled}, cancelled=${stats.cancelled}, expired=${stats.expired}`);

  // ── Step 6: Cancel the order ──────────────────────────────────────────
  console.log("\n── Step 6: Cancelling order ──");

  // Cancel on-chain (prevents the filler bot from executing it). Use the
  // per-order contract so older orders remain cancellable after upgrades.
  console.log("Invalidating nonce on-chain...");
  const limitOrderContract = new ethers.Contract(
    result.order.limitOrderContract ?? liveConfig.limitOrderContract,
    LIMIT_ORDER_ABI,
    signer,
  );
  const cancelTx = await limitOrderContract.invalidateNonce(order.nonce);
  const cancelReceipt = await cancelTx.wait();
  console.log(`Nonce invalidated in tx: ${cancelReceipt.hash}`);

  // The backend indexer observes NonceCancelled and updates order status.

  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
