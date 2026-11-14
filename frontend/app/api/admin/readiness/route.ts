import { deploymentReadiness } from "@/server/services/readiness";
import { json, requireOperator, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  await requireOperator();
  return json(await deploymentReadiness(), { requestId });
});
