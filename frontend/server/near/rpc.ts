import "server-only";
import { config } from "@/server/config";

// Minimal NEAR JSON-RPC client. Every call goes to NEAR_RPC_URL.

export class RpcError extends Error {
  constructor(message: string, readonly data?: unknown) {
    super(message);
  }
}

let rpcId = 0;
export async function rpc<T>(method: string, params: unknown, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(config.near.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `m${++rpcId}`, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new RpcError(`NEAR RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string; data?: unknown; cause?: { name?: string } } };
  if (body.error) {
    throw new RpcError(body.error.cause?.name ?? body.error.message ?? "NEAR RPC error", body.error);
  }
  return body.result as T;
}

export type AccessKeyView = { nonce: number; permission: "FullAccess" | { FunctionCall: unknown } };

export async function viewAccessKey(accountId: string, publicKey: string): Promise<AccessKeyView | null> {
  try {
    return await rpc<AccessKeyView>("query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey });
  } catch (e) {
    if (e instanceof RpcError) return null;
    throw e;
  }
}

export async function viewAccount(accountId: string): Promise<{ amount: string; locked: string; storage_usage: number } | null> {
  try {
    return await rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
  } catch (e) {
    if (e instanceof RpcError) return null;
    throw e;
  }
}

export async function viewFunction<T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  const text = Buffer.from(r.result).toString("utf8");
  return (text ? JSON.parse(text) : null) as T;
}

export type TxAction =
  | { Transfer: { deposit: string } }
  | { FunctionCall: { method_name: string; args: string; gas: number; deposit: string } }
  | Record<string, unknown>;

export type TxStatus = {
  status: { SuccessValue?: string; Failure?: unknown } | string;
  transaction: { hash: string; signer_id: string; receiver_id: string; actions: TxAction[] };
  transaction_outcome: { block_hash: string; outcome: { status: unknown } };
  receipts_outcome: { outcome: { executor_id?: string; status: { SuccessValue?: string; SuccessReceiptId?: string; Failure?: unknown } | string; logs: string[] } }[];
  final_execution_status?: string;
};

/** Transaction status with FINAL finality. Returns null if the RPC does not know the hash (yet). */
export async function txStatus(txHash: string, senderId: string): Promise<TxStatus | null> {
  try {
    return await rpc<TxStatus>("tx", { tx_hash: txHash, sender_account_id: senderId, wait_until: "FINAL" }, 30_000);
  } catch (e) {
    if (e instanceof RpcError && /UNKNOWN_TRANSACTION|TIMEOUT_ERROR|InvalidTransaction/i.test(e.message)) return null;
    throw e;
  }
}

export function txSucceeded(s: TxStatus): boolean {
  if (s.final_execution_status && s.final_execution_status !== "FINAL") return false;
  if (typeof s.status === "object" && s.status && "SuccessValue" in s.status) {
    // All receipts must also have succeeded (a function call can fail in a later receipt).
    return s.receipts_outcome.every((r) => typeof r.outcome.status === "object" && r.outcome.status !== null && ("SuccessValue" in r.outcome.status || "SuccessReceiptId" in r.outcome.status) && !("Failure" in r.outcome.status));
  }
  return false;
}
