// Types shared by the server (policy, router, simulation) and the UI.
// Money is always bigint minor units on the server; over JSON it travels as a
// decimal string of minor units (see `MicroString`) so nothing is lost.

export const STATES = ["ABUNDANCE", "DEFENSIVE", "SURVIVAL", "RECOVERY"] as const;
export type OperatingState = (typeof STATES)[number];

export const TIERS = ["premium", "standard", "economy"] as const;
export type Tier = (typeof TIERS)[number];

/** Micro-USD as a decimal string of an integer: "1250000" = $1.25. */
export type MicroString = string;
/** yoctoNEAR as a decimal string of an integer. */
export type YoctoString = string;

export type Capability = "chat" | "code" | "reasoning" | "long_context";

export type ModelSpec = {
  id: string; // our id, e.g. "anthropic:claude-sonnet-5-5"
  provider: string; // adapter key: "anthropic" | "deepseek" | "llama" | "openai"
  model: string; // provider's model identifier
  label: string;
  tier: Tier;
  quality: number; // 0..100, operator-assigned capability score
  capabilities: Capability[];
  maxOutputTokens: number;
  /** Provider cost, micro-USD per 1M tokens. */
  costInPerM: bigint;
  costOutPerM: bigint;
  /** Our sell price, micro-USD per 1M tokens. */
  sellInPerM: bigint;
  sellOutPerM: bigint;
  /** Fixed provider overhead per request, micro-USD. */
  overhead: bigint;
};

export type ProviderHealth = "ok" | "degraded" | "down";

/** Everything the policy engine looks at. All money in micro-USD. */
export type EconomicSnapshot = {
  at: number; // epoch ms
  treasury: bigint; // assets, USD at historical cost
  liabilities: bigint; // customer credits (available + reserved)
  payables: bigint; // provider costs owed
  revenueWindow: bigint;
  expenseWindow: bigint;
  requestsWindow: number;
  overheadPerHour: bigint;
  windowMs: number;
  providerHealth: Record<string, ProviderHealth>;
  rateStale: boolean;
};

export type DerivedMetrics = {
  liquidity: bigint;
  spendable: bigint;
  reserveCoverageBp: number; // 10000 = 1.0x
  rollingMarginBp: number | null; // null when no revenue in window
  burnPerHour: bigint;
  runwaySeconds: number | null; // null = not burning (self-sustaining)
};

export type StateMemory = {
  state: OperatingState;
  since: number; // epoch ms when the current state began
  /** When a candidate improving transition first became true, per target. */
  pendingSince?: { target: OperatingState; at: number } | null;
};

export type Permissions = {
  tiers: Record<Tier, boolean>;
  maxOutputTokens: number;
  maxCostPerRequest: bigint;
  minMarginBp: Record<Tier, number>;
  longContext: boolean;
};

export type PolicyEvaluation = {
  state: OperatingState;
  previous: OperatingState;
  changed: boolean;
  trigger: string | null;
  metrics: DerivedMetrics;
  permissions: Permissions;
  memory: StateMemory;
  policyVersion: number;
};

export type CandidateEstimate = {
  modelId: string;
  tier: Tier;
  inTokens: number;
  outTokens: number;
  cost: bigint;
  charge: bigint;
  marginBp: number;
  allowed: boolean;
  reason: string | null; // why excluded
};

export type RouteDecision =
  | { ok: true; model: ModelSpec; estimate: CandidateEstimate; candidates: CandidateEstimate[]; explanation: string }
  | { ok: false; code: RefusalCode; candidates: CandidateEstimate[]; explanation: string };

export type RefusalCode = "FUNDING_REQUIRED" | "NO_CAPABLE_MODEL" | "ALL_PROVIDERS_DOWN" | "POLICY_PAUSED" | "COST_CAP";

export const EVENT_TYPES = [
  "treasury.deposit.pending",
  "treasury.deposit.confirmed",
  "treasury.intent.created",
  "treasury.intent.settled",
  "inference.started",
  "inference.completed",
  "inference.failed",
  "model.switched",
  "economic.state.changed",
  "margin.threshold.crossed",
  "receipt.submitted",
  "receipt.finalized",
  "receipt.failed",
  "provider.unhealthy",
  "provider.recovered",
  "snapshot.updated",
  "simulation.started",
  "simulation.ended",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type MetabolicEvent = {
  id: string;
  seq: number;
  ts: string;
  type: EventType;
  source: "gateway" | "policy" | "treasury" | "receipts" | "simulation" | "worker" | "api";
  scope: string; // "real" | "sim:<id>"
  simulated: boolean;
  entityId?: string | null;
  payload: Record<string, unknown>;
};

/** What the dashboard reads to (re)build itself. Money as MicroString. */
export type OverviewDTO = {
  scope: string;
  simulated: boolean;
  at: string;
  state: OperatingState;
  stateSince: string;
  policyVersion: number;
  treasury: MicroString;
  treasuryNear: YoctoString;
  liabilities: MicroString;
  payables: MicroString;
  liquidity: MicroString;
  spendable: MicroString;
  hardReserve: MicroString;
  revenueWindow: MicroString;
  expenseWindow: MicroString;
  revenueTotal: MicroString;
  expenseTotal: MicroString;
  expenseEstimatedTotal: MicroString;
  rollingMarginBp: number | null;
  reserveCoverageBp: number;
  runwaySeconds: number | null;
  requestsWindow: number;
  activeModel: { id: string; label: string; tier: Tier; provider: string } | null;
  lastDecision: { at: string; explanation: string; kind: string } | null;
  providers: { provider: string; health: ProviderHealth; configured: boolean }[];
  permissions: { tiers: Record<Tier, boolean>; maxCostPerRequest: MicroString; maxOutputTokens: number };
  rate: { microPerNear: MicroString; observedAt: string; stale: boolean } | null;
  network: string;
  paused: boolean;
};
