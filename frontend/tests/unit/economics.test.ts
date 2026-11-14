import { describe, expect, it } from "vitest";
import { formatUsd, marginBp, mulDivRound, parseNear, parseUsd, tokenCost, nearToUsd, formatRunway } from "@/lib/economics/money";
import { DEFAULT_POLICY, deriveMetrics, evaluatePolicy, type PolicyConfig } from "@/server/economics/policy";
import { chooseModel, estimate } from "@/server/economics/router";
import type { EconomicSnapshot, ModelSpec, StateMemory } from "@/lib/economics/types";

const cfg: PolicyConfig = { ...DEFAULT_POLICY, hardReserve: 5_000_000n };
const $ = (n: number) => BigInt(Math.round(n * 1_000_000));

function snap(p: Partial<EconomicSnapshot> = {}): EconomicSnapshot {
  return {
    at: 0,
    treasury: $(100),
    liabilities: $(40),
    payables: $(0),
    revenueWindow: $(10),
    expenseWindow: $(4),
    requestsWindow: 100,
    overheadPerHour: 0n,
    windowMs: 3_600_000,
    providerHealth: {},
    rateStale: false,
    ...p,
  };
}

const models: ModelSpec[] = [
  { id: "p", provider: "anthropic", model: "premium-x", label: "P", tier: "premium", quality: 95, capabilities: ["chat", "code", "reasoning", "long_context"], maxOutputTokens: 4096, costInPerM: $(3), costOutPerM: $(15), sellInPerM: $(6), sellOutPerM: $(30), overhead: 0n },
  { id: "s", provider: "deepseek", model: "standard-x", label: "S", tier: "standard", quality: 80, capabilities: ["chat", "code"], maxOutputTokens: 4096, costInPerM: $(0.5), costOutPerM: $(2), sellInPerM: $(1.5), sellOutPerM: $(6), overhead: 0n },
  { id: "e", provider: "llama", model: "economy-x", label: "E", tier: "economy", quality: 65, capabilities: ["chat"], maxOutputTokens: 2048, costInPerM: $(0.1), costOutPerM: $(0.3), sellInPerM: $(0.4), sellOutPerM: $(1.2), overhead: 0n },
];

describe("money", () => {
  it("rounds half away from zero", () => {
    expect(mulDivRound(5n, 1n, 2n)).toBe(3n);
    expect(mulDivRound(-5n, 1n, 2n)).toBe(-3n);
    expect(mulDivRound(4n, 1n, 3n)).toBe(1n);
  });
  it("computes token cost rounded up", () => {
    expect(tokenCost(1_000_000, $(3))).toBe($(3));
    expect(tokenCost(1, 3_000_000n)).toBe(3n);
    expect(tokenCost(1, 1n)).toBe(1n); // never rounds a cost to zero
    expect(() => tokenCost(-1, 1n)).toThrow();
  });
  it("margin in basis points", () => {
    expect(marginBp($(10), $(4))).toBe(6000);
    expect(marginBp(0n, $(1))).toBeNull();
    expect(marginBp($(1), $(2))).toBe(-10000);
  });
  it("parses and formats", () => {
    expect(parseUsd("1.25")).toBe(1_250_000n);
    expect(parseUsd("1.2345678")).toBeNull();
    expect(parseNear("2")).toBe(2n * 10n ** 24n);
    expect(formatUsd(1_250_000n)).toBe("$1.25");
    expect(formatUsd(812n)).toBe("$0.0008");
    expect(formatUsd(12_345_678_900n)).toBe("$12,345.68");
    expect(nearToUsd(2n * 10n ** 24n, 3_420_000n)).toBe(6_840_000n);
    expect(formatRunway(null)).toBe("Self-sustaining");
    expect(formatRunway(90_000)).toBe("1d 1h");
  });
});

