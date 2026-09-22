/**
 * Hard eligibility gates (PRD 11.3, 11.6).
 *
 * Gates run BEFORE ranking and are lexicographic: a candidate that fails any
 * mandatory gate is out, full stop. It never receives a score and never sits
 * in contention looking competitive. This ordering is the difference between
 * "we ranked a halted token highly but it lost anyway" and "a halted token was
 * never a candidate".
 *
 * Each gate returns a ConstraintCheck so the UI can show the user exactly what
 * was measured against what limit, and the evidence record can reproduce it.
 */

import type {
  ConstraintCheck,
  ExecutableRoute,
  ExecutionMode,
  MarketContext,
  QuoteFreshness,
  RejectionReason,
  SimulationStatus,
} from "@taloe/shared";
import { deviationBps, div, fromBaseUnits, fromDecimalString, toDecimalString } from "@taloe/shared";

import { lookupIssuer } from "./normalization";
import type { RoutePolicy } from "./policy";

export interface GateContext {
  readonly route: ExecutableRoute;
  readonly policy: RoutePolicy;
  readonly marketContext: MarketContext | null;
  readonly maxDeviationBps: number;
  readonly spendAmountBaseUnits: string;
  readonly spendTokenDecimals: number;
  /** Wallet balances, when a wallet is connected. Null means "not checkable yet". */
  readonly walletSpendBalanceBaseUnits: string | null;
  readonly walletGasBalanceWei: string | null;
  readonly simulationStatus: SimulationStatus;
  /**
   * True when a simulation was actually attempted for this route. `NOT_RUN`
   * with attempted=false means "no wallet yet, recommendation stage";
   * `NOT_RUN` with attempted=true means the simulation ran and its answer was
   * unusable (transport failure, malformed or self-contradictory response),
   * which must fail closed rather than read as "not yet simulated".
   */
  readonly simulationAttempted: boolean;
  /** Execution modes this client can actually drive end to end. */
  readonly supportedExecutionModes: readonly ExecutionMode[];
  readonly now: Date;
  /** False for ablations that remove reference context: the wrapper's own reference price is then unavailable too. */
  readonly allowWrapperReference?: boolean;
}

export interface GateOutcome {
  readonly checks: readonly ConstraintCheck[];
  readonly rejectionReasons: readonly RejectionReason[];
  readonly referenceDeviationBps: number | null;
}

function check(
  name: string,
  passed: boolean,
  observed: string | null,
  limit: string | null,
  reason: RejectionReason | null,
): ConstraintCheck {
  return { name, passed, observed, limit, reason: passed ? null : reason };
}

/** Remaining estimated quote life in ms. Negative means already past estimate. */
export function quoteRemainingMs(route: ExecutableRoute, now: Date): number {
  return new Date(route.quote.quoteExpiresAtEstimate).getTime() - now.getTime();
}

export function quoteFreshness(
  route: ExecutableRoute,
  policy: RoutePolicy,
  now: Date,
): QuoteFreshness {
  const remaining = quoteRemainingMs(route, now);
  if (remaining <= policy.quoteMinRemainingMs) return "EXPIRED";
  if (remaining <= policy.quoteExpiringThresholdMs) return "EXPIRING";
  return "FRESH";
}

/**
 * Effective execution price: input spent per wrapper token received.
 * Used for the reference-deviation check when the wrapper tracks one share.
 */
export function effectiveUnitPrice(
  route: ExecutableRoute,
  spendTokenDecimals: number,
): string | null {
  try {
    const input = fromBaseUnits(route.quote.fromTokenAmount, spendTokenDecimals);
    const output = fromBaseUnits(route.quote.toTokenAmount, route.wrapper.decimals);
    if (output <= 0n) return null;
    return toDecimalString(div(input, output), 12);
  } catch {
    return null;
  }
}

