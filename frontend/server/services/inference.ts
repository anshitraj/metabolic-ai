import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { chooseModel, TIER_LABEL, type RouteRequest } from "@/server/economics/router";
import { enabledModels, findModel, type RegistryModel } from "@/server/economics/registry";
import { tokenCost, marginBp } from "@/lib/economics/money";
import type { Capability, CandidateEstimate, OperatingState, RefusalCode, Tier } from "@/lib/economics/types";
import { adapterFor, estimateTokens, ProviderError, type ChatMessage } from "@/server/gateway/adapters";
import { getSystem, isPaused, publish, setSystem } from "./core";
import { activePolicy, evaluateReal } from "./economy";
import { healthMap, recordResult } from "./health";
import { BillingError, getBalance, recordProviderExpense, reserve, settle } from "./billing";
import { credentialPass, lockAdmittedPass, passAllows, recordPassRejection, reservePass, settlePass, SpendPassError, type SpendPass } from "./spend-passes";

const { usageRequests, routingDecisions } = schema;

export const SYSTEM_PROMPT =
  "You are Metabolic AI, a helpful assistant served by an AI business that pays for its own compute. Answer clearly and concisely. Use Markdown for structure when it helps. Do not mention pricing unless asked.";

export type InferenceInput = {
  userId: string;
  channel: "workspace" | "api";
  apiKeyId?: string | null;
  idempotencyKey: string;
  messages: ChatMessage[];
  system?: string;
  maxOutputTokens?: number;
  requires?: Capability[];
  tier?: Tier;
  conversationId?: string | null;
  signal: AbortSignal;
};

export type InferenceEvent =
  | {
      type: "meta";
      usageId: string;
      model: { id: string; label: string; model: string; tier: Tier; provider: string };
      state: OperatingState;
      explanation: string;
      estimate: { inTokens: number; outTokens: number; cost: string; charge: string; marginBp: number };
      reserved: string;
      switched: boolean;
      spendPass: { id: string; name: string; policyVersion: number } | null;
    }
  | { type: "text"; text: string }
  | { type: "failover"; from: string; to: string; reason: string }
  | {
      type: "final";
      usageId: string;
      model: string;
      servedModel: string;
      tier: Tier;
      inTokens: number;
      outTokens: number;
      cost: string;
      charge: string;
      marginBp: number | null;
      costIsEstimated: boolean;
      partial: boolean;
      latencyMs: number;
      explanation: string;
      state: OperatingState;
      spendPass: { id: string; name: string; policyVersion: number } | null;
      providerCostSource: string;
      providerOverage: boolean;
    }
  | { type: "error"; code: RefusalCode | "INSUFFICIENT_CREDITS" | "PROVIDER_UNAVAILABLE" | "DUPLICATE_REQUEST" | "BUSY" | "DAILY_CAP" | "REFUSED" | `PASS_${string}` | "INVALID_API_KEY"; message: string; needed?: string };

const g = globalThis as unknown as { __metabolicInflight?: { n: number } };
const inflight = g.__metabolicInflight ?? (g.__metabolicInflight = { n: 0 });

const serializeCandidates = (c: CandidateEstimate[]) =>
  c.map((x) => ({ ...x, cost: x.cost.toString(), charge: x.charge.toString() }));

