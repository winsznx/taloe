/**
 * Fixture-mode `DiscoveryPort`.
 *
 * SYNTHETIC. Not evidence about live Binance behaviour — see the header in
 * `fixtures/candidates.ts`. This exists for frontend development, demos and
 * automated tests, and is only ever constructed when `TALOE_DATA_MODE=fixture`.
 * There is no code path from here back to a live call, and no code path from
 * a live failure into this file (apps/web/src/server/discovery.ts picks
 * exactly one provider at startup and never both).
 *
 * Scenarios are keyed by the search query (case-insensitive) so the same demo
 * is reproducible: typing "NVDA" always produces the same ACT decision,
 * typing "TSLA" always produces the issuer-divergence-under-a-closed-market
 * case, and so on. Every outcome the product can produce has a named
 * scenario, listed in `FIXTURE_SCENARIOS` below.
 */

import type {
  AssetMetadata,
  ExecutableRoute,
  MarketContext,
  Quote,
  SimulationResult,
  Underlying,
  WrapperCandidate,
} from "@taloe/shared";

import type {
  CandidateQuoteResult,
  DiscoveryPort,
  Discovered,
} from "../src/discovery-port";
import { discoveryErr, discoveryOk } from "../src/discovery-port";

const USDT_FIXTURE: AssetMetadata = {
  symbol: "USDT",
  contractAddress: "0x55d398326f99059fF775485246999027B3197955",
  decimals: 18,
  chainId: "56",
  provenance: "fixture:asset-registry",
};

function underlying(ticker: string, companyName: string): Underlying {
  return {
    ticker,
    companyName,
    sector: "Technology",
    logoUrl: null,
    provenance: ["fixture:synthetic"],
  };
}

function wrapper(overrides: Partial<WrapperCandidate>): WrapperCandidate {
  return {
    platformId: "xstock",
    tokenContractAddress: "0x2222222222222222222222222222222222222222",
    tokenSymbol: "TESTx",
    tokenName: "Fixture Test",
    decimals: 18,
    underlyingTicker: "TEST",
    tokenToShareRatioRaw: null,
    tokenPrice: "100",
    referencePrice: "100",
    statusInfo: null,
    semanticConfidence: "PARTIAL",
    provenance: ["fixture:synthetic"],
    ...overrides,
  };
}

function quote(overrides: Partial<Quote>, now: Date): Quote {
  return {
    quoteId: `fixture-quote-${Math.random().toString(36).slice(2, 8)}`,
    vendorName: "FixtureVendor",
    executionMode: "SWAP",
    fromTokenAmount: "500000000000000000000",
    toTokenAmount: "5000000000000000000",
    tradeFeeUsd: "0.5",
    estimatedGas: "210000",
    priceImpactPercent: "0.1",
    routePath: "USDT -> TEST",
    approveTarget: "0x3333333333333333333333333333333333333333",
    quoteObservedAt: now.toISOString(),
    quoteExpiresAtEstimate: new Date(now.getTime() + 25_000).toISOString(),
    apiIsBest: null,
    ...overrides,
  };
}

function marketContext(overrides: Partial<MarketContext>, ticker: string): MarketContext {
  return {
    underlyingTicker: ticker,
    sessionState: "REGULAR",
    rawMarketStatus: "REGULAR",
    referencePrice: "100",
    referenceObservedAt: new Date().toISOString(),
    referenceAgeMs: 5_000,
    isHalted: false,
    nextOpenTime: null,
    nextCloseTime: null,
    provenance: ["fixture:synthetic"],
    ...overrides,
  };
}

interface Scenario {
  readonly underlying: Underlying;
  readonly candidates: readonly WrapperCandidate[];
  readonly marketContext: MarketContext | null;
  buildQuotes(
    candidate: WrapperCandidate,
    now: Date,
  ): CandidateQuoteResult;
}

/**
 * One scenario per outcome the product must be able to demonstrate honestly
 * without credentials. Documented here so this doubles as a scenario index
 * for manual QA and for the demo script.
 */
