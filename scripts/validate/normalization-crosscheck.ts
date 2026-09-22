import { writeFileSync } from "node:fs";
import { buildServices } from "./lib/client";
const W = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const s = buildServices();
  const out: unknown[] = [];
  for (const t of ["CRWD", "KLAC", "META", "QCOM", "NVDA", "TSLA"]) {
    const cands = await s.rwa.getWrapperCandidates(t, "56");
    if (!cands.ok) { console.log(t, "ERR", cands.error.message); continue; }
    for (const c of cands.value) {
      const q = await s.trading.getQuotes({ binanceChainId: "56", fromTokenAddress: USDT, toTokenAddress: c.tokenContractAddress, amount: "25000000000000000000", userWalletAddress: W });
      await pause(300);
      if (!q.ok) { console.log(`${c.tokenSymbol} quote ERR ${q.error.businessCode} ${q.error.message}`); out.push({ t, sym: c.tokenSymbol, err: q.error.message }); continue; }
      for (const r of q.value) {
        const tokens = Number(r.toTokenAmount) / 1e18;
        const execPerToken = 25 * 0.9998 / tokens; // USDT ~ $0.9998 observed in quote fromToken.tokenUnitPrice
        const ratio = Number(c.tokenToShareRatioRaw), ref = Number(c.referencePrice), tp = Number(c.tokenPrice);
        const row = { ticker: t, sym: c.tokenSymbol, platform: c.platformId, mode: r.executionMode, vendor: r.vendorName, ratio, tokenPrice: tp, refPrice: ref, execPerToken, execVsTokenPrice_bps: Math.round((execPerToken / tp - 1) * 1e4), execPerShare_ifSharesPerToken: execPerToken / ratio, execPerShareVsRef_bps: Math.round((execPerToken / ratio / ref - 1) * 1e4), execPerShare_ifTokensPerShare: execPerToken * ratio, execAsTokenVsRef_bps: Math.round((execPerToken / ref - 1) * 1e4) };
        out.push(row); console.log(JSON.stringify(row));
      }
    }
  }
  writeFileSync("internal/evidence/runtime/normalization-crosscheck-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json", JSON.stringify(out, null, 2));
}
void main();
