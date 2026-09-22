# Claim Ledger

Every consequential claim Taloe makes, with its evidence status. Nothing here may be
restated in the README, the demo, the DX report or the submission at a higher
confidence than this file records.

Status vocabulary:

| Status | Means |
|---|---|
| `UNTESTED` | Asserted, not yet checked against anything. |
| `DOC_VERIFIED` | Confirmed against current official documentation, with URL and retrieval date. |
| `API_VERIFIED` | Confirmed by an actual authenticated call and a recorded response. |
| `CHAIN_VERIFIED` | Confirmed by independent on-chain observation. |
| `EMPIRICALLY_MEASURED` | Quantified across a recorded campaign with a stated sample size. |
| `DISPROVED` | Checked and found false. Must be removed from all public copy. |
| `BLOCKED_CREDENTIALS` | Cannot be checked until API credentials exist. |
| `BLOCKED_EXTERNAL` | Cannot be checked for a reason outside our control. |

Docs retrieval date for every `DOC_VERIFIED` row below: **2026-09-21**.

---

## A. Authentication and transport

| # | Claim | Status | Evidence |
|---|---|---|---|
| A1 | Base URL is `https://web3.binance.com/build` and the `/build` prefix must appear in both the wire path and the signed `requestPath`. | `DOC_VERIFIED` | [authentication](https://web3.binance.com/en/dev-docs/authentication) — "the `requestPath` used in the signature must also include the `/build` prefix". Encoded in `packages/binance-web3/src/signing.ts`; asserted in `test/signing.test.ts`. |
| A2 | Pre-hash is `timestamp + METHOD + requestPath + body`, signed HMAC-SHA256, Base64-encoded. | `DOC_VERIFIED` | Same page, Step 3. Test reproduces the doc's own worked example byte for byte. |
| A3 | `X-OC-TIMESTAMP` is ISO 8601 with milliseconds, not epoch milliseconds. | `DOC_VERIFIED` | Same page, header table. This differs from other Binance APIs and is a likely first-call failure. |
| A4 | Query string must be signed in the exact raw encoding sent, with no re-ordering. | `DOC_VERIFIED` | Same page, Step 3.1 caution block. |
| A5 | Our signing implementation produces a signature Binance accepts. | `API_VERIFIED` 2026-09-21 | First signed call HTTP 200/code 0. `auth-2026-09-21T22-49-49-348Z.ndjson`. (A separate replay bug, needing a nonce, was ours: F-011.) |
| A6 | Rate limits are 1200/min per IP and per key, 6000/min per user, 5 RPS per endpoint. | `DOC_VERIFIED` | Same page, rate-limit table. Observed behaviour not yet measured. |

## B. Business-error semantics

| # | Claim | Status | Evidence |
|---|---|---|---|
| B1 | Responses can carry HTTP 200 with a non-zero body `code`, so HTTP status alone is not success. | `DOC_VERIFIED` | Unified error format on the authentication page. Enforced in `client.ts`; asserted in `test/client.test.ts`. |
| B2 | `40401` is `QUOTE_EXPIRED`, `40462` is `SWAP_QUOTE_MISMATCH`. | `DOC_VERIFIED` | [trading-api/introduction](https://web3.binance.com/en/dev-docs/products/trading-api/introduction). |
| B3 | `40367` and `40369` signal Ondo and BStock unavailability outside US market hours. | `DOC_VERIFIED` | Same page, "Key Constraints for Equity Token Trading". Not yet observed live. |
| B4 | How often HTTP 200 + non-zero code actually occurs in practice. | `UNTESTED` | Needs the live campaign. |

## C. RWA data

| # | Claim | Status | Evidence |
|---|---|---|---|
| C1 | RWA endpoints live under the Market API at `/api/v1/dex/market/rwa/*` (platforms, price, search, tokens, underlying-profile, underlying-market). | `DOC_VERIFIED` | [market-api/introduction](https://web3.binance.com/en/dev-docs/products/market-api/introduction). Note: the PRD described these as a standalone "RWA Data API". |
| C2 | Exact response field names for the RWA endpoints. | `API_VERIFIED` 2026-09-21 (V1 guesses were wrong and are fixed; see F-009). | The introduction lists endpoints, not payloads. Schemas in `schemas.ts` are deliberately loose and nullable until a live response is seen. |
| C3 | `tokenToShareRatio` exists on RWA token records. | `API_VERIFIED` (tokens list and underlying-profile). | Asserted by the PRD; not confirmed on any page retrieved in this cycle. |
| C4 | The direction and meaning of `tokenToShareRatio` per issuer. | **Ondo `EMPIRICALLY_OBSERVED`; bStock `DOCUMENTED`; xStock `UNKNOWN`** (shares-per-token) | **Load-bearing and deliberately unimplemented.** Each issuer is now its own `IssuerNormalizer` with its own `semantics` (`DOCUMENTED`/`EMPIRICALLY_OBSERVED`/`UNKNOWN`) — all three currently `UNKNOWN` — so no wrapper is normalized and no issuer's semantics can be promoted by another issuer's evidence. See `normalization.ts` and `DECISIONS.md` D-015/D-016. |
| C4a | Binance Wallet Skills' Ondo "shares multiplier" confirms the RWA API's `tokenToShareRatio` direction. | `UNTESTED` — explicitly not treated as confirming evidence | Recorded in `normalization.ts`'s `relatedSignals` for Ondo only, distinct from `provenance`. Different API surface, different terminology; worth checking first when live validation starts, never assumed. See `DECISIONS.md` D-016. |
| C5 | Which platform IDs the `platforms` endpoint actually enumerates. | `API_VERIFIED`: exactly `ondo`, `bstock`. **xStock absent.** `raw-platforms-2026-09-21T22-50-20-312Z.json`. | The PRD expected `ondo` and `bstock` only. The Trading API now names three issuer families (see D5), so this needs checking directly. |

## D. Trading and execution

| # | Claim | Status | Evidence |
|---|---|---|---|
| D1 | `executionMode` is returned per route and is either `SWAP` or `RFQ`. | `DOC_VERIFIED` | [trading-api/introduction](https://web3.binance.com/en/dev-docs/products/trading-api/introduction), "Execution Modes". |
| D2 | Quote lifetime is 30 seconds. | `DOC_VERIFIED` | Same page. The API returns no expiry timestamp, so our freshness maths is an estimate built on this figure. |
| D3 | Real observed quote lifetime and expiry behaviour under load. | `EMPIRICALLY_MEASURED` (n=1 per delay): buildable at 29.1s, `40401` at 33.5s. `ttl-probe-2026-09-21T23-16-18-735Z.json` | Named as a DX measurement target. |
| D4 | RFQ requires signing `rfq.typedDataToSign` as EIP-712, submitting to `/order/submit`, then polling `/order/{orderId}`. | `DOC_VERIFIED` | [trading-api/integration-flow](https://web3.binance.com/en/dev-docs/products/trading-api/integration-flow). |
| D5 | Ondo routes always return RFQ; xStock routes return SWAP via AMM; BStock can return one SWAP and one RFQ route simultaneously. | `DOC_VERIFIED` | Same introduction page, "Equity Token Trading (RWA)". **Not hardcoded** — the client still branches on the returned `executionMode`, per PRD 5.4. |
| D6 | That the documented per-issuer defaults hold at runtime. | `DISPROVED` for "Ondo always RFQ" in this window: 110/110 routes were SWAP via LiquidMesh (`RUNTIME_DIFFERENCE`, F-012). One time window only. | This is exactly the doc-versus-reality seam the DX report should measure. |
| D7 | `/order/submit` takes `rfq.orderId` from `/swap` in its `quoteId` parameter, not the route `quoteId` from `/quote`. | `DOC_VERIFIED` | integration-flow, submit parameter list. Recorded as a naming trap in `SPONSOR_FINDINGS.md`. |
| D8 | `vendor` is required in `/approve-transaction` for equity tokens. | `DOC_VERIFIED` | trading-api introduction, constraints table. |
| D9 | Taloe can resolve one underlying across two or more executable wrappers on BSC. | **`API_VERIFIED`**: 40/40 overlapping underlyings quoted on both Ondo and bStock (`sweep-25usdt-2026-09-21T23-12-33-329Z.json`). Executability beyond quote/build/approval-simulation is unproven (no fill). | **The central product thesis.** Nothing verifies it yet. If it fails, PRD section 25.2 applies. |

## E. Simulation and verification

| # | Claim | Status | Evidence |
|---|---|---|---|
| E1 | `POST /api/v1/dex/pre-transaction/simulate` exists. | `DOC_VERIFIED` | [transaction-api/introduction](https://web3.binance.com/en/dev-docs/products/transaction-api/introduction). |
| E2 | Its request parameters, response fields and status vocabulary. | `API_VERIFIED`: statuses `FAILED` (30x) and `SUCCESS` (1x); `allowanceChanges` parsed. `campaign-2026-09-21T23-19-27-931Z.json`, `simulate-approval-2026-09-21T23-10-50-202Z.json` | Documented on the canonical `transaction-api` reference page (not the introduction). Our parser accepts only an explicit pass; anything unreadable becomes `NOT_RUN`, which the router treats as a failed gate. |
| E3 | Simulation can be used as a pre-sign gate for RFQ settlement. | `UNTESTED` | Likely false: RFQ settles vendor-side and the client holds no transaction. If confirmed false, it becomes a capability request. |
| E4 | Wallet transaction detail can return empty while indexing catches up. | `DOC_VERIFIED` (PRD-sourced) | Asserted in PRD 5.7; handled as `INDEXING` in `services/wallet.ts`. Not independently re-confirmed this cycle. |
| E5 | Measured Wallet API indexing delay after a mainnet broadcast. | `UNTESTED` | DX measurement target. |
| E6 | Taloe has completed a verified mainnet execution. | `BLOCKED_CREDENTIALS` | No credentials, no funded wallet. |

## F. Product behaviour

| # | Claim | Status | Evidence |
|---|---|---|---|
| F1 | WrapRoute produces `ACT`, `NO_ACTION`, `REFUSE`, `UNKNOWN` and `MANUAL_REVIEW` with traceable per-gate reasons. | `API_VERIFIED` (logic only) | 135 tests across the workspace, including full end-to-end orchestration tests in `packages/router-core/test/orchestrate.test.ts` covering all five outcomes through the actual `DiscoveryPort` pipeline. **Against synthetic fixtures**, so this proves the logic, not live behaviour. |
| F2 | A route that fails simulation cannot reach an executable state. | `API_VERIFIED` (logic only) | Covered by engine tests and by the SWAP state table, which has no edge from `BUILD_SWAP` to `USER_SIGN_SWAP`. |
| F3 | A closed underlying market does not by itself block execution, but a SPECIFIC issuer's documented market-hours restriction can reject only that candidate while another survives. | `API_VERIFIED` (logic only) | Engine tests "still routes while the underlying market is merely closed" and the `ACT_ISSUER_DIVERGENCE_CLOSED_MARKET` orchestration test (Ondo pre-rejected `OUTSIDE_TRADING_HOURS`, BStock SWAP route wins in the same CLOSED session). See `DECISIONS.md` D-018. |
| F3a | A definitively positive sponsor/chain-native settlement signal (SWAP chain confirmation, RFQ `FILLED`) is never itself Taloe's terminal success claim. | `API_VERIFIED` (logic only) | `execution` package state-transition tests: `CHAIN_PENDING`/`FILLED` cannot transition directly to `VERIFIED_SUCCESS`; both route through `EXECUTED_PENDING_VERIFICATION` -> `VERIFYING` first. See `DECISIONS.md` D-019. |
| F4 | Taloe gives a materially better valid-decision rate than first-result or fixed-issuer baselines. | `UNTESTED` | The headline claim. Needs the full campaign. No number may be published before then. |
| F5 | Execution-mode awareness is load-bearing. | `UNTESTED` | The `NO_EXECUTION_MODE_AWARENESS` ablation changes outcomes on synthetic fixtures. That is a wiring check, not evidence. |
| F6 | A complete consumer journey (intent -> route -> review -> execution -> receipt) exists and renders every required product state. | `API_VERIFIED` (structural, fixture mode only) | All 8 routes build and were smoke-tested via a running server against all 12 fixture scenarios plus the full execution/receipt timeline for 3 terminal outcomes. Zero live data involved — this proves the UI and state wiring, not anything about Binance. |
| F7 | The live and fixture data sources share one interface (`DiscoveryPort`) and cannot silently fall back into each other. | `API_VERIFIED` (structural) | `apps/web/src/server/discovery.ts` is a `switch` with two branches and no shared code path; enforced by construction, not by test. `LiveDiscoveryProvider` exists and typechecks but every one of its methods is `BLOCKED_CREDENTIALS` for correctness. |

## G. Live integration boundary (Gate C strengthening)

| # | Claim | Status | Evidence |
|---|---|---|---|
| G1 | `POST /api/v1/dex/market/token/basic-info` exists and returns `decimals`. | `DOC_VERIFIED` | Market API introduction page lists this endpoint. Used specifically so live USDT decimals are never assumed (correction 2). Response field names UNTESTED. |
| G2 | The wallet balances endpoint path/shape. | `DISPROVED` (old path 404) then `API_VERIFIED` for `POST /balance/token-balances-by-address` | See `internal/sponsor/API_MATRIX.md` A-06. `LiveDiscoveryProvider.getWalletBalances` is wired against this best-effort guess and will surface a clear failure if wrong, not a silent wrong answer. |
| G3 | Native BNB gas balance appears in the balances response under a documented convention. | `API_VERIFIED` with a doc mismatch: returned as `0xeeee…eeee`, symbol BNB (docs: empty string). Gas gate now works. | Not assumed. `LiveDiscoveryProvider.getWalletBalances` returns `gasBalanceWei: null` (not checkable) until this is confirmed against a live response, rather than guessing a zero-address convention. |
| G4 | Documented market-hours business codes (`40367`/`40369`) translate live into a `PRE_QUOTE` rejection. | `UNTESTED` — codes never observed (after-hours run only; both issuers quoted) | `LiveDiscoveryProvider.getQuotesForCandidate` checks `businessCode` against `MARKET_HOURS_BUSINESS_CODES` before falling back to a generic `SPONSOR_UNAVAILABLE`. The equivalent fixture path is `API_VERIFIED` (logic only) — see F3. |
| G5 | Live SWAP simulation (quote -> `/swap` -> `POST /pre-transaction/simulate`). | **Three separate statuses.** Implementation: `IMPLEMENTED_UNVERIFIED` (`LiveDiscoveryProvider.simulateRoute` + `TransactionService.simulate`; 13 adapter tests + 6 provider tests with mocked sponsor services). Documentation: `DOC_VERIFIED` 2026-09-21 (request `evmTx{from,to,value,data}`, response `data.status/failReason/balanceChanges/allowanceChanges`; `/swap` `data.tx` fields) — with one internal contradiction, see G6. Runtime: `API_VERIFIED` 2026-09-21 for the flow (30x `FAILED` allowance) and the parse (approval sim `SUCCESS`); a swap-simulation `SUCCESS` was **not** observed (needs an approval). | Supersedes the earlier `DISPROVED` status, which was true only until the canonical contract was found. Nothing here is `API_VERIFIED`. |
| G6 | The simulate docs' example (`status: SUCCESS` with a revert-style `failReason`) has a defined meaning. | `DOCUMENTATION_AMBIGUITY` — meaning `UNTESTED` | `DOC_ISSUES.md` DOC-005, `SPONSOR_FINDINGS.md` F-007. Taloe fails closed (`NOT_RUN`, gate refuses) and captures the raw payload; it neither invents a FAIL rule nor accepts a PASS. |
| G7 | A SWAP route cannot reach signing without an explicit simulation PASS. | `API_VERIFIED` (logic only) | `gates.ts` (attempted-but-unusable simulation is refused; only "no wallet yet" is tolerated at ranking) and `/review` (Confirm hidden unless SWAP simulation === PASS). Tests: one-fails-one-survives, all-fail, inconsistent-refuses-survivor-wins. |
| G8 | Flash API `/quote-and-swap` reduces quote-expiry failures. | `UNTESTED` — deliberately not adopted | `SPONSOR_FINDINGS.md` F-008. `enableRFQ` is documented for the Flash endpoint only. No advantage is claimed. |

---

## Disproved or corrected

| # | Original claim | Correction | Date |
|---|---|---|---|
| X1 | (PRD 5.3, 32.3) xStocks support is an open question and may not be discoverable through the Binance stack. | The current Trading API documentation explicitly supports xStock tokens as `type=2`, traded through AMM pools with `executionMode=SWAP`. xStocks are a first-class execution target, not a gap. Whether the **RWA data** surface covers them equally is still open. | 2026-09-21 |
| X2 | (PRD 5.4) Docs are ambiguous about whether equity routes always use RFQ. | No longer ambiguous in the current docs: per-issuer behaviour is stated explicitly (see D5). The ambiguity the PRD recorded has been resolved by a documentation update. | 2026-09-21 |

## H. Live validation 2026-09-21 (see `internal/evidence/LIVE_VALIDATION_REPORT.md`)

| # | Claim | Status | Evidence |
|---|---|---|---|
| H1 | Two wrappers of one underlying coexist on BSC (Ondo + bStock). | `API_VERIFIED` (40 underlyings) | `sweep-25usdt-*.json` |
| H2 | Per-share exposure gap between the two wrappers at $25. | `EMPIRICALLY_MEASURED` n=40: median 7.1, p90 16.0, max 59.8 bps | `sweep-25usdt-*.json` |
| H3 | Wrapper choice changes materially at large size. | `EMPIRICALLY_MEASURED` n=1 underlying: NVDAon +161 bps at $2k, +25,343 bps (72% fewer shares) at $10k; NVDAB +10/+13 bps | `size-probe-*.json`, `campaign-2026-09-21T23-17-41-505Z.json` |
| H4 | Taloe rejects a wrapper a first-result baseline would attempt. | `API_VERIFIED` (NVDA $2k, $10k) | same |
| H5 | Taloe gives a better price than baselines at <= $100. | `DISPROVED` as a claim: 3/15 differences, all <= 15 bps, consistent with quote noise | `campaign-2026-09-21T23-19-27-931Z.json` |
| H6 | Normalization changes the chosen wrapper. | `EMPIRICALLY_MEASURED`: 9/40, gaps 0.2-39.8 bps | sweep + universes |
| H7 | A per-token price compared to a per-share reference was a bug. | `API_VERIFIED`: would have flagged CRWDon (ratio 4) at +29,986 bps. Fixed with a regression test. | `normalization-crosscheck-*.json` |
| H8 | `priceImpactPercent` is a reliable safety signal. | `DISPROVED` (single observation, F-016) | `size-probe-*.json` |
| H9 | `referencePrice` is an independent stock price. | `DISPROVED` (documented as derived; `tokenPrice/ratio` identity holds for 488/488) | `raw-universe-*.json` |
| H10 | Session context (`marketStatus`) changes which routes are executable. | `UNTESTED`: after-hours only; every wrapper tradable | — |
| H11 | A fresh wallet can pass the ranking-time swap simulation. | `DISPROVED`: 30/30 `FAILED` (no allowance) | `campaign-*.json` |
| H12 | xStock is discoverable/tradable through RWA data. | `DISPROVED` for RWA data (absent); trading via `/quote` untested | `raw-platforms-*.json` |


## I. Product revision 2026-09-22 (see `PRD_REVISION_1.md`, `internal/evidence/CAPACITY_VALIDATION_REPORT.md`)

| # | Claim | Status | Evidence |
|---|---|---|---|
| I1 | Market decision and execution readiness are separable: the market pipeline no longer simulates every candidate. | `API_VERIFIED` (unit test asserts 0 simulate calls on a decision through the fixture port) | `packages/router-core/test/orchestrate.test.ts` |
| I2 | Insufficient allowance is `APPROVAL_REQUIRED`, not `REFUSE`. | `API_VERIFIED` (fixture-level unit tests) | `packages/router-core/test/readiness.test.ts` |
| I3 | A non-allowance simulation failure on the selected route falls through to the next viable candidate without forcing execution. | `API_VERIFIED` | `packages/router-core/test/readiness.test.ts` |
| I4 | A stale (pre-approval) quote is never reused: `resumeAfterApproval` re-quotes and re-gates before building. | `API_VERIFIED` | `packages/router-core/test/readiness.test.ts` |
| I5 | An approval whose simulated spender differs from the quote's is refused, not silently accepted. | `API_VERIFIED` | `packages/router-core/test/readiness.test.ts` |
| I6 | `SafeExecutionCapacity` derives a bracket from executable quotes only, with no liquidity model. | `API_VERIFIED` | `packages/router-core/test/capacity.test.ts`, `capacity-probe.test.ts` |
| I7 | Wrapper capacity diverges materially at size across the 40-underlying live universe. | pending capacity campaign artifact | `internal/evidence/runtime/capacity-afterhours-*.json`, `capacity-report-*.json` |
| I8 | Split-route execution shows [LOAD_BEARING/MARGINAL/NOT_USEFUL] advantage over the best single wrapper. | pending capacity campaign artifact | same |
| I9 | Session (regular-hours, weekend) behaviour differs from the after-hours baseline. | `UNTESTED` — after-hours only so far | `internal/evidence/SESSION_CAMPAIGN.md` |

## J. Static-baseline falsification campaign 2026-09-22 (see `internal/evidence/STATIC_BASELINE_FALSIFICATION_REPORT.md`)

| # | Claim | Status | Evidence |
|---|---|---|---|
| J1 | ALWAYS_USE_BSTOCK is a safe universal substitute for Taloe's routing. | `DISPROVED` — 3/40 underlyings (AVGO, COIN, DRAM) at $100,000 where bStock quotes a materially worse price than Ondo (170-5,168 bps) while Ondo either stays inside the limit or correctly refuses to quote at all. | `capacity-afterhours-2026-09-22T00-50-38-325Z.json`, `capacity-report-afterhours-2026-09-22T01-14-08-334Z.json` |
| J2 | bStock is deeper/more available than Ondo on average. | `EMPIRICALLY_MEASURED`, confirmed at larger scope: Ondo returned `40374` (insufficient liquidity) on 15/480 wrapper-ticket probes vs bStock's 0/480; bStock's p10 safe capacity at 150 bps ($50,000) exceeds Ondo's p10 ($1,000). | same |
| J3 | Wrapper ranking direction can flip with the deviation threshold chosen, for the same underlying. | `EMPIRICALLY_MEASURED` (MSFT: Ondo-better at 50 bps, bStock-better at 100/150 bps, same session). | `capacity-report-afterhours-2026-09-22T01-14-08-334Z.json`, `routingDirectionMatrix` |
| J4 | Taloe meaningfully outperforms ALWAYS_USE_BSTOCK in a recurring, non-trivial share of cases. | 3/40 (7.5%) at 150 bps, all boundary cases at the $100,000 anchor (factor lower bound 1x — proven only at that exact ticket, not with margin). | same |
| J5 | Split-route execution is useful given the extended ($100k) evidence. | `NOT_USEFUL` (unchanged from the $25k campaign): 0 of 24 evaluable underlyings show a binding best-single-wrapper capacity limit that a split would relieve. | `capacity-report-afterhours-2026-09-22T01-14-08-334Z.json`, `splitExperiment` |
| J6 | Small-ticket (<=$100) wrapper equivalence holds at the larger sample. | `EMPIRICALLY_MEASURED`: 105/108 cells (97.2%) materially equivalent, median gap 4.9 bps. | same, `smallSize` |
