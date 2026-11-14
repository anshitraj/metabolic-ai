# Metabolic AI

**Intelligence that earns. Adapts. Survives.**

An AI service that runs itself as a business. Customers prepay with NEAR; every request is priced before it runs; a deterministic policy engine picks the best model the business can afford right now; actual usage is billed after; and when money gets tight the business downgrades, protects its reserve, and recovers when funded. A live 3D organism shows its metabolism. Hashes of its books are committed to a NEAR contract that anyone can verify.

```
frontend/            Next.js 16 app: UI + backend (route handlers) + in-process worker
  app/               routes — landing, console/*, demo, verify, login, api/*
  server/            domain: policy engine, router, billing, ledger, treasury, receipts, simulation, gateway
  components/        UI (m/), 3D organism (organism/)
  config/models.json model catalog + prices
  tests/             unit + integration (vitest), live provider smoke tests
contracts/metabolic/ Rust NEAR contract: deposits + economic receipt commitments
docs/                product, architecture, policy, design system, screens, roadmap, runbook
legacy-algebra/      the previous Algebra UI, moved aside (not built)
```

## Quick start

```bash
cd frontend
cp .env.example .env.local        # set at least one of GEMINI_API_KEY / ANTHROPIC_API_KEY
pnpm install
pnpm dev                          # http://localhost:3000
```

No database setup is needed: without `DATABASE_URL` the app uses an embedded PostgreSQL (PGlite) in `frontend/.data/` and migrates it on first request. Background jobs (state evaluation, snapshots, price refresh, provider health, receipts) start inside the server.

A fresh business has no treasury, so it starts in **Survival** — that is correct. To bring it to life on testnet:

1. Set `OPERATOR_ACCOUNT_IDS=you.testnet` and a deposit target (`NEAR_CONTRACT_ID` after deploying the contract, or simply `NEAR_TREASURY_ACCOUNT_ID=some-account.testnet`).
2. Sign in at `/login` with that wallet and **Fund the business** on the Treasury page (operator deposits become operating capital).
3. Sign in with any other testnet wallet, deposit a little NEAR for credits, and ask something in the AI Workspace.

The Stress Lab (`/console/stress-lab`) and guided demo (`/demo`) work with no wallet and no keys: they run the real policy engine on an isolated, clearly labelled simulated economy.

## Checks

```bash
cd frontend
pnpm exec tsc --noEmit     # types
pnpm lint                  # ESLint
pnpm test                  # unit + integration tests (in-memory Postgres, mocked provider/RPC)
pnpm test:live             # real provider/model checks (uses provider quota)
pnpm test:e2e              # end-to-end HTTP checks against the running server
pnpm build                 # production build

cd ../contracts/metabolic
cargo test                 # contract tests
cargo build --target wasm32-unknown-unknown --release
```

## Read next

- [docs/README.md](docs/README.md) — the design and architecture documents
- [docs/08-RUNBOOK.md](docs/08-RUNBOOK.md) — deploy, operate, and run the 90-second demo
- [contracts/metabolic/README.md](contracts/metabolic/README.md) — contract API and testnet deployment
- [docs/09-SPEND-PASSES.md](docs/09-SPEND-PASSES.md) — enforced per-agent budgets and owner/API workflows
- [docs/10-DEPLOYMENT-VERIFICATION.md](docs/10-DEPLOYMENT-VERIFICATION.md) — observed testnet transactions, demo evidence and production preparation
- [docs/11-RAILWAY-SUPABASE.md](docs/11-RAILWAY-SUPABASE.md) — deploy the complete Next.js app on Railway with Supabase PostgreSQL

The verified testnet environment runs separately with `cd frontend` and `pnpm testnet:dev` at `http://localhost:3002`. It uses the deployed `metabolic-d0e41b6dc5.testnet` contract owned by `solrishu.testnet`. Production publication is deferred; the testnet report distinguishes on-chain evidence from local and browser checks.
