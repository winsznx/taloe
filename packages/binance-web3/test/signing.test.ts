import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildPreHash, buildQueryString, signRequest } from "../src/signing";

const API_KEY = "test-key";
const API_SECRET = "test-secret";
const NOW = new Date("2026-05-11T10:08:57.715Z");

describe("signing", () => {
  it("reproduces the pre-hash from the official documentation example", () => {
    // Verbatim from https://web3.binance.com/en/dev-docs/authentication (2026-09-21).
    const preHash = buildPreHash(
      "2026-05-11T10:08:57.715Z",
      "GET",
      "/build/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT",
      "",
    );
    expect(preHash).toBe(
      "2026-05-11T10:08:57.715ZGET/build/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT",
    );
  });

  it("always includes the /build prefix in the signed request path", () => {
    // The docs name omitting /build as the number-one cause of 40102, and the
    // edge still routes the request, so the failure looks like a bad key.
    const signed = signRequest({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      method: "GET",
      path: "/api/v1/dex/aggregator/quote",
      query: { binanceChainId: "56" },
      now: NOW,
    });
    expect(signed.requestPath).toBe("/build/api/v1/dex/aggregator/quote?binanceChainId=56");
  });

  it("does not double the prefix when the caller already supplied it", () => {
    const signed = signRequest({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      method: "GET",
      path: "/build/api/v1/dex/aggregator/quote",
      now: NOW,
    });
    expect(signed.requestPath).toBe("/build/api/v1/dex/aggregator/quote");
  });

  it("encodes spaces as %20 rather than +", () => {
    expect(buildQueryString({ symbol: "ETH USDT" })).toBe("symbol=ETH%20USDT");
  });

  it("preserves caller parameter order and never sorts", () => {
    // The docs forbid re-ordering: the signed query must match the wire byte
    // for byte, so insertion order is the contract.
    expect(buildQueryString({ z: "1", a: "2", m: "3" })).toBe("z=1&a=2&m=3");
  });

  it("omits undefined and null parameters entirely", () => {
    expect(buildQueryString({ a: "1", b: undefined, c: null, d: "2" })).toBe("a=1&d=2");
  });

  it("signs an empty body for GET even when a body is supplied", () => {
    const withBody = signRequest({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      method: "GET",
      path: "/api/v1/x",
      body: '{"ignored":true}',
      now: NOW,
    });
    const withoutBody = signRequest({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      method: "GET",
      path: "/api/v1/x",
      now: NOW,
    });
    expect(withBody.signature).toBe(withoutBody.signature);
  });

  it("includes the raw body verbatim in a POST signature", () => {
    const body = '{"binanceChainId":"56","amount":"1000"}';
    const signed = signRequest({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      method: "POST",
      path: "/api/v1/dex/aggregator/order/submit",
      body,
      now: NOW,
    });
    const expected = createHmac("sha256", API_SECRET)
      .update(
        `${NOW.toISOString()}POST/build/api/v1/dex/aggregator/order/submit${body}`,
        "utf8",
      )
      .digest("base64");
    expect(signed.signature).toBe(expected);
  });

  it("produces a base64 signature, not hex", () => {
    const signed = signRequest({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      method: "GET",
      path: "/api/v1/x",
      now: NOW,
    });
    expect(signed.signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(signed.signature).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it("emits an ISO 8601 timestamp with milliseconds, not epoch ms", () => {
    const signed = signRequest({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      method: "GET",
      path: "/api/v1/x",
      now: NOW,
    });
    expect(signed.headers["X-OC-TIMESTAMP"]).toBe("2026-05-11T10:08:57.715Z");
  });

  it("sets the recv-window header only when configured", () => {
    const without = signRequest({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      method: "GET",
      path: "/api/v1/x",
      now: NOW,
    });
    expect(without.headers["X-OC-RECV-WINDOW"]).toBeUndefined();

    const with5s = signRequest({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      method: "GET",
      path: "/api/v1/x",
      recvWindowMs: 5000,
      now: NOW,
    });
    expect(with5s.headers["X-OC-RECV-WINDOW"]).toBe("5000");
  });
});
