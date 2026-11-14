import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runInference, type InferenceEvent } from "@/server/services/inference";
import { body, HttpError, json, rateLimit, requireApiKey, route } from "@/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(50_000) }))
    .min(1)
    .max(100)
    .refine((m) => m[m.length - 1].role === "user", "the last message must be from the user"),
  system: z.string().max(10_000).optional(),
  max_output_tokens: z.number().int().min(16).max(8192).optional(),
  requires: z.array(z.enum(["chat", "code", "reasoning", "long_context"])).max(4).optional(),
  tier: z.enum(["premium", "standard", "economy"]).optional(),
  stream: z.boolean().optional(),
});

const STATUS: Record<string, number> = {
  INSUFFICIENT_CREDITS: 402,
  FUNDING_REQUIRED: 503,
  POLICY_PAUSED: 503,
  NO_CAPABLE_MODEL: 422,
  COST_CAP: 422,
  ALL_PROVIDERS_DOWN: 503,
  PROVIDER_UNAVAILABLE: 502,
  DUPLICATE_REQUEST: 409,
  BUSY: 429,
  DAILY_CAP: 503,
  REFUSED: 422,
  PASS_REVOKED: 403,
  PASS_EXPIRED: 403,
  PASS_EXHAUSTED: 402,
  PASS_BUDGET: 402,
  PASS_REQUEST_CAP: 422,
  PASS_MODEL: 403,
  PASS_NO_MODEL: 422,
  PASS_NOT_FOUND: 403,
  INVALID_API_KEY: 401,
};

/**
 * Developer inference API. Authenticate with `Authorization: Bearer mk_test_…`.
 * Set `Idempotency-Key` to make retries safe. `stream: true` returns SSE.
 */
export const POST = route(async (req, { requestId }) => {
  const key = await requireApiKey(req);
  rateLimit(`api:${key.apiKeyId}`, 60);
  const b = await body(req, Body);
  const idem = req.headers.get("idempotency-key")?.slice(0, 80) || randomUUID();
  const abort = new AbortController();
  const gen = runInference({
    userId: key.id,
    channel: "api",
    apiKeyId: key.apiKeyId,
    idempotencyKey: idem,
    messages: b.messages,
    system: b.system,
    maxOutputTokens: b.max_output_tokens,
    requires: b.requires,
    tier: b.tier,
    signal: AbortSignal.any([req.signal, abort.signal]),
  });

  if (b.stream) {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const ev of gen) {
            try { controller.enqueue(enc.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)); }
            catch { abort.abort(); /* Continue consuming the generator so accounting finishes. */ }
          }
        } catch (err) {
          console.error(err);
          try { controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ type: "error", code: "INTERNAL", message: "internal error" })}\n\n`)); } catch { /* disconnected */ }
        } finally {
          try { controller.close(); } catch { /* disconnected */ }
        }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-request-id": requestId } });
  }

  let text = "";
  let meta: Extract<InferenceEvent, { type: "meta" }> | null = null;
  let final: Extract<InferenceEvent, { type: "final" }> | null = null;
  for await (const ev of gen) {
    if (ev.type === "text") text += ev.text;
    else if (ev.type === "meta") meta = ev;
    else if (ev.type === "final") final = ev;
    else if (ev.type === "error") {
      throw new HttpError(STATUS[ev.code] ?? 400, ev.code, ev.message, ev.needed ? { needed_micro_usd: ev.needed } : undefined);
    }
  }
  return json(
    {
      id: final?.usageId,
      output: text,
      routing: {
        model: final?.model,
        served_model: final?.servedModel,
        tier: final?.tier,
        state: final?.state,
        explanation: final?.explanation ?? meta?.explanation,
        spend_pass: final?.spendPass ?? meta?.spendPass,
      },
      billing: {
        input_tokens: final?.inTokens,
        output_tokens: final?.outTokens,
        provider_cost_micro_usd: final?.cost,
        charge_micro_usd: final?.charge,
        margin_bp: final?.marginBp,
        cost_is_estimated: final?.costIsEstimated,
        partial: final?.partial,
        provider_cost_source: final?.providerCostSource,
        provider_overage: final?.providerOverage,
      },
      latency_ms: final?.latencyMs,
    },
    { requestId },
  );
});
