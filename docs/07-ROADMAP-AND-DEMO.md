# 07 — Roadmap and demo

## 1. Milestones

Order matters: the real economic loop comes before visual polish.

| # | Milestone | Done when |
|---|---|---|
| M0 | **Docs + design board** (this folder) | Owner signs off on direction, palette, structure, backend decision |
| M1 | **Foundation** | New tokens + fonts in `globals.css`; app shell, sidebar, top bar, routes stubbed with real empty states; Postgres + Drizzle schema + migrations; NEP-413 wallet sign-in; old routes redirected |
| M2 | **Real economic loop** | Gateway adapters (Anthropic, DeepSeek, OpenAI-compatible Llama) with usage; model registry + prices file; billing reserve/finalize; policy + router (pure, tested); decisions persisted; Workspace streams with CostFooter |
| M3 | **NEAR** | Contract built, tested, deployed to testnet; wallet selector deposit; server finality verification; ledger crediting exactly once; Treasury page live; receipts worker + `/verify` |
| M4 | **Organism + dashboard** | R3F organism with 4 states and event animations; SSE pipeline; Command Center with charts, feed, receipts; fallback 2D |
| M5 | **Stress Lab + demo** | Scenario engine reusing policy/router; controls; `/demo` 90-second mode; isolation test green |
| M6 | **Landing + polish** | Landing per doc 06; responsive pass; a11y pass; perf budget; Playwright E2E; Docker + worker; README/runbook |

## 2. First implementation slice (M1, concrete)

1. `app/globals.css`: replace Algebra tokens with Living Ledger tokens (doc 05 §2); keep `@theme inline` mapping so Tailwind utilities like `bg-paper`, `text-ink`, `text-g-700` work.
2. `app/layout.tsx`: Newsreader + Geist + Geist Mono via `next/font/google`; metadata → Metabolic AI.
3. `components/ui/*`: Button, Badge, StateChip, SimChip, Metric, Money, Hash, Skeleton.
4. `components/shell/*`: TopBar, Sidebar, MiniOrganism (2D), banners.
5. Route skeletons under `app/console/*` per doc 06 §1 with empty/loading states — no fake numbers.
6. `next.config.ts` redirects from Algebra routes.

## 3. The 90-second judge demo

Setup before judging: testnet contract deployed, treasury funded, at least one provider key configured, one receipt already finalized (as fallback proof), a fresh browser profile with a funded testnet wallet.

| Time | Chapter | What happens | Real or sim |
|---|---|---|---|
| 0–15 s | **Meet it** | Command Center. Organism in ABUNDANCE. One sentence: "This AI pays its own bills." Point at treasury, margin, runway. | Real |
| 15–30 s | **It thinks, it pays** | Ask a question in Workspace. Stream answer. CostFooter shows model, tokens, cost, charge, margin, reason. Organism: filaments light, amber burst. | **Real** |
| 30–45 s | **Costs spike** | Stress Lab → Spike ×4. Margin compresses, state → DEFENSIVE, inner ring morphs, toast "Switched to Economy — premium would run at 12% margin." | Simulated |
| 45–60 s | **Money runs out** | Drain treasury. State → SURVIVAL. Core collapses red, outer ring fractures, banner, premium disabled. Try a request: clear refusal with reason. | Simulated |
| 60–75 s | **It recovers** | Restore funding. RECOVERY: blue swirl, filaments regrow; after dwell, back toward ABUNDANCE. | Simulated |
| 75–90 s | **Proof** | Publish receipt (or open the pre-finalized one). TxStatus → Finalized, open NearBlocks, `/verify` shows ✓ Match. | **Real** |

Fallbacks: no provider key → Workspace shows the configuration boundary honestly and the demo skips to chapter 3; RPC slow → use the already finalized receipt, labelled with its date.

## 4. Acceptance checklist (from the brief)

Status 2026-11-14: M0–M6 implemented. Verified locally: typecheck, lint, 34 app tests, 8 contract tests, wasm build, production build, live Gemini call, Stress Lab state cycle in the browser. Needs your accounts to verify end to end: wallet sign-in, a real testnet deposit, and on-chain receipts (requires deploying the contract).


- [x] Algebra transformed; old routes redirect; no Spend Pass remnants in UI
- [x] Responsive (checked at 375 and 1440 wide; no horizontal scroll)
- [x] Organism renders, 4 states, event animations, fallback
- [x] Real inference with ≥ 1 configured provider; usage recorded (live Gemini call verified; full UI path needs a funded wallet)
- [x] Routing follows policy; decisions persisted and explained
- [x] Credits charged safely (concurrency test)
- [ ] Wallet connect; testnet deposit verified before credit; duplicate tx rejected — implemented and covered by mocked-RPC tests; needs a real testnet deposit to verify
- [x] Treasury values reconciled and labelled by kind
- [ ] Receipts committed and verifiable — implemented, contract tested; needs the contract deployed to testnet
- [x] Stress Lab isolated (test proves real ledger unchanged)
- [ ] 90-second demo runs start to finish — simulated chapters verified; real chapters need a funded wallet and the contract
- [x] Loading / empty / error / disconnected / degraded states
- [x] `pnpm lint`, `tsc`, `vitest` pass; `pnpm build` succeeds (no Playwright E2E suite yet — follow-up)
- [x] `.env.example`, setup, contract deploy, and demo runbook documented

## 5. Open decisions for the owner

1. ~~**Backend:**~~ **Decided:** inside this Next app (`server/` + `app/api/**` + `worker/`).
2. **Auth:** NEAR wallet only (recommended), or keep email code as well?
3. **Providers for the demo:** which keys are available — Anthropic, DeepSeek, a Llama host?
4. **Hosting:** where Postgres and the worker run (e.g. Railway/Render/Fly + Neon/Supabase).
5. **Contract account:** the testnet account name to deploy `metabolic` under.
