/**
 * The single signed Binance Web3 API client.
 *
 * Signing logic exists here and nowhere else. Every adapter goes through
 * `request`, which means the /build prefix rule, the raw-query rule, the
 * business-code check and the DX/latency instrumentation are applied uniformly
 * and cannot drift between call sites.
 */

import type { Result } from "@taloe/shared";
import { err, ok, redactHeaders } from "@taloe/shared";
import type { z } from "zod";

import { BinanceApiError, classifyBusinessCode, isRetryableKind } from "./errors";
import type { QueryParams } from "./signing";
import { signRequest } from "./signing";

export interface BinanceClientConfig {
  readonly apiKey: string;
  readonly apiSecret: string;
  /** Must already include the /build prefix, e.g. https://web3.binance.com/build */
  readonly baseUrl: string;
  readonly recvWindowMs?: number;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onObservation?: (observation: ApiObservation) => void;
}

/**
 * One instrumented call. Written to the evidence log and, in aggregate, is the
 * latency and rate-limit data the DX report is built from — so it is captured
 * at the point of the call rather than reconstructed later (PRD 19).
 */
export interface ApiObservation {
  readonly timestamp: string;
  readonly correlationId: string;
  readonly endpoint: string;
  readonly method: string;
  readonly httpStatus: number | null;
  readonly businessCode: number | null;
  readonly latencyMs: number;
  readonly retryCount: number;
  readonly rateLimitHeaders: Record<string, string>;
  readonly outcome: "SUCCESS" | "BUSINESS_ERROR" | "TRANSPORT_ERROR" | "SCHEMA_ERROR";
}

export interface RequestOptions<T> {
  readonly method: "GET" | "POST";
  /** Path WITHOUT /build; the signer adds it to both URL and signature. */
  readonly path: string;
  readonly query?: QueryParams;
  readonly body?: unknown;
  /** Runtime schema for the `data` field. Documentation examples are not a contract. */
  readonly schema: z.ZodType<T>;
  readonly correlationId?: string;
  readonly signal?: AbortSignal;
}

/** The envelope every endpoint wraps its payload in. */
interface Envelope {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;

export class BinanceWeb3Client {
  readonly #config: Required<
    Pick<BinanceClientConfig, "apiKey" | "apiSecret" | "baseUrl" | "timeoutMs" | "maxRetries">
  > & {
    recvWindowMs: number | undefined;
    fetchImpl: typeof fetch;
    onObservation: ((observation: ApiObservation) => void) | undefined;
  };

