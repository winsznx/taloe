#!/usr/bin/env -S npx tsx
/** Quote-lifetime probe: quote, wait, then /swap the same quoteId. No signing, no broadcast. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { redactValue } from "@taloe/shared";
import { parseArgs } from "./lib/args";
import { buildServices, REPO_ROOT } from "./lib/client";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wallet = args.wallet!; const to = args.token!; const delays = (args.delays ?? "5,20,28,32,40,60").split(",").map(Number);
  const s = buildServices(); const out: any[] = [];
  for (const d of delays) {
    const q = await s.trading.getQuotes({ binanceChainId: "56", fromTokenAddress: USDT, toTokenAddress: to, amount: "25000000000000000000", userWalletAddress: wallet });
    if (!q.ok || !q.value[0]) { out.push({ delaySec: d, quoteError: q.ok ? "no routes" : q.error.message }); continue; }
    const quote = q.value[0]; const t0 = Date.now();
    await pause(d * 1000);
    const b = await s.trading.buildSwap({ binanceChainId: "56", quoteId: quote.quoteId, fromTokenAddress: USDT, toTokenAddress: to, amount: quote.fromTokenAmount, userWalletAddress: wallet, slippagePercent: "1" });
    const row = { delaySec: d, actualDelayMs: Date.now() - t0, ok: b.ok, code: b.ok ? 0 : b.error.businessCode, msg: b.ok ? "built" : b.error.message };
    out.push(row); console.log(JSON.stringify(row));
  }
  writeFileSync(resolve(REPO_ROOT, "internal/evidence/runtime", `ttl-probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(redactValue({ token: to, out }), null, 2));
}
void main();
