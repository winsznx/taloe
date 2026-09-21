/**
 * RWA data adapter (Market API surface).
 *
 * Translates sponsor payloads into Taloe's `WrapperCandidate` / `Underlying`
 * domain types. Crucially it never invents an absent field: a missing ratio,
 * price or status arrives as null and downstream gates treat that as unknown.
 */

import type { Result, Underlying, WrapperCandidate, WrapperStatusInfo } from "@taloe/shared";
import { err, ok } from "@taloe/shared";

import type { BinanceWeb3Client } from "../client";
import type { BinanceApiError } from "../errors";
import type { RwaToken } from "../schemas";
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

export class RwaService {
  constructor(private readonly client: BinanceWeb3Client) {}

  async listPlatforms(): Promise<Result<{ platformId: string; platformName: string | null }[], BinanceApiError>> {
    const result = await this.client.request({
      method: "GET",
      path: RWA_PATHS.platforms,
      schema: rwaPlatformListSchema,
    });
    if (!result.ok) return result;
    return ok(
      result.value
        .filter((p): p is typeof p & { platformId: string } => Boolean(p.platformId))
        .map((p) => ({ platformId: p.platformId, platformName: p.platformName })),
    );
  }

  /** Search by ticker, company name, or contract address. */
  async search(
    query: string,
    binanceChainId: string,
  ): Promise<Result<WrapperCandidate[], BinanceApiError>> {
    const result = await this.client.request({
      method: "GET",
      path: RWA_PATHS.search,
      query: { binanceChainId, keyword: query },
      schema: rwaSearchResultSchema,
    });
    if (!result.ok) return result;
    return ok(result.value.map((token) => toWrapperCandidate(token, RWA_PATHS.search)));
  }

  /** All RWA tokens, optionally narrowed to one issuance platform. */
  async listTokens(
    binanceChainId: string,
    platformId?: string,
  ): Promise<Result<WrapperCandidate[], BinanceApiError>> {
    const result = await this.client.request({
      method: "GET",
      path: RWA_PATHS.tokens,
      query: { binanceChainId, platformId },
      schema: rwaTokenListSchema,
    });
    if (!result.ok) return result;
    return ok(result.value.map((token) => toWrapperCandidate(token, RWA_PATHS.tokens)));
  }

  /**
   * Refresh on-chain and reference prices for specific contracts.
   * Returned as a map so callers merge by address rather than by list order,
   * which the API does not promise to preserve.
   */
  async getPrices(
    binanceChainId: string,
    tokenContractAddresses: readonly string[],
  ): Promise<
    Result<Map<string, { tokenPrice: string | null; referencePrice: string | null }>, BinanceApiError>
  > {
    if (tokenContractAddresses.length === 0) return ok(new Map());
    const result = await this.client.request({
      method: "GET",
      path: RWA_PATHS.price,
      query: {
        binanceChainId,
        tokenContractAddresses: tokenContractAddresses.join(","),
      },
      schema: rwaPriceListSchema,
    });
    if (!result.ok) return result;

    const map = new Map<string, { tokenPrice: string | null; referencePrice: string | null }>();
    for (const entry of result.value) {
      if (!entry.tokenContractAddress) continue;
      map.set(entry.tokenContractAddress.toLowerCase(), {
        tokenPrice: entry.tokenPrice,
        referencePrice: entry.referencePrice,
      });
    }
    return ok(map);
  }

  async getUnderlyingProfile(
    underlyingTicker: string,
  ): Promise<Result<Underlying, BinanceApiError>> {
    const result = await this.client.request({
      method: "GET",
      path: RWA_PATHS.underlyingProfile,
      query: { underlyingTicker },
      schema: rwaUnderlyingProfileSchema,
    });
    if (!result.ok) return result;
    return ok({
      ticker: result.value.underlyingTicker ?? underlyingTicker,
      companyName: result.value.companyName ?? underlyingTicker,
      sector: result.value.sector,
      logoUrl: result.value.logoUrl,
      provenance: [RWA_PATHS.underlyingProfile],
    });
  }

  /** Raw underlying market/session data. SessionMark interprets it. */
  async getUnderlyingMarket(underlyingTicker: string) {
    return this.client.request({
      method: "GET",
      path: RWA_PATHS.underlyingMarket,
      query: { underlyingTicker },
      schema: rwaUnderlyingMarketSchema,
    });
  }
}

function toStatusInfo(token: RwaToken): WrapperStatusInfo | null {
  const raw = token.statusInfo;
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

/**
 * Semantic confidence is assigned here, and it is the gate that decides whether
 * a wrapper may compete numerically at all.
 *
 * VERIFIED requires a contract address, decimals, an underlying ticker AND a
 * ratio we can read. Without the ratio we cannot state how much of the company
 * the token represents, and the PRD forbids inventing that conversion — such a
 * token is shown to the user but excluded from ranking.
 */
function classifyConfidence(token: RwaToken): WrapperCandidate["semanticConfidence"] {
  const hasIdentity =
    Boolean(token.tokenContractAddress && EVM_ADDRESS.test(token.tokenContractAddress)) &&
    token.decimals !== null &&
    Boolean(token.underlyingTicker);

  if (!hasIdentity) return "UNSUPPORTED";
  if (token.tokenToShareRatio === null) return "PARTIAL";
  return "VERIFIED";
}

export function toWrapperCandidate(token: RwaToken, provenance: string): WrapperCandidate {
  return {
    platformId: token.platformId,
    tokenContractAddress: token.tokenContractAddress ?? "",
    tokenSymbol: token.tokenSymbol ?? "",
    tokenName: token.tokenName,
    decimals: token.decimals ?? 18,
    underlyingTicker: token.underlyingTicker ?? "",
    tokenToShareRatioRaw: token.tokenToShareRatio,
    tokenPrice: token.tokenPrice,
    referencePrice: token.referencePrice,
    statusInfo: toStatusInfo(token),
    semanticConfidence: classifyConfidence(token),
    provenance: [provenance],
  };
}

/** Exported so discovery and tests share one address-validity rule. */
export function isValidEvmAddress(value: string | null | undefined): boolean {
  return typeof value === "string" && EVM_ADDRESS.test(value);
}

export { err };
