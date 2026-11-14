import { eventsSince, recentEvents, subscribe } from "@/server/services/core";
import type { MetabolicEvent } from "@/lib/economics/types";

export const dynamic = "force-dynamic";

// Server-Sent Events. `scope` is "real" or "sim:<uuid>". Supports Last-Event-ID
// (or ?after=) replay; the client always re-syncs numbers from a snapshot, so a
// missed event only means a missed animation.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "real";
  if (scope !== "real" && !/^sim:[0-9a-f-]{36}$/.test(scope)) {
    return new Response("bad scope", { status: 400 });
  }
  const after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? NaN);
  const enc = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: MetabolicEvent) => {
        try {
          controller.enqueue(enc.encode(`id: ${ev.seq}\nevent: metabolic\ndata: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* closed */
        }
      };
      controller.enqueue(enc.encode(`retry: 3000\n: connected\n\n`));
      let lastSeq = 0;
      const backlog = Number.isFinite(after) ? await eventsSince(scope, after) : (await recentEvents(scope, 1)).reverse();
      for (const ev of backlog) {
        if (Number.isFinite(after)) send(ev);
        lastSeq = Math.max(lastSeq, ev.seq);
      }
      unsubscribe = subscribe((ev) => {
        if (ev.scope !== scope || ev.seq <= lastSeq) return;
        lastSeq = ev.seq;
        send(ev);
      });
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          /* closed */
        }
      }, 20_000);
      req.signal.addEventListener("abort", () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
