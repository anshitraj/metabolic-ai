"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { MetabolicEvent, OverviewDTO } from "@/lib/economics/types";
import { useLive } from "@/lib/client/live";
import { api } from "@/lib/client/api";
import { big, formatBp, formatCoverage, formatRunway, formatUsd } from "@/lib/economics/money";
import { OrganismStage } from "@/components/organism/stage";
import { LineChart, SERIES } from "./charts";
import { Badge, Button, Card, ErrorNote, Label, SimChip, Skeleton, StateChip, cx } from "./ui";
import { Hint, StateGuide, STATE_GUIDANCE } from "./guide";

export type SimView = {
  id: string;
  overview: OverviewDTO;
  modifiers: { costMultiplier: number; demandMultiplier: number; trafficPerMin: number; providersDown: string[] };
  observedCostRatio: number;
  history: { t: number; liquidity: string; revenue: string; expense: string; state: string; tier: string | null; marginBp: number | null }[];
  decisions: { at: number; kind: string; text: string; state: string; model: string | null }[];
  totals: { revenue: string; expense: string; requests: number; refused: number };
  speed: number;
  models: { id: string; label: string; tier: string; provider: string; configured: boolean }[];
};

export type SimAction =
  | { type: "spike_cost"; multiplier: number }
  | { type: "set_demand"; multiplier: number }
  | { type: "set_traffic"; perMin: number }
  | { type: "drain_treasury" }
  | { type: "restore_funding"; usd?: number }
  | { type: "provider_failure"; provider: string; down: boolean }
  | { type: "reset" };

/** A scenario owns its stream and polling lifecycle; old polls cannot overwrite an action. */
export function useSimulation() {
  const [sim, setSim] = useState<SimView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const idRef = useRef<string | null>(null);
  const actionRef = useRef(false);
  const actionVersion = useRef(0);
  const pollRequest = useRef<Promise<SimView> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let scenarioId: string | null = null;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        const s = await api<SimView>("/api/simulations", { method: "POST" });
        if (cancelled) {
          void fetch(`/api/simulations/${s.id}`, { method: "DELETE", keepalive: true });
          return;
        }
        scenarioId = s.id;
        idRef.current = s.id;
        useLive.getState().reset(`sim:${s.id}`);
        useLive.getState().setOverview(s.overview);
        useLive.getState().setConnection("live");
        setSim(s);
        es = new EventSource(`/api/events/stream?scope=sim:${s.id}`);
        es.addEventListener("metabolic", (m) => {
          const ev = JSON.parse((m as MessageEvent).data) as MetabolicEvent;
          if (ev.type !== "snapshot.updated") useLive.getState().pushEvent(ev);
        });
        let polling = false;
        poll = setInterval(async () => {
          if (polling || actionRef.current) return;
          polling = true;
          const before = actionVersion.current;
          try {
            const request = api<SimView>(`/api/simulations/${s.id}`);
            pollRequest.current = request;
            const n = await request;
            if (!cancelled && before === actionVersion.current && !actionRef.current) {
              setSim(n);
              setPollError(null);
              useLive.getState().setOverview(n.overview);
            }
          } catch (e) {
            if (!cancelled) setPollError(e instanceof Error ? e.message : "Could not refresh the scenario.");
          } finally {
            polling = false;
            pollRequest.current = null;
          }
        }, 1000);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not start a scenario.");
      }
    })();
    return () => {
      cancelled = true;
      es?.close();
      if (poll) clearInterval(poll);
      if (idRef.current === scenarioId) idRef.current = null;
      if (scenarioId) void fetch(`/api/simulations/${scenarioId}`, { method: "DELETE", keepalive: true });
      useLive.getState().reset("real");
    };
  }, [revision]);

  const act = useCallback(async (a: SimAction) => {
    const id = idRef.current;
    if (!id || actionRef.current) return false;
    actionRef.current = true;
    actionVersion.current++;
    setBusy(true);
    setError(null);
    try {
      // The poll also advances and saves the scenario. Finish it before mutating.
      await pollRequest.current?.catch(() => {});
      if (idRef.current !== id) return false;
      const n = await api<SimView>(`/api/simulations/${id}/events`, { method: "POST", json: a });
      if (idRef.current !== id) return false;
      setSim(n);
      useLive.getState().setOverview(n.overview);
      if (a.type === "restore_funding") useLive.getState().pushEffect({ type: "treasury.deposit.confirmed", payload: {} });
      return true;
    } catch (e) {
      if (idRef.current === id) setError(e instanceof Error ? e.message : "Action failed.");
      return false;
    } finally {
      actionRef.current = false;
      if (idRef.current === id) setBusy(false);
    }
  }, []);

  const retry = () => { setError(null); setPollError(null); setSim(null); setRevision((v) => v + 1); };
  return { sim, error: error ?? pollError, act, busy, retry };
}

