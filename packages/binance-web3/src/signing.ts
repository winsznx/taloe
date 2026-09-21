/**
 * Binance Web3 API request signing.
 *
 * Implemented directly against the current authentication doc
 * (https://web3.binance.com/en/dev-docs/authentication, retrieved 2026-09-21):
 *
 *   preHash   = timestamp + METHOD + requestPath + body
 *   signature = Base64(HMAC-SHA256(preHash, secretKey))
 *
 * Three details the doc calls out that are easy to get wrong, and that this
 * module exists to make impossible to get wrong anywhere else:
 *
 *  1. `requestPath` must carry the literal `/build` prefix. The doc names
 *     omitting it as the number-one cause of `40102 Invalid signature`. The
 *     edge redirects an unprefixed URL, so the request still routes and only
 *     the signature fails — a confusing failure worth centralising.
 *  2. The query string must be signed in the exact raw encoding sent on the
 *     wire: no re-ordering, no re-encoding, no merging. We therefore build the
 *     query string once and use that same string for both the URL and preHash.
 *  3. `X-OC-TIMESTAMP` is an ISO 8601 string with milliseconds, not epoch ms.
 */

import { createHmac } from "node:crypto";

export const BUILD_PREFIX = "/build";

export interface SignedRequestParts {
  /** Path with query, including the /build prefix, exactly as signed and sent. */
  readonly requestPath: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly headers: Record<string, string>;
}

export interface SignRequestInput {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly method: string;
  /** Path WITHOUT the /build prefix, e.g. "/api/v1/dex/market/rwa/search". */
  readonly path: string;
  readonly query?: QueryParams;
  /** Raw body string for POST/PUT/DELETE. Must be byte-identical to what is sent. */
  readonly body?: string;
  readonly recvWindowMs?: number;
  readonly nonce?: string;
  /** Injectable for deterministic tests. */
  readonly now?: Date;
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/**
 * Build the raw query string.
 *
 * `encodeURIComponent` is used so a space becomes `%20` rather than `+`, which
 * is what the doc's own helper does and what the signature must match.
 * Insertion order is preserved and never sorted: the doc forbids re-ordering,
 * so the caller's order is the wire order is the signed order.
 */
export function buildQueryString(query: QueryParams | undefined): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join("&");
}

/** ISO 8601 with exactly three fractional digits, as the doc's examples show. */
export function isoTimestamp(now: Date = new Date()): string {
  return now.toISOString();
}

export function buildPreHash(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
): string {
  return `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
}

export function signPreHash(preHash: string, apiSecret: string): string {
  return createHmac("sha256", apiSecret).update(preHash, "utf8").digest("base64");
}

export function signRequest(input: SignRequestInput): SignedRequestParts {
  const method = input.method.toUpperCase();
  // The doc specifies an empty body string for GET/HEAD. Signing anything else
  // for those methods produces a 40102 that looks like a credential problem.
  const body = method === "GET" || method === "HEAD" ? "" : (input.body ?? "");

  const queryString = buildQueryString(input.query);
  const pathWithQuery = queryString ? `${input.path}?${queryString}` : input.path;
  const requestPath = input.path.startsWith(BUILD_PREFIX)
    ? pathWithQuery
    : `${BUILD_PREFIX}${pathWithQuery}`;

  const timestamp = isoTimestamp(input.now);
  const signature = signPreHash(
    buildPreHash(timestamp, method, requestPath, body),
    input.apiSecret,
  );

  const headers: Record<string, string> = {
    "X-OC-APIKEY": input.apiKey,
    "X-OC-TIMESTAMP": timestamp,
    "X-OC-SIGN": signature,
  };
  if (input.recvWindowMs !== undefined) {
    headers["X-OC-RECV-WINDOW"] = String(input.recvWindowMs);
  }
  if (input.nonce !== undefined) {
    headers["X-OC-NONCE"] = input.nonce;
  }
  if (body !== "") {
    headers["Content-Type"] = "application/json";
  }

  return { requestPath, timestamp, signature, headers };
}
