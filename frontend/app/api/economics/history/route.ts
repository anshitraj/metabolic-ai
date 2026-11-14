import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { json, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  const db = await getDb();
  const rows = await db.select().from(schema.stateTransitions).where(eq(schema.stateTransitions.scope, "real")).orderBy(desc(schema.stateTransitions.createdAt)).limit(200);
  return json(
    { transitions: rows.map((t) => ({ at: t.createdAt.toISOString(), from: t.fromState, to: t.toState, trigger: t.trigger, metrics: t.metrics, policyVersion: t.policyVersion })) },
    { requestId },
  );
});
