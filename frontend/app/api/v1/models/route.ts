import { json, requireApiKey, route } from "@/server/http";
import { MODEL_NAMES } from "@/server/services/agent-gateway";

export const dynamic = "force-dynamic";

/** OpenAI-compatible model list. Names are routing modes, not fixed providers: the router picks the actual model. */
export const GET = route(async (req, { requestId }) => {
  await requireApiKey(req);
  const created = Math.floor(Date.now() / 1000);
  return json({ object: "list", data: MODEL_NAMES.map((id) => ({ id, object: "model", created, owned_by: "metabolic-ai" })) }, { requestId });
});
