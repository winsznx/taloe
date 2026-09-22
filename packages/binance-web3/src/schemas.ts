/**
 * Runtime schemas for Binance Web3 API responses.
 *
 * Confidence note, which matters for how these are written:
 *
 *  - Envelope, auth, endpoint paths, execution modes and error codes are
 *    DOC_VERIFIED against the current docs (retrieved 2026-09-21).
 *  - Exact field NAMES inside several RWA payloads are UNTESTED. The Market
 *    API introduction lists the endpoints but not their response shapes, and
 *    the PRD's field list predates this build.
 *
 * So every sponsor object is a *loose* object: unknown keys are preserved
 * rather than stripped, and every field whose name is not doc-confirmed is
 * optional and nullable. A field we guessed wrong then arrives as `undefined`
 * and is handled as missing data, which the router already treats honestly,
 * instead of failing the whole call or — far worse — silently reading as zero.
 *
 * When live responses are observed, tighten these and move the corresponding
 * CLAIM_LEDGER rows from UNTESTED to API_VERIFIED.
 */

import { z } from "zod";

/** Numeric-ish fields arrive as either strings or numbers depending on endpoint. */
const numericString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .nullish()
  .transform((value) => value ?? null);

const optionalString = z.string().nullish().transform((value) => value ?? null);
const optionalBool = z.boolean().nullish().transform((value) => value ?? null);
const optionalNumber = z.number().nullish().transform((value) => value ?? null);

// ---------------------------------------------------------------------------
// RWA data (Market API)
//
// DOC_VERIFIED and API_VERIFIED (shapes observed live, 2026-09-21) against
// https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/rwa-data
// Raw evidence: internal/evidence/runtime/raw-*.json. The V1 guesses (flat
// token list from /search, ticker-keyed profile/market) were WRONG; see
// SPONSOR_FINDINGS F-009.
// ---------------------------------------------------------------------------

/** Numbers that arrive as strings ("18") or numbers. Null when absent/unparseable. */
const numberish = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

export const rwaPlatformSchema = z.looseObject({
  platformId: optionalString,
  tickerCount: numberish,
  chainDistribution: z
    .array(z.looseObject({ binanceChainId: optionalString, tokenCount: numberish }))
    .nullish()
    .transform((v) => v ?? []),
  website: optionalString,
  logoUrl: optionalString,
});
export const rwaPlatformListSchema = z.array(rwaPlatformSchema);

/** Documented enums are kept as raw strings; interpretation lives in SessionMark. */
export const rwaStatusInfoSchema = z.looseObject({
  openState: optionalBool,
  marketStatus: optionalString,
  reasonCode: optionalString,
  reasonMsg: optionalString,
  nextOpenTime: numberish,
  nextCloseTime: numberish,
});

export const rwaTokenSchema = z.looseObject({
  binanceChainId: optionalString,
  platformId: optionalString,
  tokenContractAddress: optionalString,
  tokenSymbol: optionalString,
  tokenName: optionalString,
  /** Documented as decimals; observed as a string ("18"). */
  decimals: numberish,
  underlyingTicker: optionalString,
  underlyingName: optionalString,
  /** Asset CLASS (1=Stock, 2=Pre-IPO, 3=ETF), not issuer family. */
  assetType: numberish,
  tokenToShareRatio: numericString,
  tokenPrice: numericString,
  referencePrice: numericString,
  statusInfo: rwaStatusInfoSchema.nullish().transform((v) => v ?? null),
});
export const rwaTokenListSchema = z.array(rwaTokenSchema);

/** /rwa/search groups by underlying: one record per ticker with assets[] across platforms/chains. */
export const rwaSearchAssetSchema = z.looseObject({
  platformId: optionalString,
  binanceChainId: optionalString,
  tokenContractAddress: optionalString,
  tokenSymbol: optionalString,
  assetType: numberish,
});
export const rwaSearchGroupSchema = z.looseObject({
  ticker: optionalString,
  companyName: optionalString,
  assets: z.array(rwaSearchAssetSchema).nullish().transform((v) => v ?? []),
});
export const rwaSearchResultSchema = z.array(rwaSearchGroupSchema);

export const rwaPriceEntrySchema = z.looseObject({
  binanceChainId: optionalString,
  tokenContractAddress: optionalString,
  platformId: optionalString,
  tokenPrice: numericString,
  referencePrice: numericString,
  tokenPriceUpdatedAt: numberish,
});
export const rwaPriceListSchema = z.array(rwaPriceEntrySchema);

