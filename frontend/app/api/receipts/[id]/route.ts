import { verifyReceiptOnChain } from "@/server/services/receipts";
import { HttpError, json, route } from "@/server/http";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params, requestId }) => {
  const { id } = await params;
  if (!/^rcpt_[0-9_]{8,20}(?:_[0-9a-f]{8})?$/.test(id)) throw new HttpError(400, "BAD_ID", "Receipt ids look like rcpt_20261114_153000 or rcpt_20261114_153000_a1b2c3d4.");
  return json(await verifyReceiptOnChain(id), { requestId });
});
