"use server";

/**
 * Activity-history server actions. The only two operations this feature
 * needs: record a verified execution, fetch a wallet's history. Writing
 * happens right after WalletExecutionPanel independently verifies a swap
 * (balance delta confirmed, not just a receipt status) — the record this
 * stores is exactly what was already proven true, not a separate claim.
 */

import type { ExecutionRecord, StoredExecution } from "@/server/supabase";
import { insertExecution, isActivityHistoryConfigured, listExecutionsForWallet } from "@/server/supabase";

export async function recordExecution(record: ExecutionRecord): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await insertExecution(record);
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true };
}

export async function fetchActivity(
  walletAddress: string,
): Promise<{ configured: true; ok: true; executions: readonly StoredExecution[] } | { configured: true; ok: false; error: string } | { configured: false }> {
  if (!isActivityHistoryConfigured()) return { configured: false };
  const result = await listExecutionsForWallet(walletAddress);
  if (!result.ok) return { configured: true, ok: false, error: result.message };
  return { configured: true, ok: true, executions: result.value };
}
