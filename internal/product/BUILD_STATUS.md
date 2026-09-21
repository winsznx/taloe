# Build Status

**Updated:** 2026-09-21 (pre-live lock)
**Submission lock:** 2026-10-11 12:00 UTC
**Internal Valid Submission V0:** 2026-10-10 12:00 UTC

---

## Gate status

| Gate | Scope | Status |
|---|---|---|
| A — Repository foundation | pnpm workspace, TypeScript, tests, env, package boundaries | **PASS** |
| B — Domain model | Typed primitives, WrapRoute gates, ranking, all 5 decision outcomes | **PASS** |
| C — Binance client foundation | Signing, adapters, schemas, error normalization, DX hooks, live discovery boundary | **PARTIAL** — structurally complete including quote -> `/swap` -> simulate; nothing live-verified |
| D — Discovery + SessionMark | Search, wrapper discovery, session context | **PASS in fixture mode** — orchestration (`runRouteDiscovery`) drives discovery, quoting, and simulation end to end against 12 named fixture scenarios; live wiring exists but unverified |
| E — Quote + WrapRoute | Real candidates, RFQ/SWAP separation, gates, ranking, issuer-specific normalization | **PASS in fixture mode** — including the correction-3 issuer-divergence mechanism (one issuer pre-rejected under a closed market, another survives) |
| F — Simulation | Simulation as a hard pre-sign gate | **PASS structurally (fixture + mocked live adapter)** — implementation `IMPLEMENTED_UNVERIFIED`, docs `DOC_VERIFIED` (one contradiction, DOC-005), runtime `BLOCKED_CREDENTIALS` |
| G — Product UI | End-to-end manual journey | **PASS, structurally, in fixture mode** — all 8 required routes exist, build, and were smoke-tested via a running server through every fixture scenario and the full execution/receipt timeline. No live wallet SDK. No persisted session store (pages are pure functions of their URL — see DECISIONS.md D-020). |
| H — Live mainnet proof | Small BSC execution, independently verified | **BLOCKED** — credentials and funded wallet |
| I — Evaluation campaign | Baselines, ablations, measured evidence | **BLOCKED** — depends on H |
| J — Agentic Wallet | Constrained execution surface | **NOT STARTED** (correctly gated behind core path, explicitly deferred this round) |
| K — Agent Studio | Route Watch | **NOT STARTED** (optional, evidence-gated, explicitly deferred this round) |

---

## What changed this cycle (controlled continuation)

Four architecture corrections from the V1 review, all implemented and tested:

1. **Issuer-specific normalization** (`normalization.ts` rewritten). Each issuer —
   Ondo, BStock, xStock — is now its own object with its own `semantics`
   (`DOCUMENTED`/`EMPIRICALLY_OBSERVED`/`UNKNOWN`), its own `provenance`, its own
   `relatedSignals` (evidence that touches the issuer but does not confirm anything —
   the Wallet Skills Ondo multiplier lives here, explicitly not treated as proof), and
   its own `normalize` function. All three remain `UNKNOWN` and fail closed. See
   DECISIONS.md D-015/D-016.
2. **Asset-aware amounts** (`packages/shared/src/asset.ts`, new). `AssetMetadata` +
   `HumanAmount` replace the one remaining hardcoded-18-decimals call site (the
   original `/route` page). Tested at 6, 8 and 18 decimals. Live USDT decimals are
   resolved from a real `token/basic-info` call and fail closed if unavailable — never
   assumed. See DECISIONS.md D-017.
3. **Issuer-divergence under a closed market** (`RouteRejection.stage`,
   `preRejectedCandidates` in the engine). A closed session is still context, never a
   blanket allow or refuse; a SPECIFIC issuer's documented market-hours business code
   now produces an attributable `PRE_QUOTE` rejection for that candidate alone, while
   another issuer's route proceeds normally. Demonstrated end to end by the `TSLA`
   fixture scenario. See DECISIONS.md D-018.
