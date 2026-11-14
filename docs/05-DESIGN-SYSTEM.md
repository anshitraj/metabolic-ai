# 05 — Design system: "Living Ledger"

## 1. Direction

Two materials, one product:

- **Paper** — the light, editorial, text-first surface for reading and deciding. Warm off-white, ink-black type, a serif display face, one green accent. Plain and direct the way the best startup sites are: big clear sentence, short supporting line, one primary button, lots of air. Reference mood: the PayZoll pages we looked at (serif headline left / image card right, stat row with hairline dividers, feature cards with one illustration each, a dark proof card), recoloured from gold to green and rebuilt with our own layouts.
- **Stage** — the dark, deep-green-black "petri dish" where the organism lives, plus dark proof cards (receipts, transactions). Light only appears here as emitted light.

Rule of thumb: **Paper for information, Stage for life.** Gradients and glow are allowed only on Stage.

Green is our identity colour. It is our own palette, not NEAR's brand kit; we use NEAR's name and logo only where we factually say "built on NEAR", following their brand guidelines.

## 2. Colour tokens

### Paper (default, light)

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F5F4EE` | Page background |
| `--paper-sunken` | `#ECEBE3` | Wells, table headers, inputs |
| `--surface` | `#FFFFFF` | Cards |
| `--ink` | `#0E1410` | Primary text, primary dark buttons |
| `--ink-2` | `#3D463F` | Secondary text |
| `--muted` | `#6E776F` | Labels, captions |
| `--line` | `#E1E0D7` | Hairlines, card borders |
| `--line-strong` | `#CBCAC0` | Input borders, dividers that must be seen |

### Green ramp (brand)

| Token | Hex | Use |
|---|---|---|
| `--g-900` | `#06301F` | Text on mint fills |
| `--g-700` | `#0A6B44` | Links, primary button on paper, positive numbers (≥ 4.5:1 on paper) |
| `--g-500` | `#12B36E` | Icons, chart lines, focus ring |
| `--g-400` | `#2BD98A` | Accent on Stage, live dot, abundance glow |
| `--g-200` | `#A9F0CC` | Highlights, selected rows on Stage |
| `--g-50` | `#E6F6EC` | Tinted chips, badge backgrounds |

### Stage (dark)

| Token | Hex | Use |
|---|---|---|
| `--stage` | `#070B09` | Organism canvas, dark cards |
| `--stage-2` | `#0D1410` | Elevated dark surface |
| `--stage-line` | `rgba(232,241,235,0.08)` | Dark hairlines |
| `--stage-ink` | `#E8F1EB` | Text on Stage |
| `--stage-muted` | `#8C9A90` | Secondary text on Stage |

### Operating states

| State | On Stage (glow, particles) | On Paper (text/chip) | Chip bg |
|---|---|---|---|
| ABUNDANCE | `#2BD98A` | `#0A6B44` | `#E6F6EC` |
| DEFENSIVE | `#F2A93B` | `#8A5A0B` | `#FBF0DC` |
| SURVIVAL | `#F0525E` | `#A8232F` | `#FBE5E7` |
| RECOVERY | `#6C8CFF` | `#3247B8` | `#E7ECFF` |

State is never colour-only: chips always carry the state word and an icon (leaf, shield, heartbeat, sunrise).

### Simulated data

`--sim` = `#7A5AF8` (violet, deliberately outside the brand and state palettes). Simulated chart series use a dashed stroke; simulated cards get a 1px dashed violet border and a `SIMULATED` chip. This must be unmistakable at a glance.

### Dark mode

The app shell offers dark mode by swapping Paper tokens to Stage values (`--paper → #0B100D`, `--surface → #111814`, `--ink → #E8F1EB`, `--line → rgba(232,241,235,.09)`, `--g-700 → #2BD98A` for text). Landing stays light by design.

## 3. Typography

| Role | Family | Notes |
|---|---|---|
| Display | **Newsreader** (Google, variable, opsz) | Headlines, big numbers on landing. Weight 400–500, tight tracking. |
| UI | **Geist** | Everything else. 400 / 500 / 600. |
| Data | **Geist Mono** | Amounts, model ids, hashes, timestamps. `font-variant-numeric: tabular-nums`. |

Scale (desktop / mobile):

