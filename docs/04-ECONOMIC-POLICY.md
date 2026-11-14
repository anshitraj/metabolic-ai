# 04 — Economic policy (the brain)

Deterministic, versioned, auditable. Lives in `server/policy` and `server/router` as pure functions. No LLM is involved in any spending or state decision.

## 1. Inputs (a snapshot)

| Measure | Definition |
|---|---|
| `treasury_usd` | On-chain treasury NEAR × latest fresh NEAR/USD rate. If rate stale → snapshot marked `rate_stale`, state cannot improve (only hold or worsen). |
| `liabilities` | Customer prepaid credits not yet consumed + reserved amounts. |
| `payables` | Accrued, unreconciled provider costs. |
| `liquidity` | `treasury_usd − liabilities − payables`. Operating money that is really ours. |
| `hard_reserve` | Config. Money we never spend on inference. |
| `spendable` | `max(0, liquidity − hard_reserve)` |
| `reserve_coverage_bp` | `liquidity / hard_reserve × 10000` |
| `revenue_w`, `expense_w` | Recognised revenue and provider cost over rolling window `W` (default 60 min). |
| `rolling_margin_bp` | `(revenue_w − expense_w) / revenue_w × 10000`; undefined if `revenue_w = 0` (treated as neutral, not healthy). |
| `burn_per_h` | `max(0, expense_w − revenue_w)` scaled to 1 h, plus fixed overhead/h. |
| `runway_s` | `spendable / burn_per_h` (∞ shown as "self-sustaining" if burn = 0). |
| `provider_health` | Per provider: ok / degraded / down from health checks + recent error rate. |

## 2. Per-request economics

```
est_cost   = in_tokens/1e6 × cost_in_per_m + est_out_tokens/1e6 × cost_out_per_m + overhead
est_charge = in_tokens/1e6 × sell_in_per_m + est_out_tokens/1e6 × sell_out_per_m
proj_margin_bp = (est_charge − est_cost) / est_charge × 10000
```

- `in_tokens`: counted by the adapter's tokenizer when available, else `ceil(chars / 3.5)` marked estimated.
- `est_out_tokens`: `min(max_tokens, p75 output length for this task class)`.
- After completion: same formula with provider-reported usage → `cost`, `charge`, `margin`. If the provider gave no usage, `cost_is_estimated = true` and the UI says so.
- Sell prices are per tier, so a customer pays less when routed to economy. The customer sees the tier price before sending.

## 3. Default thresholds (policy v1, all configurable)

| Key | Default |
|---|---|
| `W` rolling window | 60 min |
| `hard_reserve` | $1.00 (testnet demo scale; operator can change it in Settings) |
| `abundance.min_margin_bp` | 3000 (30%) |
| `abundance.min_coverage_bp` | 30000 (3× reserve) |
| `defensive.enter_margin_bp` | 2000 (20%) |
| `defensive.enter_coverage_bp` | 15000 (1.5×) |
| `survival.enter_coverage_bp` | 10000 (liquidity ≤ reserve) |
| `survival.enter_margin_bp` | −500 (losing money per request) |
| `recovery.exit_coverage_bp` | 30000 sustained for `recovery.dwell` |
| `min_dwell` (any state) | 120 s |
| `recovery.dwell` | 300 s |
| `hysteresis_bp` | 500 |
| `max_cost_per_request` | $0.25 |
| `max_daily_provider_spend` | $20 |
| `max_concurrency` | 8 |
| `provider_timeout` | 60 s; first-token timeout 15 s |
| `retry_budget` | 1 failover per request |

## 4. State machine

```
            margin < 20% or coverage < 1.5×
 ABUNDANCE ───────────────────────────────► DEFENSIVE
     ▲                                        │   ▲
     │ coverage ≥ 3× and margin ≥ 30%         │   │ coverage > 1× + hysteresis
     │ sustained 300 s                        │   │ (only via RECOVERY)
     │                                        ▼   │
 RECOVERY ◄──────── coverage > 1.05× ─────── SURVIVAL
     │      (funds restored)                   ▲
     └──── relapse: coverage ≤ 1× ─────────────┘
                     any state: liquidity ≤ reserve or margin ≤ −5%  ──► SURVIVAL
```