export async function* runInference(input: InferenceInput): AsyncGenerator<InferenceEvent> {
  const db = await getDb();
  const cfg = await activePolicy();
  const system = input.system ?? SYSTEM_PROMPT;
  const inTokens = estimateTokens(system + input.messages.map((m) => m.content).join("\n"));
  let pass: SpendPass | null = null;
  try {
    pass = await credentialPass(input.userId, input.apiKeyId);
  } catch (err) {
    if (!(err instanceof SpendPassError)) throw err;
    await recordPassRejection(input.userId, err.passId, err.code, err.message);
    yield { type: "error", code: err.code as `PASS_${string}` | "INVALID_API_KEY", message: err.message };
    return;
  }
  // UTF-8 bytes plus framing conservatively bound input tokenization, including non-Latin text.
  const reservationInTokens = Math.max(inTokens, Buffer.byteLength(system + input.messages.map((m) => m.content).join("\n"), "utf8") + input.messages.length * 16 + 256);
  const allEnabled = enabledModels();

  const policy = await evaluateReal();
  const maxCharge = (m: RegistryModel, output?: number) => tokenCost(reservationInTokens, m.sellInPerM) + tokenCost(Math.min(output ?? input.maxOutputTokens ?? policy.permissions.maxOutputTokens, policy.permissions.maxOutputTokens, m.maxOutputTokens), m.sellOutPerM);
  const eligibleModels = (p: SpendPass) => allEnabled.filter((m) => passAllows(p, m) && maxCharge(m) <= p.maxPerRequest && maxCharge(m) <= p.totalBudget - p.spent - p.reserved);
  const models = pass ? eligibleModels(pass) : allEnabled;
  if (pass && !models.length) {
    const message = "No eligible model fits this Spend Pass's model restrictions, remaining budget and maximum charge per request. Use a cheaper tier or ask the owner for a new pass.";
    await recordPassRejection(input.userId, pass.id, "PASS_NO_MODEL", message, pass.policyVersion);
    yield { type: "error", code: "PASS_NO_MODEL", message };
    return;
  }
  const req: RouteRequest = { inTokens: reservationInTokens, maxOutputTokens: input.maxOutputTokens, expectedOutputTokens: input.maxOutputTokens ?? policy.permissions.maxOutputTokens, requires: input.requires, tier: input.tier };
  let decision = chooseModel(req, models, policy, healthMap(), { paused: await isPaused() });

  if (!decision.ok) {
    await recordPassRejection(input.userId, pass?.id, decision.code, decision.explanation, pass?.policyVersion);
    await db.insert(routingDecisions).values({
      kind: "refusal",
      state: policy.state,
      candidates: serializeCandidates(decision.candidates),
      explanation: decision.explanation,
      policyVersion: policy.policyVersion,
    });
    yield { type: "error", code: decision.code, message: decision.explanation };
    return;
  }

  // Daily provider spend cap.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [{ spent }] = await db
    .select({ spent: sql<string>`coalesce(sum(${usageRequests.cost}),0)::text` })
    .from(usageRequests)
    .where(gte(usageRequests.createdAt, dayStart));
  if (BigInt(spent) >= cfg.limits.maxDailyProviderSpend) {
    yield { type: "error", code: "DAILY_CAP", message: "The daily provider spending limit has been reached. Service resumes at 00:00 UTC." };
    return;
  }

  if (inflight.n >= cfg.limits.maxConcurrency) {
    yield { type: "error", code: "BUSY", message: "Too many requests in flight. Try again in a moment." };
    return;
  }

  let model = decision.model as RegistryModel;
  const outCap = Math.min(input.maxOutputTokens ?? policy.permissions.maxOutputTokens, policy.permissions.maxOutputTokens, model.maxOutputTokens);

  // Reserve the most this request can cost the customer; shrink output if they can't afford the max.
  let maxOut = outCap;
  let reserveAmt = maxCharge(model, maxOut);
  const bal = await getBalance(input.userId);
  if (bal.available < reserveAmt) {
    const inCharge = tokenCost(reservationInTokens, model.sellInPerM);
    const left = bal.available - inCharge;
    const affordable = left > 0n && model.sellOutPerM > 0n ? Number((left * 1_000_000n) / model.sellOutPerM) : 0;
    if (affordable < 64) {
      await recordPassRejection(input.userId, pass?.id, "INSUFFICIENT_CREDITS", "Not enough prepaid credit. Deposit testnet NEAR to continue.", pass?.policyVersion);
      const needed = tokenCost(inTokens, model.sellInPerM) + tokenCost(64, model.sellOutPerM) - bal.available;
      yield { type: "error", code: "INSUFFICIENT_CREDITS", message: "Not enough prepaid credit for this request. Deposit NEAR to continue.", needed: (needed > 0n ? needed : 1n).toString() };
      return;
    }
    maxOut = Math.min(outCap, affordable);
    reserveAmt = maxCharge(model, maxOut);
  }

  // Create the usage row + reservation atomically. The idempotency key makes retries safe.
  let usageId: string;
  try {
    usageId = await db.transaction(async (tx) => {
      const lockedPass = await credentialPass(input.userId, input.apiKeyId, tx);
      // A formerly unbound key may have been bound after preflight. Re-evaluate under its policy.
      if (lockedPass && (lockedPass.id !== pass?.id || !passAllows(lockedPass, model))) {
        const next = chooseModel(req, eligibleModels(lockedPass), policy, healthMap(), { paused: false });
        if (!next.ok) throw new SpendPassError("PASS_NO_MODEL", "No model fits the credential's current Spend Pass.");
        decision = next;
        model = next.model as RegistryModel;
        maxOut = Math.min(maxOut, model.maxOutputTokens);
        reserveAmt = maxCharge(model, maxOut);
      }
      pass = lockedPass;
      if (pass) await reservePass(tx, pass, model, reserveAmt);
      const [row] = await tx
        .insert(usageRequests)
        .values({
          userId: input.userId,
          apiKeyId: input.apiKeyId ?? null,
          spendPassId: pass?.id ?? null,
          passPolicyVersion: pass?.policyVersion ?? null,
          reservationExpiresAt: new Date(Date.now() + 180_000),
          idempotencyKey: input.idempotencyKey,
          channel: input.channel,
          status: "reserved",
          modelId: model.id,
          provider: model.provider,
          tier: model.tier,
          inTokens,
          estCost: decision.ok ? decision.estimate.cost : 0n,
          reserved: reserveAmt,
          conversationId: input.conversationId ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: usageRequests.id });
      if (!row) throw new Error("DUPLICATE");
      await reserve(tx, input.userId, reserveAmt);
      return row.id;
    });
  } catch (err) {
    if (err instanceof Error && err.message === "DUPLICATE") {
      yield { type: "error", code: "DUPLICATE_REQUEST", message: "A request with this idempotency key was already processed." };
      return;
    }
    if (err instanceof BillingError) {
      await recordPassRejection(input.userId, pass?.id, err.code, err.message, pass?.policyVersion);
      yield { type: "error", code: "INSUFFICIENT_CREDITS", message: err.message, needed: err.needed?.toString() };
      return;
    }
    if (err instanceof SpendPassError) {
      await recordPassRejection(input.userId, err.passId ?? pass?.id, err.code, err.message, pass?.policyVersion);
      yield { type: "error", code: err.code as `PASS_${string}` | "INVALID_API_KEY", message: err.message };
      return;
    }
    throw err;
  }

  await db.insert(routingDecisions).values({
    usageRequestId: usageId,
    kind: "route",
    state: policy.state,
    chosenModelId: model.id,
    tier: model.tier,
    candidates: serializeCandidates(decision.candidates),
    explanation: `${decision.explanation}${pass ? ` Spend Pass policy v${pass.policyVersion}: selected within its authorized maximum charge and model restrictions.` : ""}`,
    estCost: decision.estimate.cost,
    estCharge: decision.estimate.charge,
    policyVersion: policy.policyVersion,
  });

  const lastModel = await getSystem<string>("model:last");
  const switched = !!lastModel && lastModel !== model.id;
  if (lastModel !== model.id) await setSystem("model:last", model.id);
  if (switched) {
    await publish(
      "model.switched",
      { from: lastModel, to: model.id, tier: model.tier, label: model.label, explanation: decision.explanation, state: policy.state },
      { source: "policy", entityId: usageId },
    );
  }

  yield {
    type: "meta",
    usageId,
    model: { id: model.id, label: model.label, model: model.model, tier: model.tier, provider: model.provider },
    state: policy.state,
    explanation: decision.explanation,
    estimate: {
      inTokens,
      outTokens: decision.estimate.outTokens,
      cost: decision.estimate.cost.toString(),
      charge: decision.estimate.charge.toString(),
      marginBp: decision.estimate.marginBp,
    },
    reserved: reserveAmt.toString(),
    switched,
    spendPass: pass ? { id: pass.id, name: pass.name, policyVersion: pass.policyVersion } : null,
  };

  await publish("inference.started", { model: model.id, tier: model.tier, provider: model.provider }, { source: "gateway", entityId: usageId });
  await db.update(usageRequests).set({ status: "streaming" }).where(eq(usageRequests.id, usageId));

  inflight.n++;
  const started = Date.now();
  let text = "";
  let usage: { inTokens: number; outTokens: number } | null = null;
  let servedModel = model.model;
  let partial = false;
  let failedErr: ProviderError | null = null;
  let explanation = `${decision.explanation}${pass ? ` Spend Pass policy v${pass.policyVersion} restricts the model choice to the authorized budget and allowed models.` : ""}`;
  let attempts = 0;
  const failedAttemptExpenses: { provider: string; cost: bigint }[] = [];
  let unreconciledAttempt = false;
  const executionSignal = AbortSignal.any([input.signal, AbortSignal.timeout(90_000)]);

  try {
    while (true) {
      attempts++;
      const attemptStart = Date.now();
      try {
        const adapter = adapterFor(model.provider);
        for await (const chunk of adapter.stream({ model, system, messages: input.messages, maxOutputTokens: maxOut, signal: executionSignal })) {
          if (chunk.type === "text") {
            text += chunk.text;
            yield { type: "text", text: chunk.text };
          } else {
            usage = chunk.usage;
            servedModel = chunk.servedModel;
          }
        }
        await recordResult(model.provider, true, Date.now() - attemptStart);
        failedErr = null;
        break;
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError(err instanceof Error ? err.message : "provider error", "unknown", false);
        if (pe.errorClass !== "aborted") await recordResult(model.provider, false, null, pe.errorClass);
        failedErr = pe;
        if (input.signal.aborted || pe.errorClass === "aborted") {
          partial = text.length > 0;
          break;
        }
        // Failover only before the first token, once, and only to a model that still fits policy and the reservation.
        if (text.length > 0 || attempts > 1 || pe.errorClass === "refusal" || pe.errorClass === "bad_request") {
          partial = text.length > 0;
          break;
        }
        const health = { ...healthMap(), [model.provider]: "down" as const };
        const alt = chooseModel(req, models.filter((m) => m.provider !== model.provider), policy, health);
        if (!alt.ok) break;
        const altModel = alt.model as RegistryModel;
        const altReserve = maxCharge(altModel, maxOut);
        if (altReserve > reserveAmt) break;
        if (pass) {
          // Failover uses only the already-admitted authorization, including after revocation.
          const [admitted] = await db.select().from(usageRequests).where(eq(usageRequests.id, usageId));
          if (!admitted || !["reserved", "streaming"].includes(admitted.status) || admitted.spendPassId !== pass.id || !passAllows(pass, altModel) || altReserve > pass.maxPerRequest || admitted.reserved < altReserve) break;
        }
        if (usage) failedAttemptExpenses.push({ provider: model.provider, cost: tokenCost(usage.inTokens, model.costInPerM) + tokenCost(usage.outTokens, model.costOutPerM) });
        else {
          unreconciledAttempt = true;
          await db.insert(schema.auditEvents).values({ action: "provider.attempt_unreconciled", target: usageId, meta: { provider: model.provider, model: model.id, errorClass: pe.errorClass, expenseUnknown: true } });
        }
        yield { type: "failover", from: model.id, to: altModel.id, reason: pe.message };
        await db.insert(routingDecisions).values({
          usageRequestId: usageId,
          kind: "failover",
          state: policy.state,
          chosenModelId: altModel.id,
          tier: altModel.tier,
          candidates: serializeCandidates(alt.candidates),
          explanation: `Failover: ${pe.message}. ${alt.explanation}`,
          estCost: alt.estimate.cost,
          estCharge: alt.estimate.charge,
          policyVersion: policy.policyVersion,
        });
        explanation = `Failover after ${pe.errorClass}: ${alt.explanation}`;
        model = altModel;
        maxOut = Math.min(maxOut, altModel.maxOutputTokens);
        decision = alt;
        servedModel = altModel.model;
        usage = null;
        await db.update(usageRequests).set({ modelId: model.id, provider: model.provider, tier: model.tier }).where(eq(usageRequests.id, usageId));
      }
    }
  } finally {
    inflight.n--;
  }

  const latencyMs = Date.now() - started;

  // Nothing delivered → release the reservation, no charge.
  if (failedErr && text.length === 0) {
    await db.transaction(async (tx) => {
      await lockAdmittedPass(tx, pass?.id ?? null);
      const [admitted] = await tx.select().from(usageRequests).where(eq(usageRequests.id, usageId)).for("update");
      if (!admitted || !["reserved", "streaming"].includes(admitted.status)) return;
      const failedCost = usage ? tokenCost(usage.inTokens, model.costInPerM) + tokenCost(usage.outTokens, model.costOutPerM) : 0n;
      await settle(tx, { userId: input.userId, reserved: reserveAmt, charge: 0n, cost: failedCost, provider: model.provider, usageId });
      for (const expense of failedAttemptExpenses) await recordProviderExpense(tx, expense.provider, expense.cost, usageId);
      await settlePass(tx, pass?.id ?? null, reserveAmt, 0n);
      await tx
        .update(usageRequests)
        .set({ status: "refunded", error: failedErr!.message, latencyMs, finalizedAt: new Date(), cost: failedCost + failedAttemptExpenses.reduce((sum, e) => sum + e.cost, 0n), providerCostSource: usage && !unreconciledAttempt ? "provider_usage" : "unknown_failed_attempt", recoveryRequired: !usage || unreconciledAttempt, costIsEstimated: !usage || unreconciledAttempt })
        .where(eq(usageRequests.id, usageId));
    });
    await publish("inference.failed", { model: model.id, error: failedErr.errorClass, message: failedErr.message }, { source: "gateway", entityId: usageId });
    yield {
      type: "error",
      code: failedErr.errorClass === "refusal" ? "REFUSED" : "PROVIDER_UNAVAILABLE",
      message: failedErr.errorClass === "aborted" ? "Request cancelled before any output. You were not charged." : `${failedErr.message} You were not charged.`,
    };
    return;
  }

  // Price actual usage. If the provider served a different model (server-side fallback), cost it at that model's price when we know it.
  const costModel = (servedModel !== model.model && findModel(servedModel)) || model;
  const costIsEstimated = usage === null || unreconciledAttempt;
  const providerCostSource = unreconciledAttempt ? "provider_usage_with_unreconciled_attempt" : usage === null ? "token_estimate" : "provider_usage";
  const finalIn = usage?.inTokens ?? inTokens;
  const finalOut = usage?.outTokens ?? estimateTokens(text);
  const finalAttemptCost = tokenCost(finalIn, costModel.costInPerM) + tokenCost(finalOut, costModel.costOutPerM) + costModel.overhead;
  const cost = finalAttemptCost + failedAttemptExpenses.reduce((sum, e) => sum + e.cost, 0n);
  const chargeRaw = tokenCost(finalIn, model.sellInPerM) + tokenCost(finalOut, model.sellOutPerM);

  const charge = await db.transaction(async (tx) => {
    await lockAdmittedPass(tx, pass?.id ?? null);
    const [admitted] = await tx.select().from(usageRequests).where(eq(usageRequests.id, usageId)).for("update");
    if (!admitted || !["reserved", "streaming"].includes(admitted.status)) throw new Error("This reservation has already been finalized or recovered; operator reconciliation required.");
    const c = await settle(tx, { userId: input.userId, reserved: reserveAmt, charge: chargeRaw, cost: finalAttemptCost, provider: model.provider, usageId });
    for (const expense of failedAttemptExpenses) await recordProviderExpense(tx, expense.provider, expense.cost, usageId);
    await settlePass(tx, pass?.id ?? null, reserveAmt, c);
    await tx
      .update(usageRequests)
      .set({
        status: "finalized",
        inTokens: finalIn,
        outTokens: finalOut,
        cost,
        costIsEstimated,
        charge: c,
        latencyMs,
        partial,
        error: failedErr?.message ?? null,
        finalizedAt: new Date(),
        providerCostSource,
        providerOverage: chargeRaw > reserveAmt,
        recoveryRequired: chargeRaw > reserveAmt || unreconciledAttempt,
      })
      .where(eq(usageRequests.id, usageId));
    return c;
  });
  if (chargeRaw > reserveAmt) await db.insert(schema.auditEvents).values({ action: "inference.provider_overage", target: usageId, meta: { authorizedCharge: reserveAmt.toString(), reportedCharge: chargeRaw.toString(), customerChargeCapped: true } });

  const m = marginBp(charge, cost);
  await publish(
    "inference.completed",
    { model: model.id, tier: model.tier, cost: cost.toString(), charge: charge.toString(), marginBp: m, costIsEstimated, partial },
    { source: "gateway", entityId: usageId },
  );
  const after = await evaluateReal();

  yield {
    type: "final",
    usageId,
    model: model.id,
    servedModel,
    tier: model.tier,
    inTokens: finalIn,
    outTokens: finalOut,
    cost: cost.toString(),
    charge: charge.toString(),
    marginBp: m,
    costIsEstimated,
    partial,
    latencyMs,
    explanation,
    state: after.state,
    spendPass: pass ? { id: pass.id, name: pass.name, policyVersion: pass.policyVersion } : null,
    providerCostSource,
    providerOverage: chargeRaw > reserveAmt,
  };
}

