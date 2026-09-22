# Sponsor Findings

Differences between the PRD's assumptions and the current official documentation,
plus open seams to investigate. Questions, not pre-declared bugs. Nothing here is
called a Binance bug until it has been reproduced.

All documentation retrieved **2026-09-21**.

## Classification

Every finding gets exactly one label, assigned at the time it is recorded and revised
only when new evidence justifies it:

| Label | Means |
|---|---|
| `DOCUMENTATION_AMBIGUITY` | Current docs are internally inconsistent or genuinely support more than one reading. |
| `DOCUMENTATION_GAP` | Docs are silent on something we need (a schema, a status vocabulary, a parameter). |
| `RUNTIME_DIFFERENCE` | Live behaviour observed to differ from documented behaviour. Requires a live observation — cannot be assigned from reading docs alone. |
| `API_DEFECT` | The platform is doing something wrong, reproduced more than once, with no reasonable reading of the docs that makes it correct. **Never** the first label a finding gets. |
| `DEVELOPER_ERROR` | Turned out to be our mistake, not the platform's. Kept in the log rather than deleted, so the same mistake isn't repeated. |
| `UNRESOLVED` | Not enough information yet to classify further. |

`API_DEFECT` requires reproduction. A finding that starts as `RUNTIME_DIFFERENCE`
or `DOCUMENTATION_GAP` may be reclassified to `API_DEFECT` only after a second,
independent observation confirms it is not a one-off, a misunderstanding, or a
transient condition.

---

## F-001 — xStocks are documented as first-class, which the PRD did not expect

