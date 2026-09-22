# Session campaign

The first capacity run and the first live validation were both taken outside US regular hours. Session impact is therefore **not inferred**. It stays `UNTESTED` until the same subset is observed in the two other sessions.

## Observations so far

| Label | Observed (UTC) | US market state | Artifact |
|---|---|---|---|
| afterhours | 2026-09-22 00:07 onward (Mon 20:07 ET) | after-hours / overnight | `capacity-afterhours-*.json` |

## Product-lock phase status (2026-09-22)

**REGULAR_DIRECTION_MATRIX: `PENDING_REAL_TIME`** — next window Tue 2026-09-22 09:30-16:00 ET (13:30-20:00 UTC), ~4.5h after this phase started. Not run: this session cannot block on real wall-clock time.
**AFTER_HOURS_DIRECTION_MATRIX: available** — see `capacity-report-afterhours-2026-09-22T01-14-08-334Z.json`, extended to $100,000. Preserved, not rerun.
**WEEKEND_DIRECTION_MATRIX: `PENDING_REAL_TIME`** — next window Sat 2026-09-26.

Direction-matrix label vocabulary for this phase is `ONDO_BETTER / BSTOCK_BETTER / MATERIAL_EQUIVALENCE / ALL_REFUSE / UNKNOWN`. The existing `capacity-report.ts` (`routingDirectionMatrix` field) emits `A_LARGER`/`B_LARGER`-derived labels `ONDO_BETTER`/`BSTOCK_BETTER`/`EITHER`/`UNKNOWN`; read `EITHER` as `MATERIAL_EQUIVALENCE` when reporting against this phase's vocabulary — the underlying computation is identical (`compareCapacity`), only the label name differs, and it is not worth touching tested, already-committed script output for a naming difference.

## To run (same script; use the representative subset for the session workstream, the full 40 for a capacity re-run)

Representative subset for this phase (per Taloe product-lock phase section 8):
`NVDA,TSLA,AAPL,QQQ,SPY,AMD,RKLB,SPCX,AVGO,COIN,DRAM`

Regular hours (US cash session 09:30-16:00 ET, 13:30-20:00 UTC during EDT). Any weekday inside the window:

```
pnpm validate:capacity --session regular --tickers NVDA,TSLA,AAPL,QQQ,SPY,AMD,RKLB,SPCX,AVGO,COIN,DRAM
pnpm validate:capacity-report --file capacity-regular-<stamp>.json
```

Weekend (any Saturday or Sunday; the next is 2026-09-26):

```
pnpm validate:capacity --session weekend --tickers NVDA,TSLA,AAPL,QQQ,SPY,AMD,RKLB,SPCX,AVGO,COIN,DRAM
pnpm validate:capacity-report --file capacity-weekend-<stamp>.json
```

Each run takes several minutes for the 11-ticker subset (the full 40-ticker run takes ~20-25 minutes) and issues read-only quotes only. Nothing is signed, approved or broadcast.

## What to compare between sessions

1. Whether any quote fails with `40367` (Ondo) or `40369` (bStock). This is the only direct evidence of issuer-specific market-hours behaviour and has never been observed.
2. Whether `executionMode` ever becomes `RFQ` (never observed so far).
3. Whether capacity brackets move for the same underlying. Compare `perThreshold` and the per-underlying brackets in the report artifacts.
4. Whether reference-price availability changes (an `AXTI`-style null deviation).

Do not write a session conclusion into a report until artifacts for at least regular and weekend exist. The report field is "session evidence status".
