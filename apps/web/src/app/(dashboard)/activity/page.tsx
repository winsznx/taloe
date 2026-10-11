import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Minimal activity history (PRD 8.3): timestamp, ticker, wrapper, spend
 * amount, status, receipt link. Not a PnL dashboard.
 *
 * Honest empty state: persistent, per-wallet execution history needs the
 * backend store described in PRD 21, which does not exist yet (see
 * internal/product/BUILD_STATUS.md). This page states that plainly rather
 * than fabricating history or silently going blank.
 */
export const metadata = { title: "Activity" };

export default function ActivityPage(): ReactNode {
  return (
    <section aria-labelledby="activity-heading">
      <h1 id="activity-heading" className="lede" style={{ marginBottom: "var(--space-5)" }}>
        Activity
      </h1>

      <div className="card">
        <p>Persistent activity history is not wired up yet.</p>
        <p className="field-hint" style={{ marginTop: "var(--space-3)" }}>
          Each execution already produces a receipt with its own link (timestamp, ticker,
          wrapper, spend amount, and verified status) — that link is currently the only durable
          record. A per-wallet history that survives across sessions needs the route/execution
          store described in the product plan, which has not been built.
        </p>
      </div>

      <p className="notice" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/app">Start a new request</Link>
      </p>
    </section>
  );
}