/** Pre-flight estimate for the composer: which model would run and what it would cost. No side effects. */
export async function quote(userId: string | null, prompt: string, history: ChatMessage[] = []) {
  const policy = await evaluateReal();
  const inTokens = estimateTokens(SYSTEM_PROMPT + history.map((m) => m.content).join("\n") + prompt);
  const d = chooseModel({ inTokens }, enabledModels(), policy, healthMap(), { paused: await isPaused() });
  const balance = userId ? await getBalance(userId) : null;
  return {
    state: policy.state,
    ok: d.ok,
    explanation: d.explanation,
    code: d.ok ? null : d.code,
    model: d.ok ? { id: d.model.id, label: d.model.label, tier: d.model.tier, tierLabel: TIER_LABEL[d.model.tier] } : null,
    estimate: d.ok ? { cost: d.estimate.cost.toString(), charge: d.estimate.charge.toString(), marginBp: d.estimate.marginBp, inTokens, outTokens: d.estimate.outTokens } : null,
    credits: balance ? { available: balance.available.toString(), reserved: balance.reserved.toString() } : null,
  };
}

export async function usageCountToday(userId: string) {
  const db = await getDb();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(usageRequests).where(and(eq(usageRequests.userId, userId), gte(usageRequests.createdAt, dayStart)));
  return r?.n ?? 0;
}
