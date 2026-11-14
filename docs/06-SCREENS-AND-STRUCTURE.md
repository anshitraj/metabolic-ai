# 06 — Screens and structure

## 1. Route map

```
/                         Landing (public, Paper)
/verify[?id=]             Receipt verification (public)
/demo                     Guided 90-second presentation (public, runs a simulation scope)
/login                    NEAR wallet sign-in
/console                  Command Center (Overview)
/console/workspace        AI Workspace
/console/treasury         Treasury
/console/models           Model Intelligence
/console/decisions        Economic Decisions
/console/stress-lab       Stress Lab
/console/developers       Developer API (keys, usage, docs)
/console/receipts         Receipts (list; detail opens drawer)
/console/settings         Settings (profile, wallet, effects, policy for operators)
/terms /privacy /contact  Legal (kept)
```

Old Algebra routes (`/console/agent`, `/vault`, `/routing`, `/providers`, `/intelligence`, `/executions`, `/firewall`, `/projects`, `/connect`, `/quickstart`) redirect to their new homes in `next.config.ts` during migration, then are deleted.

## 2. App shell

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◐ Metabolic   │ TESTNET ●  │ ● Abundance │ health ●●●○ │   🔔   alice.testnet ▾ │  top bar 56px, Paper
├───────────────┼──────────────────────────────────────────────────────────────────┤
│ Overview      │                                                                  │
│ AI Workspace  │                                                                  │
│ Treasury      │                       page content                               │
│ Models        │                                                                  │
│ Decisions     │                                                                  │
│ Stress Lab  ⚗ │                                                                  │
│ Receipts      │                                                                  │
│ Developers    │                                                                  │
│ ───────────── │                                                                  │
│ Settings      │                                                                  │
│ [ mini        │                                                                  │
│   organism ]  │                                                                  │
└───────────────┴──────────────────────────────────────────────────────────────────┘
  sidebar 232px Paper-sunken; collapses to 64px icons; on mobile → bottom sheet nav
```

- Sidebar footer shows a 2D mini organism (fallback component) on every page so state is always visible.
- Top bar: environment pill (TESTNET in green; MAINNET disabled), state chip, provider health dots, notifications (SSE-fed), wallet/account menu.
- A **simulation banner** (violet, dashed bottom border) appears under the top bar whenever the viewer has an active scenario: "Viewing simulated economy — Scenario #a1f3 · Exit".
- A **survival banner** (red) appears in real scope when state = SURVIVAL: "Survival mode — premium inference paused. Deposit NEAR to restore service."

## 3. Landing `/`

Paper, 1200px container. Sections in order:

```
NAV      ◐ Metabolic AI     How it works   Stress Lab   Docs   Verify          [Launch app]
─────────────────────────────────────────────────────────────────────────────────────────
HERO     ┌──────────────── 6 cols ──────────────┐ ┌─────────── 6 cols ─────────────┐
         │ ● LIVE ON NEAR TESTNET  (label, green)│ │                                │
         │                                       │ │   STAGE panel, radius 28       │
         │ An AI that pays                       │ │   3D organism (live state      │
         │ to stay alive.        (display-xl)    │ │   from public /economics/state)│
         │                                       │ │                                │
         │ It earns from every request, pays for │ │   ● Abundance   margin 41%     │
         │ its own models, and changes how it    │ │   overlay chips bottom-left    │
         │ thinks when money gets tight.         │ │                                │
         │                                       │ └────────────────────────────────┘
         │ [ Launch app → ]  [ Watch it adapt ]  │
         │ Real NEAR deposits · Real inference · Simulations clearly labelled        │
         └───────────────────────────────────────┘
STATS    ~ Treasury (live) │ Requests served │ Avg margin │ Receipts on chain
         (real numbers from a public summary endpoint; "—" when unavailable, never fake)
