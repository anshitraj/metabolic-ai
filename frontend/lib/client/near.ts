"use client";

import type { WalletSelector } from "@near-wallet-selector/core";
import { Buffer } from "buffer";
import { api } from "./api";

// Wallet modules use Node's Buffer in the browser.
const gb = globalThis as unknown as { Buffer?: typeof Buffer };
if (typeof window !== "undefined" && !gb.Buffer) gb.Buffer = Buffer;

// NEAR wallet integration (wallet selector, loaded lazily). Sign-in uses a
// NEP-413 signed message verified by the server; deposits are signed by the
// user's wallet and independently verified on chain by the server.

let selectorPromise: Promise<WalletSelector> | null = null;
let modalPromise: Promise<{ show: () => void; hide: () => void }> | null = null;

export function getSelector(network: string): Promise<WalletSelector> {
  if (!selectorPromise) {
    selectorPromise = (async () => {
      const { setupWalletSelector } = await import("@near-wallet-selector/core");
      const { setupMyNearWallet } = await import("@near-wallet-selector/my-near-wallet");
      const { setupMeteorWallet } = await import("@near-wallet-selector/meteor-wallet");
      return setupWalletSelector({
        network: network === "mainnet" ? "mainnet" : "testnet",
        modules: [setupMyNearWallet(), setupMeteorWallet()],
      });
    })();
  }
  return selectorPromise;
}

export async function showWalletModal(network: string, contractId?: string | null) {
  const selector = await getSelector(network);
  if (!modalPromise) {
    modalPromise = (async () => {
      const { setupModal } = await import("@near-wallet-selector/modal-ui");
      // Modal styles ship as CSS in the package; load once.
      await import("@near-wallet-selector/modal-ui/styles.css");
      return setupModal(selector, { contractId: contractId ?? "", theme: "light" });
    })();
  }
  (await modalPromise).show();
}

type NonceResponse = { nonce: string; message: string; recipient: string; network: string };

const PENDING_KEY = "metabolic:pending-signin";

/** Ask the connected wallet to sign the server's NEP-413 challenge, then open a session. */
export async function signInWithWallet(network: string): Promise<{ accountId: string }> {
  const selector = await getSelector(network);
  if (!selector.isSignedIn()) throw new Error("Connect a wallet first.");
  const wallet = await selector.wallet();
  if (!wallet.signMessage) throw new Error("This wallet can't sign messages. Try MyNearWallet or Meteor.");
  const n = await api<NonceResponse>("/api/auth/nonce", { method: "POST" });
  const callbackUrl = `${window.location.origin}/login`;
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ nonce: n.nonce, callbackUrl }));
  } catch {
    /* storage unavailable */
  }
  const signed = await wallet.signMessage({
    message: n.message,
    recipient: n.recipient,
    nonce: Buffer.from(n.nonce, "base64"),
    callbackUrl,
  });
  // Browser wallets may redirect instead of returning; /login completes that path.
  if (!signed) throw new Error("Waiting for the wallet to return…");
  await api("/api/auth/verify", {
    method: "POST",
    json: { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: n.nonce, callbackUrl },
  });
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  return { accountId: signed.accountId };
}

/** Complete a redirect-based NEP-413 sign-in (MyNearWallet returns via URL hash). */
export async function completeRedirectSignIn(): Promise<{ accountId: string } | null> {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const accountId = hash.get("accountId");
  const signature = hash.get("signature");
  const publicKey = hash.get("publicKey");
  if (!accountId || !signature || !publicKey) return null;
  let pending: { nonce: string; callbackUrl: string } | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
  } catch {
    /* ignore */
  }
  if (!pending) throw new Error("Sign-in session expired. Try again.");
  await api("/api/auth/verify", { method: "POST", json: { accountId, publicKey, signature, nonce: pending.nonce, callbackUrl: pending.callbackUrl } });
  sessionStorage.removeItem(PENDING_KEY);
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return { accountId };
}

export type DepositIntent = {
  intentId: string;
  kind: "credits" | "capital";
  network: string;
  receiverId: string;
  method: "deposit" | "transfer";
  amountYocto: string;
  gas: string;
  estimateUsd: string | null;
};

/** Sign and send the deposit with the user's wallet. Returns the transaction hash. */
export async function sendDeposit(network: string, intent: DepositIntent): Promise<string> {
  if (network !== intent.network) throw new Error("The wallet network does not match the deposit intent.");
  sessionStorage.setItem("metabolic:deposit-intent", intent.intentId);
  const selector = await getSelector(network);
  const wallet = await selector.wallet();
  const { actionCreators } = await import("@near-js/transactions");
  const action =
    intent.method === "deposit"
      ? actionCreators.functionCall("deposit", { memo: intent.intentId }, BigInt(intent.gas), BigInt(intent.amountYocto))
      : actionCreators.transfer(BigInt(intent.amountYocto));
  const outcome = await wallet.signAndSendTransaction({ receiverId: intent.receiverId, actions: [action] });
  const hash = (outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } } | undefined)?.transaction?.hash
    ?? (outcome as { transaction_outcome?: { id?: string } } | undefined)?.transaction_outcome?.id;
  if (!hash) throw new Error("The wallet did not return a transaction hash. If you were redirected, paste the hash from your wallet below.");
  return hash;
}

/** Transaction hashes returned on redirect (MyNearWallet appends ?transactionHashes=). */
export function takeRedirectTxHash(): string | null {
  const p = new URLSearchParams(window.location.search);
  const h = p.get("transactionHashes")?.split(",").pop() ?? null;
  if (h) {
    p.delete("transactionHashes");
    const q = p.toString();
    history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
  }
  return h;
}
