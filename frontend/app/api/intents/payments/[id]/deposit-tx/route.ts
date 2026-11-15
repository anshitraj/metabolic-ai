import { z } from "zod";
import { IntentsError, submitIntentDepositTx } from "@/server/services/intents";
import { body, HttpError, json, rateLimit, requireUser, route } from "@/server/http";

const Body = z.object({ txHash: z.string().min(16).max(200) });

/** Optional: report the deposit transaction so NEAR Intents picks it up sooner. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params, requestId }) => {
  const user = await requireUser({ mutation: true });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "BAD_ID", "Payment ids are UUIDs.");
  rateLimit(`intent-tx:${user.id}`, 20);
  const b = await body(req, Body);
  try {
    return json(await submitIntentDepositTx(id, user.id, b.txHash.trim()), { requestId });
  } catch (e) {
    if (e instanceof IntentsError) throw new HttpError(e.status, e.code, e.message);
    throw e;
  }
});
