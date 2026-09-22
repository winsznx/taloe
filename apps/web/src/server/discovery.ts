import "server-only";

/**
 * The single place that decides which `DiscoveryPort` the app uses.
 *
 * This function is the entire enforcement mechanism for "no silent fallback
 * from live to fixture" (PRD 15; V1 review). It is a `switch` with exactly
 * two branches and no shared code path between them — there is no `try` block
 * here that could catch a live failure and reach for the fixture provider.
 * If live mode is configured, the fixture provider is never even imported in
 * that request's execution; if fixture mode is configured, `getServices()`
 * (which throws for missing credentials) is never called at all.
 */

import { FixtureDiscoveryProvider } from "@taloe/router-core/fixtures/fixture-provider";
import type { DiscoveryPort } from "@taloe/router-core";
import { LiveDiscoveryProvider } from "@taloe/router-core";

import { getServices } from "./binance";
import { getServerConfig } from "./config";

let cached: DiscoveryPort | null = null;

export function getDiscoveryPort(): DiscoveryPort {
  if (cached) return cached;

  const config = getServerConfig();
  switch (config.dataMode) {
    case "fixture":
      cached = new FixtureDiscoveryProvider();
      return cached;
    case "live":
      cached = new LiveDiscoveryProvider(getServices(), config.binanceChainId, { rpcUrl: config.bscRpcUrl });
      return cached;
  }
}
