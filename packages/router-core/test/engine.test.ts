import type { SimulationStatus } from "@taloe/shared";
import { describe, expect, it } from "vitest";

import {
  makeIntent,
  makeMarketContext,
  makeRoute,
  NVDA_UNDERLYING,
} from "../fixtures/candidates";
import { evaluateRoutes } from "../src/engine";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function evaluate(
  routes: Parameters<typeof evaluateRoutes>[0]["routes"],
  overrides: Partial<Parameters<typeof evaluateRoutes>[0]> = {},
) {
  return evaluateRoutes({
    routeSessionId: "rs-1",
    intent: makeIntent(),
    underlying: NVDA_UNDERLYING,
    marketContext: makeMarketContext(),
    routes,
    now: NOW,
    ...overrides,
  });
}

describe("WrapRoute — outcomes", () => {
  it("returns ACT and names the winner when a route clears every gate", () => {
    const decision = evaluate([
      makeRoute({ routeId: "a", now: NOW, toTokenAmount: "5000000000000000000" }),
    ]);
    expect(decision.outcome).toBe("ACT");
    expect(decision.selected?.route.routeId).toBe("a");
    expect(decision.selectionReasons).toContain("ONLY_QUALIFYING_ROUTE");
  });

  it("returns UNKNOWN when there are no candidates at all", () => {
    const decision = evaluate([]);
    expect(decision.outcome).toBe("UNKNOWN");
    expect(decision.decisionReasons).toContain("NO_CANDIDATES_DISCOVERED");
    expect(decision.selected).toBeNull();
  });

  it("returns REFUSE, not a weakened constraint, when every route breaches the user limit", () => {
    // Reference is 100/token; this route pays 500 USDT for 1 token, so it is
    // 400x the reference — far outside any deviation the user set.
    const decision = evaluate([
      makeRoute({ routeId: "expensive", now: NOW, toTokenAmount: "1000000000000000000" }),
    ]);
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.selected).toBeNull();
    expect(decision.rejected[0]?.reasons).toContain("EXCEEDS_USER_DEVIATION");
    expect(decision.decisionReasons).toContain("ALL_CANDIDATES_REJECTED");
  });

  it("refuses an expired quote rather than offering it", () => {
    const decision = evaluate([makeRoute({ routeId: "stale", now: NOW, remainingMs: -1_000 })]);
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected[0]?.reasons).toContain("QUOTE_EXPIRED");
  });

  it("refuses a quote whose remaining life is too short for the next step", () => {
    // Not expired yet, but it would die mid-execution. Distinct reason code so
    // the UI can offer a refresh rather than a dead end.
    const decision = evaluate([makeRoute({ routeId: "thin", now: NOW, remainingMs: 3_000 })]);
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected[0]?.reasons).toContain("QUOTE_TTL_INSUFFICIENT");
  });

  it("refuses a route whose simulation failed", () => {
    const simulations = new Map<string, SimulationStatus>([["sim", "FAIL"]]);
    const decision = evaluate([makeRoute({ routeId: "sim", now: NOW })], { simulations });
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected[0]?.reasons).toContain("SIMULATION_FAILED");
  });

  it("refuses when an unreadable simulation result cannot be confirmed as a pass", () => {
    // "The endpoint answered" is not "the transaction is safe".
    const simulations = new Map<string, SimulationStatus>([["sim", "NOT_APPLICABLE"]]);
    const decision = evaluate([makeRoute({ routeId: "sim", now: NOW })], { simulations });
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected[0]?.reasons).toContain("SIMULATION_REQUIRED_BUT_UNAVAILABLE");
  });

  it("does not demand a simulation for an RFQ route it cannot simulate", () => {
    const decision = evaluate([
      makeRoute({ routeId: "rfq", now: NOW, executionMode: "RFQ" }),
    ]);
    expect(decision.outcome).toBe("ACT");
    expect(decision.selected?.simulationStatus).toBe("NOT_APPLICABLE");
  });

  it("one candidate's simulation fails while another survives and wins", () => {
    const simulations = new Map<string, SimulationStatus>([
      ["fails", "FAIL"],
      ["passes", "PASS"],
    ]);
    const decision = evaluate(
      [
        makeRoute({ routeId: "fails", now: NOW }),
        makeRoute({ routeId: "passes", now: NOW }),
      ],
      { simulations },
    );
    expect(decision.outcome).toBe("ACT");
    expect(decision.selected?.route.routeId).toBe("passes");
    const failedRejection = decision.rejected.find((r) => r.routeId === "fails");
    expect(failedRejection?.reasons).toContain("SIMULATION_FAILED");
  });

  it("REFUSEs when every candidate's simulation fails", () => {
    const simulations = new Map<string, SimulationStatus>([
      ["a", "FAIL"],
      ["b", "FAIL"],
    ]);
    const decision = evaluate(
      [makeRoute({ routeId: "a", now: NOW }), makeRoute({ routeId: "b", now: NOW })],
      { simulations },
    );
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected).toHaveLength(2);
    for (const rejection of decision.rejected) {
      expect(rejection.reasons).toContain("SIMULATION_FAILED");
    }
  });

  it("a passing simulation does not excuse an already-expired quote at evaluation time", () => {
    // Models "quote expires between build and simulation": the simulation
    // ran and passed against the transaction as built, but by the time the
    // engine evaluates the route, its estimated quote lifetime is already
    // spent. The route must still be refused for the quote, not waved through
    // because the simulation happened to succeed.
    const simulations = new Map<string, SimulationStatus>([["stale-after-sim", "PASS"]]);
    const decision = evaluate(
      [makeRoute({ routeId: "stale-after-sim", now: NOW, remainingMs: -1_000 })],
      { simulations },
    );
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected[0]?.reasons).toContain("QUOTE_EXPIRED");
  });

  it("refuses a halted wrapper", () => {
    const decision = evaluate([makeRoute({ routeId: "halted", now: NOW })], {
      marketContext: makeMarketContext({ isHalted: true, sessionState: "PAUSED" }),
    });
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected[0]?.reasons).toContain("PAUSED_OR_HALTED");
  });

  it("still routes while the underlying market is merely closed", () => {
    // PRD 8.7: a closed reference market is context, not a refusal. Tokenized
    // wrappers keep trading, and refusing here would break the product
    // overnight and every weekend.
    const decision = evaluate([makeRoute({ routeId: "closed", now: NOW })], {
      marketContext: makeMarketContext({ sessionState: "CLOSED", isHalted: false }),
    });
    expect(decision.outcome).toBe("ACT");
  });

  it("returns UNKNOWN, not ACT, when there is no reference to check the constraint against", () => {
    // The route passed every gate we could run — but the user's hard deviation
    // limit was never actually tested, so claiming ACT would claim an
    // enforcement that did not happen.
    // Neither the underlying context nor the wrapper itself carries a reference.
    const decision = evaluate([makeRoute({ routeId: "noref", now: NOW, wrapper: { referencePrice: null } })], {
      marketContext: makeMarketContext({ referencePrice: null }),
    });
    expect(decision.outcome).toBe("UNKNOWN");
    expect(decision.decisionReasons).toContain("REFERENCE_CONTEXT_UNAVAILABLE");
    expect(decision.selected).toBeNull();
  });

  it("returns UNKNOWN when the reference price is too stale to trust", () => {
    const decision = evaluate([makeRoute({ routeId: "stale-ref", now: NOW })], {
      marketContext: makeMarketContext({ referenceAgeMs: 600_000 }),
    });
    expect(decision.outcome).toBe("UNKNOWN");
  });

  it("never attaches a selected route to a non-ACT decision", () => {
    const decision = evaluate([makeRoute({ routeId: "bad", now: NOW, remainingMs: -1 })]);
    expect(decision.outcome).not.toBe("ACT");
    expect(decision.selected).toBeNull();
  });

  it("refuses when the wallet cannot cover the spend", () => {
    const decision = evaluate([makeRoute({ routeId: "poor", now: NOW })], {
      walletSpendBalanceBaseUnits: "1000000000000000000", // 1 USDT vs 500 requested
    });
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected[0]?.reasons).toContain("INSUFFICIENT_BALANCE");
  });

  it("excludes an unsupported wrapper rather than ranking it", () => {
    const decision = evaluate([
      makeRoute({ routeId: "unsupported", now: NOW, wrapper: { semanticConfidence: "UNSUPPORTED" } }),
    ]);
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected[0]?.reasons).toContain("ISSUER_MAPPING_UNSUPPORTED");
  });

  it("refuses a route whose execution mode this client cannot drive", () => {
    const decision = evaluate([makeRoute({ routeId: "rfq", now: NOW, executionMode: "RFQ" })], {
      supportedExecutionModes: ["SWAP"],
    });
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected[0]?.reasons).toContain("UNSUPPORTED_EXECUTION_MODE");
  });

  it("keeps gate reasons traceable for every rejected candidate", () => {
    const decision = evaluate([
      makeRoute({ routeId: "a", now: NOW, remainingMs: -1 }),
      makeRoute({ routeId: "b", now: NOW, toTokenAmount: "1000000000000000000" }),
    ]);
    expect(decision.rejected).toHaveLength(2);
    for (const rejection of decision.rejected) {
      expect(rejection.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("WrapRoute — comparison", () => {
  it("prefers the route returning more of the same wrapper token", () => {
    // Both must sit inside the user's 150 bps limit, otherwise the loser is
    // rejected by the deviation gate and there is no comparison to test.
    // 4.99 tokens for 500 USDT is ~20 bps off the 100 reference.
    const decision = evaluate([
      makeRoute({ routeId: "less", now: NOW, toTokenAmount: "4990000000000000000" }),
      makeRoute({ routeId: "more", now: NOW, toTokenAmount: "5000000000000000000" }),
    ]);
    expect(decision.outcome).toBe("ACT");
    expect(decision.selected?.route.routeId).toBe("more");
    expect(decision.selectionReasons).toContain("BETTER_EFFECTIVE_EXPOSURE");
  });

  it("lists losing-but-valid routes as alternatives, not rejections", () => {
    const decision = evaluate([
      makeRoute({ routeId: "less", now: NOW, toTokenAmount: "4990000000000000000" }),
      makeRoute({ routeId: "more", now: NOW, toTokenAmount: "5000000000000000000" }),
    ]);
    expect(decision.alternatives.map((a) => a.route.routeId)).toEqual(["less"]);
    expect(decision.rejected).toHaveLength(0);
  });

  it("does not treat a missing fee as a zero fee", () => {
    // Both routes deliver the same amount; one reports no fee. An unreported
    // fee must not win by looking free.
    const decision = evaluate([
      makeRoute({ routeId: "unknown-fee", now: NOW, tradeFeeUsd: null, priceImpactPercent: "0.1" }),
      makeRoute({ routeId: "known-fee", now: NOW, tradeFeeUsd: "0.5", priceImpactPercent: "0.1" }),
    ]);
    expect(decision.outcome).toBe("ACT");
    expect(decision.selectionReasons).not.toContain("LOWER_TOTAL_COST");
  });

  it("does not compare amounts across different wrapper tokens", () => {
    // 5 NVDAon and 5 NVDAx are not the same quantity of anything. Without
    // validated normalization these are not comparable, and the engine must
    // not pick a winner by pretending they are.
    const decision = evaluate([
      makeRoute({
        routeId: "ondo",
        now: NOW,
        toTokenAmount: "5000000000000000000",
        wrapper: { platformId: "ondo", tokenContractAddress: "0xaaaa".padEnd(42, "a") },
      }),
      makeRoute({
        routeId: "bstock",
        now: NOW,
        toTokenAmount: "9000000000000000000",
        wrapper: { platformId: "bstock", tokenContractAddress: "0xbbbb".padEnd(42, "b") },
      }),
    ]);
    expect(decision.outcome).toBe("ACT");
    // The larger raw number must not automatically win on exposure grounds.
    expect(decision.selectionReasons).not.toContain("BETTER_EFFECTIVE_EXPOSURE");
  });
});

describe("WrapRoute — ablations", () => {
  it("FIXED_ISSUER only considers the pinned platform", () => {
    const decision = evaluate(
      [
        makeRoute({ routeId: "ondo", now: NOW, wrapper: { platformId: "ondo" } }),
        makeRoute({ routeId: "bstock", now: NOW, wrapper: { platformId: "bstock" } }),
      ],
      { mode: { variant: "FIXED_ISSUER", fixedPlatformId: "bstock" } },
    );
    expect(decision.selected?.route.routeId).toBe("bstock");
  });

  it("NO_MARKET_STATUS drops the reference and can no longer confirm the constraint", () => {
    const decision = evaluate([makeRoute({ routeId: "a", now: NOW })], {
      mode: { variant: "NO_MARKET_STATUS" },
    });
    expect(decision.outcome).toBe("UNKNOWN");
    expect(decision.decisionReasons).toContain("REFERENCE_CONTEXT_UNAVAILABLE");
  });

  it("NO_EXECUTION_MODE_AWARENESS rejects RFQ routes it would otherwise execute", () => {
    // This is the ablation that should show execution-mode handling is
    // load-bearing: with it off, a perfectly good Ondo route is unusable.
    const routes = [makeRoute({ routeId: "rfq", now: NOW, executionMode: "RFQ" })];
    expect(evaluate(routes).outcome).toBe("ACT");
    expect(evaluate(routes, { mode: { variant: "NO_EXECUTION_MODE_AWARENESS" } }).outcome).toBe(
      "REFUSE",
    );
  });

  it("NO_SIMULATION lets a route through that the full router refuses", () => {
    const simulations = new Map<string, SimulationStatus>([["sim", "FAIL"]]);
    const routes = [makeRoute({ routeId: "sim", now: NOW })];
    expect(evaluate(routes, { simulations }).outcome).toBe("REFUSE");
    expect(evaluate(routes, { simulations, mode: { variant: "NO_SIMULATION" } }).outcome).toBe(
      "ACT",
    );
  });
});

describe("WrapRoute — per-share deviation (live-observed ratio != 1)", () => {
  it("does not read a 4-shares-per-token wrapper as a 300% deviation", () => {
    // CRWDon-like: 500 USDT buys 1.25 tokens = 5 shares = 100 USDT/share, which
    // matches the 100/share reference. Comparing the per-TOKEN price (400) to
    // the per-share reference would have refused this at +30,000 bps.
    const decision = evaluate([
      makeRoute({
        routeId: "four-shares",
        now: NOW,
        toTokenAmount: "1250000000000000000",
        wrapper: { platformId: "ondo", tokenToShareRatioRaw: "4" },
      }),
    ], { simulations: new Map([["four-shares", "PASS"]]) });
    expect(decision.outcome).toBe("ACT");
    expect(decision.selected?.referenceDeviationBps).toBe(0);
  });

  it("still refuses a genuinely mispriced multi-share wrapper", () => {
    const decision = evaluate([
      makeRoute({
        routeId: "mispriced",
        now: NOW,
        toTokenAmount: "1000000000000000000", // 500/token / 4 shares = 125/share vs 100
        wrapper: { platformId: "ondo", tokenToShareRatioRaw: "4" },
      }),
    ]);
    expect(decision.rejected[0]?.reasons).toContain("EXCEEDS_USER_DEVIATION");
  });

  it("cannot enforce the limit when the issuer's ratio semantics are UNKNOWN", () => {
    const decision = evaluate([
      makeRoute({ routeId: "xs", now: NOW, wrapper: { platformId: "xstock" } }),
    ]);
    expect(decision.outcome).toBe("UNKNOWN");
    expect(decision.decisionReasons).toContain("REFERENCE_CONTEXT_UNAVAILABLE");
  });
});

describe("WrapRoute — NO_ACTION", () => {
  it("returns NO_ACTION without evaluating any route when holdings already meet the intent", () => {
    const decision = evaluate([makeRoute({ routeId: "a", now: NOW })], {
      alreadyHoldsTargetExposure: true,
    });
    expect(decision.outcome).toBe("NO_ACTION");
    expect(decision.selected).toBeNull();
    expect(decision.decisionReasons).toContain("ALREADY_HOLDS_TARGET_EXPOSURE");
  });

  it("does not return NO_ACTION merely because the flag was omitted", () => {
    const decision = evaluate([makeRoute({ routeId: "a", now: NOW })]);
    expect(decision.outcome).not.toBe("NO_ACTION");
  });
});

describe("WrapRoute — correction 3: closed market is context, not a global allow or refuse", () => {
  it("a candidate survives under a closed underlying market when nothing about IT is restricted", () => {
    // xStock trades via AMM per the docs and is not documented as subject to
    // market-hours restrictions. A closed session must not block it.
    const decision = evaluate(
      [makeRoute({ routeId: "bstock", now: NOW, wrapper: { platformId: "bstock" } })],
      { marketContext: makeMarketContext({ sessionState: "CLOSED", isHalted: false }) },
    );
    expect(decision.outcome).toBe("ACT");
  });

  it("a specific issuer's documented market-hours restriction rejects only that candidate", () => {
    // The flagship case: one underlying, one closed session, two issuers.
    // Ondo's API actually refused to quote (we never got a route for it) —
    // modelled as a pre-quote rejection with OUTSIDE_TRADING_HOURS — while
    // xStock's AMM route is unaffected and wins. This is the issuer
    // divergence the review calls out as a strong product proof: the SAME
    // session state produces a DIFFERENT outcome per issuer, for a reason a
    // price-only comparison could never produce.
    const decision = evaluate(
      [makeRoute({ routeId: "bstock", now: NOW, wrapper: { platformId: "bstock" } })],
      {
        marketContext: makeMarketContext({ sessionState: "CLOSED", isHalted: false }),
        preRejectedCandidates: [
          {
            routeId: "no-quote:ondo:NVDAon",
            wrapperSymbol: "NVDAon",
            platformId: "ondo",
            reasons: ["OUTSIDE_TRADING_HOURS"],
            stage: "PRE_QUOTE",
          },
        ],
      },
    );
    expect(decision.outcome).toBe("ACT");
    expect(decision.selected?.route.wrapper.platformId).toBe("bstock");
    const ondoRejection = decision.rejected.find((r) => r.platformId === "ondo");
    expect(ondoRejection?.reasons).toContain("OUTSIDE_TRADING_HOURS");
    expect(ondoRejection?.stage).toBe("PRE_QUOTE");
  });

  it("REFUSEs when every candidate is pre-rejected for a documented, attributable reason", () => {
    const decision = evaluate([], {
      preRejectedCandidates: [
        {
          routeId: "no-quote:ondo:NVDAon",
          wrapperSymbol: "NVDAon",
          platformId: "ondo",
          reasons: ["OUTSIDE_TRADING_HOURS"],
          stage: "PRE_QUOTE",
        },
      ],
    });
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.decisionReasons).toContain("ALL_CANDIDATES_REJECTED");
    expect(decision.rejected).toHaveLength(1);
  });

  it("returns UNKNOWN, not REFUSE, when nothing was found at all — not even a pre-rejection", () => {
    const decision = evaluate([]);
    expect(decision.outcome).toBe("UNKNOWN");
    expect(decision.decisionReasons).toContain("NO_CANDIDATES_DISCOVERED");
  });

  it("still rejects a halted wrapper the same way regardless of session state", () => {
    const decision = evaluate([makeRoute({ routeId: "halted", now: NOW })], {
      marketContext: makeMarketContext({ sessionState: "PAUSED", isHalted: true }),
    });
    expect(decision.outcome).toBe("REFUSE");
    expect(decision.rejected[0]?.reasons).toContain("PAUSED_OR_HALTED");
    expect(decision.rejected[0]?.stage).toBe("GATE");
  });

  it("returns UNKNOWN when required market context is unavailable, per the existing reference rule", () => {
    const decision = evaluate([makeRoute({ routeId: "a", now: NOW, wrapper: { referencePrice: null } })], {
      marketContext: null,
    });
    expect(decision.outcome).toBe("UNKNOWN");
    expect(decision.decisionReasons).toContain("REFERENCE_CONTEXT_UNAVAILABLE");
  });
});
