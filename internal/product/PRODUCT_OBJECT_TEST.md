# Product Object Test

**Question:** is Taloe primarily (A) a consumer tokenized-equity execution router, or (B) best-execution infrastructure used by wallets/agents/trading products, with the consumer web app as the reference client?

**Status: not decided.** This document lays the two cases side by side using only evidence that already exists. It does not choose. See "Not yet decidable" at the end for what's missing.

## A. Consumer Execution Router

| Dimension | Answer |
|---|---|
| Flow originator | The retail user, typing a ticker and an amount into the Taloe web app. |
| Beneficiary | The same retail user — avoids a materially bad fill, gets a like-for-like wrapper comparison. |
| Installer | Nobody installs anything; it's a website. |
| Payer | Unclear — no monetization model exists yet (correctly out of scope this phase). Presumably the user, eventually, if there's a fee. |
| Operator | Taloe (as a hosted product). |
| Distribution owner | Taloe's own web app is the only distribution channel. |
| Counterparty | Binance Web3 API (sponsor), Ondo, bStock (issuers). |
| Value returned | Correct wrapper selection and refusal of bad fills, at the cost of the user learning a new product. |
| Integration burden | Zero for the user (it's a website), but zero leverage too — every user is a fresh, unrelated flow. |
| Recurring flow potential | Low per user. A retail buyer of one stock, occasionally, is not a recurring flow; a user who trades often might be, but nothing in the product encourages or measures that yet. |
| Aggregation wedge | Does not apply — there is no aggregation point; each user is independent. |
| Actual pull evidence | None collected (no user testing has happened in this phase; product is pre-launch). |

**What the evidence says about A:** the capacity campaign directly measured this actor's value and found it thin most of the time — 97.2% of small-ticket comparisons were materially equivalent. The cases where it mattered were rare and severe (`STATIC_BASELINE_FALSIFICATION_REPORT.md`). A consumer router whose main value shows up in ~7.5% of stressed-size cases is a real but narrow story for an individual retail user, who may never place a large enough order to see it.

## B. Execution Routing Service

| Dimension | Answer |
|---|---|
| Flow originator | A wallet, trading app, agent, or protocol that already has its own users and its own order flow. |
| Beneficiary | That integrator's own end users, indirectly; the integrator directly (offloads a hard problem). |
| Installer | A developer wiring an API/SDK call (`routeEquityIntent`, already built as a clean internal service shape — `packages/router-core/src/route-equity-intent.ts`) into their own system. |
| Payer | The integrator, presumably (again, no monetization model decided — out of scope this phase). |
| Operator | Taloe, as an API/service; the integrator operates their own product on top. |
| Distribution owner | The integrator's own distribution — Taloe never has to acquire a retail user directly. |
| Counterparty | Same sponsor/issuer dependencies as A, plus now the integrator itself as a counterparty with its own SLA expectations. |
| Value returned | Removes issuer-specific routing logic, size-aware safety checks, and sponsor quirks (F-001 through F-025) from every integrator that would otherwise have to discover them independently, the way Taloe did. |
| Integration burden | Real: an integrator has to trust an external service for a security-relevant decision (execution safety), audit it, and build a fallback for when it's unavailable. `routeEquityIntent` exists as a clean shape but is NOT published, has no auth, no billing, no SLA, no external callers. |
| Recurring flow potential | High per integration point — one wallet with 10,000 users routing tokenized-equity orders is 10,000x the flow of one retail user, from a single integration decision. |
| Aggregation wedge | Directly applies: Taloe's scarce input (order intent) can come from one integrator in volume instead of one user at a time. This is the thesis under test in `AGGREGATION_PULL_TEST.md`. |
| Actual pull evidence | **None yet.** No outsider has asked for API access, docs, or SDK. The wedge is argued, not observed. |

**What the evidence says about B:** the mechanism that matters (catching a rare, severe, silent-bad-price divergence) is exactly the kind of tail risk an integrator handling many orders would rationally want offloaded, and would hit more often in aggregate than any single retail user would. But this is an inference from the shape of the evidence, not from anyone actually asking for it.

## Comparison, side by side

| | A. Consumer router | B. Execution routing service |
|---|---|---|
| Recurring flow potential | Low | High |
| Integration burden | None (it's a website) | Real (trust, audit, fallback) |
| Distribution cost | Taloe must acquire every user | Integrator brings the users |
| Value per flow | Small, rare | Same mechanism, but hits more often in aggregate across many flows |
| Evidence today | Fully built, live-tested (both the frontend journey and the routing/readiness pipeline) | The routing primitive exists in a clean internal shape; nothing external, no auth, no docs, no SLA, no external caller |
| Pull evidence | None | None |

## Static-bStock counterfactual, restated for both cases

Every claim above still has to survive "why not always use bStock?" (`STATIC_BASELINE_FALSIFICATION_REPORT.md`). It does, on the same evidence as before, nothing new measured this phase:

- rare severe bad-price protection: AVGO/COIN/DRAM at $100,000 (measured)
- wrapper availability differences: Ondo returned `40374` far more often than bStock in the extended campaign (measured)
- capacity differences: bStock's p10 safe capacity ($50,000) far exceeds Ondo's ($1,000) at 150 bps (measured)
- correct refusal: Taloe avoided every avoidable first-result breach in the campaign (measured)
- session-dependent routing: **not claimed** — still `UNTESTED`/`PENDING_REAL_TIME` (see `SESSION_CAMPAIGN.md`); this document does not add a session claim
- removing issuer-specific execution logic from integrators: this is case B's core value proposition, and it is a *structural* answer, not yet an empirical one — no integrator has confirmed this is actually a burden they'd want removed.

The counterfactual is the same in both A and B: bStock alone would be right 92.5% of the time in the measured sample. What changes between A and B is only who benefits from catching the other 7.5%, and how often they'd encounter it.

## Not yet decidable

Neither case has actual pull evidence. The comparison above uses only what the routing mechanism itself has already proven (capacity campaign, static-baseline falsification) plus straightforward structural reasoning about distribution and recurring flow — it does not use a single real conversation with an outsider, because none has happened. Choosing B over A "because infrastructure sounds more sophisticated" is explicitly the wrong reason (Taloe product-lock phase, section 12) and this document does not do that: it lays out that A is fully built and evidenced today, while B is a stronger structural argument with zero external validation.

The next fact that would actually move this decision is real responses in `AGGREGATION_PULL_TEST.md`. Until then, Taloe remains, in practice, product A with product B's primitive built underneath it and not yet exposed.