| Token | Size / line | Family |
|---|---|---|
| `display-xl` | 72/72 → 44/46, −0.02em | Newsreader |
| `display-l` | 52/56 → 36/40 | Newsreader |
| `h1` | 36/42 → 28/34 | Newsreader |
| `h2` | 26/32 → 22/28 | Geist 600 |
| `h3` | 18/26 | Geist 600 |
| `body-l` | 18/30 | Geist 400 |
| `body` | 15/24 | Geist 400 |
| `small` | 13/20 | Geist 400 |
| `label` | 11/16, uppercase, 0.14em, 600 | Geist |
| `metric-xl` | 40/44 | Geist Mono 500 |
| `metric` | 22/28 | Geist Mono 500 |
| `mono` | 13/20 | Geist Mono |

Eyebrows (like "OUR SOLUTION") use `label` in `--g-700`.

## 4. Space, shape, elevation

- Base unit 4px. Common steps: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- Content width: 1200px landing, fluid console with 24px gutters (16px mobile).
- Radius: `4` tags · `8` inputs/buttons · `12` cards · `20` feature panels · `28` Stage panels · `999` pills.
- Borders before shadows. One shadow token for floating things only: `0 1px 2px rgba(14,20,16,.06), 0 8px 24px rgba(14,20,16,.06)`.
- Grain: 3% noise overlay on Paper hero and Stage, as a single tiled PNG (≤ 8 KB).

## 5. Components (inventory)

**Primitives** (Radix-based, styled with tokens): Button (primary-ink, primary-green, secondary, ghost, danger; sizes sm/md/lg), IconButton, Input, NumberInput with unit, Select, Slider (thick track, value bubble in mono), Switch, Tabs (underline), SegmentedControl, Tooltip, Popover, Dialog, Sheet (mobile nav), Toast, Skeleton, Badge, Kbd.

**Product components**

| Component | Description |
|---|---|
| `StateChip` | Icon + state word, state colours; `size=sm|lg` |
| `SimChip` | Violet `SIMULATED` chip |
| `EstChip` | `est.` marker next to amounts |
| `Metric` | label, value (`metric`), delta, sparkline, optional chip; animated counter |
| `MetricRow` | 6 metrics with hairline separators (PayZoll stat-row pattern) |
| `Money` | Formats micro-USD / yocto bigint; never floats |
| `Hash` | Truncated mono hash, copy, explorer link |
| `TxStatus` | pending → submitted → finalized / failed stepper |
| `DecisionCard` | prev → new state, trigger, model, savings, policy version, receipt |
| `DecisionFeed` | Live list with enter animation |
| `ModelNode` | Provider logo, model id, tier, price, health dot |
| `RouteFlow` | SVG: request → candidates → chosen, animated stroke |
| `TreasuryBreakdown` | Stacked bar: treasury → liabilities → payables → reserve → spendable |
| `RunwayGauge` | Horizontal gauge with reserve marker |
| `StressControl` | Big labelled button + severity slider + preview of effect |
| `ReceiptCard` | Dark Stage card: id, hash, status, explorer, verify |
| `CostFooter` | Under each AI message: model, tokens, cost, charge, margin, reason |
| `Organism` | See §7 |
| `OrganismFallback` | 2D SVG/CSS version |

**Charts**: hand-built SVG (as Algebra already does) for sparklines, area (treasury), dual line (revenue vs cost), timeline (state bands + switch markers). Read the `dataviz` guidance before building. No chart library unless time forces it.

## 6. Motion

Library: Motion for React. Tokens:

| Token | Duration | Easing |
|---|---|---|
| `micro` | 160 ms | `[0.2, 0, 0, 1]` |
| `card` | 280 ms | `[0.2, 0, 0, 1]` |
| `page` | 420 ms | `[0.16, 1, 0.3, 1]` |
| `state` | 900 ms | `[0.65, 0, 0.35, 1]` |
| `organism` | 1600 ms | custom spring in shader uniforms |
| `spring-ui` | — | `{ stiffness: 420, damping: 32 }` |

Choreography: page sections stagger 40 ms; metric counters tween over `card`; decision feed inserts slide 8px + fade; state change = chip cross-fade + one-time banner + organism transition. Nothing loops on Paper except the live dot. `prefers-reduced-motion`: no counters tweening, no stagger, organism falls to slow breathing only, transitions become fades.

## 7. The organism (3D spec)

Built with React Three Fiber + Drei + postprocessing (Bloom only, `luminanceThreshold` high so only emissive parts glow). Lazy-loaded, client-only, inside a Stage panel.

### Layers

