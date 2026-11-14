"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { OverviewDTO } from "@/lib/economics/types";
import { SessionProvider, useSession } from "@/lib/client/session";
import { useLive } from "@/lib/client/live";
import { api, streamNdjson } from "@/lib/client/api";
import { big, formatBp, formatCoverage, formatUsd } from "@/lib/economics/money";
import { useSimulation } from "@/components/m/stress-lab";
import { OrganismStage } from "@/components/organism/stage";
import { ReceiptCard, type ReceiptDTO } from "@/components/m/receipt";
import { ConnectWallet } from "@/components/m/wallet";
import { LogoMark } from "@/components/logo";
import { Button, SimChip, StateChip, cx } from "@/components/m/ui";

type Chapter = { title: string; caption: string; kind: "real" | "sim" };
const CHAPTERS: Chapter[] = [
  { title: "Meet it", caption: "This AI runs as a business. It holds a treasury, pays for its own models, and its operating state comes from its books.", kind: "real" },
  { title: "It thinks, it pays", caption: "A real request: the router prices every model first, answers, then bills actual usage. Cost, charge and the reason are shown.", kind: "real" },
  { title: "Costs spike", caption: "Simulated: providers suddenly bill 4× the price list. The router learns the real cost, margins collapse, and it downgrades.", kind: "sim" },
  { title: "Money runs out", caption: "Simulated: the treasury drains to below the hard reserve. Survival — the core collapses and unprofitable inference stops.", kind: "sim" },
  { title: "It recovers", caption: "Simulated: funding returns and prices normalise. Recovery first; abundance only after it holds steady.", kind: "sim" },
  { title: "Proof", caption: "Real: the business commits a hash of its books to NEAR. Anyone can recompute it and compare.", kind: "real" },
];
const CHAPTER_MS = 15_000;

export default function DemoPage() {
  return (
    <SessionProvider>
      <Demo />
    </SessionProvider>
  );
}

