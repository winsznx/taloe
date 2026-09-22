#!/usr/bin/env -S npx tsx
/**
 * Exercises the simulate SUCCESS path WITHOUT broadcasting: builds the ERC-20
 * approval calldata (approve-transaction) and simulates it from a public
 * address. Nothing is signed or sent.
 * Usage: pnpm tsx scripts/validate/simulate-approval.ts --wallet 0x... [--ticker NVDA]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { redactValue } from "@taloe/shared";
import { parseArgs } from "./lib/args";
import { buildServices, REPO_ROOT } from "./lib/client";

const USDT = "0x55d398326f99059fF775485246999027B3197955";
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wallet = args.wallet!;
  const s = buildServices();
  const out: Record<string, unknown> = { at: new Date().toISOString(), wallet: "public address (no key)" };
  const approval = await s.trading.getApprovalTransaction({ binanceChainId: "56", tokenContractAddress: USDT, approveAmount: "5000000000000000000" });
  out.approvalResponse = approval.ok ? approval.value : approval.error.toRecord();
  console.log("approve-transaction:", approval.ok ? JSON.stringify(approval.value).slice(0, 400) : approval.error.message);
  if (approval.ok && approval.value[0]?.data) {
    const a = approval.value[0];
    const sim = await s.transaction.simulate({ binanceChainId: "56", evmTx: { from: wallet, to: USDT, value: "0", data: a.data! } });
    out.simulation = sim.ok ? sim.value : sim.error.toRecord();
    console.log("simulate(approve):", JSON.stringify(sim.ok ? sim.value : sim.error.toRecord()).slice(0, 900));
  }
  const f = resolve(REPO_ROOT, "internal/evidence/runtime", `simulate-approval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(f, JSON.stringify(redactValue(out), null, 2));
  console.log("artifact:", f);
}
void main();
