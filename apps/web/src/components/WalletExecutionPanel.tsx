"use client";

/**
 * Live-mode wallet execution panel: connect, chain, balance/gas/allowance,
 * approval-if-required, mandatory re-quote, fresh simulation, sign, broadcast,
 * and independent balance-based verification — the full flow from route
 * selection to a confirmed, verified fill. Fixture mode never renders this
 * (see `/review`); its scripted demo stays exactly as it was.
 *
 * The human signs every transaction in their own wallet — this component
 * never holds a key and never broadcasts anything the human did not
 * explicitly approve in their wallet's own UI. "Confirm and execute" sends
 * the SAME `swapTransaction` `prepareExecution`/`resumeAfterApproval` already
 * built and simulated; nothing is rebuilt or substituted at sign time.
 */

import { useCallback, useState } from "react";

import { deriveWalletReadinessState, WALLET_READINESS_COPY } from "@taloe/execution";
import type { SignedLifecyclePhase, WalletFacts } from "@taloe/execution";
import type { ReadinessOutcome } from "@taloe/router-core";
import { readErc20Balance } from "@taloe/router-core/chain-reader";

import { checkExecutionReadiness, checkPostApprovalReadiness } from "@/server/actions/readiness";
import { useAllowance } from "@/lib/wallet/useAllowance";
import { useBalances } from "@/lib/wallet/useBalances";
import { useWallet } from "@/lib/wallet/useWallet";
import { sendTransaction, getInjectedProvider } from "@/lib/wallet/provider";
import { waitForReceipt } from "@/lib/wallet/receipt";

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

  /**
   * One human action — signing the approval in their own wallet. Everything
   * after that (waiting for it to mine, independently re-verifying the
   * allowance, the mandatory re-quote) is automatic: it is verification, not
   * a second broadcast, so there is nothing left for the human to decide
   * until a fresh swap is actually ready to sign.
   */
  const signApproval = (): void => {
    if (readiness?.kind !== "APPROVAL_REQUIRED" || !wallet.address) return;
    const walletAddress = wallet.address;
    const spender = readiness.spender;
    const requiredBaseUnits = readiness.requiredBaseUnits;
    setLifecycle({ kind: "APPROVAL_AWAITING_SIGNATURE" });
    setActionError(null);

    void (async () => {
      const hash = await sendTransaction(getInjectedProvider(), {
        from: walletAddress,
        to: readiness.approvalTransaction.to,
        value: readiness.approvalTransaction.value,
        data: readiness.approvalTransaction.data,
      });
      setLifecycle({ kind: "APPROVAL_BROADCAST_PENDING" });
      const receipt = await waitForReceipt(props.rpcUrl, hash);
      if (receipt.status !== "0x1") throw new Error(`Approval reverted on-chain (block ${receipt.blockNumber}). Check ${hash} on BscScan.`);

      setLifecycle({ kind: "APPROVAL_MINED_CONFIRMED" });
      setChecking(true);
      const result = await checkPostApprovalReadiness({
        q: props.q,
        amount: props.amount,
        maxDeviationBps: props.maxDeviationBps,
        routeId: props.routeId,
        walletAddress,
        spender,
        requiredBaseUnits,
      });
      setLifecycle(null);
      setRefreshNonce((n) => n + 1); // re-read allowance independently, never trust the action alone
      if (result.ok) setReadiness(result.readiness);
      else setActionError(result.error);
    })()
      .catch((error: unknown) => {
        setLifecycle(null);
        setActionError(error instanceof Error ? error.message : "The approval could not be signed or confirmed");
      })
      .finally(() => setChecking(false));
  };

  const [verifiedReceive, setVerifiedReceive] = useState<string | null>(null);

  /** Signs and broadcasts the ALREADY-SIMULATED swap, then verifies by reading the actual balance delta — never by trusting the receipt status alone. */
  const signAndExecuteSwap = useCallback((): void => {
    if (readiness?.kind !== "READY_TO_SIGN" || !wallet.address) return;
    const owner = wallet.address;
    const wrapperToken = readiness.route.wrapper.tokenContractAddress;
    setActionError(null);
    setLifecycle({ kind: "SWAP_BROADCAST_PENDING" });

    void (async () => {
      const before = await readErc20Balance({ rpcUrl: props.rpcUrl }, { tokenAddress: wrapperToken, owner });
      const hash = await sendTransaction(getInjectedProvider(), {
        from: owner,
        to: readiness.swapTransaction.to,
        value: readiness.swapTransaction.value,
        data: readiness.swapTransaction.data,
      });
      const receipt = await waitForReceipt(props.rpcUrl, hash);
      if (receipt.status !== "0x1") throw new Error(`Transaction reverted on-chain (block ${receipt.blockNumber}). Check ${hash} on BscScan.`);

      setLifecycle({ kind: "SWAP_CHAIN_PENDING_VERIFICATION" });
      const after = await readErc20Balance({ rpcUrl: props.rpcUrl }, { tokenAddress: wrapperToken, owner });
      const delta = before.ok && after.ok ? BigInt(after.value) - BigInt(before.value) : null;
      if (delta === null || delta <= 0n) {
        setLifecycle({ kind: "SWAP_VERIFICATION_FAILED" });
        setActionError(`Broadcast succeeded but the ${readiness.route.wrapper.tokenSymbol} balance did not increase. Check the transaction directly before trusting this fill.`);
        return;
      }
      setVerifiedReceive(delta.toString());
      setLifecycle({ kind: "SWAP_VERIFIED_SUCCESS" });
    })().catch((error: unknown) => {
      setLifecycle(null);
      setActionError(error instanceof Error ? error.message : "The swap could not be signed or confirmed");
    });
  }, [readiness, wallet.address, props.rpcUrl]);

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
      ) : state === "REQUOTE_REQUIRED" || state === "SIMULATION_FAILED" || state === "VERIFICATION_FAILED" ? (
        <button className="button" type="button" onClick={runReadinessCheck} disabled={checking}>
          {checking ? "Checking…" : "Try again"}
        </button>
      ) : state === "READY_TO_SIGN" ? (
        <button className="button" type="button" onClick={signAndExecuteSwap}>
          Confirm and execute
        </button>
      ) : state === "VERIFIED_SUCCESS" && readiness?.kind === "READY_TO_SIGN" ? (
        <p>
          Done. Received ~{verifiedReceive} {readiness.route.wrapper.tokenSymbol} (base units), verified on-chain —
          not just a receipt status.
        </p>
      ) : null}

      {wallet.address ? (
        <p className="field-hint mono" style={{ marginTop: "var(--space-3)" }}>
          {wallet.address}{" "}
          <button
            type="button"
            onClick={wallet.disconnect}
            style={{ background: "none", border: "none", padding: 0, textDecoration: "underline", cursor: "pointer", font: "inherit", color: "inherit" }}
          >
            disconnect
          </button>
        </p>
      ) : null}
      {spender && allowance.readable ? (
        <p className="field-hint">Current on-chain allowance for this route: {allowance.value}</p>
      ) : null}
      {(wallet.error ?? actionError) ? <p className="field-hint" role="alert">{wallet.error ?? actionError}</p> : null}
    </div>
  );
}
