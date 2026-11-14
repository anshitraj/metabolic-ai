"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { OperatingState, OverviewDTO } from "@/lib/economics/types";
import { STATE_META } from "@/lib/client/live";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/use-api";
import { api } from "@/lib/client/api";
import { big, formatUsd } from "@/lib/economics/money";
import { OrganismFallback } from "@/components/organism/fallback";
import { STATE_PLAIN } from "./guide";
import { Button, ButtonLink, cx, inputClass } from "./ui";

export type SetupStatus = {
  hasOperator: boolean;
  canClaim: boolean;
  isOperator: boolean;
  treasury: { receiverId: string; method: "deposit" | "transfer"; source: "env" | "app" } | null;
  treasuryEditable: boolean;
  network: string;
};

export function useSetup() {
  const { me } = useSession();
  return useApi<SetupStatus>("/api/setup", { deps: [me?.user?.id] });
}

/** One plain sentence describing what the business is doing right now, and why. */
export function statusSentence(o: OverviewDTO): { headline: string; detail: string } {
  const liquid = formatUsd(big(o.liquidity));
  const reserve = formatUsd(big(o.hardReserve));
  switch (o.state) {
    case "SURVIVAL":
      return big(o.treasury) === 0n
        ? { headline: "It has no money yet, so it isn't answering paid questions.", detail: "Like a company on day one with an empty bank account. Fund it and it wakes up." }
        : { headline: "It's out of spare money, so it paused paid answers to protect itself.", detail: `It has ${liquid} of its own money and never dips below its ${reserve} safety reserve.` };
    case "DEFENSIVE":
      return { headline: "Money is getting tight, so it switched to cheaper AI models.", detail: "It still answers, but picks models that keep it profitable." };
    case "RECOVERY":
      return { headline: "Funding is back. It's rebuilding carefully.", detail: "It returns to the best models only after staying healthy for a few minutes." };
    default:
      return { headline: "Funds are healthy. There's room to think.", detail: "It can consider stronger models when the request fits its budget." };
  }
}

/** Claim the operator role and pick the treasury account, without touching any config file. */
export function ClaimForm({ accountId, onDone, compact }: { accountId: string; onDone: () => void; compact?: boolean }) {
  const [treasury, setTreasury] = useState(accountId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/setup", { method: "POST", json: { treasuryAccountId: treasury.trim().toLowerCase() } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cx("rounded-xl border border-g-200 bg-surface p-4", compact ? "" : "mt-3")}>
      <label className="block text-[13px] font-semibold text-ink" htmlFor="treasury-account">
        Which NEAR account should hold the business&apos;s money?
      </label>
      <p className="mt-0.5 text-[12.5px] leading-[18px] text-muted">
        Deposits are sent to this account and checked on chain. Your own account is fine for a demo; a separate one is cleaner.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input id="treasury-account" className={cx(inputClass, "min-w-[200px] flex-1 font-mono text-[13px]")} value={treasury} onChange={(e) => setTreasury(e.target.value)} spellCheck={false} />
        <Button variant="green" onClick={submit} loading={busy} disabled={treasury.trim().length < 2}>
          Make me the operator
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-[12.5px] text-sv-text">{error}</p>}
    </div>
  );
}

type StepDef = { key: string; title: string; body: React.ReactNode; done: boolean; action?: React.ReactNode };

const KEY = "metabolic:journey-collapsed";

/**
 * The guided path at the top of the Overview: what this is, what it's doing
 * right now, and the next thing to do. Adapts to who is looking (visitor,
 * first operator, operator, customer).
 */
