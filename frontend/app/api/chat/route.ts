import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { runInference, type InferenceEvent } from "@/server/services/inference";
import { body, HttpError, rateLimit, requireUser, route } from "@/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  conversationId: z.string().uuid().nullish(),
  message: z.string().min(1).max(20_000),
  idempotencyKey: z.string().min(8).max(80).optional(),
});

// Workspace chat. Streams newline-delimited JSON InferenceEvents.
export const POST = route(async (req) => {
  const user = await requireUser({ mutation: true });
  rateLimit(`chat:${user.id}`, 30);
  const b = await body(req, Body);
  const db = await getDb();

  let conversation: typeof schema.conversations.$inferSelect | undefined;
  if (b.conversationId) {
    [conversation] = await db
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.id, b.conversationId), eq(schema.conversations.userId, user.id)));
    if (!conversation) throw new HttpError(404, "NOT_FOUND", "Conversation not found.");
  }
  const history = (conversation?.messages ?? []).slice(-20).map((m) => ({ role: m.role, content: m.content }));
  const messages = [...history, { role: "user" as const, content: b.message }];

  const enc = new TextEncoder();
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* client gone */
        }
      };
      let text = "";
      let final: Extract<InferenceEvent, { type: "final" }> | null = null;
      let convId = conversation?.id ?? null;
      try {
        if (!convId) {
          const [c] = await db
            .insert(schema.conversations)
            .values({ userId: user.id, title: b.message.slice(0, 60), messages: [] })
            .returning({ id: schema.conversations.id });
          convId = c.id;
        }
        push({ type: "conversation", id: convId });
        for await (const ev of runInference({
          userId: user.id,
          channel: "workspace",
          idempotencyKey: b.idempotencyKey ?? randomUUID(),
          messages,
          conversationId: convId,
          signal: ac.signal,
        })) {
          if (ev.type === "text") text += ev.text;
          if (ev.type === "final") final = ev;
          push(ev);
        }
      } catch (err) {
        console.error(err);
        push({ type: "error", code: "INTERNAL", message: "Something went wrong while answering." });
      } finally {
        if (convId && text) {
          const [c] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, convId));
          const msgs = [...(c?.messages ?? []), { role: "user" as const, content: b.message }, { role: "assistant" as const, content: text, usageId: final?.usageId }];
          await db.update(schema.conversations).set({ messages: msgs, updatedAt: new Date() }).where(eq(schema.conversations.id, convId));
        }
        try {
          controller.close();
        } catch {
          /* closed */
        }
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});
