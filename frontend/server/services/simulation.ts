import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { evaluatePolicy, type PolicyConfig } from "@/server/economics/policy";
import { chooseModel, TIER_LABEL } from "@/server/economics/router";
import { allModels, configuredProviders } from "@/server/economics/registry";
import { marginBp } from "@/lib/economics/money";
import type { EconomicSnapshot, OverviewDTO, ProviderHealth, StateMemory } from "@/lib/economics/types";
import { activePolicy } from "./economy";
import { publish } from "./core";
import { config } from "@/server/config";

// Isolated scenario engine for the Stress Lab. It reuses the real policy engine
// and router on a synthetic economy held in simulation_scenarios.state. It never
// reads or writes ledger_entries, credit_balances, deposits or usage_requests.
// Virtual time runs SPEED× faster than wall time so dwell timers play out in seconds.

export const SPEED = 20; // 1 real second = 20 virtual seconds
const TICK_MS = 10_000; // virtual
const WINDOW_MS = 5 * 60_000; // virtual rolling window
const MAX_CATCHUP_MS = 30_000 * SPEED;

type Bucket = { t: number; revenue: string; expense: string; overhead?: string; requests: number; refused: number };
export type SimModifiers = {
  costMultiplier: number; // true provider cost vs price list
  demandMultiplier: number; // scales request volume
  trafficPerMin: number; // base requests per virtual minute
  providersDown: string[];
};
export type SimDecision = { at: number; kind: string; text: string; state: string; model: string | null };
export type SimState = {
  virtualNow: number;
  lastRealAt: number;
  carryVirtualMs?: number;
  treasury: string;
  liabilities: string;
  payables: string;
  overheadPerHour: string;
  buckets: Bucket[];
  memory: StateMemory | null;
  lastModelId: string | null;
  observedCostRatio: number;
  modifiers: SimModifiers;
  history: { t: number; liquidity: string; revenue: string; expense: string; state: string; tier: string | null; marginBp: number | null }[];
  decisions: SimDecision[];
  totals: { revenue: string; expense: string; requests: number; refused: number };
  lastExplanation: string | null;
};

const DEFAULT_MODS: SimModifiers = { costMultiplier: 1, demandMultiplier: 1, trafficPerMin: 30, providersDown: [] };

function initialState(): SimState {
  const now = Date.now();
  return {
    virtualNow: now,
    lastRealAt: now,
    carryVirtualMs: 0,
    treasury: "60000000", // $60 simulated
    liabilities: "20000000",
    payables: "0",
    overheadPerHour: "1500000", // $1.50/h simulated overhead
    buckets: [],
    memory: null,
    lastModelId: null,
    observedCostRatio: 1,
    modifiers: { ...DEFAULT_MODS },
    history: [],
    decisions: [],
    totals: { revenue: "0", expense: "0", requests: 0, refused: 0 },
    lastExplanation: null,
  };
}

/** Models usable in simulation: every catalog model with a known price list, configured or not. */
function simModels() {
  return allModels().filter((m) => m.costInPerM > 0n || m.costOutPerM > 0n);
}

function snapshotOf(s: SimState): EconomicSnapshot {
  const since = s.virtualNow - WINDOW_MS;
  let revenue = 0n;
  let expense = 0n;
  let requests = 0;
  for (const b of s.buckets) {
    if (b.t < since) continue;
    revenue += BigInt(b.revenue);
    // Policy snapshots contain provider expense; deriveMetrics adds fixed
    // overhead to burn separately, exactly as it does for the real economy.
    const overhead = b.overhead === undefined
      ? BigInt(s.overheadPerHour) * BigInt(TICK_MS) / 3_600_000n
      : BigInt(b.overhead);
    expense += BigInt(b.expense) - overhead;
    requests += b.requests;
  }
  const health: Record<string, ProviderHealth> = {};
  for (const p of configuredProviders()) health[p.provider] = s.modifiers.providersDown.includes(p.provider) ? "down" : "ok";
  return {
    at: s.virtualNow,
    treasury: BigInt(s.treasury),
    liabilities: BigInt(s.liabilities),
    payables: BigInt(s.payables),
    revenueWindow: revenue,
    expenseWindow: expense,
    requestsWindow: requests,
    overheadPerHour: BigInt(s.overheadPerHour),
    windowMs: WINDOW_MS,
    providerHealth: health,
    rateStale: false,
  };
}

function healthOf(s: SimState): Record<string, ProviderHealth> {
  const h: Record<string, ProviderHealth> = {};
  for (const m of simModels()) h[m.provider] = s.modifiers.providersDown.includes(m.provider) ? "down" : "ok";
  return h;
}

