import type { ReactNode } from "react";
import Link from "next/link";

import { fromBaseUnits, toDecimalString } from "@taloe/shared";
import { DEFAULT_POLICY, quoteFreshness, quoteRemainingMs, runRouteDiscovery } from "@taloe/router-core";

import { getDiscoveryPort } from "@/server/discovery";
import { getServerConfig } from "@/server/config";
import type { IntentQuery } from "@/lib/intent-query";
import { intentQueryString, parseIntentQuery } from "@/lib/intent-query";
import { defaultScenarioFor, FIXTURE_EXECUTION_SCENARIOS } from "@/lib/fixture-execution-timeline";
import type { FixtureExecutionScenario } from "@/lib/fixture-execution-timeline";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const config = getServerConfig();
  const parsed = parseIntentQuery(params, config.defaultMaxDeviationBps);

  if (!parsed.ok) {
    return <ReviewError message={parsed.message} />;
  }
  const intent = parsed.value;
  const routeId = firstParam(params.routeId);

  const outcome = await runRouteDiscovery(getDiscoveryPort(), {
    // Purely an internal correlation id for this one discovery call — never
    // displayed, never used as a lookup key, so it needs no real entropy.
    routeSessionId: "review-page",
    underlyingQuery: intent.q,
    spendAmountDecimal: intent.amount,
    walletAddress: intent.wallet,
    maxDeviationBps: intent.maxDeviationBps,
    binanceChainId: config.binanceChainId,
  });

  if (outcome.kind === "UNRESOLVABLE") {
    return <ReviewError message={outcome.reason.message} />;
  }

  const { decision } = outcome;
  if (decision.outcome !== "ACT" || !decision.selected) {
    return (
      <ReviewError message="This route is no longer available to review. Go back and re-run the route." />
    );
  }

  const candidates = [decision.selected, ...decision.alternatives];
  const evaluation = routeId ? (candidates.find((c) => c.route.routeId === routeId) ?? decision.selected) : decision.selected;
  const { route } = evaluation;

  const now = new Date();
  const remainingMs = quoteRemainingMs(route, now);
  const freshness = quoteFreshness(route, DEFAULT_POLICY, now);
  const quoteUsable = freshness !== "EXPIRED";

  const simulation =
    route.quote.executionMode === "SWAP" && intent.wallet
      ? await getDiscoveryPort().simulateRoute(route, {
          chainId: config.binanceChainId,
          walletAddress: intent.wallet,
          spendTokenAddress: decision.intent.spendTokenAddress,
          now,
        })
      : null;

  // READY_TO_SIGN: a SWAP route needs a simulation that explicitly passed.
  // No wallet, a failed call, NOT_RUN (unreadable / self-contradictory sponsor
  // response) and FAIL all block signing. RFQ has no client-side simulation.
  const simulationClear =
    route.quote.executionMode === "RFQ" || (simulation?.ok === true && simulation.value.status === "PASS");

  const outputAmount = toDecimalString(fromBaseUnits(route.quote.toTokenAmount, route.wrapper.decimals), 6);
  const inputAmount = toDecimalString(fromBaseUnits(route.quote.fromTokenAmount, decision.intent.spendTokenDecimals), 6);

  const defaultScenario = defaultScenarioFor(route.quote.executionMode);

  return (
    <section aria-labelledby="review-heading">
      <h1 id="review-heading" className="lede" style={{ marginBottom: "var(--space-2)" }}>
        Review your purchase
      </h1>
      <p style={{ marginBottom: "var(--space-5)" }}>
        You are exchanging USDT for a tokenized wrapper. This is{" "}
        <strong>underlying-equivalent exposure to {decision.underlying.companyName}</strong>, not a
        registered brokerage share, and it carries the issuer&apos;s own risks.
      </p>

      <div className="card">
        <ul className="status-list">
          <li>
            <span className="status-marker">spend</span>
            <span>{inputAmount} USDT</span>
          </li>
          <li>
            <span className="status-marker">receive</span>
            <span>
              ~{outputAmount} {route.wrapper.tokenSymbol}
            </span>
          </li>
          <li>
            <span className="status-marker">mode</span>
            <span>{route.quote.executionMode === "RFQ" ? "Request-for-quote" : "Automated market maker"}</span>
          </li>
          <li>
            <span className="status-marker">platform</span>
            <span>{route.wrapper.platformId ?? "not reliably known"}</span>
          </li>
          <li>
            <span className="status-marker">your limit</span>
            <span>
              {decision.intent.maxDeviationBps} bps
              {evaluation.referenceDeviationBps !== null
                ? ` — currently ${evaluation.referenceDeviationBps} bps`
                : " — not checkable right now"}
            </span>
          </li>
          <li>
            <span className="status-marker">price age</span>
            <span>
              {freshness === "FRESH"
                ? `Fresh (${Math.round(remainingMs / 1000)}s remaining)`
                : freshness === "EXPIRING"
                  ? `Expiring soon (${Math.max(0, Math.round(remainingMs / 1000))}s remaining)`
                  : "Expired"}
            </span>
          </li>
        </ul>

        <details className="disclosure">
          <summary>Advanced details</summary>
          <ul className="status-list" style={{ marginTop: "var(--space-4)" }}>
            <li>
              <span className="status-marker">contract</span>
              <span className="mono">{route.wrapper.tokenContractAddress}</span>
            </li>
            <li>
              <span className="status-marker">vendor</span>
              <span>{route.quote.vendorName}</span>
            </li>
            <li>
              <span className="status-marker">quote id</span>
              <span className="mono">{route.quote.quoteId}</span>
            </li>
            {route.quote.approveTarget ? (
              <li>
                <span className="status-marker">approval</span>
                <span>
                  Requires a one-time, amount-scoped approval to <span className="mono">{route.quote.approveTarget}</span>
                </span>
              </li>
            ) : null}
          </ul>
        </details>

        {route.quote.executionMode === "SWAP" ? (
          <div className="disclosure">
            <p className="field-label">Simulation</p>
            {simulation === null ? (
              <p className="field-hint">Connect a wallet to run a simulation before signing.</p>
            ) : simulation.ok ? (
              <p className={simulation.value.status === "PASS" ? undefined : "field-hint"}>
                {simulation.value.status === "PASS"
                  ? "Passed — this transaction was tested against the chain and succeeded."
                  : `Failed: ${simulation.value.failReason ?? "no reason reported"}`}
              </p>
            ) : (
              <p className="field-hint">Simulation could not be run: {simulation.error.message}</p>
            )}
          </div>
        ) : (
          <p className="field-hint" style={{ marginTop: "var(--space-4)" }}>
            RFQ orders settle through the market maker after you sign. There is no client-side
            transaction to simulate beforehand.
          </p>
        )}
      </div>

      {!quoteUsable ? (
        <div className="card" style={{ marginTop: "var(--space-5)" }} role="alert">
          <p className="field-label">This price has expired</p>
          <p className="field-hint">Market conditions changed. Refresh to get a current price before signing.</p>
          <Link className="button" style={{ marginTop: "var(--space-4)" }} href={`/review?${intentQueryString(intent, { routeId: route.routeId })}`}>
            Refresh price
          </Link>
        </div>
      ) : !simulationClear ? (
        <div className="card" style={{ marginTop: "var(--space-5)" }} role="alert">
          <p className="field-label">Not ready to sign</p>
          <p className="field-hint">
            Taloe will not ask you to sign a transaction unless its simulation passed.
            {simulation === null ? " Connect a wallet to run the simulation." : " The simulation did not pass."}
          </p>
        </div>
      ) : (
        <ConfirmAction
          intent={intent}
          routeId={route.routeId}
          mode={route.quote.executionMode}
          defaultScenario={defaultScenario}
          showScenarioPicker={config.dataMode === "fixture"}
        />
      )}

      <p className="notice" style={{ marginTop: "var(--space-6)" }}>
        <Link href={`/route?${intentQueryString(intent)}`}>Back to route</Link>
      </p>
    </section>
  );
}

