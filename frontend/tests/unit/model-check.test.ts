import { beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({ fail: false, params: null as { maxOutputTokens: number; signal: AbortSignal } | null }));
vi.mock("@/server/gateway/adapters", async (original) => {
  const actual = await original<typeof import("@/server/gateway/adapters")>();
  return { ...actual, adapterFor: vi.fn(() => ({
    async *stream(params: { maxOutputTokens: number; signal: AbortSignal }) {
      probe.params = params;
      if (probe.fail) throw new actual.ProviderError("Gemini quota reached. Check project billing.", "rate_limit", true);
      yield { type: "text", text: "OK" };
    },
    health: async () => ({ ok: true, latencyMs: 1 }),
  })) };
});
vi.mock("@/server/http", async (original) => {
  const actual = await original<typeof import("@/server/http")>();
  return { ...actual, requireOperator: vi.fn(), rateLimit: vi.fn() };
});

import { POST } from "@/app/api/models/check/route";
import { HttpError, rateLimit, requireOperator } from "@/server/http";
import { adapterFor } from "@/server/gateway/adapters";

const request = (modelId = "gemini:gemini-3.1-pro-preview") => new Request("http://localhost/api/models/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperator).mockReset();
  vi.mocked(rateLimit).mockReset();
  probe.fail = false;
  probe.params = null;
  vi.mocked(requireOperator).mockResolvedValue({ id: "operator-id", accountId: "operator.testnet", role: "operator" } as Awaited<ReturnType<typeof requireOperator>>);
});

describe("model connection checks", () => {
  it("requires an operator before making any provider calls", async () => {
    vi.mocked(requireOperator).mockRejectedValue(new HttpError(403, "FORBIDDEN", "Operator access required."));
    expect((await POST(request(), {})).status).toBe(403);
    expect(adapterFor).not.toHaveBeenCalled();
  });

  it("bounds provider usage and confirms a real text response", async () => {
    const response = await POST(request(), {});
    expect((await response.json()).ok).toBe(true);
    expect(probe.params?.maxOutputTokens).toBeLessThanOrEqual(1024);
    expect(probe.params?.signal).toBeInstanceOf(AbortSignal);
    expect(rateLimit).toHaveBeenCalledWith("model-check:operator-id", 6);
  });

  it("does not call a provider for an unknown or unconfigured model", async () => {
    expect((await POST(request("missing"), {})).status).toBe(400);
    expect((await POST(request("anthropic:claude-opus-5-5"), {})).status).toBe(400);
    expect(adapterFor).not.toHaveBeenCalled();
  });

  it("stops repeated tests at the rate limit", async () => {
    vi.mocked(rateLimit).mockImplementation(() => { throw new HttpError(429, "RATE_LIMITED", "Try again later."); });
    expect((await POST(request(), {})).status).toBe(429);
    expect(adapterFor).not.toHaveBeenCalled();
  });

  it("returns useful quota guidance without exposing credentials", async () => {
    probe.fail = true;
    const response = await POST(request(), {});
    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.errorClass).toBe("rate_limit");
    expect(data.message).toMatch(/billing/);
    expect(JSON.stringify(data)).not.toContain(process.env.GEMINI_API_KEY);
  });
});
