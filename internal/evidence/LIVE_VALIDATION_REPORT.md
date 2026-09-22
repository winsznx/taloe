# Live Validation Report

**Observed:** 2026-09-21 22:49-23:20 UTC (US after-hours, `marketStatus: postmarket` for Ondo). Chain: BSC (56).
**No signing, no approvals, no broadcast, no funds moved.** Read-only quotes/simulations used a *public third-party address*
(`0x8894…D4E3`, not the user's) because Ondo requires a wallet address to quote at all; no key for it exists or was used.
Artifacts live in `internal/evidence/runtime/` (gitignored, credential-free: 0 occurrences of key/secret, verified).

## VERDICT: **REVISE**

The core mechanism survives live data: two wrappers for one underlying genuinely coexist and are both executable through Binance, and
wrapper choice becomes decisive at size. But the *headline* (a better price for the user) is economically negligible at the small sizes
the demo will use, several documented behaviours did not hold, and the execution path cannot yet clear its own simulation gate for a
fresh wallet. It is a narrower product than the PRD describes, not a dead one.

## The eight questions

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Do >=2 wrappers coexist for important underlyings? | **YES.** 40 underlyings have both an Ondo and a bStock wrapper on BSC, incl. NVDA, TSLA, QQQ, SPY, AMD, PLTR. AAPL has both too. | `raw-universe-*`, `sweep-25usdt-*.json`, `ticker-*-wrappers-*.json` |
| 2 | Are >=2 executable through Binance? | **YES for quote + build + approval-simulation.** 40/40 quoted on both wrappers with zero errors. A *swap* simulation PASS was not reachable without an approval (see Simulation). No fill attempted. | `sweep-25usdt-*.json`, `simulate-approval-*.json` |
| 3 | Does Taloe choose differently from FIRST_RESULT / FIXED_ISSUER? | **Sometimes.** Small sizes: 3/15 (all inside 15 bps, i.e. quote noise). At size it is decisive (below). | `campaign-2026-09-21T23-19-27-931Z.json`, `campaign-2026-09-21T23-17-41-505Z.json` |
| 4 | Does Taloe correctly refuse something a baseline would attempt? | **YES, at size.** NVDAon at $2,000: +161 bps vs the 150 bps limit (1.5% fewer shares than bStock). At $10,000: **+25,343 bps, 12.4 shares vs 44.0 (72% shortfall)**. FIRST_RESULT and FIXED_ISSUER:ondo both attempt it; Taloe rejects it (`EXCEEDS_USER_DEVIATION`) and selects NVDAB. | `campaign-2026-09-21T23-17-41-505Z.json`, `size-probe-*.json` |
| 5 | Large enough to justify the product? | **At <= $100: no.** Per-share exposure gap between wrappers across 40 underlyings: median 7.1 bps, p90 16 bps, max 59.8 bps (ARM); $0.007 on $100 at the median. **At >= $2,000 on a shallow wrapper: yes**, but that is loss avoidance, not price improvement. | `sweep-25usdt-*.json` |
| 6 | Is Binance load-bearing? | **Yes, completely** — discovery, ratio, reference price, quotes, build, simulation and balances all come from Binance, and every executable route went through one vendor (LiquidMesh). There is no independent data source. | all |
| 7 | Can "best executable tokenized-equity route" stay honest? | **Only narrowed:** "the better of the two Binance-listed wrappers by executable per-share price at the quoted instant, within your deviation limit." "Best" is measured on quotes taken ~0.5s apart with a ~30s life. | TTL probe, sweep |
| 8 | What must be narrowed? | See "Recommended revision". | |

## Findings by area

**Authentication.** First signed request succeeded (HTTP 200, code 0, 1.5s). Signing implementation was correct. One *intermittent* `401/40103`
(2 of 79 searches) was **our bug**: parallel identical requests share timestamp+signature; fixed with a per-request `X-OC-NONCE` and a test.
`auth-2026-09-21T22-49-49-348Z.ndjson`, `campaign-2026-09-21T23-06-25-882Z.ndjson`.

**Platforms.** Live `/rwa/platforms` returns exactly **`ondo`** (459 tickers; BSC 458 tokens) and **`bstock`** (77 tickers; BSC only, 77 tokens). **No xStock.**
Consistent with the RWA docs (`ondo`,`bstock` enum), inconsistent with the Trading docs (which describe xStock as a first-class AMM family).
`raw-platforms-2026-09-21T22-50-20-312Z.json`.

**Wrapper discovery.** Every wrapper is its own record. NVDA: `NVDAon` `0xa9ee28c8…6f75` (ondo, ratio 1.00172) and `NVDAB` `0x02fca66c…7436`
(bstock, ratio 1.00078), both 18 decimals, both `TRADING`. Ondo carries `marketStatus: postmarket` with next open/close; bStock reports `null`.
`ticker-{nvda,tsla,aapl,qqq,aaoi}-wrappers-*.json`. `/rwa/tokens` is incomplete (442/458 Ondo, 46/77 bStock; e.g. `AAPLB` missing).

**Normalization.** Documented: "1 token ≈ ratio underlying shares". Ondo direction **empirically confirmed** with executable prices on ratio≠1 tokens
(CRWDon ratio 4: $248.53/share = -4 bps vs reference under shares-per-token, +29,986 bps under the inverse; KLACon ratio 10.03: +35 vs +90,614 bps).
bStock: **DOCUMENTED only** (every bStock ratio is within 0.4% of 1, so prices cannot discriminate). Ondo issuer documentation was **not** consulted.
xStock: UNKNOWN (absent). `normalization-crosscheck-2026-09-21T23-03-54-939Z.json`.
Normalization changes the chosen wrapper in **9/40** underlyings (gaps 0.2-39.8 bps).
`referencePrice` is documented as *derived from the on-chain token price*, and `tokenPrice / referencePrice == ratio` for all 488 parseable tokens: it is **not** an independent quote.

**Quotes.** 100% `SWAP`, 100% vendor `LiquidMesh`, across 40 underlyings x 2 wrappers and 15 ticker/size cells; **no RFQ ever observed**, contradicting the docs
(Ondo "always RFQ"). Quote p50 637 ms, p95 841 ms. Ondo enforces a **$5 minimum** (`40375`), and USDT ≈ $0.9998, so exactly "5 USDT" fails; ≥5.1 works.
Ondo quotes **require `userWalletAddress`** (`40001`). Observed TTL: buildable at 29.1s, `40401` at 33.5s (`ttl-probe-*.json`). No `40367/40369` seen (after-hours only, not regular/closed).

**Simulation.** quote → `/swap` → `simulate` works end to end (`/swap` needs `slippagePercent`/`autoSlippage`, else `40001`). 30/30 swap simulations returned a well-formed
`FAILED` / `execution reverted: BEP20: transfer amount exceeds allowance` (correct: the wallet never approved the router). Simulating the **approval** returned
`PASS` with parsed `allowanceChanges` (0 → 5e18, spender = quote `approveTarget`). **The documented `SUCCESS`+`failReason` contradiction did not occur.**
Consequence: a ranking-time simulation gate refuses every route for any wallet without allowance. `campaign-2026-09-21T23-19-27-931Z.json`, `simulate-approval-*.json`.

**Sponsor price-impact field.** `priceImpactPercent` reported `0.7187` for NVDAon at $10,000 while the measured shortfall was ~72% (docs: it is a percentage). Single observation, `UNRESOLVED`.
Taloe's independent deviation gate is what caught it. Do not use the field as a safety gate.

## Baselines and ablations (authoritative core campaign, 15 cells = 5 tickers x $5.1/$25/$100)

| Method | Outcomes |
|---|---|
| FULL | 15 x REFUSE (all `SIMULATION_FAILED`: no allowance) |
| NO_SIMULATION (routing merit) | 15 x ACT |
| BASELINE_FIRST_RESULT | 15 x ATTEMPT (always Ondo: discovery order, not merit) |
| FIXED_ISSUER ondo / bstock | 15 x REFUSE each (simulation) |
| NO_RWA_CONTEXT / NO_MARKET_STATUS / NO_EXECUTION_MODE_AWARENESS / NO_NORMALIZATION | 15 x REFUSE each (masked by simulation) |

Ablation reading, stated honestly:
- **Deviation/reference context: load-bearing at size only.** At NVDA $2,000 and $10,000 `NO_RWA_CONTEXT` loses the `EXCEEDS_USER_DEVIATION` rejection; at <=$100 it changes nothing (0/15).
- **Normalization:** changes the winner in 9/40 by <=40 bps; 0/15 outcome changes in the masked campaign.
- **Execution-mode awareness: NOT load-bearing** — there was no RFQ route to be aware of.
- **Session/market status: NOT shown load-bearing** — every wrapper was tradable after hours; the closed/weekend case was not tested.
- **Simulation:** the hard gate is what turned 15 viable routes into 15 refusals for a fresh wallet. It is correct but currently blocks the product.

## Recommended revision
1. **Reposition** from "best price" to **size-aware wrapper safety**: correct per-share comparison, per-token liquidity depth, and refusal of a wrapper that silently loses 1-72% at size. Stop implying savings at small sizes.
2. **Make the pre-sign flow allowance-aware:** check allowance first; treat "exceeds allowance" as `APPROVAL_REQUIRED`, approve, re-quote, then simulate. Do not use swap simulation as a ranking-time gate.
3. **Drop** xStock-as-primary and RFQ-first claims; keep RFQ/EIP-712 as a code path but stop presenting it as observed.
4. **Do not trust** `priceImpactPercent`; keep the deviation gate as the authority. Re-run at regular hours and on a weekend to test session context and `40367/40369`.
5. Keep normalization; it is cheap and correct, but describe it as correctness, not advantage.

## Ready for first <$10 live fill: **NO**
Blocking: (a) fresh wallets fail the simulation gate before approval; (b) no wallet adapter/signing and the execution timeline is fixture-only, so nothing in-app can broadcast;
(c) a funded user wallet (>= 5.1 USDT + BNB) is needed, and the balances/allowance are unknown for it; (d) Ondo's $5 minimum means the smallest fill is ~$5.1 (still <$10).
