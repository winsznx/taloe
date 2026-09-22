import { describe, expect, it } from "vitest";

import { FIXTURE_SCENARIOS, FixtureDiscoveryProvider } from "../fixtures/fixture-provider";
import { prepareExecution, resumeAfterApproval } from "../src/readiness";
import { runRouteDiscovery } from "../src/orchestrate";
import type { DiscoveryPort } from "../src/discovery-port";
import type { RouteDecision } from "@taloe/shared";

const NOW = new Date("2026-09-21T12:00:00.000Z");
const WALLET = "0x1111111111111111111111111111111111111111";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const SPENDER = "0x3333333333333333333333333333333333333333";

async function decide(port: DiscoveryPort, query: string): Promise<RouteDecision> {
  const outcome = await runRouteDiscovery(port, {
    routeSessionId: "rs-ready",
    underlyingQuery: query,
    spendAmountDecimal: "500",
    walletAddress: WALLET,
    maxDeviationBps: 150,
    binanceChainId: "56",
    now: NOW,
  });
  if (outcome.kind !== "DECIDED") throw new Error("expected a decision");
  return outcome.decision;
}

const context = (port: DiscoveryPort) => ({ port, walletAddress: WALLET, chainId: "56", spendTokenAddress: USDT, now: NOW });

describe("prepareExecution — allowance-aware readiness", () => {
  it("returns APPROVAL_REQUIRED, not a refusal, for a wallet with no allowance", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    expect(decision.outcome).toBe("ACT");

    const readiness = await prepareExecution(context(port), decision);
    expect(readiness.kind).toBe("APPROVAL_REQUIRED");
    if (readiness.kind !== "APPROVAL_REQUIRED") return;
    expect(readiness.currentAllowanceBaseUnits).toBe("0");
    // Approves exactly the trade amount, never unlimited.
    expect(readiness.requiredBaseUnits).toBe(readiness.route.quote.fromTokenAmount);
    expect(readiness.spender).toBe(SPENDER);
  });

  it("skips the approval and goes straight to a simulated swap when allowance is sufficient", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    port.grantFixtureAllowance(WALLET, SPENDER, "999999999999999999999999");
    const readiness = await prepareExecution(context(port), decision);
    expect(readiness.kind).toBe("READY_TO_SIGN");
  });

  it("does not fail closed when the allowance cannot be READ: it stops with a distinct reason", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    port.getAllowance = async () => ({ ok: false, error: { kind: "SPONSOR_UNAVAILABLE", message: "rpc down" } });
    const readiness = await prepareExecution(context(port), decision);
    expect(readiness).toMatchObject({ kind: "REFUSED", reason: "ALLOWANCE_UNREADABLE" });
  });

  it("refuses when the approval itself cannot be simulated", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    port.simulateTransaction = async (p) => ({
      ok: true,
      value: { status: "FAIL", failReason: "approve reverted", balanceChanges: [], allowanceChanges: [], observedAt: p.now.toISOString(), provenance: [] },
    });
    const readiness = await prepareExecution(context(port), decision);
    expect(readiness).toMatchObject({ kind: "REFUSED", reason: "APPROVAL_SIMULATION_FAILED" });
  });

  it("refuses an approval whose simulated spender differs from the one the quote named", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    port.simulateTransaction = async (p) => ({
      ok: true,
      value: {
        status: "PASS",
        failReason: null,
        balanceChanges: [],
        allowanceChanges: [{ tokenAddress: USDT, owner: WALLET, spender: "0x9999999999999999999999999999999999999999", preAmount: "0", postAmount: "1" }],
        observedAt: p.now.toISOString(),
        provenance: [],
      },
    });
    const readiness = await prepareExecution(context(port), decision);
    expect(readiness).toMatchObject({ kind: "REFUSED", reason: "APPROVAL_SPENDER_MISMATCH" });
  });
});

describe("prepareExecution — non-allowance simulation failure", () => {
  it("rejects the selected route, preserves the reason, and never forces it through", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = await decide(port, FIXTURE_SCENARIOS.REFUSE_SIMULATION_FAILED);
    port.grantFixtureAllowance(WALLET, SPENDER, "999999999999999999999999");
    const readiness = await prepareExecution(context(port), decision);
    expect(readiness.kind).toBe("REFUSED");
    if (readiness.kind !== "REFUSED") return;
    expect(readiness.attempts[0]).toMatchObject({ reason: "SWAP_SIMULATION_FAILED" });
    expect(readiness.attempts[0]?.detail).toMatch(/simulated revert/);
  });

  it("falls through to the next viable candidate when the selected route fails simulation", async () => {
    const port = new FixtureDiscoveryProvider();
    // The NVDA fixture pairs a SWAP with an RFQ route; make both SWAP so the fallback is a real swap.
    const quoteOriginal = port.getQuotesForCandidate.bind(port);
    port.getQuotesForCandidate = async (candidate, params) => {
      const result = await quoteOriginal(candidate, params);
      if (!result.ok) return result;
      return { ok: true, value: { ...result.value, routes: result.value.routes.map((r) => ({ ...r, quote: { ...r.quote, executionMode: "SWAP" as const } })) } };
    };
    const decision = await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    expect(decision.alternatives.length).toBeGreaterThan(0);
    port.grantFixtureAllowance(WALLET, SPENDER, "999999999999999999999999");
    const failingId = decision.selected!.route.routeId;
    const original = port.simulateRoute.bind(port);
    port.simulateRoute = async (route, params) => {
      const result = await original(route, params);
      return route.routeId === failingId && result.ok
        ? { ok: true, value: { ...result.value, status: "FAIL", failReason: "insufficient output amount" } }
        : result;
    };
    const readiness = await prepareExecution(context(port), decision);
    expect(readiness.kind).toBe("READY_TO_SIGN");
    if (readiness.kind !== "READY_TO_SIGN") return;
    expect(readiness.route.routeId).not.toBe(failingId);
    expect(readiness.attempts).toHaveLength(1);
    expect(readiness.attempts[0]?.detail).toBe("insufficient output amount");
  });

  it("does not attempt any simulation for a decision that is not ACT", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = { ...(await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS)), outcome: "REFUSE" as const, selected: null };
    let calls = 0;
    port.simulateRoute = async () => { calls += 1; throw new Error("must not be called"); };
    expect(await prepareExecution(context(port), decision)).toMatchObject({ kind: "REFUSED" });
    expect(calls).toBe(0);
  });
});

