/**
 * WrapRoute — the decision engine.
 *
 * Pipeline (PRD 11):
 *
 *   DISCOVER -> ELIGIBILITY -> TRADABILITY -> QUOTE VIABILITY -> SIMULATION
 *            -> NORMALIZATION -> COMPARISON -> DECISION
 *
 * Pure with respect to I/O: it takes already-fetched candidates, quotes and
 * context and returns a decision. That keeps it unit-testable without Binance
 * credentials, and keeps the honesty rules — which are the valuable part — out
 * of the network layer where they would be hard to see and easy to bypass.
 *
 * The non-obvious design rule: an inability to CHECK a constraint is never
 * treated as the constraint passing. That single rule is what separates
 * REFUSE (we checked and it failed) from UNKNOWN (we could not check), and it
 * is why UNKNOWN exists as a first-class outcome instead of being rounded to
 * ACT.
 */

import type {
  DecisionOutcome,
  DecisionReason,
  EquityIntent,
  ExecutableRoute,
  ExecutionMode,
  MarketContext,
  RouteDecision,
  RouteEvaluation,
  RouteRejection,
  SelectionReason,
  SimulationStatus,
  Underlying,
} from "@taloe/shared";
import { fromBaseUnits, toDecimalString } from "@taloe/shared";

import { runGates } from "./gates";
import type { NormalizationOutcome } from "./normalization";
import { normalizeWrapperAmountToUnderlying } from "./normalization";
import type { EvaluationMode, RoutePolicy } from "./policy";
import { DEFAULT_POLICY, FULL_MODE, policyForVariant } from "./policy";
import { rankRoutes } from "./ranking";

export interface EvaluateRoutesInput {
  readonly routeSessionId: string;
  readonly intent: EquityIntent;
  readonly underlying: Underlying;
  readonly marketContext: MarketContext | null;
  readonly routes: readonly ExecutableRoute[];
  /**
   * Candidates that never produced a quote at all — most importantly, a
   * wrapper whose issuer API returned a documented market-hours restriction
   * (Ondo `40367`, BStock `40369`) when queried. This is how "the underlying
   * market is closed" turns into a real, attributable rejection for ONE
   * issuer without ever becoming a blanket rule: SessionMark's session state
   * is context, this is the actual runtime signal from that specific
   * issuer's API, and it says nothing about any other wrapper for the same
   * underlying (PRD 8.7; V1 review correction 3).
   */
  readonly preRejectedCandidates?: readonly RouteRejection[];
  /** Simulation results keyed by routeId. Absent entries are NOT_RUN. */
  readonly simulations?: ReadonlyMap<string, SimulationStatus>;
  readonly walletSpendBalanceBaseUnits?: string | null;
  readonly walletGasBalanceWei?: string | null;
  readonly supportedExecutionModes?: readonly ExecutionMode[];
  /**
   * True when the user's wallet already holds the underlying-equivalent
   * exposure this intent asks for, through a wrapper still valid to hold.
   * Computing this honestly needs wallet balances plus normalized exposure
   * across held wrappers, which the orchestration layer owns; the engine
   * only acts on the precomputed answer. Absent or false means "proceed to
   * evaluate routes as a purchase," never "assume no existing holdings" —
   * callers that cannot determine this should leave it undefined rather than
   * pass false, and the resulting decision will simply not consider
   * NO_ACTION, which is the safe default.
   */
  readonly alreadyHoldsTargetExposure?: boolean;
  readonly policy?: RoutePolicy;
  readonly mode?: EvaluationMode;
  readonly now?: Date;
}

const ALL_EXECUTION_MODES: readonly ExecutionMode[] = ["SWAP", "RFQ"];
/** The NO_EXECUTION_MODE_AWARENESS ablation: pretend every route is a swap. */
const SWAP_ONLY: readonly ExecutionMode[] = ["SWAP"];

/** The NO_NORMALIZATION ablation: every route becomes non-comparable. */
const NORMALIZATION_DISABLED: NormalizationOutcome = {
  underlyingEquivalent: null,
  normalizer: null,
  failure: null,
};

