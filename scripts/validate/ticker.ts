#!/usr/bin/env -S npx tsx
/**
 * V3-V6 in the first-live-validation order: for one ticker, capture the
 * wrapper set, then RWA token data, underlying profile, and underlying
 * market context — and report the raw `tokenToShareRatio` values observed,
 * WITHOUT interpreting their direction. Direction is a separate, explicit
 * step (V6) that requires cross-checking documentation and issuer sources,
 * not something this script decides for you.
 *
 * Usage: pnpm validate:ticker --ticker NVDA
 */

import { buildServices } from "./lib/client";
import { beginCapture, printObservationTable, writeArtifact, writeObservations } from "./lib/capture";
import { parseArgs } from "./lib/args";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ticker = args.ticker;
  if (!ticker) {
    console.error("Usage: pnpm validate:ticker --ticker NVDA");
    process.exit(1);
  }

  const capture = beginCapture(`ticker-${ticker.toLowerCase()}`);
  const services = buildServices();

  console.log(`[validate:ticker] ${capture.startedAt} — ${ticker}\n`);

  const search = await services.rwa.search(ticker, services.chainId);
  const underlyingProfile = await services.rwa.getUnderlyingProfile(ticker);
  const underlyingMarket = await services.rwa.getUnderlyingMarket(ticker);

  printObservationTable(services.observations);
  writeObservations(capture, services.observations);

  if (search.ok) {
    writeArtifact(capture, "search", search.value);
    console.log(`\nWrapper candidates found (${search.value.length}):`);
    for (const wrapper of search.value) {
      console.log(
        `  - ${wrapper.tokenSymbol} [${wrapper.platformId ?? "unknown platform"}] ` +
          `contract=${wrapper.tokenContractAddress || "MISSING"} ` +
          `ratio=${wrapper.tokenToShareRatioRaw ?? "MISSING"} ` +
          `confidence=${wrapper.semanticConfidence}`,
      );
    }
  } else {
    console.error(`\nsearch FAILED [${search.error.kind}]: ${search.error.message}`);
  }

  if (underlyingProfile.ok) {
    writeArtifact(capture, "underlying-profile", underlyingProfile.value);
    console.log(`\nCompany: ${underlyingProfile.value.companyName}`);
  } else {
    console.error(`underlying-profile FAILED [${underlyingProfile.error.kind}]: ${underlyingProfile.error.message}`);
  }

  if (underlyingMarket.ok) {
    writeArtifact(capture, "underlying-market", underlyingMarket.value);
    console.log(
      `Market: status=${underlyingMarket.value.marketStatus ?? "unknown"} ` +
        `openState=${underlyingMarket.value.openState ?? "unknown"} ` +
        `referencePrice=${underlyingMarket.value.referencePrice ?? "unknown"}`,
    );
  } else {
    console.error(`underlying-market FAILED [${underlyingMarket.error.kind}]: ${underlyingMarket.error.message}`);
  }

  console.log(
    "\nNext (V6, do NOT skip): cross-check each ratio value above against documentation and, " +
      "where available, issuer sources, before writing a normalizer in " +
      "packages/router-core/src/normalization.ts. Do not infer direction from the field name.",
  );

  process.exit(search.ok ? 0 : 1);
}

void main();
