"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { OperatingState } from "@/lib/economics/types";
import { useLive, useRealFeed, STATE_META } from "@/lib/client/live";
import { api } from "@/lib/client/api";
import { big, formatBp, formatUsd } from "@/lib/economics/money";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { OrganismStage } from "@/components/organism/stage";
import { OrganismFallback } from "@/components/organism/fallback";
import { ReceiptCard, type ReceiptDTO } from "./receipt";
import { AdaptArt, EarnArt, SpendArt, SurviveArt } from "./landing-art";
import { ButtonLink, StateChip, cx } from "./ui";

const fade = { initial: { opacity: 0, y: 12 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } };

export function Landing() {
  useRealFeed();
  const overview = useLive((s) => s.overview);
  const reduce = useReducedMotion();
  const [receipt, setReceipt] = useState<ReceiptDTO | null>(null);
  const [preview, setPreview] = useState<OperatingState | null>(null);
  const [providers, setProviders] = useState<{ provider: string; configured: boolean }[]>([]);
  useEffect(() => {
    api<{ receipts: ReceiptDTO[] }>("/api/receipts").then((r) => setReceipt(r.receipts.find((x) => x.status === "finalized") ?? null)).catch(() => {});
    api<{ providers: { provider: string; configured: boolean }[] }>("/api/public/config").then((c) => setProviders(c.providers)).catch(() => {});
  }, []);

  return (
    <div className="m-app">
      <Nav />
      <main>
        {/* HERO */}
        <section className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 pb-14 pt-10 sm:px-6 lg:grid-cols-2 lg:pt-16">
          <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
            <div className="m-label flex items-center gap-2 text-g-700">
              <span className="m-live-dot h-2 w-2 rounded-full bg-g-500" /> Live on NEAR {overview?.network ?? "testnet"}
            </div>
            <h1 className="mt-5 font-serif text-[46px] leading-[48px] tracking-[-0.02em] text-ink sm:text-[64px] sm:leading-[64px] xl:text-[76px] xl:leading-[74px]">
              An AI that pays
              <br />
              to stay alive.
            </h1>
            <p className="mt-6 max-w-[540px] text-[17px] leading-[29px] text-ink-2 sm:text-[18px] sm:leading-[30px]">
              Metabolic AI earns from every request, pays for its own models out of a NEAR treasury, and changes how it thinks when money gets tight. Every decision is logged, explained, and committed on chain.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/console" size="lg" variant="green">Launch app →</ButtonLink>
              <ButtonLink href="/demo" size="lg" variant="secondary">Watch it adapt</ButtonLink>
            </div>
            <p className="mt-4 text-[13px] text-muted">Real NEAR deposits · Real inference · Simulations clearly labelled</p>
          </motion.div>
          <div>
            <OrganismStage overview={overview} previewState={preview} className="aspect-[1/1.02] w-full" />
            <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Organism view">
              <span className="mr-1 text-[12.5px] text-muted">See its moods:</span>
              {([null, "ABUNDANCE", "DEFENSIVE", "SURVIVAL", "RECOVERY"] as (OperatingState | null)[]).map((s) => (
                <button
                  key={s ?? "live"}
                  type="button"
                  aria-pressed={preview === s}
                  onClick={() => setPreview(s)}
                  className={cx(
                    "rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors",
                    preview === s ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
                  )}
                >
                  {s === null ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="m-live-dot h-1.5 w-1.5 rounded-full bg-g-500" /> Live now
                    </span>
                  ) : (
                    STATE_META[s].label
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* LIVE STATS */}
        <section className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="grid grid-cols-2 border-t border-line py-8 md:grid-cols-4">
            {[
              ["Treasury", overview ? formatUsd(big(overview.treasury)) : "—"],
              ["Revenue earned", overview ? formatUsd(big(overview.revenueTotal)) : "—"],
              ["Margin, last hour", overview ? formatBp(overview.rollingMarginBp) : "—"],
              ["Operating state", overview ? STATE_META[overview.state].label : "—"],
            ].map(([k, v], i) => (
              <div key={k} className={cx("px-2 py-3 text-center", i > 0 && "md:border-l md:border-line", i % 2 === 1 && "border-l border-line md:border-l")}>
                <div className="font-serif text-[30px] leading-9 text-ink sm:text-[36px] sm:leading-[42px]">{v}</div>
                <div className="mt-1 text-[13px] text-muted">{k}</div>
              </div>
            ))}
          </div>
          <p className="pb-2 text-center text-[12px] text-muted">Live figures from the business&apos;s own ledger. “—” means not loaded yet, never a made-up number.</p>
        </section>

        {/* IN PLAIN WORDS */}
        <section className="mx-auto max-w-[1200px] px-4 pb-6 pt-10 sm:px-6">
          <div className="rounded-[24px] border border-line bg-surface p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="m-label text-g-700">In plain words</div>
                <h2 className="mt-2 font-serif text-[30px] leading-9 sm:text-[34px] sm:leading-[40px]">Think of it as a tiny company run by an AI.</h2>
              </div>
              <ButtonLink href="/login" variant="green">Try it — sign in</ButtonLink>
            </div>
            <ol className="mt-7 grid gap-6 md:grid-cols-3">
              {[
                ["You add a little credit", "Sign in with a NEAR wallet and deposit a few testnet NEAR. That's your prepaid balance.", "💳"],
                ["You ask, it answers", "Before answering, it checks which AI models it can afford. You see the price, the model, and the reason.", "💬"],
                ["It minds its own money", "If AI prices jump or money runs low, it switches to cheaper models — or pauses costly work until it's funded again.", "🌱"],
              ].map(([t, d, icon], i) => (
                <li key={t} className="flex gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-g-50 text-[20px]" aria-hidden>{icon}</span>
                  <div>
                    <div className="font-mono text-[11.5px] text-muted">Step {i + 1}</div>
                    <div className="text-[16px] font-semibold text-ink">{t}</div>
                    <p className="mt-1 text-[14px] leading-[22px] text-ink-2">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* BUILT WITH */}
        <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
          <div className="m-label text-center text-muted">Built with</div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-[19px] font-semibold tracking-tight text-ink-2">
            <span>NEAR Protocol</span>
            {providers.filter((p) => p.configured).map((p) => (
              <span key={p.provider} className="capitalize">{p.provider === "llama" ? "Llama" : p.provider === "deepseek" ? "DeepSeek" : "Anthropic"}</span>
            ))}
            <span>Three.js</span>
          </div>
        </section>

        {/* LOOP */}
        <section id="how" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 py-20 sm:px-6">
          <motion.div {...fade}>
            <div className="m-label text-g-700">How it works</div>
            <h2 className="mt-3 max-w-2xl font-serif text-[38px] leading-[44px] tracking-[-0.01em] sm:text-[46px] sm:leading-[52px]">Earn. Spend. Adapt. Survive.</h2>
            <p className="mt-3 max-w-2xl text-[16px] leading-7 text-ink-2">One loop, run by fixed rules you can read — the AI never decides how to spend the money.</p>
          </motion.div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Earn", "People prepay with NEAR. A deposit is credit they own; it only becomes the business's income as they use it.", <EarnArt key="a" />],
                ["Spend", "Every answer has a price. You see what the AI cost, what you paid, and what the business kept.", <SpendArt key="a" />],
                ["Adapt", "Before answering, it prices every AI model and picks the best one it can afford, with the reason in one sentence.", <AdaptArt key="a" />],
                ["Survive", "If its own money falls to the safety reserve, costly work stops. Funding brings it back, step by step.", <SurviveArt key="a" />],
              ] as [string, string, React.ReactNode][]
            ).map(([t, d, art], i) => (
              <motion.div key={t} {...fade} transition={{ ...fade.transition, delay: i * 0.05 }} className="overflow-hidden rounded-[20px] border border-line bg-surface">
                {art}
                <div className="p-5">
                  <div className="font-mono text-[12px] text-muted">0{i + 1}</div>
                  <h3 className="mt-1 text-[18px] font-semibold">{t}</h3>
                  <p className="mt-2 text-[14px] leading-[22px] text-ink-2">{d}</p>
                </div>
              </motion.div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-muted">The figures inside these cards are examples of what the real screens show.</p>
        </section>

        {/* MARGIN CARD */}
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <MarginCard />
          <motion.div {...fade}>
            <div className="m-label text-g-700">Before it thinks</div>
            <h2 className="mt-3 font-serif text-[38px] leading-[44px] sm:text-[44px] sm:leading-[50px]">It does the math first.</h2>
            <p className="mt-4 text-[16px] leading-7 text-ink-2">Every capable model is priced for the request. The policy removes any that would run below the current state&apos;s margin floor or above its cost cap, then picks the best value that remains.</p>
            <ul className="mt-6 space-y-3 text-[15px] text-ink">
              {["Estimated cost shown before you send", "Actual cost shown after, from provider-reported usage", "One written reason for every routing choice", "Estimated values are always marked est."].map((x) => (
                <li key={x} className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-g-500" />
                  {x}
                </li>
              ))}
            </ul>
          </motion.div>
        </section>

        {/* STATES */}
        <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <motion.div {...fade}>
            <div className="m-label text-g-700">Operating states</div>
            <h2 className="mt-3 font-serif text-[38px] leading-[44px] sm:text-[44px] sm:leading-[50px]">Four moods, all earned.</h2>
          </motion.div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(STATE_META) as OperatingState[]).map((s) => (
              <div key={s} className="overflow-hidden rounded-[20px] bg-stage text-stage-ink">
                <div className="grid aspect-[1/0.8] place-items-center"><div className="h-[85%] w-[85%]"><OrganismFallback state={s} /></div></div>
                <div className="border-t border-stage-line bg-stage-2 p-5">
                  <StateChip state={s} onStage />
                  <p className="mt-3 text-[13.5px] leading-[21px] text-stage-muted">{STATE_META[s].blurb}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* PROOF */}
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <motion.div {...fade}>
            <div className="m-label text-g-700">On the record</div>
            <h2 className="mt-3 font-serif text-[38px] leading-[44px] sm:text-[44px] sm:leading-[50px]">Every decision, inspectable. The books, verifiable.</h2>
            <ul className="mt-6 space-y-3 text-[15px] text-ink">
              <li className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-g-500" />Deposits are credited only after the server checks the finalized transaction on NEAR.</li>
              <li className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-g-500" />Economic receipts commit a hash of each interval&apos;s books to a NEAR contract.</li>
              <li className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-g-500" />Anyone can recompute that hash and compare it on chain.</li>
            </ul>
            <div className="mt-8"><ButtonLink href="/verify" variant="ink">Verify a receipt →</ButtonLink></div>
          </motion.div>
          <div className="rounded-[28px] bg-stage p-6 sm:p-8">
            {receipt ? (
              <ReceiptCard r={receipt} />
            ) : (
              <div className="rounded-xl border border-dashed border-stage-line p-6 text-[13.5px] text-stage-muted">The latest finalized receipt appears here once the business commits one on NEAR.</div>
            )}
            <p className="mt-4 text-[12.5px] leading-5 text-stage-muted">NEAR proves deposits and receipt commitments. It does not prove an AI provider was paid — that comes from provider usage records and reconciliation.</p>
          </div>
        </section>

        {/* ARCHITECTURE */}
        <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <motion.div {...fade}>
            <div className="m-label text-g-700">Architecture</div>
            <h2 className="mt-3 font-serif text-[38px] leading-[44px] sm:text-[44px] sm:leading-[50px]">Where the money and the thinking flow.</h2>
          </motion.div>
          <Architecture />
        </section>

        {/* STRESS BAND */}
        <section className="m-stage">
          <div className="relative z-10 mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <h2 className="font-serif text-[40px] leading-[46px] sm:text-[52px] sm:leading-[56px]">Break it on purpose.</h2>
              <p className="mt-4 max-w-lg text-[16px] leading-7 text-stage-muted">Spike compute prices, drain the treasury, take a provider down. The Stress Lab runs the real policy engine on an isolated, clearly labelled simulated economy — and the organism reacts.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/demo" size="lg" variant="green">Start the 90-second demo</ButtonLink>
                <ButtonLink href="/console/stress-lab" size="lg" variant="stage">Open the Stress Lab</ButtonLink>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(["DEFENSIVE", "SURVIVAL", "RECOVERY"] as OperatingState[]).map((s, i) => (
                <div key={s} className="rounded-2xl border border-stage-line bg-white/[0.03] p-3 text-center">
                  <div className="mx-auto h-20 w-20"><OrganismFallback state={s} filaments={false} /></div>
                  <div className="mt-2 font-mono text-[11px] text-stage-muted">{["Spike compute", "Drain treasury", "Restore funding"][i]}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-[860px] px-4 py-20 sm:px-6">
          <h2 className="font-serif text-[38px] leading-[44px]">Questions</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {[
              ["What is real and what is simulated?", "Deposits, AI requests, costs, routing decisions, state changes and receipts in the console are real (on NEAR testnet). The Stress Lab and the guided demo run an isolated simulated economy through the same policy code; every simulated number carries a violet SIMULATED label and none of it touches the real ledger."],
              ["Does an AI decide how to spend the money?", "No. A deterministic, versioned policy engine decides the operating state and which models are allowed. Models only answer questions."],
              ["Why would the AI choose a worse model?", "Only when the better one would cost more than the business can afford at that moment — for example below its margin floor in Defensive, or above the per-request cap in Survival. The reason is shown with every answer."],
              ["Are customer deposits revenue?", "No. Deposits are prepaid credit, a liability. Revenue is recognised only when a request completes and its actual usage is billed."],
              ["What does a receipt prove?", "That a given interval's aggregate revenue, compute spend, margin and ledger root were committed at that time and haven't changed. It doesn't prove a provider was paid; that's in the provider usage records."],
              ["Can I use it from code?", "Yes — create an API key in the console and call /api/v1/inference. Responses include the routing explanation and billing."],
            ].map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-ink">
                  {q}
                  <span className="text-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-7 text-ink-2">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function MarginCard() {
  const [tokens, setTokens] = useState(2400);
  const spike = 2.4;
  // Illustrative per-1M prices (USD): list cost × spike vs sell price. Labelled as an example.
  const tiers = [
    { n: "Premium", c: 4 * spike, co: 20 * spike, s: 8, so: 40, col: "#0e1410" },
    { n: "Standard", c: 2 * spike, co: 10 * spike, s: 4 * 1.6, so: 20 * 1.6, col: "#0a6b44" },
    { n: "Economy", c: 0.1 * spike, co: 0.5 * spike, s: 0.4, so: 2, col: "#12b36e" },
  ];
  const floor = 30;
  const out = Math.round(tokens * 0.6);
  const rows = tiers.map((t) => {
    const cost = (tokens * t.c + out * t.co) / 1e6;
    const charge = (tokens * t.s + out * t.so) / 1e6;
    return { ...t, cost, charge, m: Math.round(((charge - cost) / charge) * 100) };
  });
  const chosen = rows.find((r) => r.m >= floor);
  const maxCost = Math.max(...rows.map((r) => r.cost));
  return (
    <motion.div {...fade} className="rounded-[20px] border border-line bg-surface p-6 sm:p-7">
      <div className="flex items-center justify-between">
        <span className="m-label text-muted">A request of</span>
        <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">Illustrative</span>
      </div>
      <div className="mt-1 font-serif text-[44px] leading-[52px]">
        {tokens.toLocaleString()} <span className="text-[22px] text-muted">tokens</span>
      </div>
      <input type="range" min={200} max={12000} step={100} value={tokens} onChange={(e) => setTokens(Number(e.target.value))} className="mt-3 w-full accent-[#0a6b44]" aria-label="Request size in tokens" />
      <div className="mt-4 divide-y divide-line border-t border-line">
        {rows.map((r) => (
          <div key={r.n} className="grid grid-cols-[100px_1fr_56px_20px] items-center gap-3 py-3 text-[14px]">
            <span>
              <b className="font-semibold">{r.n}</b>
              <br />
              <span className="font-mono text-[11.5px] text-muted">${r.cost.toFixed(4)} cost</span>
            </span>
            <span className="h-2.5 rounded-full" style={{ width: `${(r.cost / maxCost) * 100}%`, background: r.col, opacity: r.m >= floor ? 1 : 0.3 }} />
            <span className="text-right font-mono">{r.m}%</span>
            <span className={r.m >= floor ? "text-g-700" : "text-sv-text"}>{r.m >= floor ? "✓" : "✕"}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-ink px-4 py-3 text-[14px] text-white">
        {chosen ? (
          <>Routed to <b className="text-g-400">{chosen.n}</b> — premium would run at {rows[0].m}% margin, under the {floor}% floor.</>
        ) : (
          "Request declined — no tier clears the floor."
        )}
      </div>
      <p className="mt-3 text-[12px] text-muted">Example with a 2.4× compute-cost spike and a 30% floor. Live prices are on the Models page.</p>
    </motion.div>
  );
}

function Architecture() {
  const box = (x: number, y: number, w: number, title: string, sub: string, dark = false) => (
    <g>
      <rect x={x} y={y} width={w} height="58" rx="12" fill={dark ? "var(--m-stage)" : "var(--m-surface)"} stroke={dark ? "none" : "var(--m-line)"} />
      <text x={x + w / 2} y={y + 25} textAnchor="middle" fontSize="13.5" fontWeight="600" fill={dark ? "#e8f1eb" : "var(--m-ink)"}>{title}</text>
      <text x={x + w / 2} y={y + 43} textAnchor="middle" fontSize="11" fill={dark ? "#8c9a90" : "var(--m-muted)"} fontFamily="var(--font-geist-mono)">{sub}</text>
    </g>
  );
  const arrow = (d: string, green = false) => <path d={d} fill="none" stroke={green ? "#12b36e" : "var(--m-line-strong)"} strokeWidth="1.6" markerEnd={green ? "url(#ag)" : "url(#an)"} />;
  return (
    <div className="mt-8 overflow-x-auto rounded-[20px] border border-line bg-paper-sunken/50 p-4 sm:p-6">
      <svg viewBox="0 0 1100 330" className="min-w-[860px]" role="img" aria-label="Architecture: wallet deposits to NEAR contract, verified into the ledger; requests are priced by the policy engine and routed to AI providers; receipts are committed back to NEAR.">
        <defs>
          <marker id="an" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--m-line-strong)" /></marker>
          <marker id="ag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#12b36e" /></marker>
        </defs>
        {box(20, 40, 170, "NEAR wallet", "signs deposits")}
        {box(250, 40, 190, "metabolic contract", "deposit · commit_receipt", true)}
        {box(500, 40, 190, "Deposit verifier", "finality · signer · amount")}
        {box(750, 40, 170, "Ledger", "double-entry, append-only")}
        {box(20, 200, 170, "Customer request", "workspace or API")}
        {box(250, 200, 190, "Policy engine", "state · margin · caps", true)}
        {box(500, 200, 190, "Router", "capability · cost · health")}
        {box(750, 200, 170, "AI providers", "Anthropic · DeepSeek · …")}
        {box(960, 120, 120, "Receipts", "hash → NEAR")}
        {arrow("M190 69 H246", true)}
        {arrow("M440 69 H496", true)}
        {arrow("M690 69 H746", true)}
        {arrow("M190 229 H246")}
        {arrow("M440 229 H496")}
        {arrow("M690 229 H746")}
        {arrow("M835 98 V196")}
        {arrow("M835 196 V102")}
        {arrow("M920 69 C 960 69, 1000 80, 1018 116", true)}
        {arrow("M1018 178 C 1000 300, 400 320, 345 102", true)}
        {arrow("M790 98 C 700 150, 420 150, 345 196")}
        <text x="560" y="140" fontSize="11" fill="var(--m-muted)" fontFamily="var(--font-geist-mono)">liquidity, margin → state</text>
        <text x="836" y="150" fontSize="11" fill="var(--m-muted)" fontFamily="var(--font-geist-mono)"> usage → cost</text>
      </svg>
      <p className="mt-3 text-[12.5px] text-muted">Green paths touch NEAR. Provider bills are proven by usage records, not by the chain.</p>
    </div>
  );
}

