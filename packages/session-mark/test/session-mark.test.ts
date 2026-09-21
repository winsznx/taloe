import { describe, expect, it } from "vitest";

import { blocksExecution, interpretSession, isReferenceStale, sessionLabel } from "../src/index";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function interpret(overrides: Partial<Parameters<typeof interpretSession>[0]> = {}) {
  return interpretSession({
    underlyingTicker: "NVDA",
    marketStatus: "REGULAR",
    openState: true,
    referencePrice: "100",
    referenceTime: NOW.getTime() - 5_000,
    nextOpenTime: null,
    nextCloseTime: null,
    statusInfo: null,
    provenance: ["test"],
    now: NOW,
    ...overrides,
  });
}

describe("SessionMark", () => {
  it("maps a regular session", () => {
    expect(interpret().sessionState).toBe("REGULAR");
  });

  it("maps pre- and post-market variants regardless of separator style", () => {
    expect(interpret({ marketStatus: "PRE_MARKET" }).sessionState).toBe("PREMARKET");
    expect(interpret({ marketStatus: "post-market" }).sessionState).toBe("POSTMARKET");
    expect(interpret({ marketStatus: "After Hours" }).sessionState).toBe("POSTMARKET");
  });

  it("distinguishes an issuer halt from an ordinary close", () => {
    // This distinction decides whether the router refuses. Getting it wrong
    // either blocks the product every night or trades into a halt.
    const closed = interpret({ marketStatus: "CLOSED", openState: false });
    expect(closed.sessionState).toBe("CLOSED");
    expect(closed.isHalted).toBe(false);
    expect(blocksExecution(closed)).toBe(false);

    const halted = interpret({
      marketStatus: "CLOSED",
      openState: false,
      statusInfo: {
        openState: false,
        marketStatus: "CLOSED",
        reasonCode: "TRADING_HALT",
        reasonMsg: "Trading halted by the issuer",
        nextOpenTime: null,
        nextCloseTime: null,
      },
    });
    expect(halted.sessionState).toBe("PAUSED");
    expect(halted.isHalted).toBe(true);
    expect(blocksExecution(halted)).toBe(true);
  });

  it("reports UNKNOWN rather than guessing when the status string is unrecognised", () => {
    const context = interpret({ marketStatus: "SOMETHING_NEW", openState: true });
    expect(context.sessionState).toBe("UNKNOWN");
    expect(sessionLabel(context)).toBe("Reference context unavailable");
  });

  it("treats an absent reference price as stale", () => {
    expect(isReferenceStale(interpret({ referencePrice: null }))).toBe(true);
  });

  it("treats an old reference price as stale", () => {
    expect(isReferenceStale(interpret({ referenceTime: NOW.getTime() - 600_000 }))).toBe(true);
    expect(isReferenceStale(interpret({ referenceTime: NOW.getTime() - 5_000 }))).toBe(false);
  });

  it("preserves the raw status string for evidence", () => {
    expect(interpret({ marketStatus: "PRE_MARKET" }).rawMarketStatus).toBe("PRE_MARKET");
  });

  it("computes reference age from the API timestamp", () => {
    expect(interpret({ referenceTime: NOW.getTime() - 30_000 }).referenceAgeMs).toBe(30_000);
  });
});
