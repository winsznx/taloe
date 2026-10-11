import type { ReactNode } from "react";

/**
 * Route-discovery loading state.
 *
 * Says what Taloe is doing rather than showing an indefinite spinner
 * (PRD 8.1.5). Next.js renders this automatically while the async page
 * component below it is resolving.
 */
export default function RouteLoading(): ReactNode {
  return (
    <section className="card" role="status" aria-live="polite">
      <p className="field-label">Comparing tokenized routes</p>
      <p className="notice" style={{ marginTop: "var(--space-2)" }}>
        Looking up wrapper candidates, current market context, and executable quotes.
      </p>
    </section>
  );
}
