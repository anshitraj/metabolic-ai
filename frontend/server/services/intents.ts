import "server-only";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { config } from "@/server/config";
import { parseDecimal } from "@/lib/economics/money";
import {
  creditableMicro,
  destinationMicro,
  isTerminal,
  oneClick,
  OneClickError,
  USDC_ON_NEAR,
  type OneClickStatusResponse,
  type OneClickToken,
} from "@/server/near/intents";
import { audit, publish } from "./core";
import { creditIntentPayment, getBalance } from "./billing";
import { evaluateReal } from "./economy";

// Pay with any token through NEAR Intents. The customer picks a token on any
// supported chain; 1Click returns a one-off deposit address; solvers swap it
// and deliver USDC on NEAR to the business's mainnet account; once 1Click
// reports SUCCESS for that address the customer's credit is booked, once.

const { intentPayments } = schema;

export class IntentsError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

export function intentsConfigured(): { ok: boolean; reason?: string } {
  if (!config.intents.recipient) return { ok: false, reason: "Set INTENTS_RECIPIENT_ACCOUNT_ID (a mainnet NEAR account) to accept NEAR Intents payments." };
  if (!/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(config.intents.recipient) || config.intents.recipient.endsWith(".testnet")) {
    return { ok: false, reason: "INTENTS_RECIPIENT_ACCOUNT_ID must be a mainnet NEAR account (NEAR Intents has no testnet)." };
  }
  return { ok: true };
}

let tokenCache: { at: number; tokens: OneClickToken[] } | null = null;

/** Supported tokens with a live USD price, cached for five minutes. */
export async function payTokens(): Promise<OneClickToken[]> {
  if (tokenCache && Date.now() - tokenCache.at < 5 * 60_000) return tokenCache.tokens;
  const all = await oneClick.tokens();
  const tokens = all
    .filter((t) => t.assetId && t.symbol && Number(t.price) > 0 && Number.isInteger(t.decimals))
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain));
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

export function publicIntentsConfig() {
  const c = intentsConfigured();
  return {
    enabled: c.ok,
    reason: c.reason ?? null,
    network: "mainnet" as const,
    recipient: c.ok ? config.intents.recipient! : null,
    destinationAsset: USDC_ON_NEAR,
    destinationSymbol: "USDC",
    minUsd: config.intents.minUsdMicro.toString(),
    maxUsd: config.intents.maxUsdMicro.toString(),
    authenticated: !!config.intents.apiKey,
  };
}

type Row = typeof intentPayments.$inferSelect;

export function paymentDto(r: Row) {
  return {
    id: r.id,
    status: r.status,
    origin: { assetId: r.originAsset, symbol: r.originSymbol, chain: r.originChain },
    amountIn: r.amountIn,
    amountInFormatted: r.amountInFormatted,
    depositAddress: r.depositAddress,
    depositMemo: r.depositMemo,
    refundTo: r.refundTo,
    recipient: r.recipient,
    quotedUsd: r.quotedUsdMicro.toString(),
    settledUsd: r.settledUsdMicro?.toString() ?? null,
    creditedUsd: r.creditedUsdMicro?.toString() ?? null,
    creditedAt: r.creditedAt?.toISOString() ?? null,
    depositTxHash: r.depositTxHash,
    deadline: r.deadline.toISOString(),
    createdAt: r.createdAt.toISOString(),
    explorer: `https://explorer.near-intents.org/transactions/${encodeURIComponent(r.depositAddress)}`,
  };
}

