"use client";

import { useEffect, useState } from "react";

import { readErc20Balance, readNativeBalanceWei } from "@taloe/router-core/chain-reader";

export interface BalanceReading {
  readonly value: string | null;
  readonly readable: boolean;
  readonly loading: boolean;
}

const UNREAD: BalanceReading = { value: null, readable: false, loading: false };

interface FetchedState {
  readonly key: string | null;
  readonly spend: BalanceReading;
  readonly gas: BalanceReading;
}

/**
 * Reads the spend-token and native balances for a connected address. Real
 * async I/O against an external RPC, so this is a `useEffect` with a
 * cleanup/ignore-stale-response guard (react-useeffect: data fetching needs
 * cleanup). `loading` is never set with a synchronous `setState` inside the
 * effect body — only the eventual `.then()` result is stored; "still
 * loading" is instead DERIVED by comparing the stored result's key against
 * the current one, so the effect only ever updates state from a callback.
 * `refreshNonce` lets a caller force a fresh read (e.g. after an approval)
 * via an event handler bumping the counter.
 */
export function useBalances(params: {
  rpcUrl: string;
  owner: string | null;
  spendTokenAddress: string;
  refreshNonce?: number;
}): { spend: BalanceReading; gas: BalanceReading } {
  const [fetched, setFetched] = useState<FetchedState>({ key: null, spend: UNREAD, gas: UNREAD });
  const { rpcUrl, owner, spendTokenAddress, refreshNonce } = params;
  const key = owner ? `${owner}:${rpcUrl}:${spendTokenAddress}:${refreshNonce ?? 0}` : null;

  useEffect(() => {
    if (!key || !owner) return;
    let ignore = false;

    void Promise.all([
      readErc20Balance({ rpcUrl }, { tokenAddress: spendTokenAddress, owner }),
      readNativeBalanceWei({ rpcUrl }, { owner }),
    ]).then(([spendResult, gasResult]) => {
      if (ignore) return;
      setFetched({
        key,
        spend: spendResult.ok ? { value: spendResult.value, readable: true, loading: false } : { value: null, readable: false, loading: false },
        gas: gasResult.ok ? { value: gasResult.value, readable: true, loading: false } : { value: null, readable: false, loading: false },
      });
    });

    return () => {
      ignore = true;
    };
  }, [key, owner, rpcUrl, spendTokenAddress]);

  if (!owner) return { spend: UNREAD, gas: UNREAD };
  const loading = fetched.key !== key;
  return {
    spend: loading ? { ...fetched.spend, loading: true } : fetched.spend,
    gas: loading ? { ...fetched.gas, loading: true } : fetched.gas,
  };
}