export function evaluateRoutes(input: EvaluateRoutesInput): RouteDecision {
  const now = input.now ?? new Date();
  const mode = input.mode ?? FULL_MODE;
  const policy = policyForVariant(input.policy ?? DEFAULT_POLICY, mode.variant);

  // NO_ACTION is checked first and short-circuits everything else: if the
  // user already holds what they asked for, there is nothing to route.
  if (input.alreadyHoldsTargetExposure === true) {
    return decision(
      input,
      now,
      "NO_ACTION",
      null,
      [],
      [],
      [],
      ["ALREADY_HOLDS_TARGET_EXPOSURE"],
      collectProvenance(input.routes, input.marketContext),
    );
  }

  // Ablation wiring: each variant removes exactly one mechanism so identical
  // intents can be replayed against it and the difference measured.
  const marketContext =
    mode.variant === "NO_MARKET_STATUS" || mode.variant === "NO_RWA_CONTEXT"
      ? null
      : input.marketContext;
  const supportedExecutionModes =
    mode.variant === "NO_EXECUTION_MODE_AWARENESS"
      ? SWAP_ONLY
      : (input.supportedExecutionModes ?? ALL_EXECUTION_MODES);

  const candidateRoutes =
    mode.variant === "FIXED_ISSUER" && mode.fixedPlatformId
      ? input.routes.filter(
          (route) => route.wrapper.platformId?.toLowerCase() === mode.fixedPlatformId?.toLowerCase(),
        )
      : input.routes;

  const preRejected =
    mode.variant === "FIXED_ISSUER" && mode.fixedPlatformId
      ? (input.preRejectedCandidates ?? []).filter(
          (rejection) => rejection.platformId?.toLowerCase() === mode.fixedPlatformId?.toLowerCase(),
        )
      : (input.preRejectedCandidates ?? []);

  const provenance = collectProvenance(candidateRoutes, marketContext);

  if (candidateRoutes.length === 0 && preRejected.length === 0) {
    // Genuinely nothing found — not even a candidate that got as far as being
    // refused for a documented reason. This is UNKNOWN, not REFUSE: there is
    // no reason to report, only an absence.
    return decision(input, now, "UNKNOWN", null, [], [], [], ["NO_CANDIDATES_DISCOVERED"], provenance);
  }
  if (candidateRoutes.length === 0 && preRejected.length > 0) {
    // Candidates existed and each one was refused for a specific, attributable
    // reason (e.g. one issuer's documented market-hours restriction) before a
    // quote was ever requested. That is a genuine REFUSE.
    return decision(
      input,
      now,
      "REFUSE",
      null,
      [],
      [],
      preRejected,
      ["ALL_CANDIDATES_REJECTED"],
      provenance,
    );
  }

  const passed: RouteEvaluation[] = [];
  const rejected: RouteRejection[] = [...preRejected];
  /** True when at least one route was blocked only by an uncheckable constraint. */
  let sawUncheckableConstraint = false;

  for (const route of candidateRoutes) {
    const simulationStatus =
      mode.variant === "NO_SIMULATION"
        ? "NOT_APPLICABLE"
        : (input.simulations?.get(route.routeId) ??
          (route.quote.executionMode === "RFQ" ? "NOT_APPLICABLE" : "NOT_RUN"));

    const gateOutcome = runGates({
      route,
      policy,
      marketContext,
      maxDeviationBps: input.intent.maxDeviationBps,
      spendAmountBaseUnits: input.intent.spendAmountBaseUnits,
      spendTokenDecimals: input.intent.spendTokenDecimals,
      walletSpendBalanceBaseUnits: input.walletSpendBalanceBaseUnits ?? null,
      walletGasBalanceWei: input.walletGasBalanceWei ?? null,
      simulationStatus,
      simulationAttempted: input.simulations?.has(route.routeId) ?? false,
      supportedExecutionModes,
      now,
    });

    if (gateOutcome.referenceDeviationBps === null) sawUncheckableConstraint = true;

    const normalization =
      mode.variant === "NO_NORMALIZATION"
        ? NORMALIZATION_DISABLED
        : normalizeWrapperAmountToUnderlying({
            wrapper: route.wrapper,
            tokenAmountDecimal: toDecimalString(
              fromBaseUnits(route.quote.toTokenAmount, route.wrapper.decimals),
              8,
            ),
          });

    const evaluation: RouteEvaluation = {
      route,
      comparable: normalization.underlyingEquivalent !== null,
      underlyingEquivalentAmount: normalization.underlyingEquivalent,
      effectiveCostPerUnderlyingUnit: null,
      referenceDeviationBps: gateOutcome.referenceDeviationBps,
      constraintChecks: gateOutcome.checks,
      simulationStatus,
      rejectionReasons: gateOutcome.rejectionReasons,
    };

    if (gateOutcome.rejectionReasons.length > 0) {
      rejected.push({
        routeId: route.routeId,
        wrapperSymbol: route.wrapper.tokenSymbol,
        platformId: route.wrapper.platformId,
        reasons: gateOutcome.rejectionReasons,
        stage: "GATE",
      });
    } else {
      passed.push(evaluation);
    }
  }

  if (passed.length === 0) {
    // Candidates existed and every one of them failed a gate we could actually
    // evaluate. That is a genuine REFUSE, and the rejection reasons say why.
    return decision(
      input,
      now,
      "REFUSE",
      null,
      [],
      [],
      rejected,
      ["ALL_CANDIDATES_REJECTED"],
      provenance,
    );
  }

  const ranked = rankRoutes(passed);
  const winner = ranked[0];
  /* c8 ignore next — passed.length > 0 guarantees a winner. */
  if (!winner) {
    return decision(input, now, "UNKNOWN", null, [], [], rejected, ["NO_COMPARABLE_CANDIDATE"], provenance);
  }

  // A route can clear every gate and still not be recommendable: if we had no
  // trustworthy reference, the user's hard deviation constraint was never
  // actually tested. Claiming ACT there would be claiming we enforced a limit
  // we did not enforce.
  if (winner.evaluation.referenceDeviationBps === null && sawUncheckableConstraint) {
    return decision(
      input,
      now,
      "UNKNOWN",
      winner.evaluation,
      [],
      ranked.slice(1).map((r) => r.evaluation),
      rejected,
      ["REFERENCE_CONTEXT_UNAVAILABLE"],
      provenance,
    );
  }

  return decision(
    input,
    now,
    "ACT",
    winner.evaluation,
    winner.reasons,
    ranked.slice(1).map((r) => r.evaluation),
    rejected,
    [],
    provenance,
  );
}

