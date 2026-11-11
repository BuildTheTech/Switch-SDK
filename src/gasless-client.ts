import {
  Contract,
  Interface,
  MaxUint256,
  verifyTypedData,
  type Provider,
  type Signer,
  type TransactionRequest,
  type TransactionResponse,
} from "ethers";
import { API_BASE, ERC20_ABI, NATIVE_PLS } from "./constants.js";
import type { LimitOrderConfigResponse, LimitOrderRecord } from "./types.js";
import type { LimitOrderNetwork } from "./limit-orders.js";
import {
  GASLESS_DEPLOYMENTS,
  GASLESS_SWITCH_ABI,
  GaslessError,
  assessGaslessQuote,
  buildGaslessOrder,
  gaslessAddress,
  gaslessCeil,
  gaslessUint,
  getGaslessSigningParams,
  normalizeGaslessTrade,
  readGaslessChainState,
  sameAddress,
  selectGaslessFeeOnOutput,
  validateGaslessConfig,
  validateGaslessTaxInfo,
} from "./gasless.js";
import type {
  GaslessDeployment,
  GaslessOrder,
  GaslessOrderOutcome,
  GaslessPendingStore,
  GaslessQuoteDecision,
  GaslessQuoteResponse,
  GaslessTaxInfo,
  GaslessTrade,
  PendingGaslessOrder,
  PreparedGaslessSwap,
  SignedGaslessOrder,
} from "./gasless-types.js";

export interface GaslessClientOptions {
  network: LimitOrderNetwork;
  provider: Provider;
  /** Your own backend proxy can expose the same paths under a different base. */
  apiBaseUrl?: string;
  quoteEndpoint?: string;
  ordersEndpoint?: string;
  taxEndpoint?: string;
  /** Attach credentials server-side. Never embed an API key in browser code. */
  fetch?: typeof globalThis.fetch;
  /** Explicitly trusted migration override; never derive it blindly from an API. */
  deployment?: GaslessDeployment;
}

function endpoint(url: string, query: Record<string, string>): string {
  const suffix = new URLSearchParams(query).toString();
  return `${url}${url.includes("?") ? "&" : "?"}${suffix}`;
}

/** Abort bounded reads; a timed-out POST must instead retain its uncertain order lock. */
export async function withGaslessDeadline<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: () => void;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new GaslessError(
            "REQUEST_TIMEOUT",
            "Gasless request timed out.",
            true,
          ),
        ),
      timeoutMs,
    );
    onAbort = () =>
      reject(
        signal?.reason ?? new GaslessError("ABORTED", "Request cancelled."),
      );
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer!);
    signal?.removeEventListener("abort", onAbort!);
  }
}

/** Complete field comparison prevents a duplicate-nonce response matching a different order. */
export function gaslessRecordMatches(
  pending: PendingGaslessOrder,
  record: LimitOrderRecord,
): boolean {
  const o = pending.order;
  return (
    sameAddress(record.limitOrderContract, pending.contract) &&
    ["maker", "tokenIn", "tokenOut", "recipient", "partnerAddress"].every(
      (key) =>
        sameAddress(
          record[key as keyof LimitOrderRecord],
          o[key as keyof GaslessOrder] as string,
        ),
    ) &&
    record.nonce === o.nonce &&
    record.deadline === o.deadline &&
    record.amountIn === o.amountIn &&
    record.minAmountOut === o.minAmountOut &&
    record.feeOnOutput === o.feeOnOutput &&
    record.unwrapOutput === o.unwrapOutput
  );
}

export class GaslessSubmissionError extends GaslessError {
  constructor(
    message: string,
    public readonly pending: PendingGaslessOrder,
  ) {
    super("SUBMISSION_UNCERTAIN", message, true);
    this.name = "GaslessSubmissionError";
  }
}

/** Gasless settlements charge a fixed 0.1% protocol fee, plus an operator payout
 * capped at 0.05% of the after-fee base including gas. Integrators cannot override
 * the protocol fee; offer regular swaps only if this fee policy is unsuitable.
 * No background quote polling. Each method is explicit; status checks never request a quote. */
