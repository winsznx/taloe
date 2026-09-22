# Static-Baseline Falsification Report

**Question:** does live market structure collapse Taloe's routing decision to "always choose bStock"?
**Session:** afterhours only (2026-09-21 20:22-21:50 ET / 2026-09-22 00:22-01:50 UTC). Regular-hours and weekend runs are **pending** — see "Session evidence status".
**Universe:** the same 40 live Ondo/bStock overlapping underlyings. **Sizes:** $5.10 to $100,000 (12-point adaptive sweep: 5.1, 25, 100, 250, 500, 1,000, 2,000, 5,000, 10,000, 25,000, 50,000, 100,000).
**Wallet:** public address, no key. No signing, no approval, no broadcast, no trade.
**Source artifacts:** `internal/evidence/runtime/capacity-afterhours-2026-09-22T00-50-38-325Z.json` (raw, extended), `capacity-report-afterhours-2026-09-22T01-14-08-334Z.json` (derived). The earlier $25,000-capped run (`capacity-afterhours-2026-09-22T00-22-03-051Z.json`) is preserved.

## Checkpoint commit

`ebd5394fa1d2623fb21287469e8cd590621807dc` — "feat: validate Taloe capacity-aware routing". 205 tests, lint/typecheck/build clean, verified before commit to exclude `.env`, credentials and gitignored runtime evidence.

## WHY NOT ALWAYS USE BSTOCK?

Because bStock's failure mode at extreme size is a **silent bad-price fill**, not a refusal. In 3 of 40 underlyings (AVGO, COIN, DRAM), at $100,000, bStock returned a fully executable quote priced 170 to 5,168 bps away from reference (roughly 1.7% to 52% worse), while Ondo either stayed inside the limit or correctly declined to quote at all (`40374 "Insufficient liquidity"`). A router that always used bStock would have silently offered the user that fill; Taloe's own recomputed deviation catches it, and the sponsor's `priceImpactPercent` does not (it read 0.09-0.27% on those same quotes — F-024). Separately, Ondo is the one that fails to quote more often overall (15 of 480 wrapper-ticket probes vs bStock's 0), but an honest refusal is not the dangerous case — a wrong-but-executable quote is. bStock is the better **default**, not a **substitute** for checking.

## Sessions actually observed

Afterhours only, twice (once capped at $25,000, once extended to $100,000 with availability/buildability evidence). Regular-hours and weekend are not yet observed; see below.

## Underlyings tested

40. 24-36 had usable evidence at every threshold depending on how far the sweep got before a liquidity failure; 16 are `INCOMPARABLE` at 150 bps (up from 4 at the $25k cap) because Ondo hit `40374` before both sides could be measured at the same large ticket. 3 of those 16 (CRWV, GLW, RKLB) show both wrappers eventually failing — Ondo around $50,000, bStock around $100,000 — so bStock lasts one size tier longer even where both are ultimately liquidity-bound.

## Sizes tested

$5.10 to $100,000, 12 points, adaptive (stops at the first breach or failure; a name that stayed clean through $10,000 was escalated to $25k/$50k/$100k).

## Routing direction matrix (afterhours)

| Threshold | ONDO_BETTER | BSTOCK_BETTER | EITHER (materially equivalent) | ALL_REFUSE | UNKNOWN (insufficient evidence) |
|---|---|---|---|---|---|
| 50 bps | 5 | 2 | 17 | 0 | 16 |
| 100 bps | 3 | 3 | 18 | 0 | 16 |
| 150 bps | **3** (AVGO, COIN, DRAM) | **3** (MSFT, NVDA, SPCX) | 18 | 0 | 16 |

No literal `ALL_REFUSE` case (both wrappers breaching even at the smallest $5.10 ticket) was observed. Regular-hours and weekend not yet run.