/** Deterministic pseudo-noise from the tick time so replays are stable. */
function noise(t: number) {
  const x = Math.sin(t / 997) * 10000;
  return 0.92 + (x - Math.floor(x)) * 0.16; // 0.92 .. 1.08
}

type TickOutcome = { stateChanged?: { from: string; to: string; trigger: string | null }; switched?: { from: string | null; to: string; explanation: string } };

function tick(s: SimState, cfg: PolicyConfig): TickOutcome {
  const out: TickOutcome = {};
  s.virtualNow += TICK_MS;
  const snap = snapshotOf(s);
  const ev = evaluatePolicy(snap, s.memory, cfg, s.virtualNow);
  if (ev.changed) out.stateChanged = { from: ev.previous, to: ev.state, trigger: ev.trigger };
  s.memory = ev.memory;

  const perTick = (s.modifiers.trafficPerMin * s.modifiers.demandMultiplier * TICK_MS) / 60_000;
  const n = Math.max(0, Math.round(perTick * noise(s.virtualNow + 7)));
  const inTokens = Math.round(900 * noise(s.virtualNow));
  const d = chooseModel({ inTokens, expectedOutputTokens: 500 }, simModels(), ev, healthOf(s), { costMultiplier: s.observedCostRatio });

  let revenue = 0n;
  let expense = 0n;
  let refused = 0;
  let tier: string | null = null;
  if (d.ok) {
    tier = d.model.tier;
    if (s.lastModelId !== d.model.id) {
      out.switched = { from: s.lastModelId, to: d.model.id, explanation: d.explanation };
      s.lastModelId = d.model.id;
    }
    s.lastExplanation = d.explanation;
    // Price-list cost, then the true (hidden) multiplier with noise = what the provider actually bills.
    const listCost = d.estimate.cost === 0n ? 0n : BigInt(Math.ceil(Number(d.estimate.cost) / s.observedCostRatio));
    const trueCost = BigInt(Math.ceil(Number(listCost) * s.modifiers.costMultiplier * noise(s.virtualNow + 3)));
    revenue = d.estimate.charge * BigInt(n);
    expense = trueCost * BigInt(n);
    // Learn the realised cost ratio (as reconciliation would), so the router adapts.
    if (n > 0 && listCost > 0n) {
      const ratio = Number(trueCost) / Number(listCost);
      s.observedCostRatio = s.observedCostRatio * 0.4 + ratio * 0.6;
    }
  } else {
    refused = n;
    s.lastExplanation = d.explanation;
    if (s.lastModelId !== null && n > 0) {
      out.switched = { from: s.lastModelId, to: "none", explanation: d.explanation };
      s.lastModelId = null;
    }
  }

  // Customers top up exactly what they consume, so liabilities stay flat; the
  // business keeps the margin and pays overhead.
  const overhead = (BigInt(s.overheadPerHour) * BigInt(TICK_MS)) / 3_600_000n;
  s.treasury = (BigInt(s.treasury) + revenue - expense - overhead).toString();
  s.buckets.push({ t: s.virtualNow, revenue: revenue.toString(), expense: (expense + overhead).toString(), overhead: overhead.toString(), requests: n - refused, refused });
  s.buckets = s.buckets.filter((b) => b.t >= s.virtualNow - WINDOW_MS);
  s.totals = {
    revenue: (BigInt(s.totals.revenue) + revenue).toString(),
    expense: (BigInt(s.totals.expense) + expense + overhead).toString(),
    requests: s.totals.requests + n - refused,
    refused: s.totals.refused + refused,
  };
  const after = snapshotOf(s);
  const liq = after.treasury - after.liabilities - after.payables;
  s.history.push({
    t: s.virtualNow,
    liquidity: liq.toString(),
    revenue: revenue.toString(),
    expense: (expense + overhead).toString(),
    state: ev.state,
    tier,
    marginBp: marginBp(after.revenueWindow, after.expenseWindow),
  });
  if (s.history.length > 360) s.history = s.history.slice(-360);
  return out;
}

async function load(id: string, userId: string | null) {
  const db = await getDb();
  const conds = [eq(schema.simulationScenarios.id, id), isNull(schema.simulationScenarios.endedAt), gt(schema.simulationScenarios.expiresAt, new Date())];
  const [row] = await db.select().from(schema.simulationScenarios).where(and(...conds));
  if (!row) return null;
  if (row.userId && userId && row.userId !== userId) return null;
  return { row, state: row.state as SimState };
}

async function save(id: string, state: SimState) {
  const db = await getDb();
  await db.update(schema.simulationScenarios).set({ state }).where(eq(schema.simulationScenarios.id, id));
}

function decision(s: SimState, kind: string, text: string) {
  s.decisions.unshift({ at: s.virtualNow, kind, text, state: s.memory?.state ?? "ABUNDANCE", model: s.lastModelId });
  if (s.decisions.length > 60) s.decisions.length = 60;
}

