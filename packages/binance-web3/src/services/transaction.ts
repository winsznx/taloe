/**
 * Transaction API adapter: gas, simulation, broadcast.
 *
 * `simulate` is implemented against the canonical current documentation at
 * https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/transaction-api
 * (#simulate-transactions section), retrieved 2026-09-21. This supersedes the
 * V1 build's guessed request/response shape — the real contract is:
 *
 *   request:  { binanceChainId, evmTx: { from, to, value, data } }
 *   response: { code, msg, data: { status, failReason, balanceChanges[], allowanceChanges[] }, timestamp, success }
 *
 * Simulation is a product gate, not a formality: "the endpoint answered"
 * never means "the transaction is safe." The documented result has to
 * actually say `status === "SUCCESS"` with no contradicting signal, or this
 * adapter refuses to call it a pass.
 *
 * The current docs themselves contain an internal contradiction worth
 * treating as first-class product logic rather than an edge case: the
 * documented example response shows `status: "SUCCESS"` paired with a
 * non-empty `failReason: "execution reverted: ..."`. Nothing in the docs
 * explains which field should win. Rather than invent a rule (e.g. "failReason
 * wins" or "status wins"), this adapter treats that specific combination as an
 * inconsistent sponsor response and fails closed to `NOT_RUN` — which the
 * router's hard gate already treats as "cannot confirm a pass," i.e. REFUSE.
 * See internal/sponsor/SPONSOR_FINDINGS.md DOC-005.
 */

import type { Result, SimulationResult } from "@taloe/shared";
import { ok } from "@taloe/shared";

import type { BinanceWeb3Client } from "../client";
import type { BinanceApiError } from "../errors";
import { broadcastResponseSchema, gasPriceSchema, simulationResponseSchema } from "../schemas";

export const TRANSACTION_PATHS = {
  supportedChain: "/api/v1/dex/pre-transaction/supported/chain",
  gasPrice: "/api/v1/dex/pre-transaction/gas-price",
  blockHeight: "/api/v1/dex/pre-transaction/block-height",
  gasLimit: "/api/v1/dex/pre-transaction/gas-limit",
  simulate: "/api/v1/dex/pre-transaction/simulate",
  broadcast: "/api/v1/dex/pre-transaction/broadcast-transaction",
  orders: "/api/v1/dex/post-transaction/orders",
} as const;

export interface SimulateSwapRequest {
  readonly binanceChainId: string;
  /** The unsigned EVM transaction fields as returned by TradingService.buildSwap's data.tx. */
  readonly evmTx: {
    readonly from: string;
    readonly to: string;
    readonly value: string;
    readonly data: string;
  };
}

/** Documented status values. An unrecognised string is handled explicitly, not assumed. */
const KNOWN_STATUSES = new Set(["SUCCESS", "FAILED"]);

/** Raw sponsor payload handed to the caller when a response contradicts itself. */
export type InconsistentSimulationHandler = (raw: {
  readonly status: string | null;
  readonly failReason: string | null;
  readonly balanceChanges: readonly unknown[];
  readonly allowanceChanges: readonly unknown[];
}) => void;

export class TransactionService {
  constructor(
    private readonly client: BinanceWeb3Client,
    /**
     * Called with the raw (already-parsed, secret-free) response whenever the
     * sponsor returns a self-contradictory simulation, so the caller can
     * persist it as evidence and log a finding. The adapter itself still
     * fails closed regardless of whether a handler is supplied.
     */
    private readonly onInconsistent?: InconsistentSimulationHandler,
  ) {}

  async getGasPrice(binanceChainId: string) {
    return this.client.request({
      method: "GET",
      path: TRANSACTION_PATHS.gasPrice,
      query: { binanceChainId },
      schema: gasPriceSchema,
    });
  }

  async simulate(request: SimulateSwapRequest): Promise<Result<SimulationResult, BinanceApiError>> {
    const result = await this.client.request({
      method: "POST",
      path: TRANSACTION_PATHS.simulate,
      body: {
        binanceChainId: request.binanceChainId,
        evmTx: request.evmTx,
      },
      schema: simulationResponseSchema,
    });
    if (!result.ok) return result;

    const payload = result.value;
    const rawStatus = payload.status?.toUpperCase() ?? null;
    const hasFailReason = typeof payload.failReason === "string" && payload.failReason.trim().length > 0;

    let status: SimulationResult["status"];
    let failReason: string | null;

    if (rawStatus === "SUCCESS" && hasFailReason) {
      // The documented contradiction. Fail closed rather than guess which
      // field is authoritative — see the module header and DOC-005.
      this.onInconsistent?.({
        status: payload.status,
        failReason: payload.failReason,
        balanceChanges: payload.balanceChanges,
        allowanceChanges: payload.allowanceChanges,
      });
      status = "NOT_RUN";
      failReason =
        `sponsor response inconsistent: status="SUCCESS" but failReason="${payload.failReason}". ` +
        "Refusing to treat either field as authoritative; see internal/sponsor/SPONSOR_FINDINGS.md DOC-005.";
    } else if (rawStatus === "SUCCESS") {
      status = "PASS";
      failReason = null;
    } else if (rawStatus === "FAILED") {
      status = "FAIL";
      failReason = payload.failReason ?? "simulation failed with no reason reported";
    } else if (rawStatus !== null && !KNOWN_STATUSES.has(rawStatus)) {
      // A status we don't recognise is not assumed to be a pass or a fail.
      status = "NOT_RUN";
      failReason = `simulation returned an unrecognised status "${payload.status}"`;
    } else {
      status = "NOT_RUN";
      failReason = "simulation response did not include a status";
    }

    return ok({
      status,
      failReason,
      balanceChanges: payload.balanceChanges.map((change) => ({
        contractAddress: change.contractAddress ?? "",
        tokenType: change.tokenType,
        change: change.change ?? "0",
        owner: change.owner,
      })),
      allowanceChanges: payload.allowanceChanges.map((change) => ({
        tokenAddress: change.tokenAddress ?? "",
        owner: change.owner,
        spender: change.spender,
        preAmount: change.preAmount,
        postAmount: change.postAmount,
      })),
      observedAt: new Date().toISOString(),
      provenance: [TRANSACTION_PATHS.simulate],
    });
  }

  /**
   * Relay an already-signed transaction. Taloe never holds a private key; the
   * signature is produced in the user's wallet and only the signed blob arrives
   * here. The returned txHash is a broadcast receipt, NOT proof of success.
   */
  async broadcast(params: {
    binanceChainId: string;
    signedTransaction: string;
    address: string;
    enableMevProtection?: boolean;
  }) {
    return this.client.request({
      method: "POST",
      path: TRANSACTION_PATHS.broadcast,
      body: {
        binanceChainId: params.binanceChainId,
        signedTransaction: params.signedTransaction,
        address: params.address,
        ...(params.enableMevProtection !== undefined
          ? { enableMevProtection: params.enableMevProtection }
          : {}),
      },
      schema: broadcastResponseSchema,
    });
  }
}
