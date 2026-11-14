"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { OperatingState, OverviewDTO } from "@/lib/economics/types";
import { useLive, STATE_META } from "@/lib/client/live";
import { useApi } from "@/lib/client/use-api";
import { big, formatBp, formatCoverage, formatRunway, formatUsd } from "@/lib/economics/money";
import { OrganismStage, type OrganismSelect } from "@/components/organism/stage";
import { LineChart, SERIES, StateTimeline } from "@/components/m/charts";
import { DecisionDetail, DecisionFeed, type DecisionItem } from "@/components/m/decisions";
import { ReceiptCard, type ReceiptDTO } from "@/components/m/receipt";
import { Hint, StateGuide } from "@/components/m/guide";
import { Journey } from "@/components/m/journey";
import { AnimatedMoney, Card, Dialog, Empty, ErrorNote, Label, PageHeader, Skeleton, StateChip, TierBadge, TimeAgo, cx, ButtonLink } from "@/components/m/ui";

type Metrics = {
  bucket: string;
  series: { t: string; revenue: string; expense: string; liquidity: string }[];
  transitions: { at: string; from: string; to: string; trigger: string }[];
  modelSwitches: { at: string; model: string | null; tier: string | null; explanation: string }[];
};

export default function OverviewPage() {
  const overview = useLive((s) => s.overview);
  const error = useLive((s) => s.overviewError);
  const events = useLive((s) => s.events);
  const lastSnap = useLive((s) => s.lastSnapshotAt);
  const metrics = useApi<Metrics>("/api/dashboard/metrics?hours=24", { intervalMs: 30_000, deps: [overview?.revenueTotal, overview?.state] });
  const decisions = useApi<{ items: DecisionItem[] }>("/api/economics/decisions?limit=8", { deps: [events[0]?.id] });
  const receipts = useApi<{ configured: boolean; reason: string | null; receipts: ReceiptDTO[] }>("/api/receipts", { deps: [events.find((e) => e.type.startsWith("receipt"))?.id] });
  const [drawer, setDrawer] = useState<OrganismSelect | { kind: "decision"; d: DecisionItem } | null>(null);

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Your AI business at a glance. Follow its funds, model choices and every decision."
        actions={
          overview && (
            <span className="text-[12.5px] text-muted">
              <StateChip state={overview.state} /> <span className="ml-1">since <TimeAgo iso={overview.stateSince} /> · policy v{overview.policyVersion}</span>
            </span>
          )
        }
      />
      <Journey overview={overview} />
      <div className="mb-4"><StateGuide state={overview?.state} /></div>
      {error && !overview && <ErrorNote message={error} />}

      <MetricRow o={overview} />

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <OrganismStage overview={overview} className="min-h-[350px] sm:min-h-[540px] xl:col-span-8" onSelect={setDrawer} />
        <IntelligencePanel o={overview} lastSnap={lastSnap} className="xl:col-span-4" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">Operating liquidity · 24h</h2>
            <span className="text-[12px] text-muted">treasury − customer credits − payables</span>
          </div>
          {metrics.loading ? (
            <Skeleton className="h-[220px]" />
          ) : (
            <LineChart
              ariaLabel="Operating liquidity over the last 24 hours"
              series={[{ key: "liq", label: "Liquidity", color: SERIES.liquidity, area: true, points: (metrics.data?.series ?? []).map((p) => ({ t: Date.parse(p.t), v: Number(p.liquidity) })) }]}
              refLine={overview ? { value: Number(overview.hardReserve), label: `hard reserve ${formatUsd(big(overview.hardReserve))}`, color: "#a8232f" } : undefined}
              emptyText="No ledger activity in the last 24 hours."
            />
          )}
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">Revenue vs compute · 24h</h2>
            <span className="text-[12px] text-muted">per {metrics.data?.bucket ?? "hour"}</span>
          </div>
          {metrics.loading ? (
            <Skeleton className="h-[220px]" />
          ) : (
            <LineChart
              ariaLabel="Revenue and compute cost per hour"
              series={[
                { key: "rev", label: "Revenue", color: SERIES.revenue, points: (metrics.data?.series ?? []).map((p) => ({ t: Date.parse(p.t), v: Number(p.revenue) })) },
                { key: "cost", label: "Compute", color: SERIES.cost, dashed: true, points: (metrics.data?.series ?? []).map((p) => ({ t: Date.parse(p.t), v: Number(p.expense) })) },
              ]}
              emptyText="No requests served in the last 24 hours."
            />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Card className="p-4 sm:p-5 lg:col-span-5">
          <h2 className="mb-3 text-[15px] font-semibold">State &amp; model timeline · 24h</h2>
          {metrics.data && overview ? (
            <Timeline m={metrics.data} current={overview.state} onPick={(s) => setDrawer({ kind: "decision", d: { id: s.label, at: new Date(s.at).toISOString(), kind: "route", state: overview.state, previousState: null, model: null, tier: null, explanation: s.detail ?? s.label, estCost: null, estCharge: null, candidates: null, usageRequestId: null, policyVersion: overview.policyVersion, metrics: null } })} />
          ) : (
            <Skeleton className="h-16" />
          )}
        </Card>
        <Card className="p-4 sm:p-5 lg:col-span-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Decision feed</h2>
            <Link href="/console/decisions" className="text-[12.5px] font-semibold text-g-700 hover:underline">All decisions →</Link>
          </div>
          {decisions.data?.items.length ? (
            <DecisionFeed compact items={decisions.data.items} onOpen={(d) => setDrawer({ kind: "decision", d })} />
          ) : decisions.loading ? (
            <Skeleton className="h-40" />
          ) : (
            <p className="py-4 text-[13px] text-muted">No decisions yet. The first request or state change will appear here.</p>
          )}
        </Card>
        <Card className="p-4 sm:p-5 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Recent receipts</h2>
            <Link href="/console/receipts" className="text-[12.5px] font-semibold text-g-700 hover:underline">All →</Link>
          </div>
          {receipts.data?.receipts.length ? (
            <div className="space-y-2">
              {receipts.data.receipts.slice(0, 3).map((r) => (
                <ReceiptCard key={r.id} r={r} compact />
              ))}
            </div>
          ) : receipts.loading ? (
            <Skeleton className="h-24" />
          ) : (
            <p className="text-[13px] text-muted">{receipts.data?.configured ? "No receipts committed yet." : `On-chain receipts are not configured (${receipts.data?.reason ?? "contract missing"}).`}</p>
          )}
        </Card>
      </div>

      <Dialog open={!!drawer} onClose={() => setDrawer(null)} title={drawer?.kind === "model" ? "Active model" : drawer?.kind === "treasury" ? "Treasury" : drawer?.kind === "event" ? "Economic event" : "Decision"} wide={drawer?.kind === "decision"}>
        {drawer?.kind === "model" && <ModelDrawer o={overview} />}
        {drawer?.kind === "treasury" && <TreasuryDrawer o={overview} />}
        {drawer?.kind === "event" && (
          <div className="space-y-2 text-[13.5px]">
            <div className="font-mono text-[12px] text-muted">{drawer.event.type} · {new Date(drawer.event.ts).toLocaleString()}</div>
            <pre className="overflow-x-auto rounded-lg bg-paper-sunken p-3 font-mono text-[12px]">{JSON.stringify(drawer.event.payload, null, 2)}</pre>
          </div>
        )}
        {drawer?.kind === "decision" && <DecisionDetail d={drawer.d} />}
      </Dialog>
    </div>
  );
}

function MetricRow({ o }: { o: OverviewDTO | null }) {
  type Term = Parameters<typeof Hint>[0]["term"];
  const HINT: Record<string, Term> = { Treasury: "treasury", "Revenue · 1h": "revenue", "Inference spend · 1h": "spend", "Gross margin": "margin", Runway: "runway", State: "state" };
  const cells: { k: string; v: React.ReactNode; d?: React.ReactNode }[] = o
    ? [
        { k: "Treasury", v: <AnimatedMoney micro={o.treasury} />, d: o.rate ? `${(Number(big(o.treasuryNear) / 10n ** 20n) / 10_000).toFixed(2)} NEAR deposited` : "historical USD cost" },
        { k: "Revenue · 1h", v: <AnimatedMoney micro={o.revenueWindow} />, d: <>total {formatUsd(big(o.revenueTotal))}</> },
        { k: "Inference spend · 1h", v: <AnimatedMoney micro={o.expenseWindow} />, d: big(o.expenseEstimatedTotal) > 0n ? <>incl. {formatUsd(big(o.expenseEstimatedTotal))} est.</> : <>total {formatUsd(big(o.expenseTotal))}</> },
        { k: "Gross margin", v: <span className="m-num">{formatBp(o.rollingMarginBp)}</span>, d: o.rollingMarginBp === null ? "no revenue in window" : "rolling 60 min" },
        { k: "Runway", v: <span className="m-num">{formatRunway(o.runwaySeconds)}</span>, d: <>spendable {formatUsd(big(o.spendable))}</> },
        { k: "State", v: <StateChip state={o.state} />, d: <>{formatCoverage(o.reserveCoverageBp)} reserve</> },
      ]
    : Array.from({ length: 6 }, (_, i) => ({ k: ["Treasury", "Revenue · 1h", "Inference spend · 1h", "Gross margin", "Runway", "State"][i], v: <Skeleton className="h-7 w-24" /> }));
  return (
    <div className="m-metric-grid grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {cells.map((c, i) => (
        <Card key={c.k} className={cx("m-metric p-4", i === 0 && "m-metric-primary")}>
          <Label className="flex items-center gap-1.5 text-[10.5px]">{c.k} {HINT[c.k] && <Hint term={HINT[c.k]} />}</Label>
          <div className="m-metric-value mt-3 text-ink">{c.v}</div>
          {c.d && <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted">{c.d}</div>}
        </Card>
      ))}
    </div>
  );
}

