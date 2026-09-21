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
