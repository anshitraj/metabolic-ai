import { metricsSeries } from "@/server/services/economy";
import { json, route } from "@/server/http";

export const GET = route(async (req, { requestId }) => {
  const hours = Math.min(24 * 30, Math.max(1, Number(new URL(req.url).searchParams.get("hours") ?? 24) || 24));
  return json(await metricsSeries(hours), { requestId });
});
