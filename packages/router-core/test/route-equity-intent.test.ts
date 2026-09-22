import { describe, expect, it } from "vitest";

import { FIXTURE_DEFAULT_WALLET_ADDRESS, FIXTURE_SCENARIOS, FixtureDiscoveryProvider } from "../fixtures/fixture-provider";
import { routeEquityIntent } from "../src/route-equity-intent";

const NOW = new Date("2026-09-21T12:00:00.000Z");

describe("routeEquityIntent — the single routing call shape", () => {
  it("returns ACT with a selected wrapper, its deviation, and a candidate summary — no wallet needed", async () => {
    const result = await routeEquityIntent(new FixtureDiscoveryProvider(), {
      ticker: FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS,
      amount: "500",
      maxDeviationBps: 150,
      binanceChainId: "56",
      routeSessionId: "svc-1",
      now: NOW,
    });
    expect(result.decision).toBe("ACT");
    expect(result.selectedWrapper).not.toBeNull();
    expect(typeof result.effectiveDeviationBps === "number" || result.effectiveDeviationBps === null).toBe(true);
    expect(result.candidateSummary.length).toBeGreaterThan(0);
    expect(result.refusalReason).toBeNull();
    // No walletContext supplied: readiness is never evaluated, market and wallet concerns stay separate.
    expect(result.executionReadiness).toBeNull();
  });

  it("surfaces a specific refusal reason for REFUSE, not just the outcome label", async () => {
    const result = await routeEquityIntent(new FixtureDiscoveryProvider(), {
      ticker: FIXTURE_SCENARIOS.REFUSE_EXCEEDS_DEVIATION,
      amount: "500",
      maxDeviationBps: 1,
      binanceChainId: "56",
      routeSessionId: "svc-2",
      now: NOW,
    });
    expect(result.decision).toBe("REFUSE");
    expect(result.selectedWrapper).toBeNull();
    expect(result.refusalReason).not.toBeNull();
  });

  it("evaluates execution readiness only when a walletContext is supplied AND the decision is ACT", async () => {
    const result = await routeEquityIntent(new FixtureDiscoveryProvider(), {
      ticker: FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS,
      amount: "500",
      maxDeviationBps: 150,
      binanceChainId: "56",
      routeSessionId: "svc-3",
      walletContext: { address: FIXTURE_DEFAULT_WALLET_ADDRESS },
      now: NOW,
    });
    expect(result.decision).toBe("ACT");
    expect(result.executionReadiness).not.toBeNull();
    expect(["READY_TO_SIGN", "APPROVAL_REQUIRED", "REFUSED"]).toContain(result.executionReadiness?.kind);
  });

  it("does not evaluate readiness for a REFUSE decision even with a wallet supplied", async () => {
    const result = await routeEquityIntent(new FixtureDiscoveryProvider(), {
      ticker: FIXTURE_SCENARIOS.REFUSE_EXCEEDS_DEVIATION,
      amount: "500",
      maxDeviationBps: 1,
      binanceChainId: "56",
      routeSessionId: "svc-4",
      walletContext: { address: FIXTURE_DEFAULT_WALLET_ADDRESS },
      now: NOW,
    });
    expect(result.decision).toBe("REFUSE");
    expect(result.executionReadiness).toBeNull();
  });

  it("reports UNRESOLVABLE distinctly from every real decision outcome", async () => {
    const result = await routeEquityIntent(new FixtureDiscoveryProvider(), {
      ticker: FIXTURE_SCENARIOS.UNKNOWN_SPONSOR_UNAVAILABLE,
      amount: "not-a-number",
      maxDeviationBps: 150,
      binanceChainId: "56",
      routeSessionId: "svc-5",
      now: NOW,
    });
    expect(result.decision).toBe("UNRESOLVABLE");
    expect(result.refusalReason).toBe("UNRESOLVABLE_REQUEST");
  });
});
