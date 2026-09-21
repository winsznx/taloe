/**
 * Execution record and transition driver.
 *
 * The record is the server-side source of truth for an in-flight execution, so
 * progress survives a browser refresh (PRD 8.9) and a receipt can be recovered
 * later by tx hash. Transitions are validated against the mode's own table:
 * an illegal transition is rejected rather than applied, which is what stops a
 * UI bug from marking a trade successful without the states in between.
 */

import type { ExecutionMode, ExecutionVerification, Result } from "@taloe/shared";
import { err, ok } from "@taloe/shared";

import type { ExecutionState } from "./states";
import { canTransition, initialState, isTerminal } from "./states";

export interface ExecutionEvent {
  readonly at: string;
  readonly state: ExecutionState;
  readonly note: string | null;
}

export interface ExecutionRecord {
  readonly executionId: string;
  readonly routeSessionId: string;
  readonly mode: ExecutionMode;
  readonly state: ExecutionState;
  readonly history: readonly ExecutionEvent[];
  readonly quoteId: string;
  readonly vendorName: string;
  readonly walletAddress: string;
  readonly approvalTxHash: string | null;
  readonly swapTxHash: string | null;
  readonly rfqOrderId: string | null;
  /** UUID v4 reused only across retries of the SAME order attempt. */
  readonly rfqRequestId: string | null;
  readonly failReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TransitionError {
  readonly kind: "ILLEGAL_TRANSITION" | "TERMINAL";
  readonly message: string;
}

export function createExecution(params: {
  executionId: string;
  routeSessionId: string;
  mode: ExecutionMode;
  quoteId: string;
  vendorName: string;
  walletAddress: string;
  rfqRequestId?: string | null;
  now?: Date;
}): ExecutionRecord {
  const now = (params.now ?? new Date()).toISOString();
  const state = initialState(params.mode);
  return {
    executionId: params.executionId,
    routeSessionId: params.routeSessionId,
    mode: params.mode,
    state,
    history: [{ at: now, state, note: null }],
    quoteId: params.quoteId,
    vendorName: params.vendorName,
    walletAddress: params.walletAddress,
    approvalTxHash: null,
    swapTxHash: null,
    rfqOrderId: null,
    rfqRequestId: params.rfqRequestId ?? null,
    failReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function transition(
  record: ExecutionRecord,
  to: ExecutionState,
  options: { note?: string; patch?: Partial<ExecutionRecord>; now?: Date } = {},
): Result<ExecutionRecord, TransitionError> {
  if (isTerminal(record.mode, record.state)) {
    return err({
      kind: "TERMINAL",
      message: `execution ${record.executionId} is already terminal in ${record.state}`,
    });
  }
  if (!canTransition(record.mode, record.state, to)) {
    return err({
      kind: "ILLEGAL_TRANSITION",
      message: `${record.mode} execution cannot move from ${record.state} to ${to}`,
    });
  }

  const at = (options.now ?? new Date()).toISOString();
  return ok({
    ...record,
    ...options.patch,
    state: to,
    history: [...record.history, { at, state: to, note: options.note ?? null }],
    updatedAt: at,
  });
}

/**
 * Map execution state to the coarse verification status shown on the receipt.
 *
 * A broadcast, and an RFQ `FILLED`, are both sponsor/chain-native signals —
 * never reported as Taloe's own success (V1 review correction 4). Everything
 * from broadcast/`FILLED` up to Taloe's own independent check is
 * `PENDING_VERIFICATION`, so the user is told "we are still checking" rather
 * than "done" (PRD 11 / 15.14).
 */
export function verificationFor(record: ExecutionRecord): ExecutionVerification {
  switch (record.state) {
    case "VERIFIED_SUCCESS":
      return "VERIFIED_SUCCESS";
    case "VERIFIED_FAILURE":
    case "FAILED":
    case "CANCELLED":
      return "VERIFIED_FAILURE";
    case "BROADCAST_SWAP":
    case "CHAIN_PENDING":
    case "EXECUTED_PENDING_VERIFICATION":
    case "INDEXING_PENDING":
    case "VERIFYING":
    case "SUBMIT_RFQ_ORDER":
    case "PENDING_VENDOR":
    case "PENDING_ONCHAIN":
    case "FILLED":
      return "PENDING_VERIFICATION";
    case "EXPIRED":
    case "VERIFICATION_FAILED":
      return "VERIFICATION_FAILED";
    default:
      return "NOT_STARTED";
  }
}

/**
 * How long to keep polling before we stop claiming to know.
 *
 * Bounded on purpose: after this window the UI hands the user the tx hash and
 * an explorer link instead of spinning forever, and the receipt stays
 * recoverable by hash later.
 */
export const VERIFICATION_POLL_WINDOW_MS = 180_000;

/** Backoff for indexing polls: the Wallet API lags a fresh broadcast. */
export function nextPollDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, 15_000);
}
