import "server-only";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema, type Executor } from "@/server/db/client";
import { DEFAULT_POLICY, evaluatePolicy, type PolicyConfig } from "@/server/economics/policy";
import { TIER_LABEL } from "@/server/economics/router";
import { configuredProviders, findModel } from "@/server/economics/registry";
import type { EconomicSnapshot, OverviewDTO, PolicyEvaluation, StateMemory } from "@/lib/economics/types";
import { config } from "@/server/config";
import { accountNet, getRate, getSystem, isPaused, publish, setSystem } from "./core";
import { healthMap } from "./health";

const { ledgerEntries, usageRequests, routingDecisions, stateTransitions, economicSnapshots, deposits } = schema;

const WINDOW_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------- policy config

let policyCache: { cfg: PolicyConfig; at: number } | null = null;

/** Active policy: the operator's override from policy_configs if any, else DEFAULT_POLICY. */
export async function activePolicy(): Promise<PolicyConfig> {
  if (policyCache && Date.now() - policyCache.at < 10_000) return policyCache.cfg;
  const db = await getDb();
  const [row] = await db.select().from(schema.policyConfigs).where(eq(schema.policyConfigs.active, true)).orderBy(desc(schema.policyConfigs.version)).limit(1);
  const cfg = row ? reviveConfig(row.config as SerializedPolicy, row.version) : DEFAULT_POLICY;
  policyCache = { cfg, at: Date.now() };
  return cfg;
}

export function invalidatePolicyCache() {
  policyCache = null;
}

export type SerializedPolicy = {
  hardReserveMicro: string;
  abundanceMinMarginBp: number;
  abundanceMinCoverageBp: number;
  defensiveEnterMarginBp: number;
  defensiveEnterCoverageBp: number;
  minDwellSeconds: number;
  recoveryDwellSeconds: number;
  hysteresisBp: number;
};

export function serializePolicy(c: PolicyConfig): SerializedPolicy {
  return {
    hardReserveMicro: c.hardReserve.toString(),
    abundanceMinMarginBp: c.abundance.minMarginBp,
    abundanceMinCoverageBp: c.abundance.minCoverageBp,
    defensiveEnterMarginBp: c.defensive.enterMarginBp,
    defensiveEnterCoverageBp: c.defensive.enterCoverageBp,
    minDwellSeconds: c.minDwellMs / 1000,
    recoveryDwellSeconds: c.recovery.dwellMs / 1000,
    hysteresisBp: c.hysteresisBp,
  };
}

export function reviveConfig(s: SerializedPolicy, version: number): PolicyConfig {
  return {
    ...DEFAULT_POLICY,
    version,
    hardReserve: BigInt(s.hardReserveMicro),
    abundance: { minMarginBp: s.abundanceMinMarginBp, minCoverageBp: s.abundanceMinCoverageBp },
    defensive: { enterMarginBp: s.defensiveEnterMarginBp, enterCoverageBp: s.defensiveEnterCoverageBp },
    minDwellMs: s.minDwellSeconds * 1000,
    recovery: { ...DEFAULT_POLICY.recovery, dwellMs: s.recoveryDwellSeconds * 1000, exitCoverageBp: s.abundanceMinCoverageBp },
    hysteresisBp: s.hysteresisBp,
  };
}

// ---------------------------------------------------------------- snapshot

export async function realSnapshot(db?: Executor): Promise<EconomicSnapshot> {
  const d = db ?? (await getDb());
  const since = new Date(Date.now() - WINDOW_MS);
  const [treasury, liabilitiesNeg, payablesNeg, revenueNeg, expense] = await Promise.all([
    accountNet(d, "asset:treasury"),
    accountNet(d, "liability:credits"),
    accountNet(d, "liability:payable:%"),
    accountNet(d, "revenue:inference", { since }),
    accountNet(d, "expense:provider:%", { since }),
  ]);
  const [{ n }] = await d.select({ n: count() }).from(usageRequests).where(and(eq(usageRequests.status, "finalized"), gte(usageRequests.createdAt, since)));
  const rate = await getRate();
  return {
    at: Date.now(),
    treasury,
    liabilities: -liabilitiesNeg,
    payables: -payablesNeg,
    revenueWindow: -revenueNeg,
    expenseWindow: expense,
    requestsWindow: Number(n),
    overheadPerHour: config.overheadPerHourMicro,
    windowMs: WINDOW_MS,
    providerHealth: healthMap(),
    // Accounting uses historical USD cost; a stale rate only matters when new
    // NEAR has to be converted, so it freezes improvements per docs/04 §1.
    rateStale: !rate || rate.stale,
  };
}

/**
 * Evaluate and persist the real operating state. Writes a state transition and
 * publishes an event when it changes. Serialised by a row lock on the memory row.
 */
