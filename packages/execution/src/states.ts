/**
 * Execution state machines (PRD 12; V1 review correction 4).
 *
 * SWAP and RFQ are modelled as two distinct machines rather than one generic
 * getQuote -> sendTransaction path, because they settle differently and the
 * differences are exactly what the user needs to see:
 *
 *  - SWAP settles on-chain from a transaction the user signs. It can be
 *    simulated beforehand, and a broadcast produces a hash to verify.
 *  - RFQ settles through a vendor after the user signs EIP-712 typed data.
 *    There is no client-held transaction to simulate, and the order status —
 *    not a transaction hash — is the settlement source until a hash appears.
 *
 * Both machines share a second distinction, which the V1 review corrected:
 * the sponsor's OWN settlement signal (an RFQ order reaching `FILLED`, a
 * SWAP transaction confirming on-chain) is never renamed, reinterpreted or
 * collapsed into Taloe's product-level claim of success. They are kept as
 * two separate phases:
 *
 *   sponsor/chain-native settlement  ->  EXECUTED_PENDING_VERIFICATION
 *                                     ->  VERIFYING (Taloe's own check)
 *                                     ->  VERIFIED_SUCCESS | VERIFIED_FAILURE | VERIFICATION_FAILED
 *
 * `FILLED` for RFQ and on-chain confirmation for SWAP are BOTH still modelled
 * exactly as Binance/the chain report them — a filled RFQ order is `FILLED`,
 * full stop, and a reverted transaction is a chain-native failure Taloe
 * trusts directly without a further verification pass (there is nothing to
 * independently check about a transaction the chain itself says failed).
 * What changes is that neither one, by itself, is allowed to produce
 * `VERIFIED_SUCCESS`. Only Taloe's own post-settlement check — reading token
 * transfers back, optionally through an independent RPC path — can do that.
 */

import type { ExecutionMode } from "@taloe/shared";

export const SWAP_STATES = [
  "ROUTE_SELECTED",
  "ALLOWANCE_CHECK",
  "APPROVAL_REQUIRED",
  "APPROVAL_SIGN",
  "APPROVAL_BROADCAST",
  "APPROVAL_CONFIRMED",
  "REQUOTE_AND_REVALIDATE",
  "BUILD_SWAP",
  "SIMULATE_SWAP",
  "SIMULATION_PASSED",
  "USER_SIGN_SWAP",
  "BROADCAST_SWAP",
  /** Chain-native: broadcast accepted, not yet mined. Binance's own signal. */
  "CHAIN_PENDING",
  /** Chain-native: mined and confirmed successful. Taloe has NOT yet independently verified it. */
  "EXECUTED_PENDING_VERIFICATION",
  /** Taloe-side: Wallet API has not indexed the transaction yet (documented lag). */
  "INDEXING_PENDING",
  /** Taloe-side: actively checking token transfers, optionally via independent RPC. */
  "VERIFYING",
  "VERIFIED_SUCCESS",
  /** We affirmatively confirmed this did not succeed (on-chain revert, or a verification check that failed). */
  "VERIFIED_FAILURE",
  /** We could not confirm either outcome within our verification window. */
  "VERIFICATION_FAILED",
  "REFUSED",
  "USER_CANCELLED",
] as const;

export const RFQ_STATES = [
  "RFQ_ROUTE_SELECTED",
  "VENDOR_IDENTIFIED",
  "VENDOR_ALLOWANCE_CHECK",
  "APPROVAL_REQUIRED",
  "APPROVAL_SIGN",
  "APPROVAL_BROADCAST",
  "APPROVAL_CONFIRMED",
  "REQUOTE_IF_NEEDED",
  "BUILD_RFQ_PAYLOAD",
  "VALIDATE_TYPED_DATA",
  "USER_SIGN_EIP712",
  "SUBMIT_RFQ_ORDER",
  /** Sponsor-native RFQ order states, preserved exactly as Binance reports them. */
  "PENDING_VENDOR",
  "PENDING_ONCHAIN",
  "FILLED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  /** Sponsor says FILLED. Taloe has NOT yet independently verified it. */
  "EXECUTED_PENDING_VERIFICATION",
  /** Taloe-side: checking the settlement tx hash via Wallet API / independent RPC when one exists. */
  "VERIFYING",
  "VERIFIED_SUCCESS",
  "VERIFIED_FAILURE",
  "VERIFICATION_FAILED",
  "REFUSED",
  "USER_CANCELLED",
] as const;

export type SwapState = (typeof SWAP_STATES)[number];
export type RfqState = (typeof RFQ_STATES)[number];
export type ExecutionState = SwapState | RfqState;

