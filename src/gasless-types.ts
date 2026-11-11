import type {
  BestPathResponse,
  LimitOrderParams,
  LimitOrderRecord,
} from "./types.js";
import type { LimitOrderNetwork } from "./limit-orders.js";

export interface GaslessDeployment {
  network: LimitOrderNetwork;
  chainId: number;
  contract: string;
  router: string;
  wrappedNative: string;
  explorer: string;
}

export type GaslessEligibilityReason =
  | "READY"
  | "NOT_REQUESTED"
  | "EXECUTION_UNVERIFIED"
  | "PAYOUT_UNVALUED"
  | "GAS_NOT_COVERED"
  | "INSUFFICIENT_SAFETY_MARGIN"
  | "OPERATOR_GAS_UNAVAILABLE"
  | "NO_APPROVED_OPERATOR"
  | "SLIPPAGE_BUFFER_TOO_SMALL"
  | "STALE_PREVIEW";

/** Server recommendation; all native Wei values are decimal strings. */
export interface GaslessEligibility {
  policyVersion: 1;
  status: "eligible" | "ineligible" | "unavailable" | "not_checked";
  eligible: boolean;
  recommendation: "gasless" | "regular";
  reasonCode: GaslessEligibilityReason;
  reason: string;
  nativeSymbol: "PLS" | "ETH";
  protocolFeeBps: 10;
  maxOperatorPayoutBps: 5;
  requiredGasCoverageBps: 20000;
  payoutValuationHaircutBps: 1000;
  minimumSlippageBps: 50;
  /** Registration and a funded wallet do not prove a worker is online. */
  operatorLivenessVerified: false;
  /** Milliseconds since the Unix epoch. */
  checkedAt: number;
  /** Milliseconds since the Unix epoch. */
  expiresAt: number;
  economics?: {
    estimatedGasUnits: string;
    gasLimit: string;
    gasPriceWei: string;
    estimatedGasCostNativeWei: string;
    estimatedGasCostNative: string;
    operatorPayoutNativeWei: string;
    operatorPayoutNative: string;
    gasBudgetNativeWei: string;
    gasBudgetNative: string;
    conservativeGasBudgetNativeWei: string;
    conservativeGasBudgetNative: string;
    stressedOperatorPayoutNativeWei: string;
    requiredOperatorPayoutNativeWei: string;
    requiredOperatorPayoutNative: string;
    payoutToGasCoverageBps: string;
    /** Signed: negative values mean the payout does not cover the budget. */
    netAfterGasBudgetNativeWei: string;
    shortfallNativeWei: string;
    gasCovered: boolean;
    safetyMarginCovered: boolean;
  };
  operator?: {
    address: string;
    nativeBalanceWei: string;
    gasAvailable: boolean;
  };
}

/** Amounts are uint256 decimal strings; timestamps are Unix seconds except checkedAt. */
export interface GaslessExecutionPreview {
  status: "ready";
  version: 2;
  settlementVersion: 2;
  maker: string;
  chainId: number;
  contract: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  recipient: string;
  unwrapOutput: boolean;
  feeOnOutput: boolean;
  excessOnInput: boolean;
  payoutToken: string;
  routeHash: string;
  quoteBlockNumber: number;
  /** Milliseconds since the Unix epoch. */
  checkedAt: number;
  slippageBps: number;
  expectedOutputAmount: string;
  minAmountOut: string;
  recipientAmountOut: string;
  /** Actual payout received after any transfer tax. */
  operatorPayout: string;
  nominalOperatorPayout: string;
  payoutCapBase: string;
  operatorPayoutNative: string;
  estimatedGas: string;
  gasLimit: string;
  gasPriceWei: string;
  gasBudgetNative: string;
  gasPriceBoostBps: number;
  gasLimitBps: number;
  headroomBps: number;
  eligible: boolean;
  reason?: string;
  /** Additive API metadata. A ready simulation can still be economically ineligible. */
  eligibility?: GaslessEligibility;
}

export type GaslessPreviewResult =
  | GaslessExecutionPreview
  | {
      status: "unavailable";
      reason: string;
      eligibility?: GaslessEligibility;
    };

