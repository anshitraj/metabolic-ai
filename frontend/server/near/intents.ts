import "server-only";
import { config } from "@/server/config";

// Thin client for the NEAR Intents 1Click Swap API (mainnet only; there is no
// testnet). Docs: https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api
// OpenAPI: https://1click.chaindefuser.com/docs/v0/openapi.yaml

/** USDC on NEAR (native, Circle). Settled payments land here; 6 decimals = micro-USD. */
export const USDC_ON_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export type OneClickToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number | string;
  priceUpdatedAt?: string;
  contractAddress?: string;
};

export type OneClickQuoteRequest = {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
  referral?: string;
};

export type OneClickQuote = {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeEstimate: number;
};

export type OneClickQuoteResponse = {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: OneClickQuoteRequest;
  quote: OneClickQuote;
};

export const TERMINAL_STATUSES = ["SUCCESS", "REFUNDED", "FAILED"] as const;
export type OneClickStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export type OneClickStatusResponse = {
  correlationId: string;
  quoteResponse: OneClickQuoteResponse;
  status: OneClickStatus;
  updatedAt: string;
  swapDetails: {
    intentHashes: string[];
    nearTxHashes: string[];
    originChainTxHashes: { hash: string; explorerUrl: string }[];
    destinationChainTxHashes: { hash: string; explorerUrl: string }[];
    amountIn?: string;
    amountInUsd?: string;
    amountOut?: string;
    amountOutUsd?: string;
    refundedAmount?: string;
    refundReason?: string;
  };
};

export class OneClickError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body) headers["content-type"] = "application/json";
  if (config.intents.apiKey) headers["x-api-key"] = config.intents.apiKey;
  const res = await fetch(`${config.intents.baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : `1Click API returned ${res.status}`;
    throw new OneClickError(res.status, msg);
  }
  return data as T;
}

export const oneClick = {
  tokens: () => call<OneClickToken[]>("/v0/tokens"),
  quote: (req: OneClickQuoteRequest) => call<OneClickQuoteResponse>("/v0/quote", { method: "POST", body: JSON.stringify(req) }, 30_000),
  status: (depositAddress: string, depositMemo?: string | null) => {
    const q = new URLSearchParams({ depositAddress });
    if (depositMemo) q.set("depositMemo", depositMemo);
    return call<OneClickStatusResponse>(`/v0/status?${q}`);
  },
  submitDeposit: (body: { txHash: string; depositAddress: string; memo?: string }) =>
    call<OneClickStatusResponse>("/v0/deposit/submit", { method: "POST", body: JSON.stringify(body) }),
};

/** "4.993784369082" → 4_993_784n micro-USD (truncated, never rounded up). Null for anything else. */
export function usdToMicro(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(frac.slice(0, 6).padEnd(6, "0"));
}

/**
 * Micro-USD for an amount of the destination asset. USDC on NEAR has 6
 * decimals, so its smallest unit is exactly one micro-USD; anything else falls
 * back to 1Click's USD estimate.
 */
export function destinationMicro(destinationAsset: string, amountOut: string | undefined, amountOutUsd: string | undefined): bigint | null {
  if (destinationAsset === USDC_ON_NEAR && amountOut && /^\d+$/.test(amountOut)) return BigInt(amountOut);
  return usdToMicro(amountOutUsd);
}

/** Credit what actually settled, but never more than the customer was quoted. */
export function creditableMicro(quoted: bigint, settled: bigint | null): bigint {
  if (settled === null) return 0n;
  return settled < quoted ? settled : quoted;
}

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}
