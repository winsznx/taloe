# Demo Script

**Status: outline only.** Cannot be finalised before live route data exists. Target
length four minutes or less.

Rule: nothing captured may be labelled live, and nothing live may be faked.

---

## 0:00-0:10 — The problem, stated concretely

> "NVIDIA can exist as more than one tokenized wrapper on BNB Smart Chain. They settle
> differently, and some of them stop trading when the US market closes. A buyer should
> not have to know which one is actually executable right now."

## 0:10-0:25 — What Taloe does

> "You give it a company, an amount, and how far from the reference price you are
> willing to go. It compares the wrappers using live Binance RWA and trading data, and
> either routes the best valid exposure or refuses."

## 0:25-1:10 — The route

Enter NVDA and a small USDT amount. Show candidates being evaluated. Land on one
recommendation with its reason. No architecture page.

## 1:10-1:40 — The comparison

Expand alternatives. Show at least one materially different rejection reason. The best
version of this is a wrapper rejected for a reason a price comparison could not have
produced: wrong execution mode, outside issuer trading hours, failed simulation.

## 1:40-2:10 — Review and safety

Exact wrapper, exact contract, execution mode, quote freshness. For SWAP, the
simulation result. For RFQ, the typed-data signing path.

## 2:10-2:50 — Execution and verification

Small live BSC fill if safe, otherwise clearly labelled capture. End on a verified
receipt with the transaction or order proof, and the wrapper actually received.

## 2:50-3:20 — Correct inaction

The segment most demos skip. Show a genuine refusal and the reason behind it. Taloe
declining to trade is a feature, and it is the part judges can least easily fake.

## 3:20-3:50 — The DX finding

One finding, the one that would most improve the platform. Currently DOC-002 or R-003.
Replace with a runtime finding once one exists, since those are stronger.

---

## Not in the demo

Test counts, package counts, architecture diagrams, agent identity registration.