export function Journey({ overview }: { overview: OverviewDTO | null }) {
  const { me, refresh } = useSession();
  const setup = useSetup();
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read a per-browser preference after mount
      setCollapsed(saved === null ? null : saved === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () => {
    const next = !isCollapsed;
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* storage unavailable */ }
    setCollapsed(next);
  };

  const s = setup.data;
  const user = me?.user ?? null;
  const funded = overview ? big(overview.liquidity) > big(overview.hardReserve) : false;
  const hasCredit = big(me?.credits?.available) > 0n;
  const earned = overview ? big(overview.revenueTotal) > 0n : false;
  const operatorView = !!s && (s.isOperator || s.canClaim || !s.hasOperator);

  const steps: StepDef[] = [];
  steps.push({
    key: "signin",
    title: "Sign in with a NEAR wallet",
    body: "Your wallet is your account. Signing in is a free signature, not a payment.",
    done: !!user,
    action: <ButtonLink href="/login" size="sm" variant="green">Sign in</ButtonLink>,
  });
  if (operatorView) {
    steps.push({
      key: "claim",
      title: "Become the operator",
      body: s?.isOperator ? (
        <>You run this business. Deposits go to <span className="font-mono">{s.treasury?.receiverId ?? "—"}</span>.</>
      ) : (
        "Nobody runs this business yet. The first person to sign in becomes its operator and chooses where its money lives."
      ),
      done: !!s?.isOperator && !!s.treasury,
      action: user && s?.canClaim ? <ClaimForm accountId={user.accountId} compact onDone={() => { void setup.reload(); void refresh(); }} /> : undefined,
    });
    steps.push({
      key: "fund",
      title: "Give it starting money",
      body: overview ? (
        <>Deposit about <b>1 NEAR</b> of testnet funds. It needs more than its {formatUsd(big(overview.hardReserve))} safety reserve to start working.</>
      ) : (
        "Deposit a little testnet NEAR as the business's starting capital."
      ),
      done: funded,
      action: <ButtonLink href="/console/treasury?deposit=capital" size="sm" variant="green">Fund the business</ButtonLink>,
    });
    steps.push({
      key: "credit",
      title: "Add a little credit for yourself",
      body: "The business's money isn't yours to spend on answers. Add some personal credit (about 0.2 NEAR is plenty) so you can ask it questions like any customer.",
      done: hasCredit || earned,
      action: <ButtonLink href="/console/treasury?deposit=credits" size="sm" variant="green">Add credit</ButtonLink>,
    });
  } else {
    steps.push({
      key: "credit",
      title: "Add a little credit",
      body: "Deposit some testnet NEAR. Each answer is paid from it, and you see the exact price.",
      done: hasCredit,
      action: <ButtonLink href="/console/treasury?deposit=credits" size="sm" variant="green">Add credit</ButtonLink>,
    });
  }
  steps.push({
    key: "ask",
    title: "Ask it a question",
    body: "It prices every AI model first, answers with the best one it can afford, and shows you why.",
    done: earned,
    action: <ButtonLink href="/console/workspace" size="sm" variant="green">Open the AI Workspace</ButtonLink>,
  });
  steps.push({
    key: "stress",
    title: "Break it on purpose",
    body: "Spike AI prices or drain its money in a safe simulation and watch it adapt. No wallet needed.",
    done: false,
    action: <ButtonLink href="/console/stress-lab" size="sm" variant="secondary">Open the Stress Lab</ButtonLink>,
  });

  const firstOpen = steps.findIndex((x) => !x.done);
  const core = steps.filter((x) => x.key !== "stress");
  const doneCount = core.filter((x) => x.done).length;
  const isCollapsed = collapsed ?? (doneCount === core.length);
  const sentence = overview ? statusSentence(overview) : null;
  const state: OperatingState = overview?.state ?? "ABUNDANCE";

  return (
    <section aria-label="What this is and what to do next" className="m-journey mb-5 overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="m-journey-intro flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="h-16 w-16 shrink-0 rounded-2xl bg-stage p-1.5">
          <OrganismFallback state={state} filaments={false} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="m-label text-g-700">Right now</div>
          <AnimatePresence mode="wait">
            <motion.h2 key={sentence?.headline ?? "loading"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }} className="mt-1 font-serif text-[24px] leading-[30px] text-ink sm:text-[28px] sm:leading-[34px]">
              {sentence?.headline ?? "Checking on the business…"}
            </motion.h2>
          </AnimatePresence>
          {sentence && (
            <p className="mt-1 text-[14px] leading-[22px] text-ink-2">
              {sentence.detail} <span className="text-muted">Mood: <b className={STATE_META[state].text}>{STATE_META[state].label}</b> — {STATE_PLAIN[state]}.</span>
            </p>
          )}
        </div>
        <button type="button" onClick={toggle} aria-expanded={!isCollapsed} className="shrink-0 self-start rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 hover:border-line-strong hover:text-ink sm:self-center">
          {isCollapsed ? `Setup guide · ${doneCount}/${core.length}` : "Hide guide"}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }} className="overflow-hidden">
            <div className="border-t border-line bg-paper/60 px-5 py-4 sm:px-6">
              <div className="mb-3 flex items-center gap-3">
                <span className="text-[13px] font-semibold text-ink">Get it running</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={core.length} aria-valuenow={doneCount}>
                  <motion.div className="h-full rounded-full bg-g-500" initial={false} animate={{ width: `${(doneCount / core.length) * 100}%` }} transition={{ duration: 0.5 }} />
                </div>
                <span className="font-mono text-[12px] text-muted">{doneCount}/{core.length}</span>
              </div>
              <ol className="space-y-1.5">
                {steps.map((st, i) => {
                  const current = i === firstOpen;
                  return (
                    <li key={st.key} className={cx("rounded-xl px-3 py-2.5 transition-colors", current ? "border border-g-200 bg-g-50/60" : "border border-transparent")}>
                      <div className="flex items-start gap-3">
                        <span
                          className={cx(
                            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold",
                            st.done ? "bg-g-700 text-white" : current ? "bg-surface text-g-700 ring-2 ring-g-500" : "bg-paper-sunken text-muted",
                          )}
                        >
                          {st.done ? "✓" : i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className={cx("text-[14.5px] font-semibold", st.done ? "text-ink-2" : "text-ink")}>{st.title}</div>
                          {(current || st.key === "claim") && <p className="mt-0.5 text-[13px] leading-5 text-ink-2">{st.body}</p>}
                          {current && st.action && st.key === "claim" && <div className="mt-2">{st.action}</div>}
                          {current && st.action && st.key !== "claim" && <div className="mt-3 sm:hidden">{st.action}</div>}
                        </div>
                        {current && st.action && st.key !== "claim" && <div className="hidden shrink-0 sm:block">{st.action}</div>}
                        {!current && !st.done && st.key === "stress" && <Link href="/console/stress-lab" className="shrink-0 text-[13px] font-semibold text-g-700 hover:underline">Try it →</Link>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
