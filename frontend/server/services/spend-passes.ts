import "server-only";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Executor } from "@/server/db/client";
import { allModels, type RegistryModel } from "@/server/economics/registry";
import { newApiKeySecret } from "./auth";
import { audit, publish } from "./core";
import { release } from "./billing";

const { apiKeys, spendPasses, usageRequests } = schema;
const micro = z.string().regex(/^[1-9]\d{0,14}$/, "Use a positive amount in micro-USD (1000000 = $1).");
export const PassInput = z.object({
  name: z.string().trim().min(1).max(60),
  agentName: z.string().trim().min(1).max(80),
  totalBudget: micro,
  maxPerRequest: micro,
  allowedModels: z.array(z.string().max(160)).max(40).default([]),
  allowedProviders: z.array(z.string().max(40)).max(10).default([]),
  allowedTiers: z.array(z.enum(["premium", "standard", "economy"])).min(1).max(3).default(["premium", "standard", "economy"]),
  expiresAt: z.iso.datetime({ offset: true }),
  apiKeyId: z.string().uuid().optional(),
}).refine((v) => BigInt(v.maxPerRequest) <= BigInt(v.totalBudget), { message: "The per-request limit cannot exceed the total budget.", path: ["maxPerRequest"] });

export type SpendPass = typeof spendPasses.$inferSelect;
export class SpendPassError extends Error {
  constructor(readonly code: string, message: string, readonly passId?: string) { super(message); }
}

export function passStatus(p: SpendPass, now = Date.now()) {
  if (p.revokedAt) return "revoked";
  if (p.expiresAt.getTime() <= now) return "expired";
  if (p.spent >= p.totalBudget) return "exhausted";
  return "active";
}

export function assertPassActive(p: SpendPass) {
  const status = passStatus(p);
  if (status !== "active") throw new SpendPassError(`PASS_${status.toUpperCase()}`, `This Spend Pass is ${status}. Ask the workspace owner for a new pass.`, p.id);
  if (p.totalBudget - p.spent - p.reserved <= 0n) throw new SpendPassError("PASS_BUDGET", "This pass has no unreserved budget. Wait for active requests to settle or ask the owner for a new pass.", p.id);
}

export function passAllows(p: SpendPass, model: RegistryModel) {
  return p.allowedTiers.includes(model.tier)
    && (!p.allowedModels.length || p.allowedModels.includes(model.id))
    && (!p.allowedProviders.length || p.allowedProviders.includes(model.provider));
}

export function passView(p: SpendPass) {
  return { ...p, totalBudget: p.totalBudget.toString(), maxPerRequest: p.maxPerRequest.toString(), spent: p.spent.toString(), reserved: p.reserved.toString(), remaining: (p.totalBudget - p.spent - p.reserved).toString(), status: passStatus(p), expiresAt: p.expiresAt.toISOString(), revokedAt: p.revokedAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString() };
}

export async function createSpendPass(userId: string, raw: unknown) {
  const b = PassInput.parse(raw);
  if (new Date(b.expiresAt).getTime() <= Date.now()) throw new SpendPassError("PASS_EXPIRY", "Choose an expiration in the future.");
  const catalog = allModels();
  if (b.allowedModels.some((id) => !catalog.some((m) => m.id === id)) || b.allowedProviders.some((provider) => !catalog.some((m) => m.provider === provider))) throw new SpendPassError("PASS_MODELS", "Choose models and providers from the current catalog.");
  if (!catalog.some((m) => b.allowedTiers.includes(m.tier) && (!b.allowedModels.length || b.allowedModels.includes(m.id)) && (!b.allowedProviders.length || b.allowedProviders.includes(m.provider)))) throw new SpendPassError("PASS_MODELS", "These restrictions do not allow any model. Choose at least one compatible model, tier and provider.");
  const db = await getDb();
  const secret = b.apiKeyId ? null : newApiKeySecret();
  const result = await db.transaction(async (tx) => {
    if (b.apiKeyId) {
      const [key] = await tx.select().from(apiKeys).where(and(eq(apiKeys.id, b.apiKeyId), eq(apiKeys.userId, userId))).for("update");
      if (!key || key.revokedAt || key.spendPassId) throw new SpendPassError("PASS_KEY", "Choose your own active, unbound API key. A bound key cannot be reassigned.");
    }
    const [p] = await tx.insert(spendPasses).values({ userId, name: b.name, agentName: b.agentName, totalBudget: BigInt(b.totalBudget), maxPerRequest: BigInt(b.maxPerRequest), allowedModels: [...new Set(b.allowedModels)], allowedProviders: [...new Set(b.allowedProviders)], allowedTiers: [...new Set(b.allowedTiers)], expiresAt: new Date(b.expiresAt) }).returning();
    let keyId = b.apiKeyId;
    if (keyId) await tx.update(apiKeys).set({ spendPassId: p.id }).where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));
    else {
      const [key] = await tx.insert(apiKeys).values({ userId, name: `${b.agentName} · ${b.name}`.slice(0, 60), prefix: secret!.prefix, hash: secret!.hash, spendPassId: p.id }).returning();
      keyId = key.id;
    }
    await tx.insert(schema.auditEvents).values({ actorUserId: userId, action: "spend_pass.create", target: p.id, meta: { apiKeyId: keyId, policyVersion: p.policyVersion } });
    return { pass: passView(p), apiKeyId: keyId };
  });
  return { ...result, secret: secret?.secret ?? null };
}

