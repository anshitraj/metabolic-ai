import { z } from "zod";
import { createIntentPayment, IntentsError, listIntentPayments } from "@/server/services/intents";
import { body, HttpError, json, rateLimit, requireUser, route } from "@/server/http";

const Body = z.object({
  originAsset: z.string().min(3).max(200),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "use a decimal like 25 or 0.01"),
  refundTo: z.string().min(2).max(128),
});

export const GET = route(async (_req, { requestId }) => {
  const user = await requireUser();
  return json(await listIntentPayments(user.id), { requestId });
});

/** Get a one-off NEAR Intents deposit address for paying with any supported token. */
export const POST = route(async (req, { requestId }) => {
  const user = await requireUser({ mutation: true });
  rateLimit(`intent-quote:${user.id}`, 10);
  const b = await body(req, Body);
  try {
    return json(await createIntentPayment(user, b), { requestId, status: 201 });
  } catch (e) {
    if (e instanceof IntentsError) throw new HttpError(e.status, e.code, e.message);
    throw e;
  }
});
