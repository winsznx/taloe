/**
 * EXECUTION READINESS: everything that happens AFTER a route is selected.
 *
 *   selected route -> balance -> allowance -> [approval] -> re-quote
 *                  -> build -> simulate -> (sign, broadcast, verify elsewhere)
 *
 * The market decision (discover, quote, normalize, gate, rank) answers "which
 * representation can execute this exposure within the user's constraint".
 * Readiness answers "can this wallet execute it right now". Keeping them
 * apart means a wallet that has not approved the router yet is not read as a
 * bad market: insufficient allowance is `APPROVAL_REQUIRED`, not `REFUSE`.
 *
 * Nothing here signs or broadcasts. Every step that would need the user's key
 * returns the unsigned transaction for the wallet layer to sign.
 */

import type { ExecutableRoute, RouteDecision, SimulationResult } from "@taloe/shared";

import type { DiscoveryPort, UnsignedEvmTransaction } from "./discovery-port";
import { evaluateRoutes } from "./engine";
import type { RoutePolicy } from "./policy";

export type ReadinessRefusalReason =
  | "RFQ_READINESS_NOT_IMPLEMENTED"
  | "NO_APPROVAL_TARGET"
  | "ALLOWANCE_UNREADABLE"
  | "APPROVAL_BUILD_FAILED"
  | "APPROVAL_SIMULATION_FAILED"
  | "APPROVAL_SPENDER_MISMATCH"
  | "APPROVAL_NOT_EFFECTIVE"
  | "REQUOTE_UNAVAILABLE"
  | "REQUOTE_FAILED_GATES"
  | "SWAP_BUILD_FAILED"
  | "SWAP_SIMULATION_FAILED"
  | "NO_VIABLE_CANDIDATE";

export interface CandidateAttempt {
  readonly routeId: string;
  readonly wrapperSymbol: string;
  readonly reason: ReadinessRefusalReason;
  /** The sponsor's or chain's own words, preserved verbatim where they exist. */
  readonly detail: string | null;
}

export type ReadinessOutcome =
  /** A fresh, simulated swap is ready for the user to sign. */
  | {
      readonly kind: "READY_TO_SIGN";
      readonly route: ExecutableRoute;
      readonly simulation: SimulationResult;
      /** Rebuilt from the same quoteId `simulation` just validated — hand this straight to the wallet, never a prior one. */
      readonly swapTransaction: UnsignedEvmTransaction;
      readonly attempts: readonly CandidateAttempt[];
    }
  /** The route is fine but the wallet must approve the spender first. */
  | {
      readonly kind: "APPROVAL_REQUIRED";
      readonly route: ExecutableRoute;
      readonly spender: string;
      readonly requiredBaseUnits: string;
      readonly currentAllowanceBaseUnits: string;
      readonly approvalTransaction: UnsignedEvmTransaction;
      readonly approvalSimulation: SimulationResult;
      readonly attempts: readonly CandidateAttempt[];
    }
  | { readonly kind: "REFUSED"; readonly reason: ReadinessRefusalReason; readonly attempts: readonly CandidateAttempt[] };

export interface ReadinessContext {
  readonly port: DiscoveryPort;
  readonly walletAddress: string;
  readonly chainId: string;
  readonly spendTokenAddress: string;
  readonly policy?: RoutePolicy;
  readonly now: Date;
}

/**
 * Prepares the selected route (and, if a non-allowance failure rejects it, the
 * next viable candidate) for signing. Never forces a rejected route through.
 */
export async function prepareExecution(
  context: ReadinessContext,
  decision: RouteDecision,
): Promise<ReadinessOutcome> {
  if (decision.outcome !== "ACT" || decision.selected === null) {
    return { kind: "REFUSED", reason: "NO_VIABLE_CANDIDATE", attempts: [] };
  }
  const candidates = [decision.selected, ...decision.alternatives].map((evaluation) => evaluation.route);
  const attempts: CandidateAttempt[] = [];

  for (const route of candidates) {
    const outcome = await prepareRoute(context, decision, route);
    if (outcome.kind === "TRY_NEXT") {
      attempts.push({
        routeId: route.routeId,
        wrapperSymbol: route.wrapper.tokenSymbol,
        reason: outcome.reason,
        detail: outcome.detail,
      });
      continue;
    }
    if (outcome.kind === "STOP") {
      return {
        kind: "REFUSED",
        reason: outcome.reason,
        attempts: [
          ...attempts,
          { routeId: route.routeId, wrapperSymbol: route.wrapper.tokenSymbol, reason: outcome.reason, detail: outcome.detail },
        ],
      };
    }
    return { ...outcome.value, attempts };
  }
  return { kind: "REFUSED", reason: "NO_VIABLE_CANDIDATE", attempts };
}

