# Taloe

Choose the company and the amount. Taloe finds the best valid tokenized-equity
execution on BNB Smart Chain, or tells you not to trade.

> **Status: in development.** No live API integration has been verified and no mainnet
> execution has taken place. See `internal/product/CLAIM_LEDGER.md` for the evidence
> status of every claim on this page, and `internal/product/BUILD_STATUS.md` for what
> is and is not built.

---

## What it is

A tokenized-equity execution router.

One company can exist on BNB Smart Chain as several different wrapper tokens, issued by
different platforms. They do not settle the same way: some route through AMM pools,
some through request-for-quote market makers, and some are unavailable while the US
market is closed. Which one you should actually buy depends on the size of your order,
the current session, the executable quote, and the limit you set.

Taloe takes a plain intent — "buy $500 of NVIDIA" — and makes that decision, or refuses.

Correct inaction is part of the product. Taloe returns one of `ACT`, `NO_ACTION`,
`REFUSE`, `UNKNOWN` or `MANUAL_REVIEW`, and every one of those outcomes is explained
from a structured reason code rather than narrated.

## Who it is for

Someone holding USDT on BNB Smart Chain who has already decided they want exposure to a
named company, and does not want to compare issuer wrappers and execution paths by hand.

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
apps/web/              Next.js product surface
packages/shared/       domain types, exact-decimal arithmetic, reason codes
packages/binance-web3/ signed API client, schemas, service adapters
packages/session-mark/ market and session context
packages/router-core/  WrapRoute decision engine
packages/execution/    SWAP and RFQ state machines
packages/evidence/     observation schemas and recorder
internal/              engineering memory, claim ledger, DX journal
```

## What has actually been verified

- Request signing reproduces the documented worked example, including the `/build`
  prefix rule and raw query encoding. Verified against documentation, not against a
  live endpoint.
- HTTP 200 carrying a non-zero business code is treated as a failure everywhere.
- The router produces all five decision outcomes (`ACT`, `NO_ACTION`, `REFUSE`,
  `UNKNOWN`, `MANUAL_REVIEW`) with per-gate reasons, verified end to end — discovery
  through decision — against 12 named synthetic fixture scenarios in 157 passing tests.
- The full consumer journey (landing, route, review, execution, receipt) builds,
  typechecks, lints clean, and was smoke-tested against a running server through every
  fixture scenario and three distinct execution outcomes.

Nothing above is a claim about live Binance behaviour.

## Known limitations

- No live API call has been made. All sponsor claims are documentation-level.
- Underlying-equivalent normalization is deliberately inactive: no issuer's
  `tokenToShareRatio` direction has been observed, and the product will not invent a
  conversion to make a comparison look complete. Cross-wrapper numeric ranking is
  therefore not yet functional.
- USDT-only funding, BSC mainnet only, spot only.
- No real wallet SDK yet — fixture mode connects a fixed demo address.
- No persisted session store — the route/review/execution/receipt pages are stateless
  functions of their URL rather than a database-backed session.
- Live SWAP simulation (quote -> build -> simulate) is implemented and tested against mocked sponsor
  services only; it has never run against Binance. See `internal/product/CLAIM_LEDGER.md` G5.

## Validating against live Binance data

Once you have API credentials in `.env.local`:

```bash
pnpm validate:auth                                   # confirm signing works
pnpm validate:platforms                              # which RWA platforms exist
pnpm validate:ticker --ticker NVDA                    # wrapper candidates + ratios
pnpm validate:quotes --ticker NVDA --amounts 5,25,100 # executable quotes at size
pnpm validate:route --ticker NVDA --amount 5          # whole seam, no signing: one evidence bundle
pnpm validate:all                                     # full Gate 1 seam-validation sweep
```

Every command captures raw, credential-redacted evidence under
`internal/evidence/runtime/` and prints which tracked doc to update with the result.

## Licence

Not yet chosen.
