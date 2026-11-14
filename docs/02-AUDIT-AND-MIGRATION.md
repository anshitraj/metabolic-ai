# 02 — Audit of Algebra and migration plan

Audit date: 2026-11-14. Scope: `D:\near-project` as checked out.

## 1. What exists

| Area | Finding |
|---|---|
| Repository | Only `frontend/` is present. Its README and `next.config.ts` refer to a separate `../backend` (Algebra REST API on `:8080`, network names like `internal/domain/chain`). **That backend is not in this checkout.** |
| Framework | Next.js 16.4 (App Router, with breaking changes vs older Next — read `node_modules/next/dist/docs/` before coding, per `AGENTS.md`), React 19.2, TypeScript 5, pnpm 10. |
| Styling | Tailwind CSS 4 (`@theme inline` tokens in `app/globals.css`), plus `app/algebra.css`, `app/agent-workspace.css`, and ~20 CSS modules. Warm-paper editorial palette, Manrope + Instrument Serif + IBM Plex Mono. |
| Motion | `motion` 13 with a `MotionProvider` that respects reduced motion. IntersectionObserver reveals. |
| 3D | None. One shader file (`components/ui/glassbound-shaders.ts`) for a 2D glass effect. |
| Auth | Emailed-code sign-in (`components/auth/*`, `lib/session.tsx`), session cookie issued by the absent backend and proxied first-party. |
| AI | **Strong reuse.** `lib/agent/` runs Anthropic, OpenAI and Gemini server-side with a provider interface (`providers/types.ts`), model catalog from env (`models.ts`), auto-model selection, chat store, streaming events, tool execution. `app/api/agent/chat` and `app/api/agent/providers` route handlers. |
| Wallet / chain | `lib/wallet/*`: local keystore, Solana and EVM (Base, Arc) USDC vault, permits, withdrawals. **No NEAR.** |
| Console | `/console` shell with sidebar: Agent chat, Overview, Providers, Provider intelligence, Routing, Executions, Spend Passes (firewall), Vault, Quickstart, Projects & API keys, Connect an agent, Settings. Native SVG charts, notification bell, network switch (testnet/mainnet). |
| Receipts | `/verify` with `verify-receipt.tsx` — public receipt verification page. |
| Demo | `/demo` with illustrative data, clearly labelled. Good precedent for the Stress Lab. |
| Database / ORM | None in the frontend. |
| Tests | None found (only a `smoke` script entry; `scripts/` folder missing). |
| Deploy | Dockerfile (Next standalone, Node 22, non-root). |

## 2. Decision: where the Metabolic backend lives

The Algebra backend is not available here, and the Metabolic domain (treasury, ledger, policy, receipts) is new anyway.

**Decided (2026-11-14):** build the Metabolic backend as TypeScript inside the same Next app, behind clean module boundaries, plus one worker process.

- `server/` — domain modules (policy, router, billing, ledger, treasury, receipts, simulation, events). Pure TypeScript, no React, unit-testable.
- `app/api/**/route.ts` — thin HTTP adapters over `server/`.
- `worker/` — separate Node entry (`pnpm worker`) for deposit reconciliation, receipt batching, health checks.
- PostgreSQL + Drizzle ORM.
- The existing `/api/v1/*` rewrite to the Algebra backend is removed once Metabolic owns `/api/v1/*`.

Why: one deploy, one language, the agent code already lives here, and nothing has to be invented to replace the missing backend. If the Algebra backend is later restored, it can still be proxied under a different prefix.

**Open question for the owner:** is the original Algebra backend (sessions, email codes) recoverable? If not, auth moves to NEAR wallet sign-in (NEP-413 signed message) plus optional email — see §4.

## 3. Feature mapping

