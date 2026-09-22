/**
 * Minimal read-only EVM JSON-RPC access: ERC-20 allowance, ERC-20 balance and
 * native balance. Used for wallet execution readiness (allowance, spend
 * balance, gas balance) rather than any Binance endpoint, because none of
 * Wallet/Trading/RWA exposes an ERC-20 allowance read (F-022), and because a
 * balance or an approval must be verified against real chain state, which a
 * sponsor response cannot substitute for.
 *
 * Deliberately dependency-free (no viem/ethers): three JSON-RPC calls do not
 * justify a client library, and staying on raw `fetch` keeps this module
 * usable from both Node (validation scripts) and the browser (wallet
 * readiness) without a bundler-specific build.
 */

export interface ChainReaderOptions {
  readonly rpcUrl: string;
  readonly fetchImpl?: typeof fetch;
}

/** keccak256("allowance(address,address)")[0:4] */
const ALLOWANCE_SELECTOR = "0xdd62ed3e";
/** keccak256("balanceOf(address)")[0:4] */
const BALANCE_OF_SELECTOR = "0x70a08231";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const DEFAULT_BSC_RPC_URL = "https://bsc-dataseed.binance.org";

type ChainReadResult = { ok: true; value: string } | { ok: false; message: string };

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function assertAddresses(addresses: readonly string[]): string | null {
  for (const address of addresses) {
    if (!ADDRESS_PATTERN.test(address)) return `not an EVM address: ${address}`;
  }
  return null;
}

async function rpcCall(
  options: ChainReaderOptions,
  method: string,
  params: readonly unknown[],
): Promise<ChainReadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (typeof body.result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(body.result)) {
      return { ok: false, message: body.error?.message ?? `${method} returned no readable word` };
    }
    return { ok: true, value: BigInt(body.result).toString() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "rpc request failed" };
  }
}

export async function readErc20Allowance(
  options: ChainReaderOptions,
  params: { tokenAddress: string; owner: string; spender: string },
): Promise<ChainReadResult> {
  const invalid = assertAddresses([params.tokenAddress, params.owner, params.spender]);
  if (invalid) return { ok: false, message: invalid };
  return rpcCall(options, "eth_call", [
    { to: params.tokenAddress, data: `${ALLOWANCE_SELECTOR}${padAddress(params.owner)}${padAddress(params.spender)}` },
    "latest",
  ]);
}

/** ERC-20 balance of `owner` in the token's own base units (decimals unapplied). */
export async function readErc20Balance(
  options: ChainReaderOptions,
  params: { tokenAddress: string; owner: string },
): Promise<ChainReadResult> {
  const invalid = assertAddresses([params.tokenAddress, params.owner]);
  if (invalid) return { ok: false, message: invalid };
  return rpcCall(options, "eth_call", [{ to: params.tokenAddress, data: `${BALANCE_OF_SELECTOR}${padAddress(params.owner)}` }, "latest"]);
}

/** Native BNB balance of `owner`, in wei. */
export async function readNativeBalanceWei(
  options: ChainReaderOptions,
  params: { owner: string },
): Promise<ChainReadResult> {
  const invalid = assertAddresses([params.owner]);
  if (invalid) return { ok: false, message: invalid };
  return rpcCall(options, "eth_getBalance", [params.owner, "latest"]);
}
