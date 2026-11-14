import "server-only";
import { getDb, schema } from "@/server/db/client";
import type { ProviderHealth } from "@/lib/economics/types";
import { publish } from "./core";
import { adapterFor } from "@/server/gateway/adapters";
import { configuredProviders } from "@/server/economics/registry";

// Circuit breaker per provider: 3 consecutive failures, or > 50% errors over
// the last 2 minutes (min 4 calls), opens the circuit for 60 s; then one probe.

type Window = { at: number; ok: boolean }[];
type Breaker = { consecutive: number; openUntil: number; window: Window; latency: number[] };
const g = globalThis as unknown as { __metabolicBreakers?: Map<string, Breaker> };
const breakers: Map<string, Breaker> = g.__metabolicBreakers ?? (g.__metabolicBreakers = new Map());

function b(provider: string): Breaker {
  let x = breakers.get(provider);
  if (!x) breakers.set(provider, (x = { consecutive: 0, openUntil: 0, window: [], latency: [] }));
  return x;
}

export function providerHealth(provider: string): ProviderHealth {
  const x = b(provider);
  const now = Date.now();
  if (x.openUntil > now) return "down";
  x.window = x.window.filter((w) => now - w.at < 120_000);
  const errs = x.window.filter((w) => !w.ok).length;
  if (x.window.length >= 4 && errs / x.window.length > 0.25) return "degraded";
  if (x.consecutive > 0) return "degraded";
  return "ok";
}

export function healthMap(): Record<string, ProviderHealth> {
  const out: Record<string, ProviderHealth> = {};
  for (const p of configuredProviders()) out[p.provider] = providerHealth(p.provider);
  return out;
}

export function latencyStats(provider: string): { p50: number | null; p95: number | null } {
  const l = [...b(provider).latency].sort((a, c) => a - c);
  if (!l.length) return { p50: null, p95: null };
  return { p50: l[Math.floor(l.length * 0.5)], p95: l[Math.min(l.length - 1, Math.floor(l.length * 0.95))] };
}

export async function recordResult(provider: string, ok: boolean, latencyMs: number | null, errorClass?: string) {
  const x = b(provider);
  const now = Date.now();
  const before = providerHealth(provider);
  x.window.push({ at: now, ok });
  if (latencyMs !== null && ok) {
    x.latency.push(latencyMs);
    if (x.latency.length > 200) x.latency.shift();
  }
  if (ok) {
    x.consecutive = 0;
    x.openUntil = 0;
  } else if (errorClass !== "aborted" && errorClass !== "bad_request" && errorClass !== "refusal") {
    x.consecutive += 1;
    const recent = x.window.filter((w) => now - w.at < 120_000);
    const errRate = recent.filter((w) => !w.ok).length / recent.length;
    if (x.consecutive >= 3 || (recent.length >= 4 && errRate > 0.5)) x.openUntil = now + 60_000;
  }
  const after = providerHealth(provider);
  const db = await getDb();
  await db.insert(schema.providerHealth).values({ provider, ok, latencyMs, errorClass: errorClass ?? null });
  if (before !== "down" && after === "down") await publish("provider.unhealthy", { provider, errorClass }, { source: "gateway" });
  if (before === "down" && after !== "down") await publish("provider.recovered", { provider }, { source: "gateway" });
}

export async function probeAll() {
  for (const { provider, configured } of configuredProviders()) {
    if (!configured) continue;
    const r = await adapterFor(provider).health();
    await recordResult(provider, r.ok, r.latencyMs, r.error);
  }
}
