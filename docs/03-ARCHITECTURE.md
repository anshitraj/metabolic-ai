# 03 — Architecture

> **As built (2026-11-14):** implemented as described, with these choices: providers are Anthropic, Google Gemini and OpenAI-compatible (DeepSeek, hosted Llama); without `DATABASE_URL` the app uses embedded PGlite; the worker runs in-process via `instrumentation.ts` (standalone `pnpm worker` for PostgreSQL); domain code lives in `frontend/server/`; no Redis.

## 1. System view

```
┌──────────────────────────── Browser ─────────────────────────────┐
│  Next.js UI (React 19)                                           │
│  ├─ Organism (R3F, lazy)  ◄── zustand live store ◄── SSE client  │
│  ├─ TanStack Query (snapshots: /overview, /treasury, …)          │
│  └─ NEAR Wallet Selector (signs deposits, sign-in message)       │
└───────────────┬──────────────────────────────┬───────────────────┘
                │ HTTPS (same origin)          │ wallet → NEAR RPC
┌───────────────▼──────────────────────────────┴───────────────────┐
│  Next.js route handlers  (app/api/**)  — thin, zod-validated     │
│                                                                  │
│  server/                                                         │
│  ├─ auth        nonce, NEP-413 verify, sessions, roles           │
│  ├─ billing     estimate → reserve → finalize → refund           │
│  ├─ ledger      append-only double-entry, atomic                 │
│  ├─ treasury    balances, deposits, liquidity view               │
│  ├─ registry    models, versioned prices, capabilities           │
│  ├─ policy      PURE: snapshot + config → state + permissions    │
│  ├─ router      PURE: request + candidates + policy → choice     │
│  ├─ gateway     provider adapters, stream, usage, failover       │
│  ├─ receipts    build, hash, batch, submit, verify               │
│  ├─ simulation  isolated scenario engine (reuses policy/router)  │
│  └─ events      typed envelope, persist, fan-out (SSE)           │
└───────┬───────────────────┬──────────────────────┬───────────────┘
        │                   │                      │
   PostgreSQL          AI providers           NEAR testnet
   (Drizzle)     Anthropic · DeepSeek ·    RPC + metabolic contract
                  Llama host · …
        ▲
┌───────┴─────────── worker/ (separate process) ───────────────────┐
│  deposit reconciliation · receipt batching/submission ·          │
│  provider health checks · price snapshot refresh · snapshots     │
└──────────────────────────────────────────────────────────────────┘
```

Key property: `policy` and `router` are **pure functions**. The real system and the Stress Lab call the same code with different inputs. That is what makes the simulation honest and the decisions testable.

## 2. Folder structure (inside `frontend/`, to be renamed `app/` later if wanted)

```
app/
  (marketing)/page.tsx            landing
  (app)/console/…                 authenticated product (see doc 06)
  verify/                         public receipt verification
  demo/                           presentation mode
  api/
    auth/{nonce,verify,logout}/route.ts
    dashboard/{overview,metrics}/route.ts
    events/stream/route.ts        SSE
    chat/route.ts                 web workspace (session auth)
    v1/inference/route.ts         developer API (API-key auth)
    models/route.ts
    usage/route.ts
    treasury/{route,transactions,deposit-intent,verify-deposit}/…
    economics/{state,decisions,history}/route.ts
    receipts/{route,[id]}/route.ts
    simulations/{route,[id],[id]/events}/route.ts
    keys/{route,[id]}/route.ts
server/
  money.ts  ids.ts  clock.ts  errors.ts
  auth/ billing/ ledger/ treasury/ registry/ policy/ router/
  gateway/{adapter.ts, anthropic.ts, openai-compatible.ts, gemini.ts}
  receipts/ simulation/ events/
  db/{schema.ts, client.ts, migrations/}
worker/index.ts
contracts/metabolic/              Rust near-sdk contract
components/
  organism/                       R3F scene + 2D fallback
  shell/  metrics/  charts/  decisions/  treasury/  workspace/  stress/  ui/
lib/
  store/live.ts                   zustand: state, last events, effects toggle
  near/                           wallet selector setup, explorer links
tests/{unit,integration,e2e}/
```

## 3. Money and units

