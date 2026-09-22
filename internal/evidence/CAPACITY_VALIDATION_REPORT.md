# Capacity Validation Report

**Session:** afterhours (2026-09-22 00:22-00:42 UTC, Mon 20:22 ET onward — after-hours/overnight; see `SESSION_CAMPAIGN.md`, still the only session observed).
**Universe:** the 40 live Ondo/bStock overlapping underlyings from the first live validation.
**Wallet:** public address, no key. **No signing, no approval, no broadcast.**
**Source artifacts:** `internal/evidence/runtime/capacity-afterhours-2026-09-22T00-22-03-051Z.json` (raw), `capacity-report-afterhours-2026-09-22T00-42-36-724Z.json` (derived).

## VERDICT: **REVISE**

The size-aware thesis holds and is now measured across the full universe, not one ticker. At small tickets (<=$100) 95% of wrapper pairs are materially equivalent (within 25 bps); Taloe correctly does not manufacture a winner there. At larger tickets a minority of underlyings (NVDA the clearest, plus a handful more once liquidity gaps and closed markets are excluded) diverge enough that a first-result baseline would breach the user's limit and Taloe avoids it. The product claim from Revision 1 — size-aware safety, not small-size price — is confirmed, not merely asserted. It is not ready for a live fill for the same allowance/wallet reasons as before.

## PRD revision summary

`PRD_REVISION_1.md`: thesis moved from "best price now" to "which representation can execute this size within your limit, or refuse." Pipeline split into MARKET DECISION (no simulation) and EXECUTION READINESS (`APPROVAL_REQUIRED` as a first-class state, allowance read on-chain, approval simulated and spender-checked, mandatory re-quote after approval, fresh-quote-only swap simulation). Full detail: `PRD_REVISION_1.md`.

## Number of overlapping underlyings tested

40 (all from the first live sweep). 36 had a usable capacity bracket for both wrappers at every threshold; 4 (AXTI, COIN, DRAM, SOXL) are `INCOMPARABLE` (below).

## Safe-capacity distribution (at 150 bps)

| Wrapper | >= $25,000 tested, no breach | Bounded below $25,000 | Unknown |
|---|---|---|---|
| Ondo | 34/40 | 2/40 (NVDA: $2,000; SPCX: bounded at the last anchor) | 4/40 |
| bStock | 40/40 | 0/40 | 0/40 |

Full histogram: `capacity-report-*.json`, field `capacityDistribution`. Reading it honestly: within the $5.1-$25,000 range this campaign tested, most wrappers on both platforms never breach 150 bps at all. The scan does not prove they are safe above $25,000 — it proves nothing failed inside the tested range.

## First-result comparison

| Threshold | First-result breaches (of 360 ticker x anchor cells with usable evidence) | Breach avoided by Taloe |
|---|---|---|
| 50 bps | 5 | 5 |
| 100 bps | 5 | 5 |
| 150 bps | 4 | 4 |

`FIRST_RESULT` always picks Ondo (the platform returned first by search). Every one of its breaches in this campaign was Ondo's; bStock breached zero cells at any threshold. This is the same asymmetry the first live report found on NVDA alone, now confirmed as a pattern rather than an outlier: Ondo's tighter observed liquidity is the recurring failure mode, not a one-ticker fluke.

## Fixed-issuer comparison

`FIXED_ONDO` inherits every one of the 4-5 breaches above. `FIXED_BSTOCK` inherits zero breaches in this campaign, but would have inherited a hypothetical bStock-side breach had one occurred — none did in the tested range.

## Taloe comparison (TALOE_BEST_SINGLE_WRAPPER)

Taloe (the per-underlying wrapper whose capacity bracket is largest) matches bStock in every one of the 4 underlyings where the two platforms diverge in this campaign (NVDA, RKLB, SPCX at 50 bps; NVDA and SPCX at 150 bps). It never underperforms `FIXED_BSTOCK` and always outperforms `FIXED_ONDO` where they differ.

## Wrapper-switch frequency

At 150 bps, Taloe's capacity-implied choice differs from `FIRST_RESULT` (Ondo) in 2 of 36 comparable underlyings (NVDA, SPCX); at 50 bps, 3 of 36 (adds RKLB). `perThreshold` in the report artifact has the exact counts per threshold.

## Threshold-breach frequency

See the table above. Breach counts fall as the threshold loosens (5 -> 5 -> 4 from 50 to 150 bps), as expected — a looser constraint is breached less often.

## Largest observed divergences (same ticket, both wrappers quoted)

| Ticker | Ticket | Gap (bps) | Cheaper |
|---|---|---|---|
| SPCX | $25,000 | 29,612 | bstock |
| NVDA | $5,000 | 6,442 | bstock |
| NVDA | $2,000 | 120 | bstock |
| NVDA | $1,000 | 45 | bstock |
| NOK | $5.1 | 43 | bstock |

