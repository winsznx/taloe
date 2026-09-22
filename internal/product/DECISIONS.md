# Decisions

Engineering decisions with consequences, and the reasoning behind them. Reversal
requires a new entry, not an edit.

---

## D-001 — pnpm workspace with source-level package imports

**Date:** 2026-09-21

Seven packages per PRD 9.1. Packages export TypeScript source directly rather than
building to `dist`, and the web app transpiles them. No build step between editing a
router rule and seeing it in the app, and no stale-artifact class of bug during a
three-week window.

Trade-off: packages are not independently publishable. Not a goal.

## D-002 — Node 24, TypeScript 7, Next 16, React 19, Zod 4, Vitest 5

**Date:** 2026-09-21

Current versions at initialization, pinned by lockfile as the PRD requires. TypeScript
7 is the native compiler and typechecks the workspace in well under a second, which
matters when the honesty rules live in the type system.

## D-003 — All amounts are base-unit integer strings; arithmetic is 1e18 fixed point

**Date:** 2026-09-21

Taloe compares routes that differ by single basis points and enforces a user
constraint expressed in basis points. IEEE-754 is not acceptable anywhere near that.
Every quantity crosses a module boundary as a base-unit integer string plus decimals,
and `packages/shared/src/money.ts` is the only place arithmetic happens.

`fromDecimalString` **rejects** more than 18 decimal places rather than truncating: an
input we cannot represent exactly is a bug, not a rounding event.

## D-004 — Adapters return `Result`, they do not throw

**Date:** 2026-09-21

Sponsor failures carry product meaning. A paused issuer, an expired quote and a region
block are all things the router must reason about and the user must be told about.
Exceptions unwind past exactly the code that should be handling them. Only genuine
programmer errors throw.

## D-005 — One signing implementation, no exceptions

**Date:** 2026-09-21

All signing lives in `packages/binance-web3/src/signing.ts` and every call goes through
`BinanceWeb3Client.request`. The `/build` prefix rule, raw-query preservation, the
business-code check and DX instrumentation therefore cannot drift between call sites.
The client constructor throws if the base URL lacks `/build`, because the resulting
`40102` looks like a credential problem and wastes hours.

## D-006 — Sponsor schemas are loose and nullable by default

**Date:** 2026-09-21

Driven by `SPONSOR_FINDINGS.md` F-005: the RWA and Transaction introduction pages
carry no response schemas. A strict schema built on guessed field names would fail
every call. A cast would make a wrong guess read as a silent zero, which is worse.

So: unknown keys preserved, uncertain fields optional and nullable, and a missing field
propagates as null into a router that already treats null as "cannot compare".

**Revisit** the moment live responses are observed. Tighten the schema and move the
ledger row in the same commit.

## D-007 — Never interpret `tokenToShareRatio` until its direction is observed

**Date:** 2026-09-21

The PRD's hardest rule (10.5), and the one most tempting to break, because
implementing it would make the demo look complete.

Getting the direction backwards silently inverts every cross-wrapper comparison and
produces confident, wrong recommendations. There is no test that catches it and no
user-visible symptom.

So each issuer gets an adapter declaring its own direction and evidence status, and all
three currently return null. Consequence, stated plainly: **cross-wrapper numeric
ranking does not currently work.** Routes are compared on executable output only, and
wrappers delivering different tokens are not compared at all. That is the honest
position until a live ratio is observed.

## D-008 — Ranking is lexicographic, not weighted

**Date:** 2026-09-21

PRD 11.7 forbids hidden weights before the campaign. A weighted score also lets a bad
dimension be compensated by a good one and makes "why this route?" unanswerable.

Ordered criteria instead: exposure, then price impact, then fees, then freshness. The
first criterion that separates two routes decides, and that criterion is the selection
reason shown to the user. A missing fee **defers** rather than counting as zero, so an
unreported fee cannot win by looking free.

## D-009 — Inability to check a constraint is never treated as the constraint passing

**Date:** 2026-09-21

The rule that gives `UNKNOWN` its reason to exist.

