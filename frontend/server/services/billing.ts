import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema, type Executor } from "@/server/db/client";
import { postJournal } from "./core";

const { creditBalances } = schema;

export class BillingError extends Error {
  constructor(
    readonly code: "INSUFFICIENT_CREDITS" | "NO_BALANCE",
    message: string,
    readonly needed?: bigint,
  ) {
    super(message);
  }
}

export async function ensureBalanceRow(db: Executor, userId: string) {
  await db.insert(creditBalances).values({ userId }).onConflictDoNothing();
}

export async function getBalance(userId: string): Promise<{ available: bigint; reserved: bigint }> {
  const db = await getDb();
  const [row] = await db.select().from(creditBalances).where(eq(creditBalances.userId, userId));
  return { available: row?.available ?? 0n, reserved: row?.reserved ?? 0n };
}

/** Lock the user's balance row. Call inside a transaction. */
export async function lockBalance(tx: Executor, userId: string) {
  await ensureBalanceRow(tx, userId);
  const rows = await tx.execute(sql`select available::text as available, reserved::text as reserved from credit_balances where user_id = ${userId} for update`);
  const r = (rows as unknown as { rows?: { available: string; reserved: string }[] }).rows ?? (rows as unknown as { available: string; reserved: string }[]);
  const row = Array.isArray(r) ? r[0] : undefined;
  return { available: BigInt(row?.available ?? "0"), reserved: BigInt(row?.reserved ?? "0") };
}

/** Move `amount` from available to reserved. Concurrent requests serialise on the row lock, so credits can't be overspent. */
export async function reserve(tx: Executor, userId: string, amount: bigint) {
  const bal = await lockBalance(tx, userId);
  if (bal.available < amount) {
    throw new BillingError("INSUFFICIENT_CREDITS", "Not enough prepaid credit for this request.", amount - bal.available);
  }
  await tx
    .update(creditBalances)
    .set({ available: sql`${creditBalances.available} - ${amount}`, reserved: sql`${creditBalances.reserved} + ${amount}`, updatedAt: new Date() })
    .where(eq(creditBalances.userId, userId));
}

/** Release a reservation without charging. */
export async function release(tx: Executor, userId: string, amount: bigint) {
  await lockBalance(tx, userId);
  await tx
    .update(creditBalances)
    .set({ available: sql`${creditBalances.available} + ${amount}`, reserved: sql`${creditBalances.reserved} - ${amount}`, updatedAt: new Date() })
    .where(eq(creditBalances.userId, userId));
}

/**
 * Finalise a request: release the reservation, charge `charge` (≤ reserved),
 * recognise revenue and accrue the provider cost. One transaction.
 */
export async function settle(
  tx: Executor,
  p: { userId: string; reserved: bigint; charge: bigint; cost: bigint; provider: string; usageId: string },
) {
  const charge = p.charge > p.reserved ? p.reserved : p.charge;
  await lockBalance(tx, p.userId);
  await tx
    .update(creditBalances)
    .set({
      available: sql`${creditBalances.available} + ${p.reserved - charge}`,
      reserved: sql`${creditBalances.reserved} - ${p.reserved}`,
      updatedAt: new Date(),
    })
    .where(eq(creditBalances.userId, p.userId));
  if (charge > 0n) {
    await postJournal(
      tx,
      [
        { account: "liability:credits", debit: charge, userId: p.userId, memo: "inference charge" },
        { account: "revenue:inference", credit: charge, userId: p.userId },
      ],
      { type: "usage", id: p.usageId },
    );
  }
  await recordProviderExpense(tx, p.provider, p.cost, p.usageId);
  return charge;
}

/** Provider expense is an offchain payable, independent of what the customer was charged. */
export async function recordProviderExpense(tx: Executor, provider: string, cost: bigint, usageId: string) {
  if (cost > 0n) {
    await postJournal(
      tx,
      [
        { account: `expense:provider:${provider}`, debit: cost, memo: "provider usage" },
        { account: `liability:payable:${provider}`, credit: cost },
      ],
      { type: "usage", id: usageId },
    );
  }
}

/** Credit a verified customer deposit (USD micro). */
export async function creditDeposit(tx: Executor, userId: string, usd: bigint, depositId: string) {
  await ensureBalanceRow(tx, userId);
  await tx
    .update(creditBalances)
    .set({ available: sql`${creditBalances.available} + ${usd}`, updatedAt: new Date() })
    .where(eq(creditBalances.userId, userId));
  await postJournal(
    tx,
    [
      { account: "asset:treasury", debit: usd, memo: "NEAR deposit (credits)" },
      { account: "liability:credits", credit: usd, userId },
    ],
    { type: "deposit", id: depositId },
  );
}

/** Record operator capital (funds the business, not a customer liability). */
export async function recordCapital(tx: Executor, userId: string, usd: bigint, depositId: string) {
  await postJournal(
    tx,
    [
      { account: "asset:treasury", debit: usd, memo: "NEAR deposit (operating capital)" },
      { account: "equity:capital", credit: usd, userId },
    ],
    { type: "deposit", id: depositId },
  );
}
