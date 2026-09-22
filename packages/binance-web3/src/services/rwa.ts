/**
 * RWA data adapter (Market API surface).
 *
 * Rewritten 2026-09-21 against the live, observed contract (raw evidence in
 * internal/evidence/runtime/raw-*.json; docs: .../rest-api/rwa-data). The V1
 * version guessed a flat `/search` list and ticker-keyed profile/market
 * endpoints; live reality is:
 *
 *   /rwa/search            -> [{ticker, companyName, assets:[{platformId, binanceChainId, tokenContractAddress, tokenSymbol, assetType}]}]
 *   /rwa/tokens            -> full token records (decimals, ratio, status, prices). Observed to return FEWER tokens
 *                             than /rwa/platforms advertises (442/458 Ondo, 46/77 bStock on BSC), so it is used only
 *                             to enrich decimals, never as the authoritative universe.
 *   /rwa/price             -> batched, keyed by tokenContractAddresses
 *   /rwa/underlying-profile, /rwa/underlying-market -> keyed by (binanceChainId, tokenContractAddress)
 *
 * The adapter never invents an absent field. Unknown decimals make a wrapper
 * UNSUPPORTED rather than defaulting to 18 (correction 2).
 */

import type { Result, WrapperCandidate, WrapperStatusInfo } from "@taloe/shared";
import { err, ok } from "@taloe/shared";

import type { BinanceWeb3Client } from "../client";
import type { BinanceApiError } from "../errors";
import type { RwaToken } from "../schemas";
import { TokenService } from "./token";
import {
  rwaPlatformListSchema,
  rwaPriceListSchema,
  rwaSearchResultSchema,
  rwaTokenListSchema,
  rwaUnderlyingMarketSchema,
  rwaUnderlyingProfileSchema,
} from "../schemas";

export const RWA_PATHS = {
  platforms: "/api/v1/dex/market/rwa/platforms",
  price: "/api/v1/dex/market/rwa/price",
  search: "/api/v1/dex/market/rwa/search",
  tokens: "/api/v1/dex/market/rwa/tokens",
  underlyingProfile: "/api/v1/dex/market/rwa/underlying-profile",
  underlyingMarket: "/api/v1/dex/market/rwa/underlying-market",
} as const;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface RwaSearchGroup {
  readonly ticker: string;
  readonly companyName: string | null;
  readonly assets: readonly {
    readonly platformId: string | null;
    readonly binanceChainId: string | null;
    readonly tokenContractAddress: string;
    readonly tokenSymbol: string;
    readonly assetType: number | null;
  }[];
}

export class RwaService {
  private readonly token: TokenService;

  constructor(private readonly client: BinanceWeb3Client) {
    this.token = new TokenService(client);
  }

  listPlatforms() {
    return this.client.request({ method: "GET", path: RWA_PATHS.platforms, schema: rwaPlatformListSchema });
  }

  /** Underlying-grouped search. Each group's assets[] keeps every wrapper as its own record. */
  async searchGroups(keyword: string): Promise<Result<RwaSearchGroup[], BinanceApiError>> {
    const result = await this.client.request({
      method: "GET",
      path: RWA_PATHS.search,
      query: { keyword },
      schema: rwaSearchResultSchema,
    });
    if (!result.ok) return result;
    return ok(
      result.value
        .filter((group): group is typeof group & { ticker: string } => Boolean(group.ticker))
        .map((group) => ({
          ticker: group.ticker,
          companyName: group.companyName,
          assets: group.assets
            .filter((a) => a.tokenContractAddress && a.tokenSymbol)
            .map((a) => ({
              platformId: a.platformId,
              binanceChainId: a.binanceChainId,
              tokenContractAddress: a.tokenContractAddress as string,
              tokenSymbol: a.tokenSymbol as string,
              assetType: a.assetType,
            })),
        })),
    );
  }

  getTokenList(binanceChainId: string, platformId?: string) {
    return this.client.request({
      method: "GET",
      path: RWA_PATHS.tokens,
      query: { binanceChainId, platformId },
      schema: rwaTokenListSchema,
    });
  }

  getPrices(binanceChainId: string, tokenContractAddresses: readonly string[]) {
    return this.client.request({
      method: "GET",
      path: RWA_PATHS.price,
      query: { binanceChainId, tokenContractAddresses: tokenContractAddresses.join(",") },
      schema: rwaPriceListSchema,
    });
  }

  getUnderlyingProfile(binanceChainId: string, tokenContractAddress: string) {
    return this.client.request({
      method: "GET",
      path: RWA_PATHS.underlyingProfile,
      query: { binanceChainId, tokenContractAddress },
      schema: rwaUnderlyingProfileSchema,
    });
  }