Rules:

1. **Survival is immediate.** Entering SURVIVAL ignores `min_dwell` (safety first).
2. **Leaving survival always goes through RECOVERY.** No direct jump to ABUNDANCE.
3. **Improving transitions** require the condition to hold for `min_dwell` (RECOVERY → ABUNDANCE: `recovery.dwell`), and must clear the threshold by `hysteresis_bp`.
4. **Worsening transitions** (other than survival) also respect `min_dwell` to avoid flapping on noise.
5. Every transition writes `state_transitions` with trigger, metrics and `policy_version`, and emits `economic.state.changed`.
6. Stale price data: state can hold or worsen, never improve.

## 5. Permissions per state

| | ABUNDANCE | DEFENSIVE | SURVIVAL | RECOVERY |
|---|---|---|---|---|
| Premium tier | ✓ if margin ≥ min | only if task requires it and margin ≥ 30% | ✗ | ✓ if margin ≥ 40% |
| Standard tier | ✓ | ✓ | ✗ unless margin ≥ 20% and cost ≤ $0.01 | ✓ |
| Economy tier | ✓ | ✓ preferred | ✓ only if margin > 0 and spendable covers it | ✓ |
| Max output tokens | 4096 | 2048 | 512 | 2048 |
| Max cost/request | $0.25 | $0.08 | $0.01 | $0.08 |
| Long-context / tools | ✓ | ✗ | ✗ | ✗ |

## 6. Router

```
choose(request, candidates, estimates, policy):
  capable = candidates.filter(m => meets(request.requirements, m.capabilities))
  healthy = capable.filter(m => health[m.provider] != "down")
  allowed = healthy.filter(m => policy.permits(m.tier, est[m]))      // margin, caps, liquidity
  if allowed is empty → refuse with reason (FUNDING_REQUIRED | NO_CAPABLE_MODEL | ALL_PROVIDERS_DOWN)
  score(m) = quality[m] × stateWeight(policy.state, m.tier) − costWeight × est_cost[m]
  pick argmax score; tie → lower cost → lower p50 latency
  explanation = template(state, chosen, best_excluded, reason)
```

Explanation templates (shown verbatim in UI):

- "Routed to **Economy** (`deepseek-chat`): premium projected margin 12% is below the 30% floor in DEFENSIVE."
- "Routed to **Premium** (`claude-sonnet-…`): margin 64%, liquidity 4.2× reserve, ABUNDANCE."
- "Request declined: SURVIVAL — spendable funds $0.00 after $5.00 reserve. Deposit to restore service."

## 7. Failover

Provider error before first token → mark health, pick next allowed model under same constraints, one retry max, same idempotency key, no extra reservation. Error mid-stream → stop, finalize delivered tokens, surface "partial response" in UI. Circuit breaker: 3 consecutive failures or >50% errors in 2 min → provider `down` for 60 s, then half-open probe.

## 8. Simulation

`simulation_scenarios.state` holds a synthetic snapshot plus modifiers: `cost_multiplier`, `demand_multiplier`, `traffic_rps`, `liquidity_delta`, `provider_down[]`. A tick (1 s) produces synthetic requests, runs the **same** `policy.evaluate` and `router.choose`, appends to the scenario's own event scope, never touches `ledger_entries` with `scope='real'`. Scenarios expire after 1 h.

## 9. Tests that must exist

Cost formula, margin bp rounding, reserve/finalize/refund, concurrent reserve cannot overspend, each transition and its dwell/hysteresis, survival immediacy, recovery-only exit, stale-rate freeze, router capability filter, explanation text, simulation isolation (real ledger row count unchanged after a scenario).
