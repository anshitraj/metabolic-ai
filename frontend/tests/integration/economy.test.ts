import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

// ---- Mocks: a controllable provider and a fake NEAR RPC ----

type Behaviour = { kind: "ok"; text: string; usage: { inTokens: number; outTokens: number } | null } | { kind: "fail" } | { kind: "slow" };
const provider = { behaviour: { kind: "ok", text: "Hello from the mock model.", usage: { inTokens: 120, outTokens: 40 } } as Behaviour };

vi.mock("@/server/gateway/adapters", async (orig) => {
  const real = await orig<typeof import("@/server/gateway/adapters")>();
  return {
    ...real,
    adapterFor: () => ({
      async *stream() {
        const b = provider.behaviour;
        if (b.kind === "fail") throw new real.ProviderError("mock provider down", "unavailable", true);
        if (b.kind === "slow") await new Promise((r) => setTimeout(r, 50));
        const text = b.kind === "ok" ? b.text : "slow answer";
        for (const w of text.split(" ")) yield { type: "text" as const, text: w + " " };
        yield { type: "done" as const, usage: b.kind === "ok" ? b.usage : { inTokens: 50, outTokens: 10 }, servedModel: "mock", stopReason: "end_turn" };
      },
      async health() {
        return { ok: true, latencyMs: 1 };
      },
    }),
  };
});

const chain = { txs: new Map<string, unknown>() };
vi.mock("@/server/near/rpc", async (orig) => {
  const real = await orig<typeof import("@/server/near/rpc")>();
  return {
    ...real,
    txStatus: async (hash: string) => (chain.txs.get(hash) as never) ?? null,
    viewAccount: async () => ({ amount: "0", locked: "0", storage_usage: 0 }),
  };
});

import { getDb, schema } from "@/server/db/client";
import { creditDeposit, getBalance, recordCapital } from "@/server/services/billing";
import { runInference, type InferenceEvent } from "@/server/services/inference";
import { evaluateReal, metricsSeries, overview } from "@/server/services/economy";
import { verifyDeposit, DepositError } from "@/server/services/treasury";
import { applyAction, createScenario, getScenario } from "@/server/services/simulation";
import { buildReceipt, canonicalJson, sha256Hex } from "@/server/services/receipts";
import { setSystem } from "@/server/services/core";

const $ = (n: number) => BigInt(Math.round(n * 1_000_000));
let customer: string;
let operator: string;

async function run(userId: string, key = crypto.randomUUID(), content = "hi") {
  const out: InferenceEvent[] = [];
  for await (const ev of runInference({ userId, channel: "api", idempotencyKey: key, messages: [{ role: "user", content }], signal: new AbortController().signal })) out.push(ev);
  return out;
}

async function ledgerBalanced() {
  const db = await getDb();
  const [r] = await db.execute(sql`select coalesce(sum(debit),0)::text as d, coalesce(sum(credit),0)::text as c from ledger_entries`).then((x) => (x as unknown as { rows: { d: string; c: string }[] }).rows ?? (x as unknown as { d: string; c: string }[]));
  return r.d === r.c;
}

beforeAll(async () => {
  const db = await getDb();
  // A fresh price so nothing fetches the network.
  await db.insert(schema.priceSnapshots).values({ microPerUnit: 3_000_000n, source: "test", observedAt: new Date(Date.now() + 3600_000) });
  const [c] = await db.insert(schema.users).values({ nearAccountId: "alice.testnet" }).returning();
  const [o] = await db.insert(schema.users).values({ nearAccountId: "operator.testnet", role: "operator" }).returning();
  customer = c.id;
  operator = o.id;
  await db.transaction(async (tx) => {
    await recordCapital(tx, operator, $(50), "seed-capital");
    await creditDeposit(tx, customer, $(2), "seed-credit");
  });
});

beforeEach(() => {
  provider.behaviour = { kind: "ok", text: "Hello from the mock model.", usage: { inTokens: 120, outTokens: 40 } };
});

