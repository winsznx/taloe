#!/usr/bin/env -S npx tsx
/**
 * Wide quote sweep across every underlying that has BOTH an Ondo and a bStock
 * wrapper on BSC (taken from saved raw universe artifacts). Records
 * executionMode/vendor/business codes and the per-share exposure gap.
 * Usage: pnpm tsx scripts/validate/sweep.ts --wallet 0x... [--amount 25]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { redactValue } from "@taloe/shared";
import { parseArgs } from "./lib/args";
import { buildServices, REPO_ROOT } from "./lib/client";

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const RT = resolve(REPO_ROOT, "internal/evidence/runtime");
const latest = (p: string) => readdirSync(RT).filter((f) => f.startsWith(p)).sort().at(-1)!;
const load = (p: string) => JSON.parse(readFileSync(resolve(RT, latest(p)), "utf8")).body.data as any[];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wallet = args.wallet!; const amount = args.amount ?? "25";
  const base = String(BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 12n);
  const ondo = new Map(load("raw-universe-ondo").map((x) => [x.underlyingTicker, x]));
  const bs = new Map(load("raw-universe-bstock").map((x) => [x.underlyingTicker, x]));
  const tickers = [...ondo.keys()].filter((t) => bs.has(t)).sort();
  const s = buildServices();
  const rows: any[] = [];
  for (const t of tickers) {
    const row: any = { ticker: t, wrappers: {} };
    for (const [platform, tok] of [["ondo", ondo.get(t)], ["bstock", bs.get(t)]] as const) {
      const q = await s.trading.getQuotes({ binanceChainId: "56", fromTokenAddress: USDT, toTokenAddress: tok.tokenContractAddress, amount: base, userWalletAddress: wallet });
      await pause(350);
      row.wrappers[platform] = q.ok
        ? q.value.map((r) => ({ mode: r.executionMode, vendor: r.vendorName, sharesOut: (Number(r.toTokenAmount) / 1e18) * Number(tok.tokenToShareRatio), impact: r.priceImpactPercent, quoteId: r.quoteId }))
        : { error: q.error.message, code: q.error.businessCode };
      row.wrappers[platform + "_status"] = tok.statusInfo?.reasonCode;
    }
    rows.push(row);
    console.log(t.padEnd(6), JSON.stringify(row.wrappers).slice(0, 230));
  }
  const f = resolve(RT, `sweep-${amount}usdt-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(f, JSON.stringify(redactValue({ amount, wallet: "public address", rows }), null, 2));
  console.log("artifact:", f);
}
void main();