/** Legal transitions. Anything absent is a bug, not an undocumented shortcut. */
const SWAP_TRANSITIONS: Readonly<Record<SwapState, readonly SwapState[]>> = {
  ROUTE_SELECTED: ["ALLOWANCE_CHECK", "REFUSED", "USER_CANCELLED"],
  ALLOWANCE_CHECK: ["APPROVAL_REQUIRED", "REQUOTE_AND_REVALIDATE", "REFUSED", "USER_CANCELLED"],
  APPROVAL_REQUIRED: ["APPROVAL_SIGN", "REFUSED", "USER_CANCELLED"],
  APPROVAL_SIGN: ["APPROVAL_BROADCAST", "REFUSED", "USER_CANCELLED"],
  APPROVAL_BROADCAST: ["APPROVAL_CONFIRMED", "VERIFIED_FAILURE", "REFUSED"],
  // Approval can eat most of a 30s quote, so revalidation after it is
  // mandatory rather than optional.
  APPROVAL_CONFIRMED: ["REQUOTE_AND_REVALIDATE", "REFUSED"],
  REQUOTE_AND_REVALIDATE: ["BUILD_SWAP", "REFUSED", "USER_CANCELLED"],
  BUILD_SWAP: ["SIMULATE_SWAP", "REFUSED"],
  SIMULATE_SWAP: ["SIMULATION_PASSED", "REFUSED"],
  SIMULATION_PASSED: ["USER_SIGN_SWAP", "REQUOTE_AND_REVALIDATE", "USER_CANCELLED"],
  USER_SIGN_SWAP: ["BROADCAST_SWAP", "USER_CANCELLED", "REQUOTE_AND_REVALIDATE"],
  BROADCAST_SWAP: ["CHAIN_PENDING", "VERIFIED_FAILURE"],
  // A chain-native failure (e.g. a revert) is knowable directly from the
  // chain's own status; there is nothing further for Taloe to independently
  // verify about a transaction the chain itself says failed.
  CHAIN_PENDING: ["EXECUTED_PENDING_VERIFICATION", "VERIFIED_FAILURE"],
  // Chain-confirmed success is NOT product-level success. It must pass
  // through Taloe's own verification before either terminal claim is made.
  EXECUTED_PENDING_VERIFICATION: ["INDEXING_PENDING", "VERIFYING"],
  INDEXING_PENDING: ["VERIFYING", "INDEXING_PENDING"],
  VERIFYING: ["VERIFIED_SUCCESS", "VERIFIED_FAILURE", "VERIFICATION_FAILED", "VERIFYING"],
  VERIFIED_SUCCESS: [],
  VERIFIED_FAILURE: [],
  VERIFICATION_FAILED: [],
  REFUSED: [],
  USER_CANCELLED: [],
};

const RFQ_TRANSITIONS: Readonly<Record<RfqState, readonly RfqState[]>> = {
  RFQ_ROUTE_SELECTED: ["VENDOR_IDENTIFIED", "REFUSED", "USER_CANCELLED"],
  VENDOR_IDENTIFIED: ["VENDOR_ALLOWANCE_CHECK", "REFUSED", "USER_CANCELLED"],
  VENDOR_ALLOWANCE_CHECK: ["APPROVAL_REQUIRED", "REQUOTE_IF_NEEDED", "REFUSED", "USER_CANCELLED"],
  APPROVAL_REQUIRED: ["APPROVAL_SIGN", "REFUSED", "USER_CANCELLED"],
  APPROVAL_SIGN: ["APPROVAL_BROADCAST", "REFUSED", "USER_CANCELLED"],
  APPROVAL_BROADCAST: ["APPROVAL_CONFIRMED", "FAILED", "REFUSED"],
  APPROVAL_CONFIRMED: ["REQUOTE_IF_NEEDED", "REFUSED"],
  REQUOTE_IF_NEEDED: ["BUILD_RFQ_PAYLOAD", "REFUSED", "USER_CANCELLED"],
  BUILD_RFQ_PAYLOAD: ["VALIDATE_TYPED_DATA", "REFUSED"],
  VALIDATE_TYPED_DATA: ["USER_SIGN_EIP712", "REFUSED"],
  USER_SIGN_EIP712: ["SUBMIT_RFQ_ORDER", "USER_CANCELLED", "REQUOTE_IF_NEEDED"],
  SUBMIT_RFQ_ORDER: ["PENDING_VENDOR", "FAILED", "EXPIRED"],
  PENDING_VENDOR: ["PENDING_ONCHAIN", "FILLED", "FAILED", "EXPIRED", "CANCELLED", "PENDING_VENDOR"],
  PENDING_ONCHAIN: ["FILLED", "FAILED", "EXPIRED", "CANCELLED", "PENDING_ONCHAIN"],
  // FILLED is the sponsor's own terminal state for the ORDER. It is preserved
  // exactly and is NOT Taloe's final word — see the module header.
  FILLED: ["EXECUTED_PENDING_VERIFICATION"],
  // The sponsor's own FAILED/CANCELLED are definitive negative signals; no
  // further independent check is needed to know the order did not fill.
  FAILED: ["VERIFIED_FAILURE"],
  EXPIRED: ["REQUOTE_IF_NEEDED", "VERIFIED_FAILURE"],
  CANCELLED: ["VERIFIED_FAILURE"],
  EXECUTED_PENDING_VERIFICATION: ["VERIFYING"],
  VERIFYING: ["VERIFIED_SUCCESS", "VERIFIED_FAILURE", "VERIFICATION_FAILED", "VERIFYING"],
  VERIFIED_SUCCESS: [],
  VERIFIED_FAILURE: [],
  VERIFICATION_FAILED: [],
  REFUSED: [],
  USER_CANCELLED: [],
};

