import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { classifyGemini } from "@/server/gateway/adapters";
import { allModels } from "@/server/economics/registry";

describe("Gemini configuration", () => {
  it("uses one key for a current model in every routing tier", () => {
    const models = allModels().filter((m) => m.provider === "gemini" && m.enabled);
    expect(new Set(models.map((m) => m.tier))).toEqual(new Set(["premium", "standard", "economy"]));
    expect(models.some((m) => m.model === "gemini-3.1-pro-preview")).toBe(true);
    expect(models.some((m) => m.model === "gemini-2.5-pro")).toBe(false);
  });
});

describe("Gemini errors", () => {
  it("recognizes an invalid key even when Google returns HTTP 400", async () => {
    const error = await classifyGemini(new ApiError({ status: 400, message: "API key not valid. Please pass a valid API key. API_KEY_INVALID" }));
    expect(error.errorClass).toBe("auth");
    expect(error.message).toMatch(/replace|update/i);
  });

  it("explains a retired model without asking for a new key", async () => {
    const error = await classifyGemini(new ApiError({ status: 404, message: "Model is no longer available to new users" }));
    expect(error.errorClass).toBe("bad_request");
    expect(error.message).toMatch(/model/i);
    expect(error.message).toMatch(/key/i);
    expect(error.message).not.toContain("rejected");
  });

  it("separates quota limits from authentication failures and does not echo provider secrets", async () => {
    const error = await classifyGemini(new ApiError({ status: 429, message: "quota exceeded secret-value" }));
    expect(error.errorClass).toBe("rate_limit");
    expect(error.message).toMatch(/quota|billing/i);
    expect(error.message).not.toContain("secret-value");
  });
});
