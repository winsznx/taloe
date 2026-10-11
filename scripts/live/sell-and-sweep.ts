#!/usr/bin/env -S npx tsx
/**
 * One-off fund recovery for the demo: sell the NVDAon received in the
 * mainnet-trade proof back to USDT via the same Binance DEX aggregator, then
 * sweep USDT and most of the remaining BNB to the user's own wallet.
 *
 * Not product code — Taloe is buy-only in v1 and has no sell-side route, so
 * this calls the aggregator service directly (it is not direction-locked)
 * the same way `execute-mainnet-trade.ts` calls buildSwap directly. Every
 * step is independently checked against the chain before the next one runs.
 *
 * Usage: pnpm tsx scripts/live/sell-and-sweep.ts --to 0x7Cc6...3F6
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { readErc20Allowance, readErc20Balance } from "@taloe/router-core/chain-reader";

import { parseArgs } from "../validate/lib/args";
import { buildServices, REPO_ROOT } from "../validate/lib/client";

const RPC_URL = "https://bsc-dataseed.bnbchain.org";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const NVDAON = "0xA9eE28C80f960B889dFbd1902055218cBa016F75";
const CHAIN_ID = "56";
const GAS_MARGIN_PERCENT = 30n;
const BNB_SWEEP_RESERVE_WEI = 300_000_000_000_000n; // keep 0.0003 BNB behind for the sweep tx's own gas

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

async function signAndBroadcast(wallet: string, tx: { to: string; data: string; value: string }): Promise<{ hash: string; status: string }> {
  const [nonceHex, gasPriceHex, gasEstimateHex] = await Promise.all([
    rpc("eth_getTransactionCount", [wallet, "pending"]),
    rpc("eth_gasPrice", []),
    rpc("eth_estimateGas", [{ from: wallet, to: tx.to, data: tx.data, value: tx.value === "0" ? "0x0" : `0x${BigInt(tx.value).toString(16)}` }]),
  ]);
  const gasWithMargin = (BigInt(gasEstimateHex) * (100n + GAS_MARGIN_PERCENT)) / 100n;

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
    const body = (await res.json()) as { result: { status: string; blockNumber: string } | null };
    if (body.result) {
      console.log(`  mined: block ${body.result.blockNumber}, status ${body.result.status}`);
      return { hash, status: body.result.status };
    }
  }
  throw new Error(`transaction ${hash} did not confirm within the poll window`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const destination = args.to;
  if (!destination) throw new Error("--to <address> is required");
  const wallet = process.env.TALOE_TEST_WALLET_ADDRESS;
  if (!wallet) throw new Error("TALOE_TEST_WALLET_ADDRESS is not set");

  const services = buildServices();

  console.log(`\n== 1. Quote NVDAon -> USDT ==`);
  const nvdaBalance = await readErc20Balance({ rpcUrl: RPC_URL }, { tokenAddress: NVDAON, owner: wallet });
  if (!nvdaBalance.ok) throw new Error("Could not read NVDAon balance");
  console.log(`  selling ${nvdaBalance.value} NVDAon (base units)`);

  const quotes = await services.trading.getQuotes({
    binanceChainId: CHAIN_ID,
    fromTokenAddress: NVDAON,
    toTokenAddress: USDT,
    amount: nvdaBalance.value,
    userWalletAddress: wallet,
  });
  if (!quotes.ok || quotes.value.length === 0) throw new Error(`No sell-side quote available: ${JSON.stringify(quotes)}`);
  const quote = quotes.value[0]!;
  console.log(`  quote: ${quote.toTokenAmount} USDT (base units) via ${quote.vendorName}, mode ${quote.executionMode}`);
  if (quote.executionMode !== "SWAP") throw new Error(`Expected SWAP, got ${quote.executionMode} — this script only handles SWAP`);

  console.log(`\n== 2. Allowance check / approval ==`);
  const approval = await services.trading.getApprovalTransaction({
    binanceChainId: CHAIN_ID,
    tokenContractAddress: NVDAON,
    approveAmount: nvdaBalance.value,
    vendor: quote.vendorName,
  });
  if (!approval.ok) throw new Error(`Could not get approval transaction: ${JSON.stringify(approval)}`);
  const approvalTx = Array.isArray(approval.value) ? approval.value[0] : approval.value;
  if (!approvalTx?.data || !approvalTx.dexContractAddress) throw new Error("Approval response had no calldata or spender");

  const spender = approvalTx.dexContractAddress;
  const currentAllowance = await readErc20Allowance(
    { rpcUrl: RPC_URL },
    { tokenAddress: NVDAON, owner: wallet, spender },
  );
  const hasAllowance = currentAllowance.ok && BigInt(currentAllowance.value) >= BigInt(nvdaBalance.value);
  if (!hasAllowance) {
    console.log(`  approving ${spender} for the aggregator`);
    // Approval is sent to the token contract being approved; the spender lives inside the calldata.
    const approvalReceipt = await signAndBroadcast(wallet, { to: NVDAON, data: approvalTx.data, value: "0" });
    if (approvalReceipt.status !== "0x1") throw new Error("Approval reverted on-chain");
  } else {
    console.log(`  existing allowance already covers the sell amount, skipping approval`);
  }

  console.log(`\n== 3. Re-quote and build the swap (mirrors the readiness invariant: never sign a stale quote) ==`);
  const freshQuotes = await services.trading.getQuotes({
    binanceChainId: CHAIN_ID,
    fromTokenAddress: NVDAON,
    toTokenAddress: USDT,
    amount: nvdaBalance.value,
    userWalletAddress: wallet,
  });
  if (!freshQuotes.ok || freshQuotes.value.length === 0) throw new Error("Re-quote failed");
  const freshQuote = freshQuotes.value[0]!;
  const built = await services.trading.buildSwap({
    binanceChainId: CHAIN_ID,
    quoteId: freshQuote.quoteId,
    fromTokenAddress: NVDAON,
    toTokenAddress: USDT,
    amount: nvdaBalance.value,
    userWalletAddress: wallet,
    slippagePercent: "1",
  });
  if (!built.ok || !built.value.tx?.to || !built.value.tx.data) throw new Error("Could not build the sell swap transaction");

  const usdtBefore = await readErc20Balance({ rpcUrl: RPC_URL }, { tokenAddress: USDT, owner: wallet });
  const swapReceipt = await signAndBroadcast(wallet, { to: built.value.tx.to, data: built.value.tx.data, value: built.value.tx.value ?? "0" });
  if (swapReceipt.status !== "0x1") throw new Error("Sell swap reverted on-chain");

  const usdtAfter = await readErc20Balance({ rpcUrl: RPC_URL }, { tokenAddress: USDT, owner: wallet });
  const usdtGained = usdtAfter.ok && usdtBefore.ok ? BigInt(usdtAfter.value) - BigInt(usdtBefore.value) : 0n;
  console.log(`  USDT gained (base units): ${usdtGained}`);
  if (usdtGained <= 0n) throw new Error("Sell swap broadcast but USDT balance did not increase");

  console.log(`\n== 4. Sweep USDT to ${destination} ==`);
  const usdtBalance = await readErc20Balance({ rpcUrl: RPC_URL }, { tokenAddress: USDT, owner: wallet });
  if (!usdtBalance.ok) throw new Error("Could not read final USDT balance");
  const transferData = `0xa9059cbb${destination.slice(2).padStart(64, "0")}${BigInt(usdtBalance.value).toString(16).padStart(64, "0")}`;
  const usdtSweep = await signAndBroadcast(wallet, { to: USDT, data: transferData, value: "0" });
  if (usdtSweep.status !== "0x1") throw new Error("USDT sweep reverted on-chain");

  console.log(`\n== 5. Sweep BNB to ${destination} (minus gas reserve) ==`);
  const bnbBalanceHex = await rpc("eth_getBalance", [wallet, "latest"]);
  const bnbBalance = BigInt(bnbBalanceHex);
  const gasPriceHex = await rpc("eth_gasPrice", []);
  const nativeTransferCost = BigInt(gasPriceHex) * 21_000n;
  const sweepAmount = bnbBalance - nativeTransferCost - BNB_SWEEP_RESERVE_WEI;
  if (sweepAmount > 0n) {
    const nonceHex = await rpc("eth_getTransactionCount", [wallet, "pending"]);
    const raw = signTx({
      to: destination,
      data: "0x",
      value: sweepAmount.toString(),
      gas: 21_000,
      gasPrice: BigInt(gasPriceHex).toString(),
      nonce: Number(BigInt(nonceHex)),
      chainId: 56,
    });
    const hash = await rpc("eth_sendRawTransaction", [raw]);
    console.log(`  broadcast: ${hash} (${sweepAmount} wei)`);
  } else {
    console.log(`  not enough BNB left to sweep after gas reserve, skipping`);
  }

  console.log(`\nDone. USDT and most BNB swept from ${wallet} to ${destination}.`);
}

void main();
