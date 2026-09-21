# Taloe Product Requirements Document

**Version:** 1.0  
**Status:** Implementation PRD with empirical lock gates  
**Prepared:** 21 September 2026  
**Hackathon:** BNB Hack: Tokenized Stocks Edition  
**Submission lock:** 11 October 2026, 12:00 UTC  
**Internal valid-submission V0 deadline:** 10 October 2026, 12:00 UTC  
**Primary chain:** BNB Smart Chain mainnet (`binanceChainId = 56`)  

> Visual design tokens are intentionally excluded from this PRD. The frontend requirements below define information architecture, interaction behavior, states, content hierarchy, responsiveness, and accessibility. Final visual styling should follow the inspiration images supplied later without changing the product logic or required states.

---

## 1. Product Lock

### 1.1 Product name

**Taloe**

Internal subsystem names:

- **WrapRoute** - wrapper-aware execution and route-selection engine.
- **SessionMark** - market-session, reference-price, freshness, and tradability context used by WrapRoute.
- **Route Watch** - optional persistent Agent Studio extension. It is not required for the core product and must not delay the main submission.

### 1.2 One-line product

Taloe turns an intent such as **"Buy $500 of NVIDIA"** into the best executable tokenized NVIDIA exposure available on BSC under the user's constraints, or refuses to trade when no available route qualifies.

### 1.3 Product object

Taloe is a **tokenized-equity execution router**.

The web application is the primary consumer surface and reference client. The differentiated product mechanism is not the interface itself. The mechanism is the ability to discover tokenized representations of one underlying, understand their current state, obtain executable routes, normalize their outcomes into comparable underlying-equivalent exposure, simulate where possible, and choose or refuse an execution.

### 1.4 Interface identity vs mechanism identity

**What the interface should feel like:** a simple brokerage-style purchase flow.

**What the product actually does:** wrapper-aware, session-aware, execution-aware routing across tokenized-equity representations and available execution paths.

The product must never collapse into any of these shapes:

- a token-price comparison dashboard,
- a weekend arbitrage bot,
- a generic AI trading chatbot,
- an MCP/API wrapper,
- a portfolio dashboard with no consequential routing decision,
- a safety or verification page pretending to be the product.

### 1.5 Core decision primitive

> Given an underlying ticker, spend amount, wallet, current market context, available wrappers, executable routes, and user constraints, which wrapper + execution path gives the best valid underlying-equivalent exposure now?

Possible outcomes are:

- `ACT` - one route satisfies all required constraints and can proceed.
- `NO_ACTION` - the user already holds the intended exposure or no switch/purchase is justified for the requested operation.
- `REFUSE` - candidates exist, but all violate a hard constraint or fail a required execution check.
- `UNKNOWN` - the product cannot establish enough trustworthy information to compare candidates.
- `MANUAL_REVIEW` - an ambiguous mapping, unsupported issuer path, contradictory API response, or other condition makes automatic execution inappropriate.

For the first-purchase flow, `ACT`, `REFUSE`, `UNKNOWN`, and `MANUAL_REVIEW` are mandatory. `NO_ACTION` becomes mandatory once holdings-aware routing or Route Watch is enabled.

---

## 2. Hackathon Contract

The current official event page says:

- build window: 16 September to 11 October 2026;
- BSC mainnet only;
- spot only;
- at least one of bStocks, Ondo, or xStocks must be central;
- small live amounts should be used after Transaction API dry-runs;
- a public repository, deployed path/instructions, and Developer Experience Report are required;
- the recommended demo video is four minutes or less;
- the Developer Experience Report is worth 25% of the score;
- Agentic Wallet / Wallet Skills and BNB Agent Studio have separate $2,000 special prizes that can stack with a main placement.

### 2.1 Official score weights

| Criterion | Weight | Taloe scoring strategy |
|---|---:|---|
| Technical implementation | 30% | One real BSC path combining RWA discovery/context, Trading quote/build, Transaction simulation/broadcast where applicable, execution-mode-specific handling, Wallet verification, and robust failure handling. |
| Creativity & originality | 25% | Route an underlying-equity intent across wrappers and execution modes rather than building one of the organizer's listed stock bots, dashboards, DCA agents, baskets, or simple arbitrage monitors. |
| Developer Experience Report | 25% | Dated first-party engineering journal containing onboarding time, exact docs seams, API failures, latency, quote expiry behavior, wrapper differences, execution-mode differences, and concrete platform redesign suggestions. |
| Product quality & UX | 20% | User asks for a company and amount. Taloe hides infrastructure complexity while still exposing honest details before signing. |

### 2.2 Special-prize posture

The main product must remain complete without either special-prize integration.

**Agentic Wallet / Wallet Skills** should be used only when it can act as a credible execution surface for a Taloe decision under user-configured spend/token rules.

**BNB Agent Studio** should be added only after the core router has produced real `ACT`, `NO_ACTION`, and `REFUSE` observations. The Studio extension should operate a persistent routing mandate, not replace the primary product with another agent demo.

---

## 3. Problem

Tokenized equities on BSC can expose multiple representations of the same underlying company. A buyer who wants "NVIDIA" may encounter issuer-specific tokens rather than one canonical equity object. Those representations can differ in metadata, token-to-underlying relationship, reference/on-chain pricing, market-session context, liquidity, execution path, approval requirements, quote lifetime, and transaction viability.

The current user workflow is often equivalent to:

1. search for a ticker;
2. pick the first recognizable token;
3. accept the venue's quote;
4. discover execution problems, poor price impact, a paused/halted path, or wrapper differences after the fact.

Taloe moves wrapper and execution selection into the product.

### 3.1 Primary user job

> I already decided that I want exposure to a named company. Find a valid way to acquire that exposure on BSC without making me understand every issuer token and execution path.

### 3.2 First customer

The primary v1 customer is **a BSC wallet holder with USDT who has already decided to buy a supported tokenized equity**.

This is intentionally narrower than "everyone who has never used crypto." The frontend should still be legible to a non-crypto-native user, because that is part of the event's UX rubric, but the product does not depend on solving fiat onboarding, KYC, or first-wallet creation in v1.

### 3.3 Value-return contract

The user gives Taloe:

- ticker/company intent;
- spend amount;
- BSC wallet address and signing permission at execution time;
- maximum execution/reference deviation or equivalent constraint;
- a short decision window while quotes remain valid.

Taloe returns:

- a selected executable wrapper and route, or an explicit refusal;
- the actual token that will be received;
- estimated underlying-equivalent exposure;
- execution mode and quote freshness;
- expected cost, slippage/impact, network cost where available, and reference context;
- a simulation result for raw EVM transactions where available;
- a verified post-execution receipt after settlement.

If Taloe cannot show a meaningful improvement in valid execution decisions over simpler baselines, the thesis must be revised rather than hidden behind UI or agent features.

---

## 4. Goals and Non-Goals

### 4.1 V1 goals

1. Accept a supported underlying ticker/company and a USDT spend amount.
2. Discover all safely comparable BSC tokenized representations available through the integrated Binance surfaces.
3. Fetch and preserve current RWA metadata and market/session context.
4. Obtain executable quotes for candidate wrappers.
5. Treat runtime `executionMode` as authoritative and support both `SWAP` and `RFQ` state machines when returned.
6. Normalize candidate outcomes into an underlying-equivalent comparison without assuming token symbols are economically identical.
7. Enforce user constraints and produce `ACT`, `REFUSE`, `UNKNOWN`, or `MANUAL_REVIEW` honestly.
8. For SWAP routes, build and simulate the actual EVM transaction before asking the user to sign.
9. For RFQ routes, sign the EIP-712 order through the user's wallet, submit it, and track RFQ order settlement correctly.
10. Execute at least one small mainnet trade during development and verify the resulting state independently.
11. Keep a structured Developer Experience journal from the first authenticated API call.
12. Produce judge-visible evidence without turning the main web app into a proof dashboard.

### 4.2 Explicit non-goals for the hackathon build

- predicting stock prices or Monday opens;
- optimizing or advertising PnL;
- perps, options, margin, or leverage;
- becoming an issuer, broker-dealer, custodian, or tokenization platform;
- fiat/card onboarding;
- tax reporting;
- advanced portfolio rebalancing;
- thematic baskets;
- earnings/news trading agents;
- generic chat-first trading;
- MCP or SDK as the primary product;
- DeFi lending/LP of tokenized equities;
- institutional in-kind mint/redeem flows;
- support for every possible tokenized-stock issuer when the Binance data required for honest normalization is unavailable;
- Agent Studio as a blocker for the core web product.