1. **Core** — icosahedron (detail 6) with vertex shader: 3D simplex noise displacement (`amp`, `freq`, `speed`), fresnel rim emission in state colour, inner gradient. Breathing = `scale = base × (1 + 0.025 sin(t·rate))`.
2. **Neural filaments** — 24–96 Catmull-Rom curves from core surface outward, as `Line2`/tube instances. A uniform-driven dash offset moves "pulses" along them on inference.
3. **Economic particles** — one `InstancedMesh` (≤ 3000 instances), pooled. Streams: inbound (revenue/deposit, `--g-400`), outbound (expense, amber), receipt (white flash up-and-out), recovery (blue swirl). Particle spawn is driven by events from the live store.
4. **Orbital rings** — 3 tori (thin), each meaning something: inner = model tier (radius/thickness per tier), middle = liquidity (arc length = coverage), outer = activity (speed = req/min). Nodes on rings: model nodes (inner), treasury node (middle), event markers (outer) — all clickable.
5. **Atmosphere** — 1500 point dust with depth fade, radial vignette, faint grid floor fading out, grain.

### State parameters

| Param | ABUNDANCE | DEFENSIVE | SURVIVAL | RECOVERY |
|---|---|---|---|---|
| core scale | 1.0 | 0.82 | 0.55 | 0.55 → 1.0 |
| noise amp | 0.12 | 0.07 | 0.03 | 0.05 → 0.12 |
| breath rate (Hz) | 0.25 | 0.2 | 0.9 double-beat | 0.3 |
| emissive | 1.0 | 0.7 | 0.35 | 0.5 → 1.0 |
| colour | `#2BD98A` | `#F2A93B` | `#F0525E` | `#6C8CFF` → `#2BD98A` |
| filaments | 96 | 48 | 12 | 12 → 96 regrow |
| ring speed | 1.0 | 0.6 | 0.15 | 0.3 → 1.0 |
| ring integrity | full | full | outer ring broken into arcs | arcs closing |
| particle rate | 1.0 | 0.6 | 0.1 | 0.6 |
| bloom | 0.9 | 0.6 | 0.4 | 0.7 |

All params tween over `state` / `organism` durations; nothing snaps.

### Event animations

| Event | Animation |
|---|---|
| deposit confirmed | Inbound green stream (≈ 200 particles) into treasury node, core +4% swell, counter ticks |
| inference started | Filaments light from active model node, ring speed ×1.4 |
| inference completed | Outbound amber burst sized by cost, settle |
| model switched | Inner ring morphs (radius/thickness), core contracts 8% then releases, new model node lights, explanation toast |
| survival | Core shrinks, colour drains to red, outer ring fractures, particles stall, red banner |
| recovery | Blue swirl in, filaments regrow from base, rings re-close |
| receipt finalized | White ring pulse travels outward + small upward flare from outer ring |

### Interaction

OrbitControls with limits (polar 60–120°, no zoom past 0.8–1.4, no pan); mouse parallax ±3°; hover highlights nodes (Drei `Html` label); click model node → Model drawer, treasury node → Treasury drawer, event marker → Decision drawer; "Reset view" button; "Reduce effects" toggle (no bloom, 30% particles, DPR 1).

### Performance

DPR clamp `[1, 1.75]`; `PerformanceMonitor` drops to low tier (no bloom, half particles) under 45 fps; `frameloop="demand"` when tab hidden or panel off-screen; geometries/materials memoised and disposed; no allocations in `useFrame`. Budget: < 2 ms JS per frame, < 150 KB gz for the 3D chunk excluding three.

### Fallback

No WebGL or reduced effects forced → `OrganismFallback`: SVG core circle with CSS breathing, three SVG rings, state colours, same click targets. The dashboard is fully usable with the canvas absent.

## 8. Voice

Short, plain, honest. Say what the machine did and why, in one sentence. Numbers before adjectives. Examples:

- "Switched to Economy. Premium would have run at 12% margin."
- "Survival mode. Spendable funds are $0.00 after the $5.00 reserve."
- "Deposit confirmed on NEAR testnet. 2.00 NEAR → $6.84 credit."

Avoid: "revolutionary", "seamless", exclamation marks, and any claim we can't show.

## 9. Accessibility

Text ≥ 4.5:1 (state text colours chosen to pass on paper); focus ring 2px `--g-500` + 2px offset; every canvas interaction has a DOM equivalent (drawers reachable from the intelligence panel); live regions announce state changes politely; all controls keyboard-operable; `prefers-reduced-motion` respected.
