/**
 * Generic token metadata adapter (Market API surface, not RWA-specific).
 *
 * Exists for exactly one reason: live decimals resolution. Correction 2 (V1
 * review) forbids assuming any token's decimals, including USDT's — BEP-20
 * USDT on BSC happens to use 18, but that is a fact to confirm, not a
 * constant to bake in. `getBasicInfo` is the live source of truth for it.
 */

import type { Result } from "@taloe/shared";

import type { BinanceWeb3Client } from "../client";
import type { BinanceApiError } from "../errors";
import type { TokenBasicInfo } from "../schemas";
import { tokenBasicInfoSchema } from "../schemas";

export const TOKEN_PATHS = {
  basicInfo: "/api/v1/dex/market/token/basic-info",
} as const;

export class TokenService {
  constructor(private readonly client: BinanceWeb3Client) {}

  async getBasicInfo(
    binanceChainId: string,
    tokenContractAddress: string,
  ): Promise<Result<TokenBasicInfo, BinanceApiError>> {
    return this.client.request({
      method: "POST",
      path: TOKEN_PATHS.basicInfo,
      body: { binanceChainId, tokenContractAddress },
      schema: tokenBasicInfoSchema,
    });
  }
}