async function advance(id: string, s: SimState, cfg: PolicyConfig, minTicks = 0) {
  const now = Date.now();
  const virtualElapsed = Math.min(Math.max(0, now - s.lastRealAt) * SPEED + (s.carryVirtualMs ?? 0), MAX_CATCHUP_MS);
  s.lastRealAt = now;
  const ticks = Math.max(minTicks, Math.floor(virtualElapsed / TICK_MS));
  s.carryVirtualMs = Math.max(0, virtualElapsed - ticks * TICK_MS);
  const scope = `sim:${id}`;
  for (let i = 0; i < ticks; i++) {
    const o = tick(s, cfg);
    if (o.stateChanged) {
      decision(s, "state", `${o.stateChanged.from} → ${o.stateChanged.to}: ${o.stateChanged.trigger ?? ""}`);
      await publish("economic.state.changed", { from: o.stateChanged.from, to: o.stateChanged.to, trigger: o.stateChanged.trigger }, { source: "simulation", scope });
    }
    if (o.switched) {
      decision(s, o.switched.to === "none" ? "refusal" : "route", o.switched.explanation);
      await publish("model.switched", { from: o.switched.from, to: o.switched.to, explanation: o.switched.explanation, tier: simModels().find((m) => m.id === o.switched!.to)?.tier ?? null }, { source: "simulation", scope });
    }
  }
  if (ticks > 0) await publish("snapshot.updated", { ticks }, { source: "simulation", scope });
}

export async function createScenario(userId: string | null) {
  const db = await getDb();
  const cfg = await activePolicy();
  const state = initialState();
  // Seed a short healthy history so the rolling window and charts start populated.
  for (let i = 0; i < 30; i++) tick(state, cfg);
  state.lastRealAt = Date.now();
  decision(state, "info", "Scenario started with a healthy simulated treasury.");
  const [row] = await db
    .insert(schema.simulationScenarios)
    .values({ userId, params: { speed: SPEED, tickMs: TICK_MS, windowMs: WINDOW_MS }, state, expiresAt: new Date(Date.now() + 3600_000) })
    .returning();
  await publish("simulation.started", { id: row.id }, { source: "simulation", scope: `sim:${row.id}` });
  return { id: row.id, ...(await simView(row.id, state, cfg)) };
}

export async function getScenario(id: string, userId: string | null) {
  const l = await load(id, userId);
  if (!l) return null;
  const cfg = await activePolicy();
  await advance(id, l.state, cfg);
  await save(id, l.state);
  return { id, ...(await simView(id, l.state, cfg)) };
}

export type SimAction =
  | { type: "spike_cost"; multiplier: number }
  | { type: "set_demand"; multiplier: number }
  | { type: "set_traffic"; perMin: number }
  | { type: "drain_treasury" }
  | { type: "restore_funding"; usd?: number }
  | { type: "provider_failure"; provider: string; down: boolean }
  | { type: "advance_time"; seconds: number }
  | { type: "reset" };

export async function applyAction(id: string, userId: string | null, action: SimAction) {
  const l = await load(id, userId);
  if (!l) return null;
  const s = l.state;
  const cfg = await activePolicy();
  await advance(id, s, cfg); // bring time current first
  let actionTicks = 1;
  switch (action.type) {
    case "spike_cost":
      s.modifiers.costMultiplier = Math.min(10, Math.max(0.5, action.multiplier));
      decision(s, "stress", `Provider compute cost set to ×${s.modifiers.costMultiplier.toFixed(1)} (simulated).`);
      break;
    case "set_demand":
      s.modifiers.demandMultiplier = Math.min(3, Math.max(0, action.multiplier));
      decision(s, "stress", `Customer demand set to ${Math.round(s.modifiers.demandMultiplier * 100)}% (simulated).`);
      break;
    case "set_traffic":
      s.modifiers.trafficPerMin = Math.min(120, Math.max(0, Math.round(action.perMin)));
      decision(s, "stress", `Traffic set to ${s.modifiers.trafficPerMin} req/min (simulated).`);
      break;
    case "drain_treasury": {
      const liabilities = BigInt(s.liabilities) + BigInt(s.payables);
      // Leave liquidity at 60% of the hard reserve.
      s.treasury = (liabilities + (cfg.hardReserve * 6n) / 10n).toString();
      decision(s, "stress", "Simulated treasury drained to 60% of the hard reserve.");
      break;
    }
    case "restore_funding": {
      const usd = BigInt(Math.round((action.usd ?? 50) * 1_000_000));
      s.treasury = (BigInt(s.treasury) + usd).toString();
      decision(s, "stress", `Simulated funding of $${(Number(usd) / 1e6).toFixed(2)} added.`);
      break;
    }
    case "provider_failure":
      s.modifiers.providersDown = action.down
        ? Array.from(new Set([...s.modifiers.providersDown, action.provider]))
        : s.modifiers.providersDown.filter((p) => p !== action.provider);
      decision(s, "stress", `${action.provider} marked ${action.down ? "down" : "healthy"} (simulated).`);
      break;
    case "advance_time":
      actionTicks = Math.ceil(Math.min(300, Math.max(10, action.seconds)) * 1000 / TICK_MS);
      decision(s, "info", `Advancing ${actionTicks * TICK_MS / 1000} simulated seconds with the current conditions.`);
      break;
    case "reset": {
      const fresh = initialState();
      for (let i = 0; i < 30; i++) tick(fresh, cfg);
      fresh.lastRealAt = Date.now();
      Object.assign(s, fresh);
      decision(s, "info", "Scenario reset.");
      break;
    }
  }
  // Apply one tick immediately so the effect is visible at once.
  await advance(id, s, cfg, actionTicks);
  await save(id, s);
  return { id, ...(await simView(id, s, cfg)) };
}

