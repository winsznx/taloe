#!/usr/bin/env -S npx tsx
/**
 * Read-only before/after measurement of the market-decision / readiness split.
 *
 *   BEFORE (legacy): decide, then build+simulate EVERY quoted SWAP route
 *                    (what runRouteDiscovery did before the split).
 *   AFTER  (split):  decide with no simulation, then prepareExecution on the
 *                    selected route only (allowance read, approval build+sim).
 *
 * Counts sponsor HTTP requests and wall time. The wallet is a public address
 * with no key, so nothing can be signed or broadcast.
 * Usage: pnpm validate:readiness-cost --tickers NVDA,TSLA --amount 25
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { LiveDiscoveryProvider, prepareExecution, runRouteDiscovery } from "@taloe/router-core";
import { redactValue } from "@taloe/shared";

import { parseArgs } from "./lib/args";
import { buildServices, REPO_ROOT } from "./lib/client";

const WALLET = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tickers = (args.tickers ?? "NVDA,TSLA,AAPL,QQQ").split(",");
  const amount = args.amount ?? "25";
  const services = buildServices();
  const port = new LiveDiscoveryProvider(services);
  const spend = await port.resolveSpendAsset(services.chainId);
  if (!spend.ok) throw new Error(spend.error.message);
  const rows: unknown[] = [];

  for (const ticker of tickers) {
    const params = {
      routeSessionId: `cost-${ticker}`,
      underlyingQuery: ticker,
      spendAmountDecimal: amount,
      walletAddress: WALLET,
      maxDeviationBps: 150,
      binanceChainId: services.chainId,
    };

    // AFTER: the split flow.
    let mark = services.observations.length;
    let t0 = Date.now();
    const decided = await runRouteDiscovery(port, { ...params, now: new Date() });
    const decisionRequests = services.observations.length - mark;
    const decisionMs = Date.now() - t0;
    if (decided.kind !== "DECIDED") continue;
    const decision = decided.decision;

    mark = services.observations.length;
    t0 = Date.now();
    const readiness = await prepareExecution(
      { port, walletAddress: WALLET, chainId: services.chainId, spendTokenAddress: spend.value.contractAddress, now: new Date() },
      decision,
    );
    const readinessRequests = services.observations.length - mark;
    const readinessMs = Date.now() - t0;

    // BEFORE: the legacy loop, on a fresh decision so quote ages are comparable.
    mark = services.observations.length;
    t0 = Date.now();
    const legacy = await runRouteDiscovery(port, { ...params, now: new Date() });
    let legacySims = 0;
    if (legacy.kind === "DECIDED") {
      const all = [legacy.decision.selected, ...legacy.decision.alternatives, ...legacy.decision.rejected.map(() => null)];
      for (const evaluation of all) {
        if (!evaluation) continue;
        await port.simulateRoute(evaluation.route, {
          chainId: services.chainId, walletAddress: WALLET, spendTokenAddress: spend.value.contractAddress, now: new Date(),
        });
        legacySims += 1;
      }
    }
    const legacyRequests = services.observations.length - mark;
    const legacyMs = Date.now() - t0;

    const row = {
      ticker, amount, outcome: decision.outcome,
      selected: decision.selected?.route.wrapper.tokenSymbol ?? null,
      readiness: readiness.kind,
      after: { requests: decisionRequests + readinessRequests, ms: decisionMs + readinessMs, decisionRequests, readinessRequests },
      before: { requests: legacyRequests, ms: legacyMs, swapSimulations: legacySims },
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }

  const out = resolve(REPO_ROOT, "internal/evidence/runtime", `readiness-cost-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(redactValue({ wallet: "public address (no key)", signedOrBroadcast: false, rows }), null, 2));
  console.log("artifact:", out);
  process.exit(0);
}
void main();
