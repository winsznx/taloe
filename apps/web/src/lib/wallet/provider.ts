/**
 * Thin wrapper over the browser's injected EIP-1193 provider (MetaMask, OKX
 * Wallet, Trust Wallet, etc.) — whatever `window.ethereum` the user already
 * has, appropriate for BSC. No wagmi/RainbowKit: three RPC calls and two
 * event subscriptions do not justify a client library or its UI chrome, and
 * pulling one in here would be a visual-system decision this phase is not
 * making.
 *
 * Kept modular on purpose (PRD, Taloe product-lock phase 2026-09-22, section
 * 4): Agentic Wallet, when it exists, should be able to satisfy this same
 * `Eip1193Provider` shape and reuse everything downstream (readiness
 * derivation, the approval/re-quote flow) rather than forking a second
 * wallet path.
 */

import { BSC_ADD_CHAIN_PARAMS, BSC_CHAIN_ID_HEX } from "./chain";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export class WalletUnavailableError extends Error {
  constructor() {
    super("No browser wallet was found. Install one to connect (e.g. MetaMask, OKX Wallet, Trust Wallet).");
    this.name = "WalletUnavailableError";
  }
}

/** Prompts the wallet's own connect UI; throws WalletUnavailableError if none is injected. */
export async function requestAccounts(provider: Eip1193Provider | null): Promise<readonly string[]> {
  if (!provider) throw new WalletUnavailableError();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  return Array.isArray(accounts) ? (accounts as string[]) : [];
}

export async function getChainId(provider: Eip1193Provider | null): Promise<string | null> {
  if (!provider) return null;
  const chainId = await provider.request({ method: "eth_chainId" });
  return typeof chainId === "string" ? chainId : null;
}

/**
 * Tries the fast path (wallet already knows BSC) and falls back to adding it
 * (EIP-3085) only on the specific "unrecognized chain" error — never adds a
 * chain the wallet already has, and never silently swallows an unrelated
 * failure (e.g. the user rejecting the switch prompt).
 */
export async function switchToBsc(provider: Eip1193Provider | null): Promise<void> {
  if (!provider) throw new WalletUnavailableError();
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_CHAIN_ID_HEX }] });
  } catch (error) {
    const code = (error as { code?: number } | undefined)?.code;
    if (code === 4902) {
      await provider.request({ method: "wallet_addEthereumChain", params: [BSC_ADD_CHAIN_PARAMS] });
      return;
    }
    throw error;
  }
}

/** Requests the wallet's own signature-and-broadcast UI for one unsigned transaction. Returns the tx hash. */
export async function sendTransaction(
  provider: Eip1193Provider | null,
  tx: { from: string; to: string; value: string; data: string },
): Promise<string> {
  if (!provider) throw new WalletUnavailableError();
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: tx.from, to: tx.to, value: tx.value === "0" ? "0x0" : `0x${BigInt(tx.value).toString(16)}`, data: tx.data }],
  });
  if (typeof hash !== "string") throw new Error("wallet did not return a transaction hash");
  return hash;
}