export async function createIntentPayment(
  user: { id: string; accountId: string },
  input: { originAsset: string; amount: string; refundTo: string },
) {
  const c = intentsConfigured();
  if (!c.ok) throw new IntentsError("NOT_CONFIGURED", c.reason!, 503);
  const token = (await payTokens()).find((t) => t.assetId === input.originAsset);
  if (!token) throw new IntentsError("UNSUPPORTED_TOKEN", "That token is not supported by NEAR Intents right now.");
  if (token.assetId === USDC_ON_NEAR) throw new IntentsError("SAME_ASSET", "USDC on NEAR is what the treasury receives; pick a token on another chain or a different token.");
  const amount = parseDecimal(input.amount, token.decimals);
  if (amount === null || amount <= 0n) throw new IntentsError("BAD_AMOUNT", `Enter an amount of ${token.symbol} with at most ${token.decimals} decimals.`);
  const refundTo = input.refundTo.trim();
  if (refundTo.length < 2 || refundTo.length > 128) throw new IntentsError("BAD_REFUND", `Enter your ${token.blockchain} address so a failed swap can be refunded.`);

  const deadline = new Date(Date.now() + config.intents.deadlineMinutes * 60_000);
  let res;
  try {
    res = await oneClick.quote({
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: config.intents.slippageBp,
      originAsset: token.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_ON_NEAR,
      amount: amount.toString(),
      refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: config.intents.recipient!,
      recipientType: "DESTINATION_CHAIN",
      deadline: deadline.toISOString(),
      referral: "metabolic-ai",
    });
  } catch (e) {
    if (e instanceof OneClickError) throw new IntentsError("QUOTE_FAILED", `NEAR Intents could not quote this swap: ${e.message}`, e.status >= 500 ? 502 : 400);
    throw e;
  }
  const q = res.quote;
  if (!q?.depositAddress) throw new IntentsError("QUOTE_FAILED", "NEAR Intents returned a quote without a deposit address.", 502);
  if (res.quoteRequest.recipient !== config.intents.recipient || res.quoteRequest.destinationAsset !== USDC_ON_NEAR || res.quoteRequest.amount !== amount.toString()) {
    throw new IntentsError("QUOTE_MISMATCH", "The quote does not match the requested recipient, asset or amount.", 502);
  }
  // Quote on the guaranteed minimum, so credit never depends on positive slippage.
  const quoted = destinationMicro(USDC_ON_NEAR, q.minAmountOut, q.amountOutUsd);
  if (quoted === null) throw new IntentsError("QUOTE_FAILED", "The quote has no usable output amount.", 502);
  if (quoted < config.intents.minUsdMicro || quoted > config.intents.maxUsdMicro) {
    throw new IntentsError("BAD_AMOUNT", `Payments must settle between $${Number(config.intents.minUsdMicro) / 1e6} and $${Number(config.intents.maxUsdMicro) / 1e6}. This one settles at about $${q.amountOutUsd}.`);
  }

  const db = await getDb();
  const [row] = await db
    .insert(intentPayments)
    .values({
      userId: user.id,
      originAsset: token.assetId,
      originSymbol: token.symbol,
      originChain: token.blockchain,
      destinationAsset: USDC_ON_NEAR,
      recipient: config.intents.recipient!,
      amountIn: amount.toString(),
      amountInFormatted: q.amountInFormatted,
      refundTo,
      depositAddress: q.depositAddress,
      depositMemo: q.depositMemo ?? null,
      quotedUsdMicro: quoted,
      quote: res,
      deadline: q.deadline ? new Date(q.deadline) : deadline,
    })
    .returning();
  await audit("treasury.intent.created", { actorUserId: user.id, target: row.depositAddress, meta: { originAsset: token.assetId, amountIn: row.amountIn, quotedUsd: quoted.toString(), correlationId: res.correlationId } });
  await publish("treasury.intent.created", { account: user.accountId, symbol: token.symbol, chain: token.blockchain, quotedUsd: quoted.toString() }, { source: "treasury", entityId: row.id });
  return { ...paymentDto(row), timeEstimateSeconds: q.timeEstimate, amountOutFormatted: q.amountOutFormatted };
}

