import { getSessionUser } from "@/server/services/auth";
import { treasuryView } from "@/server/services/treasury";
import { json, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  const user = await getSessionUser();
  return json(await treasuryView(user?.id ?? null), { requestId });
});
