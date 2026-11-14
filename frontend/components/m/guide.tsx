"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OperatingState } from "@/lib/economics/types";
import { cx, StateChip } from "./ui";

// Plain-language help for people seeing Metabolic AI for the first time.

export const GLOSSARY = {
  treasury: "All the money the business holds, from deposits. Some of it belongs to customers as unused credit.",
  revenue: "Money the business has actually earned: credit that customers spent on answers. Deposits don't count until they're used.",
  spend: "What the business paid AI providers (Anthropic, Google, …) to generate answers.",
  margin: "Of every dollar earned in the last hour, how much was left after paying for the AI. Higher is healthier.",
  runway: "How long the business could keep running at today's losses before hitting its safety reserve.",
  state: "The business's mood, decided by its finances: Abundance, Defensive, Survival or Recovery. It changes which AI models it allows itself to use.",
  liquidity: "Money that is really the business's own: treasury minus what it owes customers and providers.",
  reserve: "A safety cushion it never spends on AI. Hitting it puts the business into Survival.",
  credits: "Your prepaid balance. Each answer is paid from it; unused credit stays yours.",
  tier: "Premium, Standard or Economy — how capable (and expensive) the AI model is.",
} as const;

/** A small "?" that explains a term in plain words. Hover, focus or tap. */
export function Hint({ term, className }: { term: keyof typeof GLOSSARY; className?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 64 });
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(12, Math.min(rect.left + rect.width / 2 - 120, window.innerWidth - 252)), top: rect.bottom + 100 > window.innerHeight ? Math.max(12, rect.top - 100) : rect.bottom + 8 });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    const dismiss = () => setOpen(false);
    const reposition = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(12, Math.min(rect.left + rect.width / 2 - 120, window.innerWidth - 252)), top: rect.bottom + 100 > window.innerHeight ? Math.max(12, rect.top - 100) : rect.bottom + 8 });
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <span ref={ref} className={cx("relative inline-flex align-middle", className)} onMouseEnter={show} onMouseLeave={() => { if (!ref.current?.contains(document.activeElement)) setOpen(false); }}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={`What is ${term}?`}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={show}
        className="grid h-6 w-6 place-items-center rounded-full border border-line-strong text-[9.5px] font-bold normal-case tracking-normal text-muted hover:border-g-500 hover:text-g-700 sm:h-4 sm:w-4"
      >
        ?
      </button>
      {open && createPortal(
        <span role="tooltip" id={id} style={position} className="fixed z-40 w-[min(240px,calc(100vw-24px))] rounded-lg border border-line bg-ink px-3 py-2 text-left text-[12px] font-normal normal-case leading-[18px] tracking-normal text-white shadow-[0_10px_30px_rgba(14,20,16,.25)]">
          {GLOSSARY[term]}
        </span>, document.body
      )}
    </span>
  );
}

export const STATE_PLAIN: Record<OperatingState, string> = {
  ABUNDANCE: "healthy, uses the best models",
  DEFENSIVE: "tightening up, prefers cheaper models",
  SURVIVAL: "out of spare money, stops costly work",
  RECOVERY: "money is back, rebuilding carefully",
};

export const STATE_GUIDANCE: Record<OperatingState, { title: string; description: string }> = {
  ABUNDANCE: { title: "Healthy enough to use stronger models", description: "Margins and available funds are healthy. Premium, Standard and Economy models can be considered when the request fits the budget." },
  DEFENSIVE: { title: "Saving money while continuing to answer", description: "Margins or available funds are getting tight. The router favors cheaper models to reduce spending." },
  SURVIVAL: { title: "Protecting the safety reserve", description: "Available funds have reached the reserve limit. Paid work is blocked when it cannot be funded safely. Add funds to begin recovering." },
  RECOVERY: { title: "Funding is back; capacity returns gradually", description: "The business waits for its finances to stay healthy before opening up more expensive models again. This prevents rapid switching between states." },
};

export function StateGuide({ state }: { state?: OperatingState }) {
  return (
    <details className="rounded-xl border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-ink">What do the four operating states mean?</summary>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {(Object.keys(STATE_GUIDANCE) as OperatingState[]).map((key) => (
          <div key={key} className={cx("rounded-lg p-3", state === key ? "bg-paper-sunken ring-1 ring-line-strong" : "bg-paper/50")}>
            <div className="flex flex-wrap items-center gap-2"><StateChip state={key} />{state === key && <span className="text-[11px] text-muted">Current state</span>}</div>
            <p className="mt-2 text-[13px] font-medium">{STATE_GUIDANCE[key].title}</p>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-2">{STATE_GUIDANCE[key].description}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