**Status:** resolved in Binance's favour. PRD assumption superseded.
**Classification:** `DOCUMENTATION_GAP` (the PRD's source page was simply out of date; current docs are clear).

**PRD expectation (5.3, 32.3):** the RWA `platformId` filter enumerates only `ondo`
and `bstock`, so xStocks discovery and normalization was flagged as an unresolved
empirical seam that might not be supported at all.

**Current documented behaviour:** the Trading API introduction explicitly supports
three mutually exclusive equity token families:

| Family | `type` | Examples given | Routing |
|---|---|---|---|
| Ondo | 1 | NKEon, NVDAon, EEMon | 3-vendor RFQ (InchFusion + CowSwap + PcsXRfq), always `executionMode=RFQ` |
| xStock | 2 | AAPLx, NVDAx, TSLAx | Regular AMM pools, `executionMode=SWAP` |
| BStock | 3 | PALLon, TSLAB | LiquidMesh (SWAP) + PcsXRfq (RFQ), mixed result |

Source: <https://web3.binance.com/en/dev-docs/products/trading-api/introduction>

**Implementation consequence:** substantial and positive. NVDA plausibly exists as
both `NVDAon` (Ondo, RFQ) and `NVDAx` (xStock, SWAP). That is a real cross-wrapper,
cross-execution-mode comparison for a single underlying, which is precisely the
decision WrapRoute exists to make. It strengthens the product thesis rather than
threatening it.

**Still open:** the Trading API documents xStock trading. It does not follow that the
**RWA data** surface returns xStock tokens with `underlyingTicker` and
`tokenToShareRatio`. If RWA data covers only Ondo and BStock, then xStock routes are
executable but not normalizable, and they cannot enter numeric ranking. That would be
a genuine platform gap worth reporting. **Check the `platforms` endpoint first.**

---

## F-002 — RFQ order submission reuses the name `quoteId` for a different identifier

**Status:** open. Documented clearly, but the naming invites a silent error.
**Classification:** `DOCUMENTATION_AMBIGUITY` (a parameter name that reasonably implies a different value than the one it takes).

`POST /api/v1/dex/aggregator/order/submit` takes a parameter named `quoteId`. Its
value is **`rfq.orderId` from the `/swap` response**, not the route `quoteId` returned
by `/quote`.

Source: <https://web3.binance.com/en/dev-docs/products/trading-api/integration-flow>
("`quoteId`: value of `rfq.orderId` from `/swap` (not the route identifier)").

**Why it matters:** a developer holding a `quoteId` variable from the quote step will
pass it, and the call will fail in a way that points at quote expiry rather than at a
wrong identifier. Both values are opaque strings, so nothing catches it locally.

**Our mitigation:** the client method parameter is named `rfqOrderIdFromSwap`, so the
wrong value cannot be passed without noticing. See
`packages/binance-web3/src/services/trading.ts`.

**Suggested platform change:** name the field `rfqOrderId`, or accept either and
disambiguate server-side.

---

## F-003 — Market-hours restrictions differ by issuer, which makes session state load-bearing

**Status:** open, high product value if confirmed.
**Classification:** `UNRESOLVED` (documented; not yet observed live, so not yet a `RUNTIME_DIFFERENCE` in either direction).

Documented: Ondo tokens may be unavailable outside US market hours (error `40367`);
BStock similarly (`40369`). No equivalent restriction is documented for xStock, which
trades through ordinary AMM pools.

**If this holds at runtime**, then outside US market hours a single underlying may
have exactly one executable wrapper, and it is the one a naive "pick the first result"
flow is least likely to choose. That is a concrete, demonstrable case where session
context changes which route is executable at all, rather than merely changing a price.

**To verify:** quote NVDA across issuer families during and outside US market hours
and record which routes return, and with what errors.

---

## F-004 — RWA data lives under the Market API, not a standalone RWA API

**Status:** documentation-structure difference. No product impact beyond paths.
**Classification:** `DOCUMENTATION_GAP` (the PRD's source page predates the current site structure).

The PRD (section 33) cites a `catalog/web3-wallet/api/rest-api/rwa-data` page. The
current `llms.txt` index places RWA data inside the Market API, and the endpoints are
`/api/v1/dex/market/rwa/*`. Recorded so the API matrix stays accurate.

---

## F-005 — Endpoint introduction pages do not carry request or response schemas

**Status:** open. This is the biggest current blocker to writing precise clients.
**Classification:** `DOCUMENTATION_GAP`.

The Market API and Transaction API introduction pages list endpoints, methods and
one-line descriptions, but not parameters or response fields. The Trading API
introduction and integration-flow pages are considerably richer.

**Consequence:** our RWA and simulation schemas are written loosely and defensively
(optional, nullable, unknown keys preserved) because guessing a field name and having
it silently read as absent is the failure mode we most need to avoid. Tightening them
requires either per-endpoint reference pages or a live response.

**Time cost so far:** roughly 25 minutes of doc navigation that did not produce the
schemas needed.

**Suggested platform change:** publish request/response schemas on the per-endpoint
reference pages for the Market API RWA endpoints and the Transaction API simulate
endpoint, at the level of detail the Trading API integration flow already reaches.

---

## F-006 — `/swap` is a GET that returns either a transaction or typed data

**Status:** noted, no problem. Recorded because it is surprising.
**Classification:** `DOCUMENTATION_GAP` resolved by reading further (the integration-flow page, not the introduction page, explains it).

`GET /api/v1/dex/aggregator/swap` returns `data.tx` for SWAP routes and
`rfq.typedDataToSign` for RFQ routes. One endpoint, two fundamentally different
payloads, distinguished by a field on the quote. Our `swapResponseSchema` models both
as nullable and the caller branches on `executionMode`.

---

## Open questions carried forward from PRD section 32

| # | Question | Status |
|---|---|---|
| 1 | Which wrappers exist for NVDA, TSLA, AAPL, QQQ on BSC today? | Blocked on credentials |
| 2 | Live semantics and values of `tokenToShareRatio` per platform | Blocked on credentials. Blocks all numeric normalization. |
| 3 | Documented and actual xStocks discovery path | Partly answered by F-001. RWA-data coverage still open. |
| 4 | Actual `executionMode` per issuer and pair | Documented (F-001), not observed |
| 5 | Do Ondo/BStock routes need vendor-specific approval in practice? | Documented as required. Not observed. |
| 6 | How often does approval make the original quote stale? | Blocked on credentials |
| 7 | Can RFQ expose a pre-settlement simulation? | Open. Likely a capability request. |
| 8 | p50/p95 latency per endpoint | Blocked on credentials |

---

## F-007 — Simulate response contract is documented on a page the intro pages don't link clearly; its own example contradicts its field table

**Status:** open.
**Classification:** `DOCUMENTATION_AMBIGUITY` (the contradiction), with F-005's `DOCUMENTATION_GAP` for the simulate endpoint now **resolved**: the canonical
`.../rest-api/transaction-api` page documents the full contract (request `{binanceChainId, evmTx:{from,to,value,data}}`;
response `data.{status, failReason, balanceChanges[], allowanceChanges[]}`). Details and exact example: `DOC_ISSUES.md` DOC-005.
Confirmed on the same date that `/swap`'s `data.tx` exposes `from,to,data,value,gas,gasPrice,maxPriorityFeePerGas,minReceiveAmount,slippagePercent`,
so the simulation request can be built from the swap response with no extra inputs.

**Consequence:** live SWAP simulation is implemented (quote -> `/swap` -> `simulate`), failing closed on the contradiction.

---

## F-008 — Flash API (`/quote-and-swap`) and `enableRFQ`: documentation evidence only, not adopted

**Status:** recorded; deliberately not implemented.
**Classification:** `UNRESOLVED`.

Documented on <https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/trading-api> (Flash API section):
`enableRFQ` — "Whether to enable RFQ liquidity sources for routing. Default depends on the token pair: BStock pairs default to `"true"`;
all other tokens default to `"false"` (AMM-only routing)." It applies to `/api/v1/dex/aggregator/quote-and-swap` only; it does not
appear on `/quote` or `/swap`. `/quote-and-swap` documents `vendor` accepting `LiquidMesh` only, and returns quote + built tx in one call.

Taloe keeps `/quote` -> `/swap` and keeps trusting the runtime `executionMode` on each returned route.

**Future experiment (not run, no advantage claimed):** does the single round trip materially reduce quote-expiry failures for
tokenized-equity execution compared with `/quote` -> `/swap`? Measure expiry/failure rate and end-to-end latency for both paths at
$5/$25/$100 during and outside US hours; note the `LiquidMesh`-only vendor restriction limits which routes it can even reach.

---

# Live validation findings (2026-09-21, first authenticated run)

Artifacts: `internal/evidence/runtime/` (see `internal/evidence/LIVE_VALIDATION_REPORT.md`).

## F-001 UPDATE — xStock is absent from live RWA data
**Classification:** `DOCUMENTATION_AMBIGUITY` (Trading docs vs RWA docs), resolved for RWA data by a live observation.
`/rwa/platforms` returns only `ondo` and `bstock` (`raw-platforms-2026-09-21T22-50-20-312Z.json`). The Trading API docs describe xStock (`type=2`, AMM) as first-class;
no xStock token appears in `/rwa/search` or `/rwa/tokens`. Whether xStock is tradable through `/quote` at all was **not tested** (no xStock contract address is discoverable via RWA data).
The earlier expectation "NVDAx exists" is **not supported**; Taloe's two-wrapper thesis rests on Ondo + bStock only.

## F-009 — V1 RWA schemas were wrong; `/rwa/search` is grouped by underlying
**Classification:** `DEVELOPER_ERROR` (guessed schema) / `DOCUMENTATION_GAP` (F-005). `search` returns `[{ticker, companyName, assets:[…]}]`; `underlying-profile`/`-market` take
`(binanceChainId, tokenContractAddress)`, not a ticker; `/quote` `data` is a flat array of routes. Fixed in `schemas.ts`/`rwa.ts`/`trading.ts`.

## F-010 — `POST token/basic-info` reads QUERY parameters and ignores a JSON body; `POST token-balances-by-address` reads a JSON body
**Classification:** `DOCUMENTATION_GAP`. Two POST endpoints in the same API family disagree on where parameters go. A body to `basic-info` answers `40001 "Parameter binanceChainId is required"`
even when `binanceChainId` is in the body. ~10 minutes lost. Raw: see `DX_JOURNAL.md` DX-006.

## F-011 — Identical concurrent requests are rejected as replays unless `X-OC-NONCE` is sent
**Classification:** `DEVELOPER_ERROR` (ours), with a `DOCUMENTATION_AMBIGUITY` note: the docs say the nonce "falls back to X-OC-SIGN if omitted", which means two identical
requests in the same millisecond (same timestamp, same signature) collide as `40103`. Observed 2/79 searches. Fixed with a per-request nonce.

## F-012 — Ondo `NVDAon` routes as `SWAP`, not RFQ; no RFQ observed for any token
**Classification:** `RUNTIME_DIFFERENCE` (single time window, after-hours, wallet supplied). Docs: "Ondo … always routed via 3-vendor RFQ … all routes return executionMode=RFQ".
Live: 80/80 quotes (40 underlyings x 2) + 30 build/simulate calls were `SWAP` via `LiquidMesh`. Not yet reproduced across sessions; not called a defect.
The `RFQ (Ondo)` wording in the `40001` message for a missing wallet suggests the RFQ path is still gated on wallet presence.

## F-013 — Ondo minimum order is $5 USD, undocumented in what we read; USDT is slightly under $1
**Classification:** `DOCUMENTATION_GAP`. `40375 "Minimum order amount is 5 USD."` at exactly 5 USDT (USDT unit price 0.9998). Sizes >= 5.1 USDT work. New business code `40375`.

## F-014 — `/swap` requires `slippagePercent` or `autoSlippage`
**Classification:** `DOCUMENTATION_GAP` (we omitted it; `40001 "either slippagePercent or autoSlippage is required"`). Documented on the reference page; our adapter is fixed (explicit 1%).

## F-015 — Wallet balances: documented path/native convention differ from what works
**Classification:** `DOCUMENTATION_AMBIGUITY`. The path we guessed (`/wallet/all-token-balances-by-address`) 404s; the documented `/balance/all-token-balances-by-address` is paginated (20/page);
`POST /balance/token-balances-by-address` takes tokens explicitly. Native asset is documented as an empty-string contract address but returned as `0xeeee…eeee` (symbol BNB).

## F-016 — `priceImpactPercent` under-reports at size
**Classification:** `UNRESOLVED` (1 observation, would need reproduction before any stronger label). NVDAon @ $10,000: reported `0.7187` (docs: percent) vs measured shortfall 71.7% relative to bStock (12.445 vs 43.970 shares). NVDAon @ $2,000: reported 0.0211 vs measured ~1.5%. `size-probe-2026-09-21T23-16-59-691Z.json`.

## F-017 — `referencePrice` is derived from `tokenPrice`, and differs by wrapper
**Classification:** `DOCUMENTATION_AMBIGUITY`. Documented as "derived from the on-chain token price, not an official quote". `tokenPrice/referencePrice == tokenToShareRatio` for 488/488 tokens.
Different wrappers of one underlying report different reference prices at the same instant (NVDAon 227.225 vs NVDAB 227.083). It is a per-wrapper mark, not an independent stock price.

## F-018 — `assetType` is asset class, not issuer family
**Classification:** `DOCUMENTATION_AMBIGUITY`. RWA docs: 1=Stock, 2=Pre-IPO, 3=ETF. Trading docs map types to issuers (1 Ondo, 2 xStock, 3 BStock). Live data follows the RWA docs (both platforms carry types 1 and 3).

## F-019 — `/rwa/tokens` is incomplete relative to `/rwa/platforms` and `/rwa/search`
**Classification:** `UNRESOLVED`. Ondo BSC: 442 returned vs 458 advertised; bStock 46 vs 77; `AAPLB` (found by search) is missing. Cause unknown (default page limit or filtering; no pagination parameter documented).

## F-020 — Fuzzy `/rwa/search`
**Classification:** `DOCUMENTATION_GAP`. Keyword "QQQ" also returns TQQQ, SQQQ, PSQ. Handled with an exact-ticker-wins rule.

## F-021 — Quote lifetime confirmed
**Classification:** none needed. Documented ~30s; measured buildable at 29.1s and `40401` at 33.5s (n=1 per delay). `ttl-probe-2026-09-21T23-16-18-735Z.json`.

## F-007 UPDATE — the simulate contract holds; the documented contradiction did not reproduce
30 swap simulations and 1 approval simulation: statuses `FAILED` (with a matching revert reason) and `SUCCESS` (`failReason: null`). No `SUCCESS`+`failReason`. Stays `DOCUMENTATION_AMBIGUITY`, not reproduced.


## F-022 — Reading an ERC-20 allowance requires a separate JSON-RPC call; no Binance endpoint reports it
**Classification:** `DOCUMENTATION_GAP`. Neither the Wallet nor the Trading API exposes an ERC-20 `allowance(owner,spender)` read. Taloe now reads it directly via `eth_call` against a BSC RPC (`packages/router-core/src/chain-reader.ts`), independent of the swap-simulation revert text, so "no allowance" and "RPC unreachable" are never conflated.

## F-023 — The approval-transaction endpoint's spender is inside the calldata, not a labeled field
**Classification:** `DOCUMENTATION_GAP`. `/approve-transaction` returns `data`/`dexContractAddress`/`gasLimit`/`gasPrice`; the spender granted by the approval must be decoded from `data` (or cross-checked against the quote's `approveTarget`) rather than read from a field. Taloe's readiness flow cross-checks the simulated `allowanceChanges[].spender` against the quote's `approveTarget` and refuses (`APPROVAL_SPENDER_MISMATCH`) on a mismatch instead of trusting the label.

## F-024 — `priceImpactPercent` unreliable on bStock too, not just Ondo
**Classification:** `UNRESOLVED`, extends F-016. At $100,000: AVGOB reported `0.0895%` while Taloe's recomputed deviation was 5,168 bps (~52% worse per-share price than reference); COINB reported `0.2737%` vs 3,215 bps (~32%); DRAMB reported `0.0159%` vs 170 bps. The field is unreliable on both platforms at size, not an Ondo-specific quirk. `capacity-afterhours-2026-09-22T00-50-38-325Z.json`.

## F-025 — Ondo's failure mode at size is a clean refusal; bStock's is a silent bad-price fill
**Classification:** `EMPIRICALLY_MEASURED` (afterhours session, n=40 underlyings, tickets to $100,000). When Ondo cannot fill a large order it returns `40374 "Insufficient liquidity for a quote"` — no quote, nothing to accidentally execute (15 of 480 wrapper-ticket probes; 1 additional `40367`-style pause). bStock never returned that code in this campaign (0 of 480). Where bStock's depth genuinely runs out at large size (AVGO, COIN, DRAM, each at $100,000) it instead returns an executable quote at a materially worse price — the dangerous failure mode, because it looks tradeable. Taloe's own recomputed deviation gate is what catches this; the sponsor's `priceImpactPercent` does not (F-024). `capacity-report-afterhours-2026-09-22T01-14-08-334Z.json`, field `bidirectionalEvidence`.
