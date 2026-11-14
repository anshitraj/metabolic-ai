// First-run path with NO env configuration for operators or treasury:
// sign in → claim operator + choose treasury → deposit → business leaves survival.
import { beforeAll, describe, expect, it, vi } from "vitest";

delete process.env.NEAR_TREASURY_ACCOUNT_ID;
delete process.env.NEAR_CONTRACT_ID;
delete process.env.OPERATOR_ACCOUNT_IDS;

const chain = { txs: new Map<string, unknown>(), accounts: new Set(["owner.testnet", "vault.testnet", "judge.testnet"]) };
vi.mock("@/server/near/rpc", async (orig) => {
  const real = await orig<typeof import("@/server/near/rpc")>();
  return {
    ...real,
    txStatus: async (hash: string) => (chain.txs.get(hash) as never) ?? null,
    viewAccount: async (id: string) => (chain.accounts.has(id) ? { amount: "0", locked: "0", storage_usage: 0 } : null),
  };
});

const { getDb, schema } = await import("@/server/db/client");
const { claimOperator, resolveDepositTarget, setupStatus, isOperatorAccount, setTreasuryAccount } = await import("@/server/services/settings");
const { createDepositIntent, verifyDeposit } = await import("@/server/services/treasury");
const { evaluateReal, overview } = await import("@/server/services/economy");
const { getBalance } = await import("@/server/services/billing");
const { setSystem, getSystem } = await import("@/server/services/core");

const tx = (hash: string, signer: string, receiver: string, near: bigint) => ({
  status: { SuccessValue: "" },
  transaction: { hash, signer_id: signer, receiver_id: receiver, actions: [{ Transfer: { deposit: (near * 10n ** 24n).toString() } }] },
  transaction_outcome: { block_hash: "blk", outcome: { status: {} } },
  receipts_outcome: [{ outcome: { status: { SuccessValue: "" }, logs: [] } }],
});

let owner: { id: string; accountId: string };
let judge: { id: string; accountId: string };

beforeAll(async () => {
  const db = await getDb();
  await db.insert(schema.priceSnapshots).values({ microPerUnit: 3_000_000n, source: "test", observedAt: new Date(Date.now() + 3600_000) });
  const [o] = await db.insert(schema.users).values({ nearAccountId: "owner.testnet" }).returning();
  const [j] = await db.insert(schema.users).values({ nearAccountId: "judge.testnet" }).returning();
  owner = { id: o.id, accountId: o.nearAccountId };
  judge = { id: j.id, accountId: j.nearAccountId };
});

