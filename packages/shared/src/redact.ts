/**
 * Log and evidence redaction.
 *
 * Evidence records are written to disk and quoted in the submission, so the
 * redaction pass runs on the way in rather than at render time. Anything that
 * could re-authenticate a request or move funds must never reach a record.
 */

const SENSITIVE_KEY_PATTERN =
  /^(x-oc-apikey|x-oc-sign|authorization|cookie|set-cookie|api[-_]?key|secret([-_]?key)?|private[-_]?key|mnemonic|seed([-_]?phrase)?|password|signed[-_]?transaction|user[-_]?signature)$/i;

export const REDACTED = "[redacted]";

/** Rate-limit headers worth preserving for the DX report. */
const PRESERVED_HEADERS = new Set([
  "retry-after",
  "x-oc-ratelimit-limit",
  "x-oc-ratelimit-remaining",
  "x-oc-used-weight",
  "content-type",
]);

export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  const out: Record<string, string> = {};
  for (const [rawKey, value] of entries) {
    const key = rawKey.toLowerCase();
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = REDACTED;
    } else if (PRESERVED_HEADERS.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

/** Recursively redact sensitive keys from an arbitrary value. */
export function redactValue(input: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth-limit]";
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((item) => redactValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(value, depth + 1);
  }
  return out;
}

/**
 * Truncate an EVM address or hash for display while keeping it identifiable.
 * Callers must always keep the full value available behind a copy control.
 */
export function truncateHex(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/**
 * Stable, non-reversible identifier for a wallet address, for use in evidence
 * records where we need to correlate observations without storing the address.
 */
export async function hashWalletAddress(address: string): Promise<string> {
  const data = new TextEncoder().encode(address.toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
