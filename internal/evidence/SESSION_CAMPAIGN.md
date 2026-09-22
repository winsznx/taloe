# Session campaign

The first capacity run and the first live validation were both taken outside US regular hours. Session impact is therefore **not inferred**. It stays `UNTESTED` until the same subset is observed in the two other sessions.

## Observations so far

| Label | Observed (UTC) | US market state | Artifact |
|---|---|---|---|
| afterhours | 2026-09-22 00:07 onward (Mon 20:07 ET) | after-hours / overnight | `capacity-afterhours-*.json` |

## To run (same script, same 40 underlyings, same anchors)

Regular hours (US cash session 09:30-16:00 ET, 13:30-20:00 UTC during EDT). Any weekday inside the window:

```
pnpm validate:capacity --session regular
pnpm validate:capacity-report --file capacity-regular-<stamp>.json
```

Weekend (any Saturday or Sunday; the next is 2026-09-26):

```
pnpm validate:capacity --session weekend
pnpm validate:capacity-report --file capacity-weekend-<stamp>.json
```

Each run takes about 20 minutes and issues read-only quotes only. Nothing is signed, approved or broadcast.

## What to compare between sessions

1. Whether any quote fails with `40367` (Ondo) or `40369` (bStock). This is the only direct evidence of issuer-specific market-hours behaviour and has never been observed.
2. Whether `executionMode` ever becomes `RFQ` (never observed so far).
3. Whether capacity brackets move for the same underlying. Compare `perThreshold` and the per-underlying brackets in the report artifacts.
4. Whether reference-price availability changes (an `AXTI`-style null deviation).

Do not write a session conclusion into a report until artifacts for at least regular and weekend exist. The report field is "session evidence status".
