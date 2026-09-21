/**
 * SYNTHETIC test fixtures. Not evidence.
 *
 * These are hand-built shapes used to exercise router logic without
 * credentials. They are explicitly NOT observations of live Binance
 * behaviour and must never be cited in the claim ledger, the DX report, the
 * evaluation campaign or any public claim. Sanitized real responses, when we
 * have them, will live separately and carry their observation date.
 */

import type {
  EquityIntent,
  ExecutableRoute,
  ExecutionMode,
  MarketContext,
  Underlying,
  WrapperCandidate,
} from "@taloe/shared";

export const SYNTHETIC = true as const;

export const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";

export const NVDA_UNDERLYING: Underlying = {
  ticker: "NVDA",
  companyName: "NVIDIA Corporation",
  sector: "Technology",
  logoUrl: null,
  provenance: ["fixture:synthetic"],
};

export function makeIntent(overrides: Partial<EquityIntent> = {}): EquityIntent {
  return {
    intentId: "intent-test",
    underlyingQuery: "NVDA",
    underlyingTicker: "NVDA",
    spendToken: "USDT",
    spendTokenAddress: USDT_BSC,
    spendTokenDecimals: 18,
    spendAmountBaseUnits: "500000000000000000000", // 500 USDT
    walletAddress: "0x1111111111111111111111111111111111111111",
    binanceChainId: "56",
    maxDeviationBps: 150,
    createdAt: "2026-09-21T12:00:00.000Z",
    ...overrides,
  };
}

export function makeWrapper(overrides: Partial<WrapperCandidate> = {}): WrapperCandidate {
  return {
    platformId: "ondo",
    tokenContractAddress: "0x2222222222222222222222222222222222222222",
    tokenSymbol: "NVDAon",
    tokenName: "Ondo NVIDIA",
    decimals: 18,
    underlyingTicker: "NVDA",
    tokenToShareRatioRaw: "1",
    tokenPrice: "100",
    referencePrice: "100",
    statusInfo: null,
    semanticConfidence: "VERIFIED",
    provenance: ["fixture:synthetic"],
    ...overrides,
  };
}

export function makeRoute(params: {
  routeId: string;
  wrapper?: Partial<WrapperCandidate>;
  executionMode?: ExecutionMode;
  /** Wrapper tokens out, in base units. */
  toTokenAmount?: string;
  priceImpactPercent?: string | null;
  tradeFeeUsd?: string | null;
  /** Milliseconds of estimated quote life remaining, relative to `now`. */
  remainingMs?: number;
  now?: Date;
}): ExecutableRoute {
  const now = params.now ?? new Date("2026-09-21T12:00:00.000Z");
  const remainingMs = params.remainingMs ?? 25_000;
  return {
    routeId: params.routeId,
    wrapper: makeWrapper(params.wrapper),
    quote: {
      quoteId: `quote-${params.routeId}`,
      vendorName: "PcsXRfq",
      executionMode: params.executionMode ?? "SWAP",
      fromTokenAmount: "500000000000000000000",
      toTokenAmount: params.toTokenAmount ?? "5000000000000000000", // 5 tokens
      tradeFeeUsd: params.tradeFeeUsd ?? "0.5",
      estimatedGas: "210000",
      priceImpactPercent:
        params.priceImpactPercent === undefined ? "0.1" : params.priceImpactPercent,
      routePath: "USDT -> NVDAon",
      approveTarget: "0x3333333333333333333333333333333333333333",
      quoteObservedAt: now.toISOString(),
      quoteExpiresAtEstimate: new Date(now.getTime() + remainingMs).toISOString(),
      apiIsBest: null,
    },
  };
}

export function makeMarketContext(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    underlyingTicker: "NVDA",
    sessionState: "REGULAR",
    rawMarketStatus: "REGULAR",
    referencePrice: "100",
    referenceObservedAt: "2026-09-21T11:59:30.000Z",
    referenceAgeMs: 30_000,
    isHalted: false,
    nextOpenTime: null,
    nextCloseTime: null,
    provenance: ["fixture:synthetic"],
    ...overrides,
  };
}
