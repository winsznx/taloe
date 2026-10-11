# Live Mainnet Trade (PRD goal #10)

**Status: ACHIEVED.** One small, real, independently-verified tokenized-equity purchase executed on BSC mainnet through Taloe's own decision and execution pipeline — no shortcuts, no simulation substituted for reality.

**Executed:** 2026-10-11 02:05:33–02:05:59 UTC.
**Wallet:** `0x6ce9092Aaa671D146e05fD76AB632B47a3e86F08` (freshly generated for this purpose; private key held only in a local, gitignored, `chmod 600` file; never logged, printed, or committed anywhere).
**Script:** `scripts/live/execute-mainnet-trade.ts` + `scripts/live/sign_tx.py` (signing isolated to the smallest possible surface — see the scripts' own headers).
**Raw artifact (gitignored, credential-free):** `internal/evidence/runtime/live-mainnet-trade-1791684359496.json`.

## What happened, step by step

1. **Market decision** (`runRouteDiscovery`, unmodified product code): $10 USDT into NVDA resolved to `ACT`, wrapper `NVDAon` (Ondo), vendor LiquidMesh, deviation **-10 bps** from reference — comfortably inside the 150 bps limit.
2. **Execution readiness** (`prepareExecution`, unmodified product code): `APPROVAL_REQUIRED` — the fresh wallet had never approved the router. Spender: `0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5`, exact amount `10000000000000000000` (10 USDT, never unlimited).
3. **Approval signed and broadcast.** Tx [`0xb1ef6221a4cccaab0028106b979677368aae3eaa30d3a0502fe4e7e9184a77af`](https://bscscan.com/tx/0xb1ef6221a4cccaab0028106b979677368aae3eaa30d3a0502fe4e7e9184a77af) — mined, status success, gas used `0xb472` (46,194 units).
4. **Mandatory re-quote enforced** (`resumeAfterApproval`, unmodified product code): allowance re-verified on-chain independently of the broadcast acknowledgement, the pre-approval quote discarded, a fresh quote obtained, the deviation gate re-run, and a fresh swap simulated. Result: `READY_TO_SIGN`. This is the exact invariant `readiness.test.ts` proves in unit tests — here it ran for real.
5. **Swap signed and broadcast.** Tx [`0xd73092697cdc32778e5fda0ae1cf480f7f78e0253382f1e1a93c95881c3b6a92`](https://bscscan.com/tx/0xd73092697cdc32778e5fda0ae1cf480f7f78e0253382f1e1a93c95881c3b6a92) — mined, status success, gas used `0x10fc49` (1,109,577 units).
6. **Independent verification** — not "the transaction said success," but a direct before/after balance read on-chain:
   - USDT spent: exactly `10000000000000000000` (10.0 USDT).
   - NVDAon received: `43353655194818823` (≈0.0434 NVDAon).
   - Both deltas strictly positive and matching the expected direction → `VERIFIED_SUCCESS`.

## Total real cost

Gas: (46,194 + 1,109,577) × 0.05 gwei ≈ 0.0000578 BNB (at the gas price observed at execution time). USDT: 10.0 exactly, no more.

## What this proves, and what it doesn't

**Proves:** the full pipeline — market decision, allowance-aware readiness, approval, independent on-chain re-verification, mandatory re-quote, fresh simulation, signing, broadcast, and independent balance-based verification — works end to end against real BSC mainnet, real Binance Web3 API responses, and a real wrapper contract. This was not a dry run or a mocked signer; both transaction hashes are on-chain and checkable by anyone on BscScan.

**Does not prove:** that this is production-ready for arbitrary users. The signing step here used a raw private key held in a local file by the operator — this is correct for proving the pipeline once, but is explicitly not how the shipped product works. The product's own execution path (`WalletExecutionPanel`, `/review`) signs through the user's own browser wallet (EIP-1193 `eth_sendTransaction`), never a server-held key. No live swap broadcast is wired into that browser-facing path yet — closing that gap (wiring the already-working readiness/approval UI through to an actual browser-signed swap broadcast) is the next step if the product moves toward real user-facing execution, not just this one proof-of-capability run.

## Reproducing this

```
pnpm tsx scripts/live/execute-mainnet-trade.ts --ticker <TICKER> --amount <USDT_AMOUNT>
```

Requires `BINANCE_WEB3_API_KEY`/`BINANCE_WEB3_API_SECRET` and `TALOE_TEST_WALLET_ADDRESS`/`TALOE_TEST_WALLET_PRIVATE_KEY` in the environment (never committed — see `.gitignore`). The wallet needs enough of the spend token to clear the issuer's minimum (Ondo: $5) plus a small amount of native BNB for gas (observed: under $0.01 at a 0.05 gwei gas price; use your own judgment against current gas prices).
