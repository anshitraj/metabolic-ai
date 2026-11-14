"use client";

import { useEffect, useState } from "react";
import { useLive } from "@/lib/client/live";
import { useApi } from "@/lib/client/use-api";
import { big, formatBp, formatUsd } from "@/lib/economics/money";
import { StateTimeline } from "@/components/m/charts";
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, Skeleton, StateChip, TierBadge, cx } from "@/components/m/ui";
import { ProviderMark } from "@/components/m/provider-mark";
import { ModelConnectionTest } from "@/components/m/model-connection";
import { StateGuide } from "@/components/m/guide";
import type { OperatingState } from "@/lib/economics/types";

type ModelRow = {
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  tier: string;
  tierLabel: string;
  quality: number;
  capabilities: string[];
  costInPerM: string;
  costOutPerM: string;
  sellInPerM: string;
  sellOutPerM: string;
  sampleRequest: { cost: string; charge: string; marginBp: number };
  enabled: boolean;
  disabledReason: string | null;
  health: string | null;
  availability: number | null;
  latency: { p50: number | null; p95: number | null };
  routedShare: number;
  routed24h: number;
};

type Metrics = { transitions: { at: string; from: string; to: string }[]; modelSwitches: { at: string; model: string | null; tier: string | null; explanation: string }[] };

