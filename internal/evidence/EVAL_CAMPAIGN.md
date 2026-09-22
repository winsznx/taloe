# Evaluation Campaign

**Status: SUPERSEDED for the small-size price question, EXTENDED for capacity.**
The small-size "Valid Decision Rate at $5/$25/$100" campaign ran (`internal/evidence/LIVE_VALIDATION_REPORT.md`): 3/15 differences from FIRST_RESULT, all inside 15 bps.
The live thesis moved from small-size price to size-aware capacity; see `PRD_REVISION_1.md` and `internal/evidence/CAPACITY_VALIDATION_REPORT.md` for the campaign that replaces the "Order sizes" and "Headline" sections below.

No number in this file may be published anywhere until it is measured. Empty cells
stay empty.

---

## Purpose

Prove mechanism truth, workflow value, sponsor dependence and correct inaction. Not
PnL.

## Primary metric

**Valid Decision Rate** — the share of route intents where the system either selects
and completes a route inside the user's declared constraints, or correctly refuses
when no route qualifies.

A correct refusal counts as a success. That is the point of the metric.

## Asset set

Initial, subject to actual wrapper overlap on BSC:

| Ticker | Why |
|---|---|
| NVDA | Expected in multiple families (NVDAon, NVDAx). Primary demo asset. |
| TSLA | Expected across all three (TSLAon, TSLAx, TSLAB). Best cross-issuer case. |
| AAPL | AAPLx documented. Checks Ondo/BStock coverage. |
| QQQ | ETF rather than a single equity. Checks whether ratio semantics differ. |
| TBD | One thinner name, to expose liquidity and price impact at size. |

## Order sizes

$5, $25, $100. Larger dry-run sizes only where they reveal price impact without
spending real funds.

## Session conditions

Each intent should be run during US regular hours and outside them. `SPONSOR_FINDINGS.md`
F-003 predicts this changes which routes are executable at all, not just their price.

## Method comparison

For every intent, run all of:

| Method | Description |
|---|---|
| `FIRST_RESULT` | First safely returned wrapper, its best route, no comparison |
| `FIXED_ISSUER` | Always one chosen issuer where available |
| `PRICE_ONLY` | Choose on displayed price, no session/reference/semantic context |
| `FULL` | Taloe |

## Outcome classes required

Per PRD 18.6. All five must be represented by real observations.

| Class | Meaning | Observed |
|---|---|---|
| Positive | A route qualifies and completes | no |
| Control | The obvious route is already valid and Taloe does not manufacture a difference | no |
| Refusal | All routes violate a hard constraint, or simulation fails | no |
| Sparse | Only one usable wrapper; the product must not claim a multi-wrapper advantage | no |
| Ablation | A mechanism removed, identical intents re-run | no |

The Control class matters as much as the Positive one. A router that always finds a
difference is suspicious.

## Results

| Run | Date | Ticker | Size | Session | Method | Decision | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | *no runs yet* |

## Headline

Not written. Per PRD 18.8, no headline exists until the data does. If the data does
not support a dramatic number, the strongest honest mechanism proof is used instead.
