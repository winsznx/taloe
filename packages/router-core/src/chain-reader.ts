/**
 * Minimal read-only EVM JSON-RPC access, used only to read ERC-20 allowances.
 *
 * Allowance is read on-chain rather than inferred from a failed swap
 * simulation because the revert text ("transfer amount exceeds allowance") is
 * vendor and token specific, and because an approval must be verified against
 * chain state after it is mined, which a simulation cannot do.
 */

export interface ChainReaderOptions {
  readonly rpcUrl: string;
  readonly fetchImpl?: typeof fetch;
}

/** keccak256("allowance(address,address)")[0:4] */
const ALLOWANCE_SELECTOR = "0xdd62ed3e";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const DEFAULT_BSC_RPC_URL = "https://bsc-dataseed.binance.org";

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export async function readErc20Allowance(
  options: ChainReaderOptions,
  params: { tokenAddress: string; owner: string; spender: string },
): Promise<{ ok: true; value: string } | { ok: false; message: string }> {
  for (const address of [params.tokenAddress, params.owner, params.spender]) {
    if (!ADDRESS_PATTERN.test(address)) return { ok: false, message: `not an EVM address: ${address}` };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          { to: params.tokenAddress, data: `${ALLOWANCE_SELECTOR}${padAddress(params.owner)}${padAddress(params.spender)}` },
          "latest",
        ],
      }),
    });
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (typeof body.result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(body.result)) {
      return { ok: false, message: body.error?.message ?? "eth_call returned no allowance word" };
    }
    return { ok: true, value: BigInt(body.result).toString() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "rpc request failed" };
  }
}