export class GaslessSwapClient {
  readonly deployment: Readonly<GaslessDeployment>;
  private readonly provider: Provider;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly quoteUrl: string;
  private readonly ordersUrl: string;
  private readonly taxUrl: string;

  constructor(options: GaslessClientOptions) {
    const deployment = {
      ...(options.deployment ?? GASLESS_DEPLOYMENTS[options.network]),
    };
    if (
      deployment.network !== options.network ||
      deployment.chainId !== GASLESS_DEPLOYMENTS[options.network].chainId
    )
      throw new GaslessError(
        "WRONG_CHAIN",
        "Deployment and requested network differ.",
      );
    this.deployment = Object.freeze({
      ...deployment,
      contract: gaslessAddress(deployment.contract),
      router: gaslessAddress(deployment.router),
      wrappedNative: gaslessAddress(deployment.wrappedNative),
    });
    this.provider = options.provider;
    this.fetcher = options.fetch ?? globalThis.fetch;
    const base = (options.apiBaseUrl ?? API_BASE).replace(/\/$/, "");
    this.quoteUrl = options.quoteEndpoint ?? `${base}/swap/quote`;
    this.ordersUrl = options.ordersEndpoint ?? `${base}/limit-orders`;
    this.taxUrl = options.taxEndpoint ?? `${base}/swap/checkTax`;
  }

  private async request<T>(
    url: string,
    init: RequestInit = {},
    signal?: AbortSignal,
    timeoutMs = 15_000,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetcher(url, {
      ...init,
      cache: "no-store",
      signal: combined,
    });
    const body: unknown = await response.json().catch(() => null);
    const error =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : undefined;
    if (!response.ok || error || !body)
      throw new GaslessError(
        "API_ERROR",
        error ?? `Switch API returned HTTP ${response.status}.`,
        response.status >= 500 || response.status === 429,
      );
    return body as T;
  }

  async getConfig(signal?: AbortSignal): Promise<LimitOrderConfigResponse> {
    const config = await this.request<LimitOrderConfigResponse>(
      endpoint(`${this.ordersUrl}/config`, {
        network: this.deployment.network,
      }),
      {},
      signal,
    );
    validateGaslessConfig(config, this.deployment);
    return config;
  }

  private async tax(
    token: string,
    maker: string,
    signal?: AbortSignal,
  ): Promise<GaslessTaxInfo> {
    if (
      sameAddress(token, NATIVE_PLS) ||
      sameAddress(token, this.deployment.wrappedNative)
    )
      return { isTaxToken: false, sellTaxBps: 0, buyTaxBps: 0 };
    const tax = await this.request<GaslessTaxInfo>(
      endpoint(this.taxUrl, {
        network: this.deployment.network,
        token,
        sender: maker,
      }),
      {},
      signal,
    );
    validateGaslessTaxInfo(tax);
    return tax;
  }

