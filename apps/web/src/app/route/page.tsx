import type { ReactNode } from "react";
import Link from "next/link";

import type { RouteEvaluation } from "@taloe/shared";
import { explainReason, fromBaseUnits, toDecimalString } from "@taloe/shared";
import { DEFAULT_POLICY, quoteFreshness } from "@taloe/router-core";
import { runRouteDiscovery } from "@taloe/router-core";
import { sessionLabel } from "@taloe/session-mark";

import { getDiscoveryPort } from "@/server/discovery";
import { getServerConfig } from "@/server/config";
import { OUTCOME_HEADING, OUTCOME_SUMMARY } from "@/lib/decision-copy";
import type { IntentQuery } from "@/lib/intent-query";
import { intentQueryString, parseIntentQuery } from "@/lib/intent-query";

export default async function RoutePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const config = getServerConfig();
  const parsed = parseIntentQuery(params, config.defaultMaxDeviationBps);

  if (!parsed.ok) {
    return <InputError message={parsed.message} />;
  }

  const intent = parsed.value;
  const outcome = await runRouteDiscovery(getDiscoveryPort(), {
    // Purely an internal correlation id for this one discovery call — never
    // displayed, never used as a lookup key, so it needs no real entropy.
    routeSessionId: "route-page",
    underlyingQuery: intent.q,
    spendAmountDecimal: intent.amount,
    walletAddress: intent.wallet,
    maxDeviationBps: intent.maxDeviationBps,
    binanceChainId: config.binanceChainId,
    alreadyHoldsTargetExposure: intent.holdAlready,
  });

  if (outcome.kind === "UNRESOLVABLE") {
    return outcome.reason.kind === "SPONSOR_UNAVAILABLE" ? (
      <SponsorUnavailable message={outcome.reason.message} />
    ) : (
      <InputError message={outcome.reason.message} />
    );
  }

  const { decision } = outcome;

  return (
    <section aria-labelledby="route-heading">
      <p className="field-hint" style={{ marginBottom: "var(--space-2)" }}>
        {decision.underlying.companyName} ({decision.underlying.ticker})
      </p>
      <h1 id="route-heading" className="lede" style={{ marginBottom: "var(--space-2)" }}>
        {OUTCOME_HEADING[decision.outcome]}
      </h1>
      <p style={{ marginBottom: "var(--space-5)" }}>{OUTCOME_SUMMARY[decision.outcome]}</p>

      {decision.marketContext ? (
        <p className="field-hint" style={{ marginBottom: "var(--space-5)" }}>
          {sessionLabel(decision.marketContext)}
        </p>
      ) : null}

      {decision.outcome === "MANUAL_REVIEW" ? (
        <Disambiguation intent={intent} candidateUnderlyings={decision.candidateUnderlyings} />
      ) : null}

      {decision.outcome === "ACT" && decision.selected ? (
        <ActResult
          intent={intent}
          selected={decision.selected}
          selectionReasons={decision.selectionReasons}
          alternatives={decision.alternatives}
          rejected={decision.rejected}
          companyName={decision.underlying.companyName}
        />
      ) : null}

      {decision.outcome === "REFUSE" || decision.outcome === "UNKNOWN" ? (
        <RejectionList
          rejected={decision.rejected}
          decisionReasons={decision.decisionReasons}
          companyName={decision.underlying.companyName}
        />
      ) : null}

      {decision.outcome === "NO_ACTION" ? (
        <p>
          <Link href="/">Start a new request</Link>
        </p>
      ) : null}

      <p className="notice" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/">Change your request</Link>
      </p>
    </section>
  );
}

function InputError({ message }: { message: string }): ReactNode {
  return (
    <section className="card">
      <h1 className="lede" style={{ marginBottom: "var(--space-4)" }}>
        Taloe could not read that request
      </h1>
      <p>{message}</p>
      <p style={{ marginTop: "var(--space-5)" }}>
        <Link href="/">Start again</Link>
      </p>
    </section>
  );
}

function SponsorUnavailable({ message }: { message: string }): ReactNode {
  return (
    <section className="card" role="alert">
      <h1 className="lede" style={{ marginBottom: "var(--space-4)" }}>
        Market data is temporarily unavailable
      </h1>
      <p>Taloe could not reach the data it needs to route this request. Nothing was assumed in its place.</p>
      <p className="field-hint" style={{ marginTop: "var(--space-3)" }}>
        {message}
      </p>
      <p style={{ marginTop: "var(--space-5)" }}>
        <Link href="/">Try again</Link>
      </p>
    </section>
  );
}

