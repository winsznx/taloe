#!/usr/bin/env -S npx tsx
/**
 * Analysis of a capacity campaign artifact. Pure post-processing: reads the
 * saved observations and derives capacity brackets, baselines and the split
 * experiment. It makes no network calls.
 *
 * Usage: pnpm validate:capacity-report [--file capacity-afterhours-....json]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CAPACITY_THRESHOLDS_BPS, compareCapacity, deriveSafeCapacity } from "@taloe/router-core";
import type { CapacityObservation, SafeExecutionCapacity } from "@taloe/router-core";

import { parseArgs } from "./lib/args";
import { REPO_ROOT } from "./lib/client";

const RT = resolve(REPO_ROOT, "internal/evidence/runtime");
/** "No material difference" tolerance for the small-size question, in bps of per-share price. */
const EQUIVALENCE_BPS = 25;
const SMALL_TICKET_MAX_USD = 100;

interface Obs extends CapacityObservation {
  perShareUsdt: number | null;
  vendor: string | null;
  executionMode: string | null;
  error: { code: number | null; message: string } | null;
  latencyMs: number;
  sponsorPriceImpactPercent: string | null;
  estimatedGas?: string | null;
}
interface WrapperRow { platformId: string; symbol: string; observations: Obs[] }
interface TickerRow { ticker: string; wrappers: WrapperRow[]; error?: string }

const median = (xs: number[]) => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!);
const pct = (xs: number[], p: number) => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!);

