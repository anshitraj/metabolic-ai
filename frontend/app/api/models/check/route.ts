import { z } from "zod";
import { adapterFor, ProviderError } from "@/server/gateway/adapters";
import { findModel } from "@/server/economics/registry";
import { body, HttpError, json, rateLimit, requireOperator, route } from "@/server/http";

// A real, bounded generation check. Operator-only because it consumes provider quota.
export const POST = route(async (req, { requestId }) => {
  const user = await requireOperator();
  rateLimit(`model-check:${user.id}`, 6);
  const { modelId } = await body(req, z.object({ modelId: z.string().max(160) }));
  const model = findModel(modelId);
  if (!model?.enabled) throw new HttpError(400, "MODEL_NOT_CONFIGURED", model?.disabledReason ?? "Choose a configured model.");
  const started = Date.now();
  try {
    let hasText = false;
    for await (const chunk of adapterFor(model.provider).stream({
      model,
      system: "Reply briefly.",
      messages: [{ role: "user", content: "Reply with OK only." }],
      maxOutputTokens: Math.min(1024, model.maxOutputTokens),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(20_000)]),
    })) {
      if (chunk.type === "text" && chunk.text.trim()) hasText = true;
    }
    return json({ ok: hasText, message: hasText ? "Test answer received. This key can generate with this model." : "Connected, but no text answer was returned. Try again or use another model.", latencyMs: Date.now() - started }, { requestId });
  } catch (err) {
    const known = err instanceof ProviderError;
    return json({ ok: false, message: known ? err.errorClass === "aborted" ? "The connection check timed out or was cancelled. Try again in a moment." : err.message : "The connection test failed. Check the server connection and try again.", errorClass: known ? err.errorClass : "unknown", latencyMs: Date.now() - started }, { requestId });
  }
});