MSFT is genuinely threshold-dependent: Ondo-better at 50 bps (bStock breaches its own reference by 51-90 bps even at the smallest ticket — a small persistent offset, not a size effect), bStock-better at 100/150 bps (Ondo breaches badly only at $100,000: 3,376 bps). This is a real example of the ranking flipping direction for one underlying depending only on the constraint chosen, not on ticket size.

## Safe-capacity comparison (150 bps)

| Wrapper | Median safe-up-to | p10 safe-up-to (worst-case underlying) |
|---|---|---|
| Ondo | $100,000 | $1,000 |
| bStock | $100,000 | $50,000 |

bStock's worst case is far better than Ondo's worst case (p10 $50,000 vs $1,000) — this is the statistical basis for "bStock by default." It is not universal: the 3 ONDO_BETTER cases sit inside this same distribution.

## ALWAYS_USE_BSTOCK performance

Evaluated against Taloe (best-of-two by capacity bracket) at every threshold:

| Threshold | Taloe meaningfully better than ALWAYS_USE_BSTOCK | Cases |
|---|---|---|
| 50 bps | 5/40 (12.5%) | AVGO, COIN, DRAM, HOOD, MSFT |
| 100 bps | 3/40 (7.5%) | AVGO, COIN, DRAM |
| 150 bps | 3/40 (7.5%) | AVGO, COIN, DRAM |

Every one of these is a boundary case: the divergence is only proven at the single largest tested ticket ($100,000), not with margin below it (`factorLowerBound: 1` for all three at 150 bps, vs 10-50x margin for the NVDA/SPCX bStock-better cases at smaller sizes). This is real, not manufactured, but it is thin: it took escalating the campaign to $100,000 to find it, and the campaign brief explicitly notes $100k is a research point, not the intended user size.

## Taloe performance

Taloe avoided every first-result (always-Ondo) breach that was avoidable: 13/13 at 100 and 150 bps, 13/14 at 50 bps (one underlying breached on both platforms simultaneously, so no route existed to switch to). It never underperformed ALWAYS_USE_BSTOCK in this session.

## Cases where Ondo beats bStock

**AVGO, COIN, DRAM** at $100,000 (the only three, all price-divergence, all at the largest tested ticket): bStock quotes but at 170-5,168 bps off reference; Ondo stays inside 5-14 bps. Additionally, in raw price terms (not threshold-crossing, so not counted above): **HOOD** at $50,000/$100,000 (Ondo cheaper by 38/44 bps, both sides still inside 150 bps) and **RKLB** at $25,000 (35 bps, both inside). These are genuine but sub-threshold; recorded, not overstated.

## Cases where bStock beats Ondo

**NVDA** (Ondo breaches at $2,000, +157 bps; bStock clean through $100,000 — factor >=50x), **SPCX** (Ondo breaches at $10,000; bStock clean through $100,000 — factor >=10x), **MSFT** at 100/150 bps only (Ondo breaches only at $100,000). These are the deep, high-margin cases; AVGO/COIN/DRAM's reverse is comparatively shallow.

## Availability divergences

| | Ondo | bStock |
|---|---|---|
| `QUOTE_AVAILABLE` | 369 | 437 |
| `BUILDABLE` (confirmed with a real unsigned build call) | 36 | 40 |
| `OTHER_SPONSOR_ERROR` (`40374` insufficient liquidity, x1 unclassified) | 15 | 3 |
| `PAUSED` | 1 (SOXL, `reasonCode: UNSUPPORTED`) | 0 |

Zero cases of "bStock unavailable while Ondo available" were found (`bidirectionalEvidence.bstockBad` contains only `DEVIATION` entries, never `AVAILABILITY`). 18 cases of the reverse were found. Availability, on its own, never argues for Ondo.

## All-refuse cases

None where both wrappers breached even the loosest tested threshold at the smallest ticket. Three underlyings (CRWV, GLW, RKLB) have both wrappers eventually fail to quote at all as size increases (Ondo around $50,000, bStock around $100,000) — a liquidity ceiling on both sides for thin names, not a threshold breach.

