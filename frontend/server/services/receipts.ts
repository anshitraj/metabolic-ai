import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { config, explorerTxUrl } from "@/server/config";
import { marginBp } from "@/lib/economics/money";
import { viewFunction } from "@/server/near/rpc";
import { getSystem, publish, audit } from "./core";
import type { StateMemory } from "@/lib/economics/types";
import { activePolicy } from "./economy";

const { economicReceipts, ledgerEntries, usageRequests, chainTransactions } = schema;

/** Canonical JSON: keys sorted recursively, no whitespace. Used for hashing. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

export type ReceiptPayload = {
  receipt_id: string;
  network: string;
  policy_version: number;
  state: string;
  interval_start: string;
  interval_end: string;
  revenue_micro: string;
  expense_micro: string;
  margin_bp: number | null;
  requests: number;
  tier_mix: Record<string, number>;
  ledger_entries: number;
  ledger_root: string;
};

/** Build a receipt over [start, end). No prompts, user ids, or keys go into the payload. */
export async function buildReceipt(start: Date, end: Date): Promise<{ payload: ReceiptPayload; hash: string }> {
  const db = await getDb();
  const entries = await db
    .select({ id: ledgerEntries.id, account: ledgerEntries.account, debit: ledgerEntries.debit, credit: ledgerEntries.credit })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.scope, "real"), gte(ledgerEntries.createdAt, start), lt(ledgerEntries.createdAt, end)))
    .orderBy(asc(ledgerEntries.id));
  let revenue = 0n;
  let expense = 0n;
  for (const e of entries) {
    if (e.account === "revenue:inference") revenue += e.credit - e.debit;
    if (e.account.startsWith("expense:provider:")) expense += e.debit - e.credit;
  }
  const ledgerRoot = sha256Hex(canonicalJson(entries.map((e) => [e.id, e.account.replace(/:[0-9a-f-]{36}$/, ""), e.debit.toString(), e.credit.toString()])));
  const tiers = await db
    .select({ tier: usageRequests.tier, n: sql<number>`count(*)::int` })
    .from(usageRequests)
    .where(and(eq(usageRequests.status, "finalized"), gte(usageRequests.finalizedAt, start), lt(usageRequests.finalizedAt, end)))
    .groupBy(usageRequests.tier);
  const tierMix: Record<string, number> = {};
  let requests = 0;
  for (const t of tiers) {
    tierMix[t.tier ?? "unknown"] = t.n;
    requests += t.n;
  }
  const memory = await getSystem<StateMemory>("state:real");
  const pad = (n: number) => String(n).padStart(2, "0");
  const id = `rcpt_${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}_${pad(end.getUTCHours())}${pad(end.getUTCMinutes())}${pad(end.getUTCSeconds())}`;
  const payload: ReceiptPayload = {
    receipt_id: id,
    network: config.near.network,
    policy_version: (await activePolicy()).version,
    state: memory?.state ?? "ABUNDANCE",
    interval_start: start.toISOString(),
    interval_end: end.toISOString(),
    revenue_micro: revenue.toString(),
    expense_micro: expense.toString(),
    margin_bp: marginBp(revenue, expense),
    requests,
    tier_mix: tierMix,
    ledger_entries: entries.length,
    ledger_root: ledgerRoot,
  };
  return { payload, hash: sha256Hex(canonicalJson(payload)) };
}

export function receiptsConfigured(): { ok: boolean; reason: string | null } {
  if (!config.near.contractId) return { ok: false, reason: "NEAR_CONTRACT_ID is not set" };
  if (!config.near.receiptSignerId || !config.near.receiptSignerKey) return { ok: false, reason: "NEAR_RECEIPT_SIGNER_ID / NEAR_RECEIPT_SIGNER_KEY are not set" };
  return { ok: true, reason: null };
}

