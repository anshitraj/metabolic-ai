import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { base58 } from "@scure/base";
import { getDb, schema } from "@/server/db/client";
import { config } from "@/server/config";
import { isOperatorAccount } from "./settings";
import { viewAccessKey } from "@/server/near/rpc";
import { audit } from "./core";

const { users, sessions, authNonces, apiKeys } = schema;

export const SESSION_COOKIE = "metabolic_session";
export const NEP413_TAG = 2147484061; // 2^31 + 413
export const AUTH_RECIPIENT = "metabolic.ai";

export type SessionUser = { id: string; accountId: string; role: "customer" | "operator" };

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------- NEP-413

function borshString(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, true);
  out.set(b, 4);
  return out;
}

/** sha256( borsh(u32 tag) ‖ borsh({message, nonce[32], recipient, callbackUrl?}) ) per NEP-413. */
export function nep413Hash(p: { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string | null }): Uint8Array {
  if (p.nonce.length !== 32) throw new Error("nonce must be 32 bytes");
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, NEP413_TAG, true);
  const parts: Uint8Array[] = [tag, borshString(p.message), p.nonce, borshString(p.recipient)];
  if (p.callbackUrl) parts.push(Uint8Array.of(1), borshString(p.callbackUrl));
  else parts.push(Uint8Array.of(0));
  const len = parts.reduce((n, x) => n + x.length, 0);
  const buf = new Uint8Array(len);
  let o = 0;
  for (const x of parts) {
    buf.set(x, o);
    o += x.length;
  }
  return sha256(buf);
}

export function verifyNep413Signature(p: {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
  publicKey: string; // "ed25519:<base58>" (prefix optional)
  signature: string; // base64 (some wallets: base58)
}): boolean {
  const pk = decodePublicKey(p.publicKey);
  const sig = decodeSignature(p.signature);
  if (!pk || !sig) return false;
  // Wallets disagree on whether callbackUrl is part of the signed payload:
  // browser wallets (MyNearWallet) include it, injected wallets (Meteor, HOT…)
  // sign without it. Accept either — the nonce, message and recipient are
  // still bound to this server's single-use challenge.
  const variants = p.callbackUrl ? [p.callbackUrl, null] : [null];
  for (const callbackUrl of variants) {
    try {
      if (ed25519.verify(sig, nep413Hash({ ...p, callbackUrl }), pk)) return true;
    } catch {
      /* try the next variant */
    }
  }
  return false;
}

function decodePublicKey(s: string): Uint8Array | null {
  try {
    const raw = s.startsWith("ed25519:") ? s.slice(8) : s;
    if (s.includes(":") && !s.startsWith("ed25519:")) return null; // only ed25519 keys sign NEP-413 here
    const pk = base58.decode(raw);
    return pk.length === 32 ? pk : null;
  } catch {
    return null;
  }
}

function decodeSignature(s: string): Uint8Array | null {
  const raw = s.startsWith("ed25519:") ? s.slice(8) : s;
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === 64 && b.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) return new Uint8Array(b);
  } catch {
    /* not base64 */
  }
  try {
    const b = base58.decode(raw);
    if (b.length === 64) return b;
  } catch {
    /* not base58 */
  }
  return null;
}

export async function createNonce() {
  const db = await getDb();
  const nonce = randomBytes(32).toString("base64");
  const message = `Sign in to Metabolic AI (${config.near.network}). This request does not send a transaction or cost gas.`;
  await db.insert(authNonces).values({ nonce, message, expiresAt: new Date(Date.now() + 10 * 60_000) });
  return { nonce, message, recipient: AUTH_RECIPIENT, network: config.near.network };
}

export class AuthError extends Error {}

/** Verify a NEP-413 sign-in and open a session. The key must be a full-access key of the account. */
export async function verifySignIn(p: { accountId: string; publicKey: string; signature: string; nonce: string; callbackUrl?: string | null }) {
  const db = await getDb();
  const [n] = await db
    .select()
    .from(authNonces)
    .where(and(eq(authNonces.nonce, p.nonce), isNull(authNonces.usedAt), gt(authNonces.expiresAt, new Date())));
  if (!n) throw new AuthError("Sign-in request expired. Try again.");
  const ok = verifyNep413Signature({
    message: n.message,
    nonce: Buffer.from(p.nonce, "base64"),
    recipient: AUTH_RECIPIENT,
    callbackUrl: p.callbackUrl ?? null,
    publicKey: p.publicKey,
    signature: p.signature,
  });
  if (!ok) throw new AuthError("Signature did not verify. Please try again; if it keeps happening, try another wallet (MyNearWallet or Meteor).");
  const key = await viewAccessKey(p.accountId, p.publicKey);
  if (!key || key.permission !== "FullAccess") throw new AuthError("That key is not a full-access key of this account.");

  // Burn the nonce (single use).
  const used = await db.update(authNonces).set({ usedAt: new Date() }).where(and(eq(authNonces.id, n.id), isNull(authNonces.usedAt))).returning({ id: authNonces.id });
  if (!used.length) throw new AuthError("Sign-in request already used.");

  const role = (await isOperatorAccount(p.accountId)) ? "operator" : "customer";
  const [user] = await db
    .insert(users)
    .values({ nearAccountId: p.accountId, role })
    .onConflictDoUpdate({ target: users.nearAccountId, set: { lastSeenAt: new Date(), role } })
    .returning();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.session.ttlHours * 3600_000);
  await db.insert(sessions).values({ userId: user.id, tokenHash: sha256hex(token), publicKey: p.publicKey, expiresAt });
  await audit("auth.sign_in", { actorUserId: user.id, target: p.accountId });
  return { token, expiresAt, user: { id: user.id, accountId: user.nearAccountId, role: user.role as SessionUser["role"] } };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    expires: expiresAt,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: users.id, accountId: users.nearAccountId, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256hex(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  return { id: row.id, accountId: row.accountId, role: (await isOperatorAccount(row.accountId)) ? "operator" : "customer" };
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256hex(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/** CSRF defence for cookie-authenticated mutations: the Origin must be this site. */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return h.get("sec-fetch-site") === "same-origin" || h.get("sec-fetch-site") === null;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- API keys

export function newApiKeySecret() {
  const secret = `mk_${config.near.network === "mainnet" ? "live" : "test"}_${randomBytes(24).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 12), hash: sha256hex(secret) };
}

export async function userFromApiKey(authorization: string | null): Promise<(SessionUser & { apiKeyId: string }) | null> {
  const m = authorization?.match(/^Bearer\s+(mk_(?:live|test)_[A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const db = await getDb();
  const [row] = await db
    .select({ keyId: apiKeys.id, id: users.id, accountId: users.nearAccountId, role: users.role, scopes: apiKeys.scopes })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.hash, sha256hex(m[1])), isNull(apiKeys.revokedAt)));
  if (!row || !row.scopes.includes("inference")) return null;
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.keyId)).catch(() => {});
  return { id: row.id, accountId: row.accountId, role: row.role as SessionUser["role"], apiKeyId: row.keyId };
}