4. **Sponsor/chain-native settlement vs Taloe's own verification** (both execution
   state machines reworked). `EXECUTED_PENDING_VERIFICATION` -> `VERIFYING` sits
   between a positive sponsor signal (SWAP chain confirmation, RFQ `FILLED`) and
   either terminal claim, for both modes. A negative sponsor signal still reaches
   `VERIFIED_FAILURE` directly — nothing to independently check about a confirmed
   failure. New `VERIFICATION_FAILED` terminal state for a genuinely inconclusive
   check, distinct from a confirmed one. See DECISIONS.md D-019.

Plus, not corrections but explicitly requested completions:

5. **Full consumer journey**, structurally complete in fixture mode: landing, route
   (all 5 outcomes + disambiguation), review (with live-shaped simulation call,
   quote-freshness gating that blocks signing on an expired price), execution
   (step-by-step, semantic status region, auto-polling), receipt (independent
   verification framing), plus `/about/how-it-works` and `/activity`. No persisted
   session store exists — every page is a pure function of its URL (D-020), which is
   an honest simplification of the PRD's `[routeSessionId]` shape, not the final
   architecture.
6. **Live validation harness** (`scripts/validate/*`, new). Six runnable commands
   (`pnpm validate:auth/platforms/ticker/quotes/simulation/all`) that use the exact
   same signed client and adapters the product uses, capture raw NDJSON evidence with
   credentials redacted, and print next-action guidance pointing at the specific
   ledger rows each result should update. All verified to fail cleanly and honestly
   with `BLOCKED_CREDENTIALS` in the absence of a key — no crash, no silent fake data.
7. **Fixture mode is now real**, not a placeholder. 12 named, deterministic scenarios
   (keyed by ticker) exercise `ACT` (plain and with issuer divergence), `NO_ACTION`,
   `REFUSE` (5 distinct reasons: deviation, expiry, simulation, balance, unsupported
   mapping), `UNKNOWN` (no context, sponsor unavailable, unrecognized query), and
   `MANUAL_REVIEW` (genuine disambiguation with two distinct companies).
8. **Lint actually runs now.** It existed as a script since Gate A but had never been
   executed; running it for the first time surfaced a TypeScript-7-vs-typescript-eslint
   incompatibility and a Next-16-removed-`next-lint` gap, both fixed. See DECISIONS.md
   D-021. `pnpm lint` is clean.

---

## Verification evidence for this cycle

```
pnpm typecheck   -> clean, 7/7 packages
pnpm test        -> 157 tests passing, 11 files
pnpm lint        -> clean
pnpm build       -> succeeds, 8 routes (4 static, 4 dynamic)
pnpm validate:*  -> all 6 commands fail honestly with BLOCKED_CREDENTIALS (expected — no key)
```

Manual smoke test against a running production build: all 12 fixture scenarios
rendered correct outcome copy; full route -> review -> execution -> receipt chain
walked for `SWAP_SUCCESS` (reaches `VERIFIED_SUCCESS`), `SWAP_CHAIN_FAILURE` (reaches
`VERIFIED_FAILURE`), and `SWAP_VERIFICATION_INCONCLUSIVE` (reaches
`VERIFICATION_FAILED`) — the three terminal states correction 4 exists to distinguish.

---

## What is deliberately NOT implemented

Honest gaps, not oversights, all newly precise this cycle:

1. **No issuer normalization is active** (unchanged from V1, now issuer-specific —
   see correction 1 above). Cross-wrapper numeric ranking is inert until a live ratio
   is observed and one issuer's evidence justifies its own normalizer.
2. **Live SWAP simulation is wired but never run live** (ASSUMPTIONS A-09 resolved structurally). The documented
   `SUCCESS`+`failReason` contradiction fails closed.
3. **No live wallet balance for native gas.** `LiveDiscoveryProvider.getWalletBalances`
   returns `gasBalanceWei: null` rather than guessing a convention (ASSUMPTIONS A-10).
