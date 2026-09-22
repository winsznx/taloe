# Split-route experiment: research only

No split execution is built. This is an analysis of whether dividing one intent across two wrappers (e.g. half on Ondo, half on bStock) could materially increase safe executable capacity versus the best single wrapper, using the capacity campaign's own measured brackets.

## Method

For each underlying and each deviation threshold, take the proven-safe capacity of each wrapper (`SafeExecutionCapacity.safeUpToUsd` from `deriveSafeCapacity`, the largest ticket actually quoted inside the constraint). A two-leg split's capacity is lower-bounded by `safeA + safeB`: each leg, sized within its own proven-safe bracket, is independently proven to clear the same per-share deviation limit. This is a lower bound, not a measurement of the split executing as one settlement — no split order was ever quoted.

A split is only evaluated where the best single wrapper actually **binds** (breached within the tested range). Where the best single wrapper never breached across the whole tested range up to $25,000, there is no capacity problem for a split to solve, so that underlying is excluded from the "material gain" count.

Material gain threshold: `(safeA + safeB) / bestSingle >= 1.5x`, chosen because anything less is inside the noise of a single extra ticket point on the scan grid.

## Costs not counted in the naive lower bound (why the estimate is optimistic)

- **Combined quoted output** — the two legs are two independent quotes; nothing here confirms both simultaneously honor the union price, and both legs still individually respect the same reference at the moment they were quoted seconds apart, not at one instant.
- **Extra transaction and gas burden** — a split is two approvals and two swaps (or one approval, two swaps, if both route through the same spender) instead of one. Gas is not zero and is not modeled here.
- **Multiple wrapper holdings** — the user ends up holding two different wrapper tokens for one intended equity position, which is a UX and normalization cost the single-wrapper flow does not have (two cost bases, two symbols on a receipt, potential confusion about which one to sell first).
- **Separate approvals** — if the two wrappers use different spenders (unverified assumption; both use LiquidMesh in this campaign, but that could differ per pair), the wallet must approve twice, and TALOE's own `resumeAfterApproval` re-quotes after every approval, so a two-leg split roughly doubles the number of "approve → wait → re-quote → simulate" rounds.
- **Practical quote lifetime** — quotes live about 30 seconds; sequencing two legs (quote A, quote B, possibly re-quote either) narrows the window in which both legs are still fresh, especially if either needs an approval first.

None of these costs are netted against the naive `safeA + safeB` capacity gain below; the reported number is therefore a ceiling, not the achievable split capacity.

## Result

See `internal/evidence/runtime/capacity-report-afterhours-*.json`, field `splitExperiment`. Verdict is computed at the 150 bps threshold using this rule:

- **LOAD_BEARING** if at least 5 underlyings have a binding best-single-wrapper AND at least 50% of those show a naive gain of 1.5x or more.
- **NOT_USEFUL** if fewer than 10% show that gain.
- **MARGINAL** otherwise.

The verdict and supporting numbers are reported verbatim in `internal/evidence/CAPACITY_VALIDATION_REPORT.md`. Implementation is only recommended if the measured advantage, net of the uncounted costs above, is still substantial — given those costs are all real and unmeasured, a MARGINAL or lower verdict here means no.
