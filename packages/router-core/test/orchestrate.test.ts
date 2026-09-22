import { describe, expect, it } from "vitest";

import {
  FIXTURE_DEFAULT_WALLET_ADDRESS,
  FIXTURE_POOR_WALLET_ADDRESS,
  FIXTURE_SCENARIOS,
  FixtureDiscoveryProvider,
} from "../fixtures/fixture-provider";
import { runRouteDiscovery } from "../src/orchestrate";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function discover(query: string, overrides: Partial<Parameters<typeof runRouteDiscovery>[1]> = {}) {
  const port = new FixtureDiscoveryProvider();
  return runRouteDiscovery(port, {
    routeSessionId: "rs-test",
    underlyingQuery: query,
    spendAmountDecimal: "500",
    walletAddress: "0x1111111111111111111111111111111111111111",
    maxDeviationBps: 150,
    binanceChainId: "56",
    now: NOW,
    ...overrides,
  });
}

describe("runRouteDiscovery — end to end through the fixture provider", () => {
  it("ACT: two wrappers, at least one execution mode difference, both surfaced", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("ACT");
    expect(outcome.decision.selected).not.toBeNull();
    expect(outcome.decision.underlying.companyName).toBe("NVIDIA Corporation");
  });

  it("ACT with issuer divergence: one issuer pre-rejected for a documented reason, the other wins", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.ACT_ISSUER_DIVERGENCE_CLOSED_MARKET);
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("ACT");
    expect(outcome.decision.marketContext?.sessionState).toBe("CLOSED");
    const ondoRejection = outcome.decision.rejected.find((r) => r.platformId === "ondo");
    expect(ondoRejection?.stage).toBe("PRE_QUOTE");
    expect(ondoRejection?.reasons).toContain("OUTSIDE_TRADING_HOURS");
    expect(outcome.decision.selected?.route.wrapper.platformId).toBe("bstock");
  });

  it("REFUSE: quote outside the user's deviation limit", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.REFUSE_EXCEEDS_DEVIATION);
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("REFUSE");
    expect(outcome.decision.rejected[0]?.reasons).toContain("EXCEEDS_USER_DEVIATION");
  });

  it("REFUSE: quote expired before evaluation", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.REFUSE_QUOTE_EXPIRED);
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("REFUSE");
    expect(outcome.decision.rejected[0]?.reasons).toContain("QUOTE_EXPIRED");
  });

  it("market decision never simulates: a route whose swap would fail still wins the MARKET decision", async () => {
    // Simulation is an execution-readiness step (readiness.ts), run once on the selected route.
    const port = new FixtureDiscoveryProvider();
    let simulations = 0;
    const original = port.simulateRoute.bind(port);
    port.simulateRoute = async (...args) => {
      simulations += 1;
      return original(...args);
    };
    const outcome = await runRouteDiscovery(port, {
      routeSessionId: "rs-nosim",
      underlyingQuery: FIXTURE_SCENARIOS.REFUSE_SIMULATION_FAILED,
      spendAmountDecimal: "500",
      walletAddress: FIXTURE_DEFAULT_WALLET_ADDRESS,
      maxDeviationBps: 150,
      binanceChainId: "56",
      now: NOW,
    });
    expect(outcome.kind === "DECIDED" && outcome.decision.outcome).toBe("ACT");
    expect(simulations).toBe(0);
  });

  it("UNKNOWN: candidates exist but market context is unavailable", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.UNKNOWN_NO_MARKET_CONTEXT);
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("UNKNOWN");
  });

  it("NO_ACTION: short-circuits when the caller has established existing holdings meet the intent", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.NO_ACTION_ALREADY_HELD, {
      alreadyHoldsTargetExposure: true,
    });
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("NO_ACTION");
    expect(outcome.decision.decisionReasons).toContain("ALREADY_HOLDS_TARGET_EXPOSURE");
  });

  it("MANUAL_REVIEW: an ambiguous query surfaces both candidate companies", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.MANUAL_REVIEW_AMBIGUOUS);
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("MANUAL_REVIEW");
    expect(outcome.decision.decisionReasons).toContain("UNDERLYING_MATCH_AMBIGUOUS");
    expect(outcome.decision.candidateUnderlyings.length).toBe(2);
    expect(outcome.decision.selected).toBeNull();
  });

  it("UNKNOWN: a query that resolves to nothing at all is distinct from an ambiguous one", async () => {
    const outcome = await discover("ZZZZ_NOT_A_TICKER");
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("UNKNOWN");
    expect(outcome.decision.decisionReasons).toContain("UNDERLYING_NOT_RECOGNIZED");
  });

  it("REFUSE: insufficient wallet balance for the requested spend", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.REFUSE_INSUFFICIENT_BALANCE, {
      walletAddress: FIXTURE_POOR_WALLET_ADDRESS,
    });
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("REFUSE");
    expect(outcome.decision.rejected[0]?.reasons).toContain("INSUFFICIENT_BALANCE");
  });

  it("ACT: the same ticker with a well-funded wallet is unaffected by the balance gate", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.REFUSE_INSUFFICIENT_BALANCE, {
      walletAddress: FIXTURE_DEFAULT_WALLET_ADDRESS,
    });
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("ACT");
  });

  it("REFUSE: a wrapper with no safe identity is excluded from ranking, not silently dropped", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.REFUSE_UNSUPPORTED_MAPPING);
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("REFUSE");
    expect(outcome.decision.rejected[0]?.reasons).toContain("ISSUER_MAPPING_UNSUPPORTED");
  });

  it("UNKNOWN: the sponsor search API itself is unavailable", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.UNKNOWN_SPONSOR_UNAVAILABLE);
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.outcome).toBe("UNKNOWN");
    expect(outcome.decision.decisionReasons).toContain("SPONSOR_API_UNAVAILABLE");
  });

  it("rejects an unreadable amount before any discovery call is made", async () => {
    const outcome = await discover(FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS, {
      spendAmountDecimal: "not-a-number",
    });
    expect(outcome.kind).toBe("UNRESOLVABLE");
    if (outcome.kind !== "UNRESOLVABLE") return;
    expect(outcome.reason.kind).toBe("INVALID_INPUT");
  });

  it("resolves the spend asset from the port, not from a hardcoded constant", async () => {
    // Regression guard for correction 2: the intent's spend amount must come
    // out scaled by whatever decimals resolveSpendAsset actually returns.
    const outcome = await discover(FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    expect(outcome.kind).toBe("DECIDED");
    if (outcome.kind !== "DECIDED") return;
    expect(outcome.decision.intent.spendTokenDecimals).toBe(18);
    expect(outcome.decision.intent.spendAmountBaseUnits).toBe("500000000000000000000");
  });
});
