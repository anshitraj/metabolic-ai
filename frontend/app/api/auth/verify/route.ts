import { z } from "zod";
import { AuthError, setSessionCookie, verifySignIn } from "@/server/services/auth";
import { body, clientIp, HttpError, json, rateLimit, route } from "@/server/http";

const Body = z.object({
  accountId: z.string().min(2).max(64).regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/),
  publicKey: z.string().min(40).max(100),
  signature: z.string().min(80).max(140),
  nonce: z.string().length(44),
  callbackUrl: z.string().url().max(500).nullish(),
});

export const POST = route(async (req, { requestId }) => {
  rateLimit(`verify:${await clientIp()}`, 20);
  const b = await body(req, Body);
  try {
    const r = await verifySignIn(b);
    await setSessionCookie(r.token, r.expiresAt);
    return json({ user: r.user }, { requestId });
  } catch (e) {
    if (e instanceof AuthError) throw new HttpError(401, "SIGN_IN_FAILED", e.message);
    throw e;
  }
});
