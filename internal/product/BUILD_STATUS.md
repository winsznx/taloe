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
| H — Live mainnet proof | Small BSC execution, independently verified | **PASS** (2026-10-11) — real $10 USDT->NVDAon trade, approval + mandatory re-quote + swap, both tx hashes on-chain, verified by balance delta not just tx status. See `LIVE_MAINNET_TRADE.md`. |
| I — Evaluation campaign | Baselines, ablations, measured evidence | **PASS** — capacity, falsification and static-baseline campaigns against live data (see `CAPACITY_VALIDATION_REPORT.md`, `STATIC_BASELINE_FALSIFICATION_REPORT.md`) |
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

---

## Live validation addendum (2026-09-21)

First authenticated run completed. **Verdict: REVISE** (`internal/evidence/LIVE_VALIDATION_REPORT.md`). Thesis mechanism survives (Ondo + bStock coexist and are both executable on 40 underlyings; wrapper choice is decisive at size);
the small-size price advantage does not (median 7 bps). Six implementation bugs found and fixed by live data (RWA/quote schemas, basic-info params, balances path, swap slippage, replay nonce, per-token-vs-per-share deviation) plus exact-ticker search.
Open: allowance-aware pre-sign ordering (fresh wallets fail the simulation gate), no wallet adapter, session-context and RFQ behaviour unverified (after-hours run only).
Gate H (mainnet fill): **NOT ready.** Changes are uncommitted; raw artifacts are local-only (gitignored) pending curation.

---

## Capacity validation addendum (2026-09-22)

Product revision executed: thesis moved to size-aware execution routing (`PRD_REVISION_1.md`). Pipeline split into MARKET DECISION (no simulation) and EXECUTION READINESS
(`packages/router-core/src/readiness.ts`, `chain-reader.ts`): `APPROVAL_REQUIRED` is now a first-class state, allowance is read on-chain, approvals are simulated and
spender-checked before being offered, and a stale quote is never reused after approval. `SafeExecutionCapacity` (`capacity.ts`, `capacity-probe.ts`) is a new evidence
primitive with no invented liquidity model. Capacity campaign ran live across all 40 overlapping underlyings (`internal/evidence/CAPACITY_VALIDATION_REPORT.md`):
95.5% small-ticket equivalence confirmed, wrapper divergence at size confirmed as a cross-underlying pattern (not NVDA-only), split-route execution assessed NOT_USEFUL
given current evidence. 205 tests / 15 files; lint, typecheck, build clean. Session evidence still after-hours only (`SESSION_CAMPAIGN.md`).
**Verdict: REVISE.** Ready for first live fill: still NO — fresh-wallet approval flow is unsigned/untested end to end, no wallet adapter, no funded wallet.

**Checkpoint commit:** `ebd5394fa1d2623fb21287469e8cd590621807dc` — "feat: validate Taloe capacity-aware routing". 66 files, 205 tests, lint/typecheck/build clean. No `.env`, no credentials, no gitignored runtime evidence included (verified before commit).

---

## Static-baseline falsification addendum (2026-09-22)

Extended `capacity.ts` with availability status classification (8-state raw evidence, no composite score) and a real unsigned `buildSwap` check per wrapper; extended the sweep to $100,000. Extended `capacity-report.ts` with a routing-direction matrix, an ALWAYS_USE_BSTOCK baseline (reusing the same capacity brackets, no separate comparison), and bidirectional evidence collection. Full campaign: `internal/evidence/STATIC_BASELINE_FALSIFICATION_REPORT.md`.
Finding: ALWAYS_USE_BSTOCK is falsified (AVGO/COIN/DRAM at $100,000 — bStock quotes a bad price where Ondo refuses or stays clean), but the counterexamples are thin (3/40, boundary-only). 205 tests / 15 files; lint, typecheck, build clean. Session evidence still after-hours only.
**Verdict: REVISE.** Ready for first live fill: still NO.

---

## Product-lock phase: wallet readiness addendum (2026-09-22)

Real wallet execution readiness is structurally complete: EIP-1193 connect/chain-switch/balance/gas/allowance reads (dependency-free, direct RPC, via a new `@taloe/router-core/chain-reader` subpath export so the client bundle never sees the signed Binance client or `node:crypto`), a 16-state `deriveWalletReadinessState` (`@taloe/execution`) that never conflates market-route quality with wallet readiness, and two server actions wiring `prepareExecution`/`resumeAfterApproval` into a live-mode-only `/review` panel. Approval is built for exactly the trade amount, simulated, and spender-checked before being offered; after a human signs it, allowance is re-verified on-chain and the pre-approval quote is discarded and mandatorily re-quoted (new test proves the stale `quoteId` never reaches `simulateRoute`). The final swap broadcast remains unwired for live mode — unchanged from before, pending explicit human authorization.
Also added: `routeEquityIntent`, a clean internal service-shape composition (no HTTP handler, no auth) so a future external API/SDK never diverges from the web app's routing logic; `AGGREGATION_PULL_TEST.md` and `PRODUCT_OBJECT_TEST.md`, prepared but with zero real outsider evidence yet; session campaigns for regular-hours and weekend marked `PENDING_REAL_TIME` (after-hours evidence preserved, not rerun).
240 tests / 18 files; lint, typecheck, build clean. No live wallet has been connected with real funds; nothing was signed or broadcast.
**Verdict: not re-evaluated this phase** — see `PRODUCT_OBJECT_TEST.md` for why a product-lock decision (A vs B) is not yet decidable.

---

## Live mainnet trade addendum (2026-10-11)

PRD goal #10 achieved: `scripts/live/execute-mainnet-trade.ts` ran the full pipeline (market decision -> allowance-aware readiness -> approval -> independent on-chain re-verification -> mandatory re-quote -> fresh simulation -> sign -> broadcast -> independent balance-based verification) against real BSC mainnet, through unmodified product code (`runRouteDiscovery`, `prepareExecution`, `resumeAfterApproval`). Two real transactions, both confirmed success on-chain: approval `0xb1ef6221a4cccaab0028106b979677368aae3eaa30d3a0502fe4e7e9184a77af`, swap `0xd73092697cdc32778e5fda0ae1cf480f7f78e0253382f1e1a93c95881c3b6a92`. Verified by reading the wrapper-token and USDT balance before/after, not by trusting the receipt status alone: 10.0 USDT spent, ~0.0434 NVDAon received. Full writeup: `LIVE_MAINNET_TRADE.md`.
Signing used a locally-held test-wallet private key (generated for this purpose, gitignored, chmod 600, never logged) via a single-responsibility signer (`sign_tx.py`) — deliberately isolated from all Taloe business logic. This is NOT the shipped product's signing path (that remains the user's own browser wallet via `WalletExecutionPanel`); the live broadcast step for that browser-facing path is still unwired, same as before.
