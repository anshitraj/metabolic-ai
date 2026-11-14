import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { config, explorerTxUrl } from "@/server/config";
import { isOperatorAccount, resolveDepositTarget } from "./settings";
import { nearToUsd, parseNear, YOCTO } from "@/lib/economics/money";
import { txStatus, txSucceeded, viewAccount } from "@/server/near/rpc";
import { getRate, publish, audit } from "./core";
import { creditDeposit, getBalance, recordCapital } from "./billing";
import { evaluateReal } from "./economy";

const { depositIntents, chainTransactions, deposits, users } = schema;

export const MIN_DEPOSIT_YOCTO = YOCTO / 100n; // 0.01 NEAR
export const MAX_DEPOSIT_YOCTO = 1000n * YOCTO;

export const depositTarget = resolveDepositTarget;

export class DepositError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) {
    super(message);
  }
}

export type DepositPurpose = "capital" | "credits";

/** Operators may fund the business (capital) or buy credit for themselves; everyone else buys credit. */
async function depositKind(accountId: string, purpose?: DepositPurpose): Promise<DepositPurpose> {
  if (!(await isOperatorAccount(accountId))) return "credits";
  return purpose === "credits" ? "credits" : "capital";
}

export async function createDepositIntent(user: { id: string; accountId: string }, amountNear: string, purpose?: DepositPurpose) {
  const target = await depositTarget();
  if (!target) throw new DepositError("NOT_CONFIGURED", "Deposits are not set up yet: the operator needs to choose a treasury account (Overview → Setup).");
  const yocto = parseNear(amountNear);
  if (yocto === null || yocto < MIN_DEPOSIT_YOCTO || yocto > MAX_DEPOSIT_YOCTO) {
    throw new DepositError("BAD_AMOUNT", "Amount must be between 0.01 and 1000 NEAR.");
  }
  const kind = await depositKind(user.accountId, purpose);
  const rate = await getRate();
  const db = await getDb();
  const [intent] = await db
    .insert(depositIntents)
    .values({ userId: user.id, kind, amountYocto: yocto.toString(), network: config.near.network, receiverId: target.receiverId, method: target.method })
    .returning();
  return {
    intentId: intent.id,
    kind,
    network: config.near.network,
    receiverId: target.receiverId,
    method: target.method,
    amountYocto: yocto.toString(),
    gas: "30000000000000",
    estimateUsd: rate && !rate.stale ? nearToUsd(yocto, rate.microPerNear).toString() : null,
    rate: rate ? { microPerNear: rate.microPerNear.toString(), observedAt: rate.observedAt.toISOString(), stale: rate.stale } : null,
  };
}

/**
 * Verify a deposit transaction independently on chain and credit it exactly once.
 * Checks: final, succeeded, signer = session account, receiver = treasury/contract,
 * action = deposit()/Transfer with the attached amount, hash not used before.
 */
