import { fromDecimalString, mul, toDecimalString } from "@taloe/shared";

/**
 * Wrapper -> underlying-equivalent normalization.
 *
 * This is the module the PRD is most insistent about (10.5), and the one the
 * V1 review corrected further: `tokenToShareRatio`'s meaning must not be
 * generalized across issuers from the field name alone, and must not be
 * inferred from adjacent-but-different evidence.
 *
 * Two concrete traps this module exists to avoid:
 *
 *  1. Assuming every RWA issuer encodes the ratio the same way because they
 *     share one API field name. Ondo, BStock and xStock are documented as
 *     three structurally different trading families (RFQ-only, mixed, AMM);
 *     nothing says their ratio semantics are the same family too.
 *  2. Treating the Binance Wallet Skills documentation's mention of an
 *     Ondo-specific "shares multiplier" as proof of the RWA API's
 *     `tokenToShareRatio` direction. It is related evidence — the same
 *     issuer, a similar-sounding concept — and it is recorded as exactly
 *     that: a `relatedSignal`, which does NOT by itself raise a normalizer's
 *     `semantics` above `UNKNOWN`. Conflating "related" with "confirms" is
 *     the mistake this file is built not to make.
 *
 * Each issuer gets its OWN normalizer object with its OWN `normalize`
 * function — not one shared formula parameterized by a direction enum. An
 * issuer whose semantics are `UNKNOWN` fails closed: `normalize` returns
 * null unconditionally, which removes that wrapper from numeric ranking
 * entirely (`RouteEvaluation.comparable` becomes false). It is still shown to
 * the user, labelled as not comparable. We never invent a conversion so a
 * wrapper can appear in a league table.
 */

/** How we know what a ratio means, per issuer. Fixed vocabulary, no in-between. */
export type RatioSemantics = "DOCUMENTED" | "EMPIRICALLY_OBSERVED" | "UNKNOWN";

/** Which way a ratio points, once semantics are above UNKNOWN. */
export type RatioDirection =
  /** ratio = underlying shares represented by ONE token. underlying = tokens * ratio */
  | "SHARES_PER_TOKEN"
  /** ratio = tokens representing ONE underlying share. underlying = tokens / ratio */
  | "TOKENS_PER_SHARE";

export interface RatioInterpretation {
  readonly direction: RatioDirection;
  /** Human-readable formula, shown in `/about/how-it-works` advanced detail. */
  readonly formula: string;
}

export interface NormalizeArgs {
  readonly ratioRaw: string;
  /** Wrapper tokens received, as a decimal string (not base units). */
  readonly tokenAmountDecimal: string;
}

export interface IssuerNormalizer {
  readonly platformId: string;
  readonly displayName: string;
  readonly semantics: RatioSemantics;
  /** Present only when `semantics !== "UNKNOWN"`. */
  readonly interpretation: RatioInterpretation | null;
  /** Citations or observations that directly establish `semantics`. */
  readonly provenance: readonly string[];
  /**
   * Evidence that touches this issuer but does NOT, on its own, establish the
   * RWA API's ratio direction — e.g. a same-issuer concept from a different
   * API surface. Kept visible precisely so it is never silently promoted to
   * `provenance`.
   */
  readonly relatedSignals: readonly string[];
  readonly note: string;
  /**
   * Convert one wrapper's ratio + token amount into underlying-equivalent
   * exposure. Issuer-specific, not a shared global formula dispatched off an
   * enum. Returns null whenever semantics are UNKNOWN or an input cannot be
   * parsed — this function fails closed unconditionally, by construction, not
   * by a caller remembering to check `semantics` first.
   */
  normalize(args: NormalizeArgs): string | null;
}

/**
 * Issuer registry.
 *
 * Ondo (EMPIRICALLY_OBSERVED) and BStock (DOCUMENTED) were promoted on
 * 2026-09-21 from live evidence, each on its own evidence. xStock stays UNKNOWN:
 * live RWA data does not list it at all. The Wallet Skills "shares multiplier"
 * reference remains a related signal for Ondo only, never the basis.
 *
 * When live evidence arrives, an issuer's entry is replaced wholesale (new
 * `semantics`, new `interpretation`, new `provenance`, new bespoke
 * `normalize` body) rather than edited in place, so the change is reviewable
 * as "here is the new evidence and the new function it justifies."
 */
