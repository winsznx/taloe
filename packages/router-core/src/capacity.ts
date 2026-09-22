/**
 * SafeExecutionCapacity: the largest requested ticket a wrapper can execute
 * while staying inside a user's deviation constraint.
 *
 * There is deliberately no liquidity model here. Capacity is read off
 * executable quotes taken at increasing ticket sizes, so every bound is
 * something Binance actually quoted, never an extrapolation. The answer is a
 * bracket, not a point: the largest ticket observed inside the constraint and
 * the smallest ticket observed outside it. Interpolating between the two
 * would invent a liquidity curve we have not measured.
 */

export const CAPACITY_THRESHOLDS_BPS = [50, 100, 150] as const;

export interface CapacityObservation {
  readonly ticketUsd: number;
  /** Taloe-recomputed effective deviation from reference, in bps. Null when it could not be computed. */
  readonly deviationBps: number | null;
  /** False when no executable quote came back for this ticket. */
  readonly quoted: boolean;
}

export type CapacityStatus =
  /** A safe ticket and a breaching ticket were both observed. */
  | "BOUNDED"
  /** Every quoted ticket up to the largest tested stayed inside the constraint. */
  | "AT_LEAST_MAX_TESTED"
  /** Even the smallest tested ticket breached the constraint. */
  | "BELOW_SMALLEST_TESTED"
  /** No usable observation, or the scan stopped on missing data rather than a breach. */
  | "UNKNOWN";

export type CapacityEndedBy =
  | "DEVIATION_BREACH"
  | "QUOTE_UNAVAILABLE"
  | "DEVIATION_UNCOMPUTABLE"
  | "EXHAUSTED_TESTED_RANGE";

export interface SafeExecutionCapacity {
  readonly thresholdBps: number;
  readonly status: CapacityStatus;
  /** Largest ticket observed inside the constraint (all smaller tickets also inside). */
  readonly safeUpToUsd: number | null;
  /** Smallest ticket observed outside the constraint, or where the evidence stopped. */
  readonly breachedAtUsd: number | null;
  readonly endedBy: CapacityEndedBy | null;
}

/**
 * Scans upward and stops at the first ticket that is not provably inside the
 * constraint. A later in-range point after a breach is ignored on purpose:
 * quote noise must not resurrect capacity that the scan already lost.
 */
export function deriveSafeCapacity(
  observations: readonly CapacityObservation[],
  thresholdBps: number,
): SafeExecutionCapacity {
  const ascending = [...observations].sort((a, b) => a.ticketUsd - b.ticketUsd);
  let safeUpTo: number | null = null;

  for (const observation of ascending) {
    if (!observation.quoted) {
      return stopped(thresholdBps, safeUpTo, observation.ticketUsd, "QUOTE_UNAVAILABLE");
    }
    if (observation.deviationBps === null) {
      return stopped(thresholdBps, safeUpTo, observation.ticketUsd, "DEVIATION_UNCOMPUTABLE");
    }
    if (Math.abs(observation.deviationBps) > thresholdBps) {
      return stopped(thresholdBps, safeUpTo, observation.ticketUsd, "DEVIATION_BREACH");
    }
    safeUpTo = observation.ticketUsd;
  }

  if (safeUpTo === null) {
    return { thresholdBps, status: "UNKNOWN", safeUpToUsd: null, breachedAtUsd: null, endedBy: null };
  }
  return {
    thresholdBps,
    status: "AT_LEAST_MAX_TESTED",
    safeUpToUsd: safeUpTo,
    breachedAtUsd: null,
    endedBy: "EXHAUSTED_TESTED_RANGE",
  };
}

function stopped(
  thresholdBps: number,
  safeUpTo: number | null,
  stoppedAt: number,
  endedBy: CapacityEndedBy,
): SafeExecutionCapacity {
  const breach = endedBy === "DEVIATION_BREACH";
  if (safeUpTo === null) {
    return {
      thresholdBps,
      status: breach ? "BELOW_SMALLEST_TESTED" : "UNKNOWN",
      safeUpToUsd: null,
      breachedAtUsd: stoppedAt,
      endedBy,
    };
  }
  return {
    thresholdBps,
    // A stop caused by missing data is not evidence of a breach, so it is not BOUNDED.
    status: breach ? "BOUNDED" : "UNKNOWN",
    safeUpToUsd: safeUpTo,
    breachedAtUsd: stoppedAt,
    endedBy,
  };
}

export type CapacityComparison = "NO_DIFFERENCE" | "A_LARGER" | "B_LARGER" | "INCOMPARABLE";

/**
 * Compares two brackets conservatively. They differ only when disjoint: one
 * side's proven-safe size is at or beyond the other's breach point.
 * Overlapping brackets cannot be ordered from this evidence, so they report
 * NO_DIFFERENCE rather than a manufactured winner.
 */
export function compareCapacity(a: SafeExecutionCapacity, b: SafeExecutionCapacity): CapacityComparison {
  if (a.status === "UNKNOWN" || b.status === "UNKNOWN") return "INCOMPARABLE";
  const aLower = a.safeUpToUsd ?? 0;
  const bLower = b.safeUpToUsd ?? 0;
  if (b.breachedAtUsd !== null && aLower >= b.breachedAtUsd) return "A_LARGER";
  if (a.breachedAtUsd !== null && bLower >= a.breachedAtUsd) return "B_LARGER";
  return "NO_DIFFERENCE";
}
