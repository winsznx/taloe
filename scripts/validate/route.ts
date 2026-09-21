#!/usr/bin/env -S npx tsx
/**
 * Pre-signature acceptance run for the whole seam:
 *
 *   RWA discovery -> market/session context -> executable quotes
 *   -> build swap / RFQ path -> simulation -> Taloe decision
 *
 * It drives the exact `LiveDiscoveryProvider` + `runRouteDiscovery` code the
 * product runs, wrapped in a recorder, and writes ONE evidence bundle. It
 * never signs and never broadcasts: no private key is read, and the
 * broadcast / RFQ-submit methods are never called.
 *
 * Normalization is not forced to succeed. While an issuer's ratio semantics
 * are UNKNOWN the bundle says so and the decision reflects it.
 *
 * Usage: pnpm validate:route --ticker NVDA --amount 5 [--wallet 0x...] [--max-deviation-bps 150]
 * A --wallet is needed for SWAP simulation (build + simulate need a `from`
 * address). Without one, simulation is reported as not attempted, honestly.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { lookupIssuer, LiveDiscoveryProvider, runRouteDiscovery } from "@taloe/router-core";
import type { DiscoveryPort } from "@taloe/router-core";
import { redactValue } from "@taloe/shared";

import { parseArgs } from "./lib/args";
import { buildServices, REPO_ROOT } from "./lib/client";
import { beginCapture, printObservationTable, writeObservations } from "./lib/capture";

type Recorded = { method: string; at: string; ok: boolean; value?: unknown; error?: unknown };

/** Records every DiscoveryPort call/result without altering behaviour. */
function recording(port: DiscoveryPort, log: Recorded[]): DiscoveryPort {
  const wrap = <A extends unknown[], R extends { ok: boolean }>(
    method: string,
    fn: (...args: A) => Promise<R>,
  ) =>
    async (...args: A): Promise<R> => {
      const result = await fn(...args);
      const entry: Recorded = { method, at: new Date().toISOString(), ok: result.ok };
      if (result.ok) entry.value = (result as unknown as { value: unknown }).value;
      else entry.error = (result as unknown as { error: unknown }).error;
      log.push(entry);
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
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ticker = args.ticker;
  const amount = args.amount;
  if (!ticker || !amount) {
    console.error("Usage: pnpm validate:route --ticker NVDA --amount 5 [--wallet 0x...] [--max-deviation-bps 150]");
    process.exit(1);
  }
  const wallet = args.wallet && args.wallet !== "true" ? args.wallet : null;
  const maxDeviationBps = Number(args["max-deviation-bps"] ?? 150);

  const capture = beginCapture(`route-${ticker.toLowerCase()}-${amount}`);
  const services = buildServices();
  const log: Recorded[] = [];
  const port = recording(new LiveDiscoveryProvider(services), log);

  console.log(`[validate:route] ${capture.startedAt} — ${ticker} @ ${amount} USDT (no signing, no broadcast)\n`);

  const outcome = await runRouteDiscovery(port, {
    routeSessionId: `validate-${capture.startedAt}`,
    underlyingQuery: ticker,
    spendAmountDecimal: amount,
    walletAddress: wallet,
    maxDeviationBps,
    binanceChainId: services.chainId,
  });

  const observationsPath = writeObservations(capture, services.observations);
  const byMethod = (m: string) => log.filter((e) => e.method === m);

  const candidates = (byMethod("discoverCandidates")[0]?.value ?? []) as {
    platformId: string | null;
    tokenSymbol: string;
    tokenContractAddress: string;
    tokenToShareRatioRaw: string | null;
    semanticConfidence: string;
  }[];

  const bundle = {
    schema: "taloe.validate-route/v1",
    generatedAt: capture.startedAt,
    signedOrBroadcast: false,
    inputIntent: { ticker, amount, wallet, maxDeviationBps, chainId: services.chainId },
    spendAsset: byMethod("resolveSpendAsset")[0],
    wrapperUniverse: byMethod("searchUnderlying")[0],
    candidates,
    rwaContext: byMethod("getMarketContext")[0],
    candidateQuotes: byMethod("getQuotesForCandidate"),
    executionModes: [
      ...new Set(
        byMethod("getQuotesForCandidate").flatMap((e) =>
          ((e.value as { routes?: { quote: { executionMode: string } }[] } | undefined)?.routes ?? []).map(
            (r) => `${r.quote.executionMode}`,
          ),
        ),
      ),
    ],
    normalizationStatus: candidates.map((c) => {
      const issuer = lookupIssuer(c.platformId);
      return {
        wrapper: c.tokenSymbol,
        platformId: c.platformId,
        rawRatio: c.tokenToShareRatioRaw,
        issuerSemantics: issuer?.semantics ?? "UNKNOWN_ISSUER",
        note: "ratio recorded raw; direction is NOT inferred from the field name",
      };
    }),
    simulations: wallet
      ? byMethod("simulateRoute")
      : "not attempted: no --wallet supplied (build+simulate need a `from` address)",
    walletBalances: byMethod("getWalletBalances")[0],
    decision: outcome.kind === "DECIDED" ? outcome.decision : outcome,
    apiTiming: services.observations.map((o) => ({
      endpoint: o.endpoint,
      httpStatus: o.httpStatus,
      businessCode: o.businessCode,
      latencyMs: o.latencyMs,
      retryCount: o.retryCount,
      outcome: o.outcome,
    })),
    rawObservationArtifact: observationsPath,
  };

  const bundlePath = resolve(
    REPO_ROOT,
    "internal",
    "evidence",
    "runtime",
    `route-bundle-${ticker.toLowerCase()}-${amount}-${capture.startedAt.replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(bundlePath, JSON.stringify(redactValue(bundle), null, 2), "utf8");

  printObservationTable(services.observations);
  if (outcome.kind === "DECIDED") {
    const d = outcome.decision;
    console.log(`\nDecision: ${d.outcome}  reasons=[${[...d.decisionReasons, ...d.selectionReasons].join(", ")}]`);
    for (const r of d.rejected) console.log(`  rejected ${r.wrapperSymbol} (${r.stage}): ${r.reasons.join(", ")}`);
  } else {
    console.log(`\nUnresolvable: ${outcome.reason.kind} — ${outcome.reason.message}`);
  }
  console.log(`\nEvidence bundle: ${bundlePath}`);
  console.log("Nothing was signed or broadcast.");
  process.exit(outcome.kind === "DECIDED" ? 0 : 1);
}

void main();
