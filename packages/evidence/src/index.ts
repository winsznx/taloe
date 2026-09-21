/**
 * Evidence recording (PRD 20).
 *
 * Two rules shape this module:
 *
 *  1. It never fabricates a missing value. Absent data is recorded as null;
 *    an aggregate computed from nulls reports its own sample size so a metric
 *    can never be quoted more confidently than the data behind it.
 *  2. It is never on the critical path. A failed evidence write must not stop
 *    a user getting a quote (PRD 21), so `record` swallows its own failures
 *    and reports them through a separate channel.
 */

import { redactValue } from "@taloe/shared";
import { z } from "zod";

export const apiRequestRecordSchema = z.object({
  kind: z.literal("api_request"),
  timestamp: z.string(),
  correlationId: z.string(),
  apiModule: z.enum(["rwa", "market", "trading", "transaction", "wallet"]),
  endpoint: z.string(),
  method: z.string(),
  chainId: z.string().nullable(),
  underlyingTicker: z.string().nullable(),
  wrapperContract: z.string().nullable(),
  platformId: z.string().nullable(),
  httpStatus: z.number().nullable(),
  businessCode: z.number().nullable(),
  latencyMs: z.number(),
  retryCount: z.number(),
  rateLimitHeaders: z.record(z.string(), z.string()),
  outcome: z.string(),
});

export const routeObservationSchema = z.object({
  kind: z.literal("route_observation"),
  routeSessionId: z.string(),
  observedAt: z.string(),
  underlyingTicker: z.string(),
  inputAmount: z.string(),
  /** Hashed, never the raw address. */
  walletIdentifier: z.string().nullable(),
  candidateWrappers: z.array(z.string()),
  sessionState: z.string().nullable(),
  referenceFreshnessMs: z.number().nullable(),
  executionModes: z.array(z.string()),
  selectedRouteId: z.string().nullable(),
  rejectedRoutes: z.array(z.object({ routeId: z.string(), reasons: z.array(z.string()) })),
  decision: z.string(),
  ablationVariant: z.string(),
});

export const executionRecordSchema = z.object({
  kind: z.literal("execution"),
  executionId: z.string(),
  routeSessionId: z.string(),
  mode: z.string(),
  approvalTxHash: z.string().nullable(),
  quoteId: z.string(),
  vendor: z.string(),
  rfqOrderId: z.string().nullable(),
  swapTxHash: z.string().nullable(),
  simulationResult: z.string(),
  terminalStatus: z.string(),
  verifiedTokenTransfers: z.number().nullable(),
  independentReceiptStatus: z.string().nullable(),
  observedAt: z.string(),
});

export const evidenceRecordSchema = z.discriminatedUnion("kind", [
  apiRequestRecordSchema,
  routeObservationSchema,
  executionRecordSchema,
]);

export type ApiRequestRecord = z.infer<typeof apiRequestRecordSchema>;
export type RouteObservation = z.infer<typeof routeObservationSchema>;
export type ExecutionEvidence = z.infer<typeof executionRecordSchema>;
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

export interface EvidenceSink {
  append(record: EvidenceRecord): Promise<void>;
}

/** In-memory sink. Used in tests and as the development default. */
export class MemoryEvidenceSink implements EvidenceSink {
  readonly records: EvidenceRecord[] = [];
  async append(record: EvidenceRecord): Promise<void> {
    this.records.push(record);
  }
}

export class EvidenceRecorder {
  #failures = 0;

  constructor(
    private readonly sink: EvidenceSink,
    private readonly onFailure?: (error: unknown) => void,
  ) {}

  /**
   * Append a record. Deliberately never throws: observability is not allowed
   * to break the product. Failures are counted and reported out of band.
   */
  async record(record: EvidenceRecord): Promise<void> {
    try {
      const parsed = evidenceRecordSchema.parse(redactValue(record));
      await this.sink.append(parsed);
    } catch (error) {
      this.#failures += 1;
      this.onFailure?.(error);
    }
  }

  get failureCount(): number {
    return this.#failures;
  }
}

export interface LatencySummary {
  readonly endpoint: string;
  readonly count: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
}

/**
 * Latency percentiles per endpoint, for the DX report.
 *
 * Percentiles are returned as null below a minimum sample size rather than
 * computed from two data points — a p95 from three samples is not a p95, and
 * publishing one would be exactly the kind of unearned number the claim ledger
 * exists to prevent.
 */
export const MIN_SAMPLES_FOR_PERCENTILE = 20;

export function summarizeLatency(records: readonly ApiRequestRecord[]): LatencySummary[] {
  const byEndpoint = new Map<string, number[]>();
  for (const record of records) {
    const bucket = byEndpoint.get(record.endpoint) ?? [];
    bucket.push(record.latencyMs);
    byEndpoint.set(record.endpoint, bucket);
  }

  return [...byEndpoint.entries()]
    .map(([endpoint, latencies]) => {
      const sorted = [...latencies].sort((a, b) => a - b);
      const enough = sorted.length >= MIN_SAMPLES_FOR_PERCENTILE;
      return {
        endpoint,
        count: sorted.length,
        p50Ms: enough ? percentile(sorted, 0.5) : null,
        p95Ms: enough ? percentile(sorted, 0.95) : null,
      };
    })
    .sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

function percentile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[index] ?? null;
}
