"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { useInView } from "motion/react";
import { useLive } from "@/lib/client/live";
import { exampleRouting } from "@/lib/economics/example-routing";
const Canvas = dynamic(() => import("./routing-canvas"), {
  ssr: false,
  loading: () => (
    <div className="ml-flow-canvas grid place-items-center text-sm text-muted">
      Loading the routing visual…
    </div>
  ),
});

export function RoutingPlayground() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { amount: 0.2 });
  const shouldMount = useInView(ref, { once: true, margin: "200px" });
  const reduced = useLive((s) => s.reducedEffects);
  const [paused, setPaused] = useState(false);
  const [stressed, setStressed] = useState(false);
  const [inspect, setInspect] = useState(0);
  const playing = !paused && visible && !reduced;
  const margin = Math.round(exampleRouting(stressed).models[inspect].marginBp / 100);
  return (
    <div ref={ref} className="ml-flow-shell" data-testid="routing-playground">
      <div className="ml-flow-toolbar">
        <div>
          <strong>A request finds its way.</strong>
          <p>Interactive example · figures are illustrative</p>
        </div>
        <div
          className="ml-flow-options"
          role="group"
          aria-label="Illustrative compute prices"
        >
          <button
            type="button"
            aria-pressed={!stressed}
            onClick={() => {
              setStressed(false);
              setInspect(0);
            }}
          >
            Normal costs
          </button>
          <button
            type="button"
            aria-pressed={stressed}
            onClick={() => {
              setStressed(true);
              setInspect(1);
            }}
          >
            Costs rise 2.4× ↗
          </button>
        </div>
      </div>
      {shouldMount ? <Canvas
        stressed={stressed}
        playing={playing}
        inspect={inspect}
        onInspect={setInspect}
      /> : <div className="ml-flow-canvas grid place-items-center text-[12px] text-muted">Follow the route as costs change.</div>}
      <div
        className="flex flex-wrap gap-2 border-t border-line px-5 py-3"
        role="group"
        aria-label="Inspect example model tiers"
      >
        {["Premium", "Standard", "Economy"].map((name, i) => (
          <button
            key={name}
            type="button"
            className="min-h-10 rounded-full border border-line px-3 text-[11px] aria-pressed:border-g-700 aria-pressed:bg-g-50 aria-pressed:text-g-700"
            aria-pressed={inspect === i}
            onClick={() => setInspect(i)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="ml-flow-summary">
        <p role="status">
          <strong>{["Premium", "Standard", "Economy"][inspect]}:</strong>{" "}
          {inspect === 0
            ? stressed
              ? "At −20% margin, it falls below the 30% example floor. The router moves to Standard."
              : "At 50% margin, it fits the example policy and can answer."
            : inspect === 1
              ? `At ${margin}% margin, it clears the example floor${stressed ? " and is selected when Premium becomes too costly" : "; Premium is currently preferred"}.`
              : `At ${margin}% margin, this lower-cost option remains available if the request and policy allow it.`}
        </p>
        <button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
          disabled={reduced}
        >
          {reduced ? "Motion reduced" : paused ? "▷ Play flow" : "Ⅱ Pause flow"}
        </button>
      </div>
    </div>
  );
}
