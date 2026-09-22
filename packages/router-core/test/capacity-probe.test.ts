import { describe, expect, it } from "vitest";

import { makeMarketContext, makeRoute, makeWrapper } from "../fixtures/candidates";
import { probeWrapperCapacity } from "../src/capacity-probe";
import type { DiscoveryPort } from "../src/discovery-port";
import { assessSizeEquivalence } from "../src/size-equivalence";
import type { RouteEvaluation } from "@taloe/shared";

const wrapper = makeWrapper({ platformId: "bstock" });
const USDT = "0x55d398326f99059fF775485246999027B3197955";

/** A port whose per-token price worsens by `bpsPerThousandUsd` for every 1000 spent. */
function port(bpsPerThousandUsd: number, failAbove = Infinity): DiscoveryPort {
  const quotes: DiscoveryPort["getQuotesForCandidate"] = async (_candidate, params) => {
      const spendUsd = Number(BigInt(params.spendAmountBaseUnits) / 10n ** 16n) / 100;
      if (spendUsd > failAbove) return { ok: false, error: { kind: "SPONSOR_UNAVAILABLE", message: "no liquidity" } };
      const worsening = 1 + (bpsPerThousandUsd * (spendUsd / 1000)) / 10_000;
      // Reference is 100 USDT per token, so spend / 100 tokens would be zero deviation.
      const tokens = spendUsd / 100 / worsening;
      const route = makeRoute({ routeId: `r-${spendUsd}`, wrapper, toTokenAmount: BigInt(Math.round(tokens * 1e6)) * 10n ** 12n + "" });
      return { ok: true, value: { routes: [{ ...route, quote: { ...route.quote, fromTokenAmount: params.spendAmountBaseUnits } }], preRejected: null } };
  };
  // Only the one method the probe calls is needed.
  return { getQuotesForCandidate: quotes } as unknown as DiscoveryPort;
}

const params = { chainId: "56", spendTokenAddress: USDT, spendTokenDecimals: 18, walletAddress: null, marketContext: makeMarketContext() };

describe("probeWrapperCapacity", () => {
  it("brackets capacity from quotes and stops at the first breach of the loosest threshold", async () => {
    // 10 bps of deviation per $1000: 500 -> 5 bps, 2000 -> 20 bps, 20000 would be 200 bps.
    const result = await probeWrapperCapacity(port(10), wrapper, { ...params, tickets: [100, 500, 2000, 10000, 25000] });
    const at150 = result.capacities.find((c) => c.thresholdBps === 150)!;
    expect(at150.status).toBe("BOUNDED");
    expect(at150.safeUpToUsd).toBe(10000);
    expect(at150.breachedAtUsd).toBe(25000);
    expect(result.observations).toHaveLength(5);
  });

  it("uses the same quotes to answer tighter thresholds", async () => {
    const result = await probeWrapperCapacity(port(10), wrapper, { ...params, tickets: [100, 500, 2000, 10000, 25000] });
    expect(result.capacities.find((c) => c.thresholdBps === 50)).toMatchObject({ safeUpToUsd: 2000, breachedAtUsd: 10000 });
  });

  it("stops issuing quotes once a ticket breaches", async () => {
    const result = await probeWrapperCapacity(port(500), wrapper, { ...params, tickets: [100, 500, 1000, 2000, 5000] });
    expect(result.observations.length).toBeLessThan(5);
  });

  it("treats a missing quote as unknown, never as a breach or as safe", async () => {
    const result = await probeWrapperCapacity(port(0, 200), wrapper, { ...params, tickets: [100, 500, 1000] });
    const at150 = result.capacities.find((c) => c.thresholdBps === 150)!;
    expect(at150.status).toBe("UNKNOWN");
    expect(at150.endedBy).toBe("QUOTE_UNAVAILABLE");
  });
});

const evaluation = (amount: string | null): RouteEvaluation => ({
  route: makeRoute({ routeId: "x" }),
  comparable: amount !== null,
  underlyingEquivalentAmount: amount,
  effectiveCostPerUnderlyingUnit: null,
  referenceDeviationBps: 0,
  constraintChecks: [],
  simulationStatus: "NOT_RUN",
  rejectionReasons: [],
});

describe("assessSizeEquivalence", () => {
  it("calls a few-bps gap materially equivalent instead of naming a winner", () => {
    expect(assessSizeEquivalence([evaluation("1.0000"), evaluation("1.0007")])).toEqual({ kind: "MATERIALLY_EQUIVALENT", gapBps: 7 });
  });
  it("flags a large gap as materially different", () => {
    const result = assessSizeEquivalence([evaluation("1"), evaluation("1.02")]);
    expect(result).toEqual({ kind: "MATERIALLY_DIFFERENT", gapBps: 200 });
  });
  it("does not compare when an amount is unknown", () => {
    expect(assessSizeEquivalence([evaluation("1"), evaluation(null)]).kind).toBe("NOT_COMPARABLE");
  });
  it("has nothing to compare with one route", () => {
    expect(assessSizeEquivalence([evaluation("1")]).kind).toBe("SINGLE_ROUTE");
  });
});
