"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { OperatingState } from "@/lib/economics/types";
import { STATE_META } from "@/lib/client/live";
import { formatUsd } from "@/lib/economics/money";
import { cx } from "./ui";

// Hand-built SVG charts. One y-axis per chart, 2px lines, recessive grid,
// legend for ≥2 series plus direct end labels, crosshair + tooltip on hover.
// Palette validated (revenue #12b36e / cost #c0721a): CVD ΔE 8.3, normal ΔE 22.

export const SERIES = { revenue: "#12b36e", cost: "#c0721a", liquidity: "#0a6b44", sim: "#7a5af8" };

type Point = { t: number; v: number };
type Series = { key: string; label: string; color: string; points: Point[]; dashed?: boolean; area?: boolean };

const W = 640;
const H = 220;
const PAD = { l: 52, r: 64, t: 14, b: 26 };

function niceTicks(min: number, max: number, n = 4) {
  if (max === min) max = min + 1;
  const span = max - min;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n + 0.5) ?? step0;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

const usdShort = (micro: number) => {
  const d = micro / 1e6;
  const a = Math.abs(d);
  if (a >= 1000) return `$${(d / 1000).toFixed(1)}k`;
  if (a >= 10) return `$${d.toFixed(0)}`;
  if (a >= 1) return `$${d.toFixed(2)}`;
  if (a === 0) return "$0";
  return `$${d.toFixed(a < 0.01 ? 4 : 3)}`;
};

