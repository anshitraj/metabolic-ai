import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { allModels, PROVIDER_LABEL } from "@/server/economics/registry";
import { estimate, TIER_LABEL } from "@/server/economics/router";
import { healthMap, latencyStats } from "@/server/services/health";
import { json, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3600_000);
  const freq = await db
    .select({ model: schema.routingDecisions.chosenModelId, n: sql<number>`count(*)::int` })
    .from(schema.routingDecisions)
    .where(and(eq(schema.routingDecisions.scope, "real"), eq(schema.routingDecisions.kind, "route"), gte(schema.routingDecisions.createdAt, since)))
    .groupBy(schema.routingDecisions.chosenModelId);
  const total = freq.reduce((n, f) => n + f.n, 0);
  const avail = await db
    .select({ provider: schema.providerHealth.provider, ok: sql<number>`sum(case when ${schema.providerHealth.ok} then 1 else 0 end)::int`, n: sql<number>`count(*)::int` })
    .from(schema.providerHealth)
    .where(gte(schema.providerHealth.observedAt, since))
    .groupBy(schema.providerHealth.provider);
  const health = healthMap();
  const models = allModels().map((m) => {
    const e = estimate(m, 800, 500);
    const f = freq.find((x) => x.model === m.id)?.n ?? 0;
    const a = avail.find((x) => x.provider === m.provider);
    const lat = latencyStats(m.provider);
    return {
      id: m.id,
      provider: m.provider,
      providerLabel: PROVIDER_LABEL[m.provider] ?? m.provider,
      model: m.model,
      label: m.label,
      tier: m.tier,
      tierLabel: TIER_LABEL[m.tier],
      quality: m.quality,
      capabilities: m.capabilities,
      maxOutputTokens: m.maxOutputTokens,
      costInPerM: m.costInPerM.toString(),
      costOutPerM: m.costOutPerM.toString(),
      sellInPerM: m.sellInPerM.toString(),
      sellOutPerM: m.sellOutPerM.toString(),
      sampleRequest: { inTokens: 800, outTokens: 500, cost: e.cost.toString(), charge: e.charge.toString(), marginBp: e.marginBp },
      enabled: m.enabled,
      disabledReason: m.disabledReason,
      health: m.enabled ? health[m.provider] ?? "ok" : null,
      availability: a && a.n > 0 ? a.ok / a.n : null,
      latency: lat,
      routedShare: total ? f / total : 0,
      routed24h: f,
    };
  });
  return json({ models, routedTotal24h: total }, { requestId });
});
