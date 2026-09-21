import { describe, expect, it } from "vitest";

import { createExecution, transition, verificationFor } from "../src/machine";
import { canTransition, isTerminal } from "../src/states";

const BASE = {
  executionId: "ex-1",
  routeSessionId: "rs-1",
  quoteId: "q-1",
  vendorName: "PcsXRfq",
  walletAddress: "0x1111111111111111111111111111111111111111",
};

describe("SWAP machine", () => {
  it("starts in ROUTE_SELECTED", () => {
    expect(createExecution({ ...BASE, mode: "SWAP" }).state).toBe("ROUTE_SELECTED");
  });

  it("cannot skip simulation on the way to a signature", () => {
    // The gap this closes: a UI bug jumping straight to "sign" would otherwise
    // put a user in front of an unsimulated transaction.
    expect(canTransition("SWAP", "BUILD_SWAP", "USER_SIGN_SWAP")).toBe(false);
    expect(canTransition("SWAP", "BUILD_SWAP", "SIMULATE_SWAP")).toBe(true);
    expect(canTransition("SWAP", "SIMULATE_SWAP", "USER_SIGN_SWAP")).toBe(false);
    expect(canTransition("SWAP", "SIMULATION_PASSED", "USER_SIGN_SWAP")).toBe(true);
  });

  it("cannot jump from a broadcast straight to verified success", () => {
    expect(canTransition("SWAP", "BROADCAST_SWAP", "VERIFIED_SUCCESS")).toBe(false);
    expect(canTransition("SWAP", "BROADCAST_SWAP", "CHAIN_PENDING")).toBe(true);
  });

  it("does not treat chain confirmation as Taloe's own verified success (correction 4)", () => {
    // The chain confirming the transaction is a sponsor/chain-native signal,
    // not Taloe's product-level claim. It must pass through Taloe's own
    // verification phase before either terminal claim is reachable.
    expect(canTransition("SWAP", "CHAIN_PENDING", "VERIFIED_SUCCESS")).toBe(false);
    expect(canTransition("SWAP", "CHAIN_PENDING", "EXECUTED_PENDING_VERIFICATION")).toBe(true);
    expect(canTransition("SWAP", "EXECUTED_PENDING_VERIFICATION", "VERIFYING")).toBe(true);
    expect(canTransition("SWAP", "VERIFYING", "VERIFIED_SUCCESS")).toBe(true);
  });

  it("trusts a chain-native failure directly, without a further verification pass", () => {
    // A reverted transaction needs no independent check — the chain itself
    // already said no.
    expect(canTransition("SWAP", "CHAIN_PENDING", "VERIFIED_FAILURE")).toBe(true);
  });

  it("can end a verification attempt as inconclusive rather than forcing a false claim either way", () => {
    expect(canTransition("SWAP", "VERIFYING", "VERIFICATION_FAILED")).toBe(true);
    expect(isTerminal("SWAP", "VERIFICATION_FAILED")).toBe(true);
  });

  it("forces revalidation after an approval confirms", () => {
    // An approval can consume most of a 30s quote, so the only way out of
    // APPROVAL_CONFIRMED is a re-quote.
    expect(canTransition("SWAP", "APPROVAL_CONFIRMED", "BUILD_SWAP")).toBe(false);
    expect(canTransition("SWAP", "APPROVAL_CONFIRMED", "REQUOTE_AND_REVALIDATE")).toBe(true);
  });

  it("rejects an illegal transition instead of applying it", () => {
    const record = createExecution({ ...BASE, mode: "SWAP" });
    const result = transition(record, "VERIFIED_SUCCESS");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ILLEGAL_TRANSITION");
  });

  it("appends to history on a legal transition", () => {
    const record = createExecution({ ...BASE, mode: "SWAP" });
    const result = transition(record, "ALLOWANCE_CHECK", { note: "checking allowance" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("ALLOWANCE_CHECK");
      expect(result.value.history).toHaveLength(2);
      expect(result.value.history[1]?.note).toBe("checking allowance");
    }
  });

  it("refuses to move once terminal", () => {
    const record = { ...createExecution({ ...BASE, mode: "SWAP" }), state: "VERIFIED_SUCCESS" as const };
    const result = transition(record, "CHAIN_PENDING");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("TERMINAL");
  });
});

describe("RFQ machine", () => {
  it("starts in RFQ_ROUTE_SELECTED", () => {
    expect(createExecution({ ...BASE, mode: "RFQ" }).state).toBe("RFQ_ROUTE_SELECTED");
  });

  it("has no simulation step, because the client holds no transaction to simulate", () => {
    expect(canTransition("RFQ", "BUILD_RFQ_PAYLOAD", "VALIDATE_TYPED_DATA")).toBe(true);
    expect(canTransition("RFQ", "BUILD_RFQ_PAYLOAD", "SIMULATE_SWAP")).toBe(false);
  });

  it("does not accept a SWAP broadcast as its settlement path", () => {
    // Broadcasting a swap is not how an RFQ order settles; conflating them
    // would report a vendor order as an on-chain result.
    expect(canTransition("RFQ", "SUBMIT_RFQ_ORDER", "BROADCAST_SWAP")).toBe(false);
    expect(canTransition("RFQ", "SUBMIT_RFQ_ORDER", "PENDING_VENDOR")).toBe(true);
  });

  it("allows an expired order to be re-quoted", () => {
    expect(canTransition("RFQ", "EXPIRED", "REQUOTE_IF_NEEDED")).toBe(true);
  });

  it("treats FILLED as needing verification, not as done", () => {
    // FILLED is the sponsor's own terminal state for the ORDER and is
    // preserved exactly (correction 4) — but it is not Taloe's final word.
    expect(isTerminal("RFQ", "FILLED")).toBe(false);
    expect(canTransition("RFQ", "FILLED", "EXECUTED_PENDING_VERIFICATION")).toBe(true);
    // It must not shortcut straight to a Taloe-level claim.
    expect(canTransition("RFQ", "FILLED", "VERIFIED_SUCCESS")).toBe(false);
  });

  it("routes FILLED through Taloe's own verification phase before any terminal claim", () => {
    expect(canTransition("RFQ", "EXECUTED_PENDING_VERIFICATION", "VERIFYING")).toBe(true);
    expect(canTransition("RFQ", "VERIFYING", "VERIFIED_SUCCESS")).toBe(true);
    expect(canTransition("RFQ", "VERIFYING", "VERIFIED_FAILURE")).toBe(true);
    expect(canTransition("RFQ", "VERIFYING", "VERIFICATION_FAILED")).toBe(true);
  });

  it("trusts the sponsor's own FAILED/CANCELLED without a further verification pass", () => {
    // The sponsor affirmatively saying "did not fill" needs no independent
    // check — there is nothing to verify about an order that never settled.
    expect(canTransition("RFQ", "FAILED", "VERIFIED_FAILURE")).toBe(true);
    expect(canTransition("RFQ", "FAILED", "EXECUTED_PENDING_VERIFICATION")).toBe(false);
    expect(canTransition("RFQ", "CANCELLED", "VERIFIED_FAILURE")).toBe(true);
  });

  it("allows polling to stay in the same pending state", () => {
    expect(canTransition("RFQ", "PENDING_VENDOR", "PENDING_VENDOR")).toBe(true);
  });
});

describe("verificationFor", () => {
  it("never reports a broadcast as success", () => {
    const record = { ...createExecution({ ...BASE, mode: "SWAP" }), state: "BROADCAST_SWAP" as const };
    expect(verificationFor(record)).toBe("PENDING_VERIFICATION");
  });

  it("reports a vendor-pending RFQ order as pending verification", () => {
    const record = { ...createExecution({ ...BASE, mode: "RFQ" }), state: "PENDING_VENDOR" as const };
    expect(verificationFor(record)).toBe("PENDING_VERIFICATION");
  });

  it("reports verified success only from the verified state", () => {
    const record = {
      ...createExecution({ ...BASE, mode: "SWAP" }),
      state: "VERIFIED_SUCCESS" as const,
    };
    expect(verificationFor(record)).toBe("VERIFIED_SUCCESS");
  });

  it("reports chain-confirmed-but-unverified as pending, not success", () => {
    const record = {
      ...createExecution({ ...BASE, mode: "SWAP" }),
      state: "EXECUTED_PENDING_VERIFICATION" as const,
    };
    expect(verificationFor(record)).toBe("PENDING_VERIFICATION");
  });

  it("reports a sponsor-side FILLED RFQ order as pending, not success", () => {
    const record = { ...createExecution({ ...BASE, mode: "RFQ" }), state: "FILLED" as const };
    expect(verificationFor(record)).toBe("PENDING_VERIFICATION");
  });

  it("reports an inconclusive verification distinctly from a confirmed failure", () => {
    const inconclusive = {
      ...createExecution({ ...BASE, mode: "SWAP" }),
      state: "VERIFICATION_FAILED" as const,
    };
    const confirmed = {
      ...createExecution({ ...BASE, mode: "SWAP" }),
      state: "VERIFIED_FAILURE" as const,
    };
    expect(verificationFor(inconclusive)).toBe("VERIFICATION_FAILED");
    expect(verificationFor(confirmed)).toBe("VERIFIED_FAILURE");
  });
});