export function LineChart({
  series,
  height = H,
  refLine,
  format = (v) => formatUsd(BigInt(Math.round(v))),
  axisFormat = usdShort,
  timeFormat = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  emptyText = "No data in this period yet.",
  ariaLabel,
}: {
  series: Series[];
  height?: number;
  refLine?: { value: number; label: string; color: string };
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  timeFormat?: (t: number) => string;
  emptyText?: string;
  ariaLabel: string;
}) {
  const gid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  const geom = useMemo(() => {
    if (all.length === 0) return null;
    const t0 = Math.min(...all.map((p) => p.t));
    const t1 = Math.max(...all.map((p) => p.t));
    let vmin = Math.min(0, ...all.map((p) => p.v), refLine?.value ?? 0);
    let vmax = Math.max(...all.map((p) => p.v), refLine?.value ?? 0);
    if (vmax === vmin) vmax = vmin + 1_000_000;
    const { lo, hi, ticks } = niceTicks(vmin, vmax);
    vmin = lo;
    vmax = hi;
    const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - vmin) / (vmax - vmin)) * (height - PAD.t - PAD.b);
    const times = Array.from(new Set(all.map((p) => p.t))).sort((a, b) => a - b);
    return { t0, t1, x, y, ticks, times, vmin };
  }, [all, height, refLine?.value]);

  if (!geom) {
    return (
      <div className="grid place-items-center rounded-lg bg-paper-sunken/60 text-[13px] text-muted" style={{ height }}>
        {emptyText}
      </div>
    );
  }
  const { x, y, ticks, times } = geom;
  const hoverT = hover !== null ? times[hover] : null;

  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    times.forEach((t, i) => {
      const d = Math.abs(x(t) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div className="relative">
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4 text-[12px] text-ink-2">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden>
                <line x1="0" y1="3" x2="16" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setHover((h) => Math.min(times.length - 1, (h ?? -1) + 1));
          if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? times.length) - 1));
          if (e.key === "Escape") setHover(null);
        }}
      >
        <defs>
          {series.filter((s) => s.area).map((s) => (
            <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity=".18" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--m-line)" strokeWidth={v === 0 ? 1.2 : 1} />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--m-muted)" fontFamily="var(--font-geist-mono)">
              {axisFormat(v)}
            </text>
          </g>
        ))}
        {[geom.t0, geom.t1].map((t, i) => (
          <text key={i} x={x(t)} y={height - 6} textAnchor={i === 0 ? "start" : "end"} fontSize="10.5" fill="var(--m-muted)" fontFamily="var(--font-geist-mono)">
            {timeFormat(t)}
          </text>
        ))}
        {refLine && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(refLine.value)} y2={y(refLine.value)} stroke={refLine.color} strokeDasharray="4 4" strokeWidth="1.2" />
            <text x={PAD.l + 4} y={y(refLine.value) - 5} fontSize="10" fill={refLine.color} fontFamily="var(--font-geist-mono)">
              {refLine.label}
            </text>
          </g>
        )}
        {series.map((s) => {
          if (!s.points.length) return null;
          const d = s.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.key}>
              {s.area && <path d={`${d} L${x(last.t)} ${y(geom.vmin)} L${x(s.points[0].t)} ${y(geom.vmin)} Z`} fill={`url(#${gid}-${s.key})`} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} />
              {series.length <= 4 && (
                <text x={x(last.t) + 6} y={y(last.v) + 4} fontSize="10.5" fill="var(--m-ink-2)" fontFamily="var(--font-geist)">
                  {s.label}
                </text>
              )}
            </g>
          );
        })}
        {hoverT !== null && (
          <g pointerEvents="none">
            <line x1={x(hoverT)} x2={x(hoverT)} y1={PAD.t} y2={height - PAD.b} stroke="var(--m-ink-2)" strokeOpacity=".35" />
            {series.map((s) => {
              const p = s.points.find((q) => q.t === hoverT);
              return p ? <circle key={s.key} cx={x(p.t)} cy={y(p.v)} r="4.5" fill={s.color} stroke="var(--m-surface)" strokeWidth="2" /> : null;
            })}
          </g>
        )}
      </svg>
      {hoverT !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 min-w-[150px] rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-[0_8px_24px_rgba(14,20,16,.10)]"
          style={{ left: `clamp(0px, calc(${(x(hoverT) / W) * 100}% - 75px), calc(100% - 160px))` }}
        >
          <div className="mb-1 font-mono text-[11px] text-muted">{new Date(hoverT).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          {series.map((s) => {
            const p = s.points.find((q) => q.t === hoverT);
            return p ? (
              <div key={s.key} className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="m-num text-ink">{format(p.v)}</span>
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

/** State bands over time with model-switch markers. */
export function StateTimeline({
  start,
  end,
  initial,
  transitions,
  switches = [],
  onSelect,
}: {
  start: number;
  end: number;
  initial: OperatingState;
  transitions: { at: number; to: OperatingState; label?: string }[];
  switches?: { at: number; label: string; detail?: string }[];
  onSelect?: (s: { at: number; label: string; detail?: string }) => void;
}) {
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);
  const span = Math.max(1, end - start);
  const segs: { from: number; to: number; state: OperatingState }[] = [];
  let cur = initial;
  let at = start;
  for (const t of transitions.filter((t) => t.at >= start).sort((a, b) => a.at - b.at)) {
    segs.push({ from: at, to: t.at, state: cur });
    cur = t.to;
    at = t.at;
  }
  segs.push({ from: at, to: end, state: cur });
  const pct = (t: number) => ((t - start) / span) * 100;
  return (
    <div className="relative">
      <div className="flex h-7 w-full overflow-hidden rounded-md">
        {segs.map((s, i) => (
          <div
            key={i}
            className="h-full border-r-2 border-surface last:border-r-0"
            style={{ width: `${Math.max(0.5, pct(s.to) - pct(s.from))}%`, background: STATE_META[s.state].color, opacity: 0.85 }}
            title={`${STATE_META[s.state].label}: ${new Date(s.from).toLocaleTimeString()} – ${new Date(s.to).toLocaleTimeString()}`}
          />
        ))}
      </div>
      <div className="relative mt-1 h-5">
        {switches.map((s, i) => (
          <button
            key={i}
            type="button"
            className="absolute top-0 -translate-x-1/2 p-1"
            style={{ left: `${pct(s.at)}%` }}
            onMouseEnter={() => setTip({ x: pct(s.at), text: s.label })}
            onMouseLeave={() => setTip(null)}
            onFocus={() => setTip({ x: pct(s.at), text: s.label })}
            onBlur={() => setTip(null)}
            onClick={() => onSelect?.(s)}
            aria-label={`Model switch: ${s.label}`}
          >
            <span className="block h-2.5 w-2.5 rotate-45 border-2 border-surface bg-ink" />
          </button>
        ))}
      </div>
      {tip && (
        <div className="pointer-events-none absolute top-12 z-10 max-w-[240px] -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] shadow" style={{ left: `clamp(60px, ${tip.x}%, calc(100% - 60px))` }}>
          {tip.text}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-3 text-[11.5px] text-ink-2">
        {(Object.keys(STATE_META) as OperatingState[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: STATE_META[s].color }} />
            {STATE_META[s].label}
          </span>
        ))}
        {switches.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="block h-2 w-2 rotate-45 bg-ink" /> model switch
          </span>
        )}
      </div>
    </div>
  );
}

export function Sparkline({ values, color = SERIES.liquidity, className }: { values: number[]; color?: string; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * 100).toFixed(1)} ${(22 - ((v - min) / Math.max(1e-9, max - min)) * 20).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={cx("h-6 w-full", className)} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
