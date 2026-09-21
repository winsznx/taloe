/**
 * Trading API adapter.
 *
 * Two behaviours here are load-bearing for the product:
 *
 *  1. `executionMode` is read from the response, never inferred from the
 *     issuer. The docs state defaults (Ondo -> RFQ, xStock -> SWAP, BStock ->
 *     may return one SWAP and one RFQ route at once) but issuer behaviour can
 *     change and the PRD requires branching on runtime data.
 *  2. Every route in `routerResult` is preserved. The API's own "best" flag is
 *     recorded but not obeyed — comparing routes under the user's constraints
 *     is the thing Taloe exists to do.
 */

import type { ExecutionMode, Quote, Result } from "@taloe/shared";
import { ok } from "@taloe/shared";

import type { BinanceWeb3Client } from "../client";
import { BinanceApiError } from "../errors";
import type { QuoteRoute, RfqOrder, SwapResponse } from "../schemas";
import {
  approveTransactionSchema,
  quoteResponseSchema,
  rfqOrderSchema,
  supportedChainSchema,
  swapResponseSchema,
} from "../schemas";

export const TRADING_PATHS = {
  supportedChain: "/api/v1/dex/aggregator/supported/chain",
  quote: "/api/v1/dex/aggregator/quote",
  swap: "/api/v1/dex/aggregator/swap",
  quoteAndSwap: "/api/v1/dex/aggregator/quote-and-swap",
  approveTransaction: "/api/v1/dex/aggregator/approve-transaction",
  history: "/api/v1/dex/aggregator/history",
  orderSubmit: "/api/v1/dex/aggregator/order/submit",
  order: "/api/v1/dex/aggregator/order",
} as const;

/**
 * Documented quote lifetime is 30 seconds. Held here as a named constant
 * because it is an *estimate* used to compute freshness — the API returns no
 * expiry timestamp — and the DX campaign is expected to measure the real value.
 */
export const DOCUMENTED_QUOTE_TTL_MS = 30_000;

export interface QuoteRequest {
  readonly binanceChainId: string;
  readonly fromTokenAddress: string;
  readonly toTokenAddress: string;
  /** Base units of the input token. */
  readonly amount: string;
  /** Required for RFQ routes; also used as the RFQ order receiver. */
  readonly userWalletAddress: string | null;
}

export interface SwapRequest extends QuoteRequest {
  readonly quoteId: string;
  readonly slippagePercent?: string;
  readonly autoSlippage?: boolean;
}

export class TradingService {
  constructor(private readonly client: BinanceWeb3Client) {}

  async getSupportedChains() {
    return this.client.request({
      method: "GET",
      path: TRADING_PATHS.supportedChain,
      schema: supportedChainSchema,
    });
  }

  /**
   * Fetch every executable route for one wrapper.
   *
   * Returns a list because a single pair can legitimately produce several
   * routes across different execution modes — the BStock case the docs
   * describe — and discarding any of them would discard the comparison.
   */
  async getQuotes(request: QuoteRequest): Promise<Result<Quote[], BinanceApiError>> {
    const result = await this.client.request({
      method: "GET",
      path: TRADING_PATHS.quote,
      query: {
        binanceChainId: request.binanceChainId,
        fromTokenAddress: request.fromTokenAddress,
        toTokenAddress: request.toTokenAddress,
        amount: request.amount,
        userWalletAddress: request.userWalletAddress ?? undefined,
      },
      schema: quoteResponseSchema,
    });
    if (!result.ok) return result;

    const observedAt = new Date();
    const envelopeMode = result.value.executionMode;
    const envelopeQuoteId = result.value.quoteId;

    const quotes: Quote[] = [];
    for (const route of result.value.routerResult) {
      const quote = toQuote(route, {
        observedAt,
        fallbackQuoteId: envelopeQuoteId,
        fallbackExecutionMode: envelopeMode,
        fallbackApproveTarget: result.value.approveTarget,
      });
      // A route we cannot identify or whose settlement method we cannot read is
      // dropped here rather than defaulted: guessing SWAP for an RFQ route
      // would produce a transaction that silently does nothing.
      if (quote) quotes.push(quote);
    }
    return ok(quotes);
  }

