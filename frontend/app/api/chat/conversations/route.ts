import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { json, requireUser, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  const user = await requireUser();
  const db = await getDb();
  const rows = await db
    .select({ id: schema.conversations.id, title: schema.conversations.title, updatedAt: schema.conversations.updatedAt })
    .from(schema.conversations)
    .where(eq(schema.conversations.userId, user.id))
    .orderBy(desc(schema.conversations.updatedAt))
    .limit(50);
  return json({ conversations: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) }, { requestId });
});