---

## 5. Fresh Documentation Findings That Shape the Build

The PRD is based on the current official documentation reviewed on 21 September 2026.

### 5.1 Binance Web3 API authentication

All authenticated requests use the Binance Web3 base URL:

`https://web3.binance.com/build`

Required headers are `X-OC-APIKEY`, `X-OC-TIMESTAMP`, and `X-OC-SIGN`. `X-OC-RECV-WINDOW` and `X-OC-NONCE` are optional. The signed request path must include the literal `/build` prefix and the exact raw query encoding. The HMAC pre-hash is:

`timestamp + METHOD + requestPath + body`

The API secret must remain server-side. No browser bundle may contain the API secret.

### 5.2 Business errors are not equivalent to HTTP errors

Current Trading and Wallet documentation states that responses can use HTTP 200 while the body carries a non-zero business `code`. All Binance adapters must check the body code before treating a call as successful.

A shared response parser must therefore enforce:

```text
HTTP transport succeeded
AND body.code == 0
AND expected data shape validates
```

Anything else is an error or unsupported response.

### 5.3 RWA data available today

The current RWA API exposes:

- issuance-platform discovery;
- RWA search by ticker/company/contract;
- batch token price and underlying reference price;
- underlying profile and attestation URLs;
- token list with `underlyingTicker`, `tokenToShareRatio`, `statusInfo`, `tokenPrice`, and `referencePrice`;
- underlying market data including session state and next open/close information.

The documented `platformId` filter currently enumerates `ondo` and `bstock`. The hackathon includes xStocks, so xStocks discovery/normalization is an empirical seam to investigate. Taloe must not fabricate parity across issuers.

### 5.4 Trading API behavior

The current Trading API provides:

- aggregator chain discovery;
- ERC-20 approval transaction construction;
- multi-vendor quotes;
- swap transaction building;
- quote-and-swap fast path;
- transaction-status support;
- RFQ order submission and RFQ order polling.

`GET /api/v1/dex/aggregator/quote` returns routes with `quoteId`, `vendorName`, amounts, gas estimates, price impact, route details, `executionMode`, and other metadata. The documentation says quote IDs have a lifetime of roughly 30 seconds.

The documentation contains issuer/RFQ wording that must be tested rather than hardcoded. One section describes equity/RWA routes as RFQ, while the integration guide says equity/RWA routes *can* return RFQ, and the Flash API documents BStock-specific RFQ defaults. Therefore Taloe must branch on the actual returned `executionMode` and record any inconsistent behavior in the DX log.

### 5.5 SWAP and RFQ are different state machines

**SWAP:** build an unsigned transaction, simulate it, sign it in the user's wallet, broadcast it, then verify the resulting on-chain transfers.

**RFQ:** quote first, use vendor-specific approval when required, build the RFQ payload, sign `rfq.typedDataToSign` using EIP-712, submit with an idempotency `requestId`, then poll RFQ order status until a terminal state. A normal swap broadcast is not the RFQ settlement mechanism.

Terminal RFQ states documented today include `FILLED`, `FAILED`, `EXPIRED`, and `CANCELLED`. Intermediate states include `PENDING_VENDOR` and `PENDING_ONCHAIN`.

### 5.6 Simulation semantics

`POST /api/v1/dex/pre-transaction/simulate` predicts an EVM transaction's execution status and returns balance and allowance changes. This is ideal for SWAP transaction validation and approval transaction validation.

RFQ settlement is vendor-relayed after EIP-712 order submission, so the PRD must not pretend that the Transaction API can simulate a vendor settlement transaction that the client does not possess. If no direct RFQ simulation primitive is available, Taloe should validate the quote/order payload, approvals, user constraints, signatures, and final RFQ settlement honestly. This is also a candidate DX capability request.

### 5.7 Post-broadcast verification

Broadcast success is not final success. The Wallet API transaction-detail endpoint can temporarily return an empty result while indexing catches up. Taloe must poll with backoff and inspect final `txStatus` plus token-transfer details. An API broadcast response alone is insufficient proof.

### 5.8 Agentic Wallet today

The current Agentic Wallet docs support BSC and allow user-defined daily limits and tradable-token scope. The tokenized-securities use case describes resolving bStock/Ondo tickers, checking status, quoting, buying/selling, and continuous strategies.

Taloe's differentiation must therefore **not** be "plain-language stock trading." Agentic Wallet should consume Taloe's differentiated routing decision or execute the selected wrapper under user constraints.

### 5.9 Wallet Skills today

Binance Wallet Skills are composable AI modules callable by LLM agents/applications. The currently published `binance-agentic-wallet` skill is read/write, while `binance-tokenized-securities-info` is read-only. Current documentation is not perfectly consistent about whether the latter is Ondo-only or bStock + Ondo. Record actual behavior during integration.

### 5.10 Agent Studio today

BNB Agent Studio currently supplies an autonomous runtime, wallet options, ERC-8004 identity, ERC-8183 tasks, x402/B402 payment integrations, and managed deployment options. The managed `bnb` deployment documented in the current quickstart is a time-limited testnet trial and the docs explicitly warn builders to use a throwaway wallet because signing material leaves their control in that mode. Taloe must never reuse the mainnet trading wallet for that test runtime.

---

## 6. User and Actor Model

### 6.1 Primary actor map

| Actor | V1 role |
|---|---|
| Flow originator | User asking to acquire a named underlying equity exposure. |
| Beneficiary | Same user. |
| Installer | User of the web app. A Wallet Skill may become a later distribution surface. |
| Operator | Taloe web/backend services. Optional Route Watch agent later. |
| Payer | User pays the actual trade input, gas, and any route costs. |
| Distribution owner | Initially Taloe. Potentially Binance Wallet / Skills Hub for the skill extension. |
| Counterparty/liquidity | Existing AMM/RFQ liquidity providers surfaced through the Trading API. Taloe does not recruit them. |

### 6.2 Cold-start profile

Taloe does not require a two-sided marketplace. It can create value for one user as long as the relevant tokenized-stock representations and execution liquidity already exist.

---

## 7. Core User Journeys

### 7.1 Journey A - First purchase, successful route

1. User opens Taloe.
2. User searches `NVDA` or `NVIDIA`.
3. Taloe resolves the underlying and displays the company/ticker.
4. User enters a USDT amount.
5. User optionally adjusts the maximum acceptable deviation/impact constraint.
6. User connects a BSC wallet if not already connected.
7. Taloe discovers safely comparable wrapper candidates.
8. Taloe fetches RWA context and executable quotes.
9. WrapRoute evaluates candidates and chooses one route.
10. Route Result shows the recommended wrapper, expected underlying-equivalent exposure, execution mode, session context, quote freshness, cost/impact, and reasons.
11. User opens Review.
12. Taloe checks or obtains required approval.
13. Taloe refreshes the quote if necessary. Any material route change re-runs the decision and is surfaced before signing.
14. For `SWAP`, Taloe builds and simulates the transaction. For `RFQ`, it prepares the RFQ signing payload and verifies all available constraints.
15. User signs.
16. Taloe executes through the correct SWAP or RFQ path.
17. Taloe verifies settlement and wallet changes.
18. User sees a receipt naming the actual wrapper token received and the underlying-equivalent exposure.

### 7.2 Journey B - No valid route

1. User enters ticker and amount.
2. Candidates are discovered.
3. Every candidate fails at least one hard gate.
4. Taloe returns `REFUSE` rather than hiding or weakening the constraint.
5. UI explains each failure in user language, for example:
   - route exceeds your maximum deviation;
   - transaction simulation failed;
   - RFQ expired and no replacement route qualified;
   - wrapper mapping is incomplete;
   - issuer/trading state is paused;
   - available liquidity is insufficient for this size.
6. User may change the amount or constraint and re-run.

### 7.3 Journey C - Unknown/unsupported comparison

1. Taloe finds a token or issuer path it cannot normalize with sufficient confidence.
2. It excludes that candidate from automated comparison.
3. It labels the exclusion clearly.
4. If no sufficiently understood candidate remains, result is `UNKNOWN` or `MANUAL_REVIEW`.
5. The event is written to `SPONSOR_FINDINGS.md` if it exposes a sponsor-data gap.