  getUnderlyingMarket(binanceChainId: string, tokenContractAddress: string) {
    return this.client.request({
      method: "GET",
      path: RWA_PATHS.underlyingMarket,
      query: { binanceChainId, tokenContractAddress },
      schema: rwaUnderlyingMarketSchema,
    });
  }

  /**
   * Every wrapper for a ticker on one chain, each as its OWN candidate (two
   * platforms wrapping one underlying are never merged). Composed from search
   * (identity) + token list (decimals) + price + profile (ratio) + market
   * (status). Sequential per-wrapper calls stay well inside the documented
   * 5 RPS per-endpoint limit for the handful of wrappers per underlying.
   */
  async getWrapperCandidates(
    ticker: string,
    binanceChainId: string,
  ): Promise<Result<WrapperCandidate[], BinanceApiError>> {
    const search = await this.searchGroups(ticker);
    if (!search.ok) return search;

    const group = search.value.find((g) => g.ticker.toUpperCase() === ticker.toUpperCase());
    const assets = (group?.assets ?? []).filter((a) => a.binanceChainId === binanceChainId);
    if (assets.length === 0) return ok([]);

    const platforms = [...new Set(assets.map((a) => a.platformId).filter((p): p is string => Boolean(p)))];
    const listed = new Map<string, RwaToken>();
    for (const platformId of platforms) {
      const list = await this.getTokenList(binanceChainId, platformId);
      if (list.ok) {
        for (const token of list.value) {
          if (token.tokenContractAddress) listed.set(token.tokenContractAddress.toLowerCase(), token);
        }
      }
    }

    const prices = await this.getPrices(binanceChainId, assets.map((a) => a.tokenContractAddress));
    if (!prices.ok) return prices;
    const priceByAddress = new Map(prices.value.map((p) => [p.tokenContractAddress?.toLowerCase() ?? "", p]));

    const candidates: WrapperCandidate[] = [];
    for (const asset of assets) {
      const key = asset.tokenContractAddress.toLowerCase();
      const profile = await this.getUnderlyingProfile(binanceChainId, asset.tokenContractAddress);
      const market = await this.getUnderlyingMarket(binanceChainId, asset.tokenContractAddress);
      const price = priceByAddress.get(key);
      const token = listed.get(key);

      // /rwa/tokens is incomplete (e.g. AAPLB is missing), so fall back to the
      // token's own metadata rather than defaulting or falsely rejecting.
      let decimals = token?.decimals ?? null;
      if (decimals === null) {
        const info = await this.token.getBasicInfo(binanceChainId, asset.tokenContractAddress);
        decimals = info.ok ? info.value.decimals : null;
      }
      const ratio = profile.ok ? profile.value.tokenToShareRatio : (token?.tokenToShareRatio ?? null);
      const status = market.ok ? market.value.statusInfo : (token?.statusInfo ?? null);
      const provenance = [
        RWA_PATHS.search,
        ...(token ? [RWA_PATHS.tokens] : ["/api/v1/dex/market/token/basic-info"]),
        RWA_PATHS.price,
        ...(profile.ok ? [RWA_PATHS.underlyingProfile] : []),
        ...(market.ok ? [RWA_PATHS.underlyingMarket] : []),
      ];

      const identified = EVM_ADDRESS.test(asset.tokenContractAddress) && decimals !== null;
      candidates.push({
        platformId: asset.platformId,
        tokenContractAddress: asset.tokenContractAddress,
        tokenSymbol: asset.tokenSymbol,
        tokenName: token?.tokenName ?? null,
        // Unknown decimals are NEVER defaulted to 18: the wrapper becomes
        // UNSUPPORTED (rejected at the semantics gate) and 0 is a placeholder
        // that the router does not use for a rejected candidate.
        decimals: decimals ?? 0,
        underlyingTicker: ticker.toUpperCase(),
        tokenToShareRatioRaw: ratio,
        tokenPrice: price?.tokenPrice ?? token?.tokenPrice ?? null,
        referencePrice: price?.referencePrice ?? token?.referencePrice ?? null,
        statusInfo: toStatusInfo(status),
        semanticConfidence: !identified ? "UNSUPPORTED" : ratio === null ? "PARTIAL" : "VERIFIED",
        provenance,
      });
    }
    return ok(candidates);
  }
}

function toStatusInfo(raw: RwaToken["statusInfo"]): WrapperStatusInfo | null {
  if (!raw) return null;
  return {
    openState: raw.openState,
    marketStatus: raw.marketStatus,
    reasonCode: raw.reasonCode,
    reasonMsg: raw.reasonMsg,
    nextOpenTime: raw.nextOpenTime,
    nextCloseTime: raw.nextCloseTime,
  };
}

/** Exported so discovery and tests share one address-validity rule. */
export function isValidEvmAddress(value: string | null | undefined): boolean {
  return typeof value === "string" && EVM_ADDRESS.test(value);
}

export { err };