function IntelligencePanel({ o, lastSnap, className }: { o: OverviewDTO | null; lastSnap: number | null; className?: string }) {
  const lastEvent = useLive((s) => s.events.find((e) => e.type !== "snapshot.updated"));
  if (!o) return <Card className={cx("p-5", className)}><Skeleton className="h-full min-h-[300px]" /></Card>;
  const meta = STATE_META[o.state];
  return (
    <Card className={cx("flex flex-col p-5", className)}>
      <Label>Intelligence</Label>
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13.5px] [&>dd]:min-w-0 [&>dd]:break-words">
        <dt className="text-muted">Active model</dt>
        <dd className="text-right">{o.activeModel ? <span className="font-mono text-[12.5px]">{o.activeModel.label}</span> : <span className="text-muted">none yet</span>}</dd>
        <dt className="text-muted">Tier</dt>
        <dd className="text-right">{o.activeModel ? <TierBadge tier={o.activeModel.tier} /> : "—"}</dd>
        <dt className="text-muted">Operating state</dt>
        <dd className="text-right"><StateChip state={o.state} /></dd>
        <dt className="text-muted">Allowed tiers</dt>
        <dd className="text-right font-mono text-[12px]">{(Object.entries(o.permissions.tiers) as [string, boolean][]).filter(([, v]) => v).map(([k]) => k).join(" · ") || "none"}</dd>
        <dt className="text-muted">Max cost / request</dt>
        <dd className="text-right m-num">{formatUsd(big(o.permissions.maxCostPerRequest))}</dd>
        <dt className="text-muted">Rolling margin</dt>
        <dd className="text-right m-num">{formatBp(o.rollingMarginBp)}</dd>
        <dt className="text-muted">Providers</dt>
        <dd className="flex flex-wrap justify-end gap-x-2 gap-y-1.5 text-[12px]">
          {o.providers.map((p) => (
            <span key={p.provider} className="inline-flex items-center gap-1">
              <span className={cx("h-2 w-2 rounded-full", !p.configured ? "bg-line-strong" : p.health === "ok" ? "bg-g-500" : p.health === "degraded" ? "bg-df" : "bg-sv")} />
              {p.provider}
            </span>
          ))}
        </dd>
      </dl>
      <div className={cx("mt-4 rounded-lg p-3 text-[13px] leading-5", meta.tint, meta.text)}>
        <b className="font-semibold">Why: </b>
        {o.lastDecision?.explanation ?? meta.blurb}
      </div>
      <div className="mt-auto pt-4 text-[12px] text-muted">
        {lastEvent ? (
          <>Last event <span className="font-mono text-ink-2">{lastEvent.type}</span> · <TimeAgo iso={lastEvent.ts} /></>
        ) : (
          "Waiting for the first event."
        )}
        {lastSnap && <div className="mt-0.5">Snapshot {new Date(lastSnap).toLocaleTimeString()}{o.rate?.stale && " · NEAR/USD rate stale"}</div>}
      </div>
      <div className="mt-3 flex gap-2">
        <ButtonLink href="/console/workspace" size="sm" variant="green">Ask the AI</ButtonLink>
        <ButtonLink href="/console/stress-lab" size="sm" variant="secondary">Stress it</ButtonLink>
      </div>
    </Card>
  );
}

