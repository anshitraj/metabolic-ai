import { IntentsError, refreshIntentPayment } from "@/server/services/intents";
import { HttpError, json, rateLimit, requireUser, route } from "@/server/http";

/** Current state of a payment; credits the account the first time it reads SUCCESS. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params, requestId }) => {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "BAD_ID", "Payment ids are UUIDs.");
  rateLimit(`intent-status:${user.id}`, 60);
  try {
    return json(await refreshIntentPayment(id, user.id), { requestId });
  } catch (e) {
    if (e instanceof IntentsError) throw new HttpError(e.status, e.code, e.message);
    throw e;
  }
});
