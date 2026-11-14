// Agent doors: the MCP server and the OpenAI-compatible API, end to end through
// the real route handlers, billing and ledger (provider mocked).
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/gateway/adapters", async (orig) => {
  const real = await orig<typeof import("@/server/gateway/adapters")>();
  return {
    ...real,
    adapterFor: () => ({
      async *stream() {
        for (const w of ["Hello", " from", " the", " agent", " door."]) yield { type: "text" as const, text: w };
        yield { type: "done" as const, usage: { inTokens: 30, outTokens: 12 }, servedModel: "mock-model", stopReason: "end_turn" };
      },
      async health() {
        return { ok: true, latencyMs: 1 };
      },
    }),
  };
});

const { getDb, schema } = await import("@/server/db/client");
const { newApiKeySecret } = await import("@/server/services/auth");
const { creditDeposit, recordCapital, getBalance } = await import("@/server/services/billing");
const mcp = await import("@/app/api/mcp/route");
const chat = await import("@/app/api/v1/chat/completions/route");
const models = await import("@/app/api/v1/models/route");

const $ = (n: number) => BigInt(Math.round(n * 1_000_000));
let funded: { id: string; key: string };
let broke: { key: string };

async function makeKey(userId: string) {
  const db = await getDb();
  const k = newApiKeySecret();
  await db.insert(schema.apiKeys).values({ userId, name: "test", prefix: k.prefix, hash: k.hash });
  return k.secret;
}

const call = (handler: (req: Request, ctx: never) => Promise<Response>, url: string, key: string | null, body?: unknown, method = "POST") =>
  handler(
    new Request(`http://localhost${url}`, {
      method,
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    {} as never,
  );
const rpc = (key: string | null, method: string, params?: unknown, id: number | undefined = 1) =>
  call(mcp.POST as never, "/api/mcp", key, { jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params });

beforeAll(async () => {
  const db = await getDb();
  await db.insert(schema.priceSnapshots).values({ microPerUnit: 3_000_000n, source: "test", observedAt: new Date(Date.now() + 3600_000) });
  const [op] = await db.insert(schema.users).values({ nearAccountId: "boss.testnet", role: "operator" }).returning();
  await db.transaction((tx) => recordCapital(tx, op.id, $(60), "agents-capital"));
  const [u] = await db.insert(schema.users).values({ nearAccountId: "dev.testnet" }).returning();
  await db.transaction((tx) => creditDeposit(tx, u.id, $(2), "agents-credit"));
  const [b] = await db.insert(schema.users).values({ nearAccountId: "broke.testnet" }).returning();
  funded = { id: u.id, key: await makeKey(u.id) };
  broke = { key: await makeKey(b.id) };
});

describe("MCP server", () => {
  it("requires an API key", async () => {
    const r = await rpc(null, "initialize");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/Bearer/);
    expect((await rpc("mk_test_not-a-real-key-xxxxxxxxxxxxxxxx", "tools/list")).status).toBe(401);
  });

  it("negotiates the protocol and lists its tools", async () => {
    const init = await (await rpc(funded.key, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })).json();
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.serverInfo.name).toBe("metabolic-ai");
    expect(init.result.capabilities.tools).toBeTruthy();
    const unknown = await (await rpc(funded.key, "initialize", { protocolVersion: "1999-01-01" })).json();
    expect(unknown.result.protocolVersion).toBe("2025-06-18");
    const list = await (await rpc(funded.key, "tools/list")).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["ask", "business_status", "list_models"]);
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe("object");
  });

  it("accepts notifications with 202 and rejects unknown methods", async () => {
    expect((await rpc(funded.key, "notifications/initialized", undefined, undefined)).status).toBe(202);
    const r = await (await rpc(funded.key, "nope/nothing")).json();
    expect(r.error.code).toBe(-32601);
  });

  it("answers `ask` through the router and bills the key's owner", async () => {
    const before = await getBalance(funded.id);
    const r = await (await rpc(funded.key, "tools/call", { name: "ask", arguments: { prompt: "hi", tier: "auto" } })).json();
    expect(r.result.isError).toBeUndefined();
    const text: string = r.result.content[0].text;
    expect(text).toContain("Hello from the agent door.");
    expect(text).toMatch(/Metabolic AI · \w+ tier/);
    expect(text).toMatch(/charged \$/);
    const after = await getBalance(funded.id);
    expect(before.available - after.available).toBeGreaterThan(0n);
  });

  it("reports a clear tool error (not a crash) when the caller has no credit", async () => {
    const r = await (await rpc(broke.key, "tools/call", { name: "ask", arguments: { prompt: "hi" } })).json();
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/INSUFFICIENT_CREDITS/);
    expect(r.result.content[0].text).toMatch(/Add credit/);
  });

  it("validates tool arguments and serves status/models", async () => {
    const bad = await (await rpc(funded.key, "tools/call", { name: "ask", arguments: {} })).json();
    expect(bad.result.isError).toBe(true);
    const st = await (await rpc(funded.key, "tools/call", { name: "business_status", arguments: {} })).json();
    expect(st.result.content[0].text).toMatch(/State: (ABUNDANCE|DEFENSIVE|SURVIVAL|RECOVERY)/);
    const ms = await (await rpc(funded.key, "tools/call", { name: "list_models", arguments: {} })).json();
    expect(ms.result.content[0].text).toMatch(/premium|standard|economy|No models/);
    const none = await (await rpc(funded.key, "tools/call", { name: "missing", arguments: {} })).json();
    expect(none.error.code).toBe(-32602);
  });

  it("is stateless: GET is not allowed", async () => {
    expect((mcp.GET() as Response).status).toBe(405);
  });
});

