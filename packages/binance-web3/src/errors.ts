/**
 * Normalized Binance Web3 API errors.
 *
 * The platform returns HTTP 200 with a non-zero body `code` for business
 * failures, so a transport-level status is never treated as success anywhere
 * in Taloe. Every response must clear three bars before it counts (PRD 5.2):
 *
 *   HTTP transport succeeded AND body.code === 0 AND the data shape validates
 *
 * Error codes below are transcribed from the current docs (retrieved
 * 2026-09-21). Codes observed at runtime that are not listed here are carried
 * through as UNKNOWN rather than being coerced into a known category.
 */

export type BinanceErrorKind =
  | "TRANSPORT" // network failure, timeout, DNS
  | "AUTH" // 40101 / 40102 / 40103 / 40104
  | "RATE_LIMIT" // 42900 / HTTP 429
  | "INVALID_REQUEST" // 40001 and parameter-level rejections
  | "QUOTE_EXPIRED" // 40401
  | "QUOTE_MISMATCH" // 40462
  | "MARKET_CLOSED" // 40367 (Ondo) / 40369 (BStock)
  | "COMPLIANCE" // region / permission refusals
  | "SCHEMA" // HTTP 200, code 0, but the payload did not validate
  | "SERVER" // 50000 / 50001
  | "UNKNOWN";

export interface BinanceApiErrorInit {
  readonly kind: BinanceErrorKind;
  readonly message: string;
  readonly httpStatus: number | null;
  readonly businessCode: number | null;
  readonly endpoint: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number | null;
  readonly details?: unknown;
}

export class BinanceApiError extends Error {
  readonly kind: BinanceErrorKind;
  readonly httpStatus: number | null;
  readonly businessCode: number | null;
  readonly endpoint: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;
  readonly details: unknown;

  constructor(init: BinanceApiErrorInit) {
    super(init.message);
    this.name = "BinanceApiError";
    this.kind = init.kind;
    this.httpStatus = init.httpStatus;
    this.businessCode = init.businessCode;
    this.endpoint = init.endpoint;
    this.retryable = init.retryable;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.details = init.details;
  }

  /** Safe for logs and evidence records: carries no credential material. */
  toRecord(): Record<string, unknown> {
    return {
      kind: this.kind,
      message: this.message,
      httpStatus: this.httpStatus,
      businessCode: this.businessCode,
      endpoint: this.endpoint,
      retryable: this.retryable,
      retryAfterSeconds: this.retryAfterSeconds,
    };
  }
}

/** Documented gateway and product error codes, current as of 2026-09-21. */
export const BUSINESS_CODE_KIND: Readonly<Record<number, BinanceErrorKind>> = {
  40001: "INVALID_REQUEST",
  40101: "AUTH",
  40102: "AUTH",
  40103: "AUTH",
  40104: "AUTH",
  40367: "MARKET_CLOSED", // Ondo outside US market hours
  40369: "MARKET_CLOSED", // BStock outside US market hours
  40401: "QUOTE_EXPIRED",
  40462: "QUOTE_MISMATCH",
  40466: "INVALID_REQUEST", // INVALID_FEE_PERCENT
  40467: "INVALID_REQUEST", // INVALID_REFERRER_ADDRESS
  40468: "INVALID_REQUEST", // CONFLICT_REFERRER_PARAMS
  40469: "INVALID_REQUEST", // REFERRER_NOT_ACTIVATED
  42900: "RATE_LIMIT",
  50000: "SERVER",
  50001: "SERVER",
};

export function classifyBusinessCode(code: number): BinanceErrorKind {
  return BUSINESS_CODE_KIND[code] ?? "UNKNOWN";
}

/**
 * Whether a failure is worth retrying with the SAME request.
 *
 * An expired quote is deliberately not retryable: the PRD forbids replaying a
 * dead quoteId, and the correct recovery is a fresh quote plus a re-run of the
 * whole routing decision, which is a caller-level concern (PRD 13).
 */
export function isRetryableKind(kind: BinanceErrorKind): boolean {
  return kind === "TRANSPORT" || kind === "RATE_LIMIT" || kind === "SERVER";
}
