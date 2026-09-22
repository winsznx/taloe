import { err, ok } from "@taloe/shared";
import { describe, expect, it, vi } from "vitest";

import { makeRoute } from "../fixtures/candidates";
import { LiveDiscoveryProvider } from "../src/live-discovery-provider";
import type { LiveSponsorServices } from "../src/live-discovery-provider";

const WALLET = "0x1111111111111111111111111111111111111111";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const NOW = new Date("2026-09-21T12:00:00.000Z");

const TX = {
  from: WALLET,
  to: "0x9999999999999999999999999999999999999999",
  data: "0xdeadbeef",
  value: "0",
};

function services(overrides: {
  buildSwap?: unknown;
  simulate?: unknown;
}): { services: LiveSponsorServices; buildSwap: ReturnType<typeof vi.fn>; simulate: ReturnType<typeof vi.fn> } {
  const buildSwap = vi.fn(async () => overrides.buildSwap ?? ok({ tx: TX, rfq: null, routerResult: null }));
  const simulate = vi.fn(
    async () =>
      overrides.simulate ??
      ok({
        status: "PASS",
        failReason: null,
        balanceChanges: [],
        allowanceChanges: [],
        observedAt: NOW.toISOString(),
        provenance: [],
      }),
  );
  return {
    buildSwap,
    simulate,
    services: {
      trading: { buildSwap },
      transaction: { simulate },
    } as unknown as LiveSponsorServices,
  };
}

const PARAMS = { chainId: "56", walletAddress: WALLET, spendTokenAddress: USDT, now: NOW };

describe("LiveDiscoveryProvider.simulateRoute — quote -> build -> simulate", () => {
  it("builds the swap from the quote-bound parameters, then simulates the built tx fields", async () => {
    const { services: s, buildSwap, simulate } = services({});
    const route = makeRoute({ routeId: "r", now: NOW });

    const result = await new LiveDiscoveryProvider(s).simulateRoute(route, PARAMS);

    expect(result.ok).toBe(true);
    expect(buildSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: route.quote.quoteId,
        fromTokenAddress: USDT,
        toTokenAddress: route.wrapper.tokenContractAddress,
        amount: route.quote.fromTokenAmount,
        userWalletAddress: WALLET,
      }),
    );
    expect(simulate).toHaveBeenCalledWith({ binanceChainId: "56", evmTx: TX });
  });

  it("defaults a missing tx value to 0 rather than sending undefined", async () => {
    const { services: s, simulate } = services({
      buildSwap: ok({ tx: { ...TX, value: null }, rfq: null, routerResult: null }),
    });
    await new LiveDiscoveryProvider(s).simulateRoute(makeRoute({ routeId: "r", now: NOW }), PARAMS);
    expect(simulate).toHaveBeenCalledWith({ binanceChainId: "56", evmTx: { ...TX, value: "0" } });
  });

  it("fails closed and never simulates when the build returns no EVM transaction", async () => {
    const { services: s, simulate } = services({
      buildSwap: ok({ tx: null, rfq: { orderId: "o", typedDataToSign: null, signingScheme: null }, routerResult: null }),
    });
    const result = await new LiveDiscoveryProvider(s).simulateRoute(makeRoute({ routeId: "r", now: NOW }), PARAMS);
    expect(result.ok).toBe(false);
    expect(simulate).not.toHaveBeenCalled();
  });

  it("surfaces a build failure (e.g. QUOTE_EXPIRED between quote and build) without simulating", async () => {
    const { services: s, simulate } = services({
      buildSwap: err({ message: "Quote expired", businessCode: 40401, kind: "QUOTE_EXPIRED" }),
    });
    const result = await new LiveDiscoveryProvider(s).simulateRoute(makeRoute({ routeId: "r", now: NOW }), PARAMS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SPONSOR_UNAVAILABLE");
    expect(simulate).not.toHaveBeenCalled();
  });

  it("surfaces a simulate business/transport error as a discovery error, not a pass", async () => {
    const { services: s } = services({ simulate: err({ message: "Invalid parameters", businessCode: 40001 }) });
    const result = await new LiveDiscoveryProvider(s).simulateRoute(makeRoute({ routeId: "r", now: NOW }), PARAMS);
    expect(result.ok).toBe(false);
  });

  it("passes an inconsistent (NOT_RUN) simulation through unchanged so the router gate refuses it", async () => {
    const inconsistent = ok({
      status: "NOT_RUN",
      failReason: "sponsor response inconsistent: status=SUCCESS but failReason=...",
      balanceChanges: [],
      allowanceChanges: [],
      observedAt: NOW.toISOString(),
      provenance: [],
    });
    const { services: s } = services({ simulate: inconsistent });
    const result = await new LiveDiscoveryProvider(s).simulateRoute(makeRoute({ routeId: "r", now: NOW }), PARAMS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("NOT_RUN");
  });
});

describe("LiveDiscoveryProvider.searchUnderlying — fuzzy keyword search", () => {
  const group = (ticker: string) => ({
    ticker,
    companyName: ticker,
    assets: [{ platformId: "ondo", binanceChainId: "56", tokenContractAddress: WALLET, tokenSymbol: `${ticker}on`, assetType: 3 }],
  });
  const provider = (groups: ReturnType<typeof group>[]) =>
    new LiveDiscoveryProvider({ rwa: { searchGroups: async () => ok(groups) } } as unknown as LiveSponsorServices);

  it("resolves an exact ticker even though the search also returned lookalikes", async () => {
    const result = await provider([group("QQQ"), group("TQQQ"), group("SQQQ")]).searchUnderlying("qqq", "56");
    expect(result.ok && result.value.map((m) => m.underlying.ticker)).toEqual(["QQQ"]);
  });

  it("keeps a genuinely non-exact query ambiguous", async () => {
    const result = await provider([group("QQQ"), group("TQQQ")]).searchUnderlying("QQ", "56");
    expect(result.ok && result.value).toHaveLength(2);
  });
});
