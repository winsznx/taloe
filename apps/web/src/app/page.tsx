import type { ReactNode } from "react";
import Link from "next/link";

import { getPublicConfig } from "@/server/config";

/**
 * Landing and intent capture.
 *
 * The company comes first and the wrapper is not mentioned here at all (PRD
 * 8.1.1). No architecture diagram, no benchmark chart, no hackathon badge above
 * the primary action (PRD 8.3). The advanced constraint is present but folded
 * away, because the main path must work without the user tuning anything.
 */
export default function HomePage(): ReactNode {
  const { defaultMaxDeviationBps } = getPublicConfig();

  return (
    <>
      <h1 className="lede">
        Choose a company and an amount. Taloe finds the best valid way to buy it on BNB
        Smart Chain, or tells you not to trade.
      </h1>

      <section className="card" aria-labelledby="intent-heading">
        <h2 id="intent-heading" className="field-label" style={{ marginBottom: "var(--space-5)" }}>
          What do you want exposure to?
        </h2>

        <form action="/route" method="get">
          <label className="field">
            <span className="field-label">Company or ticker</span>
            <input
              className="input"
              type="text"
              name="q"
              placeholder="NVIDIA, NVDA, TSLA…"
              autoComplete="off"
              enterKeyHint="search"
              required
            />
            <span className="field-hint">
              Search by company name, ticker, or a token contract address.
            </span>
          </label>

          <label className="field">
            <span className="field-label">Amount to spend</span>
            <span className="input-group">
              <input
                className="input"
                type="text"
                name="amount"
                inputMode="decimal"
                placeholder="500"
                autoComplete="off"
                required
              />
              <span className="input-suffix">USDT</span>
            </span>
            <span className="field-hint">Funded from USDT on BNB Smart Chain.</span>
          </label>

          <details className="disclosure">
            <summary>Execution limit</summary>
            <label className="field" style={{ marginTop: "var(--space-4)" }}>
              <span className="field-label">
                Maximum distance from the reference price, in basis points
              </span>
              <input
                className="input"
                type="number"
                name="maxDeviationBps"
                min={1}
                max={10000}
                step={1}
                defaultValue={defaultMaxDeviationBps}
              />
              <span className="field-hint">
                Taloe refuses to execute beyond this, rather than widening it for you. 100
                basis points is 1%.
              </span>
            </label>
          </details>

          <details className="disclosure">
            <summary>Wallet</summary>
            <div style={{ marginTop: "var(--space-4)" }}>
              <p className="field-hint" style={{ marginBottom: "var(--space-3)" }}>
                A live wallet adapter is not wired up yet. This connects a fixed demo address
                so balance-aware states (insufficient funds, simulation, execution) can be
                exercised honestly in fixture mode.
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <input type="checkbox" name="wallet" value="0x1111111111111111111111111111111111111111" />
                <span>Connect demo wallet</span>
              </label>
            </div>
          </details>

          <button className="button" type="submit" style={{ marginTop: "var(--space-5)" }}>
            Find my route
          </button>
        </form>
      </section>

      <p className="notice">
        Tokenized equities are wrapper tokens issued by third parties. Buying one gives you
        exposure that tracks the underlying company. It is not direct ownership of a
        registered share, and it carries the issuer&apos;s own risks. Availability may be
        restricted in some regions.{" "}
        <Link href="/about/how-it-works">Why multiple wrappers exist</Link>.
      </p>
    </>
  );
}
