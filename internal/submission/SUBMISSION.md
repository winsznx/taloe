# Submission

Living document. Kept current from now, not written at the deadline.

**Valid Submission V0 target:** 2026-10-10 12:00 UTC
**Lock:** 2026-10-11 12:00 UTC

---

| Field | Status |
|---|---|
| Project name | Taloe |
| Contact details | held privately, not in this repository |
| Prize wallet / UID | held privately until submission |
| Tracks selected | main track; Agentic Wallet and Agent Studio specials are optional and evidence-gated |
| Public repository URL | https://github.com/winsznx/taloe |
| Demo video URL | not recorded |
| Deployed judge link | not deployed |
| DX Report | journal started, report not written |
| Registration | **not done** |

## What did you build

*Draft. Every clause must stay inside what `CLAIM_LEDGER.md` supports.*

> Taloe is a size-aware tokenized-equity execution router for BNB Smart Chain. You
> choose a company, an amount, and how far the price can move. Taloe finds the
> tokenized representations of that company actually available on BSC, checks how much
> exposure the requested size really receives under live executable quotes, and returns
> the viable route — or refuses before you take a materially bad fill. A static
> "always pick the usually-better wrapper" policy was tested against live data and
> falsified: it loses badly, rarely, at large size. One real trade has been executed
> and independently verified on BSC mainnet.

Wording to avoid: any "best price at small size" claim (measured and found mostly
negligible — see `CAPACITY_VALIDATION_REPORT.md`), any session-dependence claim
(untested — every live campaign ran after-hours), any RFQ-execution claim (code exists,
never observed live).

## Limitations

Stated openly, not hidden:

- the product's browser-wallet flow reaches a simulated, ready-to-sign swap but does
  not yet broadcast it — the mainnet proof used a direct script with an operator-held
  key, not the UI's own wallet path
- RFQ execution is implemented and branches correctly on runtime data, but has never
  been observed live (every quote returned has been SWAP)
- session dependence (regular hours, weekend) is untested — see `SESSION_CAMPAIGN.md`
- no external API/SDK published; the routing primitive exists internally
  (`routeEquityIntent`) with no auth or external caller
- underlying-equivalent normalization is active for Ondo (empirically observed
  direction) and bStock (documented), inactive/`UNKNOWN` for any other issuer
- USDT-only funding in v1
- BSC mainnet only, spot only
- issuer coverage limited to what the Binance RWA surface actually exposes (Ondo,
  bStock observed; xStock absent from live platform data despite being documented)

## V0 checklist

- [x] public repo available — https://github.com/winsznx/taloe
- [ ] deployed path or reproducible judge instructions
- [ ] demo video uploaded, sharing verified
- [ ] DX Report submitted
- [ ] form answers complete
- [ ] track selected
- [ ] all links tested from an incognito session
- [ ] claims evidence-safe and matching the ledger
