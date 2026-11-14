// Live provider smoke tests — they spend a fraction of a cent per run.
// Run with: pnpm test:live  (reads keys from .env.local)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2] && (m[1].endsWith("_API_KEY") || m[1].endsWith("_BASE_URL"))) process.env[m[1]] = m[2].trim();
}

const { enabledModels } = await import("@/server/economics/registry");
const { adapterFor } = await import("@/server/gateway/adapters");

describe("live providers", () => {
  const providers = Array.from(new Set(enabledModels().map((m) => m.provider)));
  it("has at least one configured provider", () => expect(providers.length).toBeGreaterThan(0));
  for (const p of providers) {
    it(`${p}: streams text and reports usage on its economy model`, async () => {
      const model = enabledModels().filter((m) => m.provider === p).sort((a, b) => Number(a.costOutPerM - b.costOutPerM))[0];
      let text = "";
      let usage: { inTokens: number; outTokens: number } | null = null;
      for await (const c of adapterFor(p).stream({ model, system: "Answer in five words or fewer.", messages: [{ role: "user", content: "Say hello." }], maxOutputTokens: 64, signal: AbortSignal.timeout(60_000) })) {
        if (c.type === "text") text += c.text;
        else usage = c.usage;
      }
      console.log(`${model.model}: "${text.trim()}"`, usage);
      expect(text.length).toBeGreaterThan(0);
      expect(usage?.inTokens).toBeGreaterThan(0);
    });
  }
  for (const model of enabledModels().filter((m) => m.provider === "gemini" && m.tier !== "economy")) {
    it(`${model.model}: the shared Gemini key generates an answer`, async () => {
      let text = "";
      let usage: { inTokens: number; outTokens: number } | null = null;
      for await (const chunk of adapterFor("gemini").stream({ model, system: "Reply briefly.", messages: [{ role: "user", content: "Reply with OK only." }], maxOutputTokens: 1024, signal: AbortSignal.timeout(25_000) })) {
        if (chunk.type === "text") text += chunk.text;
        else usage = chunk.usage;
      }
      expect(text.trim().length).toBeGreaterThan(0);
      expect(usage?.inTokens).toBeGreaterThan(0);
      expect(usage?.outTokens).toBeGreaterThan(0);
    });
  }
});