### 7.4 Journey D - Quote expires during execution

1. User reaches Review.
2. Quote lifetime becomes unsafe or API returns `QUOTE_EXPIRED`.
3. Taloe does not retry the same `quoteId`.
4. It obtains a fresh quote and re-runs route constraints.
5. If the selected wrapper/route or user-visible economics materially changes, require fresh confirmation.
6. If no refreshed route qualifies, return `REFUSE`.

---

## 8. Frontend Requirements

### 8.1 Frontend product principles

1. The user sees the company before the wrapper.
2. The actual wrapper is always disclosed before signing and on the receipt.
3. The main path must not require the user to understand RFQ, AMM, contract addresses, or token-to-share mechanics.
4. Advanced execution details remain inspectable.
5. Every loading state must say what Taloe is doing rather than displaying an indefinite spinner.
6. A failure should produce an actionable next state, not a raw API error.
7. The public product must look and behave like a real application. Judge evidence belongs in supporting surfaces, not as the homepage.
8. Visual styling is deferred to later inspiration images. Do not invent a visual system in this PRD.

### 8.2 Recommended frontend stack

- Next.js with the current stable App Router at repository initialization.
- React + TypeScript.
- Server-side route handlers for all Binance Web3 API calls that require the API secret.
- `viem`-compatible EVM primitives for BSC transaction encoding/verification and wallet interactions; a wallet-adapter layer should prevent product logic from depending on one connector.
- A query/cache layer such as TanStack Query for browser request state.
- Zod or equivalent runtime schema validation at every sponsor/API boundary.
- Current Active LTS Node.js pinned in repository tooling at initialization.
- `pnpm` workspace so core routing logic can be shared by the web app, tests, and optional agent/skill package.

Exact library versions must be pinned by the lockfile at build time rather than copied from this PRD.

### 8.3 Route map

#### `/`
Primary Taloe experience.

Contains:

- product proposition in one sentence;
- stock search / ticker input;
- amount input;
- wallet connection state;
- optional advanced constraint control;
- recent successful route examples only if real evidence exists;
- concise tokenized-securities risk notice;
- clear primary action.

Do not place architecture diagrams, benchmark charts, hackathon badges, or proof counts above the primary action.

#### `/route/[routeSessionId]`
Route decision and comparison.

Shows:

- underlying company and ticker;
- requested spend;
- overall decision (`ACT`, `REFUSE`, etc.);
- recommended route when applicable;
- current underlying market/session context;
- quote freshness/countdown;
- expected wrapper tokens received;
- estimated underlying-equivalent exposure;
- reference deviation;
- route price impact/slippage if available;
- network/trade fee fields when available;
- execution mode (`SWAP` or `RFQ`) in expandable details;
- plain-language reason for the recommendation;
- alternatives with rejection/ranking reasons;
- Review action when `ACT`.

#### `/review/[routeSessionId]`
Final pre-sign review.

Must show:

- exact input token and amount;
- exact wrapper token being acquired;
- platform/issuer label when reliably available;
- token contract address in advanced details;
- estimated wrapper amount;
- estimated underlying-equivalent exposure;
- current quote age / expiry state;
- user constraint and current observed value;
- approval requirement;
- predicted balance changes if a SWAP simulation exists;
- clear distinction between tokenized exposure and direct registered share ownership;
- one explicit execution confirmation action.

If any route-affecting data becomes stale, do not allow signing until refreshed.

#### `/execution/[executionId]`
Step-by-step execution progress.

For SWAP:

1. approval check;
2. approval signature if required;
3. approval confirmation;
4. fresh quote / route revalidation;
5. transaction build;
6. simulation;
7. user signature;
8. broadcast;
9. chain confirmation / Wallet API indexing;
10. verified completion.

For RFQ:

1. quote and vendor identification;
2. vendor-specific approval if required;
3. approval confirmation;
4. quote refresh if TTL margin is insufficient;
5. RFQ payload build;
6. EIP-712 signature;
7. order submission with idempotency request ID;
8. `PENDING_VENDOR` / `PENDING_ONCHAIN` state;
9. terminal RFQ state;
10. transaction verification when a tx hash exists.

The frontend must visibly distinguish a pending API operation, pending user signature, pending vendor, and pending chain confirmation.

#### `/receipt/[executionId]`
Verified trade result.

Must show:

- decision and execution status;
- amount spent;
- wrapper token actually received;
- actual received amount when known;
- underlying-equivalent exposure using the validated normalization method;
- route/vendor/execution mode;
- transaction hash and external explorer link when available;
- final Wallet API/on-chain status;
- timestamp;
- route constraints used;
- any difference between quoted and executed amount;
- plain-language "what you now hold" explanation.

The receipt is part of the product, not a judge-only verifier.

#### `/activity`
Minimal user activity history for executions initiated by this connected wallet/session.

V1 needs only:

- execution timestamp;
- ticker;
- wrapper;
- spend amount;
- status;
- receipt link.

Do not build a full PnL dashboard.

#### `/about/how-it-works`
Short user-facing explanation of why multiple wrappers can exist and how Taloe chooses among candidates. This page must remain product language, not hackathon language.

#### `/evidence`
Optional supporting judge/research surface.

This is not part of the primary nav for ordinary users unless the final visual design supports it naturally. It may expose:

- current evaluation campaign summary;
- reproducible route observations;
- sponsor ablation outcomes;
- mainnet transaction evidence;
- known limitations.

It must not replace the real application.

### 8.4 Search behavior

- Accept ticker, company name, and supported contract address.
- Prefer RWA search as the semantic source for supported bStock/Ondo mappings.
- Do not silently merge different companies with ambiguous names.
- Each result should include company name, ticker, and number of safely identified wrappers when known.
- Unsupported/uncertain xStocks or other issuer mappings must be clearly marked rather than guessed.

### 8.5 Amount behavior

V1 funding token: **USDT on BSC**.

Reasons:

- consistent baseline across wrapper candidates;
- aligns with official tokenized-stock examples and Agentic Wallet use cases;
- reduces an unnecessary second routing dimension during the hackathon.

Later versions can add other funding assets.

Input validation:

- amount must be positive;
- wallet balance must be checked before final execution;
- amount should be tested against available route liquidity rather than rejected from static min/max assumptions;
- any API/vendor minimum should be surfaced from observed behavior or documented constraints.

### 8.6 Constraint behavior

Expose one primary user constraint in V1:

**Maximum allowed execution deviation from the product's validated reference basis.**

The exact default must remain configurable until the live liquidity spike establishes reasonable behavior. Do not bury the value in code.

Advanced details may include price impact/slippage controls if the execution API requires them, but the consumer path should not force users to tune DEX-specific settings manually.

### 8.7 SessionMark presentation

SessionMark should convert raw status/reference context into user-facing labels such as:

- Regular market session
- Pre-market
- Post-market
- Overnight
- Underlying market closed
- Trading/issuer pause
- Reference context unavailable

Important: an underlying market being `closed` is **not automatically a token-trading refusal**. Tokenized assets may continue trading while the underlying reference market is closed. Closed-session state should increase context/freshness scrutiny and may affect constraints, but the router should only refuse when a real product rule is violated.

### 8.8 Frontend state requirements

Every key screen must have explicit states for:

- initial/empty;
- searching;
- no matching underlying;
- candidate discovery;
- partial issuer coverage;
- quoting;
- route calculated;
- stale quote;
- wallet disconnected;
- wrong chain;
- insufficient USDT;
- insufficient BNB for gas when required;
- approval required;
- user rejected signature;
- simulation passed;
- simulation failed;
- RFQ pending;
- RFQ expired;
- transaction pending;
- indexing pending;
- execution success;
- execution failure;
- compliance/region error;
- sponsor API unavailable;
- manual-review state.

### 8.9 Responsive behavior

- The entire buy flow must work on narrow mobile widths and desktop.
- Mobile must not hide critical quote expiry, wrapper identity, constraints, or signing state below inaccessible overlays.
- Execution progress must survive browser refresh through server-side execution records or recoverable identifiers.
- Tables should collapse into stacked candidate cards on smaller screens.
- Contract addresses and hashes require copy controls and safe truncation without losing access to full values.

### 8.10 Accessibility