export async function verifyDeposit(user: { id: string; accountId: string }, txHash: string, purpose?: DepositPurpose, intentId?: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(txHash)) throw new DepositError("BAD_HASH", "That is not a NEAR transaction hash.");
  const target = await depositTarget();
  if (!target) throw new DepositError("NOT_CONFIGURED", "Deposits are not configured.");
  const db = await getDb();

  const [existing] = await db
    .select({ id: chainTransactions.id })
    .from(chainTransactions)
    .where(and(eq(chainTransactions.network, config.near.network), eq(chainTransactions.txHash, txHash)));
  if (existing) {
    const [dep] = await db.select().from(deposits).where(eq(deposits.chainTxId, existing.id));
    if (dep) throw new DepositError("DUPLICATE", "This transaction has already been credited.");
  }

  const status = await txStatus(txHash, user.accountId);
  if (!status) throw new DepositError("NOT_FINAL", "Transaction not found or not final yet. Try again in a few seconds.", true);
  const tx = status.transaction;
  if (tx.hash !== txHash) throw new DepositError("WRONG_HASH", "The RPC transaction does not match the requested hash.");
  if (status.final_execution_status && status.final_execution_status !== "FINAL") throw new DepositError("NOT_FINAL", "The transaction and its receipts are not final yet. Try again shortly.", true);
  if (tx.signer_id !== user.accountId) throw new DepositError("WRONG_SIGNER", "This transaction was signed by a different account.");
  if (tx.receiver_id !== target.receiverId) throw new DepositError("WRONG_RECEIVER", `This transaction was not sent to ${target.receiverId}.`);
  if (!txSucceeded(status)) throw new DepositError("FAILED", "The transaction failed on chain.");

  let amount = 0n;
  let memo: string | null = null;
  for (const a of tx.actions) {
    if (target.method === "deposit" && "FunctionCall" in a) {
      const fc = (a as { FunctionCall: { method_name: string; deposit: string; args: string } }).FunctionCall;
      if (fc.method_name === "deposit") {
        if (tx.actions.length !== 1) throw new DepositError("BAD_ACTIONS", "A contract deposit must be a single deposit action.");
        amount += BigInt(fc.deposit);
        try {
          const args = JSON.parse(Buffer.from(fc.args, "base64").toString("utf8"));
          memo = typeof args.memo === "string" ? args.memo : null;
        } catch { throw new DepositError("BAD_DEPOSIT", "The contract deposit arguments could not be verified."); }
      }
    }
    if (target.method === "transfer" && "Transfer" in a) {
      amount += BigInt((a as { Transfer: { deposit: string } }).Transfer.deposit);
    }
  }
  if (amount < MIN_DEPOSIT_YOCTO) throw new DepositError("NO_DEPOSIT", "No qualifying deposit found in this transaction.");
  if (amount > MAX_DEPOSIT_YOCTO) throw new DepositError("BAD_AMOUNT", "The transaction exceeds the maximum supported deposit.");
  if (target.method === "deposit") {
    const emitted = status.receipts_outcome.filter((r) => r.outcome.executor_id === target.receiverId).flatMap((r) => r.outcome.logs).some((log) => {
      if (!log.startsWith("EVENT_JSON:")) return false;
      try {
        const event = JSON.parse(log.slice(11));
        return event.standard === "metabolic" && event.version === "1.0.0" && event.event === "deposit" && Array.isArray(event.data) && event.data.some((d: { account_id?: string; amount?: string; memo?: string | null }) => d.account_id === user.accountId && d.amount === amount.toString() && (d.memo ?? null) === memo);
      } catch { return false; }
    });
    if (!emitted) throw new DepositError("DEPOSIT_EVENT_MISSING", "The expected treasury contract did not confirm this deposit with matching payer, amount and memo.");
    if (intentId && memo !== intentId) throw new DepositError("INTENT_MISMATCH", "The deposit memo does not match this intent.");
    if (!intentId && memo && /^[0-9a-f-]{36}$/i.test(memo)) intentId = memo;
  }
  const [intent] = intentId ? await db.select().from(depositIntents).where(and(eq(depositIntents.id, intentId), eq(depositIntents.userId, user.id))) : [];
  if (intentId && !intent) throw new DepositError("INTENT_NOT_FOUND", "This deposit intent does not belong to the signed-in account.");
  if (intent && (intent.network !== config.near.network || intent.receiverId !== target.receiverId || intent.amountYocto !== amount.toString() || (intent.method && intent.method !== target.method) || (purpose && purpose !== intent.kind))) throw new DepositError("INTENT_MISMATCH", "The transaction's network, recipient, amount or purpose does not match the deposit intent.");
  if (intent?.consumedTxHash) throw new DepositError("INTENT_USED", "This deposit intent was already used. Create a new intent for a new deposit.");

  const rate = await getRate();
  if (!rate || rate.stale) {
    throw new DepositError("RATE_UNAVAILABLE", "NEAR/USD rate is unavailable right now, so the deposit can't be converted to credit yet. Your funds are safe on chain — try verifying again shortly.", true);
  }
  const usd = nearToUsd(amount, rate.microPerNear);
  const kind = intent ? intent.kind as DepositPurpose : await depositKind(user.accountId, purpose);

  const result = await db.transaction(async (t) => {
    if (intent) {
      const consumed = await t.update(depositIntents).set({ consumedTxHash: txHash }).where(and(eq(depositIntents.id, intent.id), eq(depositIntents.userId, user.id), sql`${depositIntents.consumedTxHash} is null`)).returning({ id: depositIntents.id });
      if (!consumed.length) throw new DepositError("INTENT_USED", "This deposit intent was already consumed.");
    }
    const [ctx] = await t
      .insert(chainTransactions)
      .values({
        network: config.near.network,
        txHash,
        kind: "deposit",
        signerId: tx.signer_id,
        receiverId: tx.receiver_id,
        amountYocto: amount.toString(),
        status: "final",
        blockHash: status.transaction_outcome.block_hash,
        finalizedAt: new Date(),
      })
      .onConflictDoUpdate({ target: [chainTransactions.network, chainTransactions.txHash], set: { status: "final" } })
      .returning();
    const [dep] = await t
      .insert(deposits)
      .values({ userId: user.id, intentId: intent?.id ?? null, chainTxId: ctx.id, kind, amountYocto: amount.toString(), usdMicro: usd, priceSnapshotId: rate.id })
      .onConflictDoNothing()
      .returning();
    if (!dep) throw new DepositError("DUPLICATE", "This transaction has already been credited.");
    if (kind === "capital") await recordCapital(t, user.id, usd, dep.id);
    else await creditDeposit(t, user.id, usd, dep.id);
    return dep;
  });

  await audit("treasury.deposit", { actorUserId: user.id, target: txHash, meta: { amount: amount.toString(), usd: usd.toString(), kind } });
  await publish(
    "treasury.deposit.confirmed",
    { account: user.accountId, amountYocto: amount.toString(), usd: usd.toString(), kind, txHash, explorer: explorerTxUrl(txHash) },
    { source: "treasury", entityId: result.id },
  );
  await evaluateReal();
  return { depositId: result.id, kind, amountYocto: amount.toString(), usd: usd.toString(), txHash, explorer: explorerTxUrl(txHash), balance: await getBalance(user.id) };
}

