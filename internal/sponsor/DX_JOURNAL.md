# Developer Experience Journal

First-party engineering log. Written as things happen, not reconstructed afterwards.
The DX Report is 25% of the score and every factual claim in it must trace to an entry
here.

Rules:
- No entry may be invented or inferred. If it was not experienced, it is not here.
- A documentation inconsistency is not called a bug until it is reproduced.
- Raw responses are kept with secrets removed.
- Timestamps are UTC.

---

## Onboarding clock

| Milestone | Timestamp (UTC) | Notes |
|---|---|---|
| Hack docs first opened | 2026-09-21 ~18:45 | Started with `llms.txt` index |
| Hackathon registration | not yet | |
| API key requested | not yet | **Blocking.** See `internal/product/BUILD_STATUS.md`. |
| Credentials received | before 2026-09-21 22:49 UTC (exact time not recorded) | |
| First signed request attempted | 2026-09-21 22:49:49Z | `validate:auth` |
| First successful signed request | 2026-09-21 22:49:50Z | HTTP 200, code 0, first try |
| First RWA search | 2026-09-21 22:50:31Z | raw shape differed from our guess |
| First quote | 2026-09-21 22:58:40Z | Ondo `40375` min order; bStock ok |
| First simulation | 2026-09-21 23:00:5xZ | `40001` (no slippage) then `FAILED` allowance |
| First mainnet settlement | not yet | |

Docs-to-first-successful-call time cannot be measured until credentials exist. The
docs-reading portion so far is recorded below.

---

## DX-001 — Documentation host rejects command-line clients

**Timestamp UTC:** 2026-09-21 18:47
**Component:** Documentation site
**Docs URL:** `https://web3.binance.com/en/dev-docs/llms.txt`
**Goal:** Pull the docs index and the per-endpoint markdown into the working
environment so endpoint schemas could be read directly while writing clients.

**Expected:** `curl` returns the markdown, as the `.md` URL suffix and the presence of
an `llms.txt` file both advertise machine consumption.

**Observed:** HTTP `202` with a zero-byte body, consistently, across several attempts
and with a browser `User-Agent` and `Accept` headers set. A browser-based fetch of the
same URL returned the content immediately.

**Business code / HTTP status:** HTTP 202, `Content-Length: 0`.

**Latency:** ~6.8s to the empty 202.

**Time lost:** ~10 minutes.

**Workaround:** fetched through a browser-equivalent client instead of `curl`.

**Still reproducible:** yes, at time of writing.

**Impact on product:** low for us, but notable in kind. An `llms.txt` file exists
specifically so automated agents can consume the documentation, and the edge appears
to bot-challenge exactly those clients. A `202` with an empty body is also the least
diagnosable possible response: it is not an error status, so naive tooling treats it as
success and parses an empty string.

**Suggested platform change:** allow `llms.txt` and the `.md` documentation routes
through the bot challenge, or return `403` with a short explanatory body so the
failure is legible. Serving an empty `202` to an endpoint designed for machine
consumption defeats its purpose.

**Evidence location:** `internal/sponsor/ERROR_LOG.md` DX-001.

---

## DX-002 — Endpoint introduction pages carry no request or response schemas

**Timestamp UTC:** 2026-09-21 18:51
**Component:** Market API / Transaction API documentation
**Docs URL:** `https://web3.binance.com/en/dev-docs/products/market-api/introduction`
and `.../transaction-api/introduction`
**Goal:** Write runtime-validated schemas for the six RWA endpoints and the
transaction simulate endpoint before implementing against them.

**Expected:** based on how thorough the Trading API `integration-flow` page is, the
other introduction pages would carry at least parameter names and response field
names.

**Observed:** both pages list endpoint, method and a one-line description only. No
parameters, no response fields, no status vocabularies. The RWA section is a six-row
table. The Transaction API simulate endpoint, which we intend to use as a hard
pre-signature gate, has no documented response shape on that page at all.

**Time lost:** ~25 minutes of navigation that did not yield the schemas.

**Workaround:** wrote deliberately loose schemas — every uncertain field optional and
nullable, unknown keys preserved — so a wrong guess surfaces as missing data rather
than as a failed call or, worse, a silent zero. Marked the corresponding claim-ledger
rows `UNTESTED`.