─────────────────────────────────────────────────────────────────────────────────────────
BUILT    BUILT WITH:  NEAR · Anthropic · DeepSeek · (only providers actually configured)
─────────────────────────────────────────────────────────────────────────────────────────
LOOP     HOW IT WORKS (label)  /  "Earn. Spend. Adapt. Survive."  (h1)
         4 cards in a row (2×2 tablet, 1 col mobile), each with a small Stage illustration:
         [Earn — deposits become credits] [Spend — each request priced first]
         [Adapt — policy picks the model] [Survive — protects its reserve]
─────────────────────────────────────────────────────────────────────────────────────────
MARGIN   Left: interactive card (PayZoll slider pattern, green):            Right: copy
         "A REQUEST COSTS"  $0.0124  ───●──── slider (prompt length)       "It does the math
          Premium   ████████  margin 18%  ✕ below floor                     before it thinks."
          Standard  █████     margin 44%  ✓ chosen                          + 3 bullet facts
          Economy   ██        margin 71%
          [ Routed to Standard — premium would run under 30% ]
─────────────────────────────────────────────────────────────────────────────────────────
STATES   Four state tiles in a row, each a mini Stage with the organism in that state
         (pre-rendered loops or the 2D fallback), title + one sentence + what's allowed.
─────────────────────────────────────────────────────────────────────────────────────────
PROOF    Left: copy "Every decision, on the record."                Right: dark ReceiptCard
         Bullets: deposits verified on chain · receipts committed · anyone can verify
         [ Verify a receipt → ]
─────────────────────────────────────────────────────────────────────────────────────────
ARCH     Architecture diagram (SVG, Paper): Wallet → Contract → Treasury → Policy → Router
         → Providers, with the honest note: "NEAR proves deposits and receipts. Provider
         bills are proven by usage records."
─────────────────────────────────────────────────────────────────────────────────────────
STRESS   Dark full-width band (Stage): "Break it on purpose." 3 buttons preview
         [Spike compute] [Drain treasury] [Restore funding] → opens /demo
─────────────────────────────────────────────────────────────────────────────────────────
FAQ      6 questions, accordion. Includes "What is real and what is simulated?"
FOOTER   big Newsreader wordmark "Metabolic", links, testnet notice
```

No testimonials. No partner logo wall.

## 4. Command Center `/console`

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Overview                                      ● Abundance since 14:02 · policy v1   │
├──────────┬──────────┬──────────┬──────────┬──────────┬───────────────────────────────┤
│ Treasury │ Revenue  │ Inference│ Gross    │ Runway   │ State                         │
│ $48.20   │ $12.31   │ spend    │ margin   │ 3d 4h    │ ● ABUNDANCE                   │
│ 14.1 NEAR│ +8% 24h  │ $6.02    │ 51%      │          │ 4.1× reserve                  │
├──────────┴──────────┴──────────┴──────────┴──────────┴───┬───────────────────────────┤
│                                                          │ INTELLIGENCE              │
│                STAGE (radius 28, min-h 560)              │ Model   claude-sonnet-…   │
│                                                          │         Premium · ● ok    │
│                   3D ORGANISM                            │ Why     margin 64% ≥ 30%  │
│                                                          │ Est. request  $0.0081     │
│    ○ model node      ○ treasury node     ◇ event markers │ Last margin   58%         │
│                                                          │ Providers ● ● ○           │
│  ● Abundance  ·  12 req/min  ·  [Reset view] [Effects ◐] │ Last event                │
│                                                          │ inference.completed 2s    │
├──────────────────────────────┬───────────────────────────┴───────────────────────────┤
│ Treasury · 24h (area)        │ Revenue vs compute (dual line)                        │
├──────────────────────────────┼───────────────────────────────────────────────────────┤
│ Model switches (timeline,    │ Decision feed (live)        │ Recent receipts         │
│ state bands + markers)       │                             │ (dark cards, status)    │
└──────────────────────────────┴─────────────────────────────┴─────────────────────────┘
```

Grid: 12 columns. Metrics row = 6 equal cells with hairline separators. Stage = 8 cols, Intelligence = 4 cols. Analytics rows below.

