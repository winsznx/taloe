import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Taloe",
  description:
    "Choose a company and an amount. Taloe finds the tokenized representation that can execute it within your limit on BNB Smart Chain, or tells you not to trade.",
};

/**
 * Deliberately bare. The marketing page (/) and the dashboard
 * ((dashboard)/layout.tsx, sidebar-navigated) each own their own chrome —
 * a landing page and an app shell have different top-of-page needs, and
 * forcing one header design onto both was the wrong default. Font variables
 * are set here once, self-hosted by Next (next/font), so every page shares
 * the same type without a runtime font request.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