/** Build the receipt for everything since the last one and submit it on chain. */
export async function publishReceipt(opts: { actorUserId?: string | null } = {}) {
  const cfg = receiptsConfigured();
  if (!cfg.ok) throw new Error(`On-chain receipts are not configured: ${cfg.reason}.`);
  const db = await getDb();
  const [last] = await db.select().from(economicReceipts).where(eq(economicReceipts.status, "finalized")).orderBy(desc(economicReceipts.intervalEnd)).limit(1);
  const end = new Date();
  const start = last ? last.intervalEnd : new Date(end.getTime() - 24 * 3600_000);
  const { payload } = await buildReceipt(start, end);
  // Canonical buildReceipt remains deterministic; publishing adds a collision-resistant record id.
  payload.receipt_id += `_${randomBytes(4).toString("hex")}`;
  const publishedHash = sha256Hex(canonicalJson(payload));
  const [row] = await db
    .insert(economicReceipts)
    .values({ receiptId: payload.receipt_id, intervalStart: start, intervalEnd: end, payload, hash: publishedHash, status: "pending", network: config.near.network })
    .returning();
  await audit("receipt.build", { actorUserId: opts.actorUserId, target: payload.receipt_id });
  return submitReceipt(row.id);
}

export async function submitReceipt(rowId: string) {
  const db = await getDb();
  const [row] = await db.select().from(economicReceipts).where(eq(economicReceipts.id, rowId));
  if (!row) throw new Error("receipt not found");
  const payload = row.payload as ReceiptPayload;
  try {
    if (row.network !== config.near.network) throw new Error("Receipt network does not match the configured signer network.");
    const expectedCommitment = (commitment: { hash_hex: string; policy_version: number; interval_start?: number; interval_end: number } | null) => !!commitment && commitment.hash_hex === row.hash && commitment.policy_version === payload.policy_version && commitment.interval_start === Math.floor(new Date(payload.interval_start).getTime() / 1000) && commitment.interval_end === Math.floor(new Date(payload.interval_end).getTime() / 1000);
    const already = await viewFunction<{ hash_hex: string; policy_version: number; interval_start?: number; interval_end: number } | null>(config.near.contractId!, "get_receipt", { id: payload.receipt_id });
    if (already) {
      if (!expectedCommitment(already)) throw new Error("An existing on-chain commitment disagrees with this receipt record.");
      await db.update(economicReceipts).set({ status: "finalized", finalizedAt: new Date(), error: null }).where(eq(economicReceipts.id, rowId));
      await audit("receipt.recovered_from_chain", { target: row.receiptId, meta: { hash: row.hash, txHashKnown: !!row.txHash } });
      return { receiptId: payload.receipt_id, status: "finalized" as const, txHash: row.txHash, explorer: row.txHash ? explorerTxUrl(row.txHash) : null, hash: row.hash };
    }
    const { Account } = await import("@near-js/accounts");
    const { JsonRpcProvider } = await import("@near-js/providers");
    const { KeyPairSigner } = await import("@near-js/signers");
    const provider = new JsonRpcProvider({ url: config.near.rpcUrl });
    const signer = KeyPairSigner.fromSecretKey(config.near.receiptSignerKey as `ed25519:${string}`);
    const account = new Account(config.near.receiptSignerId!, provider, signer);
    await db.update(economicReceipts).set({ status: "submitted" }).where(eq(economicReceipts.id, rowId));
    const outcome = await account.callFunctionRaw({
      contractId: config.near.contractId!,
      methodName: "commit_receipt",
      args: {
        id: payload.receipt_id,
        hash_hex: row.hash,
        interval_start: Math.floor(new Date(payload.interval_start).getTime() / 1000),
        interval_end: Math.floor(new Date(payload.interval_end).getTime() / 1000),
        policy_version: payload.policy_version,
      },
      gas: 30_000_000_000_000n,
      waitUntil: "FINAL",
    });
    const txHash = outcome.transaction_outcome.id;
    const failed = typeof outcome.status === "object" && outcome.status !== null && "Failure" in outcome.status;
    if (failed) throw new Error(`commit_receipt failed: ${JSON.stringify((outcome.status as { Failure: unknown }).Failure).slice(0, 300)}`);
    if (outcome.final_execution_status && outcome.final_execution_status !== "FINAL") throw new Error("Receipt transaction has not reached finality.");
    await db.update(economicReceipts).set({ txHash }).where(eq(economicReceipts.id, rowId));
    const committed = await viewFunction<{ hash_hex: string; policy_version: number; interval_start?: number; interval_end: number } | null>(config.near.contractId!, "get_receipt", { id: payload.receipt_id });
    if (!expectedCommitment(committed)) throw new Error("Independent contract read did not confirm this receipt commitment.");
    await db.transaction(async (tx) => {
      await tx.update(economicReceipts).set({ status: "finalized", txHash, finalizedAt: new Date(), error: null }).where(eq(economicReceipts.id, rowId));
      await tx
        .insert(chainTransactions)
        .values({ network: config.near.network, txHash, kind: "receipt", signerId: config.near.receiptSignerId!, receiverId: config.near.contractId!, status: "final", finalizedAt: new Date() })
        .onConflictDoNothing();
    });
    await publish("receipt.finalized", { receiptId: payload.receipt_id, txHash, explorer: explorerTxUrl(txHash), hash: row.hash }, { source: "receipts", entityId: row.id });
    return { receiptId: payload.receipt_id, status: "finalized" as const, txHash, explorer: explorerTxUrl(txHash), hash: row.hash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(economicReceipts).set({ status: "failed", error: message.slice(0, 500) }).where(eq(economicReceipts.id, rowId));
    await publish("receipt.failed", { receiptId: payload.receipt_id, error: message.slice(0, 200) }, { source: "receipts", entityId: row.id });
    throw err;
  }
}

export async function listReceipts(limit = 50) {
  const db = await getDb();
  const rows = await db.select().from(economicReceipts).orderBy(desc(economicReceipts.createdAt)).limit(limit);
  return rows.map(serializeReceipt);
}

export async function getReceipt(receiptId: string) {
  const db = await getDb();
  const [row] = await db.select().from(economicReceipts).where(eq(economicReceipts.receiptId, receiptId));
  return row ? serializeReceipt(row) : null;
}

function serializeReceipt(r: typeof economicReceipts.$inferSelect) {
  return {
    id: r.receiptId,
    status: r.status,
    network: r.network,
    hash: r.hash,
    txHash: r.txHash,
    explorer: r.txHash ? explorerTxUrl(r.txHash) : null,
    payload: r.payload as ReceiptPayload,
    intervalStart: r.intervalStart.toISOString(),
    intervalEnd: r.intervalEnd.toISOString(),
    createdAt: r.createdAt.toISOString(),
    finalizedAt: r.finalizedAt?.toISOString() ?? null,
    error: r.error,
  };
}

/** Independent verification: recompute the payload hash and compare with the contract's stored commitment. */
export async function verifyReceiptOnChain(receiptId: string) {
  const r = await getReceipt(receiptId);
  const recomputed = r ? sha256Hex(canonicalJson(r.payload)) : null;
  let onChain: { hash_hex: string; interval_start?: number; interval_end: number; policy_version: number; committed_at_ns?: string } | null = null;
  let chainError: string | null = null;
  if (config.near.contractId) {
    try {
      onChain = await viewFunction(config.near.contractId, "get_receipt", { id: receiptId });
    } catch (e) {
      chainError = e instanceof Error ? e.message : "view call failed";
    }
  } else chainError = "NEAR_CONTRACT_ID is not set";
  return {
    receiptId,
    found: !!r,
    payload: r?.payload ?? null,
    storedHash: r?.hash ?? null,
    recomputedHash: recomputed,
    onChainHash: onChain?.hash_hex ?? null,
    match: !!recomputed && !!onChain && onChain.hash_hex === recomputed && r?.hash === recomputed && r.network === config.near.network && onChain.policy_version === r.payload.policy_version && onChain.interval_start === Math.floor(new Date(r.payload.interval_start).getTime() / 1000) && onChain.interval_end === Math.floor(new Date(r.payload.interval_end).getTime() / 1000),
    chainError,
    contractId: config.near.contractId ?? null,
    explorer: r?.explorer ?? null,
    network: config.near.network,
  };
}