function Demo() {
  const { sim, act } = useSimulation();
  const overview = useLive((s) => s.overview);
  const [chapter, setChapter] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [real, setReal] = useState<OverviewDTO | null>(null);
  const applied = useRef<number>(-1);

  useEffect(() => {
    api<OverviewDTO>("/api/dashboard/overview").then(setReal).catch(() => {});
  }, []);

  // Apply each chapter's simulated action once when it starts.
  useEffect(() => {
    if (!sim || applied.current === chapter) return;
    applied.current = chapter;
    if (chapter === 0) void act({ type: "reset" });
    if (chapter === 2) void act({ type: "spike_cost", multiplier: 4 });
    if (chapter === 3) void act({ type: "drain_treasury" });
    if (chapter === 4) void act({ type: "spike_cost", multiplier: 1 }).then(() => act({ type: "restore_funding", usd: 60 }));
  }, [chapter, sim, act]);

  // Timeline.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setElapsed((e) => {
        const n = e + 100;
        if (n >= CHAPTER_MS) {
          setChapter((c) => {
            if (c >= CHAPTERS.length - 1) {
              setPlaying(false);
              return c;
            }
            return c + 1;
          });
          return 0;
        }
        return n;
      });
    }, 100);
    return () => clearInterval(t);
  }, [playing]);

  const go = useCallback((c: number) => {
    setChapter(Math.max(0, Math.min(CHAPTERS.length - 1, c)));
    setElapsed(0);
  }, []);
  const replay = useCallback(() => {
    applied.current = -1;
    go(0);
    setPlaying(true);
  }, [go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea")) return;
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        go(chapter + 1);
      }
      if (e.key === "ArrowLeft") go(chapter - 1);
      if (e.key.toLowerCase() === "r") replay();
      if (e.key.toLowerCase() === "p") setPlaying((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chapter, go, replay]);

  const ch = CHAPTERS[chapter];
  return (
    <div className="m-stage flex min-h-dvh flex-col">
      <header className="relative z-10 flex items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-[14px] font-semibold text-stage-ink"><LogoMark onDark size={22} /> Metabolic AI</Link>
        <span className="font-mono text-[11.5px] text-stage-muted">· guided demo</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="stage" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</Button>
          <Button size="sm" variant="stage" onClick={replay}>Replay</Button>
          <Link href="/console/stress-lab" className="hidden rounded-md px-2 py-1 text-[12px] text-stage-muted hover:text-stage-ink sm:inline">Manual control →</Link>
        </div>
      </header>

      <div className="relative z-10 grid flex-1 gap-4 px-4 pb-4 sm:px-6 lg:grid-cols-[1fr_400px]">
        <OrganismStage overview={overview} className="min-h-[52vh] border border-stage-line" label={<SimChip />} />
        <aside className="flex flex-col gap-3">
          <AnimatePresence mode="wait">
            <motion.div key={chapter} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }} className="rounded-2xl border border-stage-line bg-stage-2 p-5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11.5px] text-stage-muted">{chapter + 1}/{CHAPTERS.length}</span>
                <span className={cx("rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", ch.kind === "real" ? "bg-g-400/15 text-g-400" : "border border-dashed border-sim text-[#b6a2ff]")}>
                  {ch.kind === "real" ? "Real" : "Simulated"}
                </span>
              </div>
              <h1 className="mt-3 font-serif text-[34px] leading-[38px] text-stage-ink">{ch.title}</h1>
              <p className="mt-2 text-[14.5px] leading-6 text-stage-muted">{ch.caption}</p>
            </motion.div>
          </AnimatePresence>
          <div className="flex-1 rounded-2xl border border-stage-line bg-stage-2 p-5 text-stage-ink">
            {chapter === 0 && <RealSummary o={real} />}
            {chapter === 1 && <RealInference />}
            {chapter >= 2 && chapter <= 4 && <SimSummary o={overview} />}
            {chapter === 5 && <Proof />}
          </div>
        </aside>
      </div>

      <nav className="relative z-10 grid grid-cols-6 gap-1.5 px-4 pb-5 sm:px-6" aria-label="Chapters">
        {CHAPTERS.map((c, i) => (
          <button key={c.title} type="button" onClick={() => go(i)} className="group text-left" aria-current={i === chapter}>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className={cx("h-full", c.kind === "real" ? "bg-g-400" : "bg-sim")} style={{ width: i < chapter ? "100%" : i === chapter ? `${(elapsed / CHAPTER_MS) * 100}%` : "0%" }} />
            </div>
            <div className={cx("mt-1.5 hidden truncate text-[11.5px] sm:block", i === chapter ? "text-stage-ink" : "text-stage-muted group-hover:text-stage-ink")}>{c.title}</div>
          </button>
        ))}
      </nav>
      <p className="relative z-10 pb-3 text-center font-mono text-[10.5px] text-stage-muted">Space / → next · ← back · P pause · R replay</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-stage-line py-2 text-[13.5px] last:border-0">
      <span className="text-stage-muted">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

function RealSummary({ o }: { o: OverviewDTO | null }) {
  if (!o) return <p className="text-[13px] text-stage-muted">Loading the real economy…</p>;
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-g-400">Real · NEAR {o.network}</div>
      <Row k="Treasury" v={formatUsd(big(o.treasury))} />
      <Row k="Revenue earned" v={formatUsd(big(o.revenueTotal))} />
      <Row k="Margin (1h)" v={formatBp(o.rollingMarginBp)} />
      <Row k="Liquidity" v={`${formatCoverage(o.reserveCoverageBp)} reserve`} />
      <Row k="State" v={<StateChip state={o.state} onStage />} />
      <p className="mt-3 text-[12px] text-stage-muted">The organism on the left runs the demo scenario: an isolated simulated economy that starts healthy.</p>
    </div>
  );
}

