import "server-only";

// All server configuration, read from the environment. Nothing here reaches
// the browser bundle. See .env.example.

const env = (k: string) => process.env[k]?.trim() || undefined;

export const config = {
  publicUrl: env("PUBLIC_WEB_URL") ?? "http://localhost:3000",
  isProd: process.env.NODE_ENV === "production",
  near: {
    network: (env("NEAR_NETWORK") ?? "testnet") as "testnet" | "mainnet",
    rpcUrl: env("NEAR_RPC_URL") ?? "https://rpc.testnet.near.org",
    /** The metabolic contract (deposit + receipts). Optional: without it, deposits are plain transfers to the treasury account. */
    contractId: env("NEAR_CONTRACT_ID"),
    /** Account that receives plain-transfer deposits when no contract is configured. */
    treasuryAccountId: env("NEAR_TREASURY_ACCOUNT_ID") ?? env("NEAR_CONTRACT_ID"),
    /** Server-held function-call key used only to call commit_receipt. */
    receiptSignerId: env("NEAR_RECEIPT_SIGNER_ID"),
    receiptSignerKey: env("NEAR_RECEIPT_SIGNER_KEY"),
    explorerUrl: env("NEAR_EXPLORER_URL") ?? "https://testnet.nearblocks.io",
  },
  /** Accounts whose deposits fund the business (capital) and who may edit policy / pause. */
  operators: (env("OPERATOR_ACCOUNT_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  price: {
    feedUrl: env("PRICE_FEED_URL") ?? "https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd",
    maxAgeSeconds: Number(env("PRICE_MAX_AGE_S") ?? 300),
  },
  session: {
    ttlHours: Number(env("SESSION_TTL_HOURS") ?? 72),
  },
  receipts: {
    intervalMinutes: Number(env("RECEIPT_INTERVAL_MIN") ?? 10),
  },
  /**
   * NEAR Intents (1Click API): customers pay with any supported token on any
   * chain; solvers settle it as USDC on NEAR into `recipient`. NEAR Intents has
   * no testnet, so this is always mainnet and moves real funds. Disabled until
   * INTENTS_RECIPIENT_ACCOUNT_ID is set.
   */
  intents: {
    baseUrl: env("ONECLICK_BASE_URL") ?? "https://1click.chaindefuser.com",
    /** Partner JWT from partners.near-intents.org. Optional: without it 1Click adds a 0.25% fee. */
    apiKey: env("ONECLICK_JWT"),
    recipient: env("INTENTS_RECIPIENT_ACCOUNT_ID"),
    slippageBp: Number(env("INTENTS_SLIPPAGE_BP") ?? 100),
    minUsdMicro: BigInt(env("INTENTS_MIN_USD_MICRO") ?? "1000000"),
    maxUsdMicro: BigInt(env("INTENTS_MAX_USD_MICRO") ?? "500000000"),
    /** Minutes before an unpaid quote refunds. */
    deadlineMinutes: Number(env("INTENTS_DEADLINE_MIN") ?? 60),
  },
  /** Fixed hourly overhead (hosting etc.) that counts toward burn, in micro-USD. */
  overheadPerHourMicro: BigInt(env("OVERHEAD_PER_HOUR_MICRO") ?? "0"),
};

export function explorerTxUrl(hash: string) {
  return `${config.near.explorerUrl.replace(/\/$/, "")}/txns/${hash}`;
}
export function explorerAccountUrl(id: string) {
  return `${config.near.explorerUrl.replace(/\/$/, "")}/address/${id}`;
}
export function isOperator(accountId: string | null | undefined) {
  return !!accountId && config.operators.includes(accountId);
}
