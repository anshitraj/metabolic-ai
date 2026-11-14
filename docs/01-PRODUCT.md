# 01 — Product

## 1. What Metabolic AI is

A paid AI inference service that runs itself as a business.

- **It earns.** Customers (people in the web app, developers through the API) prepay credits with NEAR. Each completed request recognises revenue.
- **It spends.** Each request costs real money at an AI provider (Anthropic, DeepSeek, a Llama host, others).
- **It decides.** Before every request, a deterministic policy engine looks at treasury liquidity, margins and provider health, then picks the best model the business can afford.
- **It adapts.** Four operating states — ABUNDANCE, DEFENSIVE, SURVIVAL, RECOVERY — change what the service is allowed to do.
- **It proves.** Deposits are verified on NEAR. Periodic economic receipts (hash of the off-chain ledger for an interval) are committed to a NEAR contract and can be verified by anyone.
- **It shows.** A 3D organism on the dashboard breathes, contracts, and circulates particles according to real events.

The idea in one line: **an AI service whose intelligence is regulated by its own economics.**

## 2. Who uses it

| Persona | Goal | Primary surface |
|---|---|---|
| **Customer** (individual) | Ask questions, get good answers, pay only for what they use | AI Workspace, Treasury (deposit) |
| **Developer** | Call a cost-aware model router through one API key | Developer API |
| **Operator** (us) | Set policy thresholds, watch health, pause in emergencies | Command Center, Settings |
| **Judge / visitor** | Understand the concept in 90 seconds and stress it | Landing, Stress Lab, Demo mode |

## 3. The economic loop

```
 customer deposits NEAR ──► verified on chain ──► prepaid credits (a liability, not revenue)
                                                        │
 customer sends a request ──► price estimate per candidate model
                                                        │
                       policy engine: state + margin + liquidity + health
                                                        │
                          route to best affordable model ──► provider
                                                        │
             actual tokens ──► final charge (credits → recognised revenue)
                            ──► provider cost (expense)
                                                        │
                    snapshot ──► state machine ──► events ──► organism + dashboard
                                                        │
                    every interval ──► receipt hash ──► NEAR contract
```

## 4. Operating states

| State | Typical trigger | Behaviour | Organism |
|---|---|---|---|
| **ABUNDANCE** | Reserve healthy, rolling margin ≥ 30% | Premium tier allowed when it clears margin | Green/mint, full core, rich filaments, steady orbits |
| **DEFENSIVE** | Rolling margin < 20%, costs rising, reserve falling | Prefer economy tier, disable high-cost features | Amber, compact core, slower orbits, thinner network |
| **SURVIVAL** | Liquidity below hard reserve, or negative unit economics | Block unprofitable inference, strict per-request cap, clear "funding required" responses | Red, small dim core, heartbeat pulse, orbits partly collapsed |
| **RECOVERY** | Funding restored or margin recovered, not yet stable | Restore capacity in steps, watch for relapse | Blue → green, core expanding, connections rebuilding |

Exact thresholds and transition rules: [04-ECONOMIC-POLICY.md](04-ECONOMIC-POLICY.md).

## 5. Product areas

1. **Landing** — "An AI That Pays to Stay Alive." Organism hero, the loop explained, architecture, NEAR section, real-vs-demo clarity.
2. **Command Center** — metrics, the organism, intelligence panel, analytics.
3. **AI Workspace** — streaming chat (evolved from Algebra's agent chat) with per-request model, cost and reason.
4. **Treasury** — NEAR balance, deposits, credit liabilities, revenue, expenses, runway, transactions.
5. **Model Intelligence** — catalog, prices, latency, availability, routing flow, switch timeline.
6. **Economic Decisions** — append-only log of every routing and state decision.
7. **Stress Lab** — isolated simulator with sliders and buttons; drives the organism.
8. **Developer API** — keys, usage, examples, errors.
9. **Receipts / Verify** — receipt list and a public verify page (evolved from Algebra's `/verify`).
10. **Settings** — policy config (operator), profile, wallet, reduced effects.

Screen-level detail: [06-SCREENS-AND-STRUCTURE.md](06-SCREENS-AND-STRUCTURE.md).

## 6. Honesty rules (non-negotiable)

These are product requirements, not style preferences.

1. **Real vs simulated.** Every simulated number, chart series and event carries a `SIMULATED` chip and a hatched or dashed visual treatment. The Stress Lab never writes to the real ledger.
2. **Estimated vs actual.** Before a request finishes, costs show as `est.`. After, they show as actual only if the provider returned usage; otherwise `est. (provider did not report usage)`.
3. **Deposits are not revenue.** Prepaid credits are a liability until consumed.
4. **On-chain proves what it proves.** NEAR proves deposits and receipt commitments. It does not prove an AI provider was paid; that is shown from provider usage records and reconciliation.
5. **No fabricated social proof.** No testimonials, no "trusted by" logo wall. Integrations are listed under "Built with" only if actually wired.
6. **No hidden reasoning.** We show routing explanations from our policy engine. We never surface provider chain-of-thought.
7. **No invented exchange rates.** If the NEAR/USD snapshot is stale, conversions show "rate unavailable", not a guess.

## 7. Out of scope for MVP

Staking, borrowing, yield, autonomous treasury investment, mainnet launch, multi-org billing. These may appear on the roadmap page as "future", never as working features.

## 8. Success criteria (judge's view)

Within 90 seconds a judge sees: a real AI answer with its real cost, a simulated cost spike causing a visible model switch with a written reason, a simulated treasury crash putting the organism into survival, recovery after funding, and a real NEAR testnet receipt they can open in an explorer.
