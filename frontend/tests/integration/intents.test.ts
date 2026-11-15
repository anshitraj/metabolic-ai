import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// 1Click is mocked: NEAR Intents has no testnet, so tests never touch mainnet.
const api = vi.hoisted(() => ({
  quotes: 0,
  statuses: new Map<string, { status: string; amountOut?: string; amountOutUsd?: string; recipient?: string }>(),
}));
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

vi.mock("@/server/near/intents", async (original) => {
  const real = await original<typeof import("@/server/near/intents")>();
  return {
    ...real,
    oneClick: {
      tokens: async () => [
        { assetId: BASE_USDC, symbol: "USDC", blockchain: "base", decimals: 6, price: 1 },
        { assetId: USDC, symbol: "USDC", blockchain: "near", decimals: 6, price: 1 },
      ],
      quote: async (req: import("@/server/near/intents").OneClickQuoteRequest) => {
        const n = ++api.quotes;
        const out = (BigInt(req.amount) * 999n) / 1000n;
        return {
          correlationId: `c${n}`, timestamp: new Date().toISOString(), signature: "ed25519:test",
          quoteRequest: req,
          quote: {
            depositAddress: `0xdeposit${n}`, amountIn: req.amount, amountInFormatted: String(Number(req.amount) / 1e6), amountInUsd: String(Number(req.amount) / 1e6),
            minAmountIn: req.amount, amountOut: out.toString(), amountOutFormatted: String(Number(out) / 1e6), amountOutUsd: String(Number(out) / 1e6),
            minAmountOut: ((out * 99n) / 100n).toString(), timeEstimate: 30, deadline: req.deadline,
          },
        };
      },
      status: async (depositAddress: string) => {
        const s = api.statuses.get(depositAddress) ?? { status: "PENDING_DEPOSIT" };
        return {
          correlationId: "s", status: s.status, updatedAt: new Date().toISOString(),
          quoteResponse: { quoteRequest: { recipient: s.recipient ?? "metabolic-biz.near", destinationAsset: USDC }, quote: { depositAddress } },
          swapDetails: { intentHashes: [], nearTxHashes: ["nearTx"], originChainTxHashes: [{ hash: "0xorigin", explorerUrl: "" }], destinationChainTxHashes: [], amountOut: s.amountOut, amountOutUsd: s.amountOutUsd },
        };
      },
      submitDeposit: async () => ({}),
    },
  };
});

import { getDb, schema } from "@/server/db/client";
import { config } from "@/server/config";
import { getBalance } from "@/server/services/billing";
import { createIntentPayment, refreshIntentPayment, refreshOpenIntentPayments } from "@/server/services/intents";
import { creditableMicro, destinationMicro, usdToMicro } from "@/server/near/intents";

let user: { id: string; accountId: string };
let other: { id: string; accountId: string };

beforeAll(async () => {
  config.intents.recipient = "metabolic-biz.near";
  const db = await getDb();
  const [a] = await db.insert(schema.users).values({ nearAccountId: "intents-payer.testnet" }).returning();
  const [b] = await db.insert(schema.users).values({ nearAccountId: "intents-other.testnet" }).returning();
  user = { id: a.id, accountId: a.nearAccountId };
  other = { id: b.id, accountId: b.nearAccountId };
});

describe("money helpers", () => {
  it("truncates USD strings to micro-USD and never credits above the quote", () => {
    expect(usdToMicro("4.993784369082")).toBe(4_993_784n);
    expect(usdToMicro("12")).toBe(12_000_000n);
    expect(usdToMicro("-1")).toBeNull();
    expect(usdToMicro("abc")).toBeNull();
    expect(destinationMicro(USDC, "4995213", "4.99")).toBe(4_995_213n);
    expect(destinationMicro("nep141:wrap.near", "1000", "3.021")).toBe(3_021_000n);
    expect(creditableMicro(5_000_000n, 6_000_000n)).toBe(5_000_000n);
    expect(creditableMicro(5_000_000n, 4_000_000n)).toBe(4_000_000n);
    expect(creditableMicro(5_000_000n, null)).toBe(0n);
  });
});