  /**
   * Build the executable payload for a chosen quote.
   * Returns `tx` for SWAP routes and `rfq.typedDataToSign` for RFQ routes.
   */
  async buildSwap(request: SwapRequest): Promise<Result<SwapResponse, BinanceApiError>> {
    return this.client.request({
      method: "GET",
      path: TRADING_PATHS.swap,
      query: {
        binanceChainId: request.binanceChainId,
        quoteId: request.quoteId,
        fromTokenAddress: request.fromTokenAddress,
        toTokenAddress: request.toTokenAddress,
        amount: request.amount,
        userWalletAddress: request.userWalletAddress ?? undefined,
        slippagePercent: request.slippagePercent,
        autoSlippage: request.autoSlippage,
      },
      schema: swapResponseSchema,
    });
  }

  /**
   * Approval calldata.
   *
   * `vendor` is REQUIRED for equity tokens per the current docs — pass the
   * `vendorName` from the quote. Omitting it on an RFQ route yields an approval
   * for the wrong spender, which fails only later at settlement.
   */
  async getApprovalTransaction(params: {
    binanceChainId: string;
    tokenContractAddress: string;
    approveAmount: string;
    vendor?: string;
  }) {
    return this.client.request({
      method: "GET",
      path: TRADING_PATHS.approveTransaction,
      query: {
        binanceChainId: params.binanceChainId,
        tokenContractAddress: params.tokenContractAddress,
        approveAmount: params.approveAmount,
        vendor: params.vendor,
      },
      schema: approveTransactionSchema,
    });
  }

  /**
   * Submit a signed RFQ order.
   *
   * Naming trap, straight from the integration-flow doc: the `quoteId`
   * parameter here takes `rfq.orderId` from the /swap response, NOT the route
   * quoteId from /quote. The parameter is named for the caller's convenience
   * and means something else. The argument below is named accordingly so the
   * mistake cannot be made silently at a call site.
   */
  async submitRfqOrder(params: {
    rfqOrderIdFromSwap: string;
    userSignature: string;
    vendor: string;
    /** UUID v4. Reuse ONLY when retrying the same order attempt. */
    requestId: string;
    signingScheme?: string;
  }): Promise<Result<RfqOrder, BinanceApiError>> {
    return this.client.request({
      method: "POST",
      path: TRADING_PATHS.orderSubmit,
      body: {
        quoteId: params.rfqOrderIdFromSwap,
        userSignature: params.userSignature,
        vendor: params.vendor,
        requestId: params.requestId,
        ...(params.signingScheme ? { signingScheme: params.signingScheme } : {}),
      },
      schema: rfqOrderSchema,
    });
  }

  /** Poll RFQ settlement. This is the primary status source before a tx hash exists. */
  async getRfqOrder(orderId: string): Promise<Result<RfqOrder, BinanceApiError>> {
    return this.client.request({
      method: "GET",
      path: `${TRADING_PATHS.order}/${encodeURIComponent(orderId)}`,
      schema: rfqOrderSchema,
    });
  }
}

interface QuoteContext {
  readonly observedAt: Date;
  readonly fallbackQuoteId: string | null;
  readonly fallbackExecutionMode: ExecutionMode | null;
  readonly fallbackApproveTarget: string | null;
}

/**
 * Map one API route to a domain Quote.
 *
 * Returns null — rather than a partially-filled Quote — when identity or
 * execution mode is missing. A route we cannot execute correctly should never
 * reach the ranking stage wearing a plausible shape.
 */
export function toQuote(route: QuoteRoute, context: QuoteContext): Quote | null {
  const quoteId = route.quoteId ?? context.fallbackQuoteId;
  const executionMode = route.executionMode ?? context.fallbackExecutionMode;
  if (!quoteId || !executionMode || !route.vendorName) return null;
  if (route.toTokenAmount === null || route.fromTokenAmount === null) return null;

  return {
    quoteId,
    vendorName: route.vendorName,
    executionMode,
    fromTokenAmount: route.fromTokenAmount,
    toTokenAmount: route.toTokenAmount,
    tradeFeeUsd: route.tradeFee,
    estimatedGas: route.estimateGasFee ?? route.gas,
    priceImpactPercent: route.priceImpactPercentage ?? route.priceImpact,
    routePath: route.routePath,
    approveTarget: route.approveTarget ?? context.fallbackApproveTarget,
    quoteObservedAt: context.observedAt.toISOString(),
    quoteExpiresAtEstimate: new Date(
      context.observedAt.getTime() + DOCUMENTED_QUOTE_TTL_MS,
    ).toISOString(),
    apiIsBest: route.isBest,
  };
}
