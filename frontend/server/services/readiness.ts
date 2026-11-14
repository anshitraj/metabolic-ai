import "server-only";
import { sql } from "drizzle-orm";
import { KeyPair } from "@near-js/crypto";
import { config } from "@/server/config";
import { getDb } from "@/server/db/client";
import { enabledModels } from "@/server/economics/registry";
import { rpc, viewAccessKey, viewAccount, viewFunction } from "@/server/near/rpc";

export async function deploymentReadiness() {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  try { await (await getDb()).execute(sql`select 1`); check("database", true, process.env.DATABASE_URL ? "PostgreSQL connection and migrations succeeded." : "Embedded database is available. Production requires a persistent volume or PostgreSQL."); }
  catch { check("database", false, "Database connection or migrations failed."); }
  check("provider", enabledModels().length > 0, `${enabledModels().length} priced models configured. This is configuration readiness; use an operator model test to verify generation.`);
  check("operators", config.operators.length > 0, config.operators.length ? `${config.operators.length} server-configured operator account(s).` : "Set OPERATOR_ACCOUNT_IDS before a public deployment.");
  try {
    const status = await rpc<{ chain_id: string }>("status", []);
    check("network", status.chain_id === config.near.network, `RPC reports ${status.chain_id}; configured ${config.near.network}.`);
  } catch { check("network", false, "Could not verify the RPC network."); }
  if (config.near.contractId) {
    try {
      const account = await viewAccount(config.near.contractId);
      const [owner, signers, paused] = await Promise.all([viewFunction<string>(config.near.contractId, "owner", {}), viewFunction<string[]>(config.near.contractId, "signers", {}), viewFunction<boolean>(config.near.contractId, "is_paused", {})]);
      check("contract", !!account && !paused, `${config.near.contractId}; owner ${owner}; ${paused ? "paused" : "unpaused"}.`);
      check("receipt-signer", !!config.near.receiptSignerId && signers.includes(config.near.receiptSignerId), "The runtime receipt signer must be authorized by the contract.");
      if (config.near.receiptSignerKey && config.near.receiptSignerId) {
        const publicKey = KeyPair.fromString(config.near.receiptSignerKey as `ed25519:${string}`).getPublicKey().toString();
        const key = await viewAccessKey(config.near.receiptSignerId, publicKey);
        const permission = key?.permission !== "FullAccess" ? key?.permission.FunctionCall as { receiver_id?: string; method_names?: string[]; allowance?: string | null } | undefined : undefined;
        check("receipt-key-scope", !!permission && permission.receiver_id === config.near.contractId && permission.method_names?.length === 1 && permission.method_names[0] === "commit_receipt" && !!permission.allowance && BigInt(permission.allowance) > 0n, "Receipt key must have a finite positive allowance and only commit_receipt access to this contract. Full-access server keys are rejected.");
      } else check("receipt-key-scope", false, "Set NEAR_RECEIPT_SIGNER_ID and NEAR_RECEIPT_SIGNER_KEY in runtime secrets.");
    } catch { check("contract", false, "Contract methods or signer permissions could not be verified. Check the contract and network configuration."); }
  } else check("contract", false, "NEAR_CONTRACT_ID is not set.");
  if (config.isProd) {
    check("production-database", !!process.env.DATABASE_URL, "Use managed PostgreSQL for this production deployment.");
    check("public-origin", /^https:\/\//.test(config.publicUrl) && !/localhost|127\.0\.0\.1/.test(config.publicUrl), "PUBLIC_WEB_URL must be the public HTTPS origin.");
  }
  return { ready: checks.every((c) => c.ok), network: config.near.network, checks, observedAt: new Date().toISOString() };
}
