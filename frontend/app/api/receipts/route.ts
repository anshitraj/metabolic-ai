import { listReceipts, publishReceipt, receiptsConfigured } from "@/server/services/receipts";
import { HttpError, json, rateLimit, requireUser, route } from "@/server/http";

export const GET = route(async (_req, { requestId }) => {
  const cfg = receiptsConfigured();
  return json({ configured: cfg.ok, reason: cfg.reason, receipts: await listReceipts() }, { requestId });
});

// Publishing a receipt spends gas from the server's receipt signer, so any signed-in
// user may trigger it (rate-limited) — it commits only an aggregate hash, never user data.
export const POST = route(async (_req, { requestId }) => {
  const user = await requireUser({ mutation: true });
  rateLimit(`receipt:${user.id}`, 3);
  rateLimit(`receipt:global`, 10);
  const cfg = receiptsConfigured();
  if (!cfg.ok) throw new HttpError(503, "RECEIPTS_NOT_CONFIGURED", `On-chain receipts are not configured: ${cfg.reason}.`);
  try {
    return json(await publishReceipt({ actorUserId: user.id }), { requestId });
  } catch (e) {
    throw new HttpError(502, "RECEIPT_FAILED", e instanceof Error ? e.message.slice(0, 300) : "Receipt submission failed.");
  }
});
