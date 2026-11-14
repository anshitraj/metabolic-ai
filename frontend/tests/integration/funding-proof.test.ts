import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
const chain = vi.hoisted(() => ({ txs: new Map<string, unknown>(), commitments: new Map<string, { hash_hex: string; interval_start: number; interval_end: number; policy_version: number }>(), broadcasts: 0 }));
vi.mock("@/server/near/rpc", async (original) => ({ ...await original<typeof import("@/server/near/rpc")>(), txStatus: async (hash: string) => chain.txs.get(hash) ?? null, viewFunction: async (_contract: string, _method: string, args: { id: string }) => chain.commitments.get(args.id) ?? null }));
vi.mock("@near-js/accounts", () => ({ Account: class { async callFunctionRaw({ args }: { args: { id: string; hash_hex: string; interval_start: number; interval_end: number; policy_version: number } }) { chain.broadcasts++; chain.commitments.set(args.id, args); return { final_execution_status: "FINAL", status: { SuccessValue: "" }, transaction_outcome: { id: "8Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz" } }; } } }));
vi.mock("@near-js/providers", () => ({ JsonRpcProvider: class {} }));
vi.mock("@near-js/signers", () => ({ KeyPairSigner: { fromSecretKey: () => ({}) } }));

import { getDb, schema } from "@/server/db/client";
import { config } from "@/server/config";
import { createDepositIntent, verifyDeposit } from "@/server/services/treasury";
import { getBalance } from "@/server/services/billing";
import { buildReceipt, canonicalJson, sha256Hex, submitReceipt, verifyReceiptOnChain } from "@/server/services/receipts";
import { DEFAULT_POLICY } from "@/server/economics/policy";
import { invalidatePolicyCache, serializePolicy } from "@/server/services/economy";
let user: { id: string; accountId: string };
let other: { id: string; accountId: string };
let n = 0;
const hash = () => `${"123456789ABCDEFGHJKLMNPQRSTUVWXYZ"[++n]}Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz`;
function tx(h: string, memo: string, { amount = "1000000000000000000000000", signer = user.accountId, final = "FINAL", emitter = "proof.testnet", failed = false } = {}) {
  return { status: { SuccessValue: "" }, final_execution_status: final, transaction: { hash: h, signer_id: signer, receiver_id: "proof.testnet", actions: [{ FunctionCall: { method_name: "deposit", args: Buffer.from(JSON.stringify({ memo })).toString("base64"), deposit: amount, gas: 30000000000000 } }] }, transaction_outcome: { block_hash: "block", outcome: { status: {} } }, receipts_outcome: [{ outcome: { executor_id: emitter, status: failed ? { Failure: "contract failed" } : { SuccessValue: "" }, logs: [`EVENT_JSON:${JSON.stringify({ standard: "metabolic", version: "1.0.0", event: "deposit", data: [{ account_id: signer, amount, memo }] })}`] } }] };
}
beforeAll(async () => {
  config.near.contractId = "proof.testnet"; config.near.receiptSignerId = "proof.testnet"; config.near.receiptSignerKey = "ed25519:mock";
  const db = await getDb();
  const [a] = await db.insert(schema.users).values({ nearAccountId: "funding-customer.testnet" }).returning();
  const [b] = await db.insert(schema.users).values({ nearAccountId: "funding-outsider.testnet" }).returning();
  user = { id: a.id, accountId: a.nearAccountId }; other = { id: b.id, accountId: b.nearAccountId };
  await db.insert(schema.priceSnapshots).values({ microPerUnit: 3_000_000n, source: "test", observedAt: new Date(Date.now() + 3600_000) });
});