describe("economic loop", () => {
  it("returns chart timestamps and opening liquidity for funded accounts", async () => {
    const metrics = await metricsSeries(24);
    expect(metrics.series.length).toBeGreaterThan(0);
    for (const point of metrics.series) expect(Number.isFinite(Date.parse(point.t))).toBe(true);
    expect(BigInt(metrics.series.at(-1)!.liquidity)).toBeGreaterThan(0n);
  });
  it("routes, streams, bills actual usage and keeps the ledger balanced", async () => {
    const before = await getBalance(customer);
    const evs = await run(customer);
    const meta = evs.find((e) => e.type === "meta");
    const final = evs.find((e) => e.type === "final");
    expect(meta && final).toBeTruthy();
    if (final?.type !== "final") throw new Error("no final");
    expect(final.inTokens).toBe(120);
    expect(final.outTokens).toBe(40);
    expect(final.costIsEstimated).toBe(false);
    expect(BigInt(final.charge)).toBeGreaterThan(BigInt(final.cost));
    const after = await getBalance(customer);
    expect(before.available - after.available).toBe(BigInt(final.charge));
    expect(after.reserved).toBe(0n);
    expect(await ledgerBalanced()).toBe(true);
    const o = await overview();
    expect(BigInt(o.revenueTotal)).toBe(BigInt(final.charge));
    expect(BigInt(o.expenseTotal)).toBe(BigInt(final.cost));
    expect(o.activeModel?.id).toBe(final.model);
  });

  it("marks cost as estimated when the provider reports no usage", async () => {
    provider.behaviour = { kind: "ok", text: "no usage here", usage: null };
    const evs = await run(customer);
    const final = evs.find((e) => e.type === "final");
    expect(final?.type === "final" && final.costIsEstimated).toBe(true);
  });

  it("rejects a duplicate idempotency key without charging twice", async () => {
    const key = crypto.randomUUID();
    await run(customer, key);
    const mid = await getBalance(customer);
    const evs = await run(customer, key);
    expect(evs.find((e) => e.type === "error")).toMatchObject({ code: "DUPLICATE_REQUEST" });
    expect((await getBalance(customer)).available).toBe(mid.available);
  });

  it("refunds the reservation when the provider fails before any output", async () => {
    provider.behaviour = { kind: "fail" };
    const before = await getBalance(customer);
    const evs = await run(customer);
    expect(evs.at(-1)).toMatchObject({ type: "error", code: "PROVIDER_UNAVAILABLE" });
    const after = await getBalance(customer);
    expect(after.available).toBe(before.available);
    expect(after.reserved).toBe(0n);
  });

  it("never lets concurrent requests overspend credits", async () => {
    const db = await getDb();
    const [u] = await db.insert(schema.users).values({ nearAccountId: "bob.testnet" }).returning();
    await db.transaction((tx) => creditDeposit(tx, u.id, 3_000n, "seed-bob")); // $0.003 — enough for a few small requests at most
    provider.behaviour = { kind: "slow" };
    const results = await Promise.all(Array.from({ length: 6 }, () => run(u.id)));
    const bal = await getBalance(u.id);
    expect(bal.available).toBeGreaterThanOrEqual(0n);
    expect(bal.reserved).toBe(0n);
    const charged = results.flat().filter((e) => e.type === "final").reduce((n, e) => n + BigInt((e as { charge: string }).charge), 0n);
    expect(charged + bal.available).toBe(3_000n);
    expect(await ledgerBalanced()).toBe(true);
  });

  it("declines with INSUFFICIENT_CREDITS when the user has nothing", async () => {
    const db = await getDb();
    const [u] = await db.insert(schema.users).values({ nearAccountId: "carol.testnet" }).returning();
    const evs = await run(u.id);
    expect(evs[0]).toMatchObject({ type: "error", code: "INSUFFICIENT_CREDITS" });
  });

  it("refuses inference when paused", async () => {
    await setSystem("paused", true);
    const evs = await run(customer);
    expect(evs[0]).toMatchObject({ type: "error", code: "POLICY_PAUSED" });
    await setSystem("paused", false);
  });

  it("keeps the ledger append-only", async () => {
    const db = await getDb();
    await expect(db.execute(sql`update ledger_entries set debit = debit + 1`)).rejects.toThrow();
    await expect(db.execute(sql`delete from ledger_entries`)).rejects.toThrow();
  });
});

