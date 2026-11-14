import "server-only";
import { desc, eq, gt, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { config } from "@/server/config";
import { evaluateReal, realSnapshot, recordSnapshot } from "@/server/services/economy";
import { probeAll } from "@/server/services/health";
import { getRate } from "@/server/services/core";
import { publishReceipt, receiptsConfigured, submitReceipt } from "@/server/services/receipts";
import { recoverStaleReservations } from "@/server/services/spend-passes";

// Background jobs. Runs in-process (instrumentation.ts) by default, because the
// embedded PGlite database is single-process. With DATABASE_URL set you can run
// it as its own process instead (WORKER_INLINE=false + `pnpm worker`).

type Job = { name: string; everyMs: number; run: () => Promise<void>; last: number; running: boolean };

const g = globalThis as unknown as { __metabolicWorker?: { timer: ReturnType<typeof setInterval> } };

export function startWorker(log: (m: string) => void = (m) => console.log(`[worker] ${m}`)) {
  if (g.__metabolicWorker) return;
  const jobs: Job[] = [
    { name: "reservation-recovery", everyMs: 30_000, run: async () => { const n = await recoverStaleReservations(); if (n) log(`Recovered ${n} expired reservations; provider reconciliation required.`); } },
    {
      name: "state+snapshot",
      everyMs: 30_000,
      run: async () => {
        const ev = await evaluateReal();
        await recordSnapshot(ev, await realSnapshot());
      },
    },
    { name: "price", everyMs: Math.max(60_000, config.price.maxAgeSeconds * 1000 - 30_000), run: async () => void (await getRate()) },
    { name: "provider-health", everyMs: 120_000, run: probeAll },
    { name: "receipts", everyMs: config.receipts.intervalMinutes * 60_000, run: () => autoReceipt(log) },
    { name: "receipt-retry", everyMs: 5 * 60_000, run: () => retryFailedReceipts(log) },
  ].map((j) => ({ ...j, last: 0, running: false }));

  const tick = () => {
    const now = Date.now();
    for (const j of jobs) {
      if (j.running || now - j.last < j.everyMs) continue;
      j.running = true;
      j.last = now;
      j.run()
        .catch((e) => log(`${j.name} failed: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => {
          j.running = false;
        });
    }
  };
  const timer = setInterval(tick, 5_000);
  timer.unref?.();
  g.__metabolicWorker = { timer };
  setTimeout(tick, 3_000).unref?.();
  log("started");
}

/** Commit a receipt when configured and there has been ledger activity since the last one. */
async function autoReceipt(log: (m: string) => void) {
  if (!receiptsConfigured().ok) return;
  const db = await getDb();
  const [last] = await db.select().from(schema.economicReceipts).where(eq(schema.economicReceipts.status, "finalized")).orderBy(desc(schema.economicReceipts.intervalEnd)).limit(1);
  const since = last?.intervalEnd ?? new Date(0);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.ledgerEntries)
    .where(and(eq(schema.ledgerEntries.scope, "real"), gt(schema.ledgerEntries.createdAt, since)));
  if (!n) return;
  const r = await publishReceipt();
  log(`receipt ${r.receiptId} finalized (${r.txHash})`);
}

async function retryFailedReceipts(log: (m: string) => void) {
  if (!receiptsConfigured().ok) return;
  const db = await getDb();
  const failed = await db.select().from(schema.economicReceipts).where(eq(schema.economicReceipts.status, "failed")).limit(3);
  for (const r of failed) {
    try {
      await submitReceipt(r.id);
      log(`receipt ${r.receiptId} retried and finalized`);
    } catch {
      /* stays failed; visible in the UI */
    }
  }
}