- Full keyboard navigation for search, amount, route alternatives, review, and confirmation.
- Screen-reader labels for execution status and countdown changes.
- Do not use color alone to communicate pass/fail/refuse.
- Countdown/quote-expiry updates should not announce every second to assistive technology; announce threshold/state changes.
- Loading and execution steps require semantic status regions.

---

## 9. System Architecture

### 9.1 Repository shape

```text
binance-engineering/
├── apps/
│   └── web/                       # Next.js product
├── packages/
│   ├── binance-web3/              # signed API client + schemas
│   ├── router-core/               # WrapRoute decision engine
│   ├── session-mark/              # market/session context
│   ├── execution/                 # SWAP and RFQ state machines
│   ├── evidence/                  # eval/DX event schemas and writers
│   └── shared/                    # shared types/utilities
├── agent/
│   ├── wallet-skill/              # optional Agentic Wallet/Skills adapter
│   └── studio/                    # optional Route Watch agent
├── eval/
├── evidence/
├── docs/
│   ├── PRD.md
│   ├── THESIS.md
│   ├── CLAIM_LEDGER.md
│   ├── JUDGE_SCORECARD.md
│   ├── EVAL_CAMPAIGN.md
│   ├── SPONSOR_FINDINGS.md
│   ├── DX_JOURNAL.md
│   ├── DEMO_SCRIPT.md
│   └── SUBMISSION.md
└── scripts/
```

The existing research/lab history should remain in the repository. Production code must not erase failed experiments or corrected claims.

### 9.2 Core services

#### BinanceAuthClient

Responsibilities:

- build exact raw URL/query;
- include `/build` in signed request path;
- generate UTC timestamp;
- create HMAC-SHA256 signature and Base64 encoding;
- add optional nonce;
- parse transport vs business errors separately;
- capture rate-limit headers and latency;
- redact secrets from logs.

#### RwaService

Responsibilities:

- search ticker/company;
- list supported issuance platforms;
- fetch token list;
- fetch batch token/reference prices;
- fetch underlying profile;
- fetch underlying market/session data;
- return normalized internal `WrapperCandidate` objects without inventing absent fields.

#### TradingService

Responsibilities:

- verify BSC aggregator support;
- request executable quotes;
- preserve every vendor route needed for evaluation;
- return approval transaction information;
- build SWAP or RFQ payloads;
- refresh expired quotes;
- submit RFQ orders;
- poll RFQ statuses;
- treat runtime `executionMode` as authoritative.

#### TransactionService

Responsibilities:

- get gas data as needed;
- simulate approval and SWAP EVM transactions;
- broadcast user-signed transactions;
- record order/tx identifiers;
- never claim final success from broadcast alone.

#### WalletService

Responsibilities:

- query USDT and target-wrapper balances;
- read transaction details by hash;
- verify actual token transfers after settlement;
- handle the "not indexed yet" empty-data condition with backoff.

#### IndependentChainVerifier

Responsibilities:

- use a separate BSC RPC/provider path to verify transaction receipt and token balance changes where feasible;
- never use the same internal success flag as the only proof;
- keep explorer links for human inspection.

#### SessionMark

Responsibilities:

- interpret underlying session state;
- preserve raw `statusInfo` and reference timestamps;
- identify pause/halt vs ordinary market closure;
- calculate reference freshness fields;
- emit context, not investment advice.

#### WrapRouteEngine

Responsibilities:

- assemble candidates;
- apply hard eligibility gates;
- normalize route outputs;
- rank valid candidates;
- produce human-readable selection/rejection reasons;
- return `ACT`, `NO_ACTION`, `REFUSE`, `UNKNOWN`, or `MANUAL_REVIEW`;
- retain enough inputs to reproduce the decision later.

#### EvidenceRecorder

Responsibilities:

- append structured route observations;
- write latency/error records;
- preserve raw API response fixtures with secrets removed;
- associate every public metric with its source records;
- generate machine-readable evaluation artifacts;
- never fabricate missing values.

---

## 10. Internal Data Contracts

### 10.1 `EquityIntent`

```ts
interface EquityIntent {
  underlyingQuery: string;
  underlyingTicker: string;
  spendToken: "USDT";
  spendTokenAddress: string;
  spendAmountBaseUnits: string;
  walletAddress: string;
  binanceChainId: "56";
  maxDeviationBps: number;
  createdAt: string;
}
```

### 10.2 `WrapperCandidate`

```ts
interface WrapperCandidate {
  platformId: string | null;
  tokenContractAddress: string;
  tokenSymbol: string;
  decimals: number;
  underlyingTicker: string;
  tokenToShareRatioRaw: string | null;
  tokenPrice: string | null;
  referencePrice: string | null;
  statusInfo: {
    openState?: boolean;
    marketStatus?: string | null;
    reasonCode?: string | null;
    reasonMsg?: string | null;
    nextOpenTime?: number | null;
    nextCloseTime?: number | null;
  } | null;
  semanticConfidence: "VERIFIED" | "PARTIAL" | "UNSUPPORTED";
  provenance: string[];
}
```

### 10.3 `ExecutableRoute`

```ts
interface ExecutableRoute {
  wrapper: WrapperCandidate;
  quoteId: string;
  vendorName: string;
  executionMode: "SWAP" | "RFQ";
  fromTokenAmount: string;
  toTokenAmount: string;
  tradeFeeUsd: string | null;
  estimatedGas: string | null;
  priceImpactPercent: string | null;
  routePath: string | null;
  quoteObservedAt: string;
  quoteExpiresAtEstimate: string;
  apiIsBest: boolean | null;
}
```

### 10.4 `RouteEvaluation`

```ts
interface RouteEvaluation {
  route: ExecutableRoute;
  comparable: boolean;
  underlyingEquivalentAmount: string | null;
  effectiveCostPerUnderlyingUnit: string | null;
  referenceDeviationBps: number | null;
  constraintChecks: ConstraintCheck[];
  simulationStatus: "NOT_APPLICABLE" | "NOT_RUN" | "PASS" | "FAIL";
  decisionReasonCodes: string[];
}
```

### 10.5 Normalization rule

Do **not** hardcode the mathematical direction/meaning of `tokenToShareRatio` until live responses and issuer semantics are validated.

Implement normalization behind an adapter:

```ts
normalizeWrapperAmountToUnderlying({
  platformId,
  tokenAmount,
  tokenToShareRatioRaw,
  issuerMetadata
})
```

Each supported issuer must have:

- documented or empirically validated ratio semantics;
- test fixtures;
- an explicit version/provenance note;
- failure behavior when semantics are missing.

If exact equivalent exposure cannot be established, that wrapper cannot compete in the same numeric ranking. It may be shown as unsupported/partial, but Taloe must not invent a conversion.

---

## 11. WrapRoute Decision Pipeline

### 11.1 Step 1 - Resolve the underlying

Input: `NVDA`, `NVIDIA`, etc.

Output:

- canonical underlying ticker;
- company name;
- candidate wrapper contracts;
- mapping provenance.

If multiple underlying companies remain ambiguous, stop and ask the user to choose.

### 11.2 Step 2 - Enrich candidate semantics

For each wrapper, gather:

- issuer/platform ID;
- token contract;
- decimals;
- underlying ticker;
- token-to-share data when available;
- token and reference price;
- underlying market state;
- status/reason fields;
- attestation/profile links if available.

Do not use company fundamentals as a routing score. They are informational only.

### 11.3 Step 3 - Apply semantic eligibility gates

Reject or isolate candidate when:

- underlying mapping is ambiguous;
- contract address is missing/invalid;
- issuer normalization semantics are unknown and comparison requires them;
- sponsor data contradicts itself materially;
- token is explicitly paused/halted for a reason that prevents execution;
- product policy marks the candidate unsupported.

Underlying market `closed` alone is not an automatic rejection.

### 11.4 Step 4 - Obtain size-specific executable quotes

For each comparable wrapper, request an actual quote using the user's spend amount and wallet address when required.

Preserve:

- vendor;
- input/output amount;
- quote ID;
- price impact;
- gas/trade fee fields;
- path;
- execution mode;
- approval target;
- quote timestamp.

A displayed token price is not an executable route.

### 11.5 Step 5 - Normalize candidate outputs

For each route whose wrapper has validated normalization semantics:

1. convert quoted wrapper output to underlying-equivalent exposure;
2. calculate effective input cost using the actual spend amount plus known execution costs where comparable;
3. calculate effective cost per underlying-equivalent unit;
4. calculate deviation from the chosen validated reference basis;
5. preserve missing cost fields rather than coercing them to zero.