export async function listSpendPasses(userId: string) {
  const db = await getDb();
  return (await db.select().from(spendPasses).where(eq(spendPasses.userId, userId)).orderBy(desc(spendPasses.createdAt))).map(passView);
}

export async function getSpendPass(userId: string, id: string) {
  const db = await getDb();
  const [p] = await db.select().from(spendPasses).where(and(eq(spendPasses.id, id), eq(spendPasses.userId, userId)));
  if (!p) return null;
  const activity = await db.select().from(usageRequests).where(and(eq(usageRequests.spendPassId, id), eq(usageRequests.userId, userId))).orderBy(desc(usageRequests.createdAt)).limit(100);
  const receipts = await db.select({ id: schema.economicReceipts.receiptId, start: schema.economicReceipts.intervalStart, end: schema.economicReceipts.intervalEnd, status: schema.economicReceipts.status }).from(schema.economicReceipts).orderBy(desc(schema.economicReceipts.intervalEnd)).limit(100);
  const decisions = activity.length ? await db.select().from(schema.routingDecisions).where(inArray(schema.routingDecisions.usageRequestId, activity.map((u) => u.id))).orderBy(desc(schema.routingDecisions.createdAt)) : [];
  const rejected = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.actorUserId, userId), eq(schema.auditEvents.target, id), eq(schema.auditEvents.action, "spend_pass.rejected"))).orderBy(desc(schema.auditEvents.createdAt)).limit(30);
  return { pass: passView(p), rejected: rejected.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), ...(r.meta as { code: string; message: string; policyVersion: number }) })), activity: activity.map((u) => ({ id: u.id, status: u.status, model: u.modelId, charge: u.charge.toString(), providerCost: u.cost.toString(), costSource: u.providerCostSource ?? (u.costIsEstimated ? "estimated" : "provider_usage"), reserved: u.reserved.toString(), partial: u.partial, error: u.error, policyVersion: u.passPolicyVersion, explanation: decisions.find((d) => d.usageRequestId === u.id)?.explanation ?? null, recoveryRequired: u.recoveryRequired, at: u.createdAt.toISOString(), receipts: receipts.filter((r) => u.finalizedAt && u.finalizedAt >= r.start && u.finalizedAt < r.end).map((r) => ({ id: r.id, status: r.status })) })) };
}

export async function revokeSpendPass(userId: string, id: string) {
  const db = await getDb();
  const [p] = await db.update(spendPasses).set({ revokedAt: new Date() }).where(and(eq(spendPasses.id, id), eq(spendPasses.userId, userId))).returning();
  if (!p) return null;
  await audit("spend_pass.revoke", { actorUserId: userId, target: id, meta: { admittedReservationsRemainValid: true } });
  return passView(p);
}