describe("OpenAI-compatible API", () => {
  const msgs = [
    { role: "system", content: "Be brief." },
    { role: "user", content: [{ type: "text", text: "Say hi" }] },
  ];

  it("lists routing modes as models", async () => {
    const r = await call(models.GET as never, "/api/v1/models", funded.key, undefined, "GET");
    const j = await r.json();
    expect(j.object).toBe("list");
    expect(j.data.map((m: { id: string }) => m.id)).toContain("metabolic-auto");
    expect((await call(models.GET as never, "/api/v1/models", null, undefined, "GET")).status).toBe(401);
  });

  it("returns a chat.completion with usage and billing details", async () => {
    const r = await call(chat.POST as never, "/api/v1/chat/completions", funded.key, { model: "metabolic-auto", messages: msgs });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.object).toBe("chat.completion");
    expect(j.choices[0].message).toEqual({ role: "assistant", content: "Hello from the agent door." });
    expect(j.choices[0].finish_reason).toBe("stop");
    expect(j.usage).toEqual({ prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 });
    expect(BigInt(j.metabolic.charge_micro_usd)).toBeGreaterThan(0n);
  });

  it("streams OpenAI-style chunks ending in [DONE]", async () => {
    const r = await call(chat.POST as never, "/api/v1/chat/completions", funded.key, { model: "metabolic-economy", stream: true, messages: msgs });
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const body = await r.text();
    const events = body.split("\n\n").filter(Boolean);
    expect(events.at(-1)).toBe("data: [DONE]");
    const chunks = events.slice(0, -1).map((e) => JSON.parse(e.replace(/^data: /, "")));
    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    expect(chunks.map((c) => c.choices[0].delta.content ?? "").join("")).toBe("Hello from the agent door.");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
    expect(chunks[0].object).toBe("chat.completion.chunk");
  });

  it("uses OpenAI-shaped errors: 401 without a key, 402 without credit, 400 for bad input", async () => {
    const noKey = await call(chat.POST as never, "/api/v1/chat/completions", null, { messages: msgs });
    expect(noKey.status).toBe(401);
    expect((await noKey.json()).error.code).toBe("INVALID_API_KEY");
    const poor = await call(chat.POST as never, "/api/v1/chat/completions", broke.key, { messages: msgs });
    expect(poor.status).toBe(402);
    expect((await poor.json()).error.code).toBe("INSUFFICIENT_CREDITS");
    const poorStream = await call(chat.POST as never, "/api/v1/chat/completions", broke.key, { messages: msgs, stream: true });
    expect(poorStream.status).toBe(402);
    const bad = await call(chat.POST as never, "/api/v1/chat/completions", funded.key, { messages: [{ role: "assistant", content: "x" }] });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_messages");
  });

  it("every request is recorded on the key's owner with the api channel", async () => {
    const db = await getDb();
    const rows = await db.select().from(schema.usageRequests);
    const mine = rows.filter((r) => r.userId === funded.id);
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine.every((r) => r.channel === "api" && r.apiKeyId)).toBe(true);
  });
});
