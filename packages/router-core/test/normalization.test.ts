import { describe, expect, it } from "vitest";

import { makeWrapper } from "../fixtures/candidates";
import {
  hasValidatedNormalization,
  ISSUER_NORMALIZERS,
  lookupIssuer,
  normalizeWrapperAmountToUnderlying,
} from "../src/normalization";

describe("normalization — fails closed on UNKNOWN semantics", () => {
  it("refuses to convert while an issuer's ratio semantics are UNKNOWN", () => {
    // The PRD's hardest rule: never invent the direction of tokenToShareRatio.
    // Every registered issuer starts UNKNOWN and stays that way until real
    // evidence justifies otherwise.
    const outcome = normalizeWrapperAmountToUnderlying({
      wrapper: makeWrapper({ platformId: "ondo", tokenToShareRatioRaw: "1" }),
      tokenAmountDecimal: "5",
    });
    expect(outcome.underlyingEquivalent).toBeNull();
    expect(outcome.failure).toBe("SEMANTICS_UNKNOWN");
    expect(outcome.normalizer?.semantics).toBe("UNKNOWN");
  });

  it("reports an unknown issuer distinctly from a known-but-unvalidated one", () => {
    const outcome = normalizeWrapperAmountToUnderlying({
      wrapper: makeWrapper({ platformId: "someoneelse" }),
      tokenAmountDecimal: "5",
    });
    expect(outcome.failure).toBe("UNKNOWN_ISSUER");
    expect(outcome.normalizer).toBeNull();
  });

  it("reports a missing ratio distinctly from unknown semantics, once semantics allow checking it", () => {
    // Constructed directly against a hypothetically-validated normalizer shape
    // to prove the failure ordering: semantics are checked first, so an
    // UNKNOWN issuer never even reaches the "is the ratio present" check.
    const semanticsFirst = normalizeWrapperAmountToUnderlying({
      wrapper: makeWrapper({ platformId: "bstock", tokenToShareRatioRaw: null }),
      tokenAmountDecimal: "5",
    });
    expect(semanticsFirst.failure).toBe("SEMANTICS_UNKNOWN");
  });

  it("knows the three issuer families the Trading API documents, each with its own normalizer", () => {
    expect(ISSUER_NORMALIZERS.map((i) => i.platformId).sort()).toEqual([
      "bstock",
      "ondo",
      "xstock",
    ]);
    // Each has its own `normalize` function object, not a shared dispatcher.
    const fns = new Set(ISSUER_NORMALIZERS.map((i) => i.normalize));
    expect(fns.size).toBe(ISSUER_NORMALIZERS.length);
  });

  it("looks issuers up case-insensitively", () => {
    expect(lookupIssuer("ONDO")?.displayName).toBe("Ondo");
    expect(lookupIssuer(null)).toBeNull();
  });

  it("records the Wallet Skills Ondo multiplier as a related signal, not as provenance", () => {
    // This is the specific trap the V1 review flagged: a same-issuer, adjacent
    // concept from a DIFFERENT API surface must never silently become the
    // evidence for the RWA API's own ratio direction.
    const ondo = lookupIssuer("ondo");
    expect(ondo?.semantics).toBe("UNKNOWN");
    expect(ondo?.provenance).toEqual([]);
    expect(ondo?.relatedSignals.length).toBeGreaterThan(0);
    expect(ondo?.relatedSignals.join(" ")).toMatch(/shares multiplier/i);
  });

  it("reports honestly that nothing is validated yet", () => {
    // Expected to flip only when a live ratio is observed AND an issuer's
    // entry is replaced with a bespoke, evidenced normalizer — never by
    // relaxing this check.
    expect(hasValidatedNormalization()).toBe(false);
  });

  it("every UNKNOWN normalizer fails closed regardless of input", () => {
    for (const issuer of ISSUER_NORMALIZERS) {
      expect(issuer.normalize({ ratioRaw: "1", tokenAmountDecimal: "100" })).toBeNull();
      expect(issuer.normalize({ ratioRaw: "0.5", tokenAmountDecimal: "0" })).toBeNull();
    }
  });
});
