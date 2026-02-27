/**
 * Switch Limit Orders — Complete Example (ethers.js v6)
 *
 * Demonstrates the full limit order lifecycle:
 *   1. Build order parameters
 *   2. Approve the V2 contract to spend input tokens
 *   3. Sign the order via EIP-712
 *   4. Submit the signed order to the Switch backend
 *   5. Query your active orders
 *   6. Cancel an order (on-chain + backend)
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
  getEIP712SigningParams,
  getApprovalTarget,
  submitLimitOrder,
  cancelLimitOrder,
  fetchLimitOrders,
  fetchLimitOrder,
  fetchLimitOrderPairs,
  fetchLimitOrderStats,
} from "../src/limit-orders";
import {
  SWITCH_LIMIT_ORDER,
  ERC20_ABI,
  LIMIT_ORDER_ABI,
  WPLS,
} from "../src/constants";

// ── Configuration ───────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const RPC_URL = process.env.RPC_URL ?? "https://rpc.pulsechain.com";

if (!PRIVATE_KEY) throw new Error("Set PRIVATE_KEY env var");

// ── Order parameters ────────────────────────────────────────────────────────

const TOKEN_IN = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27"; // WPLS
const TOKEN_OUT = "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab"; // PLSX
const AMOUNT_IN = ethers.parseUnits("1000", 18).toString(); // 1000 WPLS
const MIN_AMOUNT_OUT = ethers.parseUnits("500000", 18).toString(); // minimum 500,000 PLSX

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const maker = await signer.getAddress();

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

  // ── Step 2: Approve the V2 contract to spend tokenIn ──────────────────
  console.log("\n── Step 2: Approving token spend ──");
  const approvalTarget = getApprovalTarget();
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
  const { domain, types } = getEIP712SigningParams();
  const signature = await signer.signTypedData(domain, types, order);
  console.log(`Signature: ${signature.slice(0, 20)}...`);

  // ── Step 4: Submit signedorder to the Switch backend ─────────────────
  console.log("\n── Step 4: Submitting order to backend ──");
  const result = await submitLimitOrder({ ...order, signature });

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
  });
  console.log(`Active orders for ${maker}: ${total}`);
  for (const o of orders) {
    console.log(`  [nonce=${o.nonce}] ${o.tokenIn} → ${o.tokenOut} | ${o.amountIn} → min ${o.minAmountOut}`);
  }

  // Fetch the specific order we just created
  const fetched = await fetchLimitOrder(maker, order.nonce);
  if ("error" in fetched) {
    console.log(`  Lookup failed: ${fetched.error}`);
  } else {
    console.log(`\nFetched order: nonce=${fetched.nonce}, status=${fetched.status}`);
  }

  // Check active pairs
  const pairs = await fetchLimitOrderPairs();
  console.log(`\nActive pairs: ${pairs.length}`);
  for (const p of pairs) {
    console.log(`  ${p.pairKey} — ${p.activeOrders} orders`);
  }

  // Global stats
  const stats = await fetchLimitOrderStats();
  console.log(`\nStats: active=${stats.active}, filled=${stats.filled}, cancelled=${stats.cancelled}, expired=${stats.expired}`);

  // ── Step 6: Cancel the order ──────────────────────────────────────────
  console.log("\n── Step 6: Cancelling order ──");

  // Step 6a: Cancel on-chain (prevents the filler bot from executing it)
  console.log("Invalidating nonce on-chain...");
  const limitOrderContract = new ethers.Contract(
    SWITCH_LIMIT_ORDER,
    LIMIT_ORDER_ABI,
    signer,
  );
  const cancelTx = await limitOrderContract.invalidateNonce(order.nonce);
  const cancelReceipt = await cancelTx.wait();
  console.log(`Nonce invalidated in tx: ${cancelReceipt.hash}`);

  // Step 6b: Notify the backend (removes from the active orderbook)
  console.log("Notifying backend...");
  const cancelResult = await cancelLimitOrder(maker, order.nonce);
  if ("error" in cancelResult) {
    console.log(`Backend cancel info: ${cancelResult.error}`);
  } else {
    console.log("Order cancelled on backend");
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