Full list (top 12): `capacity-report-*.json`, field `largestDivergences`. The NOK small-ticket entries (43, 42, 39 bps at $5.1/$25/$100) are the only small-ticket gaps that exceed the 25 bps equivalence bar used below; they are inside quote noise territory but on the high side of it, and are not treated as a claim.

## Small-size no-difference rate

At tickets <= $100: **106 of 111 comparable cells (95.5%) are materially equivalent** (per-share gap <= 25 bps). Median gap 4.2 bps, p90 17.5 bps, max 43.3 bps (NOK). This both confirms and sharpens the first live report's finding (median 7.1 bps on a $25-only sweep): across three ticket sizes and 40 underlyings, near-equivalence at small size is the dominant case, not the exception. The product must not claim savings here; `RouteSummary`/`ActResult` on `/route` now say so explicitly when the gap is inside this bound.

## Split-route experiment result

**NOT_USEFUL** at every threshold tested (50/100/150 bps). Zero of the underlyings where one wrapper actually breached had a "best single wrapper" that itself remained capacity-constrained within the tested range — Taloe's own wrapper selection already resolves every capacity problem this campaign found, so there is nothing left for a split to fix. The naive `safeA + safeB` lower bound (ignoring the real costs of two approvals, two holdings and two quote windows — see `SPLIT_ROUTE_RESEARCH.md`) shows a positive combined figure in the raw numbers, but it never applies to a case where it would matter. Full method and the uncounted costs: `SPLIT_ROUTE_RESEARCH.md`. Recommendation: do not build split execution.

## Call-count/latency improvement

Measured on 2 live tickers (`readiness-cost-2026-09-22T00-21-18-561Z.json`): with exactly 2 quoted wrapper candidates per ticker, the before/after sponsor-request counts were roughly equal (25 vs 25, 24 vs 27). The saving from moving simulation off the ranking path is proportional to (candidates rejected - 0); with only 2 issuers live today it rarely shows up. It becomes material once more execution modes or issuers are quoted per underlying. Recorded honestly, not inflated (`DX-012`).

## Session evidence status

**UNTESTED beyond after-hours.** This entire campaign, like the first live validation, ran outside US regular hours. Regular-hours and weekend re-runs are scheduled but not yet executed; see `SESSION_CAMPAIGN.md` for the exact commands. No session conclusion is drawn.

## New DX findings

- DX-011: no Binance endpoint reports ERC-20 allowance; Taloe reads it directly via `eth_call`.
- DX-012: the simulation-relocation saving is candidate-count-dependent and was small on the 2-platform universe measured.

## New sponsor findings

- F-022: allowance must be read off-chain-adjacent (direct RPC), not from any Binance endpoint.
- F-023: the approval-transaction response's spender is inside opaque calldata; Taloe cross-checks it against the simulated `allowanceChanges[].spender` rather than trusting a label.
- Confirms F-016 (`priceImpactPercent` unreliable at size) with two more live observations: NVDA-class routes reported 0.40% and 0.74% sponsor impact while Taloe's own recomputed deviation was 6,440 and 29,635 bps respectively at $5,000/$25,000 tickets.
- New, minor: `40374 "Insufficient liquidity for a quote"` observed on AXTI/COIN/DRAM's Ondo wrapper at $25,000 — a distinct business code from the deviation gate, correctly treated as `UNKNOWN`/incomparable rather than a breach (a missing quote is not evidence of a breach).

## Claims upgraded

- Wrapper divergence at size is a cross-underlying pattern (2-3 of 36 comparable underlyings at each threshold in this run), not an NVDA-only artifact — `EMPIRICALLY_MEASURED`.
- Small-size near-equivalence, previously measured on one $25 sweep, now `EMPIRICALLY_MEASURED` across three ticket sizes and 40 underlyings (95.5% equivalence rate).
- `SafeExecutionCapacity` as an evidence primitive is `API_VERIFIED` against live data, not just the fixture-level unit tests.
- Split-route is `NOT_USEFUL` given current evidence — a negative claim, but a measured one.

## Claims disproved

- None newly disproved this round; F-016 (`priceImpactPercent` unreliable) is further confirmed rather than newly disproved.

## Revised demo headline

"Taloe checked $NVDA on two wrappers. At $25 they're the same price. At $5,000 one of them silently loses over half your exposure — Taloe found that and picked the other one automatically." This is honest at both ends: small tickets get an equivalence statement, not a fabricated win; large tickets get the one underlying (NVDA, backed now by a second, RKLB/SPCX-adjacent pattern) where the safety mechanism visibly matters.

## Ready for first live fill: **NO**

Unchanged from the first live report and for the same reasons: a fresh wallet still needs an approval before any swap can pass simulation (now modeled correctly as `APPROVAL_REQUIRED`, not a refusal, but still unexecuted — nothing was signed or broadcast in this campaign), there is no wallet adapter in the app yet, and no funded user wallet exists.

## CONCLUSION: **REVISE**
