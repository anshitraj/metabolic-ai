// Metabolic AI database schema (PostgreSQL / PGlite). See docs/03 §4.
// Money: micro-USD as int8 (bigint mode), NEAR as numeric(40,0) strings of yocto.
// `scope` is 'real' or 'sim:<id>'; real queries always filter scope = 'real'.

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const micro = (name: string) => bigint(name, { mode: "bigint" });
const yocto = (name: string) => numeric(name, { precision: 40, scale: 0 });

export const users = pgTable("users", {
  id: id(),
  nearAccountId: text("near_account_id").notNull(),
  role: text("role").notNull().default("customer"), // customer | operator
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (t) => [uniqueIndex("users_account_uq").on(t.nearAccountId)]).enableRLS();

export const authNonces = pgTable("auth_nonces", {
  id: id(),
  nonce: text("nonce").notNull(), // base64 of 32 random bytes
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("auth_nonces_uq").on(t.nonce)]).enableRLS();

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  publicKey: text("public_key").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash)]).enableRLS();

export const spendPasses = pgTable("spend_passes", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  agentName: text("agent_name").notNull(),
  totalBudget: micro("total_budget").notNull(),
  maxPerRequest: micro("max_per_request").notNull(),
  spent: micro("spent").notNull().default(sql`0`),
  reserved: micro("reserved").notNull().default(sql`0`),
  allowedModels: jsonb("allowed_models").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  allowedProviders: jsonb("allowed_providers").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  allowedTiers: jsonb("allowed_tiers").$type<string[]>().notNull().default(sql`'["premium","standard","economy"]'::jsonb`),
  policyVersion: integer("policy_version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("spend_pass_owner_idx").on(t.userId)]).enableRLS();

export const apiKeys = pgTable("api_keys", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'["inference"]'::jsonb`),
  spendPassId: uuid("spend_pass_id").references(() => spendPasses.id),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("api_keys_hash_uq").on(t.hash), index("api_keys_user_idx").on(t.userId)]).enableRLS();

export const priceSnapshots = pgTable("price_snapshots", {
  id: id(),
  pair: text("pair").notNull().default("NEAR/USD"),
  microPerUnit: micro("micro_per_unit").notNull(),
  source: text("source").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("price_snapshots_obs_idx").on(t.observedAt)]).enableRLS();

export const depositIntents = pgTable("deposit_intents", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(), // credits | capital
  amountYocto: yocto("amount_yocto").notNull(),
  network: text("network").notNull(),
  receiverId: text("receiver_id").notNull(),
  method: text("method"),
  consumedTxHash: text("consumed_tx_hash"),
  createdAt: createdAt(),
}).enableRLS();

export const chainTransactions = pgTable("chain_transactions", {
  id: id(),
  network: text("network").notNull(),
  txHash: text("tx_hash").notNull(),
  kind: text("kind").notNull(), // deposit | receipt
  signerId: text("signer_id").notNull(),
  receiverId: text("receiver_id").notNull(),
  amountYocto: yocto("amount_yocto").notNull().default("0"),
  status: text("status").notNull(), // pending | final | failed
  blockHash: text("block_hash"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("chain_tx_uq").on(t.network, t.txHash)]).enableRLS();

export const deposits = pgTable("deposits", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  intentId: uuid("intent_id").references(() => depositIntents.id),
  chainTxId: uuid("chain_tx_id").notNull().references(() => chainTransactions.id),
  kind: text("kind").notNull(), // credits | capital
  amountYocto: yocto("amount_yocto").notNull(),
  usdMicro: micro("usd_micro").notNull(),
  priceSnapshotId: uuid("price_snapshot_id").references(() => priceSnapshots.id),
  creditedAt: timestamp("credited_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("deposits_tx_uq").on(t.chainTxId), uniqueIndex("deposits_intent_uq").on(t.intentId)]).enableRLS();

/** Append-only double-entry ledger (a trigger rejects UPDATE/DELETE). */
export const ledgerEntries = pgTable("ledger_entries", {
  id: id(),
  journalId: uuid("journal_id").notNull(),
  scope: text("scope").notNull().default("real"),
  account: text("account").notNull(),
  userId: uuid("user_id"),
  debit: micro("debit").notNull().default(sql`0`),
  credit: micro("credit").notNull().default(sql`0`),
  refType: text("ref_type").notNull(),
  refId: text("ref_id"),
  memo: text("memo"),
  createdAt: createdAt(),
}, (t) => [
  index("ledger_scope_account_idx").on(t.scope, t.account),
  index("ledger_journal_idx").on(t.journalId),
  index("ledger_created_idx").on(t.createdAt),
]).enableRLS();

/** Cached per-user credit balance, row-locked during reservation. */
export const creditBalances = pgTable("credit_balances", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  available: micro("available").notNull().default(sql`0`),
  reserved: micro("reserved").notNull().default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const usageRequests = pgTable("usage_requests", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  apiKeyId: uuid("api_key_id"),
  spendPassId: uuid("spend_pass_id").references(() => spendPasses.id),
  passPolicyVersion: integer("pass_policy_version"),
  reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }),
  providerCostSource: text("provider_cost_source"),
  providerOverage: boolean("provider_overage").notNull().default(false),
  recoveryRequired: boolean("recovery_required").notNull().default(false),
  idempotencyKey: text("idempotency_key").notNull(),
  channel: text("channel").notNull(), // workspace | api
  status: text("status").notNull(), // reserved | streaming | finalized | refunded | failed
  modelId: text("model_id"),
  provider: text("provider"),
  tier: text("tier"),
  inTokens: integer("in_tokens").notNull().default(0),
  outTokens: integer("out_tokens").notNull().default(0),
  estCost: micro("est_cost").notNull().default(sql`0`),
  cost: micro("cost").notNull().default(sql`0`),
  costIsEstimated: boolean("cost_is_estimated").notNull().default(false),
  reserved: micro("reserved").notNull().default(sql`0`),
  charge: micro("charge").notNull().default(sql`0`),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  partial: boolean("partial").notNull().default(false),
  conversationId: text("conversation_id"),
  createdAt: createdAt(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("usage_idem_uq").on(t.userId, t.idempotencyKey),
  index("usage_user_created_idx").on(t.userId, t.createdAt),
  index("usage_created_idx").on(t.createdAt),
]).enableRLS();

export const conversations = pgTable("conversations", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  messages: jsonb("messages").$type<{ role: "user" | "assistant"; content: string; usageId?: string }[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [index("conversations_user_idx").on(t.userId, t.updatedAt)]).enableRLS();

export const providerHealth = pgTable("provider_health", {
  id: id(),
  provider: text("provider").notNull(),
  ok: boolean("ok").notNull(),
  latencyMs: integer("latency_ms"),
  errorClass: text("error_class"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("provider_health_idx").on(t.provider, t.observedAt)]).enableRLS();

export const routingDecisions = pgTable("routing_decisions", {
  id: id(),
  scope: text("scope").notNull().default("real"),
  usageRequestId: uuid("usage_request_id"),
  kind: text("kind").notNull(), // route | refusal | failover
  state: text("state").notNull(),
  chosenModelId: text("chosen_model_id"),
  tier: text("tier"),
  candidates: jsonb("candidates").notNull(),
  explanation: text("explanation").notNull(),
  estCost: micro("est_cost"),
  estCharge: micro("est_charge"),
  policyVersion: integer("policy_version").notNull(),
  createdAt: createdAt(),
}, (t) => [index("routing_scope_created_idx").on(t.scope, t.createdAt)]).enableRLS();

export const economicSnapshots = pgTable("economic_snapshots", {
  id: id(),
  scope: text("scope").notNull().default("real"),
  state: text("state").notNull(),
  treasury: micro("treasury").notNull(),
  liabilities: micro("liabilities").notNull(),
  payables: micro("payables").notNull(),
  liquidity: micro("liquidity").notNull(),
  revenueWindow: micro("revenue_window").notNull(),
  expenseWindow: micro("expense_window").notNull(),
  rollingMarginBp: integer("rolling_margin_bp"),
  reserveCoverageBp: integer("reserve_coverage_bp").notNull(),
  runwaySeconds: integer("runway_seconds"),
  requestsWindow: integer("requests_window").notNull(),
  createdAt: createdAt(),
}, (t) => [index("snapshots_scope_created_idx").on(t.scope, t.createdAt)]).enableRLS();

export const policyConfigs = pgTable("policy_configs", {
  id: id(),
  version: integer("version").notNull(),
  config: jsonb("config").notNull(),
  active: boolean("active").notNull().default(false),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("policy_version_uq").on(t.version)]).enableRLS();

export const stateTransitions = pgTable("state_transitions", {
  id: id(),
  scope: text("scope").notNull().default("real"),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  trigger: text("trigger").notNull(),
  metrics: jsonb("metrics").notNull(),
  policyVersion: integer("policy_version").notNull(),
  createdAt: createdAt(),
}, (t) => [index("transitions_scope_created_idx").on(t.scope, t.createdAt)]).enableRLS();

export const economicReceipts = pgTable("economic_receipts", {
  id: id(),
  receiptId: text("receipt_id").notNull(),
  intervalStart: timestamp("interval_start", { withTimezone: true }).notNull(),
  intervalEnd: timestamp("interval_end", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull(),
  hash: text("hash").notNull(),
  status: text("status").notNull(), // pending | submitted | finalized | failed
  network: text("network").notNull(),
  txHash: text("tx_hash"),
  error: text("error"),
  createdAt: createdAt(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
}, (t) => [uniqueIndex("receipts_id_uq").on(t.receiptId)]).enableRLS();

export const auditEvents = pgTable("audit_events", {
  id: id(),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  target: text("target"),
  meta: jsonb("meta"),
  createdAt: createdAt(),
}).enableRLS();

export const simulationScenarios = pgTable("simulation_scenarios", {
  id: id(),
  userId: uuid("user_id"),
  params: jsonb("params").notNull(),
  state: jsonb("state").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: createdAt(),
}).enableRLS();

export const events = pgTable("events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  id: uuid("id").notNull().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  source: text("source").notNull(),
  scope: text("scope").notNull().default("real"),
  simulated: boolean("simulated").notNull().default(false),
  entityId: text("entity_id"),
  payload: jsonb("payload").notNull(),
  createdAt: createdAt(),
}, (t) => [index("events_scope_seq_idx").on(t.scope, t.seq)]).enableRLS();

/** Small key/value store: operating-state memory, pause flag, active model. */
export const systemState = pgTable("system_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
