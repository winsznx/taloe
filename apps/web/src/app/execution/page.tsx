import type { ReactNode } from "react";
import Link from "next/link";

import { STATE_COPY } from "@taloe/execution";
import type { ExecutionState } from "@taloe/execution";

import { AutoRefresh } from "@/components/AutoRefresh";
import {
  deriveExecutionState,
  FIXTURE_EXECUTION_SCENARIOS,
} from "@/lib/fixture-execution-timeline";
import type { FixtureExecutionScenario } from "@/lib/fixture-execution-timeline";
import { intentQueryString, parseIntentQuery } from "@/lib/intent-query";
import { getServerConfig } from "@/server/config";

/**
 * SWAP steps shown to the user, distinguishing the four kinds of waiting
 * (API, signature, vendor, chain) per PRD 8.10, plus Taloe's own
 * verification phase which is never conflated with sponsor/chain settlement
 * (correction 4).
 */
const SWAP_STEP_ORDER: readonly ExecutionState[] = [
  "ROUTE_SELECTED",
  "ALLOWANCE_CHECK",
  "REQUOTE_AND_REVALIDATE",
  "BUILD_SWAP",
  "SIMULATE_SWAP",
  "SIMULATION_PASSED",
  "USER_SIGN_SWAP",
  "BROADCAST_SWAP",
  "CHAIN_PENDING",
  "EXECUTED_PENDING_VERIFICATION",
  "VERIFYING",
];

const RFQ_STEP_ORDER: readonly ExecutionState[] = [
  "RFQ_ROUTE_SELECTED",
  "VENDOR_IDENTIFIED",
  "VENDOR_ALLOWANCE_CHECK",
  "REQUOTE_IF_NEEDED",
  "BUILD_RFQ_PAYLOAD",
  "VALIDATE_TYPED_DATA",
  "USER_SIGN_EIP712",
  "SUBMIT_RFQ_ORDER",
  "PENDING_VENDOR",
  "FILLED",
  "EXECUTED_PENDING_VERIFICATION",
  "VERIFYING",
];

const TERMINAL_LABEL: Readonly<Record<string, string>> = {
  VERIFIED_SUCCESS: "Verified success",
  VERIFIED_FAILURE: "Did not go through",
  VERIFICATION_FAILED: "Could not confirm",
};

export default async function ExecutionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const config = getServerConfig();
  const parsed = parseIntentQuery(params, config.defaultMaxDeviationBps);
  if (!parsed.ok) return <ExecutionError message={parsed.message} />;

  const scenario = first(params.scenario) as FixtureExecutionScenario | undefined;
  const startedAt = Number(first(params.startedAt));
  const routeId = first(params.routeId);

  if (!scenario || !FIXTURE_EXECUTION_SCENARIOS.includes(scenario) || !Number.isFinite(startedAt) || !routeId) {
    return <ExecutionError message="This execution link is incomplete. Start from Review again." />;
  }

  // Deliberately real elapsed time — see the identical note in receipt/page.tsx.
  // eslint-disable-next-line react-hooks/purity -- async Server Component, no hydration risk
  const elapsedMs = Date.now() - startedAt;
  const { state, isTerminal, nextStepInMs } = deriveExecutionState(scenario, elapsedMs);
  const steps = scenario.startsWith("SWAP") ? SWAP_STEP_ORDER : RFQ_STEP_ORDER;
  const currentIndex = steps.indexOf(state);

  const receiptQuery = intentQueryString(parsed.value, {
    routeId,
    mode: scenario.startsWith("SWAP") ? "SWAP" : "RFQ",
    scenario,
    startedAt: String(startedAt),
  });

  return (
    <section aria-labelledby="execution-heading">
      <h1 id="execution-heading" className="lede" style={{ marginBottom: "var(--space-5)" }}>
        {isTerminal ? (TERMINAL_LABEL[state] ?? STATE_COPY[state]) : "Executing"}
      </h1>

      {/* Semantic status region: announces state changes to assistive tech
          without reading every intermediate tick (PRD 8.10). */}
      <div className="card" role="status" aria-live="polite" aria-atomic="true">
        <p className="field-label">{STATE_COPY[state]}</p>

        {currentIndex >= 0 ? (
          <ul className="status-list" style={{ marginTop: "var(--space-4)" }}>
            {steps.map((step, index) => (
              <li key={step}>
                <span className="status-marker">
                  {index < currentIndex ? "[ok]" : index === currentIndex ? "[..]" : "[  ]"}
                </span>
                <span>{STATE_COPY[step]}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {isTerminal ? (
          <Link className="button" style={{ marginTop: "var(--space-5)" }} href={`/receipt?${receiptQuery}`}>
            View receipt
          </Link>
        ) : null}
      </div>

      {!isTerminal ? (
        <AutoRefresh intervalMs={Math.max(400, Math.min(nextStepInMs ?? 1000, 1500))} stop={isTerminal} />
      ) : null}

      <p className="notice" style={{ marginTop: "var(--space-6)" }}>
        This page reflects the same progress if you refresh or come back later — execution state is
        derived from when you confirmed, not stored only in this browser tab.
      </p>
    </section>
  );
}

function ExecutionError({ message }: { message: string }): ReactNode {
  return (
    <section className="card">
      <h1 className="lede" style={{ marginBottom: "var(--space-4)" }}>
        Can&apos;t show this execution
      </h1>
      <p>{message}</p>
      <p style={{ marginTop: "var(--space-5)" }}>
        <Link href="/">Start again</Link>
      </p>
    </section>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
