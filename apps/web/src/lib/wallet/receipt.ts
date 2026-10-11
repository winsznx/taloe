/**
 * Minimal transaction-receipt poll, plain JSON-RPC over `fetch`. No wallet
 * involved — reading a receipt needs no signature, so this talks to the RPC
 * directly rather than through the injected provider.
 */
export interface TransactionReceipt {
  readonly status: "0x1" | "0x0" | string;
  readonly blockNumber: string;
}

export async function waitForReceipt(
  rpcUrl: string,
  hash: string,
  options: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<TransactionReceipt> {
  const intervalMs = options.intervalMs ?? 3000;
  const maxAttempts = options.maxAttempts ?? 40;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
    });
    const body = (await res.json()) as { result: TransactionReceipt | null };
    if (body.result) return body.result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Transaction ${hash} did not confirm in time. Check it directly on BscScan.`);
}