function Disambiguation({
  intent,
  candidateUnderlyings,
}: {
  intent: IntentQuery;
  candidateUnderlyings: readonly { ticker: string; companyName: string }[];
}): ReactNode {
  return (
    <div className="card">
      <ul className="status-list">
        {candidateUnderlyings.map((company) => (
          <li key={company.ticker}>
            <Link href={`/route?${intentQueryString(intent, { q: company.ticker })}`}>
              {company.companyName} ({company.ticker})
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RejectionList({
  rejected,
  decisionReasons,
  companyName,
}: {
  rejected: readonly { wrapperSymbol: string; platformId: string | null; reasons: readonly string[]; stage: string }[];
  decisionReasons: readonly string[];
  companyName: string;
}): ReactNode {
  return (
    <div className="card">
      {decisionReasons.length > 0 ? (
        <ul className="status-list" style={{ marginBottom: rejected.length > 0 ? "var(--space-5)" : 0 }}>
          {decisionReasons.map((reason) => (
            <li key={reason}>
              <span className="status-marker">[--]</span>
              {/* Reason codes are typed in @taloe/shared; narrowed loosely here
                  since this component also renders live decisionReasons that
                  TypeScript cannot narrow without importing the full union. */}
              <span>{explainReason(reason as Parameters<typeof explainReason>[0], companyName)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {rejected.length > 0 ? (
        <ul className="status-list">
          {rejected.map((candidate) => (
            <li key={`${candidate.platformId ?? "unknown"}-${candidate.wrapperSymbol}`}>
              <span className="status-marker">[--]</span>
              <span>
                <strong>{candidate.wrapperSymbol}</strong>
                {candidate.platformId ? ` (${candidate.platformId})` : ""} —{" "}
                {candidate.reasons
                  .map((reason) => explainReason(reason as Parameters<typeof explainReason>[0], companyName))
                  .join(" ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActResult({
  intent,
  selected,
  selectionReasons,
  alternatives,
  rejected,
  companyName,
}: {
  intent: IntentQuery;
  selected: RouteEvaluation;
  selectionReasons: readonly string[];
  alternatives: readonly RouteEvaluation[];
  rejected: readonly { wrapperSymbol: string; platformId: string | null; reasons: readonly string[]; stage: string }[];
  companyName: string;
}): ReactNode {
  const freshness = quoteFreshness(selected.route, DEFAULT_POLICY, new Date());
  return (
    <>
      <div className="card">
        <RouteSummary evaluation={selected} freshness={freshness} />

        {selectionReasons.length > 0 ? (
          <ul className="status-list" style={{ marginTop: "var(--space-4)" }}>
            {selectionReasons.map((reason) => (
              <li key={reason}>
                <span className="status-marker">[ok]</span>
                <span>{explainReason(reason as Parameters<typeof explainReason>[0], companyName)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <Link
          className="button"
          style={{ marginTop: "var(--space-5)" }}
          href={`/review?${intentQueryString(intent, { routeId: selected.route.routeId })}`}
        >
          Review purchase
        </Link>
      </div>

      {alternatives.length > 0 ? (
        <details className="disclosure" style={{ marginTop: "var(--space-5)" }}>
          <summary>Other routes considered ({alternatives.length})</summary>
          <ul className="status-list" style={{ marginTop: "var(--space-4)" }}>
            {alternatives.map((alt) => (
              <li key={alt.route.routeId}>
                <span className="status-marker">[--]</span>
                <span>
                  {alt.route.wrapper.tokenSymbol} via {alt.route.quote.vendorName} (
                  {alt.route.quote.executionMode})
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {rejected.length > 0 ? (
        <details className="disclosure">
          <summary>Routes excluded ({rejected.length})</summary>
          <div style={{ marginTop: "var(--space-4)" }}>
            <RejectionList rejected={rejected} decisionReasons={[]} companyName={companyName} />
          </div>
        </details>
      ) : null}
    </>
  );
}

export function RouteSummary({
  evaluation,
  freshness,
}: {
  evaluation: RouteEvaluation;
  freshness: "FRESH" | "EXPIRING" | "EXPIRED";
}): ReactNode {
  const { route } = evaluation;
  const outputAmount = toDecimalString(fromBaseUnits(route.quote.toTokenAmount, route.wrapper.decimals), 6);

  return (
    <>
      <p className="field-label">
        {route.wrapper.tokenSymbol}
        {route.wrapper.platformId ? ` · ${route.wrapper.platformId}` : ""}
      </p>
      <p style={{ fontSize: "1.5rem", fontWeight: 600, margin: "var(--space-1) 0 var(--space-4)" }}>
        ~{outputAmount} {route.wrapper.tokenSymbol}
      </p>
      <ul className="status-list">
        <li>
          <span className="status-marker">mode</span>
          <span>{route.quote.executionMode === "RFQ" ? "Request-for-quote" : "Automated market maker"}</span>
        </li>
        {route.quote.priceImpactPercent ? (
          <li>
            <span className="status-marker">impact</span>
            <span>{route.quote.priceImpactPercent}%</span>
          </li>
        ) : null}
        {evaluation.referenceDeviationBps !== null ? (
          <li>
            <span className="status-marker">deviation</span>
            <span>{evaluation.referenceDeviationBps} bps from reference</span>
          </li>
        ) : (
          <li>
            <span className="status-marker">deviation</span>
            <span>Not checkable — no trustworthy reference available</span>
          </li>
        )}
        <li>
          <span className="status-marker">price</span>
          <span>
            {freshness === "FRESH"
              ? "Fresh"
              : freshness === "EXPIRING"
                ? "Expiring soon — will refresh before you sign"
                : "Expired — will be refreshed"}
          </span>
        </li>
        {!evaluation.comparable ? (
          <li>
            <span className="status-marker">note</span>
            <span>
              Taloe cannot yet confirm how much of {route.wrapper.underlyingTicker} this token represents,
              so it is not compared numerically against other wrappers.
            </span>
          </li>
        ) : null}
      </ul>
    </>
  );
}
