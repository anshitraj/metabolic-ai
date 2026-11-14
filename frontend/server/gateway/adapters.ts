import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { enabledModels, type RegistryModel } from "@/server/economics/registry";

// Provider adapters behind one streaming interface. Each adapter reports the
// usage the provider returned; when a provider returns none, `usage` is null
// and the caller marks the cost as estimated.

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "done"; usage: { inTokens: number; outTokens: number } | null; servedModel: string; stopReason: string | null };

export type ErrorClass = "auth" | "rate_limit" | "timeout" | "unavailable" | "bad_request" | "refusal" | "aborted" | "unknown";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly errorClass: ErrorClass,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type StreamParams = {
  model: RegistryModel;
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  signal: AbortSignal;
};

export interface ProviderAdapter {
  stream(p: StreamParams): AsyncGenerator<StreamChunk>;
  health(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

// ---------------- Anthropic ----------------

let anthropicClient: Anthropic | null = null;
function anthropic() {
  if (!anthropicClient) anthropicClient = new Anthropic({ maxRetries: 0, timeout: 60_000 });
  return anthropicClient;
}

function classifyAnthropic(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError("aborted", "aborted", false);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new ProviderError("Anthropic rejected the API key", "auth", false);
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("Anthropic rate limit", "rate_limit", true);
  if (err instanceof Anthropic.BadRequestError) return new ProviderError(`Anthropic bad request: ${err.message}`, "bad_request", false);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("Anthropic timed out", "timeout", true);
  if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError)
    return new ProviderError("Anthropic unavailable", "unavailable", true);
  if (err instanceof Anthropic.APIError) return new ProviderError(`Anthropic error ${err.status}`, "unknown", (err.status ?? 0) >= 500);
  return new ProviderError(err instanceof Error ? err.message : "Anthropic error", "unknown", false);
}

const anthropicAdapter: ProviderAdapter = {
  async *stream({ model, system, messages, maxOutputTokens, signal }) {
    // Opus 5.5 and Sonnet 5.5 decline some requests with stop_reason "refusal";
    // server-side fallbacks let the API re-run a declined request on a fallback
    // model. Haiku 5.5 has no server-side fallback.
    const useFallbacks = model.model !== "claude-haiku-5-5";
    try {
      const stream = anthropic().beta.messages.stream(
        {
          model: model.model,
          max_tokens: maxOutputTokens,
          system,
          messages,
          ...(model.effort ? { output_config: { effort: model.effort } } : {}),
          ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal },
      );
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          yield { type: "text", text: ev.delta.text };
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        throw new ProviderError("The model declined this request.", "refusal", false);
      }
      yield {
        type: "done",
        usage: final.usage ? { inTokens: final.usage.input_tokens, outTokens: final.usage.output_tokens } : null,
        servedModel: final.model,
        stopReason: final.stop_reason,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw classifyAnthropic(err);
    }
  },
  async health() {
    const t = Date.now();
    try {
      await anthropic().models.list({ limit: 1 });
      return { ok: true, latencyMs: Date.now() - t };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t, error: classifyAnthropic(err).errorClass };
    }
  },
};

// ---------------- OpenAI-compatible (DeepSeek, hosted Llama) ----------------

function openaiCompatible(provider: "deepseek" | "llama"): ProviderAdapter {
  const keyVar = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "LLAMA_API_KEY";
  const urlVar = provider === "deepseek" ? "DEEPSEEK_BASE_URL" : "LLAMA_BASE_URL";
  const defaultUrl = provider === "deepseek" ? "https://api.deepseek.com" : undefined;
  let client: OpenAI | null = null;
  const get = () => {
    if (!client) {
      const baseURL = process.env[urlVar]?.trim() || defaultUrl;
      if (!baseURL) throw new ProviderError(`${urlVar} not set`, "unavailable", false);
      client = new OpenAI({ apiKey: process.env[keyVar], baseURL, maxRetries: 0, timeout: 60_000 });
    }
    return client;
  };
  const classify = (err: unknown): ProviderError => {
    if (err instanceof ProviderError) return err;
    if (err instanceof OpenAI.APIUserAbortError) return new ProviderError("aborted", "aborted", false);
    if (err instanceof OpenAI.AuthenticationError) return new ProviderError(`${provider} rejected the API key`, "auth", false);
    if (err instanceof OpenAI.RateLimitError) return new ProviderError(`${provider} rate limit`, "rate_limit", true);
    if (err instanceof OpenAI.BadRequestError) return new ProviderError(`${provider} bad request`, "bad_request", false);
    if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError(`${provider} timed out`, "timeout", true);
    if (err instanceof OpenAI.APIConnectionError || err instanceof OpenAI.InternalServerError)
      return new ProviderError(`${provider} unavailable`, "unavailable", true);
    return new ProviderError(err instanceof Error ? err.message : `${provider} error`, "unknown", false);
  };
  return {
    async *stream({ model, system, messages, maxOutputTokens, signal }) {
      try {
        const stream = await get().chat.completions.create(
          {
            model: model.model,
            max_tokens: maxOutputTokens,
            stream: true,
            stream_options: { include_usage: true },
            messages: [{ role: "system", content: system }, ...messages],
          },
          { signal },
        );
        let usage: { inTokens: number; outTokens: number } | null = null;
        let served = model.model;
        let stop: string | null = null;
        for await (const chunk of stream) {
          if (chunk.model) served = chunk.model;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield { type: "text", text: delta };
          const fr = chunk.choices?.[0]?.finish_reason;
          if (fr) stop = fr;
          if (chunk.usage) usage = { inTokens: chunk.usage.prompt_tokens, outTokens: chunk.usage.completion_tokens };
        }
        yield { type: "done", usage, servedModel: served, stopReason: stop };
      } catch (err) {
        throw classify(err);
      }
    },
    async health() {
      const t = Date.now();
      try {
        await get().models.list();
        return { ok: true, latencyMs: Date.now() - t };
      } catch (err) {
        return { ok: false, latencyMs: Date.now() - t, error: classify(err).errorClass };
      }
    },
  };
}