4. **No real wallet SDK.** The "connect wallet" control on the landing page attaches a
   fixed demo address via a checkbox; there is no viem/wagmi wallet adapter yet. Signing
   states (`USER_SIGN_SWAP`, `USER_SIGN_EIP712`) are modelled and shown in the fixture
   execution timeline but nothing actually prompts a real wallet.
5. **No persisted session store.** See D-020. `/route/[routeSessionId]` from the PRD's
   route map is currently `/route?q=...&amount=...` — same information, no database.
6. **No live call has ever been made.**

---

## Blocking on a human

| # | Need | Blocks | Why it cannot be worked around |
|---|---|---|---|
| 1 | Binance Web3 API key and secret from the Developer Portal | Gates C/D/E/F live verification, H, I | Every sponsor claim stays `BLOCKED_CREDENTIALS`. The harness (`pnpm validate:*`) is ready to run the moment this exists. |
| 2 | Hackathon registration | Submission | Deadline-bound |
| 3 | A BSC wallet with a small USDT balance and BNB for gas | Gate H | PRD acceptance criterion 11 requires one verified mainnet execution |
| 4 | Visual inspiration images | Final UI styling | Explicitly deferred by the PRD; build proceeds with restrained temporary styling |

Item 1 remains the sole critical-path blocker. Everything on the other side of it
(Gates D, E, F live verification, H, I) is ready to execute the moment it clears —
that readiness is exactly what this cycle's work produced.

---

## Thesis health

Unchanged from V1's positive finding, now backed by a working fixture demonstration
rather than just documentation reading: the Trading API's three-issuer-family split
(Ondo RFQ-only, xStock AMM-only, BStock mixed) plus documented per-issuer market-hours
restrictions gives Taloe a real, demonstrable case where session and issuer context —
not just price — determine which route is executable. The `TSLA` fixture scenario
proves the MECHANISM works; it does not yet prove Binance's live data actually behaves
this way. That is still `UNTESTED` (CLAIM_LEDGER D9).

## Next actions, in order

1. Obtain API credentials.
2. `pnpm validate:auth` — confirms signing works against the live gateway.
3. `pnpm validate:platforms` — answers SPONSOR_FINDINGS F-001's open half (does RWA
   data cover xStock, not just the Trading API).
4. `pnpm validate:all` — runs the Gate 1 seam-validation sequence for NVDA/TSLA/AAPL/
   QQQ and drafts `VALIDATION_REPORT.md`.
5. `pnpm validate:ticker --ticker <T>` for every ticker with 2+ platforms — observe
   real `tokenToShareRatio` values, then write ONE issuer's bespoke `normalize`
   function against that issuer's own evidence (never all three at once).
6. `pnpm validate:quotes --ticker <T> --amounts 5,25,100` — confirms runtime
   `executionMode` per issuer against the documented defaults.
7. Wire `LiveDiscoveryProvider.simulateRoute` to `TradingService.buildSwap`'s output
   (ASSUMPTIONS A-09) once a live `/swap` response shape is confirmed.
8. Add a real wallet adapter (viem + a connector) once the manual flow is validated
   against live data — signing states already exist in the state machine and UI.


---

## Pre-live lock addendum

- Live SWAP simulation implemented end to end (quote -> `/swap` -> `POST /simulate`), fail-closed on the documented contradiction; a hole where an
  unusable simulation could pass the gate was found by test and fixed (DECISIONS D-023). `/review` never offers Confirm without a SWAP simulation PASS.
- `pnpm validate:route --ticker NVDA --amount 5 [--wallet 0x...]` produces one evidence bundle (intent, wrapper universe, RWA context, quotes,
  modes, normalization status, rejections, simulations, decision, API timing) with no signing or broadcast.
- 157 tests / 11 files; lint, typecheck, build clean. First git checkpoint created.
- Still `BLOCKED_CREDENTIALS`: every live claim. Still open: native-gas balance (A-10), normalization semantics (all `UNKNOWN`), wallet SDK, session store.
