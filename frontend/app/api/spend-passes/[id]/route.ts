import { z } from "zod";
import { getSpendPass, revokeSpendPass } from "@/server/services/spend-passes";
import { HttpError, json, requireUser, route } from "@/server/http";

type Context = { params: Promise<{ id: string }> };
export const GET = route<Context>(async (_req, { params, requestId }) => {
  const user = await requireUser();
  const id = z.string().uuid().parse((await params).id);
  const result = await getSpendPass(user.id, id);
  if (!result) throw new HttpError(404, "NOT_FOUND", "Spend Pass not found.");
  return json(result, { requestId });
});

export const DELETE = route<Context>(async (_req, { params, requestId }) => {
  const user = await requireUser({ mutation: true });
  const id = z.string().uuid().parse((await params).id);
  const pass = await revokeSpendPass(user.id, id);
  if (!pass) throw new HttpError(404, "NOT_FOUND", "Spend Pass not found.");
  return json({ pass }, { requestId });
});
