# Test Matrix

Updated 2026-09-21 (pre-live lock). **166 tests passing across 11 files.**
`pnpm test`.

Every test below runs against synthetic fixtures or the documentation's own worked
examples. None of them is evidence about live Binance behaviour.

New this cycle: `packages/shared/test/asset.test.ts` (decimals-aware amount
conversion at 6/8/18 decimals — correction 2) and
`packages/router-core/test/orchestrate.test.ts` (full end-to-end orchestration through
the `DiscoveryPort` abstraction, covering all 5 decision outcomes and the
issuer-divergence mechanism — corrections 1, 3, and the fixture provider built for
Gate G). `packages/router-core/test/normalization.test.ts` and
`packages/execution/test/machine.test.ts` were substantially rewritten for
corrections 1 and 4 respectively.

---

## Coverage by PRD requirement

| PRD | Requirement | Covered | Where |
|---|---|---|---|
| 23.1 | Signing path includes `/build` | yes | `binance-web3/test/signing.test.ts` |
| 23.1 | Raw query ordering and encoding preserved | yes | same |
| 23.1 | HTTP 200 + non-zero body code is a failure | yes | `binance-web3/test/client.test.ts` |
| 23.1 | Token amount / base-unit conversion | yes | `shared/test/money.test.ts` |
| 23.1 | Issuer normalization adapters | yes | `router-core/test/normalization.test.ts` |
| 23.1 | Route hard-gate behaviour | yes | `router-core/test/engine.test.ts` |
| 23.1 | Quote freshness calculation | yes | same (expired and insufficient-TTL cases) |
| 23.1 | Ranking and tie behaviour | yes | same |
| 23.1 | Reason-code generation | yes | same |
| 23.1 | State-machine transitions | yes | `execution/test/machine.test.ts` |
| 23.1 | Idempotency handling | partial | `rfqRequestId` is modelled; retry semantics untested |
| 23.2 | Sanitized real response fixtures | **no** | blocked on credentials |
| 23.3 | Integration tests against live modules | **no** | blocked on credentials |
| 23.4 | Browser E2E | **no** | no web app yet |
| 23.5 | Mainnet acceptance | **no** | blocked on credentials and funds |

## Behaviours specifically asserted

The tests worth knowing about, because they encode the honesty rules:

| Behaviour | Test |
|---|---|
| Doc's own pre-hash example reproduced byte for byte | signing |
| GET signs an empty body even if one is passed | signing |
| Signature is base64, not hex | signing |
| Timestamp is ISO 8601, not epoch ms | signing |
| `40401` is not retryable, so a dead quote is never replayed | client |
| A valid code-0 response with a wrong shape still fails | client |
| Observations carry rate-limit headers but never credentials | client |
| A closed underlying market does **not** block execution | engine |
| A halt **does** block execution | engine, session-mark |
| No reference price yields `UNKNOWN`, not `ACT` | engine |
| A stale reference price yields `UNKNOWN` | engine |
| A failed simulation yields `REFUSE` | engine |
| An unreadable simulation result yields `REFUSE`, not a pass | engine |
| RFQ routes are not asked for a simulation they cannot have | engine |
| A missing fee does not count as a zero fee | engine |
| Amounts in different wrapper tokens are not compared | engine |
| No selected route is attached to a non-`ACT` decision | engine |
| SWAP cannot reach a signature without passing simulation | machine |
| SWAP cannot go from broadcast straight to verified success | machine |
| An approval forces a re-quote before the swap proceeds | machine |
| RFQ has no simulation step and no swap-broadcast path | machine |
| RFQ `FILLED` is not terminal | machine |
| Normalization refuses to convert while semantics are unvalidated | normalization |

## Gaps worth naming

1. No fixture tests against real response payloads. The loose schemas are therefore
   untested against reality.
2. Retry and idempotency behaviour for `/order/submit` is modelled but not exercised.
3. No test covers the evidence recorder's failure path under a throwing sink.
4. No accessibility or responsive tests, because there is no UI yet.


## Pre-live lock additions (simulation gate)

| Behaviour | Test file |
|---|---|
| Simulate request uses the documented `evmTx` shape | `binance-web3/test/transaction.test.ts` |
| Clean `SUCCESS` -> PASS; clean `FAILED` -> FAIL with reason | same |
| HTTP 200 + business error is an error, not a simulation result | same |
| Missing / unrecognised `status` fails closed (`NOT_RUN`) | same |
| `SUCCESS` + non-empty `failReason` fails closed, hook receives raw payload, clean SUCCESS does not fire it | same |
| `balanceChanges` / `allowanceChanges` parse with documented field names; unknown additive fields tolerated | same |
| Live `simulateRoute`: build from quote-bound params, simulate built `evmTx`, default value "0", no simulate on failed/empty build, error passthrough, inconsistent passthrough | `router-core/test/live-discovery-provider.test.ts` |
| One candidate's simulation fails while another wins; all fail -> REFUSE | `router-core/test/engine.test.ts` |
| Passing simulation does not excuse an expired quote at evaluation time | same |
| Inconsistent simulation refuses that candidate, survivor wins (through the port) | `router-core/test/orchestrate.test.ts` |

Not covered by an automated test: a quote that expires *between* build and simulate inside one live call (it would need a real clock gap);
it is covered structurally by evaluating freshness at decision time (`quote.ttl` gate) and by `QUOTE_EXPIRED` from `/swap`.


## Live-validation additions
Per-share deviation (ratio 4 not read as +300%; genuinely mispriced multi-share wrapper still refused; UNKNOWN issuer cannot be enforced), per-issuer normalizer arithmetic and direction,
exact-ticker-wins search, and per-request nonce uniqueness. These encode bugs found by live data. Live behaviour itself is evidenced by artifacts, not by these tests.
