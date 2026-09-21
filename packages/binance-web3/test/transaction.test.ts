import { describe, expect, it, vi } from "vitest";

import { BinanceWeb3Client } from "../src/client";
import { TransactionService } from "../src/services/transaction";

const CONFIG = {
  apiKey: "APIKEY-b7f2c1a9",
  apiSecret: "SECRET-3e91d5f0",
  baseUrl: "https://web3.binance.com/build",
  maxRetries: 0,
};

const REQUEST = {
  binanceChainId: "56",
  evmTx: {
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    value: "0",
    data: "0xabcdef",
  },
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function serviceWith(fetchImpl: typeof fetch): TransactionService {
  const client = new BinanceWeb3Client({ ...CONFIG, fetchImpl });
  return new TransactionService(client);
}

describe("TransactionService.simulate — against the canonical documented contract", () => {
  it("signs the request with the documented evmTx shape, not the guessed fromAddress/toAddress/txAmount shape", async () => {
    let capturedBody: unknown;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;
      return jsonResponse({ code: 0, data: { status: "SUCCESS", failReason: null, balanceChanges: [], allowanceChanges: [] } });
    });
    await serviceWith(fetchImpl as never).simulate(REQUEST);
    expect(capturedBody).toEqual({ binanceChainId: "56", evmTx: REQUEST.evmTx });
  });

  it("maps a clean SUCCESS to PASS", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 0, data: { status: "SUCCESS", failReason: null, balanceChanges: [], allowanceChanges: [] } }),
    );
    const result = await serviceWith(fetchImpl as never).simulate(REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("PASS");
      expect(result.value.failReason).toBeNull();
    }
  });

  it("maps a clean FAILED to FAIL and preserves the reason", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: { status: "FAILED", failReason: "execution reverted: insufficient allowance", balanceChanges: [], allowanceChanges: [] },
      }),
    );
    const result = await serviceWith(fetchImpl as never).simulate(REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("FAIL");
      expect(result.value.failReason).toContain("insufficient allowance");
    }
  });

  it("treats HTTP transport success with a business-level error as a failure, never as a simulation result", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 40001, msg: "Invalid parameters", data: null }));
    const result = await serviceWith(fetchImpl as never).simulate(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.businessCode).toBe(40001);
  });

  it("fails closed on a malformed response that carries no status at all", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 0, data: { balanceChanges: [], allowanceChanges: [] } }),
    );
    const result = await serviceWith(fetchImpl as never).simulate(REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("NOT_RUN");
      expect(result.value.failReason).toMatch(/did not include a status/);
    }
  });

  it("fails closed on an unrecognised status value rather than guessing pass or fail", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 0, data: { status: "PARTIAL_SOMETHING", failReason: null, balanceChanges: [], allowanceChanges: [] } }),
    );
    const result = await serviceWith(fetchImpl as never).simulate(REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("NOT_RUN");
      expect(result.value.failReason).toMatch(/unrecognised status/);
    }
  });

  it("fails closed on the documented SUCCESS+failReason contradiction rather than picking a side", async () => {
    // This is the exact combination the current canonical docs show in their
    // own example response — see SPONSOR_FINDINGS.md DOC-005.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          status: "SUCCESS",
          failReason: "execution reverted: ERC20InsufficientBalance",
          balanceChanges: [],
          allowanceChanges: [],
        },
      }),
    );
    const result = await serviceWith(fetchImpl as never).simulate(REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Neither PASS (ignoring the revert-shaped failReason) nor FAIL
      // (inventing a rule the docs never state) — fails closed to NOT_RUN,
      // which the router's hard gate already treats as "cannot confirm a pass."
      expect(result.value.status).toBe("NOT_RUN");
      expect(result.value.status).not.toBe("PASS");
      expect(result.value.status).not.toBe("FAIL");
      expect(result.value.failReason).toMatch(/inconsistent/i);
      expect(result.value.failReason).toContain("ERC20InsufficientBalance");
    }
  });

  it("hands the raw contradictory payload to the evidence hook while still failing closed", async () => {
    const seen: unknown[] = [];
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: { status: "SUCCESS", failReason: "execution reverted: X", balanceChanges: [], allowanceChanges: [] },
      }),
    );
    const client = new BinanceWeb3Client({ ...CONFIG, fetchImpl: fetchImpl as never });
    const result = await new TransactionService(client, (raw) => seen.push(raw)).simulate(REQUEST);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ status: "SUCCESS", failReason: "execution reverted: X" });
    expect(result.ok && result.value.status).toBe("NOT_RUN");
  });

  it("does not call the hook for a clean SUCCESS", async () => {
    const seen: unknown[] = [];
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 0, data: { status: "SUCCESS", failReason: null, balanceChanges: [], allowanceChanges: [] } }),
    );
    const client = new BinanceWeb3Client({ ...CONFIG, fetchImpl: fetchImpl as never });
    await new TransactionService(client, (raw) => seen.push(raw)).simulate(REQUEST);
    expect(seen).toHaveLength(0);
  });

  it("parses balanceChanges using the documented field names", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          status: "SUCCESS",
          failReason: null,
          balanceChanges: [
            {
              contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
              tokenType: "ERC20",
              change: "-1000000",
              owner: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            },
          ],
          allowanceChanges: [],
        },
      }),
    );
    const result = await serviceWith(fetchImpl as never).simulate(REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.balanceChanges).toEqual([
        {
          contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
          tokenType: "ERC20",
          change: "-1000000",
          owner: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        },
      ]);
    }
  });

  it("parses allowanceChanges using the documented field names", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          status: "SUCCESS",
          failReason: null,
          balanceChanges: [],
          allowanceChanges: [
            {
              tokenAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
              owner: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
              spender: "0x3333333333333333333333333333333333333333",
              preAmount: "0",
              postAmount: "1000000000000000000",
            },
          ],
        },
      }),
    );
    const result = await serviceWith(fetchImpl as never).simulate(REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowanceChanges).toEqual([
        {
          tokenAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
          owner: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          spender: "0x3333333333333333333333333333333333333333",
          preAmount: "0",
          postAmount: "1000000000000000000",
        },
      ]);
    }
  });

  it("tolerates unknown additive fields in the response without failing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          status: "SUCCESS",
          failReason: null,
          balanceChanges: [],
          allowanceChanges: [],
          somethingBinanceAddsLater: { nested: true },
        },
      }),
    );
    const result = await serviceWith(fetchImpl as never).simulate(REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("PASS");
  });
});
