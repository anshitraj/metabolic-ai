# 08 — Runbook: deploy, operate, demo

## 1. Local (zero setup)

```bash
cd frontend && cp .env.example .env.local   # add GEMINI_API_KEY and/or ANTHROPIC_API_KEY
pnpm install && pnpm dev
```

Embedded PGlite in `frontend/.data/pglite`. Delete that folder to start a fresh business.

## 2. Fastest path: set up in the app (no config files)

1. Open `/login`, connect a NEAR **testnet** wallet (MyNearWallet or Meteor) and sign the message.
2. On the Overview, the guide shows **Become the operator**. Choose the NEAR account that will hold the business's money (your own account is fine for a demo) and press *Make me the operator*. Only the first signed-in user can do this.
3. Press **Fund the business** and deposit about 1 NEAR. Operator deposits are the business's own capital. The default safety reserve is $1.00, so ~1 NEAR is enough to leave Survival (it passes through Recovery first; allow a few minutes).
4. Sign in with a different wallet to act as a customer: **Add credit**, then ask a question in the AI Workspace.

On-chain receipts still need the contract (section 3). Environment variables, when set, override the in-app choices.

## 3. Testnet setup with the contract (actual transactions, testnet tokens)

1. **Wallets.** Two testnet accounts: `you.testnet` (operator) and `customer.testnet` (customer). MyNearWallet or Meteor.
2. **Contract** (needed for on-chain receipts). Follow `contracts/metabolic/README.md`; you end with `NEAR_CONTRACT_ID`, `NEAR_RECEIPT_SIGNER_ID`, `NEAR_RECEIPT_SIGNER_KEY`.
   - Without the contract, set only `NEAR_TREASURY_ACCOUNT_ID` — deposits become plain transfers and are still verified on chain, but receipts are disabled (the UI says so).
3. **Env** in `frontend/.env.local`:
   ```
   OPERATOR_ACCOUNT_IDS=you.testnet
   NEAR_CONTRACT_ID=metabolic.you.testnet
   NEAR_RECEIPT_SIGNER_ID=metabolic.you.testnet
   NEAR_RECEIPT_SIGNER_KEY=ed25519:…
   ```
4. **Fund the business.** `/login` as `you.testnet` → Treasury → *Fund the business* (e.g. 5 NEAR). Operator deposits are recorded as operating capital, so liquidity rises above the default $1 hard reserve and the organism leaves Survival through Recovery. Dwell times are controlled by the active policy.
5. **Be a customer.** Sign in as `customer.testnet` → *Deposit NEAR* (e.g. 1 NEAR) → ask in the AI Workspace.

## 4. Production

| Item | Setting |
|---|---|
| Database | `DATABASE_URL` (PostgreSQL 15+). Migrations run on first connection. |
| Worker | Default: in-process. For several web instances, set `WORKER_INLINE=false` on all of them and run one `pnpm worker`. |
| Events | SSE fan-out is in-process; with several instances put them behind sticky sessions or add a shared bus (Postgres `LISTEN/NOTIFY` or Redis). |
| Rate limits | In-process token buckets; move to Postgres/Redis for multi-instance. |
| Secrets | Provider keys and `NEAR_RECEIPT_SIGNER_KEY` are runtime env only. The signer key is a function-call key limited to `commit_receipt`. |
| Docker | `docker build -t metabolic-web --build-arg PUBLIC_WEB_URL=https://… frontend` then `docker run --env-file … -p 3000:3000 -v metabolic-data:/app/.data metabolic-web`. |
| Mainnet | Not enabled. Switching means `NEAR_NETWORK=mainnet`, a mainnet RPC/explorer, a mainnet contract, and a legal review. |

## 5. Operating

- **Pause:** Settings → Emergency pause (operator). Blocks all inference immediately; deposits and receipts still work. The contract has its own `set_paused`.
- **Policy:** Settings → Economic policy (operator). Saving creates a new version; old decisions keep their version number.
- **Prices:** edit `config/models.json` (or `*_COST_*_PER_M` env for OpenAI-compatible providers) and restart. Keep `cost` in sync with provider pricing pages; Gemini 3.8 Flash's listed price changes on 2027-01-01 and Gemini 4 Argon's on 2026-12-01.
- **Provider bills:** provider costs accrue as payables in the ledger. They reduce operating liquidity until paid; `withdraw_operating` on the contract is the capped, logged way to move NEAR out to pay them.
- **Receipts:** the worker commits one every `RECEIPT_INTERVAL_MIN` minutes when there was ledger activity, and retries failed ones every 5 minutes. Anyone can check one at `/verify`.

## 6. The 90-second judge demo

Before judging: business funded, at least one finalized receipt, customer wallet signed in with credits, browser at `/demo`.

| Time | Chapter | Do | Real / sim |
|---|---|---|---|
| 0–15 s | Meet it | Point at treasury, revenue, margin, state in the right panel. | Real numbers |
| 15–30 s | It thinks, it pays | Click **Ask**. Answer streams; cost, charge, margin and the routing reason appear. | **Real** inference + billing |
| 30–45 s | Costs spike | Automatic ×4 provider-cost spike. Margin collapses, router downgrades, organism turns amber. | Simulated |
| 45–60 s | Money runs out | Automatic treasury drain. Survival: core collapses red, requests refused with a reason. | Simulated |
| 60–75 s | It recovers | Prices normalise, funding returns. Recovery (blue), then rebuilding. | Simulated |
| 75–90 s | Proof | Show the latest finalized receipt, open the explorer, **Verify it yourself** → ✓ Match. | **Real** on chain |

Keys: Space/→ next, ← back, P pause, R replay. Manual control: `/console/stress-lab`.

Fallbacks: no wallet → chapter 2 says so and the demo continues; no contract → chapter 6 says receipts aren't configured. Nothing is faked to fill a gap.

The independently verified deposit → Spend Pass → live inference → receipt walkthrough is documented in [10-DEPLOYMENT-VERIFICATION.md](10-DEPLOYMENT-VERIFICATION.md). Its isolated local environment runs with `pnpm testnet:dev` on port 3002. The business owner is `solrishu.testnet`; signing used fresh faucet-funded test wallets. Production hosting remains deliberately unpublished.

## 7. What is real and what is not

| Real | Simulated (always labelled) | Not built (future) |
|---|---|---|
| NEAR sign-in (NEP-413), deposit verification at finality, ledger, credits, inference, provider usage and cost, routing decisions, state machine, receipts on chain, verification | Stress Lab and `/demo` economy | Staking, borrowing, treasury investment, mainnet, automatic provider payment on chain |