describe("intent-bound finalized deposits", () => {
  it("credits concurrent verification of one intent and transaction exactly once", async () => {
    const intent = await createDepositIntent(user, "1"); const h = hash(); chain.txs.set(h, tx(h, intent.intentId));
    const before = await getBalance(user.id);
    const results = await Promise.allSettled([verifyDeposit(user, h, "credits", intent.intentId), verifyDeposit(user, h, "credits", intent.intentId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getBalance(user.id)).available - before.available).toBe(3_000_000n);
    const second = hash(); chain.txs.set(second, tx(second, intent.intentId));
    await expect(verifyDeposit(user, second, "credits", intent.intentId)).rejects.toMatchObject({ code: "INTENT_USED" });
  });
  it("rejects mismatched amount, memo, owner and purpose", async () => {
    const intent = await createDepositIntent(user, "1");
    const a = hash(); chain.txs.set(a, tx(a, intent.intentId, { amount: "2000000000000000000000000" }));
    await expect(verifyDeposit(user, a, "credits", intent.intentId)).rejects.toMatchObject({ code: "INTENT_MISMATCH" });
    const b = hash(); chain.txs.set(b, tx(b, "another-intent"));
    await expect(verifyDeposit(user, b, "credits", intent.intentId)).rejects.toMatchObject({ code: "INTENT_MISMATCH" });
    const c = hash(); chain.txs.set(c, tx(c, intent.intentId, { signer: other.accountId }));
    await expect(verifyDeposit(other, c, "credits", intent.intentId)).rejects.toMatchObject({ code: "INTENT_NOT_FOUND" });
    const d = hash(); chain.txs.set(d, tx(d, intent.intentId));
    await expect(verifyDeposit(user, d, "capital", intent.intentId)).rejects.toMatchObject({ code: "INTENT_MISMATCH" });
  });
  it("rejects unfinalized transactions, failed receipts and spoofed contract events", async () => {
    const intent = await createDepositIntent(user, "1");
    const a = hash(); chain.txs.set(a, tx(a, intent.intentId, { final: "EXECUTED_OPTIMISTIC" }));
    await expect(verifyDeposit(user, a, "credits", intent.intentId)).rejects.toMatchObject({ code: "NOT_FINAL" });
    const b = hash(); chain.txs.set(b, tx(b, intent.intentId, { failed: true }));
    await expect(verifyDeposit(user, b, "credits", intent.intentId)).rejects.toMatchObject({ code: "FAILED" });
    const c = hash(); chain.txs.set(c, tx(c, intent.intentId, { emitter: "impostor.testnet" }));
    await expect(verifyDeposit(user, c, "credits", intent.intentId)).rejects.toMatchObject({ code: "DEPOSIT_EVENT_MISSING" });
  });
  it("rejects intent network changes and does not consume mismatched intents", async () => {
    const intent = await createDepositIntent(user, "1");
    const db = await getDb();
    await db.update(schema.depositIntents).set({ network: "mainnet" }).where(eq(schema.depositIntents.id, intent.intentId));
    const h = hash(); chain.txs.set(h, tx(h, intent.intentId));
    await expect(verifyDeposit(user, h, "credits", intent.intentId)).rejects.toMatchObject({ code: "INTENT_MISMATCH" });
    const [saved] = await db.select().from(schema.depositIntents).where(eq(schema.depositIntents.id, intent.intentId));
    expect(saved.consumedTxHash).toBeNull();
  });
});

describe("accounting commitments", () => {
  it("uses the current policy version and verifies the independently stored commitment", async () => {
    const db = await getDb();
    await db.insert(schema.policyConfigs).values({ version: 9, active: true, config: serializePolicy(DEFAULT_POLICY) }); invalidatePolicyCache();
    const start = new Date(Date.now() - 1000), end = new Date(Date.now() + 1000);
    const built = await buildReceipt(start, end);
    expect(built.payload.policy_version).toBe(9);
    built.payload.receipt_id = "rcpt_20261114_120000_abcdef01";
    const hash = sha256Hex(canonicalJson(built.payload));
    const [row] = await db.insert(schema.economicReceipts).values({ receiptId: built.payload.receipt_id, intervalStart: start, intervalEnd: end, payload: built.payload, hash, status: "pending", network: "testnet" }).returning();
    const result = await submitReceipt(row.id);
    expect(result.status).toBe("finalized");
    expect((await verifyReceiptOnChain(row.receiptId)).match).toBe(true);
    const broadcasts = chain.broadcasts;
    // A restart after chain commitment can recover by reading the record without re-broadcasting.
    await db.update(schema.economicReceipts).set({ status: "failed" }).where(eq(schema.economicReceipts.id, row.id));
    expect((await submitReceipt(row.id)).status).toBe("finalized");
    expect(chain.broadcasts).toBe(broadcasts);
    chain.commitments.get(row.receiptId)!.policy_version = 8;
    expect((await verifyReceiptOnChain(row.receiptId)).match).toBe(false);
    await expect(submitReceipt(row.id)).rejects.toThrow(/disagrees/);
  });
});