const SCENARIOS: Readonly<Record<string, () => Scenario>> = {
  // ACT — two comparable-but-unnormalized wrappers, regular session.
  NVDA: () => ({
    underlying: underlying("NVDA", "NVIDIA Corporation"),
    candidates: [
      wrapper({
        platformId: "ondo",
        tokenContractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tokenSymbol: "NVDAon",
        tokenName: "Ondo NVIDIA",
        underlyingTicker: "NVDA",
      }),
      wrapper({
        platformId: "xstock",
        tokenContractAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        tokenSymbol: "NVDAx",
        tokenName: "xStock NVIDIA",
        underlyingTicker: "NVDA",
      }),
    ],
    marketContext: marketContext({}, "NVDA"),
    buildQuotes: (candidate, now) => ({
      routes: [
        route(
          candidate,
          quote(
            {
              executionMode: candidate.platformId === "ondo" ? "RFQ" : "SWAP",
              toTokenAmount: candidate.platformId === "ondo" ? "4980000000000000000" : "5000000000000000000",
            },
            now,
          ),
        ),
      ],
      preRejected: null,
    }),
  }),

  // ACT with a genuine issuer-divergence rejection under a CLOSED session —
  // the flagship correction-3 case. Ondo cannot be quoted (documented
  // market-hours restriction); BStock's SWAP route is unaffected and wins.
  TSLA: () => ({
    underlying: underlying("TSLA", "Tesla, Inc."),
    candidates: [
      wrapper({
        platformId: "ondo",
        tokenContractAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
        tokenSymbol: "TSLAon",
        tokenName: "Ondo Tesla",
        underlyingTicker: "TSLA",
      }),
      wrapper({
        platformId: "bstock",
        tokenContractAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
        tokenSymbol: "TSLAB",
        tokenName: "BStock Tesla",
        underlyingTicker: "TSLA",
      }),
    ],
    marketContext: marketContext({ sessionState: "CLOSED", rawMarketStatus: "CLOSED", isHalted: false }, "TSLA"),
    buildQuotes: (candidate, now) => {
      if (candidate.platformId === "ondo") {
        return {
          routes: [],
          preRejected: {
            routeId: `no-quote:ondo:${candidate.tokenSymbol}`,
            wrapperSymbol: candidate.tokenSymbol,
            platformId: "ondo",
            reasons: ["OUTSIDE_TRADING_HOURS"],
            stage: "PRE_QUOTE",
          },
        };
      }
      return {
        routes: [route(candidate, quote({ executionMode: "SWAP" }, now))],
        preRejected: null,
      };
    },
  }),

  // REFUSE — single candidate, quote priced outside the user's deviation limit.
  AAPL: () => ({
    underlying: underlying("AAPL", "Apple Inc."),
    candidates: [
      wrapper({
        platformId: "xstock",
        tokenContractAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        tokenSymbol: "AAPLx",
        tokenName: "xStock Apple",
        underlyingTicker: "AAPL",
      }),
    ],
    marketContext: marketContext({}, "AAPL"),
    buildQuotes: (candidate, now) => ({
      // 500 USDT for 1 token against a 100 reference is wildly outside any
      // reasonable deviation limit.
      routes: [route(candidate, quote({ toTokenAmount: "1000000000000000000" }, now))],
      preRejected: null,
    }),
  }),

  // REFUSE — quote already past its estimated lifetime by the time it's evaluated.
  EXPIRED: () => ({
    underlying: underlying("EXPIRED", "Expired Quote Test Co."),
    candidates: [wrapper({ platformId: "xstock", underlyingTicker: "EXPIRED" })],
    marketContext: marketContext({}, "EXPIRED"),
    buildQuotes: (candidate, now) => ({
      routes: [
        route(
          candidate,
          quote({ quoteExpiresAtEstimate: new Date(now.getTime() - 5_000).toISOString() }, now),
        ),
      ],
      preRejected: null,
    }),
  }),

  // REFUSE — SWAP candidate whose simulation is made to fail (see simulateRoute below).
  FAILSIM: () => ({
    underlying: underlying("FAILSIM", "Failed Simulation Test Co."),
    candidates: [wrapper({ platformId: "xstock", underlyingTicker: "FAILSIM" })],
    marketContext: marketContext({}, "FAILSIM"),
    buildQuotes: (candidate, now) => ({
      routes: [route(candidate, quote({ executionMode: "SWAP" }, now))],
      preRejected: null,
    }),
  }),

  // UNKNOWN — candidates exist but the market/reference context is unavailable.
  QQQ: () => ({
    underlying: underlying("QQQ", "Invesco QQQ Trust"),
    candidates: [wrapper({ platformId: "xstock", underlyingTicker: "QQQ" })],
    marketContext: null,
    buildQuotes: (candidate, now) => ({
      routes: [route(candidate, quote({ executionMode: "SWAP" }, now))],
      preRejected: null,
    }),
  }),

  // NO_ACTION — alreadyHoldsTargetExposure short-circuits before quoting.
  HOLD: () => ({
    underlying: underlying("HOLD", "Already Held Test Co."),
    candidates: [wrapper({ platformId: "xstock", underlyingTicker: "HOLD" })],
    marketContext: marketContext({}, "HOLD"),
    buildQuotes: (candidate, now) => ({
      routes: [route(candidate, quote({ executionMode: "SWAP" }, now))],
      preRejected: null,
    }),
  }),

  // REFUSE — wallet balance insufficient for the requested spend. Trigger by
  // connecting the fixture wallet address that starts with 0xf00d.
  POOR: () => ({
    underlying: underlying("POOR", "Insufficient Balance Test Co."),
    candidates: [wrapper({ platformId: "xstock", underlyingTicker: "POOR" })],
    marketContext: marketContext({}, "POOR"),
    buildQuotes: (candidate, now) => ({
      routes: [route(candidate, quote({ executionMode: "SWAP" }, now))],
      preRejected: null,
    }),
  }),

  // ACT — the resolved target of the MANUAL_REVIEW disambiguation demo above.
  METAPLT: () => ({
    underlying: underlying("METAPLT", "Meta Platforms, Inc."),
    candidates: [wrapper({ platformId: "xstock", underlyingTicker: "METAPLT", tokenSymbol: "METAx" })],
    marketContext: marketContext({}, "METAPLT"),
    buildQuotes: (candidate, now) => ({
      routes: [route(candidate, quote({ executionMode: "SWAP" }, now))],
      preRejected: null,
    }),
  }),

  // REFUSE — a wrapper we found but cannot safely identify (no contract
  // address / decimals), so it is shown but excluded from ranking.
  UNSUP: () => ({
    underlying: underlying("UNSUP", "Unsupported Mapping Test Co."),
    candidates: [
      wrapper({
        platformId: "xstock",
        underlyingTicker: "UNSUP",
        tokenContractAddress: "",
        semanticConfidence: "UNSUPPORTED",
      }),
    ],
    marketContext: marketContext({}, "UNSUP"),
    buildQuotes: (candidate, now) => ({
      routes: [route(candidate, quote({ executionMode: "SWAP" }, now))],
      preRejected: null,
    }),
  }),
};

