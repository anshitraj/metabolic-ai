import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { HttpError, json, requireUser, route } from "@/server/http";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params, requestId }) => {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "NOT_FOUND", "Conversation not found.");
  const db = await getDb();
  const [c] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.id, id), eq(schema.conversations.userId, user.id)));
  if (!c) throw new HttpError(404, "NOT_FOUND", "Conversation not found.");
  const usageIds = c.messages.map((m) => m.usageId).filter((x): x is string => !!x);
  const usage = usageIds.length
    ? await db.select().from(schema.usageRequests).where(inArray(schema.usageRequests.id, usageIds))
    : [];
  const decisions = usageIds.length
    ? await db.select().from(schema.routingDecisions).where(inArray(schema.routingDecisions.usageRequestId, usageIds))
    : [];
  const byId = new Map(usage.map((u) => [u.id, u]));
  return json(
    {
      id: c.id,
      title: c.title,
      messages: c.messages.map((m) => {
        const u = m.usageId ? byId.get(m.usageId) : undefined;
        const d = decisions.filter((x) => x.usageRequestId === m.usageId).at(-1);
        return {
          role: m.role,
          content: m.content,
          usage: u
            ? {
                usageId: u.id,
                model: u.modelId,
                tier: u.tier,
                inTokens: u.inTokens,
                outTokens: u.outTokens,
                cost: u.cost.toString(),
                charge: u.charge.toString(),
                costIsEstimated: u.costIsEstimated,
                partial: u.partial,
                latencyMs: u.latencyMs,
                explanation: d?.explanation ?? null,
                state: d?.state ?? null,
              }
            : null,
        };
      }),
    },
    { requestId },
  );
});
