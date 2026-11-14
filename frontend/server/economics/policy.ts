// The economic brain. Pure and deterministic: the real system and the Stress
// Lab call the same function with different snapshots. See docs/04.

import { marginBp, ratioBp } from "@/lib/economics/money";
import type {
  DerivedMetrics,
  EconomicSnapshot,
  OperatingState,
  Permissions,
  PolicyEvaluation,
  StateMemory,
  Tier,
} from "@/lib/economics/types";

export type PolicyConfig = {
  version: number;
  hardReserve: bigint; // micro-USD
  abundance: { minMarginBp: number; minCoverageBp: number };
  defensive: { enterMarginBp: number; enterCoverageBp: number };
  survival: { enterCoverageBp: number; enterMarginBp: number };
  recovery: { exitCoverageBp: number; enterCoverageBp: number; dwellMs: number };
  minDwellMs: number;
  hysteresisBp: number;
  limits: {
    maxCostPerRequest: Record<OperatingState, bigint>;
    maxOutputTokens: Record<OperatingState, number>;
    maxDailyProviderSpend: bigint;
    maxConcurrency: number;
  };
  minMarginBp: Record<OperatingState, Record<Tier, number>>;
};

export const DEFAULT_POLICY: PolicyConfig = {
  version: 1,
  hardReserve: 1_000_000n, // $1.00 — testnet scale; operators can change it in Settings
  abundance: { minMarginBp: 3000, minCoverageBp: 30_000 },
  defensive: { enterMarginBp: 2000, enterCoverageBp: 15_000 },
  survival: { enterCoverageBp: 10_000, enterMarginBp: -500 },
  recovery: { exitCoverageBp: 30_000, enterCoverageBp: 10_500, dwellMs: 300_000 },
  minDwellMs: 120_000,
  hysteresisBp: 500,
  limits: {
    maxCostPerRequest: { ABUNDANCE: 250_000n, DEFENSIVE: 80_000n, SURVIVAL: 10_000n, RECOVERY: 80_000n },
    maxOutputTokens: { ABUNDANCE: 4096, DEFENSIVE: 2048, SURVIVAL: 512, RECOVERY: 2048 },
    maxDailyProviderSpend: 20_000_000n,
    maxConcurrency: 8,
  },
  // A tier is allowed in a state only when its projected margin is at least this.
  // Number.POSITIVE_INFINITY = tier disabled in that state.
  minMarginBp: {
    ABUNDANCE: { premium: 3000, standard: 2000, economy: 1000 },
    DEFENSIVE: { premium: 3000, standard: 2000, economy: 500 },
    SURVIVAL: { premium: Number.POSITIVE_INFINITY, standard: 2000, economy: 1 },
    RECOVERY: { premium: 4000, standard: 2000, economy: 500 },
  },
};

export function deriveMetrics(s: EconomicSnapshot, cfg: PolicyConfig): DerivedMetrics {
  const liquidity = s.treasury - s.liabilities - s.payables;
  const spendable = liquidity > cfg.hardReserve ? liquidity - cfg.hardReserve : 0n;
  const reserveCoverageBp = ratioBp(liquidity, cfg.hardReserve);
  const rollingMarginBp = marginBp(s.revenueWindow, s.expenseWindow);
  const net = s.expenseWindow - s.revenueWindow;
  const perHourNet = s.windowMs > 0 ? (net * 3_600_000n) / BigInt(s.windowMs) : 0n;
  const burnPerHour = (perHourNet > 0n ? perHourNet : 0n) + s.overheadPerHour;
  const runwaySeconds = spendable === 0n ? 0 : burnPerHour > 0n ? Number((spendable * 3600n) / burnPerHour) : null;
  return { liquidity, spendable, reserveCoverageBp, rollingMarginBp, burnPerHour, runwaySeconds };
}

function permissionsFor(state: OperatingState, cfg: PolicyConfig): Permissions {
  const min = cfg.minMarginBp[state];
  return {
    tiers: {
      premium: Number.isFinite(min.premium),
      standard: Number.isFinite(min.standard),
      economy: Number.isFinite(min.economy),
    },
    minMarginBp: min,
    maxOutputTokens: cfg.limits.maxOutputTokens[state],
    maxCostPerRequest: cfg.limits.maxCostPerRequest[state],
    longContext: state === "ABUNDANCE",
  };
}

const RANK: Record<OperatingState, number> = { SURVIVAL: 0, DEFENSIVE: 1, RECOVERY: 2, ABUNDANCE: 3 };
export const isImprovement = (from: OperatingState, to: OperatingState) => RANK[to] > RANK[from];

/** Fresh state with no history: classify directly. */
function classify(m: DerivedMetrics, cfg: PolicyConfig): OperatingState {
  if (survivalCondition(m, cfg)) return "SURVIVAL";
  const marginOk = m.rollingMarginBp === null || m.rollingMarginBp >= cfg.abundance.minMarginBp;
  if (marginOk && m.reserveCoverageBp >= cfg.abundance.minCoverageBp) return "ABUNDANCE";
  return "DEFENSIVE";
}

