# Ablations

**Status: wired in code, not yet run against live data.**

Each variant removes exactly one supposedly load-bearing mechanism so identical intents
can be replayed against it. If removing a mechanism never changes an outcome, that
mechanism is downgraded in every public claim. Negative results are reported, not
buried.

Implemented in `packages/router-core/src/policy.ts` and applied in `engine.ts`.

---

| Variant | Removes | Hypothesis | Live result |
|---|---|---|---|
| `FULL` | nothing | baseline for comparison | not run |
| `NO_RWA_CONTEXT` | token and reference price context | user deviation constraint becomes unenforceable, so decisions fall to `UNKNOWN` | not run |
| `NO_MARKET_STATUS` | session state and reference | same as above, plus halts go undetected | not run |
| `NO_EXECUTION_MODE_AWARENESS` | RFQ handling; every route treated as a swap | all Ondo routes become unexecutable | not run |
| `NO_NORMALIZATION` | underlying-equivalent conversion | cross-wrapper ranking degrades to same-token only | not run |
| `NO_SIMULATION` | pre-sign SWAP simulation gate | failing transactions reach the signature prompt | not run |
| `FIXED_ISSUER` | cross-wrapper discovery | fails when the pinned issuer has no route | not run |

---

## Fixture-level wiring checks

These confirm the ablation switches are connected. They are **not** evidence about
Binance or about product value, and must not be cited as such.

From `packages/router-core/test/engine.test.ts`:

- `NO_EXECUTION_MODE_AWARENESS` turns an RFQ route that `FULL` accepts into a `REFUSE`.
- `NO_SIMULATION` lets a route through that `FULL` refuses on a failed simulation.
- `NO_MARKET_STATUS` drops `FULL`'s `ACT` to `UNKNOWN`, because the user's deviation
  constraint can no longer be checked.
- `FIXED_ISSUER` restricts the candidate set to the pinned platform.

## Honest caveat on `NO_NORMALIZATION`

This ablation cannot currently show anything, because normalization is inert in `FULL`
too (see `DECISIONS.md` D-007, D-015). Until a live `tokenToShareRatio` is observed and
a specific issuer's own normalizer is validated against its own evidence, `FULL` and
`NO_NORMALIZATION` are the same run. Recorded here so the result is not later mistaken
for a finding about the mechanism.

## Issuer divergence: a mechanism check that is NOT one of the six PRD ablations

The `TSLA` fixture scenario (`packages/router-core/fixtures/fixture-provider.ts`,
`FIXTURE_SCENARIOS.ACT_ISSUER_DIVERGENCE_CLOSED_MARKET`) demonstrates something the
formal ablation list does not directly test: that a SessionMark-context signal
(closed session) combined with a per-issuer runtime signal (a documented market-hours
business code) produces a DIFFERENT outcome per issuer for the SAME underlying at the
SAME moment — Ondo pre-rejected, BStock's SWAP route wins.

This is not an ablation (nothing is removed), but it is the single clearest fixture
demonstration that session/issuer awareness is load-bearing, because the alternative
— a router that ignored per-candidate market-hours signals — would either refuse the
whole underlying (over-refusing a perfectly executable BStock route) or attempt the
Ondo route anyway (which the sponsor API has already refused). Covered end to end in
`packages/router-core/test/orchestrate.test.ts`. Fixture-only; not yet observed live.
