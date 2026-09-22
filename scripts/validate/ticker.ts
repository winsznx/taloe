#!/usr/bin/env -S npx tsx
/**
 * Live wrapper discovery for one ticker: EVERY wrapper is its own record
 * (duplicate-underlying wrappers are never merged), with contract, platform,
 * decimals, prices, raw tokenToShareRatio (uninterpreted), statusInfo, and the
 * exact endpoints that produced each field.
 *
 * Usage: pnpm validate:ticker --ticker NVDA
 */
import { parseArgs } from "./lib/args";
import { buildServices } from "./lib/client";
import { beginCapture, printObservationTable, writeArtifact, writeObservations } from "./lib/capture";

async function main(): Promise<void> {
  const ticker = parseArgs(process.argv.slice(2)).ticker;
  if (!ticker) {
    console.error("Usage: pnpm validate:ticker --ticker NVDA");
    process.exit(1);
  }
  const capture = beginCapture(`ticker-${ticker.toLowerCase()}`);
  const services = buildServices();
  console.log(`[validate:ticker] ${capture.startedAt} — ${ticker}\n`);

  const groups = await services.rwa.searchGroups(ticker);
  const candidates = await services.rwa.getWrapperCandidates(ticker, services.chainId);

  printObservationTable(services.observations);
  writeObservations(capture, services.observations);
  if (groups.ok) writeArtifact(capture, "search-groups", groups.value);
  if (!candidates.ok) {
    console.error(`\nFAIL [${candidates.error.kind}]: ${candidates.error.message}`);
    process.exit(1);
  }
  const file = writeArtifact(capture, "wrappers", candidates.value);
  console.log(`\n${ticker}: ${candidates.value.length} wrapper(s) on chain ${services.chainId}`);
  for (const w of candidates.value) {
    console.log(
      `  ${w.tokenSymbol.padEnd(8)} [${w.platformId}] ${w.tokenContractAddress} dec=${w.decimals} ` +
        `ratio=${w.tokenToShareRatioRaw} tokenPx=${w.tokenPrice} refPx=${w.referencePrice} ` +
        `status=${w.statusInfo?.reasonCode}/${w.statusInfo?.marketStatus} open=${w.statusInfo?.openState} ` +
        `nextOpen=${w.statusInfo?.nextOpenTime} nextClose=${w.statusInfo?.nextCloseTime} conf=${w.semanticConfidence}`,
    );
  }
  console.log(`\nArtifact: ${file}`);
  process.exit(0);
}
void main();
