"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { fetchActivity } from "@/server/actions/activity";
import { useWallet } from "@/lib/wallet/useWallet";
import { TokenIcon } from "@/components/TokenIcon";

interface Execution {
  readonly id: string;
  readonly underlyingTicker: string;
  readonly wrapperSymbol: string;
  readonly platformId: string | null;
  readonly spendToken: string;
  readonly spendAmountBaseUnits: string;
  readonly executionMode: string;
  readonly swapTxHash: string | null;
  readonly verifiedSuccess: boolean;
  readonly createdAt: string;
}

/**
 * Real-data activity, scoped to whichever wallet is connected. A fetch
 * triggered by a real external state change (wallet connecting) belongs in
 * an effect with cleanup, not an event handler — there is no user action to
 * attach it to.
 */
export function ActivityList({ requiredChainId }: { requiredChainId: string }): ReactNode {
  const wallet = useWallet(requiredChainId);
  type Fetched =
    | { kind: "not_configured" }
    | { kind: "error"; message: string }
    | { kind: "loaded"; executions: readonly Execution[] };
  const [fetched, setFetched] = useState<{ key: string | null; result: Fetched | null }>({ key: null, result: null });

  useEffect(() => {
    const address = wallet.address;
    if (!address) return;
    let ignore = false;
    void fetchActivity(address).then((result) => {
      if (ignore) return;
      const outcome: Fetched = !result.configured
        ? { kind: "not_configured" }
        : !result.ok
          ? { kind: "error", message: result.error }
          : { kind: "loaded", executions: result.executions };
      setFetched({ key: address, result: outcome });
    });
    return () => {
      ignore = true;
    };
  }, [wallet.address]);

  const loading = wallet.address !== null && fetched.key !== wallet.address;
  const state: { kind: "idle" } | { kind: "loading" } | Fetched = !wallet.address
    ? { kind: "idle" }
    : loading
      ? { kind: "loading" }
      : (fetched.result ?? { kind: "loading" });

  if (!wallet.address) {
    return (
      <div className="card">
        <p>Connect a wallet to see its history.</p>
        <button className="button" type="button" onClick={wallet.connect} style={{ marginTop: "var(--space-4)" }} disabled={wallet.connecting}>
          {wallet.connecting ? "Connecting…" : "Connect wallet"}
        </button>
      </div>
    );
  }

  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <div className="card">
        <p className="field-hint">Loading activity for {wallet.address}…</p>
      </div>
    );
  }

  if (state.kind === "not_configured") {
    return (
      <div className="card">
        <p>Activity history storage is not configured on this deployment.</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="card" role="alert">
        <p>Could not load activity.</p>
        <p className="field-hint">{state.message}</p>
      </div>
    );
  }

  if (state.executions.length === 0) {
    return (
      <div className="card">
        <p>No executions yet for {wallet.address}.</p>
      </div>
    );
  }

  return (
    <ul className="activity-list">
      {state.executions.map((execution) => (
        <li key={execution.id} className="card activity-row">
          <TokenIcon underlyingTicker={execution.underlyingTicker} symbol={execution.wrapperSymbol} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="field-label" style={{ marginBottom: "var(--space-1)" }}>
              {execution.wrapperSymbol}
              {execution.platformId ? ` · ${execution.platformId}` : ""}
              <span className="field-hint" style={{ marginLeft: "var(--space-2)" }}>
                {new Date(execution.createdAt).toLocaleString()}
              </span>
            </p>
            <p className="field-hint">
              {execution.executionMode} · {execution.verifiedSuccess ? "Verified" : "Unverified"}
              {execution.swapTxHash ? (
                <>
                  {" "}
                  ·{" "}
                  <a href={`https://bscscan.com/tx/${execution.swapTxHash}`} className="mono">
                    {execution.swapTxHash.slice(0, 10)}…{execution.swapTxHash.slice(-6)}
                  </a>
                </>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
