import { getSessionUser } from "@/server/services/auth";
import { endScenario, getScenario } from "@/server/services/simulation";
import { HttpError, json, route } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

async function id(params: Ctx["params"]) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "NOT_FOUND", "Scenario not found or expired.");
  return id;
}

export const GET = route<Ctx>(async (_req, { params, requestId }) => {
  const user = await getSessionUser();
  const s = await getScenario(await id(params), user?.id ?? null);
  if (!s) throw new HttpError(404, "NOT_FOUND", "Scenario not found or expired.");
  return json(s, { requestId });
});

export const DELETE = route<Ctx>(async (_req, { params, requestId }) => {
  const user = await getSessionUser();
  const ok = await endScenario(await id(params), user?.id ?? null);
  if (!ok) throw new HttpError(404, "NOT_FOUND", "Scenario not found or expired.");
  return json({ ok: true }, { requestId });
});
