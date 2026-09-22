/**
 * External-store wrapper around the injected wallet's own account/chain
 * state, for `useSyncExternalStore` — the wallet is a real external system
 * (PRD/react-useeffect guidance: subscriptions to external stores use
 * `useSyncExternalStore`, not a manual `useEffect` + `useState` pair that
 * would fight the wallet's own event timing).
 */

import { getInjectedProvider, requestAccounts, switchToBsc } from "./provider";
import type { Eip1193Provider } from "./provider";

export interface WalletSnapshot {
  readonly address: string | null;
  readonly chainIdHex: string | null;
  readonly connecting: boolean;
  readonly error: string | null;
}

const EMPTY_SNAPSHOT: WalletSnapshot = { address: null, chainIdHex: null, connecting: false, error: null };

let snapshot: WalletSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

function setSnapshot(next: WalletSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function handleAccountsChanged(accounts: unknown): void {
  const list = Array.isArray(accounts) ? (accounts as string[]) : [];
  setSnapshot({ ...snapshot, address: list[0] ?? null });
}

function handleChainChanged(chainIdHex: unknown): void {
  setSnapshot({ ...snapshot, chainIdHex: typeof chainIdHex === "string" ? chainIdHex : null });
}

let subscribedProvider: Eip1193Provider | null = null;

function ensureSubscribed(): void {
  const provider = getInjectedProvider();
  if (!provider || provider === subscribedProvider) return;
  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);
  subscribedProvider = provider;
}

export function subscribeWallet(listener: () => void): () => void {
  ensureSubscribed();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWalletSnapshot(): WalletSnapshot {
  return snapshot;
}

/** SSR/first-paint snapshot: no wallet state exists on the server, ever. */
export function getWalletServerSnapshot(): WalletSnapshot {
  return EMPTY_SNAPSHOT;
}

export async function connectWallet(): Promise<void> {
  setSnapshot({ ...snapshot, connecting: true, error: null });
  try {
    const provider = getInjectedProvider();
    const [accounts, chainIdHex] = await Promise.all([
      requestAccounts(provider),
      provider ? provider.request({ method: "eth_chainId" }) : Promise.resolve(null),
    ]);
    ensureSubscribed();
    setSnapshot({
      address: accounts[0] ?? null,
      chainIdHex: typeof chainIdHex === "string" ? chainIdHex : null,
      connecting: false,
      error: null,
    });
  } catch (error) {
    setSnapshot({ ...snapshot, connecting: false, error: error instanceof Error ? error.message : "Could not connect a wallet" });
  }
}

/** Local disconnect only: EIP-1193 has no standard programmatic revoke, so this clears Taloe's own state. */
export function disconnectWallet(): void {
  setSnapshot(EMPTY_SNAPSHOT);
}

export async function requestSwitchToBsc(): Promise<void> {
  try {
    await switchToBsc(getInjectedProvider());
  } catch (error) {
    setSnapshot({ ...snapshot, error: error instanceof Error ? error.message : "Could not switch network" });
  }
}