export const rwaUnderlyingProfileSchema = z.looseObject({
  binanceChainId: optionalString,
  tokenContractAddress: optionalString,
  platformId: optionalString,
  underlyingTicker: optionalString,
  underlyingFullName: optionalString,
  assetType: numberish,
  tokenToShareRatio: numericString,
});

export const rwaUnderlyingMarketSchema = z.looseObject({
  binanceChainId: optionalString,
  tokenContractAddress: optionalString,
  platformId: optionalString,
  assetType: numberish,
  statusInfo: rwaStatusInfoSchema.nullish().transform((v) => v ?? null),
  marketData: z
    .looseObject({ referencePrice: numericString })
    .nullish()
    .transform((v) => v ?? null),
});

// ---------------------------------------------------------------------------
// Trading API
// ---------------------------------------------------------------------------

/**
 * executionMode is the authoritative runtime signal. The docs state defaults
 * per issuer type (Ondo -> RFQ, xStock -> SWAP, BStock -> mixed), but the PRD
 * requires branching on what is actually returned, so an unrecognised value is
 * preserved rather than coerced to SWAP.
 */
export const executionModeSchema = z.enum(["SWAP", "RFQ"]);

export const quoteRouteSchema = z.looseObject({
  quoteId: optionalString,
  vendorName: optionalString,
  executionMode: executionModeSchema.nullish().transform((v) => v ?? null),
  fromTokenAmount: numericString,
  toTokenAmount: numericString,
  priceImpact: numericString,
  priceImpactPercent: numericString,
  priceImpactPercentage: numericString,
  estimateGasFee: numericString,
  gas: numericString,
  tradeFee: numericString,
  approveTarget: optionalString,
  routePath: optionalString,
  isBest: optionalBool,
  feeAmount: numericString,
  feeToken: optionalString,
  actualSwapAmount: numericString,
});

/**
 * Observed live 2026-09-21 (raw-quote-nvdab-5-*.json): `data` is a FLAT ARRAY of
 * routes, each with its own quoteId/vendorName/executionMode and the fields
 * below (plus fromToken/toToken/dexRouterList, preserved by the loose object).
 * The V1 guess (`data.routerResult[]`) was wrong.
 */
export const quoteResponseSchema = z.array(quoteRouteSchema);

/**
 * DOC_VERIFIED field list (2026-09-21):
 * https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/trading-api
 * "Build Swap Transaction" -> `data.tx`.
 */
export const evmTxSchema = z.looseObject({
  from: optionalString,
  to: optionalString,
  data: optionalString,
  value: numericString,
  gas: numericString,
  gasPrice: numericString,
  maxPriorityFeePerGas: numericString,
  minReceiveAmount: numericString,
  slippagePercent: numericString,
});

/** EIP-712 payload for RFQ routes. Signed as typed data, never as a string. */
export const rfqTypedDataSchema = z.looseObject({
  domain: z.looseObject({}),
  types: z.record(z.string(), z.unknown()),
  primaryType: z.string().nullish().transform((v) => v ?? null),
  message: z.looseObject({}),
});

export const rfqBlockSchema = z.looseObject({
  /**
   * NOTE: `/order/submit` expects THIS value in its `quoteId` parameter, not
   * the route quoteId from `/quote`. Confirmed in the integration-flow doc and
   * recorded in SPONSOR_FINDINGS as a naming trap.
   */
  orderId: optionalString,
  typedDataToSign: rfqTypedDataSchema.nullish().transform((v) => v ?? null),
  signingScheme: optionalString,
});

export const swapResponseSchema = z.looseObject({
  tx: evmTxSchema.nullish().transform((v) => v ?? null),
  rfq: rfqBlockSchema.nullish().transform((v) => v ?? null),
  routerResult: quoteRouteSchema.nullish().transform((v) => v ?? null),
});

export const approveTransactionSchema = z.union([
  z.array(
    z.looseObject({
      data: optionalString,
      dexContractAddress: optionalString,
      gasLimit: numericString,
      gasPrice: numericString,
    }),
  ),
  z
    .looseObject({
      data: optionalString,
      dexContractAddress: optionalString,
      gasLimit: numericString,
      gasPrice: numericString,
    })
    .transform((v) => [v]),
]);

/** Documented terminal and intermediate RFQ order states (PRD 5.5). */
export const rfqOrderStatusSchema = z.enum([
  "PENDING_VENDOR",
  "PENDING_ONCHAIN",
  "FILLED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
]);

