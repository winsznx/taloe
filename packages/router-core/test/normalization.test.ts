import { describe, expect, it } from "vitest";

import { makeWrapper } from "../fixtures/candidates";
import {
  hasValidatedNormalization,
  ISSUER_NORMALIZERS,
  lookupIssuer,
  normalizeWrapperAmountToUnderlying,
} from "../src/normalization";

const norm = (platformId: string, ratio: string | null, tokens = "4") =>
  normalizeWrapperAmountToUnderlying({
    wrapper: makeWrapper({ platformId, tokenToShareRatioRaw: ratio }),
    tokenAmountDecimal: tokens,
  });

describe("normalization — per-issuer evidence", () => {
  it("Ondo converts tokens to shares as tokens x ratio (EMPIRICALLY_OBSERVED, shares-per-token)", () => {
    // CRWDon-like: ratio 4 means one token is four shares, so 2 tokens = 8 shares.
    const outcome = norm("ondo", "4", "2");
    expect(outcome.underlyingEquivalent).toBe("8");
    expect(outcome.normalizer?.semantics).toBe("EMPIRICALLY_OBSERVED");
  });

  it("does NOT divide by the ratio (the inverse direction was empirically disproved)", () => {
    expect(norm("ondo", "10", "1").underlyingEquivalent).toBe("10");
    expect(norm("ondo", "10", "1").underlyingEquivalent).not.toBe("0.1");
  });

  it("BStock is DOCUMENTED and normalizes with its own function", () => {
    const outcome = norm("bstock", "1.0005", "2");
    expect(outcome.underlyingEquivalent).toBe("2.001");
    expect(outcome.normalizer?.semantics).toBe("DOCUMENTED");
  });

  it("xStock stays UNKNOWN and fails closed", () => {
    const outcome = norm("xstock", "1");
    expect(outcome.underlyingEquivalent).toBeNull();
    expect(outcome.failure).toBe("SEMANTICS_UNKNOWN");
  });

  it("reports a missing ratio and an unknown issuer distinctly", () => {
    expect(norm("ondo", null).failure).toBe("MISSING_RATIO");
    expect(norm("someoneelse", "1").failure).toBe("UNKNOWN_ISSUER");
  });

  it("rejects a non-positive or unreadable ratio instead of producing a number", () => {
    expect(norm("ondo", "0").failure).toBe("UNREADABLE_INPUT");
    expect(norm("ondo", "abc").failure).toBe("UNREADABLE_INPUT");
  });

  it("each issuer has its own normalize function, not a shared dispatcher", () => {
    expect(new Set(ISSUER_NORMALIZERS.map((i) => i.normalize)).size).toBe(ISSUER_NORMALIZERS.length);
  });

  it("looks issuers up case-insensitively", () => {
    expect(lookupIssuer("ONDO")?.displayName).toBe("Ondo");
    expect(lookupIssuer(null)).toBeNull();
  });

  it("keeps the Wallet Skills multiplier as a related signal, never as provenance", () => {
    const ondo = lookupIssuer("ondo");
    expect(ondo?.relatedSignals.join(" ")).toMatch(/shares multiplier/i);
    expect(ondo?.provenance.join(" ")).not.toMatch(/Wallet Skills/i);
  });

  it("every provenance entry names its source and date", () => {
    for (const issuer of ISSUER_NORMALIZERS.filter((i) => i.semantics !== "UNKNOWN")) {
      expect(issuer.provenance.length).toBeGreaterThan(0);
      expect(issuer.provenance.join(" ")).toMatch(/2026-09-21/);
    }
  });

  it("at least one issuer is now rankable, and the UNKNOWN one still is not", () => {
    expect(hasValidatedNormalization()).toBe(true);
    expect(lookupIssuer("xstock")?.normalize({ ratioRaw: "1", tokenAmountDecimal: "1" })).toBeNull();
  });
});
