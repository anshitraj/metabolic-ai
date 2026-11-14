# Spend Pass and testnet verification implementation plan

**Goal:** Enforce per-agent spending permissions, close the authenticated funding/inference/receipt loop, and prepare a verifiable production deployment.

**Architecture:** Keep the existing user credit balance as the workspace balance. Bind each agent API credential immutably to a persisted Spend Pass. At the shared inference boundary, lock the credential, pass and credit balance in one transaction, select an eligible model using a conservative maximum charge, and persist the reservation before provider execution. Settle or release the pass and customer reservations together. Pass policy is immutable in v1; revocation blocks new reservations while admitted work can settle.

**Stack:** Existing Next.js/TypeScript, Drizzle/PostgreSQL/PGlite, NEAR Rust contract, Vitest, Gemini and Three.js.

## 1. Preserve and trace the baseline

- Read `frontend/AGENTS.md`, schema, shared inference, authentication, treasury, receipts, contract and legacy pass code.
- No `.git` exists in this supplied folder; preserve files in place and do not invent commits or a remote.
- Legacy `legacy-algebra/lib/pass-rules.ts` describes approval UI rules, but the current backend has no persisted agent spending authorization to reuse.
- Railway CLI is signed out, Docker engine is stopped, and no NEAR contract/signer is configured. Request public account/deployment choices while implementation continues. Never put credentials in reports.

## 2. Persist pass policy and reservations

- Modify `frontend/server/db/schema.ts`, generate a migration with `pnpm db:generate`.
- Add owner-scoped passes, immutable credential bindings, usage pass/version/lease fields, aggregate spent/reserved amounts and private activity queries.
- Add `frontend/server/services/spend-passes.ts` for validation, owner CRUD, eligibility, locked admission, settlement and recovery.
- Test concurrent admission, workspace isolation, immutable credential binding, revoked/expired/exhausted policy, and idempotent release/settlement.

## 3. Enforce at shared inference

- Modify `frontend/server/services/inference.ts`, authentication, developer inference route and worker.
- Resolve restrictions from the authenticated API key, never a caller-supplied pass ID; intersect model restrictions and economic policy.
- Reserve a conservative maximum customer charge against both pass and credits atomically. Recheck the admitted reservation before failover. Keep provider costs separate, flag overruns and unknown expenses.
- Bound execution time, finish accounting even when clients disconnect, and reclaim stale reservations after the maximum execution/lease window. Never replay an ambiguous paid operation after a crash.
- Run focused Vitest integration tests before broader checks.

## 4. Bind funding evidence and harden receipts

- Modify treasury intent creation/verification, wallet callback persistence, NEAR RPC types, receipt submission/verification and migration fields.
- Bind an intent to the authenticated payer, intended recipient, amount, network and deposit memo. Validate final execution and contract-emitted deposit evidence. Keep legacy no-intent verification only for old clients, with transaction uniqueness preserved.
- Make intent consumption atomic with transaction uniqueness and the credit journal.
- Use the actual policy version in commitments and recover already-committed receipt retries by independently reading the stored hash.
- Add tests for duplicate/concurrent deposits, intent mismatch/reuse, nonfinal or failed receipts and independently verified commitments.

## 5. Connect owner and agent UX

- Add Spend Pass create/detail/activity/revoke controls to the existing Developer API area.
- Show remaining/spent/reserved credit, exact limits, expiration/status and activity/request/receipt links.
- Distinguish app credentials, spending permission and the operator-funded provider key. Keep prompts/secrets out of decision events and commitments.
- Use authoritative inference/funding/rejection events for existing scene effects and leave simulation isolated.

## 6. Prepare and verify deployment

- Add a health endpoint, production environment preflight, reproducible Railway/container configuration and testnet readiness/deployment scripts.
- Use PostgreSQL and one web replica with the inline worker for this version. Preserve runtime-only secrets; validate signer permission and contract authorization using read-only RPC.
- Run contract tests/build, lint, unit/integration tests, live model checks, HTTP tests, production build, and desktop/mobile browser verification.
- Deploy and run the six-step funded testnet demonstration only after a host login and authorized funded wallet are available. Record only observed transaction hashes and verification results.

## 7. Record evidence and precise outstanding access

- Add `docs/09-SPEND-PASSES.md` and `docs/10-DEPLOYMENT-VERIFICATION.md`, update runbook/README.
- Record local versus deployed results separately. A locally built production bundle is not a public deployment; mocked chain evidence is not a testnet transaction.
- Defer automatic top-ups until explicit owner limits and independently confirmed settlement are available.