export async function evaluateReal(): Promise<PolicyEvaluation> {
  const db = await getDb();
  const cfg = await activePolicy();
  const snapshot = await realSnapshot(db);
  let changedEval: PolicyEvaluation | null = null;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from system_state where key = 'state:real' for update`);
    const memory = await getSystem<StateMemory>("state:real", tx);
    const ev = evaluatePolicy(snapshot, memory, cfg, Date.now());
    const memChanged = !memory || ev.changed || JSON.stringify(memory.pendingSince ?? null) !== JSON.stringify(ev.memory.pendingSince ?? null);
    if (memChanged) await setSystem("state:real", ev.memory, tx);
    if (ev.changed || !memory) {
      await tx.insert(stateTransitions).values({
        scope: "real",
        fromState: ev.previous,
        toState: ev.state,
        trigger: ev.trigger ?? "initial classification",
        metrics: metricsJson(ev),
        policyVersion: ev.policyVersion,
      });
      changedEval = ev;
    }
    return ev;
  });
  if (changedEval) {
    const ev = changedEval as PolicyEvaluation;
    await publish(
      "economic.state.changed",
      { from: ev.previous, to: ev.state, trigger: ev.trigger, metrics: metricsJson(ev) },
      { source: "policy" },
    );
  }
  return result;
}

export function metricsJson(ev: PolicyEvaluation) {
  const m = ev.metrics;
  return {
    liquidity: m.liquidity.toString(),
    spendable: m.spendable.toString(),
    reserveCoverageBp: m.reserveCoverageBp,
    rollingMarginBp: m.rollingMarginBp,
    burnPerHour: m.burnPerHour.toString(),
    runwaySeconds: m.runwaySeconds,
  };
}

/** Persist a periodic snapshot row (worker, and after billing). Throttled to one per 30 s. */
export async function recordSnapshot(ev: PolicyEvaluation, snap: EconomicSnapshot) {
  const last = await getSystem<number>("snapshot:last");
  if (last && Date.now() - last < 30_000) return;
  await setSystem("snapshot:last", Date.now());
  const db = await getDb();
  await db.insert(economicSnapshots).values({
    scope: "real",
    state: ev.state,
    treasury: snap.treasury,
    liabilities: snap.liabilities,
    payables: snap.payables,
    liquidity: ev.metrics.liquidity,
    revenueWindow: snap.revenueWindow,
    expenseWindow: snap.expenseWindow,
    rollingMarginBp: ev.metrics.rollingMarginBp,
    reserveCoverageBp: ev.metrics.reserveCoverageBp,
    runwaySeconds: ev.metrics.runwaySeconds,
    requestsWindow: snap.requestsWindow,
  });
  await publish("snapshot.updated", { state: ev.state }, { source: "policy" });
}

// ---------------------------------------------------------------- overview DTO

export async function overview(): Promise<OverviewDTO> {
  const db = await getDb();
  const ev = await evaluateReal();
  const snap = await realSnapshot(db);
  const cfg = await activePolicy();
  void recordSnapshot(ev, snap).catch(() => {});
  const memory = await getSystem<StateMemory>("state:real");
  const [revTotal, expTotal, estRow, nearRow, lastRoute, rate, paused] = await Promise.all([
    accountNet(db, "revenue:inference"),
    accountNet(db, "expense:provider:%"),
    db.select({ v: sql<string>`coalesce(sum(${usageRequests.cost}),0)::text` }).from(usageRequests).where(and(eq(usageRequests.status, "finalized"), eq(usageRequests.costIsEstimated, true))),
    db.select({ v: sql<string>`coalesce(sum(${deposits.amountYocto}),0)::text` }).from(deposits),
    db.select().from(routingDecisions).where(eq(routingDecisions.scope, "real")).orderBy(desc(routingDecisions.createdAt)).limit(1),
    getRate(),
    isPaused(),
  ]);
  const last = lastRoute[0];
  const activeId = last?.chosenModelId ?? null;
  const active = activeId ? findModel(activeId) : null;
  const health = healthMap();
  return {
    scope: "real",
    simulated: false,
    at: new Date().toISOString(),
    state: ev.state,
    stateSince: new Date(memory?.since ?? Date.now()).toISOString(),
    policyVersion: ev.policyVersion,
    treasury: snap.treasury.toString(),
    treasuryNear: nearRow[0]?.v ?? "0",
    liabilities: snap.liabilities.toString(),
    payables: snap.payables.toString(),
    liquidity: ev.metrics.liquidity.toString(),
    spendable: ev.metrics.spendable.toString(),
    hardReserve: cfg.hardReserve.toString(),
    revenueWindow: snap.revenueWindow.toString(),
    expenseWindow: snap.expenseWindow.toString(),
    revenueTotal: (-revTotal).toString(),
    expenseTotal: expTotal.toString(),
    expenseEstimatedTotal: estRow[0]?.v ?? "0",
    rollingMarginBp: ev.metrics.rollingMarginBp,
    reserveCoverageBp: ev.metrics.reserveCoverageBp,
    runwaySeconds: ev.metrics.runwaySeconds,
    requestsWindow: snap.requestsWindow,
    activeModel: active ? { id: active.id, label: active.label, tier: active.tier, provider: active.provider } : null,
    lastDecision: last ? { at: last.createdAt.toISOString(), explanation: last.explanation, kind: last.kind } : null,
    providers: configuredProviders().map((p) => ({ ...p, health: health[p.provider] ?? "ok" })),
    permissions: {
      tiers: ev.permissions.tiers,
      maxCostPerRequest: ev.permissions.maxCostPerRequest.toString(),
      maxOutputTokens: ev.permissions.maxOutputTokens,
    },
    rate: rate ? { microPerNear: rate.microPerNear.toString(), observedAt: rate.observedAt.toISOString(), stale: rate.stale } : null,
    network: config.near.network,
    paused,
  };
}

export { TIER_LABEL };

/** Hourly time series for charts: revenue, expense and treasury from the ledger. */
export async function metricsSeries(hours: number) {
  const db = await getDb();
  const since = new Date(Date.now() - hours * 3600_000);
  const bucket = hours > 48 ? "day" : "hour";
  const rows = await db
    .select({
      // Epoch seconds: unambiguous across Postgres/PGlite text formats and time zones.
      t: sql<string>`extract(epoch from date_trunc(${bucket}, ${ledgerEntries.createdAt}))::bigint::text`,
      revenue: sql<string>`coalesce(sum(case when ${ledgerEntries.account} = 'revenue:inference' then ${ledgerEntries.credit} - ${ledgerEntries.debit} else 0 end),0)::text`,
      expense: sql<string>`coalesce(sum(case when ${ledgerEntries.account} like 'expense:provider:%' then ${ledgerEntries.debit} - ${ledgerEntries.credit} else 0 end),0)::text`,
      treasury: sql<string>`coalesce(sum(case when ${ledgerEntries.account} = 'asset:treasury' then ${ledgerEntries.debit} - ${ledgerEntries.credit} else 0 end),0)::text`,
      liability: sql<string>`coalesce(sum(case when ${ledgerEntries.account} = 'liability:credits' or ${ledgerEntries.account} like 'liability:payable:%' then ${ledgerEntries.credit} - ${ledgerEntries.debit} else 0 end),0)::text`,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.scope, "real"), gte(ledgerEntries.createdAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  // Opening balances before the window, so the liquidity line starts at the right level.
  const [openT, openL1, openL2] = await Promise.all([
    accountNet(db, "asset:treasury", { since: new Date(0) }).then(async (all) => all - (await accountNet(db, "asset:treasury", { since }))),
    accountNet(db, "liability:credits").then(async (all) => all - (await accountNet(db, "liability:credits", { since }))),
    accountNet(db, "liability:payable:%").then(async (all) => all - (await accountNet(db, "liability:payable:%", { since }))),
  ]);
  let liquidity = openT + openL1 + openL2; // liabilities are credit-normal (negative net)
  const series: { t: string; revenue: string; expense: string; liquidity: string }[] = [];
  if (rows.length) series.push({ t: since.toISOString(), revenue: "0", expense: "0", liquidity: liquidity.toString() });
  for (const r of rows) {
    liquidity += BigInt(r.treasury) - BigInt(r.liability);
    series.push({ t: new Date(Number(r.t) * 1000).toISOString(), revenue: r.revenue, expense: r.expense, liquidity: liquidity.toString() });
  }
  // Carry the latest level to "now" so the line reaches the right edge.
  if (rows.length) series.push({ t: new Date().toISOString(), revenue: "0", expense: "0", liquidity: liquidity.toString() });
  const transitions = await db.select().from(stateTransitions).where(and(eq(stateTransitions.scope, "real"), gte(stateTransitions.createdAt, since))).orderBy(stateTransitions.createdAt);
  const switches = await db
    .select({ at: routingDecisions.createdAt, model: routingDecisions.chosenModelId, tier: routingDecisions.tier, explanation: routingDecisions.explanation })
    .from(routingDecisions)
    .where(and(eq(routingDecisions.scope, "real"), eq(routingDecisions.kind, "route"), gte(routingDecisions.createdAt, since)))
    .orderBy(routingDecisions.createdAt);
  // Keep only the points where the chosen model changed.
  const modelSwitches: { at: string; model: string | null; tier: string | null; explanation: string }[] = [];
  let prev: string | null = null;
  for (const s of switches) {
    if (s.model !== prev) modelSwitches.push({ at: s.at.toISOString(), model: s.model, tier: s.tier, explanation: s.explanation });
    prev = s.model;
  }
  return {
    bucket,
    series,
    transitions: transitions.map((t) => ({ at: t.createdAt.toISOString(), from: t.fromState, to: t.toState, trigger: t.trigger })),
    modelSwitches,
    tierLabels: TIER_LABEL,
  };
}