export async function treasuryView(userId: string | null) {
  const db = await getDb();
  const target = await depositTarget();
  const onChain = target ? await viewAccount(target.receiverId).catch(() => null) : null;
  const txs = await db
    .select({
      hash: chainTransactions.txHash,
      kind: chainTransactions.kind,
      signer: chainTransactions.signerId,
      receiver: chainTransactions.receiverId,
      amountYocto: chainTransactions.amountYocto,
      status: chainTransactions.status,
      at: chainTransactions.createdAt,
      usd: deposits.usdMicro,
      depositKind: deposits.kind,
    })
    .from(chainTransactions)
    .leftJoin(deposits, eq(deposits.chainTxId, chainTransactions.id))
    .orderBy(desc(chainTransactions.createdAt))
    .limit(50);
  const [{ capitalYocto, creditsYocto }] = await db
    .select({
      capitalYocto: sql<string>`coalesce(sum(case when ${deposits.kind} = 'capital' then ${deposits.amountYocto} else 0 end),0)::text`,
      creditsYocto: sql<string>`coalesce(sum(case when ${deposits.kind} = 'credits' then ${deposits.amountYocto} else 0 end),0)::text`,
    })
    .from(deposits);
  const mine = userId
    ? await db
        .select({ hash: chainTransactions.txHash, amountYocto: deposits.amountYocto, usd: deposits.usdMicro, at: deposits.createdAt, kind: deposits.kind })
        .from(deposits)
        .innerJoin(chainTransactions, eq(chainTransactions.id, deposits.chainTxId))
        .where(eq(deposits.userId, userId))
        .orderBy(desc(deposits.createdAt))
        .limit(20)
    : [];
  const [{ depositors }] = await db.select({ depositors: sql<number>`count(distinct ${deposits.userId})::int` }).from(deposits).innerJoin(users, eq(users.id, deposits.userId));
  return {
    network: config.near.network,
    target,
    onChain: onChain ? { amountYocto: onChain.amount, lockedYocto: onChain.locked, storageUsage: onChain.storage_usage } : null,
    recordedYocto: { capital: capitalYocto, credits: creditsYocto },
    depositors,
    transactions: txs.map((t) => ({ ...t, usd: t.usd?.toString() ?? null, at: t.at.toISOString(), explorer: explorerTxUrl(t.hash) })),
    myDeposits: mine.map((d) => ({ ...d, usd: d.usd.toString(), at: d.at.toISOString(), explorer: explorerTxUrl(d.hash) })),
    balance: userId ? await getBalance(userId) : null,
  };
}
