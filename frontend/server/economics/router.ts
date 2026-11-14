// Cost-aware, capability-aware model router. Pure. See docs/04 §6.

import { formatBp, formatUsd, marginBp, tokenCost } from "@/lib/economics/money";
import type {
  Capability,
  CandidateEstimate,
  ModelSpec,
  OperatingState,
  PolicyEvaluation,
  ProviderHealth,
  RouteDecision,
  Tier,
} from "@/lib/economics/types";

export type RouteRequest = {
  inTokens: number;
  /** Customer-requested maximum output; capped by policy. */
  maxOutputTokens?: number;
  /** Expected output length for estimation (p75 for the task class). */
  expectedOutputTokens?: number;
  requires?: Capability[];
  /** Optional pin to a tier (developer API). Still subject to policy. */
  tier?: Tier;
};

export const TIER_LABEL: Record<Tier, string> = { premium: "Premium", standard: "Standard", economy: "Economy" };

const STATE_WEIGHT: Record<OperatingState, Record<Tier, number>> = {
  ABUNDANCE: { premium: 1.0, standard: 0.94, economy: 0.86 },
  DEFENSIVE: { premium: 0.7, standard: 0.9, economy: 1.0 },
  SURVIVAL: { premium: 0, standard: 0.8, economy: 1.0 },
  RECOVERY: { premium: 0.85, standard: 1.0, economy: 0.95 },
};

/** Micro-USD of cost that costs one point of score, per state. */
const COST_SCALE: Record<OperatingState, number> = { ABUNDANCE: 4000, DEFENSIVE: 600, SURVIVAL: 100, RECOVERY: 1500 };

export function estimate(model: ModelSpec, inTokens: number, outTokens: number) {
  const cost = tokenCost(inTokens, model.costInPerM) + tokenCost(outTokens, model.costOutPerM) + model.overhead;
  const charge = tokenCost(inTokens, model.sellInPerM) + tokenCost(outTokens, model.sellOutPerM);
  return { cost, charge, marginBp: marginBp(charge, cost) ?? -10_000 };
}

export function chooseModel(
  req: RouteRequest,
  models: ModelSpec[],
  policy: PolicyEvaluation,
  health: Record<string, ProviderHealth>,
  opts: { paused?: boolean; costMultiplier?: number } = {},
): RouteDecision {
  const state = policy.state;
  const perms = policy.permissions;
  const outCap = Math.min(req.maxOutputTokens ?? perms.maxOutputTokens, perms.maxOutputTokens);
  const expectedOut = Math.min(req.expectedOutputTokens ?? Math.min(600, outCap), outCap);
  const requires = req.requires ?? ["chat"];

  if (opts.paused) {
    return { ok: false, code: "POLICY_PAUSED", candidates: [], explanation: "Inference is paused by the operator." };
  }

  const candidates: CandidateEstimate[] = [];
  const allowedModels: { model: ModelSpec; est: CandidateEstimate; score: number }[] = [];
  let anyCapable = false;
  let anyHealthy = false;

  for (const model of models) {
    const e0 = estimate(model, req.inTokens, Math.min(expectedOut, model.maxOutputTokens));
    // Stress Lab: a cost multiplier inflates provider cost (sell price unchanged).
    const mult = opts.costMultiplier ?? 1;
    const cost = mult === 1 ? e0.cost : BigInt(Math.ceil(Number(e0.cost) * mult));
    const mBp = marginBp(e0.charge, cost) ?? -10_000;
    const est: CandidateEstimate = {
      modelId: model.id,
      tier: model.tier,
      inTokens: req.inTokens,
      outTokens: Math.min(expectedOut, model.maxOutputTokens),
      cost,
      charge: e0.charge,
      marginBp: mBp,
      allowed: false,
      reason: null,
    };
    candidates.push(est);

    const capable = requires.every((c) => model.capabilities.includes(c));
    if (!capable) {
      est.reason = `lacks ${requires.filter((c) => !model.capabilities.includes(c)).join(", ")}`;
      continue;
    }
    anyCapable = true;
    if (req.tier && model.tier !== req.tier) {
      est.reason = `tier pinned to ${req.tier}`;
      continue;
    }
    if ((health[model.provider] ?? "ok") === "down") {
      est.reason = "provider down";
      continue;
    }
    anyHealthy = true;
    if (!perms.tiers[model.tier]) {
      est.reason = `${TIER_LABEL[model.tier]} disabled in ${state}`;
      continue;
    }
    const floor = perms.minMarginBp[model.tier];
    if (mBp < floor) {
      est.reason = `margin ${formatBp(mBp)} below ${formatBp(floor)} floor`;
      continue;
    }
    if (cost > perms.maxCostPerRequest) {
      est.reason = `cost ${formatUsd(cost)} above ${formatUsd(perms.maxCostPerRequest)} cap`;
      continue;
    }
    if (cost > policy.metrics.spendable) {
      est.reason = "exceeds spendable funds";
      continue;
    }
    est.allowed = true;
    const score = model.quality * STATE_WEIGHT[state][model.tier] - Number(cost) / COST_SCALE[state];
    allowedModels.push({ model, est, score });
  }

  if (allowedModels.length === 0) {
    if (!anyCapable) {
      return { ok: false, code: "NO_CAPABLE_MODEL", candidates, explanation: "No configured model has the capabilities this request needs." };
    }
    if (!anyHealthy) {
      return { ok: false, code: "ALL_PROVIDERS_DOWN", candidates, explanation: "Every capable provider is currently down." };
    }
    if (policy.metrics.spendable <= 0n || state === "SURVIVAL") {
      return {
        ok: false,
        code: "FUNDING_REQUIRED",
        candidates,
        explanation: `Request declined: ${state} — spendable funds ${formatUsd(policy.metrics.spendable)} after the reserve, and no model can run profitably within limits.`,
      };
    }
    return { ok: false, code: "COST_CAP", candidates, explanation: `Request declined: no model fits the ${state} margin and cost limits.` };
  }

  allowedModels.sort((a, b) => b.score - a.score || Number(a.est.cost - b.est.cost));
  const best = allowedModels[0];
  const explanation = explain(state, best.model, best.est, candidates, models);
  return { ok: true, model: best.model, estimate: best.est, candidates, explanation };
}

function explain(state: OperatingState, model: ModelSpec, est: CandidateEstimate, candidates: CandidateEstimate[], models: ModelSpec[]): string {
  const head = `Routed to ${TIER_LABEL[model.tier]} (${model.model})`;
  // Name the best-quality model we did not choose, and why.
  const better = candidates
    .filter((c) => c.modelId !== model.id && !c.allowed && c.reason)
    .map((c) => ({ c, q: models.find((m) => m.id === c.modelId)?.quality ?? 0 }))
    .filter((x) => x.q > model.quality)
    .sort((a, b) => b.q - a.q)[0];
  if (better) {
    return `${head}: ${TIER_LABEL[better.c.tier]} excluded — ${better.c.reason} in ${state}.`;
  }
  return `${head}: projected margin ${formatBp(est.marginBp)}, best value allowed in ${state}.`;
}
