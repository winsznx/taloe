#!/usr/bin/env -S npx tsx
/** Quote-only size probe (no funds move): does mode/impact/gap change with size? */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { redactValue } from "@taloe/shared";
import { parseArgs } from "./lib/args";
import { buildServices, REPO_ROOT } from "./lib/client";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const args = parseArgs(process.argv.slice(2)); const wallet = args.wallet!;
  const sizes = (args.sizes ?? "500,2000,10000").split(",");
  const s = buildServices(); const out: any[] = [];
  for (const t of (args.tickers ?? "NVDA,AAOI").split(",")) {
    const c = await s.rwa.getWrapperCandidates(t, "56"); if (!c.ok) continue;
    for (const size of sizes) for (const w of c.value) {
      const q = await s.trading.getQuotes({ binanceChainId: "56", fromTokenAddress: USDT, toTokenAddress: w.tokenContractAddress, amount: String(BigInt(size) * 10n ** 18n), userWalletAddress: wallet });
      await pause(350);
      const row = q.ok ? { t, size, w: w.tokenSymbol, routes: q.value.map((r) => ({ mode: r.executionMode, vendor: r.vendorName, shares: (Number(r.toTokenAmount) / 1e18) * Number(w.tokenToShareRatioRaw), impact: r.priceImpactPercent })) } : { t, size, w: w.tokenSymbol, error: q.error.message, code: q.error.businessCode };
      out.push(row); console.log(JSON.stringify(row).slice(0, 260));
    }
  }
  writeFileSync(resolve(REPO_ROOT, "internal/evidence/runtime", `size-probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(redactValue(out), null, 2));
}
void main();
