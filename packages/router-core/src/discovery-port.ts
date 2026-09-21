/**
 * The discovery boundary.
 *
 * `DiscoveryPort` is the ONE interface both a fixture-backed provider (dev,
 * tests, demos) and a live Binance-backed provider must satisfy. Nothing
 * upstream of this interface — `runRouteDiscovery`, the router engine, the
 * web app — knows or cares which one it is talking to. That is what makes
 * "no silent fallback from live to fixture" enforceable structurally rather
 * than by convention: there is no code path that catches a live failure and
 * reaches for the fixture provider, because the two are never in scope
 * together. Exactly one `DiscoveryPort` is constructed per process, chosen
 * once from `TALOE_DATA_MODE` at startup (see apps/web/src/server/discovery.ts).
 */

import type {
  AssetMetadata,
  ExecutableRoute,
  MarketContext,
  RouteRejection,
  SimulationResult,
  Underlying,
  WrapperCandidate,
} from "@taloe/shared";

export type DiscoveryErrorKind =
  | "SPONSOR_UNAVAILABLE"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "INVALID_INPUT";

export interface DiscoveryError {
  readonly kind: DiscoveryErrorKind;
  readonly message: string;
  /** Present for SPONSOR_UNAVAILABLE: which underlying Binance error caused it, if any. */
  readonly cause?: unknown;
}

export function discoveryOk<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}
export function discoveryErr(error: DiscoveryError): { ok: false; error: DiscoveryError } {
  return { ok: false, error };
}
export type Discovered<T> = { ok: true; value: T } | { ok: false; error: DiscoveryError };

export interface UnderlyingMatch {
  readonly underlying: Underlying;
  readonly identifiedWrapperCount: number;
}

export interface CandidateQuoteResult {
  /** Routes actually quoted for this candidate — zero or more execution modes. */
  readonly routes: readonly ExecutableRoute[];
  /**
   * Populated when the candidate could not be quoted at all for an
   * attributable, issuer-specific reason (most importantly a documented
   * market-hours restriction). Empty when routes were obtained, even if
   * those routes later fail a gate — that is a GATE-stage rejection the
   * engine itself produces, not a PRE_QUOTE one.
   */
  readonly preRejected: RouteRejection | null;
}

/**
 * One data source for everything WrapRoute needs to discover, quote and
 * simulate candidates. Implementations: `FixtureDiscoveryProvider` (this
 * package) and `LiveDiscoveryProvider` (apps/web/src/server, wraps the signed
 * Binance client).
 */
export interface DiscoveryPort {
  readonly mode: "fixture" | "live";

  /** Resolve the v1 funding asset (USDT) on the given chain. */
  resolveSpendAsset(chainId: string): Promise<Discovered<AssetMetadata>>;

  /**
   * Resolve a free-text query to the company/companies it could mean.
   * Zero matches and multiple distinct-company matches are both legitimate,
   * non-error results — the caller decides what UNDERLYING_NOT_RECOGNIZED or
   * UNDERLYING_MATCH_AMBIGUOUS means; this method just reports what it found.
   */
  searchUnderlying(query: string, chainId: string): Promise<Discovered<readonly UnderlyingMatch[]>>;

  /** All safely-identified wrapper candidates for one resolved underlying. */
  discoverCandidates(
    underlyingTicker: string,
    chainId: string,
  ): Promise<Discovered<readonly WrapperCandidate[]>>;

  /** Session/reference context for one underlying. Feeds SessionMark. */
  getMarketContext(underlyingTicker: string): Promise<Discovered<MarketContext | null>>;

  /**
   * Request an executable quote for one candidate at the given spend amount.
   * May legitimately return zero routes with a PRE_QUOTE rejection attached
   * (see `CandidateQuoteResult`) rather than a transport-level error — a
   * documented market-hours refusal is expected data, not a failure of the
   * discovery call itself.
   */
  getQuotesForCandidate(
    candidate: WrapperCandidate,
    params: {
      chainId: string;
      spendTokenAddress: string;
      spendAmountBaseUnits: string;
      walletAddress: string | null;
      /** The single clock the whole discovery pass evaluates against. */
      now: Date;
    },
  ): Promise<Discovered<CandidateQuoteResult>>;

  /**
   * Pre-sign SWAP simulation. Never called for RFQ routes.
   *
   * `spendTokenAddress` is required because a live implementation must first
   * rebuild the exact unsigned swap transaction (quote -> build -> simulate,
   * PRD 12.1) before it has anything to simulate — the route alone does not
   * carry the input token's address.
   */
  simulateRoute(
    route: ExecutableRoute,
    params: { chainId: string; walletAddress: string; spendTokenAddress: string; now: Date },
  ): Promise<Discovered<SimulationResult>>;

  /**
   * Spend-token and native-gas balances for a connected wallet. Returns null
   * for either when a balance genuinely cannot be determined (e.g. no wallet
   * connected) — callers must treat that as "not checkable," never as zero,
   * matching the same fail-closed-but-not-falsely-failing rule the engine
   * applies to every other uncheckable constraint.
   */
  getWalletBalances(
    walletAddress: string,
    spendAsset: AssetMetadata,
    chainId: string,
  ): Promise<Discovered<{ spendBalanceBaseUnits: string | null; gasBalanceWei: string | null }>>;
}