| Quantity | Type | Storage |
|---|---|---|
| USD amounts | `bigint` micro-USD (`1n = $0.000001`) | `numeric(38,0)` |
| NEAR amounts | `bigint` yoctoNEAR (`10^24 = 1 NEAR`) | `numeric(40,0)` |
| Ratios (margin, coverage) | basis points integer (`3000 = 30.00%`) | `integer` |
| Token prices | micro-USD per 1M tokens | `numeric(38,0)` |
| NEAR/USD rate | micro-USD per 1 NEAR + `observed_at` + `source` | `price_snapshots` |

All arithmetic in `server/money.ts` on `bigint`, with explicit rounding (`ceil` for charges to customers' disadvantage is **not** used: charges round half-up, costs round up, so margins are reported conservatively).

## 4. Database (PostgreSQL)

Every table has `id uuid pk`, `created_at timestamptz`. `scope` columns are `'real'` or a simulation id; real queries always filter `scope = 'real'`.

| Table | Key columns | Notes |
|---|---|---|
| `users` | `near_account_id unique`, `email null`, `role` | |
| `organizations` | `owner_user_id` | One per user in MVP |
| `wallets` | `user_id`, `account_id`, `network`, `verified_at` | From NEP-413 sign-in |
| `api_keys` | `org_id`, `prefix`, `hash`, `scopes[]`, `revoked_at`, `last_used_at` | Hash = SHA-256 of secret; show secret once |
| `treasury_accounts` | `network`, `contract_id`, `label` | |
| `chain_transactions` | `network`, `tx_hash unique(network,tx_hash)`, `signer`, `receiver`, `amount_yocto`, `status`, `block_height`, `finalized_at` | |
| `deposits` | `org_id`, `chain_tx_id unique`, `amount_yocto`, `usd_micro`, `rate_snapshot_id`, `credited_at` | unique on tx → exactly-once credit |
| `ledger_entries` | `journal_id`, `account`, `debit_micro`, `credit_micro`, `scope`, `ref_type`, `ref_id` | Append-only; DB trigger blocks UPDATE/DELETE |
| `credit_balances` | `org_id pk`, `available_micro`, `reserved_micro`, `version` | Derived cache of ledger; row-locked on reserve |
| `usage_requests` | `org_id`, `idempotency_key unique`, `model_id`, `status`, `in_tokens`, `out_tokens`, `est_cost_micro`, `cost_micro`, `cost_is_estimated`, `charge_micro`, `latency_ms` | |
| `model_catalog` | `provider`, `model_key`, `tier`, `capabilities jsonb`, `quality_score`, `enabled` | |
| `model_prices` | `model_id`, `in_per_m_micro`, `out_per_m_micro`, `sell_in_per_m_micro`, `sell_out_per_m_micro`, `effective_from` | Versioned; never edited in place |
| `provider_health` | `provider`, `ok`, `latency_ms`, `error_class`, `observed_at` | |
| `routing_decisions` | `usage_request_id`, `state`, `chosen_model_id`, `candidates jsonb`, `constraints jsonb`, `explanation`, `policy_version`, `scope` | |
| `economic_snapshots` | `scope`, `liquidity_micro`, `liabilities_micro`, `revenue_micro`, `expense_micro`, `rolling_margin_bp`, `reserve_coverage_bp`, `burn_micro_per_h`, `runway_s`, `state` | Every N seconds + on change |
| `policy_configs` | `version`, `thresholds jsonb`, `limits jsonb`, `active` | |
| `state_transitions` | `scope`, `from`, `to`, `trigger`, `metrics jsonb`, `policy_version` | |
| `economic_receipts` | `receipt_id unique`, `interval_start/end`, `payload jsonb`, `hash`, `status`, `tx_hash`, `error` | |
| `audit_events` | `actor`, `action`, `target`, `meta` | |
| `simulation_scenarios` | `owner_user_id`, `params jsonb`, `state jsonb`, `expires_at` | |
| `events` | `type`, `scope`, `entity_id`, `payload`, `seq bigserial` | Used for SSE replay via `Last-Event-ID` |
| `jobs` | `kind`, `run_at`, `locked_until`, `attempts`, `payload` | Worker queue |

Ledger accounts (double entry):

```
asset:treasury_near          real NEAR held (USD-valued at snapshot)
liability:customer_credits   prepaid, unearned
revenue:inference            recognised on final charge
expense:provider:<name>      provider cost (estimated or actual flag on usage row)
expense:network_fees         NEAR gas for receipts
```

Deposit: Dr `asset:treasury_near` / Cr `liability:customer_credits`.
Final charge: Dr `liability:customer_credits` / Cr `revenue:inference`.
Provider cost accrual: Dr `expense:provider:x` / Cr `liability:provider_payable:x`.

Available operating liquidity = treasury assets − customer credit liabilities − provider payables − hard reserve.

## 5. Request lifecycle (inference)

1. Auth (session or API key) → rate limit → size limit → idempotency key.
2. `registry.candidates(task)` → capable, enabled, healthy models.
3. `billing.estimate(candidate, tokens)` for each.
4. `policy.evaluate(snapshot, config)` → state + permissions.
5. `router.choose(request, candidates, estimates, policy)` → model + explanation, or a refusal reason.
6. `billing.reserve(org, maxCharge)` — `SELECT … FOR UPDATE` on `credit_balances`; fails if insufficient.
7. `gateway.stream(model, messages)` → tokens to client; capture usage.
8. On provider error before first token: failover per router rules; on error mid-stream: finalize for tokens delivered only.
9. `billing.finalize(actualUsage)` → one DB transaction: ledger entries, release unused reserve, usage row.
10. Persist `routing_decisions`; publish `inference.completed`; maybe trigger snapshot + state transition.

Client disconnect: abort provider call, finalize with delivered usage, never double charge (idempotency key + usage row status machine `reserved → streaming → finalized | refunded`).

## 6. API

All JSON, zod-validated, errors as `{ error: { code, message, request_id } }`. Every response carries `x-request-id`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/nonce` | — | Sign-in nonce |
| POST | `/api/auth/verify` | — | Verify NEP-413 signature, set session |
| GET | `/api/dashboard/overview` | session | Metrics + state + last decision (snapshot for sync) |
| GET | `/api/dashboard/metrics?range=` | session | Chart series |
| GET | `/api/events/stream?scope=` | session | SSE, supports `Last-Event-ID` |
| POST | `/api/chat` | session | Workspace streaming chat |
| POST | `/api/v1/inference` | API key | Developer inference (stream or not) |
| GET | `/api/models` | session | Catalog, prices, health, routing frequency |
| GET | `/api/usage` | session/key | Usage history |
| GET | `/api/treasury` | session | Balances (labelled by kind) |
| GET | `/api/treasury/transactions` | session | Chain tx list |
| POST | `/api/treasury/deposit-intent` | session | Amount + contract + memo for wallet |
| POST | `/api/treasury/verify-deposit` | session | Submit tx hash; server verifies on chain |
| GET | `/api/economics/state` | session | Current state + reasons |
| GET | `/api/economics/decisions` | session | Filterable decision log |
| GET | `/api/economics/history` | session | State transitions |
| GET | `/api/receipts`, `/api/receipts/:id` | public | Receipts + verification |
| POST/GET/DELETE | `/api/simulations[/:id]` | session | Scenario lifecycle |
| POST | `/api/simulations/:id/events` | session | Apply stress action |
| POST/GET/DELETE | `/api/keys[/:id]` | session | API keys |
| POST | `/api/admin/pause` | operator | Emergency pause |

## 7. Events

Envelope:

```ts
type MetabolicEvent = {
  id: string;            // uuid
  seq: number;           // monotonic per scope, used as SSE id
  ts: string;            // ISO
  type: EventType;
  source: "gateway" | "policy" | "treasury" | "receipts" | "simulation" | "worker";
  scope: "real" | `sim:${string}`;
  simulated: boolean;
  entityId?: string;
  payload: Record<string, unknown>;
};
```

Types: `treasury.deposit.pending`, `treasury.deposit.confirmed`, `inference.started`, `inference.completed`, `inference.failed`, `model.switched`, `economic.state.changed`, `margin.threshold.crossed`, `receipt.submitted`, `receipt.finalized`, `receipt.failed`, `provider.unhealthy`, `provider.recovered`, `snapshot.updated`.

Rules: events drive animation; snapshots drive numbers. On reconnect, the client refetches `/api/dashboard/overview` and resumes from `Last-Event-ID`. Missing an event never leaves the UI wrong, only un-animated.

## 8. NEAR integration

### Contract `metabolic` (Rust, near-sdk 5.x), testnet first

```
state:
  owner: AccountId
  receipt_signers: UnorderedSet<AccountId>
  receipts: LookupMap<String, ReceiptCommitment>   // id → { hash, interval_end, policy_version, committed_at }
  deposits_total: LookupMap<AccountId, u128>
  paused: bool

#[payable] deposit(memo: Option<String>)          // emits EVENT_JSON deposit {account, amount, memo}
commit_receipt(id, hash_hex, interval_start, interval_end, policy_version)
                                                  // signer-only, rejects duplicate id, emits receipt_committed
get_receipt(id) -> Option<ReceiptCommitment>      // view
verify_receipt(id, hash_hex) -> bool              // view
add_signer / remove_signer / set_paused           // owner-only
withdraw_operating(amount, to)                    // owner-only, capped, emits event — optional for MVP
```

Events follow NEP-297 (`EVENT_JSON:{"standard":"metabolic","version":"1.0.0","event":"…","data":[…]}`).

### Deposit flow

1. UI → `deposit-intent` → `{ contractId, amountYocto, memo: intentId }`.
2. Wallet signs `deposit` with attached deposit.
3. UI posts `txHash` to `verify-deposit` (and the worker also scans contract events as a backstop).
4. Server calls `EXPERIMENTAL_tx_status` / `tx` with `wait_until: FINAL`, checks receiver = contract, method = `deposit`, attached amount, signer = session account, success outcome, network, and that the hash is unused.
5. One DB transaction: `chain_transactions` + `deposits` (unique) + ledger + `credit_balances`.
6. Publish `treasury.deposit.confirmed`.

### Receipts

Worker every interval (default 10 min, or on state change): build payload `{receipt_id, policy_version, state, model_tier_mix, revenue_micro, expense_micro, margin_bp, interval_start, interval_end, ledger_root}` where `ledger_root` = SHA-256 over canonical JSON of the interval's ledger entry ids and amounts (no prompts, no user identifiers). Hash payload, call `commit_receipt` with a function-call access key held server-side (limited to that method and contract), track `pending → submitted → finalized | failed`. `/verify` recomputes the hash from the published payload and compares with `get_receipt`.

### Explorer links

`https://testnet.nearblocks.io/txns/<hash>` (configurable via `NEAR_EXPLORER_URL`).

## 9. Configuration

```
DATABASE_URL=
SESSION_SECRET=
PUBLIC_WEB_URL=
NEAR_NETWORK=testnet
NEAR_RPC_URL=https://rpc.testnet.near.org
NEAR_CONTRACT_ID=
NEAR_RECEIPT_SIGNER_ID=
NEAR_RECEIPT_SIGNER_KEY=          # function-call key, server only
NEAR_EXPLORER_URL=https://testnet.nearblocks.io
PRICE_FEED_URL=                   # NEAR/USD source; stale after PRICE_MAX_AGE_S
PRICE_MAX_AGE_S=300
ANTHROPIC_API_KEY=   ANTHROPIC_MODELS=
DEEPSEEK_API_KEY=    DEEPSEEK_BASE_URL=   DEEPSEEK_MODELS=
LLAMA_API_KEY=       LLAMA_BASE_URL=      LLAMA_MODELS=
MODEL_PRICES_FILE=config/model-prices.json
```

No `NEXT_PUBLIC_` variable ever holds a secret. Public ones: `NEXT_PUBLIC_NEAR_NETWORK`, `NEXT_PUBLIC_NEAR_CONTRACT_ID`.

## 10. Security checklist

Server-only provider keys; NEP-413 challenge with nonce + expiry; httpOnly SameSite=Lax session; CSRF token on cookie-auth POSTs; API keys hashed; rate limits per key and IP (Postgres token bucket); body size caps; zod everywhere; idempotent deposits and charges; row locks on credits; audit log for keys, policy edits, pause, withdrawals; emergency pause blocks inference and contract writes; the model never touches treasury functions.