function Timeline({ m, current, onPick }: { m: Metrics; current: OperatingState; onPick: (s: { at: number; label: string; detail?: string }) => void }) {
  const [end] = useState(() => Date.now());
  const start = end - 24 * 3600_000;
  const transitions = m.transitions.map((t) => ({ at: Date.parse(t.at), to: t.to as OperatingState }));
  const initial = (m.transitions.find((t) => Date.parse(t.at) >= start)?.from as OperatingState | undefined) ?? current;
  const switches = useMemo(
    () => m.modelSwitches.slice(1).map((s) => ({ at: Date.parse(s.at), label: `${s.model?.split(":").pop() ?? "none"} (${s.tier ?? "—"})`, detail: s.explanation })),
    [m.modelSwitches],
  );
  return <StateTimeline start={start} end={end} initial={initial} transitions={transitions} switches={switches} onSelect={onPick} />;
}

function ModelDrawer({ o }: { o: OverviewDTO | null }) {
  if (!o?.activeModel) return <Empty title="No model has served a request yet">Ask something in the AI Workspace and the router will pick one.</Empty>;
  return (
    <div className="space-y-3 text-[13.5px]">
      <div className="flex items-center gap-2">
        <span className="font-mono">{o.activeModel.label}</span>
        <TierBadge tier={o.activeModel.tier} />
        <span className="text-muted">via {o.activeModel.provider}</span>
      </div>
      <p className="text-ink-2">{o.lastDecision?.explanation}</p>
      <ButtonLink href="/console/models" size="sm" variant="secondary">Compare AI models →</ButtonLink>
    </div>
  );
}

function TreasuryDrawer({ o }: { o: OverviewDTO | null }) {
  if (!o) return null;
  const rows: [string, string][] = [
    ["Treasury (historical USD)", o.treasury],
    ["Customer credits (liability)", `-${o.liabilities}`],
    ["Provider payables", `-${o.payables}`],
    ["Operating liquidity", o.liquidity],
    ["Hard reserve", `-${o.hardReserve}`],
    ["Spendable", o.spendable],
  ];
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-line text-[13.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between py-2">
            <dt className="text-ink-2">{k}</dt>
            <dd className="m-num">{formatUsd(big(v))}</dd>
          </div>
        ))}
      </dl>
      <ButtonLink href="/console/treasury" size="sm" variant="secondary">Open Treasury →</ButtonLink>
    </div>
  );
}
