import { activePolicy, evaluateReal, metricsJson, serializePolicy } from "@/server/services/economy";
import { json, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  const ev = await evaluateReal();
  const cfg = await activePolicy();
  return json(
    {
      state: ev.state,
      trigger: ev.trigger,
      metrics: metricsJson(ev),
      permissions: { ...ev.permissions, maxCostPerRequest: ev.permissions.maxCostPerRequest.toString(), minMarginBp: Object.fromEntries(Object.entries(ev.permissions.minMarginBp).map(([k, v]) => [k, Number.isFinite(v) ? v : null])) },
      policy: { version: cfg.version, ...serializePolicy(cfg) },
    },
    { requestId },
  );
});