/** Underlying searches that simulate the sponsor API itself being unreachable. */
const SPONSOR_DOWN_QUERY = "DOWN";

/** Underlying searches that deliberately resolve to more than one distinct company. */
const AMBIGUOUS_QUERY = "META";

function route(wrapperCandidate: WrapperCandidate, q: Quote): ExecutableRoute {
  return {
    routeId: `fixture-route-${wrapperCandidate.tokenSymbol}-${q.executionMode}`,
    wrapper: wrapperCandidate,
    quote: q,
  };
}

export const FIXTURE_SCENARIOS = {
  ACT_TWO_WRAPPERS: "NVDA",
  ACT_ISSUER_DIVERGENCE_CLOSED_MARKET: "TSLA",
  REFUSE_EXCEEDS_DEVIATION: "AAPL",
  REFUSE_QUOTE_EXPIRED: "EXPIRED",
  REFUSE_SIMULATION_FAILED: "FAILSIM",
  REFUSE_INSUFFICIENT_BALANCE: "POOR",
  REFUSE_UNSUPPORTED_MAPPING: "UNSUP",
  UNKNOWN_NO_MARKET_CONTEXT: "QQQ",
  UNKNOWN_SPONSOR_UNAVAILABLE: SPONSOR_DOWN_QUERY,
  NO_ACTION_ALREADY_HELD: "HOLD",
  MANUAL_REVIEW_AMBIGUOUS: AMBIGUOUS_QUERY,
} as const;

