import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { BinanceWeb3Client } from "../src/client";

const CONFIG = {
  // Distinctive so a leak assertion cannot pass or fail by coincidence.
  apiKey: "APIKEY-b7f2c1a9",
  apiSecret: "SECRET-3e91d5f0",
  baseUrl: "https://web3.binance.com/build",
  maxRetries: 0,
};

const schema = z.object({ value: z.string() });

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("BinanceWeb3Client", () => {
  it("rejects a base URL without the /build prefix at construction time", () => {
    expect(
      () => new BinanceWeb3Client({ ...CONFIG, baseUrl: "https://web3.binance.com" }),
    ).toThrow(/\/build/);
  });

  it("accepts HTTP 200 with code 0 and a valid shape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, data: { value: "ok" } }));
    const client = new BinanceWeb3Client({ ...CONFIG, fetchImpl: fetchImpl as never });

    const result = await client.request({ method: "GET", path: "/api/v1/x", schema });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value).toBe("ok");
  });

  it("treats HTTP 200 with a non-zero business code as a failure", async () => {
    // The whole point of PRD 5.2: the transport says 200 and the body says no.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 40401, msg: "Quote expired", data: null }),
    );
    const client = new BinanceWeb3Client({ ...CONFIG, fetchImpl: fetchImpl as never });

    const result = await client.request({ method: "GET", path: "/api/v1/x", schema });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(200);
      expect(result.error.businessCode).toBe(40401);
      expect(result.error.kind).toBe("QUOTE_EXPIRED");
      // An expired quote must not be retried with the same quoteId.
      expect(result.error.retryable).toBe(false);
    }
  });

  it("classifies an auth business code as AUTH and does not retry it", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 40102, msg: "Invalid signature", data: null }),
    );
    const client = new BinanceWeb3Client({ ...CONFIG, fetchImpl: fetchImpl as never });

    const result = await client.request({ method: "GET", path: "/api/v1/x", schema });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("AUTH");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("fails when code is 0 but the payload does not match the schema", async () => {
    // Documentation examples are not a contract; an unexpected shape is an
    // error rather than something we cast our way past.
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, data: { value: 42 } }));
    const client = new BinanceWeb3Client({ ...CONFIG, fetchImpl: fetchImpl as never });

    const result = await client.request({ method: "GET", path: "/api/v1/x", schema });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SCHEMA");
  });

  it("classifies HTTP 429 as a rate limit and reads Retry-After", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { code: 42900, msg: "Too many requests", data: null },
        { status: 429, headers: { "retry-after": "3", "content-type": "application/json" } },
      ),
    );
    const client = new BinanceWeb3Client({ ...CONFIG, fetchImpl: fetchImpl as never });

    const result = await client.request({ method: "GET", path: "/api/v1/x", schema });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("RATE_LIMIT");
      expect(result.error.retryAfterSeconds).toBe(3);
    }
  });

  it("retries a transport failure and succeeds on a later attempt", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNRESET");
      return jsonResponse({ code: 0, data: { value: "recovered" } });
    });
    const client = new BinanceWeb3Client({ ...CONFIG, maxRetries: 2, fetchImpl: fetchImpl as never });

    const result = await client.request({ method: "GET", path: "/api/v1/x", schema });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("emits an observation carrying latency and rate-limit headers but no credentials", async () => {
    const observations: unknown[] = [];
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { code: 0, data: { value: "ok" } },
        { headers: { "x-oc-ratelimit-remaining": "1199", "content-type": "application/json" } },
      ),
    );
    const client = new BinanceWeb3Client({
      ...CONFIG,
      fetchImpl: fetchImpl as never,
      onObservation: (observation) => observations.push(observation),
    });

    await client.request({ method: "GET", path: "/api/v1/dex/aggregator/quote", schema });

    expect(observations).toHaveLength(1);
    const serialized = JSON.stringify(observations[0]);
    expect(serialized).toContain("x-oc-ratelimit-remaining");
    expect(serialized).not.toContain(CONFIG.apiSecret);
    expect(serialized).not.toContain(CONFIG.apiKey);
  });

  it("sends the /build prefix exactly once in the request URL", async () => {
    let calledUrl = "";
    const fetchImpl = vi.fn(async (url: string) => {
      calledUrl = url;
      return jsonResponse({ code: 0, data: { value: "ok" } });
    });
    const client = new BinanceWeb3Client({ ...CONFIG, fetchImpl: fetchImpl as never });

    await client.request({
      method: "GET",
      path: "/api/v1/dex/market/rwa/search",
      query: { keyword: "NVDA" },
      schema,
    });

    expect(calledUrl).toBe(
      "https://web3.binance.com/build/api/v1/dex/market/rwa/search?keyword=NVDA",
    );
  });
});
