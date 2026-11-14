# Vercel frontend + Railway backend

The app is one Next.js project. The UI pages are client-side and talk to `/api/*`; the API routes, database and worker run on Railway ([doc 11](11-RAILWAY-SUPABASE.md)). Vercel serves the UI and proxies `/api/*` to Railway, so the browser only ever sees the Vercel origin (same-origin cookies, CSRF check and wallet sign-in unchanged).

## Vercel project

1. Import `anshitraj/metabolic-ai`, set **Root Directory** to `frontend`. Framework: Next.js (auto-detected).
2. Environment variables (Production):

```dotenv
API_ORIGIN=https://YOUR-RAILWAY-DOMAIN
PUBLIC_WEB_URL=https://YOUR-VERCEL-DOMAIN
NEAR_NETWORK=testnet
NEAR_RPC_URL=https://rpc.testnet.near.org
```

`API_ORIGIN` is read when the project builds (it configures the rewrite), so redeploy after changing it. No database URL, provider keys or receipt key belong on Vercel.

3. On Railway set `PUBLIC_WEB_URL` to the **Vercel** origin and redeploy. Cookies, sitemap/robots and the CSRF origin check use the public site.

## Notes

- Agents / programmatic clients (`/api/v1/*`, MCP) should call the Railway domain directly: long streaming inference responses are better off not going through the Vercel proxy.
- The Vercel project also contains the API route code but never runs it: the `beforeFiles` rewrite takes precedence.
- Add the Vercel domain to the wallet's allowed origins if your wallet requires it.
