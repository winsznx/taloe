"use client";

import { useCallback, useSyncExternalStore } from "react";

import { chainIdHexToDecimal, isBscChain } from "./chain";
import { connectWallet, disconnectWallet, getWalletServerSnapshot, getWalletSnapshot, requestSwitchToBsc, subscribeWallet } from "./store";

export interface UseWalletResult {
  readonly address: string | null;
  readonly chainIdDecimal: string | null;
  readonly connecting: boolean;
  readonly error: string | null;
  readonly onCorrectChain: boolean;
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly switchChain: () => void;
}

/** The wallet is an external system; its live state is read with `useSyncExternalStore`, not effect-driven local state. */
export function useWallet(requiredChainIdDecimal: string): UseWalletResult {
  const snapshot = useSyncExternalStore(subscribeWallet, getWalletSnapshot, getWalletServerSnapshot);

  const connect = useCallback(() => {
    void connectWallet();
  }, []);
  const switchChain = useCallback(() => {
    void requestSwitchToBsc();
  }, []);

  return {
    address: snapshot.address,
    chainIdDecimal: chainIdHexToDecimal(snapshot.chainIdHex ?? "") ?? snapshot.chainIdHex,
    connecting: snapshot.connecting,
    error: snapshot.error,
    onCorrectChain: isBscChain(snapshot.chainIdHex, requiredChainIdDecimal),
    connect,
    disconnect: disconnectWallet,
    switchChain,
  };
}
