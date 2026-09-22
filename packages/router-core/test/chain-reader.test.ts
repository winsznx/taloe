import { describe, expect, it, vi } from "vitest";

import { readErc20Allowance, readErc20Balance, readNativeBalanceWei } from "../src/chain-reader";

const TOKEN = "0x55d398326f99059fF775485246999027B3197955";
const OWNER = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";
const SPENDER = "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5";

const rpc = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));

describe("readErc20Allowance", () => {
  it("encodes allowance(owner,spender) calldata and parses the returned word", async () => {
    const fetchImpl = rpc({ jsonrpc: "2.0", id: 1, result: "0x" + (5n * 10n ** 18n).toString(16).padStart(64, "0") });
    const result = await readErc20Allowance({ rpcUrl: "https://rpc.test", fetchImpl }, { tokenAddress: TOKEN, owner: OWNER, spender: SPENDER });
    expect(result).toEqual({ ok: true, value: "5000000000000000000" });

    const sent = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.method).toBe("eth_call");
    expect(sent.params[0].to).toBe(TOKEN);
    expect(sent.params[0].data).toBe(
      "0xdd62ed3e" + OWNER.slice(2).toLowerCase().padStart(64, "0") + SPENDER.slice(2).toLowerCase().padStart(64, "0"),
    );
  });

  it("reads a genuine zero as zero", async () => {
    const result = await readErc20Allowance({ rpcUrl: "x", fetchImpl: rpc({ result: "0x" + "0".repeat(64) }) }, { tokenAddress: TOKEN, owner: OWNER, spender: SPENDER });
    expect(result).toEqual({ ok: true, value: "0" });
  });

  it("reports an RPC error instead of returning zero", async () => {
    const result = await readErc20Allowance({ rpcUrl: "x", fetchImpl: rpc({ error: { message: "rate limited" } }) }, { tokenAddress: TOKEN, owner: OWNER, spender: SPENDER });
    expect(result).toEqual({ ok: false, message: "rate limited" });
  });

  it("reports a transport failure instead of returning zero", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNRESET"); });
    const result = await readErc20Allowance({ rpcUrl: "x", fetchImpl }, { tokenAddress: TOKEN, owner: OWNER, spender: SPENDER });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed address before making any request", async () => {
    const fetchImpl = rpc({});
    const result = await readErc20Allowance({ rpcUrl: "x", fetchImpl }, { tokenAddress: TOKEN, owner: "0x123", spender: SPENDER });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("readErc20Balance", () => {
  it("encodes balanceOf(owner) calldata and parses the returned word", async () => {
    const fetchImpl = rpc({ jsonrpc: "2.0", id: 1, result: "0x" + (12n * 10n ** 18n).toString(16).padStart(64, "0") });
    const result = await readErc20Balance({ rpcUrl: "https://rpc.test", fetchImpl }, { tokenAddress: TOKEN, owner: OWNER });
    expect(result).toEqual({ ok: true, value: "12000000000000000000" });

    const sent = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.method).toBe("eth_call");
    expect(sent.params[0].to).toBe(TOKEN);
    expect(sent.params[0].data).toBe("0x70a08231" + OWNER.slice(2).toLowerCase().padStart(64, "0"));
  });

  it("reports an RPC error instead of returning zero", async () => {
    const result = await readErc20Balance({ rpcUrl: "x", fetchImpl: rpc({ error: { message: "rate limited" } }) }, { tokenAddress: TOKEN, owner: OWNER });
    expect(result).toEqual({ ok: false, message: "rate limited" });
  });

  it("rejects a malformed address before making any request", async () => {
    const fetchImpl = rpc({});
    const result = await readErc20Balance({ rpcUrl: "x", fetchImpl }, { tokenAddress: "not-an-address", owner: OWNER });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("readNativeBalanceWei", () => {
  it("calls eth_getBalance for the owner and parses the returned word", async () => {
    const fetchImpl = rpc({ jsonrpc: "2.0", id: 1, result: "0x" + (2n * 10n ** 17n).toString(16) });
    const result = await readNativeBalanceWei({ rpcUrl: "https://rpc.test", fetchImpl }, { owner: OWNER });
    expect(result).toEqual({ ok: true, value: "200000000000000000" });

    const sent = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.method).toBe("eth_getBalance");
    expect(sent.params).toEqual([OWNER, "latest"]);
  });

  it("reads a genuine zero balance as zero, not as an error", async () => {
    const result = await readNativeBalanceWei({ rpcUrl: "x", fetchImpl: rpc({ result: "0x0" }) }, { owner: OWNER });
    expect(result).toEqual({ ok: true, value: "0" });
  });

  it("reports a transport failure instead of returning zero", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNRESET"); });
    const result = await readNativeBalanceWei({ rpcUrl: "x", fetchImpl }, { owner: OWNER });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed address before making any request", async () => {
    const fetchImpl = rpc({});
    const result = await readNativeBalanceWei({ rpcUrl: "x", fetchImpl }, { owner: "0xbad" });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
