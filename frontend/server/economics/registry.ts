import "server-only";
import catalog from "@/config/models.json";
import { parseUsd } from "@/lib/economics/money";
import type { Capability, ModelSpec, Tier } from "@/lib/economics/types";

type CatalogEntry = {
  id: string;
  provider: string;
  model: string;
  label: string;
  tier: Tier;
  quality: number;
  capabilities: Capability[];
  maxOutputTokens: number;
  cost: { in: number; out: number } | null;
  sell?: { in: number; out: number };
  sellMarkup?: number;
  effort?: "low" | "medium" | "high";
};

export type RegistryModel = ModelSpec & { effort?: "low" | "medium" | "high"; enabled: boolean; disabledReason: string | null };

export const PROVIDER_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  llama: "LLAMA_API_KEY",
};

export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  deepseek: "DeepSeek",
  llama: "Llama host",
};

const usdToMicro = (n: number) => parseUsd(n.toFixed(6)) ?? 0n;

function resolveModelId(raw: string): string | null {
  if (!raw.startsWith("env:")) return raw;
  const [envKey, fallback] = raw.slice(4).split("|");
  return process.env[envKey]?.trim() || fallback || null;
}

function envPrice(provider: string, which: "IN" | "OUT"): number | null {
  const v = process.env[`${provider.toUpperCase()}_COST_${which}_PER_M`]?.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

let cached: RegistryModel[] | null = null;

/** All catalog models with their enabled state. Prices come from config/models.json or env overrides. */
export function allModels(): RegistryModel[] {
  if (cached) return cached;
  const out: RegistryModel[] = [];
  for (const e of (catalog as { models: CatalogEntry[] }).models) {
    const model = resolveModelId(e.model);
    const costIn = envPrice(e.provider, "IN") ?? e.cost?.in ?? null;
    const costOut = envPrice(e.provider, "OUT") ?? e.cost?.out ?? null;
    const hasKey = !!process.env[PROVIDER_KEYS[e.provider] ?? ""]?.trim();
    let disabledReason: string | null = null;
    if (!hasKey) disabledReason = `${PROVIDER_KEYS[e.provider] ?? "provider key"} not set`;
    else if (!model) disabledReason = "model identifier not configured";
    else if (costIn === null || costOut === null) disabledReason = `set ${e.provider.toUpperCase()}_COST_IN_PER_M and _OUT_PER_M`;
    const sellIn = e.sell?.in ?? (costIn !== null ? costIn * (e.sellMarkup ?? 2) : 0);
    const sellOut = e.sell?.out ?? (costOut !== null ? costOut * (e.sellMarkup ?? 2) : 0);
    out.push({
      id: e.id,
      provider: e.provider,
      model: model ?? "(unset)",
      label: e.label,
      tier: e.tier,
      quality: e.quality,
      capabilities: e.capabilities,
      maxOutputTokens: e.maxOutputTokens,
      costInPerM: usdToMicro(costIn ?? 0),
      costOutPerM: usdToMicro(costOut ?? 0),
      sellInPerM: usdToMicro(sellIn),
      sellOutPerM: usdToMicro(sellOut),
      overhead: 0n,
      effort: e.effort,
      enabled: disabledReason === null,
      disabledReason,
    });
  }
  cached = out;
  return out;
}

export function enabledModels(): RegistryModel[] {
  return allModels().filter((m) => m.enabled);
}

export function findModel(id: string): RegistryModel | undefined {
  return allModels().find((m) => m.id === id || m.model === id);
}

export function configuredProviders(): { provider: string; configured: boolean }[] {
  const seen = new Set<string>();
  const list: { provider: string; configured: boolean }[] = [];
  for (const m of allModels()) {
    if (seen.has(m.provider)) continue;
    seen.add(m.provider);
    list.push({ provider: m.provider, configured: allModels().some((x) => x.provider === m.provider && x.enabled) });
  }
  return list;
}