**Still reproducible:** yes.

**Impact on product:** real. We cannot write a precise client for the simulation gate,
which is the check standing between a user and signing a failing transaction. The
conservative reading we adopted (anything not an explicit pass is treated as a failed
gate) is safe but will over-refuse if the real status vocabulary differs from our
guesses.

**Suggested platform change:** bring the Market API RWA and Transaction API
per-endpoint reference pages up to the standard the Trading API integration flow
already sets. The gap between those two is wide enough to notice.

**Evidence location:** schemas at `packages/binance-web3/src/schemas.ts`, with the
uncertainty documented in the module header.

---

**AMENDMENT (2026-09-21, later the same day):** the "no schema" observation above is accurate for what was retrieved at the time — the
*introduction* pages. A recheck of the canonical reference page
(`/en/dev-docs/catalog/web3-wallet/api/rest-api/transaction-api`) does expose the full simulate contract (request `evmTx`, response
`status/failReason/balanceChanges/allowanceChanges`). So the finding narrows from "simulate is undocumented" to "the schema lives on a
different page than the one the intro links to, and took ~2 further lookups to find"; the original time-lost figure stands as measured.
The reference page then surfaced a separate issue, recorded as DOC-005 / DX-004. The original entry is otherwise unchanged. Classification stays
`DOCUMENTATION_GAP`, now scoped to discoverability; it is not an `API_DEFECT`.

---

## DX-003 — The `/order/submit` `quoteId` parameter does not take a `quoteId`

**Timestamp UTC:** 2026-09-21 18:53
**Component:** Trading API, RFQ flow
**Docs URL:** `https://web3.binance.com/en/dev-docs/products/trading-api/integration-flow`
**Goal:** Implement RFQ order submission.

**Expected:** a parameter named `quoteId` takes the `quoteId` obtained from `/quote`.

**Observed:** it takes `rfq.orderId` from the `/swap` response. The documentation says
so explicitly and parenthetically flags that it is "not the route identifier", which
suggests this has caught people before.

**Time lost:** none, because the note was read before implementing. Recorded because
the trap is real for anyone who skims.

**Still reproducible:** n/a, documentation observation.

**Impact on product:** would have been a hard-to-diagnose settlement failure. Both
values are opaque strings, so no local check catches the mix-up, and the resulting
error would most likely read as quote expiry.

**Workaround:** named our client parameter `rfqOrderIdFromSwap`.

**Suggested platform change:** rename the field to `rfqOrderId`, or accept either
identifier and resolve it server-side.

**Evidence location:** `packages/binance-web3/src/services/trading.ts`,
`SPONSOR_FINDINGS.md` F-002.

---

## Measurement targets not yet started

These need credentials. Listed so they are not forgotten and not fabricated.

- Docs-to-first-successful-call wall-clock time
- p50/p95 latency for: RWA search, RWA tokens, quote, swap build, simulate, RFQ
  submit, RFQ status, wallet transaction detail
- Real quote lifetime versus the documented 30 seconds
- How often an approval transaction invalidates the quote that preceded it
- Wallet API indexing delay after a mainnet broadcast
- Frequency of HTTP 200 carrying a non-zero business code
- Rate-limit behaviour when quoting several wrappers inside one quote lifetime
- Whether documented per-issuer execution modes hold at runtime
- Whether RWA data covers xStock tokens with the same fields as Ondo and BStock
- Behaviour of Ondo and BStock routes outside US market hours (`40367` / `40369`)

---

## DX-004 — The simulate docs contradict themselves in their own example

**Timestamp UTC:** 2026-09-21 (later session)
**Component:** Transaction API documentation
**Docs URL:** `https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/transaction-api`
**Goal:** Implement simulation mapping for the SWAP gate.
**Expected:** `failReason` populated only with `status=FAILED`, per the field table.
**Observed:** the example response has `status: "SUCCESS"` and `failReason: "execution reverted: ERC20InsufficientBalance"`.
**Time lost:** ~5 minutes; the real cost is a design decision (which field wins) the docs don't answer.
**Workaround:** fail closed on that combination; capture raw payload via an evidence hook. See DOC-005.
**Still reproducible:** yes (documentation). Runtime behaviour: not tested.
**Impact on product:** a naive integration either ignores the revert text (unsafe pass) or treats every SUCCESS with text as failed (over-refuses).
**Suggested platform change:** state the precedence rule and correct the example.
**Evidence location:** `internal/sponsor/DOC_ISSUES.md` DOC-005; tests in `packages/binance-web3/test/transaction.test.ts`.

