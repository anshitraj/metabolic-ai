import { randomUUID } from "node:crypto";
import { z } from "zod";
import { big, formatBp, formatCoverage, formatRunway, formatUsd } from "@/lib/economics/money";
import { enabledModels } from "@/server/economics/registry";
import { rateLimit, requireApiKey, route } from "@/server/http";
import { completeOnce, GatewayError, tierFromModel } from "@/server/services/agent-gateway";
import { overview } from "@/server/services/economy";

export const dynamic = "force-dynamic";

// Model Context Protocol server (Streamable HTTP, stateless, JSON responses).
// Lets Claude Code, Claude Desktop, Cursor, Codex, Antigravity, Windsurf, Gemini CLI,
// VS Code, Cline, OpenCode … call Metabolic AI as a tool. Auth: Authorization: Bearer mk_…

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER = { name: "metabolic-ai", title: "Metabolic AI", version: "1.0.0" };
const INSTRUCTIONS =
  "Metabolic AI is an AI service that pays for its own models. `ask` routes your prompt to the best model the business can afford right now and reports what it cost. `business_status` shows its financial health; `list_models` shows the models it can choose from.";

const TOOLS = [
  {
    name: "ask",
    title: "Ask Metabolic AI",
    description:
      "Send a prompt. The router prices every capable model, picks the best one the business can afford in its current state, answers, and bills actual usage to your key's credit. The reply ends with the model used and the cost.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to ask." },
        system: { type: "string", description: "Optional instructions for the answer's style or role." },
        tier: { type: "string", enum: ["auto", "premium", "standard", "economy"], description: "auto (default) lets the router choose; a tier pins it, subject to current policy." },
        max_output_tokens: { type: "integer", minimum: 16, maximum: 4096, description: "Upper bound on the answer length." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    annotations: { title: "Ask Metabolic AI", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "business_status",
    title: "Business status",
    description: "How the business is doing right now: operating state (Abundance, Defensive, Survival, Recovery), treasury, margin, runway and which model tiers are allowed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Business status", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_models",
    title: "List models",
    description: "The AI models the router can choose from, with tier and price per million tokens charged to customers.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "List models", readOnlyHint: true, openWorldHint: false },
  },
];

const AskArgs = z.object({
  prompt: z.string().min(1).max(50_000),
  system: z.string().max(10_000).optional(),
  tier: z.enum(["auto", "premium", "standard", "economy"]).optional(),
  max_output_tokens: z.number().int().min(16).max(4096).optional(),
});

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Caller = { userId: string; apiKeyId: string };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

async function callTool(name: string, args: unknown, caller: Caller, signal: AbortSignal) {
  if (name === "ask") {
    const a = AskArgs.safeParse(args ?? {});
    if (!a.success) return text(`Invalid arguments: ${a.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, true);
    try {
      const { text: answer, final } = await completeOnce({
        caller,
        messages: [{ role: "user", content: a.data.prompt }],
        system: a.data.system,
        maxOutputTokens: a.data.max_output_tokens,
        tier: a.data.tier && a.data.tier !== "auto" ? tierFromModel(a.data.tier) : undefined,
        idempotencyKey: randomUUID(),
        signal,
      });
      const model = final.servedModel || final.model.split(":").pop();
      const footer = `\n\n— Metabolic AI · ${final.tier} tier (${model}) · cost ${formatUsd(big(final.cost))}${final.costIsEstimated ? " (est.)" : ""} · charged ${formatUsd(big(final.charge))} · state ${final.state}${final.partial ? " · partial answer" : ""}`;
      return text(answer + footer);
    } catch (e) {
      if (e instanceof GatewayError) {
        const hint = e.code === "INSUFFICIENT_CREDITS" ? " Add credit in the Metabolic AI console (Treasury → Add credit)." : "";
        return text(`${e.message}${hint} [${e.code}]`, true);
      }
      throw e;
    }
  }
  if (name === "business_status") {
    const o = await overview();
    const tiers = (Object.entries(o.permissions.tiers) as [string, boolean][]).filter(([, v]) => v).map(([k]) => k).join(", ") || "none";
    return text(
      [
        `State: ${o.state}${o.paused ? " (paused by operator)" : ""}`,
        `Treasury: ${formatUsd(big(o.treasury))} · its own spendable money: ${formatUsd(big(o.spendable))} (safety reserve ${formatUsd(big(o.hardReserve))}, ${formatCoverage(o.reserveCoverageBp)} covered)`,
        `Revenue earned (all time): ${formatUsd(big(o.revenueTotal))} · AI cost (all time): ${formatUsd(big(o.expenseTotal))} · margin last hour: ${formatBp(o.rollingMarginBp)}`,
        `Runway: ${formatRunway(o.runwaySeconds)}`,
        `Allowed model tiers right now: ${tiers}`,
        `Active model: ${o.activeModel ? `${o.activeModel.label} (${o.activeModel.tier})` : "none yet"}`,
        o.lastDecision ? `Last decision: ${o.lastDecision.explanation}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (name === "list_models") {
    const rows = enabledModels().map((m) => `- ${m.label} · ${m.tier} · $${(Number(m.sellInPerM) / 1e6).toFixed(2)} in / $${(Number(m.sellOutPerM) / 1e6).toFixed(2)} out per 1M tokens`);
    return text(rows.length ? rows.join("\n") : "No models are configured on this server.");
  }
  return null;
}

async function handle(msg: Rpc, caller: Caller, signal: AbortSignal): Promise<unknown | null> {
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg.id, -32600, "Invalid request");
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      return ok(msg.id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      const result = await callTool(name, msg.params?.arguments, caller, signal);
      return result ? ok(msg.id, result) : fail(msg.id, -32602, `Unknown tool: ${name}`);
    }
    case "resources/list":
      return ok(msg.id, { resources: [] });
    case "prompts/list":
      return ok(msg.id, { prompts: [] });
    default:
      if (isNotification || msg.method.startsWith("notifications/")) return null;
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const jsonRes = (data: unknown, requestId: string, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId } });

export const POST = route(async (req, { requestId }) => {
  let key;
  try {
    key = await requireApiKey(req);
  } catch {
    return new Response(JSON.stringify(fail(null, -32001, "Missing or invalid API key. Send `Authorization: Bearer mk_…` (create one in the Metabolic AI console → Connect an agent).")), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="metabolic-ai"' },
    });
  }
  rateLimit(`mcp:${key.apiKeyId}`, 120);
  const raw = await req.text();
  if (raw.length > 512 * 1024) return jsonRes(fail(null, -32600, "Request too large"), requestId, 413);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonRes(fail(null, -32700, "Parse error"), requestId, 400);
  }
  const caller = { userId: key.id, apiKeyId: key.apiKeyId };
  if (Array.isArray(payload)) {
    const out = (await Promise.all(payload.map((m) => handle(m as Rpc, caller, req.signal)))).filter((x) => x !== null);
    return out.length ? jsonRes(out, requestId) : new Response(null, { status: 202 });
  }
  const res = await handle(payload as Rpc, caller, req.signal);
  return res === null ? new Response(null, { status: 202 }) : jsonRes(res, requestId);
});

// Stateless server: no server-initiated stream and no sessions.
export const GET = () => new Response("This MCP server is stateless; use POST.", { status: 405, headers: { allow: "POST" } });
export const DELETE = () => new Response(null, { status: 405, headers: { allow: "POST" } });
