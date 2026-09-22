/**
 * Live capacity probe: derives SafeExecutionCapacity for one wrapper from
 * fresh executable quotes at increasing tickets.
 *
 * Every number returned here was quoted seconds ago. The probe never
 * extrapolates, so the caller can show it without hedging about method, only
 * about age. It costs one quote per ticket, which is why it is opt-in and
 * stops at the first ticket that breaches the loosest threshold.
 */

import type { ExecutableRoute, MarketContext, WrapperCandidate } from "@taloe/shared";

import type { CapacityObservation, SafeExecutionCapacity } from "./capacity";
import { CAPACITY_THRESHOLDS_BPS, deriveSafeCapacity } from "./capacity";
import type { DiscoveryPort } from "./discovery-port";
import { computeReferenceDeviation } from "./gates";
import { DEFAULT_POLICY } from "./policy";

export const CAPACITY_PROBE_TICKETS_USD = [5.1, 25, 100, 250, 500, 1000, 2000, 5000, 10000, 25000] as const;

export interface CapacityProbeResult {
  readonly wrapperSymbol: string;
  readonly platformId: string | null;
  readonly observations: readonly CapacityObservation[];
  readonly capacities: readonly SafeExecutionCapacity[];
  readonly probedAt: string;
}

export interface CapacityProbeParams {
  readonly chainId: string;
  readonly spendTokenAddress: string;
  readonly spendTokenDecimals: number;
  readonly walletAddress: string | null;
  readonly marketContext: MarketContext | null;
  readonly tickets?: readonly number[];
  /** The scan stops at the first ticket whose deviation exceeds this. Defaults to the loosest evaluated threshold. */
  readonly stopAtBps?: number;
  readonly now?: () => Date;
}

function toBaseUnits(ticketUsd: number, decimals: number): string {
  const cents = BigInt(Math.round(ticketUsd * 100));
  return (cents * 10n ** BigInt(decimals - 2)).toString();
}

function bestRoute(routes: readonly ExecutableRoute[]): ExecutableRoute | null {
  // The vendor's own "best" flag is not trusted; the route returning the most tokens wins.
  return routes.reduce<ExecutableRoute | null>(
    (best, route) => (best === null || BigInt(route.quote.toTokenAmount) > BigInt(best.quote.toTokenAmount) ? route : best),
    null,
  );
}

export async function probeWrapperCapacity(
  port: DiscoveryPort,
  wrapper: WrapperCandidate,
  params: CapacityProbeParams,
): Promise<CapacityProbeResult> {
  const clock = params.now ?? (() => new Date());
  const stopAt = params.stopAtBps ?? Math.max(...CAPACITY_THRESHOLDS_BPS);
  const observations: CapacityObservation[] = [];

  for (const ticketUsd of params.tickets ?? CAPACITY_PROBE_TICKETS_USD) {
    const now = clock();
    const result = await port.getQuotesForCandidate(wrapper, {
      chainId: params.chainId,
      spendTokenAddress: params.spendTokenAddress,
      spendAmountBaseUnits: toBaseUnits(ticketUsd, params.spendTokenDecimals),
      walletAddress: params.walletAddress,
      now,
    });
    const route = result.ok ? bestRoute(result.value.routes) : null;
    if (route === null) {
      observations.push({ ticketUsd, deviationBps: null, quoted: false });
      break;
    }
    const deviationBps = computeReferenceDeviation({
      route,
      policy: DEFAULT_POLICY,
      marketContext: params.marketContext,
      maxDeviationBps: stopAt,
      spendAmountBaseUnits: route.quote.fromTokenAmount,
      spendTokenDecimals: params.spendTokenDecimals,
      walletSpendBalanceBaseUnits: null,
      walletGasBalanceWei: null,
      simulationStatus: "NOT_RUN",
      simulationAttempted: false,
      supportedExecutionModes: ["SWAP", "RFQ"],
      now,
    });
    observations.push({ ticketUsd, deviationBps, quoted: true });
    if (deviationBps === null || Math.abs(deviationBps) > stopAt) break;
  }

  return {
    wrapperSymbol: wrapper.tokenSymbol,
    platformId: wrapper.platformId,
    observations,
    capacities: CAPACITY_THRESHOLDS_BPS.map((threshold) => deriveSafeCapacity(observations, threshold)),
    probedAt: clock().toISOString(),
  };
}
