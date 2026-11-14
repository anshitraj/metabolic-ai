"use client";

import { AnimatePresence, motion } from "motion/react";
import type { OperatingState } from "@/lib/economics/types";
import { formatBp, formatUsd, big } from "@/lib/economics/money";
import { Badge, StateChip, TierBadge, TimeAgo, cx } from "./ui";

export type DecisionItem = {
  id: string;
  at: string;
  kind: string;
  state: string;
  previousState: string | null;
  model: string | null;
  tier: string | null;
  explanation: string;
  estCost: string | null;
  estCharge: string | null;
  candidates: unknown;
  usageRequestId: string | null;
  policyVersion: number;
  metrics: unknown;
};

const KIND: Record<string, { label: string; tone: "neutral" | "green" | "amber" | "red" | "blue" }> = {
  route: { label: "Route", tone: "green" },
  refusal: { label: "Refusal", tone: "red" },
  failover: { label: "Failover", tone: "amber" },
  state: { label: "State change", tone: "blue" },
};

export function DecisionFeed({ items, compact, onOpen }: { items: DecisionItem[]; compact?: boolean; onOpen?: (d: DecisionItem) => void }) {
  return (
    <ul className="divide-y divide-line">
      <AnimatePresence initial={false}>
        {items.map((d) => (
          <motion.li key={d.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}>
            <button type="button" onClick={() => onOpen?.(d)} className={cx("w-full text-left", compact ? "py-2.5" : "py-3", onOpen && "hover:bg-paper-sunken/50")}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={KIND[d.kind]?.tone ?? "neutral"}>{KIND[d.kind]?.label ?? d.kind}</Badge>
                {d.kind === "state" && d.previousState === d.state ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">Initial state <StateChip state={d.state as OperatingState} /></span>
                ) : d.kind === "state" && d.previousState ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px]">
                    <StateChip state={d.previousState as OperatingState} /> → <StateChip state={d.state as OperatingState} />
                  </span>
                ) : (
                  <>
                    <TierBadge tier={d.tier} />
                    {d.model && <span className="font-mono text-[12px] text-ink-2">{d.model.split(":").pop()}</span>}
                  </>
                )}
                <TimeAgo iso={d.at} className="ml-auto text-[11.5px] text-muted" />
              </div>
              <p className={cx("mt-1 text-[13px] leading-5 text-ink-2", compact && "line-clamp-2")}>{d.explanation}</p>
              {!compact && d.estCost && (
                <div className="mt-1 font-mono text-[11.5px] text-muted">
                  est. cost {formatUsd(big(d.estCost))} · est. charge {formatUsd(big(d.estCharge))} · policy v{d.policyVersion}
                </div>
              )}
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

type Candidate = { modelId: string; tier: string; cost: string; charge: string; marginBp: number; allowed: boolean; reason: string | null };

export function DecisionDetail({ d }: { d: DecisionItem }) {
  const cands = Array.isArray(d.candidates) ? (d.candidates as Candidate[]) : [];
  const metrics = (d.metrics ?? null) as Record<string, unknown> | null;
  return (
    <div className="space-y-4 text-[13.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={KIND[d.kind]?.tone ?? "neutral"}>{KIND[d.kind]?.label ?? d.kind}</Badge>
        <StateChip state={d.state as OperatingState} />
        <span className="font-mono text-[12px] text-muted">{new Date(d.at).toLocaleString()} · policy v{d.policyVersion}</span>
      </div>
      <p className="text-ink">{d.explanation}</p>
      {metrics && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-paper-sunken p-3 font-mono text-[12px]">
          <dt className="text-muted">Liquidity</dt>
          <dd>{formatUsd(big(metrics.liquidity as string))}</dd>
          <dt className="text-muted">Reserve coverage</dt>
          <dd>{((metrics.reserveCoverageBp as number) / 10000).toFixed(2)}×</dd>
          <dt className="text-muted">Rolling margin</dt>
          <dd>{formatBp((metrics.rollingMarginBp as number | null) ?? null)}</dd>
          <dt className="text-muted">Burn / hour</dt>
          <dd>{formatUsd(big(metrics.burnPerHour as string))}</dd>
        </dl>
      )}
      {cands.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1.5 pr-3 font-semibold">Candidate</th>
                <th className="py-1.5 pr-3 font-semibold">Est. cost</th>
                <th className="py-1.5 pr-3 font-semibold">Est. charge</th>
                <th className="py-1.5 pr-3 font-semibold">Margin</th>
                <th className="py-1.5 font-semibold">Verdict</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line font-mono">
              {cands.map((c) => (
                <tr key={c.modelId} className={c.modelId === d.model ? "bg-g-50/60" : ""}>
                  <td className="py-1.5 pr-3">{c.modelId.split(":").pop()}</td>
                  <td className="py-1.5 pr-3">{formatUsd(big(c.cost))}</td>
                  <td className="py-1.5 pr-3">{formatUsd(big(c.charge))}</td>
                  <td className="py-1.5 pr-3">{formatBp(c.marginBp)}</td>
                  <td className={cx("py-1.5 font-sans", c.allowed ? "text-g-700" : "text-sv-text")}>{c.allowed ? (c.modelId === d.model ? "chosen" : "allowed") : c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.usageRequestId && <div className="font-mono text-[11.5px] text-muted">usage {d.usageRequestId}</div>}
    </div>
  );
}
