import { z } from "zod";
import { getSessionUser } from "@/server/services/auth";
import { quote } from "@/server/services/inference";
import { body, clientIp, json, rateLimit, route } from "@/server/http";

const Body = z.object({ prompt: z.string().max(20_000), historyChars: z.number().int().min(0).max(400_000).optional() });

export const POST = route(async (req, { requestId }) => {
  rateLimit(`quote:${await clientIp()}`, 120);
  const b = await body(req, Body);
  const user = await getSessionUser();
  const history = b.historyChars ? [{ role: "user" as const, content: "x".repeat(Math.min(b.historyChars, 400_000)) }] : [];
  return json(await quote(user?.id ?? null, b.prompt, history), { requestId });
});
