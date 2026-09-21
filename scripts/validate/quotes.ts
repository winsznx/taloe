#!/usr/bin/env -S npx tsx
/**
 * V7-V8 in the first-live-validation order: executable quotes at multiple
 * sizes, recording the runtime `executionMode`, quote id, and observed
 * behaviour per candidate. This is the call that actually tells us whether
 * the documented per-issuer execution-mode defaults (SPONSOR_FINDINGS F-001,
 * D5 in CLAIM_LEDGER.md) hold at runtime.
 *
 * Usage: pnpm validate:quotes --ticker NVDA --amounts 5,25,100
 */

import { toBaseUnitAmount } from "@taloe/shared";

import { parseArgs } from "./lib/args";
import { buildServices } from "./lib/client";
import { beginCapture, printObservationTable, writeArtifact, writeObservations } from "./lib/capture";

const USDT_BSC_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ticker = args.ticker;
  const amounts = (args.amounts ?? "5,25,100").split(",").map((a) => a.trim());
  if (!ticker) {
    console.error("Usage: pnpm validate:quotes --ticker NVDA --amounts 5,25,100");
    process.exit(1);
  }

  const capture = beginCapture(`quotes-${ticker.toLowerCase()}`);
  const services = buildServices();

  console.log(`[validate:quotes] ${capture.startedAt} — ${ticker} at ${amounts.join(", ")} USDT\n`);

  // Decimals resolved live, never assumed (V1 review correction 2).
  const usdtInfo = await services.token.getBasicInfo(services.chainId, USDT_BSC_ADDRESS);
  if (!usdtInfo.ok || usdtInfo.value.decimals === null) {
    console.error(
      `FAIL: could not resolve USDT decimals live (${usdtInfo.ok ? "no decimals field" : usdtInfo.error.message}). ` +
        "Refusing to assume 18 — fix token/basic-info first.",
    );
    process.exit(1);
  }
  const usdtDecimals = usdtInfo.value.decimals;

  const search = await services.rwa.search(ticker, services.chainId);
  if (!search.ok) {
    console.error(`FAIL: search failed [${search.error.kind}]: ${search.error.message}`);
    process.exit(1);
  }

  const results: unknown[] = [];
  for (const wrapper of search.value) {
    if (!wrapper.tokenContractAddress) continue;
    for (const amount of amounts) {
      let baseUnits: string;
      try {
        baseUnits = toBaseUnitAmount({ decimalString: amount }, {
          symbol: "USDT",
          contractAddress: USDT_BSC_ADDRESS,
          decimals: usdtDecimals,
          chainId: services.chainId,
          provenance: "live:token/basic-info",
        });
      } catch (error) {
        console.error(`skip: bad amount "${amount}": ${error instanceof Error ? error.message : error}`);
        continue;
      }

      const quoteResult = await services.trading.getQuotes({
        binanceChainId: services.chainId,
        fromTokenAddress: USDT_BSC_ADDRESS,
        toTokenAddress: wrapper.tokenContractAddress,
        amount: baseUnits,
        userWalletAddress: null,
      });

      if (!quoteResult.ok) {
        console.log(
          `  ${wrapper.tokenSymbol} @ ${amount} USDT -> FAILED [${quoteResult.error.kind}] ${quoteResult.error.message}`,
        );
        results.push({ wrapper: wrapper.tokenSymbol, amount, ok: false, error: quoteResult.error.toRecord() });
        continue;
      }

      for (const quote of quoteResult.value) {
        console.log(
          `  ${wrapper.tokenSymbol} @ ${amount} USDT -> mode=${quote.executionMode} ` +
            `vendor=${quote.vendorName} quoteId=${quote.quoteId} out=${quote.toTokenAmount} ` +
            `impact=${quote.priceImpactPercent ?? "n/a"}`,
        );
        results.push({ wrapper: wrapper.tokenSymbol, amount, ok: true, quote });
      }
    }
  }

  printObservationTable(services.observations);
  writeObservations(capture, services.observations);
  const artifactPath = writeArtifact(capture, "results", results);
  console.log(`\nRaw results saved: ${artifactPath}`);
  console.log(
    "\nNext: compare executionMode per issuer against the documented defaults in " +
      "internal/sponsor/SPONSOR_FINDINGS.md F-001, and record any divergence there — classified, " +
      "not yet called a bug.",
  );

  process.exit(0);
}

void main();
