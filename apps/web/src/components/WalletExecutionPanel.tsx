"use client";

/**
 * Live-mode wallet execution panel: connect, chain, balance/gas/allowance,
 * approval-if-required, mandatory re-quote, then a fresh simulation — the
 * flow from Taloe product-lock phase section 3. Fixture mode never renders
 * this (see `/review`); its scripted demo stays exactly as it was.
 *
 * This panel PREPARES a swap for signing. It does not broadcast the swap
 * itself — that "Confirm and execute" step stays gated behind
 * READY_TO_SIGN and is unchanged from the existing (fixture-only) flow,
 * because executing a live tokenized-stock purchase needs separate, explicit
 * human authorization (Taloe product-lock phase section 5).
 */

import { useState } from "react";

import { deriveWalletReadinessState, WALLET_READINESS_COPY } from "@taloe/execution";
import type { SignedLifecyclePhase, WalletFacts } from "@taloe/execution";
import type { ReadinessOutcome } from "@taloe/router-core";

import { checkExecutionReadiness, checkPostApprovalReadiness } from "@/server/actions/readiness";
import { useAllowance } from "@/lib/wallet/useAllowance";
import { useBalances } from "@/lib/wallet/useBalances";
import { useWallet } from "@/lib/wallet/useWallet";
import { sendTransaction, getInjectedProvider } from "@/lib/wallet/provider";

/** Rough estimate, not an exact gas quote — the wallet computes the real cost at sign time. */
const MIN_GAS_BALANCE_WEI = 1_000_000_000_000_000n; // 0.001 BNB

export interface WalletExecutionPanelProps {
  readonly requiredChainId: string;
  readonly rpcUrl: string;
  readonly spendTokenAddress: string;
  readonly requiredSpendBaseUnits: string;
  readonly q: string;
  readonly amount: string;
  readonly maxDeviationBps: number;
  readonly routeId: string;
  /** Known once a market quote exists, before any wallet check; null only if the quote itself carried none. */
  readonly knownApproveTarget: string | null;
}

export function WalletExecutionPanel(props: WalletExecutionPanelProps): React.ReactNode {
  const wallet = useWallet(props.requiredChainId);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [readiness, setReadiness] = useState<ReadinessOutcome | null>(null);
  const [lifecycle, setLifecycle] = useState<SignedLifecyclePhase | null>(null);
  const [checking, setChecking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const spender = readiness?.kind === "APPROVAL_REQUIRED" ? readiness.spender : props.knownApproveTarget;
  const { spend, gas } = useBalances({
    rpcUrl: props.rpcUrl,
    owner: wallet.address,
    spendTokenAddress: props.spendTokenAddress,
    refreshNonce,
  });
  const allowance = useAllowance({
    rpcUrl: props.rpcUrl,
    owner: wallet.address,
    tokenAddress: props.spendTokenAddress,
    spender,
    refreshNonce,
  });

  const facts: WalletFacts = {
    connectedAddress: wallet.address,
    connectedChainId: wallet.chainIdDecimal,
    requiredChainId: props.requiredChainId,
    spendBalanceBaseUnits: spend.value,
    gasBalanceWei: gas.value,
    requiredSpendBaseUnits: props.requiredSpendBaseUnits,
    spendBalanceReadable: spend.readable,
    gasBalanceReadable: gas.readable,
    minGasBalanceWei: MIN_GAS_BALANCE_WEI,
  };
  const state = deriveWalletReadinessState({ wallet: facts, readiness, lifecycle });

  const runReadinessCheck = (): void => {
    if (!wallet.address) return;
    setActionError(null);
    setChecking(true);
    void checkExecutionReadiness({
      q: props.q,
      amount: props.amount,
      maxDeviationBps: props.maxDeviationBps,
      routeId: props.routeId,
      walletAddress: wallet.address,
    })
      .then((result) => {
        if (result.ok) setReadiness(result.readiness);
        else setActionError(result.error);
      })
      .finally(() => setChecking(false));
  };

  const signApproval = (): void => {
    if (readiness?.kind !== "APPROVAL_REQUIRED" || !wallet.address) return;
    setLifecycle({ kind: "APPROVAL_AWAITING_SIGNATURE" });
    setActionError(null);
    void sendTransaction(getInjectedProvider(), {
      from: wallet.address,
      to: readiness.approvalTransaction.to,
      value: readiness.approvalTransaction.value,
      data: readiness.approvalTransaction.data,
    })
      .then(() => {
        setLifecycle({ kind: "APPROVAL_BROADCAST_PENDING" });
      })
      .catch((error: unknown) => {
        setLifecycle(null);
        setActionError(error instanceof Error ? error.message : "The wallet rejected or failed the approval");
      });
  };

  /** Human-triggered: "I've confirmed the approval in my wallet" — never polled automatically. */
  const confirmApprovalAndRequote = (): void => {
    if (readiness?.kind !== "APPROVAL_REQUIRED" || !wallet.address) return;
    setLifecycle({ kind: "APPROVAL_MINED_CONFIRMED" });
    setChecking(true);
    setActionError(null);
    void checkPostApprovalReadiness({
      q: props.q,
      amount: props.amount,
      maxDeviationBps: props.maxDeviationBps,
      routeId: props.routeId,
      walletAddress: wallet.address,
      spender: readiness.spender,
      requiredBaseUnits: readiness.requiredBaseUnits,
    })
      .then((result) => {
        setLifecycle(null);
        setRefreshNonce((n) => n + 1); // re-read allowance independently, never trust the action alone
        if (result.ok) setReadiness(result.readiness);
        else setActionError(result.error);
      })
      .finally(() => setChecking(false));
  };

  return (
    <div className="card" style={{ marginTop: "var(--space-5)" }}>
      <p className="field-label">Wallet</p>
      <p style={{ marginBottom: "var(--space-3)" }}>{WALLET_READINESS_COPY[state]}</p>

      {state === "WALLET_DISCONNECTED" ? (
        <button className="button" type="button" onClick={wallet.connect} disabled={wallet.connecting}>
          {wallet.connecting ? "Connecting…" : "Connect wallet"}
        </button>
      ) : state === "WRONG_CHAIN" ? (
        <button className="button" type="button" onClick={wallet.switchChain}>
          Switch to BNB Smart Chain
        </button>
      ) : state === "READY_FOR_SIMULATION" && readiness === null ? (
        <button className="button" type="button" onClick={runReadinessCheck} disabled={checking}>
          {checking ? "Checking…" : "Check execution readiness"}
        </button>
      ) : state === "APPROVAL_REQUIRED" ? (
        <button className="button" type="button" onClick={signApproval}>
          Approve in wallet
        </button>
      ) : state === "APPROVAL_PENDING" ? (
        <button className="button" type="button" onClick={confirmApprovalAndRequote} disabled={checking}>
          {checking ? "Verifying…" : "I've approved — verify and refresh price"}
        </button>
      ) : state === "REQUOTE_REQUIRED" || state === "SIMULATION_FAILED" ? (
        <button className="button" type="button" onClick={runReadinessCheck} disabled={checking}>
          {checking ? "Checking…" : "Try again"}
        </button>
      ) : null}

      {wallet.address ? (
        <p className="field-hint mono" style={{ marginTop: "var(--space-3)" }}>
          {wallet.address}
        </p>
      ) : null}
      {spender && allowance.readable ? (
        <p className="field-hint">Current on-chain allowance for this route: {allowance.value}</p>
      ) : null}
      {(wallet.error ?? actionError) ? <p className="field-hint" role="alert">{wallet.error ?? actionError}</p> : null}
    </div>
  );
}