export const ISSUER_NORMALIZERS: readonly IssuerNormalizer[] = [
  {
    platformId: "ondo",
    displayName: "Ondo",
    semantics: "EMPIRICALLY_OBSERVED",
    interpretation: {
      direction: "SHARES_PER_TOKEN",
      formula: "underlying shares = tokens x tokenToShareRatio",
    },
    provenance: [
      "DOCUMENTED: Binance RWA Underlying Info, https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/rwa-data " +
        "(\"'1.003701' means 1 token ≈ 1.003701 underlying shares\"), retrieved 2026-09-21.",
      "EMPIRICALLY_OBSERVED: executable LiquidMesh quotes 2026-09-21T23:03Z — CRWDon (ratio 4.0): $994.10/token = $248.53/share " +
        "(-4 bps vs reference) under shares-per-token, but $3,976/share under the inverse; KLACon (ratio 10.026): +35 bps vs +90,614 bps. " +
        "Artifact: internal/evidence/runtime/normalization-crosscheck-2026-09-21T23-03-54-939Z.json",
      "Internal consistency: tokenPrice / referencePrice == tokenToShareRatio for every one of 488 parseable tokens " +
        "(raw-universe-*.json). This alone is NOT independent evidence: referencePrice is documented as derived from tokenPrice.",
    ],
    relatedSignals: [
      "Binance Wallet Skills documentation references an Ondo-specific shares multiplier (different API surface). " +
        "It is consistent with the direction above but is NOT what established it.",
    ],
    note:
      "Direction established from Binance's field definition and confirmed by executable prices on tokens whose ratio is far from 1. " +
      "Ondo's own issuer documentation was not consulted; that remains a gap.",
    normalize: ({ ratioRaw, tokenAmountDecimal }) => {
      try {
        const ratio = fromDecimalString(ratioRaw);
        if (ratio <= 0n) return null;
        return toDecimalString(mul(fromDecimalString(tokenAmountDecimal), ratio), 8);
      } catch {
        return null;
      }
    },
  },
  {
    platformId: "bstock",
    displayName: "BStock",
    semantics: "DOCUMENTED",
    interpretation: {
      direction: "SHARES_PER_TOKEN",
      formula: "underlying shares = tokens x tokenToShareRatio",
    },
    provenance: [
      "DOCUMENTED: Binance RWA Underlying Info field definition (platform-agnostic), " +
        "https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/rwa-data, retrieved 2026-09-21.",
    ],
    relatedSignals: [
      "Every observed bStock ratio is within 0.4% of 1 (max 1.0038), so executable prices cannot discriminate the direction " +
        "(consistent with shares-per-token at 10-40 bps noise, not proof). tokenPrice/referencePrice == ratio holds but is not independent.",
    ],
    note:
      "Rests on Binance's documented field meaning only. Not empirically discriminated and issuer documentation was not consulted. " +
      "Demote to UNKNOWN if any bStock token with ratio far from 1 disagrees with its quotes.",
    normalize: ({ ratioRaw, tokenAmountDecimal }) => {
      try {
        const ratio = fromDecimalString(ratioRaw);
        if (ratio <= 0n) return null;
        return toDecimalString(mul(fromDecimalString(tokenAmountDecimal), ratio), 8);
      } catch {
        return null;
      }
    },
  },
  {
    platformId: "xstock",
    displayName: "xStocks",
    semantics: "UNKNOWN",
    interpretation: null,
    provenance: [],
    relatedSignals: [],
    note:
      "The Trading API documents xStock as AMM/SWAP-only. Whether the RWA data surface " +
      "exposes xStock tokens with a ratio field AT ALL is an open empirical question — see " +
      "SPONSOR_FINDINGS.md F-001 and the xStock investigation in ASSUMPTIONS.md. If RWA data " +
      "does not cover xStock, this entry stays UNKNOWN permanently for a different reason " +
      "than 'not yet observed': there would be nothing to observe through this surface.",
    normalize: () => null,
  },
];

export function lookupIssuer(platformId: string | null): IssuerNormalizer | null {
  if (!platformId) return null;
  const key = platformId.toLowerCase();
  return ISSUER_NORMALIZERS.find((issuer) => issuer.platformId === key) ?? null;
}

export interface NormalizationInput {
  readonly wrapper: { platformId: string | null; tokenToShareRatioRaw: string | null };
  readonly tokenAmountDecimal: string;
}

export type NormalizationFailure =
  | "UNKNOWN_ISSUER"
  | "SEMANTICS_UNKNOWN"
  | "MISSING_RATIO"
  | "UNREADABLE_INPUT";

export interface NormalizationOutcome {
  /** Underlying-equivalent exposure, or null when it cannot be established. */
  readonly underlyingEquivalent: string | null;
  readonly normalizer: IssuerNormalizer | null;
  readonly failure: NormalizationFailure | null;
}

/**
 * Convert a wrapper amount into underlying-equivalent exposure.
 *
 * Returns null rather than a best guess whenever any input is missing, the
 * issuer is unrecognised, or the issuer's semantics are UNKNOWN. Callers must
 * treat null as "cannot compare", never as zero.
 */
export function normalizeWrapperAmountToUnderlying(
  input: NormalizationInput,
): NormalizationOutcome {
  const normalizer = lookupIssuer(input.wrapper.platformId);
  if (!normalizer) {
    return { underlyingEquivalent: null, normalizer: null, failure: "UNKNOWN_ISSUER" };
  }
  if (normalizer.semantics === "UNKNOWN") {
    return { underlyingEquivalent: null, normalizer, failure: "SEMANTICS_UNKNOWN" };
  }
  const ratioRaw = input.wrapper.tokenToShareRatioRaw;
  if (ratioRaw === null) {
    return { underlyingEquivalent: null, normalizer, failure: "MISSING_RATIO" };
  }

  const result = normalizer.normalize({
    ratioRaw,
    tokenAmountDecimal: input.tokenAmountDecimal,
  });
  if (result === null) {
    return { underlyingEquivalent: null, normalizer, failure: "UNREADABLE_INPUT" };
  }
  return { underlyingEquivalent: result, normalizer, failure: null };
}

/** True when at least one issuer's semantics are above UNKNOWN and rankable on. */
export function hasValidatedNormalization(): boolean {
  return ISSUER_NORMALIZERS.some((issuer) => issuer.semantics !== "UNKNOWN");
}