function SimSummary({ o }: { o: OverviewDTO | null }) {
  if (!o) return null;
  return (
    <div>
      <div className="mb-2"><SimChip /></div>
      <Row k="State" v={<StateChip state={o.state} onStage />} />
      <Row k="Model" v={o.activeModel?.label ?? "refusing requests"} />
      <Row k="Liquidity" v={formatUsd(big(o.liquidity))} />
      <Row k="Coverage" v={formatCoverage(o.reserveCoverageBp)} />
      <Row k="Margin (window)" v={formatBp(o.rollingMarginBp)} />
      {o.lastDecision && <p className="mt-3 rounded-lg bg-white/5 p-3 text-[12.5px] leading-5 text-stage-ink/90">{o.lastDecision.explanation}</p>}
    </div>
  );
}

function RealInference() {
  const { me } = useSession();
  const [q, setQ] = useState("In one sentence: why would an AI choose a cheaper model?");
  const [answer, setAnswer] = useState("");
  const [final, setFinal] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me?.user) {
    return (
      <div className="space-y-3 text-[13.5px] text-stage-muted">
        <p>Sign in with a NEAR testnet wallet that has credits to run a real request here.</p>
        <ConnectWallet size="sm" variant="stage" />
        <p className="text-[12px]">No wallet handy? Continue — the next chapters are simulated.</p>
      </div>
    );
  }
  const ask = async () => {
    setBusy(true);
    setAnswer("");
    setFinal(null);
    setError(null);
    try {
      await streamNdjson<Record<string, unknown> & { type: string }>("/api/chat", { message: q, idempotencyKey: crypto.randomUUID() }, (ev) => {
        if (ev.type === "text") setAnswer((a) => a + (ev.text as string));
        if (ev.type === "final") setFinal(ev);
        if (ev.type === "error") setError(ev.message as string);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-g-400">Real request</div>
      <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} className="w-full resize-none rounded-lg border border-stage-line bg-white/5 p-2.5 text-[13.5px] text-stage-ink outline-none focus:border-g-400" aria-label="Question" />
      <Button size="sm" variant="green" onClick={ask} loading={busy}>Ask</Button>
      {answer && <p className="text-[13.5px] leading-6 text-stage-ink">{answer}</p>}
      {final && (
        <div className="rounded-lg bg-white/5 p-3 font-mono text-[11.5px] leading-5 text-stage-muted">
          {String(final.model).split(":").pop()} · {String(final.inTokens)} in / {String(final.outTokens)} out
          <br />cost {formatUsd(big(final.cost as string))}{final.costIsEstimated ? " (est.)" : ""} · paid {formatUsd(big(final.charge as string))} · margin {formatBp(final.marginBp as number)}
          <br /><span className="font-sans text-stage-ink/80">{String(final.explanation)}</span>
        </div>
      )}
      {error && <p className="text-[12.5px] text-sv">{error}</p>}
    </div>
  );
}

function Proof() {
  const { me, config } = useSession();
  const [receipts, setReceipts] = useState<ReceiptDTO[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ receipts: ReceiptDTO[] }>("/api/receipts").then((r) => setReceipts(r.receipts)).catch(() => setReceipts([]));
  useEffect(() => {
    void load();
  }, []);
  const latest = receipts?.find((r) => r.status === "finalized");
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-g-400">Real · on chain</div>
      {latest ? (
        <>
          <ReceiptCard r={latest} />
          <p className="text-[12px] text-stage-muted">Committed {new Date(latest.finalizedAt ?? latest.createdAt).toLocaleString()}.</p>
        </>
      ) : (
        <p className="text-[13px] text-stage-muted">{receipts === null ? "Loading…" : "No finalized receipt yet."}</p>
      )}
      {me?.user && config?.receipts.ok && (
        <Button
          size="sm"
          variant="green"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await api<{ receiptId: string }>("/api/receipts", { method: "POST" });
              setMsg(`Receipt ${r.receiptId} finalized.`);
              await load();
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Publish a receipt now
        </Button>
      )}
      {!config?.receipts.ok && <p className="text-[12px] text-stage-muted">On-chain receipts not configured: {config?.receipts.reason}.</p>}
      {msg && <p className="text-[12.5px] text-stage-ink">{msg}</p>}
      {latest && <Link href={`/verify?id=${latest.id}`} className="inline-block text-[13px] font-semibold text-g-400 hover:underline">Verify it yourself →</Link>}
    </div>
  );
}