describe("policy", () => {
  it("derives liquidity, coverage and runway", () => {
    const m = deriveMetrics(snap({ revenueWindow: $(1), expenseWindow: $(3) }), cfg);
    expect(m.liquidity).toBe($(60));
    expect(m.spendable).toBe($(55));
    expect(m.reserveCoverageBp).toBe(120_000);
    expect(m.burnPerHour).toBe($(2));
    expect(m.runwaySeconds).toBe(27.5 * 3600);
  });

  it("classifies a fresh snapshot", () => {
    expect(evaluatePolicy(snap(), null, cfg, 0).state).toBe("ABUNDANCE");
    expect(evaluatePolicy(snap({ treasury: $(44) }), null, cfg, 0).state).toBe("SURVIVAL");
    expect(evaluatePolicy(snap({ revenueWindow: $(10), expenseWindow: $(9) }), null, cfg, 0).state).toBe("DEFENSIVE");
  });

  it("enters survival immediately, ignoring dwell", () => {
    const mem: StateMemory = { state: "ABUNDANCE", since: 0 };
    const r = evaluatePolicy(snap({ treasury: $(45) }), mem, cfg, 1000);
    expect(r.state).toBe("SURVIVAL");
    expect(r.changed).toBe(true);
    expect(r.permissions.tiers.premium).toBe(false);
  });

  it("respects min dwell before worsening to defensive", () => {
    const mem: StateMemory = { state: "ABUNDANCE", since: 0 };
    const bad = snap({ revenueWindow: $(10), expenseWindow: $(9) });
    expect(evaluatePolicy(bad, mem, cfg, 60_000).state).toBe("ABUNDANCE");
    expect(evaluatePolicy(bad, mem, cfg, 120_000).state).toBe("DEFENSIVE");
  });

  it("leaves survival only through recovery, then abundance after recovery dwell", () => {
    let mem: StateMemory = { state: "SURVIVAL", since: 0 };
    const healthy = snap();
    let r = evaluatePolicy(healthy, mem, cfg, 200_000);
    expect(r.state).toBe("RECOVERY");
    mem = r.memory;
    r = evaluatePolicy(healthy, mem, cfg, 300_000);
    expect(r.state).toBe("RECOVERY"); // pending timer starts
    mem = r.memory;
    r = evaluatePolicy(healthy, mem, cfg, 300_000 + cfg.recovery.dwellMs);
    expect(r.state).toBe("ABUNDANCE");
  });

  it("does not flap on a threshold within the hysteresis band", () => {
    const mem: StateMemory = { state: "DEFENSIVE", since: 0 };
    // margin exactly 30% — inside the 5% hysteresis band, so no improvement
    const edge = snap({ revenueWindow: $(10), expenseWindow: $(7) });
    let r = evaluatePolicy(edge, mem, cfg, 500_000);
    r = evaluatePolicy(edge, r.memory, cfg, 900_000);
    expect(r.state).toBe("DEFENSIVE");
  });

  it("freezes improvements while the exchange rate is stale", () => {
    const mem: StateMemory = { state: "SURVIVAL", since: 0 };
    const r = evaluatePolicy(snap({ rateStale: true }), mem, cfg, 1_000_000);
    expect(r.state).toBe("SURVIVAL");
  });

  it("relapses from recovery to survival immediately", () => {
    const mem: StateMemory = { state: "RECOVERY", since: 0 };
    expect(evaluatePolicy(snap({ treasury: $(44) }), mem, cfg, 10).state).toBe("SURVIVAL");
  });
});

describe("router", () => {
  const health = {};
  it("estimates cost and charge", () => {
    const e = estimate(models[0], 1000, 500);
    expect(e.cost).toBe(3000n + 7500n);
    expect(e.charge).toBe(6000n + 15000n);
    expect(e.marginBp).toBe(5000);
  });

  it("picks premium in abundance when it clears margin", () => {
    const p = evaluatePolicy(snap(), null, cfg, 0);
    const d = chooseModel({ inTokens: 800 }, models, p, health);
    expect(d.ok && d.model.id).toBe("p");
  });

  it("downgrades when a cost spike crushes premium margin", () => {
    const p = evaluatePolicy(snap(), null, cfg, 0);
    const d = chooseModel({ inTokens: 800 }, models, p, health, { costMultiplier: 1.6 });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.model.tier).not.toBe("premium");
      expect(d.explanation).toMatch(/Premium excluded/);
    }
  });

  it("excludes models lacking a required capability", () => {
    const p = evaluatePolicy(snap(), null, cfg, 0);
    const d = chooseModel({ inTokens: 100, requires: ["long_context"] }, models, p, health);
    expect(d.ok && d.model.id).toBe("p");
    const d2 = chooseModel({ inTokens: 100, requires: ["long_context"] }, models.slice(1), p, health);
    expect(d2.ok).toBe(false);
    if (!d2.ok) expect(d2.code).toBe("NO_CAPABLE_MODEL");
  });

  it("skips providers that are down", () => {
    const p = evaluatePolicy(snap(), null, cfg, 0);
    const d = chooseModel({ inTokens: 800 }, models, p, { anthropic: "down" });
    expect(d.ok && d.model.provider).not.toBe("anthropic");
  });

  it("refuses with FUNDING_REQUIRED in survival with no spendable funds", () => {
    const p = evaluatePolicy(snap({ treasury: $(44) }), null, cfg, 0);
    const d = chooseModel({ inTokens: 800 }, models, p, health);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("FUNDING_REQUIRED");
  });

  it("refuses when paused", () => {
    const p = evaluatePolicy(snap(), null, cfg, 0);
    const d = chooseModel({ inTokens: 1 }, models, p, health, { paused: true });
    expect(!d.ok && d.code).toBe("POLICY_PAUSED");
  });
});