The exact formula must be documented in `docs/ROUTING_MODEL.md` after issuer semantics are validated.

### 11.6 Step 6 - Hard constraint gates

A route cannot win if any mandatory gate fails.

Minimum gates:

- quote not expired / sufficient TTL remains for the next operation;
- execution mode supported by current client;
- exact wrapper mapping confidence sufficient;
- user max deviation satisfied;
- API business code is success;
- no explicit pause/halt preventing trade;
- expected output is positive;
- wallet has sufficient input balance;
- wallet has sufficient gas when required;
- price impact/slippage does not exceed configured/user policy;
- approval path is supportable;
- SWAP simulation passes before signing the swap;
- compliance/region/API permission checks do not block the operation.

### 11.7 Step 7 - Rank surviving routes

Primary objective:

**best valid underlying-equivalent execution under the user's constraints.**

Suggested ranking inputs after validation:

1. effective underlying-equivalent amount / cost;
2. known trade/network fees;
3. price impact;
4. quote freshness and completion probability;
5. execution-mode risk/friction based on measured behavior;
6. reference/session context.

Do not assign arbitrary hidden weights before the evaluation campaign. Start with lexicographic hard gates + effective-exposure ranking, then add secondary tie-breakers only when measurements justify them.

### 11.8 Step 8 - Generate reasons

Every recommendation and rejection must be explainable from recorded inputs.

Examples:

- `BETTER_EFFECTIVE_EXPOSURE`
- `LOWER_PRICE_IMPACT`
- `WITHIN_USER_DEVIATION`
- `EXCEEDS_USER_DEVIATION`
- `QUOTE_EXPIRED`
- `SIMULATION_FAILED`
- `ISSUER_MAPPING_UNSUPPORTED`
- `PAUSED_OR_HALTED`
- `INSUFFICIENT_LIQUIDITY`
- `INSUFFICIENT_BALANCE`
- `RFQ_FAILED`
- `UNKNOWN_EXECUTION_MODE`

No LLM may invent these reasons from free-form narrative. The UI text is generated from structured reason codes.

---

## 12. Execution State Machines

### 12.1 SWAP mode

```text
ROUTE_SELECTED
  -> ALLOWANCE_CHECK
  -> [APPROVAL_REQUIRED]
  -> APPROVAL_SIGN
  -> APPROVAL_BROADCAST
  -> APPROVAL_CONFIRMED
  -> REQUOTE_AND_REVALIDATE
  -> BUILD_SWAP
  -> SIMULATE_SWAP
  -> [SIMULATION_PASS]
  -> USER_SIGN_SWAP
  -> BROADCAST_SWAP
  -> CHAIN_PENDING
  -> INDEXING_PENDING
  -> VERIFIED_SUCCESS | VERIFIED_FAILURE
```

Rules:

- approval must be confirmed before relying on an execution quote that may expire while approval is pending;
- always re-quote/revalidate if the prior quote is stale;
- use Transaction API simulation on the built EVM SWAP transaction before asking for final signature;
- a simulation failure produces `REFUSE` until a newly built route passes;
- broadcast response produces `PENDING`, not success;
- Wallet API token-transfer details plus independent RPC receipt form the completion proof where feasible.

### 12.2 RFQ mode

```text
RFQ_ROUTE_SELECTED
  -> VENDOR_IDENTIFIED
  -> VENDOR_ALLOWANCE_CHECK
  -> [APPROVAL_REQUIRED]
  -> APPROVAL_SIGN
  -> APPROVAL_BROADCAST
  -> APPROVAL_CONFIRMED
  -> REQUOTE_IF_NEEDED
  -> BUILD_RFQ_PAYLOAD
  -> VALIDATE_TYPED_DATA_AND_CONSTRAINTS
  -> USER_SIGN_EIP712
  -> SUBMIT_RFQ_ORDER
  -> PENDING_VENDOR
  -> PENDING_ONCHAIN (if applicable)
  -> FILLED | FAILED | EXPIRED | CANCELLED
  -> VERIFY_TX_HASH_WHEN_AVAILABLE
```

Rules:

- use the wallet address from the quote consistently through signing;
- vendor-specific approval uses `vendorName` from the quote when required;
- EIP-712 signature is not a plain-text signature;
- use a UUID v4 `requestId` per distinct order and reuse it only for retries of the same order attempt;
- never retry an expired quote ID as if it were fresh;
- RFQ order status is the primary settlement source before a tx hash exists;
- when `FILLED` returns a tx hash, verify it through Wallet API and an independent BSC path where practical.

---

## 13. Quote Freshness and Revalidation

Quotes are short-lived. The current documentation says approximately 30 seconds.

Implement a configurable internal safety margin:

`QUOTE_MIN_REMAINING_MS`

Initial value should be chosen during live testing and stored in configuration, not buried in business logic.

A route must be refreshed when:

- its age exceeds the configured safe window;
- `QUOTE_EXPIRED` is returned;
- an approval transaction consumed most of the quote lifetime;
- the user waited too long on Review;
- a route-bound parameter changed;
- the selected wrapper or amount changed.

On refresh, re-run the route decision. If the winner changes or economics move beyond the user's confirmed range, require a fresh confirmation.

---

## 14. Error and Recovery Contract

### 14.1 Authentication

- `40101` invalid/missing API key -> server configuration error, never ask user for sponsor credentials.
- `40102` signature error -> log exact endpoint/path construction; validate `/build` prefix and raw query encoding.
- `40103` timestamp/replay -> sync server clock, use nonce correctly, never blindly replay signed API requests.
- `40104` permission denied -> surface platform configuration issue and log to DX if unexpected.

### 14.2 Rate limits

On `42900` / HTTP 429:

- honor `Retry-After`;
- use bounded retries with jitter;
- never spin at quote frequency faster than needed;
- log rate-limit headers for DX evidence;
- if retry makes a quote stale, obtain a new quote rather than continuing old execution state.

### 14.3 Trading

- `QUOTE_EXPIRED` -> re-quote.
- `SWAP_QUOTE_MISMATCH` -> rebuild using exactly quote-bound parameters.
- unsupported vendor/mode -> mark candidate unsupported and continue with other candidates if possible.
- empty route list -> candidate unavailable at requested size; do not fabricate liquidity.
- high-risk/compliance rejection -> do not bypass or route around platform restrictions.

### 14.4 Simulation

If simulation `status=FAILED`:

- show plain-language failure when a reliable reason exists;
- preserve `failReason` in the technical record;
- do not ask the user to sign the failed transaction;
- rebuild/re-quote only if the underlying cause may have changed.

### 14.5 Wallet verification

If transaction detail returns empty immediately after broadcast:

- show `Indexing transaction` rather than failure;
- poll with backoff;
- stop after a bounded window and provide the tx hash/explorer link if external verification is available;
- allow later receipt recovery by tx hash.

### 14.6 Compliance/region

Binance Web3 API enforces service-region restrictions at the platform level. Taloe must:

- respect and surface sponsor/API compliance errors;
- never recommend VPN/proxy bypasses;
- never cache a successful path and use it to bypass a later platform refusal;
- include a tokenized-securities availability disclaimer before execution.

---

## 15. Security Requirements

1. Binance Web3 API secret lives server-side only.
2. User wallet private keys/seed phrases never enter Taloe servers.
3. Web app signs normal EVM transactions through the connected user wallet.
4. RFQ uses EIP-712 typed-data signing through the same user wallet used during quote generation.
5. Validate chain ID `56` before any signing request.
6. Validate `from` address returned by the API against the connected wallet before signing.
7. Validate token contract addresses against discovered/provenanced wrapper records.
8. Never auto-approve unlimited token amounts in v1. Default to amount-scoped approval unless a user explicitly chooses otherwise later.
9. Redact API keys, secret keys, signatures, raw authorization headers, and sensitive wallet-provider session data from logs.
10. Record tx hashes, quote IDs, order IDs, route IDs, and sanitized response payloads needed for reproducibility.
11. Use idempotency keys for RFQ submissions exactly as documented.
12. Do not interpret an LLM statement as transaction success.
13. Do not treat HTTP 200 as business success.
14. Do not treat broadcast as final success.
15. Do not use the Agent Studio managed testnet wallet as the Taloe mainnet execution wallet.
16. Compliance/API blocks are terminal for that attempted path.

