import { createNonce } from "@/server/services/auth";
import { clientIp, json, rateLimit, route } from "@/server/http";

export const POST = route(async (_req, { requestId }) => {
  rateLimit(`nonce:${await clientIp()}`, 20);
  return json(await createNonce(), { requestId });
});
