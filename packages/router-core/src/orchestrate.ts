/**
 * Orchestration (MARKET DECISION stage): turns a raw user request into a `RouteDecision` by driving a
 * `DiscoveryPort` through resolution, discovery, quoting, simulation, and
 * finally the pure `evaluateRoutes` engine.
 *
 * This is where MANUAL_REVIEW is actually produced — ambiguous underlying
 * resolution happens here, before a `RouteDecision`'s required `Underlying`
 * field can even be filled in, which is why the engine itself never produces
 * that outcome (PRD 11.1: "if multiple underlying companies remain
 * ambiguous, stop and ask the user to choose").
 *
 * The only thing this module does NOT decide is which `DiscoveryPort` to use
 * — that choice, and the guarantee that live and fixture are never both in
 * scope, belongs to whoever constructs the port (apps/web/src/server/discovery.ts).
 */

import type {
  AssetMetadata,
  ExecutableRoute,
  RouteDecision,
  RouteRejection,
  Underlying,
} from "@taloe/shared";
import { toBaseUnitAmount } from "@taloe/shared";

import type { DiscoveryPort } from "./discovery-port";
import { evaluateRoutes } from "./engine";
import type { EvaluationMode, RoutePolicy } from "./policy";

export interface RouteDiscoveryParams {
  readonly routeSessionId: string;
  readonly underlyingQuery: string;
  readonly spendAmountDecimal: string;
  readonly walletAddress: string | null;
  readonly maxDeviationBps: number;
  readonly binanceChainId: string;
  /** Set true only when the caller has already established this from real wallet/holdings data. */
  readonly alreadyHoldsTargetExposure?: boolean;
  readonly policy?: RoutePolicy;
  readonly mode?: EvaluationMode;
  readonly now?: Date;
}

/** A decision the caller could not even begin to route — pre-intent failure. */
export interface UnresolvableRequest {
  readonly kind: "INVALID_INPUT" | "SPONSOR_UNAVAILABLE";
  readonly message: string;
}

export type RouteDiscoveryOutcome =
  | { readonly kind: "DECIDED"; readonly decision: RouteDecision }
  | { readonly kind: "UNRESOLVABLE"; readonly reason: UnresolvableRequest };

function unresolvedUnderlying(query: string): Underlying {
  // Honest placeholder: echoes what the user typed rather than claiming a
  // resolved identity. Used only when RouteDecision requires SOME Underlying
  // but resolution did not produce a single confident one.
  return {
    ticker: query.trim().toUpperCase(),
    companyName: query.trim(),
    sector: null,
    logoUrl: null,
    provenance: [],
  };
}

