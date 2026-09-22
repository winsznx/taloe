#!/usr/bin/env -S npx tsx
/**
 * V2 in the first-live-validation order: RWA issuance platforms.
 *
 * Answers the cheapest, highest-value open question first (SPONSOR_FINDINGS
 * F-001): does /rwa/platforms actually enumerate xStock alongside Ondo and
 * BStock, or is the PRD's original ondo/bstock-only reading still correct?
 */

import { buildServices } from "./lib/client";
import { beginCapture, printObservationTable, writeArtifact, writeObservations } from "./lib/capture";

async function main(): Promise<void> {
  const capture = beginCapture("platforms");
  const services = buildServices();

  console.log(`[validate:platforms] ${capture.startedAt}\n`);
  const result = await services.rwa.listPlatforms();

  printObservationTable(services.observations);
  writeObservations(capture, services.observations);

  if (!result.ok) {
    console.error(`\nFAIL [${result.error.kind}]: ${result.error.message}`);
    process.exit(1);
  }

  const artifactPath = writeArtifact(capture, "response", result.value);
  console.log(`\nPlatforms returned (${result.value.length}):`);
  for (const platform of result.value) {
    console.log(`  - ${platform.platformId} tickers=${platform.tickerCount} chains=${JSON.stringify(platform.chainDistribution)}`);
  }

  const ids = result.value.map((p) => (p.platformId ?? "").toLowerCase());
  console.log(`\nxStock present: ${ids.some((id) => id.includes("xstock")) ? "YES" : "NO"}`);
  console.log(`Raw response saved: ${artifactPath}`);
  console.log(
    "\nNext: update internal/product/CLAIM_LEDGER.md C5 and " +
      "internal/sponsor/SPONSOR_FINDINGS.md F-001 with this result.",
  );
  process.exit(0);
}

void main();
