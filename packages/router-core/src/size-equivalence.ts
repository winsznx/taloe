/**
 * Are the routes that cleared every gate materially the same at this size?
 *
 * Small tickets usually are: the per-share gap between wrappers is a few basis
 * points, which is below quote noise. When that is the case the product must
 * say so instead of dressing the top-ranked route up as a winner.
 */

import type { RouteEvaluation } from "@taloe/shared";
import { div, fromDecimalString } from "@taloe/shared";

/** Gap at or below this is inside observed quote noise (first sweep: median gap 7.1 bps). */
export const MATERIAL_EXPOSURE_GAP_BPS = 25;

export type SizeEquivalence =
  | { readonly kind: "SINGLE_ROUTE" }
  | { readonly kind: "NOT_COMPARABLE" }
  | { readonly kind: "MATERIALLY_EQUIVALENT"; readonly gapBps: number }
  | { readonly kind: "MATERIALLY_DIFFERENT"; readonly gapBps: number };

export function assessSizeEquivalence(evaluations: readonly RouteEvaluation[]): SizeEquivalence {
  if (evaluations.length < 2) return { kind: "SINGLE_ROUTE" };
  const amounts: bigint[] = [];
  for (const evaluation of evaluations) {
    if (!evaluation.comparable || evaluation.underlyingEquivalentAmount === null) return { kind: "NOT_COMPARABLE" };
    try {
      amounts.push(fromDecimalString(evaluation.underlyingEquivalentAmount));
    } catch {
      return { kind: "NOT_COMPARABLE" };
    }
  }
  const max = amounts.reduce((a, b) => (b > a ? b : a));
  const min = amounts.reduce((a, b) => (b < a ? b : a));
  if (min <= 0n) return { kind: "NOT_COMPARABLE" };
  // (max - min) / min in bps, computed with the shared fixed-point helpers to avoid float drift.
  const gapBps = Math.round(Number(div(max - min, min)) / 1e18 * 10_000);
  return gapBps <= MATERIAL_EXPOSURE_GAP_BPS
    ? { kind: "MATERIALLY_EQUIVALENT", gapBps }
    : { kind: "MATERIALLY_DIFFERENT", gapBps };
}
