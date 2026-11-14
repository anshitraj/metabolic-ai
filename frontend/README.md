# Metabolic AI — web app

The whole application: UI, API and background jobs in one Next.js 16 app (App Router, Turbopack, React 19, Tailwind 4).

## Run

```bash
cp .env.example .env.local    # at least one provider key
pnpm install
pnpm dev                      # http://localhost:3000
```

| Script | |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm lint` · `pnpm exec tsc --noEmit` | checks |
| `pnpm test` | unit + integration tests (in-memory PGlite, mocked provider and NEAR RPC) |
| `pnpm test:live` | real provider smoke test, reads keys from `.env.local` |
| `pnpm test:e2e` | 29 HTTP end-to-end checks against a running server (`E2E_BASE_URL`, default localhost:3000) |
| `pnpm db:generate` | new SQL migration after editing `server/db/schema.ts` |
| `pnpm worker` | standalone worker (PostgreSQL deployments with `WORKER_INLINE=false`) |
| `pnpm testnet:prepare` | dry-run description; add `-- --execute` or run `node scripts/setup-testnet.mjs --execute` for fresh testnet deployment |
| `pnpm testnet:dev` | run the isolated, deployed-contract testnet demo at localhost:3002 |
| `pnpm testnet:verify` | resume the recorded real deposit, live agent inference and receipt verification flow |
| `pnpm preflight` | verify selected runtime DB, RPC, contract authorization and receipt-key restrictions |

## Layout

```
app/
  page.tsx                     landing
  console/                     command center, workspace, treasury, models, decisions, stress-lab, receipts, developers, settings
  demo/  verify/  login/       guided demo, public receipt verification, NEAR sign-in
  api/                         route handlers (zod-validated, x-request-id, consistent errors)
server/
  economics/policy.ts          the state machine (pure)
  economics/router.ts          cost- and capability-aware routing (pure)
  economics/registry.ts        model catalog from config/models.json + env
  gateway/adapters.ts          Anthropic, Gemini, OpenAI-compatible (DeepSeek, Llama) streaming adapters
  services/                    billing, ledger, economy, inference, treasury, receipts, auth, simulation, health, events
  near/rpc.ts                  NEAR JSON-RPC (tx finality, view calls, access keys)
  db/                          Drizzle schema, client (Postgres or PGlite), SQL migrations
  worker.ts                    background jobs (started from instrumentation.ts)
components/
  organism/                    React Three Fiber organism + 2D fallback
  m/                           UI primitives, shell, charts, stress lab, landing
lib/
  economics/                   shared types and integer money helpers
  client/                      fetch helpers, live store (zustand + SSE), NEAR wallet, session
```

## Notes

- **Spend Passes are enforced permissions.** Developer API → Spend Passes lets an owner create a named allowance, bind an agent key, inspect activity and revoke it. Server-side model restrictions and conservative maximum charge limits are reserved atomically against the pass and existing customer credits. See [the Spend Pass guide](../docs/09-SPEND-PASSES.md).
- **The testnet loop is verified.** Actual deployment, funding, Pro-to-Flash-Lite routing under a tighter cap, revocation and on-chain commitment verification are recorded in [the deployment report](../docs/10-DEPLOYMENT-VERIFICATION.md). Production hosting is prepared but was not published.

- **Gemini uses one key for multiple models.** Set `GEMINI_API_KEY` in `.env.local` and restart. The priced routing catalog is `config/models.json`; the legacy gateway's `GEMINI_MODELS` variable has no effect here. Premium uses Gemini 3.1 Pro Preview, Standard uses 3.8 Flash, and Economy uses 3.1 Flash-Lite. The router automatically selects a model that fits policy and available funds.
- **Check a connection in Console → AI models.** A configured key is not proof that a model can generate. Operators can send a bounded test prompt per model; the result distinguishes authentication, quota/billing, access and retired-model errors. Tests consume provider quota and may incur a small charge. Test replies do not spend customer credits or enter the customer billing ledger. No key is sent to the browser.
- **Stress Lab starts with one-click scenarios.** Fine-tuning uses an explicit Apply button, and Reset restores all settings. The state guide explains Abundance, Defensive, Survival and Recovery. The simulation makes no real provider calls.

- **Money is integers.** USD in micro-dollars, NEAR in yocto, ratios in basis points. Never floats in the ledger.
- **Ledger is append-only** (a DB trigger rejects updates and deletes) and double-entry; every journal must balance.
- **Simulations never touch real books.** The Stress Lab keeps its synthetic economy in `simulation_scenarios` and its events in a `sim:<id>` scope.
- **This drive (D:) can't create symlinks**, so `.npmrc` uses `node-linker=hoisted` and PGlite is bundled rather than externalised.
- The previous Algebra UI lives in `../legacy-algebra/` for reference; it is not built.
