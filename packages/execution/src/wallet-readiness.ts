/**
 * Wallet execution readiness — the UI-facing status for "can THIS wallet
 * execute the ALREADY-SELECTED route right now".
 *
 * This is deliberately a separate, coarser status than both:
 *  - the market decision (`RouteDecision.outcome` from `evaluateRoutes`),
 *    which answers "which wrapper can execute this exposure at this size",
 *    and never depends on whether a wallet is even connected; and
 *  - the fine-grained signed-transaction state machine (`states.ts`), which
 *    models every sponsor/chain transition once a signature is in flight.
 *
 * Conflating market-route quality with wallet readiness was an explicit
 * failure mode to avoid (Taloe product-lock phase, 2026-09-22): a route can
 * be the correct one and still be unusable right now because the wallet is
 * disconnected, on the wrong chain, or short on gas — none of which says
 * anything about whether the ROUTE is good.
 *
 * `deriveWalletReadinessState` is a pure function over already-fetched facts
 * (no I/O), so the same 16-state contract is testable without a browser
 * wallet or live balances, and the ordering below is the single place that
 * decides which fact takes priority when more than one is true at once.
 */

import type { ReadinessOutcome } from "@taloe/router-core";

export const WALLET_READINESS_STATES = [
  "WALLET_DISCONNECTED",
  "WRONG_CHAIN",
  "BALANCE_INSUFFICIENT",
  "GAS_INSUFFICIENT",
  "APPROVAL_REQUIRED",
  "APPROVAL_READY",
  "APPROVAL_PENDING",
  "APPROVAL_CONFIRMED",
  "REQUOTE_REQUIRED",
  "READY_FOR_SIMULATION",
  "SIMULATION_FAILED",
  "READY_TO_SIGN",
  "PENDING_EXECUTION",
  "PENDING_VERIFICATION",
  "VERIFIED_SUCCESS",
  "VERIFICATION_FAILED",
] as const;

export type WalletReadinessState = (typeof WALLET_READINESS_STATES)[number];

/**
 * What stage of the SIGNED transaction lifecycle the caller is in, once a
 * route is ready or an approval has been sent. Absent (`null`) means neither
 * an approval nor a swap has been signed yet — readiness is still being
 * established from wallet facts and the market decision alone.
 */
export type SignedLifecyclePhase =
  | { readonly kind: "APPROVAL_AWAITING_SIGNATURE" }
  | { readonly kind: "APPROVAL_BROADCAST_PENDING" }
  | { readonly kind: "APPROVAL_MINED_CONFIRMED" }
  | { readonly kind: "SWAP_BROADCAST_PENDING" }
  | { readonly kind: "SWAP_CHAIN_PENDING_VERIFICATION" }
  | { readonly kind: "SWAP_VERIFIED_SUCCESS" }
  | { readonly kind: "SWAP_VERIFICATION_FAILED" };

export interface WalletFacts {
  readonly connectedAddress: string | null;
  readonly connectedChainId: string | null;
  readonly requiredChainId: string;
  /** Null when not yet read (not an error — see `readable` fields below). */
  readonly spendBalanceBaseUnits: string | null;
  readonly gasBalanceWei: string | null;
  readonly requiredSpendBaseUnits: string;
  /** A balance/gas figure that could not be read is never treated as zero. */
  readonly spendBalanceReadable: boolean;
  readonly gasBalanceReadable: boolean;
  /** A nonzero estimate is enough to gate on; exact gas cost is the wallet's own concern at sign time. */
  readonly minGasBalanceWei: bigint;
}

/**
 * Only ever evaluated once the caller already has an ACT market decision —
 * a REFUSE/UNKNOWN/NO_ACTION/MANUAL_REVIEW decision has nothing for wallet
 * readiness to evaluate and is rendered from the market decision directly
 * (see `decision-copy.ts`), never mapped into one of these 16 states.
 */
export interface DeriveWalletReadinessInput {
  readonly wallet: WalletFacts;
  /** From `prepareExecution`/`resumeAfterApproval` in `@taloe/router-core`, once the wallet is connected and funded. */
  readonly readiness: ReadinessOutcome | null;
  readonly lifecycle: SignedLifecyclePhase | null;
}

/**
 * Priority order, most fundamental first: a disconnected wallet or wrong
 * chain makes every later fact unknowable, so those short-circuit before
 * balance/gas/allowance are even considered. Signed-lifecycle facts, once
 * present, take priority over the pre-signature readiness snapshot — they
 * are what actually happened, not what was estimated beforehand.
 */
export function deriveWalletReadinessState(input: DeriveWalletReadinessInput): WalletReadinessState {
  const { wallet, readiness, lifecycle } = input;

  if (wallet.connectedAddress === null) return "WALLET_DISCONNECTED";
  if (wallet.connectedChainId !== wallet.requiredChainId) return "WRONG_CHAIN";

  if (lifecycle !== null) {
    switch (lifecycle.kind) {
      case "APPROVAL_AWAITING_SIGNATURE":
        return "APPROVAL_READY";
      case "APPROVAL_BROADCAST_PENDING":
        return "APPROVAL_PENDING";
      case "APPROVAL_MINED_CONFIRMED":
        return "APPROVAL_CONFIRMED";
      case "SWAP_BROADCAST_PENDING":
        return "PENDING_EXECUTION";
      case "SWAP_CHAIN_PENDING_VERIFICATION":
        return "PENDING_VERIFICATION";
      case "SWAP_VERIFIED_SUCCESS":
        return "VERIFIED_SUCCESS";
      case "SWAP_VERIFICATION_FAILED":
        return "VERIFICATION_FAILED";
    }
  }

  // Balance/gas are checked from wallet facts directly (not from `readiness`,
  // which only carries them implicitly via a simulation revert) so the user
  // gets a specific, attributable reason instead of a generic failure.
  if (wallet.spendBalanceReadable && !hasSufficientBalance(wallet)) return "BALANCE_INSUFFICIENT";
  if (wallet.gasBalanceReadable && !hasSufficientGas(wallet)) return "GAS_INSUFFICIENT";

  if (readiness === null) return "READY_FOR_SIMULATION"; // facts are sufficient; readiness check not yet run

  switch (readiness.kind) {
    case "APPROVAL_REQUIRED":
      return "APPROVAL_REQUIRED";
    case "READY_TO_SIGN":
      return "READY_TO_SIGN";
    case "REFUSED":
      return readiness.reason === "REQUOTE_FAILED_GATES" || readiness.reason === "REQUOTE_UNAVAILABLE"
        ? "REQUOTE_REQUIRED"
        : "SIMULATION_FAILED";
  }
}

function hasSufficientBalance(wallet: WalletFacts): boolean {
  try {
    return BigInt(wallet.spendBalanceBaseUnits ?? "0") >= BigInt(wallet.requiredSpendBaseUnits);
  } catch {
    return false;
  }
}

function hasSufficientGas(wallet: WalletFacts): boolean {
  try {
    return BigInt(wallet.gasBalanceWei ?? "0") >= wallet.minGasBalanceWei;
  } catch {
    return false;
  }
}