export interface GaslessQuoteResponse extends BestPathResponse {
  protocolFeeBps: number;
  feeOnOutput: boolean;
  quoteGasPrice: string;
  quoteBlockNumber: number;
  gaslessExecution: GaslessPreviewResult;
}

export interface GaslessTrade {
  maker: string;
  tokenIn: string;
  /** Native sentinel is supported on output; signed orders use wrapped native. */
  tokenOut: string;
  amountIn: string;
  recipient?: string;
  partnerAddress?: string;
  /** User price tolerance only. It never increases the contract's payout cap. 0–100. */
  slippageBps?: number;
}

export interface GaslessTaxInfo {
  isTaxToken: boolean;
  buyTaxBps: number;
  sellTaxBps: number;
}

export interface GaslessChainState {
  checkedAt: number;
  blockNumber: number;
  blockTimestamp: number;
  rawGasPriceWei: string;
}

export interface PreparedGaslessSwap {
  deployment: GaslessDeployment;
  trade: Required<GaslessTrade>;
  quote: GaslessQuoteResponse;
  preview: GaslessExecutionPreview;
  feeOnOutput: boolean;
  expectedOutput: string;
  minAmountOut: string;
  payoutToken: string;
  operatorPayout: string;
  gasPriceWei: string;
  gasLimit: string;
  gasBudgetNative: string;
  chainState: GaslessChainState;
}

export type GaslessUnavailableCode =
  | "NATIVE_INPUT_REQUIRES_WRAP"
  | "CONFIGURATION_CHANGED"
  | "TAX_CHECK_UNAVAILABLE"
  | "QUOTE_UNAVAILABLE"
  | "PREVIEW_UNAVAILABLE"
  | "STALE_QUOTE"
  | "INVALID_PREVIEW"
  | "SERVER_INELIGIBLE"
  | "INSUFFICIENT_OPERATOR_PAYOUT";

export type GaslessQuoteDecision =
  | {
      eligible: true;
      prepared: PreparedGaslessSwap;
      eligibility?: GaslessEligibility;
    }
  | {
      eligible: false;
      code: GaslessUnavailableCode;
      reason: string;
      retryable: boolean;
      /** Server economics are available even when this swap cannot use gasless. */
      eligibility?: GaslessEligibility;
    };

/** The API currently stores nonces as safe JSON integers, even though Solidity uses uint256. */
export interface GaslessOrder extends LimitOrderParams {}

export interface SignedGaslessOrder extends GaslessOrder {
  limitOrderContract: string;
  signature: string;
}

export interface PendingGaslessOrder {
  network: LimitOrderNetwork;
  chainId: number;
  contract: string;
  order: GaslessOrder;
  state: "signing" | "submitting" | "submitted" | "uncertain";
  signature?: string;
}

/** Implement atomically, scoped to network + maker. Persist before opening the wallet. */
export interface GaslessPendingStore {
  load(): Promise<PendingGaslessOrder | null>;
  /** Must reject if another pending order already occupies this maker's slot. */
  reserve(pending: PendingGaslessOrder): Promise<void>;
  /** Must update only the same contract + maker + nonce; preserve the signature. */
  update(pending: PendingGaslessOrder): Promise<void>;
  /** Must release only the matching order. Never clear a different tab's order. */
  release(pending: PendingGaslessOrder): Promise<void>;
}

export type GaslessOrderOutcome =
  | { status: "pending"; pending: PendingGaslessOrder }
  | {
      status: "filled";
      pending: PendingGaslessOrder;
      record: LimitOrderRecord;
      settlementTxUrl?: string;
    }
  | {
      status: "cancelled";
      pending: PendingGaslessOrder;
      record: LimitOrderRecord;
    }
  | { status: "closed"; pending: PendingGaslessOrder; reason: string };

export interface GaslessRoute {
  amountIn: string | bigint;
  hops: {
    tokenIn: string;
    tokenOut: string;
    legs: {
      adapter: string;
      amountIn: string | bigint;
      fee: number;
      data: string;
    }[];
  }[];
}
