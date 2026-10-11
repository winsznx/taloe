import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Marketing landing page. Separate from the dashboard (/app and onward) on
 * purpose: a page meant to explain the product to someone who has never
 * used it has different needs than the tool itself, and conflating the two
 * was the gap — a product had been built with no front door.
 *
 * Every number here is a real, measured figure from the live validation
 * campaigns (see internal/evidence/), not a placeholder stat.
 */
export default function LandingPage(): ReactNode {
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="wordmark">Taloe</span>
        <Link href="/app" className="button landing-nav-cta">
          Open the dashboard
        </Link>
      </header>

      <section className="section hero-section" aria-labelledby="hero-heading">
        <div className="section-inner hero-grid">
          <div>
            <p className="eyebrow">Tokenized-equity execution, BNB Smart Chain</p>
            <h1 id="hero-heading" className="hero-headline">
              One company. Several wrapper tokens. Not the same trade.
            </h1>
            <p className="hero-sub">
              Taloe checks what your order actually executes at, on every wrapper Binance
              can route to for that company, before you buy — and refuses the ones that
              cost more than you said.
            </p>
            <div className="hero-actions">
              <Link href="/app" className="button">
                Open the dashboard
              </Link>
              <a href="https://github.com/winsznx/taloe" className="hero-secondary-link">
                Read the live evidence
              </a>
            </div>
          </div>
          <div className="card hero-figure" aria-label="A real measured divergence between two wrappers for the same company">
            <p className="hero-figure-label">NVDA, $2,000 order, measured live</p>
            <div className="hero-compare">
              <div className="hero-compare-cell">
                <p className="hero-compare-symbol">NVDAon</p>
                <p className="hero-compare-stat hero-compare-bad">+157 bps</p>
                <p className="hero-compare-note">outside a 1.5% limit</p>
              </div>
              <div className="hero-compare-cell">
                <p className="hero-compare-symbol">NVDAB</p>
                <p className="hero-compare-stat hero-compare-good">13 bps</p>
                <p className="hero-compare-note">still clean at $100,000</p>
              </div>
            </div>
            <p className="hero-figure-caption">Same company, same instant, same spend — two different fills.</p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="problem-heading">
        <div className="section-inner">
          <h2 id="problem-heading" className="section-heading">
            The wrapper you default to is not always the wrapper you should use
          </h2>
          <p className="section-lede">
            Ondo and bStock both issue tokenized versions of the same companies on BNB
            Smart Chain. They are not interchangeable: liquidity depth differs by wrapper
            and by order size, and the difference is not always in the same direction.
          </p>
          <p className="section-lede">
            A static rule — &ldquo;always use the usually-deeper wrapper&rdquo; — was tested
            against live data and failed in three measured cases. At $100,000, AVGO, COIN
            and DRAM each returned a fully executable quote from the &ldquo;safer&rdquo;
            wrapper priced 170 to 5,168 basis points away from reference, while the other
            wrapper stayed clean or refused the quote outright. Reversing the rule would
            just move the failure to a different three companies.
          </p>
        </div>
      </section>

      <section className="section how-section" aria-labelledby="how-heading">
        <div className="section-inner">
          <h2 id="how-heading" className="section-heading">
            How a request gets decided
          </h2>
          <ol className="steps">
            <li className="step">
              <span className="step-number">1</span>
              <div>
                <p className="step-title">Compare</p>
                <p className="step-body">
                  Taloe pulls a live executable quote from every wrapper available for the
                  company you named — not a listed price, a quote the issuer would actually
                  honor right now.
                </p>
              </div>
            </li>
            <li className="step">
              <span className="step-number">2</span>
              <div>
                <p className="step-title">Check</p>
                <p className="step-body">
                  Each quote is converted into underlying-equivalent shares and measured
                  against the reference price, at the exact size you asked for — small and
                  large orders can land on opposite sides of the same limit.
                </p>
              </div>
            </li>
            <li className="step">
              <span className="step-number">3</span>
              <div>
                <p className="step-title">Execute or refuse</p>
                <p className="step-body">
                  A wrapper inside your limit goes through approval, a forced fresh quote,
                  and a simulated transaction before you ever sign anything. If none
                  qualifies, Taloe says so instead of picking the least-bad option quietly.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="section proof-section" aria-labelledby="proof-heading">
        <div className="section-inner">
          <h2 id="proof-heading" className="section-heading">
            Measured against live data, not a pitch deck
          </h2>
          <div className="proof-grid">
            <div className="proof-stat">
              <p className="proof-number">40</p>
              <p className="proof-caption">BSC underlyings tested live, $5.10 to $100,000 per order</p>
            </div>
            <div className="proof-stat">
              <p className="proof-number">97%</p>
              <p className="proof-caption">of ordinary retail-sized orders price the same across wrappers — Taloe says so, it doesn&apos;t invent a winner</p>
            </div>
            <div className="proof-stat">
              <p className="proof-number">2</p>
              <p className="proof-caption">
                real signed transactions on BSC mainnet, independently verified by reading
                the actual balance change, not a receipt status
              </p>
            </div>
          </div>
          <p className="section-lede proof-links">
            Approval{" "}
            <a href="https://bscscan.com/tx/0xb1ef6221a4cccaab0028106b979677368aae3eaa30d3a0502fe4e7e9184a77af" className="mono">
              0xb1ef62…a77af
            </a>{" "}
            and swap{" "}
            <a href="https://bscscan.com/tx/0xd73092697cdc32778e5fda0ae1cf480f7f78e0253382f1e1a93c95881c3b6a92" className="mono">
              0xd73092…b6a92
            </a>{" "}
            — check them on BscScan yourself.
          </p>
        </div>
      </section>

      <section className="section final-section" aria-labelledby="final-heading">
        <div className="section-inner final-inner">
          <h2 id="final-heading" className="section-heading">
            Funded in USDT. Routed on BNB Smart Chain.
          </h2>
          <p className="section-lede">
            Connect a wallet, name a company and an amount, and see the route Taloe would
            take — or the reason it wouldn&apos;t.
          </p>
          <Link href="/app" className="button final-cta">
            Open the dashboard
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <p>
          Tokenized equities are wrapper tokens issued by third parties, not registered
          shares. <Link href="/about/how-it-works">Why multiple wrappers exist</Link>.
        </p>
        <p>
          <a href="https://github.com/winsznx/taloe">Source on GitHub</a>
        </p>
      </footer>
    </div>
  );
}
