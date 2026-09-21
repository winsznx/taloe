import { describe, expect, it } from "vitest";

import { AssetAmountError, fromBaseUnitAmount, toBaseUnitAmount } from "../src/asset";
import type { AssetMetadata } from "../src/asset";

function asset(decimals: number, overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    symbol: "TEST",
    contractAddress: "0x1111111111111111111111111111111111111111",
    decimals,
    chainId: "56",
    provenance: "fixture:test",
    ...overrides,
  };
}

describe("toBaseUnitAmount — decimals are read from the asset, never assumed", () => {
  it("converts a whole-number amount at 18 decimals", () => {
    expect(toBaseUnitAmount({ decimalString: "500" }, asset(18))).toBe(
      "500000000000000000000",
    );
  });

  it("converts a whole-number amount at 6 decimals", () => {
    // This is the case a hardcoded 18 would silently corrupt: 500 USDT on a
    // 6-decimal chain is 500000000, not 500 * 1e18.
    expect(toBaseUnitAmount({ decimalString: "500" }, asset(6))).toBe("500000000");
  });

  it("converts a whole-number amount at 8 decimals", () => {
    expect(toBaseUnitAmount({ decimalString: "500" }, asset(8))).toBe("50000000000");
  });

  it("converts a fractional amount at 6 decimals", () => {
    expect(toBaseUnitAmount({ decimalString: "12.345678" }, asset(6))).toBe("12345678");
  });

  it("converts a fractional amount at 8 decimals", () => {
    expect(toBaseUnitAmount({ decimalString: "0.00000001" }, asset(8))).toBe("1");
  });

  it("converts a fractional amount at 18 decimals", () => {
    expect(toBaseUnitAmount({ decimalString: "1.5" }, asset(18))).toBe("1500000000000000000");
  });

  it("rejects zero and negative amounts", () => {
    expect(() => toBaseUnitAmount({ decimalString: "0" }, asset(18))).toThrow(AssetAmountError);
    expect(() => toBaseUnitAmount({ decimalString: "-5" }, asset(18))).toThrow(AssetAmountError);
  });

  it("rejects unreadable input with an AssetAmountError, not a raw parse error", () => {
    expect(() => toBaseUnitAmount({ decimalString: "abc" }, asset(18))).toThrow(AssetAmountError);
  });

  it("the same human amount produces different base units for different decimals", () => {
    // The property the correction exists to guarantee: identical human input,
    // different assets, different (correct) base-unit output.
    const human = { decimalString: "1" };
    const at6 = toBaseUnitAmount(human, asset(6));
    const at8 = toBaseUnitAmount(human, asset(8));
    const at18 = toBaseUnitAmount(human, asset(18));
    expect(at6).toBe("1000000");
    expect(at8).toBe("100000000");
    expect(at18).toBe("1000000000000000000");
    expect(new Set([at6, at8, at18]).size).toBe(3);
  });
});

describe("fromBaseUnitAmount — round-trips through the asset's own decimals", () => {
  it("round-trips at 6 decimals", () => {
    const base = toBaseUnitAmount({ decimalString: "12.345678" }, asset(6));
    expect(fromBaseUnitAmount(base, asset(6)).decimalString).toBe("12.345678");
  });

  it("round-trips at 8 decimals", () => {
    const base = toBaseUnitAmount({ decimalString: "0.00000001" }, asset(8));
    expect(fromBaseUnitAmount(base, asset(8)).decimalString).toBe("0.00000001");
  });

  it("round-trips at 18 decimals", () => {
    const base = toBaseUnitAmount({ decimalString: "500" }, asset(18));
    expect(fromBaseUnitAmount(base, asset(18)).decimalString).toBe("500");
  });

  it("rejects a non-integer base-unit string", () => {
    expect(() => fromBaseUnitAmount("1.5", asset(18))).toThrow(AssetAmountError);
  });

  it("reading the same base-unit string against the wrong decimals gives a different (wrong) amount", () => {
    // Documents why the asset must travel WITH the amount rather than being
    // assumed at the read site: the same bytes mean different things.
    const base = toBaseUnitAmount({ decimalString: "1" }, asset(6)); // "1000000"
    expect(fromBaseUnitAmount(base, asset(6)).decimalString).toBe("1");
    expect(fromBaseUnitAmount(base, asset(18)).decimalString).toBe("0.000000000001");
  });
});