If there is no trustworthy reference price, the user's deviation limit was never
actually tested. A route can then clear every gate we could run and still not be
recommendable, because returning `ACT` would claim an enforcement that did not happen.
The engine returns `UNKNOWN` with `REFERENCE_CONTEXT_UNAVAILABLE`.

Same rule for simulation: a result we cannot read as an explicit pass is `NOT_RUN`,
which fails the gate.

## D-010 — SWAP and RFQ are two state machines

**Date:** 2026-09-21

Per PRD 12, and enforced structurally: separate transition tables, validated
transitions, and no edge from `BUILD_SWAP` to `USER_SIGN_SWAP` that skips simulation.
The RFQ table has no simulation step at all, because the client holds no transaction to
simulate, and the SWAP table has no vendor-pending state.

A generic `getQuote -> sendTransaction` path would have to either fabricate a
simulation for RFQ or treat a vendor acknowledgement as an on-chain result.

## D-011 — A broadcast is never reported as success

**Date:** 2026-09-21

`verificationFor` maps every state between broadcast and independent confirmation to
`PENDING_VERIFICATION`. There is no transition from `BROADCAST_SWAP` to
`VERIFIED_SUCCESS`. RFQ `FILLED` is not terminal either; it leads to `VERIFY_TX_HASH`.

## D-012 — Issuer execution modes are documented but not hardcoded

**Date:** 2026-09-21

The current docs state Ondo routes as always-RFQ, xStock as always-SWAP and BStock as
mixed. We record that as a documented expectation to test against, and still branch on
the `executionMode` each quote actually returns. Issuer behaviour changes; the PRD
anticipated this, and the doc itself says the quote response is what tells you the flow.

## D-013 — No silent fallback from live to fixtures

**Date:** 2026-09-21

`TALOE_DATA_MODE` is explicit and surfaced in the UI. A live call that fails surfaces
as an error. A product that quietly serves fixtures when the sponsor API is down would
make every demo and every measurement worthless.

## D-014 — Evidence recording can never break the request path

**Date:** 2026-09-21

`EvidenceRecorder.record` does not throw; failures are counted and reported out of
band. Per PRD 21, a user's ability to get a quote must not depend on an analytics
write.

Related: `summarizeLatency` returns null percentiles below 20 samples rather than
computing a p95 from three data points.

---

## Controlled continuation (build report V1 review)

The reviewer accepted V1 and issued four architecture corrections plus a mandate to
complete the consumer journey structurally in fixture mode. Decisions below implement
that review.

## D-015 — Issuer normalizers are independent objects with their own evidence, not one formula keyed by an enum

**Date:** 2026-09-21 (correction 1)

V1's `normalization.ts` already refused to interpret `tokenToShareRatio` — but it did
so through one shared `RatioDirection` enum and evidence status (`UNVALIDATED` /
`DOC_VERIFIED` / `EMPIRICALLY_MEASURED`) applied uniformly across issuers. The review
flagged a subtler risk: nothing structurally prevented a future edit from reasoning
"Ondo and BStock probably work the same way" and promoting both at once from one piece
of evidence.

Replaced with `ISSUER_NORMALIZERS`: each issuer is its own object with its own
`semantics` (`DOCUMENTED` | `EMPIRICALLY_OBSERVED` | `UNKNOWN`), its own `provenance`,
its own `relatedSignals` (evidence that touches the issuer but does NOT establish
semantics on its own — see D-016), and its own `normalize` function. Promoting one
issuer out of `UNKNOWN` means writing that issuer's own function against that issuer's
own evidence; it cannot happen as a side effect of another issuer's evidence changing.

## D-016 — "Related" evidence is a distinct field from "provenance", and never gets promoted automatically

**Date:** 2026-09-21 (correction 1)

The Binance Wallet Skills documentation references an Ondo-specific "shares
multiplier" in the Agentic Wallet stock-trading use case. It is tempting to read this
as confirmation of the RWA API's `tokenToShareRatio` direction: same issuer, similar
concept, right there in the docs.

