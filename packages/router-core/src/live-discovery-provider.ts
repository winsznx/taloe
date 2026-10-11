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

import { DEFAULT_BSC_RPC_URL, readErc20Allowance } from "./chain-reader";
import type { CandidateQuoteResult, DiscoveryPort, Discovered, UnsignedEvmTransaction } from "./discovery-port";
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
/** How the balances endpoint labels native BNB (docs say empty string; live says this). */
const NATIVE_PLACEHOLDER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/** Explicit slippage bound applied when building the swap for simulation. Provisional; see DECISIONS. */
const SIMULATION_SLIPPAGE_PERCENT = "1";

const MARKET_HOURS_BUSINESS_CODES = new Set([40367, 40369]);

export class LiveDiscoveryProvider implements DiscoveryPort {
  readonly mode = "live" as const;

  /** BSC mainnet is product-locked (PRD 1); kept as a constructor option only for tests. */
  constructor(
    private readonly services: LiveSponsorServices,
    private readonly chainId: string = "56",
    private readonly rpc: { rpcUrl: string; fetchImpl?: typeof fetch } = { rpcUrl: DEFAULT_BSC_RPC_URL },
  ) {}

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
    const result = await this.services.rwa.searchGroups(query);
    if (!result.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: result.error.message, cause: result.error });
    }
    const matches = result.value
      .map((group) => ({
        group,
        onChain: group.assets.filter((asset) => asset.binanceChainId === chainId),
      }))
      .filter((entry) => entry.onChain.length > 0)
      .map(({ group, onChain }) => ({
        underlying: {
          ticker: group.ticker,
          companyName: group.companyName ?? group.ticker,
          sector: null,
          logoUrl: null,
          provenance: ["live:rwa/search"],
        } satisfies Underlying,
        identifiedWrapperCount: onChain.length,
      }));
    // /rwa/search is a fuzzy keyword search (live: "QQQ" also returns TQQQ, SQQQ,
    // PSQ). A query that exactly equals one returned ticker is not ambiguous, so
    // that ticker wins; only genuinely non-exact queries stay ambiguous (PRD 11.1).
    const exact = matches.filter((m) => m.underlying.ticker.toUpperCase() === query.trim().toUpperCase());
    return discoveryOk(exact.length === 1 ? exact : matches);
  }

  async discoverCandidates(
    underlyingTicker: string,
    chainId: string,
  ): Promise<Discovered<readonly WrapperCandidate[]>> {
    const result = await this.services.rwa.getWrapperCandidates(underlyingTicker, chainId);
    if (!result.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: result.error.message, cause: result.error });
    }
    return discoveryOk(result.value);
  }

  /**
   * Underlying-level context, taken from the first wrapper that actually
   * reports a market status. Observed live: Ondo reports `marketStatus`
   * (e.g. "postmarket") while bStock reports null, and the two platforms
   * report different `referencePrice` values for the same underlying at the
   * same instant — so this context is one wrapper's view, recorded in
   * provenance, never a claim about "the" NVDA price.
   */
  async getMarketContext(underlyingTicker: string): Promise<Discovered<MarketContext | null>> {
    const candidates = await this.services.rwa.getWrapperCandidates(underlyingTicker, this.chainId);
    if (!candidates.ok) return discoveryOk(null);
    const withStatus = candidates.value.find((c) => c.statusInfo?.marketStatus) ?? candidates.value[0];
    if (!withStatus) return discoveryOk(null);
    return discoveryOk(
      interpretSession({
        underlyingTicker,
        marketStatus: withStatus.statusInfo?.marketStatus ?? null,
        openState: withStatus.statusInfo?.openState ?? null,
        referencePrice: withStatus.referencePrice,
        referenceTime: null,
        nextOpenTime: withStatus.statusInfo?.nextOpenTime ?? null,
        nextCloseTime: withStatus.statusInfo?.nextCloseTime ?? null,
        statusInfo: withStatus.statusInfo,
        provenance: [`live:rwa/underlying-market via ${withStatus.tokenSymbol}`],
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
  /** Shared by `simulateRoute` and `buildSwapTransaction` so there is exactly one build call shape. */
  private async buildSwapTx(
    route: ExecutableRoute,
    params: { chainId: string; walletAddress: string; spendTokenAddress: string },
  ): Promise<Discovered<UnsignedEvmTransaction>> {
    const build = await this.services.trading.buildSwap({
      binanceChainId: params.chainId,
      quoteId: route.quote.quoteId,
      fromTokenAddress: params.spendTokenAddress,
      toTokenAddress: route.wrapper.tokenContractAddress,
      amount: route.quote.fromTokenAmount,
      userWalletAddress: params.walletAddress,
      // /swap REQUIRES slippagePercent or autoSlippage (observed 40001 without either).
      // An explicit, reviewable bound is used rather than vendor-chosen autoSlippage.
      slippagePercent: SIMULATION_SLIPPAGE_PERCENT,
    });
    if (!build.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: build.error.message, cause: build.error });
    }
    const tx = build.value.tx;
    if (!tx?.from || !tx.to || !tx.data) {
      // A route we believed was SWAP returned no usable EVM transaction —
      // either the runtime executionMode changed between quote and build, or
      // the response is malformed. Fail closed rather than act on a guess.
      return discoveryErr({
        kind: "SPONSOR_UNAVAILABLE",
        message: "swap build response did not include a complete EVM transaction (from/to/data)",
      });
    }
    return discoveryOk({ from: tx.from, to: tx.to, value: tx.value ?? "0", data: tx.data });
  }

  async simulateRoute(
    route: ExecutableRoute,
    params: { chainId: string; walletAddress: string; spendTokenAddress: string; now: Date },
  ): Promise<Discovered<SimulationResult>> {
    const built = await this.buildSwapTx(route, params);
    if (!built.ok) return built;

    const simulation = await this.services.transaction.simulate({
      binanceChainId: params.chainId,
      evmTx: built.value,
    });
    if (!simulation.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: simulation.error.message, cause: simulation.error });
    }
    return discoveryOk(simulation.value);
  }

  async buildSwapTransaction(
    route: ExecutableRoute,
    params: { chainId: string; walletAddress: string; spendTokenAddress: string },
  ): Promise<Discovered<UnsignedEvmTransaction>> {
    return this.buildSwapTx(route, params);
  }

  async getWalletBalances(walletAddress: string, spendAsset: AssetMetadata, chainId: string) {
    const result = await this.services.wallet.getTokenBalances(chainId, walletAddress, [
      spendAsset.contractAddress,
      "", // native asset per the docs
    ]);
    if (!result.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: result.error.message, cause: result.error });
    }
    const spend = result.value.tokenAssets.find(
      (a) => a.tokenContractAddress?.toLowerCase() === spendAsset.contractAddress.toLowerCase(),
    );
    // Documented as "" but observed as 0xeeee...eeee, symbol BNB.
    const native = result.value.tokenAssets.find(
      (a) => a.tokenContractAddress?.toLowerCase() === NATIVE_PLACEHOLDER || a.tokenContractAddress === "",
    );
    return discoveryOk({
      spendBalanceBaseUnits: spend?.rawBalance ?? null,
      gasBalanceWei: native?.rawBalance ?? null,
    });
  }

  async getAllowance(params: { chainId: string; tokenAddress: string; owner: string; spender: string }) {
    const result = await readErc20Allowance(this.rpc, params);
    return result.ok
      ? discoveryOk(result.value)
      : discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: `allowance read failed: ${result.message}` });
  }

  async buildApprovalTransaction(params: {
    chainId: string;
    tokenAddress: string;
    walletAddress: string;
    amountBaseUnits: string;
  }): Promise<Discovered<UnsignedEvmTransaction>> {
    const result = await this.services.trading.getApprovalTransaction({
      binanceChainId: params.chainId,
      tokenContractAddress: params.tokenAddress,
      approveAmount: params.amountBaseUnits,
    });
    if (!result.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: result.error.message, cause: result.error });
    }
    const first = Array.isArray(result.value) ? result.value[0] : result.value;
    if (!first?.data) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: "approve-transaction returned no calldata" });
    }
    // The approval is sent to the token contract; the spender is inside the calldata.
    return discoveryOk({ from: params.walletAddress, to: params.tokenAddress, value: "0", data: first.data });
  }

  async simulateTransaction(params: {
    chainId: string;
    transaction: UnsignedEvmTransaction;
    now: Date;
  }): Promise<Discovered<SimulationResult>> {
    const simulation = await this.services.transaction.simulate({
      binanceChainId: params.chainId,
      evmTx: params.transaction,
    });
    if (!simulation.ok) {
      return discoveryErr({ kind: "SPONSOR_UNAVAILABLE", message: simulation.error.message, cause: simulation.error });
    }
    return discoveryOk(simulation.value);
  }
}
