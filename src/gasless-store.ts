import type { LimitOrderNetwork } from "./limit-orders.js";
import type {
  GaslessPendingStore,
  PendingGaslessOrder,
} from "./gasless-types.js";
import {
  GASLESS_DEPLOYMENTS,
  GaslessError,
  gaslessAddress,
  gaslessUint,
  sameAddress,
} from "./gasless.js";

export interface GaslessStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GaslessLockManager {
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T>;
}

function identity(p: PendingGaslessOrder): string {
  return `${p.chainId}:${p.contract.toLowerCase()}:${p.order.maker.toLowerCase()}:${p.order.nonce}`;
}

/** Invalid storage must block new orders rather than silently discarding a live signature. */
export function parseGaslessPending(
  value: string,
  network: LimitOrderNetwork,
  maker: string,
): PendingGaslessOrder {
  try {
    const p = JSON.parse(value) as PendingGaslessOrder;
    if (
      p.network !== network ||
      p.chainId !== GASLESS_DEPLOYMENTS[network].chainId ||
      !sameAddress(p.order.maker, maker) ||
      !Number.isSafeInteger(p.order.nonce) ||
      p.order.nonce < 0 ||
      !Number.isSafeInteger(p.order.deadline) ||
      p.order.deadline <= 0 ||
      typeof p.order.feeOnOutput !== "boolean" ||
      typeof p.order.unwrapOutput !== "boolean" ||
      !["signing", "submitting", "submitted", "uncertain"].includes(p.state) ||
      (p.state !== "signing" && !p.signature) ||
      (p.signature !== undefined && !/^0x[\da-f]{130}$/i.test(p.signature))
    )
      throw Error();
    [
      p.contract,
      p.order.maker,
      p.order.tokenIn,
      p.order.tokenOut,
      p.order.recipient,
    ].forEach((a) => gaslessAddress(a));
    gaslessAddress(p.order.partnerAddress, true);
    gaslessUint(p.order.amountIn);
    gaslessUint(p.order.minAmountOut);
    return p;
  } catch {
    throw new GaslessError(
      "PENDING_STORAGE_INVALID",
      "Saved gasless order data is invalid. Recover its status before starting another swap.",
    );
  }
}

/** Browser store serializes tabs using Web Locks and persists orders across reloads. */
export function createGaslessBrowserStore(
  network: LimitOrderNetwork,
  makerInput: string,
  options: {
    storage?: GaslessStorage;
    locks?: GaslessLockManager;
  } = {},
): GaslessPendingStore {
  const maker = gaslessAddress(makerInput);
  const storage = options.storage ?? globalThis.localStorage;
  const locks = options.locks ?? globalThis.navigator?.locks;
  if (!storage || !locks)
    throw new GaslessError(
      "PENDING_STORAGE_UNAVAILABLE",
      "Durable storage and Web Locks are required. Supply an atomic application store in this environment.",
    );
  const key = `switch:sdk:gasless-pending:${GASLESS_DEPLOYMENTS[network].chainId}:${maker.toLowerCase()}`;
  const load = () => {
    const value = storage.getItem(key);
    return value === null ? null : parseGaslessPending(value, network, maker);
  };
  const check = (p: PendingGaslessOrder) =>
    parseGaslessPending(JSON.stringify(p), network, maker);
  return {
    async load() {
      return load();
    },
    async reserve(pending) {
      await locks.request(key, () => {
        if (load())
          throw new GaslessError(
            "ORDER_PENDING",
            "Another gasless order is pending in this browser.",
          );
        storage.setItem(key, JSON.stringify(check(pending)));
      });
    },
    async update(pending) {
      await locks.request(key, () => {
        const current = load();
        if (!current || identity(current) !== identity(pending))
          throw new GaslessError(
            "PENDING_ORDER_CHANGED",
            "Saved pending order changed.",
          );
        if (JSON.stringify(current.order) !== JSON.stringify(pending.order))
          throw new GaslessError(
            "PENDING_ORDER_CHANGED",
            "Cannot change a pending order's signed fields.",
          );
        if (current.signature && current.signature !== pending.signature)
          throw new GaslessError(
            "PENDING_ORDER_CHANGED",
            "Cannot replace a saved signature.",
          );
        storage.setItem(key, JSON.stringify(check(pending)));
      });
    },
    async release(pending) {
      await locks.request(key, () => {
        const current = load();
        if (current && identity(current) === identity(pending))
          storage.removeItem(key);
      });
    },
  };
}
