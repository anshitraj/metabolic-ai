# Launch with Railway and Supabase

The repository contains the complete backend in `frontend/server/` and `frontend/app/api/`. The `frontend` folder is a full-stack Next.js application: one Railway service runs its UI, API and inline background worker. Supabase supplies managed PostgreSQL. The deployed NEAR testnet contract remains on NEAR.

## Supabase

1. Create a Supabase project and open **Connect → Session pooler**. Use the PostgreSQL session connection on port **5432**, suitable for this persistent Node server. Copy it to the host's private `DATABASE_URL` variable. Use `sslmode=require` and URL-encode special characters in the database password.
2. Do not use the project HTTPS URL or an anon/service API key as `DATABASE_URL`. This application uses its existing NEAR authentication and direct server-side SQL; it does not need Supabase Auth or browser Supabase credentials.
3. The application runs the checked-in Drizzle migrations on the first database connection. App tables have row-level security enabled with no browser-facing policies: browser/anon access is denied, while the server connects using the database owner's credential and applies the existing owner checks. Do not add public policies for the ledger, sessions, keys or balances.
4. Use the session pooler with the current Postgres.js configuration. The shared transaction pooler on port 6543 requires different prepared-statement and pipelining settings and is not the recommended connection for this deployment.

## Railway

1. Import `anshitraj/metabolic-ai` from GitHub.
2. Set the service **Root Directory** to `/frontend`. If setting the config-file path manually, use `/frontend/railway.toml` (the config path is relative to the repository, not the service root).
3. Let the checked-in Dockerfile build and start the standalone server. Keep **one replica**, `WORKER_INLINE=true`, and health-check path `/api/health`. A separate backend service or worker service is not needed for this first deployment.
4. Generate the Railway HTTPS domain and set `PUBLIC_WEB_URL` to that complete origin. It is used at build time for metadata and at runtime, so redeploy after setting/changing it.
5. Add these private runtime variables:

```dotenv
DATABASE_URL=YOUR_SUPABASE_SESSION_POOLER_POSTGRESQL_CONNECTION
DATABASE_POOL_MAX=5
PUBLIC_WEB_URL=https://YOUR-RAILWAY-DOMAIN
NEAR_NETWORK=testnet
NEAR_RPC_URL=https://rpc.testnet.near.org
NEAR_EXPLORER_URL=https://testnet.nearblocks.io
NEAR_CONTRACT_ID=metabolic-d0e41b6dc5.testnet
NEAR_RECEIPT_SIGNER_ID=metabolic-d0e41b6dc5.testnet
NEAR_RECEIPT_SIGNER_KEY=YOUR_RESTRICTED_RECEIPT_KEY
OPERATOR_ACCOUNT_IDS=solrishu.testnet
GEMINI_API_KEY=YOUR_OPERATOR_FUNDED_GEMINI_KEY
WORKER_INLINE=true
RECEIPT_INTERVAL_MIN=10
```

The receipt secret is held locally in the ignored testnet runtime configuration. Install it through Railway's secret settings; never put that file, database passwords or provider keys in GitHub. Never use a full-access wallet key as the server receipt key.

## Verify the public launch

- `/api/health` must report a ready database.
- Sign in with the owner wallet, then call `/api/admin/readiness` from the same authenticated origin. Check the network, contract, authorized receipt signer and restricted function-call key.
- Supabase starts with a new application ledger. Existing local PGlite balances and history are not automatically transferred. Fund the business and customer credit on the public deployment using fresh deposit intents/transactions; do not re-import locally credited deposits into another ledger.
- Perform a wallet-signed deposit, a live inference through a bound Spend Pass, a tighter-cap model selection, revocation and independent receipt verification on the public URL.
- Publish the actual HTTPS URL only after those checks pass. GitHub publication and a deployed NEAR contract do not by themselves mean that the web application is publicly hosted.

References: [Supabase PostgreSQL connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Railway service root configuration](https://docs.railway.com/deployments/monorepo).
