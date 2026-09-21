import { describe, expect, it } from "vitest";

import {
  AmountError,
  bpsToFixed,
  deviationBps,
  div,
  fromBaseUnits,
  fromDecimalString,
  mul,
  toBaseUnits,
  toDecimalString,
} from "../src/money";

describe("base-unit conversion", () => {
  it("round-trips 18-decimal base units", () => {
    const value = fromBaseUnits("500000000000000000000", 18);
    expect(toBaseUnits(value, 18)).toBe("500000000000000000000");
    expect(toDecimalString(value)).toBe("500");
  });

  it("round-trips 6-decimal base units", () => {
    const value = fromBaseUnits("500000000", 6);
    expect(toDecimalString(value)).toBe("500");
    expect(toBaseUnits(value, 6)).toBe("500000000");
  });

  it("rejects a non-integer base-unit string", () => {
    expect(() => fromBaseUnits("1.5", 18)).toThrow(AmountError);
  });

  it("keeps precision that floating point would lose", () => {
    // 0.1 + 0.2 in IEEE-754 is 0.30000000000000004. Routing comparisons run at
    // basis-point resolution, so this has to be exact.
    const sum = fromDecimalString("0.1") + fromDecimalString("0.2");
    expect(toDecimalString(sum)).toBe("0.3");
  });

  it("rejects more precision than it can represent instead of truncating", () => {
    expect(() => fromDecimalString(`0.${"1".repeat(19)}`)).toThrow(AmountError);
  });
});

describe("deviationBps", () => {
  it("reports zero for an exact match", () => {
    expect(deviationBps(fromDecimalString("100"), fromDecimalString("100"))).toBe(0);
  });

  it("reports a positive deviation when execution is above reference", () => {
    // 101 vs 100 is 1%, which is 100 bps.
    expect(deviationBps(fromDecimalString("101"), fromDecimalString("100"))).toBe(100);
  });

  it("reports a negative deviation when execution is below reference", () => {
    expect(deviationBps(fromDecimalString("99"), fromDecimalString("100"))).toBe(-100);
  });

  it("returns null — never 0 — when there is no usable reference", () => {
    // Returning 0 here would read as a perfect match and let an uncomparable
    // route sail through a deviation gate.
    expect(deviationBps(fromDecimalString("100"), 0n)).toBeNull();
    expect(deviationBps(fromDecimalString("100"), fromDecimalString("-5"))).toBeNull();
  });

  it("resolves a single basis point", () => {
    expect(deviationBps(fromDecimalString("100.01"), fromDecimalString("100"))).toBe(1);
  });
});

describe("fixed-point arithmetic", () => {
  it("multiplies and divides consistently", () => {
    const a = fromDecimalString("7.5");
    const b = fromDecimalString("4");
    expect(toDecimalString(mul(a, b))).toBe("30");
    expect(toDecimalString(div(a, b))).toBe("1.875");
  });

  it("throws on division by zero rather than yielding Infinity", () => {
    expect(() => div(fromDecimalString("1"), 0n)).toThrow(AmountError);
  });

  it("converts basis points to a fraction", () => {
    expect(toDecimalString(bpsToFixed(150))).toBe("0.015");
  });
});
