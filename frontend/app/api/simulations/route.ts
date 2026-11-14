import { getSessionUser } from "@/server/services/auth";
import { createScenario } from "@/server/services/simulation";
import { clientIp, json, rateLimit, route } from "@/server/http";

// Anyone can open an isolated scenario: it never touches real balances.
export const POST = route(async (_req, { requestId }) => {
  rateLimit(`sim:${await clientIp()}`, 10);
  const user = await getSessionUser();
  return json(await createScenario(user?.id ?? null), { requestId });
});
