/**
 * Ranking of routes that survived every hard gate.
 *
 * Deliberately NOT a weighted score. The PRD forbids assigning arbitrary
 * hidden weights before the evaluation campaign (11.7), because a weighted
 * score lets a bad dimension be quietly compensated by a good one and makes
 * "why this route?" unanswerable.
 *
 * Instead: lexicographic comparison on an explicit, ordered list of criteria,
 * each of which either decides the comparison or defers to the next. Every
 * decision is traceable to the single criterion that made it, which is what
 * the selection reason code reports.
 *
 * Tie-breakers beyond the primary objective stay minimal until measurements
 * justify more.
 */

import type { RouteEvaluation, SelectionReason } from "@taloe/shared";
import { fromBaseUnits, fromDecimalString } from "@taloe/shared";

export interface RankedRoute {
  readonly evaluation: RouteEvaluation;
  /** The criterion that put this route ahead of the next one. */
  readonly reasons: readonly SelectionReason[];
}

type Comparison = { readonly winner: -1 | 0 | 1; readonly reason: SelectionReason | null };

/**
 * Primary objective: best valid underlying-equivalent exposure per unit spend.
 *
 * Falls back to raw wrapper output only when BOTH routes lack normalization,
 * so we never compare a normalized route against an unnormalized one on
 * different units — that would be a category error dressed up as a number.
 */
function compareExposure(a: RouteEvaluation, b: RouteEvaluation): Comparison {
  const aNorm = a.underlyingEquivalentAmount;
  const bNorm = b.underlyingEquivalentAmount;

  if (aNorm !== null && bNorm !== null) {
    try {
      const left = fromDecimalString(aNorm);
      const right = fromDecimalString(bNorm);
      if (left !== right) {
        return { winner: left > right ? -1 : 1, reason: "BETTER_EFFECTIVE_EXPOSURE" };
      }
    } catch {
      /* fall through to the raw-output comparison */
    }
    return { winner: 0, reason: null };
  }

  if (aNorm === null && bNorm === null) {
    try {
      const left = fromBaseUnits(a.route.quote.toTokenAmount, a.route.wrapper.decimals);
      const right = fromBaseUnits(b.route.quote.toTokenAmount, b.route.wrapper.decimals);
      // Comparable only when both routes deliver the SAME wrapper token;
      // otherwise the amounts are in different units and mean nothing together.
      if (
        a.route.wrapper.tokenContractAddress.toLowerCase() ===
          b.route.wrapper.tokenContractAddress.toLowerCase() &&
        left !== right
      ) {
        return { winner: left > right ? -1 : 1, reason: "BETTER_EFFECTIVE_EXPOSURE" };
      }
    } catch {
      /* fall through */
    }
    return { winner: 0, reason: null };
  }

  // One normalized, one not: the normalized route wins, because it is the only
  // one whose exposure we can actually state.
  return { winner: aNorm !== null ? -1 : 1, reason: "BETTER_EFFECTIVE_EXPOSURE" };
}

function comparePriceImpact(a: RouteEvaluation, b: RouteEvaluation): Comparison {
  const left = numeric(a.route.quote.priceImpactPercent);
  const right = numeric(b.route.quote.priceImpactPercent);
  if (left === null || right === null || left === right) return { winner: 0, reason: null };
  return { winner: Math.abs(left) < Math.abs(right) ? -1 : 1, reason: "LOWER_PRICE_IMPACT" };
}

function compareFees(a: RouteEvaluation, b: RouteEvaluation): Comparison {
  const left = numeric(a.route.quote.tradeFeeUsd);
  const right = numeric(b.route.quote.tradeFeeUsd);
  // A missing fee is NOT read as zero — that would make an unreported fee look
  // like the cheapest option. Unknown fees simply defer to the next criterion.
  if (left === null || right === null || left === right) return { winner: 0, reason: null };
  return { winner: left < right ? -1 : 1, reason: "LOWER_TOTAL_COST" };
}

function compareFreshness(a: RouteEvaluation, b: RouteEvaluation): Comparison {
  const left = Date.parse(a.route.quote.quoteExpiresAtEstimate);
  const right = Date.parse(b.route.quote.quoteExpiresAtEstimate);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left === right) {
    return { winner: 0, reason: null };
  }
  return { winner: left > right ? -1 : 1, reason: "FRESHER_QUOTE" };
}

/** Ordered criteria. Order is the ranking model; there are no weights. */
const CRITERIA: readonly ((a: RouteEvaluation, b: RouteEvaluation) => Comparison)[] = [
  compareExposure,
  comparePriceImpact,
  compareFees,
  compareFreshness,
];

export function rankRoutes(evaluations: readonly RouteEvaluation[]): RankedRoute[] {
  const sorted = [...evaluations].sort((a, b) => {
    for (const criterion of CRITERIA) {
      const { winner } = criterion(a, b);
      if (winner !== 0) return winner;
    }
    return 0;
  });

  return sorted.map((evaluation, index) => ({
    evaluation,
    reasons: index === 0 ? winningReasons(evaluation, sorted[1]) : [],
  }));
}

/**
 * Why the winner won: the first criterion that actually separated it from the
 * runner-up, plus the constraint facts worth stating. With one candidate there
 * is no comparison to report, so we say exactly that.
 */
function winningReasons(
  winner: RouteEvaluation,
  runnerUp: RouteEvaluation | undefined,
): SelectionReason[] {
  const reasons: SelectionReason[] = [];

  if (!runnerUp) {
    reasons.push("ONLY_QUALIFYING_ROUTE");
  } else {
    for (const criterion of CRITERIA) {
      const { winner: outcome, reason } = criterion(winner, runnerUp);
      if (outcome !== 0 && reason) {
        reasons.push(reason);
        break;
      }
    }
  }

  if (winner.referenceDeviationBps !== null) reasons.push("WITHIN_USER_DEVIATION");
  if (winner.simulationStatus === "PASS") reasons.push("SIMULATION_PASSED");
  return reasons;
}

function numeric(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
