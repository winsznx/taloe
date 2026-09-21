# Assumptions

Things the build currently rests on that are not verified. Each has a stated
consequence if it turns out false. Reviewed whenever a gate closes.

Last reviewed: 2026-09-21.

---

## A-01 — At least one underlying has two or more safely comparable executable wrappers on BSC

**Rests on:** the Trading API documenting three issuer families with overlapping
tickers (NVDAon / NVDAx).

**If false:** the product thesis collapses to single-wrapper execution. PRD 25.2
applies. The honest narrowing would be to lead on execution-mode and session-state
correctness rather than cross-wrapper routing.

**Resolve by:** RWA search for NVDA, TSLA, AAPL, QQQ once credentials exist.

## A-02 — RWA data covers all three issuer families with the same fields

**Rests on:** nothing. The Trading API documents xStock trading; the RWA data surface
is separate and its platform coverage is unconfirmed.

**If false:** xStock routes are executable but not normalizable, so they can be shown
and executed but cannot enter numeric ranking against Ondo or BStock. That is a real
platform gap and belongs in the DX report.

**Resolve by:** `GET /api/v1/dex/market/rwa/platforms`. Cheapest high-value call available.

## A-03 — `tokenToShareRatio` exists and has consistent per-issuer semantics

**Rests on:** the PRD. Not confirmed on any page retrieved this cycle.

**If false:** underlying-equivalent normalization is impossible through this stack, and
Taloe can only compare wrappers that deliver the same token. The claim narrows from
"best underlying-equivalent exposure" to "best executable route for a chosen wrapper".

**Resolve by:** inspecting a live RWA token record.

## A-04 — The simulation endpoint returns a readable pass/fail status

**Rests on:** the canonical reference page (`DOC_VERIFIED` 2026-09-21), whose own example is
internally inconsistent (DOC-005). Live behaviour has never been observed.

**If false:** our conservative parser treats every unreadable result as a failed gate,
so the product over-refuses rather than under-refuses. Safe, but it would block the
SWAP path entirely until the real vocabulary is known.

## A-05 — A 30-second quote lifetime is enough to quote several wrappers and still execute

**Rests on:** the documented TTL and a 5 RPS per-endpoint limit.

**If false:** comparing N wrappers consumes the quote lifetime of the first ones, and
the product needs parallel quoting, a shorter candidate set, or re-quoting the winner
immediately before execution. The last of these is already in the state machine.

**Resolve by:** measuring wall-clock time to quote 2-4 wrappers.

## A-06 — The wallet balances endpoint path is correct

**Rests on:** convention, not a retrieved page. Flagged in `API_MATRIX.md`.

**If false:** balance gates cannot run server-side and must move to the client via the
independent RPC. Low severity, easy fix.

## A-07 — Ondo and BStock market-hours restrictions are real at runtime

**Rests on:** documented errors 40367 and 40369.

**If true, this is valuable:** outside US market hours a single underlying may have
exactly one executable wrapper, which is a concrete demonstration that session context
changes which route exists rather than merely changing a price.

**Resolve by:** quoting the same underlying inside and outside US market hours.
`LiveDiscoveryProvider.getQuotesForCandidate` already translates these two codes into
an attributable `PRE_QUOTE` rejection rather than a generic failure — see
`CLAIM_LEDGER.md` G4 — but this has never been exercised against a live response.

---

## A-08 — The `token/basic-info` endpoint reliably returns `decimals` for USDT

**Rests on:** the Market API introduction listing this endpoint's purpose, not a
retrieved response shape.

**If false:** `LiveDiscoveryProvider.resolveSpendAsset` fails closed with
`SPONSOR_UNAVAILABLE` rather than assuming 18 decimals (correction 2's explicit
requirement). The product would be unable to compute any spend amount in live mode
until this is fixed, which is the honest failure mode — better than a silently wrong
amount.

**Resolve by:** `pnpm validate:auth` first (confirms signing), then inspect a real
`token/basic-info` response for USDT's BSC contract address.

## A-09 — Live SWAP simulation (RESOLVED structurally, unverified live)

**History:** V2 recorded this as a not-wired gap because the simulate contract had not been found.
The canonical `transaction-api` reference page documents it, and `/swap` `data.tx` supplies every input.

**Current state:** implemented (`LiveDiscoveryProvider.simulateRoute` -> `/swap` -> `POST /simulate`), covered by mocked-service tests.
Three separate statuses: implementation `IMPLEMENTED_UNVERIFIED`, documentation `DOC_VERIFIED` (with the DOC-005 contradiction),
runtime `BLOCKED_CREDENTIALS`.

**Still assumed:** that live `status` values are exactly `SUCCESS`/`FAILED`, and that `SUCCESS`+`failReason` is rare or absent.
Anything else fails closed and over-refuses rather than under-refuses.

**Resolve by:** `pnpm validate:simulation --ticker NVDA --wallet 0x...`.

## A-10 — The wallet-balances response places native BNB under a documented convention

**Rests on:** nothing. Explicitly not assumed.

**Current state:** `LiveDiscoveryProvider.getWalletBalances` always returns
`gasBalanceWei: null` (not checkable) rather than guessing that BNB appears at a zero
address or under a particular symbol in the same token list the USDT balance comes
from.

**Consequence:** the `INSUFFICIENT_GAS` gate can never fire in live mode until this is
resolved — a route could be recommended that the user cannot actually afford to
execute due to gas. This is a real, currently-live product gap, not a hypothetical.

**Resolve by:** inspect a live `all-token-balances-by-address` response for a wallet
holding BNB, or find the correct native-balance endpoint if it is separate.