describe("deposits", () => {
  const tx = (hash: string, signer: string, amountYocto: string, receiver = "treasury.testnet") => ({
    status: { SuccessValue: "" },
    transaction: { hash, signer_id: signer, receiver_id: receiver, actions: [{ Transfer: { deposit: amountYocto } }] },
    transaction_outcome: { block_hash: "blk", outcome: { status: {} } },
    receipts_outcome: [{ outcome: { status: { SuccessValue: "" }, logs: [] } }],
  });
  const H1 = "4Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz";

  it("credits a verified transfer exactly once at the snapshot rate", async () => {
    chain.txs.set(H1, tx(H1, "alice.testnet", (2n * 10n ** 24n).toString()));
    const before = await getBalance(customer);
    const r = await verifyDeposit({ id: customer, accountId: "alice.testnet" }, H1);
    expect(r.usd).toBe("6000000"); // 2 NEAR × $3
    expect((await getBalance(customer)).available - before.available).toBe(6_000_000n);
    await expect(verifyDeposit({ id: customer, accountId: "alice.testnet" }, H1)).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("rejects a transaction signed by someone else or sent elsewhere", async () => {
    const H2 = "9Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz";
    chain.txs.set(H2, tx(H2, "mallory.testnet", (10n ** 24n).toString()));
    await expect(verifyDeposit({ id: customer, accountId: "alice.testnet" }, H2)).rejects.toBeInstanceOf(DepositError);
    const H3 = "7Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz";
    chain.txs.set(H3, tx(H3, "alice.testnet", (10n ** 24n).toString(), "elsewhere.testnet"));
    await expect(verifyDeposit({ id: customer, accountId: "alice.testnet" }, H3)).rejects.toMatchObject({ code: "WRONG_RECEIVER" });
  });

  it("does not credit an unknown or unfinalized transaction", async () => {
    await expect(verifyDeposit({ id: customer, accountId: "alice.testnet" }, "5Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz")).rejects.toMatchObject({ code: "NOT_FINAL" });
  });
});

describe("state machine on real books", () => {
  it("enters survival when liquidity falls to the reserve", async () => {
    const db = await getDb();
    // A fresh DB view: capital $50 minus everything → healthy now.
    const ev = await evaluateReal();
    expect(["ABUNDANCE", "DEFENSIVE"]).toContain(ev.state);
    // Withdraw most capital (an operator treasury transfer) → survival.
    const { postJournal } = await import("@/server/services/core");
    await db.transaction((t) => postJournal(t, [{ account: "equity:capital", debit: $(49.6) }, { account: "asset:treasury", credit: $(49.6) }], { type: "test_withdrawal" }));
    const ev2 = await evaluateReal();
    expect(ev2.state).toBe("SURVIVAL");
    const evs = await run(customer);
    expect(evs[0]).toMatchObject({ type: "error", code: "FUNDING_REQUIRED" });
    await db.transaction((t) => postJournal(t, [{ account: "asset:treasury", debit: $(49.6) }, { account: "equity:capital", credit: $(49.6) }], { type: "test_refund" }));
    // Improvements respect the minimum dwell: still in survival right after funding…
    expect((await evaluateReal()).state).toBe("SURVIVAL");
    // …and recover once the dwell has elapsed.
    const { getSystem } = await import("@/server/services/core");
    const mem = await getSystem<{ state: string; since: number }>("state:real");
    await setSystem("state:real", { ...mem, since: Date.now() - 200_000, pendingSince: null });
    expect((await evaluateReal()).state).toBe("RECOVERY");
  });
});

describe("simulation isolation", () => {
  it("drives states without touching real books", async () => {
    const db = await getDb();
    const count = async () => {
      const r = (await db.execute(sql`select (select count(*) from ledger_entries) + (select count(*) from usage_requests) + (select count(*) from deposits) as n`)) as unknown as { rows: { n: string }[] };
      return Number((r.rows ?? (r as unknown as { n: string }[]))[0].n);
    };
    const before = await count();
    const balBefore = await getBalance(customer);
    const s = await createScenario(null);
    expect(s.overview.simulated).toBe(true);
    expect(s.overview.state).toBe("ABUNDANCE");
    const drained = await applyAction(s.id, null, { type: "drain_treasury" });
    expect(drained?.overview.state).toBe("SURVIVAL");
    const spiked = await applyAction(s.id, null, { type: "spike_cost", multiplier: 4 });
    expect(spiked).toBeTruthy();
    const restored = await applyAction(s.id, null, { type: "restore_funding", usd: 80 });
    // Leaving survival needs the minimum dwell (virtual time) — advance a few ticks.
    let st = restored!;
    for (let i = 0; i < 4 && st.overview.state === "SURVIVAL"; i++) st = (await applyAction(s.id, null, { type: "set_traffic", perMin: 30 }))!;
    expect(["RECOVERY", "SURVIVAL"]).toContain(st.overview.state);
    expect(await getScenario(s.id, null)).toBeTruthy();
    expect(await count()).toBe(before);
    expect((await getBalance(customer)).available).toBe(balBefore.available);
  });

  it("downgrades the model under a cost spike", async () => {
    const s = await createScenario(null);
    const tierBefore = s.overview.activeModel?.tier;
    expect(tierBefore).toBe("premium");
    let st = (await applyAction(s.id, null, { type: "spike_cost", multiplier: 5 }))!;
    for (let i = 0; i < 3; i++) st = (await applyAction(s.id, null, { type: "set_traffic", perMin: 30 }))!;
    expect(st.overview.activeModel?.tier ?? "none").not.toBe("premium");
    expect(st.decisions.some((d) => /excluded|declined|Routed/.test(d.text))).toBe(true);
  });
});

describe("receipts", () => {
  it("hashes deterministically over canonical JSON", async () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 0 }] })).toBe('{"a":[2,{"c":0,"d":1}],"b":1}');
    const start = new Date(Date.now() - 3600_000);
    const end = new Date(Date.now() + 1000);
    const r1 = await buildReceipt(start, end);
    const r2 = await buildReceipt(start, end);
    expect(r1.hash).toBe(r2.hash);
    expect(r1.hash).toBe(sha256Hex(canonicalJson(r1.payload)));
    expect(BigInt(r1.payload.revenue_micro)).toBeGreaterThan(0n);
    expect(JSON.stringify(r1.payload)).not.toMatch(/alice|Hello/);
  });
});
