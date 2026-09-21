# Requested Platform Capabilities

Capability requests for the DX report. Each states the developer time or product risk
it removes. A request is only listed once we have hit the gap ourselves.

---

## R-001 — Pre-settlement validation for RFQ orders

**Gap:** SWAP routes can be validated before the user signs, via
`pre-transaction/simulate`. RFQ routes cannot: settlement is vendor-relayed after an
EIP-712 signature and the client never holds a transaction to simulate.

**Consequence:** the two execution modes offer users materially different safety
guarantees for the same intent. A product that routes across both either drops to the
weaker guarantee everywhere or explains an asymmetry the user did not ask for.

**Request:** an endpoint that validates an RFQ order payload — signature, allowance,
vendor availability, expected output, market-hours eligibility — before submission.

**Removes:** a class of failures currently only discoverable after signing.

**Status:** to be confirmed against live behaviour before filing. If a pre-check
already exists and we missed it, that is a documentation finding instead.

---

## R-002 — Response schemas on Market API RWA and Transaction API reference pages

**Gap:** see `DOC_ISSUES.md` DOC-002.

**Consequence:** ~25 minutes lost this cycle, and schemas written loosely enough that
a wrong field-name guess is invisible until a live call.

**Request:** parameter and response documentation matching the Trading API integration
flow's standard.

**Removes:** guesswork at every RWA and simulation integration point.

---

## R-003 — A quote expiry timestamp in the quote response

**Gap:** quote lifetime is documented as ~30 seconds but no expiry timestamp is
returned, so every client computes freshness from a constant plus local clock.

**Consequence:** each integrator reimplements the same estimate with their own safety
margin, and none of them can tell a genuinely expired quote from a clock skew.

**Request:** return `expiresAt` on the quote response.

**Removes:** a guess from the critical path of every execution.

---

## R-004 — Let the documentation routes through the bot challenge

See `DOC_ISSUES.md` DOC-001. An `llms.txt` file that machine clients cannot fetch is
not serving its purpose.