Tablet: metrics 3×2, Stage full width, Intelligence below as 2-col card grid.
Mobile: metrics horizontal scroll-snap chips, Stage 360px tall, intelligence as stacked list, charts full width, feed last.

States: loading = skeleton metrics + Stage shows dim core "Connecting…"; SSE disconnected = top-bar "Reconnecting" pill, numbers keep last snapshot with timestamp; no data yet = empty-state copy with "Make your first request" CTA; rate stale = USD values show "rate unavailable".

## 5. AI Workspace `/console/workspace`

```
┌──────────────┬─────────────────────────────────────────────────┬──────────────────┐
│ Conversations│  ● Abundance · Auto routing ▾ · Credits $4.12   │ THIS REQUEST     │
│ + New        │─────────────────────────────────────────────────│ Est. tier Premium│
│ Today        │  user: …                                        │ Est. cost $0.008 │
│  · Pricing   │                                                 │ You pay  $0.014  │
│  · Contract  │  assistant: … (streaming, rich text)            │ Margin   43%     │
│ Yesterday    │  ┌ model claude-sonnet-… · Premium               │──────────────────│
│  · …         │  │ 812 in / 403 out · cost $0.0071 · paid $0.0128│ SESSION          │
│              │  │ margin 45% · "Premium: margin 45% ≥ 30%"      │ 7 requests $0.06 │
│              │  └ (CostFooter, collapsible)                     │ mini organism    │
│              │─────────────────────────────────────────────────│                  │
│              │  [ Ask anything…                       ] [Send] │                  │
│              │  est. $0.004–0.012 · Enter to send               │                  │
└──────────────┴─────────────────────────────────────────────────┴──────────────────┘
```

- Live estimate under the composer updates as the user types (debounced, server estimate).
- Model-switch toast inline in the thread: "Switched to Economy — costs rose 2.4×."
- Insufficient credits → composer disabled with inline card "You need $0.01 more. [Deposit]".
- Survival → inline red card with the policy reason; economy may still be allowed.
- Provider error → message shows "Partial response — provider timed out. You were charged for 212 tokens."

## 6. Treasury `/console/treasury`

```
Header:  Treasury · contract metabolic.testnet [copy][explorer]          [ Deposit NEAR ]
Row:     TreasuryBreakdown stacked bar
         On-chain 14.10 NEAR ($48.20) ▸ customer credits −$31.00 ▸ payables −$1.10
         ▸ hard reserve −$5.00 ▸ spendable $11.10
Cards:   Your credits (available / reserved) · Revenue recognised · Provider expenses
         (actual vs estimated split) · Runway gauge
Table:   On-chain transactions: time · type · amount · from · status(TxStatus) · hash
Table:   Ledger (operator only): journal · account · Dr · Cr · ref
```

Deposit dialog: amount (NEAR) → shows USD at snapshot rate with timestamp → "Sign in wallet" → stepper: Signing → Submitted (hash) → Verifying finality → Credited. Every step shows real status; failure states explain what to do.

## 7. Model Intelligence `/console/models`

```
Top:   RouteFlow SVG — incoming request ─▸ [Premium] [Standard] [Economy] ─▸ chosen
       (animated strokes on live inference; excluded models greyed with reason tooltip)
Grid:  ModelNode cards — provider logo, model id (mono), tier badge, in/out $/1M,
       est. request cost, p50/p95 latency, availability %, routed share 24h, capability tags
Bottom: Model switch timeline (state bands + switch markers, click → decision drawer)
```

## 8. Economic Decisions `/console/decisions`

Filter bar: state · decision type (route, state change, refusal, failover) · date range · real/sim.
List of `DecisionCard`s (virtualised). Each expands to: metrics at decision time, candidates table (model, est. cost, margin, allowed?, why not), policy version, linked usage request, linked receipt. Export CSV.

## 9. Stress Lab `/console/stress-lab`

