import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { config } from "@/server/config";
import { viewAccount } from "@/server/near/rpc";
import { audit, getSystem, setSystem } from "./core";

// Instance settings that can be completed in the app instead of in env files:
// who operates the business and which NEAR account receives deposits.
// Environment variables always win when set.

export type InstanceSettings = { operators: string[]; treasuryAccountId: string | null; claimedAt?: string };

let cache: { v: InstanceSettings; at: number } | null = null;

export async function getSettings(): Promise<InstanceSettings> {
  if (cache && Date.now() - cache.at < 5_000) return cache.v;
  const stored = (await getSystem<InstanceSettings>("instance:settings")) ?? { operators: [], treasuryAccountId: null };
  cache = { v: stored, at: Date.now() };
  return stored;
}

export async function operatorAccounts(): Promise<string[]> {
  const s = await getSettings();
  return Array.from(new Set([...config.operators, ...s.operators]));
}

export async function isOperatorAccount(accountId: string | null | undefined): Promise<boolean> {
  if (!accountId) return false;
  return (await operatorAccounts()).includes(accountId);
}

export type DepositTarget = { receiverId: string; method: "deposit" | "transfer"; source: "env" | "app" };

/** Where deposits go: the contract (env), a treasury account (env), or the one chosen during in-app setup. */
export async function resolveDepositTarget(): Promise<DepositTarget | null> {
  if (config.near.contractId) return { receiverId: config.near.contractId, method: "deposit", source: "env" };
  if (config.near.treasuryAccountId) return { receiverId: config.near.treasuryAccountId, method: "transfer", source: "env" };
  const s = await getSettings();
  if (s.treasuryAccountId) return { receiverId: s.treasuryAccountId, method: "transfer", source: "app" };
  return null;
}

export class SetupError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

async function assertAccountExists(accountId: string) {
  if (accountId.length < 2 || accountId.length > 64 || !ACCOUNT_RE.test(accountId)) throw new SetupError("BAD_ACCOUNT", "That is not a valid NEAR account id.");
  const acct = await viewAccount(accountId);
  if (!acct) throw new SetupError("ACCOUNT_NOT_FOUND", `${accountId} does not exist on NEAR ${config.near.network}.`);
}

export async function setupStatus(accountId: string | null) {
  const [ops, target] = await Promise.all([operatorAccounts(), resolveDepositTarget()]);
  return {
    hasOperator: ops.length > 0,
    /** The first signed-in user may claim the operator role while nobody holds it. */
    canClaim: ops.length === 0 && !!accountId,
    isOperator: !!accountId && ops.includes(accountId),
    treasury: target,
    treasuryEditable: !config.near.contractId && !config.near.treasuryAccountId,
    network: config.near.network,
  };
}

/**
 * First-run claim: while the instance has no operator, the signed-in user
 * becomes operator and chooses the treasury account. Serialised so two people
 * can't both win.
 */
export async function claimOperator(user: { id: string; accountId: string }, treasuryAccountId: string) {
  await assertAccountExists(treasuryAccountId);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`insert into system_state (key, value) values ('instance:settings', '{"operators":[],"treasuryAccountId":null}'::jsonb) on conflict (key) do nothing`);
    await tx.execute(sql`select 1 from system_state where key = 'instance:settings' for update`);
    const cur = (await getSystem<InstanceSettings>("instance:settings", tx)) ?? { operators: [], treasuryAccountId: null };
    if (config.operators.length > 0 || cur.operators.length > 0) throw new SetupError("ALREADY_CLAIMED", "This instance already has an operator.");
    const envTreasury = !!config.near.contractId || !!config.near.treasuryAccountId;
    await setSystem("instance:settings", { operators: [user.accountId], treasuryAccountId: envTreasury ? cur.treasuryAccountId : treasuryAccountId, claimedAt: new Date().toISOString() }, tx);
  });
  cache = null;
  await audit("setup.claim_operator", { actorUserId: user.id, target: user.accountId, meta: { treasuryAccountId } });
  return setupStatus(user.accountId);
}

/** Operator changes the treasury account. Only before any deposit is recorded, so the books stay reconcilable. */
export async function setTreasuryAccount(user: { id: string; accountId: string }, treasuryAccountId: string) {
  if (config.near.contractId || config.near.treasuryAccountId) throw new SetupError("ENV_MANAGED", "The treasury account is set by the server environment.");
  await assertAccountExists(treasuryAccountId);
  const db = await getDb();
  const rows = (await db.execute(sql`select count(*)::int as n from deposits`)) as unknown as { rows?: { n: number }[] } | { n: number }[];
  const n = Array.isArray(rows) ? rows[0]?.n : rows.rows?.[0]?.n;
  if ((n ?? 0) > 0) throw new SetupError("HAS_DEPOSITS", "Deposits were already recorded to the current treasury account, so it can't be changed here.");
  const cur = (await getSystem<InstanceSettings>("instance:settings")) ?? { operators: [], treasuryAccountId: null };
  await setSystem("instance:settings", { ...cur, treasuryAccountId });
  cache = null;
  await audit("setup.set_treasury", { actorUserId: user.id, target: treasuryAccountId });
  return setupStatus(user.accountId);
}

export function invalidateSettingsCache() {
  cache = null;
}