export async function runRouteDiscovery(
  port: DiscoveryPort,
  params: RouteDiscoveryParams,
): Promise<RouteDiscoveryOutcome> {
  const now = params.now ?? new Date();

  const assetResult = await port.resolveSpendAsset(params.binanceChainId);
  if (!assetResult.ok) {
    return {
      kind: "UNRESOLVABLE",
      reason: {
        kind: assetResult.error.kind === "SPONSOR_UNAVAILABLE" ? "SPONSOR_UNAVAILABLE" : "INVALID_INPUT",
        message: assetResult.error.message,
      },
    };
  }
  const spendAsset: AssetMetadata = assetResult.value;

  let spendAmountBaseUnits: string;
  try {
    spendAmountBaseUnits = toBaseUnitAmount({ decimalString: params.spendAmountDecimal }, spendAsset);
  } catch (error) {
    return {
      kind: "UNRESOLVABLE",
      reason: {
        kind: "INVALID_INPUT",
        message: error instanceof Error ? error.message : "unreadable amount",
      },
    };
  }

  const searchResult = await port.searchUnderlying(params.underlyingQuery, params.binanceChainId);
  if (!searchResult.ok) {
    return decidedUnknown(params, spendAsset, spendAmountBaseUnits, now, "SPONSOR_API_UNAVAILABLE");
  }

  const matches = searchResult.value;
  const distinctTickers = new Set(matches.map((m) => m.underlying.ticker));

  if (matches.length === 0) {
    return decidedUnknown(params, spendAsset, spendAmountBaseUnits, now, "UNDERLYING_NOT_RECOGNIZED");
  }

  if (distinctTickers.size > 1) {
    // Genuine ambiguity across distinct companies -> MANUAL_REVIEW, with the
    // candidates attached so the UI can offer a real choice instead of
    // silently picking one (PRD 11.1).
    return {
      kind: "DECIDED",
      decision: {
        routeSessionId: params.routeSessionId,
        intent: buildIntent(params, spendAsset, spendAmountBaseUnits, now),
        underlying: unresolvedUnderlying(params.underlyingQuery),
        marketContext: null,
        outcome: "MANUAL_REVIEW",
        selected: null,
        selectionReasons: [],
        alternatives: [],
        rejected: [],
        decisionReasons: ["UNDERLYING_MATCH_AMBIGUOUS"],
        candidateUnderlyings: matches.map((m) => m.underlying),
        evaluatedAt: now.toISOString(),
        provenance: [],
      },
    };
  }

  const underlying = matches[0]!.underlying;

  const [candidatesResult, marketContextResult] = await Promise.all([
    port.discoverCandidates(underlying.ticker, params.binanceChainId),
    port.getMarketContext(underlying.ticker),
  ]);

  if (!candidatesResult.ok) {
    return decidedUnknown(
      params,
      spendAsset,
      spendAmountBaseUnits,
      now,
      "SPONSOR_API_UNAVAILABLE",
      underlying,
    );
  }
  const marketContext = marketContextResult.ok ? marketContextResult.value : null;
  const candidates = candidatesResult.value;

  if (candidates.length === 0) {
    return decidedUnknown(
      params,
      spendAsset,
      spendAmountBaseUnits,
      now,
      "NO_CANDIDATES_DISCOVERED",
      underlying,
      marketContext,
    );
  }

  const routes: ExecutableRoute[] = [];
  const preRejected: RouteRejection[] = [];

  let walletSpendBalanceBaseUnits: string | null = null;
  let walletGasBalanceWei: string | null = null;
  if (params.walletAddress) {
    const balances = await port.getWalletBalances(params.walletAddress, spendAsset, params.binanceChainId);
    if (balances.ok) {
      walletSpendBalanceBaseUnits = balances.value.spendBalanceBaseUnits;
      walletGasBalanceWei = balances.value.gasBalanceWei;
    }
    // A balance-lookup failure is not fatal to the whole request: it just
    // means that gate stays uncheckable for this pass, same as no wallet at
    // all — never treated as "balance is zero."
  }

  for (const candidate of candidates) {
    const quoteResult = await port.getQuotesForCandidate(candidate, {
      chainId: params.binanceChainId,
      spendTokenAddress: spendAsset.contractAddress,
      spendAmountBaseUnits,
      walletAddress: params.walletAddress,
      now,
    });
    if (!quoteResult.ok) {
      // A transport-level failure for one candidate does not sink the whole
      // request; it just means that candidate produced nothing.
      continue;
    }
    if (quoteResult.value.preRejected) {
      preRejected.push(quoteResult.value.preRejected);
    }
    routes.push(...quoteResult.value.routes);
  }

  // MARKET DECISION only. Build, simulate and allowance belong to execution
  // readiness (readiness.ts) and run once, on the selected route, so a wallet
  // that has not approved the router yet cannot make every market candidate
  // look unexecutable.
  const decision = evaluateRoutes({
    routeSessionId: params.routeSessionId,
    intent: buildIntent(params, spendAsset, spendAmountBaseUnits, now),
    underlying,
    marketContext,
    routes,
    preRejectedCandidates: preRejected,
    walletSpendBalanceBaseUnits,
    walletGasBalanceWei,
    alreadyHoldsTargetExposure: params.alreadyHoldsTargetExposure,
    policy: params.policy,
    mode: params.mode,
    now,
  });

  return { kind: "DECIDED", decision };
}

function buildIntent(
  params: RouteDiscoveryParams,
  spendAsset: AssetMetadata,
  spendAmountBaseUnits: string,
  now: Date,
) {
  return {
    intentId: params.routeSessionId,
    underlyingQuery: params.underlyingQuery,
    underlyingTicker: params.underlyingQuery.trim().toUpperCase(),
    spendToken: "USDT" as const,
    spendTokenAddress: spendAsset.contractAddress,
    spendTokenDecimals: spendAsset.decimals,
    spendAmountBaseUnits,
    walletAddress: params.walletAddress,
    binanceChainId: params.binanceChainId as "56",
    maxDeviationBps: params.maxDeviationBps,
    createdAt: now.toISOString(),
  };
}

function decidedUnknown(
  params: RouteDiscoveryParams,
  spendAsset: AssetMetadata,
  spendAmountBaseUnits: string,
  now: Date,
  reason:
    | "UNDERLYING_NOT_RECOGNIZED"
    | "SPONSOR_API_UNAVAILABLE"
    | "NO_CANDIDATES_DISCOVERED",
  underlying?: Underlying,
  marketContext?: RouteDecision["marketContext"],
): RouteDiscoveryOutcome {
  return {
    kind: "DECIDED",
    decision: {
      routeSessionId: params.routeSessionId,
      intent: buildIntent(params, spendAsset, spendAmountBaseUnits, now),
      underlying: underlying ?? unresolvedUnderlying(params.underlyingQuery),
      marketContext: marketContext ?? null,
      outcome: "UNKNOWN",
      selected: null,
      selectionReasons: [],
      alternatives: [],
      rejected: [],
      decisionReasons: [reason],
      candidateUnderlyings: [],
      evaluatedAt: now.toISOString(),
      provenance: [],
    },
  };
}
