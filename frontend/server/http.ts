import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { getSessionUser, sameOrigin, userFromApiKey, type SessionUser } from "@/server/services/auth";

// Shared HTTP helpers for route handlers: consistent errors, validation,
// request ids, auth and a simple per-key rate limiter.

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

/** JSON with bigint → string. */
export function json(data: unknown, init: ResponseInit & { requestId?: string } = {}) {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const h = new Headers(init.headers);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  if (init.requestId) h.set("x-request-id", init.requestId);
  return new Response(body, { ...init, headers: h });
}

export function errorResponse(err: unknown, requestId: string) {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, request_id: requestId, ...err.extra } }, { status: err.status, requestId });
  }
  if (err instanceof z.ZodError) {
    return json(
      { error: { code: "INVALID_INPUT", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), request_id: requestId } },
      { status: 400, requestId },
    );
  }
  console.error(`[${requestId}]`, err);
  return json({ error: { code: "INTERNAL", message: "Something went wrong on our side.", request_id: requestId } }, { status: 500, requestId });
}

type Handler<C> = (req: Request, ctx: C & { requestId: string }) => Promise<Response>;

/** Wrap a route handler with request id + error mapping. */
export function route<C = unknown>(fn: Handler<C>) {
  return async (req: Request, ctx: C) => {
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
    try {
      const res = await fn(req, { ...(ctx as C), requestId });
      if (!res.headers.has("x-request-id")) res.headers.set("x-request-id", requestId);
      return res;
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

const MAX_BODY = 256 * 1024;

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body too large.");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body too large.");
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Body is not valid JSON.");
  }
  return schema.parse(parsed);
}

export async function requireUser(opts: { mutation?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Connect a NEAR wallet and sign in first.");
  if (opts.mutation && !(await sameOrigin())) throw new HttpError(403, "CSRF", "Cross-site request rejected.");
  return user;
}

export async function requireOperator(): Promise<SessionUser> {
  const user = await requireUser({ mutation: true });
  if (user.role !== "operator") throw new HttpError(403, "FORBIDDEN", "Operator access required.");
  return user;
}

export async function requireApiKey(req: Request) {
  const u = await userFromApiKey(req.headers.get("authorization"));
  if (!u) throw new HttpError(401, "INVALID_API_KEY", "Missing or invalid API key. Use `Authorization: Bearer mk_test_…`.");
  return u;
}

// ---------------------------------------------------------------- rate limiting
// Token bucket per key, in-process. A multi-instance deployment should move this to Postgres or Redis.

type BucketState = { tokens: number; at: number };
const g = globalThis as unknown as { __metabolicRate?: Map<string, BucketState> };
const buckets: Map<string, BucketState> = g.__metabolicRate ?? (g.__metabolicRate = new Map());

export function rateLimit(key: string, perMinute: number) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    throw new HttpError(429, "RATE_LIMITED", "Too many requests. Slow down a little.", { retry_after_s: Math.ceil(((1 - b.tokens) * 60) / perMinute) });
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.at > 600_000) buckets.delete(k);
  }
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}
