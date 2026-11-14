import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { activePolicy, invalidatePolicyCache, serializePolicy } from "@/server/services/economy";
import { audit } from "@/server/services/core";
import { body, json, requireOperator, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  const cfg = await activePolicy();
  return json({ version: cfg.version, ...serializePolicy(cfg) }, { requestId });
});

const Body = z.object({
  hardReserveMicro: z.string().regex(/^\d{1,15}$/),
  abundanceMinMarginBp: z.number().int().min(0).max(9000),
  abundanceMinCoverageBp: z.number().int().min(10_500).max(1_000_000),
  defensiveEnterMarginBp: z.number().int().min(-5000).max(9000),
  defensiveEnterCoverageBp: z.number().int().min(10_000).max(1_000_000),
  minDwellSeconds: z.number().int().min(0).max(86_400),
  recoveryDwellSeconds: z.number().int().min(0).max(86_400),
  hysteresisBp: z.number().int().min(0).max(5000),
});

/** Publish a new policy version (versions are append-only). Operator only. */
export const PUT = route(async (req, { requestId }) => {
  const user = await requireOperator();
  const b = await body(req, Body);
  const db = await getDb();
  const [last] = await db.select().from(schema.policyConfigs).orderBy(desc(schema.policyConfigs.version)).limit(1);
  const version = Math.max(1, last?.version ?? 1) + 1;
  await db.transaction(async (tx) => {
    await tx.update(schema.policyConfigs).set({ active: false });
    await tx.insert(schema.policyConfigs).values({ version, config: b, active: true, createdBy: user.id });
  });
  invalidatePolicyCache();
  await audit("policy.update", { actorUserId: user.id, target: String(version), meta: b });
  return json({ version, ...b }, { requestId });
});
