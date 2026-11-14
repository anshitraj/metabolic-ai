import { z } from "zod";
import { audit, isPaused, setSystem } from "@/server/services/core";
import { body, json, requireOperator, route } from "@/server/http";

const Body = z.object({ paused: z.boolean() });

export const GET = route(async (_req, { requestId }) => json({ paused: await isPaused() }, { requestId }));

/** Emergency pause: blocks all inference until resumed. Operator only. */
export const POST = route(async (req, { requestId }) => {
  const user = await requireOperator();
  const b = await body(req, Body);
  await setSystem("paused", b.paused);
  await audit(b.paused ? "admin.pause" : "admin.resume", { actorUserId: user.id });
  return json({ paused: b.paused }, { requestId });
});
