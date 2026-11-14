import { createSpendPass, listSpendPasses, PassInput, SpendPassError } from "@/server/services/spend-passes";
import { body, HttpError, json, rateLimit, requireUser, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  const user = await requireUser();
  return json({ passes: await listSpendPasses(user.id) }, { requestId });
});

export const POST = route(async (req, { requestId }) => {
  const user = await requireUser({ mutation: true });
  rateLimit(`pass-create:${user.id}`, 10);
  const b = await body(req, PassInput);
  try {
    return json(await createSpendPass(user.id, b), { status: 201, requestId });
  } catch (e) {
    if (e instanceof SpendPassError) throw new HttpError(400, e.code, e.message);
    throw e;
  }
});
