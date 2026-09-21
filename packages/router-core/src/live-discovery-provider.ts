/**
 * Live `DiscoveryPort`: the real Binance-backed implementation.
 *
 * Lives in `router-core` (not `apps/web`) so the exact same implementation
 * backs both the product's server-side discovery boundary
 * (`apps/web/src/server/discovery.ts`) and the standalone live-validation
 * harness (`scripts/validate/route.ts`). One implementation, two callers —
 * a bug fixed here is fixed in both places, and a validation-harness result
 * is evidence about the same code path the product actually runs, not a
 * parallel "test version" that could silently drift from it.
 *
 * `LiveSponsorServices` is intentionally the minimal structural shape this
 * class needs (rwa/token/trading/transaction/wallet), not `apps/web`'s
 * `BinanceServices` type — either satisfies it via structural typing, so
 * neither caller needs an adapter.
 *
 * Every method here is structurally complete — typed, wired to the signed
 * client, schema-validated — and every method is `BLOCKED_CREDENTIALS` for
 * whether it actually produces correct results, per
 * `internal/product/CLAIM_LEDGER.md`. Nothing in this file may be marked
 * API_VERIFIED until it has actually run against Binance.
 *
 * This is never constructed alongside `FixtureDiscoveryProvider` in the same
 * process path — see `apps/web/src/server/discovery.ts`, which picks exactly
 * one at startup.
 */

import type {
  RwaService,
  TokenService,
  TradingService,
  TransactionService,
  WalletService,
} from "@taloe/binance-web3";
import type {
  AssetMetadata,
  ExecutableRoute,
  MarketContext,
  Quote,
  RouteRejection,
  SimulationResult,
  Underlying,
  WrapperCandidate,
} from "@taloe/shared";
import { interpretSession } from "@taloe/session-mark";

import type { CandidateQuoteResult, DiscoveryPort, Discovered } from "./discovery-port";
import { discoveryErr, discoveryOk } from "./discovery-port";

export interface LiveSponsorServices {
  readonly rwa: RwaService;
  readonly token: TokenService;
  readonly trading: TradingService;
  readonly transaction: TransactionService;
  readonly wallet: WalletService;
}

/**
 * BSC BEP-20 USDT contract address. This is a well-known, permanent contract
 * address (not a fact that changes), which is why it is safe to hold as a
 * constant. Its DECIMALS are explicitly NOT assumed here — see
 * `resolveSpendAsset`, which resolves them from a live call.
 */
const USDT_BSC_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";

/**
 * Ondo and BStock documented market-hours business codes (PRD 5.4 / current
 * Trading API docs). Used to translate a business-level refusal into an
 * attributable PRE_QUOTE rejection rather than a generic transport failure —
 * this is the live-side half of correction 3's issuer-divergence mechanism.
 */
const MARKET_HOURS_BUSINESS_CODES = new Set([40367, 40369]);

export class LiveDiscoveryProvider implements DiscoveryPort {
  readonly mode = "live" as const;

  constructor(private readonly services: LiveSponsorServices) {}

  async resolveSpendAsset(chainId: string): Promise<Discovered<AssetMetadata>> {
    const result = await this.services.token.getBasicInfo(chainId, USDT_BSC_ADDRESS);
    if (!result.ok) {
      return discoveryErr({
        kind: "SPONSOR_UNAVAILABLE",
        message: `could not resolve USDT metadata: ${result.error.message}`,
        cause: result.error,
      });
    }
    if (result.value.decimals === null) {
      // Fails closed rather than assuming 18. See correction 2.
      return discoveryErr({
        kind: "SPONSOR_UNAVAILABLE",
        message: "token basic-info response did not include decimals for USDT",
      });
    }
    return discoveryOk({
      symbol: result.value.symbol ?? "USDT",
      contractAddress: USDT_BSC_ADDRESS,
      decimals: result.value.decimals,
      chainId,
      provenance: "live:token/basic-info",
    });
  }

  async searchUnderlying(query: string, chainId: string) {
    const result = await this.services.rwa.search(query, chainId);
    if (!result.ok) {
      return discoveryErr({
        kind: "SPONSOR_UNAVAILABLE",
        message: result.error.message,
        cause: result.error,
      });
    }
    const byTicker = new Map<string, { underlying: Underlying; count: number }>();
    for (const candidate of result.value) {
      if (!candidate.underlyingTicker) continue;
      const key = candidate.underlyingTicker.toUpperCase();
      const existing = byTicker.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      byTicker.set(key, {
        underlying: {
          ticker: candidate.underlyingTicker,
          // RWA search does not carry a company name field per the current
          // schema (see SPONSOR_FINDINGS F-005); the underlying-profile call
          // in a subsequent step is the real source. Echoing the ticker here
          // rather than inventing a name.
          companyName: candidate.underlyingTicker,
          sector: null,
          logoUrl: null,
          provenance: ["live:rwa/search"],
        },
        count: 1,
      });
    }
    return discoveryOk(
      [...byTicker.values()].map((v) => ({ underlying: v.underlying, identifiedWrapperCount: v.count })),
    );
  }

