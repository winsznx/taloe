"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the current route by re-fetching the server component tree.
 *
 * Used only on pages whose content is a function of elapsed time (the
 * execution progress page). `intervalMs` is a prop, not a magic number
 * buried in an effect, so the caller can tune it per scenario. Stops
 * scheduling entirely once `stop` is true — no more timers, no more
 * refreshes — so a finished execution does not keep polling forever.
 */
export function AutoRefresh({ intervalMs, stop }: { intervalMs: number; stop: boolean }): null {
  const router = useRouter();

  useEffect(() => {
    if (stop) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, stop, router]);

  return null;
}