function survivalCondition(m: DerivedMetrics, cfg: PolicyConfig) {
  return (
    m.reserveCoverageBp <= cfg.survival.enterCoverageBp ||
    (m.rollingMarginBp !== null && m.rollingMarginBp <= cfg.survival.enterMarginBp)
  );
}

function defensiveCondition(m: DerivedMetrics, cfg: PolicyConfig) {
  return (
    (m.rollingMarginBp !== null && m.rollingMarginBp < cfg.defensive.enterMarginBp) ||
    m.reserveCoverageBp < cfg.defensive.enterCoverageBp
  );
}

function abundanceCondition(m: DerivedMetrics, cfg: PolicyConfig, exitCoverageBp: number) {
  const h = cfg.hysteresisBp;
  const marginOk = m.rollingMarginBp === null || m.rollingMarginBp >= cfg.abundance.minMarginBp + h;
  return marginOk && m.reserveCoverageBp >= exitCoverageBp + h;
}

function describe(m: DerivedMetrics): string {
  const margin = m.rollingMarginBp === null ? "no revenue in window" : `margin ${(m.rollingMarginBp / 100).toFixed(1)}%`;
  return `${margin}, liquidity ${(m.reserveCoverageBp / 10_000).toFixed(2)}× reserve`;
}

/**
 * Evaluate the operating state.
 * - Survival is entered immediately (no dwell).
 * - Leaving survival always goes through RECOVERY.
 * - Improvements must hold for the dwell time and clear thresholds by the hysteresis band.
 * - Worsenings (other than survival) respect the minimum dwell in the current state.
 * - With a stale exchange rate the state may hold or worsen, never improve.
 */
export function evaluatePolicy(
  snapshot: EconomicSnapshot,
  memory: StateMemory | null,
  cfg: PolicyConfig,
  now: number,
): PolicyEvaluation {
  const m = deriveMetrics(snapshot, cfg);

  if (!memory) {
    const state = classify(m, cfg);
    return {
      state,
      previous: state,
      changed: false,
      trigger: `initial classification: ${describe(m)}`,
      metrics: m,
      permissions: permissionsFor(state, cfg),
      memory: { state, since: now, pendingSince: null },
      policyVersion: cfg.version,
    };
  }

  const cur = memory.state;
  const dwelled = now - memory.since >= cfg.minDwellMs;
  let next: OperatingState = cur;
  let trigger: string | null = null;
  let pending = memory.pendingSince ?? null;

  const tryImprove = (target: OperatingState, cond: boolean, dwellMs: number, why: string) => {
    if (!cond || snapshot.rateStale) {
      if (pending?.target === target) pending = null;
      return;
    }
    if (!pending || pending.target !== target) pending = { target, at: now };
    if (now - pending.at >= dwellMs && dwelled) {
      next = target;
      trigger = why;
    }
  };

  if (survivalCondition(m, cfg)) {
    if (cur !== "SURVIVAL") {
      next = "SURVIVAL";
      trigger =
        m.reserveCoverageBp <= cfg.survival.enterCoverageBp
          ? `liquidity at or below hard reserve (${describe(m)})`
          : `negative unit economics (${describe(m)})`;
    }
  } else {
    switch (cur) {
      case "ABUNDANCE":
        if (defensiveCondition(m, cfg) && dwelled) {
          next = "DEFENSIVE";
          trigger = `margin or reserve below defensive threshold (${describe(m)})`;
        }
        break;
      case "DEFENSIVE":
        tryImprove(
          "ABUNDANCE",
          abundanceCondition(m, cfg, cfg.abundance.minCoverageBp),
          cfg.minDwellMs,
          `sustained healthy economics (${describe(m)})`,
        );
        break;
      case "SURVIVAL":
        tryImprove(
          "RECOVERY",
          m.reserveCoverageBp >= cfg.recovery.enterCoverageBp + cfg.hysteresisBp,
          0,
          `funds restored above reserve (${describe(m)})`,
        );
        break;
      case "RECOVERY":
        if (defensiveCondition(m, cfg) && dwelled && m.reserveCoverageBp < cfg.defensive.enterCoverageBp - cfg.hysteresisBp) {
          next = "DEFENSIVE";
          trigger = `recovery stalled (${describe(m)})`;
        } else {
          tryImprove(
            "ABUNDANCE",
            abundanceCondition(m, cfg, cfg.recovery.exitCoverageBp),
            cfg.recovery.dwellMs,
            `stable for ${Math.round(cfg.recovery.dwellMs / 1000)}s (${describe(m)})`,
          );
        }
        break;
    }
  }

  const changed = next !== cur;
  return {
    state: next,
    previous: cur,
    changed,
    trigger,
    metrics: m,
    permissions: permissionsFor(next, cfg),
    memory: changed ? { state: next, since: now, pendingSince: null } : { ...memory, pendingSince: pending },
    policyVersion: cfg.version,
  };
}