type WithoutAttempts<T> = T extends unknown ? Omit<T, "attempts"> : never;
type ReadyOrApproval = Extract<ReadinessOutcome, { kind: "READY_TO_SIGN" | "APPROVAL_REQUIRED" }>;

type RouteStep =
  | { kind: "DONE"; value: WithoutAttempts<ReadyOrApproval> }
  /** This route failed for a route-specific reason: the next candidate may still work. */
  | { kind: "TRY_NEXT"; reason: ReadinessRefusalReason; detail: string | null }
  /** A wallet-level problem that every candidate would share: trying another wrapper cannot help. */
  | { kind: "STOP"; reason: ReadinessRefusalReason; detail: string | null };

async function prepareRoute(
  context: ReadinessContext,
  decision: RouteDecision,
  route: ExecutableRoute,
): Promise<RouteStep> {
  if (route.quote.executionMode !== "SWAP") {
    return { kind: "TRY_NEXT", reason: "RFQ_READINESS_NOT_IMPLEMENTED", detail: null };
  }
  const spender = route.quote.approveTarget;
  if (!spender) return { kind: "TRY_NEXT", reason: "NO_APPROVAL_TARGET", detail: null };

  const required = BigInt(route.quote.fromTokenAmount);
  const allowance = await context.port.getAllowance({
    chainId: context.chainId,
    tokenAddress: context.spendTokenAddress,
    owner: context.walletAddress,
    spender,
  });
  // Unreadable allowance is not "zero allowance": we cannot tell which step
  // comes next, and every candidate shares the same wallet, so stop.
  if (!allowance.ok) return { kind: "STOP", reason: "ALLOWANCE_UNREADABLE", detail: allowance.error.message };
  const current = BigInt(allowance.value);

  if (current < required) {
    return buildApprovalStep(context, route, spender, required, current);
  }
  return simulateFreshSwap(context, decision, route);
}

async function buildApprovalStep(
  context: ReadinessContext,
  route: ExecutableRoute,
  spender: string,
  required: bigint,
  current: bigint,
): Promise<RouteStep> {
  // Approve exactly what this trade needs. An unlimited approval would outlive
  // the trade and is a decision for the user, not a default for Taloe.
  const built = await context.port.buildApprovalTransaction({
    chainId: context.chainId,
    tokenAddress: context.spendTokenAddress,
    walletAddress: context.walletAddress,
    amountBaseUnits: required.toString(),
  });
  if (!built.ok) return { kind: "STOP", reason: "APPROVAL_BUILD_FAILED", detail: built.error.message };

  const simulation = await context.port.simulateTransaction({
    chainId: context.chainId,
    transaction: built.value,
    now: context.now,
  });
  if (!simulation.ok || simulation.value.status !== "PASS") {
    const detail = simulation.ok ? simulation.value.failReason : simulation.error.message;
    return { kind: "STOP", reason: "APPROVAL_SIMULATION_FAILED", detail };
  }

  // The approval must grant the spender the QUOTE named, not merely some spender.
  const change = simulation.value.allowanceChanges.find(
    (c) => c.tokenAddress.toLowerCase() === context.spendTokenAddress.toLowerCase(),
  );
  const spenderMatches = change?.spender?.toLowerCase() === spender.toLowerCase();
  // Fixture simulations carry no allowanceChanges; only a live change record can contradict the quote.
  if (change !== undefined && !spenderMatches) {
    return { kind: "STOP", reason: "APPROVAL_SPENDER_MISMATCH", detail: `approval targets ${change.spender}, quote requires ${spender}` };
  }

  return {
    kind: "DONE",
    value: {
      kind: "APPROVAL_REQUIRED",
      route,
      spender,
      requiredBaseUnits: required.toString(),
      currentAllowanceBaseUnits: current.toString(),
      approvalTransaction: built.value,
      approvalSimulation: simulation.value,
    },
  };
}