/** The credential supplies the binding. Callers cannot select, omit or replace it. */
export async function credentialPass(userId: string, apiKeyId?: string | null, tx?: Executor): Promise<SpendPass | null> {
  if (!apiKeyId) return null;
  const db = tx ?? await getDb();
  const query = db.select().from(apiKeys).where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)));
  const [key] = await (tx ? query.for("update") : query);
  if (!key || key.revokedAt || !key.scopes.includes("inference")) throw new SpendPassError("INVALID_API_KEY", "This app API key is revoked, invalid or cannot run inference.");
  if (!key.spendPassId) return null;
  const passQuery = db.select().from(spendPasses).where(and(eq(spendPasses.id, key.spendPassId), eq(spendPasses.userId, userId)));
  const [p] = await (tx ? passQuery.for("update") : passQuery);
  if (!p) throw new SpendPassError("PASS_NOT_FOUND", "The credential's Spend Pass is unavailable for this workspace.");
  assertPassActive(p);
  return p;
}

export async function reservePass(tx: Executor, p: SpendPass, model: RegistryModel, amount: bigint) {
  assertPassActive(p);
  if (!passAllows(p, model)) throw new SpendPassError("PASS_MODEL", "This model is not allowed by the agent's Spend Pass.");
  if (amount > p.maxPerRequest) throw new SpendPassError("PASS_REQUEST_CAP", "The maximum charge exceeds this pass's per-request limit. Ask the owner for a different pass or use a cheaper model.");
  if (amount > p.totalBudget - p.spent - p.reserved) throw new SpendPassError("PASS_BUDGET", "This Spend Pass has insufficient unreserved budget for the request.");
  await tx.update(spendPasses).set({ reserved: sql`${spendPasses.reserved} + ${amount}` }).where(eq(spendPasses.id, p.id));
}

/** Lock pass before credit balance in every finalization/recovery path. Revocation does not erase admitted authorization. */
export async function lockAdmittedPass(tx: Executor, passId: string | null) {
  if (passId) await tx.select({ id: spendPasses.id }).from(spendPasses).where(eq(spendPasses.id, passId)).for("update");
}

export async function settlePass(tx: Executor, passId: string | null, reserved: bigint, charge: bigint) {
  if (!passId) return;
  if (charge < 0n || charge > reserved) throw new Error("Pass charge exceeds admitted authorization");
  await tx.update(spendPasses).set({ reserved: sql`${spendPasses.reserved} - ${reserved}`, spent: sql`${spendPasses.spent} + ${charge}` }).where(eq(spendPasses.id, passId));
}

/** Expired leases are ambiguous after a crash: release credits once, record unknown provider expense, never replay. */
export async function recoverStaleReservations(now = new Date()) {
  const db = await getDb();
  const rows = await db.select().from(usageRequests).where(and(sql`${usageRequests.status} in ('reserved','streaming')`, or(lt(usageRequests.reservationExpiresAt, now), and(isNull(usageRequests.reservationExpiresAt), lt(usageRequests.createdAt, new Date(now.getTime() - 180_000))))));
  let recovered = 0;
  for (const candidate of rows) {
    await db.transaction(async (tx) => {
      await lockAdmittedPass(tx, candidate.spendPassId);
      const [u] = await tx.select().from(usageRequests).where(eq(usageRequests.id, candidate.id)).for("update");
      if (!u || !["reserved", "streaming"].includes(u.status) || (u.reservationExpiresAt ?? new Date(u.createdAt.getTime() + 180_000)) >= now) return;
      await release(tx, u.userId, u.reserved);
      await settlePass(tx, u.spendPassId, u.reserved, 0n);
      await tx.update(usageRequests).set({ status: "refunded", charge: 0n, finalizedAt: now, recoveryRequired: true, providerCostSource: "unknown_after_restart", costIsEstimated: true, error: "Execution lease expired. Reservation released; provider expense requires reconciliation. This request will not be replayed." }).where(eq(usageRequests.id, u.id));
      await tx.insert(schema.auditEvents).values({ actorUserId: u.userId, action: "inference.reservation_recovered", target: u.id, meta: { passId: u.spendPassId, released: u.reserved.toString(), providerCostUnknown: true } });
      recovered++;
    });
  }
  return recovered;
}

/** Private owner audit plus a public, prompt-free rejection effect. */
export async function recordPassRejection(userId: string, passId: string | null | undefined, code: string, message: string, policyVersion?: number) {
  if (passId) await audit("spend_pass.rejected", { actorUserId: userId, target: passId, meta: { code, message, policyVersion: policyVersion ?? 1 } });
  await publish("inference.failed", { error: code, message }, { source: "gateway" });
}