```
┌───────────────────────────── SIMULATED ECONOMY · scenario a1f3 ──────────── [Reset] [Exit] ┐
│ ┌───────────── controls (4 cols) ─────────────┐ ┌──────────── Stage (8 cols) ────────────┐ │
│ │ SPIKE COMPUTE COST     ×1 ──●────── ×10     │ │                                        │ │
│ │ [ Apply spike ]                             │ │        organism (sim scope)            │ │
│ │ CUSTOMER DEMAND        −90% ──●── +200%     │ │                                        │ │
│ │ TRAFFIC                0 ──●──── 60 req/min │ │  ● Defensive   SIMULATED               │ │
│ │ DRAIN TREASURY         [ Drain to reserve ] │ └────────────────────────────────────────┘ │
│ │ RESTORE FUNDING        [ +$50 simulated ]   │  Sim metrics row (dashed, violet chips)    │
│ │ PROVIDER FAILURE       ☐ Anthropic ☐ DeepSeek│ Sim decision feed (live)                  │
│ │ ─────────────────────────────────────────── │                                            │
│ │ REAL TESTNET ACTIONS (separate, green)      │                                            │
│ │ [ Deposit testnet NEAR ] [ Publish receipt ]│                                            │
│ └─────────────────────────────────────────────┘                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

The whole frame has a dashed violet border. Real actions sit in a visually separate green box with "This uses real testnet funds" copy.

## 10. Developer API `/console/developers`

Tabs: Keys · Usage · Quickstart · Errors.
Keys: create (name, scopes) → secret shown once in a dark card with copy + "I've saved it"; list shows prefix, created, last used, revoke.
Usage: requests table + cost chart. Quickstart: cURL / JS / Python tabs calling `/api/v1/inference`, response shape including `routing` and `billing` objects. Errors: code table (`FUNDING_REQUIRED`, `INSUFFICIENT_CREDITS`, `RATE_LIMITED`, `NO_CAPABLE_MODEL`, `PROVIDER_UNAVAILABLE`, `POLICY_PAUSED`).

## 11. Receipts `/console/receipts` and `/verify`

List of ReceiptCards with interval, state, revenue/expense/margin, status, tx hash. `/verify` (public): paste id → fetch payload → recompute hash in browser → compare with `get_receipt` view call → ✓ Match / ✕ Mismatch with both hashes shown.

## 12. Demo `/demo` (presentation mode)

Full-screen Stage with a slim Paper caption bar and a 90-second progress rail with 6 chapters (see doc 07). Space = next, ← = back, R = replay. Real steps (inference, receipt) are marked green "REAL"; simulated steps violet "SIMULATED".

## 13. Component tree (key pages)

```
ConsoleLayout
├─ TopBar (EnvPill, StateChip, HealthDots, NotificationBell, AccountMenu)
├─ Sidebar (NavItem×9, MiniOrganism)
├─ SimBanner | SurvivalBanner
└─ <page>

OverviewPage
├─ PageHeader
├─ MetricRow (Metric×6)
├─ Grid
│  ├─ StagePanel → Organism (lazy) | OrganismFallback, StageOverlay, StageToolbar
│  └─ IntelligencePanel (ModelSummary, DecisionReason, CostEstimate, ProviderHealth, LastEvent)
├─ TreasuryAreaChart, RevenueCostChart
└─ Grid (SwitchTimeline, DecisionFeed, ReceiptList)

Shared live data
LiveProvider (SSE → zustand) + QueryClientProvider (snapshots)
```

## 14. Global UI states

| State | Treatment |
|---|---|
| Loading | Skeletons in exact final geometry; Stage shows dim core |
| Empty | One sentence + one action |
| Error | Inline card with what failed, request id, retry |
| Disconnected | Top-bar pill "Reconnecting…", data timestamped |
| Degraded (provider down) | Health dot amber/red + banner on Workspace |
| Wallet not connected | Treasury/deposit actions show "Connect wallet" |
| Paused (operator) | Grey banner, all inference disabled with reason |
