import "server-only";

/**
 * Minimal Supabase REST (PostgREST) client for the `executions` table.
 * Deliberately no `@supabase/supabase-js` dependency: two operations
 * (insert, select-by-wallet) are two `fetch` calls against the REST API
 * with the service role key, which bypasses row-level security — this
 * module is the only place in the app allowed to read or write this table,
 * matching the same "signing stays in one small surface" discipline used
 * for chain-reader.ts and the wallet signer.
 */

import { getServerConfig } from "./config";

export interface ExecutionRecord {
  readonly walletAddress: string;
  readonly chainId: string;
  readonly underlyingTicker: string;
  readonly companyName: string;
  readonly wrapperSymbol: string;
  readonly platformId: string | null;
  readonly spendToken: string;
  readonly spendAmountBaseUnits: string;
  readonly receivedAmountBaseUnits: string | null;
  readonly executionMode: string;
  readonly approvalTxHash: string | null;
  readonly swapTxHash: string | null;
  readonly verifiedSuccess: boolean;
}

export interface StoredExecution extends ExecutionRecord {
  readonly id: string;
  readonly createdAt: string;
}

export type SupabaseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function toRow(record: ExecutionRecord): Record<string, unknown> {
  return {
    wallet_address: record.walletAddress.toLowerCase(),
    chain_id: record.chainId,
    underlying_ticker: record.underlyingTicker,
    company_name: record.companyName,
    wrapper_symbol: record.wrapperSymbol,
    platform_id: record.platformId,
    spend_token: record.spendToken,
    spend_amount_base_units: record.spendAmountBaseUnits,
    received_amount_base_units: record.receivedAmountBaseUnits,
    execution_mode: record.executionMode,
    approval_tx_hash: record.approvalTxHash,
    swap_tx_hash: record.swapTxHash,
    verified_success: record.verifiedSuccess,
  };
}

function fromRow(row: Record<string, unknown>): StoredExecution {
  return {
    id: String(row.id),
    walletAddress: String(row.wallet_address),
    chainId: String(row.chain_id),
    underlyingTicker: String(row.underlying_ticker),
    companyName: String(row.company_name),
    wrapperSymbol: String(row.wrapper_symbol),
    platformId: row.platform_id === null ? null : String(row.platform_id),
    spendToken: String(row.spend_token),
    spendAmountBaseUnits: String(row.spend_amount_base_units),
    receivedAmountBaseUnits: row.received_amount_base_units === null ? null : String(row.received_amount_base_units),
    executionMode: String(row.execution_mode),
    approvalTxHash: row.approval_tx_hash === null ? null : String(row.approval_tx_hash),
    swapTxHash: row.swap_tx_hash === null ? null : String(row.swap_tx_hash),
    verifiedSuccess: Boolean(row.verified_success),
    createdAt: String(row.created_at),
  };
}

export function isActivityHistoryConfigured(): boolean {
  return getServerConfig().supabase !== null;
}

export async function insertExecution(record: ExecutionRecord): Promise<SupabaseResult<StoredExecution>> {
  const supabase = getServerConfig().supabase;
  if (!supabase) return { ok: false, message: "Activity history is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." };

  try {
    const res = await fetch(`${supabase.url}/rest/v1/executions`, {
      method: "POST",
      headers: {
        apikey: supabase.serviceRoleKey,
        Authorization: `Bearer ${supabase.serviceRoleKey}`,
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(toRow(record)),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, message: `Supabase insert failed (${res.status}): ${body.slice(0, 300)}` };
    }
    const rows = (await res.json()) as Record<string, unknown>[];
    const first = rows[0];
    if (!first) return { ok: false, message: "Supabase insert returned no row" };
    return { ok: true, value: fromRow(first) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Supabase insert failed" };
  }
}

export async function listExecutionsForWallet(walletAddress: string): Promise<SupabaseResult<readonly StoredExecution[]>> {
  const supabase = getServerConfig().supabase;
  if (!supabase) return { ok: false, message: "Activity history is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." };

  try {
    const url = new URL(`${supabase.url}/rest/v1/executions`);
    url.searchParams.set("wallet_address", `eq.${walletAddress.toLowerCase()}`);
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", "50");
    const res = await fetch(url, {
      method: "GET",
      headers: { apikey: supabase.serviceRoleKey, Authorization: `Bearer ${supabase.serviceRoleKey}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, message: `Supabase query failed (${res.status}): ${body.slice(0, 300)}` };
    }
    const rows = (await res.json()) as Record<string, unknown>[];
    return { ok: true, value: rows.map(fromRow) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Supabase query failed" };
  }
}