function ConfirmAction({
  intent,
  routeId,
  mode,
  defaultScenario,
  showScenarioPicker,
}: {
  intent: IntentQuery;
  routeId: string;
  mode: "SWAP" | "RFQ";
  defaultScenario: FixtureExecutionScenario;
  showScenarioPicker: boolean;
}): ReactNode {
  const scenarios = FIXTURE_EXECUTION_SCENARIOS.filter((s) =>
    mode === "SWAP" ? s.startsWith("SWAP") : s.startsWith("RFQ"),
  );

  return (
    <form action="/execution" method="get" className="card" style={{ marginTop: "var(--space-5)" }}>
      {Object.entries({ ...Object.fromEntries(new URLSearchParams(intentQueryString(intent))), routeId }).map(
        ([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ),
      )}
      <input type="hidden" name="mode" value={mode} />
      {/* This value is meant to be wall-clock time at the moment of render:
          it becomes the execution's official start time on the next page,
          and the whole point of the fixture playback is that it advances
          against real elapsed time. This is an async Server Component
          rendered once per request, not a Client Component re-rendered
          reactively, so there is no hydration-mismatch risk here. */}
      {/* eslint-disable-next-line react-hooks/purity -- see comment above */}
      <input type="hidden" name="startedAt" value={String(Date.now())} />

      {showScenarioPicker ? (
        <label className="field">
          <span className="field-label">Demo outcome (fixture mode only)</span>
          <select className="input" name="scenario" defaultValue={defaultScenario}>
            {scenarios.map((scenario) => (
              <option key={scenario} value={scenario}>
                {scenario.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
          <span className="field-hint">
            Lets you exercise every terminal state without live credentials. Not shown in live mode.
          </span>
        </label>
      ) : (
        <input type="hidden" name="scenario" value={defaultScenario} />
      )}

      <button className="button" type="submit">
        Confirm and execute
      </button>
    </form>
  );
}

function ReviewError({ message }: { message: string }): ReactNode {
  return (
    <section className="card">
      <h1 className="lede" style={{ marginBottom: "var(--space-4)" }}>
        Can&apos;t review this route
      </h1>
      <p>{message}</p>
      <p style={{ marginTop: "var(--space-5)" }}>
        <Link href="/">Start again</Link>
      </p>
    </section>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
