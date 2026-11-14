import "server-only";
import { randomUUID } from "node:crypto";
import { runInference, type InferenceEvent } from "@/server/services/inference";
import type { ChatMessage } from "@/server/gateway/adapters";
import type { Tier } from "@/lib/economics/types";

// Shared plumbing for the two ways outside agents reach Metabolic AI:
//  - /api/mcp                      (MCP tools: Claude Code, Cursor, Codex, …)
//  - /api/v1/chat/completions      (OpenAI-compatible apps)
// Both run the same routed, billed inference as the workspace and the developer API.

export const ERROR_STATUS: Record<string, number> = {
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

export class GatewayError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

export type AgentCaller = { userId: string; apiKeyId: string };

export type AgentRequest = {
  caller: AgentCaller;
  messages: ChatMessage[];
  system?: string;
  maxOutputTokens?: number;
  tier?: Tier;
  idempotencyKey?: string;
  signal: AbortSignal;
};

type Final = Extract<InferenceEvent, { type: "final" }>;
type Meta = Extract<InferenceEvent, { type: "meta" }>;

function start(r: AgentRequest) {
  return runInference({
    userId: r.caller.userId,
    channel: "api",
    apiKeyId: r.caller.apiKeyId,
    idempotencyKey: r.idempotencyKey ?? randomUUID(),
    messages: r.messages,
    system: r.system,
    maxOutputTokens: r.maxOutputTokens,
    tier: r.tier,
    signal: r.signal,
  });
}

function toError(ev: Extract<InferenceEvent, { type: "error" }>) {
  return new GatewayError(ERROR_STATUS[ev.code] ?? 400, ev.code, ev.message, ev.needed ? { needed_micro_usd: ev.needed } : undefined);
}

/** Run one request to completion. Throws GatewayError on refusal or failure. */
export async function completeOnce(r: AgentRequest): Promise<{ text: string; meta: Meta | null; final: Final }> {
  let text = "";
  let meta: Meta | null = null;
  let final: Final | null = null;
  for await (const ev of start(r)) {
    if (ev.type === "text") text += ev.text;
    else if (ev.type === "meta") meta = ev;
    else if (ev.type === "final") final = ev;
    else if (ev.type === "error") throw toError(ev);
  }
  if (!final) throw new GatewayError(502, "NO_RESULT", "The model returned no result.");
  return { text, meta, final };
}

/**
 * Stream one request. `onText` receives deltas; the returned promise resolves with
 * the final accounting. If the consumer disappears mid-stream, call `abort()` and keep
 * awaiting so billing for tokens already produced still completes.
 */
export async function* streamOnce(r: AgentRequest): AsyncGenerator<{ type: "text"; text: string } | { type: "meta"; meta: Meta } | { type: "final"; final: Final }> {
  for await (const ev of start(r)) {
    if (ev.type === "text") yield { type: "text", text: ev.text };
    else if (ev.type === "meta") yield { type: "meta", meta: ev };
    else if (ev.type === "final") yield { type: "final", final: ev };
    else if (ev.type === "error") throw toError(ev);
  }
}

/** Flatten OpenAI-style content (string or parts) to plain text. Non-text parts are dropped. */
export function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => (p && typeof p === "object" && "text" in p && typeof (p as { text: unknown }).text === "string" ? (p as { text: string }).text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Map a client "model" name to a tier pin. `metabolic-auto` (or anything unknown) lets the router choose. */
export function tierFromModel(model: string | undefined): Tier | undefined {
  const m = (model ?? "").toLowerCase();
  if (m.endsWith("premium")) return "premium";
  if (m.endsWith("standard")) return "standard";
  if (m.endsWith("economy")) return "economy";
  return undefined;
}

export const MODEL_NAMES = ["metabolic-auto", "metabolic-premium", "metabolic-standard", "metabolic-economy"] as const;