  private async checkQuoteBlock(
    quote: GaslessQuoteResponse,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(quote.quoteBlockNumber) ||
      quote.quoteBlockNumber <= 0
    )
      throw new GaslessError("INVALID_PREVIEW", "Missing quote block.");
    const block = await withGaslessDeadline(
      () => this.provider.getBlock(quote.quoteBlockNumber),
      10_000,
      signal,
    );
    const now = Date.now() / 1000;
    if (!block || now - block.timestamp > 90 || block.timestamp > now + 15)
      throw new GaslessError(
        "STALE_QUOTE",
        "The quote uses an old or unavailable chain snapshot.",
        true,
      );
  }

  /** Connected-wallet quote. Missing gas simulation or unknown taxes never enable gasless. */
  async quote(
    tradeInput: GaslessTrade,
    signal?: AbortSignal,
  ): Promise<GaslessQuoteDecision> {
    const trade = normalizeGaslessTrade(tradeInput);
    if (sameAddress(trade.tokenIn, NATIVE_PLS))
      return {
        eligible: false,
        code: "NATIVE_INPUT_REQUIRES_WRAP",
        reason:
          "Wrap native currency first (wrapping requires gas), or use Regular.",
        retryable: false,
      };
    try {
      const [network, , inputTax, outputTax] = await Promise.all([
        withGaslessDeadline(() => this.provider.getNetwork(), 10_000, signal),
        this.getConfig(signal),
        this.tax(trade.tokenIn, trade.maker, signal),
        this.tax(trade.tokenOut, trade.maker, signal),
      ]);
      if (network.chainId !== BigInt(this.deployment.chainId))
        throw new GaslessError("WRONG_CHAIN", "RPC is on another network.");
      const feeOnOutput = selectGaslessFeeOnOutput(
        this.deployment.network,
        trade.tokenIn,
        trade.tokenOut,
        inputTax,
        outputTax,
      );
      const quote = await this.request<GaslessQuoteResponse>(
        endpoint(this.quoteUrl, {
          network: this.deployment.network,
          from: trade.tokenIn,
          to: trade.tokenOut,
          amount: trade.amountIn,
          sender: trade.maker,
          receiver: trade.recipient,
          partnerAddress: trade.partnerAddress,
          slippage: String(trade.slippageBps),
          fee: "10",
          feeOnOutput: String(feeOnOutput),
          gasless: "true",
          // Do not send fee=15: the preview reserves the capped payout itself.
          // Do not restrict adapters: public operators need the same route universe.
        }),
        {},
        signal,
        45_000,
      );
      if (quote.feeOnOutput !== feeOnOutput)
        throw new GaslessError(
          "INVALID_PREVIEW",
          "API changed the requested fee side.",
        );
      // Read gas again after routing: a long quote must not retain an old gas price.
      const [current] = await Promise.all([
        withGaslessDeadline(
          () => readGaslessChainState(this.provider, this.deployment),
          15_000,
          signal,
        ),
        this.checkQuoteBlock(quote, signal),
      ]);
      return assessGaslessQuote(quote, trade, this.deployment, current);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const code =
        error instanceof GaslessError &&
        ["CONFIGURATION_CHANGED", "TAX_CHECK_UNAVAILABLE"].includes(error.code)
          ? (error.code as "CONFIGURATION_CHANGED" | "TAX_CHECK_UNAVAILABLE")
          : "QUOTE_UNAVAILABLE";
      return {
        eligible: false,
        code,
        reason:
          error instanceof Error
            ? error.message
            : "Gasless execution is unavailable. Use Regular.",
        retryable: error instanceof GaslessError ? error.retryable : true,
      };
    }
  }

  /** A signing click can await a refresh and continue to the wallet in the same call. */
  async prepare(
    trade: GaslessTrade,
    displayed?: PreparedGaslessSwap,
    signal?: AbortSignal,
  ): Promise<PreparedGaslessSwap> {
    const checkedAt =
      displayed?.quote?.gaslessExecution?.status === "ready"
        ? displayed.quote.gaslessExecution.checkedAt
        : 0;
    if (
      displayed &&
      Date.now() >= checkedAt &&
      Date.now() - checkedAt <= 30_000
    ) {
      await this.getConfig(signal);
      const [state] = await Promise.all([
        withGaslessDeadline(
          () => readGaslessChainState(this.provider, this.deployment),
          15_000,
          signal,
        ),
        this.checkQuoteBlock(displayed.quote, signal),
      ]);
      const checked = assessGaslessQuote(
        displayed.quote,
        trade,
        this.deployment,
        state,
      );
      if (checked.eligible) return checked.prepared;
    }
    const refreshed = await this.quote(trade, signal);
    if (!refreshed.eligible)
      throw new GaslessError(
        refreshed.code,
        refreshed.reason,
        refreshed.retryable,
      );
    return refreshed.prepared;
  }

  private async checkSigner(signer: Signer, maker: string): Promise<void> {
    if (
      !signer.provider ||
      !sameAddress(await signer.getAddress(), maker) ||
      (await signer.provider.getNetwork()).chainId !==
        BigInt(this.deployment.chainId)
    )
      throw new GaslessError(
        "WALLET_CHANGED",
        "Wallet account or network changed. Review the swap.",
      );
  }

  async checkFunds(
    maker: string,
    tokenIn: string,
    amountIn: string,
    signal?: AbortSignal,
  ) {
    const token = new Contract(
      gaslessAddress(tokenIn),
      ERC20_ABI,
      this.provider,
    );
    const [balance, allowance] = await withGaslessDeadline(
      () =>
        Promise.all([
          token.balanceOf(gaslessAddress(maker)),
          token.allowance(maker, this.deployment.contract),
        ]) as Promise<[bigint, bigint]>,
      15_000,
      signal,
    );
    return {
      balance: balance.toString(),
      allowance: allowance.toString(),
      hasBalance: balance >= gaslessUint(amountIn),
      approved: allowance >= gaslessUint(amountIn),
      spender: this.deployment.contract,
    };
  }

  /** Build approval with a fresh API-compatible gas boost. User still sends/confirms it. */
  async approvalRequest(
    tradeInput: GaslessTrade,
    signer: Signer,
    options: {
      unlimited?: boolean;
      resetToZero?: boolean;
      quoteGasPriceWei?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<TransactionRequest> {
    const trade = normalizeGaslessTrade(tradeInput);
    if (sameAddress(trade.tokenIn, NATIVE_PLS))
      throw new GaslessError(
        "NATIVE_INPUT_REQUIRES_WRAP",
        "Native input must be wrapped before approval.",
      );
    await this.checkSigner(signer, trade.maker);
    await this.getConfig(options.signal);
    const state = await withGaslessDeadline(
      () => readGaslessChainState(this.provider, this.deployment),
      15_000,
      options.signal,
    );
    const boosted = gaslessCeil(
      gaslessUint(state.rawGasPriceWei) * 13000n,
      10000n,
    );
    const quoted = options.quoteGasPriceWei
      ? gaslessUint(options.quoteGasPriceWei)
      : boosted;
    const amount = options.resetToZero
      ? 0n
      : options.unlimited === false
        ? gaslessUint(trade.amountIn)
        : MaxUint256;
    const request: TransactionRequest = {
      chainId: this.deployment.chainId,
      from: trade.maker,
      to: trade.tokenIn,
      value: 0n,
      data: new Interface(ERC20_ABI).encodeFunctionData("approve", [
        this.deployment.contract,
        amount,
      ]),
      gasPrice: boosted > quoted ? boosted : quoted,
    };
    request.gasLimit = gaslessCeil(
      (await withGaslessDeadline(
        () => this.provider.estimateGas(request),
        15_000,
        options.signal,
      )) * 13000n,
      10000n,
    );
    return request;
  }

  async approve(
    trade: GaslessTrade,
    signer: Signer,
    options: Parameters<GaslessSwapClient["approvalRequest"]>[2] = {},
  ): Promise<TransactionResponse> {
    const request = await this.approvalRequest(trade, signer, options);
    options.signal?.throwIfAborted();
    await this.checkSigner(signer, trade.maker);
    return signer.sendTransaction(request);
  }

  /** Off-chain signatures are not indexed until POST succeeds. */
  async signAndSubmit(input: {
    trade: GaslessTrade;
    signer: Signer;
    store: GaslessPendingStore;
    displayed?: PreparedGaslessSwap;
    signal?: AbortSignal;
    /** Update the visible amounts before the wallet prompt, including refreshed minimums. */
    onPrepared?: (prepared: PreparedGaslessSwap) => void | Promise<void>;
    onPending?: (pending: PendingGaslessOrder) => void;
  }): Promise<LimitOrderRecord> {
    if (await input.store.load())
      throw new GaslessError(
        "ORDER_PENDING",
        "An existing gasless order can still execute. Reconcile it before another swap.",
      );
    await this.checkSigner(input.signer, input.trade.maker);
    let prepared = await this.prepare(
      input.trade,
      input.displayed,
      input.signal,
    );
    let order: GaslessOrder | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const funds = await this.checkFunds(
        prepared.trade.maker,
        prepared.trade.tokenIn,
        prepared.trade.amountIn,
        input.signal,
      );
      if (!funds.hasBalance)
        throw new GaslessError(
          "INSUFFICIENT_BALANCE",
          "The input token balance is insufficient.",
        );
      if (!funds.approved)
        throw new GaslessError(
          "APPROVAL_REQUIRED",
          "Approve GaslessSwitch first. Approval requires native gas.",
        );
      try {
        order = buildGaslessOrder(prepared);
        break;
      } catch (error) {
        if (
          !(error instanceof GaslessError) ||
          error.code !== "STALE_QUOTE" ||
          attempt === 1
        )
          throw error;
        prepared = await this.prepare(input.trade, undefined, input.signal);
      }
    }
    if (!order)
      throw new GaslessError("STALE_QUOTE", "Refresh the gasless quote.", true);
    Object.freeze(order);
    const contract = new Contract(
      this.deployment.contract,
      GASLESS_SWITCH_ABI,
      this.provider,
    );
    if (
      await withGaslessDeadline(
        () => contract.isNonceUsed(order!.maker, order!.nonce),
        10_000,
        input.signal,
      )
    )
      throw new GaslessError(
        "NONCE_USED",
        "Generated nonce is already used; request another preparation.",
        true,
      );
    await input.onPrepared?.(prepared);
    input.signal?.throwIfAborted();
    await this.checkSigner(input.signer, order.maker);
    const checked = assessGaslessQuote(
      prepared.quote,
      input.trade,
      this.deployment,
      prepared.chainState,
    );
    if (!checked.eligible)
      throw new GaslessError(checked.code, checked.reason, checked.retryable);
    let pending: PendingGaslessOrder = {
      network: this.deployment.network,
      chainId: this.deployment.chainId,
      contract: this.deployment.contract,
      order,
      state: "signing",
    };
    await input.store.reserve(pending);
    let signature: string | undefined;
    try {
      input.onPending?.(pending);
      const { domain, types } = getGaslessSigningParams(this.deployment);
      signature = await input.signer.signTypedData(domain, types, order);
      // Persist the signed payload before the request; never replace its nonce on retry.
      pending = { ...pending, signature, state: "submitting" };
      await input.store.update(pending);
      if (
        !sameAddress(
          verifyTypedData(domain, types, order, signature),
          order.maker,
        )
      )
        throw new GaslessError(
          "INVALID_SIGNATURE",
          "Signature does not match the maker. Hosted submission currently requires an EOA signature.",
        );
      await this.checkSigner(input.signer, order.maker);
      input.signal?.throwIfAborted();
      await this.getConfig(input.signal);
      if (
        JSON.stringify(normalizeGaslessTrade(input.trade)) !==
        JSON.stringify(prepared.trade)
      )
        throw new GaslessError(
          "TRADE_CHANGED",
          "Trade changed after signing. Keep the signed order locked until expiry.",
        );
      await this.checkSigner(input.signer, order.maker);
      if (order.deadline <= Math.floor(Date.now() / 1000) + 30)
        throw new GaslessError(
          "ORDER_EXPIRING",
          "Order is too close to expiry to submit. Keep its lock until chain expiry.",
        );
      const record = await this.submitExact(pending, input.signal);
      pending = { ...pending, state: "submitted" };
      await input.store.update(pending);
      input.onPending?.(pending);
      return record;
    } catch (error) {
      if (!signature) await input.store.release(pending);
      else {
        pending = { ...pending, signature, state: "uncertain" };
        await input.store.update(pending);
        input.onPending?.(pending);
        throw new GaslessSubmissionError(
          error instanceof Error
            ? error.message
            : "Submission is uncertain. Check this exact order before retrying.",
          pending,
        );
      }
      throw error;
    }
  }

  private async submitExact(
    pending: PendingGaslessOrder,
    signal?: AbortSignal,
  ): Promise<LimitOrderRecord> {
    if (
      !pending.signature ||
      pending.network !== this.deployment.network ||
      pending.chainId !== this.deployment.chainId ||
      !sameAddress(pending.contract, this.deployment.contract)
    )
      throw new GaslessError(
        "INVALID_SUBMISSION",
        "Signed order does not target this gasless deployment.",
      );
    const payload: SignedGaslessOrder = {
      ...pending.order,
      signature: pending.signature,
      limitOrderContract: pending.contract,
    };
    try {
      const result = await this.request<{
        success: boolean;
        order: LimitOrderRecord;
      }>(
        endpoint(this.ordersUrl, { network: pending.network }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        signal,
        20_000,
      );
      if (
        result.success !== true ||
        !result.order ||
        !gaslessRecordMatches(pending, result.order)
      )
        throw new GaslessError(
          "INVALID_RESPONSE",
          "API did not confirm this exact gasless order.",
        );
      return result.order;
    } catch (error) {
      if (!signal?.aborted) {
        // Hosted duplicates return an error, not an idempotent success response.
        const existing = await this.getOrder(pending, signal).catch(() => null);
        if (existing && gaslessRecordMatches(pending, existing))
          return existing;
      }
      throw error;
    }
  }

  /** Resend only the original signed payload after reconciling a transport/duplicate error. */
  async retrySubmission(
    store: GaslessPendingStore,
    signal?: AbortSignal,
  ): Promise<LimitOrderRecord> {
    const pending = await store.load();
    if (!pending?.signature)
      throw new GaslessError(
        "NO_SIGNED_ORDER",
        "There is no saved signed order to retry.",
      );
    const existing = await this.getOrder(pending, signal);
    if (existing) {
      await store.update({ ...pending, state: "submitted" });
      return existing;
    }
    await this.getConfig(signal);
    if (pending.order.deadline <= Math.floor(Date.now() / 1000) + 30)
      throw new GaslessError(
        "ORDER_EXPIRING",
        "Wait for chain expiry instead of resubmitting an expiring order.",
      );
    const record = await this.submitExact(pending, signal);
    await store.update({ ...pending, state: "submitted" });
    return record;
  }

  async getOrder(
    pending: PendingGaslessOrder,
    signal?: AbortSignal,
  ): Promise<LimitOrderRecord | null> {
    if (
      pending.network !== this.deployment.network ||
      pending.chainId !== this.deployment.chainId
    )
      throw new GaslessError(
        "WRONG_CHAIN",
        "Pending order belongs to another network.",
      );
    try {
      const record = await this.request<LimitOrderRecord>(
        endpoint(
          `${this.ordersUrl}/${gaslessAddress(pending.order.maker)}/${pending.order.nonce}`,
          { network: pending.network },
        ),
        {},
        signal,
        10_000,
      );
      if (!gaslessRecordMatches(pending, record))
        throw new GaslessError(
          "ORDER_IDENTITY_MISMATCH",
          "The API record does not match the saved signed order.",
        );
      return record;
    } catch (error) {
      if (
        error instanceof GaslessError &&
        error.code === "API_ERROR" &&
        error.message === "Order not found"
      )
        return null;
      throw error;
    }
  }

  /** Poll at most once per 5 seconds. An API outage alone cannot release the pending lock. */
  async reconcile(
    store: GaslessPendingStore,
    signal?: AbortSignal,
  ): Promise<GaslessOrderOutcome | null> {
    const pending = await store.load();
    if (!pending) return null;
    let record: LimitOrderRecord | null = null;
    let readError: unknown;
    try {
      record = await this.getOrder(pending, signal);
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof GaslessError &&
          ["ORDER_IDENTITY_MISMATCH", "WRONG_CHAIN"].includes(error.code))
      )
        throw error;
      readError = error;
    }
    if (record?.status === "FILLED") {
      await store.release(pending);
      return {
        status: "filled",
        pending,
        record,
        settlementTxUrl:
          typeof record.filledTxHash === "string" &&
          /^0x[\da-f]{64}$/i.test(record.filledTxHash)
            ? `${this.deployment.explorer}/tx/${record.filledTxHash}`
            : undefined,
      };
    }
    if (record?.status === "CANCELLED") {
      await store.release(pending);
      return { status: "cancelled", pending, record };
    }
    // API EXPIRED or the local clock alone cannot unlock a still-executable signature.
    const [network, block] = await withGaslessDeadline(
      () =>
        Promise.all([
          this.provider.getNetwork(),
          this.provider.getBlock("latest"),
        ]),
      10_000,
      signal,
    );
    if (network.chainId !== BigInt(pending.chainId))
      throw new GaslessError("WRONG_CHAIN", "RPC is on another network.");
    if (block && block.timestamp > pending.order.deadline) {
      await store.release(pending);
      return {
        status: "closed",
        pending,
        reason:
          "The chain has passed the signed deadline. Check order history for the final settlement result.",
      };
    }
    if (readError) throw readError;
    return { status: "pending", pending };
  }
}
