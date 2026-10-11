#!/usr/bin/env -S npx tsx
/**
 * Live evaluation campaign (evidence tooling, not product code).
 *
 * For each ticker x size: take ONE live snapshot through the real
 * LiveDiscoveryProvider (recorded), then replay that identical snapshot
 * through Taloe FULL, the two baselines and the ablations, so methods differ
 * only in logic, never in market data or timing. No signing, no broadcast.
 *
 * Usage: pnpm validate:campaign --tickers NVDA,TSLA --amounts 5.1,25,100 [--wallet 0x...]
 * (Ondo enforces a 5 USD minimum; USDT trades just under $1, so exactly "5" is below it.)
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { LiveDiscoveryProvider, evaluateRoutes, runRouteDiscovery } from "@taloe/router-core";
import type { DiscoveryPort, EvaluationMode } from "@taloe/router-core";
import type { ExecutableRoute, RouteDecision, RouteRejection } from "@taloe/shared";
import { redactValue } from "@taloe/shared";

import { parseArgs } from "./lib/args";
import { buildServices, REPO_ROOT } from "./lib/client";
import { beginCapture, writeObservations } from "./lib/capture";

type Call = { method: string; args: unknown[]; result: unknown; latencyMs: number };

function recorder(port: DiscoveryPort, calls: Call[]): DiscoveryPort {
  const wrap =
    <A extends unknown[], R>(method: string, fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      const t = performance.now();
      const result = await fn(...a);
      calls.push({ method, args: a, result, latencyMs: Math.round(performance.now() - t) });
      return result;
    };
  return {
    mode: port.mode,
    resolveSpendAsset: wrap("resolveSpendAsset", port.resolveSpendAsset.bind(port)),
    searchUnderlying: wrap("searchUnderlying", port.searchUnderlying.bind(port)),
    discoverCandidates: wrap("discoverCandidates", port.discoverCandidates.bind(port)),
    getMarketContext: wrap("getMarketContext", port.getMarketContext.bind(port)),
    getQuotesForCandidate: wrap("getQuotesForCandidate", port.getQuotesForCandidate.bind(port)),
    simulateRoute: wrap("simulateRoute", port.simulateRoute.bind(port)),
    getWalletBalances: wrap("getWalletBalances", port.getWalletBalances.bind(port)),
    getAllowance: wrap("getAllowance", port.getAllowance.bind(port)),
    buildApprovalTransaction: wrap("buildApprovalTransaction", port.buildApprovalTransaction.bind(port)),
    simulateTransaction: wrap("simulateTransaction", port.simulateTransaction.bind(port)),
    buildSwapTransaction: wrap("buildSwapTransaction", port.buildSwapTransaction.bind(port)),
  };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  ticker: string;
  amount: string;
  method: string;
  outcome: string;
  reasons: string[];
  selected: string | null;
  selectedMode: string | null;
  rejected: { wrapper: string; stage: string; reasons: string[] }[];
}

function row(ticker: string, amount: string, method: string, d: RouteDecision): Row {
  return {
    ticker,
    amount,
    method,
    outcome: d.outcome,
    reasons: [...d.decisionReasons, ...d.selectionReasons],
    selected: d.selected ? `${d.selected.route.wrapper.tokenSymbol}/${d.selected.route.quote.vendorName}` : null,
    selectedMode: d.selected?.route.quote.executionMode ?? null,
    rejected: d.rejected.map((r: RouteRejection) => ({ wrapper: r.wrapperSymbol, stage: r.stage, reasons: [...r.reasons] })),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tickers = (args.tickers ?? "NVDA").split(",").map((t) => t.trim());
  const amounts = (args.amounts ?? "5.1,25,100").split(",").map((a) => a.trim());
  const wallet = args.wallet && args.wallet !== "true" ? args.wallet : null;
  const capture = beginCapture("campaign");
  const services = buildServices();
  const live = new LiveDiscoveryProvider(services);
  const rows: Row[] = [];
  const snapshots: unknown[] = [];

  for (const ticker of tickers) {
    for (const amount of amounts) {
      const calls: Call[] = [];
      const now = new Date();
      const first = await runRouteDiscovery(recorder(live, calls), {
        routeSessionId: `campaign-${ticker}-${amount}`,
        underlyingQuery: ticker,
        spendAmountDecimal: amount,
        walletAddress: wallet,
        maxDeviationBps: 150,
        binanceChainId: services.chainId,
        now,
      });
      snapshots.push({ ticker, amount, at: now.toISOString(), calls: calls.map((c) => ({ ...c, args: c.args.slice(0, 2) })) });
      if (first.kind !== "DECIDED") {
        rows.push({ ticker, amount, method: "FULL", outcome: `UNRESOLVABLE:${first.reason.kind}`, reasons: [first.reason.message], selected: null, selectedMode: null, rejected: [] });
        console.log(`${ticker} @ ${amount}: unresolvable ${first.reason.message}`);
        continue;
      }
      const d0 = first.decision;
      rows.push(row(ticker, amount, "FULL", d0));

      // Replay the SAME snapshot for other methods.
      const routes: ExecutableRoute[] = calls
        .filter((c) => c.method === "getQuotesForCandidate")
        .flatMap((c) => ((c.result as { ok: boolean; value?: { routes: ExecutableRoute[] } }).value?.routes ?? []));
      const pre = calls
        .filter((c) => c.method === "getQuotesForCandidate")
        .map((c) => (c.result as { value?: { preRejected: RouteRejection | null } }).value?.preRejected)
        .filter((r): r is RouteRejection => Boolean(r));
      const sims = new Map(
        calls
          .filter((c) => c.method === "simulateRoute")
          .flatMap((c) => {
            const r = c.result as { ok: boolean; value?: { status: never } };
            const routeId = (c.args[0] as ExecutableRoute).routeId;
            // Attempted-but-failed calls are recorded as NOT_RUN (attempted), as the orchestrator does.
            return [[routeId, r.ok && r.value ? r.value.status : ("NOT_RUN" as never)] as const];
          }),
      );
      const base = {
        routeSessionId: `replay-${ticker}-${amount}`,
        intent: d0.intent,
        underlying: d0.underlying,
        marketContext: d0.marketContext,
        routes,
        preRejectedCandidates: pre,
        simulations: sims,
        now,
      };
      const modes: [string, EvaluationMode][] = [
        ["NO_RWA_CONTEXT", { variant: "NO_RWA_CONTEXT" }],
        ["NO_MARKET_STATUS", { variant: "NO_MARKET_STATUS" }],
        ["NO_EXECUTION_MODE_AWARENESS", { variant: "NO_EXECUTION_MODE_AWARENESS" }],
        ["NO_NORMALIZATION", { variant: "NO_NORMALIZATION" }],
        ["NO_SIMULATION", { variant: "NO_SIMULATION" }],
      ];
      for (const platform of ["ondo", "bstock"]) modes.push([`FIXED_ISSUER:${platform}`, { variant: "FIXED_ISSUER", fixedPlatformId: platform }]);
      for (const [name, mode] of modes) rows.push(row(ticker, amount, name, evaluateRoutes({ ...base, mode })));

      // BASELINE_FIRST_RESULT: first returned route, no gates, no comparison.
      const firstRoute = routes[0];
      rows.push({
        ticker, amount, method: "BASELINE_FIRST_RESULT",
        outcome: firstRoute ? "ATTEMPT" : "NO_ROUTE",
        reasons: [],
        selected: firstRoute ? `${firstRoute.wrapper.tokenSymbol}/${firstRoute.quote.vendorName}` : null,
        selectedMode: firstRoute?.quote.executionMode ?? null,
        rejected: [],
      });
      console.log(`${ticker} @ ${amount}: FULL=${d0.outcome} sel=${d0.selected?.route.wrapper.tokenSymbol ?? "-"} routes=${routes.length} pre=${pre.length}`);
      await pause(400);
    }
  }

  const stamp = capture.startedAt.replace(/[:.]/g, "-");
  const out = resolve(REPO_ROOT, "internal", "evidence", "runtime", `campaign-${stamp}.json`);
  writeFileSync(out, JSON.stringify(redactValue({ generatedAt: capture.startedAt, wallet: wallet ? "supplied" : "none", signedOrBroadcast: false, rows, snapshots }), null, 2));
  writeObservations(capture, services.observations);
  console.log(`\nCampaign artifact: ${out}`);
  process.exit(0);
}
void main();
