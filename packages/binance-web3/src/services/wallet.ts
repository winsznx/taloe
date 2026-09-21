/**
 * Wallet API adapter: balances and post-settlement verification.
 *
 * The documented failure mode this handles: immediately after a broadcast the
 * transaction-detail endpoint can return an empty result while indexing
 * catches up. That is "not indexed yet", not "failed", and showing the user a
 * failure there would be a lie. Callers get INDEXING and poll with backoff.
 */

import type { Result } from "@taloe/shared";
import { ok } from "@taloe/shared";

import type { BinanceWeb3Client } from "../client";
import type { BinanceApiError } from "../errors";
import type { TransactionDetail } from "../schemas";
import { tokenBalanceSchema, transactionDetailSchema } from "../schemas";

export const WALLET_PATHS = {
  transactionDetail: "/api/v1/dex/post-transaction/transaction-detail-by-txhash",
  tokenBalances: "/api/v1/dex/wallet/all-token-balances-by-address",
} as const;

export type ChainTxStatus = "INDEXING" | "PENDING" | "SUCCESS" | "FAIL";

export interface VerifiedTransaction {
  readonly status: ChainTxStatus;
  readonly txHash: string;
  readonly blockNumber: number | null;
  readonly tokenTransfers: readonly {
    readonly tokenContractAddress: string;
    readonly symbol: string | null;
    readonly amount: string;
    readonly from: string;
    readonly to: string;
  }[];
  readonly raw: TransactionDetail | null;
}

export class WalletService {
  constructor(private readonly client: BinanceWeb3Client) {}

  async getTransaction(
    binanceChainId: string,
    txHash: string,
  ): Promise<Result<VerifiedTransaction, BinanceApiError>> {
    const result = await this.client.request({
      method: "GET",
      path: WALLET_PATHS.transactionDetail,
      query: { binanceChainId, txHash },
      schema: transactionDetailSchema,
    });
    if (!result.ok) return result;

    const detail = result.value;
    // An empty body with a success code is the documented indexing lag.
    if (!detail.txHash && !detail.txStatus) {
      return ok({
        status: "INDEXING",
        txHash,
        blockNumber: null,
        tokenTransfers: [],
        raw: detail,
      });
    }

    const status = mapTxStatus(detail.txStatus);
    return ok({
      status,
      txHash: detail.txHash ?? txHash,
      blockNumber: detail.blockNumber,
      tokenTransfers: detail.tokenTransferDetails.map((transfer) => ({
        tokenContractAddress: transfer.tokenContractAddress ?? "",
        symbol: transfer.symbol,
        amount: transfer.amount ?? "0",
        from: transfer.from ?? "",
        to: transfer.to ?? "",
      })),
      raw: detail,
    });
  }

  async getTokenBalances(binanceChainId: string, address: string) {
    return this.client.request({
      method: "GET",
      path: WALLET_PATHS.tokenBalances,
      query: { binanceChainId, address },
      schema: tokenBalanceSchema,
    });
  }
}

function mapTxStatus(raw: string | null): ChainTxStatus {
  switch (raw?.toLowerCase()) {
    case "success":
      return "SUCCESS";
    case "fail":
    case "failed":
      return "FAIL";
    case "pending":
      return "PENDING";
    default:
      // An unrecognised status is not assumed to be success.
      return "INDEXING";
  }
}

/**
 * Find how much of `tokenAddress` actually landed in `walletAddress`.
 *
 * This is the number the receipt shows. It is read from observed transfers,
 * never copied from the quote estimate, so a partial fill or a route that
 * delivered something else is visible instead of hidden.
 */
export function extractReceivedAmount(
  transaction: VerifiedTransaction,
  tokenAddress: string,
  walletAddress: string,
): string | null {
  const token = tokenAddress.toLowerCase();
  const wallet = walletAddress.toLowerCase();
  let total = 0n;
  let found = false;

  for (const transfer of transaction.tokenTransfers) {
    if (
      transfer.tokenContractAddress.toLowerCase() === token &&
      transfer.to.toLowerCase() === wallet
    ) {
      try {
        total += BigInt(transfer.amount);
        found = true;
      } catch {
        // A non-integer amount is unusable as proof; treat it as absent rather
        // than guessing, so the receipt shows "unknown" instead of a wrong number.
        return null;
      }
    }
  }
  return found ? total.toString() : null;
}