function capacities(w: WrapperRow): Record<number, SafeExecutionCapacity> {
  return Object.fromEntries(CAPACITY_THRESHOLDS_BPS.map((t) => [t, deriveSafeCapacity(w.observations, t)]));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const file = args.file ?? readdirSync(RT).filter((f) => f.startsWith("capacity-afterhours-")).sort().at(-1)!;
  const artifact = JSON.parse(readFileSync(resolve(RT, file), "utf8")) as { rows: TickerRow[]; session: string; startedAt: string };
  const rows = artifact.rows.filter((r) => r.wrappers?.length === 2);
  const out: Record<string, unknown> = { source: file, session: artifact.session, startedAt: artifact.startedAt, underlyingsTested: rows.length };

  // ---- per-underlying capacity and baselines --------------------------------
  const perUnderlying = rows.map((row) => {
    const [first, second] = row.wrappers;
    if (!first || !second) throw new Error(`${row.ticker}: expected two wrappers`);
    const pair: [WrapperRow, WrapperRow] = [first, second];
    const caps = { [first.platformId]: capacities(first), [second.platformId]: capacities(second) };
    const byThreshold = CAPACITY_THRESHOLDS_BPS.map((t) => {
      const a = caps[first.platformId]![t]!;
      const b = caps[second.platformId]![t]!;
      const cmp = compareCapacity(a, b);
      const taloe = cmp === "A_LARGER" ? first.platformId : cmp === "B_LARGER" ? second.platformId : null;
      return { thresholdBps: t, cmp, firstResult: first.platformId, taloeWrapper: taloe, switched: taloe !== null && taloe !== first.platformId, a, b };
    });
    return { ticker: row.ticker, first: first.platformId, wrappers: pair, caps, byThreshold };
  });

  const perThreshold = CAPACITY_THRESHOLDS_BPS.map((t) => {
    const cells = perUnderlying.map((u) => u.byThreshold.find((x) => x.thresholdBps === t)!);
    const count = (f: (c: (typeof cells)[number]) => boolean) => cells.filter(f).length;
    const lowerBounds = (id: "ondo" | "bstock") => perUnderlying.map((u) => u.caps[id]![t]!.safeUpToUsd ?? 0);
    return {
      thresholdBps: t,
      differ: count((c) => c.cmp === "A_LARGER" || c.cmp === "B_LARGER"),
      noDifference: count((c) => c.cmp === "NO_DIFFERENCE"),
      incomparable: count((c) => c.cmp === "INCOMPARABLE"),
      taloeSwitchesFromFirstResult: count((c) => c.switched),
      firstResultIsWorse: count((c) => c.taloeWrapper !== null && c.taloeWrapper !== c.firstResult),
      safeUpToUsd: { ondo: { median: median(lowerBounds("ondo")), p10: pct(lowerBounds("ondo"), 0.1) }, bstock: { median: median(lowerBounds("bstock")), p10: pct(lowerBounds("bstock"), 0.1) } },
      cappedAtMaxTested: perUnderlying.filter((u) => u.caps.ondo![t]!.status === "AT_LEAST_MAX_TESTED" && u.caps.bstock![t]!.status === "AT_LEAST_MAX_TESTED").length,
    };
  });
  out.perThreshold = perThreshold;

  // Histogram of proven-safe capacity per wrapper at each threshold.
  const BUCKETS = [0, 100, 250, 500, 1000, 2000, 5000, 10000, 25000];
  out.capacityDistribution = CAPACITY_THRESHOLDS_BPS.map((t) => {
    const hist = (id: "ondo" | "bstock") => {
      const h: Record<string, number> = {};
      for (const u of perUnderlying) {
        const c = u.caps[id]![t]!;
        const key = c.status === "UNKNOWN" ? "unknown" : c.safeUpToUsd === null ? "<5.1 (breach at smallest)" : `>=${BUCKETS.filter((b) => b <= c.safeUpToUsd!).at(-1) ?? 5.1}${c.status === "AT_LEAST_MAX_TESTED" ? " (unbounded)" : ""}`;
        h[key] = (h[key] ?? 0) + 1;
      }
      return h;
    };
    return { thresholdBps: t, ondo: hist("ondo"), bstock: hist("bstock") };
  });

  // ---- breach frequency on the ticket grid ---------------------------------
  // A ticket counts as a breach for a wrapper when it is at or beyond that wrapper's first observed
  // breach (the scan stops there, so larger tickets are not separately measured).
  const anchors = (JSON.parse(readFileSync(resolve(RT, file), "utf8")) as { anchors: number[] }).anchors.concat([25000]);
  out.breachFrequency = CAPACITY_THRESHOLDS_BPS.map((t) => {
    let cells = 0, firstBreaches = 0, firstBreachesAvoidable = 0, bothBreach = 0, nonFirstBreaches = 0;
    for (const u of perUnderlying) {
      const [first, other] = u.wrappers;
      const capFirst = u.caps[first.platformId]![t]!;
      const capOther = u.caps[other.platformId]![t]!;
      if (capFirst.status === "UNKNOWN" || capOther.status === "UNKNOWN") continue;
      for (const ticket of anchors) {
        cells += 1;
        const breaches = (c: SafeExecutionCapacity) => c.breachedAtUsd !== null && ticket >= c.breachedAtUsd;
        const fb = breaches(capFirst), ob = breaches(capOther);
        if (fb) firstBreaches += 1;
        if (ob) nonFirstBreaches += 1;
        if (fb && ob) bothBreach += 1;
        if (fb && !ob) firstBreachesAvoidable += 1;
      }
    }
    return { thresholdBps: t, cells, firstResultBreaches: firstBreaches, breachAvoidedByTaloe: firstBreachesAvoidable, bothBreach, otherWrapperBreaches: nonFirstBreaches };
  });

  // ---- small-size no-difference --------------------------------------------
  const smallGaps: number[] = [];
  let smallCells = 0, smallEquivalent = 0;
  for (const u of perUnderlying) {
    const [a, b] = u.wrappers;
    for (const oa of a.observations) {
      if (oa.ticketUsd > SMALL_TICKET_MAX_USD) continue;
      const ob = b.observations.find((o) => o.ticketUsd === oa.ticketUsd);
      if (!ob || oa.perShareUsdt === null || ob.perShareUsdt === null) continue;
      const gap = (Math.abs(oa.perShareUsdt - ob.perShareUsdt) / Math.min(oa.perShareUsdt, ob.perShareUsdt)) * 10_000;
      smallGaps.push(gap);
      smallCells += 1;
      if (gap <= EQUIVALENCE_BPS) smallEquivalent += 1;
    }
  }
  out.smallSize = { maxTicketUsd: SMALL_TICKET_MAX_USD, equivalenceBps: EQUIVALENCE_BPS, cells: smallCells, materiallyEquivalent: smallEquivalent, rate: smallCells ? smallEquivalent / smallCells : null, gapBps: { median: median(smallGaps), p90: pct(smallGaps, 0.9), max: Math.max(0, ...smallGaps) } };

  // ---- largest divergences at the same ticket -------------------------------
  const divergences: { ticker: string; ticketUsd: number; gapBps: number; cheaper: string }[] = [];
  for (const u of perUnderlying) {
    const [a, b] = u.wrappers;
    for (const oa of a.observations) {
      const ob = b.observations.find((o) => o.ticketUsd === oa.ticketUsd);
      if (!ob || oa.perShareUsdt === null || ob.perShareUsdt === null) continue;
      const gapBps = ((Math.max(oa.perShareUsdt, ob.perShareUsdt) - Math.min(oa.perShareUsdt, ob.perShareUsdt)) / Math.min(oa.perShareUsdt, ob.perShareUsdt)) * 10_000;
      divergences.push({ ticker: u.ticker, ticketUsd: oa.ticketUsd, gapBps: Math.round(gapBps), cheaper: oa.perShareUsdt < ob.perShareUsdt ? a.platformId : b.platformId });
    }
  }
  out.largestDivergences = divergences.sort((x, y) => y.gapBps - x.gapBps).slice(0, 12);

  // ---- advantage windows -----------------------------------------------------
  out.capacityAdvantage = CAPACITY_THRESHOLDS_BPS.map((t) => {
    const windows = perUnderlying.flatMap((u) => {
      const c = u.byThreshold.find((x) => x.thresholdBps === t)!;
      if (c.cmp !== "A_LARGER" && c.cmp !== "B_LARGER") return [];
      const better = c.cmp === "A_LARGER" ? c.a : c.b;
      const worse = c.cmp === "A_LARGER" ? c.b : c.a;
      return [{ ticker: u.ticker, betterSafeUpTo: better.safeUpToUsd, worseBreachedAt: worse.breachedAtUsd, factorLowerBound: worse.breachedAtUsd ? (better.safeUpToUsd ?? 0) / worse.breachedAtUsd : null }];
    });
    return { thresholdBps: t, underlyings: windows.length, medianFactorLowerBound: median(windows.map((w) => w.factorLowerBound ?? 0)), windows };
  });

  // ---- unsupported / incomparable -------------------------------------------
  out.incomparable = perUnderlying.filter((u) => u.wrappers.some((w) => deriveSafeCapacity(w.observations, 150).status === "UNKNOWN")).map((u) => ({
    ticker: u.ticker,
    wrappers: u.wrappers.map((w) => ({ symbol: w.symbol, status: deriveSafeCapacity(w.observations, 150).status, endedBy: deriveSafeCapacity(w.observations, 150).endedBy, firstError: w.observations.find((o) => o.error)?.error ?? null })),
  }));
  out.refusedAtSmallestTicket = perUnderlying.filter((u) => u.wrappers.every((w) => deriveSafeCapacity(w.observations, 50).status === "BELOW_SMALLEST_TESTED")).map((u) => u.ticker);

  // ---- split-route experiment ------------------------------------------------
  // Lower bound for a two-leg split: each leg is itself proven inside the constraint, so the
  // combined proven-safe ticket is safeA + safeB. It is compared against the best single wrapper.
  const splitRows = CAPACITY_THRESHOLDS_BPS.map((t) => {
    const detail = perUnderlying.flatMap((u) => {
      const a = u.caps[u.wrappers[0].platformId]![t]!;
      const b = u.caps[u.wrappers[1].platformId]![t]!;
      if (a.status === "UNKNOWN" || b.status === "UNKNOWN") return [];
      const safeA = a.safeUpToUsd ?? 0, safeB = b.safeUpToUsd ?? 0;
      const bestSingle = Math.max(safeA, safeB);
      const bestSingleCapped = [a, b].some((c) => c.status === "AT_LEAST_MAX_TESTED" && (c.safeUpToUsd ?? 0) === bestSingle);
      // A best single wrapper that never breached has no capacity limit to relieve.
      const binds = !bestSingleCapped;
      return [{ ticker: u.ticker, safeA, safeB, bestSingle, split: safeA + safeB, gain: bestSingle > 0 ? (safeA + safeB) / bestSingle : null, binds }];
    });
    const binding = detail.filter((d) => d.binds && d.bestSingle > 0);
    const material = binding.filter((d) => (d.gain ?? 0) >= 1.5);
    return { thresholdBps: t, evaluated: detail.length, bindingUnderlyings: binding.length, materialGain: material.length, medianGain: median(binding.map((d) => d.gain ?? 1)), maxGain: Math.max(0, ...binding.map((d) => d.gain ?? 0)) };
  });
  const s150 = splitRows.find((r) => r.thresholdBps === 150)!;
  const share = s150.bindingUnderlyings ? s150.materialGain / s150.bindingUnderlyings : 0;
  out.splitExperiment = {
    rows: splitRows,
    rule: "LOAD_BEARING if >=5 binding underlyings and >=50% show proven split gain >=1.5x; NOT_USEFUL if <10% show it; else MARGINAL",
    verdictAt150bps: s150.bindingUnderlyings >= 5 && share >= 0.5 ? "LOAD_BEARING" : share < 0.1 ? "NOT_USEFUL" : "MARGINAL",
    shareMaterialAt150: share,
  };

  // ---- execution mode / vendor / latency -------------------------------------
  const all = perUnderlying.flatMap((u) => u.wrappers.flatMap((w) => w.observations));
  const tally = (key: "vendor" | "executionMode") => all.filter((o) => o.error === null).reduce<Record<string, number>>((m, o) => { const k = String(o[key]); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  out.quoteStats = { quotes: all.length, failures: all.filter((o) => o.error).length, vendors: tally("vendor"), executionModes: tally("executionMode"), latencyMs: { p50: median(all.map((o) => o.latencyMs)), p95: pct(all.map((o) => o.latencyMs), 0.95) }, errorCodes: all.filter((o) => o.error).reduce<Record<string, number>>((m, o) => { const k = String(o.error!.code); m[k] = (m[k] ?? 0) + 1; return m; }, {}) };
  out.sponsorPriceImpactVsRecomputed = all
    .filter((o) => o.sponsorPriceImpactPercent !== null && o.deviationBps !== null && Math.abs(o.deviationBps) > 150)
    .slice(0, 8)
    .map((o) => ({ ticketUsd: o.ticketUsd, sponsorPriceImpactPercent: o.sponsorPriceImpactPercent, recomputedDeviationBps: o.deviationBps }));

  out.perUnderlying = perUnderlying.map((u) => ({ ticker: u.ticker, first: u.first, caps: u.caps }));
  const target = resolve(RT, `capacity-report-${artifact.session}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(target, JSON.stringify(out, null, 2));
  const { perUnderlying: _omit, ...summary } = out;
  void _omit;
  console.log(JSON.stringify(summary, null, 1));
  console.log("artifact:", target);
}
main();