export default function ModelsPage() {
  const overview = useLive((s) => s.overview);
  const events = useLive((s) => s.events);
  const lastInference = events.find((e) => e.type === "inference.started" || e.type === "inference.completed" || e.type === "model.switched");
  const models = useApi<{ models: ModelRow[]; routedTotal24h: number }>("/api/models", { deps: [lastInference?.id] });
  const metrics = useApi<Metrics>("/api/dashboard/metrics?hours=24", { deps: [lastInference?.id] });
  const [pulse, setPulse] = useState(0);
  const [now] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- animate the route on live inference
    if (lastInference?.type === "inference.started") setPulse((p) => p + 1);
  }, [lastInference?.id, lastInference?.type]);

  const list = models.data?.models ?? [];
  const activeId = overview?.activeModel?.id;
  const configured = list.filter((m) => m.enabled);
  const visibleModels = showAll ? list : configured;

  return (
    <div>
      <PageHeader
        title="AI models"
        description="One provider key can power several models. The router chooses among them based on the business’s funds, request cost and operating state."
        actions={overview && <StateChip state={overview.state} />}
      />

      <Card className="mb-4 grid gap-4 p-5 md:grid-cols-[1.4fr_1fr]">
        <div><h2 className="text-[15px] font-semibold">One Gemini key, multiple models</h2><p className="mt-1.5 text-[13px] leading-5 text-ink-2">Pro handles complex reasoning, Flash balances speed and capability, and Flash-Lite keeps costs low. They share the same Google API key. These are models; agents are workflows that use them.</p><p className="mt-2 text-[12.5px] leading-5 text-muted">Gemini requests use the operator-funded provider account. Customer credits pay application charges; provider expenses accrue offchain. A configured key has not necessarily been tested. Use a test answer to check model access and quota.</p></div>
        <div className="rounded-lg bg-paper-sunken p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Current automatic choice</div><div className="mt-2 text-[16px] font-semibold">{overview?.activeModel?.label ?? "No model selected yet"}</div><p className="mt-1 text-[12.5px] leading-5 text-ink-2">{overview?.activeModel ? "The choice can change as finances and provider availability change. Other configured models remain available to the router." : "The business needs available funds and a model that fits its policy before it can answer."}</p></div>
      </Card>
      {models.error && <div className="mb-4"><ErrorNote title="Could not load models" message={models.error} onRetry={() => void models.reload()} /></div>}

      <div className="mb-4"><StateGuide state={overview?.state} /></div>

      <Card className="mb-4 overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold">Live routing</h2>
          <p className="mt-1 text-[12.5px] text-muted">Premium offers stronger reasoning; Standard balances capability and cost; Economy spends less. Greyed models cannot be selected under the current policy.</p>
        </div>
        {models.loading ? <Skeleton className="m-5 h-48" /> : <RouteFlow models={configured} activeId={activeId} pulse={pulse} tiers={overview?.permissions.tiers} />}
      </Card>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-[15px] font-semibold">{showAll ? "All models" : "Configured models"} <span className="font-normal text-muted">· {visibleModels.length}</span></h2><div className="flex gap-1 rounded-lg border border-line bg-surface p-1"><Button size="sm" variant={showAll ? "ghost" : "secondary"} aria-pressed={!showAll} onClick={() => setShowAll(false)}>Configured ({configured.length})</Button><Button size="sm" variant={showAll ? "secondary" : "ghost"} aria-pressed={showAll} onClick={() => setShowAll(true)}>All ({list.length})</Button></div></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleModels.map((m) => (
          <Card key={m.id} className={cx("p-4", !m.enabled && "opacity-70", m.id === activeId && "ring-2 ring-g-500")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-[12px] text-muted"><ProviderMark provider={m.provider} size={22} />{m.providerLabel}</div>
                <div className="truncate text-[15px] font-semibold">{m.label}</div>
                <div className="truncate font-mono text-[11.5px] text-muted">{m.model}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <TierBadge tier={m.tier} />
                {m.enabled ? (
                  <Badge tone={m.health === "ok" ? "neutral" : m.health === "degraded" ? "amber" : "red"}>{m.health === "ok" ? "Key configured" : m.health === "degraded" ? "Recent errors" : "Temporarily unavailable"}</Badge>
                ) : (
                  <Badge tone="neutral">not configured</Badge>
                )}
              </div>
            </div>
            <p className="mt-3 text-[12.5px] leading-5 text-ink-2">{m.tier === "premium" ? "For complex questions, code and deeper reasoning." : m.tier === "standard" ? "A balance of answer quality, speed and price." : "Lower-cost answers for everyday questions."}</p>
            {m.id === activeId && <p className="mt-2 text-[12px] font-semibold text-g-700">Currently selected by the router</p>}
            <div className="mt-3 rounded-lg bg-paper-sunken px-3 py-2"><span className="block text-[11px] text-muted">Example answer · 800 input + 500 output tokens</span><span className="mt-1 block font-mono text-[13px]">Customer price {formatUsd(big(m.sampleRequest.charge), { precise: true })}</span></div>
            <details className="mt-3"><summary className="cursor-pointer text-[12.5px] font-semibold">Pricing and usage details</summary><p className="mt-2 text-[11.5px] text-muted">Input / output rates are per 1 million tokens.</p><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
              <dt className="text-muted">Cost in / out</dt>
              <dd className="text-right m-num">{formatUsd(big(m.costInPerM))} / {formatUsd(big(m.costOutPerM))}</dd>
              <dt className="text-muted">Price in / out</dt>
              <dd className="text-right m-num">{formatUsd(big(m.sellInPerM))} / {formatUsd(big(m.sellOutPerM))}</dd>
              <dt className="text-muted">Sample request</dt>
              <dd className="text-right m-num">{formatUsd(big(m.sampleRequest.cost))} → {formatUsd(big(m.sampleRequest.charge))}</dd>
              <dt className="text-muted">List margin</dt>
              <dd className="text-right m-num">{formatBp(m.sampleRequest.marginBp)}</dd>
              <dt className="text-muted">Latency p50 / p95</dt>
              <dd className="text-right m-num">{m.latency.p50 !== null ? `${(m.latency.p50 / 1000).toFixed(1)}s / ${((m.latency.p95 ?? 0) / 1000).toFixed(1)}s` : "—"}</dd>
              <dt className="text-muted">Availability 24h</dt>
              <dd className="text-right m-num">{m.availability !== null ? `${(m.availability * 100).toFixed(1)}%` : "—"}</dd>
              <dt className="text-muted">Routed 24h</dt>
              <dd className="text-right m-num">{m.routed24h} · {(m.routedShare * 100).toFixed(0)}%</dd>
              <dt className="text-muted">Quality score</dt>
              <dd className="text-right m-num">{m.quality}</dd>
            </dl></details>
            <div className="mt-3 flex flex-wrap gap-1">
              {m.capabilities.map((c) => (
                <span key={c} className="rounded bg-paper-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">{c}</span>
              ))}
            </div>
            {!m.enabled && <p className="mt-2 text-[12px] text-muted">{m.disabledReason}</p>}
            {m.enabled && <ModelConnectionTest modelId={m.id} />}
          </Card>
        ))}
        {!models.loading && !models.error && visibleModels.length === 0 && <Empty title={showAll ? "No models in the catalog" : "No provider keys configured"}>{showAll ? "The operator can add models to the server catalog." : "Set a provider API key on the server, then restart it. One Gemini key enables all Gemini models in this catalog."}</Empty>}
      </div>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Model changes · 24h</h2>
        {metrics.data && overview ? (
          <>
            <StateTimeline
              start={now - 24 * 3600_000}
              end={now}
              initial={(metrics.data.transitions[0]?.from as OperatingState) ?? overview.state}
              transitions={metrics.data.transitions.map((t) => ({ at: Date.parse(t.at), to: t.to as OperatingState }))}
              switches={metrics.data.modelSwitches.slice(1).map((s) => ({ at: Date.parse(s.at), label: `${s.model?.split(":").pop()} — ${s.explanation}` }))}
            />
            {metrics.data.modelSwitches.length > 0 && (
              <ul className="mt-4 divide-y divide-line text-[13px]">
                {metrics.data.modelSwitches.slice().reverse().slice(0, 8).map((s) => (
                  <li key={s.at} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-mono text-[12px] text-muted">{new Date(s.at).toLocaleTimeString()}</span>
                    <TierBadge tier={s.tier} />
                    <span className="font-mono">{s.model?.split(":").pop()}</span>
                    <span className="text-ink-2">{s.explanation}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Skeleton className="h-16" />
        )}
      </Card>
    </div>
  );
}

function RouteFlow({ models, activeId, pulse, tiers }: { models: ModelRow[]; activeId?: string; pulse: number; tiers?: Record<string, boolean> }) {
  const W = 860;
  const rowH = 44;
  const H = Math.max(160, models.length * rowH + 40);
  const srcY = H / 2;
  return (
    <>
    <div className="space-y-3 p-4 md:hidden">
      <div className="rounded-lg bg-paper-sunken px-3 py-2 text-[12px] text-ink-2">Your request → budget &amp; health check → model</div>
      {models.map((m) => {
        const allowed = (!tiers || tiers[m.tier]) && m.health !== "down";
        return <div key={m.id} className={cx("rounded-lg border px-3 py-2.5", m.id === activeId ? "border-g-500 bg-g-50" : "border-line")}><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px] font-semibold">{m.label}</span><TierBadge tier={m.tier} /></div><p className="mt-1 text-[12px] text-ink-2">{m.id === activeId ? "Selected now" : allowed ? "Available for requests that fit the budget" : m.health === "down" ? "Provider temporarily unavailable" : "This tier is paused in the current state"}</p></div>;
      })}
      {models.length === 0 && <p className="text-[13px] text-muted">Configure a provider key to enable model routing.</p>}
    </div>
    <div className="hidden px-3 py-4 md:block">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Routing from request to models">
        <defs>
          <style>{`@keyframes rf{to{stroke-dashoffset:-60}} .rf{stroke-dasharray:6 10;animation:rf 1.2s linear infinite} @media(prefers-reduced-motion:reduce){.rf{animation:none}}`}</style>
        </defs>
        <rect x="20" y={srcY - 24} width="140" height="48" rx="10" fill="var(--m-stage)" />
        <text x="90" y={srcY - 3} textAnchor="middle" fill="#e8f1eb" fontSize="12.5" fontWeight="600">Request</text>
        <text x="90" y={srcY + 13} textAnchor="middle" fill="#8c9a90" fontSize="10.5" fontFamily="var(--font-geist-mono)">priced first</text>
        <rect x="230" y={srcY - 24} width="130" height="48" rx="10" fill="var(--m-paper-sunken)" stroke="var(--m-line)" />
        <text x="295" y={srcY - 3} textAnchor="middle" fill="var(--m-ink)" fontSize="12.5" fontWeight="600">Policy</text>
        <text x="295" y={srcY + 13} textAnchor="middle" fill="var(--m-muted)" fontSize="10.5" fontFamily="var(--font-geist-mono)">margin · caps · health</text>
        <line x1="160" y1={srcY} x2="230" y2={srcY} stroke="var(--m-line-strong)" strokeWidth="1.5" />
        {models.map((m, i) => {
          const y = 20 + i * rowH + rowH / 2;
          const allowed = m.enabled && (tiers ? tiers[m.tier] : true) && m.health !== "down";
          const active = m.id === activeId;
          return (
            <g key={m.id} opacity={allowed ? 1 : 0.35}>
              <path d={`M360 ${srcY} C 430 ${srcY}, 430 ${y}, 500 ${y}`} fill="none" stroke={active ? "#12b36e" : "var(--m-line-strong)"} strokeWidth={active ? 2 : 1.2} />
              {active && <path key={pulse} className="rf" d={`M360 ${srcY} C 430 ${srcY}, 430 ${y}, 500 ${y}`} fill="none" stroke="#2bd98a" strokeWidth="2.4" />}
              <rect x="500" y={y - 16} width="340" height="32" rx="8" fill={active ? "var(--m-g-50)" : "var(--m-surface)"} stroke={active ? "#12b36e" : "var(--m-line)"} />
              <text x="512" y={y + 4} fontSize="12" fill="var(--m-ink)" fontWeight={active ? 600 : 400}>{m.label}</text>
              <text x="828" y={y + 4} fontSize="10.5" textAnchor="end" fill="var(--m-muted)" fontFamily="var(--font-geist-mono)">{m.tierLabel} · {formatBp(m.sampleRequest.marginBp)}</text>
            </g>
          );
        })}
      </svg>
    </div>
    </>
  );
}
