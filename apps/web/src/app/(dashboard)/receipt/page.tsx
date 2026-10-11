import type { ReactNode } from "react";
import Link from "next/link";

import { fromBaseUnits, toDecimalString } from "@taloe/shared";
import { runRouteDiscovery } from "@taloe/router-core";

import {
  deriveExecutionState,
  FIXTURE_EXECUTION_SCENARIOS,
} from "@/lib/fixture-execution-timeline";
import type { FixtureExecutionScenario } from "@/lib/fixture-execution-timeline";
import { intentQueryString, parseIntentQuery } from "@/lib/intent-query";
import { getDiscoveryPort } from "@/server/discovery";
import { getServerConfig } from "@/server/config";
import { TokenIcon } from "@/components/TokenIcon";

const VERIFICATION_LABEL: Readonly<Record<string, string>> = {
  VERIFIED_SUCCESS: "Verified success",
  VERIFIED_FAILURE: "This did not go through",
  VERIFICATION_FAILED: "We could not confirm the result",
};

export default async function ReceiptPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const config = getServerConfig();
  const parsed = parseIntentQuery(params, config.defaultMaxDeviationBps);
  if (!parsed.ok) return <ReceiptError message={parsed.message} />;

  const scenario = first(params.scenario) as FixtureExecutionScenario | undefined;
  const startedAt = Number(first(params.startedAt));
  const routeId = first(params.routeId);
  if (!scenario || !FIXTURE_EXECUTION_SCENARIOS.includes(scenario) || !Number.isFinite(startedAt) || !routeId) {
    return <ReceiptError message="This receipt link is incomplete." />;
  }

  // Deliberately real elapsed time: this page's whole content is "what should
  // the scripted playback show right now," computed fresh on every request to
  // an async Server Component (not a reactively re-rendered Client
  // Component), so there is no hydration-mismatch risk from this being
  // non-deterministic across renders.
  // eslint-disable-next-line react-hooks/purity -- see comment above
  const { state, isTerminal } = deriveExecutionState(scenario, Date.now() - startedAt);
  if (!isTerminal) {
    return (
      <section className="card">
        <p className="field-label">Still in progress</p>
        <p className="field-hint">This execution has not reached a final state yet.</p>
        <Link
          className="button"
          style={{ marginTop: "var(--space-4)" }}
          href={`/execution?${intentQueryString(parsed.value, {
            routeId,
            mode: scenario.startsWith("SWAP") ? "SWAP" : "RFQ",
            scenario,
            startedAt: String(startedAt),
          })}`}
        >
          View progress
        </Link>
      </section>
    );
  }

  const outcome = await runRouteDiscovery(getDiscoveryPort(), {
    routeSessionId: `demo-${startedAt}`,
    underlyingQuery: parsed.value.q,
    spendAmountDecimal: parsed.value.amount,
    walletAddress: parsed.value.wallet,
    maxDeviationBps: parsed.value.maxDeviationBps,
    binanceChainId: config.binanceChainId,
  });
  const route =
    outcome.kind === "DECIDED"
      ? [outcome.decision.selected, ...outcome.decision.alternatives].find(
          (candidate) => candidate?.route.routeId === routeId,
        )?.route
      : undefined;
  const spendTokenDecimals = outcome.kind === "DECIDED" ? outcome.decision.intent.spendTokenDecimals : 18;

  const verified = state === "VERIFIED_SUCCESS";

  return (
    <section aria-labelledby="receipt-heading">
      <h1 id="receipt-heading" className="lede" style={{ marginBottom: "var(--space-5)" }}>
        {VERIFICATION_LABEL[state] ?? state}
      </h1>

      <div className="card">
        {route ? (
          <ul className="status-list">
            <li>
              <span className="status-marker">spent</span>
              <span>
                {toDecimalString(fromBaseUnits(route.quote.fromTokenAmount, spendTokenDecimals), 6)} USDT
              </span>
            </li>
            <li>
              <span className="status-marker">
                {verified ? "received" : "would have received"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
                <TokenIcon underlyingTicker={route.wrapper.underlyingTicker} symbol={route.wrapper.tokenSymbol} size={20} />
                ~{toDecimalString(fromBaseUnits(route.quote.toTokenAmount, route.wrapper.decimals), 6)}{" "}
                {route.wrapper.tokenSymbol}
              </span>
            </li>
            <li>
              <span className="status-marker">route</span>
              <span>
                {route.wrapper.tokenSymbol} via {route.quote.vendorName} ({route.quote.executionMode})
              </span>
            </li>
          </ul>
        ) : (
          <p className="field-hint">
            The original route details are no longer reconstructable from this link, but the
            verification result below is still accurate for what was confirmed.
          </p>
        )}

        <p className="field-hint" style={{ marginTop: "var(--space-4)" }}>
          {verified
            ? "This result was independently checked after settlement, not assumed from a broadcast or vendor acknowledgement alone."
            : state === "VERIFICATION_FAILED"
              ? "Taloe could not confirm the outcome within its verification window. This is not the same as a confirmed failure. Check the transaction directly if one exists."
              : "The network or the market maker reported this did not settle. No funds should have moved beyond what was already spent on gas, if any."}
        </p>
      </div>

      <p className="notice" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/app">Start a new request</Link> · <Link href="/activity">View activity</Link>
      </p>
    </section>
  );
}

function ReceiptError({ message }: { message: string }): ReactNode {
  return (
    <section className="card">
      <h1 className="lede" style={{ marginBottom: "var(--space-4)" }}>
        Can&apos;t show this receipt
      </h1>
      <p>{message}</p>
      <p style={{ marginTop: "var(--space-5)" }}>
        <Link href="/app">Start again</Link>
      </p>
    </section>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
