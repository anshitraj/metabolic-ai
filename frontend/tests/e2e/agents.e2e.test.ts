// The agent doors over real HTTP (read-only: creates no keys and spends nothing).
import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

describe("Connect an agent", () => {
  it("renders the page", async () => {
    const r = await fetch(`${BASE}/console/connect`, { redirect: "manual" });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Connect an agent");
  });

  it("ships every logo it references", async () => {
    for (const f of ["claudecode-color", "claude-color", "codex", "cursor", "antigravity-color", "windsurf", "githubcopilot", "geminicli-color", "cline", "opencode", "openai"]) {
      const r = await fetch(`${BASE}/connectors/${f}.svg`);
      expect(r.status, f).toBe(200);
      expect(r.headers.get("content-type")).toContain("svg");
      expect(await r.text()).toContain("<svg");
    }
  });

  it("MCP endpoint refuses unauthenticated calls with a JSON-RPC error and a Bearer challenge", async () => {
    const r = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("Bearer");
    expect((await r.json()).error.code).toBe(-32001);
    expect((await fetch(`${BASE}/api/mcp`)).status).toBe(405);
  });

  it("OpenAI-compatible endpoints refuse unauthenticated calls in OpenAI's error shape", async () => {
    const chat = await fetch(`${BASE}/api/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) });
    expect(chat.status).toBe(401);
    expect((await chat.json()).error.code).toBe("INVALID_API_KEY");
    expect((await fetch(`${BASE}/api/v1/models`)).status).toBe(401);
  });
});
