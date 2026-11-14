# Metabolic AI

**Intelligence that earns. Adapts. Survives.**

An AI service that runs itself as a business. Customers prepay with NEAR; every request is priced before it runs; a deterministic policy engine picks the best model the business can afford right now; actual usage is billed after; and when money gets tight the business downgrades, protects its reserve, and recovers when funded. A live 3D organism shows its metabolism. Hashes of its books are committed to a NEAR contract that anyone can verify.

License: [MIT](LICENSE). Status: hackathon prototype, NEAR **testnet** only.

## What it is

**Problem.** An AI service has a cost per request and a price per request. Usually a person watches the gap between them and changes models or limits by hand.

**Product.** A Next.js app that does this itself. Customers prepay by depositing NEAR. Each request is priced before it runs. A deterministic policy engine (plain code, not an LLM) reads the business's own books and picks the best model it can afford right now. Actual token usage reported by the provider is billed after the answer. The business moves between four states (Abundance, Defensive, Survival, Recovery) and every state change is logged with its reason. Periodically a SHA-256 hash of the books is committed to a NEAR contract, and anyone can recompute it and compare.

**How NEAR is used** (all of it built during the hackathon window, see [Hackathon disclosures](#hackathon-disclosures)):

- **Deposits.** The server verifies each deposit by reading the transaction over NEAR RPC at final finality, credits it once, and rejects duplicates. Operator deposits are operating capital; customer deposits are prepaid credit. They are tracked separately.
- **Sign-in.** NEP-413 signed-message login through wallet-selector (MyNearWallet, Meteor).
- **Contract.** [`contracts/metabolic`](contracts/metabolic/README.md) (Rust, `near-sdk`): `deposit`, `commit_receipt`, `get_receipt`, `verify_receipt`, signer list, pause, capped withdraw.
- **Receipts.** The server commits receipt hashes with a restricted function-call key (single method `commit_receipt`, one receiver, finite gas allowance). `/verify` recomputes the hash from the stored payload and compares it with `get_receipt` on chain.
- **NEAR AI Cloud** is one of the inference providers (`nearai:*` models in [`frontend/config/models.json`](frontend/config/models.json)), used through its OpenAI-compatible API. This app does not check TEE attestation.

**Not implemented.** NEAR Intents, chain signatures, mainnet, and automatic on-chain payment of AI providers. Provider API keys are funded by the operator; provider cost is recorded off chain from the usage the provider reports. Spend Passes (per-agent budgets) are enforced by the server, not by a contract.

## Try it (do X, see Y)

Setup for all steps: `cd frontend && cp .env.example .env.local && pnpm install && pnpm dev`, then open http://localhost:3000. Steps 1 and 2 need no wallet, no database setup and no provider key. Step 3 needs only `curl`.

1. **Open `/demo`.** See six chapters autoplay, 15 seconds each. Chapters 3 to 5 (costs spike, money runs out, recovery) are **SIMULATED** and labelled so; the 3D organism and state chip change with each.
2. **Open `/console/stress-lab` and click "Costs rise", then "Funds run low", then "Add funding".** See the state move Abundance, then Defensive or Survival, then Recovery, with the model choice, margin and a written reason for each decision. These run the real policy engine on an isolated simulated economy and make no provider calls.
3. **Check a real on-chain receipt without installing anything.** Run:

   ```bash
   curl -sS https://rpc.testnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"metabolic-d0e41b6dc5.testnet","method_name":"get_receipt","args_base64":"eyJpZCI6InJjcHRfMjAyNjExMTRfMTMyMjIzX2FiZDhhYjFmIn0="}}'
   ```

   See a `result` byte array; decoded it is JSON with `hash_hex` `6070e28ada3c43285db1e977f07a5e9602d4896ff933b57985d19216ed32ee69`. That is the hash the business committed for receipt `rcpt_20261114_132223_abd8ab1f`. The transactions are listed in [docs/10-DEPLOYMENT-VERIFICATION.md](docs/10-DEPLOYMENT-VERIFICATION.md) with explorer links, and the recorded evidence is in [`artifacts/testnet-verification/`](artifacts/testnet-verification/).
4. **Run a real paid request.** Needs a provider key in `.env.local` (`GEMINI_API_KEY`, `NEARAI_API_KEY`, `ANTHROPIC_API_KEY`, or another listed in `.env.example`) and a testnet wallet. Follow the three steps under "To bring it to life on testnet" below, then ask a question in `/console/workspace`. See the answer with the model that replied, what it cost the business, what you were charged, and why that model was picked; cost is marked **est.** whenever the provider reported no token usage. Your credit balance drops by the charge and the routing decision appears on `/console/decisions`.
5. **Call it as an agent.** `/console/connect` has copy-paste setup for Claude Code, Codex, Gemini CLI, OpenCode, Cursor, Antigravity, Windsurf, VS Code, Claude Desktop and Cline. Underneath: an OpenAI-compatible API (`GET /api/v1/models`, `POST /api/v1/chat/completions`, model names `metabolic-auto`, `metabolic-premium`, `metabolic-standard`, `metabolic-economy`) and an MCP server at `/api/mcp`. Both take an API key created in `/console/developers`, optionally bound to a Spend Pass budget.
6. **Redeploy the whole testnet flow from scratch.** `node scripts/setup-testnet.mjs --execute` in `frontend/` creates fresh faucet-funded testnet accounts and deploys the contract; see [docs/10-DEPLOYMENT-VERIFICATION.md](docs/10-DEPLOYMENT-VERIFICATION.md).

## Repository layout

```
frontend/            Next.js 16 app: UI + backend (route handlers) + in-process worker
  app/               routes — landing, console/*, demo, verify, login, api/*
  server/            domain: policy engine, router, billing, ledger, treasury, receipts, simulation, gateway
  components/        UI (m/), 3D organism (organism/)
  config/models.json model catalog + prices
  tests/             unit + integration (vitest), live provider smoke tests
contracts/metabolic/ Rust NEAR contract: deposits + economic receipt commitments
artifacts/           recorded testnet verification evidence (JSON + screenshots, no secrets)
docs/                product, architecture, policy, design system, screens, roadmap, runbook
legacy-algebra/      pre-hackathon Algebra UI, moved aside as the baseline (not built)
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

## Hackathon disclosures

### Baseline: Algebra (pre-hackathon work)

Before NEAR HACKATHON this folder held **Algebra**, an earlier product by the same author: a Next.js console for AI agents with USDC vaults on Solana and EVM chains, an emailed-code login backed by a separate REST backend, and Spend Pass rules. It had **no NEAR code, no database and no tests** ([docs/02-AUDIT-AND-MIGRATION.md](docs/02-AUDIT-AND-MIGRATION.md), section 1). Metabolic AI is built on top of that checkout.

- **Git history.** The Algebra history is not in this repository. Commit `56a1c61` (2026-11-14) therefore contains baseline and new work together, so there is no `pre-hackathon` tag that isolates the diff.
- **Where the baseline is.** The Algebra UI was moved aside under [`legacy-algebra/`](legacy-algebra/) (178 files: `app/`, `components/`, `lib/`). It is not built or served.
- **What changed, measured by file content.** No file in `frontend/` is byte-identical to a file in `legacy-algebra/`. Six routes share a path with an Algebra route and were rewritten: `app/console/page.tsx`, `app/console/layout.tsx`, `app/console/connect/page.tsx`, `app/console/settings/page.tsx`, `app/demo/page.tsx`, `app/verify/page.tsx`. Eight Algebra files have an obvious successor under a new name (console shell, UI primitives, landing, provider-mark, money helpers, session helper, provider types, model catalog); line-by-line similarity between each pair is 4% to 19%, so they were effectively rewritten. [docs/02-AUDIT-AND-MIGRATION.md](docs/02-AUDIT-AND-MIGRATION.md) section 3 is the migration plan that says which Algebra parts were to be reused, replaced or removed.
- **What is new.** Everything NEAR: the contract, NEP-413 sign-in, deposit verification, receipts and verification, the NEAR AI provider. Spend Passes were reimplemented on NEAR credits with server-enforced budgets (Algebra had a different Spend Pass rules module). Also the policy engine, router, double-entry ledger, simulation, the 3D organism, the OpenAI-compatible API, the MCP server and the Connect page.

### Libraries

- App: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Drizzle ORM, PostgreSQL or embedded PGlite, zod, zustand, motion.
- 3D and graphics: three, @react-three/fiber, @react-three/drei, @react-three/postprocessing, konva / react-konva, @lottiefiles/dotlottie-wc, Remotion (editable social-video exports, see [docs/13-MOTION-AND-SOCIAL-VIDEO.md](docs/13-MOTION-AND-SOCIAL-VIDEO.md)).
- NEAR and crypto: @near-js/accounts, crypto, providers, signers and transactions; @near-wallet-selector/core, modal-ui, my-near-wallet and meteor-wallet; @noble/curves and @noble/hashes; @scure/base, bip32 and bip39. Contract: Rust `near-sdk` 5.6.
- Providers: @anthropic-ai/sdk, @google/genai, openai (also used for the OpenAI-compatible DeepSeek, Llama and NEAR AI endpoints).
- Dev: vitest, Playwright, ESLint, drizzle-kit, tsx.

Exact versions are in [`frontend/package.json`](frontend/package.json), [`frontend/pnpm-lock.yaml`](frontend/pnpm-lock.yaml) and [`contracts/metabolic/Cargo.toml`](contracts/metabolic/Cargo.toml). Provider logos in `frontend/public/connectors/` belong to their owners and are used only to identify the tools they name.

### AI-generated code

Most of the code, tests and documents in this repository were written by AI coding agents, Claude Code and OpenAI Codex, working from requirements and direction given by the project owner. The agents also ran the checks below.

### Verification status

- Run 2026-11-15: `pnpm test` 93 passed (11 files). `pnpm test:live` 5 passed against the real Gemini and NEAR AI APIs, including streamed answers with provider-reported token usage.
- Recorded 2026-11-14 in [docs/10-DEPLOYMENT-VERIFICATION.md](docs/10-DEPLOYMENT-VERIFICATION.md): testnet deployment, two real deposits, live requests with pass-bound routing, revocation, and a finalized on-chain receipt that matched the recomputed hash.
- **Not exercised:** an interactive MyNearWallet or Meteor signing session with a personal wallet, a public hosted deployment, a managed PostgreSQL deployment, and anything on mainnet.

## Read next

- [docs/README.md](docs/README.md) — the design and architecture documents
- [docs/08-RUNBOOK.md](docs/08-RUNBOOK.md) — deploy, operate, and run the 90-second demo
- [contracts/metabolic/README.md](contracts/metabolic/README.md) — contract API and testnet deployment
- [docs/09-SPEND-PASSES.md](docs/09-SPEND-PASSES.md) — enforced per-agent budgets and owner/API workflows
- [docs/10-DEPLOYMENT-VERIFICATION.md](docs/10-DEPLOYMENT-VERIFICATION.md) — observed testnet transactions, demo evidence and production preparation
- [docs/11-RAILWAY-SUPABASE.md](docs/11-RAILWAY-SUPABASE.md) — deploy the complete Next.js app on Railway with Supabase PostgreSQL

The verified testnet environment runs separately with `cd frontend` and `pnpm testnet:dev` at `http://localhost:3002`. It uses the deployed `metabolic-d0e41b6dc5.testnet` contract owned by `solrishu.testnet`. Production publication is deferred; the testnet report distinguishes on-chain evidence from local and browser checks.
