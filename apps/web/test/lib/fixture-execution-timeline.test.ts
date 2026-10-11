import { describe, expect, it } from "vitest";

import {
  assertTimelineIsLegal,
  deriveExecutionState,
  FIXTURE_EXECUTION_SCENARIOS,
} from "../../src/lib/fixture-execution-timeline";

describe("fixture-execution-timeline", () => {
  it("every scripted scenario is a legal path through the real @taloe/execution transition table", () => {
    // Importing the module already runs this self-check at load time (NODE_ENV !== production);
    // calling it again here is what actually fails a test run instead of only a live request.
    for (const scenario of FIXTURE_EXECUTION_SCENARIOS) {
      expect(() => assertTimelineIsLegal(scenario)).not.toThrow();
    }
  });

  it("reaches a terminal state for every scenario", () => {
    for (const scenario of FIXTURE_EXECUTION_SCENARIOS) {
      const { isTerminal } = deriveExecutionState(scenario, 60_000);
      expect(isTerminal).toBe(true);
    }
  });

  it("SWAP_SUCCESS passes through BALANCE_CHECK before ALLOWANCE_CHECK", () => {
    const early = deriveExecutionState("SWAP_SUCCESS", 400);
    expect(early.state).toBe("BALANCE_CHECK");
    const later = deriveExecutionState("SWAP_SUCCESS", 700);
    expect(later.state).toBe("ALLOWANCE_CHECK");
  });
});
