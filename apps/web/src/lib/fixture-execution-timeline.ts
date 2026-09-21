/**
 * Fixture-mode execution playback.
 *
 * SYNTHETIC. There is no real signing, no real broadcast, and no real
 * verification here — this drives the SAME `ExecutionState` transition
 * tables from `@taloe/execution` through a scripted, deterministic timeline
 * so the execution/receipt pages can be built and demoed without a wallet
 * SDK or live credentials.
 *
 * It is deliberately a pure function of elapsed time rather than server-side
 * mutable state: `/execution` computes "what state should be showing right
 * now" from `Date.now() - startedAtMs`, so the page works statelessly across
 * server restarts and multiple instances, and a browser refresh always shows
 * the correct point in the script rather than resetting it.
 */

import type { ExecutionMode } from "@taloe/shared";
import type { ExecutionState } from "@taloe/execution";
import { canTransition, initialState, isTerminal } from "@taloe/execution";

export type FixtureExecutionScenario =
  | "SWAP_SUCCESS"
  | "SWAP_CHAIN_FAILURE"
  | "SWAP_VERIFICATION_INCONCLUSIVE"
  | "RFQ_SUCCESS"
  | "RFQ_FAILED";

interface TimelineStep {
  readonly atMs: number;
  readonly state: ExecutionState;
}

const SWAP_SUCCESS: readonly TimelineStep[] = [
  { atMs: 0, state: "ROUTE_SELECTED" },
  { atMs: 600, state: "ALLOWANCE_CHECK" },
  { atMs: 1200, state: "REQUOTE_AND_REVALIDATE" },
  { atMs: 1800, state: "BUILD_SWAP" },
  { atMs: 2400, state: "SIMULATE_SWAP" },
  { atMs: 3000, state: "SIMULATION_PASSED" },
  { atMs: 3600, state: "USER_SIGN_SWAP" },
  { atMs: 4400, state: "BROADCAST_SWAP" },
  { atMs: 5200, state: "CHAIN_PENDING" },
  { atMs: 6400, state: "EXECUTED_PENDING_VERIFICATION" },
  { atMs: 7000, state: "VERIFYING" },
  { atMs: 8200, state: "VERIFIED_SUCCESS" },
];

const SWAP_CHAIN_FAILURE: readonly TimelineStep[] = [
  ...SWAP_SUCCESS.slice(0, SWAP_SUCCESS.findIndex((s) => s.state === "CHAIN_PENDING") + 1),
  { atMs: 6200, state: "VERIFIED_FAILURE" },
];

const SWAP_VERIFICATION_INCONCLUSIVE: readonly TimelineStep[] = [
  ...SWAP_SUCCESS.slice(0, SWAP_SUCCESS.findIndex((s) => s.state === "VERIFYING") + 1),
  { atMs: 9000, state: "VERIFICATION_FAILED" },
];

const RFQ_SUCCESS: readonly TimelineStep[] = [
  { atMs: 0, state: "RFQ_ROUTE_SELECTED" },
  { atMs: 600, state: "VENDOR_IDENTIFIED" },
  { atMs: 1200, state: "VENDOR_ALLOWANCE_CHECK" },
  { atMs: 1800, state: "REQUOTE_IF_NEEDED" },
  { atMs: 2400, state: "BUILD_RFQ_PAYLOAD" },
  { atMs: 3000, state: "VALIDATE_TYPED_DATA" },
  { atMs: 3600, state: "USER_SIGN_EIP712" },
  { atMs: 4400, state: "SUBMIT_RFQ_ORDER" },
  { atMs: 5200, state: "PENDING_VENDOR" },
  { atMs: 7000, state: "FILLED" },
  { atMs: 7600, state: "EXECUTED_PENDING_VERIFICATION" },
  { atMs: 8200, state: "VERIFYING" },
  { atMs: 9400, state: "VERIFIED_SUCCESS" },
];

const RFQ_FAILED: readonly TimelineStep[] = [
  ...RFQ_SUCCESS.slice(0, RFQ_SUCCESS.findIndex((s) => s.state === "PENDING_VENDOR") + 1),
  { atMs: 6800, state: "FAILED" },
  { atMs: 7200, state: "VERIFIED_FAILURE" },
];

const TIMELINES: Readonly<Record<FixtureExecutionScenario, readonly TimelineStep[]>> = {
  SWAP_SUCCESS,
  SWAP_CHAIN_FAILURE,
  SWAP_VERIFICATION_INCONCLUSIVE,
  RFQ_SUCCESS,
  RFQ_FAILED,
};

export function scenarioMode(scenario: FixtureExecutionScenario): ExecutionMode {
  return scenario.startsWith("SWAP") ? "SWAP" : "RFQ";
}

export function defaultScenarioFor(mode: ExecutionMode): FixtureExecutionScenario {
  return mode === "SWAP" ? "SWAP_SUCCESS" : "RFQ_SUCCESS";
}

/** Every value this parameter may legitimately take, for building a picker. */
export const FIXTURE_EXECUTION_SCENARIOS = Object.keys(TIMELINES) as FixtureExecutionScenario[];

/**
 * The state the given scenario should be showing at `elapsedMs`, and whether
 * playback has reached a terminal state (so the caller can stop polling).
 */
export function deriveExecutionState(
  scenario: FixtureExecutionScenario,
  elapsedMs: number,
): { state: ExecutionState; isTerminal: boolean; nextStepInMs: number | null } {
  const timeline = TIMELINES[scenario];
  const mode = scenarioMode(scenario);

  let current: TimelineStep = timeline[0] ?? { atMs: 0, state: initialState(mode) };
  let next: TimelineStep | undefined;
  for (const step of timeline) {
    if (step.atMs <= elapsedMs) {
      current = step;
    } else {
      next = step;
      break;
    }
  }

  return {
    state: current.state,
    isTerminal: isTerminal(mode, current.state),
    nextStepInMs: next ? next.atMs - elapsedMs : null,
  };
}

/**
 * Assert the scripted timeline is itself legal against the real transition
 * table — a guard against the fixture drifting out of sync with the state
 * machine it is meant to demonstrate. Run at module load in development.
 */
export function assertTimelineIsLegal(scenario: FixtureExecutionScenario): void {
  const timeline = TIMELINES[scenario];
  const mode = scenarioMode(scenario);
  const start = timeline[0];
  if (!start || start.state !== initialState(mode)) {
    throw new Error(`fixture-execution-timeline: scenario ${scenario} must start at ${initialState(mode)}`);
  }
  let previous = start.state;
  for (const step of timeline.slice(1)) {
    if (!canTransition(mode, previous, step.state)) {
      throw new Error(
        `fixture-execution-timeline: illegal transition ${previous} -> ${step.state} in scenario ${scenario}`,
      );
    }
    previous = step.state;
  }
}

if (process.env.NODE_ENV !== "production") {
  for (const scenario of FIXTURE_EXECUTION_SCENARIOS) {
    assertTimelineIsLegal(scenario);
  }
}
