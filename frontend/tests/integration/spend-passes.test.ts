import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const provider = vi.hoisted(() => ({ calls: 0, mode: "ok", gate: null as Promise<void> | null, started: null as (() => void) | null }));
vi.mock("@/server/gateway/adapters", async (original) => {
  const actual = await original<typeof import("@/server/gateway/adapters")>();
  return { ...actual, adapterFor: () => ({ async *stream() {
    provider.calls++;
    provider.started?.();
    if (provider.gate) await provider.gate;
    if (provider.mode === "fail") throw new actual.ProviderError("Provider unavailable", "unavailable", true);
    yield { type: "text" as const, text: "A short answer." };
    if (provider.mode === "interrupt") throw new actual.ProviderError("aborted", "aborted", false);
    yield { type: "done" as const, usage: { inTokens: 40, outTokens: provider.mode === "overage" ? 10_000_000 : 5 }, servedModel: "mock", stopReason: "STOP" };
  } }) };
});

import { getDb, schema } from "@/server/db/client";
import { creditDeposit, getBalance, recordCapital, reserve } from "@/server/services/billing";
import { createSpendPass, credentialPass, getSpendPass, recoverStaleReservations, reservePass, revokeSpendPass, settlePass } from "@/server/services/spend-passes";
import { findModel } from "@/server/economics/registry";
import { runInference, type InferenceEvent } from "@/server/services/inference";
import { newApiKeySecret } from "@/server/services/auth";

let owner: string;
let outsider: string;
const future = () => new Date(Date.now() + 86400_000).toISOString();
const makePass = (overrides: Record<string, unknown> = {}) => createSpendPass(owner, { name: "Research allowance", agentName: "Research agent", totalBudget: "100000", maxPerRequest: "5000", allowedProviders: ["gemini"], allowedTiers: ["economy"], expiresAt: future(), ...overrides });
async function run(keyId: string, idem = crypto.randomUUID(), userId = owner) {
  const events: InferenceEvent[] = [];
  for await (const ev of runInference({ userId, apiKeyId: keyId, channel: "api", idempotencyKey: idem, messages: [{ role: "user", content: "Hello" }], maxOutputTokens: 128, signal: new AbortController().signal })) events.push(ev);
  return events;
}

beforeAll(async () => {
  const db = await getDb();
  const [a] = await db.insert(schema.users).values({ nearAccountId: "pass-owner.testnet" }).returning();
  const [b] = await db.insert(schema.users).values({ nearAccountId: "pass-outsider.testnet" }).returning();
  owner = a.id; outsider = b.id;
  await db.insert(schema.priceSnapshots).values({ microPerUnit: 3_000_000n, source: "test", observedAt: new Date(Date.now() + 3600_000) });
  await db.transaction(async (tx) => { await recordCapital(tx, owner, 100_000_000n, "test-capital"); await creditDeposit(tx, owner, 10_000_000n, "test-credit"); });
});
beforeEach(() => { provider.calls = 0; provider.mode = "ok"; provider.gate = null; provider.started = null; });

