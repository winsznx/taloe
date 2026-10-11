"use client";

import { useState } from "react";
import type { ReactNode } from "react";

/**
 * A real company logo when one is available (via a public, no-auth ticker
 * logo CDN), falling back to a plain letter monogram when it isn't —
 * never a broken-image icon. `underlyingTicker` (the real company, e.g.
 * "NVDA") is used for the logo lookup; `symbol` (the wrapper token, e.g.
 * "NVDAon") is what renders in the monogram fallback, since that's what
 * actually identifies the row to the user.
 */
export function TokenIcon({
  underlyingTicker,
  symbol,
  size = 28,
}: {
  underlyingTicker: string;
  symbol: string;
  size?: number;
}): ReactNode {
  const [failed, setFailed] = useState(false);
  const letter = symbol.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "?";

  if (failed) {
    return (
      <span
        className="token-icon token-icon-fallback"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
        aria-hidden="true"
      >
        {letter}
      </span>
    );
  }

  return (
    <img
      src={`https://cdn.jsdelivr.net/gh/davidepalazzo/ticker-logos/ticker_icons/${encodeURIComponent(underlyingTicker.toUpperCase())}.png`}
      alt=""
      width={size}
      height={size}
      className="token-icon"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}
