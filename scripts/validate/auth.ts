#!/usr/bin/env -S npx tsx
/**
 * V1 in the first-live-validation order (see internal/product/BUILD_STATUS.md
 * "Next actions"): authentication sanity check.
 *
 * Makes the lightest possible authenticated call — supported chains — and
 * reports whether signing actually works against the live gateway. This is
 * the ONLY thing that can move A5 in CLAIM_LEDGER.md from BLOCKED_CREDENTIALS
 * to a real status.
 */

import { buildServices } from "./lib/client";
import { beginCapture, printObservationTable, writeObservations } from "./lib/capture";

async function main(): Promise<void> {
  const capture = beginCapture("auth");
  const services = buildServices();

  console.log(`[validate:auth] ${capture.startedAt}`);
  console.log(`[validate:auth] requesting supported chains as an authentication smoke test...\n`);

  const result = await services.trading.getSupportedChains();

  printObservationTable(services.observations);
  const artifactPath = writeObservations(capture, services.observations);
  console.log(`\nRaw observations: ${artifactPath}`);

  if (result.ok) {
    console.log("\nPASS: signing accepted by the gateway. CLAIM_LEDGER.md A5 -> API_VERIFIED.");
    console.log(`Chains returned: ${result.value.length}`);
    process.exit(0);
  }

  console.error(`\nFAIL [${result.error.kind}]: ${result.error.message}`);
  if (result.error.kind === "AUTH") {
    console.error(
      "This is almost certainly a signing bug, not a credentials problem — see " +
        "internal/sponsor/SPONSOR_FINDINGS.md and check the /build prefix rule first.",
    );
  }
  process.exit(1);
}

void main();