describe("Spend Pass authorization", () => {
  it("issues a bound credential once and settles actual spend against workspace credits", async () => {
    const p = await makePass();
    expect(p.secret).toMatch(/^mk_test_/);
    const before = await getBalance(owner);
    const events = await run(p.apiKeyId!);
    const final = events.find((e) => e.type === "final");
    expect(final?.type).toBe("final");
    if (final?.type !== "final") throw new Error("Missing final");
    expect(final.spendPass?.id).toBe(p.pass.id);
    expect(before.available - (await getBalance(owner)).available).toBe(BigInt(final.charge));
    const detail = await getSpendPass(owner, p.pass.id);
    expect(detail?.pass.spent).toBe(final.charge);
    expect(detail?.pass.reserved).toBe("0");
    expect(detail?.activity[0].costSource).toBe("provider_usage");
  });

  it("serializes concurrent reservations near the total cap", async () => {
    const p = await makePass({ totalBudget: "1500", maxPerRequest: "1500" });
    let unblock!: () => void;
    provider.gate = new Promise<void>((r) => { unblock = r; });
    const started = new Promise<void>((r) => { provider.started = r; });
    const first = run(p.apiKeyId!);
    await started;
    const second = await run(p.apiKeyId!);
    expect(second.find((e) => e.type === "error")).toMatchObject({ code: expect.stringMatching(/^PASS_/) });
    expect(provider.calls).toBe(1);
    unblock(); await first;
    const view = await getSpendPass(owner, p.pass.id);
    expect(BigInt(view!.pass.spent) + BigInt(view!.pass.reserved)).toBeLessThanOrEqual(1500n);
  });

  it("blocks new work after revocation while admitted work settles", async () => {
    const p = await makePass();
    let unblock!: () => void;
    provider.gate = new Promise<void>((r) => { unblock = r; });
    const started = new Promise<void>((r) => { provider.started = r; });
    const first = run(p.apiKeyId!);
    await started;
    await revokeSpendPass(owner, p.pass.id);
    expect((await run(p.apiKeyId!))[0]).toMatchObject({ code: "PASS_REVOKED" });
    expect(provider.calls).toBe(1);
    unblock(); expect((await first).some((e) => e.type === "final")).toBe(true);
    expect((await getSpendPass(owner, p.pass.id))?.pass.reserved).toBe("0");
  });

  it("blocks expired and exhausted passes before provider invocation", async () => {
    const db = await getDb();
    const expired = await makePass();
    await db.update(schema.spendPasses).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.spendPasses.id, expired.pass.id));
    expect((await run(expired.apiKeyId!))[0]).toMatchObject({ code: "PASS_EXPIRED" });
    const exhausted = await makePass();
    await db.update(schema.spendPasses).set({ spent: BigInt(exhausted.pass.totalBudget) }).where(eq(schema.spendPasses.id, exhausted.pass.id));
    expect((await run(exhausted.apiKeyId!))[0]).toMatchObject({ code: "PASS_EXHAUSTED" });
    expect(provider.calls).toBe(0);
  });

  it("intersects tier, model and provider restrictions", async () => {
    const p = await makePass({ allowedModels: ["gemini:gemini-3.1-flash-lite"] });
    const events: InferenceEvent[] = [];
    for await (const ev of runInference({ userId: owner, apiKeyId: p.apiKeyId, channel: "api", idempotencyKey: crypto.randomUUID(), tier: "premium", messages: [{ role: "user", content: "Hello" }], signal: new AbortController().signal })) events.push(ev);
    expect(events[0].type).toBe("error");
    expect(provider.calls).toBe(0);
  });

  it("uses a cheaper eligible model when the maximum authorized charge excludes premium", async () => {
    const p = await makePass({ maxPerRequest: "20000", allowedTiers: ["premium", "standard", "economy"] });
    const events: InferenceEvent[] = [];
    for await (const ev of runInference({ userId: owner, apiKeyId: p.apiKeyId, channel: "api", idempotencyKey: crypto.randomUUID(), messages: [{ role: "user", content: "Hello" }], signal: new AbortController().signal })) events.push(ev);
    const meta = events.find((e) => e.type === "meta");
    expect(meta?.type === "meta" && meta.model.tier).toBe("economy");
  });

  it("isolates workspaces and rejects foreign or already-bound keys", async () => {
    const p = await makePass();
    expect(await getSpendPass(outsider, p.pass.id)).toBeNull();
    expect(await revokeSpendPass(outsider, p.pass.id)).toBeNull();
    await expect(credentialPass(outsider, p.apiKeyId)).rejects.toMatchObject({ code: "INVALID_API_KEY" });
    await expect(makePass({ apiKeyId: p.apiKeyId })).rejects.toMatchObject({ code: "PASS_KEY" });
    const key = newApiKeySecret();
    const db = await getDb();
    const [foreign] = await db.insert(schema.apiKeys).values({ userId: outsider, name: "Foreign", prefix: key.prefix, hash: key.hash }).returning();
    await expect(makePass({ apiKeyId: foreign.id })).rejects.toMatchObject({ code: "PASS_KEY" });
    await expect(db.update(schema.apiKeys).set({ spendPassId: null }).where(eq(schema.apiKeys.id, p.apiKeyId!))).rejects.toThrow();
  });

  it("does not execute or charge an idempotent request twice", async () => {
    const p = await makePass();
    const id = crypto.randomUUID();
    await run(p.apiKeyId!, id);
    expect((await run(p.apiKeyId!, id))[0]).toMatchObject({ code: "DUPLICATE_REQUEST" });
    expect(provider.calls).toBe(1);
    expect((await getSpendPass(owner, p.pass.id))?.activity).toHaveLength(1);
  });

  it("releases failed requests without charging and flags unknown provider expense", async () => {
    const p = await makePass();
    provider.mode = "fail";
    const before = await getBalance(owner);
    await run(p.apiKeyId!);
    expect(await getBalance(owner)).toEqual(before);
    const detail = await getSpendPass(owner, p.pass.id);
    expect(detail?.pass.reserved).toBe("0");
    expect(detail?.pass.spent).toBe("0");
    expect(detail?.activity[0]).toMatchObject({ recoveryRequired: true, costSource: "unknown_failed_attempt" });
  });

  it("settles a partial answer after interruption and releases the remainder", async () => {
    const p = await makePass(); provider.mode = "interrupt";
    const events = await run(p.apiKeyId!);
    expect(events.find((e) => e.type === "final")).toMatchObject({ partial: true, costIsEstimated: true });
    expect((await getSpendPass(owner, p.pass.id))?.pass.reserved).toBe("0");
  });

  it("caps unexpected provider overages at the admitted authorization", async () => {
    const p = await makePass(); provider.mode = "overage";
    const events = await run(p.apiKeyId!);
    const meta = events.find((e) => e.type === "meta");
    const final = events.find((e) => e.type === "final");
    expect(final).toMatchObject({ providerOverage: true });
    if (meta?.type !== "meta" || final?.type !== "final") throw new Error("Missing billing events");
    expect(BigInt(final.charge)).toBeLessThanOrEqual(BigInt(meta.reserved));
    expect((await getSpendPass(owner, p.pass.id))?.activity[0].recoveryRequired).toBe(true);
  });

  it("reconciles an abandoned reservation exactly once after a process restart", async () => {
    const p = await makePass();
    const db = await getDb();
    const before = await getBalance(owner);
    await db.transaction(async (tx) => {
      const locked = await credentialPass(owner, p.apiKeyId, tx);
      await reservePass(tx, locked!, findModel("gemini:gemini-3.1-flash-lite")!, 1000n);
      await reserve(tx, owner, 1000n);
      await tx.insert(schema.usageRequests).values({ userId: owner, apiKeyId: p.apiKeyId, spendPassId: p.pass.id, passPolicyVersion: 1, idempotencyKey: crypto.randomUUID(), channel: "api", status: "streaming", reserved: 1000n, reservationExpiresAt: new Date(Date.now() - 1000) });
    });
    expect(await recoverStaleReservations()).toBe(1);
    expect(await recoverStaleReservations()).toBe(0);
    expect(await getBalance(owner)).toEqual(before);
    expect((await getSpendPass(owner, p.pass.id))?.pass.reserved).toBe("0");
    // Refuse over-reservation settlement instead of silently extending authorization.
    await expect(db.transaction((tx) => settlePass(tx, p.pass.id, 100n, 101n))).rejects.toThrow(/exceeds/);
  });
});
