# Aggregation Pull Test

**Status: material prepared, no outsider evidence collected yet.** Nothing below the "Actual responses" section is real until a real outsider has answered. Compliments are not pull; only the specific evidence classes listed at the end count.

## Thesis to test

> Taloe may create more value for an integrator handling recurring tokenized-stock order flow than for an occasional small retail buyer.

Basis in existing evidence (not proof of the thesis — context for why it's worth asking):

- Small retail-sized orders are usually materially equivalent between wrappers (97.2% of cells <=$100 in the extended capacity campaign — `CAPACITY_VALIDATION_REPORT.md`, `STATIC_BASELINE_FALSIFICATION_REPORT.md`). A one-off buyer gets little from Taloe's routing logic most of the time.
- The cases where routing logic actually mattered (AVGO/COIN/DRAM at $100,000; NVDA/SPCX at $2,000-$10,000) are rare, severe, and size-dependent — exactly the shape of risk that matters more to someone routing MANY orders over time (an integrator absorbs the rare severe case eventually; a one-off buyer might never hit it) than to a single retail purchase.
- Taloe's scarce input is order intent (ticker, amount, deviation limit). One integrator can supply many recurring intents; one retail buyer supplies one.

That asymmetry — one integration point, many recurring intents — is the **Aggregation Wedge**. It is a hypothesis, not a finding.

## Potential actors

- a wallet (BSC-native or multi-chain) adding tokenized-equity support
- a trading interface / brokerage-style frontend for tokenized assets
- an autonomous trading agent that needs to execute equity-shaped intents
- a portfolio application that needs to size and rebalance tokenized positions
- a tokenized-stock-specific frontend (issuer-agnostic)
- a broker-like product intermediating between users and issuers
- a protocol integrating tokenized equities into a broader DeFi flow

## The outsider pitch (plain language, no architecture)

> Taloe takes a tokenized-stock order such as $5,000 of NVDA, compares the available BSC representations using live executable quotes, checks how much exposure the requested size actually receives, and returns the viable route or refuses a materially bad fill.

Explicitly not part of the pitch: architecture, Binance API internals, WrapRoute, SessionMark, hackathon judging. If a conversation drifts there, redirect back to the plain pitch above.

## Discovery questions (ask in order; do not lead the answer)

1. How do you currently choose between multiple tokenized representations of the same stock?
2. Do you default to one issuer?
3. Do you check executable output at the intended ticket size before routing?
4. Have you seen liquidity cliffs, bad fills, or inconsistent wrapper behavior?
5. If an API returned: viable wrapper, effective deviation, safe executable size, refusal reason — where would it fit in your system?
6. Would you actually route orders through it?
7. What would prevent you from integrating it?
8. What endpoint/output would you need before testing it?

## Evidence classes

**Strong pull** (record verbatim, with who/when/context):
- asks for API access
- offers to test
- gives sample orders
- explains current workaround
- identifies a specific integration point
- asks for specific wrapper support
- asks about limits/pricing/SLA
- wants SDK/docs

**Not pull, do not record as evidence:**
- general compliments ("cool idea", "nice work")
- vague interest with no concrete next step
- enthusiasm from someone with no real order flow to route

## Actual responses (append as they happen; never edit or delete a prior entry — correct with a new dated entry instead)

_None collected yet._

| Date | Actor type | Question(s) asked | Response | Evidence class | Notes |
|---|---|---|---|---|---|
| — | — | — | — | — | No real outsider conversation has occurred in this phase. |

## Verdict

**Not evaluated — insufficient data.** The pull-test thesis stays unvalidated until real responses exist. Do not infer pull from the strength of the internal argument above; the argument only justifies asking the question, not answering it.
