# Deployment and testnet verification — 14 November 2026

## Observed result

The NEAR testnet contract is deployed at **`metabolic-d0e41b6dc5.testnet`**. Its independently read owner is **`solrishu.testnet`**. Deployment used fresh faucet-funded test accounts; it did not use the owner's private key or move funds from `solrishu.testnet`.

- [Contract deployment](https://testnet.nearblocks.io/txns/6KB5r6PNm81LtaqZPwmAo7Fp5wNJd6CgUZ5XG56hQMZX)
- [Operating capital deposit — 0.8 testnet NEAR](https://testnet.nearblocks.io/txns/3mqKuwdbKhNpTc4yMmQ97PZzU4fgsL7ZJFPPSrtbzbKd)
- [Customer credit deposit — 0.2 testnet NEAR](https://testnet.nearblocks.io/txns/CCTSNoE67X8Ji7dghvHEwGqsk8kNYyXQt7juJcdEr2tC)
- [Finalized accounting commitment](https://testnet.nearblocks.io/txns/4D3oEfyzfNE4mi3EjdoWbpLrmWjY1qVKpvDzVY6NtLyi)

Receipt **`rcpt_20261114_132223_abd8ab1f`** commits hash `6070e28ada3c43285db1e977f07a5e9602d4896ff933b57985d19216ed32ee69`. The stored hash, recomputed payload hash and independently read contract commitment all matched. Its policy version and interval boundaries were also verified.

## Six-step evidence

| Step | Observed outcome |
|---|---|
| Fresh zero-credit customer submits a real request | HTTP 402 `INSUFFICIENT_CREDITS`; no provider execution |
| Finalized customer deposit is verified | 0.2 testnet NEAR credited as 664000 micro-USD using the observed $3.32 NEAR/USD snapshot |
| Duplicate verification | Rejected `DUPLICATE`; balance unchanged |
| Pass-bound live request | Gemini 3.1 Pro Preview, two streamed text frames; maximum reservation 26708, actual customer charge 10868, provider expense 5434 micro-USD |
| Same prompt, tighter pass | 6000 micro-USD maximum charge selected Gemini 3.1 Flash-Lite; reservation 5008, actual charge 153, provider expense 52 micro-USD |
| Revoke and repeat | HTTP 403 `PASS_REVOKED`; no customer charge |
| Commitment | Finalized on NEAR; independent verification matched; both completed pass reservations returned to zero |

The generous pass had a 50000 micro-USD request cap. The cheaper model's maximum reservation fits 6000; the Pro maximum does not. Thus the switch follows actual authorization limits, rather than a simulated model toggle.

The isolated demo uses a **$0.10 accounting reserve and five-second dwell/recovery intervals**, saved as audited policy v2. Production/default policy values were not changed. Capital of 0.8 testnet NEAR was recorded separately from customer prepaid credit. Neither deposit is inference revenue. Provider expense uses reported usage and published prices; the Gemini API belongs to the operator-funded Google project and is not paid onchain by this demo.

The contract also holds faucet setup funds for storage and gas. Its on-chain balance and the application's credited-deposit totals are deliberately displayed as separate measures; the difference is not represented as earned revenue or customer credit.

The receipt runtime key was independently confirmed to have a finite **0.2 testnet NEAR gas allowance**, receiver restricted to this contract, and the single permitted method `commit_receipt`. It is not a full-access server key.

## Reproduce locally

From `frontend/`:

```powershell
pnpm install --frozen-lockfile
# .env.local must contain an operator-funded Gemini key. Never put keys in reports.
pnpm testnet:prepare                         # review dry-run description
node scripts/setup-testnet.mjs --execute    # fresh testnet wallets + deployment, resumable
pnpm testnet:dev                             # isolated app at http://localhost:3002
```

In a second terminal:

```powershell
pnpm testnet:verify
$env:E2E_BASE_URL = 'http://localhost:3002'
pnpm test:e2e
pnpm lint
pnpm test
pnpm test:live
pnpm build
```

The existing completed flow is checkpointed and does not rebroadcast deposits or replay paid requests when rerun. To reproduce the *fresh* zero-credit sequence, use a fresh test deployment/data set; do not delete the existing verification evidence. The setup script stops if the saved contract binary differs from the local build rather than silently upgrading a deployed contract.

Generated full-access keys belong only to fresh test wallets and stay under ignored `frontend/.data/`. The application runtime receives only the restricted receipt key. `frontend/.data/testnet-demo.env` selects the separate `.data/testnet-verified` database; existing local application data and `.env.local` are preserved. The public evidence under `artifacts/testnet-verification/` contains no private keys, bearer credentials or session cookies.

Wallet verification used real NEP-413 signatures and signed testnet deposit transactions through the application's existing APIs. Browser tests additionally exercised authenticated pass creation, activity, revocation, and receipt verification. **An interactive MyNearWallet/Meteor signing session using `solrishu.testnet` was not exercised.**

## Production preparation and remaining work

Validation passed: **79 unit/integration tests, 31 HTTP checks against the testnet development server, the same 31 HTTP checks against the built standalone production server, 9 Rust contract tests, 4 live provider/model checks, TypeScript, ESLint and the production build**. Authenticated desktop/mobile browser checks passed for pass creation, one-time credential display, activity, revocation and receipt verification, including rejection of a hash-only match when commitment metadata disagrees. Public evidence was checked for credential leakage and the client bundle for the configured provider key; neither was present.

Production publication was explicitly deferred by the user. Railway is installed but not authenticated. No public host was created and no hosting charges were incurred.

Prepared:

- Existing non-root, multi-stage standalone Docker image, with migrations and runtime-only credentials.
- `frontend/railway.toml`: one replica, `/api/health` deployment health check and bounded restart policy.
- `frontend/.env.production.example`: managed PostgreSQL, HTTPS origin, provider secret, operator and receipt configuration.
- `GET /api/admin/readiness`: operator-only checks of DB, RPC network, deployed contract, authorization and restricted receipt key.
- `pnpm preflight`: deployment checks for the selected runtime environment. Run before starting an embedded DB server; PGlite is single-process. In production supply PostgreSQL and runtime secrets instead.

To publish later, authenticate the chosen host, create managed PostgreSQL, use `frontend/` as the service root, set the production runtime variables, build the Dockerfile, deploy one replica and verify `/api/health`. Set `PUBLIC_WEB_URL` to the actual HTTPS domain at build and runtime. Set `NEAR_CONTRACT_ID` and `NEAR_RECEIPT_SIGNER_ID` to the deployed contract; install only the restricted receipt secret through the host's secret manager. Set `OPERATOR_ACCOUNT_IDS=solrishu.testnet` for the real owner; the generated operator is test-only.

Repeat authenticated deposit/inference/receipt verification against the public HTTPS origin and managed PostgreSQL before calling production deployment verified. The current local production-bundle checks do not establish that a public deployment or managed PostgreSQL service exists. Mainnet, automatic top-ups, shared multi-replica rate limiting/event fan-out and automatic onchain provider payments remain outside this change.

Primary references: [NEAR transaction finality](https://docs.near.org/api/rpc/transactions), [NEAR contract events](https://docs.near.org/smart-contracts/anatomy/events), [official testnet faucet account creation](https://github.com/near/near-contract-helper#readme), [Railway health checks](https://docs.railway.com/deployments/healthchecks).
