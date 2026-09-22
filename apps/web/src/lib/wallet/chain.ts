/**
 * BSC chain identity and EIP-3085 (`wallet_addEthereumChain`) parameters.
 *
 * Pure data and pure conversions only — no `window.ethereum` access — so
 * this is testable in Node without a browser, and the one place that decides
 * "is the wallet actually on BSC" (a chain-id STRING comparison, not a
 * number comparison: EIP-1193 returns hex, Binance's `binanceChainId` is
 * decimal, and mixing the two representations is how a wrong-chain bug hides).
 */

export const BSC_CHAIN_ID_DECIMAL = "56";
export const BSC_CHAIN_ID_HEX = "0x38";

export const BSC_ADD_CHAIN_PARAMS = {
  chainId: BSC_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.binance.org"],
  blockExplorerUrls: ["https://bscscan.com"],
} as const;

/** EIP-1193 `eth_chainId` returns a hex string ("0x38"); normalize to decimal for comparison against `binanceChainId`. */
export function chainIdHexToDecimal(hex: string): string | null {
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  try {
    return BigInt(hex).toString(10);
  } catch {
    return null;
  }
}

export function isBscChain(chainIdHexOrDecimal: string | null, requiredChainIdDecimal: string): boolean {
  if (chainIdHexOrDecimal === null) return false;
  const decimal = chainIdHexOrDecimal.startsWith("0x") ? chainIdHexToDecimal(chainIdHexOrDecimal) : chainIdHexOrDecimal;
  return decimal === requiredChainIdDecimal;
}
