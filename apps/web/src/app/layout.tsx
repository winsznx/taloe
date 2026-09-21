import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getPublicConfig } from "@/server/config";

import "./globals.css";

export const metadata: Metadata = {
  title: "Taloe",
  description:
    "Choose a company and an amount. Taloe finds the best valid tokenized-equity execution on BNB Smart Chain, or tells you not to trade.",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  const { dataMode } = getPublicConfig();

  return (
    <html lang="en">
      <body>
        <div className="page">
          <header className="site-header">
            <p className="wordmark">Taloe</p>
            {dataMode === "fixture" ? (
              // Development mode must be visibly distinct from live mode, so a
              // screenshot or a recording can never be mistaken for real data.
              <p className="mode-banner" role="status">
                <span aria-hidden="true">●</span>
                Sample data — not live market data
              </p>
            ) : null}
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
