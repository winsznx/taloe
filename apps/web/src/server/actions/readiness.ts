"use server";

/**
 * Execution-readiness server actions.
 *
 * These exist because `prepareExecution`/`resumeAfterApproval` need the
 * signed Binance client (API key/secret), which must never reach the
 * browser (PRD 15.1) — so a connected wallet's address is sent here, the
 * market decision is re-derived exactly as `/route` and `/review` already do
 * (deterministic per query, D-020), and only the resulting readiness
 * snapshot — no credentials, no signing key — goes back to the client.
 *
 * Nothing here signs, approves, or broadcasts. `resumeAfterApproval` is only
 * ever called after the caller reports a signature the WALLET obtained
 * directly from the human (see `apps/web/src/lib/wallet/provider.ts`
 * `sendTransaction`); this file never sends a transaction itself.
 */

import type { ReadinessOutcome } from "@taloe/router-core";
import { prepareExecution, resumeAfterApproval, runRouteDiscovery } from "@taloe/router-core";
import type { ExecutableRoute, RouteDecision } from "@taloe/shared";

import { getDiscoveryPort } from "@/server/discovery";
import { getServerConfig } from "@/server/config";

export interface ReadinessRequest {
  readonly q: string;
  readonly amount: string;
  readonly maxDeviationBps: number;
  readonly routeId: string;
  readonly walletAddress: string;
}

async function redecide(request: ReadinessRequest): Promise<{ decision: RouteDecision; route: ExecutableRoute } | { error: string }> {
  const config = getServerConfig();
  const outcome = await runRouteDiscovery(getDiscoveryPort(), {
    routeSessionId: "readiness-action",
    underlyingQuery: request.q,
    spendAmountDecimal: request.amount,
    walletAddress: request.walletAddress,
    maxDeviationBps: request.maxDeviationBps,
    binanceChainId: config.binanceChainId,
  });
  const selected = outcome.kind === "DECIDED" && outcome.decision.outcome === "ACT" ? outcome.decision.selected : null;
  if (outcome.kind !== "DECIDED" || !selected) {
    return { error: "This route is no longer ACT; go back and re-run it." };
  }
  const { decision } = outcome;
  const candidates = [selected, ...decision.alternatives];
  const evaluation = candidates.find((c) => c.route.routeId === request.routeId) ?? selected;
  return { decision, route: evaluation.route };
}

export async function checkExecutionReadiness(
  request: ReadinessRequest,
): Promise<{ ok: true; readiness: ReadinessOutcome } | { ok: false; error: string }> {
  const config = getServerConfig();
  const redecided = await redecide(request);
  if ("error" in redecided) return { ok: false, error: redecided.error };
  const { decision } = redecided;

  const readiness = await prepareExecution(
    {
      port: getDiscoveryPort(),
      walletAddress: request.walletAddress,
      chainId: config.binanceChainId,
      spendTokenAddress: decision.intent.spendTokenAddress,
      now: new Date(),
    },
    decision,
  );
  return { ok: true, readiness };
}

export interface PostApprovalRequest extends ReadinessRequest {
  readonly spender: string;
  readonly requiredBaseUnits: string;
}

/**
 * Called only after the wallet reports the approval transaction was signed
 * and broadcast by the human. Independently re-verifies the allowance
 * on-chain (never trusts the broadcast acknowledgement), then enforces the
 * mandatory re-quote: the pre-approval quote this route was built from is
 * never reused past this point.
 */
export async function checkPostApprovalReadiness(
  request: PostApprovalRequest,
): Promise<{ ok: true; readiness: ReadinessOutcome } | { ok: false; error: string }> {
  const config = getServerConfig();
  const redecided = await redecide(request);
  if ("error" in redecided) return { ok: false, error: redecided.error };
  const { decision, route } = redecided;

  const readiness = await resumeAfterApproval(
    {
      port: getDiscoveryPort(),
      walletAddress: request.walletAddress,
      chainId: config.binanceChainId,
      spendTokenAddress: decision.intent.spendTokenAddress,
      spender: request.spender,
      requiredBaseUnits: request.requiredBaseUnits,
      now: new Date(),
    },
    decision,
    route,
  );
  return { ok: true, readiness };
}
