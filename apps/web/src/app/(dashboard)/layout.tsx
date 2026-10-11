import type { ReactNode } from "react";
import Link from "next/link";

import { getPublicConfig } from "@/server/config";

const NAV_LINKS = [
  { href: "/app", label: "New request" },
  { href: "/activity", label: "Activity" },
  { href: "/about/how-it-works", label: "How it works" },
] as const;

/**
 * The app shell every dashboard page renders inside: a sidebar plus a
 * content column. A route GROUP — `(dashboard)` never appears in the URL,
 * so /route, /review, /execution, /receipt, /activity and
 * /about/how-it-works are exactly where they always were; only the file
 * location and the surrounding chrome changed.
 */
export default function DashboardLayout({ children }: { children: ReactNode }): ReactNode {
  const { dataMode } = getPublicConfig();

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <Link href="/" className="wordmark sidebar-wordmark">
          Taloe
        </Link>
        <nav aria-label="Dashboard">
          <ul className="sidebar-nav">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="sidebar-link">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {dataMode === "fixture" ? (
          <p className="mode-banner" role="status">
            <span aria-hidden="true">●</span>
            Sample data
          </p>
        ) : null}
      </aside>
      <main className="dashboard-content">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