const SCENARIOS: { title: string; description: string; action: SimAction; outcome: string }[] = [
  { title: "Costs rise", description: "AI providers charge 3× more.", action: { type: "spike_cost", multiplier: 3 }, outcome: "Costs are now 3× normal. Watch the profit margin and model choice as the router learns the higher cost." },
  { title: "Demand drops", description: "Only 20% of normal traffic arrives.", action: { type: "set_demand", multiplier: 0.2 }, outcome: "Demand is now 20% of normal. Fewer requests bring in less revenue while fixed running costs continue." },
  { title: "Funds run low", description: "Available funds fall below the safety reserve.", action: { type: "drain_treasury" }, outcome: "Available funds are below the safety reserve. Watch Survival protect the remaining money. Try Add funding next." },
  { title: "Add funding", description: "Put $50 back into this simulation.", action: { type: "restore_funding", usd: 50 }, outcome: "$50 added to the simulation. Recovery takes time: the business waits for healthy finances before upgrading models." },
];

export function StressLab({ realActions }: { realActions?: React.ReactNode }) {
  const { sim, error, act, busy, retry } = useSimulation();
  const overview = sim?.overview ?? null;
  const [notice, setNotice] = useState("Choose a scenario to see how the business responds. Combine changes or reset at any time.");
  const [resetCount, setResetCount] = useState(0);
  const run = async (action: SimAction, message: string) => {
    if (await act(action)) {
      setNotice(message);
      if (action.type === "reset") setResetCount((n) => n + 1);
    }
  };
  const disabled = !sim || busy;
  if (error && !sim) return <ErrorNote title="Could not start the simulation" message={error} onRetry={retry} />;

  return (
    <div className="space-y-4">
      <div className="m-sim-frame rounded-2xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px]">
          <SimChip /><span className="text-ink-2">No real money or AI calls · {sim?.speed ?? 20}× speed</span>
          <Button className="ml-auto" size="sm" variant="secondary" onClick={() => void run({ type: "reset" }, "Scenario reset. Costs, demand, traffic and funding are back to the starting conditions.")} disabled={disabled}>Reset everything</Button>
        </div>
        <div className="grid gap-5 xl:grid-cols-12">
          <div className="space-y-4 xl:col-span-4">
            <div><Label>1 · Choose what happens</Label><h2 className="mt-1 font-serif text-[24px] leading-7">Try a change. Watch it adapt.</h2><p className="mt-2 text-[13px] leading-5 text-ink-2">A stress test asks “what if?” Higher costs, fewer customers or low funds put pressure on the business.</p></div>
            <div className="grid grid-cols-2 gap-2">
              {SCENARIOS.map((s, i) => (
                <button key={s.title} type="button" disabled={disabled} onClick={() => void run(s.action, s.outcome)} className="rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-g-700 hover:bg-g-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-g-700 disabled:cursor-wait disabled:opacity-50">
                  <span className="mb-3 grid h-6 w-6 place-items-center rounded-full bg-paper-sunken font-mono text-[11px] text-ink-2">0{i + 1}</span>
                  <span className="block text-[13.5px] font-semibold text-ink">{s.title}<span aria-hidden className="float-right text-g-700">↗</span></span><span className="mt-1 block text-[12px] leading-[18px] text-ink-2">{s.description}</span>
                </button>
              ))}
            </div>
            <div role="status" aria-live="polite" className="rounded-lg border border-line bg-surface/70 px-3 py-2.5 text-[12.5px] leading-5 text-ink-2">{busy ? "Applying your change…" : notice}</div>
            <p className="text-[12px] leading-5 text-muted">Simulated models use catalog prices, including providers without a key. To check real API access, open <a href="/console/models" className="font-semibold text-g-700 underline underline-offset-2">AI models</a>.</p>
            <details className="rounded-xl border border-line bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold">Fine-tune the scenario <span className="block pt-1 text-[12px] font-normal text-muted">Optional · adjust a value, then choose Apply</span></summary>
              <fieldset disabled={disabled} className="space-y-4 border-t border-line p-4 disabled:opacity-60">
                <AdjustableControl key={`cost:${resetCount}:${sim?.modifiers.costMultiplier}`} title="AI cost" desc="1× is the normal provider price. 3× costs three times as much; customer prices stay the same." value={sim?.modifiers.costMultiplier ?? 1} min={1} max={10} step={0.5} fmt={(v) => `${v}×`} onApply={(v) => run({ type: "spike_cost", multiplier: v }, `AI cost set to ${v}× normal.`)} />
                <AdjustableControl key={`demand:${resetCount}:${sim?.modifiers.demandMultiplier}`} title="Customer demand" desc="100% is normal. 50% means half as many requests at the base traffic rate." value={(sim?.modifiers.demandMultiplier ?? 1) * 100} min={0} max={300} step={10} fmt={(v) => `${v}%`} onApply={(v) => run({ type: "set_demand", multiplier: v / 100 }, `Customer demand set to ${v}% of normal.`)} />
                <AdjustableControl key={`traffic:${resetCount}:${sim?.modifiers.trafficPerMin}`} title="Base traffic" desc="Requests per simulated minute, before the demand adjustment." value={sim?.modifiers.trafficPerMin ?? 30} min={0} max={120} step={5} fmt={(v) => `${v}/min`} onApply={(v) => run({ type: "set_traffic", perMin: v }, `Base traffic set to ${v} requests per simulated minute.`)} />
                <div className="border-t border-line pt-4">
                  <h3 className="text-[13px] font-semibold">Provider outages</h3><p className="mb-2 mt-1 text-[12px] leading-5 text-muted">Switch a provider off to test backup routing. All its models become unavailable in this simulation.</p>
                  <div className="flex flex-wrap gap-2">{Array.from(new Set((sim?.models ?? []).map((m) => m.provider))).map((p) => {
                    const down = sim?.modifiers.providersDown.includes(p) ?? false;
                    return <button key={p} type="button" onClick={() => void run({ type: "provider_failure", provider: p, down: !down }, `${p} is now ${down ? "available again" : "offline"} in this simulation.`)} aria-pressed={down} className={cx("min-h-9 rounded-lg border px-3 py-1 text-[12px]", down ? "border-sv bg-sv-tint text-sv-text" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>{p} · {down ? "Offline — restore" : "Online — turn off"}</button>;
                  })}</div>
                </div>
              </fieldset>
            </details>
          </div>
          <div className="min-w-0 space-y-4 xl:col-span-8">
            <Card className="p-4 sm:p-5">
              <Label>2 · Understand the response</Label>
              {overview ? <>
                <div className="mt-3 flex flex-wrap items-center gap-2"><StateChip state={overview.state} /><span className="text-[12px] text-muted">Current simulated state</span></div>
                <h2 className="mt-2 text-[17px] font-semibold">{STATE_GUIDANCE[overview.state].title}</h2><p className="mt-1 text-[13px] leading-5 text-ink-2">{STATE_GUIDANCE[overview.state].description}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 font-mono text-[11.5px] text-muted"><span>Cost {sim?.modifiers.costMultiplier}×</span><span>Demand {Math.round((sim?.modifiers.demandMultiplier ?? 1) * 100)}%</span><span>Effective traffic {((sim?.modifiers.trafficPerMin ?? 30) * (sim?.modifiers.demandMultiplier ?? 1)).toFixed(0)}/min</span></div>
              </> : <Skeleton className="mt-3 h-28" />}
            </Card>
            {error && <ErrorNote title="Change or refresh failed" message={error} />}
            <OrganismStage overview={overview} className="min-h-[280px] sm:min-h-[340px]" label={<SimChip />} />
            {sim ? <SimMetrics sim={sim} /> : <Skeleton className="h-24" />}
          </div>
        </div>
      </div>
      <StateGuide state={overview?.state} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[14px] font-semibold">Available business funds <Hint term="liquidity" /></h3><SimChip /></div><p className="mb-3 text-[12.5px] text-muted">Watch funds move toward or away from the safety reserve.</p>
          {sim ? <LineChart ariaLabel="Simulated operating liquidity" height={190} series={[{ key: "l", label: "Available funds", color: SERIES.sim, dashed: true, area: true, points: sim.history.map((h) => ({ t: h.t, v: Number(h.liquidity) })) }]} refLine={{ value: Number(big(sim.overview.hardReserve)), label: "safety reserve", color: SERIES.cost }} /> : <Skeleton className="h-[190px]" />}
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[14px] font-semibold">What changed and why</h3><SimChip /></div><p className="mb-2 text-[12.5px] text-muted">Latest decisions first. State changes may wait for a stability check.</p>
          <ul className="max-h-[230px] divide-y divide-line overflow-y-auto">{(sim?.decisions ?? []).map((d, i) => <li key={`${d.at}-${i}`} className="py-2 text-[12.5px]"><div className="flex items-center gap-2"><Badge tone={d.kind === "state" ? "blue" : d.kind === "refusal" ? "red" : d.kind === "stress" ? "neutral" : "green"}>{d.kind === "stress" ? "Your change" : d.kind === "route" ? "Model choice" : d.kind === "refusal" ? "Request blocked" : d.kind === "state" ? "State change" : "Update"}</Badge><span className="ml-auto font-mono text-[11px] text-muted">{new Date(d.at).toLocaleTimeString()}</span></div><p className="mt-1 text-ink-2">{d.text}</p></li>)}</ul>
        </Card>
      </div>
      {realActions && <details className="rounded-xl border border-line bg-surface px-4 py-3"><summary className="cursor-pointer text-[13px] font-semibold">Continue with real testnet actions</summary><p className="mb-3 mt-2 text-[12.5px] text-ink-2">These actions affect the real NEAR testnet treasury and receipts. They are separate from the simulation above.</p><div className="max-w-sm">{realActions}</div></details>}
    </div>
  );
}

function SimMetrics({ sim }: { sim: SimView }) {
  const o = sim.overview;
  const cells: [string, React.ReactNode, string][] = [
    ["Available funds", formatUsd(big(o.liquidity)), "Business money after customer credits and provider bills."],
    ["Reserve coverage", formatCoverage(o.reserveCoverageBp), "Available funds divided by the safety reserve. Below 1× means funds are below the reserve."],
    ["Profit margin", formatBp(o.rollingMarginBp), "Share of recent revenue left after AI costs. A negative margin means losses."],
    ["Time until reserve", formatRunway(o.runwaySeconds), "Estimated time before losses consume funds above the safety reserve."],
    ["Selected model", o.activeModel?.label ?? "No safe model available", "The model the router can afford under the current policy."],
    ["Learned AI cost", `${sim.observedCostRatio.toFixed(2)}×`, "The router learns actual provider costs over several simulated requests."],
    ["Answered", String(sim.totals.requests), "Requests answered during this simulation."],
    ["Blocked", String(sim.totals.refused), "Requests blocked because no available model fits the budget and policy."],
  ];
  return <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4">{cells.map(([k, v, hint]) => <div key={k} className="bg-surface px-3 py-3" title={hint}><Label className="text-[10px]">{k}</Label><div className="mt-1 break-words font-mono text-[13px] text-ink">{v}</div></div>)}</Card>;
}

function AdjustableControl({ title, desc, value, min, max, step, fmt, onApply }: { title: string; desc: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onApply: (v: number) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const id = useId();
  return <div className="space-y-2 border-b border-line pb-4">
    <div className="flex items-center justify-between gap-2"><label htmlFor={id} className="text-[13px] font-semibold">{title}</label><span className="font-mono text-[12px] text-muted">Applied: {fmt(value)}</span></div><p id={`${id}-hint`} className="text-[12px] leading-[18px] text-muted">{desc}</p>
    <div className="flex items-center gap-3"><input id={id} aria-describedby={`${id}-hint`} type="range" min={min} max={max} step={step} value={draft} onChange={(e) => setDraft(Number(e.target.value))} aria-valuetext={fmt(draft)} className="h-6 min-w-0 flex-1 accent-g-700" /><output htmlFor={id} className="w-16 text-right font-mono text-[13px]">{fmt(draft)}</output></div>
    <Button size="sm" variant="secondary" disabled={draft === value} onClick={() => void onApply(draft)}>Apply {title.toLowerCase()}</Button>
  </div>;
}
