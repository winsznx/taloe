import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Plain-language explanation. Product language, not hackathon language
 * (PRD 8.3): no mention of Binance API names, hackathon tracks, or internal
 * module names like WrapRoute/SessionMark.
 */
export const metadata = { title: "How Taloe works" };

export default function HowItWorksPage(): ReactNode {
  return (
    <article>
      <h1 className="lede">Why does one company have more than one token?</h1>

      <p>
        When a company like NVIDIA is offered as a tokenized asset on BNB Smart Chain, more
        than one issuer can create their own version of it. Each version is a separate token,
        backed and operated differently, even though they all track the same company. Some
        trade through an automated market — buy and sell instantly at whatever price the pool
        offers. Others trade through a request-for-quote process, where a market maker prices
        your specific order before you sign anything.
      </p>

      <p>
        These versions do not always behave the same way. One might be tradable any time; another
        might only be available while the company&apos;s home stock market is open. One might
        give you a slightly better price right now; another might be more expensive because of
        the size of your order.
      </p>

      <h2>What Taloe does</h2>
      <p>
        You tell Taloe the company and the amount. Taloe looks at every version it can safely
        identify, checks whether each one can actually be traded right now, gets a real price for
        your specific order size, and compares what you would end up with. It also checks the
        result against a limit you set — how far the price is allowed to drift from a reference
        price before Taloe considers it too expensive.
      </p>
      <p>
        If one version clearly comes out ahead and passes every check, Taloe recommends it and
        shows you why. If every version fails a check — an expired price, a paused token, a price
        too far from reference — Taloe tells you that directly instead of picking the least-bad
        option. If Taloe cannot get enough trustworthy information to compare safely, it says so
        rather than guessing.
      </p>

      <h2>What you actually hold</h2>
      <p>
        A tokenized version of a company is not the same thing as owning a registered share
        through a brokerage. It is a token, issued by a third party, designed to track the value
        of the underlying company. Taloe shows you exactly which token you are receiving, from
        which issuer, before you sign anything — and again on your receipt afterward.
      </p>

      <p className="notice" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/">Back to Taloe</Link>
      </p>
    </article>
  );
}