export function canTransition(
  mode: ExecutionMode,
  from: ExecutionState,
  to: ExecutionState,
): boolean {
  const table: Readonly<Record<string, readonly string[]>> =
    mode === "SWAP" ? SWAP_TRANSITIONS : RFQ_TRANSITIONS;
  return table[from]?.includes(to) ?? false;
}

export function isTerminal(mode: ExecutionMode, state: ExecutionState): boolean {
  const table: Readonly<Record<string, readonly string[]>> =
    mode === "SWAP" ? SWAP_TRANSITIONS : RFQ_TRANSITIONS;
  return (table[state]?.length ?? 0) === 0;
}

export function initialState(mode: ExecutionMode): ExecutionState {
  return mode === "SWAP" ? "ROUTE_SELECTED" : "RFQ_ROUTE_SELECTED";
}

/**
 * What the user is told at each step.
 *
 * Every async step says what Taloe is doing rather than showing an
 * indefinite spinner (PRD 8.1.5), and the four kinds of waiting — on an API,
 * on the user's signature, on a vendor, on the chain — are named distinctly so
 * the user can tell which one they are in. The verification phase gets its
 * own distinct copy too: "confirmed on-chain" and "confirmed by Taloe" are
 * different claims and the user should be able to tell which one they have.
 */
export const STATE_COPY: Readonly<Record<ExecutionState, string>> = {
  ROUTE_SELECTED: "Preparing your route",
  RFQ_ROUTE_SELECTED: "Preparing your route",
  ALLOWANCE_CHECK: "Checking whether you have approved USDT for this route",
  VENDOR_IDENTIFIED: "Identifying the market maker for this route",
  VENDOR_ALLOWANCE_CHECK: "Checking your approval for this market maker",
  APPROVAL_REQUIRED: "One-time approval needed before the trade",
  APPROVAL_SIGN: "Waiting for you to approve in your wallet",
  APPROVAL_BROADCAST: "Sending your approval to the network",
  APPROVAL_CONFIRMED: "Approval confirmed",
  REQUOTE_AND_REVALIDATE: "Refreshing your price and re-checking the route",
  REQUOTE_IF_NEEDED: "Refreshing your price and re-checking the route",
  BUILD_SWAP: "Building your transaction",
  BUILD_RFQ_PAYLOAD: "Building your order",
  SIMULATE_SWAP: "Test-running your transaction against the chain",
  VALIDATE_TYPED_DATA: "Checking the order matches the route you approved",
  SIMULATION_PASSED: "Test run passed",
  USER_SIGN_SWAP: "Waiting for you to sign in your wallet",
  USER_SIGN_EIP712: "Waiting for you to sign the order in your wallet",
  BROADCAST_SWAP: "Sending your transaction to the network",
  SUBMIT_RFQ_ORDER: "Submitting your order",
  CHAIN_PENDING: "Waiting for the network to confirm",
  PENDING_VENDOR: "Waiting for the market maker to fill your order",
  PENDING_ONCHAIN: "Your fill is settling on-chain",
  FILLED: "The market maker filled your order",
  FAILED: "The market maker could not fill your order",
  EXPIRED: "The order expired before it was filled",
  CANCELLED: "The order was cancelled",
  EXECUTED_PENDING_VERIFICATION: "Confirmed by the network. Taloe is now checking the result",
  INDEXING_PENDING: "Confirmed. Waiting for the result to be indexed",
  VERIFYING: "Verifying what actually settled in your wallet",
  VERIFIED_SUCCESS: "Done and independently verified",
  VERIFIED_FAILURE: "This did not go through",
  VERIFICATION_FAILED: "We could not confirm the result yet. You can check the transaction directly",
  REFUSED: "Taloe did not execute this trade",
  USER_CANCELLED: "You cancelled this trade",
};
