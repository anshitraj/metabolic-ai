import { signOut } from "@/server/services/auth";
import { json, route } from "@/server/http";

export const POST = route(async (_req, { requestId }) => {
  await signOut();
  return json({ ok: true }, { requestId });
});
