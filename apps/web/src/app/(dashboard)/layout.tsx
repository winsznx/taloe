import type { ReactNode } from "react";
import Link from "next/link";

import { getPublicConfig } from "@/server/config";
import { SidebarNav } from "@/components/SidebarNav";

/**
 * The app shell every dashboard page renders inside: a sidebar plus a
 * content column. A route GROUP — `(dashboard)` never appears in the URL,
 * so /route, /review, /execution, /receipt, /activity and
 * /about/how-it-works are exactly where they always were; only the file
 * location and the surrounding chrome changed.
 */
export default function DashboardLayout({ children }: { children: ReactNode }): ReactNode {
  const { dataMode, binanceChainId } = getPublicConfig();

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <Link href="/" className="wordmark sidebar-wordmark">
          Taloe
        </Link>
        <SidebarNav />
        <div className="sidebar-footer">
          {dataMode === "fixture" ? (
            <p className="mode-banner" role="status">
              <span aria-hidden="true">●</span>
              Sample data
            </p>
          ) : null}
          <p className="sidebar-chain">
            <span className="sidebar-chain-dot" aria-hidden="true" />
            BNB Smart Chain<span className="mono"> · {binanceChainId}</span>
          </p>
        </div>
      </aside>
      <main className="dashboard-content">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