  async discoverCandidates(
    underlyingTicker: string,
    chainId: string,
  ): Promise<Discovered<readonly WrapperCandidate[]>> {
    const result = await this.services.rwa.search(underlyingTicker, chainId);
    if (!result.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: result.error.message, cause: result.error });
    }
    return discoveryOk(
      result.value.filter(
        (candidate) => candidate.underlyingTicker.toUpperCase() === underlyingTicker.toUpperCase(),
      ),
    );
  }

  async getMarketContext(underlyingTicker: string): Promise<Discovered<MarketContext | null>> {
    const result = await this.services.rwa.getUnderlyingMarket(underlyingTicker);
    if (!result.ok) {
      // Market/session context being unavailable is not necessarily a hard
      // failure of discovery — the engine already treats a null context as
      // "cannot check the deviation constraint" and returns UNKNOWN.
      return discoveryOk(null);
    }
    return discoveryOk(
      interpretSession({
        underlyingTicker,
        marketStatus: result.value.marketStatus,
        openState: result.value.openState,
        referencePrice: result.value.referencePrice,
        referenceTime: result.value.time,
        nextOpenTime: result.value.nextOpenTime,
        nextCloseTime: result.value.nextCloseTime,
        statusInfo: result.value.statusInfo,
        provenance: ["live:rwa/underlying-market"],
      }),
    );
  }

  async getQuotesForCandidate(
    candidate: WrapperCandidate,
    params: {
      chainId: string;
      spendTokenAddress: string;
      spendAmountBaseUnits: string;
      walletAddress: string | null;
      now: Date;
    },
  ): Promise<Discovered<CandidateQuoteResult>> {
    const result = await this.services.trading.getQuotes({
      binanceChainId: params.chainId,
      fromTokenAddress: params.spendTokenAddress,
      toTokenAddress: candidate.tokenContractAddress,
      amount: params.spendAmountBaseUnits,
      userWalletAddress: params.walletAddress,
    });

    if (!result.ok) {
      // Documented market-hours restriction -> attributable PRE_QUOTE
      // rejection, not a generic sponsor failure. This is the live half of
      // the issuer-divergence mechanism (correction 3).
      if (result.error.businessCode !== null && MARKET_HOURS_BUSINESS_CODES.has(result.error.businessCode)) {
        const rejection: RouteRejection = {
          routeId: `no-quote:${candidate.platformId ?? "unknown"}:${candidate.tokenSymbol}`,
          wrapperSymbol: candidate.tokenSymbol,
          platformId: candidate.platformId,
          reasons: ["OUTSIDE_TRADING_HOURS"],
          stage: "PRE_QUOTE",
        };
        return discoveryOk({ routes: [], preRejected: rejection });
      }
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: result.error.message, cause: result.error });
    }

    const routes: ExecutableRoute[] = result.value.map((quote: Quote) => ({
      routeId: `${candidate.tokenContractAddress}:${quote.executionMode}:${quote.quoteId}`,
      wrapper: candidate,
      quote,
    }));
    return discoveryOk({ routes, preRejected: null });
  }

  /**
   * PRD 12.1's full pre-sign flow: quote (already held by `route`) -> build
   * -> simulate. Wired end to end against the canonical current Transaction
   * API contract (see `TransactionService.simulate` for the exact shape and
   * the documented SUCCESS/failReason inconsistency it fails closed on).
   *
   * Never called for RFQ routes — the orchestration layer only invokes this
   * for `executionMode === "SWAP"` (PRD: RFQ settles vendor-side and the
   * client never holds a transaction to simulate).
   */
  async simulateRoute(
    route: ExecutableRoute,
    params: { chainId: string; walletAddress: string; spendTokenAddress: string; now: Date },
  ): Promise<Discovered<SimulationResult>> {
    const build = await this.services.trading.buildSwap({
      binanceChainId: params.chainId,
      quoteId: route.quote.quoteId,
      fromTokenAddress: params.spendTokenAddress,
      toTokenAddress: route.wrapper.tokenContractAddress,
      amount: route.quote.fromTokenAmount,
      userWalletAddress: params.walletAddress,
    });
    if (!build.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: build.error.message, cause: build.error });
    }

    const tx = build.value.tx;
    if (!tx?.from || !tx.to || !tx.data) {
      // A route we believed was SWAP returned no usable EVM transaction to
      // simulate — either the runtime executionMode changed between quote
      // and build, or the response is malformed. Fail closed rather than
      // simulate a guessed payload.
      return discoveryErr({
        kind: "SPONSOR_UNAVAILABLE",
        message: "swap build response did not include a complete EVM transaction (from/to/data) to simulate",
      });
    }

    const simulation = await this.services.transaction.simulate({
      binanceChainId: params.chainId,
      evmTx: { from: tx.from, to: tx.to, value: tx.value ?? "0", data: tx.data },
    });
    if (!simulation.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: simulation.error.message, cause: simulation.error });
    }
    return discoveryOk(simulation.value);
  }

  async getWalletBalances(walletAddress: string, spendAsset: AssetMetadata, chainId: string) {
    const result = await this.services.wallet.getTokenBalances(chainId, walletAddress);
    if (!result.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: result.error.message, cause: result.error });
    }
    const spendEntry = result.value.tokenAssets.find(
      (asset) => asset.tokenContractAddress?.toLowerCase() === spendAsset.contractAddress.toLowerCase(),
    );
    // The wallet-balances endpoint path itself is unconfirmed (see
    // internal/sponsor/API_MATRIX.md A-06), and whether native BNB appears in
    // this same list under a documented convention (e.g. a zero address) is
    // unverified. Rather than guess a convention, gas balance is reported as
    // not checkable until that is confirmed against a live response.
    return discoveryOk({
      spendBalanceBaseUnits: spendEntry?.balance ?? null,
      gasBalanceWei: null,
    });
  }
}