describe("pay with any token via NEAR Intents", () => {
  it("quotes a deposit address that settles USDC on NEAR to the business", async () => {
    const p = await createIntentPayment(user, { originAsset: BASE_USDC, amount: "10", refundTo: "0x1111111111111111111111111111111111111111" });
    expect(p.status).toBe("PENDING_DEPOSIT");
    expect(p.recipient).toBe("metabolic-biz.near");
    expect(p.depositAddress).toMatch(/^0xdeposit/);
    // 10 USDC → 9.99 out → minimum 9.8901 quoted
    expect(p.quotedUsd).toBe("9890100");
  });

  it("rejects unsupported tokens, the destination asset itself and out-of-range amounts", async () => {
    await expect(createIntentPayment(user, { originAsset: "nep141:nope", amount: "10", refundTo: "0x1" + "1".repeat(39) })).rejects.toMatchObject({ code: "UNSUPPORTED_TOKEN" });
    await expect(createIntentPayment(user, { originAsset: USDC, amount: "10", refundTo: "me.near" })).rejects.toMatchObject({ code: "SAME_ASSET" });
    await expect(createIntentPayment(user, { originAsset: BASE_USDC, amount: "0.5", refundTo: "0x" + "1".repeat(40) })).rejects.toMatchObject({ code: "BAD_AMOUNT" });
    await expect(createIntentPayment(user, { originAsset: BASE_USDC, amount: "1.1234567", refundTo: "0x" + "1".repeat(40) })).rejects.toMatchObject({ code: "BAD_AMOUNT" });
  });

  it("credits exactly once on SUCCESS, capped at the quote, even with concurrent refreshes", async () => {
    const p = await createIntentPayment(user, { originAsset: BASE_USDC, amount: "20", refundTo: "0x" + "2".repeat(40) });
    const before = (await getBalance(user.id)).available;
    expect((await refreshIntentPayment(p.id, user.id)).creditedAt).toBeNull();
    // Settles above the guaranteed minimum: credit is capped at the quoted minimum.
    api.statuses.set(p.depositAddress, { status: "SUCCESS", amountOut: "19980000", amountOutUsd: "19.98" });
    const results = await Promise.all([refreshIntentPayment(p.id, user.id), refreshIntentPayment(p.id, user.id), refreshOpenIntentPayments()]);
    expect(results[0].status).toBe("SUCCESS");
    expect((await getBalance(user.id)).available - before).toBe(BigInt(p.quotedUsd));
    const db = await getDb();
    const entries = await db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.refId, p.id));
    expect(entries).toHaveLength(2);
  });

  it("credits only what settled when it is less than quoted", async () => {
    const p = await createIntentPayment(user, { originAsset: BASE_USDC, amount: "5", refundTo: "0x" + "3".repeat(40) });
    const before = (await getBalance(user.id)).available;
    api.statuses.set(p.depositAddress, { status: "SUCCESS", amountOut: "3000000", amountOutUsd: "3" });
    const r = await refreshIntentPayment(p.id, user.id);
    expect(r.creditedUsd).toBe("3000000");
    expect((await getBalance(user.id)).available - before).toBe(3_000_000n);
  });

  it("never credits refunds, other accounts' payments or mismatched statuses", async () => {
    const refunded = await createIntentPayment(user, { originAsset: BASE_USDC, amount: "5", refundTo: "0x" + "4".repeat(40) });
    const before = (await getBalance(user.id)).available;
    api.statuses.set(refunded.depositAddress, { status: "REFUNDED" });
    expect((await refreshIntentPayment(refunded.id, user.id)).status).toBe("REFUNDED");
    expect((await getBalance(user.id)).available).toBe(before);

    const mine = await createIntentPayment(user, { originAsset: BASE_USDC, amount: "5", refundTo: "0x" + "5".repeat(40) });
    await expect(refreshIntentPayment(mine.id, other.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    api.statuses.set(mine.depositAddress, { status: "SUCCESS", amountOut: "5000000", recipient: "attacker.near" });
    await expect(refreshIntentPayment(mine.id, user.id)).rejects.toMatchObject({ code: "STATUS_MISMATCH" });
    expect((await getBalance(user.id)).available).toBe(before);
  });
});