  constructor(config: BinanceClientConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error(
        "BinanceWeb3Client requires an API key and secret. These are server-side only.",
      );
    }
    if (!config.baseUrl.endsWith("/build")) {
      // Catching this here is cheaper than debugging a 40102 later: the signed
      // path and the wire path must both carry /build, and the base URL is
      // where they diverge.
      throw new Error(
        `baseUrl must end with /build (received "${config.baseUrl}"). ` +
          "The /build prefix is part of both the request URL and the signed requestPath.",
      );
    }
    this.#config = {
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      baseUrl: config.baseUrl.replace(/\/$/, ""),
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      recvWindowMs: config.recvWindowMs,
      fetchImpl: config.fetchImpl ?? fetch,
      onObservation: config.onObservation,
    };
  }

  async request<T>(options: RequestOptions<T>): Promise<Result<T, BinanceApiError>> {
    const correlationId = options.correlationId ?? crypto.randomUUID();
    let lastError: BinanceApiError | null = null;

    for (let attempt = 0; attempt <= this.#config.maxRetries; attempt += 1) {
      const result = await this.#attempt(options, correlationId, attempt);
      if (result.ok) return result;

      lastError = result.error;
      if (!isRetryableKind(result.error.kind) || attempt === this.#config.maxRetries) {
        return result;
      }
      await delay(backoffMs(attempt, result.error.retryAfterSeconds));
    }

    /* c8 ignore next — the loop always returns; this satisfies the type checker. */
    return err(lastError!);
  }

  async #attempt<T>(
    options: RequestOptions<T>,
    correlationId: string,
    retryCount: number,
  ): Promise<Result<T, BinanceApiError>> {
    // The body is serialized exactly once and that same string is both signed
    // and sent. Re-serializing would risk a byte difference and a 40102.
    const rawBody = options.body === undefined ? undefined : JSON.stringify(options.body);

    const signed = signRequest({
      apiKey: this.#config.apiKey,
      apiSecret: this.#config.apiSecret,
      method: options.method,
      path: options.path,
      query: options.query,
      body: rawBody,
      recvWindowMs: this.#config.recvWindowMs,
      // Unique per attempt. Without it the anti-replay key falls back to the
      // signature, and two identical requests in the same millisecond (observed
      // live: parallel rwa/search calls) collide as 40103 "replayed".
      nonce: crypto.randomUUID(),
    });

    // `signed.requestPath` already carries /build, and the base URL ends with
    // /build, so the prefix is stripped here to avoid doubling it.
    const url = `${this.#config.baseUrl}${signed.requestPath.slice("/build".length)}`;
    const startedAt = performance.now();
    const timeout = AbortSignal.timeout(this.#config.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

    let response: Response;
    try {
      response = await this.#config.fetchImpl(url, {
        method: options.method,
        headers: signed.headers,
        body: rawBody,
        signal,
      });
    } catch (cause) {
      const error = new BinanceApiError({
        kind: "TRANSPORT",
        message: cause instanceof Error ? cause.message : "transport failure",
        httpStatus: null,
        businessCode: null,
        endpoint: options.path,
        retryable: true,
      });
      this.#observe({
        correlationId,
        endpoint: options.path,
        method: options.method,
        httpStatus: null,
        businessCode: null,
        latencyMs: performance.now() - startedAt,
        retryCount,
        rateLimitHeaders: {},
        outcome: "TRANSPORT_ERROR",
      });
      return err(error);
    }

    const latencyMs = performance.now() - startedAt;
    const rateLimitHeaders = redactHeaders(response.headers);
    const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));

    let envelope: Envelope | null = null;
    try {
      envelope = (await response.json()) as Envelope;
    } catch {
      envelope = null;
    }

    const businessCode = typeof envelope?.code === "number" ? envelope.code : null;
    const businessMsg = typeof envelope?.msg === "string" ? envelope.msg : null;

    // Bar 1: transport. A 429 is reported as a rate limit even when the body
    // is unparseable, because the retry policy depends on it.
    if (!response.ok) {
      const kind =
        response.status === 429
          ? "RATE_LIMIT"
          : businessCode !== null
            ? classifyBusinessCode(businessCode)
            : response.status >= 500
              ? "SERVER"
              : "UNKNOWN";
      const error = new BinanceApiError({
        kind,
        message: businessMsg ?? `HTTP ${response.status}`,
        httpStatus: response.status,
        businessCode,
        endpoint: options.path,
        retryable: isRetryableKind(kind),
        retryAfterSeconds,
      });
      this.#observe({
        correlationId,
        endpoint: options.path,
        method: options.method,
        httpStatus: response.status,
        businessCode,
        latencyMs,
        retryCount,
        rateLimitHeaders,
        outcome: "TRANSPORT_ERROR",
      });
      return err(error);
    }

    // Bar 2: business code. This is the check HTTP 200 does not give us.
    if (businessCode !== 0) {
      const kind = businessCode === null ? "SCHEMA" : classifyBusinessCode(businessCode);
      const error = new BinanceApiError({
        kind,
        message:
          businessMsg ??
          (businessCode === null
            ? "response body carried no numeric `code` field"
            : `business error ${businessCode}`),
        httpStatus: response.status,
        businessCode,
        endpoint: options.path,
        retryable: isRetryableKind(kind),
        retryAfterSeconds,
      });
      this.#observe({
        correlationId,
        endpoint: options.path,
        method: options.method,
        httpStatus: response.status,
        businessCode,
        latencyMs,
        retryCount,
        rateLimitHeaders,
        outcome: "BUSINESS_ERROR",
      });
      return err(error);
    }

    // Bar 3: shape. Doc examples are not a contract, so the payload is parsed
    // rather than cast.
    const parsed = options.schema.safeParse(envelope?.data);
    if (!parsed.success) {
      const error = new BinanceApiError({
        kind: "SCHEMA",
        message: `response did not match the expected shape: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
          .join("; ")}`,
        httpStatus: response.status,
        businessCode,
        endpoint: options.path,
        retryable: false,
        details: parsed.error.issues,
      });
      this.#observe({
        correlationId,
        endpoint: options.path,
        method: options.method,
        httpStatus: response.status,
        businessCode,
        latencyMs,
        retryCount,
        rateLimitHeaders,
        outcome: "SCHEMA_ERROR",
      });
      return err(error);
    }

    this.#observe({
      correlationId,
      endpoint: options.path,
      method: options.method,
      httpStatus: response.status,
      businessCode,
      latencyMs,
      retryCount,
      rateLimitHeaders,
      outcome: "SUCCESS",
    });
    return ok(parsed.data);
  }

  #observe(observation: Omit<ApiObservation, "timestamp">): void {
    this.#config.onObservation?.({
      ...observation,
      latencyMs: Math.round(observation.latencyMs),
      timestamp: new Date().toISOString(),
    });
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : null;
}

/** Exponential backoff with jitter, bounded, honouring Retry-After when given. */
function backoffMs(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) return Math.min(retryAfterSeconds * 1000, 10_000);
  const base = Math.min(250 * 2 ** attempt, 4_000);
  return base + Math.random() * 250;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
