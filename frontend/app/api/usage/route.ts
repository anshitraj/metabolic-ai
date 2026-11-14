import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getSessionUser, userFromApiKey } from "@/server/services/auth";
import { HttpError, json, route } from "@/server/http";

export const GET = route(async (req, { requestId }) => {
  const user = (await getSessionUser()) ?? (await userFromApiKey(req.headers.get("authorization")));
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in or pass an API key.");
  const url = new URL(req.url);
  const channel = url.searchParams.get("channel");
  const db = await getDb();
  const conds = [eq(schema.usageRequests.userId, user.id)];
  if ("apiKeyId" in user && typeof user.apiKeyId === "string") conds.push(eq(schema.usageRequests.apiKeyId, user.apiKeyId));
  if (channel === "api" || channel === "workspace") conds.push(eq(schema.usageRequests.channel, channel));
  const rows = await db.select().from(schema.usageRequests).where(and(...conds)).orderBy(desc(schema.usageRequests.createdAt)).limit(100);
  const since = new Date(Date.now() - 14 * 86400_000);
  const daily = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${schema.usageRequests.createdAt}), 'YYYY-MM-DD')`,
      charge: sql<string>`coalesce(sum(${schema.usageRequests.charge}),0)::text`,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.usageRequests)
    .where(and(...conds, gte(schema.usageRequests.createdAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return json(
    {
      requests: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        status: r.status,
        model: r.modelId,
        tier: r.tier,
        inTokens: r.inTokens,
        outTokens: r.outTokens,
        charge: r.charge.toString(),
        cost: r.cost.toString(),
        costIsEstimated: r.costIsEstimated,
        costSource: r.providerCostSource,
        recoveryRequired: r.recoveryRequired,
        providerOverage: r.providerOverage,
        spendPassId: r.spendPassId,
        passPolicyVersion: r.passPolicyVersion,
        partial: r.partial,
        latencyMs: r.latencyMs,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
      })),
      daily,
    },
    { requestId },
  );
});
