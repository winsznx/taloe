import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Taloe",
  description:
    "Choose a company and an amount. Taloe finds the tokenized representation that can execute it within your limit on BNB Smart Chain, or tells you not to trade.",
};

/**
 * Deliberately bare. The marketing page (/) and the dashboard
 * ((dashboard)/layout.tsx, sidebar-navigated) each own their own chrome —
 * a landing page and an app shell have different top-of-page needs, and
 * forcing one header design onto both was the wrong default.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
