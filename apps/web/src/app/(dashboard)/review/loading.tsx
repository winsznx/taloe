import type { ReactNode } from "react";

export default function ReviewLoading(): ReactNode {
  return (
    <section className="card" role="status" aria-live="polite">
      <p className="field-label">Preparing your review</p>
      <p className="notice" style={{ marginTop: "var(--space-2)" }}>
        Re-checking the route and, if you have a wallet connected, running a simulation.
      </p>
    </section>
  );
}