| Algebra today | Metabolic AI | Action |
|---|---|---|
| Landing (`components/landing/*`, `hero.tsx`, etc.) | Landing with organism hero | **Replace.** Keep `reveal.tsx`, `container.tsx`, `motion-provider.tsx`. |
| `/console` Overview + `overview-charts.tsx` | Command Center | **Rebuild layout**, reuse SVG chart approach where it fits (charts get restyled). |
| `/console/agent` + `components/console/agent/*` + `lib/agent/*` | AI Workspace | **Reuse core.** Keep provider adapters, streaming, chat store, rich text. Remove Algebra payment tools (Spend Pass, x402, approval cards). Add cost/route footer per message. |
| `lib/agent/providers/*` | Inference gateway adapters | **Reuse and extend.** Add usage reporting, pricing metadata, health check, error classes. Add DeepSeek (OpenAI-compatible) and a Llama host (OpenAI-compatible). |
| `lib/agent/auto-model.ts` | Model router | **Replace** with policy-driven router in `server/router`. |
| `/console/providers`, `/console/intelligence`, `/console/routing` | Model Intelligence | **Merge** into one page. |
| `/console/executions` | Economic Decisions | **Replace** contents; keep table/filter patterns. |
| `/console/vault` + `lib/wallet/*` | Treasury | **Replace** chain layer with NEAR. Keep `toMinor`/`fromMinor` helpers (generalise decimals to 24). |
| `/console/firewall` (Spend Passes) | — | **Remove.** Not part of Metabolic. Safety limits move to policy config. |
| `/console/projects`, `/console/connect`, `/console/quickstart` | Developer API | **Merge** into one page. |
| `/console/settings` | Settings | **Keep**, add policy config and reduced effects. |
| `/verify` | Receipt verification | **Reuse route**, new data source (NEAR contract). |
| `/demo` | Guided 90-second demo | **Replace** contents with Stress Lab presentation mode. |
| `components/console/network-switch.tsx`, `lib/network.tsx` | NEAR testnet/mainnet indicator | **Reuse pattern**, mainnet disabled in MVP. |
| `components/console/notification-bell.tsx`, `lib/notifications.tsx` | Notifications fed by SSE | **Reuse.** |
| `(auth)` pages | Sign-in | **Keep or replace** depending on backend answer above. |
| `(legal)`, `robots.ts`, `sitemap.ts`, `security.txt` | Same | **Keep**, rebrand strings. |
| `Dockerfile` | Same + worker target | **Extend.** |

## 4. Auth plan

- Primary: NEAR wallet sign-in. Server issues a nonce, wallet signs a NEP-413 message, server verifies the signature against the account's full-access or function-call public key via RPC, then sets an httpOnly session cookie.
- Secondary (optional): existing email code if the backend is restored.
- Roles: `customer`, `developer` (same user, has keys), `operator` (policy config, pause).

## 5. Dependencies to add

| Package | Why |
|---|---|
| `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` | Organism |
| `zustand` | Client UI + live event state |
| `@tanstack/react-query` | Server state, snapshot sync after SSE reconnect |
| `drizzle-orm`, `drizzle-kit`, `postgres` | Database |
| `zod` | Input validation on every route |
| `@near-wallet-selector/core`, `@near-wallet-selector/modal-ui`, wallet modules (MyNearWallet, Meteor, HOT) | Wallet connect |
| `near-api-js` (or `@near-js/*`) | RPC: tx status, view calls, signature verification |
| `vitest`, `@playwright/test` | Tests |
| `geist` fonts via `next/font/google` (`Geist`, `Geist_Mono`), `Newsreader` | Type |

Not adding Redis/BullMQ for MVP: the worker uses Postgres `SELECT … FOR UPDATE SKIP LOCKED` job rows. Add Redis only if SSE fan-out across multiple instances is needed.

## 6. Removal list (after Metabolic equivalents ship)

`lib/wallet/{evm-tx,solana-tx,permit,allowance,withdraw}.ts`, `lib/paysh.ts`, `lib/pass-rules.ts`, `lib/policy-check.ts` (Algebra spend policy), `components/console/{pass-create,spend-pass-credential,pass-tasks,trust-badges}.tsx`, `components/chain-logos.tsx`, Spend Pass agent cards. Delete only after the replacing page works; keep in git history.
