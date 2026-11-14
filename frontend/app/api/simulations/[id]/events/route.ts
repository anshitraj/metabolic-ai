import { z } from "zod";
import { getSessionUser } from "@/server/services/auth";
import { applyAction } from "@/server/services/simulation";
import { body, clientIp, HttpError, json, rateLimit, route } from "@/server/http";

const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("spike_cost"), multiplier: z.number().min(0.5).max(10) }),
  z.object({ type: z.literal("set_demand"), multiplier: z.number().min(0).max(3) }),
  z.object({ type: z.literal("set_traffic"), perMin: z.number().min(0).max(120) }),
  z.object({ type: z.literal("drain_treasury") }),
  z.object({ type: z.literal("restore_funding"), usd: z.number().min(1).max(1000).optional() }),
  z.object({ type: z.literal("provider_failure"), provider: z.string().max(32), down: z.boolean() }),
  z.object({ type: z.literal("reset") }),
]);

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params, requestId }) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "NOT_FOUND", "Scenario not found or expired.");
  rateLimit(`simact:${await clientIp()}`, 120);
  const action = await body(req, Action);
  const user = await getSessionUser();
  const s = await applyAction(id, user?.id ?? null, action);
  if (!s) throw new HttpError(404, "NOT_FOUND", "Scenario not found or expired.");
  return json(s, { requestId });
});
