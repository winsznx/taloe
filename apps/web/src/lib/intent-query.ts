/**
 * Shared query-parameter contract across /route, /review, /execution and
 * /receipt.
 *
 * The product has no session store yet (PRD 21 describes one for later).
 * Rather than fake persistence with an in-memory Map that would not survive
 * a redeploy or a second server instance, every page here is a pure function
 * of its URL: given the same query string, `/route` always re-derives the
 * same decision (fixture scenarios are deterministic by ticker; live mode
 * will be deterministic by construction once wired). This keeps the pages
 * stateless, bookmarkable, and shareable, and is honest about what does not
 * exist yet rather than simulating persistence that isn't real.
 */

export interface IntentQuery {
  readonly q: string;
  readonly amount: string;
  readonly maxDeviationBps: number;
  readonly wallet: string | null;
  /** Fixture-only demo toggle for the NO_ACTION path. Never a live concept yet. */
  readonly holdAlready: boolean;
}

export type ParsedIntentQuery = { ok: true; value: IntentQuery } | { ok: false; message: string };

export function parseIntentQuery(
  params: Record<string, string | string[] | undefined>,
  defaultMaxDeviationBps: number,
): ParsedIntentQuery {
  const q = first(params.q)?.trim() ?? "";
  if (q.length === 0) {
    return { ok: false, message: "Enter a company name or ticker to continue." };
  }

  const amount = first(params.amount)?.trim() ?? "";
  if (amount.length === 0 || !/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
    return { ok: false, message: `"${amount}" is not an amount Taloe can read.` };
  }

  const rawBps = first(params.maxDeviationBps);
  const maxDeviationBps = rawBps ? Number(rawBps) : defaultMaxDeviationBps;
  if (!Number.isInteger(maxDeviationBps) || maxDeviationBps <= 0 || maxDeviationBps > 10_000) {
    return { ok: false, message: "The execution limit must be between 1 and 10000 basis points." };
  }

  const wallet = first(params.wallet)?.trim() || null;
  const holdAlready = first(params.holdAlready) === "1";

  return { ok: true, value: { q, amount, maxDeviationBps, wallet, holdAlready } };
}

/** Build a query string carrying the intent forward to another page. */
export function intentQueryString(intent: IntentQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    q: intent.q,
    amount: intent.amount,
    maxDeviationBps: String(intent.maxDeviationBps),
    ...(intent.wallet ? { wallet: intent.wallet } : {}),
    ...(intent.holdAlready ? { holdAlready: "1" } : {}),
    ...extra,
  });
  return params.toString();
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