// ---------------- Google Gemini ----------------

let geminiClient: import("@google/genai").GoogleGenAI | null = null;
async function gemini() {
  if (!geminiClient) {
    const { GoogleGenAI } = await import("@google/genai");
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY?.trim(), httpOptions: { timeout: 60_000 } });
  }
  return geminiClient;
}

export async function classifyGemini(err: unknown): Promise<ProviderError> {
  if (err instanceof ProviderError) return err;
  if (err instanceof Error && err.name === "AbortError") return new ProviderError("aborted", "aborted", false);
  const { ApiError } = await import("@google/genai");
  if (err instanceof ApiError) {
    if (err.status === 401 || /API_KEY_INVALID|API key not valid|API key expired|reported as leaked/i.test(err.message))
      return new ProviderError("Gemini rejected the API key. Update GEMINI_API_KEY on the server with an active Google AI Studio key, then restart the server.", "auth", false);
    if (err.status === 403) return new ProviderError("Google denied access. Check the key's API restrictions, project permissions and regional availability in Google AI Studio.", "auth", false);
    if (err.status === 429) return new ProviderError("Gemini quota or rate limit reached. Check this model's quota and project billing in Google AI Studio, or try again later. A new key in the same project shares its quota.", "rate_limit", true);
    if (err.status === 404) return new ProviderError("This Gemini model is unavailable for this project or has been retired. Choose a supported model in the model catalog; this does not mean the API key is invalid.", "bad_request", false);
    if (err.status === 400) return new ProviderError("Gemini could not accept this request. Check the model's supported parameters and your project's billing requirements.", "bad_request", false);
    if (err.status === 408 || err.status === 504) return new ProviderError("Gemini timed out. Try again in a moment.", "timeout", true);
    if (err.status >= 500) return new ProviderError("Gemini unavailable", "unavailable", true);
  }
  return new ProviderError("Could not connect to Gemini. Check the server's network connection and try again.", "unknown", false);
}

const geminiAdapter: ProviderAdapter = {
  async *stream({ model, system, messages, maxOutputTokens, signal }) {
    try {
      const ai = await gemini();
      const stream = await ai.models.generateContentStream({
        model: model.model,
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        config: { systemInstruction: system, maxOutputTokens, abortSignal: signal },
      });
      let usage: { inTokens: number; outTokens: number } | null = null;
      let stop: string | null = null;
      let served = model.model;
      let hasText = false;
      for await (const chunk of stream) {
        const t = chunk.text;
        if (t) {
          hasText = true;
          yield { type: "text", text: t };
        }
        if (chunk.modelVersion) served = chunk.modelVersion;
        const fr = chunk.candidates?.[0]?.finishReason;
        if (fr) stop = String(fr);
        const u = chunk.usageMetadata;
        // Output price includes thinking tokens, so bill them as output.
        if (u?.promptTokenCount !== undefined) usage = { inTokens: u.promptTokenCount, outTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
      }
      if (stop === "SAFETY" || stop === "PROHIBITED_CONTENT") throw new ProviderError("The model declined this request.", "refusal", false);
      if (!hasText) throw new ProviderError(stop === "MAX_TOKENS" ? "Gemini used the output budget before producing an answer. Try a shorter prompt or a model with a larger output budget." : "Gemini returned no answer. Please try again.", "bad_request", false);
      yield { type: "done", usage, servedModel: served, stopReason: stop };
    } catch (err) {
      throw await classifyGemini(err);
    }
  },
  async health() {
    const t = Date.now();
    try {
      const ai = await gemini();
      await ai.models.get({ model: allModelIdFor("gemini") });
      return { ok: true, latencyMs: Date.now() - t };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t, error: (await classifyGemini(err)).errorClass };
    }
  },
};

function allModelIdFor(provider: string) {
  return enabledModels().find((m) => m.provider === provider)?.model ?? "gemini-3.1-flash-lite";
}

const ADAPTERS: Record<string, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  deepseek: openaiCompatible("deepseek"),
  llama: openaiCompatible("llama"),
};

export function adapterFor(provider: string): ProviderAdapter {
  const a = ADAPTERS[provider];
  if (!a) throw new ProviderError(`No adapter for ${provider}`, "unavailable", false);
  return a;
}

/** Rough input token estimate used before a request runs (≈ 3.5 chars per token, rounded up). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3.5));
}
