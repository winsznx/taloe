/**
 * Taloe domain primitives (PRD section 10).
 *
 * These types are the contract between discovery, SessionMark, WrapRoute, the
 * execution state machines and the UI. They are deliberately free of any
 * Binance response shape: adapters translate into these, so a sponsor schema
 * change cannot reach the router or the product surface directly.
 */

import type { DecisionReason, RejectionReason, SelectionReason } from "./reason-codes";

export const BSC_CHAIN_ID = "56" as const;
export type BinanceChainId = typeof BSC_CHAIN_ID;

/** The five honest outcomes of the core decision primitive (PRD 1.5). */
export type DecisionOutcome = "ACT" | "NO_ACTION" | "REFUSE" | "UNKNOWN" | "MANUAL_REVIEW";

/**
 * How much Taloe actually understands about a wrapper.
 *
 * Only VERIFIED candidates may compete in a numeric ranking. PARTIAL and
 * UNSUPPORTED are shown to the user and excluded from comparison rather than
 * being assigned an invented conversion (PRD 10.5).
 */
export type SemanticConfidence = "VERIFIED" | "PARTIAL" | "UNSUPPORTED";

/** Runtime execution mode, taken from the quote response, never assumed. */
export type ExecutionMode = "SWAP" | "RFQ";

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export interface EquityIntent {
  readonly intentId: string;
  /** Exactly what the user typed. */
  readonly underlyingQuery: string;
  readonly underlyingTicker: string;
  readonly spendToken: "USDT";
  readonly spendTokenAddress: string;
  readonly spendTokenDecimals: number;
  readonly spendAmountBaseUnits: string;
  readonly walletAddress: string | null;
  readonly binanceChainId: BinanceChainId;
  /** Hard user constraint, enforced in code and never relaxed by the router. */
  readonly maxDeviationBps: number;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Underlying and wrappers
// ---------------------------------------------------------------------------

export interface Underlying {
  readonly ticker: string;
  readonly companyName: string;
  readonly sector: string | null;
  readonly logoUrl: string | null;
  /** Which sponsor calls produced this mapping, for reproducibility. */
  readonly provenance: readonly string[];
}

export interface UnderlyingSearchResult {
  readonly underlying: Underlying;
  /** Wrappers we identified safely. May be fewer than those that exist. */
  readonly identifiedWrapperCount: number;
  readonly hasUnsupportedWrappers: boolean;
}

export interface WrapperStatusInfo {
  readonly openState: boolean | null;
  readonly marketStatus: string | null;
  readonly reasonCode: string | null;
  readonly reasonMsg: string | null;
  readonly nextOpenTime: number | null;
  readonly nextCloseTime: number | null;
}

export interface WrapperCandidate {
  readonly platformId: string | null;
  readonly tokenContractAddress: string;
  readonly tokenSymbol: string;
  readonly tokenName: string | null;
  readonly decimals: number;
  readonly underlyingTicker: string;
  /**
   * Raw ratio exactly as returned. The mathematical direction is NOT assumed
   * here — normalization happens in a per-issuer adapter (PRD 10.5).
   */
  readonly tokenToShareRatioRaw: string | null;
  readonly tokenPrice: string | null;
  readonly referencePrice: string | null;
  readonly statusInfo: WrapperStatusInfo | null;
  readonly semanticConfidence: SemanticConfidence;
  readonly provenance: readonly string[];
}

// ---------------------------------------------------------------------------
// SessionMark
// ---------------------------------------------------------------------------

export type SessionState =
  | "REGULAR"
  | "PREMARKET"
  | "POSTMARKET"
  | "OVERNIGHT"
  | "CLOSED"
  | "PAUSED"
  | "UNKNOWN";

export interface MarketContext {
  readonly underlyingTicker: string;
  readonly sessionState: SessionState;
  /** Raw status string as returned, preserved for evidence. */
  readonly rawMarketStatus: string | null;
  readonly referencePrice: string | null;
  readonly referenceObservedAt: string | null;
  readonly referenceAgeMs: number | null;
  /**
   * Distinguishes an ordinary market closure from an issuer halt. A closed
   * underlying market is NOT by itself a refusal (PRD 8.7) — tokenized assets
   * can keep trading — but a halt is.
   */
  readonly isHalted: boolean;
  readonly nextOpenTime: number | null;
  readonly nextCloseTime: number | null;
  readonly provenance: readonly string[];
}

// ---------------------------------------------------------------------------
// Quotes and routes
// ---------------------------------------------------------------------------

export type QuoteFreshness = "FRESH" | "EXPIRING" | "EXPIRED";

export interface Quote {
  readonly quoteId: string;
  readonly vendorName: string;
  readonly executionMode: ExecutionMode;
  readonly fromTokenAmount: string;
  readonly toTokenAmount: string;
  readonly tradeFeeUsd: string | null;
  readonly estimatedGas: string | null;
  readonly priceImpactPercent: string | null;
  readonly routePath: string | null;
  readonly approveTarget: string | null;
  readonly quoteObservedAt: string;
  /**
   * Estimated, not authoritative: the API documents a ~30s lifetime but does
   * not return an expiry timestamp. Treated as an estimate everywhere.
   */
  readonly quoteExpiresAtEstimate: string;
  readonly apiIsBest: boolean | null;
}

export interface ExecutableRoute {
  readonly routeId: string;
  readonly wrapper: WrapperCandidate;
  readonly quote: Quote;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export type SimulationStatus = "NOT_APPLICABLE" | "NOT_RUN" | "PASS" | "FAIL";

/**
 * Field names match the documented `data.balanceChanges[]` shape exactly
 * (DOC_VERIFIED 2026-09-21) — `contractAddress`/`change`/`owner`, not the
 * guessed `tokenAddress`/`rawDelta` names this type carried before the
 * canonical simulate contract was found.
 */
export interface SimulationBalanceChange {
  readonly contractAddress: string;
  readonly tokenType: string | null;
  readonly change: string;
  readonly owner: string | null;
}

/** Matches the documented `data.allowanceChanges[]` shape. */
export interface SimulationAllowanceChange {
  readonly tokenAddress: string;
  readonly owner: string | null;
  readonly spender: string | null;
  readonly preAmount: string | null;
  readonly postAmount: string | null;
}

export interface SimulationResult {
  readonly status: SimulationStatus;
  readonly failReason: string | null;
  readonly balanceChanges: readonly SimulationBalanceChange[];
  readonly allowanceChanges: readonly SimulationAllowanceChange[];
  readonly observedAt: string;
  readonly provenance: readonly string[];
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface ConstraintCheck {
  readonly name: string;
  readonly passed: boolean;
  /** Present only when the check could be evaluated at all. */
  readonly observed: string | null;
  readonly limit: string | null;
  readonly reason: RejectionReason | null;
}

export interface RouteEvaluation {
  readonly route: ExecutableRoute;
  /** False when normalization semantics are missing — excluded from ranking. */
  readonly comparable: boolean;
  readonly underlyingEquivalentAmount: string | null;
  readonly effectiveCostPerUnderlyingUnit: string | null;
  readonly referenceDeviationBps: number | null;
  readonly constraintChecks: readonly ConstraintCheck[];
  readonly simulationStatus: SimulationStatus;
  readonly rejectionReasons: readonly RejectionReason[];
}

export interface RouteRejection {
  readonly routeId: string;
  readonly wrapperSymbol: string;
  readonly platformId: string | null;
  readonly reasons: readonly RejectionReason[];
  /**
   * Distinguishes a candidate that never produced a quote at all — e.g. a
   * documented issuer market-hours restriction returned while requesting one
   * — from a candidate that had a quote and failed a gate on it. A closed
   * underlying market is never by itself a rejection reason (PRD 8.7); it is
   * SessionMark context. When a SPECIFIC issuer's API actually refuses to
   * quote during that closure, that is a PRE_QUOTE rejection with its own
   * reason, and it says nothing about any other wrapper for the same
   * underlying.
   */
  readonly stage: "PRE_QUOTE" | "GATE";
}

export interface RouteDecision {
  readonly routeSessionId: string;
  readonly intent: EquityIntent;
  readonly underlying: Underlying;
  readonly marketContext: MarketContext | null;
  readonly outcome: DecisionOutcome;
  /** Present only when outcome is ACT. */
  readonly selected: RouteEvaluation | null;
  readonly selectionReasons: readonly SelectionReason[];
  /** Ranked runners-up that passed every gate. */
  readonly alternatives: readonly RouteEvaluation[];
  readonly rejected: readonly RouteRejection[];
  /** Why the decision itself came out this way, when no single route explains it. */
  readonly decisionReasons: readonly DecisionReason[];
  /**
   * Populated only when `decisionReasons` includes `UNDERLYING_MATCH_AMBIGUOUS`
   * (outcome `MANUAL_REVIEW`): the distinct companies the query matched, so
   * the UI can offer the user a disambiguation choice instead of guessing.
   */
  readonly candidateUnderlyings: readonly Underlying[];
  readonly evaluatedAt: string;
  readonly provenance: readonly string[];
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type ExecutionVerification =
  | "NOT_STARTED"
  | "PENDING_VERIFICATION"
  | "VERIFIED_SUCCESS"
  | "VERIFIED_FAILURE"
  | "VERIFICATION_FAILED";

export interface ExecutionReceipt {
  readonly executionId: string;
  readonly routeSessionId: string;
  readonly mode: ExecutionMode;
  readonly spentBaseUnits: string;
  readonly spendTokenSymbol: string;
  readonly wrapperSymbol: string;
  readonly wrapperContractAddress: string;
  /** Null until settlement is observed. Never filled from the quote estimate. */
  readonly receivedBaseUnits: string | null;
  readonly quotedBaseUnits: string;
  readonly underlyingEquivalentAmount: string | null;
  readonly vendorName: string;
  readonly approvalTxHash: string | null;
  readonly swapTxHash: string | null;
  readonly rfqOrderId: string | null;
  readonly verification: ExecutionVerification;
  /** Result of checking the chain through a path independent of the sponsor API. */
  readonly independentlyVerified: boolean;
  readonly explorerUrl: string | null;
  readonly settledAt: string | null;
  readonly createdAt: string;
}