/** Fixture wallet address that demonstrates the insufficient-balance state. */
export const FIXTURE_POOR_WALLET_ADDRESS = "0xf00dd00dd00dd00dd00dd00dd00dd00dd00dd00d".slice(0, 42);
/** Any other address has ample fixture balances. */
export const FIXTURE_DEFAULT_WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";

export class FixtureDiscoveryProvider implements DiscoveryPort {
  readonly mode = "fixture" as const;

  async resolveSpendAsset(): Promise<Discovered<AssetMetadata>> {
    return discoveryOk(USDT_FIXTURE);
  }

  async searchUnderlying(query: string, _chainId: string) {
    void _chainId; // fixture mode does not branch on chain
    const key = query.trim().toUpperCase();

    if (key === SPONSOR_DOWN_QUERY) {
      return discoveryErr({
        kind: "SPONSOR_UNAVAILABLE",
        message: "fixture: simulated RWA search outage",
      });
    }

    if (key === AMBIGUOUS_QUERY) {
      return discoveryOk([
        {
          underlying: underlying("METAPLT", "Meta Platforms, Inc."),
          identifiedWrapperCount: 1,
        },
        {
          // Deliberately synthetic near-collision, clearly not a real Binance
          // mapping, purely to exercise the disambiguation path. Picking this
          // one demonstrates that disambiguation does not guarantee a full
          // scenario exists for the chosen company — an honest gap, not a bug.
          underlying: underlying("METAMTX", "Meta Materials Inc. (fixture lookalike)"),
          identifiedWrapperCount: 1,
        },
      ]);
    }

    const build = SCENARIOS[key];
    if (!build) return discoveryOk([]);

    const scenario = build();
    return discoveryOk([
      { underlying: scenario.underlying, identifiedWrapperCount: scenario.candidates.length },
    ]);
  }

  async discoverCandidates(underlyingTicker: string): Promise<Discovered<readonly WrapperCandidate[]>> {
    const build = SCENARIOS[underlyingTicker.toUpperCase()];
    if (!build) return discoveryOk([]);
    return discoveryOk(build().candidates);
  }

  async getMarketContext(underlyingTicker: string): Promise<Discovered<MarketContext | null>> {
    const build = SCENARIOS[underlyingTicker.toUpperCase()];
    if (!build) return discoveryOk(null);
    return discoveryOk(build().marketContext);
  }

  async getQuotesForCandidate(
    candidate: WrapperCandidate,
    params: { now: Date },
  ): Promise<Discovered<CandidateQuoteResult>> {
    const build = SCENARIOS[candidate.underlyingTicker.toUpperCase()];
    if (!build) return discoveryErr({ kind: "NOT_FOUND", message: "no fixture scenario for this candidate" });
    return discoveryOk(build().buildQuotes(candidate, params.now));
  }

  async simulateRoute(
    route: ExecutableRoute,
    params: { now: Date },
  ): Promise<Discovered<SimulationResult>> {
    const failing = route.wrapper.underlyingTicker.toUpperCase() === "FAILSIM";
    const now = params.now;
    const result: SimulationResult = {
      status: failing ? "FAIL" : "PASS",
      failReason: failing ? "fixture: simulated revert (insufficient output amount)" : null,
      balanceChanges: failing
        ? []
        : [
            {
              contractAddress: route.wrapper.tokenContractAddress,
              tokenType: "ERC20",
              change: route.quote.toTokenAmount,
              owner: null,
            },
          ],
      allowanceChanges: [],
      observedAt: now.toISOString(),
      provenance: ["fixture:synthetic"],
    };
    return discoveryOk(result);
  }

  async getWalletBalances(walletAddress: string) {
    // Any wallet address matching this fixture pattern demonstrates
    // insufficient balance; everything else has plenty of both.
    if (walletAddress.toLowerCase().startsWith("0xf00d")) {
      return discoveryOk({ spendBalanceBaseUnits: "1000000000000000000", gasBalanceWei: "0" });
    }
    return discoveryOk({
      spendBalanceBaseUnits: "10000000000000000000000",
      gasBalanceWei: "1000000000000000000",
    });
  }
}