It is not confirmation. It is a different API surface, different terminology, and
there is no stated guarantee it describes the same quantity the same way. Recording it
under `provenance` — the field that actually justifies a `semantics` upgrade — would
plant exactly the kind of unearned confidence this file exists to prevent, and it would
look identical to real evidence six months later when nobody remembers the distinction.

So it lives in `relatedSignals`: visible, worth checking first when live validation
starts (`ticker.ts` in the validation harness says so directly), and structurally
incapable of raising `semantics` above `UNKNOWN` by itself.

## D-017 — Decimals are a property of an `AssetMetadata`, never a call-site constant

**Date:** 2026-09-21 (correction 2)

`packages/shared/src/money.ts` already took `decimals` as a parameter on every
conversion — the review's finding was that a call site (`apps/web`'s original
`/route` page) still hardcoded `USDT_DECIMALS = 18` when building the intent, because
BEP-20 USDT on BSC does happen to use 18. True today; not a rule.

`packages/shared/src/asset.ts` adds `AssetMetadata` and `toBaseUnitAmount` /
`fromBaseUnitAmount`, which take the asset alongside the amount so a bare number
cannot travel through a conversion without its precision attached. The live
`resolveSpendAsset` (`LiveDiscoveryProvider`) resolves USDT's decimals from a live
`token/basic-info` call and fails closed — `SPONSOR_UNAVAILABLE`, not an assumed 18 —
if that call doesn't return a decimals field. Fixture mode declares its decimals
explicitly in `FixtureDiscoveryProvider`'s asset record. Tested at 6, 8 and 18
decimals in `packages/shared/test/asset.test.ts`.

## D-018 — Route rejections carry a `stage`: PRE_QUOTE vs GATE

**Date:** 2026-09-21 (correction 3)

V1's tradability gate already refused to treat a closed underlying market as an
automatic block — only an explicit halt signal did. The review asked for something
V1 didn't yet have a mechanism for: a SPECIFIC issuer's API refusing to quote at all
(the documented Ondo/BStock market-hours business codes, `40367`/`40369`) needs to
show up as an attributable rejection for THAT wrapper, while a different wrapper for
the same underlying proceeds normally.

`RouteRejection.stage` distinguishes a candidate that never reached a quote
(`PRE_QUOTE`, e.g. `OUTSIDE_TRADING_HOURS`) from one that had a quote and failed a gate
(`GATE`). `evaluateRoutes` now accepts `preRejectedCandidates` and folds them into the
outcome: if some candidates quote and pass, the pre-rejected ones are just alternatives
excluded for a stated reason; if none do, it's a genuine `REFUSE` rather than
`UNKNOWN` — candidates existed and were refused for real reasons, which is different
from finding nothing at all.

`LiveDiscoveryProvider.getQuotesForCandidate` implements the live half: a
`40367`/`40369` business code becomes a `PRE_QUOTE` rejection rather than a generic
sponsor failure. `FixtureDiscoveryProvider`'s `TSLA` scenario is the flagship
demonstration — Ondo pre-rejected under a closed session, BStock's SWAP route
unaffected and winning — covered end to end in
`packages/router-core/test/orchestrate.test.ts`.

## D-019 — `EXECUTED_PENDING_VERIFICATION` / `VERIFYING` sit between sponsor settlement and Taloe's own terminal claim, for both modes

**Date:** 2026-09-21 (correction 4)

V1 already refused to call a SWAP broadcast "success." What it did not yet do
consistently: RFQ's `FILLED` transitioned straight into a generic verification step
named `VERIFY_TX_HASH`, and SWAP's `CHAIN_PENDING` transitioned straight to
`INDEXING_PENDING`/`VERIFIED_SUCCESS` without a named boundary between "the chain/vendor
confirmed" and "Taloe confirmed."

Both `SWAP_STATES` and `RFQ_STATES` now route every settlement signal — SWAP chain
confirmation, RFQ `FILLED` — through `EXECUTED_PENDING_VERIFICATION` then `VERIFYING`
before either terminal claim is reachable. Neither state exists for SWAP alone or RFQ
alone; the review's instruction was explicit that this separation applies to "the same
AMM broadcast/execution" too, not just RFQ.

