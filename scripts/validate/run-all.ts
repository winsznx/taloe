#!/usr/bin/env -S npx tsx
/**
 * Runs the Gate 1 seam-validation sequence (PRD 29 / BUILD_STATUS.md "Next
 * actions") in order — auth, platforms, then search for the initial
 * campaign tickers — and writes a dated `VALIDATION_REPORT.md` draft.
 *
 * This script populates the FACTUAL sections only. The APPROVE / REVISE /
 * REJECT verdict the PRD asks for is a judgment call this script cannot and
 * must not make for you — it is left as a prompt in the generated file.
 *
 * Usage: pnpm validate:all [--thin-ticker SOMETICKER]
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseArgs } from "./lib/args";
import { buildServices } from "./lib/client";
import { beginCapture, printObservationTable, writeObservations } from "./lib/capture";
import { REPO_ROOT } from "./lib/client";

const CAMPAIGN_TICKERS = ["NVDA", "TSLA", "AAPL", "QQQ"];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const thinTicker = args["thin-ticker"];
  const tickers = thinTicker ? [...CAMPAIGN_TICKERS, thinTicker] : CAMPAIGN_TICKERS;

  const capture = beginCapture("run-all");
  const services = buildServices();
  const startedAt = capture.startedAt;

  console.log(`[validate:all] ${startedAt}\n`);

  console.log("== V1: authentication ==");
  const auth = await services.trading.getSupportedChains();
  console.log(auth.ok ? "PASS" : `FAIL: ${auth.error.message}`);

  console.log("\n== V2: platforms ==");
  const platforms = await services.rwa.listPlatforms();
  console.log(platforms.ok ? `PASS — ${platforms.value.length} platform(s)` : `FAIL: ${platforms.error.message}`);

  console.log("\n== V3/V4: wrapper search per ticker ==");
  const perTicker: { ticker: string; wrapperCount: number; platforms: string[]; error: string | null }[] = [];
  for (const ticker of tickers) {
    const result = await services.rwa.getWrapperCandidates(ticker, services.chainId);
    if (result.ok) {
      const platformIds = [...new Set(result.value.map((w) => w.platformId ?? "unknown"))];
      perTicker.push({ ticker, wrapperCount: result.value.length, platforms: platformIds, error: null });
      console.log(`  ${ticker}: ${result.value.length} wrapper(s) across [${platformIds.join(", ")}]`);
    } else {
      perTicker.push({ ticker, wrapperCount: 0, platforms: [], error: result.error.message });
      console.log(`  ${ticker}: FAILED — ${result.error.message}`);
    }
  }

  printObservationTable(services.observations);
  const artifactPath = writeObservations(capture, services.observations);

  const multiWrapperTickers = perTicker.filter((t) => t.platforms.length >= 2);

  const report = `# Validation Report

**Generated:** ${startedAt}
**Command:** \`pnpm validate:all${thinTicker ? ` --thin-ticker ${thinTicker}` : ""}\`
**Raw observations:** \`${artifactPath}\`

This file is a DRAFT populated from one live run. Read it, cross-check the raw
artifacts, and fill in the verdict below — this script does not and must not
decide it for you.

## Facts observed

- Authentication: ${auth.ok ? "PASS" : `FAIL (${auth.error.kind}: ${auth.error.message})`}
- Platforms endpoint: ${platforms.ok ? `PASS, returned ${platforms.value.length} platform(s): ${platforms.value.map((p) => p.platformId).join(", ")}` : `FAIL (${platforms.error.message})`}

### Per-ticker wrapper overlap

| Ticker | Wrappers found | Platforms | Notes |
|---|---|---|---|
${perTicker
    .map(
      (t) =>
        `| ${t.ticker} | ${t.wrapperCount} | ${t.platforms.join(", ") || "—"} | ${t.error ?? ""} |`,
    )
    .join("\n")}

**Tickers with 2+ platforms (candidates for the central cross-wrapper thesis):**
${multiWrapperTickers.length > 0 ? multiWrapperTickers.map((t) => `- ${t.ticker}`).join("\n") : "- none observed this run"}

## PRD core assumptions — verdict

Fill in against \`internal/product/ASSUMPTIONS.md\`:

- A-01 (2+ comparable wrappers exist for at least one underlying): ${multiWrapperTickers.length > 0 ? "supported by this run — confirm normalization is still separately unresolved" : "NOT supported by this run — investigate before proceeding"}
- A-02 (RWA data covers all three issuer families): _fill in from the platforms list above_
- A-03 (tokenToShareRatio exists and is readable): _fill in from \`pnpm validate:ticker\` output_

## Overall verdict

**APPROVE / REVISE / REJECT:** _fill in_

**Reasoning:** _fill in_

## Next actions

1. Run \`pnpm validate:ticker --ticker <TICKER>\` for each ticker above with 2+ platforms.
2. Run \`pnpm validate:quotes --ticker <TICKER> --amounts 5,25,100\` for the same.
3. Update \`internal/product/CLAIM_LEDGER.md\`, \`internal/sponsor/SPONSOR_FINDINGS.md\`, and
   \`internal/product/BUILD_STATUS.md\` from the results.
`;

  const reportPath = resolve(REPO_ROOT, "internal", "evidence", "runtime", `VALIDATION_REPORT-${startedAt.replace(/[:.]/g, "-")}.md`);
  writeFileSync(reportPath, report, "utf8");
  console.log(`\nDraft report written: ${reportPath}`);
  console.log("Read it, verify against the raw artifacts, then fold the confirmed facts into the tracked docs.");

  process.exit(0);
}

void main();