export function runGates(context: GateContext): GateOutcome {
  const { route, policy, now } = context;
  const checks: ConstraintCheck[] = [];
  const reasons: RejectionReason[] = [];

  const fail = (c: ConstraintCheck): void => {
    checks.push(c);
    if (!c.passed && c.reason) reasons.push(c.reason);
  };

  // --- Identity and semantics -------------------------------------------
  fail(
    check(
      "wrapper.contract",
      /^0x[0-9a-fA-F]{40}$/.test(route.wrapper.tokenContractAddress),
      route.wrapper.tokenContractAddress || null,
      "valid BSC contract address",
      "INVALID_TOKEN_CONTRACT",
    ),
  );
  fail(
    check(
      "wrapper.semantics",
      route.wrapper.semanticConfidence !== "UNSUPPORTED",
      route.wrapper.semanticConfidence,
      "VERIFIED or PARTIAL",
      "ISSUER_MAPPING_UNSUPPORTED",
    ),
  );

  // --- Tradability -------------------------------------------------------
  // A halt blocks. An ordinary closed underlying market does not (PRD 8.7).
  const halted =
    route.wrapper.statusInfo?.openState === false &&
    Boolean(route.wrapper.statusInfo?.reasonCode) === true;
  const marketHalted = context.marketContext?.isHalted ?? false;
  fail(
    check(
      "wrapper.notHalted",
      !halted && !marketHalted,
      route.wrapper.statusInfo?.reasonMsg ?? context.marketContext?.rawMarketStatus ?? "no halt reported",
      "not halted",
      "PAUSED_OR_HALTED",
    ),
  );

  // --- Execution mode ----------------------------------------------------
  fail(
    check(
      "route.executionModeSupported",
      context.supportedExecutionModes.includes(route.quote.executionMode),
      route.quote.executionMode,
      context.supportedExecutionModes.join(" or "),
      "UNSUPPORTED_EXECUTION_MODE",
    ),
  );

  // --- Quote viability ---------------------------------------------------
  const remaining = quoteRemainingMs(route, now);
  fail(
    check(
      "quote.ttl",
      remaining > policy.quoteMinRemainingMs,
      `${Math.max(0, Math.round(remaining))}ms remaining`,
      `> ${policy.quoteMinRemainingMs}ms`,
      remaining <= 0 ? "QUOTE_EXPIRED" : "QUOTE_TTL_INSUFFICIENT",
    ),
  );

  let positiveOutput = false;
  try {
    positiveOutput = BigInt(route.quote.toTokenAmount) > 0n;
  } catch {
    positiveOutput = false;
  }
  fail(
    check(
      "quote.positiveOutput",
      positiveOutput,
      route.quote.toTokenAmount,
      "> 0",
      "NON_POSITIVE_OUTPUT",
    ),
  );

  // --- Price impact ------------------------------------------------------
  // Missing impact data is NOT treated as zero impact; it is simply not
  // checkable, and the check is recorded as passed-with-unknown so the
  // omission is visible rather than silently favourable.
  const impact = parseFloatOrNull(route.quote.priceImpactPercent);
  if (impact !== null) {
    fail(
      check(
        "route.priceImpact",
        Math.abs(impact) <= policy.maxPriceImpactPercent,
        `${impact}%`,
        `<= ${policy.maxPriceImpactPercent}%`,
        "EXCEEDS_PRICE_IMPACT_POLICY",
      ),
    );
  } else {
    checks.push(check("route.priceImpact", true, "not reported", `<= ${policy.maxPriceImpactPercent}%`, null));
  }

  // --- User deviation constraint ----------------------------------------
  const referenceDeviation = computeReferenceDeviation(context);
  if (referenceDeviation !== null) {
    fail(
      check(
        "user.maxDeviation",
        Math.abs(referenceDeviation) <= context.maxDeviationBps,
        `${referenceDeviation} bps`,
        `<= ${context.maxDeviationBps} bps`,
        "EXCEEDS_USER_DEVIATION",
      ),
    );
  } else {
    // No trustworthy reference means the user's hard constraint cannot be
    // enforced. We record that plainly; the engine turns this into UNKNOWN
    // rather than pretending the constraint was satisfied.
    checks.push(
      check("user.maxDeviation", true, "reference unavailable", `<= ${context.maxDeviationBps} bps`, null),
    );
  }

  // --- Balances ----------------------------------------------------------
  if (context.walletSpendBalanceBaseUnits !== null) {
    let sufficient = false;
    try {
      sufficient =
        BigInt(context.walletSpendBalanceBaseUnits) >= BigInt(context.spendAmountBaseUnits);
    } catch {
      sufficient = false;
    }
    fail(
      check(
        "wallet.spendBalance",
        sufficient,
        context.walletSpendBalanceBaseUnits,
        context.spendAmountBaseUnits,
        "INSUFFICIENT_BALANCE",
      ),
    );
  }
  if (context.walletGasBalanceWei !== null) {
    let hasGas = false;
    try {
      hasGas = BigInt(context.walletGasBalanceWei) > 0n;
    } catch {
      hasGas = false;
    }
    fail(check("wallet.gasBalance", hasGas, context.walletGasBalanceWei, "> 0", "INSUFFICIENT_GAS"));
  }

  // --- Simulation --------------------------------------------------------
  // Only applies to SWAP: RFQ settlement is vendor-relayed and the client does
  // not hold a transaction to simulate, so demanding one there would refuse
  // every RFQ route for a reason that is our limitation, not the route's.
  if (route.quote.executionMode === "SWAP" && policy.requireSimulationForSwap) {
    const passed = context.simulationStatus === "PASS";
    // NOT_RUN is only tolerated when no simulation was attempted (no wallet
    // connected during route ranking). Once attempted, only PASS clears the gate.
    const notYetAttempted = context.simulationStatus === "NOT_RUN" && !context.simulationAttempted;
    if (!notYetAttempted) {
      fail(
        check(
          "route.simulation",
          passed,
          context.simulationStatus,
          "PASS",
          context.simulationStatus === "FAIL"
            ? "SIMULATION_FAILED"
            : "SIMULATION_REQUIRED_BUT_UNAVAILABLE",
        ),
      );
    }
  }

  return {
    checks,
    rejectionReasons: [...new Set(reasons)],
    referenceDeviationBps: referenceDeviation,
  };
}