---

## 16. Agentic Wallet / Wallet Skills Extension

### 16.1 Purpose

Compete credibly for the Agentic Wallet / Wallet Skills special without changing the primary product object.

### 16.2 Proposed interaction

User says through an agent surface:

> Buy 100 USDT of NVDA using Taloe, max deviation 75 bps.

Flow:

1. custom Taloe skill creates the equity intent;
2. Taloe backend runs WrapRoute;
3. skill returns the selected wrapper and structured explanation;
4. user confirms;
5. Agentic Wallet executes the selected token trade within its user-configured wallet limits where supported;
6. result is sent back to Taloe for verification and receipt generation.

### 16.3 Hard requirements

- Agentic Wallet execution must not bypass Taloe route constraints.
- The agent must not decide the wrapper by free-form reasoning after WrapRoute has returned a route.
- If the selected token/route cannot be executed by Agentic Wallet, fall back to the normal web execution path and log the capability gap.
- The main product remains complete even if this integration is unavailable.

### 16.4 Evidence for special prize

- one real or documented-safe small BSC execution through the Agentic Wallet path;
- user-defined wallet limits visible in the flow;
- route decision from Taloe followed by execution, not merely a balance query;
- exact DX notes on setup, unsupported cases, and missing capabilities.

---

## 17. BNB Agent Studio Extension - Route Watch

### 17.1 Gate

Do not build Route Watch until:

- core web routing works;
- at least one mainnet execution is verified;
- evaluation campaign has produced real `ACT`, `NO_ACTION`, and `REFUSE` cases or equivalent route changes;
- adding Studio does not threaten Valid Submission V0.

### 17.2 Product job

A user may define a persistent mandate such as:

> Maintain about $1,000 of NVDA tokenized exposure. Re-evaluate periodically. Only propose or execute a wrapper change when the measured improvement exceeds my threshold and all Taloe gates pass.

### 17.3 Studio role

- persistent runtime;
- on-chain ERC-8004 identity;
- ERC-8183 task interface if exposed to other agents;
- wallet/provider appropriate to the Studio deployment;
- x402/B402 self-funding for its own model/service costs where useful;
- audit/logging for every route evaluation.

### 17.4 Safety boundary

For the hackathon, prefer Route Watch as a persistent **evaluation/proposal operator** unless a safe user-asset execution bridge is proven. Do not move user funds from a Studio-managed wallet just to claim autonomy.

The managed BNB testnet trial uses a throwaway wallet only. Mainnet user execution remains on the user's approved wallet path.

---

## 18. Evaluation Campaign

### 18.1 Purpose

Prove mechanism truth, workflow value, sponsor dependence, and correct inaction.

### 18.2 Initial asset set

At least:

- NVDA
- TSLA
- AAPL
- QQQ
- one thinner supported name with more challenging liquidity

The final set is determined by actual wrapper overlap on BSC.

### 18.3 Order sizes

Initial test sizes:

- $5
- $25
- $100

Add larger dry-run sizes when useful to reveal price impact without unnecessarily spending real funds.

### 18.4 Baselines

**FIRST_RESULT**  
Use the first safely returned wrapper and its best available route without cross-wrapper comparison.

**FIXED_ISSUER**  
Always prefer one chosen issuer/wrapper when available.

**PRICE_ONLY / BLIND**  
Choose using token/executable price without SessionMark/reference/semantic normalization where feasible.

**FULL**  
Taloe with wrapper semantics, session/reference context, size-specific executable quotes, execution-mode handling, constraints, and simulation/settlement checks.

### 18.5 Primary outcome

Do not optimize the evaluation around PnL.

Primary metric:

**Valid Decision Rate** - percentage of route intents for which the system selects and, when executed, completes a route within the user's declared constraints, or correctly refuses when no route qualifies.

Supporting metrics:

- effective underlying-equivalent execution difference vs baselines;
- route completion/failure rate;
- number of invalid or stale routes rejected before signing;
- quote-expiry recovery rate;
- simulation failures caught pre-sign;
- wrapper choice divergence across methods;
- time from intent to executable review;
- API latency distribution by endpoint;
- RFQ terminal-state distribution;
- cases where session/reference context changes the decision;
- cases where an unsupported semantic mapping correctly produces `UNKNOWN`/`MANUAL_REVIEW`.

### 18.6 Required evidence classes

**Positive:** a route qualifies and completes.

**Control:** a normal case where the obvious/fixed route is already valid and Taloe does not manufacture a difference.

**Refusal:** all routes violate a hard constraint or simulation fails.

**Sparse/unsupported:** only one usable wrapper or incomplete issuer data exists; product must not pretend a multi-wrapper advantage.

**Ablation:** remove one supposed load-bearing mechanism and re-run identical intents.

### 18.7 Sponsor ablations

At minimum:

1. remove dual token/reference context;
2. remove market/session context;
3. ignore wrapper normalization semantics;
4. ignore `executionMode` and try one generic execution flow;
5. collapse to one issuer;
6. remove Transaction API simulation from SWAP decision-making.

If an ablation does not change any outcome across the campaign, downgrade that component from "load-bearing" in all public claims.

### 18.8 Headline proof template

Do not publish a number until measured.

Preferred final structure:

> Across **N** live BSC route evaluations covering **M** underlying names and multiple order sizes/session states, Taloe produced a valid in-constraint decision in **X** cases versus **Y** for the fixed/first-result baseline, while refusing **Z** stale, unsupported, or unexecutable paths before the user signed.

If the data does not support a dramatic numeric headline, use the strongest honest mechanism proof instead.

---

## 19. Developer Experience Program

The DX Report is 25% of the official score and must be treated as a product deliverable.

### 19.1 Start conditions

Start the onboarding clock before the first authenticated Web3 API attempt.

Record:

- time hack docs first opened;
- registration time;
- API-key request time;
- credentials received;
- first signed request attempt;
- first successful signed request;
- first RWA search;
- first quote;
- first simulation;
- first mainnet settlement.

Do not reconstruct these later from memory.

### 19.2 `DX_JOURNAL.md` entry schema

```text
ID:
Timestamp UTC:
Component:
Docs URL / section:
Goal:
Exact request / operation:
Expected:
Observed:
Business code / HTTP status:
Latency:
Raw error or response evidence path:
Time lost:
Workaround:
Still reproducible:
Impact on product:
Suggested platform change:
Status:
```

### 19.3 `SPONSOR_FINDINGS.md` seed investigations

These are questions, not pre-declared bugs:

1. RWA `platformId` docs enumerate `ondo` and `bstock` while the hackathon treats xStocks as first-class. Determine the intended xStocks discovery and semantic-normalization path.
2. Trading docs use different wording around whether equity/RWA routes always use RFQ or can use RFQ. Record actual `executionMode` by issuer/pair and compare against docs.
3. Agentic Wallet tokenized-securities use case says bStock + Ondo, while Wallet Skills overview describes the tokenized-securities info skill more narrowly. Test actual skill coverage.
4. Measure whether vendor-specific approvals plus ~30-second quote lifetimes create practical RFQ expiry pressure.
5. Determine whether Transaction API can provide any useful pre-settlement simulation for RFQ flows. If not, propose an RFQ simulation/preflight endpoint.
6. Measure Wallet API indexing delay after mainnet broadcast.
7. Record business-error behavior that arrives with HTTP 200.
8. Measure endpoint latency and rate-limit behavior from the real development environment.

### 19.4 DX evidence rules

- Never call a documentation inconsistency a bug until reproduced or confirmed.
- Preserve the exact docs revision/date when possible.
- Keep raw response samples with secrets removed.
- The final DX Report must be personally reviewed and written from the journal; do not submit generic AI-generated prose.
- Every redesign request should explain the developer time or product risk it would remove.

---

## 20. Observability and Evidence Logging

### 20.1 API request record

For each sponsor call, record at minimum:

```text
timestamp
request_id / local correlation_id
api_module
endpoint
method
chain_id
underlying_ticker (if applicable)
wrapper_contract (if applicable)
platform_id (if known)
http_status
business_code
latency_ms
retry_count
rate_limit_headers (sanitized)
outcome
```

### 20.2 Route observation record

```text
route_session_id
observed_at
underlying_ticker
input_amount
wallet_address_hash_or_redacted_identifier
candidate_wrappers
session_state
reference_freshness
quotes
execution_modes
constraint_results
selected_route
rejected_routes + reasons
decision
baseline_decisions
ablation_variant
```

