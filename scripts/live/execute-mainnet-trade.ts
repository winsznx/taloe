#!/usr/bin/env -S npx tsx
/**
 * PRD goal #10: execute one small real tokenized-equity purchase on BSC
 * mainnet, through the exact same decision pipeline the product uses, and
 * independently verify the result.
 *
 * This reuses `LiveDiscoveryProvider`, `runRouteDiscovery`, `prepareExecution`
 * and `resumeAfterApproval` unchanged — nothing here reimplements Taloe's
 * routing or safety logic. The ONLY new capability is signing and
 * broadcasting, deliberately isolated to the smallest possible surface:
 * `sign_tx.py` (a private-key-holding subprocess that does nothing else) and
 * two plain JSON-RPC calls here (`eth_sendRawTransaction`,
 * `eth_getTransactionReceipt`) that touch no secret.
 *
 * Every step is independently checked against the chain before the next one
 * runs: an approval is not trusted until its on-chain allowance is read back;
 * a swap is not trusted until the wrapper-token balance is read back. The
 * mandatory re-quote-after-approval invariant (readiness.ts) is exercised for
 * real, not simulated.
 *
 * Usage: pnpm tsx scripts/live/execute-mainnet-trade.ts --ticker NVDA --amount 10
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LiveDiscoveryProvider,
  prepareExecution,
  resumeAfterApproval,
  runRouteDiscovery,
} from "@taloe/router-core";
import { readErc20Balance } from "@taloe/router-core/chain-reader";
import { redactValue } from "@taloe/shared";

import { parseArgs } from "../validate/lib/args";
import { buildServices, REPO_ROOT } from "../validate/lib/client";

const RPC_URL = "https://bsc-dataseed.bnbchain.org";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const GAS_MARGIN_PERCENT = 30n; // applied to eth_estimateGas, since the sponsor response does not carry a gas estimate for the signer

async function rpc(method: string, params: unknown[]): Promise<string> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (!body.result) throw new Error(`${method} failed: ${body.error?.message ?? "no result"}`);
  return body.result;
}

function signTx(tx: { to: string; data: string; value: string; gas: number; gasPrice: string; nonce: number; chainId: number }): string {
  const out = execFileSync("python3", [resolve(REPO_ROOT, "scripts/live/sign_tx.py")], {
    input: JSON.stringify(tx),
    encoding: "utf8",
  });
  const parsed = JSON.parse(out) as { rawTransaction: string };
  return parsed.rawTransaction;
}

async function signAndBroadcast(wallet: string, tx: { to: string; data: string; value: string }): Promise<{ hash: string; gasUsed: string; status: string }> {
  const [nonceHex, gasPriceHex, gasEstimateHex] = await Promise.all([
    rpc("eth_getTransactionCount", [wallet, "pending"]),
    rpc("eth_gasPrice", []),
    rpc("eth_estimateGas", [{ from: wallet, to: tx.to, data: tx.data, value: tx.value === "0" ? "0x0" : `0x${BigInt(tx.value).toString(16)}` }]),
  ]);
  const estimatedGas = BigInt(gasEstimateHex);
  const gasWithMargin = (estimatedGas * (100n + GAS_MARGIN_PERCENT)) / 100n;

  const raw = signTx({
    to: tx.to,
    data: tx.data,
    value: tx.value,
    gas: Number(gasWithMargin),
    gasPrice: BigInt(gasPriceHex).toString(),
    nonce: Number(BigInt(nonceHex)),
    chainId: 56,
  });

  const hash = await rpc("eth_sendRawTransaction", [raw]);
  console.log(`  broadcast: ${hash}`);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
    });
    const body = (await res.json()) as { result: { status: string; gasUsed: string; blockNumber: string } | null };
    if (body.result) {
      console.log(`  mined: block ${body.result.blockNumber}, status ${body.result.status}, gasUsed ${body.result.gasUsed}`);
      return { hash, gasUsed: body.result.gasUsed, status: body.result.status };
    }
  }
  throw new Error(`transaction ${hash} did not confirm within the poll window`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ticker = args.ticker ?? "NVDA";
  const amount = args.amount ?? "10";
  const wallet = process.env.TALOE_TEST_WALLET_ADDRESS;
  if (!wallet) throw new Error("TALOE_TEST_WALLET_ADDRESS is not set");

  const services = buildServices();
  const port = new LiveDiscoveryProvider(services);
  const spend = await port.resolveSpendAsset(services.chainId);
  if (!spend.ok) throw new Error(spend.error.message);

  const evidence: Record<string, unknown> = { wallet, ticker, amount, startedAt: new Date().toISOString(), steps: [] as unknown[] };
  const steps = evidence.steps as unknown[];

  console.log(`\n== 1. Market decision: ${ticker} / ${amount} USDT ==`);
  const outcome = await runRouteDiscovery(port, {
    routeSessionId: "live-mainnet-trade",
    underlyingQuery: ticker,
    spendAmountDecimal: amount,
    walletAddress: wallet,
    maxDeviationBps: 150,
    binanceChainId: services.chainId,
  });
  const selectedEvaluation = outcome.kind === "DECIDED" && outcome.decision.outcome === "ACT" ? outcome.decision.selected : null;
  if (outcome.kind !== "DECIDED" || !selectedEvaluation) {
    throw new Error(`Market decision was not ACT: ${JSON.stringify(outcome)}`);
  }
  const { decision } = outcome;
  const selected = selectedEvaluation;
  console.log(`  selected: ${selected.route.wrapper.tokenSymbol} (${selected.route.wrapper.platformId}) via ${selected.route.quote.vendorName}, deviation ${selected.referenceDeviationBps} bps`);
  steps.push({ step: "market_decision", wrapper: selected.route.wrapper.tokenSymbol, platformId: selected.route.wrapper.platformId, deviationBps: selected.referenceDeviationBps });

  const wrapperToken = selected.route.wrapper.tokenContractAddress;
  const [usdtBefore, wrapperBefore] = await Promise.all([
    readErc20Balance({ rpcUrl: RPC_URL }, { tokenAddress: USDT, owner: wallet }),
    readErc20Balance({ rpcUrl: RPC_URL }, { tokenAddress: wrapperToken, owner: wallet }),
  ]);
  console.log(`  balances before — USDT: ${usdtBefore.ok ? usdtBefore.value : "unreadable"}, ${selected.route.wrapper.tokenSymbol}: ${wrapperBefore.ok ? wrapperBefore.value : "unreadable"}`);
  steps.push({ step: "balances_before", usdt: usdtBefore.ok ? usdtBefore.value : null, wrapper: wrapperBefore.ok ? wrapperBefore.value : null });

  console.log(`\n== 2. Execution readiness ==`);
  let readiness = await prepareExecution(
    { port, walletAddress: wallet, chainId: services.chainId, spendTokenAddress: spend.value.contractAddress, now: new Date() },
    decision,
  );
  console.log(`  readiness: ${readiness.kind}`);
  steps.push({ step: "readiness", kind: readiness.kind });

  if (readiness.kind === "APPROVAL_REQUIRED") {
    console.log(`\n== 3. Approval required: spender ${readiness.spender}, amount ${readiness.requiredBaseUnits} ==`);
    const approvalReceipt = await signAndBroadcast(wallet, readiness.approvalTransaction);
    steps.push({ step: "approval_broadcast", ...approvalReceipt });
    if (approvalReceipt.status !== "0x1") throw new Error("Approval transaction reverted on-chain");

    const approvedRoute = readiness.route;
    const spender = readiness.spender;
    const requiredBaseUnits = readiness.requiredBaseUnits;

    console.log(`\n== 4. Re-verify allowance, mandatory re-quote, fresh simulation ==`);
    readiness = await resumeAfterApproval(
      { port, walletAddress: wallet, chainId: services.chainId, spendTokenAddress: spend.value.contractAddress, spender, requiredBaseUnits, now: new Date() },
      decision,
      approvedRoute,
    );
    console.log(`  post-approval readiness: ${readiness.kind}`);
    steps.push({ step: "post_approval_readiness", kind: readiness.kind });
  }

  if (readiness.kind !== "READY_TO_SIGN") {
    writeFileSync(resolve(REPO_ROOT, "internal/evidence/runtime", `live-mainnet-trade-FAILED-${Date.now()}.json`), JSON.stringify(redactValue(evidence), null, 2));
    throw new Error(`Not ready to sign: ${JSON.stringify(readiness)}`);
  }

  console.log(`\n== 5. Build the fresh signed swap, broadcast, confirm ==`);
  const freshRoute = readiness.route;
  const built = await services.trading.buildSwap({
    binanceChainId: services.chainId,
    quoteId: freshRoute.quote.quoteId,
    fromTokenAddress: spend.value.contractAddress,
    toTokenAddress: freshRoute.wrapper.tokenContractAddress,
    amount: freshRoute.quote.fromTokenAmount,
    userWalletAddress: wallet,
    slippagePercent: "1",
  });
  if (!built.ok || !built.value.tx?.to || !built.value.tx.data) throw new Error("Could not rebuild the swap transaction for signing");
  const swapReceipt = await signAndBroadcast(wallet, { to: built.value.tx.to, data: built.value.tx.data, value: built.value.tx.value ?? "0" });
  steps.push({ step: "swap_broadcast", ...swapReceipt });
  if (swapReceipt.status !== "0x1") throw new Error("Swap transaction reverted on-chain");

  console.log(`\n== 6. Independent verification (balance deltas, not just tx status) ==`);
  const [usdtAfter, wrapperAfter] = await Promise.all([
    readErc20Balance({ rpcUrl: RPC_URL }, { tokenAddress: USDT, owner: wallet }),
    readErc20Balance({ rpcUrl: RPC_URL }, { tokenAddress: wrapperToken, owner: wallet }),
  ]);
  const usdtDelta = usdtAfter.ok && usdtBefore.ok ? (BigInt(usdtBefore.value) - BigInt(usdtAfter.value)).toString() : null;
  const wrapperDelta = wrapperAfter.ok && wrapperBefore.ok ? (BigInt(wrapperAfter.value) - BigInt(wrapperBefore.value)).toString() : null;
  console.log(`  USDT spent: ${usdtDelta}, ${freshRoute.wrapper.tokenSymbol} received: ${wrapperDelta}`);
  const verified = usdtDelta !== null && wrapperDelta !== null && BigInt(usdtDelta) > 0n && BigInt(wrapperDelta) > 0n;
  steps.push({
    step: "verified",
    usdtSpentBaseUnits: usdtDelta,
    wrapperReceivedBaseUnits: wrapperDelta,
    wrapperSymbol: freshRoute.wrapper.tokenSymbol,
    verifiedSuccess: verified,
  });
  evidence.verifiedSuccess = verified;
  evidence.finishedAt = new Date().toISOString();

  const outFile = resolve(REPO_ROOT, "internal/evidence/runtime", `live-mainnet-trade-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(redactValue(evidence), null, 2));
  console.log(`\n${verified ? "VERIFIED_SUCCESS" : "VERIFICATION_FAILED"} — artifact: ${outFile}`);
  process.exit(verified ? 0 : 1);
}

void main();
