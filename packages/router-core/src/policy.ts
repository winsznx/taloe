/**
 * Routing policy.
 *
 * Every tunable that could change a decision lives here as named,
 * overridable configuration rather than inside a comparison somewhere. The PRD
 * requires the deviation default and the quote safety margin in particular to
 * stay visible and configurable until live testing settles them (8.6, 13).
 */

export interface RoutePolicy {
  /**
   * A quote must retain at least this much of its estimated life to be used
   * for the next operation. The documented lifetime is ~30s and the API
   * returns no expiry timestamp, so this margin absorbs both our own latency
   * and the estimate's error.
   */
  readonly quoteMinRemainingMs: number;
  /** Below this remaining life the UI warns before the quote is unusable. */
  readonly quoteExpiringThresholdMs: number;
  /** Default user constraint when none is supplied. Provisional. */
  readonly defaultMaxDeviationBps: number;
  /**
   * Product-level ceiling on route price impact, independent of the user's
   * reference-deviation constraint. Provisional pending the liquidity campaign.
   */
  readonly maxPriceImpactPercent: number;
  /**
   * Whether a passing SWAP simulation is required before a route may be
   * offered for signing. True per PRD 12.1; exposed so the ablation campaign
   * can turn it off and measure whether it ever changes an outcome.
   */
  readonly requireSimulationForSwap: boolean;
  /** Reference age beyond which deviation cannot be checked honestly. */
  readonly referenceStaleAfterMs: number;
}

export const DEFAULT_POLICY: RoutePolicy = {
  quoteMinRemainingMs: 8_000,
  quoteExpiringThresholdMs: 15_000,
  defaultMaxDeviationBps: 150,
  maxPriceImpactPercent: 3,
  requireSimulationForSwap: true,
  referenceStaleAfterMs: 120_000,
};

/**
 * Ablation variants (PRD 17 / 18.7).
 *
 * Each disables one supposedly load-bearing mechanism so identical intents can
 * be re-run against it. If a variant never changes an outcome across the
 * campaign, that mechanism gets downgraded in every public claim rather than
 * quietly kept in the architecture diagram.
 */
export type AblationVariant =
  | "FULL"
  | "NO_RWA_CONTEXT"
  | "NO_MARKET_STATUS"
  | "NO_EXECUTION_MODE_AWARENESS"
  | "NO_NORMALIZATION"
  | "NO_SIMULATION"
  | "FIXED_ISSUER";

/** Baselines the full router is measured against. */
export type BaselineVariant = "FIRST_RESULT" | "FIXED_ISSUER" | "PRICE_ONLY";

export interface EvaluationMode {
  readonly variant: AblationVariant;
  /** Set only for FIXED_ISSUER. */
  readonly fixedPlatformId?: string;
}

export const FULL_MODE: EvaluationMode = { variant: "FULL" };

export function policyForVariant(base: RoutePolicy, variant: AblationVariant): RoutePolicy {
  switch (variant) {
    case "NO_SIMULATION":
      return { ...base, requireSimulationForSwap: false };
    default:
      return base;
  }
}
