"use client";

import { motion } from "motion/react";

// Small UI vignettes for the "how it works" cards on the landing page. They
// mirror what the real screens show; numbers are examples and labelled so.

const card = "rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(14,20,16,.05),0_10px_24px_rgba(14,20,16,.06)]";
const rise = { initial: { opacity: 0, y: 10 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-40px" } };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-[214px] place-items-center overflow-hidden bg-gradient-to-b from-paper-sunken to-[#e4e3d9] px-5">{children}</div>
  );
}

/** Earn: a deposit becoming credit, verified on chain. */
export function EarnArt() {
  return (
    <Frame>
      <motion.div {...rise} transition={{ duration: 0.5 }} className={`${card} w-full max-w-[230px] p-4`}>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Deposit</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-serif text-[30px] leading-9 text-ink">2.00</span>
          <span className="font-mono text-[12px] text-muted">NEAR</span>
          <span className="ml-auto font-mono text-[13px] font-medium text-g-700">+$6.64</span>
        </div>
        <div className="mt-3 flex items-center">
          {["Signed", "On chain", "Credited"].map((s, i) => (
            <div key={s} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span className={`h-px flex-1 ${i === 0 ? "bg-transparent" : "bg-g-500"}`} />
                <motion.span
                  initial={{ scale: 0 }}
                  whileInView={{ scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.25, type: "spring", stiffness: 420, damping: 22 }}
                  className="grid h-5 w-5 place-items-center rounded-full bg-g-700 text-[10px] font-bold text-white"
                >
                  ✓
                </motion.span>
                <span className={`h-px flex-1 ${i === 2 ? "bg-transparent" : "bg-g-500"}`} />
              </div>
              <span className="mt-1 text-[10.5px] text-ink-2">{s}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </Frame>
  );
}

/** Spend: the price of one answer, shown before and after. */
export function SpendArt() {
  const rows: [string, string, boolean?][] = [
    ["AI cost", "$0.0081"],
    ["You pay", "$0.0162"],
    ["It keeps", "50%", true],
  ];
  return (
    <Frame>
      <motion.div {...rise} transition={{ duration: 0.5 }} className={`${card} w-full max-w-[230px] p-4`}>
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">This answer</span>
          <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-white">Premium</span>
        </div>
        <div className="mt-2 divide-y divide-line">
          {rows.map(([k, v, strong]) => (
            <div key={k} className="flex items-center justify-between py-1.5 text-[13px]">
              <span className="text-ink-2">{k}</span>
              <span className={`font-mono ${strong ? "font-semibold text-g-700" : "text-ink"}`}>{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-sunken">
          <motion.div initial={{ width: 0 }} whileInView={{ width: "50%" }} viewport={{ once: true }} transition={{ delay: 0.4, duration: 0.7, ease: [0.2, 0, 0, 1] }} className="h-full rounded-full bg-g-500" />
        </div>
      </motion.div>
    </Frame>
  );
}

/** Adapt: three candidate models, one chosen, with the reason. */
export function AdaptArt() {
  const models: [string, string, "no" | "yes" | "ok"][] = [
    ["Premium", "12%", "no"],
    ["Standard", "44%", "yes"],
    ["Economy", "71%", "ok"],
  ];
  return (
    <Frame>
      <div className="w-full max-w-[236px] space-y-1.5">
        {models.map(([name, margin, v], i) => (
          <motion.div
            key={name}
            {...rise}
            transition={{ duration: 0.4, delay: i * 0.12 }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${v === "yes" ? "border-g-500 bg-surface shadow-[0_6px_18px_rgba(18,179,110,.18)]" : "border-line bg-surface/70"} ${v === "no" ? "opacity-55" : ""}`}
          >
            <span className={`font-semibold ${v === "no" ? "text-ink-2 line-through decoration-sv-text/60" : "text-ink"}`}>{name}</span>
            <span className="ml-auto font-mono text-[12px] text-muted">keeps {margin}</span>
            <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold ${v === "yes" ? "bg-g-700 text-white" : v === "no" ? "bg-sv-tint text-sv-text" : "bg-paper-sunken text-muted"}`}>
              {v === "yes" ? "✓" : v === "no" ? "✕" : "·"}
            </span>
          </motion.div>
        ))}
        <motion.div {...rise} transition={{ duration: 0.4, delay: 0.45 }} className="rounded-lg bg-ink px-3 py-2 text-[11.5px] leading-4 text-white">
          Chose <b className="text-g-400">Standard</b>: Premium would keep under 30%.
        </motion.div>
      </div>
    </Frame>
  );
}

/** Survive: money versus the safety reserve, and the moods it moves through. */
export function SurviveArt() {
  return (
    <Frame>
      <motion.div {...rise} transition={{ duration: 0.5 }} className={`${card} w-full max-w-[236px] p-4`}>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Its own money</div>
        <div className="relative mt-3 h-3 rounded-full bg-paper-sunken">
          <motion.div
            initial={{ width: "70%", backgroundColor: "#12b36e" }}
            whileInView={{ width: ["70%", "14%", "14%", "58%"], backgroundColor: ["#12b36e", "#f0525e", "#f0525e", "#6c8cff"] }}
            viewport={{ once: true }}
            transition={{ duration: 3.4, times: [0, 0.35, 0.6, 1], delay: 0.3, ease: "easeInOut" }}
            className="h-full rounded-full"
          />
          <span className="absolute -top-1 bottom-[-4px] left-[22%] w-px bg-sv-text" />
          <span className="absolute left-[22%] top-5 -translate-x-1/2 whitespace-nowrap font-mono text-[9.5px] text-sv-text">safety reserve</span>
        </div>
        <div className="mt-7 flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.06em]">
          <span className="rounded-full bg-sv-tint px-2 py-0.5 text-sv-text">Survival</span>
          <span className="text-muted">→</span>
          <span className="rounded-full bg-rc-tint px-2 py-0.5 text-rc-text">Recovery</span>
          <span className="text-muted">→</span>
          <span className="rounded-full bg-ab-tint px-2 py-0.5 text-ab-text">Healthy</span>
        </div>
      </motion.div>
    </Frame>
  );
}
