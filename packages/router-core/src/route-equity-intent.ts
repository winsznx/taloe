/**
 * `routeEquityIntent` — the routing primitive in one clean, typed call.
 *
 * This is an internal service-shape composition over `runRouteDiscovery`
 * (market decision) and `prepareExecution` (execution readiness), nothing
 * more: it makes no network call of its own, adds no new decision logic, and
 * is not exposed as an HTTP endpoint. Its only job is to give the web app and
 * any future external API/SDK the exact same call shape, so a second
 * integration surface never means a second implementation of the routing
 * decision (Taloe product-lock phase, 2026-09-22, section 11).
 *
 * Deliberately NOT here yet: auth, multi-tenancy, billing, rate limiting, or
 * a public HTTP handler. Those are premature until an external caller
 * actually exists (see `internal/research/AGGREGATION_PULL_TEST.md`).
 */

import type { DecisionOutcome, DecisionReason, RejectionReason, RouteEvaluation, RouteRejection, SelectionReason } from "@taloe/shared";

import type { DiscoveryPort } from "./discovery-port";
import { runRouteDiscovery } from "./orchestrate";
import type { RouteDiscoveryParams } from "./orchestrate";
import { prepareExecution } from "./readiness";
import type { ReadinessOutcome } from "./readiness";

export interface WalletContext {
  readonly address: string;
}

export interface RouteEquityIntentParams {
  readonly ticker: string;
  /** Decimal string, e.g. "500" for 500 USDT. */
  readonly amount: string;
  readonly maxDeviationBps: number;
  readonly walletContext?: WalletContext;
  readonly binanceChainId: string;
  readonly routeSessionId: string;
  readonly now?: Date;
}

export interface RouteEquityIntentResult {
  readonly decision: DecisionOutcome | "UNRESOLVABLE";
  readonly selectedWrapper: RouteEvaluation | null;
  readonly effectiveDeviationBps: number | null;
  readonly candidateSummary: readonly {
    readonly wrapperSymbol: string;
    readonly platformId: string | null;
    readonly comparable: boolean;
    readonly underlyingEquivalentAmount: string | null;
  }[];
  readonly selectionReasons: readonly SelectionReason[];
  readonly rejected: readonly RouteRejection[];
  readonly decisionReasons: readonly DecisionReason[];
  readonly refusalReason: RejectionReason | DecisionReason | "UNRESOLVABLE_REQUEST" | null;
  /** Present only when `walletContext` was supplied and the market decision was ACT. */
  readonly executionReadiness: ReadinessOutcome | null;
}

export async function routeEquityIntent(
  port: DiscoveryPort,
  params: RouteEquityIntentParams,
): Promise<RouteEquityIntentResult> {
  const now = params.now ?? new Date();
  const discoveryParams: RouteDiscoveryParams = {
    routeSessionId: params.routeSessionId,
    underlyingQuery: params.ticker,
    spendAmountDecimal: params.amount,
    walletAddress: params.walletContext?.address ?? null,
    maxDeviationBps: params.maxDeviationBps,
    binanceChainId: params.binanceChainId,
    now,
  };

  const outcome = await runRouteDiscovery(port, discoveryParams);
  if (outcome.kind === "UNRESOLVABLE") {
    return {
      decision: "UNRESOLVABLE",
      selectedWrapper: null,
      effectiveDeviationBps: null,
      candidateSummary: [],
      selectionReasons: [],
      rejected: [],
      decisionReasons: [],
      refusalReason: "UNRESOLVABLE_REQUEST",
      executionReadiness: null,
    };
  }

  const { decision } = outcome;
  const allEvaluated = [...(decision.selected ? [decision.selected] : []), ...decision.alternatives];

  let executionReadiness: ReadinessOutcome | null = null;
  if (params.walletContext && decision.outcome === "ACT") {
    executionReadiness = await prepareExecution(
      {
        port,
        walletAddress: params.walletContext.address,
        chainId: params.binanceChainId,
        spendTokenAddress: decision.intent.spendTokenAddress,
        now,
      },
      decision,
    );
  }

  return {
    decision: decision.outcome,
    selectedWrapper: decision.selected,
    effectiveDeviationBps: decision.selected?.referenceDeviationBps ?? null,
    candidateSummary: allEvaluated.map((evaluation) => ({
      wrapperSymbol: evaluation.route.wrapper.tokenSymbol,
      platformId: evaluation.route.wrapper.platformId,
      comparable: evaluation.comparable,
      underlyingEquivalentAmount: evaluation.underlyingEquivalentAmount,
    })),
    selectionReasons: decision.selectionReasons,
    rejected: decision.rejected,
    decisionReasons: decision.decisionReasons,
    refusalReason:
      decision.outcome === "REFUSE" || decision.outcome === "UNKNOWN"
        ? (decision.rejected[0]?.reasons[0] ?? decision.decisionReasons[0] ?? null)
        : null,
    executionReadiness,
  };
}
