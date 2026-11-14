// End-to-end smoke tests against a running server (pnpm dev or pnpm start).
//   E2E_BASE_URL=http://localhost:3000 pnpm test:e2e
// Exercises pages, public APIs, auth guards, NEP-413 verification, the
// simulation engine and the SSE stream over real HTTP. Spends no money.
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { nep413Hash } from "@/server/services/auth";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const get = (p: string, init?: RequestInit) => fetch(BASE + p, { redirect: "manual", ...init });
const post = (p: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", origin: BASE, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("pages", () => {
  const pages: [string, string][] = [
    ["/", "An AI that pays"],
    ["/login", "Welcome to Metabolic AI"],
    ["/console", "Overview"],
    ["/console/workspace", "Metabolic"],
    ["/console/treasury", "Treasury"],
    ["/console/models", "AI models"],
    ["/console/decisions", "Economic Decisions"],
    ["/console/stress-lab", "Stress Lab"],
    ["/console/receipts", "Economic Receipts"],
    ["/console/developers", "Developer API"],
    ["/console/settings", "Settings"],
    ["/demo", "guided demo"],
    ["/verify", "Check a receipt yourself"],
    ["/terms", "Terms of Service"],
    ["/privacy", "Privacy Policy"],
  ];
  for (const [path, text] of pages) {
    it(`${path} renders`, async () => {
      const r = await get(path);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain(text);
    });
  }
  it("redirects old Algebra routes", async () => {
    const r = await get("/console/agent");
    expect([307, 308]).toContain(r.status);
    expect(r.headers.get("location")).toContain("/console/workspace");
  });
  it("sends security headers", async () => {
    const r = await get("/");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("public API", () => {
  it("exposes a database-backed deployment health check", async () => {
    const r = await get("/api/health");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, database: "ready" });
  });
  it("overview has the documented shape with integer money", async () => {
    const r = await get("/api/dashboard/overview");
    expect(r.status).toBe(200);
    expect(r.headers.get("x-request-id")).toBeTruthy();
    const o = await r.json();
    expect(["ABUNDANCE", "DEFENSIVE", "SURVIVAL", "RECOVERY"]).toContain(o.state);
    for (const k of ["treasury", "liabilities", "liquidity", "spendable", "hardReserve", "revenueTotal", "expenseTotal"]) expect(o[k]).toMatch(/^-?\d+$/);
    expect(o.simulated).toBe(false);
    expect(Array.isArray(o.providers)).toBe(true);
  });
  it("lists models with prices and an enabled flag", async () => {
    const { models } = await (await get("/api/models")).json();
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.costInPerM).toMatch(/^\d+$/);
      expect(typeof m.enabled).toBe("boolean");
      if (!m.enabled) expect(m.disabledReason).toBeTruthy();
    }
  });
  it("quotes a request without side effects", async () => {
    const q = await (await post("/api/chat/quote", { prompt: "hello" })).json();
    expect(q.state).toBeTruthy();
    expect(typeof q.explanation).toBe("string");
  });
  it("serves metrics, decisions, history, receipts and config", async () => {
    for (const p of ["/api/dashboard/metrics?hours=24", "/api/economics/decisions", "/api/economics/history", "/api/economics/state", "/api/receipts", "/api/public/config"]) {
      const r = await get(p);
      expect(r.status, p).toBe(200);
    }
  });
  it("reports first-run setup status, and claiming needs a session", async () => {
    const s = await (await get("/api/setup")).json();
    expect(typeof s.hasOperator).toBe("boolean");
    expect(s.canClaim).toBe(false); // not signed in
    expect(s.isOperator).toBe(false);
    expect((await post("/api/setup", { treasuryAccountId: "someone.testnet" })).status).toBe(401);
  });
  it("rejects malformed receipt ids", async () => {
    expect((await get("/api/receipts/not-a-receipt")).status).toBe(400);
  });
});

