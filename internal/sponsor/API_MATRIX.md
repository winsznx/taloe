# API Matrix

Every Binance Web3 endpoint Taloe depends on, what it is used for, and how far it has
actually been verified.

Base URL: `https://web3.binance.com/build`
All paths below are appended to that base and carry `/build` in the signed path.
Docs retrieved **2026-09-21** (introduction pages and the canonical `catalog/web3-wallet/api/rest-api/{transaction-api,trading-api}` reference pages). Chain: BNB Smart Chain, `binanceChainId=56`.

Verification vocabulary matches `internal/product/CLAIM_LEDGER.md`.

---

## Market API — RWA data

| Endpoint | Method | Used for | Schema confidence | Verified |
|---|---|---|---|---|
| `/api/v1/dex/market/rwa/platforms` | GET | Enumerate issuance platforms; answers which issuer families are actually present | Loose | `DOC_VERIFIED` path only |
| `/api/v1/dex/market/rwa/search` | GET | Resolve a ticker or company name to wrapper candidates | Loose | `DOC_VERIFIED` path only |
| `/api/v1/dex/market/rwa/tokens` | GET | Full wrapper universe, filterable by platform | Loose | `DOC_VERIFIED` path only |
| `/api/v1/dex/market/rwa/price` | GET | Batch token price and underlying reference price | Loose | `DOC_VERIFIED` path only |
| `/api/v1/dex/market/rwa/underlying-profile` | GET | Company name, sector, attestation links | Loose | `DOC_VERIFIED` path only |
| `/api/v1/dex/market/rwa/underlying-market` | GET | Session state and next open/close, feeds SessionMark | Loose | `DOC_VERIFIED` path only |

Response field names for all six are `UNTESTED`. See `SPONSOR_FINDINGS.md` F-005.

## Trading API

| Endpoint | Method | Used for | Schema confidence | Verified |
|---|---|---|---|---|
| `/api/v1/dex/aggregator/supported/chain` | GET | Confirm BSC aggregator support | Loose | `DOC_VERIFIED` |
| `/api/v1/dex/aggregator/quote` | GET | Executable routes per wrapper; source of `executionMode` | Medium | `DOC_VERIFIED` |
| `/api/v1/dex/aggregator/swap` | GET | Build `tx` (SWAP) or `rfq.typedDataToSign` (RFQ). `data.tx`: from,to,data,value,gas,gasPrice,maxPriorityFeePerGas,minReceiveAmount,slippagePercent. Feeds simulation. | Medium | `DOC_VERIFIED` |
| `/api/v1/dex/aggregator/quote-and-swap` | GET | Flash path (quote+build in one call), `vendor` accepts LiquidMesh only; `enableRFQ` exists here only (BStock default true, others false). **Not adopted** — future experiment on quote-expiry, SPONSOR_FINDINGS F-008; runtime `executionMode` remains authoritative. | n/a | `DOC_VERIFIED`; experiment `UNTESTED` |
| `/api/v1/dex/aggregator/approve-transaction` | GET | ERC-20 approval calldata. `vendor` required for equity tokens. | Medium | `DOC_VERIFIED` |
| `/api/v1/dex/aggregator/history` | GET | Swap transaction status by hash | Loose | `DOC_VERIFIED` path only |
| `/api/v1/dex/aggregator/order/submit` | POST | Submit signed RFQ order. See F-002 on the `quoteId` parameter. | Medium | `DOC_VERIFIED` |
| `/api/v1/dex/aggregator/order/{orderId}` | GET | Poll RFQ settlement | Medium | `DOC_VERIFIED` |

## Transaction API

| Endpoint | Method | Used for | Schema confidence | Verified |
|---|---|---|---|---|
| `/api/v1/dex/pre-transaction/gas-price` | GET | Gas estimation | Loose | `DOC_VERIFIED` path only |
| `/api/v1/dex/pre-transaction/gas-limit` | POST | Gas limit estimation | Not implemented | `DOC_VERIFIED` path only |
| `/api/v1/dex/pre-transaction/simulate` | POST | **Pre-sign gate for SWAP.** Body `{binanceChainId, evmTx:{from,to,value,data}}` built from `/swap` `data.tx`. Response `data.{status, failReason, balanceChanges[], allowanceChanges[]}`. A route that does not explicitly pass cannot be offered; `SUCCESS`+`failReason` fails closed (DOC-005). | Strict on load-bearing fields, additive-tolerant | Contract `DOC_VERIFIED`; implementation `IMPLEMENTED_UNVERIFIED`; runtime `BLOCKED_CREDENTIALS` |
| `/api/v1/dex/pre-transaction/broadcast-transaction` | POST | Relay a user-signed transaction | Loose | `DOC_VERIFIED` |
| `/api/v1/dex/pre-transaction/block-height` | GET | Not used in v1 | n/a | `DOC_VERIFIED` path only |
| `/api/v1/dex/post-transaction/orders` | GET | Broadcast order status | Not implemented | `DOC_VERIFIED` path only |

## Wallet API

| Endpoint | Method | Used for | Schema confidence | Verified |
|---|---|---|---|---|
| `/api/v1/dex/post-transaction/transaction-detail-by-txhash` | GET | Post-settlement verification and token transfers | Loose | `DOC_VERIFIED` |
| `/api/v1/dex/wallet/all-token-balances-by-address` | GET | USDT and wrapper balances for gates | **Path unconfirmed** | `UNTESTED` |

The balances path was not confirmed against a retrieved page in this cycle. Confirm
before relying on it.

---

## Independent verification path

Not a Binance endpoint, and that is the point. Post-execution state is checked through
a separate BSC RPC (`TALOE_BSC_RPC_URL`) so that Binance's own success flag is never
the only proof a trade worked.

## Authentication

| Property | Value |
|---|---|
| Headers | `X-OC-APIKEY`, `X-OC-TIMESTAMP`, `X-OC-SIGN` (required); `X-OC-RECV-WINDOW`, `X-OC-NONCE` (optional) |
| Timestamp | ISO 8601 with milliseconds |
| Pre-hash | `timestamp + METHOD + requestPath + body` |
| Signature | Base64(HMAC-SHA256) |
| Signed path | Must include `/build` |
| GET body | Empty string |

## Rate limits

| Dimension | Limit | Window |
|---|---|---|
| Per IP | 1200 | 60s |
| Per API key | 1200 | 60s |
| Per user | 6000 | 60s |
| Per endpoint | 5 RPS | 1s |

HTTP 429 carries `Retry-After` in seconds. The client honours it.

**Budget note:** at 5 RPS per endpoint, quoting N wrappers means N sequential or
lightly-parallel calls to `/quote`. With a 30-second quote lifetime, wrapper count
directly consumes quote freshness. Worth measuring early.
