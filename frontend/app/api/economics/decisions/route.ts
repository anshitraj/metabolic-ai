import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { json, route } from "@/server/http";

// Append-only decision log: routing choices, refusals, failovers and state transitions, merged by time.
export const GET = route(async (req, { requestId }) => {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const kind = url.searchParams.get("kind"); // route | refusal | failover | state
  const from = url.searchParams.get("from");
  const before = url.searchParams.get("before");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 60) || 60));
  const db = await getDb();

  const rd = schema.routingDecisions;
  const st = schema.stateTransitions;
  const rConds: SQL[] = [eq(rd.scope, "real")];
  const sConds: SQL[] = [eq(st.scope, "real")];
  if (state) {
    rConds.push(eq(rd.state, state));
    sConds.push(eq(st.toState, state));
  }
  if (from) {
    rConds.push(gte(rd.createdAt, new Date(from)));
    sConds.push(gte(st.createdAt, new Date(from)));
  }
  if (before) {
    rConds.push(lt(rd.createdAt, new Date(before)));
    sConds.push(lt(st.createdAt, new Date(before)));
  }
  if (kind && kind !== "state") rConds.push(eq(rd.kind, kind));

  const [routes, transitions] = await Promise.all([
    kind === "state" ? Promise.resolve([]) : db.select().from(rd).where(and(...rConds)).orderBy(desc(rd.createdAt)).limit(limit),
    kind && kind !== "state" ? Promise.resolve([]) : db.select().from(st).where(and(...sConds)).orderBy(desc(st.createdAt)).limit(limit),
  ]);

  const items = [
    ...routes.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      kind: r.kind,
      state: r.state,
      previousState: null as string | null,
      model: r.chosenModelId,
      tier: r.tier,
      explanation: r.explanation,
      estCost: r.estCost?.toString() ?? null,
      estCharge: r.estCharge?.toString() ?? null,
      candidates: r.candidates,
      usageRequestId: r.usageRequestId,
      policyVersion: r.policyVersion,
      metrics: null as unknown,
    })),
    ...transitions.map((t) => ({
      id: t.id,
      at: t.createdAt.toISOString(),
      kind: "state",
      state: t.toState,
      previousState: t.fromState,
      model: null,
      tier: null,
      explanation: t.trigger,
      estCost: null,
      estCharge: null,
      candidates: null,
      usageRequestId: null,
      policyVersion: t.policyVersion,
      metrics: t.metrics,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
  return json({ items }, { requestId });
});
