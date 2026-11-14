import { randomUUID } from "node:crypto";
import { z } from "zod";
import { body, HttpError, rateLimit, requireApiKey, route } from "@/server/http";
import { completeOnce, contentText, GatewayError, streamOnce, tierFromModel } from "@/server/services/agent-gateway";
import type { ChatMessage } from "@/server/gateway/adapters";

export const dynamic = "force-dynamic";

// OpenAI-compatible Chat Completions, for apps that let you set a custom base URL
// (Cursor, Cline, OpenCode, Continue, the OpenAI SDKs, …).
// Base URL: <origin>/api/v1   Key: a Metabolic API key (mk_…)   Model: metabolic-auto

const Body = z
  .object({
    model: z.string().max(80).optional(),
    messages: z
      .array(z.object({ role: z.string(), content: z.unknown().optional() }).passthrough())
      .min(1)
      .max(200),
    stream: z.boolean().optional(),
    max_tokens: z.number().int().min(1).max(8192).optional(),
    max_completion_tokens: z.number().int().min(1).max(8192).optional(),
  })
  .passthrough();

function oaiError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: { message, type: status >= 500 ? "server_error" : "invalid_request_error", code, ...extra } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const POST = route(async (req, { requestId }) => {
  let key;
  try {
    key = await requireApiKey(req);
  } catch (e) {
    if (e instanceof HttpError) return oaiError(e.status, e.code, e.message);
    throw e;
  }
  rateLimit(`api:${key.apiKeyId}`, 60);
  const b = await body(req, Body);

  // OpenAI roles → ours. system/developer text becomes the system prompt; tool traffic is not supported.
  const system: string[] = [];
  const messages: ChatMessage[] = [];
  for (const m of b.messages) {
    const text = contentText(m.content);
    if (m.role === "system" || m.role === "developer") {
      if (text) system.push(text);
    } else if (m.role === "user" || m.role === "assistant") {
      if (text) messages.push({ role: m.role, content: text });
    }
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return oaiError(400, "invalid_messages", "The last message must be a non-empty user message.");
  }
  const ac = new AbortController();
  const input = {
    caller: { userId: key.id, apiKeyId: key.apiKeyId },
    messages,
    system: system.join("\n\n") || undefined,
    maxOutputTokens: b.max_completion_tokens ?? b.max_tokens,
    tier: tierFromModel(b.model),
    idempotencyKey: req.headers.get("idempotency-key")?.slice(0, 80) || randomUUID(),
    signal: AbortSignal.any([req.signal, ac.signal]),
  };
  const id = `chatcmpl-${requestId.replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  const modelName = b.model && b.model.startsWith("metabolic") ? b.model : "metabolic-auto";

  try {
    if (!b.stream) {
      const { text, final } = await completeOnce(input);
      return new Response(
        JSON.stringify({
          id,
          object: "chat.completion",
          created,
          model: modelName,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: final.partial ? "length" : "stop" }],
          usage: { prompt_tokens: final.inTokens, completion_tokens: final.outTokens, total_tokens: final.inTokens + final.outTokens },
          metabolic: {
            served_model: final.servedModel,
            tier: final.tier,
            state: final.state,
            explanation: final.explanation,
            charge_micro_usd: final.charge,
            provider_cost_micro_usd: final.cost,
            cost_is_estimated: final.costIsEstimated,
          },
        }),
        { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId } },
      );
    }
  } catch (e) {
    if (e instanceof GatewayError) return oaiError(e.status, e.code, e.message, e.extra);
    throw e;
  }

  // Streaming. Errors before the first token become a normal HTTP error; later ones end the stream.
  const enc = new TextEncoder();
  const gen = streamOnce(input);
  type Step = Awaited<ReturnType<typeof gen.next>>;
  let first: Step;
  try {
    // Pull until the first text (or the end) so refusals surface as proper status codes.
    for (;;) {
      first = await gen.next();
      if (first.done || first.value.type === "text") break;
    }
  } catch (e) {
    if (e instanceof GatewayError) return oaiError(e.status, e.code, e.message, e.extra);
    throw e;
  }
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelName, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (s: string) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          open = false;
          ac.abort(); // Client left: stop the provider, but keep consuming so accounting completes.
        }
      };
      try {
        send(chunk({ role: "assistant", content: "" }));
        let pending: Step | null = first;
        let partial = false;
        for (;;) {
          const r = pending ?? (await gen.next());
          pending = null;
          if (r.done) break;
          if (r.value.type === "text") send(chunk({ content: r.value.text }));
          else if (r.value.type === "final") partial = r.value.final.partial;
        }
        send(chunk({}, partial ? "length" : "stop"));
        send("data: [DONE]\n\n");
      } catch (e) {
        const msg = e instanceof GatewayError ? e.message : "Internal error";
        send(`data: ${JSON.stringify({ error: { message: msg, type: "server_error", code: e instanceof GatewayError ? e.code : "INTERNAL" } })}\n\n`);
        send("data: [DONE]\n\n");
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      ac.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-request-id": requestId, "x-accel-buffering": "no" } });
});