## Small-size equivalence

97.2% of cells (105/108) at <=$100 are materially equivalent (within 25 bps); median gap 4.9 bps, p90 20.5 bps, max 63.9 bps. Consistent with and slightly stronger than the first capacity campaign's 95.5%.

## High-size findings

- Ondo's insufficient-liquidity ceiling (`40374`) appears far more often than bStock's at $50,000-$100,000 (15 vs 3 wrapper-ticket probes).
- Where bStock's own depth runs out at $100,000 (3 underlyings), it does not refuse — it quotes a bad price. This is the report's central finding.
- Split-route execution remains `NOT_USEFUL` at the extended range: 0 of 24 evaluable underlyings have a binding single-wrapper capacity limit for a split to relieve.

## New DX findings

None beyond the sponsor findings below; the harness itself (extended anchors, availability classification, one real build call per wrapper) ran without incident.

## New sponsor findings

- F-024: `priceImpactPercent` is unreliable on bStock too (0.09-0.27% reported vs 170-5,168 bps measured), not an Ondo-specific defect.
- F-025: Ondo's large-size failure mode is a clean refusal (`40374`); bStock's is an executable quote at a bad price. The asymmetry is the direct answer to this campaign's question.

## Claims upgraded

- ALWAYS_USE_BSTOCK as a universal rule: tested and found false, not merely assumed false.
- bStock's average depth advantage over Ondo: confirmed at a larger sample (availability + p10 capacity) than the first campaign showed.
- Split-route NOT_USEFUL: reconfirmed at 4x the ticket range.

## Claims disproved

- "bStock consistently wins or ties" (the REJECT condition in this campaign's own lock rule): disproved by AVGO/COIN/DRAM.
- Implicit assumption that a wrapper's failure mode is always a clean refusal: disproved specifically for bStock at extreme size.

## Product-threat assessment

- The Taloe-beats-ALWAYS_USE_BSTOCK cases are thin (3/40, boundary-only, $100,000 only) — not something to build a headline on by itself.
- But the *mechanism* they expose — a wrapper can look executable while quietly delivering an over 50% worse fill, and the sponsor's own safety field will not tell you — is exactly the class of risk the product claims to guard against, and static ALWAYS_USE_BSTOCK would have missed it.
- 16/40 underlyings are now incomparable at $50k-$100k because Ondo's liquidity gives out; the product's useful size range on Ondo is narrower than the small-ticket demo implies.
- Regular-hours and weekend evidence is still absent. Everything above could look different under regular-hours liquidity; no claim in this report should be read as session-independent.

## Session evidence status

**Still after-hours only.** Regular-hours (next weekday 09:30-16:00 ET) and weekend (next: 2026-09-26) runs are documented and ready in `SESSION_CAMPAIGN.md` but have not executed — they require real wall-clock time this session cannot wait out. Commands: `pnpm validate:capacity --session regular` / `--session weekend`, then `pnpm validate:capacity-report --file <artifact>`.

## CONCLUSION: **REVISE**

Not REJECT: the dynamic-wrapper thesis survives falsification. bStock does not consistently win or tie — AVGO, COIN and DRAM are measured counterexamples, and the mechanism behind them (a quotable-but-bad fill versus an honest refusal) is precisely the failure class routing intelligence exists to catch.

Not APPROVE: the counterexamples are thin (3/40, boundary-only, at a $100,000 ticket size this product does not target) and session evidence is one-sided (after-hours only). The product object should narrow to what this campaign actually proves: Taloe's value is catching rare, high-severity, silent-bad-price events at size, not routine wrapper selection at ordinary ticket sizes, where bStock alone would have been fine 92.5% of the time in this sample. Recommended narrowing: state the ALWAYS_USE_BSTOCK-vs-Taloe comparison honestly in the demo (bStock is the strong default; Taloe is the check that catches the exception), and treat regular-hours/weekend confirmation as a precondition for the next lock decision, not an afterthought.
