#!/usr/bin/env -S npx tsx
/**
 * V9: transaction simulation, against the canonical contract
 * (POST /api/v1/dex/pre-transaction/simulate with { binanceChainId, evmTx }).
 *
 * Flow: quote a wrapper -> pick a SWAP-mode route -> /swap to obtain the
 * unsigned EVM tx -> simulate exactly that tx. No key is used or required
 * (simulation reads state, it does not sign) and nothing is broadcast.
 *
 * Usage: pnpm validate:simulation --ticker NVDA --wallet 0xYourAddress [--amount 5]
 */

import { toBaseUnitAmount } from "@taloe/shared";

import { parseArgs } from "./lib/args";
import { buildServices } from "./lib/client";
import { beginCapture, printObservationTable, writeArtifact, writeObservations } from "./lib/capture";

const USDT_BSC_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { ticker, wallet } = args;
  const amount = args.amount ?? "5";
  if (!ticker || !wallet) {
    console.error("Usage: pnpm validate:simulation --ticker NVDA --wallet 0xYourAddress [--amount 5]");
    process.exit(1);
  }

  const capture = beginCapture(`simulation-${ticker.toLowerCase()}`);
  const services = buildServices();
  console.log(`[validate:simulation] ${capture.startedAt} — ${ticker} @ ${amount} USDT\n`);

  const usdt = await services.token.getBasicInfo(services.chainId, USDT_BSC_ADDRESS);
  if (!usdt.ok || usdt.value.decimals === null) {
    console.error("FAIL: could not resolve USDT decimals live; refusing to assume 18.");
    process.exit(1);
  }
  const baseUnits = toBaseUnitAmount(
    { decimalString: amount },
    { symbol: "USDT", contractAddress: USDT_BSC_ADDRESS, decimals: usdt.value.decimals, chainId: services.chainId, provenance: "live:token/basic-info" },
  );

  const search = await services.rwa.search(ticker, services.chainId);
  if (!search.ok) {
    console.error(`FAIL: search failed: ${search.error.message}`);
    process.exit(1);
  }

  let simulated = 0;
  for (const wrapper of search.value) {
    if (!wrapper.tokenContractAddress) continue;
    const quotes = await services.trading.getQuotes({
      binanceChainId: services.chainId,
      fromTokenAddress: USDT_BSC_ADDRESS,
      toTokenAddress: wrapper.tokenContractAddress,
      amount: baseUnits,
      userWalletAddress: wallet,
    });
    if (!quotes.ok) {
      console.log(`  ${wrapper.tokenSymbol}: quote FAILED [${quotes.error.kind}] ${quotes.error.message}`);
      continue;
    }
    for (const quote of quotes.value.filter((q) => q.executionMode === "SWAP")) {
      const build = await services.trading.buildSwap({
        binanceChainId: services.chainId,
        quoteId: quote.quoteId,
        fromTokenAddress: USDT_BSC_ADDRESS,
        toTokenAddress: wrapper.tokenContractAddress,
        amount: quote.fromTokenAmount,
        userWalletAddress: wallet,
      });
      const tx = build.ok ? build.value.tx : null;
      if (!tx?.from || !tx.to || !tx.data) {
        console.log(`  ${wrapper.tokenSymbol}: build gave no EVM tx (${build.ok ? "empty tx" : build.error.message})`);
        continue;
      }
      const sim = await services.transaction.simulate({
        binanceChainId: services.chainId,
        evmTx: { from: tx.from, to: tx.to, value: tx.value ?? "0", data: tx.data },
      });
      if (!sim.ok) {
        console.log(`  ${wrapper.tokenSymbol}: simulate ERROR [${sim.error.kind}] ${sim.error.message}`);
        continue;
      }
      simulated += 1;
      writeArtifact(capture, `${wrapper.tokenSymbol}-result`, sim.value);
      console.log(
        `  ${wrapper.tokenSymbol} (${quote.vendorName}): status=${sim.value.status} ` +
          `failReason=${sim.value.failReason ?? "none"} balanceChanges=${sim.value.balanceChanges.length} ` +
          `allowanceChanges=${sim.value.allowanceChanges.length}`,
      );
    }
  }

  printObservationTable(services.observations);
  writeObservations(capture, services.observations);
  console.log(
    `\nSimulated ${simulated} SWAP route(s). Record the observed status vocabulary in CLAIM_LEDGER E2, and any ` +
      "SUCCESS+failReason response in SPONSOR_FINDINGS DOC-005 (classification: RUNTIME_DIFFERENCE only if it reproduces).",
  );
  process.exit(simulated > 0 ? 0 : 1);
}

void main();
