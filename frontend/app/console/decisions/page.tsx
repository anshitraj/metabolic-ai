"use client";

import { useState } from "react";
import { useLive } from "@/lib/client/live";
import { useApi } from "@/lib/client/use-api";
import { DecisionDetail, DecisionFeed, type DecisionItem } from "@/components/m/decisions";
import { Button, Card, Dialog, Empty, ErrorNote, PageHeader, RealChip, Skeleton, cx } from "@/components/m/ui";

const STATES = ["", "ABUNDANCE", "DEFENSIVE", "SURVIVAL", "RECOVERY"];
const KINDS = [
  ["", "All"],
  ["route", "Routes"],
  ["refusal", "Refusals"],
  ["failover", "Failovers"],
  ["state", "State changes"],
];
const RANGES = [
  ["", "All time"],
  ["1", "Last hour"],
  ["24", "Last 24h"],
  ["168", "Last 7 days"],
];

export default function DecisionsPage() {
  const [state, setState] = useState("");
  const [kind, setKind] = useState("");
  const [range, setRange] = useState("");
  const [from, setFrom] = useState("");
  const [open, setOpen] = useState<DecisionItem | null>(null);
  const live = useLive((s) => s.events[0]?.id);
  const qs = new URLSearchParams({ limit: "100", ...(state && { state }), ...(kind && { kind }), ...(from && { from }) }).toString();
  const d = useApi<{ items: DecisionItem[] }>(`/api/economics/decisions?${qs}`, { deps: [live] });

  const exportCsv = () => {
    const rows = [["at", "kind", "state", "previous_state", "model", "tier", "est_cost_micro", "est_charge_micro", "policy_version", "explanation"]];
    for (const i of d.data?.items ?? []) rows.push([i.at, i.kind, i.state, i.previousState ?? "", i.model ?? "", i.tier ?? "", i.estCost ?? "", i.estCharge ?? "", String(i.policyVersion), i.explanation]);
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `metabolic-decisions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sel = "h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px]";
  return (
    <div>
      <PageHeader
        title="Economic Decisions"
        eyebrow={<RealChip />}
        description="Its diary. Every time it picked a model, refused a request, or changed mood, it wrote down what it decided and why. Entries can't be edited or deleted."
        actions={<Button variant="secondary" size="sm" onClick={exportCsv} disabled={!d.data?.items.length}>Export CSV</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-surface p-0.5">
          {KINDS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={cx("rounded-md px-3 py-1.5 text-[13px]", kind === k ? "bg-ink text-white" : "text-ink-2 hover:text-ink")}>
              {l}
            </button>
          ))}
        </div>
        <select aria-label="State" className={sel} value={state} onChange={(e) => setState(e.target.value)}>
          {STATES.map((s) => (
            <option key={s} value={s}>{s ? s[0] + s.slice(1).toLowerCase() : "Any state"}</option>
          ))}
        </select>
        <select aria-label="Date range" className={sel} value={range} onChange={(e) => {
          setRange(e.target.value);
          setFrom(e.target.value ? new Date(Date.now() - Number(e.target.value) * 3600_000).toISOString() : "");
        }}>
          {RANGES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      {d.error && <ErrorNote message={d.error} onRetry={() => void d.reload()} />}
      <Card className="px-5">
        {d.loading ? (
          <Skeleton className="my-5 h-60" />
        ) : d.data?.items.length ? (
          <DecisionFeed items={d.data.items} onOpen={setOpen} />
        ) : (
          <Empty className="my-5" title="No decisions match">Decisions are recorded on every request and state change. Try a wider filter, or make a request in the AI Workspace.</Empty>
        )}
      </Card>
      <Dialog open={!!open} onClose={() => setOpen(null)} title="Decision" wide>
        {open && <DecisionDetail d={open} />}
      </Dialog>
    </div>
  );
}
