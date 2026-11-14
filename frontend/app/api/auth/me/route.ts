import { getSessionUser } from "@/server/services/auth";
import { getBalance } from "@/server/services/billing";
import { json, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  const user = await getSessionUser();
  if (!user) return json({ user: null }, { requestId });
  const balance = await getBalance(user.id);
  return json({ user, credits: { available: balance.available.toString(), reserved: balance.reserved.toString() } }, { requestId });
});
