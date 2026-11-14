# Metabolic AI — documentation

**Intelligence that earns. Adapts. Survives.**

An AI business with a treasury, a metabolism, and an instinct for economic survival. Metabolic AI sells AI inference, records offchain provider expenses, keeps its funds in a NEAR treasury, and changes which models it uses according to its financial health. Provider credentials are operator-funded; automatic onchain provider payment is not implemented.

This folder is the source of truth for the build. Read in order.

| # | Document | What it settles |
|---|---|---|
| 01 | [Product](01-PRODUCT.md) | What we build, for whom, the economic loop, the four operating states, honesty rules |
| 02 | [Audit and migration](02-AUDIT-AND-MIGRATION.md) | What exists in Algebra today, what is reused, renamed, replaced, or deleted |
| 03 | [Architecture](03-ARCHITECTURE.md) | Modules, data flow, database, API, event stream, NEAR contract |
| 04 | [Economic policy](04-ECONOMIC-POLICY.md) | The deterministic brain: formulas, thresholds, state machine, hysteresis, safety limits |
| 05 | [Design system](05-DESIGN-SYSTEM.md) | Color, type, spacing, motion, components, the 3D organism spec |
| 06 | [Screens and structure](06-SCREENS-AND-STRUCTURE.md) | Routes, page-by-page layout, wireframes, component tree, states |
| 07 | [Roadmap and demo](07-ROADMAP-AND-DEMO.md) | Milestones, acceptance checks, the 90-second judge demo |
| 08 | [Runbook](08-RUNBOOK.md) | Deploy, operate, and run the demo; what is real vs simulated |
| 09 | [Spend Passes](09-SPEND-PASSES.md) | Agent credentials, enforced budgets, model restrictions, accounting and recovery |
| 10 | [Deployment verification](10-DEPLOYMENT-VERIFICATION.md) | Observed testnet transactions, reproduction commands, production preparation and remaining limits |
| 11 | [Railway and Supabase](11-RAILWAY-SUPABASE.md) | Prepared hosting configuration and server-only database access |
| 12 | [Landing and mobile](12-LANDING-AND-MOBILE.md) | Interactive walkthroughs, responsive navigation, accessible controls and UI verification |
| 13 | [Motion and social video](13-MOTION-AND-SOCIAL-VIDEO.md) | Bold word art, dashboard polish, Konva/Three.js motion and editable Remotion social exports |

Visual reference: [design/design-board.html](design/design-board.html) — palette, type, organism states and the two main layouts, rendered.

## One-paragraph pitch

Every AI product has a cost per request and a price per request. Usually a human watches the gap. Metabolic AI watches it itself. Customers prepay in NEAR; each request is priced before it runs; a deterministic policy engine picks the best model the business can afford right now; actual token usage is billed after; and every state change is logged, explained, and periodically committed to NEAR as a verifiable receipt. When costs spike it downgrades. When the treasury runs dry it protects itself. When funding returns it recovers. A 3D organism on the dashboard is the live picture of that metabolism.

## Ground rules (apply to every document)

1. Real and simulated are never mixed. Simulated values always carry a visible `SIMULATED` label and live in a separate scenario scope.
2. No fake hashes, fake balances, fake AI responses, fake reviews or fake partner logos.
3. Money is integers. USD in micro-dollars (`1 = $0.000001`), NEAR in yoctoNEAR. Never JS floats in the ledger.
4. The policy engine is deterministic code, not an LLM.
5. Estimated is never shown as actual.