function decision(
  input: EvaluateRoutesInput,
  now: Date,
  outcome: DecisionOutcome,
  selected: RouteEvaluation | null,
  selectionReasons: readonly SelectionReason[],
  alternatives: readonly RouteEvaluation[],
  rejected: readonly RouteRejection[],
  decisionReasons: readonly DecisionReason[],
  provenance: readonly string[],
): RouteDecision {
  return {
    routeSessionId: input.routeSessionId,
    intent: input.intent,
    underlying: input.underlying,
    marketContext: input.marketContext,
    outcome,
    // A selected route is only attached to an ACT decision. Anything else must
    // not carry something the UI could render as a recommendation.
    selected: outcome === "ACT" ? selected : null,
    selectionReasons,
    alternatives,
    rejected,
    decisionReasons,
    // evaluateRoutes always receives an already-resolved Underlying; ambiguity
    // is a resolution-stage concern handled upstream in the orchestration
    // layer, so this engine never itself produces a disambiguation list.
    candidateUnderlyings: [],
    evaluatedAt: now.toISOString(),
    provenance,
  };
}

function collectProvenance(
  routes: readonly ExecutableRoute[],
  marketContext: MarketContext | null,
): string[] {
  const sources = new Set<string>();
  for (const route of routes) {
    for (const source of route.wrapper.provenance) sources.add(source);
  }
  for (const source of marketContext?.provenance ?? []) sources.add(source);
  return [...sources].sort();
}
