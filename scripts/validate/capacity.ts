#!/usr/bin/env -S npx tsx
/**
 * Capacity campaign (evidence tooling, read-only): an adaptive size sweep per
 * wrapper for every underlying that has BOTH an Ondo and a bStock wrapper.
 *
 * Every deviation is recomputed by Taloe's own gate function from the quoted
 * amounts and the reference. The sponsor `priceImpactPercent` is stored as
 * metadata only. Nothing is signed, approved or broadcast.
 *
 * Usage: pnpm validate:capacity --session afterhours [--tickers NVDA,TSLA] [--wallet 0x...]
 * `--session` is a label for the session-campaign (regular | weekend | afterhours).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_POLICY,
  LiveDiscoveryProvider,
  computeReferenceDeviation,
  normalizeWrapperAmountToUnderlying,
} from "@taloe/router-core";
import type { ExecutableRoute, MarketContext, WrapperCandidate } from "@taloe/shared";
import { fromBaseUnits, redactValue, toDecimalString } from "@taloe/shared";

import { parseArgs } from "./lib/args";
import { buildServices, REPO_ROOT } from "./lib/client";

const PUBLIC_WALLET = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";
const ANCHORS = [5.1, 25, 100, 250, 500, 1000, 2000, 5000, 10000];
/** Only probed when 10000 did not breach the loosest threshold. */
const EXTENSION_ANCHORS = [25000];
const STOP_BPS = 150;
const PAUSE_MS = 250;
const RT = resolve(REPO_ROOT, "internal/evidence/runtime");

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latest = (prefix: string) => readdirSync(RT).filter((f) => f.startsWith(prefix)).sort().at(-1)!;
const universe = (prefix: string): string[] =>
  (JSON.parse(readFileSync(resolve(RT, latest(prefix)), "utf8")).body.data as { underlyingTicker: string }[]).map(
    (x) => x.underlyingTicker,
  );

interface Observation {
  ticketUsd: number;
  quoted: boolean;
  error: { code: number | null; message: string } | null;
  latencyMs: number;
  executionMode: string | null;
  vendor: string | null;
  sharesOut: string | null;
  perShareUsdt: number | null;
  deviationBps: number | null;
  sponsorPriceImpactPercent: string | null;
  estimatedGas: string | null;
  tradeFeeUsd: string | null;
  quotedAt: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const session = args.session ?? "unlabelled";
  const wallet = args.wallet ?? PUBLIC_WALLET;
  const both = universe("raw-universe-ondo").filter((t) => universe("raw-universe-bstock").includes(t)).sort();
  const tickers = args.tickers ? args.tickers.split(",").map((t) => t.trim().toUpperCase()) : both;

  const services = buildServices();
  const port = new LiveDiscoveryProvider(services);
  const spend = await port.resolveSpendAsset(services.chainId);
  if (!spend.ok) throw new Error(spend.error.message);
  const decimals = spend.value.decimals;
  const toBase = (usd: number) => (BigInt(Math.round(usd * 100)) * 10n ** BigInt(decimals - 2)).toString();

  const startedAt = new Date();
  const rows: unknown[] = [];

