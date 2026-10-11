# Taloe

Tell it the company, the amount, and how far the price can move. Taloe checks the
tokenized-equity representations actually available on BNB Smart Chain, finds the one
that can execute that size within your limit, or refuses before you receive a
materially bad fill.

> **Status: live-validated.** Routing has been run against real Binance Web3 API data
> across 40 BSC underlyings at sizes from $5 to $100,000, and one real trade has been
> executed and independently verified on BSC mainnet. See
> `internal/product/CLAIM_LEDGER.md` for the evidence status of every claim on this
> page, `internal/product/BUILD_STATUS.md` for what is and isn't built, and
> `internal/evidence/LIVE_MAINNET_TRADE.md` for the mainnet proof (two real,
> on-chain-checkable transaction hashes).
>
> **Live, in live mode, right now: https://web-pink-six-80.vercel.app** — running against
> the real Binance Web3 API, not fixtures. Deployed from Frankfurt (`fra1`): Binance's
> compliance restriction blocked requests from Vercel's US default region, so the
> deployment region was switched rather than worked around.

---

## What it is

A size-aware tokenized-equity execution router.

One company can exist on BNB Smart Chain as several different wrapper tokens, issued by
different platforms (today: Ondo and bStock). They are not interchangeable: liquidity
depth differs by wrapper and by size, and at large enough tickets one representation can
silently deliver a badly priced fill while another refuses outright or stays clean.
Small retail-sized orders are usually priced about the same across wrappers — Taloe says
so rather than manufacturing a winner — but the mechanism exists for the rare, severe
case where it genuinely matters.

Taloe takes a plain intent — "buy $500 of NVIDIA, within 1.5%" — and returns the
executable wrapper, or refuses, with a structured reason rather than a narrated guess.
Outcomes are exactly one of `ACT`, `NO_ACTION`, `REFUSE`, `UNKNOWN` or `MANUAL_REVIEW`.

A static "always use the deeper-liquidity wrapper" policy was deliberately tested
against this mechanism and falsified: see `internal/evidence/STATIC_BASELINE_FALSIFICATION_REPORT.md`.

## Who it is for

Someone holding USDT on BNB Smart Chain who wants exposure to a named company without
comparing issuer wrappers and execution paths by hand. The same routing decision is also
built as a clean internal service shape (`routeEquityIntent`) for an eventual wallet,
trading app, or agent to call directly — not yet published externally; see
`internal/research/AGGREGATION_PULL_TEST.md`.

## Running it

Requires Node 22+ and pnpm.

```bash
pnpm install
cp .env.example .env.local   # fill in credentials for live mode
pnpm verify                  # typecheck + tests
pnpm dev
```

Without credentials the app runs in fixture mode, which is labelled in the interface.
There is no silent fallback: if live mode is configured and credentials are missing,
startup fails rather than quietly serving sample data.

## Layout

```
apps/web/              Next.js product surface (fixture + live mode)
packages/shared/       domain types, exact-decimal arithmetic, reason codes
packages/binance-web3/ signed API client, schemas, service adapters
packages/session-mark/ market and session context
packages/router-core/  discover -> quote -> normalize -> gate -> rank -> readiness
packages/execution/    SWAP/RFQ state machines, wallet-readiness derivation
packages/evidence/     observation schemas and recorder
scripts/validate/       live-data validation and campaign harnesses
scripts/live/          the real mainnet-trade proof (signing isolated from logic)
internal/              engineering memory, claim ledger, evidence, research
```

## What has actually been verified

- Request signing verified against real Binance Web3 API calls, not just the documented example.
- The router produces all five decision outcomes with per-gate reasons, both against 12
  synthetic fixture scenarios (deterministic, no credentials needed) and against live
  data across 40 real BSC underlyings.
- `SafeExecutionCapacity` — the largest ticket size a wrapper keeps inside a user's
  deviation limit — measured from real executable quotes from $5.10 to $100,000, with
  no invented liquidity model. See `internal/evidence/CAPACITY_VALIDATION_REPORT.md`.
- A static "always use the usually-better wrapper" baseline was tested against this live
  data and found to lose badly, rarely, at large size — `STATIC_BASELINE_FALSIFICATION_REPORT.md`.
- Allowance-aware execution readiness through to a signed, broadcast, independently
  verified swap — balance, allowance, build-time approval, independent on-chain
  re-verification, mandatory re-quote after approval, fresh simulation, sign, broadcast,
  and verification by reading the actual balance delta rather than trusting the receipt
  status — is wired through real wallet connection (EIP-1193, no private key ever leaves
  the browser) on the product's own `/review` page.
- One real mainnet trade — $10 USDT into NVDAon on BSC, approval + swap, both
  transactions confirmed on-chain and independently verified by reading the actual
  balance deltas, not just the receipt status. `internal/evidence/LIVE_MAINNET_TRADE.md`
  has both transaction hashes.
- 240 tests passing across 18 files; lint, typecheck and build clean.

## Known limitations

- RFQ execution is implemented and branched on correctly at runtime, but has never been
  observed live — every quote taken this far has come back as `SWAP`.
- Session dependence (regular US market hours, weekend) is untested; every live
  campaign so far ran after-hours. See `internal/evidence/SESSION_CAMPAIGN.md`.
- Split-route execution (dividing one order across two wrappers) was evaluated against
  live data and found not useful at current liquidity — not built.
- No external API/SDK is published. The routing primitive exists in a clean internal
  shape (`routeEquityIntent`) but has no auth, billing, or external caller yet.
- USDT-only funding, BSC mainnet only, spot only. No persisted session store — the
  route/review/execution/receipt pages are stateless functions of their URL.

## Validating against live Binance data

Once you have API credentials in `.env.local`:

```bash
pnpm validate:auth                                   # confirm signing works
pnpm validate:platforms                              # which RWA platforms exist
pnpm validate:ticker --ticker NVDA                    # wrapper candidates + ratios
pnpm validate:quotes --ticker NVDA --amounts 5,25,100 # executable quotes at size
pnpm validate:route --ticker NVDA --amount 5          # whole seam, no signing: one evidence bundle
pnpm validate:capacity --session <label>              # safe-capacity sweep across the live wrapper universe
pnpm validate:capacity-report --file <artifact.json>  # derive brackets, baselines, routing matrix from a sweep
pnpm validate:all                                     # full seam-validation sweep
```

Every command captures raw, credential-redacted evidence under
`internal/evidence/runtime/` (gitignored) and prints which tracked doc to update with
the result.

## Reproducing the mainnet trade

`scripts/live/execute-mainnet-trade.ts` drives the real pipeline end to end and
`scripts/live/sign_tx.py` is the only file that ever touches a private key — see both
files' headers, and `internal/evidence/LIVE_MAINNET_TRADE.md` for the full writeup and
the real transaction hashes from the run this repo's evidence is based on.

## Licence

MIT (see `LICENSE`).
