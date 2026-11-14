"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { OperatingState, OverviewDTO, Tier } from "@/lib/economics/types";
import { useLive, STATE_META } from "@/lib/client/live";
import { formatBp, formatCoverage } from "@/lib/economics/money";
import { cx, StateChip } from "@/components/m/ui";
import { OrganismFallback } from "./fallback";
import type { OrganismSelect } from "./scene";

const Scene = dynamic(() => import("./scene"), { ssr: false, loading: () => null });

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export type { OrganismSelect };

/** Typical look of each state, used only for clearly labelled previews. */
const PREVIEW: Record<OperatingState, { tier: Tier; coverage: number; activity: number }> = {
  ABUNDANCE: { tier: "premium", coverage: 4, activity: 24 },
  DEFENSIVE: { tier: "economy", coverage: 1.4, activity: 12 },
  SURVIVAL: { tier: "economy", coverage: 0.6, activity: 0 },
  RECOVERY: { tier: "standard", coverage: 2, activity: 8 },
};

/**
 * The dark Stage that hosts the organism, with readable HTML overlays.
 * Driven by the live store (overview + events). Works without WebGL.
 * `previewState` shows what a state looks like, labelled as a preview.
 */
export function OrganismStage({
  overview,
  className,
  minimal,
  onSelect,
  label,
  previewState,
}: {
  overview: OverviewDTO | null;
  className?: string;
  minimal?: boolean;
  onSelect?: (s: OrganismSelect) => void;
  label?: React.ReactNode;
  previewState?: OperatingState | null;
}) {
  const events = useLive((s) => s.events);
  const reduced = useLive((s) => s.reducedEffects);
  const setReduced = useLive((s) => s.setReducedEffects);
  const connection = useLive((s) => s.connection);
  const [gl, setGl] = useState<boolean | null>(null);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    // Detect once on mount (client-only capability).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGl(webglAvailable());
  }, []);

  const preview = previewState ?? null;
  const state: OperatingState = preview ?? overview?.state ?? "ABUNDANCE";
  const coverage = preview ? PREVIEW[preview].coverage : overview ? overview.reserveCoverageBp / 10_000 : 3;
  const dormant = !overview && !preview;

  return (
    <div className={cx("m-stage rounded-[28px]", className)} aria-label={`Metabolic organism, ${STATE_META[state].label} state${preview ? " (preview)" : ""}`}>
      <div className="absolute inset-0 z-0">
        {gl && !dormant ? (
          <Scene
            state={state}
            tier={preview ? PREVIEW[preview].tier : overview?.activeModel?.tier ?? null}
            coverage={coverage}
            activity={preview ? PREVIEW[preview].activity : overview?.requestsWindow ?? 0}
            modelLabel={preview ? null : overview?.activeModel?.label}
            events={preview ? [] : events.filter((e) => e.type !== "snapshot.updated")}
            reduced={reduced}
            onSelect={preview ? undefined : onSelect}
            resetKey={resetKey}
          />
        ) : (
          <div className={cx("grid h-full w-full place-items-center p-6", dormant && "opacity-40")}>
            <div className="aspect-square h-full max-h-[460px]">
              <OrganismFallback state={state} />
            </div>
          </div>
        )}
      </div>

      {!minimal && (
        <>
          <div className="absolute inset-x-4 top-4 z-10 flex flex-wrap items-start justify-between gap-2 sm:inset-x-5 sm:top-5">
          <div className="pointer-events-none flex flex-wrap items-center gap-2">
            {(overview || preview) && <StateChip state={state} onStage />}
            {preview && <span className="rounded-full border border-dashed border-white/30 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-stage-muted">Preview</span>}
            {label}
            {dormant && <span className="font-mono text-[11px] text-stage-muted">Connecting to the economy…</span>}
          </div>
          <div className="pointer-events-auto flex items-center gap-1.5">
            {gl && (
              <button type="button" onClick={() => setResetKey((k) => k + 1)} className="min-h-9 rounded-md border border-stage-line bg-white/5 px-2 py-1 font-mono text-[11px] text-stage-muted hover:text-stage-ink sm:min-h-0">
                Reset view
              </button>
            )}
            <button type="button" aria-pressed={reduced} onClick={() => setReduced(!reduced)} className="min-h-9 rounded-md border border-stage-line bg-white/5 px-2 py-1 font-mono text-[11px] text-stage-muted hover:text-stage-ink sm:min-h-0">
              Effects {reduced ? "low" : "full"}
            </button>
          </div>
          </div>
          {preview ? (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 font-mono text-[11.5px] text-stage-muted sm:inset-x-5 sm:bottom-5">{STATE_META[preview].blurb}</div>
          ) : (
            overview && (
              <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex flex-wrap items-end justify-between gap-2 font-mono text-[11.5px] text-stage-muted sm:inset-x-5 sm:bottom-5">
                <span>
                  margin {formatBp(overview.rollingMarginBp)} · liquidity {formatCoverage(overview.reserveCoverageBp)} reserve
                </span>
                <span className="flex items-center gap-2">
                  {overview.activeModel && <span className="text-stage-ink/80">{overview.activeModel.label}</span>}
                  <span>· {overview.requestsWindow} req/h</span>
                  {!overview.simulated && (
                    <span className={cx("flex items-center gap-1", connection === "live" ? "text-g-400" : "text-df")}>
                      <span className={cx("h-1.5 w-1.5 rounded-full", connection === "live" ? "m-live-dot bg-g-400" : "bg-df")} />
                      {connection === "live" ? "live" : connection}
                    </span>
                  )}
                </span>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