---

# Live-run entries (2026-09-21)

Docs-to-first-successful-call: docs first opened 18:45Z, first successful signed call 22:49Z (dominated by credential wait; the signing itself worked first try).
Signing from the docs' worked example needed **zero** iterations, which is a genuine strength of the authentication page.

## DX-005 — RWA response shapes are not what a reader infers (schema discovery cost ~35 min)
`/rwa/search` groups by underlying; profile/market need a contract address; `/quote` `data` is a flat array. The rwa-data reference page *does* document most of it
(`.../rest-api/rwa-data`), but it is not linked from the introduction pages that `llms.txt` surfaces, so it took several misses to find. **Suggested:** link reference pages from the introductions; ship one worked example response per endpoint.

## DX-006 — Two sibling POST endpoints disagree on query vs body
`POST market/token/basic-info` reads query params (a JSON body yields `40001 Parameter binanceChainId is required`, misleadingly, because the parameter *was* sent);
`POST balance/token-balances-by-address` reads a JSON body. ~10 min lost, discovered with a 3-variant probe. **Suggested:** accept both, or fix the error to say "parameters must be in the query string".
Evidence: `SPONSOR_FINDINGS.md` F-010.

## DX-007 — `40103` "timestamp expired or replayed" for a request that was neither (our bug, misleading message)
Two identical concurrent requests collide on timestamp+signature. The message points at clock drift. ~15 min. **Suggested:** say "duplicate nonce/signature" and recommend `X-OC-NONCE` in the auth page's own sample client, which sends none.

## DX-008 — Errors that were genuinely good
`40375 "Minimum order amount is 5 USD."`, `40001 "either slippagePercent or autoSlippage is required"`, `40001 "userWalletAddress is required for RFQ (Ondo) quote"`,
`40401 "quoteId=… not found or expired"`, and the simulation `failReason` (`BEP20: transfer amount exceeds allowance`) were all specific and actionable.

## DX-009 — Latency and rate limits (583 authenticated calls)
p50/p95 ms: search 678/1351, tokens 510/872, underlying-market 464/686, price 459/696, quote 637/841, swap 495/820, simulate 556/730, balances 494/577, basic-info 463/1381.
`x-oc-ratelimit-limit: 5` per endpoint (matches docs). No 429 seen at ~3 req/s. Outcomes: 576 success, 4 business `40001`, 2 `40103` (DX-007), 1 `404` (our wrong path).
Cost note: one Taloe decision = ~13-15 sequential calls (≈8-10 s) because market context re-fetches the wrapper set; measurable against a 30s quote life.

## DX-010 — Doc/runtime mismatches worth a redesign
RFQ never observed for Ondo (F-012); xStock absent (F-001); `priceImpactPercent` understates at size (F-016); native BNB address convention (F-015); `assetType` meaning (F-018). Each is classified in `SPONSOR_FINDINGS.md`; none is called a defect.


## DX-011 — No Binance endpoint answers "what is my allowance for this spender"
Every allowance-aware flow (approve, wait, verify) needs this and none of Wallet/Trading/RWA return it. Taloe added a minimal direct RPC reader (`eth_call` to `allowance(address,address)`) rather than depend on a swap simulation's revert text to infer it (F-022). ~30 min including a real BSC RPC call to confirm the calldata encoding.

## DX-012 — Moving simulation off the ranking path only saves requests when candidates are rejected
Measured on 2 live tickers (NVDA, QQQ; `readiness-cost-2026-09-22T00-21-18-561Z.json`): with exactly 2 quoted wrapper candidates, before/after request counts were roughly equal (25 vs 25, 24 vs 27) because the legacy path only ever simulated the routes that existed, same as the new path simulates the one selected route. The saving is proportional to (candidates - 1); it matters once more than 2 issuers or execution modes are quoted per ticker, which the current 2-platform (Ondo/bStock) universe rarely exercises. Recorded honestly rather than inflated.