### 20.3 Execution record

```text
execution_id
route_session_id
mode
approval_tx_hash
quote_id
vendor
rfq_order_id
swap_tx_hash
simulation_result
terminal_status
verified_token_transfers
independent_receipt_status
```

Never log a private key, seed phrase, API secret, full authorization header, or reusable wallet credential.

---

## 21. Backend Persistence

Core routing should remain usable even if analytics persistence is degraded.

Recommended production storage:

- PostgreSQL for route sessions, execution state, sanitized observations, and activity.
- Raw sanitized sponsor responses stored as JSON artifacts or object storage if needed for evaluation.
- Local file/SQLite-compatible development path for offline tests.

Do not make the user's ability to obtain a quote depend on a nonessential analytics write. If evidence persistence fails, surface/log the observability failure internally while preserving the core request when safe.

---

## 22. API Surface of Taloe

Suggested internal/public application endpoints:

### `POST /api/intents`
Create equity intent.

### `GET /api/equities/search?q=`
Resolve supported underlying names/tickers.

### `POST /api/routes/evaluate`
Run candidate discovery + executable route evaluation.

### `GET /api/routes/:id`
Return current route session and freshness.

### `POST /api/routes/:id/refresh`
Re-quote and re-run decision.

### `POST /api/executions`
Create execution from a currently valid route decision.

### `POST /api/executions/:id/prepare`
Prepare approval/SWAP or RFQ signing payload depending on runtime mode.

### `POST /api/executions/:id/simulation`
Run SWAP/approval simulation where applicable.

### `POST /api/executions/:id/submitted`
Register signed/broadcast identifiers without receiving a private key.

### `GET /api/executions/:id`
Poll execution state.

### `GET /api/receipts/:id`
Return verified final receipt.

### `POST /api/evidence/observation`
Internal-only/signed route observation logging if needed.

Do not expose Binance API secrets through any browser-callable response.

---

## 23. Testing Strategy

### 23.1 Unit tests

Required coverage:

- API signing path includes `/build`;
- raw query ordering/encoding preserved;
- HTTP 200 + non-zero body code is failure;
- token amount/base-unit conversion;
- issuer normalization adapters;
- route hard-gate behavior;
- quote freshness calculation;
- ranking/tie behavior;
- reason-code generation;
- state-machine transitions;
- idempotency handling.

### 23.2 Contract/API fixture tests

Maintain sanitized real response fixtures for:

- RWA search;
- token list;
- token/reference price;
- underlying market data;
- SWAP quote;
- RFQ quote;
- swap payload;
- simulation success;
- simulation failure;
- RFQ submitted/pending/filled/failed/expired where observed;
- Wallet tx indexing delay;
- final transaction detail.

Fixtures must be labeled by observed date and never presented as live data.

### 23.3 Integration tests

- signed authenticated call to each load-bearing Binance module;
- route evaluation for at least one multi-wrapper underlying;
- approval build + simulation;
- SWAP build + simulation;
- RFQ path if returned by live API;
- Wallet final-state polling.

### 23.4 Browser E2E

Playwright or equivalent:

1. search supported ticker;
2. amount entry;
3. wallet state handling;
4. route result;
5. quote expiry and refresh;
6. refused route;
7. simulation fail state;
8. execution progress recovery after refresh;
9. final receipt.

Use mocked wallets for automated CI and at least one real human-wallet mainnet walkthrough for proof.

### 23.5 Mainnet acceptance

Before submission:

- at least one small live BSC purchase/fill;
- final token receipt verified;
- tx/order IDs preserved;
- no private credentials in repo/evidence;
- captured replay available as fallback.

---

## 24. Product Acceptance Criteria

Core V1 is complete only when all are true:

1. User can search and select a supported underlying.
2. User can request a USDT-sized route on BSC.
3. At least two wrappers for one underlying are compared when live data allows.
4. Product can honestly handle one-wrapper cases without pretending multi-wrapper competition.
5. Runtime execution mode is handled correctly.
6. User sees exact wrapper before signing.
7. SWAP transaction is simulated before signature.
8. RFQ order path is implemented if live API returns RFQ for the chosen demo asset.
9. Quote expiry is recoverable.
10. At least one real `REFUSE` or `UNKNOWN` path is demonstrated.
11. At least one small mainnet execution reaches verified final state.
12. Post-execution state is independently checked where feasible.
13. DX journal exists with dated findings from actual use.
14. Evaluation campaign includes FULL + baselines + at least one ablation.
15. Public claims match evidence exactly.
16. Product works on mobile and desktop.
17. Core user journey does not require reading architecture or hackathon documentation.

---

## 25. Kill / Revise Gates

### 25.1 Revise the mechanism if

- token-to-share normalization almost never affects routing and execution/session state explains nearly all meaningful decisions; in that case promote execution/session quality to the headline mechanism and keep ratio semantics as a correction input;
- user value reduces to "same swap plus an explanation";
- wrapper comparison cannot be reproduced across multiple names/sizes;
- one issuer path dominates every test and cross-wrapper routing rarely matters;
- sponsor ablation leaves decisions unchanged;
- Taloe depends on a market dislocation appearing during the live demo;
- the main UI starts looking like a technical comparison dashboard rather than an execution product.

### 25.2 Kill or radically narrow if

- there is no supported underlying where two safely comparable/executable wrappers can be tested;
- the full router produces no material workflow advantage over first-result/fixed-issuer routing across the evidence campaign;
- the product cannot complete a single small mainnet execution honestly;
- every meaningful route requires an uncontrolled external capability unavailable during judging;
- safe normalization requires issuer information the sponsor stack does not provide and no honest narrower claim remains.

xStocks absence alone is **not** a kill criterion. The product may ship with clearly scoped bStock/Ondo support if those paths are real and xStocks is documented as unsupported/partial rather than falsely normalized.

---

## 26. Submission and Claim-Parity Requirements

The following must remain synchronized:

- README;
- deployed UI;
- demo narration;
- submission form;
- Developer Experience Report;
- `CLAIM_LEDGER.md`;
- `/evidence` page;
- screenshots;
- architecture docs.

If a live test disproves a claim, update every affected surface in the same work cycle.

### 26.1 Submission form fields to maintain during development

`docs/SUBMISSION.md` should always contain current status for:

- project name;
- contact details stored privately where appropriate;
- prize wallet/UID stored outside public repo until submission;
- short "what did you build" answer;
- tracks selected;
- public repository URL;
- demo video URL;
- deployed/judge link;
- Developer Experience Report status;
- limitations;
- final claim list.

### 26.2 Valid Submission V0 deadline

By **10 October 2026, 12:00 UTC**:

- public repo available;
- deployed path or reproducible judge instructions work;
- demo video uploaded and sharing verified;
- Developer Experience Report submitted;
- form answers complete;
- required track selected;
- all links tested from a logged-out/incognito environment;
- main claims already evidence-safe.

Everything after that deadline is optional polish.

---

## 27. Demo Story

### First 10 seconds

> "NVIDIA can exist as multiple tokenized wrappers on BSC. A buyer shouldn't have to know which token or execution path is actually best."

### By 20 seconds

> "Taloe takes the company, amount, and your execution constraint, compares the available wrappers using live Binance RWA and executable trading data, and either routes the best valid exposure or refuses the trade."

### Demo sequence

1. Enter `NVDA` and a small USDT amount.
2. Show candidate wrappers being evaluated without opening an architecture page.
3. Show one recommended route and why.
4. Expand alternatives and show at least one materially different rejection/ranking reason.
5. Open Review and show exact wrapper + execution mode.
6. Show simulation for SWAP or the RFQ-specific signing/order path.
7. Execute a captured or live small BSC fill depending demo safety/availability.
8. End on verified receipt plus BSC transaction/order proof.
9. Spend a short final segment on the DX finding that most directly improved Binance's developer platform.

Do not spend demo time showing test counts, package counts, agent identity registration, or architecture unless they explain a scoring criterion.

---

## 28. Demo Fallback

Judges must understand the product if Binance API, an RFQ vendor, wallet connection, cloud hosting, or RPC is temporarily unavailable.

Commit or host:

- captured route evaluation with timestamp;
- sanitized raw API fixtures;
- recorded execution trace;
- verified mainnet tx/order IDs;
- static receipt replay;
- evaluation results;
- clearly labeled captured demo video.

