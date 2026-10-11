import type { ReactNode } from "react";
import Link from "next/link";

import { getServerConfig } from "@/server/config";
import { ActivityList } from "@/components/ActivityList";

/**
 * Per-wallet execution history (PRD 8.3): timestamp, ticker, wrapper, spend
 * amount, status, receipt link. Not a PnL dashboard.
 *
 * Backed by Supabase, written server-side right after WalletExecutionPanel
 * independently verifies a swap (balance delta confirmed, not just a
 * receipt status) — see server/supabase.ts and server/actions/activity.ts.
 * Scoped to whichever wallet is connected in the browser, never a global
 * feed: this product has no accounts, only wallets.
 */
export const metadata = { title: "Activity" };

export default function ActivityPage(): ReactNode {
  const { binanceChainId } = getServerConfig();

  return (
    <section aria-labelledby="activity-heading">
      <h1 id="activity-heading" className="lede" style={{ marginBottom: "var(--space-5)" }}>
        Activity
      </h1>

      <ActivityList requiredChainId={binanceChainId} />

      <p className="notice" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/app">Start a new request</Link>
      </p>
    </section>
  );
}