describe("resumeAfterApproval — never reuses a stale quote", () => {
  const resumeContext = (port: DiscoveryPort, requiredBaseUnits: string) => ({ ...context(port), spender: SPENDER, requiredBaseUnits });

  it("verifies the allowance on-chain, re-quotes, then builds and simulates a FRESH route", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    const stale = decision.selected!.route;
    port.grantFixtureAllowance(WALLET, SPENDER, stale.quote.fromTokenAmount);

    let requoted = 0;
    const original = port.getQuotesForCandidate.bind(port);
    port.getQuotesForCandidate = async (candidate, params) => {
      requoted += 1;
      const result = await original(candidate, params);
      if (!result.ok) return result;
      return { ok: true, value: { ...result.value, routes: result.value.routes.map((r) => ({ ...r, quote: { ...r.quote, quoteId: "fresh-quote" } })) } };
    };

    const readiness = await resumeAfterApproval(resumeContext(port, stale.quote.fromTokenAmount), decision, stale);
    expect(requoted).toBe(1);
    expect(readiness.kind).toBe("READY_TO_SIGN");
    if (readiness.kind !== "READY_TO_SIGN") return;
    expect(readiness.route.quote.quoteId).toBe("fresh-quote");
    expect(readiness.route.quote.quoteId).not.toBe(stale.quote.quoteId);
  });

  it("refuses when the approval did not actually raise the on-chain allowance", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    const stale = decision.selected!.route;
    // No grantFixtureAllowance: the broadcast "succeeded" but the chain says nothing changed.
    const readiness = await resumeAfterApproval(resumeContext(port, stale.quote.fromTokenAmount), decision, stale);
    expect(readiness).toMatchObject({ kind: "REFUSED", reason: "APPROVAL_NOT_EFFECTIVE" });
  });

  it("re-runs the deviation gate on the fresh quote and refuses if the price moved out of limit", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    const stale = decision.selected!.route;
    port.grantFixtureAllowance(WALLET, SPENDER, stale.quote.fromTokenAmount);
    const original = port.getQuotesForCandidate.bind(port);
    port.getQuotesForCandidate = async (candidate, params) => {
      const result = await original(candidate, params);
      if (!result.ok) return result;
      // Price collapses after approval: same spend now buys 20% fewer tokens.
      return { ok: true, value: { ...result.value, routes: result.value.routes.map((r) => ({ ...r, quote: { ...r.quote, toTokenAmount: (BigInt(r.quote.toTokenAmount) * 80n / 100n).toString() } })) } };
    };
    const readiness = await resumeAfterApproval(resumeContext(port, stale.quote.fromTokenAmount), decision, stale);
    expect(readiness).toMatchObject({ kind: "REFUSED", reason: "REQUOTE_FAILED_GATES" });
  });
});


describe("resumeAfterApproval — the pre-approval quoteId is never sent to build or simulate", () => {
  it("passes only the freshly re-quoted route into simulateRoute, never the stale one", async () => {
    const port = new FixtureDiscoveryProvider();
    const decision = await decide(port, FIXTURE_SCENARIOS.ACT_TWO_WRAPPERS);
    const stale = decision.selected!.route;
    port.grantFixtureAllowance(WALLET, SPENDER, stale.quote.fromTokenAmount);

    const originalQuote = port.getQuotesForCandidate.bind(port);
    port.getQuotesForCandidate = async (candidate, params) => {
      const result = await originalQuote(candidate, params);
      if (!result.ok) return result;
      return {
        ok: true,
        value: { ...result.value, routes: result.value.routes.map((r) => ({ ...r, quote: { ...r.quote, quoteId: "fresh-quote-2" } })) },
      };
    };

    const simulateCalls: string[] = [];
    const originalSimulate = port.simulateRoute.bind(port);
    port.simulateRoute = async (route, params) => {
      simulateCalls.push(route.quote.quoteId);
      return originalSimulate(route, params);
    };

    await resumeAfterApproval({ ...context(port), spender: SPENDER, requiredBaseUnits: stale.quote.fromTokenAmount }, decision, stale);

    expect(simulateCalls).toEqual(["fresh-quote-2"]);
    expect(simulateCalls).not.toContain(stale.quote.quoteId);
  });
});
