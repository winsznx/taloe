import "server-only";

/**
 * Server-side Binance service wiring.
 *
 * One client instance per process, with the evidence recorder attached at
 * construction so every call is instrumented for latency and rate-limit data
 * without any call site having to remember to do it.
 *
 * `getServices` throws in fixture mode rather than returning a stubbed client.
 * A caller that wants fixture data has to ask for fixture data explicitly, so
 * the product can never serve canned results while believing it is live.
 */

import type { ApiObservation } from "@taloe/binance-web3";
import {
  BinanceWeb3Client,
  RwaService,
  TokenService,
  TradingService,
  TransactionService,
  WalletService,
} from "@taloe/binance-web3";
import type { ApiRequestRecord } from "@taloe/evidence";
import { EvidenceRecorder, MemoryEvidenceSink } from "@taloe/evidence";

import { getServerConfig } from "./config";

export interface BinanceServices {
  readonly client: BinanceWeb3Client;
  readonly rwa: RwaService;
  readonly token: TokenService;
  readonly trading: TradingService;
  readonly transaction: TransactionService;
  readonly wallet: WalletService;
}

const evidenceSink = new MemoryEvidenceSink();
const recorder = new EvidenceRecorder(evidenceSink, (error) => {
  // Observability failing must not fail the request (PRD 21). It is logged and
  // counted so the degradation is visible internally.
  console.warn("[taloe] evidence write failed", error);
});

let services: BinanceServices | null = null;

export class LiveModeUnavailableError extends Error {
  constructor() {
    super(
      "Binance services are unavailable: TALOE_DATA_MODE is not `live` or credentials are missing.",
    );
    this.name = "LiveModeUnavailableError";
  }
}

export function getServices(): BinanceServices {
  if (services) return services;

  const config = getServerConfig();
  if (config.dataMode !== "live" || !config.binance) {
    throw new LiveModeUnavailableError();
  }

  const client = new BinanceWeb3Client({
    apiKey: config.binance.apiKey,
    apiSecret: config.binance.apiSecret,
    baseUrl: config.binance.baseUrl,
    recvWindowMs: config.binance.recvWindowMs,
    onObservation: (observation) => {
      void recorder.record(toEvidenceRecord(observation));
    },
  });

  services = {
    client,
    rwa: new RwaService(client),
    token: new TokenService(client),
    trading: new TradingService(client),
    transaction: new TransactionService(client, (raw) => {
      // Documented-contradiction finding (SPONSOR_FINDINGS DOC-005): keep the raw
      // payload so a repeat can be reclassified with evidence.
      console.warn("[taloe] simulate returned status=SUCCESS with a failReason", JSON.stringify(raw));
    }),
    wallet: new WalletService(client),
  };
  return services;
}

export function isLiveMode(): boolean {
  const config = getServerConfig();
  return config.dataMode === "live" && config.binance !== null;
}

export function getEvidenceRecords(): readonly unknown[] {
  return evidenceSink.records;
}

function toEvidenceRecord(observation: ApiObservation): ApiRequestRecord {
  return {
    kind: "api_request",
    timestamp: observation.timestamp,
    correlationId: observation.correlationId,
    apiModule: moduleForEndpoint(observation.endpoint),
    endpoint: observation.endpoint,
    method: observation.method,
    chainId: getServerConfig().binanceChainId,
    underlyingTicker: null,
    wrapperContract: null,
    platformId: null,
    httpStatus: observation.httpStatus,
    businessCode: observation.businessCode,
    latencyMs: observation.latencyMs,
    retryCount: observation.retryCount,
    rateLimitHeaders: observation.rateLimitHeaders,
    outcome: observation.outcome,
  };
}

function moduleForEndpoint(endpoint: string): ApiRequestRecord["apiModule"] {
  if (endpoint.includes("/market/rwa/")) return "rwa";
  if (endpoint.includes("/market/")) return "market";
  if (endpoint.includes("/aggregator/")) return "trading";
  if (endpoint.includes("/pre-transaction/")) return "transaction";
  return "wallet";
}