/**
 * Deviation of the route's effective execution price from the reference price.
 *
 * Returns null — never 0 — when there is no usable reference, when the
 * reference is stale, or when the amounts cannot be parsed. A null deviation
 * disables the user's constraint check, which the engine escalates to UNKNOWN.
 */
export function computeReferenceDeviation(context: GateContext): number | null {
  // The reference is a per-SHARE price. A token can represent more or fewer
  // than one share (observed live: CRWDon = 4.0 shares), so the executed
  // per-TOKEN price must be converted to per-share first. If the issuer's ratio
  // semantics are UNKNOWN, or the ratio is missing, the deviation is not
  // computable and the user's constraint cannot be enforced (-> UNKNOWN).
  const issuer = lookupIssuer(context.route.wrapper.platformId);
  const ratioRaw = context.route.wrapper.tokenToShareRatioRaw;
  if (!issuer || issuer.semantics === "UNKNOWN" || issuer.interpretation === null || ratioRaw === null) return null;
  if (issuer.interpretation.direction !== "SHARES_PER_TOKEN") return null;

  const reference =
    context.marketContext?.referencePrice ??
    (context.allowWrapperReference === false ? null : context.route.wrapper.referencePrice);
  if (!reference) return null;
  const ageMs = context.marketContext?.referenceAgeMs ?? null;
  if (ageMs !== null && ageMs > context.policy.referenceStaleAfterMs) return null;

  const unitPrice = effectiveUnitPrice(context.route, context.spendTokenDecimals);
  if (unitPrice === null) return null;
  try {
    const ratio = fromDecimalString(ratioRaw);
    if (ratio <= 0n) return null;
    const perShare = div(fromDecimalString(unitPrice), ratio);
    return deviationBps(perShare, fromDecimalString(reference));
  } catch {
    return null;
  }
}

function parseFloatOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
