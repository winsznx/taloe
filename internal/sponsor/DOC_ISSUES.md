# Documentation Issues

Specific, reproducible documentation problems. Distinct from `SPONSOR_FINDINGS.md`,
which tracks product-relevant seams, and from `ERROR_LOG.md`, which holds raw evidence.

All observations 2026-09-21.

---

## DOC-001 — `llms.txt` and `.md` doc routes are bot-challenged

**Page:** `https://web3.binance.com/en/dev-docs/llms.txt` and the `.md` variants.

**Problem:** returns HTTP `202` with a zero-byte body to command-line clients,
including with a browser `User-Agent`. An `llms.txt` file exists precisely so agents
can read the docs; challenging those clients defeats it. The empty `202` is also
undiagnosable, since it is a success status carrying no content.

**Suggested fix:** exempt the documentation routes, or return `403` with an
explanatory body.

**Severity:** medium for agent-assisted development, which this hackathon actively
encourages.

## DOC-002 — Market API and Transaction API introduction pages carry no schemas

**Pages:** `products/market-api/introduction`, `products/transaction-api/introduction`.

**Problem:** endpoint, method and a one-line description only. No parameters, no
response fields, no status vocabularies. The six RWA endpoints and the
`pre-transaction/simulate` endpoint are all affected. Simulate is the check standing
between a user and signing a failing transaction, and its response shape is not
documented there.

**Contrast:** `products/trading-api/integration-flow` is detailed, worked and
genuinely good. The gap between the two standards is the issue.

**Suggested fix:** bring the RWA and Transaction reference pages to the integration
flow's standard.

**Severity:** high. Directly blocks writing precise clients.

## DOC-003 — `quoteId` parameter on `/order/submit` takes an order ID

**Page:** `products/trading-api/integration-flow`.

**Problem:** the parameter is named `quoteId` but takes `rfq.orderId` from `/swap`.
The docs flag this parenthetically, which suggests it has caught developers before.
Both values are opaque strings, so nothing catches the mistake locally and the
resulting failure most likely reads as quote expiry.

**Suggested fix:** rename to `rfqOrderId`, or accept either and disambiguate
server-side.

**Severity:** medium. Documented, but the naming actively invites the error.

## DOC-004 — PRD-era doc paths have moved

**Problem:** the PRD cites `catalog/web3-wallet/api/rest-api/rwa-data` as a standalone
RWA API. RWA data is now inside the Market API at `/api/v1/dex/market/rwa/*`.

**Severity:** low. Noted so our own API matrix stays accurate.

## DOC-005 — Documented simulate example shows `status: "SUCCESS"` with a revert-style `failReason`

**Classification:** `DOCUMENTATION_AMBIGUITY`
**Observed:** 2026-09-21
**Page:** <https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/transaction-api> (Simulate Transactions section).

**Observation:** the field table says `failReason` is "failure reason when status=FAILED",
but the page's own example response is:

```json
{ "code": 0, "msg": "success",
  "data": { "status": "SUCCESS",
            "failReason": "execution reverted: ERC20InsufficientBalance",
            "balanceChanges": [ { "contractAddress": "0xdAC1...1ec7", "tokenType": "ERC20",
                                  "change": "-1000000", "owner": "0xd8dA...6045" } ],
            "allowanceChanges": [...] } }
```

Either the example is a copy-paste artifact, or `status` reports "the simulator ran" while
`failReason` carries the EVM outcome. The docs do not say which. Not reproduced live, so
this is not a defect claim.

**Taloe behaviour:** `TransactionService.simulate` treats `SUCCESS` + non-empty `failReason` as
an inconsistent sponsor response: it never returns PASS, never invents a FAIL rule, maps to
`NOT_RUN` (router gate: refuse), and hands the raw payload to an evidence hook. If this occurs
live and reproduces, reclassify to `RUNTIME_DIFFERENCE` and record which field the chain agreed with.

**Suggested fix:** state the precedence rule, and fix or annotate the example.
