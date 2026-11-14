"use client";

import Link from "next/link";
import { formatBp, formatUsd, big } from "@/lib/economics/money";
import { cx } from "./ui";

export type ReceiptDTO = {
  id: string;
  status: "pending" | "submitted" | "finalized" | "failed";
  network: string;
  hash: string;
  txHash: string | null;
  explorer: string | null;
  payload: { revenue_micro: string; expense_micro: string; margin_bp: number | null; state: string; requests: number; interval_start: string; interval_end: string; ledger_root: string; tier_mix: Record<string, number> };
  intervalStart: string;
  intervalEnd: string;
  createdAt: string;
  finalizedAt: string | null;
  error: string | null;
};

const STATUS: Record<ReceiptDTO["status"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "text-stage-muted" },
  submitted: { label: "Submitted", cls: "text-df" },
  finalized: { label: "Finalized", cls: "text-g-400" },
  failed: { label: "Failed", cls: "text-sv" },
};

/** Dark Stage card for an on-chain economic receipt. */
export function ReceiptCard({ r, compact }: { r: ReceiptDTO; compact?: boolean }) {
  const s = STATUS[r.status];
  return (
    <div className="rounded-xl bg-stage p-3.5 text-[12.5px] text-stage-ink">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-semibold">{r.id}</span>
        <span className={cx("inline-flex items-center gap-1 font-semibold", s.cls)}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" /> {s.label}
        </span>
      </div>
      <div className="mt-1 font-mono text-[11.5px] text-g-200">
        {r.txHash && r.explorer ? (
          <a href={r.explorer} target="_blank" rel="noreferrer" className="hover:underline">
            tx {r.txHash.slice(0, 8)}…{r.txHash.slice(-6)} ↗
          </a>
        ) : (
          <span className="text-stage-muted">{r.status === "failed" ? r.error?.slice(0, 80) : r.status === "finalized" ? "Commitment verified on chain; transaction hash unavailable" : "awaiting finality…"}</span>
        )}
      </div>
      {!compact && <p className="mt-2 text-[11px] leading-4 text-stage-muted">Commitment to this accounting record. Provider expenses accrue offchain; this does not prove payment to an AI provider.</p>}
      <div className="mt-1.5 text-stage-muted">
        {new Date(r.intervalStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–{new Date(r.intervalEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · margin {formatBp(r.payload.margin_bp)}
        {!compact && (
          <>
            {" "}· revenue {formatUsd(big(r.payload.revenue_micro))} · compute {formatUsd(big(r.payload.expense_micro))} · {r.payload.requests} requests
          </>
        )}
      </div>
      {!compact && (
        <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] text-stage-muted">
          <span className="truncate" title={r.hash}>sha256 {r.hash.slice(0, 16)}…</span>
          <Link href={`/verify?id=${r.id}`} className="shrink-0 font-sans font-semibold text-g-400 hover:underline">Verify →</Link>
        </div>
      )}
    </div>
  );
}
