# Judge Scorecard

Maintained continuously, not at submission time. Honest self-assessment against the
official weights.

Updated 2026-09-21.

---

## Technical implementation — 30%

**What exists (updated V2):** centralised signed Binance client with the `/build` rule,
raw-query preservation and business-code checking enforced in one place. Two genuinely
separate execution state machines that now also separate sponsor/chain-native
settlement from Taloe's own independent verification for BOTH modes. A router with
lexicographic hard gates, issuer-specific normalization that fails closed per issuer
rather than globally, and a candidate-level rejection stage that lets one issuer's
documented restriction reject only that candidate. A `DiscoveryPort` abstraction with
two real implementations (fixture, live) sharing one interface with no fallback path
between them. A runnable live-validation harness. 135 passing tests. Strict TypeScript
across seven packages, plus a working lint pipeline.

**Evidence:** `pnpm verify`, `pnpm lint`, `pnpm build`, `internal/evidence/TEST_MATRIX.md`.

**Demo moment:** the full route -> review -> execution -> receipt journey, live-clicked
through a running production build, in fixture mode.

**Weakness, stated plainly:** not one live API call has been made. Everything is
doc-correct and fixture-tested, which is necessary and not sufficient. A judge can
currently verify our engineering, not our integration.

**Next score-raising action:** obtain credentials and complete one signed call.
Everything else is downstream.

## Creativity and originality — 25%

**What exists:** the routing primitive itself. Not a stock bot, dashboard or DCA
agent, but a decision about which tokenized representation of one company to acquire
and through which execution mode. The documented issuer split (Ondo RFQ, xStock AMM,
BStock mixed) with issuer-specific market-hours restrictions makes this a real
question rather than a constructed one.

**Evidence:** `internal/sponsor/SPONSOR_FINDINGS.md` F-001 and F-003.

**Demo moment:** one underlying, two wrappers, two execution modes, one of which is
unavailable outside US market hours.

**Weakness:** unproven. If NVDA turns out to have one wrapper on BSC, the idea is
sound and the demo is thin.

**Next action:** confirm wrapper overlap for the campaign tickers.

## Developer Experience Report — 25%

**What exists:** a dated journal started before the first authenticated call, with
three substantive entries carrying reproduction steps, time lost and suggested fixes.
Four capability requests, each tied to a gap we hit. A documentation-issues file
separate from product findings.

**Evidence:** `internal/sponsor/DX_JOURNAL.md`, `DOC_ISSUES.md`,
`REQUESTED_CAPABILITIES.md`, `ERROR_LOG.md`.

**Strongest finding so far:** the schema gap between the Trading API integration flow
and the Market/Transaction reference pages (DOC-002), because it has a concrete cost
and a concrete fix.

**Weakness:** all three entries are documentation findings. There is no runtime
finding — no latency, no error semantics, no quote-expiry behaviour — because there is
no runtime access. Latency and rate-limit capture is already wired into the client, so
this fills in quickly once credentials arrive.

**Next action:** credentials, then the measurement targets listed at the end of the
journal.

## Product quality and UX — 20%

**What exists (updated V2):** a complete consumer journey, structurally functional end
to end in fixture mode. Company-first landing, route comparison with plain-language
reasons for every recommendation and rejection, a disambiguation flow for ambiguous
queries, a review page that blocks signing on an expired price and shows a real
simulation result, a step-by-step execution page with a semantic status region for
assistive tech, and a receipt that distinguishes "the network confirmed this" from
"Taloe independently verified this." Twelve named fixture scenarios cover every
decision outcome and several distinct refusal reasons.

**Evidence:** a running production build was smoke-tested against all 12 scenarios and
the full execution/receipt timeline for three terminal outcomes (see
`internal/product/BUILD_STATUS.md` "Verification evidence for this cycle"). Source in
`apps/web/src/app/{route,review,execution,receipt}`.

**Demo moment:** the `TSLA` scenario — one underlying, one closed session, Ondo
rejected for a documented reason while BStock wins — walked from landing to receipt.

**Weakness, stated plainly:** no real wallet SDK (a checkbox attaches a fixed demo
address); no persisted session store (pages are stateless functions of their URL, an
honest simplification — see `DECISIONS.md` D-020); no visual design pass (deliberately
deferred per the PRD until reference images arrive); zero live data has touched any of
these pages.

**Next action:** once credentials exist and the live discovery provider is verified,
swap the fixture provider for the live one behind the same `DiscoveryPort` interface —
no page needs to change. A real wallet adapter is the next UX-facing gap after that.

---

## Overall honest position

Strong foundations, zero empirical validation, no user-facing product yet.

The correctness work done here is the kind that is expensive to retrofit — signing,
error semantics, state machines, the refusal to fabricate normalization — and the
remaining work is the kind that goes fast once data flows. But a judge opening the
repository today sees a library, not a product.

The two things that change that, in order: credentials, and Gate G.
