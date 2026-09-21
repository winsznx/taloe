/**
 * SessionMark — market/session context for WrapRoute.
 *
 * Not a dashboard. It answers four questions the router needs:
 *   - is the underlying reference currently live?
 *   - how stale is the reference price?
 *   - is this an ordinary market closure or an issuer halt?
 *   - when does the next relevant session start?
 *
 * The distinction between CLOSED and PAUSED is the important one. A closed
 * underlying market is NOT a refusal (PRD 8.7): tokenized wrappers can keep
 * trading while the reference market is shut, and refusing there would block
 * the product for most of the day. A halt is a refusal. Conflating them would
 * either over-refuse or execute into a halted market.
 *
 * States not supportable by live data are never invented — the honest answer
 * is UNKNOWN, which makes the router demand more scrutiny rather than less.
 */

import type { MarketContext, SessionState, WrapperStatusInfo } from "@taloe/shared";

export interface SessionMarkInput {
  readonly underlyingTicker: string;
  readonly marketStatus: string | null;
  readonly openState: boolean | null;
  readonly referencePrice: string | null;
  /** Epoch ms from the API, when present. */
  readonly referenceTime: number | null;
  readonly nextOpenTime: number | null;
  readonly nextCloseTime: number | null;
  readonly statusInfo: WrapperStatusInfo | null;
  readonly provenance: readonly string[];
  readonly now?: Date;
}

/**
 * Reference prices older than this are reported as stale. Provisional: the
 * live campaign is expected to set it from observed update cadence. It is a
 * named constant so it is visible and tunable, not buried in a comparison.
 */
export const REFERENCE_STALE_AFTER_MS = 120_000;

/**
 * Status strings that indicate a halt rather than a scheduled close.
 * Matched case-insensitively as substrings because the vocabulary is not yet
 * confirmed against live responses; an unmatched string yields UNKNOWN, not a
 * cheerful default.
 */
const HALT_MARKERS = ["halt", "paused", "pause", "suspend", "delist"];

const STATE_BY_STATUS: Readonly<Record<string, SessionState>> = {
  regular: "REGULAR",
  open: "REGULAR",
  trading: "REGULAR",
  premarket: "PREMARKET",
  pre_market: "PREMARKET",
  pre: "PREMARKET",
  postmarket: "POSTMARKET",
  post_market: "POSTMARKET",
  post: "POSTMARKET",
  afterhours: "POSTMARKET",
  after_hours: "POSTMARKET",
  overnight: "OVERNIGHT",
  closed: "CLOSED",
  close: "CLOSED",
};

export function interpretSession(input: SessionMarkInput): MarketContext {
  const now = input.now ?? new Date();
  const rawStatus = input.marketStatus ?? input.statusInfo?.marketStatus ?? null;
  const normalized = rawStatus?.toLowerCase().replace(/[\s-]/g, "_") ?? null;

  const reasonText = [input.statusInfo?.reasonCode, input.statusInfo?.reasonMsg, rawStatus]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const isHalted = HALT_MARKERS.some((marker) => reasonText.includes(marker));

  const sessionState = resolveSessionState(normalized, input.openState, isHalted);

  const referenceAgeMs = input.referenceTime !== null ? now.getTime() - input.referenceTime : null;

  return {
    underlyingTicker: input.underlyingTicker,
    sessionState,
    rawMarketStatus: rawStatus,
    referencePrice: input.referencePrice,
    referenceObservedAt:
      input.referenceTime !== null ? new Date(input.referenceTime).toISOString() : null,
    referenceAgeMs,
    isHalted,
    nextOpenTime: input.nextOpenTime ?? input.statusInfo?.nextOpenTime ?? null,
    nextCloseTime: input.nextCloseTime ?? input.statusInfo?.nextCloseTime ?? null,
    provenance: input.provenance,
  };
}

function resolveSessionState(
  normalizedStatus: string | null,
  openState: boolean | null,
  isHalted: boolean,
): SessionState {
  if (isHalted) return "PAUSED";
  if (normalizedStatus !== null) {
    const mapped = STATE_BY_STATUS[normalizedStatus];
    if (mapped) return mapped;
  }
  // openState alone distinguishes open from shut but cannot tell us *which*
  // session, so a closed market with no status string stays CLOSED and an open
  // one with no status string is UNKNOWN rather than assumed REGULAR.
  if (openState === false) return "CLOSED";
  return "UNKNOWN";
}

/** True when the reference price is too old to anchor a deviation check. */
export function isReferenceStale(
  context: MarketContext,
  maxAgeMs: number = REFERENCE_STALE_AFTER_MS,
): boolean {
  if (context.referencePrice === null) return true;
  if (context.referenceAgeMs === null) return false;
  return context.referenceAgeMs > maxAgeMs;
}

/**
 * Whether session state alone should block execution.
 *
 * Only a halt does. Everything else — closed, overnight, pre/post market — is
 * context that raises scrutiny and can widen the deviation the user sees, but
 * is not on its own a product rule violation.
 */
export function blocksExecution(context: MarketContext): boolean {
  return context.isHalted || context.sessionState === "PAUSED";
}

/** User-facing label. Product language, not API vocabulary. */
export function sessionLabel(context: MarketContext): string {
  switch (context.sessionState) {
    case "REGULAR":
      return "Regular market session";
    case "PREMARKET":
      return "Pre-market";
    case "POSTMARKET":
      return "Post-market";
    case "OVERNIGHT":
      return "Overnight";
    case "CLOSED":
      return "Underlying market closed";
    case "PAUSED":
      return "Trading paused by the issuer";
    case "UNKNOWN":
      return "Reference context unavailable";
  }
}
