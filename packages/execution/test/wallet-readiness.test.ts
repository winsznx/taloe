import { describe, expect, it } from "vitest";

import { deriveWalletReadinessState } from "../src/wallet-readiness";
import type { DeriveWalletReadinessInput, WalletFacts } from "../src/wallet-readiness";

const BASE_WALLET: WalletFacts = {
  connectedAddress: "0x1111111111111111111111111111111111111111",
  connectedChainId: "56",
  requiredChainId: "56",
  spendBalanceBaseUnits: "1000000000000000000000",
  gasBalanceWei: "1000000000000000000",
  requiredSpendBaseUnits: "500000000000000000000",
  spendBalanceReadable: true,
  gasBalanceReadable: true,
  minGasBalanceWei: 1n,
};

const derive = (overrides: Partial<DeriveWalletReadinessInput> = {}) =>
  deriveWalletReadinessState({ wallet: BASE_WALLET, readiness: null, lifecycle: null, ...overrides });

describe("deriveWalletReadinessState — priority ordering", () => {
  it("is WALLET_DISCONNECTED when there is no address, even if every other fact would otherwise pass", () => {
    expect(derive({ wallet: { ...BASE_WALLET, connectedAddress: null } })).toBe("WALLET_DISCONNECTED");
  });

  it("is WRONG_CHAIN before any balance/gas/allowance fact is considered", () => {
    const wrongChain: WalletFacts = { ...BASE_WALLET, connectedChainId: "1", spendBalanceReadable: false, gasBalanceReadable: false };
    expect(derive({ wallet: wrongChain })).toBe("WRONG_CHAIN");
  });

  it("treats an unreadable chain id the same as a mismatch, never assuming BSC", () => {
    expect(derive({ wallet: { ...BASE_WALLET, connectedChainId: null } })).toBe("WRONG_CHAIN");
  });
});

describe("deriveWalletReadinessState — balance and gas", () => {
  it("is BALANCE_INSUFFICIENT when the spend balance is readable and short", () => {
    expect(derive({ wallet: { ...BASE_WALLET, spendBalanceBaseUnits: "1" } })).toBe("BALANCE_INSUFFICIENT");
  });

  it("does NOT flag insufficient balance when the balance could not be read — unreadable is not zero", () => {
    const unreadable: WalletFacts = { ...BASE_WALLET, spendBalanceBaseUnits: null, spendBalanceReadable: false };
    expect(derive({ wallet: unreadable })).not.toBe("BALANCE_INSUFFICIENT");
  });

  it("is GAS_INSUFFICIENT when gas is readable and below the minimum", () => {
    expect(derive({ wallet: { ...BASE_WALLET, gasBalanceWei: "0", minGasBalanceWei: 1n } })).toBe("GAS_INSUFFICIENT");
  });

  it("checks balance before gas", () => {
    const bothShort: WalletFacts = { ...BASE_WALLET, spendBalanceBaseUnits: "1", gasBalanceWei: "0" };
    expect(derive({ wallet: bothShort })).toBe("BALANCE_INSUFFICIENT");
  });
});

describe("deriveWalletReadinessState — pre-signature readiness (from prepareExecution/resumeAfterApproval)", () => {
  it("is READY_FOR_SIMULATION when wallet facts are sufficient but readiness has not been checked yet", () => {
    expect(derive({ readiness: null })).toBe("READY_FOR_SIMULATION");
  });

  it("is APPROVAL_REQUIRED when the readiness outcome says so", () => {
    expect(
      derive({
        readiness: {
          kind: "APPROVAL_REQUIRED",
          route: {} as never,
          spender: "0x3333333333333333333333333333333333333333",
          requiredBaseUnits: "1",
          currentAllowanceBaseUnits: "0",
          approvalTransaction: {} as never,
          approvalSimulation: {} as never,
          attempts: [],
        },
      }),
    ).toBe("APPROVAL_REQUIRED");
  });

  it("is READY_TO_SIGN when readiness produced a simulated, fresh swap", () => {
    expect(derive({ readiness: { kind: "READY_TO_SIGN", route: {} as never, simulation: {} as never, swapTransaction: {} as never, attempts: [] } })).toBe(
      "READY_TO_SIGN",
    );
  });

  it("is REQUOTE_REQUIRED, not a generic failure, when the refusal reason is specifically about the quote going stale", () => {
    expect(derive({ readiness: { kind: "REFUSED", reason: "REQUOTE_FAILED_GATES", attempts: [] } })).toBe("REQUOTE_REQUIRED");
    expect(derive({ readiness: { kind: "REFUSED", reason: "REQUOTE_UNAVAILABLE", attempts: [] } })).toBe("REQUOTE_REQUIRED");
  });

  it("is SIMULATION_FAILED for every other refusal reason", () => {
    expect(derive({ readiness: { kind: "REFUSED", reason: "SWAP_SIMULATION_FAILED", attempts: [] } })).toBe("SIMULATION_FAILED");
    expect(derive({ readiness: { kind: "REFUSED", reason: "NO_VIABLE_CANDIDATE", attempts: [] } })).toBe("SIMULATION_FAILED");
  });
});

describe("deriveWalletReadinessState — signed lifecycle takes priority over the pre-signature snapshot", () => {
  it("reflects APPROVAL_READY/PENDING/CONFIRMED even though `readiness` still says APPROVAL_REQUIRED", () => {
    const stillApprovalRequired = {
      kind: "APPROVAL_REQUIRED" as const,
      route: {} as never,
      spender: "0x3333333333333333333333333333333333333333",
      requiredBaseUnits: "1",
      currentAllowanceBaseUnits: "0",
      approvalTransaction: {} as never,
      approvalSimulation: {} as never,
      attempts: [],
    };
    expect(derive({ readiness: stillApprovalRequired, lifecycle: { kind: "APPROVAL_AWAITING_SIGNATURE" } })).toBe("APPROVAL_READY");
    expect(derive({ readiness: stillApprovalRequired, lifecycle: { kind: "APPROVAL_BROADCAST_PENDING" } })).toBe("APPROVAL_PENDING");
    expect(derive({ readiness: stillApprovalRequired, lifecycle: { kind: "APPROVAL_MINED_CONFIRMED" } })).toBe("APPROVAL_CONFIRMED");
  });

  it("walks through the swap side: broadcast -> pending verification -> a terminal outcome", () => {
    expect(derive({ lifecycle: { kind: "SWAP_BROADCAST_PENDING" } })).toBe("PENDING_EXECUTION");
    expect(derive({ lifecycle: { kind: "SWAP_CHAIN_PENDING_VERIFICATION" } })).toBe("PENDING_VERIFICATION");
    expect(derive({ lifecycle: { kind: "SWAP_VERIFIED_SUCCESS" } })).toBe("VERIFIED_SUCCESS");
    expect(derive({ lifecycle: { kind: "SWAP_VERIFICATION_FAILED" } })).toBe("VERIFICATION_FAILED");
  });

  it("still requires a connected wallet on the right chain even mid-lifecycle", () => {
    expect(derive({ wallet: { ...BASE_WALLET, connectedAddress: null }, lifecycle: { kind: "PENDING_EXECUTION" as never } })).toBe(
      "WALLET_DISCONNECTED",
    );
  });
});
