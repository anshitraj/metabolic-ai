import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-only-never-sent";
  return { fail: "gemini", calls: [] as string[], onFailure: null as (() => Promise<void>) | null };
});
vi.mock("@/server/gateway/adapters", async (original) => {
  const actual = await original<typeof import("@/server/gateway/adapters")>();
  return { ...actual, adapterFor: (name: string) => ({ async *stream() {
    provider.calls.push(name);
    if (name === provider.fail) { await provider.onFailure?.(); throw new actual.ProviderError("Temporary outage", "unavailable", true); }
    yield { type: "text" as const, text: "A fallback answer." };
    yield { type: "done" as const, usage: { inTokens: 40, outTokens: 5 }, servedModel: "mock", stopReason: "STOP" };
  } }) };
});
import { getDb, schema } from "@/server/db/client";
import { creditDeposit, getBalance, recordCapital } from "@/server/services/billing";
import { createSpendPass, getSpendPass, revokeSpendPass } from "@/server/services/spend-passes";
import { runInference, type InferenceEvent } from "@/server/services/inference";
let owner: string;
beforeAll(async () => {
  const db = await getDb();
  const [user] = await db.insert(schema.users).values({ nearAccountId: "failover-owner.testnet" }).returning(); owner = user.id;
  await db.insert(schema.priceSnapshots).values({ microPerUnit: 3_000_000n, source: "test", observedAt: new Date(Date.now() + 3600_000) });
  await db.transaction(async (tx) => { await recordCapital(tx, owner, 100_000_000n, "capital"); await creditDeposit(tx, owner, 10_000_000n, "credit"); });
});
beforeEach(() => { provider.calls = []; provider.onFailure = null; });
async function run(keyId: string) {
  const events: InferenceEvent[] = [];
  for await (const e of runInference({ userId: owner, apiKeyId: keyId, channel: "api", idempotencyKey: crypto.randomUUID(), maxOutputTokens: 1024, messages: [{ role: "user", content: "Hello" }], signal: new AbortController().signal })) events.push(e);
  return events;
}
describe("Spend Pass failover authorization", () => {
  it("allows an eligible cheaper fallback within an admitted reservation, including after revocation", async () => {
    provider.fail = "gemini";
    const p = await createSpendPass(owner, { name: "Fallback permission", agentName: "Fallback agent", totalBudget: "100000", maxPerRequest: "50000", allowedModels: ["gemini:gemini-3.1-pro-preview", "anthropic:claude-sonnet-5-5"], expiresAt: new Date(Date.now() + 86400_000).toISOString() });
    provider.onFailure = async () => { await revokeSpendPass(owner, p.pass.id); };
    const result = await run(p.apiKeyId!);
    expect(provider.calls).toEqual(["gemini", "anthropic"]);
    expect(result.some((e) => e.type === "failover")).toBe(true);
    expect(result.find((e) => e.type === "final")).toMatchObject({ model: "anthropic:claude-sonnet-5-5" });
    const pass = await getSpendPass(owner, p.pass.id);
    expect(pass?.pass.status).toBe("revoked"); expect(pass?.pass.reserved).toBe("0");
    expect(pass?.activity).toHaveLength(1);
  });
  it("does not start a more expensive fallback that exceeds the already-reserved authorization", async () => {
    provider.fail = "anthropic";
    const p = await createSpendPass(owner, { name: "Small fallback permission", agentName: "Small agent", totalBudget: "100000", maxPerRequest: "6000", allowedModels: ["anthropic:claude-haiku-5-5", "gemini:gemini-3.1-flash-lite"], expiresAt: new Date(Date.now() + 86400_000).toISOString() });
    const before = await getBalance(owner);
    const result = await run(p.apiKeyId!);
    expect(provider.calls).toEqual(["anthropic"]);
    expect(result.find((e) => e.type === "error")).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(await getBalance(owner)).toEqual(before);
    expect((await getSpendPass(owner, p.pass.id))?.pass.spent).toBe("0");
  });
});
