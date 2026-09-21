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
 * All three currently UNKNOWN. That is the honest position: no live
 * `tokenToShareRatio` response has been observed for any issuer, and the
 * Wallet Skills "shares multiplier" reference is recorded as a related
 * signal for Ondo only — not treated as confirmation.
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
    semantics: "UNKNOWN",
    interpretation: null,
    provenance: [],
    relatedSignals: [
      "Binance Wallet Skills documentation (developers.binance.com, tokenized-securities " +
        "use case) references an Ondo-specific shares multiplier in the context of the " +
        "Agentic Wallet stock-trading flow. This is a different API surface from the RWA " +
        "Market API's `tokenToShareRatio` field, uses different terminology, and has not " +
        "been confirmed to describe the same quantity in the same direction. Recorded as a " +
        "signal worth checking first when live validation starts, not as an answer.",
    ],
    note:
      "Ondo trades exclusively via RFQ per the current Trading API docs. Its ratio direction " +
      "is unconfirmed on the RWA API. Fails closed until an actual token record is observed.",
    normalize: () => null,
  },
  {
    platformId: "bstock",
    displayName: "BStock",
    semantics: "UNKNOWN",
    interpretation: null,
    provenance: [],
    relatedSignals: [],
    note:
      "BStock returns mixed SWAP/RFQ routes for the same pair, which makes its normalization " +
      "load-bearing for cross-execution-mode comparison specifically. No related-signal " +
      "evidence has been found for this issuer; it starts from a strictly blank slate.",
    normalize: () => null,
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
