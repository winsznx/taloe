# Claim Parity

These surfaces must agree. A claim disproved on one must be corrected on all of them in
the same work cycle.

| Surface | Exists | Last checked |
|---|---|---|
| README | yes, rewritten for live-validated status | 2026-10-11 |
| Deployed application | no | — |
| PRD (`internal/product/Taloe_PRD_v1.md`) | yes | 2026-09-21 |
| Submission answers | draft, limitations updated for live status | 2026-10-11 |
| Demo narration | outline | 2026-09-21 |
| Screenshots | no | — |
| DX Report | journal only | 2026-09-21 |
| `CLAIM_LEDGER.md` | yes | 2026-09-21 |
| Evaluation results | none | — |

---

## Known divergences to resolve

### 1. PRD versus current documentation on xStocks

The PRD treats xStocks support as an open question that might not exist. The current
Trading API documents it as a first-class token family. The ledger records this as
correction X1.

**Action:** the PRD is left unedited as a dated artifact. Any public copy must follow
the ledger, not the PRD.

### 2. PRD versus current documentation on RFQ ambiguity

PRD 5.4 describes conflicting doc wording about whether equity routes always use RFQ.
The current docs state per-issuer behaviour explicitly. Ledger correction X2.

**Action:** do not present this as a live documentation inconsistency in the DX report.
It was resolved by a documentation update, and claiming otherwise would be inaccurate.

### 3. PRD repository shape versus actual

The PRD sketches `binance-engineering/` with `docs/` at the root. The actual layout is
`internal/` for engineering memory and `packages/` per the PRD's own package list.

**Action:** cosmetic. Note it in the README when written.

---

## Pre-submission audit

Not yet run. Before V0, every number, every capability claim and every "verified" in
public copy must be traced to a ledger row at the matching confidence level.