async function simulateFreshSwap(
  context: ReadinessContext,
  decision: RouteDecision,
  route: ExecutableRoute,
): Promise<RouteStep> {
  const simulation = await context.port.simulateRoute(route, {
    chainId: context.chainId,
    walletAddress: context.walletAddress,
    spendTokenAddress: context.spendTokenAddress,
    now: context.now,
  });
  if (!simulation.ok) {
    return { kind: "TRY_NEXT", reason: "SWAP_BUILD_FAILED", detail: simulation.error.message };
  }
  if (simulation.value.status !== "PASS") {
    return { kind: "TRY_NEXT", reason: "SWAP_SIMULATION_FAILED", detail: simulation.value.failReason };
  }
  // The simulation gate itself stays single-sourced in the engine.
  const gated = evaluateRoutes({
    routeSessionId: decision.routeSessionId,
    intent: decision.intent,
    underlying: decision.underlying,
    marketContext: decision.marketContext,
    routes: [route],
    simulations: new Map([[route.routeId, simulation.value.status]]),
    policy: context.policy,
    now: context.now,
  });
  if (gated.outcome !== "ACT") return { kind: "TRY_NEXT", reason: "SWAP_SIMULATION_FAILED", detail: gated.decisionReasons.join(",") };

  // Rebuilt from the exact quoteId just simulated — not a second independent quote.
  const built = await context.port.buildSwapTransaction(route, context);
  if (!built.ok) return { kind: "TRY_NEXT", reason: "SWAP_BUILD_FAILED", detail: built.error.message };

  return { kind: "DONE", value: { kind: "READY_TO_SIGN", route, simulation: simulation.value, swapTransaction: built.value } };
}

export interface ResumeAfterApprovalContext extends ReadinessContext {
  readonly spender: string;
  readonly requiredBaseUnits: string;
}

/**
 * Called after the user's approval has been signed and broadcast. The old
 * quote is discarded: an approval can take most of a 30s quote life, and the
 * price may have moved, so the same wrapper is re-quoted, re-gated against the
 * user's constraint, and only then built and simulated.
 */
export async function resumeAfterApproval(
  context: ResumeAfterApprovalContext,
  decision: RouteDecision,
  approvedRoute: ExecutableRoute,
): Promise<ReadinessOutcome> {
  const attempt = (reason: ReadinessRefusalReason, detail: string | null): ReadinessOutcome => ({
    kind: "REFUSED",
    reason,
    attempts: [{ routeId: approvedRoute.routeId, wrapperSymbol: approvedRoute.wrapper.tokenSymbol, reason, detail }],
  });

  // Independent verification: trust the chain, not the broadcast acknowledgement.
  const allowance = await context.port.getAllowance({
    chainId: context.chainId,
    tokenAddress: context.spendTokenAddress,
    owner: context.walletAddress,
    spender: context.spender,
  });
  if (!allowance.ok) return attempt("ALLOWANCE_UNREADABLE", allowance.error.message);
  if (BigInt(allowance.value) < BigInt(context.requiredBaseUnits)) {
    return attempt("APPROVAL_NOT_EFFECTIVE", `allowance is ${allowance.value}, need ${context.requiredBaseUnits}`);
  }

  const requote = await context.port.getQuotesForCandidate(approvedRoute.wrapper, {
    chainId: context.chainId,
    spendTokenAddress: context.spendTokenAddress,
    spendAmountBaseUnits: decision.intent.spendAmountBaseUnits,
    walletAddress: context.walletAddress,
    now: context.now,
  });
  if (!requote.ok || requote.value.routes.length === 0) {
    return attempt("REQUOTE_UNAVAILABLE", requote.ok ? null : requote.error.message);
  }
  const fresh = requote.value.routes.find((r) => r.quote.executionMode === "SWAP");
  if (!fresh) return attempt("REQUOTE_UNAVAILABLE", "re-quote returned no SWAP route");

  // Deviation and every other market gate are re-run on the FRESH quote.
  const regated = evaluateRoutes({
    routeSessionId: decision.routeSessionId,
    intent: decision.intent,
    underlying: decision.underlying,
    marketContext: decision.marketContext,
    routes: [fresh],
    policy: context.policy,
    now: context.now,
  });
  if (regated.outcome !== "ACT") {
    return attempt("REQUOTE_FAILED_GATES", regated.rejected.flatMap((r) => r.reasons).join(",") || regated.decisionReasons.join(","));
  }

  const step = await simulateFreshSwap(context, decision, fresh);
  if (step.kind === "DONE" && step.value.kind === "READY_TO_SIGN") return { ...step.value, attempts: [] };
  return step.kind === "DONE" ? attempt("SWAP_SIMULATION_FAILED", null) : attempt(step.reason, step.detail);
}
