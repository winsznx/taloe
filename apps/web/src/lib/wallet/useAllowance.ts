"use client";

import { useEffect, useState } from "react";

import { readErc20Allowance } from "@taloe/router-core/chain-reader";

import type { BalanceReading } from "./useBalances";

const UNREAD: BalanceReading = { value: null, readable: false, loading: false };

interface FetchedState {
  readonly key: string | null;
  readonly value: BalanceReading;
}

/** Same shape, cleanup discipline, and key-derived-loading pattern as `useBalances` — see its comment. */
export function useAllowance(params: {
  rpcUrl: string;
  owner: string | null;
  tokenAddress: string;
  spender: string | null;
  refreshNonce?: number;
}): BalanceReading {
  const [fetched, setFetched] = useState<FetchedState>({ key: null, value: UNREAD });
  const { rpcUrl, owner, tokenAddress, spender, refreshNonce } = params;
  const key = owner && spender ? `${owner}:${spender}:${tokenAddress}:${rpcUrl}:${refreshNonce ?? 0}` : null;

  useEffect(() => {
    if (!key || !owner || !spender) return;
    let ignore = false;
    void readErc20Allowance({ rpcUrl }, { tokenAddress, owner, spender }).then((result) => {
      if (ignore) return;
      setFetched({ key, value: result.ok ? { value: result.value, readable: true, loading: false } : { value: null, readable: false, loading: false } });
    });
    return () => {
      ignore = true;
    };
  }, [key, owner, rpcUrl, tokenAddress, spender]);

  if (!owner || !spender) return UNREAD;
  return fetched.key !== key ? { ...fetched.value, loading: true } : fetched.value;
}