Never label captured evidence as live.

---

## 29. Build Plan

### Gate 0 - Registration and credentials

- register for the hackathon;
- apply for Web3 API credentials;
- start onboarding timer;
- create `.env.example` without secrets;
- initialize DX journal.

### Gate 1 - API seam validation

- authenticated request signing works;
- RWA search/list works on BSC;
- NVDA/TSLA/AAPL/QQQ wrapper overlap mapped;
- xStocks discovery path investigated;
- quotes at $5/$25/$100 captured;
- actual execution modes recorded;
- simulation tested;
- Wallet API final-state path tested.

Output: `VALIDATION_REPORT.md` with `APPROVE`, `REVISE`, or `REJECT` against the PRD's core assumptions.

### Gate 2 - Router core

- internal data models;
- semantic adapters;
- SessionMark;
- quote normalization;
- hard gates;
- route ranking;
- reason codes;
- baseline implementations.

### Gate 3 - Web product

- home/intent;
- route result;
- review;
- execution state machine UI;
- receipt;
- activity;
- mobile behavior;
- error/recovery states.

Visual styling remains flexible until inspiration images are supplied.

### Gate 4 - Live execution and evidence

- small mainnet execution;
- verified receipt;
- genuine refusal;
- multi-name evaluation campaign;
- sponsor ablations;
- independent verification;
- public evidence artifacts.

### Gate 5 - Agentic Wallet / Wallet Skill

Only after Gate 4 is stable.

- route intent exposed to skill;
- selected wrapper passed to execution surface;
- user limits observed;
- result verified in Taloe;
- DX feedback captured.

### Gate 6 - Agent Studio Route Watch

Stretch gate only.

- persistent evaluation mandate;
- ERC-8004 identity;
- deployed runtime;
- x402/B402 self-funding evidence if genuinely used;
- `ACT` / `NO_ACTION` / `REFUSE` history;
- no dependency on a testnet wallet for mainnet user funds.

### Gate 7 - Submission

- README judge path;
- final DX Report;
- demo under four minutes;
- deployed URL;
- public repo;
- claim parity audit;
- valid submission V0 by T-24h.

---

## 30. Suggested Delivery Timeline

Starting 21 September 2026:

| Window | Target |
|---|---|
| Sep 21-23 | Registration, API key, docs/onboarding journal, live seam validation, wrapper map, quote/RFQ/SWAP experiments. |
| Sep 24 | Mechanism validation decision and PRD delta if required. |
| Sep 24-28 | Router core + server-side Binance clients + evidence recorder. |
| Sep 27-30 | Primary frontend journeys and execution state machines. |
| Sep 30-Oct 3 | Mainnet execution, refusal cases, campaign observations, baseline/ablation runs. |
| Oct 3-5 | Agentic Wallet / Wallet Skill integration if core evidence is stable. |
| Oct 5-7 | Agent Studio Route Watch only if it does not threaten main-track quality. |
| Oct 7-9 | UX polish using supplied visual inspiration, accessibility, recovery states, demo recording, DX report authoring. |
| Oct 10 12:00 UTC | Valid Submission V0 complete and submitted where possible. |
| Oct 10-11 | Optional final polish, link verification, claim-parity audit. |
| Oct 11 12:00 UTC | Official submission lock. |

---

## 31. Final Product Scope in One View

### Must ship

- consumer web app;
- BSC/USDT equity intent flow;
- RWA discovery/context;
- multi-wrapper comparison when safely supported;
- runtime SWAP/RFQ handling;
- route constraints;
- SWAP simulation;
- real small mainnet execution;
- verified receipt;
- honest refusal/unknown behavior;
- evaluation campaign;
- DX journal/report;
- deployed judge path;
- public repo;
- demo.

### Should ship

- Agentic Wallet / Wallet Skill execution adapter;
- activity page;
- public evidence page;
- multiple mainnet proof transactions across different route modes if affordable.

### Ship only if evidence and time support it

- Agent Studio Route Watch;
- persistent mandate automation;
- ERC-8004 / ERC-8183 public agent interface;
- x402/B402 self-funding demonstration.

### Explicitly defer

- baskets;
- full portfolio optimizer;
- fiat onboarding;
- DeFi yield;
- news/earnings strategies;
- PnL optimization;
- broad cross-chain routing;
- institutional mint/redeem;
- unsupported issuer normalization.

---

## 32. Current Open Questions to Resolve Before Coding Around Them

1. What exact wrappers for NVDA, TSLA, AAPL, QQQ are returned on BSC today?
2. What are the live semantics and observed values of `tokenToShareRatio` for each supported platform?
3. What is the documented and actual xStocks discovery path through the Binance stack?
4. What `executionMode` is returned for each issuer/pair in live Trading API responses?
5. Do BStock/Ondo routes require vendor-specific approval in the observed purchase flow?
6. How often do approval transactions cause the original quote to become stale?
7. Can RFQ routes expose a pre-settlement simulation capability not obvious in the current docs?
8. What are observed p50/p95 latencies for RWA search, quote, swap build, simulation, RFQ submit/status, and Wallet indexing?
9. How often does FULL select a different route than FIRST_RESULT or FIXED_ISSUER?
10. When FULL differs, is the difference economically/workflow meaningful rather than quote noise?
11. What genuine refusal case occurs naturally during the build window?
12. Can Agentic Wallet execute the exact wrapper selected by Taloe rather than resolving the ticker independently to a different representation?
13. Does a Taloe Wallet Skill add a useful distribution surface or just another demo surface?
14. Is Route Watch useful enough to justify the Agent Studio integration after the core app is already complete?

These are empirical questions. Do not resolve them with assumptions in code or copy.

---

## 33. Sources Verified for This PRD

All external technical claims above should be rechecked if the sponsor updates its docs during the build.

1. [BNB Hack: Tokenized Stocks Edition - official event page](https://www.bnbchain.org/en/hackathons/tokenized-stocks)
2. [BNB Hack: Tokenized Stocks Edition - organizer blog, 16 Sep 2026](https://www.bnbchain.org/en/blog/bnb-hack-tokenized-stocks-edition-with-binance-web3-wallet)
3. [Binance Web3 API documentation index / llms.txt](https://web3.binance.com/en/dev-docs/llms.txt)
4. [Binance Web3 API Authentication](https://web3.binance.com/en/dev-docs/authentication)
5. [Binance Web3 API RWA Data](https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/rwa-data)
6. [Binance Web3 API Trading API](https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/trading-api)
7. [Trading API Integration Flow](https://web3.binance.com/en/dev-docs/products/trading-api/integration-flow)
8. [Trading API Error Codes](https://web3.binance.com/en/dev-docs/products/trading-api/error-codes)
9. [Binance Web3 API Transaction API](https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/transaction-api)
10. [Transaction API Error Codes](https://web3.binance.com/en/dev-docs/products/transaction-api/error-codes)
11. [Binance Web3 API Wallet API](https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/wallet-api)
12. [Wallet API Error Codes](https://web3.binance.com/en/dev-docs/products/wallet-api/error-codes)
13. [Binance Web3 API Service-Restricted Countries & Regions](https://web3.binance.com/en/dev-docs/web3-api-prohibited-regions)
14. [Binance Agentic Wallet](https://developers.binance.com/en/docs/products/agentic-wallet/welcome)
15. [Agentic Wallet - Stock Trading (Tokenized Securities)](https://developers.binance.com/en/docs/products/agentic-wallet/use-cases/trading/stock-trading)
16. [Binance Wallet Skills](https://developers.binance.com/en/docs/products/wallet-skills/overview)
17. [Agentic Wallet Skills Reference](https://developers.binance.com/en/docs/products/agentic-wallet/reference/skills)
18. [BNB Agent Studio](https://www.bnbchain.org/en/bnb-agent-studio)
19. [BNB Agent Studio Quickstart](https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/)
20. [BNB Agent Studio CLI Reference](https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/)

---

## 34. Implementation Commandment

Before changing the architecture to "make the demo work," record the observed failure first.

Taloe is allowed to narrow a claim, exclude an issuer, refuse a route, or remove a feature. It is not allowed to turn an unsupported assumption into a hidden fallback and keep the original claim.

The final product should remain understandable in one sentence:

> **Choose the company and amount. Taloe finds the best valid tokenized-equity execution on BSC, or tells you not to trade.**
