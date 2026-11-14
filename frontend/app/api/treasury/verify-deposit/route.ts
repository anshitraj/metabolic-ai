import { z } from "zod";
import { DepositError, verifyDeposit } from "@/server/services/treasury";
import { body, HttpError, json, rateLimit, requireUser, route } from "@/server/http";

const Body = z.object({
  txHash: z.string().min(40).max(50),
  /** Operators only: how to book their own deposit. Ignored for everyone else. */
  purpose: z.enum(["capital", "credits"]).optional(),
  intentId: z.string().uuid().optional(),
});

export const POST = route(async (req, { requestId }) => {
  const user = await requireUser({ mutation: true });
  rateLimit(`verify-dep:${user.id}`, 30);
  const b = await body(req, Body);
  try {
    return json(await verifyDeposit(user, b.txHash, b.purpose, b.intentId), { requestId });
  } catch (e) {
    if (e instanceof DepositError) throw new HttpError(e.retryable ? 409 : 400, e.code, e.message, { retryable: e.retryable });
    throw e;
  }
});