  for (const ticker of tickers) {
    const candidatesResult = await port.discoverCandidates(ticker, services.chainId);
    const contextResult = await port.getMarketContext(ticker);
    if (!candidatesResult.ok) {
      console.log(ticker.padEnd(6), "discovery failed", candidatesResult.error.message);
      rows.push({ ticker, error: candidatesResult.error.message });
      continue;
    }
    const marketContext: MarketContext | null = contextResult.ok ? contextResult.value : null;
    const wrappers = candidatesResult.value.filter((c) => c.platformId === "ondo" || c.platformId === "bstock");

    const perWrapper: unknown[] = [];
    for (const wrapper of wrappers) {
      const observations: Observation[] = [];
      const probe = async (ticketUsd: number): Promise<Observation> => {
        const t0 = Date.now();
        const result = await port.getQuotesForCandidate(wrapper, {
          chainId: services.chainId,
          spendTokenAddress: spend.value.contractAddress,
          spendAmountBaseUnits: toBase(ticketUsd),
          walletAddress: wallet,
          now: new Date(),
        });
        await pause(PAUSE_MS);
        return observe(ticketUsd, wrapper, marketContext, decimals, result, Date.now() - t0);
      };

      let breached = false;
      for (const anchor of ANCHORS) {
        const o = await probe(anchor);
        observations.push(o);
        if (!o.quoted || Math.abs(o.deviationBps ?? 0) > STOP_BPS) { breached = true; break; }
      }
      if (!breached) {
        for (const anchor of EXTENSION_ANCHORS) {
          const o = await probe(anchor);
          observations.push(o);
          if (!o.quoted || Math.abs(o.deviationBps ?? 0) > STOP_BPS) break;
        }
      }
      perWrapper.push({
        platformId: wrapper.platformId,
        symbol: wrapper.tokenSymbol,
        address: wrapper.tokenContractAddress,
        ratio: wrapper.tokenToShareRatioRaw,
        referencePrice: marketContext?.referencePrice ?? wrapper.referencePrice,
        observations,
      });
      const last = observations.at(-1);
      console.log(
        `${ticker.padEnd(6)} ${wrapper.tokenSymbol.padEnd(10)} points=${observations.length} last=$${last?.ticketUsd} dev=${last?.deviationBps}`,
      );
    }
    rows.push({
      ticker,
      marketStatus: marketContext?.rawMarketStatus ?? null,
      referenceSource: marketContext?.provenance ?? [],
      wrappers: perWrapper,
    });
  }

  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const out = resolve(RT, `capacity-${session}-${stamp}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      redactValue({
        session,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        wallet: "public address (no key)",
        anchors: ANCHORS,
        signedOrBroadcast: false,
        note: "ticket = USDT spent (USDT ~ $0.9998). deviation = Taloe recomputed per-share price vs reference.",
        rows,
      }),
      null,
      2,
    ),
  );
  console.log("artifact:", out);
  process.exit(0);
}

function observe(
  ticketUsd: number,
  wrapper: WrapperCandidate,
  marketContext: MarketContext | null,
  spendDecimals: number,
  result: Awaited<ReturnType<LiveDiscoveryProvider["getQuotesForCandidate"]>>,
  latencyMs: number,
): Observation {
  const base = { ticketUsd, latencyMs, quotedAt: new Date().toISOString() };
  if (!result.ok || result.value.routes.length === 0) {
    const cause = result.ok ? null : (result.error.cause as { businessCode?: number | null } | undefined);
    return {
      ...base,
      quoted: false,
      error: {
        code: cause?.businessCode ?? null,
        message: result.ok ? (result.value.preRejected?.reasons.join(",") ?? "no routes") : result.error.message,
      },
      executionMode: null, vendor: null, sharesOut: null, perShareUsdt: null, deviationBps: null, sponsorPriceImpactPercent: null, estimatedGas: null, tradeFeeUsd: null,
    };
  }
  // Taloe does not trust the vendor's own "best" flag, so take the route with the most output.
  const route: ExecutableRoute = [...result.value.routes].sort((a, b) => (BigInt(b.quote.toTokenAmount) > BigInt(a.quote.toTokenAmount) ? 1 : -1))[0]!;
  const norm = normalizeWrapperAmountToUnderlying({
    wrapper,
    tokenAmountDecimal: toDecimalString(fromBaseUnits(route.quote.toTokenAmount, wrapper.decimals), 8),
  });
  const shares = norm.underlyingEquivalent;
  const spent = Number(toDecimalString(fromBaseUnits(route.quote.fromTokenAmount, spendDecimals), 8));
  const deviationBps = computeReferenceDeviation({
    route,
    policy: DEFAULT_POLICY,
    marketContext,
    maxDeviationBps: STOP_BPS,
    spendAmountBaseUnits: route.quote.fromTokenAmount,
    spendTokenDecimals: spendDecimals,
    walletSpendBalanceBaseUnits: null,
    walletGasBalanceWei: null,
    simulationStatus: "NOT_RUN",
    simulationAttempted: false,
    supportedExecutionModes: ["SWAP", "RFQ"],
    now: new Date(),
  });
  return {
    ...base,
    quoted: true,
    error: null,
    executionMode: route.quote.executionMode,
    vendor: route.quote.vendorName,
    sharesOut: shares,
    perShareUsdt: shares !== null && Number(shares) > 0 ? spent / Number(shares) : null,
    deviationBps,
    sponsorPriceImpactPercent: route.quote.priceImpactPercent,
    estimatedGas: route.quote.estimatedGas,
    tradeFeeUsd: route.quote.tradeFeeUsd,
  };
}

void main();