export const rfqOrderSchema = z.looseObject({
  orderId: optionalString,
  status: rfqOrderStatusSchema.nullish().transform((v) => v ?? null),
  txHash: optionalString,
  failReason: optionalString,
  fromTokenAmount: numericString,
  toTokenAmount: numericString,
});

export const supportedChainSchema = z.array(
  z.looseObject({
    chainId: numericString,
    chainName: optionalString,
    dexTokenApproveAddress: optionalString,
  }),
);

// ---------------------------------------------------------------------------
// Transaction API
// ---------------------------------------------------------------------------

/**
 * Simulation response.
 *
 * DOC_VERIFIED against
 * https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/transaction-api
 * (#simulate-transactions section), retrieved 2026-09-21. The documented
 * `data` shape is `{ status, failReason, balanceChanges[], allowanceChanges[] }`.
 *
 * `status` is kept as a loose string rather than a strict enum: the two
 * documented values are `SUCCESS` and `FAILED`, but a third, unrecognised
 * value must be handled explicitly by the adapter (as "not interpretable",
 * which fails the router's gate closed) rather than crash the whole request
 * with a schema validation error. See `TransactionService.simulate`.
 */
export const simulationBalanceChangeSchema = z.looseObject({
  contractAddress: optionalString,
  tokenType: optionalString,
  change: numericString,
  owner: optionalString,
});

export const simulationAllowanceChangeSchema = z.looseObject({
  tokenAddress: optionalString,
  owner: optionalString,
  spender: optionalString,
  preAmount: numericString,
  postAmount: numericString,
});

export const simulationResponseSchema = z.looseObject({
  status: optionalString,
  failReason: optionalString,
  balanceChanges: z.array(simulationBalanceChangeSchema).nullish().transform((v) => v ?? []),
  allowanceChanges: z.array(simulationAllowanceChangeSchema).nullish().transform((v) => v ?? []),
});

export const broadcastResponseSchema = z.looseObject({
  txHash: optionalString,
  orderId: optionalString,
});

export const gasPriceSchema = z.looseObject({
  normal: numericString,
  fast: numericString,
  eip1559Protocol: z.looseObject({}).nullish().transform((v) => v ?? null),
});

// ---------------------------------------------------------------------------
// Wallet API
// ---------------------------------------------------------------------------

export const transactionDetailSchema = z.looseObject({
  txHash: optionalString,
  txStatus: optionalString,
  blockNumber: optionalNumber,
  txTime: optionalNumber,
  tokenTransferDetails: z
    .array(
      z.looseObject({
        tokenContractAddress: optionalString,
        symbol: optionalString,
        amount: numericString,
        from: optionalString,
        to: optionalString,
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
});

/**
 * Market API "Get Token Basic Info" (`POST /api/v1/dex/market/token/basic-info`).
 * Used specifically so live `decimals` resolution never assumes a fixed value
 * for any token, including USDT (V1 review correction 2).
 */
export const tokenBasicInfoSchema = z.looseObject({
  tokenContractAddress: optionalString,
  symbol: optionalString,
  name: optionalString,
  decimals: optionalNumber,
  logoUrl: optionalString,
});

/** Live shape: data is an array of pages, each `{ tokenAssets: [...] }`. */
export const tokenBalanceSchema = z
  .array(
    z.looseObject({
      tokenAssets: z
        .array(
          z.looseObject({
            tokenContractAddress: optionalString,
            symbol: optionalString,
            balance: numericString,
            rawBalance: numericString,
          }),
        )
        .nullish()
        .transform((v) => v ?? []),
    }),
  )
  .transform((pages) => ({ tokenAssets: pages.flatMap((page) => page.tokenAssets) }));

export type RwaToken = z.infer<typeof rwaTokenSchema>;
export type RwaUnderlyingMarket = z.infer<typeof rwaUnderlyingMarketSchema>;
export type QuoteRoute = z.infer<typeof quoteRouteSchema>;
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;
export type SwapResponse = z.infer<typeof swapResponseSchema>;
export type RfqOrder = z.infer<typeof rfqOrderSchema>;
export type SimulationResponse = z.infer<typeof simulationResponseSchema>;
export type TransactionDetail = z.infer<typeof transactionDetailSchema>;
export type TokenBasicInfo = z.infer<typeof tokenBasicInfoSchema>;
