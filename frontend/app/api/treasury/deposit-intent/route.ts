import { z } from "zod";
import { createDepositIntent, DepositError } from "@/server/services/treasury";
import { body, HttpError, json, rateLimit, requireUser, route } from "@/server/http";

const Body = z.object({
  amountNear: z.string().regex(/^\d+(\.\d{1,6})?$/, "use a decimal like 1.5"),
  /** Operators only: fund the business ("capital") or buy credit for themselves ("credits"). */
  purpose: z.enum(["capital", "credits"]).optional(),
});

export const POST = route(async (req, { requestId }) => {
  const user = await requireUser({ mutation: true });
  rateLimit(`intent:${user.id}`, 20);
  const b = await body(req, Body);
  try {
    return json(await createDepositIntent(user, b.amountNear, b.purpose), { requestId });
  } catch (e) {
    if (e instanceof DepositError) throw new HttpError(400, e.code, e.message);
    throw e;
  }
});
