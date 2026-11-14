import { z } from "zod";
import { desc, eq, isNull, and, count } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newApiKeySecret } from "@/server/services/auth";
import { audit } from "@/server/services/core";
import { body, HttpError, json, requireUser, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  const user = await requireUser();
  const db = await getDb();
  const rows = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, user.id)).orderBy(desc(schema.apiKeys.createdAt));
  return json(
    {
      keys: rows.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        spendPassId: k.spendPassId,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        revokedAt: k.revokedAt?.toISOString() ?? null,
      })),
    },
    { requestId },
  );
});

const Body = z.object({ name: z.string().trim().min(1).max(60) });

export const POST = route(async (req, { requestId }) => {
  const user = await requireUser({ mutation: true });
  const b = await body(req, Body);
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.apiKeys).where(and(eq(schema.apiKeys.userId, user.id), isNull(schema.apiKeys.revokedAt)));
  if (Number(n) >= 10) throw new HttpError(400, "TOO_MANY_KEYS", "Revoke an existing key before creating more than 10.");
  const k = newApiKeySecret();
  const [row] = await db.insert(schema.apiKeys).values({ userId: user.id, name: b.name, prefix: k.prefix, hash: k.hash }).returning();
  await audit("api_key.create", { actorUserId: user.id, target: row.id });
  // The secret is returned exactly once and never stored.
  return json({ id: row.id, name: row.name, prefix: row.prefix, secret: k.secret, createdAt: row.createdAt.toISOString() }, { requestId });
});