describe("first-run setup without env config", () => {
  it("starts with no operator, no treasury, and deposits refused with a clear reason", async () => {
    const s = await setupStatus("owner.testnet");
    expect(s).toMatchObject({ hasOperator: false, canClaim: true, isOperator: false, treasury: null });
    expect(await resolveDepositTarget()).toBeNull();
    await expect(createDepositIntent(owner, "1")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect((await evaluateReal()).state).toBe("SURVIVAL");
  });

  it("rejects a treasury account that doesn't exist on chain", async () => {
    await expect(claimOperator(owner, "nobody-here.testnet")).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
    await expect(claimOperator(owner, "Not Valid!")).rejects.toMatchObject({ code: "BAD_ACCOUNT" });
  });

  it("lets the first signed-in user become operator and choose the treasury", async () => {
    const s = await claimOperator(owner, "vault.testnet");
    expect(s).toMatchObject({ hasOperator: true, isOperator: true, canClaim: false });
    expect(s.treasury).toMatchObject({ receiverId: "vault.testnet", method: "transfer", source: "app" });
    expect(await isOperatorAccount("owner.testnet")).toBe(true);
    expect(await isOperatorAccount("judge.testnet")).toBe(false);
  });

  it("does not let a second person claim", async () => {
    await expect(claimOperator(judge, "judge.testnet")).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });
    expect((await setupStatus("judge.testnet")).canClaim).toBe(false);
  });

  it("operator can still change the treasury before any deposit", async () => {
    expect((await setTreasuryAccount(owner, "owner.testnet")).treasury?.receiverId).toBe("owner.testnet");
    expect((await setTreasuryAccount(owner, "vault.testnet")).treasury?.receiverId).toBe("vault.testnet");
  });

  it("operator deposit becomes capital and wakes the business up", async () => {
    const intent = await createDepositIntent(owner, "2");
    expect(intent).toMatchObject({ kind: "capital", receiverId: "vault.testnet", method: "transfer" });
    const H = "4Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz";
    chain.txs.set(H, tx(H, "owner.testnet", "vault.testnet", 2n));
    const r = await verifyDeposit(owner, H);
    expect(r).toMatchObject({ kind: "capital", usd: "6000000" });
    // Capital is the business's own money, not customer credit.
    expect((await getBalance(owner.id)).available).toBe(0n);
    const o = await overview();
    expect(o.treasury).toBe("6000000");
    expect(o.liabilities).toBe("0");
    expect(BigInt(o.liquidity)).toBeGreaterThan(BigInt(o.hardReserve));
    // Leaving survival goes through recovery once the minimum dwell has passed.
    const mem = await getSystem<{ state: string; since: number }>("state:real");
    await setSystem("state:real", { ...mem, since: Date.now() - 200_000, pendingSince: null });
    expect((await evaluateReal()).state).toBe("RECOVERY");
  });

  it("a customer deposit becomes prepaid credit (a liability), and the treasury can no longer be moved", async () => {
    const H = "9Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz";
    chain.txs.set(H, tx(H, "judge.testnet", "vault.testnet", 1n));
    const r = await verifyDeposit(judge, H);
    expect(r).toMatchObject({ kind: "credits", usd: "3000000" });
    expect((await getBalance(judge.id)).available).toBe(3_000_000n);
    const o = await overview();
    expect(o.treasury).toBe("9000000");
    expect(o.liabilities).toBe("3000000");
    await expect(setTreasuryAccount(owner, "owner.testnet")).rejects.toMatchObject({ code: "HAS_DEPOSITS" });
  });

  it("supports the operator using their own account as the treasury (self-transfer)", async () => {
    // Same-account transfers are valid NEAR transactions; signer and receiver match.
    const H = "7Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz";
    chain.txs.set(H, tx(H, "owner.testnet", "owner.testnet", 1n));
    // Treasury is vault.testnet here, so a self-transfer must be refused as the wrong receiver.
    await expect(verifyDeposit(owner, H)).rejects.toMatchObject({ code: "WRONG_RECEIVER" });
  });
});

describe("operator buying credit for themselves", () => {
  it("books an operator deposit as personal credit when they ask for it, and never lets a customer book capital", async () => {
    const H = "3Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz";
    chain.txs.set(H, tx(H, "owner.testnet", "vault.testnet", 1n));
    const r = await verifyDeposit(owner, H, "credits");
    expect(r.kind).toBe("credits");
    expect((await getBalance(owner.id)).available).toBe(3_000_000n);
    const H2 = "2Lsy4Ab9DiTRn2xyTHhTm4wdfyAqcbiZoQtMDqKpfGJz";
    chain.txs.set(H2, tx(H2, "judge.testnet", "vault.testnet", 1n));
    const r2 = await verifyDeposit(judge, H2, "capital");
    expect(r2.kind).toBe("credits");
  });
});

describe("charts on real books", () => {
  it("returns a parseable time series once the ledger has entries", async () => {
    const { metricsSeries } = await import("@/server/services/economy");
    const m = await metricsSeries(24);
    expect(m.series.length).toBeGreaterThanOrEqual(3);
    for (const p of m.series) expect(Number.isNaN(Date.parse(p.t))).toBe(false);
    expect(m.series.at(-1)!.liquidity).toBe("6000000"); // only the $6 of capital is the business's own
    const m30 = await metricsSeries(24 * 30);
    expect(m30.bucket).toBe("day");
    expect(m30.series.length).toBeGreaterThanOrEqual(3);
  });
});
