import "server-only";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, like, sql } from "drizzle-orm";
import { getDb, schema, type Executor } from "@/server/db/client";
import type { EventType, MetabolicEvent } from "@/lib/economics/types";
import { config } from "@/server/config";

const { events, systemState, ledgerEntries, priceSnapshots, auditEvents } = schema;

// ---------------------------------------------------------------- events
// Persisted (for replay after reconnect) and fanned out in-process to SSE
// streams. Multi-instance deployments need a shared bus (see docs/03 §7).

type Bus = { emitter: EventEmitter };
const g = globalThis as unknown as { __metabolicBus?: Bus };
const bus: Bus = g.__metabolicBus ?? (g.__metabolicBus = { emitter: new EventEmitter() });
bus.emitter.setMaxListeners(1000);

export async function publish(
  type: EventType,
  payload: Record<string, unknown>,
  opts: { source: MetabolicEvent["source"]; scope?: string; entityId?: string | null; db?: Executor } = { source: "api" },
): Promise<MetabolicEvent> {
  const db = opts.db ?? (await getDb());
  const scope = opts.scope ?? "real";
  const simulated = scope !== "real";
  const [row] = await db
    .insert(events)
    .values({ type, source: opts.source, scope, simulated, entityId: opts.entityId ?? null, payload })
    .returning();
  const ev: MetabolicEvent = {
    id: row.id,
    seq: row.seq,
    ts: row.createdAt.toISOString(),
    type,
    source: opts.source,
    scope,
    simulated,
    entityId: row.entityId,
    payload,
  };
  // Emit after the caller's transaction has a chance to commit.
  queueMicrotask(() => bus.emitter.emit("event", ev));
  return ev;
}

export function subscribe(fn: (ev: MetabolicEvent) => void): () => void {
  bus.emitter.on("event", fn);
  return () => bus.emitter.off("event", fn);
}

export async function eventsSince(scope: string, afterSeq: number, limit = 200): Promise<MetabolicEvent[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.scope, scope), gt(events.seq, afterSeq)))
    .orderBy(asc(events.seq))
    .limit(limit);
  return rows.map(toEvent);
}

export async function recentEvents(scope: string, limit = 50): Promise<MetabolicEvent[]> {
  const db = await getDb();
  const rows = await db.select().from(events).where(eq(events.scope, scope)).orderBy(desc(events.seq)).limit(limit);
  return rows.map(toEvent);
}

function toEvent(r: typeof events.$inferSelect): MetabolicEvent {
  return {
    id: r.id,
    seq: r.seq,
    ts: r.createdAt.toISOString(),
    type: r.type as EventType,
    source: r.source as MetabolicEvent["source"],
    scope: r.scope,
    simulated: r.simulated,
    entityId: r.entityId,
    payload: r.payload as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------- system kv

export async function getSystem<T>(key: string, db?: Executor): Promise<T | null> {
  const d = db ?? (await getDb());
  const [row] = await d.select().from(systemState).where(eq(systemState.key, key));
  return (row?.value as T) ?? null;
}

export async function setSystem(key: string, value: unknown, db?: Executor) {
  const d = db ?? (await getDb());
  await d
    .insert(systemState)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: new Date() } });
}

export async function isPaused(): Promise<boolean> {
  return (await getSystem<boolean>("paused")) === true;
}

export async function audit(action: string, opts: { actorUserId?: string | null; target?: string; meta?: unknown } = {}) {
  const db = await getDb();
  await db.insert(auditEvents).values({ action, actorUserId: opts.actorUserId ?? null, target: opts.target, meta: opts.meta ?? null });
}

// ---------------------------------------------------------------- ledger

export type JournalLine = {
  account: string;
  debit?: bigint;
  credit?: bigint;
  userId?: string | null;
  memo?: string;
};

/** Post one balanced journal. Throws if debits ≠ credits. Must run inside a transaction for multi-step operations. */
export async function postJournal(
  db: Executor,
  lines: JournalLine[],
  ref: { type: string; id?: string | null },
  scope = "real",
): Promise<string> {
  let dr = 0n;
  let cr = 0n;
  for (const l of lines) {
    if ((l.debit ?? 0n) < 0n || (l.credit ?? 0n) < 0n) throw new Error("negative ledger amount");
    dr += l.debit ?? 0n;
    cr += l.credit ?? 0n;
  }
  if (dr !== cr) throw new Error(`unbalanced journal: debits ${dr} credits ${cr}`);
  const journalId = randomUUID();
  const rows = lines
    .filter((l) => (l.debit ?? 0n) !== 0n || (l.credit ?? 0n) !== 0n)
    .map((l) => ({
      journalId,
      scope,
      account: l.account,
      userId: l.userId ?? null,
      debit: l.debit ?? 0n,
      credit: l.credit ?? 0n,
      refType: ref.type,
      refId: ref.id ?? null,
      memo: l.memo ?? null,
    }));
  if (rows.length) await db.insert(ledgerEntries).values(rows);
  return journalId;
}

/** Σ(debit − credit) over accounts matching `pattern` (SQL LIKE) in scope, optionally since a time. */
export async function accountNet(db: Executor, pattern: string, opts: { since?: Date; scope?: string } = {}): Promise<bigint> {
  const conds = [eq(ledgerEntries.scope, opts.scope ?? "real"), like(ledgerEntries.account, pattern)];
  if (opts.since) conds.push(gte(ledgerEntries.createdAt, opts.since));
  const [row] = await db
    .select({ v: sql<string>`coalesce(sum(${ledgerEntries.debit}) - sum(${ledgerEntries.credit}), 0)::text` })
    .from(ledgerEntries)
    .where(and(...conds));
  return BigInt(row?.v ?? "0");
}

// ---------------------------------------------------------------- NEAR/USD rate

export type Rate = { id: string; microPerNear: bigint; observedAt: Date; source: string; stale: boolean };

let inflight: Promise<Rate | null> | null = null;

/** Latest NEAR/USD rate. Refreshes from the feed when older than PRICE_MAX_AGE_S. Never invents a value. */
export async function getRate(): Promise<Rate | null> {
  const db = await getDb();
  const [latest] = await db.select().from(priceSnapshots).orderBy(desc(priceSnapshots.observedAt)).limit(1);
  const maxAge = config.price.maxAgeSeconds * 1000;
  const fresh = latest && Date.now() - latest.observedAt.getTime() < maxAge;
  if (fresh) return { id: latest.id, microPerNear: latest.microPerUnit, observedAt: latest.observedAt, source: latest.source, stale: false };
  if (!inflight) {
    inflight = fetchRate().finally(() => {
      inflight = null;
    });
  }
  const fetched = await inflight;
  if (fetched) return fetched;
  if (latest) return { id: latest.id, microPerNear: latest.microPerUnit, observedAt: latest.observedAt, source: latest.source, stale: true };
  return null;
}

async function fetchRate(): Promise<Rate | null> {
  try {
    const res = await fetch(config.price.feedUrl, { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { near?: { usd?: number } };
    const usd = body?.near?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return null;
    const micro = BigInt(Math.round(usd * 1_000_000));
    const db = await getDb();
    const [row] = await db
      .insert(priceSnapshots)
      .values({ microPerUnit: micro, source: new URL(config.price.feedUrl).host, observedAt: new Date() })
      .returning();
    return { id: row.id, microPerNear: micro, observedAt: row.observedAt, source: row.source, stale: false };
  } catch {
    return null;
  }
}