/** Ask 1Click for the swap's state; credit the customer once when it settles. */
export async function refreshIntentPayment(id: string, userId?: string) {
  const db = await getDb();
  const [row] = await db.select().from(intentPayments).where(userId ? and(eq(intentPayments.id, id), eq(intentPayments.userId, userId)) : eq(intentPayments.id, id));
  if (!row) throw new IntentsError("NOT_FOUND", "No such payment for this account.", 404);
  if (row.creditedAt || isTerminal(row.status)) return paymentDto(row);

  let st: OneClickStatusResponse;
  try {
    st = await oneClick.status(row.depositAddress, row.depositMemo);
  } catch (e) {
    if (e instanceof OneClickError && e.status === 404) return paymentDto(row);
    throw e;
  }
  const req = st.quoteResponse?.quoteRequest;
  if (!req || req.recipient !== row.recipient || req.destinationAsset !== row.destinationAsset || st.quoteResponse.quote?.depositAddress !== row.depositAddress) {
    throw new IntentsError("STATUS_MISMATCH", "NEAR Intents returned a status for a different recipient, asset or deposit address.", 502);
  }
  const depositTx = st.swapDetails?.originChainTxHashes?.[0]?.hash ?? row.depositTxHash;

  if (st.status !== "SUCCESS") {
    const [updated] = await db
      .update(intentPayments)
      .set({ status: st.status, depositTxHash: depositTx, updatedAt: new Date() })
      .where(and(eq(intentPayments.id, row.id), isNull(intentPayments.creditedAt)))
      .returning();
    return paymentDto(updated ?? row);
  }

  const settled = destinationMicro(row.destinationAsset, st.swapDetails.amountOut, st.swapDetails.amountOutUsd);
  const credit = creditableMicro(row.quotedUsdMicro, settled);
  const credited = await db.transaction(async (t) => {
    const [claimed] = await t
      .update(intentPayments)
      .set({ status: "SUCCESS", depositTxHash: depositTx, settledUsdMicro: settled, creditedUsdMicro: credit, creditedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(intentPayments.id, row.id), isNull(intentPayments.creditedAt)))
      .returning();
    if (!claimed) return null;
    if (credit > 0n) await creditIntentPayment(t, row.userId, credit, row.id);
    return claimed;
  });
  if (!credited) {
    const [now] = await db.select().from(intentPayments).where(eq(intentPayments.id, row.id));
    return paymentDto(now);
  }
  await audit("treasury.intent.settled", { actorUserId: row.userId, target: row.depositAddress, meta: { settledUsd: settled?.toString() ?? null, creditedUsd: credit.toString(), nearTxHashes: st.swapDetails.nearTxHashes } });
  await publish(
    "treasury.intent.settled",
    { symbol: row.originSymbol, chain: row.originChain, usd: credit.toString(), depositAddress: row.depositAddress, nearTxHashes: st.swapDetails.nearTxHashes },
    { source: "treasury", entityId: row.id },
  );
  await evaluateReal();
  return paymentDto(credited);
}

/** Tell 1Click about the customer's deposit transaction so it is picked up sooner. */
export async function submitIntentDepositTx(id: string, userId: string, txHash: string) {
  const db = await getDb();
  const [row] = await db.select().from(intentPayments).where(and(eq(intentPayments.id, id), eq(intentPayments.userId, userId)));
  if (!row) throw new IntentsError("NOT_FOUND", "No such payment for this account.", 404);
  if (row.creditedAt || isTerminal(row.status)) return paymentDto(row);
  try {
    await oneClick.submitDeposit({ txHash, depositAddress: row.depositAddress, ...(row.depositMemo ? { memo: row.depositMemo } : {}) });
  } catch (e) {
    if (e instanceof OneClickError) throw new IntentsError("SUBMIT_FAILED", `NEAR Intents did not accept that transaction: ${e.message}`, e.status >= 500 ? 502 : 400);
    throw e;
  }
  await db.update(intentPayments).set({ depositTxHash: txHash, updatedAt: new Date() }).where(eq(intentPayments.id, row.id));
  return refreshIntentPayment(id, userId);
}

export async function listIntentPayments(userId: string) {
  const db = await getDb();
  const rows = await db.select().from(intentPayments).where(eq(intentPayments.userId, userId)).orderBy(desc(intentPayments.createdAt)).limit(20);
  return { payments: rows.map(paymentDto), balance: await getBalance(userId) };
}

/** Worker job: settle open payments from the last two days. */
export async function refreshOpenIntentPayments(limit = 20): Promise<number> {
  if (!intentsConfigured().ok) return 0;
  const db = await getDb();
  const open = await db
    .select({ id: intentPayments.id })
    .from(intentPayments)
    .where(and(isNull(intentPayments.creditedAt), inArray(intentPayments.status, ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING"]), gt(intentPayments.createdAt, sql`now() - interval '2 days'`)))
    .orderBy(intentPayments.createdAt)
    .limit(limit);
  let settled = 0;
  for (const p of open) {
    const r = await refreshIntentPayment(p.id);
    if (r.creditedAt) settled++;
  }
  return settled;
}
