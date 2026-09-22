# PRD Revision 1: size-aware wrapper execution and refusal

**Date:** 2026-09-22
**Amends:** `Taloe_PRD_v1.md` (kept intact; every section below is superseded only where a marker is placed in the PRD).
**Basis:** `internal/evidence/LIVE_VALIDATION_REPORT.md` (verdict REVISE) and `internal/evidence/CAPACITY_VALIDATION_REPORT.md`.

## OLD THESIS

Taloe picks the best wrapper for a tokenized equity, ranked on underlying-equivalent execution, and the user gets a better price.

## VALIDATION RESULT

- Two wrappers per underlying do coexist and both quote (40 underlyings with Ondo and bStock on BSC).
- At small tickets the difference is usually negligible (median per-share gap 7.1 bps on the first live sweep).
- Execution capacity diverges materially with size. A wrapper can silently lose one to seventy-two percent of the exposure at large tickets while the sponsor's own `priceImpactPercent` says under one percent.
- Ondo was never quoted as RFQ, xStock does not exist in the live platform list, and a fresh wallet fails a swap simulation before approval.

## REVISED THESIS

Taloe is a **size-aware execution router for tokenized equities**.

> Tell Taloe the equity and the ticket size. Taloe determines which supported wrapper can execute that exposure within your stated execution constraint, or refuses the trade before you receive a materially bad fill.

## Revised decision primitive

> Which representation can execute the requested underlying-equivalent exposure at this size without exceeding the user's execution constraint?

The five outcomes (`ACT`, `NO_ACTION`, `REFUSE`, `UNKNOWN`, `MANUAL_REVIEW`) are unchanged. `APPROVAL_REQUIRED` is added as an **execution-readiness** state, not a market outcome.

## What changed, section by section

| PRD area | Before | After |
|---|---|---|
| 1.2 One-line product | best executable tokenized NVIDIA exposure | the wrapper that can execute this size inside your limit, or a refusal |
| 1.5 Decision primitive | best valid exposure now | which representation can execute at this size within the constraint |
| 3.1 Primary user value | better price | not receiving a materially bad fill; correct like-for-like comparison |
| 4.2 Non-goals | (unchanged list) | adds: no claim of meaningful savings at small tickets; no split execution; no xStock or RFQ product claims until observed |
| 8.3 Route page | recommendation + reasons | recommendation, requested ticket, expected underlying-equivalent exposure, effective deviation, execution status, and SAFE SIZE / CAPACITY only when backed by current quotes |
| 11 Route engine | discover, gate, simulate, rank | **market decision** (discover, quote, normalize, deviation and capacity gates, rank, select or refuse) then **execution readiness** (balance, allowance, approval, re-quote, build, simulate, sign, broadcast, verify) |
| 12.1 SWAP machine | allowance check after selection | adds `BALANCE_CHECK`, `APPROVAL_SIMULATE`, `ALLOWANCE_VERIFY`; an approval can only lead to a fresh re-quote |
| Evaluation campaign | small-size price comparison | capacity campaign across ticket sizes and sessions (`EVAL_CAMPAIGN.md`) |
| Proof claim | Taloe finds a better price | Taloe refuses or reroutes a fill that a first-result or fixed-wrapper baseline would have taken at a size where its deviation exceeds the user's limit |

## Route engine after this revision

```
MARKET DECISION
  discover -> quote -> normalize -> deviation / capacity gates -> rank -> select route or refuse

EXECUTION READINESS (selected route only)
  balance -> allowance (on-chain read) -> [approval build -> simulate -> sign -> broadcast -> verify allowance]
  -> RE-QUOTE (never reuse a pre-approval quote) -> build -> simulate -> sign -> broadcast -> verify
```

Rules:

- Insufficient allowance is `APPROVAL_REQUIRED`. It becomes a refusal only if the approval itself cannot be built or simulated, or names a different spender than the quote.
- Swap simulation is no longer a ranking gate. It runs once, after selection. A non-allowance failure rejects that route, preserves the reason verbatim, and moves to the next viable candidate. It never forces a route through.
- The authoritative safety gate is Taloe's own recomputed effective deviation. Sponsor `priceImpactPercent` is recorded as metadata and is not trusted (observed 0.72 for a route that measured about a 72 percent shortfall).

## Safe execution capacity

A first-class evidence primitive (`packages/router-core/src/capacity.ts`). For a wrapper and a maximum deviation it reports a bracket: the largest ticket observed inside the constraint and the smallest observed outside it. It is derived from executable quotes only. There is no closed-form liquidity model and no interpolation. It is shown in the product only when backed by current quotes and only once the capacity campaign shows it matters beyond isolated outliers.

## Non-goals added or sharpened

- No claim of meaningful savings at small ticket sizes. Where wrappers are materially equivalent the product says so and does not manufacture a winner.
- No split-route execution (research only; see the capacity report).
- xStock is removed from active v1 claims (status: UNSUPPORTED / UNRESOLVED; the documentation discrepancy is preserved in `SPONSOR_FINDINGS.md`).
- RFQ stays implemented and branched on runtime `executionMode`, but is not a product claim until observed live.

## Historical truth

The original thesis, the fixture-era claims and the first live report are preserved. Nothing in `Taloe_PRD_v1.md` was deleted. Superseded passages carry an "Amended by Revision 1" marker.