What is NOT changed: a definitively negative sponsor-native signal (a chain-level
revert, an RFQ order the vendor marks `FAILED`) still reaches `VERIFIED_FAILURE`
directly, without an extra verification pass — there is nothing to independently check
about a transaction the sponsor itself already says did not happen. Only a POSITIVE
sponsor-native signal is held back from being Taloe's own claim.

`VERIFICATION_FAILED` is new as a distinct terminal state from `VERIFIED_FAILURE`: the
former means "we could not confirm either outcome," the latter means "we confirmed it
did not work." Conflating them would let an inconclusive check read as a confirmed
failure, which is its own kind of dishonesty.

## D-020 — Product pages are pure functions of their URL; no session store exists yet

**Date:** 2026-09-21 (Gate G)

The PRD's route map (8.3) implies persisted route/execution sessions
(`/route/[routeSessionId]`, PRD 21's Postgres store). That store does not exist yet
and building a fake one — an in-memory `Map` that would not survive a redeploy or a
second instance — would be worse than admitting the gap: it would look like
persistence in a demo and silently lose state in anything resembling production.

Instead, `/route`, `/review`, `/execution` and `/receipt` all take their state as
query parameters and re-derive everything else: discovery is deterministic per ticker
(fixture mode) or will be deterministic by construction (live mode, once wired), and
`/execution` / `/receipt` compute "what state should be showing" as a pure function of
`Date.now() - startedAt` against a scripted timeline (`fixture-execution-timeline.ts`)
rather than mutable server state. A browser refresh or a second tab shows the correct
point in the process every time, because there is no other state to fall out of sync.

This is an honest simplification, not the PRD's intended final shape — a real
persisted session store is still future work, tracked in `BUILD_STATUS.md`.

## D-021 — Lint toolchain pinned to TypeScript 6.x and ESLint 9.x; `next lint` replaced with direct ESLint

**Date:** 2026-09-21

Two real ecosystem gaps hit while wiring `pnpm lint` for the first time (it existed as
a script since Gate A but had never actually been run):

1. `typescript-eslint` (all published versions as of this build) declares a peer range
   of `typescript >=4.8.4 <6.1.0` and hard-fails on TypeScript 7.0.2, which this
   workspace had been running since Gate A. TS 7 is a very recent major (the native
   Go-based compiler rewrite); tooling has not caught up. Downgraded the workspace to
   TypeScript `^6.0.3`, the latest release the lint toolchain actually supports.
2. Next.js 16 removed the `next lint` command entirely in favour of running ESLint
   directly. `apps/web/package.json`'s `lint` script now runs `eslint .` against a flat
   config (`eslint.config.mjs`) that imports `eslint-config-next/core-web-vitals` and
   `eslint-config-next/typescript` directly as flat-config arrays — NOT through the
   legacy `FlatCompat` eslintrc shim, which crashes with a circular-JSON error when it
   tries to reinterpret an already-flat `eslint-plugin-react` config as legacy shape.
   Also pinned ESLint to the latest 9.x rather than 10.x for the same reason
   `eslint-config-next` is built and tested against.

`pnpm lint` is clean as of this commit and caught real issues once it ran: several
`<a>` tags that should have been `next/link`'s `Link`, an unused import, and several
genuine `react-hooks/purity` findings (`Date.now()` calls during render) — two of
which were removed outright (an internal correlation id that never needed real
entropy), and three of which are legitimately time-dependent and carry a scoped,
justified `eslint-disable-next-line` rather than a blanket suppression.


---

## Pre-live lock

## D-022 — Simulation contradiction fails closed; no precedence rule is invented

**Date:** 2026-09-21

The docs' own simulate example pairs `status: SUCCESS` with a revert-style `failReason`. Ignoring `failReason` would risk an unsafe pass;
treating every non-empty `failReason` as FAILED would invent semantics. `TransactionService.simulate` maps this one combination to `NOT_RUN`
(never PASS, never FAIL), passes the raw payload to an optional evidence hook, and the router gate refuses. Revisit only with runtime evidence.

## D-023 — "Attempted but unusable" is distinct from "not simulated yet"

**Date:** 2026-09-21

Writing the mixed-candidate test exposed a hole: the gate tolerated `NOT_RUN` as "no simulation yet", so a malformed or contradictory sponsor
response (mapped to `NOT_RUN`) would have passed. `simulationAttempted` now separates the two. Without a wallet, ranking may still recommend
(no `from` address exists to simulate); once attempted, only PASS clears the gate. `/review` additionally hides Confirm unless a SWAP simulation is PASS.
One issuer's failure only rejects that candidate.

## D-024 — `LiveDiscoveryProvider` lives in `router-core`

**Date:** 2026-09-21

So the product and `pnpm validate:route` run the same code. It takes a minimal structural `LiveSponsorServices`; `server-only` protection remains on
`apps/web/src/server/discovery.ts`, its only importer in the app.

## D-025 — Flash API is documented, not adopted

**Date:** 2026-09-21

`/quote-and-swap` would remove a round trip but skips per-route comparison and only reaches LiquidMesh. No advantage is claimed until measured (F-008).

---

## Live validation

## D-026 — Ondo promoted to EMPIRICALLY_OBSERVED, bStock to DOCUMENTED; each on its own evidence
2026-09-21. Direction (shares-per-token) is Binance's documented definition; Ondo is additionally confirmed by executable prices on ratio 4.0 and 10.03 tokens. bStock ratios are all
within 0.4% of 1, so prices cannot discriminate: it stays DOCUMENTED and carries a demotion condition. Ondo issuer docs were not consulted (recorded gap).

## D-027 — The deviation gate compares per-SHARE price to a per-share reference
A per-token comparison would have refused CRWDon at +29,986 bps. When the issuer's semantics are UNKNOWN or the ratio is missing, deviation is uncomputable and the outcome is UNKNOWN (never a silent pass).
The wrapper's own `referencePrice` is used when no underlying context exists; the reference ablations also remove it.

## D-028 — Exact-ticker search wins; only non-exact queries are ambiguous
Live search is fuzzy (QQQ -> TQQQ, SQQQ, PSQ). An exact ticker is not ambiguous.

## D-029 — Explicit 1% slippage when building a swap for simulation; per-request nonce on every call
`/swap` requires a slippage bound; an explicit reviewable number is used instead of vendor autoSlippage. Provisional. A unique nonce prevents replay collisions.

## D-030 — `priceImpactPercent` is not trusted as a gate input
Kept as recorded data. The reference-deviation gate is the authority (F-016).


## D-031 — Market decision and execution readiness are two pipelines, not one
Simulation moved out of `evaluateRoutes`/`runRouteDiscovery` entirely and into `prepareExecution` (`packages/router-core/src/readiness.ts`), which runs once, only on the selected route (and, on a non-allowance failure, the next candidate). The engine's own hard simulation gate (`gates.ts`) is unchanged and is reused by readiness for the final swap check, so there is exactly one place that decides "PASS is required," not two competing ones.

## D-032 — Allowance is read from the chain, never inferred from a failed simulation
A swap-simulation revert text is vendor- and token-specific and cannot be trusted to mean "no allowance" specifically. `readErc20Allowance` (`chain-reader.ts`) performs a raw `eth_call` and is the only source of truth for allowance state; an unreadable allowance stops the whole readiness attempt (every candidate shares the same wallet) rather than being treated as zero.

## D-033 — An approval requests exactly the trade amount, never unlimited
`buildApprovalTransaction` is always called with `required = route.quote.fromTokenAmount`, not `MaxUint256`. This is a product safety choice: an unlimited approval outliving the trade is a decision for the user to make explicitly, not a default Taloe sets for them.

## D-034 — SafeExecutionCapacity is evidence-only until the campaign says otherwise
No closed-form liquidity curve is invented. Capacity is a bracket between the largest quoted-safe ticket and the smallest quoted-breach, derived by `deriveSafeCapacity`. The product only surfaces it (`/route`'s capacity panel) above a $500 ticket, and only from quotes taken in that same request — never from the campaign artifacts, which age immediately.