export async function endScenario(id: string, userId: string | null) {
  const l = await load(id, userId);
  if (!l) return false;
  const db = await getDb();
  await db.update(schema.simulationScenarios).set({ endedAt: new Date() }).where(eq(schema.simulationScenarios.id, id));
  await publish("simulation.ended", { id }, { source: "simulation", scope: `sim:${id}` });
  return true;
}

async function simView(id: string, s: SimState, cfg: PolicyConfig) {
  const snap = snapshotOf(s);
  const ev = evaluatePolicy(snap, s.memory, cfg, s.virtualNow);
  const active = s.lastModelId ? simModels().find((m) => m.id === s.lastModelId) : null;
  const pending = ev.memory.pendingSince;
  const holdMs = pending?.target === "ABUNDANCE" && ev.state === "RECOVERY" ? cfg.recovery.dwellMs : pending?.target === "RECOVERY" ? 0 : cfg.minDwellMs;
  const overview: OverviewDTO = {
    scope: `sim:${id}`,
    simulated: true,
    at: new Date(s.virtualNow).toISOString(),
    state: ev.state,
    stateSince: new Date(s.memory?.since ?? s.virtualNow).toISOString(),
    policyVersion: cfg.version,
    treasury: s.treasury,
    treasuryNear: "0",
    liabilities: s.liabilities,
    payables: s.payables,
    liquidity: ev.metrics.liquidity.toString(),
    spendable: ev.metrics.spendable.toString(),
    hardReserve: cfg.hardReserve.toString(),
    revenueWindow: snap.revenueWindow.toString(),
    expenseWindow: snap.expenseWindow.toString(),
    revenueTotal: s.totals.revenue,
    expenseTotal: s.totals.expense,
    expenseEstimatedTotal: "0",
    rollingMarginBp: ev.metrics.rollingMarginBp,
    reserveCoverageBp: ev.metrics.reserveCoverageBp,
    runwaySeconds: ev.metrics.runwaySeconds === null ? null : Math.round(ev.metrics.runwaySeconds),
    requestsWindow: snap.requestsWindow,
    activeModel: active ? { id: active.id, label: active.label, tier: active.tier, provider: active.provider } : null,
    lastDecision: s.lastExplanation ? { at: new Date(s.virtualNow).toISOString(), explanation: s.lastExplanation, kind: "route" } : null,
    providers: configuredProviders().map((p) => ({ ...p, health: s.modifiers.providersDown.includes(p.provider) ? "down" : "ok" })),
    permissions: { tiers: ev.permissions.tiers, maxCostPerRequest: ev.permissions.maxCostPerRequest.toString(), maxOutputTokens: ev.permissions.maxOutputTokens },
    rate: null,
    network: config.near.network,
    paused: false,
  };
  return {
    overview,
    modifiers: s.modifiers,
    observedCostRatio: s.observedCostRatio,
    history: s.history.slice(-120),
    decisions: s.decisions.slice(0, 30),
    totals: s.totals,
    speed: SPEED,
    windowSeconds: WINDOW_MS / 1000,
    policy: {
      defensiveMarginBp: cfg.defensive.enterMarginBp,
      abundanceMarginBp: cfg.abundance.minMarginBp,
      pendingState: pending?.target ?? null,
      remainingHoldSeconds: pending ? Math.ceil(Math.max(0, cfg.minDwellMs - (s.virtualNow - ev.memory.since), holdMs - (s.virtualNow - pending.at)) / 1000) : null,
    },
    tierLabels: TIER_LABEL,
    models: simModels().map((m) => ({ id: m.id, label: m.label, tier: m.tier, provider: m.provider, configured: m.enabled })),
  };
}
