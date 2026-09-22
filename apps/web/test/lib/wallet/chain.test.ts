import { describe, expect, it } from "vitest";

import { BSC_CHAIN_ID_DECIMAL, BSC_CHAIN_ID_HEX, chainIdHexToDecimal, isBscChain } from "../../../src/lib/wallet/chain";

describe("chainIdHexToDecimal", () => {
  it("converts BSC's hex chain id to the decimal Binance uses", () => {
    expect(chainIdHexToDecimal(BSC_CHAIN_ID_HEX)).toBe(BSC_CHAIN_ID_DECIMAL);
  });

  it("converts an arbitrary hex chain id (e.g. Ethereum mainnet)", () => {
    expect(chainIdHexToDecimal("0x1")).toBe("1");
  });

  it("returns null for a malformed value instead of throwing", () => {
    expect(chainIdHexToDecimal("not-hex")).toBeNull();
    expect(chainIdHexToDecimal("56")).toBeNull();
  });
});

describe("isBscChain", () => {
  it("accepts the hex form a wallet reports", () => {
    expect(isBscChain("0x38", BSC_CHAIN_ID_DECIMAL)).toBe(true);
  });

  it("accepts an already-decimal chain id", () => {
    expect(isBscChain("56", BSC_CHAIN_ID_DECIMAL)).toBe(true);
  });

  it("rejects a different chain", () => {
    expect(isBscChain("0x1", BSC_CHAIN_ID_DECIMAL)).toBe(false);
  });

  it("rejects null rather than assuming BSC", () => {
    expect(isBscChain(null, BSC_CHAIN_ID_DECIMAL)).toBe(false);
  });
});
