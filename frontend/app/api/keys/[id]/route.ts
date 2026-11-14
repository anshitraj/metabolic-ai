import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/services/core";
import { HttpError, json, requireUser, route } from "@/server/http";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { params, requestId }) => {
  const user = await requireUser({ mutation: true });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "NOT_FOUND", "Key not found.");
  const db = await getDb();
  const r = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.userId, user.id), isNull(schema.apiKeys.revokedAt)))
    .returning({ id: schema.apiKeys.id });
  if (!r.length) throw new HttpError(404, "NOT_FOUND", "Key not found or already revoked.");
  await audit("api_key.revoke", { actorUserId: user.id, target: id });
  return json({ ok: true }, { requestId });
});