describe("auth guards", () => {
  it("customer endpoints require a session", async () => {
    expect((await post("/api/chat", { message: "hi" })).status).toBe(401);
    expect((await get("/api/keys")).status).toBe(401);
    expect((await post("/api/treasury/deposit-intent", { amountNear: "1" })).status).toBe(401);
    expect((await post("/api/admin/pause", { paused: true })).status).toBe(401);
    expect((await get("/api/usage")).status).toBe(401);
    expect((await get("/api/spend-passes")).status).toBe(401);
    expect((await post("/api/spend-passes", {})).status).toBe(401);
    expect((await get("/api/admin/readiness")).status).toBe(401);
    expect((await post("/api/models/check", { modelId: "gemini:gemini-3.1-pro-preview" })).status).toBe(401);
  });
  it("the developer API requires a valid key", async () => {
    const r = await post("/api/v1/inference", { messages: [{ role: "user", content: "hi" }] }, { authorization: "Bearer mk_test_notarealkey" });
    expect(r.status).toBe(401);
    expect((await r.json()).error.code).toBe("INVALID_API_KEY");
  });
  it("validates input with a clear error", async () => {
    const r = await post("/api/auth/verify", { accountId: "x" });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("INVALID_INPUT");
  });
});

describe("NEP-413 sign-in", () => {
  it("issues a nonce and verifies a real signature, then checks the key on chain", async () => {
    const n = await (await post("/api/auth/nonce")).json();
    expect(Buffer.from(n.nonce, "base64")).toHaveLength(32);
    const sk = ed25519.utils.randomPrivateKey();
    const pk = `ed25519:${base58.encode(ed25519.getPublicKey(sk))}`;
    const hash = nep413Hash({ message: n.message, nonce: Buffer.from(n.nonce, "base64"), recipient: n.recipient });
    const signature = Buffer.from(ed25519.sign(hash, sk)).toString("base64");
    // A valid signature from a key that isn't registered on this account must still be refused.
    const r = await post("/api/auth/verify", { accountId: "metabolic-e2e-nobody.testnet", publicKey: pk, signature, nonce: n.nonce });
    expect(r.status).toBe(401);
    expect((await r.json()).error.message).toMatch(/full-access key/);
  });
  it("refuses a bad signature", async () => {
    const n = await (await post("/api/auth/nonce")).json();
    const sk = ed25519.utils.randomPrivateKey();
    const pk = `ed25519:${base58.encode(ed25519.getPublicKey(sk))}`;
    const bad = Buffer.from(ed25519.sign(new Uint8Array(32), sk)).toString("base64");
    const r = await post("/api/auth/verify", { accountId: "someone.testnet", publicKey: pk, signature: bad, nonce: n.nonce });
    expect(r.status).toBe(401);
    expect((await r.json()).error.message).toMatch(/Signature did not verify/);
  });
});

describe("stress lab over HTTP", () => {
  it("runs a full scenario: abundance → survival → recovery, streaming events", async () => {
    const s = await (await post("/api/simulations")).json();
    expect(s.overview.simulated).toBe(true);
    expect(s.overview.state).toBe("ABUNDANCE");

    // Listen on the scenario's own SSE scope.
    const ac = new AbortController();
    const seen: string[] = [];
    const stream = (async () => {
      const r = await fetch(`${BASE}/api/events/stream?scope=sim:${s.id}`, { signal: ac.signal });
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value);
          for (const m of buf.matchAll(/data: (\{.*\})\n/g)) seen.push(JSON.parse(m[1]).type);
          buf = buf.slice(buf.lastIndexOf("\n\n") + 1);
        }
      } catch {
        /* aborted */
      }
    })();
    await new Promise((r) => setTimeout(r, 500));

    const drained = await (await post(`/api/simulations/${s.id}/events`, { type: "drain_treasury" })).json();
    expect(drained.overview.state).toBe("SURVIVAL");
    expect(drained.overview.activeModel).toBeNull();

    const restored = await (await post(`/api/simulations/${s.id}/events`, { type: "restore_funding", usd: 80 })).json();
    expect(BigInt(restored.overview.liquidity)).toBeGreaterThan(BigInt(drained.overview.liquidity));
    await new Promise((r) => setTimeout(r, 1500));
    expect(seen).toContain("economic.state.changed");
    ac.abort();
    await stream;

    // Simulations must never show up in the real decision log.
    const real = await (await get("/api/dashboard/overview")).json();
    expect(real.simulated).toBe(false);
    expect((await fetch(`${BASE}/api/simulations/${s.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await get(`/api/simulations/${s.id}`)).status).toBe(404);
  });
  it("validates stress actions", async () => {
    const s = await (await post("/api/simulations")).json();
    expect((await post(`/api/simulations/${s.id}/events`, { type: "spike_cost", multiplier: 99 })).status).toBe(400);
    expect((await post(`/api/simulations/${s.id}/events`, { type: "explode" })).status).toBe(400);
  });
});
