import { BrowserProvider, type Eip1193Provider } from "ethers";
import {
  GaslessSwapClient,
  createGaslessBrowserStore,
  type GaslessOrderOutcome,
  type GaslessTrade,
  type GaslessEligibility,
  type PreparedGaslessSwap,
} from "../src/gasless-index.js";
import type { LimitOrderNetwork } from "../src/limit-orders.js";

/** Opt-in gasless flow: fixed 0.1% protocol fee plus up to 0.05% operator payout
 * including gas. To offer regular swaps only, leave this flow out and use the
 * regular swap example instead. See GASLESS.md for fee policy and integration steps.
 * Wire these callbacks to your existing swap form/modal. No action runs on import. */
export async function createGaslessSwapFlow(
  wallet: Eip1193Provider,
  network: LimitOrderNetwork,
  ui: {
    /** Main amount: prepared.expectedOutput. Separate minimum: prepared.minAmountOut.
     * Format both with output-token decimals. The SDK signs the exact raw minimum. */
    showQuote(prepared: PreparedGaslessSwap): void;
    showRegular(reason: string): void;
    /** Optional PLS/ETH payout, gas reserve and reason-code display. */
    showEligibility?(eligibility: GaslessEligibility | undefined): void;
    showPending(): void;
    showOutcome(result: GaslessOrderOutcome): void;
    showError(message: string): void;
  },
) {
  const provider = new BrowserProvider(wallet, "any");
  const signer = await provider.getSigner();
  const maker = await signer.getAddress();
  const client = new GaslessSwapClient({
    network,
    provider,
    quoteEndpoint: "/api/switch/swap/quote",
    taxEndpoint: "/api/switch/swap/checkTax",
    ordersEndpoint: "/api/switch/limit-orders",
  });
  const store = createGaslessBrowserStore(network, maker);
  let displayed: PreparedGaslessSwap | undefined;
  let busy = false;
  let quotesPaused = Boolean(await store.load());
  let quoteRequest: AbortController | undefined;
  let signingRequest: AbortController | undefined;
  let intent = 0;
  let unlimited = true; // Explicit user toggle can set false.

  async function quote(trade: Omit<GaslessTrade, "maker">) {
    if (busy || quotesPaused || (await store.load())) return;
    quoteRequest?.abort();
    const controller = (quoteRequest = new AbortController());
    const current = ++intent;
    try {
      const result = await client.quote({ ...trade, maker }, controller.signal);
      if (controller.signal.aborted || current !== intent) return;
      displayed = result.eligible ? result.prepared : undefined;
      ui.showEligibility?.(result.eligibility);
      if (result.eligible) ui.showQuote(result.prepared);
      else ui.showRegular(result.reason);
    } catch (error) {
      if (!controller.signal.aborted && current === intent)
        ui.showError(
          error instanceof Error ? error.message : "Quote unavailable",
        );
    }
  }

  async function sign(trade: Omit<GaslessTrade, "maker">) {
    if (busy || (await store.load())) return;
    busy = true;
    quotesPaused = true;
    quoteRequest?.abort();
    const controller = (signingRequest = new AbortController());
    try {
      await client.signAndSubmit({
        trade: { ...trade, maker },
        signer,
        store,
        displayed,
        signal: controller.signal,
        // Refresh both amounts before the wallet opens: main expected output
        // stays on prepared.expectedOutput; the SDK signs prepared.minAmountOut.
        onPrepared(prepared) {
          displayed = prepared;
          ui.showQuote(prepared);
          ui.showEligibility?.(
            prepared.quote.gaslessEligibility ?? prepared.preview.eligibility,
          );
        },
        onPending() {
          ui.showPending();
        },
      });
    } catch (error) {
      ui.showError(
        error instanceof Error ? error.message : "Gasless submission failed.",
      );
    } finally {
      busy = false;
      signingRequest = undefined;
    }
  }

  async function approve(
    trade: Omit<GaslessTrade, "maker">,
    resetToZero = false,
  ) {
    if (busy || (await store.load())) return;
    busy = true;
    quoteRequest?.abort();
    try {
      const transaction = await client.approve({ ...trade, maker }, signer, {
        unlimited,
        resetToZero,
        quoteGasPriceWei: displayed?.gasPriceWei,
      });
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1)
        throw Error("Token approval failed.");
      // Approval time can stale the quote. Fetch on the next explicit quote/sign action.
      displayed = undefined;
    } finally {
      busy = false;
    }
  }

  async function checkStatus() {
    const result = await client.reconcile(store);
    if (result) ui.showOutcome(result);
    if (result && result.status !== "pending") {
      displayed = undefined;
      quotesPaused = true;
      // Show settlementTxUrl when filled. Do not automatically fetch another quote.
    }
    return result;
  }

  // Call on accountsChanged/chainChanged and any user edit, including slippage/recipient.
  // Recreate this flow for a new account/network; maker, signer and store are scoped to them.
  function invalidateIntent() {
    intent++;
    displayed = undefined;
    ui.showEligibility?.(undefined);
    quoteRequest?.abort();
    signingRequest?.abort();
    // A signature already obtained retains its pending lock even after abort.
  }

  return {
    quote,
    sign,
    approve,
    checkStatus,
    invalidateIntent,
    setUnlimited(value: boolean) {
      unlimited = value;
    },
    async assertNoPending() {
      // Call before Regular/Wrap actions too; closing the gasless modal is not cancellation.
      if (busy || (await store.load()))
        throw Error("A gasless order can still execute.");
    },
    async startAnotherSwap() {
      if (busy || (await store.load()))
        throw Error("The previous order can still execute.");
      quotesPaused = false;
    },
    // Use a non-overlapping timer (await checkStatus, then setTimeout >= 5000ms).
    // A close/dismiss button hides the modal; it does not cancel the signed order.
  };
}
