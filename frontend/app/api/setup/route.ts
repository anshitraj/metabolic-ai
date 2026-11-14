import { z } from "zod";
import { getSessionUser } from "@/server/services/auth";
import { claimOperator, setTreasuryAccount, setupStatus, SetupError } from "@/server/services/settings";
import { evaluateReal } from "@/server/services/economy";
import { body, HttpError, json, rateLimit, requireOperator, requireUser, route } from "@/server/http";

/** First-run status: is there an operator, where do deposits go, can this user claim. */
export const GET = route(async (_req, { requestId }) => {
  const user = await getSessionUser();
  return json(await setupStatus(user?.accountId ?? null), { requestId });
});

const Body = z.object({ treasuryAccountId: z.string().trim().toLowerCase().min(2).max(64) });

/** Claim the operator role (only while nobody holds it) and choose the treasury account. */
export const POST = route(async (req, { requestId }) => {
  const user = await requireUser({ mutation: true });
  rateLimit(`setup:${user.id}`, 10);
  const b = await body(req, Body);
  try {
    const status = await claimOperator(user, b.treasuryAccountId);
    await evaluateReal();
    return json(status, { requestId });
  } catch (e) {
    if (e instanceof SetupError) throw new HttpError(e.code === "ALREADY_CLAIMED" ? 409 : 400, e.code, e.message);
    throw e;
  }
});

/** Operator changes the treasury account (only before any deposit is recorded). */
export const PUT = route(async (req, { requestId }) => {
  const user = await requireOperator();
  const b = await body(req, Body);
  try {
    return json(await setTreasuryAccount(user, b.treasuryAccountId), { requestId });
  } catch (e) {
    if (e instanceof SetupError) throw new HttpError(400, e.code, e.message);
    throw e;
  }
});
