import { payTokens, publicIntentsConfig } from "@/server/services/intents";
import { json, rateLimit, route, clientIp } from "@/server/http";

// Public: the NEAR Intents configuration and the tokens a customer can pay with.
export const GET = route(async (_req, { requestId }) => {
  rateLimit(`intent-tokens:${await clientIp()}`, 30);
  const cfg = publicIntentsConfig();
  const tokens = cfg.enabled ? (await payTokens()).map((t) => ({ assetId: t.assetId, symbol: t.symbol, chain: t.blockchain, decimals: t.decimals, priceUsd: String(t.price ?? "") })) : [];
  return json({ ...cfg, tokens }, { requestId });
});
